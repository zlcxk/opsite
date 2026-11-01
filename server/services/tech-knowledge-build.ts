import crypto from 'node:crypto';
import type {
  KnowledgeBuildFilters,
  KnowledgeBuildMapping,
  KnowledgeBuildNodeScope,
  KnowledgeBuildPendingCandidate,
  KnowledgeBuildPreview,
  KnowledgeBuildPreviewCounts,
  KnowledgeBuildPreviewItem,
  KnowledgeBuildRequest,
  KnowledgeBuildResult,
  KnowledgeBuildResultItem,
  KnowledgeBuildResultStatus,
  KnowledgeBuildRule,
  KnowledgeBuildRuleInput,
  KnowledgeBuildScopeType,
  KnowledgeBuildSoftwareScope,
  KnowledgeBuildSourceInput,
  KnowledgeBuildTargetType,
  KnowledgeBuildTemplateKey,
  KnowledgeBuildTriggerType,
  KnowledgeLintItem,
  KnowledgeLintResult,
  KnowledgeUrlCheckResult,
  TechContentStatus,
  TechExternalLink,
  TechNodeType,
} from '../../shared/types.js';
import { db, nowIso } from '../db.js';
import {
  defaultTemplateKeyForNodeType,
  getKnowledgeBuildTemplate,
  isKnowledgeBuildTemplateKey,
  renderKnowledgeDocument,
  sourceLinksForContext,
  type KnowledgeDocumentContext,
  type KnowledgeTemplateDefinition,
} from './tech-knowledge-templates.js';
import { checkKnowledgeUrls as checkKnowledgeUrlsImpl } from './tech-knowledge-urlcheck.js';

export class KnowledgeBuildError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'KnowledgeBuildError';
    this.status = status;
  }
}

interface SoftwareRow {
  id: string;
  name: string;
  category: string;
  website: string | null;
  repo: string | null;
  description: string | null;
  watch_status: string;
  watch_level: string;
  current_version: string | null;
  latest_version: string | null;
}

interface LinkedNodeRow {
  id: string;
  name: string;
  domain_id: string;
  domain_name: string;
  parent_id: string | null;
  node_type: TechNodeType;
  content_markdown: string | null;
  content_status: TechContentStatus;
  content_source: string | null;
  applicable_versions: string | null;
  content_verified_at: string | null;
  verified_version: string | null;
  docs_url: string | null;
  repo_url: string | null;
  reference_links: string;
  summary: string | null;
  description: string | null;
  technical_role: string | null;
  core_principle: string | null;
  solved_problem: string | null;
  key_mechanism: string | null;
  use_cases: string | null;
  common_issues: string | null;
  status: string;
}

interface DomainRow {
  id: string;
  name: string;
  status: string;
}

interface NodeRow {
  id: string;
  domain_id: string;
  domain_name: string;
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
  content_markdown: string | null;
  content_status: TechContentStatus;
  content_source: string | null;
  applicable_versions: string | null;
  content_verified_at: string | null;
  verified_version: string | null;
  relation_review_status: 'unreviewed' | 'independent';
  relation_review_note: string | null;
  status: string;
}

interface NormalizedRequest {
  scopeType: KnowledgeBuildScopeType;
  software: KnowledgeBuildSoftwareScope;
  nodes: KnowledgeBuildNodeScope;
  newNode: KnowledgeBuildRequest['newNode'];
  filters: Required<Omit<KnowledgeBuildFilters, 'excludeSoftwareIds' | 'excludeNodeIds'>> & {
    excludeSoftwareIds: string[];
    excludeNodeIds: string[];
  };
  templateKey: KnowledgeBuildTemplateKey;
  mapping: Required<Pick<KnowledgeBuildMapping, 'linkStrategy'>> & KnowledgeBuildMapping;
  sources: KnowledgeBuildSourceInput;
}

interface Candidate {
  item: KnowledgeBuildPreviewItem;
  software?: SoftwareRow;
  linkedNode?: LinkedNodeRow;
  node?: NodeRow;
  create?: {
    domainId: string;
    parentId: string | null;
    name: string;
    nodeType: TechNodeType;
    summary: string | null;
  };
  sourceNodeId?: string | null;
}

const RULE_SELECT = `SELECT id, name, enabled, target_type, trigger_type, scope_type,
  scope_config, mapping_config, template_key, source_config, last_run_at,
  last_run_status, last_error, created_at, updated_at
  FROM tech_knowledge_build_rules`;

const TEMPLATE_FALLBACK: KnowledgeBuildTemplateKey = 'component-l2-v1';

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function uniqueStrings(values: Array<string | null | undefined> | undefined): string[] {
  return [...new Set((values ?? []).filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}

function hasMarkdown(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

/**
 * Strict HTTPS source validation for newly entered knowledge sources.
 * Historical rows may still contain HTTP; those are reported by the linter,
 * not silently rewritten.
 */
export function isKnowledgeHttpsUrl(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value.trim());
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      Boolean(url.hostname)
    );
  } catch {
    return false;
  }
}

function isHttpsUrl(value: string | null | undefined): boolean {
  return isKnowledgeHttpsUrl(value);
}

function canonicalUrl(value: string): string {
  try {
    return new URL(value.trim()).href;
  } catch {
    return value.trim();
  }
}

function uniqueHttpsLinks(links: TechExternalLink[] | undefined): TechExternalLink[] {
  const seen = new Set<string>();
  const result: TechExternalLink[] = [];
  for (const link of links ?? []) {
    const url = link.url?.trim();
    if (!isHttpsUrl(url)) continue;
    const key = canonicalUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ label: link.label?.trim() || '官方资料', url: url! });
  }
  return result;
}

function validateSourceInput(sources: KnowledgeBuildSourceInput | undefined): void {
  const docsUrl = sources?.docsUrl?.trim();
  if (docsUrl && !isHttpsUrl(docsUrl)) {
    throw new KnowledgeBuildError(
      '官方文档地址必须是合法 HTTPS URL，且不能包含用户名、密码或非 443 端口',
    );
  }
  for (const link of sources?.referenceLinks ?? []) {
    if (!isHttpsUrl(link.url)) {
      throw new KnowledgeBuildError(
        '参考来源必须是合法 HTTPS URL，且不能包含用户名、密码或非 443 端口',
      );
    }
  }
}

function normalizeFilters(input: KnowledgeBuildFilters | undefined): NormalizedRequest['filters'] {
  return {
    onlyMissing: input?.onlyMissing ?? false,
    onlyDraft: input?.onlyDraft ?? false,
    // This is a security/safety invariant, not a user preference. Existing
    // Markdown is never overwritten by the build flow.
    skipExistingBody: true,
    skipVerified: input?.skipVerified ?? true,
    activeOnly: input?.activeOnly ?? true,
    skipArchived: input?.skipArchived ?? true,
    excludeSoftwareIds: uniqueStrings(input?.excludeSoftwareIds),
    excludeNodeIds: uniqueStrings(input?.excludeNodeIds),
  };
}

function normalizeMapping(input: KnowledgeBuildMapping | undefined): NormalizedRequest['mapping'] {
  return {
    ...input,
    linkStrategy: input?.linkStrategy ?? 'none',
    initializeOnLink: input?.initializeOnLink ?? false,
  };
}

function normalizeRequest(input: KnowledgeBuildRequest): NormalizedRequest {
  if (!['software', 'nodes', 'combined', 'new'].includes(input.scopeType)) {
    throw new KnowledgeBuildError('未知的建档范围');
  }
  if (input.scopeType === 'new') {
    if (!input.newNode?.domainId || !input.newNode.name?.trim()) {
      throw new KnowledgeBuildError('新建知识需要指定领域和节点名称');
    }
    if ((input.newNode.summary?.trim().length ?? 0) > 500) {
      throw new KnowledgeBuildError('新建知识摘要不能超过 500 个字符');
    }
  }
  if (input.scopeType === 'software') {
    const scope = input.software ?? {};
    if (
      !scope.ids?.length &&
      !scope.category &&
      !scope.watchStatus &&
      !scope.selection
    ) {
      throw new KnowledgeBuildError('软件范围必须明确选择软件、分类或筛选条件，不能默认全量执行');
    }
  }
  if (input.scopeType === 'nodes') {
    const scope = input.nodes ?? {};
    if (!scope.ids?.length && !scope.domainId && !scope.parentId && !scope.nodeType && !scope.selection) {
      throw new KnowledgeBuildError('节点范围必须明确选择节点、领域、父节点或类型，不能默认全量执行');
    }
  }
  if (input.scopeType === 'combined') {
    const software = input.software ?? {};
    const nodes = input.nodes ?? {};
    if (
      !software.ids?.length &&
      !software.category &&
      !software.watchStatus &&
      !software.selection &&
      !nodes.ids?.length &&
      !nodes.domainId &&
      !nodes.parentId &&
      !nodes.nodeType &&
      !nodes.selection
    ) {
      throw new KnowledgeBuildError('组合范围至少需要指定软件或节点筛选条件');
    }
  }
  const explicitTemplate = input.templateKey && isKnowledgeBuildTemplateKey(input.templateKey)
    ? input.templateKey
    : null;
  const inferredType =
    input.newNode?.nodeType ?? input.mapping?.nodeType ?? null;
  const templateKey =
    explicitTemplate ??
    (inferredType ? defaultTemplateKeyForNodeType(inferredType) : TEMPLATE_FALLBACK);
  if (!getKnowledgeBuildTemplate(templateKey)) {
    throw new KnowledgeBuildError('未知的模板');
  }
  const sources = input.sources ?? {};
  validateSourceInput(sources);
  const docsUrl = sources.docsUrl?.trim() || null;
  const docsKey = docsUrl ? canonicalUrl(docsUrl) : null;
  const referenceLinks = uniqueHttpsLinks(sources.referenceLinks).filter(
    (link) => canonicalUrl(link.url) !== docsKey,
  );
  return {
    scopeType: input.scopeType,
    software: {
      ...(input.software ?? {}),
      ids: uniqueStrings(input.software?.ids),
      selection: input.software?.selection ?? (input.software?.ids?.length ? 'all' : undefined),
    },
    nodes: {
      ...(input.nodes ?? {}),
      ids: uniqueStrings(input.nodes?.ids),
      selection: input.nodes?.selection ?? (input.nodes?.ids?.length ? 'all' : undefined),
    },
    newNode: input.newNode,
    filters: normalizeFilters(input.filters),
    templateKey,
    mapping: normalizeMapping(input.mapping),
    sources: {
      docsUrl,
      referenceLinks,
    },
  };
}

