import type {
  DiscoveryCandidate,
  DiscoveryCandidateSource,
  DiscoveryCounts,
  DiscoveryImportResult,
  DiscoveryJob,
  DiscoveryJobStatus,
  DiscoveryListResponse,
  DiscoveryOverview,
  DiscoveryRadarLink,
  DiscoveryRule,
  DiscoverySource,
  DiscoverySourceSummary,
  DiscoverySourceStatus,
  DiscoverySourceType,
  DiscoveryStatus,
  RadarItem,
  RadarKind,
  RadarStatus,
} from '../../shared/types.js';
import {
  canonicalProjectUrl,
  discoveryAdapters,
  type DiscoveryAdapter,
  type DiscoveryFetchedItem,
} from '../adapters/discovery.js';
import { db, nowIso } from '../db.js';
import { getRadarItem } from './notes.js';
import { dispatchDiscoveryCandidate } from './notifications.js';

interface CandidateRow {
  id: string;
  source_type: DiscoverySourceType;
  source_item_id: string;
  source_ref: string | null;
  title: string;
  description: string | null;
  category: string;
  status: DiscoveryStatus;
  canonical_url: string;
  homepage_url: string | null;
  source_url: string | null;
  source_created_at: string | null;
  source_updated_at: string | null;
  source_pushed_at: string | null;
  stars_count: number | null;
  forks_count: number | null;
  language: string | null;
  license: string | null;
  first_discovered_at: string;
  last_seen_at: string;
  last_fetched_at: string;
  radar_item_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CandidateSourceRow {
  source_type: DiscoverySourceType;
  source_item_id: string;
  source_ref: string | null;
  source_url: string | null;
  source_updated_at: string | null;
  last_seen_at: string;
}

interface DiscoverySourceRow {
  id: string;
  type: DiscoverySourceType;
  name: string;
  enabled: number;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_summary: string | null;
  last_status: DiscoverySourceStatus;
  last_result: string | null;
}

interface DiscoveryRuleRow {
  id: string;
  source_id: string;
  source_type: DiscoverySourceType;
  name: string;
  query: string;
  category: string;
  enabled: number;
  last_run_at: string | null;
  last_result: string | null;
  last_error: string | null;
}

interface DiscoveryJobRow {
  id: string;
  source_type: DiscoverySourceType;
  trigger: 'manual' | 'schedule';
  status: DiscoveryJobStatus;
  started_at: string;
  finished_at: string | null;
  items_found: number;
  items_new: number;
  items_updated: number;
  items_skipped: number;
  items_duplicate: number;
  run_id: string | null;
  error_summary: string | null;
}

interface RadarLinkRow {
  id: string;
  title: string;
  status: RadarStatus;
  archived_at: string | null;
}

export class DiscoveryRequestError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'DiscoveryRequestError';
    this.status = status;
    this.details = details;
  }
}

const sourceNames: Record<DiscoverySourceType, string> = {
  github: 'GitHub',
  cncf: 'CNCF Landscape',
};

function mapCandidateSource(row: CandidateSourceRow): DiscoveryCandidateSource {
  return {
    sourceType: row.source_type,
    sourceItemId: row.source_item_id,
    sourceRef: row.source_ref,
    sourceUrl: row.source_url,
    sourceUpdatedAt: row.source_updated_at,
    lastSeenAt: row.last_seen_at,
  };
}

function mapRadarLink(row: RadarLinkRow): DiscoveryRadarLink {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    archivedAt: row.archived_at,
  };
}

function mapCandidate(
  row: CandidateRow,
  relatedRadarItem: DiscoveryRadarLink | null,
  sources: DiscoveryCandidateSource[],
): DiscoveryCandidate {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceItemId: row.source_item_id,
    sourceRef: row.source_ref,
    title: row.title,
    description: row.description,
    category: row.category,
    status: row.status,
    canonicalUrl: row.canonical_url,
    homepageUrl: row.homepage_url,
    sourceUrl: row.source_url,
    sourceCreatedAt: row.source_created_at,
    sourceUpdatedAt: row.source_updated_at,
    sourcePushedAt: row.source_pushed_at,
    starsCount: row.stars_count,
    forksCount: row.forks_count,
    language: row.language,
    license: row.license,
    firstDiscoveredAt: row.first_discovered_at,
    lastSeenAt: row.last_seen_at,
    lastFetchedAt: row.last_fetched_at,
    radarItemId: row.radar_item_id,
    relatedRadarItem,
    sources,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSource(row: DiscoverySourceRow): DiscoverySource {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    enabled: Boolean(row.enabled),
    lastRunAt: row.last_run_at,
    lastSuccessAt: row.last_success_at,
    lastErrorAt: row.last_error_at,
    lastErrorSummary: row.last_error_summary,
    lastStatus: row.last_status,
    lastResult: row.last_result,
  };
}

