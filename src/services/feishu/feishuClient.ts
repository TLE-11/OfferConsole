import type { FeishuConfig } from './types.ts';

/**
 * 飞书 OpenAPI 客户端：tenant_access_token 自动缓存/刷新 + 多维表格记录 CRUD。
 *
 * token 缓存在 chrome.storage.local（Service Worker 被杀后不丢），
 * 提前 60s 视为过期；API 返回 token 失效错误码时强制刷新并重试一次。
 */

export class FeishuApiError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'FeishuApiError';
    this.code = code;
  }
}

/** tenant_access_token 失效/缺失相关的业务错误码，命中即刷新重试一次 */
const TOKEN_INVALID_CODES = new Set([99991661, 99991663, 99991664]);

const OPEN_BASE = 'https://open.feishu.cn/open-apis';
const TOKEN_CACHE_KEY = 'feishuTenantTokenCache';

interface TokenCache {
  token: string;
  /** epoch ms，提前 60s 过期 */
  expireAt: number;
}

interface FeishuEnvelope<T> {
  code?: number;
  msg?: string;
  data?: T;
}

export class FeishuClient {
  private readonly config: FeishuConfig;

  constructor(config: FeishuConfig) {
    this.config = config;
  }

  /** 配置测试：能拿到 token 且目标数据表可访问（读取第一页字段定义） */
  async testConnection(): Promise<void> {
    await this.apiFetch<{ fields?: unknown[] }>(
      `/bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/fields?page_size=1`,
      { method: 'GET' },
    );
  }

  /** 列出数据表全部字段名，供 UI 预检缺失列 */
  async listFieldNames(): Promise<string[]> {
    const names: string[] = [];
    let pageToken = '';
    do {
      const data = await this.apiFetch<{ items?: Array<{ field_name?: string }>; page_token?: string; has_more?: boolean }>(
        `/bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/fields?page_size=100${pageToken ? `&page_token=${pageToken}` : ''}`,
        { method: 'GET' },
      );
      for (const item of data?.items ?? []) {
        if (item.field_name) names.push(item.field_name);
      }
      pageToken = data?.has_more ? (data?.page_token ?? '') : '';
    } while (pageToken);
    return names;
  }

  /** 按幂等键「本地记录ID」查找远端行，防止映射表丢失后重复创建 */
  async findRecordIdByLocalId(localId: string): Promise<string | null> {
    const data = await this.apiFetch<{ items?: Array<{ record_id?: string }> }>(
      `/bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records/search`,
      {
        method: 'POST',
        body: JSON.stringify({
          filter: {
            conjunction: 'and',
            conditions: [{ field_name: '本地记录ID', operator: 'is', value: [localId] }],
          },
          page_size: 1,
        }),
      },
    );
    return data?.items?.[0]?.record_id ?? null;
  }

  async createRecord(fields: Record<string, unknown>): Promise<string> {
    const data = await this.apiFetch<{ record?: { record_id?: string } }>(
      `/bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records`,
      { method: 'POST', body: JSON.stringify({ fields }) },
    );
    const recordId = data?.record?.record_id;
    if (!recordId) throw new FeishuApiError(-1, '创建记录成功但未返回 record_id');
    return recordId;
  }

  async updateRecord(recordId: string, fields: Record<string, unknown>): Promise<void> {
    await this.apiFetch(
      `/bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records/${recordId}`,
      { method: 'PUT', body: JSON.stringify({ fields }) },
    );
  }

  async deleteRecord(recordId: string): Promise<void> {
    await this.apiFetch(
      `/bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records/${recordId}`,
      { method: 'DELETE' },
    );
  }

  private async apiFetch<T>(path: string, init: RequestInit, allowTokenRetry = true): Promise<T | undefined> {
    const token = await this.tenantToken();
    const response = await fetch(`${OPEN_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });

    let envelope: FeishuEnvelope<T>;
    try {
      envelope = await response.json() as FeishuEnvelope<T>;
    } catch {
      throw new FeishuApiError(response.status, `飞书返回了非 JSON 响应（HTTP ${response.status}）`);
    }

    if (envelope.code === 0 || envelope.code === undefined) {
      if (!response.ok) {
        throw new FeishuApiError(response.status, `飞书请求失败（HTTP ${response.status}）`);
      }
      return envelope.data;
    }

    if (allowTokenRetry && TOKEN_INVALID_CODES.has(envelope.code)) {
      await this.refreshToken(true);
      return this.apiFetch<T>(path, init, false);
    }

    throw new FeishuApiError(envelope.code, `飞书 API 错误（${envelope.code}）：${envelope.msg ?? '未知错误'}`);
  }

  private async tenantToken(): Promise<string> {
    const cached = (await chrome.storage.local.get(TOKEN_CACHE_KEY))[TOKEN_CACHE_KEY] as TokenCache | undefined;
    if (cached?.token && cached.expireAt > Date.now()) return cached.token;
    return this.refreshToken(false);
  }

  private async refreshToken(force: boolean): Promise<string> {
    if (!force) {
      const cached = (await chrome.storage.local.get(TOKEN_CACHE_KEY))[TOKEN_CACHE_KEY] as TokenCache | undefined;
      if (cached?.token && cached.expireAt > Date.now()) return cached.token;
    }

    const response = await fetch(`${OPEN_BASE}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }),
    });
    const envelope = await response.json() as FeishuEnvelope<{ tenant_access_token?: string; expire?: number }>;
    if (envelope.code !== 0 || !envelope.data?.tenant_access_token) {
      throw new FeishuApiError(
        envelope.code ?? response.status,
        `获取飞书访问凭证失败：${envelope.msg ?? '请检查 App ID 与 App Secret'}`,
      );
    }

    const token = envelope.data.tenant_access_token;
    const expireInSec = envelope.data.expire ?? 7200;
    const cache: TokenCache = { token, expireAt: Date.now() + (expireInSec - 60) * 1000 };
    await chrome.storage.local.set({ [TOKEN_CACHE_KEY]: cache });
    return token;
  }
}
