import type {
  KnowledgeNote,
  TechContentCounts,
  TechContentSource,
  TechContentStatus,
  TechDomain,
  TechDomainDetail,
  TechDomainSummary,
  TechFocusLevel,
  TechGraphData,
  TechGraphEdge,
  TechGraphNode,
  TechMasteryCounts,
  TechMasteryStatus,
  TechNode,
  TechNodeDetail,
  TechNodeListResponse,
  TechNodeSummary,
  TechNodeType,
  TechOverview,
  TechRelation,
  TechRelationType,
  TechRelationWithNodes,
  TechSoftwareLink,
  TechTemplateApplyResult,
  TechTemplateSummary,
  TechTreeNode,
  TechView,
  TechViewDetail,
  TechViewSummary,
  TechViewType,
} from '../../shared/types.js';
import { db, nowIso } from '../db.js';
import { getDiscoveryCandidate } from './discovery.js';
import { listEvents } from './events.js';
import { getRadarItem } from './notes.js';
import { listNotes } from './notes.js';
import { getSoftwareSummary } from './software.js';
import { applyTechTemplate, seedTemplateRelations, TECH_TEMPLATES } from './tech-seed.js';

export class TechRequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'TechRequestError';
    this.status = status;
  }
}

export const TECH_NODE_TYPES: TechNodeType[] = [
  'domain',
  'concept',
  'component',
  'resource',
  'protocol',
  'practice',
  'direction',
];
export const TECH_MASTERY_STATUSES: TechMasteryStatus[] = [
  'unknown',
  'to_learn',
  'learning',
  'understood',
  'mastered',
  'deep_dive',
];
export const TECH_FOCUS_LEVELS: TechFocusLevel[] = ['normal', 'focus'];
export const TECH_RELATION_TYPES: TechRelationType[] = [
  'contains',
  'depends_on',
  'based_on',
  'extends',
  'alternative',
  'implements',
  'related',
];
export const TECH_VIEW_TYPES: TechViewType[] = ['architecture', 'workflow', 'relation', 'deployment'];
export const TECH_CONTENT_STATUSES: TechContentStatus[] = [
  'missing',
  'draft',
  'complete',
  'needs_review',
];
export const TECH_CONTENT_SOURCES: TechContentSource[] = [
  'official',
  'practice',
  'curated',
  'mixed',
];