function canonicalRequest(request: NormalizedRequest): string {
  return JSON.stringify({
    scopeType: request.scopeType,
    software: request.software,
    nodes: request.nodes,
    newNode: request.newNode,
    filters: request.filters,
    templateKey: request.templateKey,
    mapping: request.mapping,
    sources: request.sources,
  });
}

export function knowledgeBuildPreviewHash(request: KnowledgeBuildRequest): string {
  return crypto.createHash('sha256').update(canonicalRequest(normalizeRequest(request))).digest('hex');
}

function softwareRows(): SoftwareRow[] {
  return db
    .prepare(
      `SELECT id, name, category, website, repo, description, watch_status, watch_level,
         current_version, latest_version
       FROM software
       WHERE deleted_at IS NULL
       ORDER BY name COLLATE NOCASE`,
    )
    .all() as SoftwareRow[];
}

function activeDomain(id: string | null | undefined): DomainRow | null {
  if (!id) return null;
  const row = db
    .prepare('SELECT id, name, status FROM tech_domains WHERE id = ?')
    .get(id) as DomainRow | undefined;
  return row ?? null;
}

function linkedNodesForSoftware(softwareId: string, skipArchived: boolean): LinkedNodeRow[] {
  return db
    .prepare(
      `SELECT tn.id, tn.name, tn.domain_id, td.name AS domain_name, tn.parent_id,
         tn.node_type, tn.content_markdown, tn.content_status, tn.content_source,
         tn.applicable_versions, tn.content_verified_at, tn.verified_version,
         tn.docs_url, tn.repo_url, tn.reference_links, tn.summary, tn.description,
         tn.technical_role, tn.core_principle, tn.solved_problem, tn.key_mechanism,
         tn.use_cases, tn.common_issues, tn.status
       FROM tech_node_software tns
       JOIN tech_nodes tn ON tn.id = tns.node_id
       JOIN tech_domains td ON td.id = tn.domain_id
       WHERE tns.software_id = ? ${skipArchived ? "AND tn.status = 'active'" : ''}
       ORDER BY tn.created_at`,
    )
    .all(softwareId) as LinkedNodeRow[];
}

