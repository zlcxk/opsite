import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Advisory, LifecycleFeedItem, SoftwareDetail } from '../../shared/types.js';

let dataDir: string;
let dbModule: typeof import('../db.js');
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsite-list-ordering-'));
  process.env.DATA_DIR = dataDir;
  dbModule = await import('../db.js');
  const router = (await import('../routes.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    dbModule?.db.close();
  } catch {
    // ignore close errors in cleanup
  }
  delete process.env.DATA_DIR;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  dbModule.db.prepare('DELETE FROM software').run();
});

async function getJson<T>(pathname: string): Promise<T> {
  const response = await fetch(`${baseUrl}${pathname}`);
  if (!response.ok) throw new Error(`${pathname}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

function addSoftware(id: string, name: string, currentVersion: string | null = null): string {
  const timestamp = '2026-01-01T00:00:00.000Z';
  dbModule.db
    .prepare(
      `INSERT INTO software
        (id, name, slug, category, watch_status, current_version, created_at, updated_at)
       VALUES (?, ?, ?, 'test', 'active', ?, ?, ?)`,
    )
    .run(id, name, `${id}-slug`, currentVersion, timestamp, timestamp);
  return id;
}

function addSource(id: string, softwareId: string): string {
  dbModule.db
    .prepare(
      `INSERT INTO software_source
        (id, software_id, type, label, enabled, config, created_at, updated_at)
       VALUES (?, ?, 'github_releases', 'GitHub Releases', 1, '{}', ?, ?)`,
    )
    .run(id, softwareId, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  return id;
}

function addRelease(input: {
  id: string;
  softwareId: string;
  sourceId: string;
  version: string;
  publishedAt: string | null;
  firstSeenAt?: string;
  externalId?: string;
}) {
  dbModule.db
    .prepare(
      `INSERT INTO release_record
        (id, software_id, source_id, external_id, version, channel, published_at, first_seen_at, fetched_at, raw)
       VALUES (?, ?, ?, ?, ?, 'stable', ?, ?, ?, '{}')`,
    )
    .run(
      input.id,
      input.softwareId,
      input.sourceId,
      input.externalId ?? input.id,
      input.version,
      input.publishedAt,
      input.firstSeenAt ?? input.publishedAt ?? '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    );
}

function addLifecycle(input: {
  id: string;
  softwareId: string;
  sourceId: string;
  cycle: string;
  supportStatus?: string;
}) {
  dbModule.db
    .prepare(
      `INSERT INTO lifecycle_record
        (id, software_id, source_id, cycle, release_date, latest_version, fetched_at, support_status, source_url, raw)
       VALUES (?, ?, ?, ?, '2025-01-01', ?, '2026-01-01T00:00:00.000Z', ?, 'https://endoflife.date/test', '{}')`,
    )
    .run(
      input.id,
      input.softwareId,
      input.sourceId,
      input.cycle,
      input.cycle,
      input.supportStatus ?? 'supported',
    );
}

function addAdvisory(input: {
  id: string;
  softwareId: string;
  identifier: string;
  versionImpact?: 'affected' | 'possibly_affected' | 'insufficient' | 'not_affected';
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
  publishedAt?: string | null;
  createdAt?: string;
  status?: string;
}) {
  const createdAt = input.createdAt ?? input.publishedAt ?? '2026-01-01T00:00:00.000Z';
  dbModule.db
    .prepare(
      `INSERT INTO security_advisory
        (id, software_id, identifier, title, severity, score, published_at, version_impact,
         priority, confidence, fixed_versions, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'high', 7.5, ?, ?, ?, 'high', '[]', ?, ?)`,
    )
    .run(
      input.id,
      input.softwareId,
      input.identifier,
      input.identifier,
      input.publishedAt ?? null,
      input.versionImpact ?? 'affected',
      input.priority ?? 'P0',
      createdAt,
      createdAt,
    );
  if (input.status && input.status !== 'pending') {
    dbModule.db
      .prepare(
        `INSERT INTO advisory_user_state (advisory_id, status, updated_at)
         VALUES (?, ?, ?)`,
      )
      .run(input.id, input.status, createdAt);
  }
}

function addJob(input: { id: string; softwareId: string; startedAt: string }) {
  dbModule.db
    .prepare(
      `INSERT INTO sync_job
        (id, software_id, source_type, status, trigger, started_at, finished_at, items_found, items_new)
       VALUES (?, ?, 'endoflife', 'success', 'manual', ?, ?, 1, 1)`,
    )
    .run(input.id, input.softwareId, input.startedAt, input.startedAt);
}

describe('software intelligence list ordering', () => {
  it('orders releases by effective date, natural version and record id in detail and global lists', async () => {
    const softwareId = addSoftware('release-software', 'Release Software');
    const sourceId = addSource('release-source', softwareId);
    addRelease({ id: 'rel-0004', softwareId, sourceId, version: '1.10.0', publishedAt: '2026-01-01' });
    addRelease({ id: 'rel-0002', softwareId, sourceId, version: '1.10.0', publishedAt: '2026-01-01' });
    addRelease({ id: 'rel-0003', softwareId, sourceId, version: '1.9.0', publishedAt: '2026-01-01' });
    addRelease({ id: 'rel-0001', softwareId, sourceId, version: '1.9.0', publishedAt: '2026-01-01' });
    addRelease({ id: 'rel-0005', softwareId, sourceId, version: '2.0.0', publishedAt: '2025-12-31' });

    const detail = await getJson<SoftwareDetail>(`/api/software/${softwareId}`);
    expect(detail.releases.map((item) => `${item.version}:${item.id}`)).toEqual([
      '1.10.0:rel-0002',
      '1.10.0:rel-0004',
      '1.9.0:rel-0001',
      '1.9.0:rel-0003',
      '2.0.0:rel-0005',
    ]);
    expect(detail.releases.slice(0, 4).map((item) => item.version)).toEqual([
      '1.10.0',
      '1.10.0',
      '1.9.0',
      '1.9.0',
    ]);

    const global = await getJson<Array<{ version: string; id: string }>>(
      `/api/releases?softwareId=${softwareId}`,
    );
    expect(global.map((item) => `${item.version}:${item.id}`)).toEqual(
      detail.releases.map((item) => `${item.version}:${item.id}`),
    );
    const repeat = await getJson<Array<{ version: string; id: string }>>(
      `/api/releases?softwareId=${softwareId}`,
    );
    expect(repeat.map((item) => item.id)).toEqual(global.map((item) => item.id));
  });

  it('orders lifecycle rows by current cycle, natural cycle and record id, with software groups by name', async () => {
    const alpha = addSoftware('alpha-software', 'Alpha', '1.9.5');
    const beta = addSoftware('beta-software', 'Beta', '2.0.0');
    const alphaSourceA = addSource('alpha-source-a', alpha);
    const alphaSourceB = addSource('alpha-source-b', alpha);
    const betaSource = addSource('beta-source', beta);
    addLifecycle({ id: 'alpha-19', softwareId: alpha, sourceId: alphaSourceA, cycle: '1.9' });
    addLifecycle({ id: 'alpha-110-b', softwareId: alpha, sourceId: alphaSourceB, cycle: '1.10' });
    addLifecycle({ id: 'alpha-110-a', softwareId: alpha, sourceId: alphaSourceA, cycle: '1.10' });
    addLifecycle({ id: 'alpha-18', softwareId: alpha, sourceId: alphaSourceA, cycle: '1.8' });
    addLifecycle({ id: 'beta-110', softwareId: beta, sourceId: betaSource, cycle: '1.10' });
    addLifecycle({ id: 'beta-19', softwareId: beta, sourceId: betaSource, cycle: '1.9' });

    const detail = await getJson<SoftwareDetail>(`/api/software/${alpha}`);
    expect(detail.lifecycle.map((item) => `${item.cycle}:${item.id}`)).toEqual([
      '1.9:alpha-19',
      '1.10:alpha-110-a',
      '1.10:alpha-110-b',
      '1.8:alpha-18',
    ]);

    const global = await getJson<LifecycleFeedItem[]>('/api/lifecycle');
    expect(global.map((item) => `${item.softwareName}:${item.cycle}:${item.id}`)).toEqual([
      'Alpha:1.9:alpha-19',
      'Alpha:1.10:alpha-110-a',
      'Alpha:1.10:alpha-110-b',
      'Alpha:1.8:alpha-18',
      'Beta:1.10:beta-110',
      'Beta:1.9:beta-19',
    ]);
  });

  it('orders advisories by impact, priority, time, natural identifier and record id', async () => {
    const softwareId = addSoftware('advisory-software', 'Advisory Software', '1.0.0');
    addAdvisory({ id: 'adv-6', softwareId, identifier: 'ADV-A', priority: 'P2' });
    addAdvisory({ id: 'adv-5', softwareId, identifier: 'ADV-B' });
    addAdvisory({ id: 'adv-4', softwareId, identifier: 'CVE-2026-999' });
    addAdvisory({ id: 'adv-3', softwareId, identifier: 'CVE-2026-1000' });
    addAdvisory({
      id: 'adv-2',
      softwareId,
      identifier: 'CVE-2026-2',
      versionImpact: 'possibly_affected',
      publishedAt: '2026-01-02',
    });
    addAdvisory({
      id: 'adv-1',
      softwareId,
      identifier: 'CVE-2026-3',
      versionImpact: 'insufficient',
      publishedAt: '2026-01-03',
    });
    addAdvisory({
      id: 'adv-0',
      softwareId,
      identifier: 'CVE-2026-4',
      versionImpact: 'not_affected',
      publishedAt: '2026-01-04',
    });
    addAdvisory({
      id: 'adv-fixed',
      softwareId,
      identifier: 'CVE-2026-5',
      versionImpact: 'not_affected',
      status: 'fixed',
    });

    const detail = await getJson<SoftwareDetail>(`/api/software/${softwareId}`);
    expect(detail.advisories.map((item) => item.identifier)).toEqual([
      'CVE-2026-1000',
      'CVE-2026-999',
      'ADV-B',
      'ADV-A',
      'CVE-2026-2',
      'CVE-2026-3',
      'CVE-2026-4',
      'CVE-2026-5',
    ]);
    expect(detail.advisories.slice(0, 5).map((item) => item.identifier)).toEqual([
      'CVE-2026-1000',
      'CVE-2026-999',
      'ADV-B',
      'ADV-A',
      'CVE-2026-2',
    ]);

    const global = await getJson<Advisory[]>(
      `/api/advisories?softwareId=${softwareId}&limit=300`,
    );
    expect(global.map((item) => item.identifier)).toEqual(
      detail.advisories.map((item) => item.identifier),
    );
    const open = await getJson<Advisory[]>(
      `/api/advisories?softwareId=${softwareId}&openOnly=true&limit=300`,
    );
    expect(open.map((item) => item.identifier)).toEqual(
      detail.advisories.slice(0, 7).map((item) => item.identifier),
    );
  });

  it('uses record id as the final tie-breaker for identical advisory identifiers', async () => {
    const alpha = addSoftware('same-advisory-a', 'Same Advisory A', '1.0.0');
    const beta = addSoftware('same-advisory-b', 'Same Advisory B', '1.0.0');
    addAdvisory({ id: 'same-advisory-b', softwareId: beta, identifier: 'CVE-2026-777' });
    addAdvisory({ id: 'same-advisory-a', softwareId: alpha, identifier: 'CVE-2026-777' });

    const global = await getJson<Advisory[]>(
      '/api/advisories?openOnly=true&limit=300',
    );
    expect(global.map((item) => item.id)).toEqual(['same-advisory-a', 'same-advisory-b']);
  });

  it('orders collection logs by start time and record id, and keeps the 60-row limit', async () => {
    const softwareId = addSoftware('log-software', 'Log Software', '1.0.0');
    addJob({ id: 'job-c', softwareId, startedAt: '2026-01-01T00:00:00.000Z' });
    addJob({ id: 'job-a', softwareId, startedAt: '2026-01-01T00:00:00.000Z' });
    addJob({ id: 'job-b', softwareId, startedAt: '2026-01-01T00:00:00.000Z' });
    addJob({ id: 'job-later', softwareId, startedAt: '2026-01-02T00:00:00.000Z' });

    const first = await getJson<SoftwareDetail>(`/api/software/${softwareId}`);
    expect(first.jobs.map((item) => item.id)).toEqual(['job-later', 'job-a', 'job-b', 'job-c']);
    const second = await getJson<SoftwareDetail>(`/api/software/${softwareId}`);
    expect(second.jobs.map((item) => item.id)).toEqual(first.jobs.map((item) => item.id));

    const many = addSoftware('many-logs', 'Many Logs', '1.0.0');
    for (let index = 0; index < 61; index += 1) {
      addJob({
        id: `many-job-${String(index).padStart(3, '0')}`,
        softwareId: many,
        startedAt: '2026-01-01T00:00:00.000Z',
      });
    }
    const limited = await getJson<SoftwareDetail>(`/api/software/${many}`);
    expect(limited.jobs).toHaveLength(60);
    expect(limited.jobs[0].id).toBe('many-job-000');
    expect(limited.jobs.at(-1)?.id).toBe('many-job-059');
  });

  it('keeps interface caps stable at release and advisory boundaries', async () => {
    const softwareId = addSoftware('boundary-software', 'Boundary Software', '1.0.0');
    const sourceId = addSource('boundary-source', softwareId);
    for (let index = 0; index < 201; index += 1) {
      addRelease({
        id: `boundary-release-${String(index).padStart(3, '0')}`,
        softwareId,
        sourceId,
        version: '1.0.0',
        publishedAt: '2026-01-01',
      });
    }
    for (let index = 0; index < 301; index += 1) {
      addAdvisory({
        id: `boundary-advisory-${String(index).padStart(3, '0')}`,
        softwareId,
        identifier: `CVE-2026-${String(index).padStart(4, '0')}`,
      });
    }

    const releases = await getJson<Array<{ id: string }>>(
      `/api/releases?softwareId=${softwareId}`,
    );
    expect(releases).toHaveLength(200);
    expect(releases[0].id).toBe('boundary-release-000');
    expect(releases.at(-1)?.id).toBe('boundary-release-199');

    const detail = await getJson<SoftwareDetail>(`/api/software/${softwareId}`);
    expect(detail.releases).toHaveLength(150);
    expect(detail.releases[0].id).toBe('boundary-release-000');

    const advisories = await getJson<Advisory[]>(
      `/api/advisories?softwareId=${softwareId}&limit=300`,
    );
    expect(advisories).toHaveLength(300);
    expect(advisories[0].identifier).toBe('CVE-2026-0300');
    expect(advisories.at(-1)?.identifier).toBe('CVE-2026-0001');

    const nextPage = await getJson<Advisory[]>(
      `/api/advisories?softwareId=${softwareId}&limit=300&offset=300`,
    );
    expect(nextPage).toHaveLength(1);
    expect(nextPage[0].identifier).toBe('CVE-2026-0000');
    const repeated = await getJson<Advisory[]>(
      `/api/advisories?softwareId=${softwareId}&limit=300`,
    );
    expect(repeated.map((item) => item.id)).toEqual(advisories.map((item) => item.id));
  });
});
