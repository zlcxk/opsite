import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { catalog } from '../catalog.js';
import { P2_CONTENT } from './tech-content-p2.js';
import { P2_TEMPLATES } from './tech-seed-p2.js';

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

const EXPECTED_SLUGS: Record<string, string> = {
  'db-mysql': 'mysql',
  'db-postgresql': 'postgresql',
  'db-redis': 'redis',
  'db-clickhouse': 'clickhouse',
  'msg-kafka': 'kafka',
  'msg-rocketmq': 'rocketmq',
  'msg-rabbitmq': 'rabbitmq',
  'msg-pulsar': 'apache-pulsar',
  'obs-grafana': 'grafana',
  'obs-loki': 'loki',
  'obs-otel': 'opentelemetry-collector',
  'obs-skywalking': 'skywalking',
  'del-argocd': 'argo-cd',
  'del-harbor': 'harbor',
  'del-terraform': 'terraform',
  'del-ansible': 'ansible',
  'infra-istio': 'istio',
  'infra-envoy': 'envoy-proxy',
  'infra-cert-manager': 'cert-manager',
  'infra-podman': 'podman',
};

const MECHANISMS: Record<string, string[]> = {
  'db-mysql': ['聚簇索引', 'redo', 'undo', 'binlog', 'MVCC', 'Next-Key Lock'],
  'db-postgresql': ['堆表', 'WAL', 'VACUUM', 'B-tree', 'GIN', 'BRIN', '逻辑复制'],
  'db-redis': ['16384', 'RDB', 'AOF', 'Sentinel', 'Cluster', 'Valkey'],
  'db-clickhouse': ['MergeTree', 'granule', '排序键', 'Keeper', 'Mutation'],
  'msg-kafka': ['ISR', 'KRaft', 'acks=all', '恰好一次'],
  'msg-rocketmq': ['NameServer', 'CommitLog', 'ConsumeQueue', 'Proxy', 'POP'],
  'msg-rabbitmq': ['AMQP', '交换机', '仲裁队列', '发布确认', 'prefetch'],
  'msg-pulsar': ['BookKeeper', 'ledger', 'key_shared', '分层存储', '跨地域复制'],
  'obs-grafana': ['数据源', 'provisioning', '统一告警'],
  'obs-loki': ['只索引标签', '日志流', '对象存储', 'LogQL'],
  'obs-otel': ['receiver', 'processor', 'exporter', 'pipeline', 'memory_limiter'],
  'obs-skywalking': ['Agent', 'OAP', 'trace segment', '拓扑'],
  'del-argocd': ['Application', 'AppProject', 'Sync', '漂移'],
  'del-harbor': ['OCI', '垃圾回收', '扫描', '复制'],
  'del-terraform': ['状态文件', 'plan', 'apply', 'provider', 'import'],
  'del-ansible': ['无代理', 'inventory', '幂等', 'handler', 'check mode'],
  'infra-istio': ['sidecar', 'ambient', 'ztunnel', 'waypoint', 'mTLS'],
  'infra-envoy': ['listener', 'cluster', 'xDS', 'filter chain'],
  'infra-cert-manager': ['ACME', 'Certificate', 'Issuer', 'DNS-01', 'renewBefore'],
  'infra-podman': ['无守护进程', 'rootless', 'Quadlet', 'Pod'],
};

const ORIGINAL_RELATIONS = [
  ['rel-db-mysql-pg', 'db-mysql', 'db-postgresql', 'alternative'],
  ['rel-db-redis-mysql', 'db-redis', 'db-mysql', 'related'],
  ['rel-msg-kafka-pulsar', 'msg-kafka', 'msg-pulsar', 'alternative'],
  ['rel-msg-rabbitmq-kafka', 'msg-rabbitmq', 'msg-kafka', 'alternative'],
  ['rel-obs-grafana-loki', 'obs-grafana', 'obs-loki', 'related'],
  ['rel-obs-otel-grafana', 'obs-otel', 'obs-grafana', 'related'],
  ['rel-del-harbor-argocd', 'del-harbor', 'del-argocd', 'related'],
  ['rel-del-terraform-ansible', 'del-terraform', 'del-ansible', 'related'],
  ['rel-infra-istio-envoy', 'infra-istio', 'infra-envoy', 'depends_on'],
  ['rel-infra-cert-istio', 'infra-cert-manager', 'infra-istio', 'related'],
];

const docs = new Map(P2_CONTENT.map((entry) => [entry.nodeId, entry]));
const nodes = P2_TEMPLATES.flatMap((template) =>
  template.domains.flatMap((domain) => domain.nodes.map((node) => ({ domain, node }))),
);
const nodeIds = new Set(nodes.map(({ node }) => node.id));
const relations = P2_TEMPLATES.flatMap((template) =>
  template.domains.flatMap((domain) => domain.relations),
);

function doc(nodeId: string) {
  const entry = docs.get(nodeId);
  if (!entry?.contentMarkdown) throw new Error(`missing document: ${nodeId}`);
  return entry;
}