interface DomainRow {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  cover: string | null;
  status: 'active' | 'archived';
  focus_level: TechFocusLevel;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface NodeRow {
  id: string;
  domain_id: string;
  parent_id: string | null;
  name: string;
  node_type: TechNodeType;
  summary: string | null;
  description: string | null;
  technical_role: string | null;
  core_principle: string | null;
  solved_problem: string | null;
  key_mechanism: string | null;
  use_cases: string | null;
  common_issues: string | null;
  docs_url: string | null;
  repo_url: string | null;
  reference_links: string;
  personal_notes: string | null;
  research_questions: string | null;
  content_markdown: string | null;
  content_status: TechContentStatus;
  content_source: TechContentSource | null;
  applicable_versions: string | null;
  content_updated_at: string | null;
  content_verified_at: string | null;
  verified_version: string | null;
  mastery_status: TechMasteryStatus;
  focus_level: TechFocusLevel;
  status: 'active' | 'archived';
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface RelationRow {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relation_type: TechRelationType;
  description: string | null;
  created_at: string;
}

interface ViewRow {
  id: string;
  domain_id: string;
  name: string;
  description: string | null;
  view_type: TechViewType;
  graph_data: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const emptyMastery = (): TechMasteryCounts => ({
  unknown: 0,
  to_learn: 0,
  learning: 0,
  understood: 0,
  mastered: 0,
  deep_dive: 0,
});

function mapDomain(row: DomainRow): TechDomain {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    cover: row.cover,
    status: row.status,
    focusLevel: row.focus_level,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hasMarkdownContent(value: string | null | undefined): boolean {
  return Boolean(value && value.trim());
}

function effectiveContentStatus(row: NodeRow): TechContentStatus {
  return hasMarkdownContent(row.content_markdown) ? row.content_status : 'missing';
}

function mapNodeSummary(row: NodeRow, childCount = 0): TechNodeSummary {
  return {
    id: row.id,
    domainId: row.domain_id,
    parentId: row.parent_id,
    name: row.name,
    nodeType: row.node_type,
    summary: row.summary,
    status: row.status,
    masteryStatus: row.mastery_status,
    focusLevel: row.focus_level,
    contentStatus: effectiveContentStatus(row),
    hasContent: hasMarkdownContent(row.content_markdown),
    sortOrder: row.sort_order,
    childCount,
    updatedAt: row.updated_at,
  };
}

function parseLinks(value: string): Array<{ label: string; url: string }> {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          typeof entry.label === 'string' &&
          typeof entry.url === 'string' &&
          /^https?:\/\//i.test(entry.url),
      )
      .map((entry) => ({ label: String(entry.label), url: String(entry.url) }));
  } catch {
    return [];
  }
}

function mapNode(row: NodeRow, childCount: number): TechNode {
  return {
    ...mapNodeSummary(row, childCount),
    description: row.description,
    technicalRole: row.technical_role,
    corePrinciple: row.core_principle,
    solvedProblem: row.solved_problem,
    keyMechanism: row.key_mechanism,
    useCases: row.use_cases,
    commonIssues: row.common_issues,
    docsUrl: row.docs_url,
    repoUrl: row.repo_url,
    referenceLinks: parseLinks(row.reference_links),
    researchQuestions: row.research_questions,
    personalNotes: row.personal_notes,
    contentMarkdown: row.content_markdown,
    contentStatus: effectiveContentStatus(row),
    contentSource: row.content_source,
    applicableVersions: row.applicable_versions,
    contentUpdatedAt: row.content_updated_at,
    contentVerifiedAt: row.content_verified_at,
    verifiedVersion: row.verified_version,
    createdAt: row.created_at,
  };
}

function mapRelation(row: RelationRow): TechRelation {
  return {
    id: row.id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    relationType: row.relation_type,
    description: row.description,
    createdAt: row.created_at,
  };
}

function parseGraphData(value: string): TechGraphData {
  try {
    const parsed = JSON.parse(value);
    if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
      return { nodes: parsed.nodes, edges: parsed.edges };
    }
  } catch {
    // fall through to empty graph
  }
  return { nodes: [], edges: [] };
}

function mapViewSummary(row: ViewRow): TechViewSummary {
  const graph = parseGraphData(row.graph_data);
  return {
    id: row.id,
    domainId: row.domain_id,
    name: row.name,
    description: row.description,
    viewType: row.view_type,
    sortOrder: row.sort_order,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapView(row: ViewRow): TechView {
  return {
    id: row.id,
    domainId: row.domain_id,
    name: row.name,
    description: row.description,
    viewType: row.view_type,
    graphData: parseGraphData(row.graph_data),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function childCounts(domainId?: string): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT parent_id AS parent_id, COUNT(*) AS count FROM tech_nodes
       WHERE status = 'active' AND parent_id IS NOT NULL ${domainId ? 'AND domain_id = ?' : ''}
       GROUP BY parent_id`,
    )
    .all(...(domainId ? [domainId] : [])) as Array<{ parent_id: string; count: number }>;
  return new Map(rows.map((row) => [row.parent_id, row.count]));
}

function getNodeRow(id: string): NodeRow | undefined {
  return db.prepare('SELECT * FROM tech_nodes WHERE id = ?').get(id) as NodeRow | undefined;
}

function getNodeSummary(id: string): TechNodeSummary | null {
  const row = getNodeRow(id);
  if (!row) return null;
  const count = db
    .prepare("SELECT COUNT(*) AS count FROM tech_nodes WHERE parent_id = ? AND status = 'active'")
    .get(id) as { count: number };
  return mapNodeSummary(row, count.count);
}

function getDomainRow(id: string): DomainRow | undefined {
  return db.prepare('SELECT * FROM tech_domains WHERE id = ?').get(id) as DomainRow | undefined;
}

function requireDomain(id: string): DomainRow {
  const row = getDomainRow(id);
  if (!row) throw new TechRequestError('技术领域不存在', 404);
  return row;
}

function requireNode(id: string): NodeRow {
  const row = getNodeRow(id);
  if (!row) throw new TechRequestError('技术节点不存在', 404);
  return row;
}

function assertParent(domainId: string, parentId: string | null, nodeId?: string): void {
  if (!parentId) return;
  const parent = getNodeRow(parentId);
  if (!parent) throw new TechRequestError('父节点不存在', 404);
  if (parent.domain_id !== domainId) throw new TechRequestError('父节点必须属于同一技术领域');
  if (parent.status !== 'active') throw new TechRequestError('不能在已归档节点下创建或移动节点');
  if (nodeId && parentId === nodeId) throw new TechRequestError('节点不能作为自己的父节点');
  if (nodeId) {
    const subtree = subtreeIds(nodeId);
    if (subtree.has(parentId)) throw new TechRequestError('不能把节点移动到自己的子孙节点下');
  }
}

function assertSiblingName(domainId: string, parentId: string | null, name: string, excludeId?: string): void {
  const row = db
    .prepare(
      `SELECT id FROM tech_nodes
       WHERE domain_id = ? AND ${parentId ? 'parent_id = ?' : 'parent_id IS NULL'}
         AND LOWER(name) = LOWER(?) AND status = 'active' ${excludeId ? 'AND id != ?' : ''}
       LIMIT 1`,
    )
    .get(...(parentId ? [domainId, parentId, name] : [domainId, name]), ...(excludeId ? [excludeId] : []));
  if (row) throw new TechRequestError('同一层级下已存在同名节点');
}

/* --------------------------------- Content -------------------------------- */

const emptyContentCounts = (): TechContentCounts => ({
  total: 0,
  missing: 0,
  draft: 0,
  complete: 0,
  needs_review: 0,
  completionRate: 0,
});

function completionRate(complete: number, total: number): number {
  if (!total) return 0;
  return Math.round((complete / total) * 1000) / 10;
}

export function contentCounts(domainId?: string): TechContentCounts {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN content_markdown IS NULL OR TRIM(content_markdown) = '' THEN 1 ELSE 0 END) AS missing,
        SUM(CASE WHEN content_markdown IS NOT NULL AND TRIM(content_markdown) != ''
                  AND content_status = 'draft' THEN 1 ELSE 0 END) AS draft,
        SUM(CASE WHEN content_markdown IS NOT NULL AND TRIM(content_markdown) != ''
                  AND content_status = 'complete' THEN 1 ELSE 0 END) AS complete,
        SUM(CASE WHEN content_markdown IS NOT NULL AND TRIM(content_markdown) != ''
                  AND content_status = 'needs_review' THEN 1 ELSE 0 END) AS needs_review
       FROM tech_nodes WHERE status = 'active' ${domainId ? 'AND domain_id = ?' : ''}`,
    )
    .get(...(domainId ? [domainId] : [])) as {
    total: number;
    missing: number | null;
    draft: number | null;
    complete: number | null;
    needs_review: number | null;
  };
  const counts = {
    total: row.total,
    missing: row.missing ?? 0,
    draft: row.draft ?? 0,
    complete: row.complete ?? 0,
    needs_review: row.needs_review ?? 0,
    completionRate: 0,
  };
  counts.completionRate = completionRate(counts.complete, counts.total);
  return counts;
}

/* --------------------------------- Domains -------------------------------- */

export function listDomainSummaries(): TechDomainSummary[] {
  const rows = db
    .prepare(
      `SELECT d.*,
        (SELECT COUNT(*) FROM tech_nodes n WHERE n.domain_id = d.id AND n.status = 'active') AS node_count,
        (SELECT COUNT(*) FROM tech_nodes n WHERE n.domain_id = d.id AND n.status = 'active' AND n.focus_level = 'focus') AS focus_count,
        (SELECT MAX(n.updated_at) FROM tech_nodes n WHERE n.domain_id = d.id AND n.status = 'active') AS last_node_updated_at
       FROM tech_domains d
       ORDER BY d.sort_order, d.created_at`,
    )
    .all() as Array<
    DomainRow & { node_count: number; focus_count: number; last_node_updated_at: string | null }
  >;

  const mastery = new Map<string, TechMasteryCounts>();
  const masteryRows = db
    .prepare(
      `SELECT domain_id, mastery_status, COUNT(*) AS count FROM tech_nodes
       WHERE status = 'active' GROUP BY domain_id, mastery_status`,
    )
    .all() as Array<{ domain_id: string; mastery_status: TechMasteryStatus; count: number }>;
  for (const row of masteryRows) {
    const counts = mastery.get(row.domain_id) ?? emptyMastery();
    counts[row.mastery_status] = row.count;
    mastery.set(row.domain_id, counts);
  }

  const contentRows = db
    .prepare(
      `SELECT domain_id,
        SUM(CASE WHEN content_markdown IS NULL OR TRIM(content_markdown) = '' THEN 1 ELSE 0 END) AS missing,
        SUM(CASE WHEN content_markdown IS NOT NULL AND TRIM(content_markdown) != ''
                  AND content_status = 'draft' THEN 1 ELSE 0 END) AS draft,
        SUM(CASE WHEN content_markdown IS NOT NULL AND TRIM(content_markdown) != ''
                  AND content_status = 'complete' THEN 1 ELSE 0 END) AS complete,
        SUM(CASE WHEN content_markdown IS NOT NULL AND TRIM(content_markdown) != ''
                  AND content_status = 'needs_review' THEN 1 ELSE 0 END) AS needs_review,
        COUNT(*) AS total
       FROM tech_nodes WHERE status = 'active' GROUP BY domain_id`,
    )
    .all() as Array<{
    domain_id: string;
    total: number;
    missing: number | null;
    draft: number | null;
    complete: number | null;
    needs_review: number | null;
  }>;
  const content = new Map<string, TechContentCounts>();
  for (const row of contentRows) {
    const counts = emptyContentCounts();
    counts.total = row.total;
    counts.missing = row.missing ?? 0;
    counts.draft = row.draft ?? 0;
    counts.complete = row.complete ?? 0;
    counts.needs_review = row.needs_review ?? 0;
    counts.completionRate = completionRate(counts.complete, counts.total);
    content.set(row.domain_id, counts);
  }

  return rows.map((row) => ({
    ...mapDomain(row),
    nodeCount: row.node_count,
    focusCount: row.focus_count,
    masteryCounts: mastery.get(row.id) ?? emptyMastery(),
    contentCounts: content.get(row.id) ?? emptyContentCounts(),
    lastNodeUpdatedAt: row.last_node_updated_at,
  }));
}

export function getDomainSummary(id: string): TechDomainSummary | null {
  return listDomainSummaries().find((domain) => domain.id === id) ?? null;
}

export function createDomain(input: {
  name: string;
  description?: string | null;
  icon?: string | null;
  cover?: string | null;
  focusLevel?: TechFocusLevel;
}): TechDomain {
  const existing = db
    .prepare('SELECT id FROM tech_domains WHERE LOWER(name) = LOWER(?) AND status = ? LIMIT 1')
    .get(input.name, 'active');
  if (existing) throw new TechRequestError('已存在同名技术领域');
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM tech_domains').get() as {
    value: number;
  };
  db.prepare(
    `INSERT INTO tech_domains (id, name, description, icon, cover, status, focus_level, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
  ).run(
    id,
    input.name.trim(),
    input.description?.trim() || null,
    input.icon?.trim() || null,
    input.cover?.trim() || null,
    input.focusLevel ?? 'normal',
    max.value + 1,
    timestamp,
    timestamp,
  );
  return mapDomain(getDomainRow(id)!);
}

export function updateDomain(
  id: string,
  input: {
    name?: string;
    description?: string | null;
    icon?: string | null;
    cover?: string | null;
    focusLevel?: TechFocusLevel;
    status?: 'active' | 'archived';
    sortOrder?: number;
  },
): TechDomain {
  const existing = requireDomain(id);
  if (input.name && input.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
    const duplicate = db
      .prepare('SELECT id FROM tech_domains WHERE LOWER(name) = LOWER(?) AND id != ? LIMIT 1')
      .get(input.name.trim(), id);
    if (duplicate) throw new TechRequestError('已存在同名技术领域');
  }
  db.prepare(
    `UPDATE tech_domains SET name = ?, description = ?, icon = ?, cover = ?, focus_level = ?, status = ?, sort_order = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.name?.trim() || existing.name,
    input.description !== undefined ? input.description?.trim() || null : existing.description,
    input.icon !== undefined ? input.icon?.trim() || null : existing.icon,
    input.cover !== undefined ? input.cover?.trim() || null : existing.cover,
    input.focusLevel ?? existing.focus_level,
    input.status ?? existing.status,
    input.sortOrder ?? existing.sort_order,
    nowIso(),
    id,
  );
  return mapDomain(getDomainRow(id)!);
}

export function deleteDomain(id: string): void {
  requireDomain(id);
  const nodeIds = db.prepare('SELECT id FROM tech_nodes WHERE domain_id = ?').all(id) as Array<{ id: string }>;
  const ids = nodeIds.map((row) => row.id);
  const run = db.transaction(() => {
    for (const nodeId of ids) {
      db.prepare('UPDATE knowledge_note SET tech_node_id = NULL WHERE tech_node_id = ?').run(nodeId);
    }
    sanitizeGraphForNodes(new Set(ids));
    db.prepare('DELETE FROM tech_domains WHERE id = ?').run(id);
  });
  run();
}

/* ---------------------------------- Nodes --------------------------------- */

export interface NodeListOptions {
  domainId?: string;
  q?: string;
  nodeType?: TechNodeType;
  mastery?: TechMasteryStatus;
  focus?: boolean;
  contentStatus?: TechContentStatus;
  hasContent?: boolean;
  /** Content whose last verification is older than this many days (or absent). */
  staleDays?: number;
  status?: 'active' | 'archived' | 'all';
  limit?: number;
  offset?: number;
}

export function listNodes(options: NodeListOptions = {}): TechNodeListResponse {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.domainId) {
    clauses.push('domain_id = ?');
    params.push(options.domainId);
  }
  const status = options.status ?? 'active';
  if (status !== 'all') {
    clauses.push('status = ?');
    params.push(status);
  }
  if (options.nodeType) {
    clauses.push('node_type = ?');
    params.push(options.nodeType);
  }
  if (options.mastery) {
    clauses.push('mastery_status = ?');
    params.push(options.mastery);
  }
  if (options.focus) {
    clauses.push("focus_level = 'focus'");
  }
  if (options.hasContent !== undefined) {
    clauses.push(
      options.hasContent
        ? "content_markdown IS NOT NULL AND TRIM(content_markdown) != ''"
        : "(content_markdown IS NULL OR TRIM(content_markdown) = '')",
    );
  }
  if (options.contentStatus) {
    if (options.contentStatus === 'missing') {
      clauses.push("(content_markdown IS NULL OR TRIM(content_markdown) = '')");
    } else {
      clauses.push("content_markdown IS NOT NULL AND TRIM(content_markdown) != '' AND content_status = ?");
      params.push(options.contentStatus);
    }
  }
  if (options.staleDays && options.staleDays > 0) {
    const cutoff = new Date(Date.now() - options.staleDays * 86_400_000).toISOString();
    clauses.push(
      `(content_markdown IS NOT NULL AND TRIM(content_markdown) != ''
        AND content_status IN ('complete', 'needs_review')
        AND (content_verified_at IS NULL OR content_verified_at < ?))`,
    );
    params.push(cutoff);
  }
  const term = options.q?.trim().toLowerCase();
  if (term) {
    clauses.push(
      `(LOWER(name) LIKE ? OR LOWER(COALESCE(summary, '')) LIKE ?
        OR LOWER(COALESCE(description, '')) LIKE ? OR LOWER(COALESCE(content_markdown, '')) LIKE ?)`,
    );
    const pattern = `%${term}%`;
    params.push(pattern, pattern, pattern, pattern);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = (
    db.prepare(`SELECT COUNT(*) AS count FROM tech_nodes ${where}`).get(...params) as { count: number }
  ).count;
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 300);
  const offset = Math.max(options.offset ?? 0, 0);
  const rows = db
    .prepare(
      `SELECT * FROM tech_nodes ${where}
       ORDER BY focus_level = 'focus' DESC, updated_at DESC, sort_order
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as NodeRow[];
  const counts = childCounts(options.domainId);
  return { items: rows.map((row) => mapNodeSummary(row, counts.get(row.id) ?? 0)), total };
}

export function getDomainTree(domainId: string): TechTreeNode[] {
  requireDomain(domainId);
  const rows = db
    .prepare(
      `SELECT * FROM tech_nodes WHERE domain_id = ? AND status = 'active'
       ORDER BY sort_order, created_at`,
    )
    .all(domainId) as NodeRow[];
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.parent_id) counts.set(row.parent_id, (counts.get(row.parent_id) ?? 0) + 1);
  }
  const byParent = new Map<string | null, NodeRow[]>();
  for (const row of rows) {
    const key = row.parent_id;
    const list = byParent.get(key) ?? [];
    list.push(row);
    byParent.set(key, list);
  }
  const build = (parentId: string | null, depth: number): TechTreeNode[] => {
    if (depth > 32) return [];
    return (byParent.get(parentId) ?? []).map((row) => ({
      ...mapNodeSummary(row, counts.get(row.id) ?? 0),
      children: build(row.id, depth + 1),
    }));
  };
  // A node whose parent was archived can otherwise disappear from the tree.
  // Surface it at the root so no active knowledge is silently hidden.
  const orphaned = rows.filter((row) => row.parent_id && !rows.some((parent) => parent.id === row.parent_id));
  return [...build(null, 0), ...orphaned.map((row) => ({ ...mapNodeSummary(row, 0), children: [] }))];
}

export function getNode(id: string): TechNode | null {
  const row = getNodeRow(id);
  if (!row) return null;
  const count = db
    .prepare("SELECT COUNT(*) AS count FROM tech_nodes WHERE parent_id = ? AND status = 'active'")
    .get(id) as { count: number };
  return mapNode(row, count.count);
}

function breadcrumbs(row: NodeRow): TechNodeSummary[] {
  const chain: TechNodeSummary[] = [];
  let current = row.parent_id;
  let guard = 0;
  while (current && guard < 64) {
    const parent = getNodeRow(current);
    if (!parent) break;
    chain.unshift(mapNodeSummary(parent, 0));
    current = parent.parent_id;
    guard += 1;
  }
  return chain;
}

function listRelationsForNode(nodeId: string): TechRelationWithNodes[] {
  const rows = db
    .prepare(
      `SELECT * FROM tech_relations WHERE source_node_id = ? OR target_node_id = ?
       ORDER BY created_at, rowid`,
    )
    .all(nodeId, nodeId) as RelationRow[];
  return rows
    .map((row) => {
      const source = getNodeSummary(row.source_node_id);
      const target = getNodeSummary(row.target_node_id);
      if (!source || !target) return null;
      return { ...mapRelation(row), source, target };
    })
    .filter((entry): entry is TechRelationWithNodes => Boolean(entry));
}

export function listNodeSoftware(nodeId: string): TechSoftwareLink[] {
  const rows = db
    .prepare('SELECT software_id, created_at FROM tech_node_software WHERE node_id = ? ORDER BY created_at')
    .all(nodeId) as Array<{ software_id: string; created_at: string }>;
  const links: TechSoftwareLink[] = [];
  for (const row of rows) {
    const software = getSoftwareSummary(row.software_id);
    if (software) {
      const recentEvent = listEvents({ softwareId: row.software_id, limit: 1 })[0] ?? null;
      links.push({ software, linkedAt: row.created_at, recentEvent });
    }
  }
  return links;
}

function listNodeNotes(nodeId: string): KnowledgeNote[] {
  return listNotes({ techNodeId: nodeId });
}

export function listNodeRadar(nodeId: string) {
  const rows = db
    .prepare('SELECT radar_item_id, created_at FROM tech_node_radar WHERE node_id = ? ORDER BY created_at')
    .all(nodeId) as Array<{ radar_item_id: string; created_at: string }>;
  return rows
    .map((row) => {
      const radarItem = getRadarItem(row.radar_item_id);
      return radarItem ? { radarItem, linkedAt: row.created_at } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

export function listNodeDiscovery(nodeId: string) {
  const rows = db
    .prepare('SELECT candidate_id, created_at FROM tech_node_discovery WHERE node_id = ? ORDER BY created_at')
    .all(nodeId) as Array<{ candidate_id: string; created_at: string }>;
  return rows
    .map((row) => {
      const candidate = getDiscoveryCandidate(row.candidate_id);
      return candidate ? { candidate, linkedAt: row.created_at } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

export function getNodeDetail(id: string): TechNodeDetail | null {
  const row = getNodeRow(id);
  if (!row) return null;
  const domainRow = getDomainRow(row.domain_id);
  if (!domainRow) return null;
  const parent = row.parent_id ? getNodeSummary(row.parent_id) : null;
  const childRows = db
    .prepare(
      `SELECT * FROM tech_nodes WHERE parent_id = ? AND status = 'active'
       ORDER BY sort_order, created_at`,
    )
    .all(id) as NodeRow[];
  const counts = childCounts(row.domain_id);
  const node = mapNode(row, childRows.length);
  const views = listViewSummaries(row.domain_id).filter((view) => {
    const detail = getView(view.id);
    return detail?.graphData.nodes.some((graphNode) => graphNode.nodeId === id);
  });
  return {
    node,
    domain: mapDomain(domainRow),
    parent,
    breadcrumbs: breadcrumbs(row),
    children: childRows.map((child) => mapNodeSummary(child, counts.get(child.id) ?? 0)),
    relations: listRelationsForNode(id),
    software: listNodeSoftware(id),
    radar: listNodeRadar(id),
    discovery: listNodeDiscovery(id),
    notes: listNodeNotes(id),
    views,
  };
}

export interface NodeInput {
  name: string;
  nodeType: TechNodeType;
  parentId?: string | null;
  summary?: string | null;
  description?: string | null;
  technicalRole?: string | null;
  corePrinciple?: string | null;
  solvedProblem?: string | null;
  keyMechanism?: string | null;
  useCases?: string | null;
  commonIssues?: string | null;
  docsUrl?: string | null;
  repoUrl?: string | null;
  referenceLinks?: Array<{ label: string; url: string }>;
  personalNotes?: string | null;
  researchQuestions?: string | null;
  contentMarkdown?: string | null;
  contentStatus?: TechContentStatus;
  contentSource?: TechContentSource | null;
  applicableVersions?: string | null;
  verifiedVersion?: string | null;
  masteryStatus?: TechMasteryStatus;
  focusLevel?: TechFocusLevel;
}

export function createNode(domainId: string, input: NodeInput): TechNode {
  const domain = requireDomain(domainId);
  if (domain.status !== 'active') throw new TechRequestError('不能向已归档的技术领域添加节点');
  if (input.contentStatus === 'complete') {
    throw new TechRequestError('“已完善”只能通过验证操作设置，请先保存草稿', 400);
  }
  if (input.verifiedVersion !== undefined && input.verifiedVersion !== null && input.verifiedVersion.trim()) {
    throw new TechRequestError('验证版本只能通过验证操作写入', 400);
  }
  const parentId = input.parentId ?? null;
  assertParent(domainId, parentId);
  assertSiblingName(domainId, parentId, input.name.trim());
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const max = db
    .prepare(
      `SELECT COALESCE(MAX(sort_order), 0) AS value FROM tech_nodes
       WHERE domain_id = ? AND ${parentId ? 'parent_id = ?' : 'parent_id IS NULL'}`,
    )
    .get(...(parentId ? [domainId, parentId] : [domainId])) as { value: number };
  const markdown = hasMarkdownContent(input.contentMarkdown) ? input.contentMarkdown! : null;
  const contentStatus: TechContentStatus = markdown
    ? input.contentStatus ?? 'draft'
    : 'missing';
  db.prepare(
    `INSERT INTO tech_nodes
      (id, domain_id, parent_id, name, node_type, summary, description, technical_role, core_principle,
       solved_problem, key_mechanism, use_cases, common_issues, docs_url, repo_url, reference_links,
       personal_notes, research_questions, content_markdown, content_status, content_source,
       applicable_versions, content_updated_at, mastery_status, focus_level, status, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
  ).run(
    id,
    domainId,
    parentId,
    input.name.trim(),
    input.nodeType,
    input.summary?.trim() || null,
    input.description?.trim() || null,
    input.technicalRole?.trim() || null,
    input.corePrinciple?.trim() || null,
    input.solvedProblem?.trim() || null,
    input.keyMechanism?.trim() || null,
    input.useCases?.trim() || null,
    input.commonIssues?.trim() || null,
    input.docsUrl?.trim() || null,
    input.repoUrl?.trim() || null,
    JSON.stringify(input.referenceLinks ?? []),
    input.personalNotes ?? null,
    input.researchQuestions ?? null,
    markdown,
    contentStatus,
    input.contentSource ?? null,
    input.applicableVersions?.trim() || null,
    markdown ? timestamp : null,
    input.masteryStatus ?? 'unknown',
    input.focusLevel ?? 'normal',
    max.value + 1,
    timestamp,
    timestamp,
  );
  return getNode(id)!;
}

export function updateNode(
  id: string,
  input: Partial<Omit<NodeInput, 'parentId'>>,
): TechNode {
  const existing = requireNode(id);
  if (input.contentStatus === 'complete') {
    throw new TechRequestError('“已完善”只能通过验证操作设置', 400);
  }
  if (input.verifiedVersion !== undefined) {
    throw new TechRequestError('验证版本只能通过验证操作写入', 400);
  }
  if (input.name && input.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
    assertSiblingName(existing.domain_id, existing.parent_id, input.name.trim(), id);
  }
  const timestamp = nowIso();
  const nextMarkdown = input.contentMarkdown !== undefined
    ? hasMarkdownContent(input.contentMarkdown)
      ? input.contentMarkdown!
      : null
    : existing.content_markdown;
  const nextApplicableVersions = input.applicableVersions !== undefined
    ? input.applicableVersions?.trim() || null
    : existing.applicable_versions;
  const nextDocsUrl = input.docsUrl !== undefined
    ? input.docsUrl?.trim() || null
    : existing.docs_url;
  const nextReferenceLinks = input.referenceLinks?.filter((link) =>
    /^https?:\/\//i.test(link.url),
  );
  const markdownChanged = (existing.content_markdown ?? null) !== (nextMarkdown ?? null);
  const applicableVersionsChanged =
    (existing.applicable_versions ?? null) !== (nextApplicableVersions ?? null);
  const docsUrlChanged = (existing.docs_url ?? null) !== (nextDocsUrl ?? null);
  const referenceLinksChanged =
    nextReferenceLinks !== undefined &&
    JSON.stringify(parseLinks(existing.reference_links ?? '')) !==
      JSON.stringify(nextReferenceLinks);
  const verificationInputsChanged =
    markdownChanged || applicableVersionsChanged || docsUrlChanged || referenceLinksChanged;
  let nextContentStatus: TechContentStatus = input.contentStatus ?? existing.content_status;
  if (!hasMarkdownContent(nextMarkdown)) {
    // A node without a document is always "待补充", regardless of what the
    // caller asked for.
    nextContentStatus = 'missing';
  } else if (nextContentStatus === 'missing') {
    nextContentStatus = 'draft';
  } else if (verificationInputsChanged && existing.content_status === 'complete') {
    // Editing anything that the verification claim depends on invalidates the
    // current verification: the body, the applicable version range, the main
    // official reference, or the supporting links. Keep the verification
    // timestamp/version as history, but force the status back to draft so the
    // new material can never be presented as verified.
    nextContentStatus = 'draft';
  }
  // Verification metadata is only writable through verifyNodeContent. A normal
  // PATCH leaves the previous record untouched as history.
  const nextVerifiedVersion = existing.verified_version;
  const nextVerifiedAt = existing.content_verified_at;
  const contentChanged =
    verificationInputsChanged ||
    input.contentStatus !== undefined ||
    input.contentSource !== undefined;
  db.prepare(
    `UPDATE tech_nodes SET
      name = ?, node_type = ?, summary = ?, description = ?, technical_role = ?, core_principle = ?,
      solved_problem = ?, key_mechanism = ?, use_cases = ?, common_issues = ?, docs_url = ?, repo_url = ?,
      reference_links = ?, personal_notes = ?, research_questions = ?,
      content_markdown = ?, content_status = ?, content_source = ?, applicable_versions = ?,
      content_updated_at = ?, content_verified_at = ?, verified_version = ?,
      mastery_status = ?, focus_level = ?,
      updated_at = ?
     WHERE id = ?`,
  ).run(
    input.name?.trim() || existing.name,
    input.nodeType ?? existing.node_type,
    input.summary !== undefined ? input.summary?.trim() || null : existing.summary,
    input.description !== undefined ? input.description?.trim() || null : existing.description,
    input.technicalRole !== undefined ? input.technicalRole?.trim() || null : existing.technical_role,
    input.corePrinciple !== undefined ? input.corePrinciple?.trim() || null : existing.core_principle,
    input.solvedProblem !== undefined ? input.solvedProblem?.trim() || null : existing.solved_problem,
    input.keyMechanism !== undefined ? input.keyMechanism?.trim() || null : existing.key_mechanism,
    input.useCases !== undefined ? input.useCases?.trim() || null : existing.use_cases,
    input.commonIssues !== undefined ? input.commonIssues?.trim() || null : existing.common_issues,
    nextDocsUrl,
    input.repoUrl !== undefined ? input.repoUrl?.trim() || null : existing.repo_url,
    nextReferenceLinks !== undefined
      ? JSON.stringify(nextReferenceLinks)
      : existing.reference_links,
    input.personalNotes !== undefined ? input.personalNotes : existing.personal_notes,
    input.researchQuestions !== undefined ? input.researchQuestions : existing.research_questions,
    nextMarkdown,
    nextContentStatus,
    input.contentSource !== undefined ? input.contentSource : existing.content_source,
    nextApplicableVersions,
    contentChanged ? timestamp : existing.content_updated_at,
    nextVerifiedAt,
    nextVerifiedVersion,
    input.masteryStatus ?? existing.mastery_status,
    input.focusLevel ?? existing.focus_level,
    timestamp,
    id,
  );
  return getNode(id)!;
}

/**
 * Explicit "I checked this document" action. It records when and against
 * which product version the verification happened, without touching the
 * Markdown body itself.
 */
export function verifyNodeContent(
  id: string,
  input: { version?: string | null } = {},
): TechNode {
  const existing = requireNode(id);
  if (!hasMarkdownContent(existing.content_markdown)) {
    throw new TechRequestError('没有文档内容，无法验证', 400);
  }
  const version = input.version?.trim();
  if (!version) {
    throw new TechRequestError('验证时必须填写所依据的版本', 400);
  }
  const timestamp = nowIso();
  db.prepare(
    `UPDATE tech_nodes SET content_status = 'complete', content_verified_at = ?,
       verified_version = ?, updated_at = ? WHERE id = ?`,
  ).run(timestamp, version, timestamp, id);
  return getNode(id)!;
}

export function updateNodeCognition(
  id: string,
  input: { masteryStatus?: TechMasteryStatus; focusLevel?: TechFocusLevel },
): TechNode {
  requireNode(id);
  const timestamp = nowIso();
  db.prepare(
    `UPDATE tech_nodes SET mastery_status = COALESCE(?, mastery_status), focus_level = COALESCE(?, focus_level),
       updated_at = ? WHERE id = ?`,
  ).run(input.masteryStatus ?? null, input.focusLevel ?? null, timestamp, id);
  return getNode(id)!;
}

export function subtreeIds(id: string): Set<string> {
  const rows = db
    .prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM tech_nodes WHERE id = ?
         UNION ALL
         SELECT n.id FROM tech_nodes n JOIN subtree s ON n.parent_id = s.id
       )
       SELECT id FROM subtree`,
    )
    .all(id) as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

export function moveNode(
  id: string,
  input: { parentId: string | null; beforeId?: string | null },
): TechNode {
  const existing = requireNode(id);
  if (input.parentId === existing.parent_id && !input.beforeId) return getNode(id)!;
  assertParent(existing.domain_id, input.parentId, id);
  if (input.beforeId) {
    if (input.beforeId === id) throw new TechRequestError('节点不能移动到自己之前');
    const before = getNodeRow(input.beforeId);
    if (!before) throw new TechRequestError('目标位置节点不存在', 404);
    if (before.parent_id !== input.parentId) throw new TechRequestError('目标位置节点必须与新父节点同级');
  }
  const siblings = db
    .prepare(
      `SELECT id, sort_order FROM tech_nodes WHERE domain_id = ?
        AND ${input.parentId ? 'parent_id = ?' : 'parent_id IS NULL'}
        AND id != ? ORDER BY sort_order, created_at`,
    )
    .all(...(input.parentId ? [existing.domain_id, input.parentId, id] : [existing.domain_id, id])) as Array<{
    id: string;
  }>;
  const order = siblings.map((row) => row.id);
  if (input.beforeId) {
    const index = order.indexOf(input.beforeId);
    order.splice(index >= 0 ? index : order.length, 0, id);
  } else {
    order.push(id);
  }
  const run = db.transaction(() => {
    db.prepare('UPDATE tech_nodes SET parent_id = ?, updated_at = ? WHERE id = ?').run(
      input.parentId,
      nowIso(),
      id,
    );
    const update = db.prepare('UPDATE tech_nodes SET sort_order = ? WHERE id = ?');
    order.forEach((nodeId, index) => update.run(index + 1, nodeId));
  });
  run();
  return getNode(id)!;
}

export function setNodeArchived(id: string, archived: boolean): TechNode {
  const existing = requireNode(id);
  const ids = subtreeIds(id);
  const timestamp = nowIso();
  const run = db.transaction(() => {
    if (archived) {
      const update = db.prepare("UPDATE tech_nodes SET status = 'archived', updated_at = ? WHERE id = ?");
      ids.forEach((nodeId) => update.run(timestamp, nodeId));
    } else {
      // Restore the node, its descendants, and any archived ancestors so the
      // restored branch is visible in the tree again.
      const restore = new Set(ids);
      let parent = existing.parent_id;
      let guard = 0;
      while (parent && guard < 64) {
        const row = getNodeRow(parent);
        if (!row) break;
        if (row.status === 'archived') restore.add(row.id);
        parent = row.parent_id;
        guard += 1;
      }
      const update = db.prepare("UPDATE tech_nodes SET status = 'active', updated_at = ? WHERE id = ?");
      restore.forEach((nodeId) => update.run(timestamp, nodeId));
    }
  });
  run();
  return getNode(id)!;
}

export type DeleteStrategy = 'subtree' | 'promote';

export function deleteNode(id: string, strategy?: DeleteStrategy): { deleted: number; promoted: number } {
  const existing = requireNode(id);
  const children = db
    .prepare("SELECT id FROM tech_nodes WHERE parent_id = ? AND status = 'active' ORDER BY sort_order")
    .all(id) as Array<{ id: string }>;
  if (children.length > 0 && !strategy) {
    throw new TechRequestError('该节点包含子节点，请选择同时删除子节点或将子节点上移', 409);
  }
  const choice = strategy ?? 'subtree';
  let deletedIds = new Set<string>([id]);
  let promoted = 0;
  const timestamp = nowIso();

  const run = db.transaction(() => {
    if (choice === 'promote' && children.length) {
      const siblings = db
        .prepare(
          `SELECT id FROM tech_nodes WHERE domain_id = ?
            AND ${existing.parent_id ? 'parent_id = ?' : 'parent_id IS NULL'}
            AND id != ? ORDER BY sort_order, created_at`,
        )
        .all(
          ...(existing.parent_id
            ? [existing.domain_id, existing.parent_id, id]
            : [existing.domain_id, id]),
        ) as Array<{ id: string }>;
      const order: string[] = [];
      for (const sibling of siblings) {
        order.push(sibling.id);
        if (sibling.id === id) order.push(...children.map((child) => child.id));
      }
      if (!order.includes(children[0].id)) order.push(...children.map((child) => child.id));
      seededPromote(children.map((child) => child.id), existing.parent_id, timestamp);
      const update = db.prepare('UPDATE tech_nodes SET sort_order = ? WHERE id = ?');
      order.forEach((nodeId, index) => update.run(index + 1, nodeId));
      promoted = children.length;
    } else {
      deletedIds = subtreeIds(id);
    }
    for (const nodeId of deletedIds) {
      db.prepare('UPDATE knowledge_note SET tech_node_id = NULL WHERE tech_node_id = ?').run(nodeId);
    }
    sanitizeGraphForNodes(deletedIds);
    db.prepare('DELETE FROM tech_nodes WHERE id = ?').run(id);
  });
  run();
  return { deleted: deletedIds.size, promoted };
}

function seededPromote(childIds: string[], parentId: string | null, timestamp: string): void {
  const update = db.prepare('UPDATE tech_nodes SET parent_id = ?, updated_at = ? WHERE id = ?');
  childIds.forEach((childId) => update.run(parentId, timestamp, childId));
}

function sanitizeGraphForNodes(deletedIds: Set<string>): void {
  if (!deletedIds.size) return;
  const rows = db.prepare('SELECT id, graph_data FROM tech_views').all() as Array<{
    id: string;
    graph_data: string;
  }>;
  const update = db.prepare('UPDATE tech_views SET graph_data = ?, updated_at = ? WHERE id = ?');
  const timestamp = nowIso();
  for (const row of rows) {
    const graph = parseGraphData(row.graph_data);
    const removedNodeIds = new Set(
      graph.nodes.filter((node) => node.nodeId && deletedIds.has(node.nodeId)).map((node) => node.id),
    );
    if (!removedNodeIds.size) continue;
    const nodes = graph.nodes.filter((node) => !removedNodeIds.has(node.id));
    const edges = graph.edges.filter(
      (edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target),
    );
    update.run(JSON.stringify({ nodes, edges }), timestamp, row.id);
  }
}

/* -------------------------------- Relations ------------------------------- */

export function listRelations(options: { domainId?: string; nodeId?: string } = {}): TechRelationWithNodes[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.nodeId) {
    clauses.push('(r.source_node_id = ? OR r.target_node_id = ?)');
    params.push(options.nodeId, options.nodeId);
  }
  if (options.domainId) {
    clauses.push('(s.domain_id = ? OR t.domain_id = ?)');
    params.push(options.domainId, options.domainId);
  }
  const rows = db
    .prepare(
      `SELECT r.* FROM tech_relations r
       JOIN tech_nodes s ON s.id = r.source_node_id
       JOIN tech_nodes t ON t.id = r.target_node_id
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY r.created_at DESC, r.rowid DESC`,
    )
    .all(...params) as RelationRow[];
  return rows
    .map((row) => {
      const source = getNodeSummary(row.source_node_id);
      const target = getNodeSummary(row.target_node_id);
      if (!source || !target) return null;
      return { ...mapRelation(row), source, target };
    })
    .filter((entry): entry is TechRelationWithNodes => Boolean(entry));
}

function assertNoRelationCycle(source: string, target: string, relationType: TechRelationType): void {
  if (relationType !== 'contains') return;
  // The tree hierarchy is itself a containment relation. Pointing "contains"
  // from a descendant at its ancestor would invert the hierarchy.
  let parent = getNodeRow(source)?.parent_id ?? null;
  let guard = 0;
  while (parent && guard < 64) {
    if (parent === target) throw new TechRequestError('包含关系不能形成环');
    parent = getNodeRow(parent)?.parent_id ?? null;
    guard += 1;
  }
  // "contains" relations may also form cycles independently of the tree.
  const rows = db
    .prepare(
      `WITH RECURSIVE down(id) AS (
         SELECT ?
         UNION
         SELECT r.target_node_id FROM tech_relations r JOIN down d ON r.source_node_id = d.id
         WHERE r.relation_type = 'contains'
       )
       SELECT id FROM down`,
    )
    .all(target) as Array<{ id: string }>;
  if (rows.some((row) => row.id === source)) {
    throw new TechRequestError('包含关系不能形成环');
  }
}

export function createRelation(input: {
  sourceNodeId: string;
  targetNodeId: string;
  relationType: TechRelationType;
  description?: string | null;
}): TechRelation {
  if (input.sourceNodeId === input.targetNodeId) throw new TechRequestError('关系两端不能是同一节点');
  const source = requireNode(input.sourceNodeId);
  const target = requireNode(input.targetNodeId);
  if (source.status !== 'active' || target.status !== 'active') {
    throw new TechRequestError('不能为已归档节点创建关系');
  }
  const duplicate = db
    .prepare(
      'SELECT id FROM tech_relations WHERE source_node_id = ? AND target_node_id = ? AND relation_type = ?',
    )
    .get(input.sourceNodeId, input.targetNodeId, input.relationType);
  if (duplicate) throw new TechRequestError('相同的关系已存在', 409);
  assertNoRelationCycle(input.sourceNodeId, input.targetNodeId, input.relationType);
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO tech_relations (id, source_node_id, target_node_id, relation_type, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.sourceNodeId,
    input.targetNodeId,
    input.relationType,
    input.description?.trim() || null,
    timestamp,
    timestamp,
  );
  return mapRelation(db.prepare('SELECT * FROM tech_relations WHERE id = ?').get(id) as RelationRow);
}

export function deleteRelation(id: string): void {
  db.prepare('DELETE FROM tech_relations WHERE id = ?').run(id);
}

/* ---------------------------------- Views --------------------------------- */

export interface GraphInput {
  nodes: TechGraphNode[];
  edges: TechGraphEdge[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateGraphData(input: unknown): TechGraphData {
  const raw = input as Partial<GraphInput> | null;
  if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new TechRequestError('架构图数据必须包含 nodes 与 edges 数组');
  }
  if (raw.nodes.length > 300) throw new TechRequestError('单张架构图最多 300 个节点');
  if (raw.edges.length > 600) throw new TechRequestError('单张架构图最多 600 条连线');
  const nodeIds = new Set<string>();
  const nodes: TechGraphNode[] = [];
  for (const node of raw.nodes) {
    if (!node || typeof node.id !== 'string' || !node.id.trim() || node.id.length > 100) {
      throw new TechRequestError('架构图节点 id 不合法');
    }
    if (nodeIds.has(node.id)) throw new TechRequestError('架构图节点 id 重复');
    nodeIds.add(node.id);
    if (!node.label || typeof node.label !== 'string' || node.label.length > 120) {
      throw new TechRequestError('架构图节点标题不能为空且不能超过 120 个字符');
    }
    if (!isFiniteNumber(node.x) || !isFiniteNumber(node.y)) {
      throw new TechRequestError('架构图节点坐标必须是数字');
    }
    if (Math.abs(node.x) > 20_000 || Math.abs(node.y) > 20_000) {
      throw new TechRequestError('架构图节点坐标超出允许范围');
    }
    const width = isFiniteNumber(node.width) ? Math.min(Math.max(node.width, 60), 600) : 168;
    const height = isFiniteNumber(node.height) ? Math.min(Math.max(node.height, 36), 260) : 54;
    if (node.nodeId) {
      const target = getNodeRow(node.nodeId);
      if (!target) throw new TechRequestError('架构图节点关联的技术节点不存在');
    }
    nodes.push({
      id: node.id,
      nodeId: node.nodeId || null,
      label: node.label.trim(),
      x: node.x,
      y: node.y,
      width,
      height,
      note: node.note ? String(node.note).slice(0, 500) : null,
      nodeType: node.nodeType ?? null,
    });
  }
  const edgeIds = new Set<string>();
  const edges: TechGraphEdge[] = [];
  for (const edge of raw.edges) {
    if (!edge || typeof edge.id !== 'string' || !edge.id.trim() || edge.id.length > 100) {
      throw new TechRequestError('架构图连线 id 不合法');
    }
    if (edgeIds.has(edge.id)) throw new TechRequestError('架构图连线 id 重复');
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new TechRequestError('架构图连线必须连接图中的两个节点');
    }
    if (edge.source === edge.target) throw new TechRequestError('架构图连线不能连接自身');
    if (edge.relationType && !TECH_RELATION_TYPES.includes(edge.relationType)) {
      throw new TechRequestError('架构图连线关系类型不合法');
    }
    edges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label ? String(edge.label).slice(0, 80) : null,
      relationType: edge.relationType ?? null,
    });
  }
  return { nodes, edges };
}

export function listViewSummaries(domainId: string): TechViewSummary[] {
  const rows = db
    .prepare('SELECT * FROM tech_views WHERE domain_id = ? ORDER BY sort_order, created_at')
    .all(domainId) as ViewRow[];
  return rows.map(mapViewSummary);
}

export function getView(id: string): TechView | null {
  const row = db.prepare('SELECT * FROM tech_views WHERE id = ?').get(id) as ViewRow | undefined;
  return row ? mapView(row) : null;
}

export function getViewDetail(id: string): TechViewDetail | null {
  const row = db.prepare('SELECT * FROM tech_views WHERE id = ?').get(id) as ViewRow | undefined;
  if (!row) return null;
  const domain = getDomainRow(row.domain_id);
  if (!domain) return null;
  const view = mapView(row);
  const linked = new Set(view.graphData.nodes.map((node) => node.nodeId).filter(Boolean) as string[]);
  const nodes = [...linked]
    .map((nodeId) => getNodeSummary(nodeId))
    .filter((node): node is TechNodeSummary => Boolean(node));
  return { view, domain: mapDomain(domain), nodes };
}

export function createView(
  domainId: string,
  input: { name: string; description?: string | null; viewType: TechViewType; graphData?: unknown },
): TechView {
  requireDomain(domainId);
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const graph = input.graphData ? validateGraphData(input.graphData) : { nodes: [], edges: [] };
  const max = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM tech_views WHERE domain_id = ?')
    .get(domainId) as { value: number };
  db.prepare(
    `INSERT INTO tech_views (id, domain_id, name, description, view_type, graph_data, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    domainId,
    input.name.trim(),
    input.description?.trim() || null,
    input.viewType,
    JSON.stringify(graph),
    max.value + 1,
    timestamp,
    timestamp,
  );
  return getView(id)!;
}

export function updateView(
  id: string,
  input: {
    name?: string;
    description?: string | null;
    viewType?: TechViewType;
    graphData?: unknown;
    sortOrder?: number;
  },
): TechView {
  const row = db.prepare('SELECT * FROM tech_views WHERE id = ?').get(id) as ViewRow | undefined;
  if (!row) throw new TechRequestError('架构视图不存在', 404);
  db.prepare(
    `UPDATE tech_views SET name = ?, description = ?, view_type = ?, graph_data = ?, sort_order = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.name?.trim() || row.name,
    input.description !== undefined ? input.description?.trim() || null : row.description,
    input.viewType ?? row.view_type,
    input.graphData !== undefined ? JSON.stringify(validateGraphData(input.graphData)) : row.graph_data,
    input.sortOrder ?? row.sort_order,
    nowIso(),
    id,
  );
  return getView(id)!;
}

export function deleteView(id: string): void {
  db.prepare('DELETE FROM tech_views WHERE id = ?').run(id);
}

/* ---------------------------------- Links --------------------------------- */

function assertSoftware(softwareId: string): void {
  const row = db
    .prepare('SELECT id FROM software WHERE id = ? AND deleted_at IS NULL')
    .get(softwareId);
  if (!row) throw new TechRequestError('软件不存在', 404);
}

export function linkSoftware(nodeId: string, softwareId: string, linked: boolean): void {
  requireNode(nodeId);
  assertSoftware(softwareId);
  if (linked) {
    db.prepare(
      `INSERT INTO tech_node_software (node_id, software_id, created_at) VALUES (?, ?, ?)
       ON CONFLICT(node_id, software_id) DO NOTHING`,
    ).run(nodeId, softwareId, nowIso());
  } else {
    db.prepare('DELETE FROM tech_node_software WHERE node_id = ? AND software_id = ?').run(
      nodeId,
      softwareId,
    );
  }
}

export function linkRadar(nodeId: string, radarItemId: string, linked: boolean): void {
  requireNode(nodeId);
  if (!getRadarItem(radarItemId)) throw new TechRequestError('雷达条目不存在', 404);
  if (linked) {
    db.prepare(
      `INSERT INTO tech_node_radar (node_id, radar_item_id, created_at) VALUES (?, ?, ?)
       ON CONFLICT(node_id, radar_item_id) DO NOTHING`,
    ).run(nodeId, radarItemId, nowIso());
  } else {
    db.prepare('DELETE FROM tech_node_radar WHERE node_id = ? AND radar_item_id = ?').run(
      nodeId,
      radarItemId,
    );
  }
}

export function linkDiscovery(nodeId: string, candidateId: string, linked: boolean): void {
  requireNode(nodeId);
  if (!getDiscoveryCandidate(candidateId)) throw new TechRequestError('发现候选不存在', 404);
  if (linked) {
    db.prepare(
      `INSERT INTO tech_node_discovery (node_id, candidate_id, created_at) VALUES (?, ?, ?)
       ON CONFLICT(node_id, candidate_id) DO NOTHING`,
    ).run(nodeId, candidateId, nowIso());
  } else {
    db.prepare('DELETE FROM tech_node_discovery WHERE node_id = ? AND candidate_id = ?').run(
      nodeId,
      candidateId,
    );
  }
}

/* -------------------------------- Overview -------------------------------- */

export function getDomainDetail(id: string): TechDomainDetail | null {
  const summary = getDomainSummary(id);
  if (!summary) return null;
  const counts = childCounts(id);
  const recent = db
    .prepare(
      `SELECT * FROM tech_nodes WHERE domain_id = ? AND status = 'active'
       ORDER BY updated_at DESC LIMIT 6`,
    )
    .all(id) as NodeRow[];
  return {
    domain: summary,
    tree: getDomainTree(id),
    nodes: db
      .prepare(
        `SELECT * FROM tech_nodes WHERE domain_id = ? AND status = 'active'
         ORDER BY updated_at DESC`,
      )
      .all(id)
      .map((row) => mapNodeSummary(row as NodeRow, counts.get((row as NodeRow).id) ?? 0)),
    views: listViewSummaries(id),
    recentNodes: recent.map((row) => mapNodeSummary(row, counts.get(row.id) ?? 0)),
  };
}

export function getTechOverview(): TechOverview {
  const domains = listDomainSummaries();
  const counts = childCounts();
  const recent = db
    .prepare(
      `SELECT * FROM tech_nodes WHERE status = 'active' ORDER BY updated_at DESC LIMIT 6`,
    )
    .all() as NodeRow[];
  const learning = db
    .prepare(
      `SELECT * FROM tech_nodes WHERE status = 'active'
        AND mastery_status IN ('to_learn','learning','deep_dive')
       ORDER BY updated_at DESC LIMIT 6`,
    )
    .all() as NodeRow[];
  const focus = db
    .prepare(
      `SELECT * FROM tech_nodes WHERE status = 'active' AND focus_level = 'focus'
       ORDER BY updated_at DESC LIMIT 6`,
    )
    .all() as NodeRow[];
  const statsRow = db
    .prepare(
      `SELECT COUNT(*) AS nodes,
        SUM(CASE WHEN mastery_status IN ('to_learn','learning','deep_dive') THEN 1 ELSE 0 END) AS learning,
        SUM(CASE WHEN focus_level = 'focus' THEN 1 ELSE 0 END) AS focus,
        SUM(CASE WHEN mastery_status = 'mastered' THEN 1 ELSE 0 END) AS mastered
       FROM tech_nodes WHERE status = 'active'`,
    )
    .get() as { nodes: number; learning: number | null; focus: number | null; mastered: number | null };
  return {
    domains,
    recentNodes: recent.map((row) => mapNodeSummary(row, counts.get(row.id) ?? 0)),
    learningNodes: learning.map((row) => mapNodeSummary(row, counts.get(row.id) ?? 0)),
    focusNodes: focus.map((row) => mapNodeSummary(row, counts.get(row.id) ?? 0)),
    stats: {
      domains: domains.filter((domain) => domain.status === 'active').length,
      nodes: statsRow.nodes,
      learning: statsRow.learning ?? 0,
      focus: statsRow.focus ?? 0,
      mastered: statsRow.mastered ?? 0,
      content: contentCounts(),
    },
  };
}

/* -------------------------------- Templates ------------------------------- */

export function listTemplates(): TechTemplateSummary[] {
  const applied = new Map(
    (
      db.prepare('SELECT key, applied_at FROM tech_seed').all() as Array<{
        key: string;
        applied_at: string;
      }>
    ).map((row) => [row.key, row.applied_at]),
  );
  return TECH_TEMPLATES.map((template) => ({
    key: template.key,
    name: template.name,
    description: template.description,
    appliedAt: applied.get(template.key) ?? null,
  }));
}

export function applyTemplate(key: string): TechTemplateApplyResult {
  const template = TECH_TEMPLATES.find((entry) => entry.key === key);
  if (!template) throw new TechRequestError('模板不存在', 404);
  const result = applyTechTemplate(key);
  if (!result) throw new TechRequestError('模板不存在', 404);
  for (const entry of TECH_TEMPLATES) seedTemplateRelations(entry);
  const summary = listTemplates().find((entry) => entry.key === key)!;
  return { template: summary, inserted: result.inserted };
}