function nodeRowsForScope(scope: KnowledgeBuildNodeScope, filters: NormalizedRequest['filters']): NodeRow[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.activeOnly) clauses.push("tn.status = 'active'");
  if (filters.skipArchived) clauses.push("tn.status != 'archived'");
  if (scope.domainId) {
    clauses.push('tn.domain_id = ?');
    params.push(scope.domainId);
  }
  if (scope.nodeType) {
    clauses.push('tn.node_type = ?');
    params.push(scope.nodeType);
  }
  if (scope.ids?.length) {
    clauses.push(`tn.id IN (${scope.ids.map(() => '?').join(', ')})`);
    params.push(...scope.ids);
  }
  if (scope.parentId && scope.includeSubtree) {
    clauses.push(
      `tn.id IN (WITH RECURSIVE subtree(id) AS (
         SELECT id FROM tech_nodes WHERE id = ?
         UNION ALL
         SELECT n.id FROM tech_nodes n JOIN subtree s ON n.parent_id = s.id
       ) SELECT id FROM subtree)`,
    );
    params.push(scope.parentId);
  } else if (scope.parentId) {
    clauses.push('tn.parent_id = ?');
    params.push(scope.parentId);
  }
  if (filters.excludeNodeIds.length) {
    clauses.push(`tn.id NOT IN (${filters.excludeNodeIds.map(() => '?').join(', ')})`);
    params.push(...filters.excludeNodeIds);
  }
  if (scope.selection === 'no_body') {
    clauses.push("(tn.content_markdown IS NULL OR TRIM(tn.content_markdown) = '')");
  } else if (scope.selection === 'draft') {
    clauses.push("tn.content_status = 'draft'");
  } else if (scope.selection === 'needs_review') {
    clauses.push("tn.content_status = 'needs_review'");
  } else if (scope.selection === 'unlinked') {
    clauses.push('NOT EXISTS (SELECT 1 FROM tech_node_software tns WHERE tns.node_id = tn.id)');
  }
  if (filters.onlyMissing) {
    clauses.push("(tn.content_markdown IS NULL OR TRIM(tn.content_markdown) = '')");
  }
  if (filters.onlyDraft) {
    clauses.push("tn.content_status = 'draft'");
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT tn.id, tn.domain_id, td.name AS domain_name, tn.parent_id, tn.name, tn.node_type,
         tn.summary, tn.description, tn.technical_role, tn.core_principle, tn.solved_problem,
         tn.key_mechanism, tn.use_cases, tn.common_issues, tn.docs_url, tn.repo_url,
         tn.reference_links, tn.content_markdown, tn.content_status, tn.content_source,
         tn.applicable_versions, tn.content_verified_at, tn.verified_version,
         tn.relation_review_status, tn.relation_review_note, tn.status
       FROM tech_nodes tn
       JOIN tech_domains td ON td.id = tn.domain_id
       ${where}
       ORDER BY td.sort_order, tn.sort_order, tn.name COLLATE NOCASE`,
    )
    .all(...params) as NodeRow[];
}

function findSameNameNode(domainId: string, name: string): NodeRow | null {
  const row = db
    .prepare(
      `SELECT tn.id, tn.domain_id, td.name AS domain_name, tn.parent_id, tn.name, tn.node_type,
         tn.summary, tn.description, tn.technical_role, tn.core_principle, tn.solved_problem,
         tn.key_mechanism, tn.use_cases, tn.common_issues, tn.docs_url, tn.repo_url,
         tn.reference_links, tn.content_markdown, tn.content_status, tn.content_source,
         tn.applicable_versions, tn.content_verified_at, tn.verified_version,
         tn.relation_review_status, tn.relation_review_note, tn.status
       FROM tech_nodes tn
       JOIN tech_domains td ON td.id = tn.domain_id
       WHERE tn.domain_id = ? AND tn.status = 'active' AND LOWER(TRIM(tn.name)) = LOWER(TRIM(?))
       LIMIT 1`,
    )
    .get(domainId, name) as NodeRow | undefined;
  return row ?? null;
}

function sourceCoverage(
  node: LinkedNodeRow | NodeRow | null,
  software: SoftwareRow | null,
  sources: KnowledgeBuildSourceInput,
): boolean {
  const urls = [
    sources.docsUrl,
    ...(sources.referenceLinks ?? []).map((link) => link.url),
    node?.docs_url,
    node?.repo_url,
    ...(node ? parseJson<TechExternalLink[]>(node.reference_links, []).map((link) => link.url) : []),
    software?.website,
    software?.repo,
  ];
  return new Set(urls.filter((url) => isHttpsUrl(url)).map((url) => canonicalUrl(url!))).size >= 2;
}

function shouldSkipExisting(
  node: LinkedNodeRow | NodeRow,
  filters: NormalizedRequest['filters'],
): string | null {
  const hasBody = hasMarkdown(node.content_markdown);
  if (filters.onlyMissing && hasBody) return '已有正文，不符合“仅无文档”筛选';
  if (filters.onlyDraft && node.content_status !== 'draft') {
    return '文档状态不是草稿，不符合“仅草稿”筛选';
  }
  if (hasBody) return '已有正文，按默认策略跳过，不会覆盖';
  if (filters.skipVerified && (node.content_verified_at || node.content_status === 'complete')) {
    return '已有验证记录，跳过';
  }
  return null;
}

function itemBase(): Omit<KnowledgeBuildPreviewItem, 'key' | 'action'> {
  return {
    softwareId: null,
    softwareName: null,
    nodeId: null,
    nodeName: null,
    domainId: null,
    domainName: null,
    nodeType: null,
    templateKey: null,
    reason: null,
  };
}

function mappedName(software: SoftwareRow, mapping: KnowledgeBuildMapping): string {
  const template = mapping.nameTemplate?.trim();
  if (!template) return software.name;
  return template.replaceAll('{name}', software.name).trim() || software.name;
}

function softwareCandidate(
  software: SoftwareRow,
  request: NormalizedRequest,
  links: LinkedNodeRow[],
): Candidate {
  const item = itemBase();
  item.softwareId = software.id;
  item.softwareName = software.name;
  item.templateKey = request.templateKey;
  const activeLinks = links;
  if (activeLinks.length > 1) {
    return {
      item: {
        ...item,
        key: `sw:${software.id}`,
        action: 'pending',
        reason: '该软件已关联多个技术节点，需要手动选择要初始化的节点',
      },
      software,
    };
  }
  if (activeLinks.length === 1) {
    const node = activeLinks[0];
    Object.assign(item, {
      nodeId: node.id,
      nodeName: node.name,
      domainId: node.domain_id,
      domainName: node.domain_name,
      nodeType: node.node_type,
    });
    const skip = shouldSkipExisting(node, request.filters);
    if (skip) {
      return {
        item: { ...item, key: `node:${node.id}`, action: 'skip', reason: skip },
        software,
        linkedNode: node,
        sourceNodeId: node.id,
      };
    }
    return {
      item: {
        ...item,
        key: `node:${node.id}`,
        action: 'initialize_doc',
        reason: '已有技术节点但没有正文，初始化标准草稿',
      },
      software,
      linkedNode: node,
      sourceNodeId: node.id,
    };
  }

  const strategy = request.mapping.linkStrategy;
  if (strategy === 'none') {
    return {
      item: {
        ...item,
        key: `sw:${software.id}`,
        action: 'pending',
        reason: '软件尚未关联技术节点，需先选择“关联现有节点”或“新建节点”',
      },
      software,
    };
  }

  const name = mappedName(software, request.mapping);
  if (strategy === 'link_existing') {
    let node: NodeRow | null = null;
    if (request.mapping.nodeId) {
      node = findNodeById(request.mapping.nodeId);
    } else {
      const domainId = request.mapping.domainId ?? request.nodes.domainId ?? null;
      if (domainId) node = findSameNameNode(domainId, name);
    }
    if (!node) {
      return {
        item: {
          ...item,
          key: `sw:${software.id}`,
          nodeName: name,
          action: 'pending',
          reason: request.mapping.nodeId
            ? '指定的技术节点不存在或已归档'
            : '未指定关联节点，且没有在目标领域找到唯一同名节点',
        },
        software,
      };
    }
    Object.assign(item, {
      nodeId: node.id,
      nodeName: node.name,
      domainId: node.domain_id,
      domainName: node.domain_name,
      nodeType: node.node_type,
    });
    const hasBody = hasMarkdown(node.content_markdown);
    if (!hasBody && request.mapping.initializeOnLink) {
      return {
        item: {
          ...item,
          key: `node:${node.id}`,
          action: 'link_and_initialize',
          reason: '关联现有节点，并在同一事务中初始化标准草稿',
        },
        software,
        node,
        sourceNodeId: node.id,
      };
    }
    return {
      item: {
        ...item,
        key: `node:${node.id}`,
        action: 'link_existing',
        reason: hasBody
          ? '只建立关联，保留现有文档'
          : '只建立关联，不初始化文档',
      },
      software,
      node,
      sourceNodeId: node.id,
    };
  }

  const domain = activeDomain(request.mapping.domainId ?? request.nodes.domainId);
  if (!domain) {
    return {
      item: {
        ...item,
        key: `sw:${software.id}`,
        nodeName: name,
        action: 'pending',
        reason: '新建节点前必须明确目标领域，系统不会猜测',
      },
      software,
    };
  }
  if (domain.status !== 'active') {
    return {
      item: {
        ...item,
        key: `sw:${software.id}`,
        nodeName: name,
        domainId: domain.id,
        domainName: domain.name,
        action: 'pending',
        reason: '目标领域已归档，不能新建节点',
      },
      software,
    };
  }
  const duplicate = findSameNameNode(domain.id, name);
  if (duplicate) {
    return {
      item: {
        ...item,
        key: `sw:${software.id}`,
        nodeId: duplicate.id,
        nodeName: duplicate.name,
        domainId: duplicate.domain_id,
        domainName: duplicate.domain_name,
        nodeType: duplicate.node_type,
        action: 'pending',
        reason: '目标领域已存在同名节点。请先确认是否应关联它，系统不会按名称自动合并',
      },
      software,
    };
  }
  if (request.mapping.parentId) {
    const parent = findNodeById(request.mapping.parentId);
    if (!parent || parent.domain_id !== domain.id || parent.status !== 'active') {
      return {
        item: {
          ...item,
          key: `sw:${software.id}`,
          nodeName: name,
          domainId: domain.id,
          domainName: domain.name,
          action: 'pending',
          reason: '目标父节点不存在、已归档或不属于目标领域',
        },
        software,
      };
    }
  }
  const nodeType = request.mapping.nodeType ?? 'component';
  return {
    item: {
      ...item,
      key: `sw:${software.id}`,
      nodeName: name,
      domainId: domain.id,
      domainName: domain.name,
      nodeType,
      action: 'create_node',
      reason: '新建技术节点、关联软件并初始化标准草稿',
    },
    software,
    create: {
      domainId: domain.id,
      parentId: request.mapping.parentId ?? null,
      name,
      nodeType,
      summary: software.description,
    },
  };
}

function nodeCandidate(node: NodeRow, request: NormalizedRequest): Candidate {
  const item: KnowledgeBuildPreviewItem = {
    ...itemBase(),
    key: `node:${node.id}`,
    action: 'initialize_doc',
    nodeId: node.id,
    nodeName: node.name,
    domainId: node.domain_id,
    domainName: node.domain_name,
    nodeType: node.node_type,
    templateKey: request.templateKey,
    reason: '节点没有正文，初始化标准草稿',
  };
  const skip = shouldSkipExisting(node, request.filters);
  if (skip) {
    return { item: { ...item, action: 'skip', reason: skip }, node, sourceNodeId: node.id };
  }
  return { item, node, sourceNodeId: node.id };
}

function findNodeById(id: string): NodeRow | null {
  const row = db
    .prepare(
      `SELECT tn.id, tn.domain_id, td.name AS domain_name, tn.parent_id, tn.name, tn.node_type,
         tn.summary, tn.description, tn.technical_role, tn.core_principle, tn.solved_problem,
         tn.key_mechanism, tn.use_cases, tn.common_issues, tn.docs_url, tn.repo_url,
         tn.reference_links, tn.content_markdown, tn.content_status, tn.content_source,
         tn.applicable_versions, tn.content_verified_at, tn.verified_version,
         tn.relation_review_status, tn.relation_review_note, tn.status
       FROM tech_nodes tn
       JOIN tech_domains td ON td.id = tn.domain_id
       WHERE tn.id = ?`,
    )
    .get(id) as NodeRow | undefined;
  return row ?? null;
}

function resolveSoftwareCandidates(request: NormalizedRequest): Candidate[] {
  const scope = request.software;
  let rows = softwareRows();
  if (request.filters.skipArchived) rows = rows.filter((row) => row.watch_status !== 'archived');
  if (request.filters.activeOnly) rows = rows.filter((row) => row.watch_status === 'active');
  if (scope.watchStatus) rows = rows.filter((row) => row.watch_status === scope.watchStatus);
  if (scope.category) rows = rows.filter((row) => row.category === scope.category);
  if (scope.ids?.length) {
    const ids = new Set(scope.ids);
    rows = rows.filter((row) => ids.has(row.id));
  }
  if (request.filters.excludeSoftwareIds.length) {
    const ids = new Set(request.filters.excludeSoftwareIds);
    rows = rows.filter((row) => !ids.has(row.id));
  }
  const candidates: Candidate[] = [];
  for (const software of rows) {
    const links = linkedNodesForSoftware(software.id, request.filters.skipArchived);
    if (scope.selection === 'unlinked' && links.length) continue;
    if (scope.selection === 'watchlist' && software.watch_level === 'normal' && software.watch_status !== 'active') {
      continue;
    }
    if (scope.selection === 'linked_without_markdown' && !links.some((node) => !hasMarkdown(node.content_markdown))) {
      continue;
    }
    if (scope.selection === 'linked_draft' && !links.some((node) => node.content_status === 'draft' && hasMarkdown(node.content_markdown))) {
      continue;
    }
    candidates.push(softwareCandidate(software, request, links));
  }
  return candidates;
}

function resolveNodeCandidates(request: NormalizedRequest): Candidate[] {
  const rows = nodeRowsForScope(request.nodes, request.filters);
  return rows.map((node) => nodeCandidate(node, request));
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const result: Candidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.item.nodeId ? `node:${candidate.item.nodeId}` : candidate.item.key;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

type PreviewBase = Omit<KnowledgeBuildPreview, 'previewId' | 'expiresAt'>;

function sha256Text(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function softwareById(id: string): SoftwareRow | null {
  const row = db
    .prepare(
      `SELECT id, name, category, website, repo, description, watch_status, watch_level,
         current_version, latest_version
       FROM software WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(id) as SoftwareRow | undefined;
  return row ?? null;
}

interface RelationReviewFields {
  relation_review_status: 'unreviewed' | 'independent';
  relation_review_note: string | null;
}

function nodeAssociationIds(nodeId: string): {
  softwareIds: string[];
  relationIds: string[];
} {
  const softwareIds = (
    db
      .prepare('SELECT software_id FROM tech_node_software WHERE node_id = ? ORDER BY software_id')
      .all(nodeId) as Array<{ software_id: string }>
  ).map((row) => row.software_id);
  const relationIds = (
    db
      .prepare(
        `SELECT id FROM tech_relations
         WHERE source_node_id = ? OR target_node_id = ?
         ORDER BY id`,
      )
      .all(nodeId, nodeId) as Array<{ id: string }>
  ).map((row) => row.id);
  return { softwareIds, relationIds };
}

