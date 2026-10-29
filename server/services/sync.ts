import type { Priority, SourceType, SyncJob, VersionRange } from '../../shared/types.js';
import { db, nowIso } from '../db.js';
import { fetchEndOfLife } from '../adapters/endoflife.js';
import { fetchGitHubAdvisories, fetchGitHubReleases } from '../adapters/github.js';
import { fetchNvd } from '../adapters/nvd.js';
import { fetchCisaKev } from '../adapters/cisa.js';
import type { AdapterContext, AdapterResult, RawAdvisory, RawLifecycle, RawRelease } from '../adapters/types.js';
import { findCycle, maxVersion } from '../lib/version.js';
import { severityRank } from '../lib/severity.js';
import { upsertAdvisory, refreshAdvisoryInsights } from './advisories.js';
import { upsertEvent } from './events.js';
import { mapJob, setSourceResult } from './software.js';

interface SourceRow {
  id: string;
  software_id: string;
  type: SourceType;
  label: string;
  enabled: number;
  config: string;
  last_sync_at: string | null;
}

interface SoftwareRow {
  id: string;
  name: string;
  current_version: string | null;
}

const locks = new Set<string>();

export function isSoftwareSyncing(id: string): boolean {
  return locks.has(id);
}

export interface SyncRunResult {
  ok: boolean;
  busy?: boolean;
  jobs: SyncJob[];
  error?: string;
}

function parseConfig(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, value == null ? '' : String(value)]),
    );
  } catch {
    return {};
  }
}

function sourceName(type: SourceType): string {
  return {
    endoflife: 'endoflife.date',
    github_releases: 'GitHub Releases',
    github_advisories: 'GitHub Advisory',
    nvd: 'NVD',
    cisa_kev: 'CISA KEV',
    upstream_advisory: '上游公告',
  }[type];
}

async function runAdapter(type: SourceType, context: AdapterContext): Promise<AdapterResult> {
  switch (type) {
    case 'endoflife':
      return fetchEndOfLife(context);
    case 'github_releases':
      return fetchGitHubReleases(context);
    case 'github_advisories':
      return fetchGitHubAdvisories(context);
    case 'nvd':
      return fetchNvd(context);
    case 'cisa_kev':
      return fetchCisaKev(context);
    case 'upstream_advisory':
      throw new Error('上游公告适配器尚未配置，请在后续版本中接入');
    default:
      throw new Error(`未知数据源类型：${type}`);
  }
}

