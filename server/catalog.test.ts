import { describe, expect, it } from 'vitest';
import type { CatalogCoverage, CatalogSource } from '../shared/types.js';
import { catalog, categories } from './catalog.js';

const knownCategories = [
  '容器与编排',
  '云原生与服务治理',
  '数据库',
  '缓存与搜索',
  '消息与流',
  '可观测性',
  'CI/CD',
  '安全与供应链',
  'Web 与代理',
  '存储与虚拟化',
  '运行时',
  '基础设施',
  '操作系统',
];

function sourceTypes(sources: CatalogSource[]): Set<string> {
  return new Set(sources.map((source) => source.type));
}

function expectedCoverage(sources: CatalogSource[]): CatalogCoverage['level'] {
  const types = sourceTypes(sources);
  const lifecycle = types.has('endoflife');
  const releases = types.has('github_releases');
  const advisories = types.has('github_advisories') || types.has('nvd');
  if (lifecycle && releases && advisories) return 'full';
  if ((lifecycle || releases) && advisories) return 'partial';
  return 'limited';
}

describe('built-in software catalog', () => {
  it('contains the P5.3 target range without duplicate identifiers', () => {
    expect(catalog.length).toBeGreaterThanOrEqual(100);
    expect(catalog.length).toBeLessThanOrEqual(115);
    expect(new Set(catalog.map((item) => item.key)).size).toBe(catalog.length);
    expect(new Set(catalog.map((item) => item.name.toLowerCase())).size).toBe(catalog.length);
  });

  it('keeps existing categories and adds the P5.3 domains', () => {
    expect(categories).toEqual(expect.arrayContaining(knownCategories));
  });

  it('gives every entry searchable tags, a description and a valid website', () => {
    for (const item of catalog) {
      expect(item.tags.length, `${item.key} tags`).toBeGreaterThan(0);
      expect(item.description.trim().length, `${item.key} description`).toBeGreaterThan(4);
      if (item.website) expect(item.website, `${item.key} website`).toMatch(/^https:\/\/\S+$/);
      if (item.repo) {
        expect(item.repo, `${item.key} repo`).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/);
      }
      expect(item.aliases.every((alias) => alias.trim().length > 0), `${item.key} aliases`).toBe(true);
    }
  });

  it('only binds lifecycle sources to explicit endoflife.date product slugs', () => {
    for (const item of catalog) {
      const source = item.sources.find((entry) => entry.type === 'endoflife');
      if (!source) continue;
      expect(source.config.product, `${item.key} product`).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(source.label).toBe('endoflife.date');
    }
  });

  it('ties GitHub release sources to a repository and never invents release channels', () => {
    for (const item of catalog) {
      const source = item.sources.find((entry) => entry.type === 'github_releases');
      if (!source) continue;
      expect(item.repo).toBeTruthy();
      expect(source.config.repo, `${item.key} release repo`).toBe(item.repo!.replace('https://github.com/', ''));
    }
  });

  it('requires package and ecosystem metadata for GitHub advisories', () => {
    for (const item of catalog) {
      const source = item.sources.find((entry) => entry.type === 'github_advisories');
      if (!source) continue;
      expect(source.config.package?.trim(), `${item.key} advisory package`).toBeTruthy();
      expect(source.config.ecosystem?.trim(), `${item.key} advisory ecosystem`).toBeTruthy();
    }
  });

  it('marks every NVD mapping with a match type and review note', () => {
    for (const item of catalog) {
      const source = item.sources.find((entry) => entry.type === 'nvd');
      if (!source) continue;
      expect(source.config.keyword?.trim() || source.config.cpeName?.trim(), `${item.key} NVD query`).toBeTruthy();
      expect(['keyword', 'cpe']).toContain(source.config.matchType);
      expect(source.config.matchType === 'cpe' ? source.config.cpeName : true).toBeTruthy();
      expect(source.config.note?.trim(), `${item.key} NVD note`).toBeTruthy();
    }
  });

  it('enables the global CISA KEV feed without per-software configuration', () => {
    for (const item of catalog) {
      const source = item.sources.find((entry) => entry.type === 'cisa_kev');
      expect(source, `${item.key} KEV`).toBeTruthy();
      expect(source!.config.feed).toBe(
        'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
      );
    }
  });

  it('derives coverage from the sources that are actually present', () => {
    for (const item of catalog) {
      expect(item.coverage.level).toBe(expectedCoverage(item.sources));
      expect(item.coverage.lifecycle).toBe(sourceTypes(item.sources).has('endoflife'));
      expect(item.coverage.releases).toBe(sourceTypes(item.sources).has('github_releases'));
      expect(item.coverage.advisories).toBe(
        sourceTypes(item.sources).has('github_advisories') || sourceTypes(item.sources).has('nvd'),
      );
      expect(item.coverage.kev).toBe(true);
      expect(item.coverage.notes.length).toBeGreaterThan(0);
    }
  });
});
