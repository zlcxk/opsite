import type { SearchResult } from '../../shared/types.js';
import { db } from '../db.js';
import { searchEvents } from './events.js';

export function searchAll(query: string): SearchResult {
  const cleaned = query.trim();
  if (!cleaned) return { software: [], events: [], advisories: [] };
  const like = `%${cleaned.replace(/[%_]/g, (match) => `\\${match}`)}%`;

  const software = db
    .prepare(
      `SELECT id, name, category FROM software
       WHERE deleted_at IS NULL AND (name LIKE ? ESCAPE '\\' OR aliases LIKE ? ESCAPE '\\')
       ORDER BY pinned DESC, name LIMIT 6`,
    )
    .all(like, like)
    .map((row) => row as { id: string; name: string; category: string });

  const events = searchEvents(cleaned);

  const advisories = db
    .prepare(
      `SELECT a.id, a.software_id AS softwareId, a.identifier, a.title, a.severity
       FROM security_advisory a JOIN software s ON s.id = a.software_id
       WHERE s.deleted_at IS NULL AND (a.identifier LIKE ? ESCAPE '\\' OR a.title LIKE ? ESCAPE '\\')
       ORDER BY CASE a.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END
       LIMIT 6`,
    )
    .all(like, like)
    .map((row) => row as { id: string; softwareId: string; identifier: string; title: string; severity: string });

  return { software, events, advisories };
}
