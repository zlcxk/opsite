import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, ArrowUpRight, BellOff, CheckCheck, Filter, Siren } from 'lucide-react';
import type { EventType, IntelEvent, Priority, UserEventStatus } from '@shared/types';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { api } from '../lib/api';
import { useAppData } from '../contexts/AppDataContext';
import { useToast } from '../contexts/ToastContext';
import { relativeTime } from '../lib/format';
import { EmptyState, LoadingBlock, PageHeader } from '../components/ui';

const typeMeta: Record<EventType, string> = {
  vulnerability: '安全漏洞',
  release: '版本发布',
  lifecycle: '生命周期',
  source_issue: '采集异常',
};

const statusMeta: Record<UserEventStatus, string> = {
  new: '新发现',
  acknowledged: '已确认',
  resolved: '已解决',
  ignored: '已忽略',
};

type StatusFilter = 'all' | 'unread' | UserEventStatus;
type RangeFilter = 'all' | '24h' | '7d' | '30d';

const rangeHours: Record<RangeFilter, number | null> = {
  all: null,
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
};

export function Events() {
  useDocumentTitle('情报事件');
  const { data, loading, error, refetch } = useApi<IntelEvent[]>('/events?limit=200');
  const { data: appData, refresh } = useAppData();
  const { push } = useToast();
  const navigate = useNavigate();
  const [type, setType] = useState<'all' | EventType>('all');
  const [priority, setPriority] = useState<'all' | Priority>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [softwareId, setSoftwareId] = useState('all');
  const [range, setRange] = useState<RangeFilter>('all');
  const [query, setQuery] = useState('');

  const events = data ?? [];
  const software = appData?.software ?? [];

  const counts = useMemo(
    () => ({
      unread: events.filter((event) => !event.readAt).length,
      urgent: events.filter(
        (event) => (event.priority === 'P0' || event.priority === 'P1') && event.status !== 'resolved',
      ).length,
      today: events.filter((event) => Date.now() - new Date(event.firstSeenAt).getTime() < 86_400_000).length,
    }),
    [events],
  );

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    const cutoff = rangeHours[range] ? Date.now() - rangeHours[range]! * 3_600_000 : null;
    return events.filter((event) => {
      if (type !== 'all' && event.type !== type) return false;
      if (priority !== 'all' && event.priority !== priority) return false;
      if (softwareId !== 'all' && event.softwareId !== softwareId) return false;
      if (status === 'unread' && event.readAt) return false;
      if (status !== 'all' && status !== 'unread' && event.status !== status) return false;
      if (cutoff && new Date(event.firstSeenAt).getTime() < cutoff) return false;
      if (!search) return true;
      return (
        event.title.toLowerCase().includes(search) ||
        event.softwareName.toLowerCase().includes(search) ||
        (event.summary ?? '').toLowerCase().includes(search)
      );
    });
  }, [events, type, priority, softwareId, status, range, query]);

  const openEvent = async (event: IntelEvent) => {
    if (!event.readAt) {
      try {
        await api.patch(`/events/${event.id}/read`, {});
        void refresh(true);
      } catch {
        // navigation should not be blocked by read-state failures
      }
    }
    const tab =
      event.type === 'vulnerability' ? 'vulnerabilities' : event.type === 'release' ? 'releases' : 'lifecycle';
    navigate(`/software/${event.softwareId}?tab=${tab}`);
  };

  const updateStatus = async (event: IntelEvent, next: UserEventStatus) => {
    try {
      await api.patch(`/events/${event.id}/status`, { status: next });
      push(`${event.title} 已标记为${statusMeta[next]}`);
      await refetch(true);
      await refresh(true);
    } catch (updateError) {
      push(updateError instanceof Error ? updateError.message : '更新失败', 'error');
    }
  };

  const markAllRead = async () => {
    try {
      await api.post('/events/read-all');
      push('已将全部情报标记为已读');
      await refetch(true);
      await refresh(true);
    } catch (markError) {
      push(markError instanceof Error ? markError.message : '操作失败', 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Event center · first seen, then upstream"
        title="情报事件"
        subtitle="同一份信号只保留一条主事件；首次发现时间与上游发布时间分开记录。"
        actions={
          <button className="btn btn-secondary" onClick={() => void markAllRead()} disabled={counts.unread === 0}>
            <CheckCheck size={14} /> 全部已读
          </button>
        }
      />

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">
            <BellOff size={10} /> 未读事件
          </span>
          <span className="stat-value">{counts.unread}</span>
          <div className="stat-foot">点击事件后自动标记为已读</div>
        </div>
        <div className="stat-card">
          <span className="stat-label">
            <Siren size={10} /> P0 / P1 待处理
          </span>
          <span className="stat-value">{counts.urgent}</span>
          <div className="stat-foot">按当前处置状态统计</div>
        </div>
        <div className="stat-card">
          <span className="stat-label">
            <Activity size={10} /> 近 24 小时新增
          </span>
          <span className="stat-value">{counts.today}</span>
          <div className="stat-foot">以首次发现时间为准</div>
        </div>
      </div>

      <div className="filter-bar mt-5">
        <div className="filter-chips">
          <button className={`chip ${status === 'all' ? 'active' : ''}`} onClick={() => setStatus('all')}>
            全部
          </button>
          <button className={`chip ${status === 'unread' ? 'active' : ''}`} onClick={() => setStatus('unread')}>
            仅未读
          </button>
          {(Object.keys(statusMeta) as UserEventStatus[]).map((value) => (
            <button
              key={value}
              className={`chip ${status === value ? 'active' : ''}`}
              onClick={() => setStatus(value)}
            >
              {statusMeta[value]}
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
            placeholder="事件标题、软件、摘要"
            aria-label="搜索事件"
          />
        </div>
        <select
          className="filter-select"
          value={type}
          onChange={(event) => setType(event.target.value as typeof type)}
          aria-label="按事件类型筛选"
        >
          <option value="all">全部类型</option>
          {(Object.keys(typeMeta) as EventType[]).map((value) => (
            <option key={value} value={value}>
              {typeMeta[value]}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          value={priority}
          onChange={(event) => setPriority(event.target.value as typeof priority)}
          aria-label="按优先级筛选"
        >
          <option value="all">全部优先级</option>
          {(['P0', 'P1', 'P2', 'P3'] as Priority[]).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
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
          value={range}
          onChange={(event) => setRange(event.target.value as RangeFilter)}
          aria-label="按时间范围筛选"
        >
          <option value="all">全部时间</option>
          <option value="24h">近 24 小时</option>
          <option value="7d">近 7 天</option>
          <option value="30d">近 30 天</option>
        </select>
      </div>

      {error && <div className="error-note mb-3">{error}</div>}

      {loading && !data ? (
        <LoadingBlock />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Filter}
          title={events.length ? '没有符合条件的事件' : '还没有情报事件'}
          description={
            events.length
              ? '调整类型、优先级、状态或时间范围。'
              : '添加软件并完成首次采集后，版本、生命周期和漏洞变化会以去重后的事件出现。'
          }
        />
      ) : (
        <div className="data-list event-center">
          <div className="event-center-head" aria-hidden="true">
            <span>级别</span>
            <span>事件</span>
            <span>软件 / 来源</span>
            <span>时间</span>
            <span>处置状态</span>
            <span />
          </div>
          {filtered.map((event) => (
            <div
              className={`event-center-row ${event.readAt ? '' : 'unread'}`}
              key={event.id}
              role="button"
              tabIndex={0}
              onClick={() => void openEvent(event)}
              onKeyDown={(keyboardEvent) => {
                if (keyboardEvent.key === 'Enter') void openEvent(event);
              }}
            >
              <span className={`event-priority ${event.priority.toLowerCase()}`}>{event.priority}</span>
              <div className="event-center-main">
                <strong>{event.title}</strong>
                <div className="event-center-sub">
                  <span className="event-type">{typeMeta[event.type]}</span>
                  {event.summary && <span className="event-summary">{event.summary}</span>}
                </div>
              </div>
              <div className="event-center-owner">
                <strong>{event.softwareName}</strong>
                <span>{event.sourceName ?? 'Opsite'}</span>
              </div>
              <div className="event-center-time">
                <span>
                  首次发现 <strong>{relativeTime(event.firstSeenAt)}</strong>
                </span>
                <span>
                  上游发布{' '}
                  <strong>{event.upstreamPublishedAt ? relativeTime(event.upstreamPublishedAt) : '未提供'}</strong>
                </span>
              </div>
              <div className="event-center-status" onClick={(clickEvent) => clickEvent.stopPropagation()}>
                <select
                  className="status-select w-full"
                  value={event.status}
                  onChange={(selectEvent) => void updateStatus(event, selectEvent.target.value as UserEventStatus)}
                  aria-label={`${event.title} 处置状态`}
                >
                  {(Object.keys(statusMeta) as UserEventStatus[]).map((value) => (
                    <option key={value} value={value}>
                      {statusMeta[value]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="event-center-tail">
                {!event.readAt && <span className="unread-dot" />}
                {event.sourceUrl ? (
                  <a
                    href={event.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="event-source-link"
                    aria-label="打开上游来源"
                    onClick={(clickEvent) => clickEvent.stopPropagation()}
                  >
                    <ArrowUpRight size={13} />
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[9px] text-[var(--muted-2)]">
        <span>共 {filtered.length} 条事件 · 同一漏洞的多来源信息合并为一个主事件</span>
        <span>事件状态与上游公告更新相互独立</span>
      </div>
    </div>
  );
}
