import { useNavigate } from 'react-router-dom';
import type { IntelEvent } from '@shared/types';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';
import { useAppData } from '../contexts/AppDataContext';

export function EventRow({ event, compact = false }: { event: IntelEvent; compact?: boolean }) {
  const navigate = useNavigate();
  const { refresh } = useAppData();

  const open = async () => {
    const tab =
      event.type === 'vulnerability' ? 'vulnerabilities' : event.type === 'release' ? 'releases' : 'lifecycle';
    if (!event.readAt) {
      try {
        await api.patch(`/events/${event.id}/read`, {});
        void refresh(true);
      } catch {
        // ignore; navigation should not be blocked by read-state failures
      }
    }
    navigate(`/software/${event.softwareId}?tab=${tab}`);
  };

  return (
    <button className="event-row w-full text-left" onClick={() => void open()}>
      <span className={`event-priority ${event.priority.toLowerCase()}`}>{event.priority}</span>
      <span className="event-main">
        <span className="event-title">{event.title}</span>
        <span className="event-meta">
          <span className="software">{event.softwareName}</span>
          <span>{event.sourceName ?? 'Opsite'}</span>
          {!compact && event.upstreamPublishedAt && (
            <span>上游 {relativeTime(event.upstreamPublishedAt)}</span>
          )}
        </span>
      </span>
      {!event.readAt && <span className="unread-dot" />}
      <span className="event-time">{relativeTime(event.firstSeenAt)}</span>
    </button>
  );
}