function mapRule(row: DiscoveryRuleRow): DiscoveryRule {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceType: row.source_type,
    name: row.name,
    query: row.query,
    category: row.category,
    enabled: Boolean(row.enabled),
    lastRunAt: row.last_run_at,
    lastResult: row.last_result,
    lastError: row.last_error,
  };
}

function mapJob(row: DiscoveryJobRow): DiscoveryJob {
  return {
    id: row.id,
    sourceType: row.source_type,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    itemsFound: row.items_found,
    itemsNew: row.items_new,
    itemsUpdated: row.items_updated,
    itemsSkipped: row.items_skipped,
    itemsDuplicate: row.items_duplicate,
    runId: row.run_id,
    errorSummary: row.error_summary,
  };
}

function radarLinkFor(radarItemId: string | null): DiscoveryRadarLink | null {
  if (!radarItemId) return null;
  const row = db
    .prepare('SELECT id, title, status, archived_at FROM radar_item WHERE id = ?')
    .get(radarItemId) as RadarLinkRow | undefined;
  return row ? mapRadarLink(row) : null;
}

function sourcesFor(candidateId: string): DiscoveryCandidateSource[] {
  const rows = db
    .prepare(
      `SELECT source_type, source_item_id, source_ref, source_url, source_updated_at, last_seen_at
       FROM discovery_candidate_source WHERE candidate_id = ?
       ORDER BY last_seen_at DESC, source_type ASC`,
    )
    .all(candidateId) as CandidateSourceRow[];
  return rows.map(mapCandidateSource);
}

function getCandidateRow(id: string): CandidateRow | null {
  const row = db.prepare('SELECT * FROM discovery_candidate WHERE id = ?').get(id) as
    | CandidateRow
    | undefined;
  return row ?? null;
}

export function getDiscoveryCandidate(id: string): DiscoveryCandidate | null {
  const row = getCandidateRow(id);
  if (!row) return null;
  return mapCandidate(row, radarLinkFor(row.radar_item_id), sourcesFor(row.id));
}

export interface DiscoveryListOptions {
  status?: DiscoveryStatus | 'all';
  sourceType?: DiscoverySourceType;
  category?: string;
  q?: string;
  sort?: 'discovered' | 'updated' | 'stars' | 'title';
  limit?: number;
  offset?: number;
}

function listClauses(options: DiscoveryListOptions, includeStatus = true): {
  clauses: string[];
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (includeStatus && options.status && options.status !== 'all') {
    clauses.push('c.status = ?');
    params.push(options.status);
  }
  if (options.sourceType) {
    clauses.push(
      'EXISTS (SELECT 1 FROM discovery_candidate_source cs WHERE cs.candidate_id = c.id AND cs.source_type = ?)',
    );
    params.push(options.sourceType);
  }
  if (options.category?.trim()) {
    clauses.push('c.category = ?');
    params.push(options.category.trim());
  }
  if (options.q?.trim()) {
    const pattern = `%${options.q.trim().toLowerCase()}%`;
    clauses.push(
      "(LOWER(c.title) LIKE ? OR LOWER(COALESCE(c.description, '')) LIKE ? OR LOWER(COALESCE(c.source_ref, '')) LIKE ? OR LOWER(c.canonical_url) LIKE ?)",
    );
    params.push(pattern, pattern, pattern, pattern);
  }
  return { clauses, params };
}

function counts(): DiscoveryCounts {
  const rows = db
    .prepare('SELECT status, COUNT(*) AS count FROM discovery_candidate GROUP BY status')
    .all() as Array<{ status: DiscoveryStatus; count: number }>;
  const result: DiscoveryCounts = { all: 0, pending: 0, imported: 0, ignored: 0 };
  for (const row of rows) {
    result[row.status] = row.count;
    result.all += row.count;
  }
  return result;
}

