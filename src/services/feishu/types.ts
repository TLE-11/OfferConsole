/**
 * 飞书多维表格单向同步（决策 D2：本地为准，单向推送，不回写）。
 */

export interface FeishuConfig {
  /** 自建应用凭证（飞书开放平台创建） */
  appId: string;
  appSecret: string;
  /** 多维表格 app_token（表格 URL 中 /base/ 之后的部分） */
  appToken: string;
  /** 数据表 table_id（表格 URL 中 table= 参数） */
  tableId: string;
  /** 总开关 */
  enabled: boolean;
}

/** 本地记录 id → 飞书 record_id 的映射（删除/更新时定位远端行） */
export type FeishuRecordMap = Record<string, string>;

export interface FeishuRecordFailure {
  attempts: number;
  lastError: string;
  /** 下次允许重试的时间（epoch ms），指数退避 */
  nextRetryAt: number;
}

export interface FeishuSyncMeta {
  /** 上次成功完成一轮对账的时间（ISO） */
  lastSyncedAt?: string;
  /** 逐条失败记录；同步成功的条目会从表中移除 */
  failures: Record<string, FeishuRecordFailure>;
  /** 上一轮整体错误（如配置缺失、token 获取失败） */
  lastError?: string;
}

export interface FeishuSyncStatus {
  configured: boolean;
  enabled: boolean;
  pendingCount: number;
  failedCount: number;
  lastSyncedAt?: string;
  lastError?: string;
  failures: Array<{ localId: string } & FeishuRecordFailure>;
}

export const FEISHU_SYNC_ALARM = 'offerconsole-feishu-reconcile';

/** 单条记录最大重试次数，超过后保持失败状态等待下次对账 */
export const FEISHU_MAX_ATTEMPTS = 8;

/** 指数退避（毫秒）：5s / 30s / 2min / 10min / 30min / 1h / 2h / 4h */
export const FEISHU_BACKOFF_MS = [
  5_000,
  30_000,
  120_000,
  600_000,
  1_800_000,
  3_600_000,
  7_200_000,
  14_400_000,
] as const;
