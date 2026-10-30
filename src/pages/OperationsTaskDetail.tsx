import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUpRight,
  CircleAlert,
  Clock3,
  Database,
  Gauge,
  Loader2,
  Play,
  RefreshCw,
  Timer,
} from 'lucide-react';
import type { CollectionTaskDetailResponse } from '@shared/types';
import { api } from '../lib/api';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { formatDateTime, relativeTime } from '../lib/format';
import { formatDuration, formatPercent, runStatusMeta, runTriggerMeta } from '../lib/operations';
import { EmptyState, LoadingBlock, PageHeader } from '../components/ui';
import { useToast } from '../contexts/ToastContext';

type TaskForm = {
  enabled: boolean;
  schedule: string;
  timeoutSeconds: number;
};

export function OperationsTaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { push } = useToast();
  const { data, loading, error, refetch } = useApi<CollectionTaskDetailResponse>(
    id ? `/collection-tasks/${id}` : null,
    5000,
  );
  const [form, setForm] = useState<TaskForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const task = data?.task;
  const source = data?.source;
  useDocumentTitle(task?.name ?? '采集任务');

  useEffect(() => {
    if (task) {
      setForm({
        enabled: task.enabled,
        schedule: task.schedule,
        timeoutSeconds: task.timeoutSeconds,
      });
    }
    // Only re-initialize when switching tasks; run history updates must not
    // overwrite unsaved edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  if (loading && !data) {
    return (
      <div className="page">
        <PageHeader eyebrow="Operations · task" title="采集任务" />
        <LoadingBlock count={2} />
      </div>
    );
  }

  if (!data || !task || !source) {
    return (
      <div className="page">
        <PageHeader eyebrow="Operations · task" title="采集任务" />
        <div className="error-note">{error ?? '采集任务不存在或已删除'}</div>
        <Link to="/operations/tasks" className="btn btn-ghost mt-4">
          <ArrowLeft size={13} /> 返回采集任务
        </Link>
      </div>
    );
  }

  const dirty =
    form !== null &&
    (form.enabled !== task.enabled ||
      form.schedule.trim() !== task.schedule ||
      form.timeoutSeconds !== task.timeoutSeconds);
  const lastStatus = task.lastStatus === 'never' ? null : runStatusMeta[task.lastStatus];

  const save = async () => {
    if (!form || !dirty) return;
    if (!form.schedule.trim()) {
      push('cron 表达式不能为空', 'error');
      return;
    }
    if (!Number.isFinite(form.timeoutSeconds) || form.timeoutSeconds < 10) {
      push('超时时间至少为 10 秒', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/collection-tasks/${task.id}`, {
        enabled: form.enabled,
        schedule: form.schedule.trim(),
        timeoutSeconds: Math.trunc(form.timeoutSeconds),
      });
      push('采集任务设置已保存', 'success');
      await refetch(true);
    } catch (err) {
      push(err instanceof Error ? err.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const run = async () => {
    setRunning(true);
    try {
      await api.post(`/collection-tasks/${task.id}/run`);
      push('已开始执行，结果会在运行记录中更新', 'success');
      await refetch(true);
    } catch (err) {
      push(err instanceof Error ? err.message : '无法启动任务', 'error');
    } finally {
      setRunning(false);
    }
  };

  const canRun = task.enabled && source.enabled && task.lastStatus !== 'running';

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operations · task"
        title={task.name}
        subtitle={
          <span className="ops-detail-sub">
            <span>{task.description ?? '该任务尚未提供描述'}</span>
            <span className="ops-detail-sep">·</span>
            <span className="ops-source-key">{task.taskKey}</span>
          </span>
        }
        actions={
          <>
            <Link to="/operations/tasks" className="btn btn-ghost">
              <ArrowLeft size={13} /> 返回
            </Link>
            <button className="btn btn-primary" onClick={() => void run()} disabled={!canRun || running}>
              {running || task.lastStatus === 'running' ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Play size={13} />
              )}
              {task.lastStatus === 'running' ? '执行中' : '手动执行'}
            </button>
          </>
        }
      />

      <div className="ops-detail-badges">
        <span className={`pill ${task.enabled ? 'pill-calm' : 'pill-neutral'}`}>
          {task.enabled ? '已启用' : '已暂停'}
        </span>
        {lastStatus ? (
          <span className={`pill ${lastStatus.className}`}>最近{lastStatus.label}</span>
        ) : (
          <span className="pill pill-neutral">尚未执行</span>
        )}
        <Link to={`/operations/sources/${source.id}`} className="pill pill-info ops-pill-link">
          <Database size={11} /> {source.name}
        </Link>
        {!source.enabled && <span className="pill pill-warn">数据源已停用</span>}
      </div>

      {!source.enabled && (
        <div className="ops-callout">
          <CircleAlert size={14} />
          <span>所属数据源已停用，该任务不会执行。启用数据源后才能恢复调度与手动执行。</span>
          <Link to={`/operations/sources/${source.id}`} className="text-link">
            查看数据源 <ArrowUpRight size={12} />
          </Link>
        </div>
      )}

      <div className="stat-grid ops-stat-grid">
        <div className="stat-card">
          <div className="stat-label">
            <Gauge size={12} /> 成功率
          </div>
          <div className="stat-value">{formatPercent(task.successRate)}</div>
          <div className="stat-foot">按历史已结束的执行统计</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <Timer size={12} /> 平均耗时
          </div>
          <div className="stat-value ops-stat-value-text">{formatDuration(task.avgDurationMs)}</div>
          <div className="stat-foot">超时阈值 {task.timeoutSeconds} 秒</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <Clock3 size={12} /> 上次执行
          </div>
          <div className="stat-value ops-stat-value-text">{relativeTime(task.lastRunAt)}</div>
          <div className="stat-foot">{formatDateTime(task.lastRunAt)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <RefreshCw size={12} /> 下次执行
          </div>
          <div className="stat-value ops-stat-value-text">
            {task.enabled && source.enabled ? relativeTime(task.nextRunAt) : '暂停中'}
          </div>
          <div className="stat-foot">{task.enabled ? formatDateTime(task.nextRunAt) : '不参与调度'}</div>
        </div>
      </div>

      <div className="detail-grid">
        <section className="panel">
          <div className="panel-head">
            <h3>执行设置</h3>
            {form && (
              <button className="btn btn-primary btn-sm" onClick={() => void save()} disabled={!dirty || saving}>
                {saving ? '保存中…' : dirty ? '保存设置' : '已保存'}
              </button>
            )}
          </div>
          <div className="panel-body">
            {form ? (
              <>
                <div className="ops-switch-row">
                  <div>
                    <strong>启用定时执行</strong>
                    <span>暂停后不再触发定时执行，不影响已经开始的任务。</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.enabled}
                    aria-label="启用定时执行"
                    className={`switch ${form.enabled ? 'on' : ''}`}
                    onClick={() => setForm({ ...form, enabled: !form.enabled })}
                  />
                </div>
                <div className="field-row">
                  <label className="field">
                    <span className="field-label">cron 表达式</span>
                    <input
                      className="field-input"
                      value={form.schedule}
                      onChange={(event) => setForm({ ...form, schedule: event.target.value })}
                      spellCheck={false}
                    />
                    <span className="field-hint">修改后调度器会立即重新注册，不影响历史记录。</span>
                  </label>
                  <label className="field">
                    <span className="field-label">执行超时（秒）</span>
                    <input
                      className="field-input"
                      type="number"
                      min={10}
                      max={3600}
                      value={form.timeoutSeconds}
                      onChange={(event) =>
                        setForm({ ...form, timeoutSeconds: Number(event.target.value) })
                      }
                    />
                    <span className="field-hint">超时后会标记为异常终止，不会无限期运行。</span>
                  </label>
                </div>
                <p className="form-note">
                  手动执行不修改这里的定时规则，但会写入触发来源为“手动”的运行记录。同一时间只允许一个采集任务执行。
                </p>
              </>
            ) : (
              <span className="ops-run-muted">正在加载设置…</span>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>最近一次执行</h3>
            {task.lastRun && (
              <Link to={`/operations/runs/${task.lastRun.id}`} className="text-link">
                运行详情 <ArrowUpRight size={12} />
              </Link>
            )}
          </div>
          <div className="panel-body">
            {task.lastRun ? (
              <dl className="ops-kv">
                <div>
                  <dt>状态</dt>
                  <dd>
                    <span className={`pill ${runStatusMeta[task.lastRun.status].className}`}>
                      {runStatusMeta[task.lastRun.status].label}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>触发来源</dt>
                  <dd>{runTriggerMeta[task.lastRun.triggerType]}</dd>
                </div>
                <div>
                  <dt>开始 / 结束</dt>
                  <dd>
                    {formatDateTime(task.lastRun.startedAt)} → {formatDateTime(task.lastRun.finishedAt)}
                  </dd>
                </div>
                <div>
                  <dt>耗时</dt>
                  <dd>{formatDuration(task.lastRun.durationMs)}</dd>
                </div>
                <div>
                  <dt>新增 / 更新 / 跳过</dt>
                  <dd>
                    {task.lastRun.createdCount} / {task.lastRun.updatedCount} / {task.lastRun.skippedCount}
                  </dd>
                </div>
                {task.lastRun.errorMessage && (
                  <div>
                    <dt>错误</dt>
                    <dd className="ops-cell-error">{task.lastRun.errorMessage}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <EmptyState
                compact
                icon={Play}
                title="还没有执行记录"
                description="点击右上角“手动执行”，或等待定时调度。"
              />
            )}
          </div>
        </section>
      </div>

      <section className="panel mt-4">
        <div className="panel-head">
          <h3>执行历史</h3>
          <span className="section-count">{data.runs.length}</span>
        </div>
        <div className="panel-body flush">
          {data.runs.length === 0 ? (
            <div className="panel-body">
              <EmptyState
                compact
                icon={Play}
                title="还没有运行记录"
                description="每次定时、手动或重试执行都会记录在这里。"
              />
            </div>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>开始时间</th>
                    <th>状态</th>
                    <th>触发</th>
                    <th>耗时</th>
                    <th>新增 / 更新 / 跳过</th>
                    <th>错误</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((run) => (
                    <tr key={run.id}>
                      <td>{formatDateTime(run.startedAt)}</td>
                      <td>
                        <span className={`pill ${runStatusMeta[run.status].className}`}>
                          {runStatusMeta[run.status].label}
                        </span>
                      </td>
                      <td>{runTriggerMeta[run.triggerType]}</td>
                      <td>{formatDuration(run.durationMs)}</td>
                      <td>
                        {run.createdCount} / {run.updatedCount} / {run.skippedCount}
                      </td>
                      <td className="ops-cell-error">{run.errorMessage ?? '—'}</td>
                      <td>
                        <Link to={`/operations/runs/${run.id}`} className="text-link">
                          详情
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
