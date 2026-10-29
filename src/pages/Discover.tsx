import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Compass,
  EyeOff,
  GitFork,
  Link2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Star,
} from 'lucide-react';
import type {
  DiscoveryCandidate,
  DiscoveryListResponse,
  DiscoveryOverview,
  DiscoverySourceType,
  DiscoveryStatus,
} from '@shared/types';
import { api } from '../lib/api';
import { useApi, useDebouncedValue, useDocumentTitle } from '../lib/hooks';
import { formatDate, formatDateTime, relativeTime } from '../lib/format';
import {
  discoveryJobStatusMeta,
  discoverySourceLabel,
  discoverySourceMeta,
  discoverySourceStatusMeta,
  discoveryStatusMeta,
  formatMetric,
} from '../lib/discovery';
import { categoryColor } from '../lib/format';
import { useToast } from '../contexts/ToastContext';
import { useAppData } from '../contexts/AppDataContext';
import { EmptyState, PageHeader } from '../components/ui';
import { DiscoveryImportDialog } from '../components/DiscoveryImportDialog';

type SortKey = 'discovered' | 'updated' | 'stars' | 'title';

const statusOptions: Array<{ value: DiscoveryStatus | 'all'; label: string }> = [
  { value: 'pending', label: '待评估' },
  { value: 'imported', label: '已收录' },
  { value: 'ignored', label: '已忽略' },
  { value: 'all', label: '全部' },
];

const statusCountKey: Record<DiscoveryStatus | 'all', keyof DiscoveryListResponse['counts']> = {
  pending: 'pending',
  imported: 'imported',
  ignored: 'ignored',
  all: 'all',
};

function sourceCode(type: DiscoverySourceType): string {
  return discoverySourceMeta[type]?.code ?? type.toUpperCase();
}

