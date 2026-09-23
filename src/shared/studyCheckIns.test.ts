import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStudyCheckInsCsv,
  computeStreakDays,
  computeStudyStats,
  formatLocalDate,
  normalizeStudyCheckIns,
  validateStudyCheckIns,
  type StudyCheckIn,
} from './studyCheckIns.ts';
import { createBackupDocument, parseAndValidateBackup, serializeBackup, createBackupSummary } from './backup.ts';
import { detectProblemFromPage, matchProblemUrl, cleanProblemTitle } from './problemDetector.ts';
import type { BackupData } from './types.ts';

// ---------- 测试数据 ----------

const base: StudyCheckIn = {
  id: 'study-1',
  date: '2026-09-22',
  platform: 'LeetCode',
  problemId: 'two-sum',
  problemTitle: '两数之和',
  difficulty: '简单',
  tags: ['数组', '哈希表'],
  durationMin: 15,
  result: 'AC',
  note: '',
  sourceUrl: 'https://leetcode.cn/problems/two-sum/',
  createdAt: '2026-09-22T10:00:00.000Z',
};

// ---------- normalize / validate ----------

test('normalizeStudyCheckIns 兜底缺省字段并过滤坏数据', () => {
  const result = normalizeStudyCheckIns([
    base,
    { id: 'x' },                              // 缺 problemTitle → 过滤
    'not-an-object',                          // 非对象 → 过滤
    { id: 'y', problemTitle: '有效', tags: '数组', durationMin: 'abc' }, // 类型错误兜底
  ]);

  assert.equal(result.length, 2);
  assert.equal(result[0].problemTitle, '两数之和');
  const patched = result[1];
  assert.deepEqual(patched.tags, [], 'tags 类型错误时应兜底为空数组');
  assert.equal(patched.durationMin, null);
  assert.equal(patched.result, 'AC', '非法结果应兜底为 AC');
});

test('validateStudyCheckIns 校验备份导入结构', () => {
  assert.equal(validateStudyCheckIns(undefined), true);
  assert.equal(validateStudyCheckIns(null), true);
  assert.equal(validateStudyCheckIns([base]), true);
  assert.equal(validateStudyCheckIns('数组以外'), false);
  assert.equal(validateStudyCheckIns([{ id: 'x' }]), false);
});

// ---------- 连续天数 ----------

test('computeStreakDays：今天已打卡则从今天连续计数', () => {
  const now = new Date('2026-09-22T12:00:00');
  const dates = new Set(['2026-09-22', '2026-09-21', '2026-09-20', '2026-09-18']);
  assert.equal(computeStreakDays(dates, now), 3);
});

test('computeStreakDays：今天未打卡但昨天有，连续记录保留', () => {
  const now = new Date('2026-09-22T12:00:00');
  const dates = new Set(['2026-09-21', '2026-09-20']);
  assert.equal(computeStreakDays(dates, now), 2);
});

test('computeStreakDays：昨天也没有则归零；空集合归零', () => {
  const now = new Date('2026-09-22T12:00:00');
  assert.equal(computeStreakDays(new Set(['2026-09-19']), now), 0);
  assert.equal(computeStreakDays(new Set(), now), 0);
});

// ---------- 统计 ----------

test('computeStudyStats 汇总今日/本周/标签/平台', () => {
  const now = new Date('2026-09-22T12:00:00'); // 周二
  const checkIns: StudyCheckIn[] = [
    base,                                                            // 今天
    { ...base, id: 's2', date: '2026-09-21', platform: '牛客', tags: ['数组'] },
    { ...base, id: 's3', date: '2026-09-15', tags: ['动态规划'] },     // 上周
  ];
  const stats = computeStudyStats(checkIns, now);

  assert.equal(stats.totalCount, 3);
  assert.equal(stats.todayCount, 1);
  assert.equal(stats.weekCount, 2, '本周一起算，9/15(上周二) 不计入');
  assert.equal(stats.streakDays, 2);
  assert.deepEqual(stats.tagDistribution[0], { tag: '数组', count: 2 });
  assert.equal(stats.platformDistribution.length, 2);
});

// ---------- CSV ----------