function sourceSummaries(): DiscoverySourceSummary[] {
  const rows = db
    .prepare(
      `SELECT ds.type, ds.name,
         SUM(CASE WHEN c.status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
         COUNT(*) AS total_count
       FROM discovery_candidate_source cs
       JOIN discovery_candidate c ON c.id = cs.candidate_id
       JOIN discovery_source ds ON ds.type = cs.source_type
       GROUP BY ds.type, ds.name
       ORDER BY pending_count DESC, ds.name ASC`,
    )
    .all() as Array<{
    type: DiscoverySourceType;
    name: string;
    pending_count: number;
    total_count: number;
  }>;
  return rows.map((row) => ({
    type: row.type,
    name: row.name,
    pendingCount: Number(row.pending_count) || 0,
    totalCount: Number(row.total_count) || 0,
  }));
}

function categoryList(): string[] {
  const rows = db
    .prepare('SELECT DISTINCT category FROM discovery_candidate ORDER BY category COLLATE NOCASE ASC')
    .all() as Array<{ category: string }>;
  return rows.map((row) => row.category);
}

export function listDiscoveryCandidates(options: DiscoveryListOptions = {}): DiscoveryListResponse {
  const limit = Math.max(1, Math.min(options.limit ?? 24, 100));
  const offset = Math.max(0, options.offset ?? 0);
  const { clauses, params } = listClauses(options);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const orderBy = {
    discovered: 'c.first_discovered_at DESC, c.rowid DESC',
    updated: 'COALESCE(c.source_pushed_at, c.source_updated_at, c.last_seen_at) DESC, c.rowid DESC',
    stars: 'c.stars_count IS NULL ASC, c.stars_count DESC, c.last_seen_at DESC',
    title: 'LOWER(c.title) ASC, c.rowid DESC',
  }[options.sort ?? 'discovered'];

  const rows = db
    .prepare(
      `SELECT c.* FROM discovery_candidate c ${where}
       ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as CandidateRow[];
  const total = (
    db.prepare(`SELECT COUNT(*) AS count FROM discovery_candidate c ${where}`).get(...params) as {
      count: number;
    }
  ).count;

  return {
    items: rows.map((row) =>
      mapCandidate(row, radarLinkFor(row.radar_item_id), sourcesFor(row.id)),
    ),
    total,
    limit,
    offset,
    counts: counts(),
    sources: sourceSummaries(),
    categories: categoryList(),
  };
}

function summarizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').trim().slice(0, 300) || '未知错误';
}

interface UpsertResult {
  candidateId: string;
  created: boolean;
  duplicate: boolean;
  changed: boolean;
}

function upsertCandidate(
  item: DiscoveryFetchedItem,
  seen: Set<string>,
): UpsertResult {
  const key = `${item.sourceType}:${item.sourceItemId}`;
  if (seen.has(key)) {
    const existing = db
      .prepare(
        'SELECT id FROM discovery_candidate WHERE source_type = ? AND source_item_id = ?',
      )
      .get(item.sourceType, item.sourceItemId) as { id: string } | undefined;
    return {
      candidateId: existing?.id ?? '',
      created: false,
      duplicate: true,
      changed: false,
    };
  }
  seen.add(key);

  const timestamp = nowIso();
  const existingByItem = db
    .prepare('SELECT * FROM discovery_candidate WHERE source_type = ? AND source_item_id = ?')
    .get(item.sourceType, item.sourceItemId) as CandidateRow | undefined;

  if (existingByItem) {
    // External source fields only. User decisions (status, radar link) and the
    // original first-discovered timestamp are never overwritten.
    const changed =
      existingByItem.source_ref !== item.sourceRef ||
      existingByItem.title !== item.title ||
      existingByItem.description !== item.description ||
      existingByItem.category !== item.category ||
      existingByItem.canonical_url !== item.canonicalUrl ||
      existingByItem.homepage_url !== item.homepageUrl ||
      existingByItem.source_url !== item.sourceUrl ||
      existingByItem.source_created_at !== item.sourceCreatedAt ||
      existingByItem.source_updated_at !== item.sourceUpdatedAt ||
      existingByItem.source_pushed_at !== item.sourcePushedAt ||
      existingByItem.stars_count !== item.starsCount ||
      existingByItem.forks_count !== item.forksCount ||
      existingByItem.language !== item.language ||
      existingByItem.license !== item.license;
    db.prepare(
      `UPDATE discovery_candidate SET
         source_ref = ?, title = ?, description = ?, category = ?, canonical_url = ?,
         homepage_url = ?, source_url = ?, source_created_at = ?, source_updated_at = ?,
         source_pushed_at = ?, stars_count = ?, forks_count = ?, language = ?, license = ?,
         last_seen_at = ?, last_fetched_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      item.sourceRef,
      item.title,
      item.description,
      item.category,
      item.canonicalUrl,
      item.homepageUrl,
      item.sourceUrl,
      item.sourceCreatedAt,
      item.sourceUpdatedAt,
      item.sourcePushedAt,
      item.starsCount,
      item.forksCount,
      item.language,
      item.license,
      timestamp,
      timestamp,
      timestamp,
      existingByItem.id,
    );
    linkCandidateSource(existingByItem.id, item, timestamp);
    return { candidateId: existingByItem.id, created: false, duplicate: false, changed };
  }

  const existingByUrl = db
    .prepare('SELECT * FROM discovery_candidate WHERE canonical_url = ? LIMIT 1')
    .get(item.canonicalUrl) as CandidateRow | undefined;
  if (existingByUrl) {
    linkCandidateSource(existingByUrl.id, item, timestamp);
    db.prepare(
      'UPDATE discovery_candidate SET last_seen_at = ?, last_fetched_at = ?, updated_at = ? WHERE id = ?',
    ).run(timestamp, timestamp, timestamp, existingByUrl.id);
    return { candidateId: existingByUrl.id, created: false, duplicate: true, changed: false };
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO discovery_candidate
      (id, source_type, source_item_id, source_ref, title, description, category, status,
       canonical_url, homepage_url, source_url, source_created_at, source_updated_at,
       source_pushed_at, stars_count, forks_count, language, license, first_discovered_at,
       last_seen_at, last_fetched_at, radar_item_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    id,
    item.sourceType,
    item.sourceItemId,
    item.sourceRef,
    item.title,
    item.description,
    item.category,
    item.canonicalUrl,
    item.homepageUrl,
    item.sourceUrl,
    item.sourceCreatedAt,
    item.sourceUpdatedAt,
    item.sourcePushedAt,
    item.starsCount,
    item.forksCount,
    item.language,
    item.license,
    timestamp,
    timestamp,
    timestamp,
    timestamp,
    timestamp,
  );
  linkCandidateSource(id, item, timestamp);
  try {
    const candidate = getDiscoveryCandidate(id);
    if (candidate) dispatchDiscoveryCandidate(candidate, true);
  } catch (error) {
    console.error('[notifications] discovery dispatch failed', error);
  }
  return { candidateId: id, created: true, duplicate: false, changed: true };
}

