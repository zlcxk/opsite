import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TechTreeNode } from '../../shared/types.js';

let dataDir: string;
let dbModule: typeof import('../db.js');
let seed: typeof import('./tech-seed.js');
let tech: typeof import('./tech.js');
let notes: typeof import('./notes.js');

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsite-tech-'));
  process.env.DATA_DIR = dataDir;
  dbModule = await import('../db.js');
  seed = await import('./tech-seed.js');
  tech = await import('./tech.js');
  notes = await import('./notes.js');
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
  it('seeds Kubernetes and Prometheus without duplicating on reapply', () => {
    const overview = tech.getTechOverview();
    expect(overview.domains.map((domain) => domain.name)).toEqual(['Kubernetes', 'Prometheus']);
    expect(overview.stats.nodes).toBeGreaterThan(120);

    const again = seed.applyTechTemplate('kubernetes');
    expect(again?.inserted.domains).toBe(0);
    expect(again?.inserted.nodes).toBe(0);
    expect(again?.inserted.views).toBe(0);
    expect(again?.inserted.relations).toBe(0);
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
