import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowUpRight,
  Database,
  Gauge,
  Loader2,
  PlayCircle,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import type { DataSource, DataSourceType, SourceHealthStatus, SourceListResponse } from '@shared/types';
import { api } from '../lib/api';
import { useApi, useDebouncedValue, useDocumentTitle } from '../lib/hooks';
import { relativeTime } from '../lib/format';
import {
  dataSourceTypeMeta,
  formatAgeHours,
  freshnessMeta,
  healthStatusMeta,
  runStatusMeta,
} from '../lib/operations';
import { EmptyState, PageHeader } from '../components/ui';
import { useToast } from '../contexts/ToastContext';

const statusOptions: Array<{ value: SourceHealthStatus | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'ok', label: '健康' },
  { value: 'error', label: '异常' },
  { value: 'rate_limited', label: '限流' },
  { value: 'unknown', label: '待检查' },
  { value: 'disabled', label: '已停用' },
];

const typeOptions: Array<{ value: DataSourceType | 'all'; label: string }> = [
  { value: 'all', label: '全部类型' },
  { value: 'lifecycle', label: '生命周期' },
  { value: 'release', label: '版本发布' },
  { value: 'security', label: '安全漏洞' },
  { value: 'discovery', label: '技术发现' },
];

function countFor(data: SourceListResponse, status: SourceHealthStatus | 'all'): number {
  if (status === 'all') return data.summary.total;
  if (status === 'ok') return data.summary.healthy;
  if (status === 'error') return data.summary.error;
  if (status === 'rate_limited') return data.summary.rateLimited;
  if (status === 'unknown') return data.summary.unknown;
  return data.summary.disabled;
}

