import type {
  LifecycleRecord,
  LifecycleView,
  SoftwareDetail,
  SoftwareSource,
  SoftwareSummary,
  SoftwareTechNodeLink,
  SourceConfig,
  SourceType,
  SyncJob,
  SyncStatus,
  WatchLevel,
  WatchStatus,
} from '../../shared/types.js';
import { db, getSetting, nowIso } from '../db.js';
import { SUPPORT_LABELS } from '../lib/severity.js';
import { findCycle, maxVersion } from '../lib/version.js';
import { getAdvisoryRowsForSoftware, mapAdvisory, refreshAdvisoryInsights } from './advisories.js';
import { listEvents } from './events.js';

interface SoftwareRow {
  id: string;
  name: string;
  slug: string;
  aliases: string;
  category: string;
  logo_url: string | null;
  website: string | null;
  repo: string | null;
  description: string | null;
  watch_status: WatchStatus;
  watch_level: WatchLevel;
  current_version: string | null;
  environment: string | null;
  notes: string | null;
  pinned: number;
  latest_version: string | null;
  latest_release_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SourceRow {
  id: string;
  software_id: string;
  type: SourceType;
  label: string;
  enabled: number;
  config: string;
  last_sync_at: string | null;
  last_status: SyncStatus;
  last_error: string | null;
  last_item_count: number;
}

interface LifecycleRow {
  id: string;
  software_id: string;
  cycle: string;
  release_date: string | null;
  latest_version: string | null;
  latest_release_date: string | null;
  eol_date: string | null;
  eol_raw: string | null;
  support_status: 'supported' | 'approaching_eol' | 'eol' | 'unknown';
  source_url: string | null;
  fetched_at: string;
  source_id: string | null;
}

interface ReleaseRow {
  id: string;
  software_id: string;
  version: string;
  channel: 'stable' | 'prerelease';
  title: string | null;
  notes: string | null;
  url: string | null;
  published_at: string | null;
  first_seen_at: string;
  source_type: SourceType;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function mapSource(row: SourceRow): SoftwareSource {
  const staleHours = Number(getSetting('stale_after_hours', '36'));
  const lastSync = row.last_sync_at;
  const stale = Boolean(
    lastSync && Date.now() - new Date(lastSync).getTime() > staleHours * 60 * 60 * 1000,
  );
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    enabled: Boolean(row.enabled),
    config: parseJson<SourceConfig>(row.config, {}),
    lastSyncAt: row.last_sync_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    lastItemCount: row.last_item_count,
    stale,
  };
}

function getLifecycleView(
  currentVersion: string | null,
  records: LifecycleRow[],
): LifecycleView {
  if (!currentVersion) {
    return {
      status: 'unknown',
      cycle: null,
      eolDate: null,
      latestPatch: null,
      sourceUrl: null,
      lastVerifiedAt: null,
      notice: '尚未配置当前使用版本，无法判断生命周期',
    };
  }
  const current = findCycle(currentVersion, records);
  if (!current) {
    return {
      status: 'unknown',
      cycle: null,
      eolDate: null,
      latestPatch: null,
      sourceUrl: records[0]?.source_url ?? null,
      lastVerifiedAt: records[0]?.fetched_at ?? null,
      notice: '当前版本未匹配到生命周期记录',
    };
  }

  const sameCycle = records.filter((record) => record.cycle === current.cycle);
  const statuses = new Set(sameCycle.map((record) => record.support_status));
  const eolDates = new Set(sameCycle.map((record) => record.eol_date).filter(Boolean));
  const conflict = statuses.size > 1 || eolDates.size > 1;
  const chosen = sameCycle.sort((a, b) => b.fetched_at.localeCompare(a.fetched_at))[0];

  return {
    status: chosen.support_status,
    cycle: chosen.cycle,
    eolDate: chosen.eol_date,
    latestPatch: chosen.latest_version,
    sourceUrl: chosen.source_url,
    lastVerifiedAt: chosen.fetched_at,
    notice: conflict
      ? '不同来源对当前版本的生命周期判断不一致，待核实'
      : chosen.support_status === 'unknown'
        ? '来源未提供明确的支持截止日期'
        : null,
  };
}

export function buildSoftwareSummary(row: SoftwareRow): SoftwareSummary {
  const sources = db
    .prepare('SELECT * FROM software_source WHERE software_id = ? ORDER BY created_at')
    .all(row.id) as SourceRow[];
  const lifecycleRows = db
    .prepare('SELECT * FROM lifecycle_record WHERE software_id = ? ORDER BY cycle DESC')
    .all(row.id) as LifecycleRow[];
  const lifecycle = getLifecycleView(row.current_version, lifecycleRows);
  const advisoryRows = getAdvisoryRowsForSoftware(row.id);
  const open = advisoryRows.filter(
    (advisory) => !['fixed', 'not_affected', 'ignored'].includes(advisory.status),
  );
  const affected = open.filter((advisory) => advisory.version_impact === 'affected');
  const p0 = open.filter((advisory) => advisory.priority === 'P0').length;
  const p1 = open.filter((advisory) => advisory.priority === 'P1').length;

  const successfulSyncs = sources
    .map((source) => source.last_sync_at)
    .filter((value): value is string => Boolean(value))
    .sort();
  const lastSyncAt = successfulSyncs.at(-1) ?? null;
  const mappedSources = sources.map(mapSource);
  const sourceIssueCount = mappedSources.filter(
    (source) => source.enabled && (source.lastStatus === 'error' || source.stale),
  ).length;

  const releases = db
    .prepare(
      `SELECT version, published_at FROM release_record
       WHERE software_id = ? AND channel = 'stable'
       ORDER BY COALESCE(published_at, first_seen_at) DESC LIMIT 100`,
    )
    .all(row.id) as Array<{ version: string; published_at: string | null }>;
  const derivedLatest = maxVersion(releases.map((release) => release.version));
  const defaultCycle = lifecycleRows.find((record) => record.cycle === lifecycle.cycle)
    ?? lifecycleRows.sort((a, b) => b.cycle.localeCompare(a.cycle, undefined, { numeric: true }))[0];
  const latestVersion = row.latest_version || derivedLatest || defaultCycle?.latest_version || null;
  const latestReleaseAt = row.latest_release_at
    ?? releases.find((release) => release.version === latestVersion)?.published_at
    ?? defaultCycle?.latest_release_date
    ?? null;

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    aliases: parseJson<string[]>(row.aliases, []),
    category: row.category,
    logoUrl: row.logo_url,
    website: row.website,
    repo: row.repo,
    description: row.description,
    watchStatus: row.watch_status,
    watchLevel: row.watch_level,
    currentVersion: row.current_version,
    environment: row.environment,
    notes: row.notes,
    pinned: Boolean(row.pinned),
    latestVersion,
    latestReleaseAt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    riskLevel: p0 > 0 ? 'critical' : p1 > 0 ? 'high' : 'normal',
    counts: {
      openVulns: open.length,
      criticalVulns: open.filter((advisory) => advisory.severity === 'critical').length,
      highVulns: open.filter((advisory) => advisory.severity === 'high').length,
      affectedVulns: affected.length,
    },
    lifecycle,
    sources: mappedSources,
    lastSyncAt,
    sourceIssueCount,
  };
}

