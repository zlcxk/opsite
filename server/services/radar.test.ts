import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

let dataDir: string;
let dbModule: typeof import('../db.js');
let radar: typeof import('./notes.js');

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsite-radar-'));
  const legacy = new Database(path.join(dataDir, 'opsite.db'));
  legacy.exec(`
    CREATE TABLE radar_item (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'tool',
      url TEXT,
      created_at TEXT NOT NULL
    );
    INSERT INTO radar_item (id, title, summary, kind, url, created_at)
    VALUES ('legacy-item', '旧条目', '迁移前数据', 'tool', NULL, '2026-01-01T00:00:00.000Z');
  `);
  legacy.close();

  process.env.DATA_DIR = dataDir;
  dbModule = await import('../db.js');
  radar = await import('./notes.js');
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

function create(title: string, kind: 'tool' | 'tech' | 'learning' = 'tool') {
  return radar.createRadar({ title, summary: `${title} 的关注原因`, kind });
}

describe('radar storage', () => {
  it('migrates an existing database and backfills defaults', () => {
    const legacy = radar.listRadar().find((item) => item.id === 'legacy-item');
    expect(legacy).toBeDefined();
    expect(legacy?.status).toBe('pending');
    expect(legacy?.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(legacy?.archivedAt).toBeNull();
    expect(legacy?.lastEvaluatedAt).toBeNull();
    expect(legacy?.latestRecord).toBeNull();
  });

  it('creates new items in pending state', () => {
    const item = create('OpenTelemetry');
    expect(item.status).toBe('pending');
    expect(item.archivedAt).toBeNull();
    expect(item.updatedAt).toBeTruthy();
  });

  it('updates an item in place without creating duplicates', () => {
    const item = create('Grafana Tempo');
    const before = radar.listRadar().length;
    const updated = radar.updateRadar(item.id, {
      title: 'Grafana Tempo（追踪）',
      summary: '重新整理关注原因。',
      kind: 'tech',
      url: 'https://grafana.com/oss/tempo/',
    });
    expect(updated?.id).toBe(item.id);
    expect(updated?.title).toBe('Grafana Tempo（追踪）');
    expect(updated?.kind).toBe('tech');
    expect(radar.listRadar().length).toBe(before);
    expect(radar.listRadar({ q: 'Grafana Tempo' })).toHaveLength(1);
  });

  it('persists status changes and records them once', () => {
    const item = create('Cilium Gateway API');
    const updated = radar.setRadarStatus(item.id, 'trialing');
    expect(updated?.status).toBe('trialing');

    const detail = radar.getRadarDetail(item.id);
    expect(detail?.records).toHaveLength(1);
    expect(detail?.records[0].recordType).toBe('status_change');
    expect(detail?.records[0].content).toContain('试用中');

    radar.setRadarStatus(item.id, 'trialing');
    expect(radar.listRadarRecords(item.id)).toHaveLength(1);
    expect(radar.getRadarItem(item.id)?.status).toBe('trialing');
  });

  it('adds evaluation records and updates the latest summary and next action', () => {
    const item = create('Temporal');
    const record = radar.createRadarRecord(item.id, {
      recordType: 'trial',
      content: '在测试环境验证了工作流编排。',
      nextAction: '评估生产集群是否迁移。',
    });
    expect(record?.content).toContain('工作流编排');

    const detail = radar.getRadarDetail(item.id);
    expect(detail?.records[0].nextAction).toBe('评估生产集群是否迁移。');
    expect(detail?.item.lastEvaluatedAt).toBeTruthy();
    expect(detail?.item.latestRecord?.id).toBe(record?.id);

    radar.createRadarRecord(item.id, {
      recordType: 'note',
      content: '补充一条备注。',
    });
    expect(radar.getRadarItem(item.id)?.latestRecord?.content).toBe('补充一条备注。');
  });

  it('filters by kind, status, keyword, archive state and sorts by evaluation', () => {
    const evaluated = create('Argo Rollouts', 'tech');
    radar.setRadarStatus(evaluated.id, 'trialing');
    radar.createRadarRecord(evaluated.id, { recordType: 'trial', content: '灰度发布验证通过。' });
    const notEvaluated = create('Backstage', 'tech');

    const techItems = radar.listRadar({ kind: 'tech' });
    expect(techItems.map((item) => item.id)).toEqual(expect.arrayContaining([evaluated.id, notEvaluated.id]));

    const trialing = radar.listRadar({ status: 'trialing' });
    expect(trialing.every((item) => item.status === 'trialing')).toBe(true);

    const searched = radar.listRadar({ q: 'Argo Rollouts' });
    expect(searched.map((item) => item.id)).toEqual([evaluated.id]);

    const byEvaluation = radar.listRadar({ sort: 'evaluated' });
    expect(byEvaluation.at(-1)?.lastEvaluatedAt ?? null).toBeNull();

    radar.setRadarArchived(notEvaluated.id, true);
    expect(radar.listRadar().some((item) => item.id === notEvaluated.id)).toBe(false);
    expect(radar.listRadar({ includeArchived: true }).some((item) => item.id === notEvaluated.id)).toBe(true);
    expect(radar.listRadar({ archivedOnly: true }).map((item) => item.id)).toContain(notEvaluated.id);
  });

  it('archives and restores without losing status or records', () => {
    const item = create('Flux CD');
    radar.setRadarStatus(item.id, 'adopted');
    radar.createRadarRecord(item.id, { recordType: 'adoption', content: '已用于两个集群。' });

    const archived = radar.setRadarArchived(item.id, true);
    expect(archived?.archivedAt).toBeTruthy();
    expect(radar.listRadarRecords(item.id)).toHaveLength(2);

    const restored = radar.setRadarArchived(item.id, false);
    expect(restored?.archivedAt).toBeNull();
    expect(restored?.status).toBe('adopted');
    expect(radar.getRadarDetail(item.id)?.records).toHaveLength(2);
  });

  it('deletes records together with the item and rejects unknown ids', () => {
    const item = create('To be removed');
    radar.createRadarRecord(item.id, { recordType: 'note', content: '临时记录。' });

    expect(radar.deleteRadar(item.id)).toBe(true);
    expect(radar.getRadarDetail(item.id)).toBeNull();
    const count = dbModule.db
      .prepare('SELECT COUNT(*) AS count FROM radar_record WHERE radar_item_id = ?')
      .get(item.id) as { count: number };
    expect(count.count).toBe(0);

    expect(radar.setRadarStatus('missing', 'trialing')).toBeNull();
    expect(radar.setRadarArchived('missing', true)).toBeNull();
    expect(radar.createRadarRecord('missing', { recordType: 'note', content: 'x' })).toBeNull();
    expect(radar.deleteRadar('missing')).toBe(false);
  });
});