function linkCandidateSource(candidateId: string, item: DiscoveryFetchedItem, timestamp: string): void {
  db.prepare(
    `INSERT INTO discovery_candidate_source
      (candidate_id, source_type, source_item_id, source_ref, source_url, source_updated_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_type, source_item_id) DO UPDATE SET
       candidate_id = excluded.candidate_id, source_ref = excluded.source_ref,
       source_url = excluded.source_url, source_updated_at = excluded.source_updated_at,
       last_seen_at = excluded.last_seen_at`,
  ).run(
    candidateId,
    item.sourceType,
    item.sourceItemId,
    item.sourceRef,
    item.sourceUrl,
    item.sourceUpdatedAt,
    timestamp,
  );
}

function insertJob(
  sourceType: DiscoverySourceType,
  trigger: 'manual' | 'schedule',
  runId: string | null,
): string {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO discovery_job
      (id, source_type, trigger, status, started_at, run_id)
     VALUES (?, ?, ?, 'running', ?, ?)`,
  ).run(id, sourceType, trigger, nowIso(), runId);
  return id;
}

function finishJob(
  id: string,
  result: {
    status: DiscoveryJobStatus;
    found: number;
    created: number;
    updated: number;
    skipped: number;
    duplicate: number;
    error?: string | null;
  },
): void {
  db.prepare(
    `UPDATE discovery_job SET status = ?, finished_at = ?, items_found = ?, items_new = ?,
       items_updated = ?, items_skipped = ?, items_duplicate = ?, error_summary = ? WHERE id = ?`,
  ).run(
    result.status,
    nowIso(),
    result.found,
    result.created,
    result.updated,
    result.skipped,
    result.duplicate,
    result.error ?? null,
    id,
  );
}

function setSourceRunResult(
  sourceId: string,
  input: {
    status: DiscoverySourceStatus;
    result: string;
    error?: string | null;
  },
): void {
  const timestamp = nowIso();
  const success = input.status === 'ok' || input.status === 'partial';
  db.prepare(
    `UPDATE discovery_source SET last_run_at = ?, last_status = ?, last_result = ?,
       last_success_at = CASE WHEN ? THEN ? ELSE last_success_at END,
       last_error_at = CASE WHEN ? THEN ? ELSE last_error_at END,
       last_error_summary = ?,
       updated_at = ?
     WHERE id = ?`,
  ).run(
    timestamp,
    input.status,
    input.result,
    success ? 1 : 0,
    timestamp,
    input.error ? 1 : 0,
    timestamp,
    input.error ? input.error : null,
    timestamp,
    sourceId,
  );
}

function setRuleResult(
  ruleId: string,
  input: { ok: boolean; result?: string | null; error?: string | null },
): void {
  const timestamp = nowIso();
  db.prepare(
    `UPDATE discovery_rule SET last_run_at = ?, last_result = ?, last_error = ?, updated_at = ?
     WHERE id = ?`,
  ).run(timestamp, input.ok ? input.result ?? null : null, input.ok ? null : input.error ?? null, timestamp, ruleId);
}

export interface DiscoveryRunOptions {
  trigger: 'manual' | 'schedule';
  adapters?: Record<DiscoverySourceType, DiscoveryAdapter>;
  sourceTypes?: DiscoverySourceType[];
  runId?: string;
}

export interface DiscoveryRunResult {
  jobs: DiscoveryJob[];
  failed: number;
}

/**
 * Runs all enabled sources sequentially. A failure in one source or one rule
 * is recorded and isolated; it never clears existing candidates.
 */
export async function runDiscovery(
  options: DiscoveryRunOptions,
): Promise<DiscoveryRunResult> {
  const adapters = options.adapters ?? discoveryAdapters;
  let sources = db
    .prepare(
      `SELECT * FROM discovery_source WHERE enabled = 1
       ORDER BY CASE type WHEN 'github' THEN 0 ELSE 1 END, type`,
    )
    .all() as DiscoverySourceRow[];
  if (options.sourceTypes?.length) {
    sources = sources.filter((source) => options.sourceTypes?.includes(source.type));
  }
  const jobs: DiscoveryJob[] = [];
  let failed = 0;

  for (const source of sources) {
    const rules = db
      .prepare(
        `SELECT r.*, s.type AS source_type
         FROM discovery_rule r JOIN discovery_source s ON s.id = r.source_id
         WHERE r.source_id = ? AND r.enabled = 1 ORDER BY r.id`,
      )
      .all(source.id) as DiscoveryRuleRow[];
    const jobId = insertJob(source.type, options.trigger, options.runId ?? null);
    let found = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let duplicate = 0;
    let ruleSuccesses = 0;
    const errors: string[] = [];
    const seen = new Set<string>();

    if (!rules.length) {
      errors.push('没有启用的采集规则');
    }

    const adapter = adapters[source.type];
    for (const rule of rules) {
      try {
        if (!adapter) throw new Error(`未实现的来源适配器：${source.type}`);
        const result = await adapter.fetch({ query: rule.query, category: rule.category });
        for (const item of result.items) {
          found += 1;
          const outcome = upsertCandidate(item, seen);
          if (outcome.created) created += 1;
          else if (outcome.duplicate) duplicate += 1;
          else if (outcome.changed) updated += 1;
          else skipped += 1;
        }
        ruleSuccesses += 1;
        setRuleResult(rule.id, { ok: true, result: result.note ?? `发现 ${result.items.length} 条候选` });
      } catch (error) {
        const summary = summarizeError(error);
        errors.push(`${rule.name}：${summary}`);
        setRuleResult(rule.id, { ok: false, error: summary });
      }
    }

    const status: DiscoveryJobStatus =
      ruleSuccesses === 0 ? 'error' : errors.length ? 'partial' : 'success';
    const errorSummary = errors.length ? errors.join('；').slice(0, 800) : null;
    finishJob(jobId, {
      status,
      found,
      created,
      updated,
      skipped,
      duplicate,
      error: errorSummary,
    });

    let sourceStatus: DiscoverySourceStatus;
    if (ruleSuccesses === 0) sourceStatus = 'error';
    else if (errors.length) sourceStatus = 'partial';
    else sourceStatus = 'ok';
    setSourceRunResult(source.id, {
      status: sourceStatus,
      result: `新增 ${created} · 更新 ${updated} · 未变 ${skipped} · 重复 ${duplicate}`,
      error: errorSummary,
    });
    if (ruleSuccesses === 0) failed += 1;

    const jobRow = db.prepare('SELECT * FROM discovery_job WHERE id = ?').get(jobId) as
      | DiscoveryJobRow
      | undefined;
    if (jobRow) jobs.push(mapJob(jobRow));
  }

  return { jobs, failed };
}

let activeRun: Promise<DiscoveryRunResult> | null = null;

export function isDiscoveryRunning(): boolean {
  return activeRun !== null;
}

/**
 * Starts a collection in the background and returns immediately. The lock is
 * process-local and prevents a manual refresh and the cron tick overlapping.
 */
export function startDiscoveryRun(
  trigger: 'manual' | 'schedule',
  adapters?: Record<DiscoverySourceType, DiscoveryAdapter>,
): { started: boolean; reason?: string } {
  if (activeRun) {
    return { started: false, reason: '技术发现采集正在进行中，请稍后再试' };
  }
  activeRun = runDiscovery({ trigger, adapters })
    .catch((error) => {
      console.error('[discovery] run failed:', error);
      return { jobs: [], failed: 1 };
    })
    .finally(() => {
      activeRun = null;
    });
  return { started: true };
}

export function markInterruptedDiscoveryJobs(): void {
  db.prepare(
    `UPDATE discovery_job SET status = 'error', finished_at = ?,
       error_summary = COALESCE(error_summary, '服务重启，采集任务被中断')
     WHERE status = 'running'`,
  ).run(nowIso());
}

export function listDiscoveryJobs(limit = 12): DiscoveryJob[] {
  const rows = db
    .prepare('SELECT * FROM discovery_job ORDER BY started_at DESC, rowid DESC LIMIT ?')
    .all(Math.max(1, Math.min(limit, 50))) as DiscoveryJobRow[];
  return rows.map(mapJob);
}

export function listDiscoverySources(): DiscoverySource[] {
  const rows = db
    .prepare('SELECT * FROM discovery_source ORDER BY type')
    .all() as DiscoverySourceRow[];
  return rows.map(mapSource);
}

export function listDiscoveryRules(): DiscoveryRule[] {
  const rows = db
    .prepare(
      `SELECT r.*, s.type AS source_type
       FROM discovery_rule r JOIN discovery_source s ON s.id = r.source_id
       ORDER BY s.type, r.id`,
    )
    .all() as DiscoveryRuleRow[];
  return rows.map(mapRule);
}

export function getDiscoveryOverview(scheduler: DiscoveryOverview['scheduler']): DiscoveryOverview {
  const runningRow = db
    .prepare("SELECT started_at FROM discovery_job WHERE status = 'running' ORDER BY started_at DESC LIMIT 1")
    .get() as { started_at: string } | undefined;
  const lastRunRow = db
    .prepare('SELECT started_at FROM discovery_job ORDER BY started_at DESC LIMIT 1')
    .get() as { started_at: string } | undefined;
  return {
    counts: counts(),
    sources: listDiscoverySources(),
    rules: listDiscoveryRules(),
    jobs: listDiscoveryJobs(10),
    running: activeRun !== null || Boolean(runningRow),
    runningSince: runningRow?.started_at ?? null,
    lastRunAt: lastRunRow?.started_at ?? null,
    githubTokenConfigured: Boolean(process.env.GITHUB_TOKEN),
    scheduler,
  };
}

export interface ImportCandidateInput {
  radarItemId?: string | null;
  title?: string;
  summary?: string;
  kind?: RadarKind;
  url?: string | null;
}

function findRadarByUrl(url: string | null): RadarItem | null {
  const normalized = canonicalProjectUrl(url);
  if (!normalized) return null;
  const rows = db
    .prepare('SELECT id, url FROM radar_item WHERE url IS NOT NULL')
    .all() as Array<{ id: string; url: string }>;
  for (const row of rows) {
    if (canonicalProjectUrl(row.url) === normalized) {
      return getRadarItem(row.id);
    }
  }
  return null;
}

export function findCandidateRadarMatch(id: string): RadarItem | null {
  const candidate = getCandidateRow(id);
  if (!candidate) throw new DiscoveryRequestError('候选技术不存在', 404);
  return findRadarByUrl(candidate.canonical_url);
}

function resolveRadarItem(
  candidate: CandidateRow,
  input: ImportCandidateInput,
): { radarItem: RadarItem; created: boolean } {
  if (input.radarItemId) {
    const existing = getRadarItem(input.radarItemId);
    if (!existing) throw new DiscoveryRequestError('关联的技术雷达条目不存在', 404);
    return { radarItem: existing, created: false };
  }

  const duplicate = findRadarByUrl(input.url ?? candidate.canonical_url);
  if (duplicate) {
    throw new DiscoveryRequestError(
      '技术雷达中已有相同项目，请选择关联现有条目，避免创建重复记录。',
      409,
      { duplicateRadarItem: duplicate },
    );
  }

  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const title = input.title?.trim() || candidate.title;
  const summary =
    input.summary?.trim() ||
    candidate.description ||
    `来自 ${sourceNames[candidate.source_type]} 的技术发现`;
  const kind = input.kind ?? 'tool';
  const url = input.url?.trim() || candidate.canonical_url;
  db.prepare(
    `INSERT INTO radar_item (id, title, summary, kind, url, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(id, title, summary, kind, url, timestamp, timestamp);
  return { radarItem: getRadarItem(id)!, created: true };
}

export function importDiscoveryCandidate(
  id: string,
  input: ImportCandidateInput = {},
): DiscoveryImportResult {
  const candidate = getCandidateRow(id);
  if (!candidate) throw new DiscoveryRequestError('候选技术不存在', 404);

  if (candidate.radar_item_id) {
    const existing = getRadarItem(candidate.radar_item_id);
    if (existing && candidate.status === 'imported') {
      return {
        candidate: getDiscoveryCandidate(id)!,
        radarItem: existing,
        created: false,
      };
    }
  }

  let result: { candidate: DiscoveryCandidate; radarItem: RadarItem; created: boolean } | null = null;
  const run = db.transaction(() => {
    const current = getCandidateRow(id);
    if (!current) throw new DiscoveryRequestError('候选技术不存在', 404);
    const resolved = resolveRadarItem(current, input);
    const timestamp = nowIso();
    db.prepare(
      `UPDATE discovery_candidate SET status = 'imported', radar_item_id = ?, updated_at = ?
       WHERE id = ?`,
    ).run(resolved.radarItem.id, timestamp, id);
    result = {
      candidate: getDiscoveryCandidate(id)!,
      radarItem: resolved.radarItem,
      created: resolved.created,
    };
  });
  run.immediate();
  return result!;
}

export function ignoreDiscoveryCandidate(id: string): DiscoveryCandidate {
  const candidate = getCandidateRow(id);
  if (!candidate) throw new DiscoveryRequestError('候选技术不存在', 404);
  if (candidate.status === 'imported' || candidate.radar_item_id) {
    throw new DiscoveryRequestError('已收录到技术雷达的候选不能忽略，请先在技术雷达中处理该条目', 409);
  }
  if (candidate.status !== 'ignored') {
    db.prepare("UPDATE discovery_candidate SET status = 'ignored', updated_at = ? WHERE id = ?").run(
      nowIso(),
      id,
    );
  }
  return getDiscoveryCandidate(id)!;
}

export function restoreDiscoveryCandidate(id: string): DiscoveryCandidate {
  const candidate = getCandidateRow(id);
  if (!candidate) throw new DiscoveryRequestError('候选技术不存在', 404);
  if (candidate.status === 'imported' || candidate.radar_item_id) {
    throw new DiscoveryRequestError('已收录到技术雷达的候选无法恢复为待评估', 409);
  }
  if (candidate.status !== 'pending') {
    db.prepare("UPDATE discovery_candidate SET status = 'pending', updated_at = ? WHERE id = ?").run(
      nowIso(),
      id,
    );
  }
  return getDiscoveryCandidate(id)!;
}
