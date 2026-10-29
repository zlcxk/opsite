import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Archive,
  ArrowLeft,
  ArrowUpRight,
  Clock3,
  ExternalLink,
  GitBranch,
  NotebookPen,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Play,
  PlugZap,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Tag,
} from 'lucide-react';
import type {
  Advisory,
  AdvisoryStatus,
  KnowledgeNote,
  SoftwareDetail as SoftwareDetailData,
  SyncJob,
  VersionImpact,
} from '@shared/types';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { formatReleaseNotes } from '../lib/text';
import { api } from '../lib/api';
import { useAppData } from '../contexts/AppDataContext';
import { useToast } from '../contexts/ToastContext';
import {
  advisoryStatusMeta,
  categoryColor,
  eolLabel,
  formatDate,
  formatDateTime,
  impactMeta,
  relativeTime,
  severityMeta,
  sourceTypeLabel,
  supportMeta,
  watchLevelMeta,
} from '../lib/format';
import { hasUpdate } from '../lib/version';
import { summarizeConfig } from '../components/SourceConfigFields';
import { Logo } from '../components/Logo';
import { ActionMenu, EmptyState, LoadingBlock, Modal } from '../components/ui';
import { EditSoftwareDialog } from '../components/EditSoftwareDialog';
import { AdvisoryDrawer } from '../components/AdvisoryDrawer';

const tabs = [
  ['overview', '概览'],
  ['releases', '版本发布'],
  ['lifecycle', '生命周期'],
  ['vulnerabilities', '漏洞'],
  ['compatibility', '兼容性'],
  ['sources', '数据源'],
  ['logs', '采集日志'],
] as const;

type Tab = (typeof tabs)[number][0];

const openStatuses: AdvisoryStatus[] = ['pending', 'to_fix', 'planned'];
const impactOrder: Record<VersionImpact, number> = {
  affected: 0,
  possibly_affected: 1,
  insufficient: 2,
  not_affected: 3,
};

