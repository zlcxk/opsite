import type {
  KnowledgeNote,
  RadarDetail,
  RadarItem,
  RadarKind,
  RadarRecord,
  RadarRecordType,
  RadarStatus,
} from '../../shared/types.js';
import { db, nowIso } from '../db.js';
import { dispatchRadarRecord } from './notifications.js';

interface RadarRow {
  id: string;
  title: string;
  summary: string;
  kind: RadarKind;
  url: string | null;
  status: RadarStatus;
  created_at: string;
  updated_at: string | null;
  last_evaluated_at: string | null;
  archived_at: string | null;
  latest_record_id: string | null;
  latest_record_type: RadarRecordType | null;
  latest_record_content: string | null;
  latest_record_next_action: string | null;
  latest_record_created_at: string | null;
}

interface RadarRecordRow {
  id: string;
  radar_item_id: string;
  record_type: RadarRecordType;
  content: string;
  next_action: string | null;
  created_at: string;
}

const radarSelect = `
  SELECT r.*,
    rr.id AS latest_record_id,
    rr.record_type AS latest_record_type,
    rr.content AS latest_record_content,
    rr.next_action AS latest_record_next_action,
    rr.created_at AS latest_record_created_at
  FROM radar_item r
  LEFT JOIN radar_record rr ON rr.id = (
    SELECT r2.id FROM radar_record r2
    WHERE r2.radar_item_id = r.id AND r2.record_type <> 'status_change'
    ORDER BY r2.created_at DESC, r2.rowid DESC
    LIMIT 1
  )`;

const statusLabels: Record<RadarStatus, string> = {
  pending: '待评估',
  trialing: '试用中',
  adopted: '已采用',
  deferred: '稍后关注',
  ignored: '已忽略',
};

function mapRecord(row: RadarRecordRow): RadarRecord {
  return {
    id: row.id,
    radarItemId: row.radar_item_id,
    recordType: row.record_type,
    content: row.content,
    nextAction: row.next_action,
    createdAt: row.created_at,
  };
}

function mapRadar(row: RadarRow): RadarItem {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    kind: row.kind,
    url: row.url,
    status: row.status ?? 'pending',
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    lastEvaluatedAt: row.last_evaluated_at,
    archivedAt: row.archived_at,
    latestRecord: row.latest_record_id
      ? {
          id: row.latest_record_id,
          radarItemId: row.id,
          recordType: row.latest_record_type ?? 'note',
          content: row.latest_record_content ?? '',
          nextAction: row.latest_record_next_action,
          createdAt: row.latest_record_created_at ?? row.updated_at ?? row.created_at,
        }
      : null,
  };
}

export interface RadarListOptions {
  kind?: RadarKind;
  status?: RadarStatus;
  q?: string;
  includeArchived?: boolean;
  archivedOnly?: boolean;
  sort?: 'created' | 'updated' | 'evaluated';
  limit?: number;
}

export function listRadar(options: RadarListOptions = {}): RadarItem[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (options.archivedOnly) {
    clauses.push('r.archived_at IS NOT NULL');
  } else if (!options.includeArchived) {
    clauses.push('r.archived_at IS NULL');
  }
  if (options.kind) {
    clauses.push('r.kind = ?');
    params.push(options.kind);
  }
  if (options.status) {
    clauses.push('r.status = ?');
    params.push(options.status);
  }
  const term = options.q?.trim().toLowerCase();
  if (term) {
    clauses.push('(LOWER(r.title) LIKE ? OR LOWER(r.summary) LIKE ? OR LOWER(COALESCE(r.url, \'\')) LIKE ?)');
    const pattern = `%${term}%`;
    params.push(pattern, pattern, pattern);
  }

  const orderBy =
    options.sort === 'created'
      ? 'r.created_at DESC, r.rowid DESC'
      : options.sort === 'evaluated'
        ? 'r.last_evaluated_at IS NULL ASC, r.last_evaluated_at DESC, COALESCE(r.updated_at, r.created_at) DESC'
        : 'COALESCE(r.updated_at, r.created_at) DESC, r.rowid DESC';

  let sql = `${radarSelect}${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY ${orderBy}`;
  if (options.limit && options.limit > 0) {
    sql += ' LIMIT ?';
    params.push(Math.min(options.limit, 200));
  }

  const rows = db.prepare(sql).all(...params) as RadarRow[];
  return rows.map(mapRadar);
}