export function getSoftwareRow(id: string): SoftwareRow | null {
  const row = db
    .prepare('SELECT * FROM software WHERE id = ? AND deleted_at IS NULL')
    .get(id) as SoftwareRow | undefined;
  return row ?? null;
}

export function getSoftwareSummary(id: string): SoftwareSummary | null {
  const row = getSoftwareRow(id);
  return row ? buildSoftwareSummary(row) : null;
}

export function listSoftware(options: { includeArchived?: boolean } = {}): SoftwareSummary[] {
  const rows = db
    .prepare(
      `SELECT * FROM software WHERE deleted_at IS NULL
       ${options.includeArchived ? '' : "AND watch_status != 'archived'"}
       ORDER BY pinned DESC, created_at ASC`,
    )
    .all() as SoftwareRow[];
  return rows.map(buildSoftwareSummary);
}

interface SoftwareTechNodeRow {
  id: string;
  name: string;
  domain_id: string;
  domain_name: string;
  node_type: SoftwareTechNodeLink['nodeType'];
  content_status: SoftwareTechNodeLink['contentStatus'];
  content_markdown: string | null;
  mastery_status: SoftwareTechNodeLink['masteryStatus'];
  applicable_versions: string | null;
  verified_version: string | null;
  content_verified_at: string | null;
  content_updated_at: string | null;
}

