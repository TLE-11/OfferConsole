import React, { useEffect, useState } from 'react';
import { MessageService } from '../shared/message';
import type { Message } from '../shared/types';
import type { DetectedProblem } from '../shared/problemDetector.ts';
import {
  computeStudyStats,
  STUDY_CHECKIN_RESULTS,
  STUDY_DIFFICULTIES,
  STUDY_PLATFORMS,
  type StudyCheckIn,
  type StudyCheckInResult,
} from '../shared/studyCheckIns.ts';

/**
 * popup 刷题打卡卡片区（L1 手动 + L2 题目页一键）。
 * 题目页打开时自动带出平台与题名；其它页面退化为手动补录。
 */

async function queryPageProblem(): Promise<DetectedProblem | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) return null;
    const response = await MessageService.sendMessageToTab<DetectedProblem | null>(
      tab.id,
      { type: 'GET_PAGE_PROBLEM' } satisfies Message,
      { frameId: 0 },
    );
    return response.success && response.data ? response.data : null;
  } catch {
    // 受限页面（chrome:// 等）没有 content script，按无题目处理
    return null;
  }
}

function parseTagsInput(value: string): string[] {
  return value.split(/[,，、\s]+/).map(tag => tag.trim()).filter(Boolean).slice(0, 8);
}

export function StudyCheckInCard() {
  const [problem, setProblem] = useState<DetectedProblem | null>(null);
  const [checkIns, setCheckIns] = useState<StudyCheckIn[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 表单状态（识别到题目时平台/题名只读）
  const [platform, setPlatform] = useState<string>(STUDY_PLATFORMS[0]);
  const [problemId, setProblemId] = useState('');
  const [title, setTitle] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [duration, setDuration] = useState('');
  const [result, setResult] = useState<StudyCheckInResult>('AC');

  const refreshCheckIns = async () => {
    const response = await MessageService.sendMessage<StudyCheckIn[]>({ type: 'GET_STUDY_CHECKINS' });
    if (response.success && response.data) setCheckIns(response.data);
  };

  useEffect(() => {
    void queryPageProblem().then(detected => {
      if (detected) {
        setProblem(detected);
        setPlatform(detected.platform);
        setProblemId(detected.problemId);
        setTitle(detected.title);
      }
    });
    void refreshCheckIns();
  }, []);

  const stats = computeStudyStats(checkIns);

  const handleSubmit = async () => {
    if (!title.trim()) {
      setNotice('请填写题目名称');
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const response = await MessageService.sendMessage<StudyCheckIn>({
        type: 'CREATE_STUDY_CHECKIN',
        payload: {
          date: '',
          platform,
          problemId: problemId.trim(),
          problemTitle: title.trim(),
          difficulty,
          tags: parseTagsInput(tagsInput),
          durationMin: duration.trim() && Number(duration) > 0 ? Math.round(Number(duration)) : null,
          result,
          note: '',
          sourceUrl: problem?.url ?? '',
        },
      });
      if (!response.success) throw new Error(response.error || '打卡失败');
      setNotice('打卡成功');
      setDuration('');
      if (!problem) {
        setProblemId('');
        setTitle('');
        setTagsInput('');
      }
      await refreshCheckIns();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '打卡失败');
    } finally {
      setSaving(false);
    }
  };

  const showDetectedForm = problem !== null;
  const showManualForm = !problem && manualOpen;

  return (
    <div className="profile-card" style={{ marginTop: 12 }}>
      <div className="profile-card-heading">
        刷题打卡 · 今日 {stats.todayCount} 题 · 连续 {stats.streakDays} 天
      </div>

      {showDetectedForm && (
        <div style={{ fontSize: 13, margin: '8px 0' }}>
          <strong>{problem.platform}</strong>
          {problem.problemId ? ` #${problem.problemId}` : ''}
          <div style={{ marginTop: 4, color: '#163b43', fontWeight: 600 }}>{problem.title}</div>
        </div>
      )}

      {!problem && !manualOpen && (
        <button
          type="button"
          className="button button-secondary"
          style={{ width: '100%', marginTop: 8 }}
          onClick={() => setManualOpen(true)}
        >
          当前不是题目页，手动打卡
        </button>
      )}

      {(showDetectedForm || showManualForm) && (
        <div style={{ display: 'grid', gap: 8, marginTop: 8, fontSize: 13 }}>
          {showManualForm && (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  value={platform}
                  onChange={event => setPlatform(event.target.value)}
                  style={{ flex: 1 }}
                  aria-label="平台"
                >
                  {STUDY_PLATFORMS.map(item => <option key={item} value={item}>{item}</option>)}
                </select>
                <input
                  value={problemId}
                  onChange={event => setProblemId(event.target.value)}
                  placeholder="题号（可空）"
                  style={{ flex: 1 }}
                />
              </div>
              <input
                value={title}
                onChange={event => setTitle(event.target.value)}
                placeholder="题目名称 *"
              />
            </>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <select
              value={difficulty}
              onChange={event => setDifficulty(event.target.value)}
              style={{ flex: 1 }}
              aria-label="难度"
            >
              <option value="">难度</option>
              {STUDY_DIFFICULTIES.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
            <input
              value={duration}
              onChange={event => setDuration(event.target.value.replace(/[^\d]/g, ''))}
              placeholder="耗时（分钟）"
              inputMode="numeric"
              style={{ flex: 1 }}
            />
            <select
              value={result}
              onChange={event => setResult(event.target.value as StudyCheckInResult)}
              style={{ flex: 1 }}
              aria-label="结果"
            >
              {STUDY_CHECKIN_RESULTS.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>

          <input
            value={tagsInput}
            onChange={event => setTagsInput(event.target.value)}
            placeholder="标签，逗号分隔，如：动态规划, 数组"
          />

          <button
            type="button"
            className="button button-primary"
            onClick={() => void handleSubmit()}
            disabled={saving}
          >
            {saving ? '打卡中...' : '打卡'}
          </button>
        </div>
      )}

      {notice && <div style={{ marginTop: 6, fontSize: 12, color: notice === '打卡成功' ? '#0f766e' : '#c2410c' }}>{notice}</div>}
    </div>
  );
}
