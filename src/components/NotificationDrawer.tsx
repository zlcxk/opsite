import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, BellOff, CheckCheck, X } from 'lucide-react';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';
import { useAppData } from '../contexts/AppDataContext';
import { useToast } from '../contexts/ToastContext';

interface NotificationDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function NotificationDrawer({ open, onClose }: NotificationDrawerProps) {
  const { data, refresh } = useAppData();
  const { push } = useToast();
  const navigate = useNavigate();

  if (!open) return null;

  const events = data?.events ?? [];
  const unread = data?.briefing.unread ?? 0;

  const openEvent = async (eventId: string, softwareId: string, type: string) => {
    try {
      await api.patch(`/events/${eventId}/read`, {});
      await refresh(true);
    } catch {
      // navigation is still useful even if marking read fails
    }
    onClose();
    const tab = type === 'vulnerability' ? 'vulnerabilities' : type === 'release' ? 'releases' : 'lifecycle';
    navigate(`/software/${softwareId}?tab=${tab}`);
  };

  const markAll = async () => {
    try {
      await api.post('/events/read-all');
      await refresh(true);
      push('已将全部情报标记为已读');
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
            <div className="eyebrow">Notification feed</div>
            <h2 className="mt-2">通知</h2>
            <p>{unread > 0 ? `${unread} 条未读情报` : '所有情报均已阅读'}</p>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="关闭通知">
            <X size={17} />
          </button>
        </div>
        <div className="drawer-body">
          {events.length === 0 ? (
            <div className="empty-state" style={{ minHeight: 260 }}>
              <span className="empty-mark">
                <BellOff size={17} />
              </span>
              <h3>暂无通知</h3>
              <p>当关注的软件出现漏洞、版本变化或生命周期状态变化时，情报会出现在这里。</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {events.map((event) => (
                <button
                  key={event.id}
                  className="event-row"
                  style={{ border: '1px solid #edf0ea', borderRadius: 10, marginBottom: 6 }}
                  onClick={() => openEvent(event.id, event.softwareId, event.type)}
                >
                  <span className={`event-priority ${event.priority.toLowerCase()}`}>{event.priority}</span>
                  <span className="event-main">
                    <span className="event-title">{event.title}</span>
                    <span className="event-meta">
                      <span className="software">{event.softwareName}</span>
                      <span>{event.sourceName ?? 'Opsite'}</span>
                      <span>{relativeTime(event.firstSeenAt)}</span>
                    </span>
                  </span>
                  {!event.readAt && <span className="unread-dot" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="drawer-foot">
          <button
            className="text-link"
            onClick={() => {
              onClose();
              navigate('/events');
            }}
          >
            事件中心 <ArrowUpRight size={11} />
          </button>
          <div className="ml-auto flex items-center gap-2">
            <span className="mono text-[9px] text-[var(--muted-2)]">{events.length} 条最近情报</span>
            <button className="btn btn-secondary btn-sm" onClick={markAll} disabled={unread === 0}>
              <CheckCheck size={13} /> 全部已读
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
