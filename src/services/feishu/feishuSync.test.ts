import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApplicationRecord } from '../../shared/types.ts';
import { buildFeishuFields, toFeishuDateMs } from './fieldMapping.ts';
import { FeishuApiError, FeishuClient } from './feishuClient.ts';
import { getFeishuSyncStatus, reconcileFeishuNow } from './syncEngine.ts';
import type { FeishuConfig } from './types.ts';

// ---------- 测试数据 ----------

const config: FeishuConfig = {
  appId: 'cli_test',
  appSecret: 'secret',
  appToken: 'basetable',
  tableId: 'tbl001',
  enabled: true,
};

const record1: ApplicationRecord = {
  id: 'r-1',
  companyName: '字节跳动',
  jobTitle: '前端开发',
  sourceSite: 'jobs.bytedance.com',
  sourceUrl: 'https://jobs.bytedance.com/r1',
  status: '已投递',
  notes: '一志愿',
  appliedAt: '2026-09-01',
  location: '北京',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const record2: ApplicationRecord = {
  ...record1,
  id: 'r-2',
  companyName: '腾讯',
  jobTitle: '后台开发',
  status: '面试中',
};

// ---------- chrome.storage mock（与 backup-sync.test.ts 同模式） ----------

function installChromeStorageMock(initial: Record<string, unknown>) {
  const values = { ...initial };
  const previousChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      storage: {
        local: {
          get: async (keys: string | string[]) => {
            const selected = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(
              selected.filter(key => Object.hasOwn(values, key)).map(key => [key, values[key]]),
            );
          },
          set: async (entries: Record<string, unknown>) => Object.assign(values, entries),
          remove: async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
          },
        },
      },
    },
  });
  return {
    values,
    restore: () => {
      if (previousChrome) Object.defineProperty(globalThis, 'chrome', previousChrome);
      else delete (globalThis as { chrome?: unknown }).chrome;
    },
  };
}

// ---------- 飞书 API mock ----------

