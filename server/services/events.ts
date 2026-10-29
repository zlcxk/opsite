import type { EventType, IntelEvent, Priority, UserEventStatus } from '../../shared/types.js';
import { db, nowIso } from '../db.js';

export interface EventInput {
  type: EventType;
  softwareId: string;
  refId?: string | null;
  title: string;
  summary?: string | null;
  priority: Priority;
  sourceName?: string | null;
  sourceUrl?: string | null;
  upstreamPublishedAt?: string | null;
  dedupeKey: string;
}

export function upsertEvent(input: EventInput): { id: string; created: boolean } {
  const existing = db
    .prepare('SELECT id FROM intelligence_event WHERE dedupe_key = ?')
    .get(input.dedupeKey) as { id: string } | undefined;
  const timestamp = nowIso();

  if (existing) {
    db.prepare(
      `UPDATE intelligence_event
       SET priority = ?, title = ?, summary = COALESCE(?, summary),
           source_name = COALESCE(?, source_name), source_url = COALESCE(?, source_url),
           upstream_published_at = COALESCE(?, upstream_published_at), ref_id = COALESCE(?, ref_id)
       WHERE id = ?`,
    ).run(
      input.priority,
      input.title,
      input.summary ?? null,
      input.sourceName ?? null,
      input.sourceUrl ?? null,
      input.upstreamPublishedAt ?? null,
      input.refId ?? null,
      existing.id,
    );
    return { id: existing.id, created: false };
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO intelligence_event
      (id, type, software_id, ref_id, title, summary, priority, source_name, source_url,
       first_seen_at, upstream_published_at, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.type,
    input.softwareId,
    input.refId ?? null,
    input.title,
    input.summary ?? null,
    input.priority,
    input.sourceName ?? null,
    input.sourceUrl ?? null,
    timestamp,
    input.upstreamPublishedAt ?? null,
    input.dedupeKey,
    timestamp,
  );
  db.prepare(
    `INSERT INTO user_event_state (event_id, read_at, status, updated_at)
     VALUES (?, NULL, 'new', ?) ON CONFLICT(event_id) DO NOTHING`,
  ).run(id, timestamp);
  return { id, created: true };
}

export function updateEventPriority(refId: string, priority: Priority): void {
  db.prepare('UPDATE intelligence_event SET priority = ? WHERE ref_id = ? AND type = ?').run(
    priority,
    refId,
    'vulnerability',
  );
}

interface EventRow {
  id: string;
  type: EventType;
  software_id: string;
  software_name: string;
  software_logo_url: string | null;
  category: string;
  title: string;
  summary: string | null;
  priority: Priority;
  source_name: string | null;
  source_url: string | null;
  first_seen_at: string;
  upstream_published_at: string | null;
  read_at: string | null;
  status: UserEventStatus;
  ref_id: string | null;
}

const EVENT_SELECT = `
  SELECT e.id, e.type, e.software_id, s.name AS software_name, s.logo_url AS software_logo_url,
         s.category, e.title, e.summary, e.priority, e.source_name, e.source_url,
         e.first_seen_at, e.upstream_published_at, u.read_at,
         COALESCE(u.status, 'new') AS status, e.ref_id
  FROM intelligence_event e
  JOIN software s ON s.id = e.software_id
  LEFT JOIN user_event_state u ON u.event_id = e.id
  WHERE s.deleted_at IS NULL
`;

function mapEvent(row: EventRow): IntelEvent {
  return {
    id: row.id,
    type: row.type,
    softwareId: row.software_id,
    softwareName: row.software_name,
    softwareLogoUrl: row.software_logo_url,
    category: row.category,
    title: row.title,
    summary: row.summary,
    priority: row.priority,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    firstSeenAt: row.first_seen_at,
    upstreamPublishedAt: row.upstream_published_at,
    readAt: row.read_at,
    status: row.status,
    refId: row.ref_id,
  };
}

export function listEvents(options: {
  softwareId?: string;
  type?: string;
  priority?: string;
  status?: string;
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
} = {}): IntelEvent[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.softwareId) {
    clauses.push('e.software_id = ?');
    params.push(options.softwareId);
  }
  if (options.type) {
    clauses.push('e.type = ?');
    params.push(options.type);
  }
  if (options.priority) {
    clauses.push('e.priority = ?');
    params.push(options.priority);
  }
  if (options.status) {
    clauses.push("COALESCE(u.status, 'new') = ?");
    params.push(options.status);
  }
  if (options.unreadOnly) clauses.push('u.read_at IS NULL');
  const where = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
  const limit = Math.min(options.limit ?? 50, 200);
  const offset = options.offset ?? 0;

  const rows = db
    .prepare(
      `${EVENT_SELECT}${where}
       ORDER BY CASE e.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
                e.first_seen_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as EventRow[];
  return rows.map(mapEvent);
}

export function searchEvents(term: string, limit = 6): IntelEvent[] {
  const like = `%${term.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
  const rows = db
    .prepare(
      `${EVENT_SELECT} AND (e.title LIKE ? ESCAPE '\\' OR e.summary LIKE ? ESCAPE '\\')
       ORDER BY CASE e.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
                e.first_seen_at DESC
       LIMIT ?`,
    )
    .all(like, like, limit) as EventRow[];
  return rows.map(mapEvent);
}

export function getEvent(id: string): IntelEvent | null {
  const row = db.prepare(`${EVENT_SELECT} AND e.id = ?`).get(id) as EventRow | undefined;
  return row ? mapEvent(row) : null;
}

export function markEventRead(id: string): void {
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO user_event_state (event_id, read_at, status, updated_at)
     VALUES (?, ?, 'acknowledged', ?)
     ON CONFLICT(event_id) DO UPDATE SET read_at = COALESCE(user_event_state.read_at, excluded.read_at),
       updated_at = excluded.updated_at`,
  ).run(id, timestamp, timestamp);
}

export function markAllEventsRead(): void {
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO user_event_state (event_id, read_at, status, updated_at)
     SELECT id, ?, 'acknowledged', ? FROM intelligence_event
     WHERE id NOT IN (SELECT event_id FROM user_event_state WHERE read_at IS NOT NULL)
     ON CONFLICT(event_id) DO UPDATE SET read_at = COALESCE(user_event_state.read_at, excluded.read_at),
       updated_at = excluded.updated_at`,
  ).run(timestamp, timestamp);
}

export function setEventStatus(id: string, status: UserEventStatus): void {
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO user_event_state (event_id, read_at, status, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(event_id) DO UPDATE SET status = excluded.status,
       read_at = COALESCE(user_event_state.read_at, excluded.read_at), updated_at = excluded.updated_at`,
  ).run(id, status === 'new' ? null : timestamp, status, timestamp);
}
