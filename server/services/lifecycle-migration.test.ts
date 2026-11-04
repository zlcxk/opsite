import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

let dataDir: string;
let dbModule: typeof import('../db.js');

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsite-lifecycle-migration-'));
  const legacy = new Database(path.join(dataDir, 'opsite.db'));
  legacy.pragma('foreign_keys = OFF');
  legacy.exec(`
    CREATE TABLE lifecycle_record (
      id TEXT PRIMARY KEY,
      software_id TEXT NOT NULL,
      source_id TEXT,
      cycle TEXT NOT NULL,
      release_date TEXT,
      latest_version TEXT,
      latest_release_date TEXT,
      eol_date TEXT,
      eol_raw TEXT,
      support_status TEXT NOT NULL DEFAULT 'unknown',
      source_url TEXT,
      fetched_at TEXT NOT NULL,
      raw TEXT,
      UNIQUE(software_id, source_id, cycle)
    );
    INSERT INTO lifecycle_record
      (id, software_id, source_id, cycle, release_date, latest_version, latest_release_date,
       eol_date, eol_raw, support_status, source_url, fetched_at, raw)
    VALUES
      ('legacy-row', 'legacy-software', NULL, '1.0', '2026-01-01', '1.0.1', '2026-02-01',
       '2027-01-01', NULL, 'supported', 'https://endoflife.date/legacy', '2026-10-01T00:00:00.000Z', '{}');
  `);
  legacy.close();

  process.env.DATA_DIR = dataDir;
  dbModule = await import('../db.js');
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

describe('lifecycle schema migration', () => {
  it('adds semantic columns without rewriting existing lifecycle rows', () => {
    const columns = dbModule.db.prepare('PRAGMA table_info(lifecycle_record)').all() as Array<{
      name: string;
    }>;
    const names = columns.map((column) => column.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'active_support_end',
        'maintenance_support_end',
        'vendor_support_end',
        'parse_warnings',
      ]),
    );

    const row = dbModule.db
      .prepare('SELECT * FROM lifecycle_record WHERE id = ?')
      .get('legacy-row') as Record<string, unknown>;
    expect(row).toMatchObject({
      software_id: 'legacy-software',
      cycle: '1.0',
      release_date: '2026-01-01',
      latest_version: '1.0.1',
      eol_date: '2027-01-01',
      support_status: 'supported',
      fetched_at: '2026-10-01T00:00:00.000Z',
      active_support_end: null,
      maintenance_support_end: null,
      vendor_support_end: null,
      parse_warnings: null,
    });
  });
});
