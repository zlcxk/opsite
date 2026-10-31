import crypto from 'node:crypto';
import type { TechContentSource, TechContentStatus, TechExternalLink } from '../../shared/types.js';
import { db, nowIso } from '../db.js';
import { KUBERNETES_CONTENT } from './tech-content-kubernetes.js';
import { KUBERNETES_DOCS } from './tech-content-kubernetes-docs.js';
import { PROMETHEUS_CONTENT } from './tech-content-prometheus.js';
import { PROMETHEUS_DOCS } from './tech-content-prometheus-docs.js';
import { P2_CONTENT } from './tech-content-p2.js';

/**
 * A knowledge card for an existing technology node. Every field is optional:
 * the seed only fills columns that are still empty, so a user edit always wins.
 */
export interface TechCardContent {
  description?: string;
  technicalRole?: string;
  solvedProblem?: string;
  corePrinciple?: string;
  keyMechanism?: string;
  useCases?: string;
  commonIssues?: string;
}

export interface TechContentEntry extends TechCardContent {
  nodeId: string;
  /** Bump this when the authored content for the node changes materially. */
  version?: number;
  contentMarkdown?: string;
  contentStatus?: TechContentStatus;
  contentSource?: TechContentSource;
  applicableVersions?: string;
  /** Fills the node's existing docs/repo fields only when they are empty. */
  docsUrl?: string;
  repoUrl?: string;
  referenceLinks?: TechExternalLink[];
  /**
   * A one-time content revision is allowed only when the stored Markdown still
   * matches the previous authored version. This upgrades untouched seeds
   * without ever overwriting a document the user has edited or verified.
   */
  replacesContentHash?: string;
}

const CARD_COLUMNS: Array<{ key: keyof TechCardContent; column: string }> = [
  { key: 'description', column: 'description' },
  { key: 'technicalRole', column: 'technical_role' },
  { key: 'solvedProblem', column: 'solved_problem' },
  { key: 'corePrinciple', column: 'core_principle' },
  { key: 'keyMechanism', column: 'key_mechanism' },
  { key: 'useCases', column: 'use_cases' },
  { key: 'commonIssues', column: 'common_issues' },
];

interface NodeContentRow {
  id: string;
  description: string | null;
  technical_role: string | null;
  solved_problem: string | null;
  core_principle: string | null;
  key_mechanism: string | null;
  use_cases: string | null;
  common_issues: string | null;
  content_markdown: string | null;
  content_source: string | null;
  applicable_versions: string | null;
  docs_url: string | null;
  repo_url: string | null;
  reference_links: string | null;
  content_status: TechContentStatus;
  content_verified_at: string | null;
}

function isEmpty(value: string | null | undefined): boolean {
  return !value || !value.trim();
}

function hasReferenceLinks(value: string | null): boolean {
  if (isEmpty(value)) return false;
  try {
    const parsed = JSON.parse(value!);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return true;
  }
}

