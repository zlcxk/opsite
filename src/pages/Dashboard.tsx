import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Boxes,
  CircleAlert,
  Clock3,
  Plus,
  Radar,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type { SoftwareSummary } from '@shared/types';
import { useAppData } from '../contexts/AppDataContext';
import { useToast } from '../contexts/ToastContext';
import { api } from '../lib/api';
import { hasUpdate } from '../lib/version';
import { formatDateTime, relativeTime } from '../lib/format';
import { SoftwareCard } from '../components/SoftwareCard';
import { EventRow } from '../components/EventRow';
import { AddSoftwareDialog } from '../components/AddSoftwareDialog';
import { EditSoftwareDialog } from '../components/EditSoftwareDialog';
import { EmptyState, LoadingBlock, PageHeader, SectionHeader } from '../components/ui';
import { useDocumentTitle } from '../lib/hooks';
import { notificationRuleMeta, notificationSeverityMeta } from '../lib/notification-labels';

type StatusFilter = 'all' | 'risk' | 'update' | 'lifecycle' | 'source';
type SortOption = 'risk' | 'recent' | 'name';

const suggestions = [
  { key: 'kubernetes', name: 'Kubernetes', slug: 'kubernetes', category: '容器与编排' },
  { key: 'postgresql', name: 'PostgreSQL', slug: 'postgresql', category: '数据库' },
  { key: 'nginx', name: 'NGINX', slug: 'nginx', category: 'Web 与代理' },
  { key: 'redis', name: 'Redis', slug: 'redis', category: '数据库' },
];

function riskScore(software: SoftwareSummary): number {
  return (
    (software.riskLevel === 'critical' ? 10_000 : software.riskLevel === 'high' ? 5_000 : 0) +
    software.counts.affectedVulns * 100 +
    software.counts.highVulns * 10 +
    software.counts.openVulns +
    (software.lifecycle.status === 'eol' ? 80 : software.lifecycle.status === 'approaching_eol' ? 40 : 0)
  );
}