function nodeSnapshotMetadata(node: NodeRow | LinkedNodeRow | null) {
  if (!node) return null;
  const relationReview = node as Partial<RelationReviewFields>;
  const association = nodeAssociationIds(node.id);
  return {
    id: node.id,
    name: node.name,
    domainId: node.domain_id,
    parentId: node.parent_id,
    nodeType: node.node_type,
    status: node.status,
    contentStatus: node.content_status,
    contentHash: node.content_markdown ? sha256Text(node.content_markdown) : null,
    contentSource: node.content_source,
    applicableVersions: node.applicable_versions,
    contentVerifiedAt: node.content_verified_at,
    verifiedVersion: node.verified_version,
    docsUrl: node.docs_url,
    repoUrl: node.repo_url,
    referenceLinks: parseJson<TechExternalLink[]>(node.reference_links, []),
    summary: node.summary,
    description: node.description,
    technicalRole: node.technical_role,
    corePrinciple: node.core_principle,
    solvedProblem: node.solved_problem,
    keyMechanism: node.key_mechanism,
    useCases: node.use_cases,
    commonIssues: node.common_issues,
    relationReviewStatus: relationReview.relation_review_status ?? 'unreviewed',
    relationReviewNote: relationReview.relation_review_note ?? null,
    softwareIds: association.softwareIds,
    relationIds: association.relationIds,
  };
}

function softwareSnapshotMetadata(software: SoftwareRow | null) {
  if (!software) return null;
  return {
    id: software.id,
    name: software.name,
    category: software.category,
    description: software.description,
    website: software.website,
    repo: software.repo,
    watchStatus: software.watch_status,
    watchLevel: software.watch_level,
    currentVersion: software.current_version,
    latestVersion: software.latest_version,
  };
}

function createSnapshotMetadata(
  item: KnowledgeBuildPreviewItem,
  request: NormalizedRequest,
  software: SoftwareRow | null,
) {
  if (item.action !== 'create_node') return null;
  let config: {
    domainId: string;
    parentId: string | null;
    name: string;
    nodeType: TechNodeType;
    summary: string | null;
  };
  if (request.scopeType === 'new') {
    const newNode = request.newNode!;
    config = {
      domainId: newNode.domainId,
      parentId: newNode.parentId ?? null,
      name: newNode.name.trim(),
      nodeType: newNode.nodeType,
      summary: newNode.summary?.trim() || null,
    };
  } else {
    config = {
      domainId: request.mapping.domainId ?? request.nodes.domainId ?? '',
      parentId: request.mapping.parentId ?? null,
      name: software ? mappedName(software, request.mapping) : (item.nodeName ?? ''),
      nodeType: request.mapping.nodeType ?? 'component',
      summary: software?.description ?? null,
    };
  }
  const domain = config.domainId ? activeDomain(config.domainId) : null;
  const parent = config.parentId ? findNodeById(config.parentId) : null;
  const duplicate = domain ? findSameNameNode(domain.id, config.name) : null;
  return {
    ...config,
    domain: domain ? { id: domain.id, name: domain.name, status: domain.status } : null,
    parent: parent
      ? {
          id: parent.id,
          name: parent.name,
          status: parent.status,
          domainId: parent.domain_id,
        }
      : null,
    duplicate: nodeSnapshotMetadata(duplicate),
  };
}

interface PreviewSnapshotItem {
  key: string;
  action: KnowledgeBuildPreviewItem['action'];
  softwareId: string | null;
  softwareName: string | null;
  nodeId: string | null;
  nodeName: string | null;
  domainId: string | null;
  templateKey: KnowledgeBuildTemplateKey;
  fingerprint: string;
}

function snapshotPreview(
  request: NormalizedRequest,
  preview: PreviewBase,
): { items: PreviewSnapshotItem[]; hash: string } {
  const items = preview.items
    .map((item) => {
      const software = item.softwareId ? softwareById(item.softwareId) : null;
      const node = item.nodeId ? findNodeById(item.nodeId) : null;
      const fingerprint = sha256Text(
        JSON.stringify({
          action: item.action,
          software: softwareSnapshotMetadata(software),
          node: nodeSnapshotMetadata(node),
          create: createSnapshotMetadata(item, request, software),
        }),
      );
      return {
        key: item.key,
        action: item.action,
        softwareId: item.softwareId ?? null,
        softwareName: item.softwareName ?? null,
        nodeId: item.nodeId ?? null,
        nodeName: item.nodeName ?? null,
        domainId: item.domainId ?? null,
        templateKey: request.templateKey,
        fingerprint,
      };
    })
    .sort((left, right) =>
      left.key === right.key
        ? left.action.localeCompare(right.action)
        : left.key.localeCompare(right.key),
    );
  return { items, hash: sha256Text(JSON.stringify(items)) };
}

const PREVIEW_TTL_MS = 10 * 60 * 1000;

interface PreviewRow {
  id: string;
  request_hash: string;
  candidate_hash: string;
  candidate_snapshot: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

function cleanupExpiredPreviews(): void {
  db.prepare('DELETE FROM tech_knowledge_build_previews WHERE expires_at < ?').run(nowIso());
}

function buildPreview(request: NormalizedRequest): PreviewBase {
  let candidates: Candidate[] = [];
  if (request.scopeType === 'software') {
    candidates = resolveSoftwareCandidates(request);
  } else if (request.scopeType === 'nodes') {
    candidates = resolveNodeCandidates(request);
  } else if (request.scopeType === 'combined') {
    const softwareCandidates = resolveSoftwareCandidates(request);
    const nodeCandidates = resolveNodeCandidates(request);
    const domainId = request.nodes.domainId ?? null;
    const filteredSoftware = domainId
      ? softwareCandidates.filter(
          (candidate) =>
            candidate.item.domainId === domainId ||
            (candidate.create && candidate.create.domainId === domainId) ||
            candidate.item.action === 'pending',
        )
      : softwareCandidates;
    candidates = dedupeCandidates([...filteredSoftware, ...nodeCandidates]);
  } else {
    const newNode = request.newNode!;
    const domain = activeDomain(newNode.domainId);
    const item = itemBase();
    item.nodeName = newNode.name.trim();
    item.domainId = newNode.domainId;
    item.domainName = domain?.name ?? null;
    item.nodeType = newNode.nodeType;
    item.templateKey = request.templateKey;
    if (!domain || domain.status !== 'active') {
      candidates = [{
        item: {
          ...item,
          key: 'new:0',
          action: 'pending',
          reason: '目标领域不存在或已归档',
        },
      }];
    } else {
      const duplicate = findSameNameNode(domain.id, newNode.name.trim());
      if (duplicate) {
        candidates = [{
          item: {
            ...item,
            key: `node:${duplicate.id}`,
            nodeId: duplicate.id,
            nodeName: duplicate.name,
            action: 'pending',
            reason: '目标领域已存在同名节点，系统不会按名称自动合并',
          },
          node: duplicate,
        }];
      } else if (newNode.parentId) {
        const parent = findNodeById(newNode.parentId);
        if (!parent || parent.domain_id !== domain.id || parent.status !== 'active') {
          candidates = [{
            item: {
              ...item,
              key: 'new:0',
              action: 'pending',
              reason: '目标父节点不存在、已归档或不属于目标领域',
            },
          }];
        } else {
          candidates = [{
            item: {
              ...item,
              key: 'new:0',
              action: 'create_node',
              reason: '创建新知识节点并初始化标准草稿',
            },
            create: {
              domainId: domain.id,
              parentId: newNode.parentId,
              name: newNode.name.trim(),
              nodeType: newNode.nodeType,
              summary: newNode.summary?.trim() || null,
            },
          }];
        }
      } else {
        candidates = [{
          item: {
            ...item,
            key: 'new:0',
            action: 'create_node',
            reason: '创建新知识节点并初始化标准草稿',
          },
          create: {
            domainId: domain.id,
            parentId: null,
            name: newNode.name.trim(),
            nodeType: newNode.nodeType,
            summary: newNode.summary?.trim() || null,
          },
        }];
      }
    }
  }

  const counts: KnowledgeBuildPreviewCounts = {
    selectedSoftware: 0,
    selectedNodes: 0,
    linkedNodes: 0,
    unlinkedSoftware: 0,
    createNode: 0,
    linkExisting: 0,
    linkAndInitialize: 0,
    initializeDoc: 0,
    skip: 0,
    pending: 0,
    missingOfficialSource: 0,
    needsParent: 0,
  };
  const linkedNodeIds = new Set<string>();
  const selectedNodeIds = new Set<string>();
  const softwareIds = new Set<string>();
  const warnings = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.software) softwareIds.add(candidate.software.id);
    if (candidate.item.nodeId) linkedNodeIds.add(candidate.item.nodeId);
    if (candidate.node || candidate.linkedNode) selectedNodeIds.add(candidate.item.nodeId!);
    if (candidate.item.action === 'create_node') counts.createNode += 1;
    if (candidate.item.action === 'link_existing') counts.linkExisting += 1;
    if (candidate.item.action === 'link_and_initialize') counts.linkAndInitialize += 1;
    if (candidate.item.action === 'initialize_doc') counts.initializeDoc += 1;
    if (candidate.item.action === 'skip') counts.skip += 1;
    if (candidate.item.action === 'pending') {
      counts.pending += 1;
      if (
        candidate.item.reason?.includes('领域') ||
        candidate.item.reason?.includes('父节点') ||
        candidate.item.reason?.includes('关联')
      ) {
        counts.needsParent += 1;
      }
    }
    if (candidate.software && !candidate.linkedNode && !candidate.item.nodeId) {
      counts.unlinkedSoftware += 1;
    }
    if (
      candidate.item.action === 'initialize_doc' ||
      candidate.item.action === 'create_node' ||
      candidate.item.action === 'link_existing' ||
      candidate.item.action === 'link_and_initialize'
    ) {
      const node = candidate.linkedNode ?? candidate.node ?? null;
      if (!sourceCoverage(node, candidate.software ?? null, request.sources)) {
        counts.missingOfficialSource += 1;
        warnings.add('部分目标缺少两个可用的 HTTPS 官方来源，初始化后仍需补充。');
      }
    }
  }
  counts.selectedSoftware = softwareIds.size;
  counts.selectedNodes = selectedNodeIds.size;
  counts.linkedNodes = linkedNodeIds.size;
  if (counts.pending) warnings.add('存在需要人工决定的项，系统不会猜测领域、父节点或关联方式。');
  if (counts.createNode) warnings.add('新建节点和文档会保存为草稿，不会自动标记为已完善。');
  warnings.add('预览只检查结构；链接可达性与技术正确性需要另行核实。');
  const previewHash = crypto
    .createHash('sha256')
    .update(canonicalRequest(request))
    .digest('hex');
  return {
    scopeType: request.scopeType,
    previewHash,
    counts,
    items: candidates.map((candidate) => candidate.item),
    warnings: [...warnings],
  };
}