export function Discover() {
  useDocumentTitle('技术发现');
  const navigate = useNavigate();
  const { push } = useToast();
  const { refresh } = useAppData();
  const [status, setStatus] = useState<DiscoveryStatus | 'all'>('pending');
  const [sourceType, setSourceType] = useState<DiscoverySourceType | 'all'>('all');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<SortKey>('discovered');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [offset, setOffset] = useState(0);
  const [importing, setImporting] = useState<DiscoveryCandidate | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const wasRunning = useRef(false);

  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (sourceType !== 'all') params.set('source', sourceType);
  if (category !== 'all') params.set('category', category);
  if (sort !== 'discovered') params.set('sort', sort);
  if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim());
  params.set('limit', '12');
  params.set('offset', String(offset));
  const listPath = `/discovery/candidates?${params.toString()}`;

  const { data, loading, error, refetch } = useApi<DiscoveryListResponse>(listPath);
  const {
    data: overview,
    error: overviewError,
    refetch: refetchOverview,
  } = useApi<DiscoveryOverview>('/discovery/overview', 5000);

  useEffect(() => {
    setOffset(0);
  }, [status, sourceType, category, debouncedSearch, sort]);

  useEffect(() => {
    if (!overview) return;
    if (overview.running) {
      wasRunning.current = true;
      return;
    }
    if (wasRunning.current) {
      wasRunning.current = false;
      void refetch(true);
      void refresh(true);
    }
  }, [overview, overview?.running, refetch, refresh]);

  const afterMutation = async () => {
    await Promise.all([refetch(true), refetchOverview(true), refresh(true)]);
  };

  const refreshDiscovery = async () => {
    setRefreshing(true);
    try {
      await api.post('/discovery/refresh');
      push('已开始从配置来源采集，采集过程不会影响现有候选。', 'info');
      await refetchOverview(true);
    } catch (refreshError) {
      push(refreshError instanceof Error ? refreshError.message : '启动采集失败', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const ignore = async (candidate: DiscoveryCandidate) => {
    setBusyId(candidate.id);
    try {
      await api.post(`/discovery/candidates/${candidate.id}/ignore`);
      push('已忽略该候选，来源记录与首次发现时间仍保留');
      await afterMutation();
    } catch (ignoreError) {
      push(ignoreError instanceof Error ? ignoreError.message : '忽略失败', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const restore = async (candidate: DiscoveryCandidate) => {
    setBusyId(candidate.id);
    try {
      await api.post(`/discovery/candidates/${candidate.id}/restore`);
      push('已恢复到待评估候选池');
      await afterMutation();
    } catch (restoreError) {
      push(restoreError instanceof Error ? restoreError.message : '恢复失败', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const resetFilters = () => {
    setStatus('pending');
    setSourceType('all');
    setCategory('all');
    setSearch('');
    setSort('discovered');
    setOffset(0);
  };

  const counts = data?.counts;
  const sources = data?.sources ?? overview?.sources.map((source) => ({
    type: source.type,
    name: source.name,
    pendingCount: 0,
    totalCount: 0,
  })) ?? [];
  const total = data?.total ?? 0;
  const limit = data?.limit ?? 12;
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const activeFilters =
    status !== 'pending' ||
    sourceType !== 'all' ||
    category !== 'all' ||
    Boolean(search.trim()) ||
    sort !== 'discovered';
  const hasCandidates = (counts?.all ?? 0) > 0;
  const lastRunLabel = overview?.lastRunAt
    ? `最近采集 ${formatDateTime(overview.lastRunAt)}（${relativeTime(overview.lastRunAt)}）`
    : '尚未执行过采集';
  const scheduleLabel = !overview
    ? '读取中…'
    : overview.scheduler.enabled
      ? overview.scheduler.nextRunAt
        ? `${formatDateTime(overview.scheduler.nextRunAt)} · ${overview.scheduler.timezone}`
        : `已启用 · ${overview.scheduler.timezone}`
      : '自动采集已关闭';

  return (
    <div className="page">
      <PageHeader
        eyebrow="Discovery · trusted sources, human decisions"
        title="技术发现"
        subtitle="从 GitHub 与 CNCF 官方来源发现候选技术。来源只负责提供线索，是否进入技术雷达由你决定。"
        actions={
          <button
            className="btn btn-primary"
            onClick={() => void refreshDiscovery()}
            disabled={refreshing || overview?.running}
          >
            {refreshing || overview?.running ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            {overview?.running ? '采集中…' : refreshing ? '启动中…' : '立即采集'}
          </button>
        }
      />

      {(error || overviewError) && (
        <div className="error-note mb-3">{error || overviewError}</div>
      )}

      <section className="discovery-runbar" aria-label="采集状态">
        <div className="discovery-runbar-main">
          <span className={`live-dot ${overview?.running ? 'busy' : ''}`} />
          <div>
            <strong>
              {overview?.running
                ? `正在采集${overview.runningSince ? ` · 开始于 ${formatDateTime(overview.runningSince)}` : ''}`
                : lastRunLabel}
            </strong>
            <span>
              下次自动采集 {scheduleLabel}
              {overview && !overview.githubTokenConfigured ? ' · GitHub 使用匿名请求限额' : ''}
            </span>
          </div>
        </div>
        <div className="discovery-source-statuses">
          {(overview?.sources ?? []).map((source) => {
            const meta = discoverySourceStatusMeta[source.lastStatus];
            return (
              <span
                className={`discovery-source-status ${source.lastStatus}`}
                key={source.id}
                title={source.lastErrorSummary ?? source.lastResult ?? source.name}
              >
                <span className={`pill pill-${meta.className} radar-status-pill`}>{meta.label}</span>
                {source.name}
              </span>
            );
          })}
        </div>
      </section>

      {overview && overview.rules.length > 0 && (
        <details className="discovery-rules">
          <summary>
            <span>采集范围与规则</span>
            <span className="discovery-rules-meta">
              {overview.rules.filter((rule) => rule.enabled).length} 条启用规则 · 不是 GitHub 全量扫描
            </span>
          </summary>
          <div className="discovery-rules-body">
            <p>
              发现结果只覆盖下列已配置规则。实际采集时间以任务记录为准，页脚与详情会区分来源更新时间、首次发现时间和最近采集时间。
            </p>
            <div className="discovery-rule-list">
              {overview.rules.map((rule) => (
                <div className={`discovery-rule ${rule.enabled ? '' : 'disabled'}`} key={rule.id}>
                  <div className="discovery-rule-head">
                    <span className="radar-kind">{sourceCode(rule.sourceType)}</span>
                    <strong>{rule.name}</strong>
                    {!rule.enabled && <span className="pill pill-neutral radar-status-pill">已停用</span>}
                  </div>
                  <code>{rule.query}</code>
                  <div className="discovery-rule-foot">
                    <span>{rule.category}</span>
                    <span>
                      {rule.lastRunAt ? formatDateTime(rule.lastRunAt) : '尚未运行'}
                      {rule.lastError ? ` · ${rule.lastError}` : rule.lastResult ? ` · ${rule.lastResult}` : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {overview.jobs.length > 0 && (
              <div className="discovery-job-list">
                <span className="eyebrow no-rule">最近任务</span>
                {overview.jobs.slice(0, 4).map((job) => {
                  const meta = discoveryJobStatusMeta[job.status];
                  return (
                    <div className="discovery-job" key={job.id}>
                      <span className={`pill pill-${meta.className} radar-status-pill`}>{meta.label}</span>
                      <span>{discoverySourceLabel(job.sourceType)}</span>
                      <span>{job.trigger === 'manual' ? '手动' : '定时'}</span>
                      <span>{formatDateTime(job.startedAt)}</span>
                      <span>
                        新增 {job.itemsNew} · 更新 {job.itemsUpdated} · 重复 {job.itemsDuplicate}
                      </span>
                      {job.errorSummary && (
                        <span className="discovery-job-error" title={job.errorSummary}>
                          <CircleAlert size={11} /> {job.errorSummary}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </details>
      )}

      <div className="filter-bar mt-3">
        <div className="filter-chips">
          {statusOptions.map((option) => (
            <button
              key={option.value}
              className={`chip ${status === option.value ? 'active' : ''}`}
              onClick={() => setStatus(option.value)}
            >
              {option.label}
              <span className="chip-count">
                {counts?.[statusCountKey[option.value]] ?? 0}
              </span>
            </button>
          ))}
        </div>
        <select
          className="filter-select"
          value={sourceType}
          onChange={(event) => setSourceType(event.target.value as DiscoverySourceType | 'all')}
          aria-label="按来源筛选"
        >
          <option value="all">全部来源</option>
          {sources.map((source) => (
            <option key={source.type} value={source.type}>
              {source.name}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          aria-label="按分类筛选"
        >
          <option value="all">全部分类</option>
          {(data?.categories ?? []).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          value={sort}
          onChange={(event) => setSort(event.target.value as SortKey)}
          aria-label="排序方式"
        >
          <option value="discovered">最近发现</option>
          <option value="updated">来源最近更新</option>
          <option value="stars">Star 数</option>
          <option value="title">名称</option>
        </select>
        <div className="filter-spacer" />
        <div className="inline-search">
          <Search size={12} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索名称、简介、仓库"
            aria-label="搜索候选技术"
          />
        </div>
      </div>

      {loading && !data ? (
        <div className="loading-block" style={{ minHeight: 280 }} />
      ) : error && !data ? (
        <EmptyState
          icon={CircleAlert}
          title="候选列表加载失败"
          description={error}
          actions={
            <button className="btn btn-secondary" onClick={() => void refetch()}>
              重新加载
            </button>
          }
        />
      ) : !hasCandidates ? (
        <EmptyState
          icon={Compass}
          title="候选池还是空的"
          description="执行一次采集后，来自 GitHub 规则和 CNCF Landscape 的项目会出现在这里。采集失败不会清空已有候选。"
          actions={
            <button
              className="btn btn-primary"
              onClick={() => void refreshDiscovery()}
              disabled={refreshing || overview?.running}
            >
              <RefreshCw size={13} /> 立即采集
            </button>
          }
        />
      ) : (data?.items.length ?? 0) === 0 ? (
        <EmptyState
          icon={Search}
          title="没有符合条件的候选"
          description="调整状态、来源、分类或关键词后重新查看。已忽略的候选仍然保留在资料库中。"
          actions={
            activeFilters ? (
              <button className="btn btn-secondary" onClick={resetFilters}>
                清除筛选
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="discovery-grid">
            {(data?.items ?? []).map((candidate) => {
              const statusMeta = discoveryStatusMeta[candidate.status];
              const busy = busyId === candidate.id;
              const linked = candidate.relatedRadarItem;
              return (
                <article
                  className={`radar-card discovery-card clickable ${candidate.status === 'ignored' ? 'ignored' : ''}`}
                  key={candidate.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(`/discover/${candidate.id}`)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      navigate(`/discover/${candidate.id}`);
                    }
                  }}
                >
                  <div className="radar-card-top">
                    <div className="radar-tags">
                      <span className="radar-kind">{sourceCode(candidate.sourceType)}</span>
                      <span
                        className="discovery-category"
                        style={{ color: categoryColor(candidate.category) }}
                      >
                        {candidate.category}
                      </span>
                      <span className={`pill pill-${statusMeta.className} radar-status-pill`}>
                        {statusMeta.label}
                      </span>
                    </div>
                    {candidate.sourceRef && (
                      <span className="discovery-source-ref mono" title={candidate.sourceRef}>
                        {candidate.sourceRef}
                      </span>
                    )}
                  </div>

                  <h3>{candidate.title}</h3>
                  <p>{candidate.description || '来源未提供项目简介。'}</p>

                  <div className="discovery-metrics">
                    {candidate.starsCount !== null && (
                      <span title="GitHub Star 数">
                        <Star size={11} /> {formatMetric(candidate.starsCount)}
                      </span>
                    )}
                    {candidate.forksCount !== null && (
                      <span title="GitHub Fork 数">
                        <GitFork size={11} /> {formatMetric(candidate.forksCount)}
                      </span>
                    )}
                    {candidate.language && <span>{candidate.language}</span>}
                    {candidate.license && <span>{candidate.license}</span>}
                    {candidate.sources.length > 1 && <span>{candidate.sources.length} 个来源</span>}
                  </div>

                  {linked && (
                    <div className="discovery-linked">
                      <Link2 size={11} />
                      <Link to={`/radar/${linked.id}`} onClick={(event) => event.stopPropagation()}>
                        {linked.title}
                      </Link>
                      {linked.archivedAt && <span>（雷达中已归档）</span>}
                    </div>
                  )}

                  <footer>
                    <span>首次发现 {formatDate(candidate.firstDiscoveredAt)}</span>
                    <div className="radar-card-links">
                      {candidate.status === 'pending' && (
                        <>
                          <button
                            className="radar-quick"
                            disabled={busy}
                            onClick={(event) => {
                              event.stopPropagation();
                              void ignore(candidate);
                            }}
                          >
                            <EyeOff size={10} /> 忽略
                          </button>
                          <button
                            className="btn btn-signal btn-sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              setImporting(candidate);
                            }}
                          >
                            加入雷达 <ArrowRight size={11} />
                          </button>
                        </>
                      )}
                      {candidate.status === 'ignored' && (
                        <button
                          className="radar-quick"
                          disabled={busy}
                          onClick={(event) => {
                            event.stopPropagation();
                            void restore(candidate);
                          }}
                        >
                          <RotateCcw size={10} /> {busy ? '恢复中…' : '恢复'}
                        </button>
                      )}
                      {candidate.status === 'imported' && linked && (
                        <Link
                          to={`/radar/${linked.id}`}
                          className="text-link"
                          onClick={(event) => event.stopPropagation()}
                        >
                          查看雷达条目 <ArrowRight size={10} />
                        </Link>
                      )}
                    </div>
                  </footer>
                </article>
              );
            })}
          </div>

          <div className="discovery-pager">
            <span>
              共 {total} 条 · 第 {currentPage}/{totalPages} 页
            </span>
            <div>
              <button
                className="btn btn-secondary btn-sm"
                disabled={offset <= 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
              >
                <ChevronLeft size={12} /> 上一页
              </button>
              <button
                className="btn btn-secondary btn-sm"
                disabled={offset + limit >= total}
                onClick={() => setOffset(offset + limit)}
              >
                下一页 <ChevronRight size={12} />
              </button>
            </div>
          </div>
        </>
      )}

      <DiscoveryImportDialog
        candidate={importing}
        open={Boolean(importing)}
        onClose={() => setImporting(null)}
        onImported={async (result) => {
          setImporting(null);
          push(
            result.created
              ? '已加入技术雷达，条目处于待评估状态'
              : '已关联到现有技术雷达条目，没有创建重复记录',
          );
          await afterMutation();
        }}
      />
    </div>
  );
}