export function listSoftwareTechNodes(softwareId: string): SoftwareTechNodeLink[] {
  const rows = db
    .prepare(
      `SELECT tn.id, tn.name, tn.domain_id, td.name AS domain_name, tn.node_type,
         tn.content_status, tn.content_markdown, tn.mastery_status,
         tn.applicable_versions, tn.verified_version, tn.content_verified_at, tn.content_updated_at
       FROM tech_node_software tns
       JOIN tech_nodes tn ON tn.id = tns.node_id AND tn.status = 'active'
       JOIN tech_domains td ON td.id = tn.domain_id
       WHERE tns.software_id = ?
       ORDER BY td.sort_order, tn.sort_order, tn.name`,
    )
    .all(softwareId) as SoftwareTechNodeRow[];
  return rows.map((node) => ({
    id: node.id,
    name: node.name,
    domainId: node.domain_id,
    domainName: node.domain_name,
    nodeType: node.node_type,
    contentStatus: node.content_markdown?.trim() ? node.content_status : 'missing',
    hasContent: Boolean(node.content_markdown?.trim()),
    masteryStatus: node.mastery_status,
    applicableVersions: node.applicable_versions,
    verifiedVersion: node.verified_version,
    contentVerifiedAt: node.content_verified_at,
    contentUpdatedAt: node.content_updated_at,
  }));
}

export function getSoftwareDetail(id: string): SoftwareDetail | null {
  const row = getSoftwareRow(id);
  if (!row) return null;
  const summary = buildSoftwareSummary(row);
  const techNodes = listSoftwareTechNodes(id);
  const sources = db
    .prepare('SELECT * FROM software_source WHERE software_id = ? ORDER BY created_at')
    .all(id) as SourceRow[];
  const lifecycleRows = db
    .prepare(
      `SELECT l.*, ss.type AS source_type FROM lifecycle_record l
       LEFT JOIN software_source ss ON ss.id = l.source_id
       WHERE l.software_id = ? ORDER BY l.cycle DESC`,
    )
    .all(id) as LifecycleRow[];
  const currentCycle = summary.lifecycle.cycle;
  const lifecycle: LifecycleRecord[] = lifecycleRows.map((item) => ({
    id: item.id,
    softwareId: item.software_id,
    cycle: item.cycle,
    releaseDate: item.release_date,
    latestVersion: item.latest_version,
    latestReleaseDate: item.latest_release_date,
    eolDate: item.eol_date,
    supportStatus: item.support_status,
    sourceUrl: item.source_url,
    fetchedAt: item.fetched_at,
    isCurrent: item.cycle === currentCycle,
  }));

  const releaseRows = db
    .prepare(
      `SELECT r.*, ss.type AS source_type FROM release_record r
       LEFT JOIN software_source ss ON ss.id = r.source_id
       WHERE r.software_id = ?
       ORDER BY COALESCE(r.published_at, r.first_seen_at) DESC, r.version DESC LIMIT 150`,
    )
    .all(id) as ReleaseRow[];
  const releases = releaseRows.map((release) => ({
    id: release.id,
    softwareId: release.software_id,
    version: release.version,
    channel: release.channel,
    title: release.title,
    notes: release.notes,
    url: release.url,
    publishedAt: release.published_at,
    firstSeenAt: release.first_seen_at,
    sourceType: release.source_type,
  }));

  const advisories = getAdvisoryRowsForSoftware(id).map(mapAdvisory);
  const events = listEvents({ softwareId: id, limit: 60 });
  const jobs = (
    db
      .prepare(
        `SELECT j.*, s.name AS software_name, ss.label AS source_label
         FROM sync_job j
         JOIN software s ON s.id = j.software_id
         LEFT JOIN software_source ss ON ss.id = j.source_id
         WHERE j.software_id = ? ORDER BY j.started_at DESC LIMIT 60`,
      )
      .all(id) as JobRow[]
  ).map(mapJob);

  return {
    software: summary,
    techNodes,
    releases,
    lifecycle,
    advisories,
    events,
    sources: sources.map(mapSource),
    jobs,
  };
}

