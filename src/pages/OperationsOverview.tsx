import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowUpRight,
  CircleAlert,
  Clock3,
  Database,
  Gauge,
  ListChecks,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { OperationsOverview } from '@shared/types';
import { EmptyState, LoadingBlock, PageHeader } from '../components/ui';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { relativeTime } from '../lib/format';
import {
  dataSourceTypeMeta,
  formatDuration,
  formatPercent,
  freshnessMeta,
  healthStatusMeta,
  issueKindMeta,
  runStatusMeta,
  runTriggerMeta,
} from '../lib/operations';

export function OperationsOverviewPage() {
  useDocumentTitle('运行中心');
  const { data, loading, error, refetch } = useApi<OperationsOverview>('/operations/overview', 5000);

  if (loading && !data) {
    return (
      <div className="page">
        <PageHeader eyebrow="Operations · overview" title="运行中心" />
        <LoadingBlock count={3} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <PageHeader eyebrow="Operations · overview" title="运行中心" />
        <div className="error-note">{error ?? '无法加载运行状态'}</div>
      </div>
    );
  }

  const { stats, scheduler, sources, runs, issues } = data;
  const activeSources = sources.filter((source) => source.enabled);
  const degraded = activeSources.filter((source) => source.healthStatus !== 'ok');

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operations · control plane"
        title="运行中心"
        subtitle="数据源、采集任务与运行记录共用同一套真实数据。健康状态与数据新鲜度分开计算。"
        actions={
          <>
            <Link to="/operations/sources" className="btn btn-ghost">
              <Database size={13} /> 数据源
            </Link>
            <Link to="/operations/tasks" className="btn btn-primary">
              <ListChecks size={13} /> 采集任务
            </Link>
          </>
        }
      />

      <div className={`ops-scheduler-banner ${scheduler.enabled ? '' : 'paused'}`}>
        <span className="ops-scheduler-icon">
          {scheduler.enabled ? <Activity size={17} /> : <Clock3 size={17} />}
        </span>
        <div className="ops-scheduler-main">
          <strong>{scheduler.enabled ? '调度器运行中' : '调度器已暂停'}</strong>
          <span>
            {scheduler.runningTasks > 0
              ? '当前有采集任务正在执行，其他任务会等待本轮结束'
              : scheduler.enabled
                ? `下次采集 ${relativeTime(scheduler.nextRunAt)}`
                : '定时采集不会触发，手动执行仍然可用'}
          </span>
        </div>
        <span className="ops-scheduler-side">
          {scheduler.nextRunAt ? `NEXT · ${relativeTime(scheduler.nextRunAt)}` : 'NO SCHEDULE'}
        </span>
      </div>

      <div className="stat-grid ops-stat-grid">
        <div className="stat-card">
          <div className="stat-label">
            <Database size={12} /> 数据源
          </div>
          <div className="stat-value">{stats.totalSources}</div>
          <div className="stat-foot">{activeSources.length} 个启用</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <ShieldCheck size={12} /> 健康
          </div>
          <div className="stat-value">{stats.healthySources}</div>
          <div className="stat-foot">最近一次采集或检查成功</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <CircleAlert size={12} /> 异常
          </div>
          <div className="stat-value">{stats.abnormalSources}</div>
          <div className="stat-foot">失败或触发限流</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <PlayCircle size={12} /> 今日执行
          </div>
          <div className="stat-value">{stats.todayRuns}</div>
          <div className="stat-foot">按通知时区统计</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <Gauge size={12} /> 成功率
          </div>
          <div className="stat-value">{formatPercent(stats.successRate)}</div>
          <div className="stat-foot">今日已结束的执行</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <CircleAlert size={12} /> 待处理
          </div>
          <div className="stat-value">{stats.openIssues}</div>
          <div className="stat-foot">未恢复的运行问题</div>
        </div>
      </div>

      {degraded.length > 0 && (
        <div className="ops-callout">
          <CircleAlert size={14} />
          <span>
            {degraded.slice(0, 3).map((source) => source.name).join('、')}
            {degraded.length > 3 ? ` 等 ${degraded.length} 个数据源` : ''} 当前不健康，问题恢复前不会刷新数据新鲜度。
          </span>
          <Link to="/operations/sources" className="text-link">
            查看数据源 <ArrowUpRight size={12} />
          </Link>
        </div>
      )}

      <div className="detail-grid">
        <section className="panel">
          <div className="panel-head">
            <h3>数据源健康</h3>
            <button className="text-link" onClick={() => void refetch(true)}>
              <RefreshCw size={12} /> 刷新
            </button>
          </div>
          <div className="panel-body flush">
            {sources.length === 0 ? (
              <div className="panel-body">
                <EmptyState
                  compact
                  icon={Database}
                  title="还没有数据源"
                  description="数据源会随服务启动自动注册。"
                />
              </div>
            ) : (
              <div className="mini-list">
                {sources.map((source) => {
                  const health = healthStatusMeta[source.enabled ? source.healthStatus : 'disabled'];
                  const freshness = freshnessMeta[source.freshnessStatus];
                  return (
                    <Link
                      key={source.id}
                      to={`/operations/sources/${source.id}`}
                      className="ops-source-line"
                    >
                      <span className={`ops-status-dot ${health.dot}`} />
                      <span className="ops-source-line-main">
                        <strong>{source.name}</strong>
                        <span>
                          {dataSourceTypeMeta[source.type].label} · 上次数据更新{' '}
                          {relativeTime(source.lastDataUpdatedAt)}
                        </span>
                      </span>
                      <span className={`pill ${freshness.className}`}>{freshness.label}</span>
                      <span className={`pill ${health.className}`}>{health.label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>待处理问题</h3>
            <span className="section-count">{stats.openIssues}</span>
          </div>
          <div className="panel-body flush">
            {issues.length === 0 ? (
              <div className="panel-body">
                <EmptyState
                  compact
                  icon={ShieldCheck}
                  title="运行状态正常"
                  description="当前没有未恢复的数据源或任务问题。"
                />
              </div>
            ) : (
              <div className="ops-issue-list">
                {issues.map((issue) => {
                  const kind = issueKindMeta[issue.kind];
                  return (
                    <Link key={issue.id} to={issue.link ?? '/operations'} className="ops-issue-row">
                      <span className={`pill ${kind.className}`}>{kind.label}</span>
                      <div>
                        <strong>{issue.title}</strong>
                        <span>{issue.description || '等待下一次采集确认恢复'}</span>
                      </div>
                      <span className="ops-issue-time">{relativeTime(issue.occurredAt)}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="panel mt-4">
        <div className="panel-head">
          <h3>最近执行</h3>
          <Link to="/operations/tasks" className="text-link">
            查看全部任务 <ArrowUpRight size={12} />
          </Link>
        </div>
        <div className="panel-body flush">
          {runs.length === 0 ? (
            <div className="panel-body">
              <EmptyState
                compact
                icon={PlayCircle}
                title="还没有执行记录"
                description="任务第一次执行后，这里会显示真实的采集结果。"
              />
            </div>
          ) : (
            <div className="ops-run-table">
              <div className="ops-run-head">
                <span>任务 / 数据源</span>
                <span>状态</span>
                <span>触发</span>
                <span>新增 / 更新</span>
                <span>耗时</span>
                <span>开始时间</span>
              </div>
              {runs.map((run) => {
                const status = runStatusMeta[run.status];
                return (
                  <Link key={run.id} to={`/operations/runs/${run.id}`} className="ops-run-row">
                    <span className="ops-run-name">
                      <strong>{run.taskName}</strong>
                      <span>{run.sourceName}</span>
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
