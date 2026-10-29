import { useMemo, useState } from 'react';
import { ChevronRight, Flame, ShieldAlert, ShieldCheck, Siren } from 'lucide-react';
import type { Advisory, AdvisoryStatus, Priority } from '@shared/types';
import { useApi } from '../lib/hooks';
import { api } from '../lib/api';
import { useAppData } from '../contexts/AppDataContext';
import { useToast } from '../contexts/ToastContext';
import {
  advisoryStatusMeta,
  formatDate,
  impactMeta,
  priorityMeta,
  severityMeta,
} from '../lib/format';
import { PageHeader, EmptyState, LoadingBlock } from '../components/ui';
import { AdvisoryDrawer } from '../components/AdvisoryDrawer';
import { useDocumentTitle } from '../lib/hooks';

const priorities: Array<Priority | 'all'> = ['all', 'P0', 'P1', 'P2', 'P3'];
const resolvedStatuses: AdvisoryStatus[] = ['fixed', 'not_affected', 'ignored'];

export function Vulnerabilities() {
  useDocumentTitle('漏洞与修复');
  const { data: appData } = useAppData();
  const { data, loading, error, refetch } = useApi<Advisory[]>('/advisories?limit=300');
  const { push } = useToast();
  const [priority, setPriority] = useState<Priority | 'all'>('all');
  const [status, setStatus] = useState<'open' | 'all' | AdvisoryStatus>('open');
  const [softwareId, setSoftwareId] = useState('all');
  const [query, setQuery] = useState('');
  const [kevOnly, setKevOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const advisories = data ?? [];
  const software = appData?.software ?? [];

  const counts = useMemo(() => {
    const open = advisories.filter((item) => !resolvedStatuses.includes(item.status));
    return {
      open: open.length,
      p0: open.filter((item) => item.priority === 'P0').length,
      p1: open.filter((item) => item.priority === 'P1').length,
      kev: open.filter((item) => item.kev).length,
      affected: open.filter((item) => item.versionImpact === 'affected').length,
      insufficient: open.filter((item) => item.versionImpact === 'insufficient').length,
    };
  }, [advisories]);

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return advisories
      .filter((item) => {
        if (status === 'open' && resolvedStatuses.includes(item.status)) return false;
        if (status !== 'open' && status !== 'all' && item.status !== status) return false;
        if (priority !== 'all' && item.priority !== priority) return false;
        if (softwareId !== 'all' && item.softwareId !== softwareId) return false;
        if (kevOnly && !item.kev) return false;
        if (!search) return true;
        return (
          item.identifier.toLowerCase().includes(search) ||
          item.title.toLowerCase().includes(search) ||
          (item.softwareName ?? '').toLowerCase().includes(search)
        );
      })
      .sort((a, b) => {
        const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
        return rank[a.priority] - rank[b.priority];
      });
  }, [advisories, status, priority, softwareId, kevOnly, query]);

  const updateStatus = async (advisory: Advisory, next: AdvisoryStatus) => {
    try {
      await api.patch(`/advisories/${advisory.id}/status`, { status: next });
      push(`${advisory.identifier} 的处置状态已更新`);
      await refetch(true);
    } catch (updateError) {
      push(updateError instanceof Error ? updateError.message : '更新失败', 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Advisories · evidence over noise"
        title="漏洞与修复"
        subtitle="严重程度、实际利用和本地版本影响分开判断；处置状态只由你维护。"
      />

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">
            <ShieldAlert size={10} /> 待处理漏洞
          </span>
          <span className="stat-value">{counts.open}</span>
          <div className="stat-foot">不包含已修复、已忽略与确认不受影响</div>
        </div>
        <div className="stat-card">
          <span className="stat-label">
            <Siren size={10} /> 需要立即处理
          </span>
          <span className="stat-value">{counts.p0}</span>
          <div className="stat-foot">{counts.p1} 项 P1 高危待跟进</div>
        </div>
        <div className="stat-card">
          <span className="stat-label">
            <Flame size={10} /> 已遭实际利用
          </span>
          <span className="stat-value">{counts.kev}</span>
          <div className="stat-foot">CISA KEV 交叉标记</div>
        </div>
        <div className="stat-card">
          <span className="stat-label">
            <ShieldCheck size={10} /> 本地版本判断
          </span>
          <span className="stat-value">
            {counts.affected}
            <small>受影响</small>
          </span>
          <div className="stat-foot">{counts.insufficient} 项版本信息不足，需人工确认</div>
        </div>
      </div>

      <div className="filter-bar mt-5">
        <div className="filter-chips">
          {priorities.map((value) => (
            <button
              key={value}
              className={`chip ${priority === value ? 'active' : ''}`}
              onClick={() => setPriority(value)}
            >
              {value === 'all' ? '全部优先级' : `${value}${value === 'P0' ? ' 已利用' : ''}`}
            </button>
          ))}
          <button className={`chip ${kevOnly ? 'active' : ''}`} onClick={() => setKevOnly((value) => !value)}>
            <Flame size={10} /> 仅 KEV
          </button>
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
            placeholder="CVE / GHSA / 标题"
            aria-label="搜索漏洞"
          />
        </div>
        <select
          className="filter-select"
          value={softwareId}
          onChange={(event) => setSoftwareId(event.target.value)}
          aria-label="按软件筛选"
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
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
          aria-label="按处置状态筛选"
        >
          <option value="open">待处理</option>
          <option value="all">全部状态</option>
          {(Object.keys(advisoryStatusMeta) as AdvisoryStatus[]).map((value) => (
            <option key={value} value={value}>
              {advisoryStatusMeta[value]}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="error-note mb-3">{error}</div>}

      {loading && !data ? (
        <LoadingBlock />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={advisories.length ? '没有符合条件的漏洞' : '还没有采集到漏洞情报'}
          description={
            advisories.length
              ? '调整筛选条件。P3 公告默认也会采集，可通过优先级筛选查看。'
              : '为软件启用 GitHub Advisory 和 NVD 数据源后，下一次采集会把公告关联到本地版本。'
          }
        />
      ) : (
        <div className="data-list">
          <div className="advisory-table-head" aria-hidden="true">
            <span className="advisory-col-id">Advisory</span>
            <span>Title</span>
            <span className="advisory-col-severity">Severity</span>
            <span>Version impact</span>
            <span>My status</span>
            <span />
          </div>
          {filtered.map((advisory) => {
            const severity = severityMeta[advisory.severity];
            const impact = impactMeta[advisory.versionImpact];
            return (
              <div
                className="advisory-table-row"
                key={advisory.id}
                onClick={() => setSelected(advisory.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setSelected(advisory.id);
                }}
              >
                <div className="advisory-cell-id advisory-col-id">
                  <strong>{advisory.identifier}</strong>
                  <span>{priorityMeta[advisory.priority].short}</span>
                </div>
                <div className="cell-main">
                  <strong>{advisory.title}</strong>
                  <div className="vuln-sub">
                    <span>{advisory.softwareName}</span>
                    <span>·</span>
                    <span>发布 {formatDate(advisory.publishedAt)}</span>
                    {advisory.kev && <span className="kev-badge">KEV 已利用</span>}
                  </div>
                </div>
                <div className="advisory-col-severity">
                  <span className={`pill pill-${severity.className}`}>{severity.label}</span>
                  {advisory.score !== null && (
                    <span className="mt-1 block font-mono text-[8.5px] text-[var(--muted-2)]">
                      CVSS {advisory.score}
                    </span>
                  )}
                </div>
                <div>
                  <span className={`pill pill-${impact.className}`}>{impact.label}</span>
                  {advisory.fixedVersions.length > 0 && (
                    <span className="mt-1 block font-mono text-[8.5px] text-[var(--muted-2)]">
                      修复 {advisory.fixedVersions[0]}
                    </span>
                  )}
                </div>
                <div onClick={(event) => event.stopPropagation()}>
                  <select
                    className="status-select w-full"
                    value={advisory.status}
                    onChange={(event) => void updateStatus(advisory, event.target.value as AdvisoryStatus)}
                    aria-label={`${advisory.identifier} 处置状态`}
                  >
                    {(Object.keys(advisoryStatusMeta) as AdvisoryStatus[]).map((value) => (
                      <option key={value} value={value}>
                        {advisoryStatusMeta[value]}
                      </option>
                    ))}
                  </select>
                </div>
                <ChevronRight size={14} className="text-[var(--muted-2)]" />
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[9px] text-[var(--muted-2)]">
        <span>共 {filtered.length} 条记录 · 优先级由严重程度、KEV 状态和本地版本影响共同决定</span>
        <span>处置状态与上游公告更新相互独立</span>
      </div>

      <AdvisoryDrawer
        advisoryId={selected}
        onClose={() => setSelected(null)}
        onUpdated={() => void refetch(true)}
      />
    </div>
  );
}