interface JobRow {
  id: string;
  software_id: string;
  software_name?: string;
  source_id: string | null;
  source_type: SourceType | null;
  source_label: string | null;
  status: 'running' | 'success' | 'error';
  trigger: 'manual' | 'schedule' | 'initial';
  started_at: string;
  finished_at: string | null;
  items_found: number;
  items_new: number;
  items_updated?: number;
  items_skipped?: number;
  data_changed?: number;
  run_id?: string | null;
  error: string | null;
}

export function mapJob(row: JobRow): SyncJob {
  return {
    id: row.id,
    softwareId: row.software_id,
    softwareName: row.software_name,
    sourceId: row.source_id,
    sourceType: row.source_type,
    sourceLabel: row.source_label,
    status: row.status,
    trigger: row.trigger,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    itemsFound: row.items_found,
    itemsNew: row.items_new,
    itemsUpdated: row.items_updated ?? 0,
    itemsSkipped: row.items_skipped ?? 0,
    dataChanged: Boolean(row.data_changed),
    runId: row.run_id ?? null,
    error: row.error,
  };
}

export interface SoftwareInput {
  name: string;
  aliases?: string[];
  category?: string;
  logoUrl?: string | null;
  website?: string | null;
  repo?: string | null;
  description?: string | null;
  watchLevel?: WatchLevel;
  currentVersion?: string | null;
  environment?: string | null;
  notes?: string | null;
  pinned?: boolean;
  catalogKey?: string | null;
  sources: Array<{
    type: SourceType;
    label: string;
    enabled?: boolean;
    config: SourceConfig;
  }>;
}

function makeSlug(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const fallback = `software-${Date.now().toString(36)}`;
  return base || fallback;
}

function uniqueSlug(name: string): string {
  let slug = makeSlug(name);
  let counter = 1;
  while (db.prepare('SELECT 1 FROM software WHERE slug = ?').get(slug)) {
    slug = `${makeSlug(name)}-${counter}`;
    counter += 1;
  }
  return slug;
}