export function getRadarItem(id: string): RadarItem | null {
  const row = db.prepare(`${radarSelect} WHERE r.id = ?`).get(id) as RadarRow | undefined;
  return row ? mapRadar(row) : null;
}

export function listRadarRecords(radarItemId: string): RadarRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM radar_record WHERE radar_item_id = ?
       ORDER BY created_at DESC, rowid DESC`,
    )
    .all(radarItemId) as RadarRecordRow[];
  return rows.map(mapRecord);
}

export function getRadarDetail(id: string): RadarDetail | null {
  const item = getRadarItem(id);
  if (!item) return null;
  return { item, records: listRadarRecords(id) };
}

export function createRadar(input: {
  title: string;
  summary: string;
  kind: RadarKind;
  url?: string | null;
  status?: RadarStatus;
}): RadarItem {
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO radar_item (id, title, summary, kind, url, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.title.trim(),
    input.summary.trim(),
    input.kind,
    input.url?.trim() || null,
    input.status ?? 'pending',
    timestamp,
    timestamp,
  );
  return getRadarItem(id)!;
}

export function updateRadar(
  id: string,
  input: { title?: string; summary?: string; kind?: RadarKind; url?: string | null },
): RadarItem | null {
  const existing = db.prepare('SELECT * FROM radar_item WHERE id = ?').get(id) as
    | Record<string, any>
    | undefined;
  if (!existing) return null;
  db.prepare(
    `UPDATE radar_item SET title = ?, summary = ?, kind = ?, url = ?, updated_at = ? WHERE id = ?`,
  ).run(
    input.title?.trim() ?? existing.title,
    input.summary?.trim() ?? existing.summary,
    input.kind ?? existing.kind,
    input.url !== undefined ? input.url?.trim() || null : existing.url,
    nowIso(),
    id,
  );
  return getRadarItem(id);
}

export function setRadarStatus(id: string, status: RadarStatus): RadarItem | null {
  const existing = db.prepare('SELECT * FROM radar_item WHERE id = ?').get(id) as
    | { status: RadarStatus }
    | undefined;
  if (!existing) return null;
  if (existing.status === status) return getRadarItem(id);

  const timestamp = nowIso();
  const from = statusLabels[existing.status] ?? existing.status;
  const to = statusLabels[status];
  const run = db.transaction(() => {
    db.prepare('UPDATE radar_item SET status = ?, updated_at = ? WHERE id = ?').run(
      status,
      timestamp,
      id,
    );
    db.prepare(
      `INSERT INTO radar_record (id, radar_item_id, record_type, content, next_action, created_at)
       VALUES (?, ?, 'status_change', ?, NULL, ?)`,
    ).run(crypto.randomUUID(), id, `状态从「${from}」调整为「${to}」`, timestamp);
  });
  run();
  return getRadarItem(id);
}

export function setRadarArchived(id: string, archived: boolean): RadarItem | null {
  const existing = db.prepare('SELECT archived_at FROM radar_item WHERE id = ?').get(id) as
    | { archived_at: string | null }
    | undefined;
  if (!existing) return null;
  if (Boolean(existing.archived_at) === archived) return getRadarItem(id);
  const timestamp = nowIso();
  db.prepare('UPDATE radar_item SET archived_at = ?, updated_at = ? WHERE id = ?').run(
    archived ? timestamp : null,
    timestamp,
    id,
  );
  return getRadarItem(id);
}

export function createRadarRecord(
  radarItemId: string,
  input: { recordType: RadarRecordType; content: string; nextAction?: string | null },
): RadarRecord | null {
  const exists = db.prepare('SELECT id FROM radar_item WHERE id = ?').get(radarItemId);
  if (!exists) return null;
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO radar_record (id, radar_item_id, record_type, content, next_action, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      radarItemId,
      input.recordType,
      input.content.trim(),
      input.nextAction?.trim() || null,
      timestamp,
    );
    db.prepare(
      'UPDATE radar_item SET last_evaluated_at = ?, updated_at = ? WHERE id = ?',
    ).run(timestamp, timestamp, radarItemId);
  });
  run();
  const row = db.prepare('SELECT * FROM radar_record WHERE id = ?').get(id) as RadarRecordRow;
  const record = mapRecord(row);
  try {
    const item = getRadarItem(radarItemId);
    if (item) dispatchRadarRecord(item, record);
  } catch (error) {
    console.error('[notifications] radar dispatch failed', error);
  }
  return record;
}

export function deleteRadar(id: string): boolean {
  const run = db.transaction(() => {
    // Keep discovery candidates consistent when their linked radar entry is
    // deleted: return them to the pending pool instead of leaving a dangling
    // "imported" state.
    db.prepare(
      `UPDATE discovery_candidate
       SET status = 'pending', radar_item_id = NULL, updated_at = ?
       WHERE radar_item_id = ?`,
    ).run(nowIso(), id);
    return db.prepare('DELETE FROM radar_item WHERE id = ?').run(id);
  });
  return run().changes > 0;
}

interface NoteRow {
  id: string;
  title: string;
  content: string;
  tags: string;
  related_software_id: string | null;
  related_software_name: string | null;
  tech_node_id: string | null;
  tech_node_name: string | null;
  tech_domain_name: string | null;
  created_at: string;
  updated_at: string;
}

function mapNote(row: NoteRow): KnowledgeNote {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags);
    if (Array.isArray(parsed)) tags = parsed.map(String);
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    tags,
    relatedSoftwareId: row.related_software_id,
    relatedSoftwareName: row.related_software_name,
    techNodeId: row.tech_node_id ?? null,
    techNodeName: row.tech_node_name ?? null,
    techDomainName: row.tech_domain_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const noteSelect = `
  SELECT n.*,
    s.name AS related_software_name,
    tn.name AS tech_node_name,
    td.name AS tech_domain_name
  FROM knowledge_note n
  LEFT JOIN software s ON s.id = n.related_software_id
  LEFT JOIN tech_nodes tn ON tn.id = n.tech_node_id
  LEFT JOIN tech_domains td ON td.id = tn.domain_id`;

export function listNotes(options: { techNodeId?: string } = {}): KnowledgeNote[] {
  const clauses = ['(s.deleted_at IS NULL OR n.related_software_id IS NULL)'];
  const params: unknown[] = [];
  if (options.techNodeId) {
    clauses.push('n.tech_node_id = ?');
    params.push(options.techNodeId);
  }
  const rows = db
    .prepare(`${noteSelect} WHERE ${clauses.join(' AND ')} ORDER BY n.updated_at DESC`)
    .all(...params) as NoteRow[];
  return rows.map(mapNote);
}

export function getNote(id: string): KnowledgeNote | null {
  const row = db.prepare(`${noteSelect} WHERE n.id = ?`).get(id) as NoteRow | undefined;
  return row ? mapNote(row) : null;
}

export function createNote(input: {
  title: string;
  content?: string;
  tags?: string[];
  relatedSoftwareId?: string | null;
  techNodeId?: string | null;
}): KnowledgeNote {
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO knowledge_note (id, title, content, tags, related_software_id, tech_node_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.title.trim(),
    input.content ?? '',
    JSON.stringify((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean)),
    input.relatedSoftwareId || null,
    input.techNodeId || null,
    timestamp,
    timestamp,
  );
  return getNote(id)!;
}

export function updateNote(
  id: string,
  input: {
    title?: string;
    content?: string;
    tags?: string[];
    relatedSoftwareId?: string | null;
    techNodeId?: string | null;
  },
): KnowledgeNote | null {
  const existing = db.prepare('SELECT * FROM knowledge_note WHERE id = ?').get(id) as
    | Record<string, any>
    | undefined;
  if (!existing) return null;
  db.prepare(
    `UPDATE knowledge_note SET title = ?, content = ?, tags = ?, related_software_id = ?, tech_node_id = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.title?.trim() || existing.title,
    input.content ?? existing.content,
    input.tags ? JSON.stringify(input.tags.map((tag) => tag.trim()).filter(Boolean)) : existing.tags,
    input.relatedSoftwareId !== undefined ? input.relatedSoftwareId || null : existing.related_software_id,
    input.techNodeId !== undefined ? input.techNodeId || null : existing.tech_node_id,
    nowIso(),
    id,
  );
  return getNote(id);
}

export function deleteNote(id: string): void {
  db.prepare('DELETE FROM knowledge_note WHERE id = ?').run(id);
}
