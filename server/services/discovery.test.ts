import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DiscoveryAdapter, DiscoveryFetchedItem } from '../adapters/discovery.js';
import {
  canonicalProjectUrl,
  mapCncfLandscape,
  mapGitHubRepository,
  parseCncfLandscape,
} from '../adapters/discovery.js';

let dataDir: string;
let dbModule: typeof import('../db.js');
let discovery: typeof import('./discovery.js');
let notes: typeof import('./notes.js');

const githubRepo = {
  id: 101,
  name: 'opsite-demo',
  full_name: 'demo/opsite-demo',
  html_url: 'https://github.com/demo/opsite-demo',
  homepage: 'https://demo.example.com',
  description: 'A demo cloud native tool',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  pushed_at: '2026-10-02T00:00:00Z',
  stargazers_count: 1520,
  forks_count: 88,
  language: 'Go',
  license: { spdx_id: 'Apache-2.0', name: 'Apache License 2.0' },
};

const githubItem: DiscoveryFetchedItem = {
  sourceType: 'github',
  sourceItemId: String(githubRepo.id),
  sourceRef: githubRepo.full_name,
  title: githubRepo.name,
  description: githubRepo.description,
  category: '云原生',
  canonicalUrl: githubRepo.html_url,
  homepageUrl: githubRepo.homepage,
  sourceUrl: githubRepo.html_url,
  sourceCreatedAt: githubRepo.created_at,
  sourceUpdatedAt: githubRepo.updated_at,
  sourcePushedAt: githubRepo.pushed_at,
  starsCount: githubRepo.stargazers_count,
  forksCount: githubRepo.forks_count,
  language: githubRepo.language,
  license: 'Apache-2.0',
};

const cncfItem: DiscoveryFetchedItem = {
  ...githubItem,
  sourceType: 'cncf',
  sourceItemId: 'provisioning--automation-configuration--opsite-demo',
  sourceRef: 'CNCF Graduated',
  category: 'Provisioning',
};

function adapter(
  type: 'github' | 'cncf',
  fetch: DiscoveryAdapter['fetch'],
): DiscoveryAdapter {
  return { type, fetch };
}