function contextForNode(
  name: string,
  nodeType: TechNodeType,
  node: NodeRow | LinkedNodeRow | null,
  software: SoftwareRow | null,
  request: NormalizedRequest,
  summaryOverride?: string | null,
): KnowledgeDocumentContext {
  const references = [
    ...(node ? parseJson<TechExternalLink[]>(node.reference_links, []) : []),
    ...(request.sources.referenceLinks ?? []),
  ];
  if (isHttpsUrl(software?.website)) {
    references.push({ label: '官方网站', url: software!.website! });
  }
  if (isHttpsUrl(software?.repo)) {
    references.push({ label: '源码仓库', url: software!.repo! });
  }
  return {
    name,
    nodeType,
    summary: summaryOverride ?? node?.summary ?? software?.description ?? null,
    description: node?.description ?? null,
    technicalRole: node?.technical_role ?? null,
    corePrinciple: node?.core_principle ?? null,
    solvedProblem: node?.solved_problem ?? null,
    keyMechanism: node?.key_mechanism ?? null,
    useCases: node?.use_cases ?? null,
    commonIssues: node?.common_issues ?? null,
    docsUrl: node?.docs_url ?? request.sources.docsUrl ?? null,
    repoUrl: node?.repo_url ?? software?.repo ?? null,
    referenceLinks: references,
    applicableVersions: node?.applicable_versions ?? null,
    currentVersion: software?.current_version ?? null,
    latestVersion: software?.latest_version ?? null,
    category: software?.category ?? null,
    website: software?.website ?? null,
  };
}

function renderFor(
  request: NormalizedRequest,
  name: string,
  nodeType: TechNodeType,
  node: NodeRow | LinkedNodeRow | null,
  software: SoftwareRow | null,
  summaryOverride?: string | null,
): string {
  const template = getKnowledgeBuildTemplate(request.templateKey) as KnowledgeTemplateDefinition;
  return renderKnowledgeDocument(
    template,
    contextForNode(name, nodeType, node, software, request, summaryOverride),
  );
}

function persistedSources(
  request: NormalizedRequest,
  software: SoftwareRow | null,
): TechExternalLink[] {
  const links = [...(request.sources.referenceLinks ?? [])];
  if (isHttpsUrl(software?.website)) {
    links.push({ label: '官方网站', url: software!.website! });
  }
  if (isHttpsUrl(software?.repo)) {
    links.push({ label: '源码仓库', url: software!.repo! });
  }
  return uniqueHttpsLinks(links);
}

function mergeReferenceLinks(
  existing: string,
  additions: TechExternalLink[] | undefined,
): string {
  const current = parseJson<TechExternalLink[]>(existing, []).filter(
    (link) => link && typeof link.label === 'string' && typeof link.url === 'string',
  );
  const seen = new Set(current.map((link) => link.url));
  const merged = [...current];
  for (const link of additions ?? []) {
    if (!isHttpsUrl(link.url)) continue;
    const key = canonicalUrl(link.url);
    if (seen.has(key) || seen.has(link.url.trim())) continue;
    seen.add(key);
    merged.push({ label: link.label.trim() || '官方资料', url: link.url.trim() });
  }
  return JSON.stringify(merged);
}

function initializeExistingNode(
  nodeId: string,
  request: NormalizedRequest,
  software: SoftwareRow | null,
): { status: KnowledgeBuildResultStatus; message: string } {
  const run = db.transaction(() => {
    const node = findNodeById(nodeId);
    if (!node) return { status: 'failed' as const, message: '技术节点不存在' };
    if (hasMarkdown(node.content_markdown)) {
      return { status: 'skipped' as const, message: '已有正文，未覆盖' };
    }
    const markdown = renderFor(request, node.name, node.node_type, node, software);
    const referenceLinks = mergeReferenceLinks(
      node.reference_links,
      persistedSources(request, software),
    );
    const timestamp = nowIso();
    db.prepare(
      `UPDATE tech_nodes SET content_markdown = ?, content_status = 'draft',
         docs_url = COALESCE(NULLIF(TRIM(docs_url), ''), ?),
         repo_url = COALESCE(NULLIF(TRIM(repo_url), ''), ?),
         reference_links = ?, content_updated_at = ?, updated_at = ?
       WHERE id = ? AND (content_markdown IS NULL OR TRIM(content_markdown) = '')`,
    ).run(
      markdown,
      request.sources.docsUrl ?? null,
      software?.repo ?? null,
      referenceLinks,
      timestamp,
      timestamp,
      nodeId,
    );
    return { status: 'initialized' as const, message: '已初始化标准草稿' };
  });
  return run();
}

