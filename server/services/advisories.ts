import type {
  Advisory,
  AdvisoryStatus,
  Priority,
  SourceType,
  VersionImpact,
} from '../../shared/types.js';
import { db, nowIso } from '../db.js';
import { computePriority, isOpenAdvisory, normalizeSeverity, severityRank } from '../lib/severity.js';
import { evaluateVersionImpact, formatStructuredRange } from '../lib/version.js';
import type { RawAdvisory } from '../adapters/types.js';
import { updateEventPriority } from './events.js';

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 } as const;

interface AdvisoryDbRow {
  id: string;
  software_id: string;
  identifier: string;
  title: string;
  description: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
  score: number | null;
  score_source: string | null;
  url: string | null;
  published_at: string | null;
  upstream_updated_at: string | null;
  kev: number;
  kev_due_date: string | null;
  version_impact: VersionImpact;
  priority: Priority;
  confidence: 'high' | 'medium' | 'low';
  fixed_versions: string;
  created_at: string;
  updated_at: string;
  status: AdvisoryStatus;
  current_version: string | null;
  software_name?: string;
}

interface RangeRow {
  id: string;
  range_text: string | null;
  introduced: string | null;
  fixed: string | null;
  last_affected: string | null;
  ecosystem: string | null;
  confidence: string;
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function recalculate(advisoryId: string): { priority: Priority; impact: VersionImpact } | null {
  const row = db
    .prepare(
      `SELECT a.id, a.kev, a.severity, s.current_version
       FROM security_advisory a JOIN software s ON s.id = a.software_id
       WHERE a.id = ?`,
    )
    .get(advisoryId) as { id: string; kev: number; severity: AdvisoryDbRow['severity']; current_version: string | null } | undefined;
  if (!row) return null;

  const ranges = db
    .prepare('SELECT * FROM advisory_affected_range WHERE advisory_id = ?')
    .all(advisoryId) as RangeRow[];
  const versionRanges = ranges.map((range) => ({
    introduced: range.introduced,
    fixed: range.fixed,
    lastAffected: range.last_affected,
    rangeText: range.range_text,
  }));
  const match = evaluateVersionImpact(row.current_version, versionRanges);
  const priority = computePriority({
    severity: normalizeSeverity(row.severity),
    versionImpact: match.status,
    kev: Boolean(row.kev),
  });

  db.prepare(
    'UPDATE security_advisory SET version_impact = ?, priority = ?, updated_at = ? WHERE id = ?',
  ).run(match.status, priority, nowIso(), advisoryId);
  updateEventPriority(advisoryId, priority);
  return { priority, impact: match.status };
}

export function refreshAdvisoryInsights(softwareId: string): void {
  const ids = db
    .prepare('SELECT id FROM security_advisory WHERE software_id = ?')
    .all(softwareId) as Array<{ id: string }>;
  const transaction = db.transaction(() => {
    for (const row of ids) recalculate(row.id);
  });
  transaction();
}

export interface UpsertAdvisoryResult {
  id: string;
  created: boolean;
  priority: Priority;
  title: string;
  url: string | null;
  publishedAt: string | null;
}

export function upsertAdvisory(
  softwareId: string,
  sourceId: string,
  raw: RawAdvisory,
): UpsertAdvisoryResult {
  const timestamp = nowIso();
  const software = db
    .prepare('SELECT current_version FROM software WHERE id = ?')
    .get(softwareId) as { current_version: string | null } | undefined;
  if (!software) throw new Error('软件不存在');

  const identifier = raw.identifier.trim().toUpperCase();
  const existing = db
    .prepare('SELECT * FROM security_advisory WHERE software_id = ? AND identifier = ?')
    .get(softwareId, identifier) as AdvisoryDbRow | undefined;

  let advisoryId: string;
  let created = false;

  if (!existing) {
    advisoryId = crypto.randomUUID();
    const initialImpact = evaluateVersionImpact(
      software.current_version,
      raw.affectedRanges.map((range) => ({ ...range })),
    );
    const priority = computePriority({
      severity: raw.severity,
      versionImpact: initialImpact.status,
      kev: raw.kev,
    });
    db.prepare(
      `INSERT INTO security_advisory
        (id, software_id, identifier, title, description, severity, score, score_source, url,
         published_at, upstream_updated_at, kev, kev_due_date, version_impact, priority, confidence,
         fixed_versions, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      advisoryId,
      softwareId,
      identifier,
      raw.title || identifier,
      raw.description,
      raw.severity,
      raw.score,
      raw.scoreSource,
      raw.url,
      raw.publishedAt,
      raw.updatedAt,
      raw.kev ? 1 : 0,
      raw.kevDueDate,
      initialImpact.status,
      priority,
      raw.confidence,
      JSON.stringify(raw.fixedVersions),
      timestamp,
      timestamp,
    );
    created = true;
  } else {
    advisoryId = existing.id;
    const existingConfidence = CONFIDENCE_RANK[existing.confidence] ?? 1;
    const incomingConfidence = CONFIDENCE_RANK[raw.confidence] ?? 1;
    const betterSource = incomingConfidence > existingConfidence;
    const title = betterSource && raw.title ? raw.title : existing.title;
    const description = raw.description && (betterSource || !existing.description) ? raw.description : existing.description;
    const severity = severityRank(raw.severity) > severityRank(existing.severity) ? raw.severity : existing.severity;
    const useIncomingScore = raw.score != null && (existing.score == null || raw.score > existing.score);
    const url = betterSource && raw.url ? raw.url : existing.url || raw.url;
    const publishedAt = existing.published_at && raw.publishedAt
      ? (existing.published_at < raw.publishedAt ? existing.published_at : raw.publishedAt)
      : existing.published_at || raw.publishedAt;
    const updatedAt = [existing.upstream_updated_at, raw.updatedAt].filter(Boolean).sort().pop() ?? null;
    const fixedVersions = [...new Set([...parseJsonArray(existing.fixed_versions), ...raw.fixedVersions])];

    db.prepare(
      `UPDATE security_advisory SET title = ?, description = ?, severity = ?, score = ?, score_source = ?,
        url = ?, published_at = ?, upstream_updated_at = ?, kev = ?, kev_due_date = ?,
        confidence = ?, fixed_versions = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      title,
      description,
      severity,
      useIncomingScore ? raw.score : existing.score,
      useIncomingScore ? raw.scoreSource : existing.score_source,
      url,
      publishedAt,
      updatedAt,
      existing.kev || raw.kev ? 1 : 0,
      existing.kev_due_date || raw.kevDueDate,
      betterSource ? raw.confidence : existing.confidence,
      JSON.stringify(fixedVersions),
      timestamp,
      advisoryId,
    );
  }

  // Refresh only this source's ranges; other sources stay intact.
  db.prepare('DELETE FROM advisory_affected_range WHERE advisory_id = ? AND source_id = ?').run(advisoryId, sourceId);
  const insertRange = db.prepare(
    `INSERT INTO advisory_affected_range
      (id, advisory_id, source_id, range_text, introduced, fixed, last_affected, ecosystem, confidence, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const range of raw.affectedRanges) {
    insertRange.run(
      crypto.randomUUID(),
      advisoryId,
      sourceId,
      range.rangeText ?? formatStructuredRange(range),
      range.introduced ?? null,
      range.fixed ?? null,
      range.lastAffected ?? null,
      null,
      raw.confidence,
      JSON.stringify(range),
    );
  }

  db.prepare(
    `INSERT INTO advisory_source (id, advisory_id, source_id, source_type, external_id, url, fetched_at, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(advisory_id, source_type, external_id) DO UPDATE SET
       source_id = excluded.source_id, url = COALESCE(excluded.url, advisory_source.url),
       fetched_at = excluded.fetched_at, raw = excluded.raw`,
  ).run(
    crypto.randomUUID(),
    advisoryId,
    sourceId,
    raw.sourceType,
    raw.externalId || identifier,
    raw.url,
    timestamp,
    JSON.stringify(raw.raw),
  );

  const recalculated = recalculate(advisoryId);
  return {
    id: advisoryId,
    created,
    priority: recalculated?.priority ?? 'P3',
    title: raw.title || identifier,
    url: raw.url,
    publishedAt: raw.publishedAt,
  };
}

export function setAdvisoryStatus(advisoryId: string, status: AdvisoryStatus): void {
  db.prepare(
    `INSERT INTO advisory_user_state (advisory_id, status, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(advisory_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
  ).run(advisoryId, status, nowIso());
}

export function getAdvisoryRowsForSoftware(softwareId: string): AdvisoryDbRow[] {
  return db
    .prepare(
      `SELECT a.*, COALESCE(us.status, 'pending') AS status, s.current_version,
              s.name AS software_name
       FROM security_advisory a
       JOIN software s ON s.id = a.software_id
       LEFT JOIN advisory_user_state us ON us.advisory_id = a.id
       WHERE a.software_id = ?
       ORDER BY CASE a.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
                COALESCE(a.published_at, a.created_at) DESC`,
    )
    .all(softwareId) as AdvisoryDbRow[];
}

export function listAdvisories(options: {
  softwareId?: string;
  priority?: string;
  status?: string;
  openOnly?: boolean;
  limit?: number;
  offset?: number;
} = {}): Advisory[] {
  const clauses: string[] = ['s.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (options.softwareId) {
    clauses.push('a.software_id = ?');
    params.push(options.softwareId);
  }
  if (options.priority) {
    clauses.push('a.priority = ?');
    params.push(options.priority);
  }
  if (options.status) {
    clauses.push("COALESCE(us.status, 'pending') = ?");
    params.push(options.status);
  }
  if (options.openOnly) {
    clauses.push("COALESCE(us.status, 'pending') NOT IN ('fixed', 'not_affected', 'ignored')");
  }
  const limit = Math.min(options.limit ?? 100, 300);
  const offset = options.offset ?? 0;
  const rows = db
    .prepare(
      `SELECT a.*, COALESCE(us.status, 'pending') AS status, s.current_version,
              s.name AS software_name
       FROM security_advisory a
       JOIN software s ON s.id = a.software_id
       LEFT JOIN advisory_user_state us ON us.advisory_id = a.id
       WHERE ${clauses.join(' AND ')}
       ORDER BY CASE a.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
                COALESCE(a.published_at, a.created_at) DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as AdvisoryDbRow[];

  return rows.map((row) => mapAdvisory(row));
}

export function getAdvisory(id: string): Advisory | null {
  const row = db
    .prepare(
      `SELECT a.*, COALESCE(us.status, 'pending') AS status, s.current_version,
              s.name AS software_name
       FROM security_advisory a
       JOIN software s ON s.id = a.software_id
       LEFT JOIN advisory_user_state us ON us.advisory_id = a.id
       WHERE a.id = ?`,
    )
    .get(id) as AdvisoryDbRow | undefined;
  return row ? mapAdvisory(row) : null;
}

export function mapAdvisory(row: AdvisoryDbRow): Advisory {
  const sourceRows = db
    .prepare(
      `SELECT source_type, external_id, url, fetched_at FROM advisory_source
       WHERE advisory_id = ? ORDER BY fetched_at DESC`,
    )
    .all(row.id) as Array<{ source_type: SourceType; external_id: string | null; url: string | null; fetched_at: string }>;
  const rangeRows = db
    .prepare('SELECT range_text FROM advisory_affected_range WHERE advisory_id = ?')
    .all(row.id) as Array<{ range_text: string | null }>;
  const ranges = [...new Set(rangeRows.map((range) => range.range_text).filter((text): text is string => Boolean(text)))];

  return {
    id: row.id,
    softwareId: row.software_id,
    softwareName: row.software_name,
    identifier: row.identifier,
    title: row.title,
    description: row.description,
    severity: row.severity,
    score: row.score,
    scoreSource: row.score_source,
    url: row.url,
    publishedAt: row.published_at,
    updatedAt: row.upstream_updated_at,
    kev: Boolean(row.kev),
    kevDueDate: row.kev_due_date,
    versionImpact: row.version_impact,
    affectedRange: ranges.length ? ranges.join(' · ') : null,
    fixedVersions: parseJsonArray(row.fixed_versions),
    confidence: row.confidence,
    priority: row.priority,
    status: row.status,
    sources: sourceRows.map((source) => ({
      sourceType: source.source_type,
      externalId: source.external_id,
      url: source.url,
      fetchedAt: source.fetched_at,
    })),
  };
}

export { isOpenAdvisory };