export function Dashboard() {
  useDocumentTitle('今日值班台');
  const { data, loading, error, refresh } = useAppData();
  const { push } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<SoftwareSummary | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortOption>('risk');
  const [query, setQuery] = useState('');
  const [syncingAll, setSyncingAll] = useState(false);

  const software = data?.software ?? [];
  const briefing = data?.briefing;
  const today = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
    .format(new Date())
    .toUpperCase();

  const counts = useMemo(
    () => ({
      all: software.length,
      risk: software.filter((item) => item.counts.openVulns > 0).length,
      update: software.filter((item) => hasUpdate(item.currentVersion, item.latestVersion)).length,
      lifecycle: software.filter(
        (item) => item.lifecycle.status === 'eol' || item.lifecycle.status === 'approaching_eol',
      ).length,
      source: software.filter((item) => item.sourceIssueCount > 0).length,
    }),
    [software],
  );

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return software
      .filter((item) => {
        if (
          search &&
          !item.name.toLowerCase().includes(search) &&
          !item.aliases.some((alias) => alias.toLowerCase().includes(search)) &&
          !(item.environment ?? '').toLowerCase().includes(search)
        ) {
          return false;
        }
        if (statusFilter === 'risk') return item.counts.openVulns > 0;
        if (statusFilter === 'update') return hasUpdate(item.currentVersion, item.latestVersion);
        if (statusFilter === 'lifecycle') {
          return item.lifecycle.status === 'eol' || item.lifecycle.status === 'approaching_eol';
        }
        if (statusFilter === 'source') return item.sourceIssueCount > 0;
        return true;
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (sort === 'name') return a.name.localeCompare(b.name, 'zh-CN');
        if (sort === 'recent') {
          return (b.lastSyncAt ?? '').localeCompare(a.lastSyncAt ?? '');
        }
        return riskScore(b) - riskScore(a);
      });
  }, [software, query, statusFilter, sort]);

  const openAdd = (key: string | null = null) => {
    setPresetKey(key);
    setAddOpen(true);
  };

  const syncAll = async () => {
    setSyncingAll(true);
    push('已开始同步全部关注软件，可能需要几分钟', 'info');
    try {
      const result = await api.post<{ total: number; succeeded: number; failed: number }>('/sync-all');
      push(
        result.failed > 0
          ? `同步完成：${result.succeeded}/${result.total} 成功，${result.failed} 个失败`
          : `同步完成：${result.succeeded} 个软件`,
        result.failed > 0 ? 'error' : 'success',
      );
      await refresh(true);
    } catch (syncError) {
      push(syncError instanceof Error ? syncError.message : '同步失败', 'error');
    } finally {
      setSyncingAll(false);
    }
  };

  const spectrum = briefing?.spectrum ?? { p0: 0, p1: 0, p2: 0, p3: 0 };
  const spectrumTotal = spectrum.p0 + spectrum.p1 + spectrum.p2 + spectrum.p3;
  const spectrumItems: Array<{ key: keyof typeof spectrum; label: string }> = [
    { key: 'p0', label: 'P0 实际利用' },
    { key: 'p1', label: 'P1 高危' },
    { key: 'p2', label: 'P2 待核实' },
    { key: 'p3', label: 'P3 一般' },
  ];

  if (loading && !data) {
    return (
      <div className="page">
        <div className="mb-5 h-[72px] w-2/3 animate-pulse rounded-xl bg-white/50" />
        <div className="loading-block mb-5" style={{ minHeight: 260 }} />
        <LoadingBlock count={3} />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow={`Watch desk · ${today}`}
        title="今日值班台"
        subtitle={
          <>
            {software.length} 个关注软件 · 上次巡检 {relativeTime(data?.lastSyncAt)}
            {data?.nextSyncAt ? ` · 下次 ${formatDateTime(data.nextSyncAt)}` : ''}
          </>
        }
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => void syncAll()} disabled={syncingAll}>
              <RefreshCw size={14} className={syncingAll ? 'animate-spin' : ''} />
              {syncingAll ? '同步中…' : '同步全部'}
            </button>
            <button className="btn btn-primary" onClick={() => openAdd()}>
              <Plus size={14} /> 添加软件
            </button>
          </>
        }
      />

      {error && <div className="error-note mb-3">{error}。页面展示的是最近一次成功加载的数据。</div>}

      <section className="briefing rise" aria-label="关键待办摘要">
        <div className="briefing-orbit" />
        <div className="briefing-grid">
          <div>
            <div className="briefing-top">
              <span className="eyebrow">Signal summary</span>
              <span className="brief-live">
                <span className={`live-dot ${(briefing?.sourceIssues ?? 0) > 0 ? 'warn' : ''}`} />
                live watch
              </span>
            </div>

            <div className="brief-count-row">
              <span className="brief-count">{briefing?.pending ?? 0}</span>
              <div className="brief-count-label">
                <strong>项待处理信号</strong>
                <span>
                  {briefing?.p0
                    ? `${briefing.p0} 项已确认遭实际利用，优先处理`
                    : (briefing?.eolSoon ?? 0) > 0 && (briefing?.spectrum.p0 ?? 0) + (briefing?.spectrum.p1 ?? 0) + (briefing?.spectrum.p2 ?? 0) === 0
                      ? `${briefing?.eolSoon} 个软件存在生命周期告警`
                      : briefing?.pending
                        ? '按风险等级从高到低排列'
                        : '当前没有需要立即处理的高风险项'}
                </span>
              </div>
            </div>

            <div className="brief-spectrum">
              <div className="spectrum-bar" aria-hidden="true">
                {spectrumItems.map((item) => (
                  <span
                    key={item.key}
                    className={`spectrum-seg ${item.key} ${spectrum[item.key] === 0 ? 'empty' : ''}`}
                    style={{ flexGrow: spectrumTotal === 0 ? 1 : spectrum[item.key] || 0.6 }}
                  />
                ))}
              </div>
              <div className="spectrum-legend">
                {spectrumItems.map((item) => (
                  <span key={item.key}>
                    <i
                      style={{
                        background:
                          item.key === 'p0'
                            ? 'var(--critical)'
                            : item.key === 'p1'
                              ? 'var(--high)'
                              : item.key === 'p2'
                                ? 'var(--note)'
                                : 'var(--muted-2)',
                      }}
                    />
                    {item.label} <strong style={{ color: '#d6dfd8' }}>{spectrum[item.key]}</strong>
                  </span>
                ))}
              </div>
            </div>

            <div className="brief-foot">
              <span>
                最近巡检 <strong>{relativeTime(data?.lastSyncAt)}</strong>
              </span>
              <span>
                关注范围 <strong>{software.length} 个软件</strong>
              </span>
              {(briefing?.unread ?? 0) > 0 && (
                <span>
                  未读 <strong>{briefing?.unread}</strong>
                </span>
              )}
            </div>
          </div>

          <div className="brief-side">
            <div>
              <div className="brief-metric">
                <span className="brief-metric-label">
                  <ShieldAlert size={12} /> P0 + P1 漏洞
                </span>
                <span className={`brief-metric-value ${(briefing?.p0 ?? 0) > 0 ? 'danger' : ''}`}>
                  {(briefing?.p0 ?? 0) + (briefing?.p1 ?? 0)}
                </span>
              </div>
              <div className="brief-metric">
                <span className="brief-metric-label">
                  <Clock3 size={12} /> 生命周期告警
                </span>
                <span className={`brief-metric-value ${(briefing?.eolSoon ?? 0) > 0 ? 'warn' : ''}`}>
                  {briefing?.eolSoon ?? 0}
                </span>
              </div>
              <div className="brief-metric">
                <span className="brief-metric-label">
                  <ArrowUpRight size={12} /> 可用新版本
                </span>
                <span className="brief-metric-value">{briefing?.newVersions ?? 0}</span>
              </div>
            </div>

            <div>
              {(briefing?.sourceIssues ?? 0) > 0 && (
                <div className="brief-issues">
                  <CircleAlert size={12} /> {briefing?.sourceIssues} 个数据源需要检查
                </div>
              )}
              <div className="brief-actions">
                <Link className="brief-action-link" to="/vulnerabilities">
                  漏洞待办 <ArrowRight size={12} />
                </Link>
                <Link className="brief-action-link" to="/versions">
                  生命周期 <ArrowRight size={12} />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {((data?.notifications.unread ?? 0) > 0 || (data?.notifications.recent.length ?? 0) > 0) && (
        <section className="section rise notification-home" style={{ animationDelay: '40ms' }}>
          <SectionHeader
            title="通知中心"
            count={data?.notifications.unread}
            subtitle="按关注对象与订阅规则生成；站内通知不依赖邮件通道。"
            action={
              <Link to="/notifications" className="text-link">
                <Bell size={12} /> 查看全部 <ArrowRight size={11} />
              </Link>
            }
          />
          <div className="notification-strip panel">
            {data?.notifications.recent.map((item) => {
              const severity = notificationSeverityMeta[item.severity];
              return (
                <Link
                  className={`notification-strip-row ${item.readAt ? '' : 'unread'}`}
                  key={item.id}
                  to={item.link ?? '/notifications'}
                >
                  <span className={`notification-severity ${severity.className}`}>
                    <span>{severity.label}</span>
                    <i />
                  </span>
                  <span className="notification-strip-main">
                    <strong>{item.title}</strong>
                    <span>
                      {item.targetName} · {notificationRuleMeta[item.ruleType].label} ·{' '}
                      {relativeTime(item.createdAt)}
                    </span>
                  </span>
                  {!item.readAt && <span className="unread-dot" />}
                  <ArrowUpRight size={12} className="notification-strip-arrow" />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {software.length === 0 ? (
        <section className="section rise" style={{ animationDelay: '60ms' }}>
          <div className="panel p-6 sm:p-8">
            <div className="mx-auto max-w-[720px] text-center">
              <span className="empty-mark mx-auto">
                <Sparkles size={17} />
              </span>
              <div className="eyebrow no-rule justify-center">Start here</div>
              <h2 className="mt-2 font-display text-[1.625rem] font-[560] tracking-[-0.035em]">
                从关注第一个软件开始
              </h2>
              <p className="mx-auto mt-2 max-w-[520px] text-[0.875rem] leading-7 text-[var(--muted)]">
                添加软件并配置当前版本后，Opsite 会自动采集发布、生命周期和安全公告，并把所有情报关联到同一个软件身份。
              </p>
              <div className="mt-5 flex justify-center gap-2">
                <button className="btn btn-primary" onClick={() => openAdd()}>
                  <Plus size={14} /> 添加第一个软件
                </button>
                <Link className="btn btn-secondary" to="/settings">
                  先配置数据源
                </Link>
              </div>
            </div>

            <div className="mt-7 border-t border-[var(--line)] pt-5">
              <div className="mb-3 text-center text-[0.6875rem] uppercase tracking-[0.12em] text-[var(--muted-2)]">
                常用起点
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {suggestions.map((item) => (
                  <button
                    key={item.key}
                    className="flex items-center gap-2.5 rounded-[10px] border border-[var(--line)] bg-[#fafbf8] p-2.5 text-left transition-colors hover:border-[var(--line-strong)] hover:bg-white"
                    onClick={() => openAdd(item.key)}
                  >
                    <img
                      src={`https://cdn.simpleicons.org/${item.slug}`}
                      alt=""
                      className="h-6 w-6 opacity-75"
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                    <span>
                      <strong className="block text-[0.8125rem] font-[550]">{item.name}</strong>
                      <span className="mt-0.5 block text-[0.65625rem] text-[var(--muted)]">{item.category}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="section rise" style={{ animationDelay: '60ms' }}>
            <SectionHeader
              title="最近情报"
              count={data?.events.length}
              subtitle="按风险等级和首次发现时间排序，点击进入对应软件的详情"
              action={
                <Link to="/events" className="text-link">
                  事件中心 <ArrowRight size={12} />
                </Link>
              }
            />
            <div className="events-panel panel">
              {data?.events.length ? (
                data.events.slice(0, 6).map((event) => <EventRow key={event.id} event={event} />)
              ) : (
                <EmptyState
                  compact
                  icon={Radar}
                  title="还没有情报事件"
                  description="首次采集完成后，新版本、生命周期变化和漏洞公告会汇聚到这里。"
                />
              )}
            </div>
          </section>

          <section className="section rise" style={{ animationDelay: '110ms' }}>
            <SectionHeader
              title="我的软件"
              count={software.length}
              subtitle="版本、生命周期与安全状态围绕同一份软件清单汇总"
              action={
                <div className="flex items-center gap-2">
                  <Link to="/software" className="text-link">
                    管理清单 <ArrowRight size={12} />
                  </Link>
                  <button className="btn btn-secondary btn-sm" onClick={() => openAdd()}>
                    <Plus size={12} /> 添加
                  </button>
                </div>
              }
            />

            <div className="filter-bar">
              <div className="filter-chips">
                {(
                  [
                    ['all', '全部', counts.all],
                    ['risk', '安全风险', counts.risk],
                    ['update', '有新版本', counts.update],
                    ['lifecycle', '生命周期异常', counts.lifecycle],
                    ['source', '数据源异常', counts.source],
                  ] as Array<[StatusFilter, string, number]>
                ).map(([value, label, count]) => (
                  <button
                    key={value}
                    className={`chip ${statusFilter === value ? 'active' : ''}`}
                    onClick={() => setStatusFilter(value)}
                  >
                    {label}
                    {count > 0 && <span className="chip-count">{count}</span>}
                  </button>
                ))}
              </div>
              <div className="filter-spacer" />
              <div className="inline-search">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="筛选软件名称"
                  aria-label="筛选软件名称"
                />
              </div>
              <select
                className="filter-select"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortOption)}
                aria-label="排序方式"
              >
                <option value="risk">风险优先</option>
                <option value="recent">最近更新</option>
                <option value="name">名称排序</option>
              </select>
            </div>

            {filtered.length ? (
              <div className="software-grid">
                {filtered.map((item, index) => (
                  <div className="rise" key={item.id} style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}>
                    <SoftwareCard software={item} onEdit={setEditing} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Boxes}
                title="没有符合筛选条件的软件"
                description="调整筛选条件，或添加新的关注软件。"
                actions={
                  <button className="btn btn-secondary btn-sm" onClick={() => {
                    setStatusFilter('all');
                    setQuery('');
                  }}>
                    清除筛选
                  </button>
                }
              />
            )}
          </section>

          <section className="section rise" style={{ animationDelay: '160ms' }}>
            <SectionHeader
              title="技术雷达"
              count={data?.radarCount}
              subtitle="你自己挑选的新工具、技术更新与学习线索"
              action={
                <Link to="/radar" className="text-link">
                  打开雷达 <ArrowRight size={12} />
                </Link>
              }
            />
            {data?.radar.length ? (
              <div className="radar-grid">
                {data.radar.map((item) => (
                  <article className="radar-card" key={item.id}>
                    <span className="radar-kind">{item.kind}</span>
                    <h3>{item.title}</h3>
                    <p>{item.summary}</p>
                    <footer>
                      <span>{formatDateTime(item.createdAt)}</span>
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noreferrer" className="text-link">
                          查看 <ArrowUpRight size={11} />
                        </a>
                      )}
                    </footer>
                  </article>
                ))}
              </div>
            ) : (
              <div className="panel flex flex-wrap items-center justify-between gap-4 p-5">
                <div className="flex items-center gap-3">
                  <span className="empty-mark" style={{ width: 38, height: 38, margin: 0 }}>
                    <Radar size={15} />
                  </span>
                  <div>
                    <div className="text-[0.875rem] font-[550]">雷达还没有条目</div>
                    <p className="mt-1 text-[0.75rem] text-[var(--muted)]">
                      把一个正在评估的工具或学习主题放进去，首页会持续提醒你。
                    </p>
                  </div>
                </div>
                <Link to="/radar" className="btn btn-secondary btn-sm">
                  添加条目 <Plus size={12} />
                </Link>
              </div>
            )}
          </section>
        </>
      )}

      <AddSoftwareDialog open={addOpen} onClose={() => setAddOpen(false)} initialCatalogKey={presetKey} />
      <EditSoftwareDialog
        software={editing}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        onUpdated={() => void refresh(true)}
      />
    </div>
  );
}