export function createSoftware(input: SoftwareInput): string {
  const timestamp = nowIso();
  const id = crypto.randomUUID();
  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO software
        (id, name, slug, aliases, category, logo_url, website, repo, description, watch_status,
         watch_level, current_version, environment, notes, pinned, catalog_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name.trim(),
      uniqueSlug(input.name),
      JSON.stringify(input.aliases ?? []),
      input.category?.trim() || '其他',
      input.logoUrl ?? null,
      input.website ?? null,
      input.repo ?? null,
      input.description ?? null,
      input.watchLevel ?? 'normal',
      input.currentVersion?.trim() || null,
      input.environment ?? null,
      input.notes ?? null,
      input.pinned ? 1 : 0,
      input.catalogKey ?? null,
      timestamp,
      timestamp,
    );
    const insertSource = db.prepare(
      `INSERT INTO software_source (id, software_id, type, label, enabled, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const source of input.sources) {
      insertSource.run(
        crypto.randomUUID(),
        id,
        source.type,
        source.label,
        source.enabled === false ? 0 : 1,
        JSON.stringify(source.config),
        timestamp,
        timestamp,
      );
    }
  });
  transaction();
  return id;
}

export interface SoftwarePatch {
  currentVersion?: string | null;
  watchStatus?: WatchStatus;
  watchLevel?: WatchLevel;
  environment?: string | null;
  notes?: string | null;
  pinned?: boolean;
  aliases?: string[];
  category?: string;
  website?: string | null;
  repo?: string | null;
  description?: string | null;
  logoUrl?: string | null;
  name?: string;
  sources?: Array<{ id: string; enabled?: boolean; config?: SourceConfig }>;
}

function canonicalConfig(config: object): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(config).sort(([a], [b]) => a.localeCompare(b))),
  );
}

/**
 * Saves user edits. Returns the ids of enabled sources whose configuration or
 * enabled state actually changed, so callers can rerun only those collectors.
 */
export function updateSoftware(id: string, patch: SoftwarePatch): string[] {
  const row = getSoftwareRow(id);
  if (!row) throw new Error('软件不存在');
  const changedSourceIds: string[] = [];
  const timestamp = nowIso();
  const fields: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };

  if (patch.name !== undefined) assign('name', patch.name.trim());
  if (patch.currentVersion !== undefined) assign('current_version', patch.currentVersion?.trim() || null);
  if (patch.watchStatus !== undefined) assign('watch_status', patch.watchStatus);
  if (patch.watchLevel !== undefined) assign('watch_level', patch.watchLevel);
  if (patch.environment !== undefined) assign('environment', patch.environment);
  if (patch.notes !== undefined) assign('notes', patch.notes);
  if (patch.pinned !== undefined) assign('pinned', patch.pinned ? 1 : 0);
  if (patch.aliases !== undefined) assign('aliases', JSON.stringify(patch.aliases));
  if (patch.category !== undefined) assign('category', patch.category);
  if (patch.website !== undefined) assign('website', patch.website);
  if (patch.repo !== undefined) assign('repo', patch.repo);
  if (patch.description !== undefined) assign('description', patch.description);
  if (patch.logoUrl !== undefined) assign('logo_url', patch.logoUrl);

  const transaction = db.transaction(() => {
    if (fields.length) {
      assign('updated_at', timestamp);
      db.prepare(`UPDATE software SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
    }
    if (patch.sources) {
      const updateSource = db.prepare(
        'UPDATE software_source SET enabled = ?, config = ?, updated_at = ? WHERE id = ? AND software_id = ?',
      );
      for (const source of patch.sources) {
        const current = db
          .prepare('SELECT config, enabled FROM software_source WHERE id = ? AND software_id = ?')
          .get(source.id, id) as { config: string; enabled: number } | undefined;
        if (!current) continue;
        const nextEnabled = source.enabled === undefined ? Boolean(current.enabled) : source.enabled;
        const nextConfig = source.config ?? parseJson<SourceConfig>(current.config, {});
        const configChanged =
          canonicalConfig(nextConfig) !== canonicalConfig(parseJson<SourceConfig>(current.config, {}));
        const enabledChanged = nextEnabled !== Boolean(current.enabled);
        updateSource.run(
          nextEnabled ? 1 : 0,
          JSON.stringify(nextConfig),
          timestamp,
          source.id,
          id,
        );
        if (nextEnabled && (configChanged || enabledChanged)) {
          changedSourceIds.push(source.id);
        }
      }
    }
  });
  transaction();

  if (patch.currentVersion !== undefined && row.current_version !== patch.currentVersion) {
    refreshAdvisoryInsights(id);
  }
  return changedSourceIds;
}

export function archiveSoftware(id: string): void {
  db.prepare('UPDATE software SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), id);
}

export function setSourceResult(
  sourceId: string,
  result: { ok: boolean; itemCount?: number; error?: string },
): void {
  const timestamp = nowIso();
  if (result.ok) {
    db.prepare(
      `UPDATE software_source SET last_sync_at = ?, last_status = 'ok', last_error = NULL,
        last_item_count = ?, updated_at = ? WHERE id = ?`,
    ).run(timestamp, result.itemCount ?? 0, timestamp, sourceId);
  } else {
    db.prepare(
      `UPDATE software_source SET last_status = 'error', last_error = ?, updated_at = ? WHERE id = ?`,
    ).run(result.error ?? '未知错误', timestamp, sourceId);
  }
}

export function countSoftware(): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM software WHERE deleted_at IS NULL AND watch_status = 'active'")
    .get() as { count: number };
  return row.count;
}

export const SUPPORT_LABEL = SUPPORT_LABELS;