test('buildStudyCheckInsCsv 带 BOM 且正确转义特殊字符', () => {
  const tricky: StudyCheckIn = {
    ...base,
    id: 's-csv',
    problemTitle: '含,逗号与"引号"',
    note: '第一行\n第二行',
    tags: ['数组', '字符串'],
  };
  const csv = buildStudyCheckInsCsv([base, tricky]);

  assert.ok(csv.charCodeAt(0) === 0xFEFF, '应以 BOM 开头（Excel 兼容）');
  const lines = csv.slice(1).split('\n');
  assert.equal(lines[0], '日期,平台,题号,题目,难度,标签,耗时(分钟),结果,备注,链接');
  // 转义行因含换行被引号包裹
  assert.ok(csv.includes('"含,逗号与""引号"""'));
  assert.ok(csv.includes('"第一行\n第二行"'));
  // 标签用 | 连接，不触发额外转义
  assert.ok(csv.includes('数组|哈希表'));
});

// ---------- 备份集成 ----------

test('备份往返保留刷题打卡，摘要计数正确', () => {
  const data: BackupData = {
    userProfile: null,
    llmConfig: null,
    settings: null,
    applicationRecords: [],
    studyCheckIns: [base],
  };
  const serialized = serializeBackup(createBackupDocument(data, '0.1.0', '2026-09-22T00:00:00.000Z'));
  const parsed = parseAndValidateBackup(serialized);

  assert.ok(parsed.success, '含打卡记录的备份应通过校验');
  if (!parsed.success) return;
  assert.equal(parsed.document.data.studyCheckIns?.length, 1);
  assert.equal(parsed.document.data.studyCheckIns?.[0]?.problemTitle, '两数之和');

  const summary = createBackupSummary(parsed.document);
  assert.equal(summary.studyCheckInCount, 1);
});

test('旧版备份（无打卡字段）仍可导入，字段缺省为空数组', () => {
  const data: BackupData = {
    userProfile: null,
    llmConfig: null,
    settings: null,
    applicationRecords: [],
  };
  const serialized = serializeBackup(createBackupDocument(data, '0.1.0', '2026-09-22T00:00:00.000Z'));
  // 模拟旧备份：手工移除该字段
  const value = JSON.parse(serialized);
  delete value.data.studyCheckIns;
  const parsed = parseAndValidateBackup(JSON.stringify(value));

  assert.ok(parsed.success, '缺省打卡字段的旧备份应兼容');
  if (!parsed.success) return;
  assert.equal(createBackupSummary(parsed.document).studyCheckInCount, 0);
});

// ---------- 题目页识别器 ----------

test('matchProblemUrl 识别牛客与 LeetCode 各形态', () => {
  assert.deepEqual(matchProblemUrl('https://nowcoder.com/practice/abc123def'), { platform: '牛客', problemId: 'abc123def' });
  assert.deepEqual(matchProblemUrl('https://nowcoder.com/questionTerminal/xyz789'), { platform: '牛客', problemId: 'xyz789' });
  assert.deepEqual(
    matchProblemUrl('https://nowcoder.com/exam/oj?questionId=456&tab=1'),
    { platform: '牛客', problemId: '456' },
  );
  assert.deepEqual(matchProblemUrl('https://leetcode.cn/problems/two-sum/'), { platform: 'LeetCode', problemId: 'two-sum' });
  assert.deepEqual(matchProblemUrl('https://leetcode.com/problems/3sum/description/'), { platform: 'LeetCode', problemId: '3sum' });
  assert.deepEqual(matchProblemUrl('https://codetop.cc/#/questions'), { platform: 'CodeTop', problemId: '' });
  assert.equal(matchProblemUrl('https://www.baidu.com'), null);
});

test('cleanProblemTitle 清理各站标题噪声', () => {
  assert.equal(cleanProblemTitle('LeetCode', '两数之和 - 力扣（LeetCode）'), '两数之和');
  assert.equal(cleanProblemTitle('牛客', '合并两个有序链表_牛客题霸_牛客网'), '合并两个有序链表');
  assert.equal(cleanProblemTitle('牛客', '跳台阶 - 牛客网'), '跳台阶');
});

test('detectProblemFromPage 组合 URL 与标题，非题目页返回 null', () => {
  const detected = detectProblemFromPage('https://leetcode.cn/problems/two-sum/', '两数之和 - 力扣（LeetCode）');
  assert.deepEqual(detected, {
    platform: 'LeetCode',
    problemId: 'two-sum',
    title: '两数之和',
    url: 'https://leetcode.cn/problems/two-sum/',
  });
  assert.equal(detectProblemFromPage('https://nowcoder.com/', '牛客网'), null);
});
