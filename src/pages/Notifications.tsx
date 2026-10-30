import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  Bell,
  CheckCheck,
  Filter,
  Mail,
  MailWarning,
  Settings2,
  Siren,
} from 'lucide-react';
import type {
  NotificationItem,
  NotificationListResponse,
  NotificationRuleType,
  NotificationSeverity,
} from '@shared/types';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { api } from '../lib/api';
import { useAppData } from '../contexts/AppDataContext';
import { useToast } from '../contexts/ToastContext';
import { relativeTime } from '../lib/format';
import {
  deliveryStatusMeta,
  notificationRuleMeta,
  notificationRuleOrder,
  notificationSeverityMeta,
  targetTypeMeta,
} from '../lib/notification-labels';
import { EmptyState, LoadingBlock, PageHeader } from '../components/ui';

export function Notifications() {
  useDocumentTitle('通知中心');
  const { data, loading, error, refetch } = useApi<NotificationListResponse>(
    '/notifications?limit=100',
    30_000,
  );
  const { refresh } = useAppData();
  const { push } = useToast();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'all' | 'unread'>('all');
  const [severity, setSeverity] = useState<'all' | NotificationSeverity>('all');
  const [ruleType, setRuleType] = useState<'all' | NotificationRuleType>('all');
  const [query, setQuery] = useState('');
  const [marking, setMarking] = useState(false);

  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const unread = data?.unread ?? 0;

  const stats = useMemo(
    () => ({
      urgent: items.filter((item) => item.severity === 'urgent' && !item.readAt).length,
      emailPending: items.filter(
        (item) => item.emailStatus === 'pending' || item.emailStatus === 'sending',
      ).length,
      emailFailed: items.filter((item) => item.emailStatus === 'failed').length,
    }),
    [items],
  );

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return items.filter((item) => {
      if (status === 'unread' && item.readAt) return false;
      if (severity !== 'all' && item.severity !== severity) return false;
      if (ruleType !== 'all' && item.ruleType !== ruleType) return false;
      if (!search) return true;
      return (
        item.title.toLowerCase().includes(search) ||
        item.targetName.toLowerCase().includes(search) ||
        (item.body ?? '').toLowerCase().includes(search)
      );
    });
  }, [items, status, severity, ruleType, query]);

  const markRead = async (item: NotificationItem) => {
    if (item.readAt) return;
    try {
      await api.patch(`/notifications/${item.id}`, { read: true });
      await Promise.all([refetch(true), refresh(true)]);
    } catch {
      // Opening the target is still useful if read state fails.
    }
  };

  const open = async (item: NotificationItem) => {
    await markRead(item);
    if (item.link) navigate(item.link);
  };

  const markAll = async () => {
    setMarking(true);
    try {
      await api.post('/notifications/read-all');
      push('已将全部通知标记为已读');
      await Promise.all([refetch(true), refresh(true)]);
    } catch (markError) {
      push(markError instanceof Error ? markError.message : '操作失败', 'error');
    } finally {
      setMarking(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Notification center · follow what matters"
        title="通知中心"
        subtitle="站内通知先落库，邮件在后台独立发送。重复采集不会产生重复提醒。"
        actions={
          <>
            <Link className="btn btn-secondary" to="/follows">
              <Settings2 size={13} /> 关注与订阅
            </Link>
            <button className="btn btn-secondary" onClick={() => void markAll()} disabled={unread === 0 || marking}>
              <CheckCheck size={14} /> 全部已读
            </button>
          </>
        }
      />

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">
            <Bell size={10} /> 未读通知
          </span>
          <span className="stat-value">{unread}</span>
          <div className="stat-foot">点击通知后自动标记为已读</div>
        </div>
        <div className="stat-card">
          <span className="stat-label">
            <Siren size={10} /> 紧急未读
          </span>
          <span className="stat-value">{stats.urgent}</span>
          <div className="stat-foot">P0 / 已确认实际利用的高风险信号</div>
        </div>
        <div className="stat-card">
          <span className="stat-label">
            <MailWarning size={10} /> 邮件投递
          </span>
          <span className="stat-value">
            {stats.emailPending + stats.emailFailed}
            <small>条</small>
          </span>
          <div className="stat-foot">
            {stats.emailFailed > 0 ? `${stats.emailFailed} 条发送失败，可在设置中重试` : '待发送或发送中'}
          </div>
        </div>
      </div>

      <div className="filter-bar mt-5">
        <div className="filter-chips">
          <button className={`chip ${status === 'all' ? 'active' : ''}`} onClick={() => setStatus('all')}>
            全部
          </button>
          <button
            className={`chip ${status === 'unread' ? 'active' : ''}`}
            onClick={() => setStatus('unread')}
          >
            仅未读
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
            placeholder="标题、对象、正文"
            aria-label="搜索通知"
          />
        </div>
        <select
          className="filter-select"
          value={severity}
          onChange={(event) => setSeverity(event.target.value as typeof severity)}
          aria-label="按级别筛选"
        >
          <option value="all">全部级别</option>
          <option value="urgent">紧急</option>
          <option value="important">重要</option>
          <option value="normal">普通</option>
        </select>
        <select
          className="filter-select"
          value={ruleType}
          onChange={(event) => setRuleType(event.target.value as typeof ruleType)}
          aria-label="按事件类型筛选"
        >
          <option value="all">全部类型</option>
          {notificationRuleOrder.map((type) => (
            <option key={type} value={type}>
              {notificationRuleMeta[type].label}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="error-note mb-3">{error}</div>}

      {loading && !data ? (
        <LoadingBlock />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Filter}
          title={items.length ? '没有符合条件的通知' : '还没有通知'}
          description={
            items.length
              ? '调整未读状态、级别或事件类型。'
              : '关注软件、雷达条目或技术发现流后，新变化会按订阅规则出现在这里。'
          }
          actions={
            <Link to="/follows" className="btn btn-primary">
              去设置关注
            </Link>
          }
        />
      ) : (
        <div className="notification-list">
          {filtered.map((item) => {
            const severityMeta = notificationSeverityMeta[item.severity];
            const rule = notificationRuleMeta[item.ruleType];
            const target = targetTypeMeta[item.targetType];
            const delivery = item.emailStatus ? deliveryStatusMeta[item.emailStatus] : null;
            return (
              <article
                key={item.id}
                className={`notification-row ${item.readAt ? '' : 'unread'}`}
                onClick={() => void open(item)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void open(item);
                }}
              >
                <div className={`notification-severity ${severityMeta.className}`}>
                  <span>{severityMeta.label}</span>
                  <i />
                </div>
                <div className="notification-main">
                  <div className="notification-title-row">
                    <strong>{item.title}</strong>
                    {!item.readAt && <span className="unread-dot" />}
                  </div>
                  {item.body && <p>{item.body}</p>}
                  <div className="notification-meta">
                    <span className="rule-code mono">{rule.code}</span>
                    <span>{target.label}</span>
                    <span className="notification-target">{item.targetName}</span>
                    <span>{relativeTime(item.createdAt)}</span>
                    {item.sourceName && <span>{item.sourceName}</span>}
                  </div>
                </div>
                <div className="notification-tail">
                  {delivery && (
                    <span className={`pill pill-${delivery.className} notification-mail`}>
                      <Mail size={9} /> {delivery.label}
                    </span>
                  )}
                  {item.sourceUrl && (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="event-source-link"
                      aria-label="打开上游来源"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <ArrowUpRight size={13} />
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[0.6875rem] text-[var(--muted-2)]">
        <span>
          共 {data?.total ?? 0} 条通知 · 当前展示 {filtered.length} 条
        </span>
        <span>取消关注不会删除已有通知和历史情报</span>
      </div>
    </div>
  );
}
