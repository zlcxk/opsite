import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUpRight,
  CircleAlert,
  Gauge,
  Loader2,
  Pause,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import type { DataSource, SourceDetailResponse } from '@shared/types';
import { api } from '../lib/api';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { formatDateTime, relativeTime } from '../lib/format';
import {
  dataSourceTypeMeta,
  formatAgeHours,
  formatDuration,
  freshnessMeta,
  healthStatusMeta,
  runStatusMeta,
  runTriggerMeta,
} from '../lib/operations';
import { EmptyState, LoadingBlock, PageHeader } from '../components/ui';
import { useToast } from '../contexts/ToastContext';

type FreshnessForm = {
  enabled: boolean;
  freshnessEnabled: boolean;
  freshnessInterval: number;
  freshnessGracePeriod: number;
};

function formFromSource(source: DataSource): FreshnessForm {
  return {
    enabled: source.enabled,
    freshnessEnabled: source.freshnessEnabled,
    freshnessInterval: source.freshnessInterval,
    freshnessGracePeriod: source.freshnessGracePeriod,
  };
}

export function OperationsSourceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { push } = useToast();
  const { data, loading, error, refetch } = useApi<SourceDetailResponse>(
    id ? `/sources/${id}` : null,
    8000,
  );
  const [form, setForm] = useState<FreshnessForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<'check' | 'collect' | null>(null);

  const source = data?.source;
  useDocumentTitle(source?.name ?? '数据源');

  useEffect(() => {
    if (source) setForm(formFromSource(source));
    // Only re-initialize when switching sources; polling must not overwrite
    // unsaved edits. After saving, the submitted values already match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id]);

  if (loading && !data) {
    return (
      <div className="page">
        <PageHeader eyebrow="Operations · source" title="数据源" />
        <LoadingBlock count={3} />
      </div>
    );
  }

  if (!data || !source) {
    return (
      <div className="page">
        <PageHeader eyebrow="Operations · source" title="数据源" />
        <div className="error-note">{error ?? '数据源不存在或已删除'}</div>
        <Link to="/operations/sources" className="btn btn-ghost mt-4">
          <ArrowLeft size={13} /> 返回数据源
        </Link>
      </div>
    );
  }

  const typeMeta = dataSourceTypeMeta[source.type];
  const health = healthStatusMeta[source.enabled ? source.healthStatus : 'disabled'];
  const freshness = freshnessMeta[source.freshnessStatus];
  const dirty =
    form !== null &&
    (form.enabled !== source.enabled ||
      form.freshnessEnabled !== source.freshnessEnabled ||
      form.freshnessInterval !== source.freshnessInterval ||
      form.freshnessGracePeriod !== source.freshnessGracePeriod);

  const save = async () => {
    if (!form || !dirty) return;
    if (!Number.isFinite(form.freshnessInterval) || form.freshnessInterval < 1) {
      push('新鲜度周期至少为 1 小时', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/sources/${source.id}`, {
        enabled: form.enabled,
        freshnessEnabled: form.freshnessEnabled,
        freshnessInterval: Math.trunc(form.freshnessInterval),
        freshnessGracePeriod: Math.max(0, Math.trunc(form.freshnessGracePeriod)),
      });
      push('数据源设置已保存', 'success');
      await refetch(true);
    } catch (err) {
      push(err instanceof Error ? err.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const check = async () => {
    setBusy('check');
    try {
      await api.post(`/sources/${source.id}/check`);
      push('健康检查完成', 'success');
      await refetch(true);
    } catch (err) {
      push(err instanceof Error ? err.message : '健康检查失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const collect = async () => {
    setBusy('collect');
    try {
      await api.post(`/sources/${source.id}/collect`);
      push('已提交采集任务，执行结果会在运行记录中更新', 'success');
      await refetch(true);
    } catch (err) {
      push(err instanceof Error ? err.message : '无法启动采集', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow={`Operations · ${typeMeta.code}`}
        title={source.name}
        subtitle={
          <span className="ops-detail-sub">
            <span>{source.description ?? '该数据源尚未提供描述'}</span>
            <span className="ops-detail-sep">·</span>
            <span className="ops-source-key">{source.sourceKey}</span>
            {source.officialUrl && /^https?:\/\//.test(source.officialUrl) && (
              <a
                href={source.officialUrl}
                target="_blank"
                rel="noreferrer"
                className="text-link"
              >
                官方页面 <ArrowUpRight size={12} />
              </a>
            )}
          </span>
        }
        actions={
          <>
            <Link to="/operations/sources" className="btn btn-ghost">
              <ArrowLeft size={13} /> 返回
            </Link>
            <button className="btn btn-ghost" onClick={() => void check()} disabled={!source.enabled || busy !== null}>
              {busy === 'check' ? <Loader2 size={13} className="animate-spin" /> : <Gauge size={13} />}
              健康检查
            </button>
            <button className="btn btn-primary" onClick={() => void collect()} disabled={!source.enabled || busy !== null}>
              {busy === 'collect' ? <Loader2 size={13} className="animate-spin" /> : <PlayCircle size={13} />}
              立即采集
            </button>
          </>
        }
      />

      <div className="ops-detail-badges">
        <span className={`pill ${typeMeta.className}`}>{typeMeta.label}</span>
        <span className={`pill ${health.className}`}>{health.label}</span>
        <span className={`pill ${freshness.className}`}>数据{freshness.label}</span>
        {!source.enabled && <span className="pill pill-neutral">已停用</span>}
        {source.healthStatus === 'rate_limited' && <span className="pill pill-warn">接口限流</span>}
      </div>

      {!source.enabled && (
        <div className="ops-callout">
          <Pause size={14} />
          <span>
            该数据源已停用：不会再启动采集，也不会触发数据过期提醒。已有数据、执行记录和通知都会保留。
          </span>
          <button
            className="text-link"
            onClick={() => setForm((prev) => (prev ? { ...prev, enabled: true } : prev))}
          >
            重新启用
          </button>
        </div>
      )}

      {source.lastError && (
        <div className="ops-callout danger">
          <CircleAlert size={14} />
          <div>
            <strong>最近一次错误</strong>
            <p>{source.lastError}</p>
            <span>发生于 {formatDateTime(source.lastErrorAt)}</span>
          </div>
        </div>
      )}

      <div className="stat-grid ops-stat-grid">
        <div className="stat-card">
          <div className="stat-label">
            <RefreshCw size={12} /> 实际数据更新
          </div>
          <div className="stat-value ops-stat-value-text">{relativeTime(source.lastDataUpdatedAt)}</div>
          <div className="stat-foot">采集成功但没有新数据时不会更新</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <Timer size={12} /> 数据年龄
          </div>
          <div className="stat-value ops-stat-value-text">{formatAgeHours(source.freshnessAgeHours)}</div>
          <div className="stat-foot">
            预期 {source.freshnessInterval}h，宽限 {source.freshnessGracePeriod}h
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <ShieldCheck size={12} /> 最近成功
          </div>
          <div className="stat-value ops-stat-value-text">{relativeTime(source.lastSuccessAt)}</div>
          <div className="stat-foot">失败 {source.consecutiveFailures > 0 ? `${source.consecutiveFailures} 次` : '无'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <Gauge size={12} /> 最近检查
          </div>
          <div className="stat-value ops-stat-value-text">{relativeTime(source.lastCheckAt)}</div>
          <div className="stat-foot">
            {source.lastQuota
              ? `配额剩余 ${source.lastQuota.quotaRemaining ?? '—'} / ${source.lastQuota.quotaLimit ?? '—'}`
              : '未提供配额信息'}
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <section className="panel">
          <div className="panel-head">
            <h3>运行状况</h3>
            <button className="text-link" onClick={() => void refetch(true)}>
              <RefreshCw size={12} /> 刷新
            </button>
          </div>
          <div className="panel-body">
            <dl className="ops-kv">
              <div>
                <dt>健康状态</dt>
                <dd>
                  <span className={`pill ${health.className}`}>{health.label}</span>
                  <span className="ops-run-muted">{source.healthStatus === 'unknown' ? '尚未执行检查或采集' : ''}</span>
                </dd>
              </div>
              <div>
                <dt>数据新鲜度</dt>
                <dd>
                  <span className={`pill ${freshness.className}`}>{freshness.label}</span>
                  <span className="ops-run-muted">{freshness.hint}</span>
                </dd>
              </div>
              <div>
                <dt>最近成功采集</dt>
                <dd>{formatDateTime(source.lastSuccessAt)}</dd>
              </div>
              <div>
                <dt>最近失败采集</dt>
                <dd>{formatDateTime(source.lastFailureAt)}</dd>
              </div>
              <div>
                <dt>连续失败</dt>
                <dd>{source.consecutiveFailures > 0 ? `${source.consecutiveFailures} 次` : '无'}</dd>
              </div>
              <div>
                <dt>注册时间</dt>
                <dd>{formatDateTime(source.createdAt)}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>采集与新鲜度设置</h3>
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
                    <strong>启用数据源</strong>
                    <span>停用后停止定时采集，不会删除历史数据。</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.enabled}
                    aria-label="启用数据源"
                    className={`switch ${form.enabled ? 'on' : ''}`}
                    onClick={() => setForm({ ...form, enabled: !form.enabled })}
                  />
                </div>
                <div className="ops-switch-row">
                  <div>
                    <strong>跟踪数据新鲜度</strong>
                    <span>按实际数据更新时间计算，而不是任务最后执行时间。</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.freshnessEnabled}
                    aria-label="跟踪数据新鲜度"
                    className={`switch ${form.freshnessEnabled ? 'on' : ''}`}
                    onClick={() => setForm({ ...form, freshnessEnabled: !form.freshnessEnabled })}
                  />
                </div>
                <div className="field-row">
                  <label className="field">
                    <span className="field-label">预期更新周期（小时）</span>
                    <input
                      className="field-input"
                      type="number"
                      min={1}
                      max={8760}
                      value={form.freshnessInterval}
                      disabled={!form.freshnessEnabled}
                      onChange={(event) =>
                        setForm({ ...form, freshnessInterval: Number(event.target.value) })
                      }
                    />
                    <span className="field-hint">超过该周期后进入宽限期。</span>
                  </label>
                  <label className="field">
                    <span className="field-label">宽限期（小时）</span>
                    <input
                      className="field-input"
                      type="number"
                      min={0}
                      max={8760}
                      value={form.freshnessGracePeriod}
                      disabled={!form.freshnessEnabled}
                      onChange={(event) =>
                        setForm({ ...form, freshnessGracePeriod: Number(event.target.value) })
                      }
                    />
                    <span className="field-hint">宽限期结束后标记为已过期。</span>
                  </label>
                </div>
                <p className="form-note">
                  停用数据源不会删除历史数据。恢复启用后，调度器会按任务的 cron 表达式重新注册。
                </p>
              </>
            ) : (
              <span className="ops-run-muted">正在加载设置…</span>
            )}
          </div>
        </section>
      </div>

      <section className="panel mt-4">
        <div className="panel-head">
          <h3>配额与限流</h3>
          <span className="section-count">{data.quotas.length}</span>
        </div>
        <div className="panel-body flush">
          {source.lastQuota ? (
            <>
              <div className="ops-quota-strip">
                <div>
                  <span>配额上限</span>
                  <strong>{source.lastQuota.quotaLimit ?? '未提供'}</strong>
                </div>
                <div>
                  <span>剩余</span>
                  <strong>{source.lastQuota.quotaRemaining ?? '未提供'}</strong>
                </div>
                <div>
                  <span>已使用</span>
                  <strong>{source.lastQuota.quotaUsed ?? '未提供'}</strong>
                </div>
                <div>
                  <span>重置时间</span>
                  <strong>{source.lastQuota.resetAt ? relativeTime(source.lastQuota.resetAt) : '未提供'}</strong>
                </div>
                <div>
                  <span>最近记录</span>
                  <strong>{relativeTime(source.lastQuota.recordedAt)}</strong>
                </div>
              </div>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>上限</th>
                      <th>剩余</th>
                      <th>已用</th>
                      <th>重置</th>
                      <th>限流</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.quotas.map((quota) => (
                      <tr key={quota.id}>
                        <td>{formatDateTime(quota.recordedAt)}</td>
                        <td>{quota.quotaLimit ?? '—'}</td>
                        <td>{quota.quotaRemaining ?? '—'}</td>
                        <td>{quota.quotaUsed ?? '—'}</td>
                        <td>{quota.resetAt ? relativeTime(quota.resetAt) : '—'}</td>
                        <td>{quota.rateLimited ? <span className="pill pill-warn">触发限流</span> : '否'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="panel-body">
              <EmptyState
                compact
                icon={Gauge}
                title="该数据源未提供配额信息"
                description="只有在接口返回真实配额数据时才展示，不做估算或模拟。"
              />
            </div>
          )}
        </div>
      </section>

      <div className="detail-grid">
        <section className="panel">
          <div className="panel-head">
            <h3>健康检查记录</h3>
            <span className="section-count">{data.checks.length}</span>
          </div>
          <div className="panel-body flush">
            {data.checks.length === 0 ? (
              <div className="panel-body">
                <EmptyState compact icon={ShieldCheck} title="还没有检查记录" description="点击“健康检查”主动探测一次。" />
              </div>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>状态</th>
                      <th>HTTP</th>
                      <th>响应</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.checks.map((check) => {
                      const meta = healthStatusMeta[check.status];
                      return (
                        <tr key={check.id}>
                          <td>{formatDateTime(check.checkedAt)}</td>
                          <td>
                            <span className={`pill ${meta.className}`}>{meta.label}</span>
                          </td>
                          <td>{check.httpStatus ?? '—'}</td>
                          <td>{check.responseTimeMs == null ? '—' : `${check.responseTimeMs} ms`}</td>
                          <td className="ops-cell-error">{check.errorMessage ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>关联任务</h3>
            <Link to="/operations/tasks" className="text-link">
              全部任务 <ArrowUpRight size={12} />
            </Link>
          </div>
          <div className="panel-body flush">
            {data.tasks.length === 0 ? (
              <div className="panel-body">
                <EmptyState compact icon={PlayCircle} title="没有关联任务" description="数据源可以只做健康检查，不注册采集任务。" />
              </div>
            ) : (
              <div className="mini-list ops-padded-list">
                {data.tasks.map((task) => (
                  <Link key={task.id} to={`/operations/tasks/${task.id}`} className="ops-task-line">
                    <div className="ops-task-line-main">
                      <strong>{task.name}</strong>
                      <span>
                        <code>{task.schedule}</code> · 超时 {task.timeoutSeconds}s
                      </span>
                    </div>
                    <div className="ops-task-line-side">
                      <span className={`pill ${task.enabled ? 'pill-calm' : 'pill-neutral'}`}>
                        {task.enabled ? '已启用' : '已暂停'}
                      </span>
                      <span className="ops-run-muted">
                        下次 {task.nextRunAt ? relativeTime(task.nextRunAt) : '—'}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="panel mt-4">
        <div className="panel-head">
          <h3>最近执行记录</h3>
          <span className="section-count">{data.runs.length}</span>
        </div>
        <div className="panel-body flush">
          {data.runs.length === 0 ? (
            <div className="panel-body">
              <EmptyState
                compact
                icon={PlayCircle}
                title="还没有执行记录"
                description="手动执行或等待定时调度后，这里会显示真实采集结果。"
              />
            </div>
          ) : (
            <div className="ops-run-table">
              <div className="ops-run-head ops-run-head-source">
                <span>任务</span>
                <span>状态</span>
                <span>触发</span>
                <span>新增 / 更新</span>
                <span>耗时</span>
                <span>开始时间</span>
              </div>
              {data.runs.map((run) => {
                const status = runStatusMeta[run.status];
                return (
                  <Link key={run.id} to={`/operations/runs/${run.id}`} className="ops-run-row ops-run-row-source">
                    <span className="ops-run-name">
                      <strong>{run.taskName}</strong>
                      <span>{runTriggerMeta[run.triggerType]}触发</span>
                    </span>
                    <span>
                      <span className={`pill ${status.className}`}>{status.label}</span>
                    </span>
                    <span className="ops-run-muted">{runTriggerMeta[run.triggerType]}</span>
                    <span className="ops-run-counts">
                      <strong>{run.createdCount}</strong> / {run.updatedCount}
                    </span>
                    <span className="ops-run-muted">{formatDuration(run.durationMs)}</span>
                    <span className="ops-run-time">{relativeTime(run.startedAt)}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