function hashMarkdown(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Merge entries for the same node without letting an absent value erase a
 * field that an earlier source explicitly provided. Later entries win when
 * they actually define a value; undefined, null, empty strings and empty
 * arrays are treated as "not provided".
 */
export function mergeDefined(base: TechContentEntry, override: TechContentEntry): TechContentEntry {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override) as Array<
    [keyof TechContentEntry, TechContentEntry[keyof TechContentEntry]]
  >) {
    const meaningful =
      value !== undefined &&
      value !== null &&
      !(typeof value === 'string' && !value.trim()) &&
      !(Array.isArray(value) && value.length === 0);
    if (meaningful) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

function mergeEntries(entries: TechContentEntry[]): TechContentEntry[] {
  const merged = new Map<string, TechContentEntry>();
  for (const entry of entries) {
    const current = merged.get(entry.nodeId);
    merged.set(entry.nodeId, current ? mergeDefined(current, entry) : entry);
  }
  return [...merged.values()];
}

export const TECH_CONTENT_ENTRIES: TechContentEntry[] = mergeEntries([
  ...KUBERNETES_CONTENT,
  ...KUBERNETES_DOCS,
  ...PROMETHEUS_CONTENT,
  ...PROMETHEUS_DOCS,
  ...P2_CONTENT,
]);

export interface TechContentSeedResult {
  /** Entries whose empty fields were filled. */
  applied: number;
  /** Entries skipped because their version was already applied. */
  skipped: number;
  /** Entries whose node no longer exists. */
  missing: number;
}

function applyEntry(entry: TechContentEntry, timestamp: string, force: boolean): boolean {
  const row = db.prepare('SELECT * FROM tech_nodes WHERE id = ?').get(entry.nodeId) as
    | NodeContentRow
    | undefined;
  if (!row) return false;

  const updates: Array<{ column: string; value: string }> = [];
  for (const { key, column } of CARD_COLUMNS) {
    const authored = entry[key];
    if (authored && isEmpty(row[column as keyof NodeContentRow] as string | null)) {
      updates.push({ column, value: authored });
    }
  }

  // A revision may replace a base document only when its bytes are exactly the
  // previous authored version. User edits and explicit verifications always win.
  const canReplace =
    Boolean(entry.replacesContentHash && row.content_markdown) &&
    hashMarkdown(row.content_markdown!) === entry.replacesContentHash &&
    row.content_status === 'draft' &&
    !row.content_verified_at;

  if (entry.contentMarkdown && (isEmpty(row.content_markdown) || canReplace)) {
    updates.push({ column: 'content_markdown', value: entry.contentMarkdown });
    updates.push({ column: 'content_status', value: entry.contentStatus ?? 'draft' });
    updates.push({ column: 'content_updated_at', value: timestamp });
  }
  if (entry.contentSource && isEmpty(row.content_source)) {
    updates.push({ column: 'content_source', value: entry.contentSource });
  }
  if (entry.applicableVersions && (isEmpty(row.applicable_versions) || canReplace)) {
    updates.push({ column: 'applicable_versions', value: entry.applicableVersions });
  }
  if (entry.docsUrl && isEmpty(row.docs_url)) {
    updates.push({ column: 'docs_url', value: entry.docsUrl });
  }
  if (entry.repoUrl && isEmpty(row.repo_url)) {
    updates.push({ column: 'repo_url', value: entry.repoUrl });
  }
  if (entry.referenceLinks?.length && !hasReferenceLinks(row.reference_links)) {
    updates.push({ column: 'reference_links', value: JSON.stringify(entry.referenceLinks) });
  }

  if (updates.length) {
    const assignments = updates.map((update) => `${update.column} = ?`).join(', ');
    db.prepare(`UPDATE tech_nodes SET ${assignments}, updated_at = ? WHERE id = ?`).run(
      ...updates.map((update) => update.value),
      timestamp,
      entry.nodeId,
    );
  }

  const version = entry.version ?? 1;
  db.prepare(
    `INSERT INTO tech_content_seed (key, version, applied_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET version = excluded.version, applied_at = excluded.applied_at`,
  ).run(entry.nodeId, version, timestamp);

  // "force" is only used for freshly inserted template nodes: they cannot have
  // user content yet, and their entry version may already be recorded.
  void force;
  return updates.length > 0;
}

/**
 * Applies authored technology knowledge to existing nodes.
 *
 * - Entries are matched by fixed node id.
 * - Only empty columns are filled; user edits are never overwritten.
 * - Each node id has a version record, so repeated startup runs are no-ops.
 * - `nodeIds` re-applies entries for nodes that were just created by a template.
 */
export function seedTechContent(options: { nodeIds?: Set<string>; force?: boolean } = {}): TechContentSeedResult {
  const result: TechContentSeedResult = { applied: 0, skipped: 0, missing: 0 };
  const timestamp = nowIso();
  const appliedRows = db
    .prepare('SELECT key, version FROM tech_content_seed')
    .all() as Array<{ key: string; version: number }>;
  const applied = new Map(appliedRows.map((row) => [row.key, row.version]));
  const only = options.nodeIds;

  const run = db.transaction(() => {
    for (const entry of TECH_CONTENT_ENTRIES) {
      if (only && !only.has(entry.nodeId)) continue;
      const version = entry.version ?? 1;
      const current = applied.get(entry.nodeId);
      const requiresForce = Boolean(options.force && only);
      if (!requiresForce && current !== undefined && current >= version) {
        result.skipped += 1;
        continue;
      }
      const exists = db.prepare('SELECT 1 FROM tech_nodes WHERE id = ?').get(entry.nodeId);
      if (!exists) {
        result.missing += 1;
        continue;
      }
      if (applyEntry(entry, timestamp, requiresForce)) result.applied += 1;
      else result.skipped += 1;
      applied.set(entry.nodeId, version);
    }
  });
  run();
  return result;
}

/** Exposed for diagnostics and tests. */
export function contentEntryForNode(nodeId: string): TechContentEntry | undefined {
  return TECH_CONTENT_ENTRIES.find((entry) => entry.nodeId === nodeId);
}

/** Applies one authored entry. Exposed so the hash-gated upgrade path can be
 * tested against controlled documents without relying on a real old database. */
export function applyTechContentEntry(
  entry: TechContentEntry,
  timestamp = nowIso(),
): boolean {
  return applyEntry(entry, timestamp, false);
}
