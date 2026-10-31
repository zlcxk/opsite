import { describe, expect, it } from 'vitest';
import { PROMETHEUS_DOCS } from './tech-content-prometheus-docs.js';

function doc(nodeId: string) {
  const entry = PROMETHEUS_DOCS.find((item) => item.nodeId === nodeId);
  if (!entry?.contentMarkdown) throw new Error(`missing document: ${nodeId}`);
  return entry;
}

const SERVER_NODES = [
  'prom-core',
  'prom-server',
  'prom-tsdb',
  'prom-promql',
  'prom-data-model',
  'prom-service-discovery',
  'prom-scraping',
  'prom-relabel',
  'prom-remote-write',
  'prom-federation',
  'prom-scale',
  'prom-ha',
  'prom-backup',
  'prom-kubernetes-sd',
];

const OPERATOR_NODES = [
  'prom-operator',
  'prom-cr',
  'prom-service-monitor',
  'prom-pod-monitor',
  'prom-scrape-config-cr',
  'prom-probe',
  'prom-rule-cr',
  'prom-generated-config',
];

const ALERTMANAGER_NODES = ['prom-alertmanager', 'prom-am-config', 'prom-alert-routing'];
const EXPORTER_NODES = ['prom-exporter', 'prom-node-exporter', 'prom-kube-state-metrics'];

describe('P5.4.2 Prometheus version governance', () => {
  it('versions every document with a hash gate instead of rewriting in place', () => {
    expect(PROMETHEUS_DOCS).toHaveLength(29);
    for (const entry of PROMETHEUS_DOCS) {
      expect(entry.version, entry.nodeId).toBe(2);
      expect(entry.replacesContentHash, entry.nodeId).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.contentStatus, entry.nodeId).toBe('draft');
    }
  });

  it('adds a version section before the reference section in every document', () => {
    for (const entry of PROMETHEUS_DOCS) {
      const markdown = entry.contentMarkdown!;
      const versionSection = markdown.indexOf('## 版本差异与兼容性');
      expect(versionSection, `${entry.nodeId} version section`).toBeGreaterThan(0);
      expect(versionSection, `${entry.nodeId} version section position`).toBeLessThan(
        markdown.indexOf('## 参考资料'),
      );
    }
  });

  it('separates Prometheus Server, Operator, Alertmanager, exporters and Thanos lifecycles', () => {
    for (const nodeId of SERVER_NODES) {
      const entry = doc(nodeId);
      expect(entry.applicableVersions, nodeId).toContain('3.13 LTS');
      expect(entry.applicableVersions, nodeId).toContain('3.15.1');
      expect(entry.applicableVersions, nodeId).toContain('2.x 已 EOL');
    }
    for (const entry of PROMETHEUS_DOCS) {
      expect(entry.applicableVersions, entry.nodeId).not.toContain('Prometheus Operator 0.70+');
      expect(entry.applicableVersions, entry.nodeId).not.toContain('2.45+');
    }
  });

  it('does not apply Prometheus Server lifecycle claims to the Operator', () => {
    for (const nodeId of OPERATOR_NODES) {
      const entry = doc(nodeId);
      expect(entry.applicableVersions, nodeId).toContain('Operator 0.94.x');
      expect(entry.applicableVersions, nodeId).toContain('0.94.2');
      expect(entry.applicableVersions, nodeId).not.toContain('3.13 LTS');
    }
    expect(doc('prom-operator').contentMarkdown).toContain('要求 1.25 及以上');
    expect(doc('prom-operator').contentMarkdown).toContain('kube-prometheus-stack');
  });

  it('keeps Alertmanager, exporters and Thanos on their own release tracks', () => {
    for (const nodeId of ALERTMANAGER_NODES) {
      const entry = doc(nodeId);
      expect(entry.applicableVersions, nodeId).toContain('Alertmanager 0.34.x');
      expect(entry.applicableVersions, nodeId).toContain('与 Prometheus Server 版本独立');
    }
    for (const nodeId of EXPORTER_NODES) {
      expect(doc(nodeId).applicableVersions, nodeId).toContain('独立');
    }
    expect(doc('prom-thanos').applicableVersions).toContain('Thanos 0.42.x');
    expect(doc('prom-thanos').contentMarkdown).toContain('不能由 Prometheus 的 LTS 推断');
  });

  it('keeps version-specific sources in the document body', () => {
    expect(doc('prom-server').docsUrl).toContain('/prometheus/3.15/');
    expect(doc('prom-tsdb').docsUrl).toContain('/prometheus/3.15/');
    expect(doc('prom-am-config').docsUrl).toContain('/alerting/0.34/');
    expect(doc('prom-server').contentMarkdown).not.toContain('/prometheus/latest/');
    expect(doc('prom-alertmanager').contentMarkdown).not.toContain('/alerting/latest/');
  });
});