export function OperationsSourcesPage() {
  useDocumentTitle('数据源管理');
  const { push } = useToast();
  const [status, setStatus] = useState<SourceHealthStatus | 'all'>('all');
  const [type, setType] = useState<DataSourceType | 'all'>('all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [busy, setBusy] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (type !== 'all') params.set('type', type);
  if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim());
  const path = `/sources${params.toString() ? `?${params.toString()}` : ''}`;
  const { data, loading, error, refetch } = useApi<SourceListResponse>(path, 8000);

  const check = async (source: DataSource) => {
    setBusy(`check:${source.id}`);
    try {
      await api.post(`/sources/${source.id}/check`);
      push(`${source.name} 检查完成`, 'success');
      await refetch(true);
    } catch (err) {
      push(err instanceof Error ? err.message : '健康检查失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const collect = async (source: DataSource) => {
    setBusy(`collect:${source.id}`);
    try {
      await api.post(`/sources/${source.id}/collect`);
      push(`已开始采集 ${source.name}`, 'success');
      await refetch(true);
    } catch (err) {
      push(err instanceof Error ? err.message : '无法启动采集', 'error');
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="page">
        <PageHeader eyebrow="Operations · sources" title="数据源管理" />
        <div className="loading-block" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <PageHeader eyebrow="Operations · sources" title="数据源管理" />
        <div className="error-note">{error ?? '无法加载数据源'}</div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operations · sources"
        title="数据源管理"
        subtitle="只注册当前项目中真实存在的采集适配器。停用数据源不会删除历史数据与采集记录。"
        actions={
          <>
            <Link to="/operations" className="btn btn-ghost">
              <Activity size={13} /> 运行概览
            </Link>
            <Link to="/operations/tasks" className="btn btn-ghost">
              采集任务
            </Link>
          </>
        }
      />

      <div className="filter-bar">
        <div className="filter-chips">
          {statusOptions.map((option) => (
            <button
              key={option.value}
              className={`chip ${status === option.value ? 'active' : ''}`}
              onClick={() => setStatus(option.value)}
            >
              {option.label}
              <span className="chip-count">{countFor(data, option.value)}</span>
            </button>
          ))}
        </div>
        <select
          className="filter-select"
          value={type}
          onChange={(event) => setType(event.target.value as DataSourceType | 'all')}
          aria-label="数据源类型"
        >
          {typeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <label className="inline-search">
          <Search size={13} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索名称或描述"
            aria-label="搜索数据源"
          />
        </label>
        <button className="btn btn-ghost btn-sm" onClick={() => void refetch(true)}>
          <RefreshCw size={12} /> 刷新
        </button>
      </div>

      {data.items.length === 0 ? (
        <EmptyState
          icon={Database}
          title="没有匹配的数据源"
          description="调整筛选条件，或清除搜索后重试。"
          actions={
            <button
              className="btn btn-primary"
              onClick={() => {
                setSearch('');
                setStatus('all');
                setType('all');
              }}
            >
              清除筛选
            </button>
          }
        />
      ) : (
        <div className="ops-source-grid">
          {data.items.map((source) => {
            const typeMeta = dataSourceTypeMeta[source.type];
            const health = healthStatusMeta[source.enabled ? source.healthStatus : 'disabled'];
            const freshness = freshnessMeta[source.freshnessStatus];
            const lastRun = source.lastRun;
            const runStatus = lastRun ? runStatusMeta[lastRun.status] : null;
            return (
              <article key={source.id} className={`ops-source-card ${source.enabled ? '' : 'is-disabled'}`}>
                <div className="ops-source-card-head">
                  <span className={`ops-status-dot ${health.dot}`} />
                  <div className="ops-source-title">
                    <Link to={`/operations/sources/${source.id}`}>{source.name}</Link>
                    <span className="ops-source-key">{source.sourceKey}</span>
                  </div>
                  <span className={`pill ${typeMeta.className}`}>{typeMeta.label}</span>
                </div>
                <p className="ops-source-desc">{source.description ?? '未提供描述'}</p>
                <div className="ops-source-pills">
                  <span className={`pill ${health.className}`}>{health.label}</span>
                  <span className={`pill ${freshness.className}`}>数据{freshness.label}</span>
                  {!source.enabled && <span className="pill pill-neutral">已停用</span>}
                </div>
                <dl className="ops-source-facts">
                  <div>
                    <dt>数据更新</dt>
                    <dd>{relativeTime(source.lastDataUpdatedAt)}</dd>
                  </div>
                  <div>
                    <dt>数据年龄</dt>
                    <dd>{formatAgeHours(source.freshnessAgeHours)}</dd>
                  </div>
                  <div>
                    <dt>最近检查</dt>
                    <dd>{relativeTime(source.lastCheckAt)}</dd>
                  </div>
                  <div>
                    <dt>连续失败</dt>
                    <dd>{source.consecutiveFailures > 0 ? `${source.consecutiveFailures} 次` : '无'}</dd>
                  </div>
                </dl>
                {source.lastError && (
                  <div className="ops-source-error">
                    <ShieldCheck size={12} />
                    <span>{source.lastError}</span>
                  </div>
                )}
                <div className="ops-source-foot">
                  <div className="ops-source-run">
                    {lastRun && runStatus ? (
                      <>
                        <span className={`pill ${runStatus.className}`}>{runStatus.label}</span>
                        <span>{relativeTime(lastRun.startedAt)}</span>
                        <span className="ops-run-muted">
                          +{lastRun.createdCount} / ~{lastRun.updatedCount}
                        </span>
                      </>
                    ) : (
                      <span className="ops-run-muted">尚无执行记录</span>
                    )}
                  </div>
                  <div className="ops-source-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={!source.enabled || busy !== null}
                      onClick={() => void check(source)}
                    >
                      {busy === `check:${source.id}` ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Gauge size={12} />
                      )}
                      检查
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={!source.enabled || busy !== null}
                      onClick={() => void collect(source)}
                    >
                      {busy === `collect:${source.id}` ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <PlayCircle size={12} />
                      )}
                      采集
                    </button>
                    <Link to={`/operations/sources/${source.id}`} className="btn btn-ghost btn-sm">
                      详情 <ArrowUpRight size={12} />
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
