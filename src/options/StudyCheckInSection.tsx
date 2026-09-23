import React, { useEffect, useState } from 'react';
import { MessageService } from '../shared/message';
import {
  computeStudyStats,
  type StudyCheckIn,
} from '../shared/studyCheckIns.ts';

/** options「刷题打卡」页：统计概览 + 记录管理 + CSV 导出 */

const PAGE_SIZE = 100;

export function StudyCheckInSection() {
  const [checkIns, setCheckIns] = useState<StudyCheckIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = async () => {
    const response = await MessageService.sendMessage<StudyCheckIn[]>({ type: 'GET_STUDY_CHECKINS' });
    if (response.success && response.data) setCheckIns(response.data);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const stats = computeStudyStats(checkIns);
  const sorted = [...checkIns].sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  const visible = sorted.slice(0, PAGE_SIZE);

  const handleDelete = async (item: StudyCheckIn) => {
    if (!window.confirm(`删除打卡记录「${item.problemTitle}」（${item.date}）？`)) return;
    setDeleting(item.id);
    try {
      const response = await MessageService.sendMessage({ type: 'DELETE_STUDY_CHECKIN', payload: { id: item.id } });
      if (!response.success) throw new Error(response.error || '删除失败');
      await load();
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '删除失败' });
    } finally {
      setDeleting(null);
    }
  };

  const handleExport = async () => {
    const response = await MessageService.sendMessage<{ csv: string }>({ type: 'EXPORT_STUDY_CHECKINS_CSV' });
    if (!response.success || !response.data) {
      setNotice({ type: 'error', text: response.error || '导出失败' });
      return;
    }
    const url = URL.createObjectURL(new Blob([response.data.csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `offerconsole-刷题打卡-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice({ type: 'success', text: `已导出 ${checkIns.length} 条打卡记录` });
  };

  if (loading) return <div className="options-loading">加载中...</div>;

  return (
    <div className="options-form">
      <div className="custom-information-header">
        <div>
          <h2 className="section-title">刷题打卡</h2>
          <p className="custom-information-description">
            数据保存在本机并随完整备份导出；标签分布将用于 M4 学习计划的短板分析。
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void handleExport()} disabled={checkIns.length === 0}>
          导出 CSV
        </button>
      </div>

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card"><div className="stat-value">{stats.streakDays}</div><div className="stat-label">连续打卡（天）</div></div>
        <div className="stat-card"><div className="stat-value">{stats.todayCount}</div><div className="stat-label">今日</div></div>
        <div className="stat-card"><div className="stat-value">{stats.weekCount}</div><div className="stat-label">本周</div></div>
        <div className="stat-card"><div className="stat-value">{stats.totalCount}</div><div className="stat-label">累计</div></div>
      </div>

      {(stats.tagDistribution.length > 0 || stats.platformDistribution.length > 0) && (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 16, fontSize: 13 }}>
          {stats.tagDistribution.length > 0 && (
            <div>
              <strong>标签分布</strong>
              <div style={{ marginTop: 6, color: '#526b6e' }}>
                {stats.tagDistribution.slice(0, 10).map(item => `${item.tag} ${item.count}`).join(' · ')}
              </div>
            </div>
          )}
          {stats.platformDistribution.length > 0 && (
            <div>
              <strong>平台分布</strong>
              <div style={{ marginTop: 6, color: '#526b6e' }}>
                {stats.platformDistribution.map(item => `${item.platform} ${item.count}`).join(' · ')}
              </div>
            </div>
          )}
        </div>
      )}

      {notice && (
        <div className={notice.type === 'error' ? 'settings-save-error' : 'settings-success'} role="status">
          {notice.text}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="custom-information-empty">
          <p>还没有打卡记录</p>
          <span>在牛客 / LeetCode 题目页打开插件弹窗，可一键打卡当前题目。</span>
        </div>
      ) : (
        <div className="custom-information-list">
          {visible.map(item => (
            <section className="custom-information-item" key={item.id}>
              <div className="custom-information-item-header">
                <h3>
                  {item.problemTitle}
                  <small style={{ marginLeft: 8, fontWeight: 400, color: '#607477' }}>
                    {item.platform}{item.problemId ? ` #${item.problemId}` : ''}
                  </small>
                </h3>
                <button
                  type="button"
                  className="custom-information-remove"
                  onClick={() => void handleDelete(item)}
                  disabled={deleting === item.id}
                >
                  {deleting === item.id ? '删除中…' : '删除'}
                </button>
              </div>
              <div style={{ fontSize: 12, color: '#526b6e', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span>{item.date}</span>
                {item.difficulty && <span>{item.difficulty}</span>}
                <span>{item.result}</span>
                {item.durationMin !== null && <span>{item.durationMin} 分钟</span>}
                {item.tags.length > 0 && <span>{item.tags.join(' / ')}</span>}
              </div>
            </section>
          ))}
          {sorted.length > PAGE_SIZE && (
            <p className="settings-hint">仅显示最近 {PAGE_SIZE} 条，完整数据请导出 CSV 查看。</p>
          )}
        </div>
      )}
    </div>
  );
}
