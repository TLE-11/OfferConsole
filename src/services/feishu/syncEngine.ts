import type { ApplicationRecord } from '../../shared/types.ts';
import { StorageService } from '../../shared/storage.ts';
import { FeishuClient, FeishuApiError } from './feishuClient.ts';
import { buildFeishuFields } from './fieldMapping.ts';
import {
  FEISHU_BACKOFF_MS,
  FEISHU_MAX_ATTEMPTS,
  FEISHU_SYNC_ALARM,
  type FeishuConfig,
  type FeishuRecordMap,
  type FeishuSyncMeta,
  type FeishuSyncStatus,
} from './types.ts';

/**
 * 对账式单向同步（决策 D2）。
 *
 * 不追踪每次变更的细节：任何投递记录变更后触发一轮对账，diff 出
 * 「本地有、远端没有或已过期」的记录逐条 upsert，「映射在、本地已删」的
 * 记录逐条 delete。天然幂等（本地记录ID 为幂等键）、天然合并（重复触发
 * 只是重复 diff）、可自愈（飞书侧被手删的行会重建，映射丢失会按幂等键找回）。
 *
 * 触发：变更后 chrome.alarms 3s 防抖调度；失败按 FEISHU_BACKOFF_MS 退避，
 * 由 alarm 在最早 nextRetryAt 唤醒续跑（MV3 Service Worker 被杀也不丢进度）。
 */

const CONFIG_KEY = 'feishuConfig';
const RECORD_MAP_KEY = 'feishuRecordMap';
const SYNC_META_KEY = 'feishuSyncMeta';

/** 串行写飞书时的节流间隔，远离应用级限流（20 QPS） */
const WRITE_THROTTLE_MS = 120;

// ---------- 配置与状态读写 ----------

export async function getFeishuConfig(): Promise<FeishuConfig | null> {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  return (result[CONFIG_KEY] as FeishuConfig | undefined) ?? null;
}

export async function saveFeishuConfig(config: FeishuConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}

export async function getFeishuSyncStatus(): Promise<FeishuSyncStatus> {
  const [config, meta, map, records] = await Promise.all([
    getFeishuConfig(),
    readSyncMeta(),
    readRecordMap(),
    StorageService.getApplicationRecords(),
  ]);
  const remoteOnlyIds = Object.keys(map).filter(id => !records.some(r => r.id === id));
  return {
    configured: isConfigComplete(config),
    enabled: config?.enabled === true,
    pendingCount: remoteOnlyIds.length + records.length - Object.keys(map).filter(id => records.some(r => r.id === id)).length + Object.keys(meta.failures).length,
    failedCount: Object.keys(meta.failures).length,
    lastSyncedAt: meta.lastSyncedAt,
    lastError: meta.lastError,
    failures: Object.entries(meta.failures).map(([localId, failure]) => ({ localId, ...failure })),
  };
}

// ---------- 调度 ----------

/** 变更后防抖触发（同名 alarm 覆盖即防抖，3s 后执行） */
export async function scheduleFeishuReconcile(): Promise<void> {
  const config = await getFeishuConfig();
  if (!isConfigComplete(config) || !config.enabled) return;
  try {
    await chrome.alarms.create(FEISHU_SYNC_ALARM, { delayInMinutes: 0.05 });
  } catch {
    // alarms 不可用（如测试环境）时静默，调用方仍可直接 reconcileFeishuNow()
  }
}

/** alarm 唤醒入口：background 的 chrome.alarms.onAlarm 里调用 */
export async function handleFeishuAlarm(alarmName: string): Promise<void> {
  if (alarmName !== FEISHU_SYNC_ALARM) return;
  await reconcileFeishuNow();
}

// ---------- 对账主流程 ----------