interface ApiCall {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

function installFeishuApiMock(options?: {
  failNextCreates?: number;
  updateErrorOnce?: { code: number; msg: string };
  tokenInvalidOnce?: boolean;
}) {
  const calls: ApiCall[] = [];
  const db = { records: new Map<string, { record_id: string; fields: Record<string, unknown> }>(), seq: 0 };
  let tokenSeq = 0;
  let remainingCreateFailures = options?.failNextCreates ?? 0;
  let remainingUpdateErrors = options?.updateErrorOnce ? 1 : 0;
  let remainingTokenInvalid = options?.tokenInvalidOnce ? 1 : 0;

  const json = (data: unknown) => new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: { method?: string; body?: unknown }) => {
    const method = init?.method ?? 'GET';
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ method, path, body });

    if (path === '/open-apis/auth/v3/tenant_access_token/internal') {
      tokenSeq += 1;
      return json({ code: 0, data: { tenant_access_token: `token-${tokenSeq}`, expire: 7200 } });
    }

    if (path.endsWith('/fields')) {
      return json({
        code: 0,
        data: {
          items: ['公司', '岗位', '渠道', '状态', '本地记录ID'].map(name => ({ field_name: name })),
          has_more: false,
        },
      });
    }

    if (path.endsWith('/records/search')) {
      const conditions = (body?.filter as { conditions?: Array<{ value?: string[] }> } | undefined)?.conditions;
      const localId = conditions?.[0]?.value?.[0];
      const found = [...db.records.values()].find(r => r.fields['本地记录ID'] === localId);
      return json({ code: 0, data: { items: found ? [{ record_id: found.record_id }] : [] } });
    }

    if (path.endsWith('/records') && method === 'POST') {
      if (remainingCreateFailures > 0) {
        remainingCreateFailures -= 1;
        return json({ code: 500, msg: 'internal error' });
      }
      const id = `rec-${++db.seq}`;
      db.records.set(id, { record_id: id, fields: body?.fields as Record<string, unknown> });
      return json({ code: 0, data: { record: { record_id: id } } });
    }

    const match = path.match(/\/records\/(rec-\d+)$/);
    if (match) {
      if (remainingTokenInvalid > 0) {
        remainingTokenInvalid -= 1;
        return json({ code: 99991663, msg: 'tenant access token expired' });
      }
      const existing = db.records.get(match[1]);
      if (method === 'PUT') {
        if (!existing) return json({ code: 1254045, msg: 'RecordIdNotFound' });
        if (remainingUpdateErrors > 0) {
          remainingUpdateErrors -= 1;
          return json(options!.updateErrorOnce!);
        }
        existing.fields = body?.fields as Record<string, unknown>;
        return json({ code: 0, data: {} });
      }
      if (method === 'DELETE') {
        db.records.delete(match[1]);
        return json({ code: 0, data: {} });
      }
    }

    throw new Error(`未处理的请求：${method} ${path}`);
  }) as typeof fetch;

  return {
    calls,
    db,
    get tokenRequests() {
      return tokenSeq;
    },
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function seedStorage(records: ApplicationRecord[], extra: Record<string, unknown> = {}) {
  return installChromeStorageMock({
    applicationRecords: records,
    feishuConfig: config,
    ...extra,
  });
}

// ---------- fieldMapping ----------

test('buildFeishuFields 按列名约定映射，链接/日期结构正确', () => {
  const fields = buildFeishuFields(record1) as Record<string, unknown>;

  assert.equal(fields['公司'], '字节跳动');
  assert.equal(fields['岗位'], '前端开发');
  assert.equal(fields['渠道'], 'jobs.bytedance.com');
  assert.equal(fields['状态'], '已投递');
  assert.deepEqual(fields['投递链接'], { text: '前端开发', link: 'https://jobs.bytedance.com/r1' });
  assert.equal(fields['本地记录ID'], 'r-1');
  assert.equal(typeof fields['投递时间'], 'number');
});

test('toFeishuDateMs 支持日期串与 ISO，空值/非法值返回 null', () => {
  const ms = toFeishuDateMs('2026-09-01');
  assert.equal(new Date(ms!).toISOString(), '2026-08-31T16:00:00.000Z'); // 东八区零点
  assert.equal(typeof toFeishuDateMs('2026-09-01T08:00:00.000Z'), 'number');
  assert.equal(toFeishuDateMs(''), null);
  assert.equal(toFeishuDateMs('不是日期'), null);
  assert.equal(toFeishuDateMs(undefined), null);
});

// ---------- FeishuClient ----------

test('tenant token 被缓存，多次调用只获取一次', async () => {
  const storage = installChromeStorageMock({});
  const api = installFeishuApiMock();
  try {
    const client = new FeishuClient(config);
    await client.createRecord({ 公司: 'A' });
    await client.createRecord({ 公司: 'B' });
    assert.equal(api.tokenRequests, 1);
    assert.equal(api.db.records.size, 2);
  } finally {
    api.restore();
    storage.restore();
  }
});

test('token 失效错误码触发刷新并重试一次', async () => {
  const storage = installChromeStorageMock({});
  const api = installFeishuApiMock({ tokenInvalidOnce: true });
  try {
    const client = new FeishuClient(config);
    await client.createRecord({ 公司: 'A' });
    await client.updateRecord('rec-1', { 公司: 'A2' });
    // 首次 token + 失效后强制刷新各一次
    assert.equal(api.tokenRequests, 2);
    assert.equal(api.db.records.get('rec-1')?.fields['公司'], 'A2');
  } finally {
    api.restore();
    storage.restore();
  }
});

test('业务错误抛出 FeishuApiError 并携带错误码', async () => {
  const storage = installChromeStorageMock({});
  const api = installFeishuApiMock({ failNextCreates: 1 });
  try {
    const client = new FeishuClient(config);
    await assert.rejects(
      () => client.createRecord({ 公司: 'A' }),
      (error: unknown) => error instanceof FeishuApiError && error.code === 500,
    );
  } finally {
    api.restore();
    storage.restore();
  }
});

// ---------- reconcile 对账 ----------

test('首轮对账：本地记录全部 create，映射与成功时间写入', async () => {
  const storage = seedStorage([record1, record2]);
  const api = installFeishuApiMock();
  try {
    const meta = await reconcileFeishuNow();
    assert.equal(Object.keys(meta.failures).length, 0);
    assert.ok(meta.lastSyncedAt);
    assert.equal(api.db.records.size, 2);
    const map = storage.values['feishuRecordMap'] as Record<string, string>;
    assert.deepEqual(Object.keys(map).sort(), ['r-1', 'r-2']);
    const pushed = [...api.db.records.values()].find(r => r.fields['本地记录ID'] === 'r-1');
    assert.equal(pushed?.fields['公司'], '字节跳动');
    assert.equal(pushed?.fields['状态'], '已投递');
  } finally {
    api.restore();
    storage.restore();
  }
});

test('增量对账：已有映射走 update；本地删除的记录远端 delete 并清映射', async () => {
  const storage = seedStorage([record1], { feishuRecordMap: { 'r-1': 'rec-9', 'r-gone': 'rec-8' } });
  const api = installFeishuApiMock();
  try {
    // 远端预置两行（模拟之前同步过）
    api.db.records.set('rec-9', { record_id: 'rec-9', fields: { 公司: '旧值', 本地记录ID: 'r-1' } });
    api.db.records.set('rec-8', { record_id: 'rec-8', fields: { 公司: '已删公司', 本地记录ID: 'r-gone' } });

    const meta = await reconcileFeishuNow();
    assert.equal(Object.keys(meta.failures).length, 0);
    assert.equal(api.db.records.get('rec-9')?.fields['公司'], '字节跳动', '已有映射应更新');
    assert.ok(!api.db.records.has('rec-8'), '本地已删的记录应从远端删除');
    const map = storage.values['feishuRecordMap'] as Record<string, string>;
    assert.deepEqual(map, { 'r-1': 'rec-9' });
    // 全程没有 create
    assert.ok(!api.calls.some(c => c.method === 'POST' && c.path.endsWith('/records')));
  } finally {
    api.restore();
    storage.restore();
  }
});

test('映射丢失时按幂等键找回远端行并更新，而非重复创建', async () => {
  const storage = seedStorage([record1]); // feishuRecordMap 为空
  const api = installFeishuApiMock();
  try {
    api.db.records.set('rec-7', { record_id: 'rec-7', fields: { 公司: '旧', 本地记录ID: 'r-1' } });

    const meta = await reconcileFeishuNow();
    assert.equal(Object.keys(meta.failures).length, 0);
    assert.equal(api.db.records.size, 1, '不应重复创建');
    assert.equal(api.db.records.get('rec-7')?.fields['公司'], '字节跳动');
    const map = storage.values['feishuRecordMap'] as Record<string, string>;
    assert.equal(map['r-1'], 'rec-7', '映射应被回填');
  } finally {
    api.restore();
    storage.restore();
  }
});

test('远端行被手动删除时自动重建并更新映射', async () => {
  const storage = seedStorage([record1], { feishuRecordMap: { 'r-1': 'rec-404' } });
  const api = installFeishuApiMock();
  try {
    const meta = await reconcileFeishuNow();
    assert.equal(Object.keys(meta.failures).length, 0);
    assert.equal(api.db.records.size, 1);
    const map = storage.values['feishuRecordMap'] as Record<string, string>;
    assert.notEqual(map['r-1'], 'rec-404', '映射应指向重建后的新行');
  } finally {
    api.restore();
    storage.restore();
  }
});

test('失败进入退避：记录 attempts 与 nextRetryAt，到期前不再请求', async () => {
  const storage = seedStorage([record1]);
  const api = installFeishuApiMock({ failNextCreates: 1 });
  try {
    const now = Date.now();
    const meta1 = await reconcileFeishuNow(now);
    const failure = meta1.failures['r-1'];
    assert.ok(failure, '失败应被记录');
    assert.equal(failure.attempts, 1);
    assert.equal(failure.nextRetryAt, now + 5_000);
    assert.ok(meta1.lastError);

    const callsBefore = api.calls.length;
    const meta2 = await reconcileFeishuNow(now + 1_000); // 未到重试时间
    assert.equal(api.calls.length, callsBefore, '退避期内不应再请求飞书');
    assert.ok(meta2.failures['r-1']);

    // 到期后重试成功并清除失败
    const meta3 = await reconcileFeishuNow(now + 6_000);
    assert.equal(Object.keys(meta3.failures).length, 0);
    assert.ok(meta3.lastSyncedAt);
    assert.equal(api.db.records.size, 1);
  } finally {
    api.restore();
    storage.restore();
  }
});

test('未配置或未启用时直接返回，不发起任何请求', async () => {
  const storage = installChromeStorageMock({
    applicationRecords: [record1],
    feishuConfig: { ...config, enabled: false },
  });
  const api = installFeishuApiMock();
  try {
    await reconcileFeishuNow();
    assert.equal(api.calls.length, 0);
    const status = await getFeishuSyncStatus();
    assert.equal(status.enabled, false);
    assert.equal(status.configured, true);
  } finally {
    api.restore();
    storage.restore();
  }
});
