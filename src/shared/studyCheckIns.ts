/**
 * 笔试刷题打卡（PRD 4.4）：本地记录 + 统计。
 * 牛客/CodeTop 无开放 API，手动与题目页一键打卡并用，数据不出本机。
 */

export type StudyCheckInResult = 'AC' | '未AC' | '复习';

export interface StudyCheckIn {
  id: string;
  /** 打卡归属日 yyyy-MM-dd（本地时区） */
  date: string;
  /** 牛客 / LeetCode / CodeTop / 其他 */
  platform: string;
  problemId: string;
  problemTitle: string;
  /** 简单 / 中等 / 困难 / '' 未知 */
  difficulty: string;
  tags: string[];
  durationMin: number | null;
  result: StudyCheckInResult;
  note: string;
  sourceUrl: string;
  createdAt: string;
}

export interface StudyStats {
  totalCount: number;
  todayCount: number;
  weekCount: number;
  streakDays: number;
  tagDistribution: Array<{ tag: string; count: number }>;
  platformDistribution: Array<{ platform: string; count: number }>;
}

export const STUDY_CHECKIN_RESULTS: StudyCheckInResult[] = ['AC', '未AC', '复习'];
export const STUDY_PLATFORMS = ['牛客', 'LeetCode', 'CodeTop', '其他'] as const;
export const STUDY_DIFFICULTIES = ['简单', '中等', '困难'] as const;

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createStudyCheckInId(): string {
  return `study-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const VALID_RESULTS = new Set<string>(STUDY_CHECKIN_RESULTS);

export function normalizeStudyCheckIn(value: unknown): StudyCheckIn | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.problemTitle !== 'string') return null;
  return {
    id: raw.id,
    date: typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)
      ? raw.date
      : formatLocalDate(new Date(typeof raw.createdAt === 'string' ? raw.createdAt : Date.now())),
    platform: typeof raw.platform === 'string' && raw.platform ? raw.platform : '其他',
    problemId: typeof raw.problemId === 'string' ? raw.problemId : '',
    problemTitle: raw.problemTitle,
    difficulty: typeof raw.difficulty === 'string' ? raw.difficulty : '',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
    durationMin: typeof raw.durationMin === 'number' && Number.isFinite(raw.durationMin)
      ? raw.durationMin
      : null,
    result: VALID_RESULTS.has(raw.result as string) ? raw.result as StudyCheckInResult : 'AC',
    note: typeof raw.note === 'string' ? raw.note : '',
    sourceUrl: typeof raw.sourceUrl === 'string' ? raw.sourceUrl : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
  };
}

export function normalizeStudyCheckIns(value: unknown): StudyCheckIn[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeStudyCheckIn)
    .filter((item): item is StudyCheckIn => item !== null);
}

/** 备份导入校验：字段缺失可容忍（normalize 兜底），结构必须为数组或缺省 */
export function validateStudyCheckIns(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!Array.isArray(value)) return false;
  return value.every(item => (
    typeof item === 'object'
    && item !== null
    && typeof (item as Record<string, unknown>).id === 'string'
    && typeof (item as Record<string, unknown>).problemTitle === 'string'
  ));
}

/**
 * 连续天数：今天有打卡则从今天往回数；今天还没有但昨天有，则从昨天往回数
 * （保留连续记录，避免因当天未打卡而显示为 0 打击积极性）。
 */
export function computeStreakDays(dates: ReadonlySet<string>, now = new Date()): number {
  if (dates.size === 0) return 0;
  const cursor = new Date(now);
  if (!dates.has(formatLocalDate(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!dates.has(formatLocalDate(cursor))) return 0;
  }
  let streak = 0;
  while (dates.has(formatLocalDate(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function computeStudyStats(checkIns: StudyCheckIn[], now = new Date()): StudyStats {
  const dates = new Set(checkIns.map(item => item.date));
  const today = formatLocalDate(now);
  const weekStart = new Date(now);
  // 周一为一周起点
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekStartStr = formatLocalDate(weekStart);

  const tagCounts = new Map<string, number>();
  const platformCounts = new Map<string, number>();
  for (const item of checkIns) {
    platformCounts.set(item.platform, (platformCounts.get(item.platform) ?? 0) + 1);
    for (const tag of item.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  return {
    totalCount: checkIns.length,
    todayCount: checkIns.filter(item => item.date === today).length,
    weekCount: checkIns.filter(item => item.date >= weekStartStr).length,
    streakDays: computeStreakDays(dates, now),
    tagDistribution: [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count),
    platformDistribution: [...platformCounts.entries()]
      .map(([platform, count]) => ({ platform, count }))
      .sort((a, b) => b.count - a.count),
  };
}

const CSV_HEADERS = ['日期', '平台', '题号', '题目', '难度', '标签', '耗时(分钟)', '结果', '备注', '链接'] as const;

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildStudyCheckInsCsv(checkIns: StudyCheckIn[]): string {
  const rows = checkIns.map(item => [
    item.date,
    item.platform,
    item.problemId,
    item.problemTitle,
    item.difficulty,
    item.tags.join('|'),
    item.durationMin === null ? '' : String(item.durationMin),
    item.result,
    item.note,
    item.sourceUrl,
  ].map(csvEscape).join(','));
  // BOM 保证 Excel 直接打开不乱码
  return `﻿${CSV_HEADERS.join(',')}\n${rows.join('\n')}`;
}
