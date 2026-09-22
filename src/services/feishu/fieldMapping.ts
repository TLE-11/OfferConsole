import type { ApplicationRecord } from '../../shared/types.ts';

/**
 * 本地投递记录 → 飞书多维表格字段映射。
 *
 * 用户需在多维表格中按下列列名建列（类型见注释）；缺失的列会被飞书
 * API 拒绝并给出提示，配置测试时会做预检。
 */
export function buildFeishuFields(record: ApplicationRecord): Record<string, unknown> {
  return {
    '公司': record.companyName,
    '岗位': record.jobTitle,
    '渠道': record.sourceSite,
    '投递链接': record.sourceUrl ? { text: record.jobTitle || '查看', link: record.sourceUrl } : null,
    '状态': record.status,                    // 单选：待投递/已投递/已笔试/面试中/offer/终止
    '工作地点': record.location,
    '投递时间': toFeishuDateMs(record.appliedAt), // 日期（毫秒时间戳）
    '备注': record.notes,
    '本地记录ID': record.id,                   // 文本，幂等键
    '更新时间': toFeishuDateMs(record.updatedAt),
  };
}

/** 飞书日期字段要求毫秒时间戳；解析失败返回 null（写入时该字段留空） */
export function toFeishuDateMs(value: string | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value.length === 10 ? `${value}T00:00:00+08:00` : value);
  return Number.isNaN(time) ? null : time;
}

/** 表格需要预先创建的全部列名（用于配置测试时预检缺失列） */
export const REQUIRED_FEISHU_COLUMNS = [
  '公司',
  '岗位',
  '渠道',
  '状态',
  '本地记录ID',
] as const;