function createNodeWithDocument(
  create: NonNullable<Candidate['create']>,
  request: NormalizedRequest,
  software: SoftwareRow | null,
): { status: KnowledgeBuildResultStatus; message: string; nodeId: string | null } {
  const run = db.transaction(() => {
    const domain = activeDomain(create.domainId);
    if (!domain || domain.status !== 'active') {
      return { status: 'pending' as const, message: '目标领域不存在或已归档', nodeId: null };
    }
    if (create.parentId) {
      const parent = findNodeById(create.parentId);
      if (!parent || parent.domain_id !== domain.id || parent.status !== 'active') {
        return { status: 'pending' as const, message: '目标父节点不可用', nodeId: null };
      }
    }
    const duplicate = findSameNameNode(domain.id, create.name);
    if (duplicate) {
      return {
        status: 'pending' as const,
        message: '目标领域已存在同名节点，未自动合并',
        nodeId: duplicate.id,
      };
    }
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    const markdown = renderFor(
      request,
      create.name,
      create.nodeType,
      null,
      software,
      create.summary,
    );
    const references = mergeReferenceLinks('[]', persistedSources(request, software));
    const max = db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), 0) AS value FROM tech_nodes
         WHERE domain_id = ? AND ${create.parentId ? 'parent_id = ?' : 'parent_id IS NULL'}`,
      )
      .get(...(create.parentId ? [domain.id, create.parentId] : [domain.id])) as { value: number };
    db.prepare(
      `INSERT INTO tech_nodes
        (id, domain_id, parent_id, name, node_type, summary, description, technical_role,
         core_principle, solved_problem, key_mechanism, use_cases, common_issues, docs_url,
         repo_url, reference_links, personal_notes, research_questions, content_markdown,
         content_status, content_source, applicable_versions, content_updated_at,
         mastery_status, focus_level, status, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, NULL, NULL,
         ?, 'draft', NULL, NULL, ?, 'unknown', 'normal', 'active', ?, ?, ?)`,
    ).run(
      id,
      domain.id,
      create.parentId,
      create.name,
      create.nodeType,
      create.summary ?? software?.description ?? null,
      null,
      request.sources.docsUrl ?? null,
      software?.repo ?? null,
      references,
      markdown,
      timestamp,
      max.value + 1,
      timestamp,
      timestamp,
    );
    if (software) {
      db.prepare(
        `INSERT INTO tech_node_software (node_id, software_id, created_at)
         VALUES (?, ?, ?) ON CONFLICT(node_id, software_id) DO NOTHING`,
      ).run(id, software.id, timestamp);
    }
    return {
      status: 'created' as const,
      message: software
        ? '已创建节点、关联软件并初始化草稿'
        : '已创建节点并初始化草稿',
      nodeId: id,
    };
  });
  return run();
}

function insertSoftwareLink(nodeId: string, software: SoftwareRow | null): void {
  if (!software) return;
  db.prepare(
    `INSERT INTO tech_node_software (node_id, software_id, created_at)
     VALUES (?, ?, ?) ON CONFLICT(node_id, software_id) DO NOTHING`,
  ).run(nodeId, software.id, nowIso());
}

/**
 * Association is deliberately independent from document initialization.
 * Linking to a node with an existing body must never rewrite that body.
 */
function linkExistingNode(
  nodeId: string,
  software: SoftwareRow | null,
): { status: KnowledgeBuildResultStatus; message: string } {
  const run = db.transaction(() => {
    const node = findNodeById(nodeId);
    if (!node) return { status: 'failed' as const, message: '技术节点不存在' };
    insertSoftwareLink(nodeId, software);
    return {
      status: 'linked' as const,
      message: hasMarkdown(node.content_markdown)
        ? '已关联软件，保留现有文档'
        : '已关联软件，未初始化文档',
    };
  });
  return run();
}

/**
 * Link and initialization share one transaction so a failed initialization
 * cannot leave a half-completed association behind.
 */
function linkAndInitializeNode(
  nodeId: string,
  request: NormalizedRequest,
  software: SoftwareRow | null,
): { status: KnowledgeBuildResultStatus; message: string } {
  const run = db.transaction(() => {
    const node = findNodeById(nodeId);
    if (!node) return { status: 'failed' as const, message: '技术节点不存在' };
    insertSoftwareLink(nodeId, software);
    if (hasMarkdown(node.content_markdown)) {
      return {
        status: 'linked' as const,
        message: '已关联软件；目标已有正文，未初始化',
      };
    }
    const markdown = renderFor(request, node.name, node.node_type, node, software);
    const referenceLinks = mergeReferenceLinks(
      node.reference_links,
      persistedSources(request, software),
    );
    const timestamp = nowIso();
    const result = db
      .prepare(
        `UPDATE tech_nodes SET content_markdown = ?, content_status = 'draft',
           docs_url = COALESCE(NULLIF(TRIM(docs_url), ''), ?),
           repo_url = COALESCE(NULLIF(TRIM(repo_url), ''), ?),
           reference_links = ?, content_updated_at = ?, updated_at = ?
         WHERE id = ? AND (content_markdown IS NULL OR TRIM(content_markdown) = '')`,
      )
      .run(
        markdown,
        request.sources.docsUrl ?? null,
        software?.repo ?? null,
        referenceLinks,
        timestamp,
        timestamp,
        nodeId,
      );
    if (!result.changes) {
      throw new Error('目标节点已被其他操作写入正文，已回滚关联');
    }
    return {
      status: 'linked' as const,
      message: '已关联软件并初始化标准草稿',
    };
  });
  return run();
}

export function previewKnowledgeBuild(input: KnowledgeBuildRequest): KnowledgeBuildPreview {
  const request = normalizeRequest(input);
  const preview = buildPreview(request);
  const snapshot = snapshotPreview(request, preview);
  cleanupExpiredPreviews();
  const previewId = crypto.randomUUID();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO tech_knowledge_build_previews
      (id, request_hash, candidate_hash, candidate_snapshot, expires_at, consumed_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
  ).run(
    previewId,
    preview.previewHash,
    snapshot.hash,
    JSON.stringify(snapshot.items),
    expiresAt,
    createdAt,
  );
  return { ...preview, previewId, expiresAt };
}

function claimPreview(
  previewId: string,
  requestHash: string,
): { row: PreviewRow; candidateHash: string } {
  cleanupExpiredPreviews();
  const row = db
    .prepare('SELECT * FROM tech_knowledge_build_previews WHERE id = ?')
    .get(previewId) as PreviewRow | undefined;
  if (!row) {
    throw new KnowledgeBuildError('预览不存在或已经过期，请重新预览。', 409);
  }
  if (row.consumed_at) {
    throw new KnowledgeBuildError('该预览已经执行，不能重复使用。', 409);
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM tech_knowledge_build_previews WHERE id = ?').run(row.id);
    throw new KnowledgeBuildError('预览不存在或已经过期，请重新预览。', 409);
  }
  if (row.request_hash !== requestHash) {
    throw new KnowledgeBuildError('预览参数与执行请求不一致。', 409);
  }
  return { row, candidateHash: row.candidate_hash };
}

export function executeKnowledgeBuild(input: KnowledgeBuildRequest): KnowledgeBuildResult {
  if (!input.confirmed) {
    throw new KnowledgeBuildError('执行前必须确认预览范围');
  }
  if (!input.previewId) {
    throw new KnowledgeBuildError('执行前必须先获取预览，并携带 previewId。', 400);
  }
  const request = normalizeRequest(input);
  const preview = buildPreview(request);
  if (!input.previewHash || input.previewHash !== preview.previewHash) {
    throw new KnowledgeBuildError('预览参数与执行请求不一致。', 409);
  }
  const claimed = claimPreview(input.previewId, preview.previewHash);
  const currentSnapshot = snapshotPreview(request, preview);
  if (currentSnapshot.hash !== claimed.candidateHash) {
    throw new KnowledgeBuildError('预览范围发生变化，请重新生成预览。', 409);
  }
  const consumed = db
    .prepare(
      `UPDATE tech_knowledge_build_previews SET consumed_at = ?
       WHERE id = ? AND consumed_at IS NULL`,
    )
    .run(nowIso(), input.previewId);
  if (!consumed.changes) {
    throw new KnowledgeBuildError('该预览已经执行，不能重复使用。', 409);
  }
  try {
    const candidates: Candidate[] = [];
    // Re-resolve candidates so execution uses one consistent snapshot and still
    // checks every invariant inside each item's transaction.
    if (request.scopeType === 'software') candidates.push(...resolveSoftwareCandidates(request));
    else if (request.scopeType === 'nodes') candidates.push(...resolveNodeCandidates(request));
    else if (request.scopeType === 'combined') {
      const softwareCandidates = resolveSoftwareCandidates(request);
      const nodeCandidates = resolveNodeCandidates(request);
      const domainId = request.nodes.domainId ?? null;
      const filtered = domainId
        ? softwareCandidates.filter(
            (candidate) =>
              candidate.item.domainId === domainId ||
              (candidate.create && candidate.create.domainId === domainId) ||
              candidate.item.action === 'pending',
          )
        : softwareCandidates;
      candidates.push(...dedupeCandidates([...filtered, ...nodeCandidates]));
    } else {
      // New-knowledge scope has one deterministic candidate.
      const previewCandidates = buildPreview(request);
      const item = previewCandidates.items[0];
      if (!item) throw new KnowledgeBuildError('预览结果为空');
      if (item.action === 'create_node') {
        candidates.push({
          item,
          create: {
            domainId: request.newNode!.domainId,
            parentId: request.newNode!.parentId ?? null,
            name: request.newNode!.name.trim(),
            nodeType: request.newNode!.nodeType,
            summary: request.newNode!.summary?.trim() || null,
          },
        });
      } else if (item.action === 'pending' && item.nodeId) {
        candidates.push({ item, node: findNodeById(item.nodeId) ?? undefined });
      } else {
        candidates.push({ item });
      }
    }

    const items: KnowledgeBuildResultItem[] = [];
    const counts: Record<KnowledgeBuildResultStatus, number> = {
      created: 0,
      linked: 0,
      initialized: 0,
      skipped: 0,
      pending: 0,
      failed: 0,
    };
    const push = (
      candidate: Candidate,
      status: KnowledgeBuildResultStatus,
      message: string,
      nodeId?: string | null,
    ) => {
      counts[status] += 1;
      items.push({
        key: candidate.item.key,
        status,
        message,
        softwareId: candidate.software?.id ?? candidate.item.softwareId,
        softwareName: candidate.software?.name ?? candidate.item.softwareName,
        nodeId: nodeId ?? candidate.item.nodeId,
        nodeName: candidate.item.nodeName,
      });
    };

    for (const candidate of candidates) {
      try {
        if (candidate.item.action === 'skip') {
          push(candidate, 'skipped', candidate.item.reason ?? '已跳过');
          continue;
        }
        if (candidate.item.action === 'pending') {
          push(candidate, 'pending', candidate.item.reason ?? '需要人工决定');
          continue;
        }
        if (candidate.item.action === 'initialize_doc' && candidate.item.nodeId) {
          const result = initializeExistingNode(
            candidate.item.nodeId,
            request,
            candidate.software ?? null,
          );
          push(candidate, result.status, result.message, candidate.item.nodeId);
          continue;
        }
        if (candidate.item.action === 'link_existing' && candidate.item.nodeId) {
          const result = linkExistingNode(candidate.item.nodeId, candidate.software ?? null);
          push(candidate, result.status, result.message, candidate.item.nodeId);
          continue;
        }
        if (candidate.item.action === 'link_and_initialize' && candidate.item.nodeId) {
          const result = linkAndInitializeNode(
            candidate.item.nodeId,
            request,
            candidate.software ?? null,
          );
          push(candidate, result.status, result.message, candidate.item.nodeId);
          continue;
        }
        if (candidate.item.action === 'create_node' && candidate.create) {
          const result = createNodeWithDocument(candidate.create, request, candidate.software ?? null);
          push(candidate, result.status, result.message, result.nodeId);
          continue;
        }
        push(candidate, 'failed', '无法识别该预览项');
      } catch (error) {
        push(candidate, 'failed', error instanceof Error ? error.message : '执行失败');
      }
    }

    return {
      runAt: nowIso(),
      previewHash: preview.previewHash,
      counts,
      items,
    };
  } catch (error) {
    // A preview is single-use, but an unexpected failure must not strand it as
    // consumed. Per-item failures are reported in the result instead.
    db.prepare(
      'UPDATE tech_knowledge_build_previews SET consumed_at = NULL WHERE id = ?',
    ).run(input.previewId);
    throw error;
  }
}

/* --------------------------------- Rules --------------------------------- */

interface RuleRow {
  id: string;
  name: string;
  enabled: number;
  target_type: KnowledgeBuildTargetType;
  trigger_type: KnowledgeBuildTriggerType;
  scope_type: KnowledgeBuildScopeType;
  scope_config: string;
  mapping_config: string;
  template_key: KnowledgeBuildTemplateKey;
  source_config: string;
  last_run_at: string | null;
  last_run_status: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function mapRule(row: RuleRow): KnowledgeBuildRule {
  return {
    id: row.id,
    name: row.name,
    enabled: Boolean(row.enabled),
    targetType: row.target_type,
    triggerType: row.trigger_type,
    scopeType: row.scope_type,
    scopeConfig: parseJson(row.scope_config, {}),
    mappingConfig: parseJson(row.mapping_config, {}),
    templateKey: row.template_key,
    sourceConfig: parseJson(row.source_config, {}),
    lastRunAt: row.last_run_at,
    lastRunStatus: row.last_run_status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateRule(input: KnowledgeBuildRuleInput): void {
  if (!input.name?.trim()) throw new KnowledgeBuildError('规则需要名称');
  if (!['software', 'node', 'combined'].includes(input.targetType)) {
    throw new KnowledgeBuildError('规则目标类型不合法');
  }
  if (!['software_created', 'node_created'].includes(input.triggerType)) {
    throw new KnowledgeBuildError('规则触发方式不合法');
  }
  if (input.targetType === 'software' && input.triggerType !== 'software_created') {
    throw new KnowledgeBuildError('软件目标只能由新增软件触发');
  }
  if (input.targetType === 'node' && input.triggerType !== 'node_created') {
    throw new KnowledgeBuildError('节点目标只能由新增节点触发');
  }
  if (!isKnowledgeBuildTemplateKey(input.templateKey)) throw new KnowledgeBuildError('未知模板');
  validateSourceInput(input.sourceConfig ?? {});
}

export function listKnowledgeBuildRules(): KnowledgeBuildRule[] {
  return (db.prepare(`${RULE_SELECT} ORDER BY created_at DESC`).all() as RuleRow[]).map(mapRule);
}

export function createKnowledgeBuildRule(input: KnowledgeBuildRuleInput): KnowledgeBuildRule {
  validateRule(input);
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO tech_knowledge_build_rules
      (id, name, enabled, target_type, trigger_type, scope_type, scope_config,
       mapping_config, template_key, source_config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name.trim(),
    input.enabled === false ? 0 : 1,
    input.targetType,
    input.triggerType,
    input.scopeType,
    JSON.stringify(input.scopeConfig ?? {}),
    JSON.stringify(input.mappingConfig ?? {}),
    input.templateKey,
    JSON.stringify(input.sourceConfig ?? {}),
    timestamp,
    timestamp,
  );
  return getKnowledgeBuildRule(id)!;
}

export function getKnowledgeBuildRule(id: string): KnowledgeBuildRule | null {
  const row = db.prepare(`${RULE_SELECT} WHERE id = ?`).get(id) as RuleRow | undefined;
  return row ? mapRule(row) : null;
}

export function updateKnowledgeBuildRule(
  id: string,
  patch: Partial<KnowledgeBuildRuleInput>,
): KnowledgeBuildRule {
  const existing = getKnowledgeBuildRule(id);
  if (!existing) throw new KnowledgeBuildError('规则不存在', 404);
  const merged: KnowledgeBuildRuleInput = {
    name: patch.name ?? existing.name,
    enabled: patch.enabled ?? existing.enabled,
    targetType: patch.targetType ?? existing.targetType,
    triggerType: patch.triggerType ?? existing.triggerType,
    scopeType: patch.scopeType ?? existing.scopeType,
    scopeConfig: patch.scopeConfig ?? existing.scopeConfig,
    mappingConfig: patch.mappingConfig ?? existing.mappingConfig,
    templateKey: patch.templateKey ?? existing.templateKey,
    sourceConfig: patch.sourceConfig ?? existing.sourceConfig,
  };
  // Revalidate sources only when the patch changes them. This keeps historical
  // HTTP rule sources readable and pausable without silently rewriting them.
  validateRule({
    ...merged,
    sourceConfig: patch.sourceConfig !== undefined ? merged.sourceConfig : {},
  });
  db.prepare(
    `UPDATE tech_knowledge_build_rules SET name = ?, enabled = ?, target_type = ?,
       trigger_type = ?, scope_type = ?, scope_config = ?, mapping_config = ?,
       template_key = ?, source_config = ?, updated_at = ? WHERE id = ?`,
  ).run(
    merged.name.trim(),
    merged.enabled === false ? 0 : 1,
    merged.targetType,
    merged.triggerType,
    merged.scopeType,
    JSON.stringify(merged.scopeConfig ?? {}),
    JSON.stringify(merged.mappingConfig ?? {}),
    merged.templateKey,
    JSON.stringify(merged.sourceConfig ?? {}),
    nowIso(),
    id,
  );
  return getKnowledgeBuildRule(id)!;
}

export function deleteKnowledgeBuildRule(id: string): void {
  const result = db.prepare('DELETE FROM tech_knowledge_build_rules WHERE id = ?').run(id);
  if (!result.changes) throw new KnowledgeBuildError('规则不存在', 404);
}

export function listKnowledgeBuildPending(): KnowledgeBuildPendingCandidate[] {
  const rows = db
    .prepare(
      `SELECT id, rule_id, source_type, source_id, name, reason, payload, status,
         created_at, updated_at
       FROM tech_knowledge_build_pending
       WHERE status = 'pending'
       ORDER BY created_at DESC`,
    )
    .all() as Array<{
    id: string;
    rule_id: string | null;
    source_type: string;
    source_id: string;
    name: string;
    reason: string;
    payload: string;
    status: 'pending' | 'resolved' | 'dismissed';
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    ruleId: row.rule_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    name: row.name,
    reason: row.reason,
    payload: parseJson(row.payload, {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function dismissKnowledgeBuildPending(id: string): void {
  const result = db
    .prepare(
      "UPDATE tech_knowledge_build_pending SET status = 'dismissed', updated_at = ? WHERE id = ? AND status = 'pending'",
    )
    .run(nowIso(), id);
  if (!result.changes) throw new KnowledgeBuildError('待处理项不存在', 404);
}

function persistPending(
  ruleId: string,
  sourceType: string,
  sourceId: string,
  name: string,
  reason: string,
  payload: Record<string, unknown>,
): void {
  const exists = db
    .prepare(
      `SELECT 1 FROM tech_knowledge_build_pending
       WHERE rule_id = ? AND source_type = ? AND source_id = ? AND status = 'pending'`,
    )
    .get(ruleId, sourceType, sourceId);
  if (exists) return;
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO tech_knowledge_build_pending
      (id, rule_id, source_type, source_id, name, reason, payload, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(
    crypto.randomUUID(),
    ruleId,
    sourceType,
    sourceId,
    name,
    reason,
    JSON.stringify(payload),
    timestamp,
    timestamp,
  );
}

function nodeMatchesRuleScope(node: NodeRow, rule: KnowledgeBuildRule): boolean {
  const scope = rule.scopeConfig ?? {};
  if (scope.domainId && scope.domainId !== node.domain_id) return false;
  if (scope.nodeType && scope.nodeType !== node.node_type) return false;
  return true;
}

function softwareMatchesRuleScope(software: SoftwareRow, rule: KnowledgeBuildRule): boolean {
  const scope = rule.scopeConfig ?? {};
  if (scope.category && scope.category !== software.category) return false;
  if (scope.watchStatus && scope.watchStatus !== software.watch_status) return false;
  return true;
}

export interface KnowledgeRuleRun {
  ruleId: string;
  status: 'success' | 'pending' | 'partial' | 'skipped' | 'failed';
  message: string;
  result?: KnowledgeBuildResult;
}

/**
 * Runs enabled rules after a real create event. It never throws into the
 * create flow: a rule failure is recorded and the software/node creation stays
 * successful.
 */
export function runKnowledgeBuildRules(
  trigger: KnowledgeBuildTriggerType,
  payload: { softwareId?: string; nodeId?: string },
): KnowledgeRuleRun[] {
  const rules = listKnowledgeBuildRules().filter(
    (rule) => rule.enabled && rule.triggerType === trigger,
  );
  const runs: KnowledgeRuleRun[] = [];
  for (const rule of rules) {
    try {
      let request: KnowledgeBuildRequest;
      let sourceName = '';
      let sourceId = '';
      if (trigger === 'software_created' && payload.softwareId) {
        const row = db
          .prepare(
            `SELECT id, name, category, website, repo, description, watch_status, watch_level,
               current_version, latest_version
             FROM software WHERE id = ? AND deleted_at IS NULL`,
          )
          .get(payload.softwareId) as SoftwareRow | undefined;
        if (!row) {
          runs.push({ ruleId: rule.id, status: 'skipped', message: '软件不存在' });
          continue;
        }
        if (!softwareMatchesRuleScope(row, rule)) {
          runs.push({ ruleId: rule.id, status: 'skipped', message: '软件不符合规则范围' });
          continue;
        }
        sourceName = row.name;
        sourceId = row.id;
        request = {
          scopeType: 'software',
          software: { ids: [row.id], selection: 'all' },
          templateKey: rule.templateKey,
          mapping: rule.mappingConfig,
          sources: rule.sourceConfig,
        };
      } else if (trigger === 'node_created' && payload.nodeId) {
        const node = findNodeById(payload.nodeId);
        if (!node) {
          runs.push({ ruleId: rule.id, status: 'skipped', message: '节点不存在' });
          continue;
        }
        if (!nodeMatchesRuleScope(node, rule)) {
          runs.push({ ruleId: rule.id, status: 'skipped', message: '节点不符合规则范围' });
          continue;
        }
        sourceName = node.name;
        sourceId = node.id;
        request = {
          scopeType: 'nodes',
          nodes: { ids: [node.id], selection: 'all' },
          templateKey: rule.templateKey,
          sources: rule.sourceConfig,
        };
      } else {
        runs.push({ ruleId: rule.id, status: 'skipped', message: '触发事件缺少目标' });
        continue;
      }
      const preview = previewKnowledgeBuild(request);
      const result = executeKnowledgeBuild({
        ...request,
        confirmed: true,
        previewId: preview.previewId,
        previewHash: preview.previewHash,
      });
      for (const item of result.items) {
        if (item.status === 'pending') {
          persistPending(
            rule.id,
            trigger === 'software_created' ? 'software' : 'node',
            sourceId,
            item.nodeName ?? sourceName,
            item.message,
            { ruleId: rule.id, item },
          );
        }
      }
      const pending = result.counts.pending;
      const failed = result.counts.failed;
      const status = failed > 0 ? 'partial' : pending > 0 ? 'pending' : 'success';
      const message =
        status === 'success'
          ? `已处理 ${result.items.length} 项`
          : `待处理 ${pending} 项，失败 ${failed} 项`;
      db.prepare(
        `UPDATE tech_knowledge_build_rules SET last_run_at = ?, last_run_status = ?,
           last_error = ?, updated_at = ? WHERE id = ?`,
      ).run(nowIso(), status, status === 'success' ? null : message, nowIso(), rule.id);
      runs.push({ ruleId: rule.id, status, message, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : '规则执行失败';
      db.prepare(
        `UPDATE tech_knowledge_build_rules SET last_run_at = ?, last_run_status = 'failed',
           last_error = ?, updated_at = ? WHERE id = ?`,
      ).run(nowIso(), message, nowIso(), rule.id);
      runs.push({ ruleId: rule.id, status: 'failed', message });
    }
  }
  return runs;
}

/* --------------------------------- Linter -------------------------------- */

const REQUIRED_SECTIONS = [
  '技术定位',
  '设计原理',
  '工作机制',
  '关键配置与实践',
  '版本差异与兼容性',
  '常见问题与限制',
  '技术关联',
  '参考资料',
];

function lintItem(
  rule: string,
  severity: KnowledgeLintItem['severity'],
  message: string,
  section?: string | null,
  snippet?: string | null,
): KnowledgeLintItem {
  return { rule, severity, message, section: section ?? null, snippet: snippet ?? null };
}

const PLACEHOLDER_PATTERN = /TODO|TBD|请填写|待补充|需要补充说明/i;

/**
 * Only user-authored content is checked. Template prompts live in HTML
 * comments, and the fixed version/reference hints are not author placeholders.
 */
function findPlaceholder(markdown: string): { section: string; snippet: string } | null {
  const cleaned = markdown.replace(/<!--[\s\S]*?-->/g, '');
  let section = '';
  for (const rawLine of cleaned.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      section = heading[1].trim();
      continue;
    }
    if (section === '版本差异与兼容性' && /^\|\s*(文档适用版本|本文实际核实版本)/.test(line)) {
      continue;
    }
    if (
      section === '参考资料' &&
      /尚未录入官方来源|没有来源时不要标记为已核实/.test(line)
    ) {
      continue;
    }
    if (PLACEHOLDER_PATTERN.test(line)) {
      return { section: section || '正文', snippet: line.slice(0, 160) };
    }
  }
  return null;
}

export async function lintNodeKnowledge(
  nodeId: string,
  options: { checkUrls?: boolean } = {},
): Promise<KnowledgeLintResult> {
  const node = findNodeById(nodeId);
  if (!node) throw new KnowledgeBuildError('技术节点不存在', 404);
  const markdown = node.content_markdown ?? '';
  const items: KnowledgeLintItem[] = [];
  if (!hasMarkdown(markdown)) {
    items.push(lintItem('body', 'fail', '正文为空'));
  } else {
    items.push(lintItem('body', 'pass', '正文非空'));
  }

  const headings = [...markdown.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());
  const sectionPositions = REQUIRED_SECTIONS.map((title) => headings.indexOf(title));
  if (sectionPositions.some((index) => index < 0)) {
    items.push(lintItem('structure', 'fail', '缺少固定章节或章节标题不一致'));
  } else {
    const ordered = sectionPositions.every((value, index) => index === 0 || value > sectionPositions[index - 1]);
    items.push(
      ordered
        ? lintItem('structure', 'pass', '八个固定章节齐全且顺序正确')
        : lintItem('structure', 'fail', '固定章节顺序不正确'),
    );
  }

  const isL2 = Boolean(node.parent_id);
  const length = markdown.length;
  if (isL2 && length < 1500) {
    items.push(lintItem('length', 'fail', `L2 文档需至少 1,500 字符，当前 ${length}`));
  } else if (!isL2 && length < 1500) {
    items.push(lintItem('length', 'warning', `文档当前 ${length} 字符，建议达到 1,500 字符`));
  } else {
    items.push(lintItem('length', 'pass', `正文 ${length} 字符`));
  }

  const versionSection = /## 版本差异与兼容性[\s\S]*?(?=\n## |$)/.exec(markdown)?.[0] ?? '';
  if (!versionSection) {
    items.push(lintItem('version-section', 'fail', '缺少版本差异与兼容性章节'));
  } else if (/适用版本[：:]\s*待核实/.test(versionSection) || !node.applicable_versions) {
    items.push(lintItem('version', 'warning', '适用版本待核实，尚未写入 applicableVersions'));
  } else {
    items.push(lintItem('version', 'pass', '已记录适用版本'));
  }
  if (node.applicable_versions && /latest|最新/i.test(node.applicable_versions)) {
    items.push(lintItem('version-boundary', 'fail', 'applicableVersions 不能写成最新版本或 latest'));
  }

  const references = parseJson<TechExternalLink[]>(node.reference_links, []);
  const sourceUrls = [
    ...(node.docs_url ? [node.docs_url] : []),
    ...references.map((link) => link.url),
  ];
  const httpsLinks = new Set(
    sourceUrls.filter((url) => isHttpsUrl(url)).map((url) => canonicalUrl(url)),
  );
  const invalidLinks = [
    ...(node.docs_url && !isHttpsUrl(node.docs_url) ? [node.docs_url] : []),
    ...references.filter((link) => !isHttpsUrl(link.url)).map((link) => link.url),
  ];
  if (invalidLinks.length) {
    items.push(
      lintItem(
        'source-format',
        'fail',
        '存在非 HTTPS 或格式不合法的来源；历史记录保留，但新增来源必须使用 HTTPS',
        '参考资料',
        invalidLinks[0]?.slice(0, 160) ?? null,
      ),
    );
  }
  if (httpsLinks.size < 2) {
    items.push(
      lintItem(
        'official-sources',
        'fail',
        `至少需要两个 HTTPS 官方来源，当前 ${httpsLinks.size}`,
        '参考资料',
      ),
    );
  } else {
    items.push(lintItem('official-sources', 'pass', `${httpsLinks.size} 个 HTTPS 来源`));
  }

  const placeholder = findPlaceholder(markdown);
  if (placeholder) {
    items.push(
      lintItem(
        'placeholder',
        'warning',
        '正文仍含 TODO / TBD / 请填写 / 待补充 / 需要补充说明',
        placeholder.section,
        placeholder.snippet,
      ),
    );
  } else {
    items.push(lintItem('placeholder', 'pass', '未发现占位提示'));
  }

  if (!node.content_source) {
    items.push(lintItem('content-source', 'warning', '尚未标注内容来源'));
  } else {
    items.push(lintItem('content-source', 'pass', '已标注内容来源'));
  }

  const relationCount = (
    db
      .prepare('SELECT COUNT(*) AS count FROM tech_relations WHERE source_node_id = ? OR target_node_id = ?')
      .get(nodeId, nodeId) as { count: number }
  ).count;
  if (relationCount > 0) {
    items.push(lintItem('relations', 'pass', `${relationCount} 条技术关联`));
  } else if (
    node.relation_review_status === 'independent' &&
    Boolean(node.relation_review_note?.trim())
  ) {
    items.push(
      lintItem('relations', 'pass', '已人工确认该主题独立，并记录了原因', '技术关联'),
    );
  } else {
    items.push(
      lintItem(
        'relations',
        'warning',
        '没有技术关联；若确为独立主题，请人工确认并填写原因（不会根据正文关键词自动判定）',
        '技术关联',
      ),
    );
  }

  const softwareCount = (
    db.prepare('SELECT COUNT(*) AS count FROM tech_node_software WHERE node_id = ?').get(nodeId) as {
      count: number;
    }
  ).count;
  if (node.node_type === 'component' && softwareCount === 0) {
    items.push(lintItem('software', 'warning', '组件节点尚未关联软件'));
  } else {
    items.push(lintItem('software', 'pass', softwareCount ? `关联 ${softwareCount} 个软件` : '该节点类型不要求关联软件'));
  }

  if (node.content_status === 'complete' && (!node.verified_version || !node.content_verified_at)) {
    items.push(lintItem('verification', 'fail', '状态为已完善，但缺少验证记录'));
  } else {
    items.push(lintItem('verification', 'pass', '状态与验证记录一致'));
  }

  const reachableLinks = [...httpsLinks];
  if (options.checkUrls && reachableLinks.length) {
    const results = await checkKnowledgeUrls(reachableLinks);
    const broken = results.filter((result) => result.status !== 'ok' && result.status !== 'redirect');
    if (broken.length) {
      items.push(
        lintItem(
          'source-reachability',
          'warning',
          `有 ${broken.length} 个来源当前不可访问；记录保留，但不得标记为已核实`,
        ),
      );
    } else {
      items.push(lintItem('source-reachability', 'pass', '列出的来源当前可访问'));
    }
  }

  const status: KnowledgeLintResult['status'] = items.some((item) => item.severity === 'fail')
    ? 'fail'
    : items.some((item) => item.severity === 'warning')
      ? 'warning'
      : 'pass';
  return { nodeId, status, items };
}

export async function checkKnowledgeUrls(
  urls: string[],
): Promise<KnowledgeUrlCheckResult[]> {
  return checkKnowledgeUrlsImpl(urls);
}

export { sourceLinksForContext };
