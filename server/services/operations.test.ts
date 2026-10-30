import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let dataDir: string;
let dbModule: typeof import('../db.js');
let store: typeof import('./operations-store.js');
let notes: typeof import('./notifications.js');
let operations: typeof import('./operations.js');

const HOUR = 3_600_000;

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR).toISOString();
}

function setSourceDataTime(sourceId: string, value: string | null): void {
  dbModule.db
    .prepare('UPDATE data_sources SET last_data_updated_at = ? WHERE id = ?')
    .run(value, sourceId);
}

function sourceIssues(sourceId: string) {
  return store.listOperationIssues().filter((issue) => issue.sourceId === sourceId);
}

function taskIssues(taskId: string) {
  return store.listOperationIssues().filter((issue) => issue.taskId === taskId);
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsite-operations-'));
  process.env.DATA_DIR = dataDir;
  process.env.PUBLIC_BASE_URL = 'https://opsite.example.com';
  dbModule = await import('../db.js');
  store = await import('./operations-store.js');
  notes = await import('./notifications.js');
  operations = await import('./operations.js');
});

afterAll(() => {
  try {
    dbModule?.db.close();
  } catch {
    // ignore close errors in cleanup
  }
  delete process.env.DATA_DIR;
  delete process.env.PUBLIC_BASE_URL;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('operations registry', () => {
  it('registers only the data sources and tasks that exist in the project', () => {
    const sources = store.listDataSources();
    expect(sources.map((source) => source.sourceKey).sort()).toEqual(
      [
        'cisa_kev',
        'discovery_cncf',
        'discovery_github',
        'endoflife',
        'github_advisories',
        'github_releases',
        'nvd',
        'upstream_advisory',
      ].sort(),
    );
    expect(new Set(sources.map((source) => source.id)).size).toBe(sources.length);

    const tasks = store.listTasks();
    expect(tasks.map((task) => task.taskKey).sort()).toEqual(
      [
        'discovery_cncf',
        'discovery_github',
        'sync_cisa_kev',
        'sync_endoflife',
        'sync_github_advisories',
        'sync_github_releases',
        'sync_nvd',
        'sync_upstream_advisory',
      ].sort(),
    );
    expect(tasks.every((task) => sources.some((source) => source.id === task.sourceId))).toBe(true);
  });

  it('uses per-source freshness windows without fabricating data update times', () => {
    const endoflife = store.getDataSource(store.getSourceByKey('endoflife')!.id)!;
    expect(endoflife.freshnessInterval).toBe(168);
    expect(endoflife.freshnessGracePeriod).toBe(48);
    expect(endoflife.lastDataUpdatedAt).toBeNull();
    expect(endoflife.freshnessStatus).toBe('unknown');

    const upstream = store.getDataSource(store.getSourceByKey('upstream_advisory')!.id)!;
    expect(upstream.enabled).toBe(false);
    expect(upstream.freshnessEnabled).toBe(false);
  });

  it('reports a suspended source as disabled instead of its last health result', () => {
    const source = store.getSourceByKey('upstream_advisory')!;
    expect(store.getDataSource(source.id)!.healthStatus).toBe('disabled');
    expect(store.listDataSources({ status: 'disabled' }).some((item) => item.id === source.id)).toBe(
      true,
    );

    const enabled = operations.updateSource(source.id, { enabled: true });
    expect(enabled.enabled).toBe(true);
    expect(enabled.healthStatus).toBe('unknown');

    const disabled = operations.updateSource(source.id, { enabled: false });
    expect(disabled.enabled).toBe(false);
    expect(disabled.healthStatus).toBe('disabled');

    store.recordCollectionFailure(source.id, { error: 'late failure', rateLimited: false });
    expect(store.getDataSource(source.id)!.healthStatus).toBe('disabled');
    expect(sourceIssues(source.id)).toHaveLength(0);
  });

  it('applies the global cron only to tasks that follow it', () => {
    const globalTask = store.getTaskByKey('sync_endoflife')!;
    const customTask = store.getTaskByKey('sync_github_releases')!;
    const untouchedTask = store.getTaskByKey('sync_nvd')!;
    operations.updateTask(customTask.id, { schedule: '5 * * * *' });
    // Saving a task form without changing the cron must not detach it from the
    // global schedule.
    operations.updateTask(untouchedTask.id, {
      enabled: untouchedTask.enabled,
      schedule: untouchedTask.schedule,
    });

    store.applyGlobalSyncSchedule('0 1 * * *');

    expect(store.getTask(globalTask.id)!.schedule).toBe('0 1 * * *');
    expect(store.getTask(customTask.id)!.schedule).toBe('5 * * * *');
    expect(store.getTask(untouchedTask.id)!.schedule).toBe('0 1 * * *');
    expect(store.getTaskByKey('discovery_github')!.schedule).not.toBe('0 1 * * *');
  });
});

describe('freshness calculation', () => {
  const now = Date.parse('2026-10-30T12:00:00.000Z');

  it('separates fresh, expiring and expired states', () => {
    expect(
      store.computeFreshness(
        {
          last_data_updated_at: new Date(now - 10 * HOUR).toISOString(),
          freshness_interval: 24,
          freshness_grace_period: 12,
          freshness_enabled: 1,
        },
        now,
      ),
    ).toEqual({ status: 'fresh', ageHours: 10 });

    expect(
      store.computeFreshness(
        {
          last_data_updated_at: new Date(now - 30 * HOUR).toISOString(),
          freshness_interval: 24,
          freshness_grace_period: 12,
          freshness_enabled: 1,
        },
        now,
      ).status,
    ).toBe('expiring');

    expect(
      store.computeFreshness(
        {
          last_data_updated_at: new Date(now - 40 * HOUR).toISOString(),
          freshness_interval: 24,
          freshness_grace_period: 12,
          freshness_enabled: 1,
        },
        now,
      ).status,
    ).toBe('expired');
  });

  it('returns unknown when no real data timestamp exists or tracking is disabled', () => {
    expect(
      store.computeFreshness({
        last_data_updated_at: null,
        freshness_interval: 24,
        freshness_grace_period: 12,
        freshness_enabled: 1,
      }),
    ).toEqual({ status: 'unknown', ageHours: null });

    expect(
      store.computeFreshness({
        last_data_updated_at: isoHoursAgo(1),
        freshness_interval: 24,
        freshness_grace_period: 12,
        freshness_enabled: 0,
      }).status,
    ).toBe('unknown');
  });
});

describe('collection outcomes', () => {
  it('does not refresh data freshness when a successful run found no changes', () => {
    const source = store.getSourceByKey('github_releases')!;
    setSourceDataTime(source.id, '2026-01-01T00:00:00.000Z');

    store.recordCollectionSuccess(source.id, {
      dataChanged: false,
      fetched: 5,
      created: 0,
      updated: 0,
    });
    let updated = store.getDataSource(source.id)!;
    expect(updated.lastDataUpdatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(updated.lastSuccessAt).not.toBeNull();
    expect(updated.healthStatus).toBe('ok');
    expect(updated.freshnessStatus).toBe('expired');

    store.recordCollectionSuccess(source.id, {
      dataChanged: true,
      fetched: 5,
      created: 1,
      updated: 1,
    });
    updated = store.getDataSource(source.id)!;
    expect(updated.lastDataUpdatedAt).not.toBe('2026-01-01T00:00:00.000Z');
    expect(Date.parse(updated.lastDataUpdatedAt!)).toBeGreaterThan(
      Date.parse('2026-01-01T00:00:00.000Z'),
    );
    expect(updated.freshnessStatus).toBe('fresh');
  });

  it('keeps data freshness and history on failure while opening one deduped alert', () => {
    const source = store.getSourceByKey('nvd')!;
    setSourceDataTime(source.id, '2026-01-01T00:00:00.000Z');

    store.recordCollectionFailure(source.id, { error: 'HTTP 500 upstream error', rateLimited: false });
    let updated = store.getDataSource(source.id)!;
    expect(updated.lastDataUpdatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(updated.healthStatus).toBe('error');
    expect(updated.consecutiveFailures).toBe(1);
    expect(updated.lastError).toContain('HTTP 500');

    store.recordCollectionFailure(source.id, { error: 'HTTP 500 again', rateLimited: false });
    updated = store.getDataSource(source.id)!;
    expect(updated.consecutiveFailures).toBe(2);
    expect(sourceIssues(source.id).filter((issue) => issue.kind === 'source_anomaly')).toHaveLength(1);

    const anomalyNotifications = notes
      .listNotifications({ limit: 200 })
      .items.filter(
        (item) =>
          item.ruleType === 'source_anomaly' &&
          item.targetType === 'source' &&
          item.targetId === source.id,
      );
    expect(anomalyNotifications).toHaveLength(1);

    store.recordCollectionSuccess(source.id, {
      dataChanged: false,
      fetched: 1,
      created: 0,
      updated: 0,
    });
    updated = store.getDataSource(source.id)!;
    expect(updated.healthStatus).toBe('ok');
    expect(updated.consecutiveFailures).toBe(0);
    expect(updated.lastDataUpdatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(sourceIssues(source.id).filter((issue) => issue.kind === 'source_anomaly')).toHaveLength(0);
  });

  it('records a rate-limit alert separately from a source anomaly', () => {
    const source = store.getSourceByKey('github_advisories')!;
    store.recordCollectionFailure(source.id, { error: 'API rate limit exceeded', rateLimited: true });
    const issues = sourceIssues(source.id);
    expect(issues.some((issue) => issue.kind === 'rate_limit')).toBe(true);
    expect(issues.some((issue) => issue.kind === 'source_anomaly')).toBe(false);

    store.recordCollectionSuccess(source.id, {
      dataChanged: false,
      fetched: 0,
      created: 0,
      updated: 0,
    });
    expect(sourceIssues(source.id).some((issue) => issue.kind === 'rate_limit')).toBe(false);
  });
});

describe('alert lifecycle', () => {
  it('opens one alert per incident, resolves it, and increments the cycle on recurrence', () => {
    const key = 'test:lifecycle';
    const first = store.openOperationAlert({
      key,
      kind: 'task_failure',
      sourceId: null,
      taskId: null,
      severity: 'important',
      title: '测试任务失败',
      body: 'first',
    });
    expect(first?.cycle).toBe(1);
    expect(
      store.openOperationAlert({
        key,
        kind: 'task_failure',
        sourceId: null,
        taskId: null,
        severity: 'important',
        title: '测试任务失败',
        body: 'still failing',
      }),
    ).toBeNull();

    store.resolveOperationAlert(key, false);
    const reopened = store.openOperationAlert({
      key,
      kind: 'task_failure',
      sourceId: null,
      taskId: null,
      severity: 'important',
      title: '测试任务失败',
      body: 'again',
    });
    expect(reopened?.cycle).toBe(2);
    expect(reopened?.status).toBe('open');
  });

  it('notifies task recovery with a rule type that cannot be deduped across cycles', () => {
    const task = store.getTaskByKey('sync_nvd')!;
    const source = store.getSourceByKey('nvd')!;

    store.openTaskAlert(task.id, source.id, { timeout: false, error: 'collector crashed' });
    expect(taskIssues(task.id).some((issue) => issue.kind === 'task_failure')).toBe(true);

    const before = notes.listNotifications({ limit: 200 }).items.length;
    store.resolveTaskAlerts(task.id);
    expect(taskIssues(task.id)).toHaveLength(0);

    const after = notes.listNotifications({ limit: 200 }).items;
    expect(after.length).toBe(before + 1);
    const recovery = after.find((item) => item.ruleType === 'task_recovered');
    expect(recovery?.targetType).toBe('task');
    expect(recovery?.targetId).toBe(task.id);
  });
});

describe('restart recovery', () => {
  it('marks lingering running runs as interrupted instead of leaving them running', () => {
    const task = store.getTaskByKey('sync_endoflife')!;
    const source = store.getSourceByKey('endoflife')!;
    const run = store.startRun(task.id, source.id, 'scheduled');
    expect(run.status).toBe('running');

    expect(store.recoverInterruptedRuns()).toBeGreaterThanOrEqual(1);

    const recovered = store.getRun(run.id)!;
    expect(recovered.status).toBe('timeout');
    expect(recovered.errorCode).toBe('interrupted');
    expect(recovered.errorMessage).toContain('服务重启');
    expect(recovered.finishedAt).not.toBeNull();
    expect(taskIssues(task.id).some((issue) => issue.kind === 'task_timeout')).toBe(true);
  });
});