export async function reconcileFeishuNow(now = Date.now()): Promise<FeishuSyncMeta> {
  const [config, map, meta, records] = await Promise.all([
    getFeishuConfig(),
    readRecordMap(),
    readSyncMeta(),
    StorageService.getApplicationRecords(),
  ]);

  if (!isConfigComplete(config) || !config?.enabled) return meta;

  const client = new FeishuClient(config);
  const nextMap: FeishuRecordMap = { ...map };
  const failures: FeishuSyncMeta['failures'] = {};
  let touched = false;

  // 本地存在 → upsert；远端映射存在但本地已删 → delete
  const upserts = records;
  const deletes = Object.keys(map).filter(localId => !records.some(r => r.id === localId));

  for (const record of upserts) {
    const prevFailure = meta.failures[record.id];
    if (prevFailure && prevFailure.nextRetryAt > now) {
      failures[record.id] = prevFailure;
      continue;
    }
    try {
      const recordId = await upsertOne(client, nextMap, record);
      nextMap[record.id] = recordId;
      touched = true;
      await sleep(WRITE_THROTTLE_MS);
    } catch (error) {
      failures[record.id] = nextFailure(prevFailure, error, now);
    }
  }

  for (const localId of deletes) {
    const prevFailure = meta.failures[localId];
    if (prevFailure && prevFailure.nextRetryAt > now) {
      failures[localId] = prevFailure;
      continue;
    }
    try {
      const recordId = nextMap[localId] ?? (await client.findRecordIdByLocalId(localId));
      if (recordId) {
        await client.deleteRecord(recordId);
        await sleep(WRITE_THROTTLE_MS);
      }
      delete nextMap[localId];
      touched = true;
    } catch (error) {
      failures[localId] = nextFailure(prevFailure, error, now);
    }
  }

  const nextMeta: FeishuSyncMeta = {
    failures,
    ...(Object.keys(failures).length === 0 && touched
      ? { lastSyncedAt: new Date(now).toISOString(), lastError: undefined }
      : {}),
    ...(Object.keys(failures).length > 0
      ? { lastError: `${Object.keys(failures).length} 条记录同步失败，将自动重试` }
      : {}),
  };

  await Promise.all([
    chrome.storage.local.set({ [RECORD_MAP_KEY]: nextMap, [SYNC_META_KEY]: nextMeta }),
  ]);
  await scheduleNextAlarm(nextMeta);
  return nextMeta;
}

/** 单条 upsert：优先更新映射行；映射缺失时按幂等键找回；远端被手删时重建 */
async function upsertOne(
  client: FeishuClient,
  map: FeishuRecordMap,
  record: ApplicationRecord,
): Promise<string> {
  const fields = buildFeishuFields(record);
  const mappedId = map[record.id];

  if (mappedId) {
    try {
      await client.updateRecord(mappedId, fields);
      return mappedId;
    } catch (error) {
      if (!isRecordMissingError(error)) throw error;
      // 远端行被手动删除，降级为重建
    }
  }

  const existingId = await client.findRecordIdByLocalId(record.id);
  if (existingId) {
    await client.updateRecord(existingId, fields);
    return existingId;
  }
  return client.createRecord(fields);
}

// ---------- 内部工具 ----------

function isConfigComplete(config: FeishuConfig | null): config is FeishuConfig {
  return Boolean(
    config
    && config.appId.trim()
    && config.appSecret.trim()
    && config.appToken.trim()
    && config.tableId.trim(),
  );
}

function isRecordMissingError(error: unknown): boolean {
  if (!(error instanceof FeishuApiError)) return false;
  return /not[\s_-]*found|不存在|record.*missing/i.test(error.message);
}

function nextFailure(
  prev: FeishuSyncMeta['failures'][string] | undefined,
  error: unknown,
  now: number,
): FeishuSyncMeta['failures'][string] {
  const attempts = Math.min((prev?.attempts ?? 0) + 1, FEISHU_MAX_ATTEMPTS);
  return {
    attempts,
    lastError: error instanceof Error ? error.message : String(error),
    nextRetryAt: now + FEISHU_BACKOFF_MS[Math.min(attempts - 1, FEISHU_BACKOFF_MS.length - 1)],
  };
}

async function scheduleNextAlarm(meta: FeishuSyncMeta): Promise<void> {
  try {
    const pending = Object.values(meta.failures)
      .map(f => f.nextRetryAt)
      .filter(t => Number.isFinite(t));
    if (pending.length === 0) {
      await chrome.alarms.clear(FEISHU_SYNC_ALARM);
    } else {
      await chrome.alarms.create(FEISHU_SYNC_ALARM, { when: Math.min(...pending) });
    }
  } catch {
    // alarms 不可用时静默
  }
}

async function readRecordMap(): Promise<FeishuRecordMap> {
  const result = await chrome.storage.local.get(RECORD_MAP_KEY);
  return (result[RECORD_MAP_KEY] as FeishuRecordMap | undefined) ?? {};
}

async function readSyncMeta(): Promise<FeishuSyncMeta> {
  const result = await chrome.storage.local.get(SYNC_META_KEY);
  const stored = result[SYNC_META_KEY] as FeishuSyncMeta | undefined;
  return { failures: {}, ...stored };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
