import type { KnowledgeNote, RadarItem, RadarKind } from '../../shared/types.js';
import { db, nowIso } from '../db.js';

export function listRadar(): RadarItem[] {
  const rows = db
    .prepare('SELECT * FROM radar_item ORDER BY created_at DESC')
    .all() as Array<Record<string, any>>;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    kind: row.kind as RadarKind,
    url: row.url,
    createdAt: row.created_at,
  }));
}

export function createRadar(input: {
  title: string;
  summary: string;
  kind: RadarKind;
  url?: string | null;
}): RadarItem {
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  db.prepare(
    'INSERT INTO radar_item (id, title, summary, kind, url, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, input.title.trim(), input.summary.trim(), input.kind, input.url?.trim() || null, createdAt);
  return {
    id,
    title: input.title.trim(),
    summary: input.summary.trim(),
    kind: input.kind,
    url: input.url?.trim() || null,
    createdAt,
  };
}

export function updateRadar(
  id: string,
  input: { title?: string; summary?: string; kind?: RadarKind; url?: string | null },
): RadarItem | null {
  const existing = db.prepare('SELECT * FROM radar_item WHERE id = ?').get(id) as
    | Record<string, any>
    | undefined;
  if (!existing) return null;
  db.prepare('UPDATE radar_item SET title = ?, summary = ?, kind = ?, url = ? WHERE id = ?').run(
    input.title?.trim() ?? existing.title,
    input.summary?.trim() ?? existing.summary,
    input.kind ?? existing.kind,
    input.url !== undefined ? input.url?.trim() || null : existing.url,
    id,
  );
  return listRadar().find((item) => item.id === id) ?? null;
}

export function deleteRadar(id: string): void {
  db.prepare('DELETE FROM radar_item WHERE id = ?').run(id);
}

interface NoteRow {
  id: string;
  title: string;
  content: string;
  tags: string;
  related_software_id: string | null;
  related_software_name: string | null;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listNotes(): KnowledgeNote[] {
  const rows = db
    .prepare(
      `SELECT n.*, s.name AS related_software_name
       FROM knowledge_note n LEFT JOIN software s ON s.id = n.related_software_id
       WHERE s.deleted_at IS NULL OR n.related_software_id IS NULL
       ORDER BY n.updated_at DESC`,
    )
    .all() as NoteRow[];
  return rows.map(mapNote);
}

export function getNote(id: string): KnowledgeNote | null {
  const row = db
    .prepare(
      `SELECT n.*, s.name AS related_software_name
       FROM knowledge_note n LEFT JOIN software s ON s.id = n.related_software_id
       WHERE n.id = ?`,
    )
    .get(id) as NoteRow | undefined;
  return row ? mapNote(row) : null;
}

export function createNote(input: {
  title: string;
  content?: string;
  tags?: string[];
  relatedSoftwareId?: string | null;
}): KnowledgeNote {
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO knowledge_note (id, title, content, tags, related_software_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.title.trim(),
    input.content ?? '',
    JSON.stringify((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean)),
    input.relatedSoftwareId || null,
    timestamp,
    timestamp,
  );
  return getNote(id)!;
}

export function updateNote(
  id: string,
  input: { title?: string; content?: string; tags?: string[]; relatedSoftwareId?: string | null },
): KnowledgeNote | null {
  const existing = db.prepare('SELECT * FROM knowledge_note WHERE id = ?').get(id) as
    | Record<string, any>
    | undefined;
  if (!existing) return null;
  db.prepare(
    `UPDATE knowledge_note SET title = ?, content = ?, tags = ?, related_software_id = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.title?.trim() || existing.title,
    input.content ?? existing.content,
    input.tags ? JSON.stringify(input.tags.map((tag) => tag.trim()).filter(Boolean)) : existing.tags,
    input.relatedSoftwareId !== undefined ? input.relatedSoftwareId || null : existing.related_software_id,
    nowIso(),
    id,
  );
  return getNote(id);
}

export function deleteNote(id: string): void {
  db.prepare('DELETE FROM knowledge_note WHERE id = ?').run(id);
}