function emptyAdapters(overrides: Partial<Record<'github' | 'cncf', DiscoveryAdapter>> = {}) {
  return {
    github: overrides.github ?? adapter('github', async () => ({ items: [] })),
    cncf: overrides.cncf ?? adapter('cncf', async () => ({ items: [] })),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForIdle(): Promise<void> {
  for (let index = 0; index < 60; index += 1) {
    if (!discovery.isDiscoveryRunning()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('discovery run did not finish');
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsite-discovery-'));
  process.env.DATA_DIR = dataDir;
  dbModule = await import('../db.js');
  discovery = await import('./discovery.js');
  notes = await import('./notes.js');
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

describe('discovery source mapping', () => {
  it('normalizes project URLs so cross-source duplicates can be linked', () => {
    expect(canonicalProjectUrl('http://GitHub.com/demo/opsite-demo.git/?tab=readme')).toBe(
      'https://github.com/demo/opsite-demo',
    );
    expect(canonicalProjectUrl('javascript:alert(1)')).toBeNull();
  });

  it('maps GitHub repositories without inventing missing metrics', () => {
    const mapped = mapGitHubRepository(githubRepo, '云原生');
    expect(mapped?.sourceItemId).toBe('101');
    expect(mapped?.starsCount).toBe(1520);
    expect(mapped?.license).toBe('Apache-2.0');

    const missing = mapGitHubRepository(
      { ...githubRepo, id: 102, stargazers_count: null, forks_count: null, language: null, license: null },
      '云原生',
    );
    expect(missing?.starsCount).toBeNull();
    expect(missing?.language).toBeNull();
    expect(missing?.license).toBeNull();
  });

  it('parses the official CNCF landscape.yml structure', () => {
    const data = parseCncfLandscape(`
landscape:
  - name: Runtime
    subcategories:
      - name: Container Runtime
        items:
          - name: containerd
            project: graduated
            repo_url: https://github.com/containerd/containerd
            homepage_url: https://containerd.io
            description: An industry-standard container runtime.
`);
    expect(data.landscape?.[0]?.subcategories?.[0]?.items?.[0]?.name).toBe('containerd');
  });

  it('filters CNCF maturity, skips items without links and never invents metrics', () => {
    const items = mapCncfLandscape(
      {
        landscape: [
          {
            name: 'Runtime',
            subcategories: [
              {
                name: 'Container Runtime',
                items: [
                  {
                    name: 'Graduated project',
                    project: 'graduated',
                    repo_url: 'https://github.com/a/project.git',
                    description: 'A graduated project',
                  },
                  {
                    name: 'Incubating project',
                    project: 'incubating',
                    homepage_url: 'https://b.example.com',
                  },
                  {
                    name: 'Sandbox project',
                    project: 'sandbox',
                    homepage_url: 'https://c.example.com',
                  },
                  {
                    name: 'No link',
                    project: 'graduated',
                  },
                ],
              },
            ],
          },
        ],
      },
      { query: 'maturity:graduated,incubating', category: 'CNCF 云原生' },
    );
    expect(items.map((item) => item.sourceItemId)).toEqual([
      'Runtime / Container Runtime / Graduated project',
      'Runtime / Container Runtime / Incubating project',
    ]);
    expect(items[0].canonicalUrl).toBe('https://github.com/a/project');
    expect(items[0].sourceRef).toBe('CNCF Graduated');
    expect(items[0].sourceUrl).toBe('https://landscape.cncf.io/');
    expect(items[0].starsCount).toBeNull();
    expect(items[0].forksCount).toBeNull();
    expect(items[0].language).toBeNull();
    expect(items[0].license).toBeNull();
    expect(items[0].sourcePushedAt).toBeNull();
    expect(items[1].canonicalUrl).toBe('https://b.example.com');
    expect(items[1].category).toBe('Runtime');
  });

  it('rejects malformed CNCF payloads and unsupported rule syntax', () => {
    expect(() => mapCncfLandscape({}, { query: '', category: 'CNCF' })).toThrow('格式异常');
    expect(() => parseCncfLandscape('landscape: [oops')).toThrow('YAML 解析失败');
    expect(() => parseCncfLandscape('items: []')).toThrow('格式异常');
    expect(() =>
      mapCncfLandscape({ landscape: [] }, { query: 'topic:kubernetes', category: 'CNCF' }),
    ).toThrow('仅支持');
  });
});

describe('discovery storage and collection', () => {
  it('seeds the configured trusted sources and rules', () => {
    const sources = discovery.listDiscoverySources();
    const rules = discovery.listDiscoveryRules();
    expect(sources.map((source) => source.type)).toEqual(['cncf', 'github']);
    expect(rules).toHaveLength(7);
    expect(rules.filter((rule) => rule.sourceType === 'github')).toHaveLength(6);
    expect(rules.every((rule) => rule.query.length > 0)).toBe(true);
  });

  it('creates one candidate across GitHub and CNCF when the project URL matches', async () => {
    let githubCalls = 0;
    const adapters = emptyAdapters({
      github: adapter('github', async () => {
        githubCalls += 1;
        return { items: githubCalls === 1 ? [githubItem] : [], note: 'fake github' };
      }),
      cncf: adapter('cncf', async () => ({ items: [cncfItem], note: 'fake cncf' })),
    });

    const result = await discovery.runDiscovery({ trigger: 'manual', adapters });
    expect(result.failed).toBe(0);
    expect(result.jobs).toHaveLength(2);

    const list = discovery.listDiscoveryCandidates({ status: 'all' });
    expect(list.total).toBe(1);
    const candidate = list.items[0];
    expect(candidate.title).toBe('opsite-demo');
    expect(candidate.sourceType).toBe('github');
    expect(candidate.canonicalUrl).toBe('https://github.com/demo/opsite-demo');
    expect(candidate.sources).toHaveLength(2);
    expect(candidate.sources.map((source) => source.sourceType).sort()).toEqual(['cncf', 'github']);
    expect(candidate.status).toBe('pending');
    expect(list.counts.pending).toBe(1);

    const cncfJob = result.jobs.find((job) => job.sourceType === 'cncf');
    expect(cncfJob?.status).toBe('success');
    expect(cncfJob?.itemsNew).toBe(0);
    expect(cncfJob?.itemsDuplicate).toBe(1);
    expect(discovery.listDiscoverySources().every((source) => source.lastStatus === 'ok')).toBe(true);
  });

  it('re-collects without duplicating, preserving the first discovery time and user status', async () => {
    const initial = discovery.listDiscoveryCandidates({ status: 'all' }).items[0];
    discovery.ignoreDiscoveryCandidate(initial.id);

    const adapters = emptyAdapters({
      github: adapter('github', async () => ({ items: [githubItem] })),
      cncf: adapter('cncf', async () => ({ items: [cncfItem] })),
    });
    const result = await discovery.runDiscovery({ trigger: 'schedule', adapters });
    expect(result.failed).toBe(0);

    const list = discovery.listDiscoveryCandidates({ status: 'all' });
    expect(list.total).toBe(1);
    expect(list.items[0].id).toBe(initial.id);
    expect(list.items[0].status).toBe('ignored');
    expect(list.items[0].firstDiscoveredAt).toBe(initial.firstDiscoveredAt);
    expect(list.items[0].radarItemId).toBeNull();

    const githubJob = result.jobs.find((job) => job.sourceType === 'github');
    const cncfJob = result.jobs.find((job) => job.sourceType === 'cncf');
    expect(githubJob?.itemsUpdated).toBe(1);
    expect(cncfJob?.itemsDuplicate).toBe(1);
  });

  it('isolates a failing source and keeps existing candidates', async () => {
    const extra: DiscoveryFetchedItem = {
      ...cncfItem,
      sourceItemId: 'extra-project',
      title: 'Extra project',
      canonicalUrl: 'https://github.com/extra/project',
      sourceRef: 'CNCF Incubating',
      starsCount: null,
      forksCount: null,
      language: null,
      license: null,
    };
    const adapters = emptyAdapters({
      github: adapter('github', async () => {
        throw new Error('HTTP 403 · rate limit exceeded');
      }),
      cncf: adapter('cncf', async () => ({ items: [extra] })),
    });
    const result = await discovery.runDiscovery({ trigger: 'manual', adapters });
    expect(result.failed).toBe(1);

    const githubJob = result.jobs.find((job) => job.sourceType === 'github');
    const cncfJob = result.jobs.find((job) => job.sourceType === 'cncf');
    expect(githubJob?.status).toBe('error');
    expect(githubJob?.errorSummary).toContain('rate limit');
    expect(cncfJob?.status).toBe('success');

    const sources = discovery.listDiscoverySources();
    expect(sources.find((source) => source.type === 'github')?.lastStatus).toBe('error');
    expect(sources.find((source) => source.type === 'cncf')?.lastStatus).toBe('ok');
    expect(discovery.listDiscoveryCandidates({ status: 'all' }).total).toBe(2);
  });

  it('filters, searches and pages the candidate pool', () => {
    const byGithub = discovery.listDiscoveryCandidates({ sourceType: 'github' });
    expect(byGithub.total).toBe(1);
    const byCncf = discovery.listDiscoveryCandidates({ sourceType: 'cncf' });
    expect(byCncf.total).toBe(2);
    const ignored = discovery.listDiscoveryCandidates({ status: 'ignored' });
    expect(ignored.items.map((item) => item.id).sort()).toEqual(
      discovery.listDiscoveryCandidates({ status: 'all' }).items
        .filter((item) => item.status === 'ignored')
        .map((item) => item.id)
        .sort(),
    );
    const searched = discovery.listDiscoveryCandidates({ q: 'extra', status: 'all' });
    expect(searched.total).toBe(1);
    const paged = discovery.listDiscoveryCandidates({ status: 'all', limit: 1, offset: 0 });
    expect(paged.items).toHaveLength(1);
    expect(paged.total).toBe(2);
    expect(paged.categories.length).toBeGreaterThan(0);
  });

  it('prevents overlapping collection runs', async () => {
    const gate = deferred();
    let started = 0;
    const slow = adapter('github', async () => {
      started += 1;
      await gate.promise;
      return { items: [] };
    });
    const first = discovery.startDiscoveryRun('manual', emptyAdapters({ github: slow }));
    expect(first.started).toBe(true);
    const second = discovery.startDiscoveryRun('manual', emptyAdapters({ github: slow }));
    expect(second.started).toBe(false);
    expect(second.reason).toContain('正在进行');

    gate.resolve();
    await waitForIdle();
    expect(started).toBe(6);
  });
});

describe('discovery decisions and radar import', () => {
  it('restores ignored candidates to pending', () => {
    const ignored = discovery.listDiscoveryCandidates({ status: 'ignored', limit: 1 }).items[0];
    const restored = discovery.restoreDiscoveryCandidate(ignored.id);
    expect(restored.status).toBe('pending');
    expect(discovery.restoreDiscoveryCandidate(ignored.id).status).toBe('pending');
  });

  it('imports into the radar once and is idempotent', () => {
    const candidate = discovery.listDiscoveryCandidates({ q: 'opsite-demo', status: 'all' }).items[0];
    const first = discovery.importDiscoveryCandidate(candidate.id, { kind: 'tech' });
    expect(first.created).toBe(true);
    expect(first.radarItem.status).toBe('pending');
    expect(first.radarItem.kind).toBe('tech');
    expect(first.candidate.status).toBe('imported');
    expect(first.candidate.radarItemId).toBe(first.radarItem.id);
    expect(first.candidate.relatedRadarItem?.id).toBe(first.radarItem.id);

    const radarCount = (
      dbModule.db.prepare('SELECT COUNT(*) AS count FROM radar_item').get() as { count: number }
    ).count;
    const second = discovery.importDiscoveryCandidate(candidate.id, {});
    expect(second.created).toBe(false);
    expect(second.radarItem.id).toBe(first.radarItem.id);
    expect(
      (dbModule.db.prepare('SELECT COUNT(*) AS count FROM radar_item').get() as { count: number }).count,
    ).toBe(radarCount);
  });

  it('rejects ignoring an imported candidate and resets the link when the radar item is deleted', () => {
    const candidate = discovery.listDiscoveryCandidates({ q: 'opsite-demo', status: 'imported' }).items[0];
    expect(() => discovery.ignoreDiscoveryCandidate(candidate.id)).toThrow();
    expect(notes.deleteRadar(candidate.radarItemId!)).toBe(true);
    const reset = discovery.getDiscoveryCandidate(candidate.id);
    expect(reset?.status).toBe('pending');
    expect(reset?.radarItemId).toBeNull();
    expect(reset?.relatedRadarItem).toBeNull();
  });

  it('detects an existing radar link and only links when confirmed', () => {
    const candidate = discovery.listDiscoveryCandidates({ q: 'opsite-demo', status: 'pending' }).items[0];
    const existing = notes.createRadar({
      title: 'Already in radar',
      summary: 'A pre-existing entry with the same project URL.',
      kind: 'tool',
      url: 'https://github.com/demo/opsite-demo.git',
    });

    let duplicateError: unknown;
    try {
      discovery.importDiscoveryCandidate(candidate.id);
    } catch (error) {
      duplicateError = error;
    }
    expect(duplicateError).toBeInstanceOf(discovery.DiscoveryRequestError);
    expect((duplicateError as InstanceType<typeof discovery.DiscoveryRequestError>).status).toBe(409);
    const details = (duplicateError as InstanceType<typeof discovery.DiscoveryRequestError>)
      .details as { duplicateRadarItem?: { id: string } };
    expect(details.duplicateRadarItem?.id).toBe(existing.id);

    expect(
      (dbModule.db.prepare('SELECT COUNT(*) AS count FROM radar_item').get() as { count: number }).count,
    ).toBe(1);

    const linked = discovery.importDiscoveryCandidate(candidate.id, { radarItemId: existing.id });
    expect(linked.created).toBe(false);
    expect(linked.radarItem.id).toBe(existing.id);
    expect(linked.candidate.radarItemId).toBe(existing.id);
  });

  it('rejects unknown candidates and invalid radar links', () => {
    expect(() => discovery.importDiscoveryCandidate('missing')).toThrow();
    const candidate = discovery.listDiscoveryCandidates({ status: 'pending' }).items[0];
    expect(() =>
      discovery.importDiscoveryCandidate(candidate.id, { radarItemId: 'missing-radar' }),
    ).toThrow();
  });

  it('reports task state and marks stale running jobs as interrupted', () => {
    const runningId = 'interrupted-job';
    dbModule.db
      .prepare(
        `INSERT INTO discovery_job (id, source_type, trigger, status, started_at)
         VALUES (?, 'github', 'schedule', 'running', ?)`,
      )
      .run(runningId, new Date().toISOString());
    discovery.markInterruptedDiscoveryJobs();
    const row = dbModule.db
      .prepare('SELECT status, error_summary FROM discovery_job WHERE id = ?')
      .get(runningId) as { status: string; error_summary: string };
    expect(row.status).toBe('error');
    expect(row.error_summary).toContain('中断');
    const overview = discovery.getDiscoveryOverview({
      enabled: false,
      nextRunAt: null,
      timezone: 'Asia/Shanghai',
      cron: '0 9 * * *',
    });
    expect(overview.counts.all).toBeGreaterThan(0);
    expect(overview.sources).toHaveLength(2);
    expect(overview.rules).toHaveLength(7);
  });
});
