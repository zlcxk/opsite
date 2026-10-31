import { describe, expect, it } from 'vitest';
import { catalog } from '../catalog.js';
import { P2_CONTENT } from './tech-content-p2.js';
import { P2_TEMPLATES } from './tech-seed-p2.js';

describe('P2 technology templates', () => {
  const nodes = P2_TEMPLATES.flatMap((template) =>
    template.domains.flatMap((domain) => domain.nodes.map((node) => ({ template, domain, node }))),
  );
  const nodeIds = nodes.map(({ node }) => node.id);
  const slugs = new Set(catalog.map((item) => item.key));
  const contentByNode = new Map(P2_CONTENT.map((entry) => [entry.nodeId, entry]));

  it('uses unique domain and node identifiers', () => {
    const domainIds = P2_TEMPLATES.flatMap((template) => template.domains.map((domain) => domain.id));
    expect(new Set(domainIds).size).toBe(domainIds.length);
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
  });

  it('only links existing catalog software and never duplicates a node', () => {
    for (const { node } of nodes) {
      if (node.softwareSlug) {
        expect(slugs.has(node.softwareSlug), `${node.id} -> ${node.softwareSlug}`).toBe(true);
      }
    }
    expect(new Set(nodes.map(({ node }) => node.softwareSlug).filter(Boolean)).size).toBe(
      nodes.filter(({ node }) => node.softwareSlug).length,
    );
  });

  it('ships a draft document with an applicable version for every node', () => {
    for (const { node } of nodes) {
      const entry = contentByNode.get(node.id);
      expect(entry, node.id).toBeTruthy();
      expect(entry?.contentMarkdown?.trim().length, node.id).toBeGreaterThan(40);
      expect(entry?.contentStatus, node.id).toBe('draft');
      expect(entry?.applicableVersions, node.id).toBeTruthy();
      expect(entry?.docsUrl, node.id).toMatch(/^https:\/\//);
    }
  });

  it('keeps relations inside the authored node set', () => {
    const ids = new Set(nodeIds);
    for (const template of P2_TEMPLATES) {
      for (const domain of template.domains) {
        for (const relation of domain.relations) {
          expect(ids.has(relation.source), relation.id).toBe(true);
          expect(ids.has(relation.target), relation.id).toBe(true);
          expect(relation.source).not.toBe(relation.target);
        }
      }
    }
  });
});
