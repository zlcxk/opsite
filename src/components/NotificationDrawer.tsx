import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, BellOff, CheckCheck, X } from 'lucide-react';
import type { NotificationItem, NotificationListResponse } from '@shared/types';
import { useApi } from '../lib/hooks';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';
import { useAppData } from '../contexts/AppDataContext';
import { useToast } from '../contexts/ToastContext';
import {
  notificationRuleMeta,
  notificationSeverityMeta,
  targetTypeMeta,
} from '../lib/notification-labels';

interface NotificationDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function NotificationDrawer({ open, onClose }: NotificationDrawerProps) {
  const { refresh } = useAppData();
  const { push } = useToast();
  const navigate = useNavigate();
  const { data, loading, refetch } = useApi<NotificationListResponse>(
    open ? '/notifications?limit=8' : null,
  );

  if (!open) return null;

  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  const openItem = async (item: NotificationItem) => {
    if (!item.readAt) {
      try {
        await api.patch(`/notifications/${item.id}`, { read: true });
        await refetch(true);
        void refresh(true);
      } catch {
        // navigation is still useful even if marking read fails
      }
    }
    onClose();
    if (item.link) navigate(item.link);
  };

  const markAll = async () => {
    try {
      await api.post('/notifications/read-all');
      await refetch(true);
      await refresh(true);
      push('已将全部通知标记为已读');
    } catch (error) {
      push(error instanceof Error ? error.message : '操作失败', 'error');
    }
  };

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="通知中心">
        <div className="drawer-head">
          <div>
            <div className="eyebrow">Notification center</div>
            <h2 className="mt-2">通知</h2>
            <p>{unread > 0 ? `${unread} 条未读通知` : '所有通知均已阅读'}</p>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="关闭通知">
            <X size={17} />
          </button>
        </div>
        <div className="drawer-body">
          {loading && !data ? (
            <div className="loading-block" style={{ minHeight: 220 }} />
          ) : items.length === 0 ? (
            <div className="empty-state" style={{ minHeight: 260 }}>
              <span className="empty-mark">
                <BellOff size={17} />
              </span>
              <h3>暂无通知</h3>
              <p>关注软件或雷达条目后，符合订阅规则的变化会出现在这里。</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {items.map((item) => {
                const severity = notificationSeverityMeta[item.severity];
                return (
                  <button
                    key={item.id}
                    className={`event-row notification-drawer-row ${item.readAt ? '' : 'unread'}`}
                    onClick={() => void openItem(item)}
                  >
                    <span className={`notification-severity ${severity.className}`}>
                      <span>{severity.label}</span>
                      <i />
                    </span>
                    <span className="event-main">
                      <span className="event-title">{item.title}</span>
                      <span className="event-meta">
                        <span className="software">{item.targetName}</span>
                        <span>{targetTypeMeta[item.targetType].label}</span>
                        <span>{notificationRuleMeta[item.ruleType].label}</span>
                        <span>{relativeTime(item.createdAt)}</span>
                      </span>
                    </span>
                    {!item.readAt && <span className="unread-dot" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="drawer-foot">
          <button
            className="text-link"
            onClick={() => {
              onClose();
              navigate('/notifications');
            }}
          >
            通知中心 <ArrowUpRight size={11} />
          </button>
          <div className="ml-auto flex items-center gap-2">
            <span className="mono text-[0.6875rem] text-[var(--muted-2)]">{items.length} 条最近通知</span>
            <button className="btn btn-secondary btn-sm" onClick={() => void markAll()} disabled={unread === 0}>
              <CheckCheck size={13} /> 全部已读
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
