import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Boxes, CalendarClock, GitBranch, History, Tag } from 'lucide-react';
import type { LifecycleFeedItem, ReleaseFeedItem } from '@shared/types';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { useAppData } from '../contexts/AppDataContext';
import { eolLabel, formatDate, relativeTime, supportMeta } from '../lib/format';
import { formatReleaseNotes } from '../lib/text';
import { EmptyState, LoadingBlock, PageHeader } from '../components/ui';
import { Logo } from '../components/Logo';

type Tab = 'releases' | 'lifecycle';

function dayKey(value: string | null): string {
  return value ? value.slice(0, 10) : 'unknown';
}

export function Versions() {
  useDocumentTitle('版本与生命周期');
  const [tab, setTab] = useState<Tab>('releases');
  const releases = useApi<ReleaseFeedItem[]>('/releases');
  const lifecycle = useApi<LifecycleFeedItem[]>('/lifecycle');
  const { data: appData } = useAppData();
  const [softwareId, setSoftwareId] = useState('all');
  const [channel, setChannel] = useState<'all' | 'stable' | 'prerelease'>('all');
  const [newerOnly, setNewerOnly] = useState(false);
  const [includeEol, setIncludeEol] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const software = appData?.software ?? [];

  const filteredReleases = useMemo(() => {
    return (releases.data ?? []).filter((item) => {
      if (softwareId !== 'all' && item.softwareId !== softwareId) return false;
      if (channel !== 'all' && item.channel !== channel) return false;
      if (newerOnly && !item.isNewer) return false;
      return true;
    });
  }, [releases.data, softwareId, channel, newerOnly]);

  const groupedReleases = useMemo(() => {
    const groups = new Map<string, ReleaseFeedItem[]>();
    for (const item of filteredReleases) {
      const key = dayKey(item.publishedAt ?? item.firstSeenAt);
      const list = groups.get(key) ?? [];
      list.push(item);
      groups.set(key, list);
    }
    return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [filteredReleases]);

  const lifecycleGroups = useMemo(() => {
    const groups = new Map<string, LifecycleFeedItem[]>();
    for (const item of lifecycle.data ?? []) {
      const list = groups.get(item.softwareId) ?? [];
      list.push(item);
      groups.set(item.softwareId, list);
    }
    return [...groups.values()]
      .map((items) =>
        items.sort((a, b) => {
          // Current cycle first, then support status, then cycle name.
          if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
          if (a.supportStatus !== b.supportStatus) {
            const rank = { unknown: 0, supported: 1, approaching_eol: 2, eol: 3 };
            return rank[a.supportStatus] - rank[b.supportStatus];
          }
          return b.cycle.localeCompare(a.cycle, undefined, { numeric: true });
        }),
      )
      .sort((a, b) => a[0].softwareName.localeCompare(b[0].softwareName, 'zh-CN'));
  }, [lifecycle.data]);

  const lifecycleCounts = useMemo(() => {
    const softwareIds = new Set((appData?.software ?? []).map((item) => item.id));
    const lifecycleIds = new Set((lifecycle.data ?? []).map((item) => item.softwareId));
    return {
      eol: (appData?.software ?? []).filter((item) => item.lifecycle.status === 'eol').length,
      approaching: (appData?.software ?? []).filter((item) => item.lifecycle.status === 'approaching_eol')
        .length,
      unknown: [...softwareIds].filter((id) => !lifecycleIds.has(id)).length,
    };
  }, [appData?.software, lifecycle.data]);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Versions & lifecycle · verified dates only"
        title="版本与生命周期"
        subtitle="“有新版本”和“建议升级”不是一回事；EOL 日期只使用可信来源，不按发布日期推断。"
        actions={
          <>
            <span className="pill pill-neutral">
              <History size={10} /> {releases.data?.length ?? 0} 条版本记录
            </span>
            <span className="pill pill-neutral">
              <CalendarClock size={10} /> {lifecycle.data?.length ?? 0} 个发布周期
            </span>
          </>
        }
      />

      <div className="tabs" role="tablist">
        <button
          className={`tab ${tab === 'releases' ? 'active' : ''}`}
          role="tab"
          aria-selected={tab === 'releases'}
          onClick={() => setTab('releases')}
        >
          <Tag size={12} /> 版本发布 <span className="tab-count">{releases.data?.length ?? 0}</span>
        </button>
        <button
          className={`tab ${tab === 'lifecycle' ? 'active' : ''}`}
          role="tab"
          aria-selected={tab === 'lifecycle'}
          onClick={() => setTab('lifecycle')}
        >
          <CalendarClock size={12} /> 生命周期 <span className="tab-count">{lifecycle.data?.length ?? 0}</span>
        </button>
      </div>

      {tab === 'releases' ? (
        <>
          <div className="filter-bar">
            <select
              className="filter-select"
              value={softwareId}
              onChange={(event) => setSoftwareId(event.target.value)}
              aria-label="按软件筛选版本"
            >
              <option value="all">全部软件</option>
              {software.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              className="filter-select"
              value={channel}
              onChange={(event) => setChannel(event.target.value as typeof channel)}
              aria-label="按发布通道筛选"
            >
              <option value="all">全部通道</option>
              <option value="stable">稳定版</option>
              <option value="prerelease">预发布</option>
            </select>
            <button
              className={`chip ${newerOnly ? 'active' : ''}`}
              onClick={() => setNewerOnly((value) => !value)}
            >
              仅领先当前版本
            </button>
            <div className="filter-spacer" />
            <span className="text-[0.6875rem] text-[var(--muted-2)]">
              最新记录首次发现于 {relativeTime(releases.data?.[0]?.firstSeenAt)}
            </span>
          </div>

          {releases.error && <div className="error-note mb-3">{releases.error}</div>}

          {releases.loading && !releases.data ? (
            <LoadingBlock />
          ) : groupedReleases.length === 0 ? (
            <EmptyState
              icon={Tag}
              title={(releases.data ?? []).length ? '没有符合条件的版本' : '还没有版本记录'}
              description={
                (releases.data ?? []).length
                  ? '调整软件、通道或“领先当前版本”筛选。'
                  : '为软件启用 GitHub Releases 或 endoflife.date 数据源后，下一次采集会写入版本与周期信息。'
              }
            />
          ) : (
            <div>
              {groupedReleases.map(([day, items]) => (
                <section className="release-day" key={day}>
                  <div className="release-day-label">
                    {day === 'unknown' ? '发布日期未知' : formatDate(day)}
                    <span className="text-[var(--muted-2)]">{items.length} releases</span>
                  </div>
                  {items.map((item) => (
                    <article className="release-item" key={item.id}>
                      <Link to={`/software/${item.softwareId}?tab=releases`} aria-label={item.softwareName}>
                        <Logo name={item.softwareName} logoUrl={item.softwareLogoUrl} size="sm" />
                      </Link>
                      <div className="release-main">
                        <div className="release-title">
                          <span className="release-version">{item.version}</span>
                          <span className="release-name">{item.softwareName}</span>
                          {item.channel === 'prerelease' && (
                            <span className="pill pill-note" style={{ height: 17, fontSize: '0.65625rem' }}>
                              预发布
                            </span>
                          )}
                          {item.isNewer && (
                            <span className="pill pill-info" style={{ height: 17, fontSize: '0.65625rem' }}>
                              领先当前 {item.currentVersion}
                            </span>
                          )}
                        </div>
                        {item.title && item.title !== item.version && (
                          <div className="release-meta">{item.title}</div>
                        )}
                        <div className="release-meta">
                          <span>首次发现 {relativeTime(item.firstSeenAt)}</span>
                          {item.publishedAt && <span>上游发布 {formatDate(item.publishedAt)}</span>}
                          <span>
                            {item.sourceType === 'github_releases' ? 'GitHub Releases' : 'endoflife.date'}
                          </span>
                        </div>
                        {item.notes && <p className="release-notes">{formatReleaseNotes(item.notes)}</p>}
                      </div>
                      {item.url && (
                        <a
                          className="text-link shrink-0 text-[0.75rem]"
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          发布说明 <ArrowUpRight size={11} />
                        </a>
                      )}
                    </article>
                  ))}
                </section>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="filter-bar">
            <div className="flex flex-wrap items-center gap-2">
              <span className="pill pill-danger">{lifecycleCounts.eol} 个软件已 EOL</span>
              <span className="pill pill-warn">{lifecycleCounts.approaching} 个即将到期</span>
              {lifecycleCounts.unknown > 0 && (
                <span className="pill pill-neutral">{lifecycleCounts.unknown} 个生命周期未知</span>
              )}
            </div>
            <div className="filter-spacer" />
            <button className={`chip ${includeEol ? 'active' : ''}`} onClick={() => setIncludeEol((value) => !value)}>
              包含已停止支持的周期
            </button>
          </div>

          {lifecycle.error && <div className="error-note mb-3">{lifecycle.error}</div>}

          {lifecycle.loading && !lifecycle.data ? (
            <LoadingBlock />
          ) : lifecycleGroups.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="还没有生命周期数据"
              description="生命周期来自 endoflife.date 等可信来源。为软件启用该数据源后重新采集即可建立周期视图。"
              actions={
                <Link to="/settings" className="btn btn-secondary btn-sm">
                  配置数据源
                </Link>
              }
            />
          ) : (
            <div className="flex flex-col gap-3">
              {lifecycleGroups.map((rows) => {
                const head = rows.find((row) => row.isCurrent) ?? rows[0];
                const visible = includeEol
                  ? rows
                  : rows.filter((row) => row.isCurrent || row.supportStatus !== 'eol');
                const isExpanded = expanded.has(head.softwareId);
                const shown = isExpanded
                  ? rows
                  : visible.length
                    ? visible
                    : rows.slice(0, 4);
                const support = supportMeta[head.isCurrent ? head.supportStatus : 'unknown'];
                const hiddenCount = rows.length - shown.length;
                return (
                  <section className="lifecycle-table" key={head.softwareId}>
                    <div className="lifecycle-software">
                      <Logo name={head.softwareName} logoUrl={head.softwareLogoUrl} size="xs" />
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        <strong>{head.softwareName}</strong>
                        <span className="text-[0.6875rem] text-[var(--muted)]">
                          当前 {head.currentVersion ?? '未配置'}
                        </span>
                        {head.isCurrent ? (
                          <span className={`pill pill-${support.className}`} style={{ height: 18, fontSize: '0.65625rem' }}>
                            {support.label}
                          </span>
                        ) : (
                          <span className="pill pill-neutral" style={{ height: 18, fontSize: '0.65625rem' }}>
                            当前周期未匹配
                          </span>
                        )}
                      </div>
                      <Link to={`/software/${head.softwareId}?tab=lifecycle`} className="text-link text-[0.6875rem]">
                        查看详情 <ArrowUpRight size={10} />
                      </Link>
                    </div>

                    <div className="lifecycle-head" aria-hidden="true">
                      <span>Cycle</span>
                      <span>Released</span>
                      <span>Support</span>
                      <span>EOL date</span>
                      <span>Latest patch</span>
                      <span />
                    </div>

                    {shown.map((row) => {
                      const meta = supportMeta[row.supportStatus];
                      return (
                        <div className={`lifecycle-row ${row.isCurrent ? 'current' : ''}`} key={row.id}>
                          <span className="lifecycle-cycle">{row.cycle}</span>
                          <span className="muted-cell hide-md">{formatDate(row.releaseDate)}</span>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className={`pill pill-${meta.className}`} style={{ height: 18, fontSize: '0.65625rem' }}>
                              {meta.label}
                            </span>
                            {row.isCurrent && (
                              <span className="pill pill-signal" style={{ height: 18, fontSize: '0.65625rem' }}>
                                当前
                              </span>
                            )}
                          </span>
                          <span className={row.supportStatus === 'eol' ? 'text-[var(--critical)]' : 'muted-cell'}>
                            {row.eolDate
                              ? row.supportStatus === 'eol' || row.supportStatus === 'approaching_eol'
                                ? eolLabel(row.eolDate)
                                : formatDate(row.eolDate)
                              : '未公布'}
                          </span>
                          <span className="muted-cell hide-md">{row.latestVersion ?? '—'}</span>
                          <span>
                            {row.sourceUrl && (
                              <a
                                href={row.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-link"
                                aria-label="打开生命周期来源"
                              >
                                <ArrowUpRight size={11} />
                              </a>
                            )}
                          </span>
                        </div>
                      );
                    })}

                    {hiddenCount > 0 && !isExpanded && (
                      <button
                        className="w-full border-t border-[var(--line)] py-2 text-[0.6875rem] text-[var(--muted)] hover:bg-[#fafbf8]"
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            next.add(head.softwareId);
                            return next;
                          })
                        }
                      >
                        显示其余 {hiddenCount} 个周期
                      </button>
                    )}
                    {isExpanded && rows.length > 6 && (
                      <button
                        className="w-full border-t border-[var(--line)] py-2 text-[0.6875rem] text-[var(--muted)] hover:bg-[#fafbf8]"
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            next.delete(head.softwareId);
                            return next;
                          })
                        }
                      >
                        收起历史周期
                      </button>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.6875rem] text-[var(--muted-2)]">
            <Boxes size={11} />
            生命周期记录保留来源链接与采集时间；无可靠来源的软件会显示“未知”，不会推断 EOL。
            <span className="ml-auto inline-flex items-center gap-1">
              <GitBranch size={10} /> 共 {lifecycle.data?.length ?? 0} 个周期
            </span>
          </div>
        </>
      )}
    </div>
  );
}