describe('P5.4.3 non-Kubernetes knowledge depth', () => {
  it('ships exactly 20 versioned drafts with a seed hash gate', () => {
    expect(P2_CONTENT).toHaveLength(20);
    for (const entry of P2_CONTENT) {
      expect(entry.version, entry.nodeId).toBe(2);
      expect(entry.replacesContentHash, entry.nodeId).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.contentStatus, entry.nodeId).toBe('draft');
      expect(entry.applicableVersions, entry.nodeId).toContain('核实基线');
    }
  });

  it('uses the fixed eight-section structure in order', () => {
    for (const entry of P2_CONTENT) {
      const headings = [...entry.contentMarkdown!.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
      expect(headings, entry.nodeId).toEqual(REQUIRED_SECTIONS);
    }
  });

  it('records the previous content hash rather than the new body', () => {
    const hashes = new Set<string>();
    for (const entry of P2_CONTENT) {
      const current = crypto.createHash('sha256').update(entry.contentMarkdown!).digest('hex');
      expect(entry.replacesContentHash, entry.nodeId).not.toBe(current);
      hashes.add(entry.replacesContentHash!);
    }
    expect(hashes.size).toBe(P2_CONTENT.length);
  });

  it('keeps every document above 1500 characters', () => {
    for (const entry of P2_CONTENT) {
      expect(entry.contentMarkdown!.length, entry.nodeId).toBeGreaterThanOrEqual(1500);
    }
  });

  it('provides an official docs URL and at least two official reference links', () => {
    for (const entry of P2_CONTENT) {
      expect(entry.docsUrl, entry.nodeId).toMatch(/^https:\/\//);
      expect(entry.referenceLinks?.length, entry.nodeId).toBeGreaterThanOrEqual(2);
      for (const link of entry.referenceLinks ?? []) {
        expect(link.url, `${entry.nodeId} ${link.label}`).toMatch(/^https:\/\//);
      }
    }
  });

  it('covers the product-specific mechanisms from the P5.4.3 brief', () => {
    for (const [nodeId, terms] of Object.entries(MECHANISMS)) {
      const markdown = doc(nodeId).contentMarkdown!;
      for (const term of terms) {
        expect(markdown, `${nodeId} should mention ${term}`).toContain(term);
      }
    }
  });
});

describe('P5.4.3 software mapping audit', () => {
  it('maps every node to the expected catalog product', () => {
    expect(nodes).toHaveLength(20);
    const slugs = new Set(catalog.map((item) => item.key));
    for (const { node } of nodes) {
      expect(node.softwareSlug, node.id).toBe(EXPECTED_SLUGS[node.id]);
      expect(slugs.has(node.softwareSlug!), `${node.id} -> ${node.softwareSlug}`).toBe(true);
    }
  });

  it('does not map two nodes to the same software', () => {
    const used = nodes.map(({ node }) => node.softwareSlug).filter(Boolean);
    expect(new Set(used).size).toBe(used.length);
  });

  it('supports reverse lookup from software to its technology node', () => {
    const bySlug = new Map(nodes.map(({ node }) => [node.softwareSlug, node.id]));
    for (const [nodeId, slug] of Object.entries(EXPECTED_SLUGS)) {
      expect(bySlug.get(slug), `${slug} reverse lookup`).toBe(nodeId);
    }
  });

  it('documents Redis and Valkey as independent version lines', () => {
    const entry = doc('db-redis');
    expect(entry.applicableVersions).toContain('Valkey 9.1.x');
    expect(entry.contentMarkdown).toContain('Redis 与 Valkey 已独立演进');
  });
});

describe('P5.4.3 relation review', () => {
  it('keeps all ten original seed tuples unchanged', () => {
    for (const [id, source, target, type] of ORIGINAL_RELATIONS) {
      const relation = relations.find((item) => item.id === id);
      expect(relation, id).toMatchObject({ source, target, relationType: type });
    }
  });

  it('adds only the three evidence-based cross-product relations', () => {
    expect(relations).toHaveLength(13);
    expect(relations.find((item) => item.id === 'rel-msg-kafka-clickhouse')).toMatchObject({
      source: 'msg-kafka',
      target: 'db-clickhouse',
      relationType: 'related',
    });
    expect(relations.find((item) => item.id === 'rel-obs-otel-loki')).toMatchObject({
      source: 'obs-otel',
      target: 'obs-loki',
      relationType: 'related',
    });
    expect(relations.find((item) => item.id === 'rel-obs-grafana-clickhouse')).toMatchObject({
      source: 'obs-grafana',
      target: 'db-clickhouse',
      relationType: 'related',
    });
  });

  it('keeps relation ids unique and both endpoints inside the authored node set', () => {
    expect(new Set(relations.map((item) => item.id)).size).toBe(relations.length);
    for (const relation of relations) {
      expect(nodeIds.has(relation.source), relation.id).toBe(true);
      expect(nodeIds.has(relation.target), relation.id).toBe(true);
      expect(relation.source).not.toBe(relation.target);
      expect(relation.description, relation.id).toBeTruthy();
    }
  });
});