export function SoftwareDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, loading, error, refetch } = useApi<SoftwareDetailData>(
    id ? `/software/${id}` : null,
  );
  const { refresh } = useAppData();
  const { push } = useToast();
  const [editing, setEditing] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [selectedAdvisory, setSelectedAdvisory] = useState<string | null>(null);
  const [advisoryFilter, setAdvisoryFilter] = useState<'open' | 'all'>('open');
  const [showAllReleases, setShowAllReleases] = useState(false);

  const rawTab = searchParams.get('tab') as Tab | null;
  const tab: Tab = tabs.some(([key]) => key === rawTab) ? (rawTab as Tab) : 'overview';
  const compatibility = useApi<KnowledgeNote[]>(tab === 'compatibility' ? '/knowledge' : null);

  const software = data?.software;
  useDocumentTitle(software?.name ?? '软件详情');

  const openAdvisories = useMemo(
    () => (data?.advisories ?? []).filter((item) => openStatuses.includes(item.status)),
    [data?.advisories],
  );

  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  if (loading && !data) {
    return (
      <div className="page">
        <LoadingBlock />
        <div className="loading-block mt-4" style={{ minHeight: 320 }} />
      </div>
    );
  }

  if (!software) {
    return (
      <div className="page">
        <EmptyState
          icon={ShieldAlert}
          title="软件不存在或已归档"
          description="它可能已被归档。历史数据仍保留在数据库中。"
          actions={
            <Link to="/software" className="btn btn-secondary">
              返回软件清单
            </Link>
          }
        />
      </div>
    );
  }

  const lifecycleMeta = supportMeta[software.lifecycle.status];
  const enabledSources = data.sources.filter((source) => source.enabled);
  const updateAvailable = hasUpdate(software.currentVersion, software.latestVersion);

  const syncAll = async () => {
    setSyncing('all');
    try {
      const result = await api.post<{ jobs: Array<{ status: string; error: string | null }> }>(
        `/software/${software.id}/sync`,
      );
      const failed = result.jobs?.find((job) => job.status === 'error');
      push(
        failed ? `部分数据源失败：${failed.error ?? '未知错误'}` : `${software.name} 采集完成`,
        failed ? 'error' : 'success',
      );
      await Promise.all([refetch(true), refresh(true)]);
    } catch (syncError) {
      push(syncError instanceof Error ? syncError.message : '同步失败', 'error');
    } finally {
      setSyncing(null);
    }
  };

  const syncSource = async (sourceId: string) => {
    setSyncing(sourceId);
    try {
      const result = await api.post<{ jobs: Array<{ status: string; error: string | null }> }>(
        `/software/${software.id}/sync`,
        { sourceIds: [sourceId] },
      );
      const failed = result.jobs?.find((job) => job.status === 'error');
      push(failed ? `采集失败：${failed.error ?? '未知错误'}` : '数据源采集完成', failed ? 'error' : 'success');
      await refetch(true);
    } catch (syncError) {
      push(syncError instanceof Error ? syncError.message : '同步失败', 'error');
    } finally {
      setSyncing(null);
    }
  };

  const togglePause = async () => {
    try {
      await api.patch(`/software/${software.id}`, {
        watchStatus: software.watchStatus === 'paused' ? 'active' : 'paused',
      });
      await Promise.all([refetch(true), refresh(true)]);
      push(software.watchStatus === 'paused' ? '已恢复关注' : '已暂停关注，历史保留');
    } catch (pauseError) {
      push(pauseError instanceof Error ? pauseError.message : '操作失败', 'error');
    }
  };

  const togglePin = async () => {
    try {
      await api.patch(`/software/${software.id}`, { pinned: !software.pinned });
      await Promise.all([refetch(true), refresh(true)]);
    } catch (pinError) {
      push(pinError instanceof Error ? pinError.message : '操作失败', 'error');
    }
  };

  const updateSourceEnabled = async (sourceId: string, enabled: boolean) => {
    try {
      await api.patch(`/software/${software.id}`, { sources: [{ id: sourceId, enabled }] });
      await refetch(true);
      push(enabled ? '数据源已启用' : '数据源已停用，历史数据保留');
    } catch (sourceError) {
      push(sourceError instanceof Error ? sourceError.message : '更新失败', 'error');
    }
  };

  const updateAdvisoryStatus = async (advisory: Advisory, status: AdvisoryStatus) => {
    try {
      await api.patch(`/advisories/${advisory.id}/status`, { status });
      await refetch(true);
      push(`${advisory.identifier} 的处置状态已更新`);
    } catch (statusError) {
      push(statusError instanceof Error ? statusError.message : '更新失败', 'error');
    }
  };

  const archive = async () => {
    try {
      await api.delete(`/software/${software.id}`);
      push(`${software.name} 已归档`);
      await refresh(true);
      navigate('/software');
    } catch (archiveError) {
      push(archiveError instanceof Error ? archiveError.message : '归档失败', 'error');
    }
  };

  return (
    <div className="page">
      <button className="mb-3 inline-flex items-center gap-1.5 text-[9.5px] text-[var(--muted)] hover:text-[var(--ink)]" onClick={() => navigate(-1)}>
        <ArrowLeft size={12} /> 返回
      </button>

      {error && <div className="error-note mb-3">{error}</div>}

      <header className="detail-head">
        <div className="detail-identity">
          <Logo name={software.name} logoUrl={software.logoUrl} size="lg" />
          <div className="detail-title">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="eyebrow no-rule">{software.category}</span>
              {software.watchStatus === 'paused' && (
                <span className="pill pill-neutral" style={{ height: 19, fontSize: 8 }}>已暂停</span>
              )}
              <span className={`pill pill-${watchLevelMeta[software.watchLevel].className}`} style={{ height: 19, fontSize: 8 }}>
                {watchLevelMeta[software.watchLevel].label}
              </span>
            </div>
            <h1>{software.name}</h1>
            <div className="detail-sub">
              <span className="inline-flex items-center gap-1.5">
                <i className="category-dot" style={{ background: categoryColor(software.category) }} />
                {software.environment || '未标注环境'}
              </span>
              {software.aliases.length > 0 && <span>别名 {software.aliases.join(' / ')}</span>}
              {software.website && (
                <a href={software.website} target="_blank" rel="noreferrer" className="text-link">
                  官网 <ArrowUpRight size={10} />
                </a>
              )}
              {software.repo && (
                <a href={software.repo} target="_blank" rel="noreferrer" className="text-link">
                  仓库 <ArrowUpRight size={10} />
                </a>
              )}
            </div>
            {software.description && (
              <p className="mt-2 max-w-[620px] text-[10.5px] leading-6 text-[var(--muted)]">{software.description}</p>
            )}
          </div>
        </div>

        <div className="detail-actions">
          <button className="btn btn-secondary" onClick={() => void syncAll()} disabled={syncing !== null}>
            <RefreshCw size={13} className={syncing === 'all' ? 'animate-spin' : ''} />
            {syncing === 'all' ? '采集中…' : '立即同步'}
          </button>
          <button className="btn btn-primary" onClick={() => setEditing(true)}>
            <Pencil size={13} /> 编辑配置
          </button>
          <ActionMenu
            trigger={
              <span className="btn btn-secondary" style={{ width: 34, padding: 0 }}>
                ⋯
              </span>
            }
            items={[
              {
                label: software.watchStatus === 'paused' ? '恢复关注' : '暂停关注',
                icon: software.watchStatus === 'paused' ? Play : Pause,
                onClick: () => void togglePause(),
              },
              {
                label: software.pinned ? '取消置顶' : '置顶到首页',
                icon: software.pinned ? PinOff : Pin,
                onClick: () => void togglePin(),
              },
              { label: '归档软件', icon: Archive, danger: true, separator: true, onClick: () => setArchiving(true) },
            ]}
          />
        </div>
      </header>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">
            <ShieldAlert size={10} /> 待处理漏洞
          </span>
          <span className="stat-value">
            {openAdvisories.length}
            <small>项</small>
          </span>
          <div className="stat-foot">
            {openAdvisories.filter((item) => item.versionImpact === 'affected').length} 项确认受当前版本影响
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-label">
            <Clock3 size={10} /> 当前版本生命周期
          </span>
          <span className={`stat-value ${lifecycleMeta.className === 'danger' ? 'text-[var(--critical)]' : lifecycleMeta.className === 'warn' ? 'text-[var(--high)]' : ''}`} style={{ fontSize: 19 }}>
            {lifecycleMeta.label}
          </span>
          <div className="stat-foot">
            {software.lifecycle.eolDate
              ? `${software.lifecycle.cycle ? `周期 ${software.lifecycle.cycle} · ` : ''}EOL ${eolLabel(software.lifecycle.eolDate)}`
              : '缺少可信 EOL 日期，不做推断'}
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-label">
            <Tag size={10} /> 当前 / 最新稳定
          </span>
          <span className="stat-value" style={{ fontSize: 19 }}>
            {software.currentVersion ?? '待配置'}
            <small>/ {software.latestVersion ?? '未采集'}</small>
          </span>
          <div className="stat-foot">
            {updateAvailable ? 'Latest 领先当前版本，是否升级需结合兼容性判断' : '当前没有可确认的版本差'}
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-label">
            <PlugZap size={10} /> 数据源
          </span>
          <span className="stat-value">
            {enabledSources.length}
            <small>/ {data.sources.length} 启用</small>
          </span>
          <div className="stat-foot">
            {software.sourceIssueCount > 0 ? `${software.sourceIssueCount} 个异常，保留上次成功数据` : `最近同步 ${relativeTime(software.lastSyncAt)}`}
          </div>
        </div>
      </div>

      {software.lifecycle.notice && (
        <div className="form-note mt-3 flex items-start gap-2">
          <Clock3 size={12} className="mt-0.5 flex-none" />
          {software.lifecycle.notice}
        </div>
      )}

      <div className="tabs mt-5" role="tablist">
        {tabs.map(([key, label]) => {
          const count =
            key === 'vulnerabilities'
              ? data.advisories.length
              : key === 'releases'
                ? data.releases.length
                : key === 'lifecycle'
                  ? data.lifecycle.length
                  : key === 'logs'
                    ? data.jobs.length
                    : key === 'sources'
                      ? data.sources.length
                      : undefined;
          return (
            <button
              key={key}
              className={`tab ${tab === key ? 'active' : ''}`}
              onClick={() => setTab(key)}
              role="tab"
              aria-selected={tab === key}
            >
              {label}
              {count !== undefined && count > 0 && <span className="tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && (
        <div className="detail-grid">
          <div className="flex flex-col gap-3.5">
            <section className="panel">
              <div className="panel-head">
                <h3>安全状态</h3>
                <button className="text-link" onClick={() => setTab('vulnerabilities')}>
                  全部 {data.advisories.length} 条 <ArrowUpRight size={10} />
                </button>
              </div>
              <div className="panel-body flush">
                {openAdvisories.length ? (
                  openAdvisories
                    .slice()
                    .sort((a, b) => impactOrder[a.versionImpact] - impactOrder[b.versionImpact])
                    .slice(0, 5)
                    .map((advisory) => {
                      const impact = impactMeta[advisory.versionImpact];
                      const severity = severityMeta[advisory.severity];
                      return (
                        <button
                          className="detail-advisory-row"
                          key={advisory.id}
                          onClick={() => setSelectedAdvisory(advisory.id)}
                        >
                          <span className="detail-advisory-id">{advisory.identifier}</span>
                          <span className="cell-main">
                            <strong>{advisory.title}</strong>
                            <span>
                              {severity.label} · 发布 {formatDate(advisory.publishedAt)}
                              {advisory.kev ? ' · KEV 已利用' : ''}
                            </span>
                          </span>
                          <span className={`pill pill-${impact.className}`}>{impact.label}</span>
                        </button>
                      );
                    })
                ) : (
                  <EmptyState
                    compact
                    icon={data.advisories.length ? ShieldCheck : ShieldAlert}
                    title={data.advisories.length ? '没有待处理的漏洞' : '尚未采集到安全公告'}
                    description={
                      data.advisories.length
                        ? `已采集的 ${data.advisories.length} 条公告均已处置或确认不受影响。`
                        : '这不代表已确认不受影响。请确认 GitHub Advisory 或 NVD 数据源已启用。'
                    }
                  />
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h3>最近版本</h3>
                <button className="text-link" onClick={() => setTab('releases')}>
                  版本历史 <ArrowUpRight size={10} />
                </button>
              </div>
              <div className="panel-body">
                {data.releases.length ? (
                  <div className="mini-list">
                    {data.releases.slice(0, 4).map((release) => (
                      <div className="mini-row" key={release.id}>
                        <div className="mini-row-main">
                          <strong>
                            <span className="font-mono">{release.version}</span>
                            {release.channel === 'prerelease' && (
                              <span className="pill pill-note ml-2" style={{ height: 16, fontSize: 7 }}>预发布</span>
                            )}
                          </strong>
                          <span>{release.title || '无发布说明'} · {formatDate(release.publishedAt)}</span>
                        </div>
                        {release.url && (
                          <a href={release.url} target="_blank" rel="noreferrer" className="text-link">
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState compact icon={Tag} title="还没有版本记录" description="启用 GitHub Releases 后，采集会写入版本与发布说明。" />
                )}
              </div>
            </section>
          </div>

          <div className="flex flex-col gap-3.5">
            <section className="panel">
              <div className="panel-head">
                <h3>生命周期</h3>
                <button className="text-link" onClick={() => setTab('lifecycle')}>
                  周期 <ArrowUpRight size={10} />
                </button>
              </div>
              <div className="panel-body">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className={`pill pill-${lifecycleMeta.className}`}>{lifecycleMeta.label}</span>
                  <span className="font-mono text-[9px] text-[var(--muted)]">
                    {software.lifecycle.cycle ? `cycle ${software.lifecycle.cycle}` : 'no matching cycle'}
                  </span>
                </div>
                <div className="mini-list">
                  <div className="mini-row">
                    <div className="mini-row-main">
                      <strong>EOL 日期</strong>
                      <span>{software.lifecycle.eolDate ? formatDate(software.lifecycle.eolDate) : '来源未提供'}</span>
                    </div>
                  </div>
                  <div className="mini-row">
                    <div className="mini-row-main">
                      <strong>该周期最新补丁</strong>
                      <span>{software.lifecycle.latestPatch ?? '未知'}</span>
                    </div>
                  </div>
                  <div className="mini-row">
                    <div className="mini-row-main">
                      <strong>最近核实</strong>
                      <span>{software.lifecycle.lastVerifiedAt ? formatDateTime(software.lifecycle.lastVerifiedAt) : '尚未核实'}</span>
                    </div>
                  </div>
                </div>
                {software.lifecycle.sourceUrl && (
                  <a href={software.lifecycle.sourceUrl} target="_blank" rel="noreferrer" className="text-link mt-3">
                    查看生命周期来源 <ExternalLink size={10} />
                  </a>
                )}
                {software.lifecycle.status === 'unknown' && (
                  <p className="mt-3 text-[9px] leading-5 text-[var(--muted-2)]">
                    没有足够可靠的来源数据，因此不显示推断的 EOL。
                  </p>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h3>采集健康度</h3>
                <button className="text-link" onClick={() => setTab('sources')}>
                  数据源 <ArrowUpRight size={10} />
                </button>
              </div>
              <div className="panel-body">
                <div className="mini-list">
                  {data.sources.map((source) => (
                    <div className="mini-row items-center" key={source.id}>
                      <span className={`live-dot ${source.lastStatus === 'error' ? 'warn' : ''}`} />
                      <div className="mini-row-main">
                        <strong>{source.label}</strong>
                        <span>
                          {source.enabled ? (source.lastStatus === 'ok' ? `正常 · ${relativeTime(source.lastSyncAt)}` : source.lastStatus === 'error' ? '采集异常' : '尚未同步') : '已停用'}
                        </span>
                      </div>
                      <span className="text-[8px] text-[var(--muted-2)]">{source.lastItemCount} 条</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {software.notes && (
              <section className="panel">
                <div className="panel-head">
                  <h3>个人备注</h3>
                </div>
                <div className="panel-body text-[10.5px] leading-6 text-[var(--muted)]">{software.notes}</div>
              </section>
            )}
          </div>
        </div>
      )}

      {tab === 'releases' && (
        <div>
          {data.releases.length === 0 ? (
            <EmptyState
              icon={Tag}
              title="还没有版本记录"
              description="启用 GitHub Releases 或 endoflife.date 数据源后，下一次采集会写入版本与发布说明。"
            />
          ) : (
            <>
              {(() => {
                const list = showAllReleases ? data.releases : data.releases.slice(0, 40);
                const groups = new Map<string, SoftwareDetailData['releases']>();
                for (const release of list) {
                  const key = (release.publishedAt ?? release.firstSeenAt).slice(0, 10);
                  const group = groups.get(key) ?? [];
                  group.push(release);
                  groups.set(key, group);
                }
                return [...groups.entries()].map(([day, releases]) => (
                  <section className="release-day" key={day}>
                    <div className="release-day-label">
                      {formatDate(day)} <span>{releases.length} releases</span>
                    </div>
                    {releases.map((release) => (
                      <article className="release-item" key={release.id}>
                        <div className="release-main">
                          <div className="release-title">
                            <span className="release-version">{release.version}</span>
                            {release.channel === 'prerelease' && (
                              <span className="pill pill-note" style={{ height: 17, fontSize: 7.5 }}>预发布</span>
                            )}
                            {hasUpdate(release.version, software.currentVersion) && release.channel === 'stable' && (
                              <span className="update-pill">领先当前</span>
                            )}
                            {release.version === software.currentVersion && (
                              <span className="pill pill-signal" style={{ height: 17, fontSize: 7.5 }}>当前使用</span>
                            )}
                          </div>
                          {release.title && <div className="release-meta">{release.title}</div>}
                          <div className="release-meta">
                            <span>上游发布 {formatDate(release.publishedAt)}</span>
                            <span>首次发现 {relativeTime(release.firstSeenAt)}</span>
                            <span>{sourceTypeLabel(release.sourceType)}</span>
                          </div>
                          {release.notes && <p className="release-notes">{formatReleaseNotes(release.notes)}</p>}
                        </div>
                        {release.url && (
                          <a href={release.url} target="_blank" rel="noreferrer" className="text-link shrink-0">
                            发布说明 <ArrowUpRight size={11} />
                          </a>
                        )}
                      </article>
                    ))}
                  </section>
                ));
              })()}
              {data.releases.length > 40 && (
                <button className="btn btn-secondary btn-sm" onClick={() => setShowAllReleases((value) => !value)}>
                  {showAllReleases ? '收起较早版本' : `显示全部 ${data.releases.length} 个版本`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'lifecycle' && (
        <div>
          {data.lifecycle.length === 0 ? (
            <EmptyState
              icon={Clock3}
              title="还没有生命周期数据"
              description="生命周期只使用可信来源。启用 endoflife.date 并重新采集后，这里会显示每个发布周期的支持状态。"
            />
          ) : (
            <div className="lifecycle-table">
              <div className="lifecycle-software">
                <GitBranch size={13} className="text-[var(--muted)]" />
                <strong>{software.name}</strong>
                <span className="text-[9px] text-[var(--muted)]">当前 {software.currentVersion ?? '未配置'}</span>
                <span className="ml-auto text-[8.5px] text-[var(--muted-2)]">
                  {data.lifecycle.length} 个周期 · 来源日期未做推断
                </span>
              </div>
              <div className="lifecycle-head" aria-hidden="true">
                <span>Cycle</span>
                <span>Released</span>
                <span>Support</span>
                <span>EOL date</span>
                <span>Latest patch</span>
                <span />
              </div>
              {data.lifecycle.map((row) => {
                const meta = supportMeta[row.supportStatus];
                return (
                  <div className={`lifecycle-row ${row.isCurrent ? 'current' : ''}`} key={row.id}>
                    <span className="lifecycle-cycle">{row.cycle}</span>
                    <span className="muted-cell hide-md">{formatDate(row.releaseDate)}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className={`pill pill-${meta.className}`} style={{ height: 18, fontSize: 7.5 }}>
                        {meta.label}
                      </span>
                      {row.isCurrent && <span className="pill pill-signal" style={{ height: 18, fontSize: 7.5 }}>当前</span>}
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
                        <a href={row.sourceUrl} target="_blank" rel="noreferrer" className="text-link">
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'vulnerabilities' && (
        <div>
          <div className="filter-bar">
            <div className="filter-chips">
              <button className={`chip ${advisoryFilter === 'open' ? 'active' : ''}`} onClick={() => setAdvisoryFilter('open')}>
                待处理 <span className="chip-count">{openAdvisories.length}</span>
              </button>
              <button className={`chip ${advisoryFilter === 'all' ? 'active' : ''}`} onClick={() => setAdvisoryFilter('all')}>
                全部 <span className="chip-count">{data.advisories.length}</span>
              </button>
            </div>
            <div className="filter-spacer" />
            <span className="text-[9px] text-[var(--muted-2)]">
              影响判断基于当前版本 {software.currentVersion ?? '（未配置）'}
            </span>
          </div>

          {(advisoryFilter === 'open' ? openAdvisories : data.advisories).length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title={advisoryFilter === 'open' ? '没有待处理的漏洞' : '还没有漏洞记录'}
              description={
                software.currentVersion
                  ? '当前版本尚未发现处于待处理状态的漏洞。'
                  : '先配置当前使用版本，再让采集结果参与本地影响判断。'
              }
            />
          ) : (
            <div className="data-list">
              {(advisoryFilter === 'open' ? openAdvisories : data.advisories)
                .slice()
                .sort((a, b) => impactOrder[a.versionImpact] - impactOrder[b.versionImpact])
                .map((advisory) => {
                  const impact = impactMeta[advisory.versionImpact];
                  const severity = severityMeta[advisory.severity];
                  return (
                    <div className="detail-vuln-row" key={advisory.id} onClick={() => setSelectedAdvisory(advisory.id)} role="button" tabIndex={0}>
                      <span className="vuln-id">{advisory.identifier}</span>
                      <div className="cell-main">
                        <strong>{advisory.title}</strong>
                        <div className="vuln-sub">
                          <span>{severity.label}</span>
                          <span>CVSS {advisory.score ?? '—'}</span>
                          <span>发布 {formatDate(advisory.publishedAt)}</span>
                          {advisory.kev && <span className="kev-badge">KEV</span>}
                          {advisory.fixedVersions.length > 0 && <span>修复 {advisory.fixedVersions.join(' / ')}</span>}
                        </div>
                      </div>
                      <span className={`pill pill-${impact.className}`}>{impact.label}</span>
                      <div onClick={(event) => event.stopPropagation()}>
                        <select
                          className="status-select"
                          value={advisory.status}
                          onChange={(event) => void updateAdvisoryStatus(advisory, event.target.value as AdvisoryStatus)}
                          aria-label={`${advisory.identifier} 处置状态`}
                        >
                          {(Object.keys(advisoryStatusMeta) as AdvisoryStatus[]).map((status) => (
                            <option key={status} value={status}>
                              {advisoryStatusMeta[status]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <span className={`advisory-priority-badge ${advisory.priority.toLowerCase()}`}>{advisory.priority}</span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {tab === 'compatibility' && (
        <div className="detail-grid equal">
          <section className="panel">
            <div className="panel-head">
              <h3>兼容性记录</h3>
              <Link to="/knowledge" className="text-link">
                知识库 <ArrowUpRight size={10} />
              </Link>
            </div>
            <div className="panel-body">
              <div className="form-note mb-3">
                Opsite 不会自动推断版本兼容性。这里展示知识库中关联到 {software.name} 的记录。
              </div>
              {compatibility.loading ? (
                <div className="loading-block" style={{ minHeight: 120 }} />
              ) : (compatibility.data ?? []).filter((note) => note.relatedSoftwareId === software.id).length ? (
                <div className="mini-list">
                  {(compatibility.data ?? [])
                    .filter((note) => note.relatedSoftwareId === software.id)
                    .map((note) => (
                      <div className="mini-row" key={note.id}>
                        <div className="mini-row-main">
                          <strong>{note.title}</strong>
                          <span>{note.content.slice(0, 120) || '暂无内容'}</span>
                        </div>
                        <span className="shrink-0 text-[8px] text-[var(--muted-2)]">{formatDate(note.updatedAt)}</span>
                      </div>
                    ))}
                </div>
              ) : (
                <EmptyState
                  compact
                  icon={NotebookPen}
                  title="还没有兼容性记录"
                  description="升级验证、依赖冲突和回滚结论都可以记录到知识库，并关联到这个软件。"
                  actions={
                    <Link to="/knowledge" className="btn btn-secondary btn-sm">
                      去写一条笔记
                    </Link>
                  }
                />
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h3>版本升级判断</h3>
            </div>
            <div className="panel-body">
              <div className="mini-list">
                <div className="mini-row">
                  <div className="mini-row-main">
                    <strong>当前版本</strong>
                    <span>{software.currentVersion ?? '未配置'}</span>
                  </div>
                </div>
                <div className="mini-row">
                  <div className="mini-row-main">
                    <strong>最新稳定版</strong>
                    <span>{software.latestVersion ?? '尚未采集'}</span>
                  </div>
                </div>
                <div className="mini-row">
                  <div className="mini-row-main">
                    <strong>版本差距</strong>
                    <span>{updateAvailable ? '存在新版本，但“有新版本”不等于“建议升级”' : '未发现明确版本差'}</span>
                  </div>
                </div>
                <div className="mini-row">
                  <div className="mini-row-main">
                    <strong>生命周期建议</strong>
                    <span>
                      {software.lifecycle.status === 'eol'
                        ? '当前版本已停止支持，应优先规划升级或隔离。'
                        : software.lifecycle.status === 'approaching_eol'
                          ? '当前版本即将停止支持，建议评估升级窗口。'
                          : software.lifecycle.status === 'supported'
                            ? '当前版本仍在支持期内，按常规节奏评估。'
                            : '缺少生命周期来源，暂不给出升级建议。'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {tab === 'sources' && (
        <div>
          {data.sources.length === 0 ? (
            <EmptyState
              icon={PlugZap}
              title="没有配置数据源"
              description="点击编辑配置，为该软件启用至少一个采集来源。"
              actions={
                <button className="btn btn-primary" onClick={() => setEditing(true)}>
                  配置数据源
                </button>
              }
            />
          ) : (
            <div className="grid gap-2.5">
              {data.sources.map((source) => (
                <div className="source-card" key={source.id}>
                  <div className="source-head">
                    <span className="source-icon">
                      <PlugZap size={12} />
                    </span>
                    <div className="source-name">
                      <strong>{source.label}</strong>
                      <span>
                        {sourceTypeLabel(source.type)} · {summarizeConfig(source.type, source.config)}
                      </span>
                    </div>
                    <span className={`pill ${source.enabled ? (source.lastStatus === 'error' ? 'pill-danger' : source.lastStatus === 'ok' ? 'pill-calm' : 'pill-neutral') : 'pill-neutral'}`}>
                      {source.enabled ? (source.lastStatus === 'error' ? '异常' : source.lastStatus === 'ok' ? '正常' : '未同步') : '已停用'}
                    </span>
                    <button
                      className={`switch ${source.enabled ? 'on' : ''}`}
                      role="switch"
                      aria-checked={source.enabled}
                      aria-label={`${source.enabled ? '停用' : '启用'} ${source.label}`}
                      onClick={() => void updateSourceEnabled(source.id, !source.enabled)}
                    />
                  </div>
                  <div className="source-meta">
                    <span>last sync · {relativeTime(source.lastSyncAt)}</span>
                    <span>items · {source.lastItemCount}</span>
                    {source.stale && <span className="text-[var(--high)]">数据已过期</span>}
                  </div>
                  {source.lastError && <div className="source-error">{source.lastError}</div>}
                  <div className="mt-2.5 flex items-center gap-2">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => void syncSource(source.id)}
                      disabled={!source.enabled || syncing !== null}
                    >
                      <RefreshCw size={11} className={syncing === source.id ? 'animate-spin' : ''} />
                      {syncing === source.id ? '采集中…' : '同步此源'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                      <Pencil size={11} /> 修改配置
                    </button>
                    {source.enabled && source.lastStatus === 'error' && (
                      <span className="text-[9px] text-[var(--muted-2)]">失败时保留上一次成功数据</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'logs' && (
        <div>
          {data.jobs.length === 0 ? (
            <EmptyState
              icon={RefreshCw}
              title="还没有采集任务"
              description="手动触发同步或等待定时任务后，这里会记录每个数据源的执行结果。"
            />
          ) : (
            <div className="data-list">
              <div className="jobs-table-head" aria-hidden="true">
                <span>Time</span>
                <span>Source</span>
                <span>Trigger</span>
                <span>Status</span>
                <span>Items</span>
                <span>Duration</span>
                <span>Error</span>
              </div>
              {data.jobs.map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
            </div>
          )}
        </div>
      )}

      <EditSoftwareDialog
        software={software}
        open={editing}
        onClose={() => setEditing(false)}
        onUpdated={() => {
          void refetch(true);
          void refresh(true);
        }}
      />

      <AdvisoryDrawer
        advisoryId={selectedAdvisory}
        onClose={() => setSelectedAdvisory(null)}
        onUpdated={() => void refetch(true)}
      />

      <Modal
        open={archiving}
        onClose={() => setArchiving(false)}
        eyebrow="Archive software"
        title={`归档 ${software.name}？`}
        description="归档后不再出现在首页和软件清单，但所有历史数据都会保留。"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setArchiving(false)}>
              取消
            </button>
            <button className="btn btn-danger" onClick={() => void archive()}>
              确认归档
            </button>
          </>
        }
      >
        <div className="form-note">当前没有界面入口恢复已归档软件。</div>
      </Modal>
    </div>
  );
}

function JobRow({ job }: { job: SyncJob }) {
  const duration =
    job.finishedAt && job.startedAt
      ? Math.max(0, Math.round((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000))
      : null;
  const triggerLabel = job.trigger === 'manual' ? '手动' : job.trigger === 'initial' ? '首次' : '定时';
  return (
    <div className="jobs-table-row">
      <span className="font-mono text-[9px] text-[var(--muted)]">{formatDateTime(job.startedAt)}</span>
      <span className="cell-main">
        <strong>{job.sourceLabel ?? sourceTypeLabel(job.sourceType ?? '')}</strong>
        <span>{job.sourceType ? sourceTypeLabel(job.sourceType) : '全部数据源'}</span>
      </span>
      <span className="cell-mono">{triggerLabel}</span>
      <span>
        <span className={`pill ${job.status === 'success' ? 'pill-calm' : job.status === 'error' ? 'pill-danger' : 'pill-note'}`}>
          {job.status === 'success' ? '成功' : job.status === 'error' ? '失败' : '运行中'}
        </span>
      </span>
      <span className="cell-mono">
        {job.itemsFound} / +{job.itemsNew}
      </span>
      <span className="cell-mono">{duration === null ? '—' : `${duration}s`}</span>
      <span className="truncate text-[9px] text-[var(--critical)]" title={job.error ?? ''}>
        {job.error ?? '—'}
      </span>
    </div>
  );
}