function insertJob(softwareId: string, sourceId: string, sourceType: SourceType, trigger: string): string {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO sync_job (id, software_id, source_id, source_type, status, trigger, started_at)
     VALUES (?, ?, ?, ?, 'running', ?, ?)`,
  ).run(id, softwareId, sourceId, sourceType, trigger, nowIso());
  return id;
}

function finishJob(
  id: string,
  result: { status: 'success' | 'error'; itemsFound: number; itemsNew: number; error?: string | null },
): void {
  db.prepare(
    `UPDATE sync_job SET status = ?, finished_at = ?, items_found = ?, items_new = ?, error = ? WHERE id = ?`,
  ).run(result.status, nowIso(), result.itemsFound, result.itemsNew, result.error ?? null, id);
}

function getJob(id: string): SyncJob | null {
  const row = db
    .prepare(
      `SELECT j.*, s.name AS software_name, ss.label AS source_label
       FROM sync_job j JOIN software s ON s.id = j.software_id
       LEFT JOIN software_source ss ON ss.id = j.source_id WHERE j.id = ?`,
    )
    .get(id);
  return row ? mapJob(row as Parameters<typeof mapJob>[0]) : null;
}

function handleLifecycle(
  software: SoftwareRow,
  source: SourceRow,
  rows: RawLifecycle[],
): { createdEvents: number; created: number } {
  let createdEvents = 0;
  let created = 0;
  const findExisting = db.prepare(
    'SELECT support_status, eol_date FROM lifecycle_record WHERE software_id = ? AND source_id = ? AND cycle = ?',
  );
  const upsert = db.prepare(
    `INSERT INTO lifecycle_record
      (id, software_id, source_id, cycle, release_date, latest_version, latest_release_date,
       eol_date, eol_raw, support_status, source_url, fetched_at, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(software_id, source_id, cycle) DO UPDATE SET
       release_date = excluded.release_date, latest_version = excluded.latest_version,
       latest_release_date = excluded.latest_release_date, eol_date = excluded.eol_date,
       eol_raw = excluded.eol_raw, support_status = excluded.support_status,
       source_url = excluded.source_url, fetched_at = excluded.fetched_at, raw = excluded.raw`,
  );
  const currentCycle = software.current_version
    ? findCycle(software.current_version, rows.map((row) => ({ cycle: row.cycle })))
    : null;

  for (const row of rows) {
    const previous = findExisting.get(software.id, source.id, row.cycle) as
      | { support_status: string; eol_date: string | null }
      | undefined;
    upsert.run(
      crypto.randomUUID(),
      software.id,
      source.id,
      row.cycle,
      row.releaseDate,
      row.latestVersion,
      row.latestReleaseDate,
      row.eolDate,
      JSON.stringify(row.raw),
      row.supportStatus,
      row.sourceUrl,
      nowIso(),
      JSON.stringify(row.raw),
    );

    if (!previous) created += 1;
    const isCurrent = currentCycle?.cycle === row.cycle;
    const becameRisky =
      isCurrent &&
      ['approaching_eol', 'eol'].includes(row.supportStatus) &&
      (!previous || previous.support_status !== row.supportStatus || previous.eol_date !== row.eolDate);
    if (becameRisky) {
      const label = row.supportStatus === 'eol' ? '已停止支持' : '即将停止支持';
      upsertEvent({
        type: 'lifecycle',
        softwareId: software.id,
        refId: `${row.cycle}`,
        title: `${software.name} ${row.cycle} ${label}`,
        summary: row.eolDate ? `维护截止日期：${row.eolDate}` : '来源未提供维护截止日期',
        priority: row.supportStatus === 'eol' ? 'P1' : 'P2',
        sourceName: sourceName(source.type),
        sourceUrl: row.sourceUrl,
        upstreamPublishedAt: row.eolDate,
        dedupeKey: `lifecycle:${software.id}:${row.cycle}:${row.supportStatus}:${row.eolDate ?? ''}`,
      });
      createdEvents += 1;
    }
  }

  return { createdEvents, created };
}

function handleReleases(
  software: SoftwareRow,
  source: SourceRow,
  rows: RawRelease[],
  initial: boolean,
): { createdEvents: number; created: number } {
  let createdEvents = 0;
  let created = 0;
  const existing = db.prepare(
    'SELECT id FROM release_record WHERE software_id = ? AND source_id = ? AND external_id = ?',
  );
  const upsert = db.prepare(
    `INSERT INTO release_record
      (id, software_id, source_id, external_id, version, channel, title, notes, url, published_at, first_seen_at, fetched_at, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(software_id, source_id, external_id) DO UPDATE SET
       version = excluded.version, channel = excluded.channel, title = excluded.title,
       notes = excluded.notes, url = excluded.url, published_at = excluded.published_at,
       fetched_at = excluded.fetched_at, raw = excluded.raw`,
  );
  const newestStable = [...rows]
    .filter((row) => row.channel === 'stable')
    .sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')))[0];
  const timestamp = nowIso();

  for (const row of rows) {
    const previous = existing.get(software.id, source.id, row.externalId);
    upsert.run(
      crypto.randomUUID(),
      software.id,
      source.id,
      row.externalId,
      row.version,
      row.channel,
      row.title,
      row.notes,
      row.url,
      row.publishedAt,
      timestamp,
      timestamp,
      JSON.stringify(row.raw),
    );
    if (!previous) {
      created += 1;
      const shouldCreate = row.channel === 'stable' && (!initial || newestStable?.externalId === row.externalId);
      if (shouldCreate) {
        upsertEvent({
          type: 'release',
          softwareId: software.id,
          refId: null,
          title: `${software.name} 发布 ${row.version}`,
          summary: row.title && row.title !== row.version ? row.title : null,
          priority: 'P3',
          sourceName: sourceName(source.type),
          sourceUrl: row.url,
          upstreamPublishedAt: row.publishedAt,
          dedupeKey: `release:${software.id}:${row.version}`,
        });
        createdEvents += 1;
      }
    }
  }
  return { createdEvents, created };
}

function handleAdvisories(
  software: SoftwareRow,
  source: SourceRow,
  rows: RawAdvisory[],
  initial: boolean,
  alreadyCreated: number,
): { createdEvents: number; created: number } {
  let createdEvents = 0;
  let created = 0;
  const sorted = [...rows].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const initialCap = 30;

  for (const row of sorted) {
    const result = upsertAdvisory(software.id, source.id, row);
    if (!result.created) continue;
    created += 1;
    if (initial && alreadyCreated + createdEvents >= initialCap) continue;
    if (result.priority === 'P3' && initial) continue;
    upsertEvent({
      type: 'vulnerability',
      softwareId: software.id,
      refId: result.id,
      title: `${row.identifier} · ${row.title}`,
      summary: `${severityLabel(row)}${row.affectedRanges.length ? ' · 已获取受影响版本范围' : ' · 受影响范围待核实'}`,
      priority: result.priority,
      sourceName: sourceName(source.type),
      sourceUrl: result.url,
      upstreamPublishedAt: result.publishedAt,
      dedupeKey: `vulnerability:${software.id}:${result.id}`,
    });
    createdEvents += 1;
  }
  return { createdEvents, created };
}

function severityLabel(row: Pick<RawAdvisory, 'severity' | 'score'>): string {
  const label = { critical: '严重', high: '高危', medium: '中危', low: '低危', unknown: '未知' }[row.severity];
  return `${label}${row.score != null ? ` · CVSS ${row.score}` : ''}`;
}

function refreshSoftwareLatest(softwareId: string): void {
  const releases = db
    .prepare(
      `SELECT version, published_at FROM release_record
       WHERE software_id = ? AND channel = 'stable'`,
    )
    .all(softwareId) as Array<{ version: string; published_at: string | null }>;
  const lifecycle = db
    .prepare(
      `SELECT latest_version, latest_release_date FROM lifecycle_record
       WHERE software_id = ? ORDER BY fetched_at DESC`,
    )
    .all(softwareId) as Array<{ latest_version: string | null; latest_release_date: string | null }>;

  const candidates = [
    ...releases.map((release) => release.version),
    ...lifecycle.map((row) => row.latest_version).filter((version): version is string => Boolean(version)),
  ];
  const latest = maxVersion(candidates);
  const release = releases.find((item) => item.version === latest);
  const lifecycleMatch = lifecycle.find((item) => item.latest_version === latest);
  db.prepare('UPDATE software SET latest_version = ?, latest_release_at = ?, updated_at = ? WHERE id = ?').run(
    latest,
    release?.published_at ?? lifecycleMatch?.latest_release_date ?? null,
    nowIso(),
    softwareId,
  );
}

/**
 * Keep the vulnerability event in sync with CISA KEV. The KEV adapter updates
 * advisory rows directly (a feed-level operation), so this runs after every
 * sync and is idempotent: it updates the existing event instead of creating a
 * second event for the same advisory.
 */
function refreshAdvisoryEvents(softwareId: string): void {
  const rows = db
    .prepare(
      `SELECT a.id, a.identifier, a.title, a.severity, a.score, a.kev, a.priority,
              s.name AS software_name,
              e.id AS event_id
       FROM security_advisory a
       JOIN software s ON s.id = a.software_id
       LEFT JOIN intelligence_event e ON e.ref_id = a.id AND e.type = 'vulnerability'
       WHERE a.software_id = ?`,
    )
    .all(softwareId) as Array<{
      id: string;
      identifier: string;
      title: string;
      severity: RawAdvisory['severity'];
      score: number | null;
      kev: number;
      priority: Priority;
      software_name: string;
      event_id: string | null;
    }>;

  for (const row of rows) {
    const kev = Boolean(row.kev);
    if (!kev && !row.event_id) continue;
    upsertEvent({
      type: 'vulnerability',
      softwareId,
      refId: row.id,
      title: kev
        ? `${row.identifier} · ${row.title}（KEV 已利用）`
        : `${row.identifier} · ${row.title}`,
      summary: kev
        ? `${severityLabel({ severity: row.severity, score: row.score })} · CISA KEV 已确认实际利用`
        : null,
      priority: row.priority,
      sourceName: kev ? 'CISA KEV' : null,
      sourceUrl: kev
        ? 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog'
        : null,
      dedupeKey: `vulnerability:${softwareId}:${row.id}`,
    });
  }
}

function refreshHighestAffectedEventPriority(softwareId: string): void {
  const rows = db
    .prepare(
      `SELECT id, priority FROM security_advisory WHERE software_id = ?
       AND version_impact = 'affected' ORDER BY priority`,
    )
    .all(softwareId) as Array<{ id: string; priority: Priority }>;
  for (const row of rows) {
    db.prepare('UPDATE intelligence_event SET priority = ? WHERE ref_id = ? AND type = ?').run(
      row.priority,
      row.id,
      'vulnerability',
    );
  }
}

export async function syncSoftware(
  softwareId: string,
  options: { trigger: 'manual' | 'schedule' | 'initial'; sourceIds?: string[] } = { trigger: 'manual' },
): Promise<SyncRunResult> {
  if (locks.has(softwareId)) {
    return { ok: false, busy: true, jobs: [], error: '该软件正在同步中' };
  }
  const software = db
    .prepare('SELECT id, name, current_version FROM software WHERE id = ? AND deleted_at IS NULL')
    .get(softwareId) as SoftwareRow | undefined;
  if (!software) return { ok: false, jobs: [], error: '软件不存在' };

  let sources = db
    .prepare('SELECT * FROM software_source WHERE software_id = ? AND enabled = 1 ORDER BY created_at')
    .all(softwareId) as SourceRow[];
  if (options.sourceIds?.length) {
    sources = sources.filter((source) => options.sourceIds?.includes(source.id));
  }
  if (!sources.length) return { ok: false, jobs: [], error: '没有启用的数据源' };

  locks.add(softwareId);
  const jobs: SyncJob[] = [];
  let anySuccess = false;
  try {
    const advisoryCountBefore = (
      db.prepare('SELECT COUNT(*) AS count FROM security_advisory WHERE software_id = ?').get(softwareId) as {
        count: number;
      }
    ).count;
    let advisoryEventsCreated = 0;

    for (const source of sources) {
      const jobId = insertJob(softwareId, source.id, source.type, options.trigger);
      const initial = !source.last_sync_at;
      const context: AdapterContext = {
        sourceId: source.id,
        softwareId,
        config: parseConfig(source.config),
      };

      try {
        const result = await runAdapter(source.type, context);
        let itemsNew = 0;
        let eventCount = 0;

        if (result.lifecycle?.length) {
          const lifecycleResult = handleLifecycle(software, source, result.lifecycle);
          itemsNew += lifecycleResult.created;
          eventCount += lifecycleResult.createdEvents;
        }
        if (result.releases?.length) {
          const releaseResult = handleReleases(software, source, result.releases, initial);
          itemsNew += releaseResult.created;
          eventCount += releaseResult.createdEvents;
        }
        if (result.advisories?.length) {
          const advisoryResult = handleAdvisories(
            software,
            source,
            result.advisories,
            initial || advisoryCountBefore === 0,
            advisoryEventsCreated,
          );
          itemsNew += advisoryResult.created;
          eventCount += advisoryResult.createdEvents;
          advisoryEventsCreated += advisoryResult.createdEvents;
        }

        finishJob(jobId, {
          status: 'success',
          itemsFound: result.itemCount,
          itemsNew,
        });
        setSourceResult(source.id, { ok: true, itemCount: result.itemCount });
        anySuccess = true;
        const job = getJob(jobId);
        if (job) jobs.push(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        finishJob(jobId, { status: 'error', itemsFound: 0, itemsNew: 0, error: message });
        setSourceResult(source.id, { ok: false, error: message });
        const job = getJob(jobId);
        if (job) jobs.push(job);
      }
    }

    refreshAdvisoryInsights(softwareId);
    refreshAdvisoryEvents(softwareId);
    refreshHighestAffectedEventPriority(softwareId);
    refreshSoftwareLatest(softwareId);

    return {
      ok: anySuccess,
      jobs,
      error: anySuccess ? undefined : jobs[0]?.error ?? '所有数据源采集失败',
    };
  } finally {
    locks.delete(softwareId);
  }
}

export async function syncAllActive(trigger: 'manual' | 'schedule' = 'schedule'): Promise<{
  total: number;
  succeeded: number;
  failed: number;
}> {
  const rows = db
    .prepare(
      "SELECT id FROM software WHERE deleted_at IS NULL AND watch_status = 'active' ORDER BY created_at",
    )
    .all() as Array<{ id: string }>;
  let succeeded = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await syncSoftware(row.id, { trigger });
    if (result.ok) succeeded += 1;
    else failed += 1;
  }
  return { total: rows.length, succeeded, failed };
}

export function listJobs(options: { softwareId?: string; limit?: number } = {}): SyncJob[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.softwareId) {
    clauses.push('j.software_id = ?');
    params.push(options.softwareId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT j.*, s.name AS software_name, ss.label AS source_label
       FROM sync_job j JOIN software s ON s.id = j.software_id
       LEFT JOIN software_source ss ON ss.id = j.source_id
       ${where} ORDER BY j.started_at DESC LIMIT ?`,
    )
    .all(...params, Math.min(options.limit ?? 100, 300));
  return rows.map((row) => mapJob(row as Parameters<typeof mapJob>[0]));
}

export function runningJobCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM sync_job WHERE status = 'running'").get() as {
    count: number;
  };
  return row.count;
}
