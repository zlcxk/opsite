import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RawLifecycle } from '../adapters/types.js';

const mocks = vi.hoisted(() => ({ fetchEndOfLife: vi.fn() }));

vi.mock('../adapters/endoflife.js', () => ({
  fetchEndOfLife: mocks.fetchEndOfLife,
}));

let dataDir: string;
let dbModule: typeof import('../db.js');
let sync: typeof import('./sync.js');

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsite-lifecycle-sync-'));
  process.env.DATA_DIR = dataDir;
  dbModule = await import('../db.js');
  sync = await import('./sync.js');
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

beforeEach(() => {
  dbModule.db.prepare('DELETE FROM software').run();
  mocks.fetchEndOfLife.mockReset();
});

function addSoftware(name: string, currentVersion: string, product: string) {
  const softwareId = crypto.randomUUID();
  const sourceId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  dbModule.db
    .prepare(
      `INSERT INTO software
        (id, name, slug, category, watch_status, current_version, created_at, updated_at)
       VALUES (?, ?, ?, 'test', 'active', ?, ?, ?)`,
    )
    .run(softwareId, name, `${name.toLowerCase()}-${softwareId.slice(0, 8)}`, currentVersion, timestamp, timestamp);
  dbModule.db
    .prepare(
      `INSERT INTO software_source
        (id, software_id, type, label, enabled, config, created_at, updated_at)
       VALUES (?, ?, 'endoflife', 'endoflife.date', 1, ?, ?, ?)`,
    )
    .run(sourceId, softwareId, JSON.stringify({ product }), timestamp, timestamp);
  return { softwareId, sourceId };
}

function rawLifecycle(overrides: Partial<RawLifecycle> = {}): RawLifecycle {
  return {
    cycle: '4.4',
    releaseDate: '2026-10-13',
    latestVersion: '4.4.0',
    latestReleaseDate: '2026-10-13',
    eolDate: null,
    activeSupportEnd: null,
    maintenanceSupportEnd: null,
    vendorSupportEnd: '2028-10-27',
    supportStatus: 'supported',
    sourceUrl: 'https://endoflife.date/apache-kafka',
    warnings: [],
    raw: { release: { name: '4.4', eolsFrom: '2028-10-27' } },
    ...overrides,
  };
}

function lifecycleRows(softwareId: string) {
  return dbModule.db
    .prepare('SELECT * FROM lifecycle_record WHERE software_id = ? ORDER BY cycle')
    .all(softwareId) as Array<Record<string, unknown>>;
}

describe('lifecycle synchronization', () => {
  it('stores semantic support fields separately', async () => {
    const { softwareId } = addSoftware('Kafka', '4.4.0', 'apache-kafka');
    mocks.fetchEndOfLife.mockResolvedValue({
      lifecycle: [rawLifecycle()],
      itemCount: 1,
    });

    const result = await sync.syncSoftware(softwareId, { trigger: 'manual' });

    expect(result.ok).toBe(true);
    const [row] = lifecycleRows(softwareId);
    expect(row.eol_date).toBeNull();
    expect(row.vendor_support_end).toBe('2028-10-27');
    expect(row.support_status).toBe('supported');
    expect(row.parse_warnings).toBeNull();
    expect(
      dbModule.db
        .prepare('SELECT COUNT(*) AS count FROM intelligence_event WHERE software_id = ?')
        .get(softwareId),
    ).toEqual({ count: 0 });
  });

  it('is idempotent when the same payload is synchronized twice', async () => {
    const { softwareId } = addSoftware('Kafka', '4.4.0', 'apache-kafka');
    mocks.fetchEndOfLife.mockResolvedValue({
      lifecycle: [rawLifecycle()],
      itemCount: 1,
    });

    await sync.syncSoftware(softwareId, { trigger: 'manual' });
    const second = await sync.syncSoftware(softwareId, { trigger: 'manual' });

    expect(second.ok).toBe(true);
    expect(second.jobs[0]).toMatchObject({
      status: 'success',
      itemsNew: 0,
      itemsUpdated: 0,
      dataChanged: false,
    });
    expect(lifecycleRows(softwareId)).toHaveLength(1);
  });

  it('does not overwrite valid rows when the upstream request fails', async () => {
    const { softwareId } = addSoftware('Kafka', '4.4.0', 'apache-kafka');
    mocks.fetchEndOfLife.mockResolvedValue({
      lifecycle: [rawLifecycle()],
      itemCount: 1,
    });
    await sync.syncSoftware(softwareId, { trigger: 'manual' });
    const before = lifecycleRows(softwareId)[0];

    mocks.fetchEndOfLife.mockRejectedValue(new Error('upstream timeout'));
    const failed = await sync.syncSoftware(softwareId, { trigger: 'manual' });

    expect(failed.ok).toBe(false);
    expect(failed.jobs[0]).toMatchObject({ status: 'error', error: 'upstream timeout' });
    expect(lifecycleRows(softwareId)).toHaveLength(1);
    expect(lifecycleRows(softwareId)[0]).toMatchObject({
      eol_date: before.eol_date,
      vendor_support_end: before.vendor_support_end,
      support_status: before.support_status,
      fetched_at: before.fetched_at,
    });
  });

  it('isolates one software failure from the rest of the batch', async () => {
    const failing = addSoftware('Kubernetes', '1.37.2', 'kubernetes');
    const succeeding = addSoftware('Kafka', '4.4.0', 'apache-kafka');
    mocks.fetchEndOfLife.mockImplementation(async (context: { config: { product?: string } }) => {
      if (context.config.product === 'kubernetes') throw new Error('parse failed');
      return { lifecycle: [rawLifecycle()], itemCount: 1 };
    });

    const result = await sync.syncAllActive('manual');

    expect(result).toEqual({ total: 2, succeeded: 1, failed: 1 });
    expect(lifecycleRows(failing.softwareId)).toHaveLength(0);
    expect(lifecycleRows(succeeding.softwareId)).toHaveLength(1);
  });

  it('persists parse warnings without mapping them into lifecycle dates', async () => {
    const { softwareId } = addSoftware('Kafka', '4.4.0', 'apache-kafka');
    mocks.fetchEndOfLife.mockResolvedValue({
      lifecycle: [
        rawLifecycle({
          eolDate: null,
          vendorSupportEnd: null,
          supportStatus: 'unknown',
          warnings: ['4.4.eolFrom: 不是有效日期，已留空（原始值："not-a-date"）'],
        }),
      ],
      itemCount: 1,
    });

    await sync.syncSoftware(softwareId, { trigger: 'manual' });

    const [row] = lifecycleRows(softwareId);
    expect(row.eol_date).toBeNull();
    expect(row.support_status).toBe('unknown');
    expect(JSON.parse(String(row.parse_warnings))).toHaveLength(1);
  });
});
