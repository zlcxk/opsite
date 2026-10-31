import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TechTreeNode } from '../../shared/types.js';

let dataDir: string;
let dbModule: typeof import('../db.js');
let seed: typeof import('./tech-seed.js');
let tech: typeof import('./tech.js');
let notes: typeof import('./notes.js');
let content: typeof import('./tech-content.js');
let software: typeof import('./software.js');

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsite-tech-'));
  process.env.DATA_DIR = dataDir;
  dbModule = await import('../db.js');
  seed = await import('./tech-seed.js');
  tech = await import('./tech.js');
  notes = await import('./notes.js');
  content = await import('./tech-content.js');
  software = await import('./software.js');
  seed.seedTechnologyTemplates();
});

afterAll(() => {
  try {
    dbModule?.db.close();
  } catch {
    // ignore close errors in cleanup
  }
  delete process.env.DATA_DIR;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function findTreeNode(nodes: TechTreeNode[], name: string): TechTreeNode | null {
  for (const node of nodes) {
    if (node.name === name) return node;
    const found = findTreeNode(node.children, name);
    if (found) return found;
  }
  return null;
}

describe('technology map seed', () => {
  it('seeds the built-in technology domains without duplicating on reapply', () => {
    const overview = tech.getTechOverview();
    expect(overview.domains.map((domain) => domain.name)).toEqual([
      'Kubernetes',
      'Prometheus',
      '数据库与缓存',
      '消息与流',
      '可观测性与日志',
      '发布与基础设施自动化',
      '云原生基础设施',
    ]);
    expect(overview.stats.nodes).toBeGreaterThan(140);

    const again = seed.applyTechTemplate('kubernetes');
    expect(again?.inserted.domains).toBe(0);
    expect(again?.inserted.nodes).toBe(0);
    expect(again?.inserted.views).toBe(0);
    expect(again?.inserted.relations).toBe(0);
  });

  it('ships P2 domains with draft documents for every core node', () => {
    const expected = ['数据库与缓存', '消息与流', '可观测性与日志', '发布与基础设施自动化', '云原生基础设施'];
    for (const name of expected) {
      const domain = tech.listDomainSummaries().find((entry) => entry.name === name);
      expect(domain, name).toBeTruthy();
      const nodes = tech.listNodes({ domainId: domain!.id, limit: 100 }).items;
      expect(nodes.length, name).toBe(4);
      expect(nodes.every((node) => node.hasContent && node.contentStatus === 'draft'), name).toBe(true);
      for (const node of nodes) {
        expect(tech.getNodeDetail(node.id)?.node.applicableVersions, `${name}/${node.name}`).toBeTruthy();
      }
    }
  });

  it('builds the Kubernetes tree with the expected hierarchy', () => {
    const domain = tech.listDomainSummaries().find((entry) => entry.name === 'Kubernetes')!;
    const tree = tech.getDomainTree(domain.id);
    const core = findTreeNode(tree, '核心架构');
    expect(core).not.toBeNull();
    const controlPlane = findTreeNode(core!.children, '控制平面');
    expect(controlPlane?.children.map((node) => node.name)).toContain('kube-apiserver');
    const networking = findTreeNode(tree, '网络');
    expect(networking?.children.some((node) => node.name === 'Ingress')).toBe(true);
  });

  it('ships four Prometheus views and accurate Operator nodes', () => {
    const domain = tech.listDomainSummaries().find((entry) => entry.name === 'Prometheus')!;
    const views = tech.listViewSummaries(domain.id);
    expect(views.map((view) => view.name)).toEqual([
      '整体监控架构',
      'Operator 资源关系',
      '指标采集流程',
      '告警处理流程',
    ]);
    const serviceMonitor = tech
      .listNodes({ domainId: domain.id, q: 'ServiceMonitor' })
      .items.find((node) => node.name === 'ServiceMonitor');
    expect(serviceMonitor).toBeTruthy();
    const detail = tech.getNodeDetail(serviceMonitor!.id)!;
    expect(detail.node.description).toContain('Endpoint');
    expect(detail.node.commonIssues).toContain('serviceMonitorSelector');
  });

  it('keeps user edits when a preset is applied again', () => {
    const domain = tech.listDomainSummaries().find((entry) => entry.name === 'Prometheus')!;
    const server = tech.listNodes({ domainId: domain.id, q: 'Prometheus Server' }).items.find(
      (node) => node.name === 'Prometheus Server',
    )!;
    const original = tech.getNode(server.id)!;
    tech.updateNode(server.id, { name: 'Prometheus Server（我的叫法）' });
    seed.applyTechTemplate('prometheus');
    expect(tech.getNode(server.id)!.name).toBe('Prometheus Server（我的叫法）');
    tech.updateNode(server.id, { name: original.name });
  });

  it('keeps cross-domain relations between Kubernetes and Prometheus', () => {
    const prom = tech.listDomainSummaries().find((entry) => entry.name === 'Prometheus')!;
    const relations = tech.listRelations({ domainId: prom.id });
    const linked = relations.find(
      (relation) => relation.source.id === 'prom-service-monitor' && relation.target.id === 'k8s-service',
    );
    expect(linked?.description).toContain('Endpoints');
    expect(
      relations.some((relation) => relation.source.id === 'k8s-monitoring' && relation.target.id === 'prom-core'),
    ).toBe(true);
  });

  it('uses the corrected P5.4 relations without dropping existing links', () => {
    const k8s = tech.listDomainSummaries().find((entry) => entry.name === 'Kubernetes')!;
    const relations = tech.listRelations({ domainId: k8s.id });
    const proxy = relations.find((relation) => relation.id === 'rel-k8s-service-proxy');
    expect(proxy?.relationType).toBe('related');
    expect(proxy?.description).toContain('数据面');
    expect(
      relations.some(
        (relation) =>
          relation.id === 'rel-k8s-service-pod' &&
          relation.source.id === 'k8s-service' &&
          relation.target.id === 'k8s-pod',
      ),
    ).toBe(true);
    expect(
      relations.some(
        (relation) =>
          relation.id === 'rel-k8s-cm-deploy' &&
          relation.source.id === 'k8s-controller-manager' &&
          relation.target.id === 'k8s-deployment',
      ),
    ).toBe(true);
    expect(
      relations.some(
        (relation) =>
          relation.id === 'rel-k8s-cm-api' &&
          relation.source.id === 'k8s-controller-manager' &&
          relation.target.id === 'k8s-apiserver' &&
          relation.relationType === 'depends_on',
      ),
    ).toBe(true);
  });

  it('uses the containerd -> CRI direction for the implementation relation', () => {
    const k8s = tech.listDomainSummaries().find((entry) => entry.name === 'Kubernetes')!;
    const relation = tech
      .listRelations({ domainId: k8s.id })
      .find((entry) => entry.id === 'rel-k8s-cri-containerd');
    expect(relation?.source.id).toBe('k8s-containerd');
    expect(relation?.target.id).toBe('k8s-cri');
    expect(relation?.relationType).toBe('implements');
    expect(relation?.description).toContain('CRI Plugin');
  });

  it('migrates only the exact seeded relation and preserves user changes', () => {
    const before = tech.listRelations({ domainId: 'tech-domain-kubernetes' }).length;
    dbModule.db
      .prepare(
        `UPDATE tech_relations SET relation_type = 'depends_on', description = NULL
         WHERE id = 'rel-k8s-service-proxy'`,
      )
      .run();
    expect(seed.migrateP54Relations()).toBe(1);
    const migrated = dbModule.db
      .prepare('SELECT relation_type, description FROM tech_relations WHERE id = ?')
      .get('rel-k8s-service-proxy') as { relation_type: string; description: string };
    expect(migrated.relation_type).toBe('related');
    expect(migrated.description).toContain('数据面');

    dbModule.db
      .prepare(
        `UPDATE tech_relations SET relation_type = 'alternative', description = '用户自己的说明'
         WHERE id = 'rel-k8s-service-proxy'`,
      )
      .run();
    expect(seed.migrateP54Relations()).toBe(0);
    const preserved = dbModule.db
      .prepare('SELECT relation_type, description FROM tech_relations WHERE id = ?')
      .get('rel-k8s-service-proxy') as { relation_type: string; description: string };
    expect(preserved.relation_type).toBe('alternative');
    expect(preserved.description).toBe('用户自己的说明');
    expect(tech.listRelations({ domainId: 'tech-domain-kubernetes' }).length).toBe(before);

    dbModule.db
      .prepare(
        `UPDATE tech_relations SET relation_type = 'related',
           description = 'kube-proxy 是 Service 的一种数据面实现，eBPF CNI 等实现可以替代它。'
         WHERE id = 'rel-k8s-service-proxy'`,
      )
      .run();

    // P5.4.1: the old seed had CRI -> containerd, which reverses who
    // implements the interface. Only that exact tuple is migrated.
    dbModule.db
      .prepare(
        `UPDATE tech_relations SET source_node_id = 'k8s-cri',
           target_node_id = 'k8s-containerd', relation_type = 'implements', description = NULL
         WHERE id = 'rel-k8s-cri-containerd'`,
      )
      .run();
    expect(seed.migrateP54Relations()).toBe(1);
    const flipped = dbModule.db
      .prepare(
        'SELECT source_node_id, target_node_id, relation_type, description FROM tech_relations WHERE id = ?',
      )
      .get('rel-k8s-cri-containerd') as {
      source_node_id: string;
      target_node_id: string;
      relation_type: string;
      description: string;
    };
    expect(flipped.source_node_id).toBe('k8s-containerd');
    expect(flipped.target_node_id).toBe('k8s-cri');
    expect(flipped.relation_type).toBe('implements');
    expect(flipped.description).toContain('CRI Plugin');
    expect(seed.migrateP54Relations()).toBe(0);

    dbModule.db
      .prepare(
        `UPDATE tech_relations SET source_node_id = 'k8s-cri',
           target_node_id = 'k8s-containerd', relation_type = 'related',
           description = '用户自己改的方向和类型'
         WHERE id = 'rel-k8s-cri-containerd'`,
      )
      .run();
    expect(seed.migrateP54Relations()).toBe(0);
    const preservedDirection = dbModule.db
      .prepare('SELECT source_node_id, target_node_id, relation_type, description FROM tech_relations WHERE id = ?')
      .get('rel-k8s-cri-containerd') as {
      source_node_id: string;
      target_node_id: string;
      relation_type: string;
      description: string;
    };
    expect(preservedDirection.source_node_id).toBe('k8s-cri');
    expect(preservedDirection.target_node_id).toBe('k8s-containerd');
    expect(preservedDirection.relation_type).toBe('related');
    expect(preservedDirection.description).toBe('用户自己改的方向和类型');

    dbModule.db
      .prepare(
        `UPDATE tech_relations SET source_node_id = 'k8s-containerd',
           target_node_id = 'k8s-cri', relation_type = 'implements',
           description = 'containerd 通过内置 CRI Plugin 实现 CRI 接口；kubelet 通过 CRI 调用容器运行时。'
         WHERE id = 'rel-k8s-cri-containerd'`,
      )
      .run();
  });
});

describe('technology node editing', () => {
  it('prevents circular contains relations', () => {
    expect(() =>
      tech.createRelation({
        sourceNodeId: 'k8s-apiserver',
        targetNodeId: 'k8s-core',
        relationType: 'contains',
      }),
    ).toThrow(/环/);
  });

  it('moves nodes between parents and rejects moving into a descendant', () => {
    const domain = tech.listDomainSummaries().find((entry) => entry.name === 'Kubernetes')!;
    const parentA = tech.createNode(domain.id, { name: '临时父节点 A', nodeType: 'concept' });
    const parentB = tech.createNode(domain.id, { name: '临时父节点 B', nodeType: 'concept' });
    const child = tech.createNode(domain.id, {
      name: '临时子节点',
      nodeType: 'concept',
      parentId: parentA.id,
    });
    expect(() => tech.moveNode(parentA.id, { parentId: child.id })).toThrow(/子孙/);

    const moved = tech.moveNode(child.id, { parentId: parentB.id });
    expect(moved.parentId).toBe(parentB.id);

    tech.deleteNode(parentA.id, 'subtree');
    tech.deleteNode(parentB.id, 'subtree');
  });

  it('archives and restores a whole subtree', () => {
    const domain = tech.listDomainSummaries().find((entry) => entry.name === 'Kubernetes')!;
    const parent = tech.createNode(domain.id, { name: '归档测试父节点', nodeType: 'concept' });
    const child = tech.createNode(domain.id, {
      name: '归档测试子节点',
      nodeType: 'concept',
      parentId: parent.id,
    });
    tech.setNodeArchived(parent.id, true);
    expect(tech.getNode(child.id)!.status).toBe('archived');
    const tree = tech.getDomainTree(domain.id);
    expect(findTreeNode(tree, '归档测试父节点')).toBeNull();

    tech.setNodeArchived(parent.id, false);
    expect(tech.getNode(child.id)!.status).toBe('active');
    expect(findTreeNode(tech.getDomainTree(domain.id), '归档测试父节点')).not.toBeNull();
    tech.deleteNode(parent.id, 'subtree');
  });

  it('promotes children when deleting a parent', () => {
    const domain = tech.listDomainSummaries().find((entry) => entry.name === 'Kubernetes')!;
    const parent = tech.createNode(domain.id, { name: '待删除父节点', nodeType: 'concept' });
    const child = tech.createNode(domain.id, {
      name: '提升子节点',
      nodeType: 'concept',
      parentId: parent.id,
    });
    expect(() => tech.deleteNode(parent.id)).toThrow(/子节点/);
    const result = tech.deleteNode(parent.id, 'promote');
    expect(result.promoted).toBe(1);
    expect(tech.getNode(parent.id)).toBeNull();
    expect(tech.getNode(child.id)!.parentId).toBeNull();
    tech.deleteNode(child.id);
  });

  it('removes deleted nodes from views and detaches knowledge notes', () => {
    const domain = tech.listDomainSummaries().find((entry) => entry.name === 'Prometheus')!;
    const node = tech.createNode(domain.id, { name: '待清理节点', nodeType: 'component' });
    const note = notes.createNote({ title: '节点笔记', techNodeId: node.id });
    tech.createRelation({
      sourceNodeId: node.id,
      targetNodeId: 'prom-server',
      relationType: 'related',
    });
    const view = tech.createView(domain.id, {
      name: '清理测试视图',
      viewType: 'architecture',
      graphData: {
        nodes: [
          { id: 'g1', nodeId: node.id, label: '待清理节点', x: 10, y: 10, width: 168, height: 54, note: null, nodeType: null },
          { id: 'g2', nodeId: 'prom-server', label: 'Prometheus', x: 200, y: 10, width: 168, height: 54, note: null, nodeType: null },
        ],
        edges: [{ id: 'e1', source: 'g1', target: 'g2', label: '关联', relationType: null }],
      },
    });

    tech.deleteNode(node.id, 'subtree');

    const updated = tech.getView(view.id)!;
    expect(updated.graphData.nodes.map((entry) => entry.id)).toEqual(['g2']);
    expect(updated.graphData.edges).toHaveLength(0);
    expect(notes.getNote(note.id)!.techNodeId).toBeNull();
    expect(tech.listRelations({ nodeId: 'prom-server' }).some((relation) => relation.source.id === node.id)).toBe(
      false,
    );
    tech.deleteView(view.id);
    notes.deleteNote(note.id);
  });
});

describe('technology knowledge content', () => {
  it('provides a knowledge card for every active node and docs for priority nodes', () => {
    const emptyCards = dbModule.db
      .prepare(
        `SELECT count(*) AS count FROM tech_nodes
         WHERE status = 'active'
           AND (technical_role IS NULL OR TRIM(technical_role) = ''
             OR core_principle IS NULL OR TRIM(core_principle) = ''
             OR key_mechanism IS NULL OR TRIM(key_mechanism) = ''
             OR use_cases IS NULL OR TRIM(use_cases) = '')`,
      )
      .get() as { count: number };
    expect(emptyCards.count).toBe(0);

    expect(content.contentEntryForNode('k8s-apiserver')?.contentMarkdown).toContain('准入');
    expect(content.contentEntryForNode('k8s-cri')?.contentMarkdown).toContain('RuntimeService');
    expect(content.contentEntryForNode('k8s-containerd')?.contentMarkdown).toContain(
      'io.containerd.cri.v1.runtime',
    );
    expect(content.contentEntryForNode('prom-tsdb')?.contentMarkdown).toContain('WAL');
    expect(content.TECH_CONTENT_ENTRIES).toHaveLength(180);

    // Phase B upgrades are actually written into the seeded node rows.
    expect(tech.getNode('k8s-apiserver')!.contentMarkdown).toContain('API Priority and Fairness');
    expect(tech.getNode('k8s-kubelet')!.contentMarkdown).toContain('Kubernetes 1.37 默认值');
    expect(tech.getNode('k8s-cri')!.contentMarkdown).toContain('RuntimeService');
    expect(tech.getNode('k8s-containerd')!.contentMarkdown).toContain('io.containerd.cri.v1.runtime');

    const docs = dbModule.db
      .prepare(
        `SELECT count(*) AS count FROM tech_nodes
         WHERE status = 'active' AND content_markdown IS NOT NULL AND TRIM(content_markdown) != ''`,
      )
      .get() as { count: number };
    expect(docs.count).toBeGreaterThanOrEqual(60);
  });

  it('derives missing, draft, complete and needs_review deterministically', () => {
    const domain = tech.listDomainSummaries().find((entry) => entry.name === 'Kubernetes')!;
    const node = tech.createNode(domain.id, { name: '文档状态测试节点', nodeType: 'concept' });
    expect(tech.getNode(node.id)!.contentStatus).toBe('missing');
    expect(tech.getNode(node.id)!.hasContent).toBe(false);

    const drafted = tech.updateNode(node.id, {
      contentMarkdown: '## 定义\n\n第一版内容。',
      contentStatus: 'needs_review',
    });
    expect(drafted.contentStatus).toBe('needs_review');
    expect(drafted.hasContent).toBe(true);

    expect(() => tech.updateNode(node.id, { contentStatus: 'complete' })).toThrow(
      /验证操作/,
    );
    const completed = tech.verifyNodeContent(node.id, { version: 'v1.0' });
    expect(completed.contentStatus).toBe('complete');

    const edited = tech.updateNode(node.id, {
      contentMarkdown: '## 定义\n\n修改后的内容。',
    });
    expect(edited.contentStatus).toBe('draft');

    const emptied = tech.updateNode(node.id, { contentMarkdown: '   ' });
    expect(emptied.contentStatus).toBe('missing');
    expect(emptied.contentMarkdown).toBeNull();

    tech.deleteNode(node.id);
  });

  it('replaces only an untouched draft whose hash matches the previous authored body', () => {
    const domain = tech.listDomainSummaries().find((entry) => entry.name === 'Kubernetes')!;
    const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
    const oldBody = '# 旧版\n\n这是上一版权威内容。';
    const newBody = '# 新版\n\n这是经过质量治理的内容。';
    const makeEntry = (nodeId: string) => ({
      nodeId,
      version: 2,
      contentMarkdown: newBody,
      replacesContentHash: hash(oldBody),
    });

    const untouched = tech.createNode(domain.id, { name: '哈希升级测试节点', nodeType: 'concept' });
    tech.updateNode(untouched.id, { contentMarkdown: oldBody });
    expect(content.applyTechContentEntry(makeEntry(untouched.id))).toBe(true);
    expect(tech.getNode(untouched.id)!.contentMarkdown).toBe(newBody);
    expect(tech.getNode(untouched.id)!.contentStatus).toBe('draft');

    const edited = tech.createNode(domain.id, { name: '哈希保护编辑节点', nodeType: 'concept' });
    tech.updateNode(edited.id, { contentMarkdown: oldBody });
    tech.updateNode(edited.id, { contentMarkdown: '# 用户修改\n\n不要覆盖。' });
    expect(content.applyTechContentEntry(makeEntry(edited.id))).toBe(false);
    expect(tech.getNode(edited.id)!.contentMarkdown).toContain('不要覆盖');

    const verified = tech.createNode(domain.id, { name: '哈希保护验证节点', nodeType: 'concept' });
    tech.updateNode(verified.id, { contentMarkdown: oldBody });
    tech.verifyNodeContent(verified.id, { version: 'v1.0' });
    expect(content.applyTechContentEntry(makeEntry(verified.id))).toBe(false);
    expect(tech.getNode(verified.id)!.contentMarkdown).toBe(oldBody);
    expect(tech.getNode(verified.id)!.contentStatus).toBe('complete');

    const triaged = tech.createNode(domain.id, { name: '哈希保护复核节点', nodeType: 'concept' });
    tech.updateNode(triaged.id, { contentMarkdown: oldBody, contentStatus: 'needs_review' });
    expect(content.applyTechContentEntry(makeEntry(triaged.id))).toBe(false);
    expect(tech.getNode(triaged.id)!.contentMarkdown).toBe(oldBody);
    expect(tech.getNode(triaged.id)!.contentStatus).toBe('needs_review');

    for (const node of [untouched, edited, verified, triaged]) tech.deleteNode(node.id);
  });

  it('appends verified reference links on a hash-gated revision without removing existing ones', () => {
    const domain = tech.listDomainSummaries().find((entry) => entry.name === 'Kubernetes')!;
    const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
    const oldBody = '# 旧版\n\n旧正文。';
    const newBody = '# 新版\n\n补充了官方来源。';
    const node = tech.createNode(domain.id, { name: '参考链接合并测试节点', nodeType: 'concept' });
    tech.updateNode(node.id, {
      contentMarkdown: oldBody,
      referenceLinks: [{ label: '既有来源', url: 'https://example.com/existing' }],
    });

    expect(
      content.applyTechContentEntry({
        nodeId: node.id,
        version: 2,
        contentMarkdown: newBody,
        replacesContentHash: hash(oldBody),
        referenceLinks: [
          { label: '既有来源', url: 'https://example.com/existing' },
          { label: '新增来源', url: 'https://example.com/new' },
        ],
      }),
    ).toBe(true);
    expect(tech.getNode(node.id)!.referenceLinks).toEqual([
      { label: '既有来源', url: 'https://example.com/existing' },
      { label: '新增来源', url: 'https://example.com/new' },
    ]);

    tech.updateNode(node.id, { contentMarkdown: '# 用户改写\n\n不要动链接。' });
    expect(
      content.applyTechContentEntry({
        nodeId: node.id,
        version: 3,
        contentMarkdown: '# 又一个版本',
        replacesContentHash: hash(oldBody),
        referenceLinks: [{ label: '不应写入', url: 'https://example.com/blocked' }],
      }),
    ).toBe(false);
    expect(tech.getNode(node.id)!.referenceLinks).toHaveLength(2);

    tech.deleteNode(node.id);
  });

  it('never overwrites user content when the content seed runs again', () => {
    const node = tech.getNode('k8s-apiserver')!;
    const original = {
      markdown: node.contentMarkdown,
      status: node.contentStatus,
      role: node.technicalRole,
      versions: node.applicableVersions,
      verifiedVersion: node.verifiedVersion,
      verifiedAt: node.contentVerifiedAt,
    };
    tech.updateNode('k8s-apiserver', {
      contentMarkdown: '# 我的 apiserver 笔记\n\n只属于我的内容。',
      technicalRole: '我自定义的技术角色',
      applicableVersions: '内部版本 1.0',
    });
    tech.verifyNodeContent('k8s-apiserver', { version: '内部验证版本 1.0' });
    dbModule.db.prepare('DELETE FROM tech_content_seed WHERE key = ?').run('k8s-apiserver');
    content.seedTechContent();

    const after = tech.getNode('k8s-apiserver')!;
    expect(after.contentMarkdown).toContain('只属于我的内容');
    expect(after.contentStatus).toBe('complete');
    expect(after.technicalRole).toBe('我自定义的技术角色');
    expect(after.applicableVersions).toBe('内部版本 1.0');
    expect(after.verifiedVersion).toBe('内部验证版本 1.0');

    dbModule.db
      .prepare(
        `UPDATE tech_nodes SET content_markdown = ?, content_status = ?, technical_role = ?,
           applicable_versions = ?, verified_version = ?, content_verified_at = ? WHERE id = ?`,
      )
      .run(
        original.markdown,
        original.status,
        original.role,
        original.versions,
        original.verifiedVersion,
        original.verifiedAt,
        'k8s-apiserver',
      );
  });

  it('reports content statistics and excludes archived nodes', () => {
    const domain = tech.listDomainSummaries().find((entry) => entry.name === 'Prometheus')!;
    const baseline = tech.contentCounts();
    const node = tech.createNode(domain.id, { name: '统计测试节点', nodeType: 'component' });
    tech.updateNode(node.id, { contentMarkdown: '# 文档' });
    tech.verifyNodeContent(node.id, { version: 'v1.0' });

    const withNode = tech.contentCounts(domain.id);
    expect(withNode.total).toBeGreaterThanOrEqual(1);
    expect(withNode.complete).toBeGreaterThanOrEqual(1);
    expect(withNode.completionRate).toBeGreaterThan(0);

    tech.setNodeArchived(node.id, true);
    expect(tech.contentCounts().total).toBe(baseline.total);
    expect(tech.contentCounts().complete).toBe(baseline.complete);

    tech.deleteNode(node.id);
  });

  it('filters by content status and searches Markdown bodies', () => {
    const drafts = tech.listNodes({ contentStatus: 'draft', limit: 300 });
    expect(drafts.items.length).toBeGreaterThan(0);
    expect(drafts.items.every((node) => node.contentStatus === 'draft' && node.hasContent)).toBe(true);

    const missing = tech.listNodes({ contentStatus: 'missing', limit: 300 });
    expect(missing.items.every((node) => node.contentStatus === 'missing' && !node.hasContent)).toBe(true);

    const withDocs = tech.listNodes({ hasContent: true, limit: 300 });
    expect(withDocs.items.every((node) => node.hasContent)).toBe(true);

    const search = tech.listNodes({ q: 'histogram_quantile', limit: 300 });
    expect(search.items.some((node) => node.id === 'prom-promql')).toBe(true);
  });
});

describe('content verification and stale review', () => {
  it('records an explicit verification without changing the Markdown body', () => {
    const domain = tech.listDomainSummaries().find((entry) => entry.name === 'Kubernetes')!;
    const node = tech.createNode(domain.id, { name: '验证记录测试节点', nodeType: 'concept' });
    const markdown = '## 定义\n\n用于验证状态测试。';
    tech.updateNode(node.id, { contentMarkdown: markdown, contentStatus: 'draft' });

    const verified = tech.verifyNodeContent(node.id, { version: 'v1.32' });
    expect(verified.contentStatus).toBe('complete');
    expect(verified.contentMarkdown).toBe(markdown);
    expect(verified.verifiedVersion).toBe('v1.32');
    expect(verified.contentVerifiedAt).toBeTruthy();

    tech.deleteNode(node.id);
  });

  it('requires content before verification', () => {
    const domain = tech.listDomainSummaries().find((entry) => entry.name === 'Kubernetes')!;
    const node = tech.createNode(domain.id, { name: '空文档验证测试节点', nodeType: 'concept' });
    expect(() => tech.verifyNodeContent(node.id, { version: 'v1.0' })).toThrow();
    tech.deleteNode(node.id);
  });

  it('requires an explicit version before verification', () => {
    const domain = tech.listDomainSummaries().find((entry) => entry.name === 'Kubernetes')!;
    const node = tech.createNode(domain.id, { name: '验证版本必填测试节点', nodeType: 'concept' });
    tech.updateNode(node.id, { contentMarkdown: '# 内容' });
    expect(() => tech.verifyNodeContent(node.id, {})).toThrow(/版本/);
    expect(() => tech.verifyNodeContent(node.id, { version: '   ' })).toThrow(/版本/);
    expect(tech.getNode(node.id)!.contentStatus).toBe('draft');
    expect(tech.getNode(node.id)!.verifiedVersion).toBeNull();
    tech.deleteNode(node.id);
  });

  it('rejects direct complete status and verification metadata through ordinary writes', () => {
    const domain = tech.listDomainSummaries().find((entry) => entry.name === 'Kubernetes')!;
    expect(() =>
      tech.createNode(domain.id, {
        name: '直接完成创建测试节点',
        nodeType: 'concept',
        contentMarkdown: '# 内容',
        contentStatus: 'complete',
      }),
    ).toThrow(/验证操作/);
    const node = tech.createNode(domain.id, { name: '直接完成更新测试节点', nodeType: 'concept' });
    tech.updateNode(node.id, { contentMarkdown: '# 内容', contentStatus: 'draft' });
    expect(() => tech.updateNode(node.id, { contentStatus: 'complete' })).toThrow(/验证操作/);
    expect(() => tech.updateNode(node.id, { verifiedVersion: 'v9.9' })).toThrow(/验证操作/);
    const unchanged = tech.getNode(node.id)!;
    expect(unchanged.contentStatus).toBe('draft');
    expect(unchanged.verifiedVersion).toBeNull();
    expect(unchanged.contentVerifiedAt).toBeNull();
    tech.deleteNode(node.id);
  });

  it('retains the last verification when a complete document is edited', () => {
    const domain = tech.listDomainSummaries().find((entry) => entry.name === 'Kubernetes')!;
    const node = tech.createNode(domain.id, { name: '验证历史测试节点', nodeType: 'concept' });
    tech.updateNode(node.id, { contentMarkdown: '# 第一版', contentStatus: 'draft' });
    const verified = tech.verifyNodeContent(node.id, { version: 'v2.0' });

    const edited = tech.updateNode(node.id, {
      contentMarkdown: '# 第二版',
      contentStatus: 'needs_review',
    });
    expect(edited.contentStatus).toBe('draft');
    expect(edited.verifiedVersion).toBe('v2.0');
    expect(edited.contentVerifiedAt).toBe(verified.contentVerifiedAt);

    tech.deleteNode(node.id);
  });

  it('invalidates Complete when version, official source or reference links change', () => {
    const domain = tech.listDomainSummaries().find((entry) => entry.name === 'Kubernetes')!;
    const node = tech.createNode(domain.id, { name: '版本身份测试节点', nodeType: 'concept' });
    tech.updateNode(node.id, {
      contentMarkdown: '# 内容',
      applicableVersions: 'Kubernetes 1.35–1.37',
      docsUrl: 'https://kubernetes.io/docs/',
      referenceLinks: [{ label: 'Docs', url: 'https://kubernetes.io/docs/' }],
    });
    const verified = tech.verifyNodeContent(node.id, { version: 'Kubernetes 1.37.2' });

    const notesOnly = tech.updateNode(node.id, { personalNotes: '只改个人笔记' });
    expect(notesOnly.contentStatus).toBe('complete');
    expect(notesOnly.verifiedVersion).toBe('Kubernetes 1.37.2');

    const versionsChanged = tech.updateNode(node.id, {
      applicableVersions: 'Kubernetes 1.36–1.37',
    });
    expect(versionsChanged.contentStatus).toBe('draft');
    expect(versionsChanged.verifiedVersion).toBe(verified.verifiedVersion);
    expect(versionsChanged.contentVerifiedAt).toBe(verified.contentVerifiedAt);
    expect(() =>
      tech.updateNode(node.id, { contentStatus: 'complete' }),
    ).toThrow(/验证操作/);

    const reverified = tech.verifyNodeContent(node.id, { version: 'Kubernetes 1.37.2' });
    expect(reverified.contentStatus).toBe('complete');
    const docsChanged = tech.updateNode(node.id, {
      docsUrl: 'https://kubernetes.io/docs/concepts/',
    });
    expect(docsChanged.contentStatus).toBe('draft');

    tech.verifyNodeContent(node.id, { version: 'Kubernetes 1.37.2' });
    const linksChanged = tech.updateNode(node.id, {
      referenceLinks: [{ label: 'Concepts', url: 'https://kubernetes.io/docs/concepts/' }],
    });
    expect(linksChanged.contentStatus).toBe('draft');

    tech.verifyNodeContent(node.id, { version: 'Kubernetes 1.37.2' });
    const unchanged = tech.updateNode(node.id, {
      applicableVersions: 'Kubernetes 1.36–1.37',
      docsUrl: 'https://kubernetes.io/docs/concepts/',
      referenceLinks: [{ label: 'Concepts', url: 'https://kubernetes.io/docs/concepts/' }],
    });
    expect(unchanged.contentStatus).toBe('complete');

    tech.deleteNode(node.id);
  });

  it('filters long-unverified content by verification timestamp', () => {
    const domain = tech.listDomainSummaries().find((entry) => entry.name === 'Kubernetes')!;
    const node = tech.createNode(domain.id, { name: '长期未验证测试节点', nodeType: 'concept' });
    tech.updateNode(node.id, { contentMarkdown: '# 内容', contentStatus: 'draft' });
    tech.verifyNodeContent(node.id, { version: 'v1.0' });

    const fresh = tech.listNodes({ domainId: domain.id, staleDays: 180, limit: 300 });
    expect(fresh.items.some((entry) => entry.id === node.id)).toBe(false);

    dbModule.db
      .prepare('UPDATE tech_nodes SET content_verified_at = ? WHERE id = ?')
      .run('2020-01-01T00:00:00.000Z', node.id);
    const stale = tech.listNodes({ domainId: domain.id, staleDays: 180, limit: 300 });
    expect(stale.items.some((entry) => entry.id === node.id)).toBe(true);

    tech.deleteNode(node.id);
  });
});

describe('software and technical knowledge links', () => {
  it('does not duplicate a software link and exposes it from both sides', () => {
    const domain = tech.listDomainSummaries().find((entry) => entry.name === 'Prometheus')!;
    const node = tech.createNode(domain.id, { name: '软件关联测试节点', nodeType: 'component' });
    const softwareId = software.createSoftware({ name: '关联测试软件', sources: [] });

    tech.linkSoftware(node.id, softwareId, true);
    tech.linkSoftware(node.id, softwareId, true);
    const count = dbModule.db
      .prepare('SELECT count(*) AS count FROM tech_node_software WHERE node_id = ? AND software_id = ?')
      .get(node.id, softwareId) as { count: number };
    expect(count.count).toBe(1);

    expect(tech.listNodeSoftware(node.id).map((link) => link.software.id)).toEqual([softwareId]);
    expect(software.listSoftwareTechNodes(softwareId).map((link) => link.id)).toEqual([node.id]);

    tech.linkSoftware(node.id, softwareId, false);
    expect(tech.listNodeSoftware(node.id)).toHaveLength(0);
    dbModule.db.prepare('DELETE FROM software WHERE id = ?').run(softwareId);
    tech.deleteNode(node.id);
  });

  it('keeps seed content priority explicit and ignores undefined, null and empty overrides', () => {
    const merged = content.mergeDefined(
      {
        nodeId: 'merge-test',
        docsUrl: 'https://example.com/docs',
        repoUrl: 'https://github.com/a/b',
        description: '已有描述',
        referenceLinks: [{ label: 'Docs', url: 'https://example.com/docs' }],
      },
      {
        nodeId: 'merge-test',
        docsUrl: undefined,
        repoUrl: '',
        description: null as unknown as string,
        referenceLinks: [],
        contentMarkdown: '   ',
      },
    );
    expect(merged.docsUrl).toBe('https://example.com/docs');
    expect(merged.repoUrl).toBe('https://github.com/a/b');
    expect(merged.description).toBe('已有描述');
    expect(merged.referenceLinks).toHaveLength(1);
    expect(merged.contentMarkdown).toBeUndefined();

    const overridden = content.mergeDefined(merged, {
      nodeId: 'merge-test',
      repoUrl: 'https://github.com/c/d',
      contentMarkdown: '# 新内容',
    });
    expect(overridden.repoUrl).toBe('https://github.com/c/d');
    expect(overridden.contentMarkdown).toBe('# 新内容');
  });
});

describe('technology overview', () => {
  it('counts mastery and focus only from user-maintained fields', () => {
    const domain = tech.listDomainSummaries().find((entry) => entry.name === 'Kubernetes')!;
    const node = tech.createNode(domain.id, { name: '认知测试节点', nodeType: 'concept' });
    tech.updateNodeCognition(node.id, { masteryStatus: 'learning', focusLevel: 'focus' });
    const overview = tech.getTechOverview();
    expect(overview.learningNodes.some((entry) => entry.id === node.id)).toBe(true);
    expect(overview.focusNodes.some((entry) => entry.id === node.id)).toBe(true);
    expect(overview.stats.learning).toBeGreaterThanOrEqual(1);
    expect(overview.stats.focus).toBeGreaterThanOrEqual(1);
    tech.deleteNode(node.id);
  });
});
