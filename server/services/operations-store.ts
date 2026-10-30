import type {
  CollectionRun,
  CollectionRunStatus,
  CollectionTask,
  CollectionTrigger,
  DataSource,
  DataSourceType,
  FreshnessStatus,
  OperationIssue,
  OperationIssueKind,
  SourceHealthCheck,
  SourceHealthStatus,
  SourceQuotaRecord,
} from '../../shared/types.js';
import { db, nowIso } from '../db.js';
import { dispatchOperationNotification } from './notifications.js';

interface SourceRow {
  id: string;
  source_key: string;
  name: string;
  type: DataSourceType;
  description: string | null;
  official_url: string | null;
  enabled: number;
  health_status: SourceHealthStatus;
  last_check_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_data_updated_at: string | null;
  freshness_interval: number;
  freshness_grace_period: number;
  freshness_enabled: number;
  consecutive_failures: number;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  task_key: string;
  name: string;
  source_id: string;
  description: string | null;
  schedule: string;
  enabled: number;
  timeout_seconds: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
  source_name?: string;
  source_key?: string;
}

interface RunRow {
  id: string;
  task_id: string;
  source_id: string;
  trigger_type: CollectionTrigger;
  status: CollectionRunStatus;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  fetched_count: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  task_name?: string;
  task_key?: string;
  source_name?: string;
  source_key?: string;
}

interface QuotaRow {
  id: string;
  source_id: string;
  quota_limit: number | null;
  quota_remaining: number | null;
  quota_used: number | null;
  reset_at: string | null;
  rate_limited: number;
  recorded_at: string;
}

export interface AlertRow {
  id: string;
  alert_key: string;
  kind: OperationIssueKind;
  source_id: string | null;
  task_id: string | null;
  severity: 'urgent' | 'important' | 'normal';
  title: string;
  body: string | null;
  status: 'open' | 'resolved';
  cycle: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

const RUN_SELECT = `
  SELECT r.*, t.name AS task_name, t.task_key,
         s.name AS source_name, s.source_key
  FROM collection_runs r
  JOIN collection_tasks t ON t.id = r.task_id
  JOIN data_sources s ON s.id = r.source_id`;

const SOURCE_ORDER = `ORDER BY CASE s.type WHEN 'lifecycle' THEN 0 WHEN 'release' THEN 1
  WHEN 'security' THEN 2 ELSE 3 END, s.name`;

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function safeTime(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function computeFreshness(
  source: Pick<
    SourceRow,
    'last_data_updated_at' | 'freshness_interval' | 'freshness_grace_period' | 'freshness_enabled'
  >,
  now = Date.now(),
): { status: FreshnessStatus; ageHours: number | null } {
  const updated = safeTime(source.last_data_updated_at);
  if (!source.freshness_enabled || updated === null || source.freshness_interval <= 0) {
    return {
      status: 'unknown',
      ageHours: updated === null ? null : Math.max(0, (now - updated) / 3_600_000),
    };
  }
  const ageHours = Math.max(0, (now - updated) / 3_600_000);
  if (ageHours <= source.freshness_interval) return { status: 'fresh', ageHours };
  if (ageHours <= source.freshness_interval + Math.max(0, source.freshness_grace_period)) {
    return { status: 'expiring', ageHours };
  }
  return { status: 'expired', ageHours };
}

export function mapQuota(row: QuotaRow | undefined): SourceQuotaRecord | null {
  if (!row) return null;
  return {
    id: row.id,
    sourceId: row.source_id,
    quotaLimit: row.quota_limit,
    quotaRemaining: row.quota_remaining,
    quotaUsed: row.quota_used,
    resetAt: row.reset_at,
    rateLimited: Boolean(row.rate_limited),
    recordedAt: row.recorded_at,
  };
}

export function mapRun(row: RunRow): CollectionRun {
  return {
    id: row.id,
    taskId: row.task_id,
    taskName: row.task_name ?? '',
    taskKey: row.task_key ?? '',
    sourceId: row.source_id,
    sourceName: row.source_name ?? '',
    sourceKey: row.source_key ?? '',
    triggerType: row.trigger_type,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    fetchedCount: row.fetched_count,
    createdCount: row.created_count,
    updatedCount: row.updated_count,
    skippedCount: row.skipped_count,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

function latestQuota(sourceId: string): SourceQuotaRecord | null {
  const row = db
    .prepare('SELECT * FROM source_quota_records WHERE source_id = ? ORDER BY recorded_at DESC LIMIT 1')
    .get(sourceId) as QuotaRow | undefined;
  return mapQuota(row);
}

function latestRun(sourceId?: string, taskId?: string): CollectionRun | null {
  const clauses: string[] = [];
  const params: string[] = [];
  if (sourceId) {
    clauses.push('r.source_id = ?');
    params.push(sourceId);
  }
  if (taskId) {
    clauses.push('r.task_id = ?');
    params.push(taskId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const row = db
    .prepare(`${RUN_SELECT} ${where} ORDER BY r.started_at DESC, r.rowid DESC LIMIT 1`)
    .get(...params) as RunRow | undefined;
  return row ? mapRun(row) : null;
}

export function mapSource(row: SourceRow): DataSource {
  const freshness = computeFreshness(row);
  return {
    id: row.id,
    sourceKey: row.source_key,
    name: row.name,
    type: row.type,
    description: row.description,
    officialUrl: row.official_url,
    enabled: Boolean(row.enabled),
    healthStatus: row.health_status,
    lastCheckAt: row.last_check_at,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    lastDataUpdatedAt: row.last_data_updated_at,
    freshnessInterval: row.freshness_interval,
    freshnessGracePeriod: row.freshness_grace_period,
    freshnessEnabled: Boolean(row.freshness_enabled),
    freshnessStatus: freshness.status,
    freshnessAgeHours: freshness.ageHours,
    consecutiveFailures: row.consecutive_failures,
    lastError: row.last_error,
    lastErrorAt: row.last_error_at,
    lastQuota: latestQuota(row.id),
    lastRun: latestRun(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getSourceRow(id: string): SourceRow | null {
  return (
    (db.prepare('SELECT * FROM data_sources WHERE id = ?').get(id) as SourceRow | undefined) ??
    null
  );
}

export function getSourceByKey(key: string): SourceRow | null {
  return (
    (db.prepare('SELECT * FROM data_sources WHERE source_key = ?').get(key) as SourceRow | undefined) ??
    null
  );
}

export function getDataSource(id: string): DataSource | null {
  const row = getSourceRow(id);
  return row ? mapSource(row) : null;
}

export function listDataSources(options: {
  type?: DataSourceType;
  status?: SourceHealthStatus;
  q?: string;
} = {}): DataSource[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.type) {
    clauses.push('s.type = ?');
    params.push(options.type);
  }
  if (options.status) {
    clauses.push('s.health_status = ?');
    params.push(options.status);
  }
  if (options.q) {
    clauses.push('(s.name LIKE ? OR s.source_key LIKE ? OR COALESCE(s.description, \'\') LIKE ?)');
    const q = `%${options.q}%`;
    params.push(q, q, q);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT s.* FROM data_sources s ${where} ${SOURCE_ORDER}`)
    .all(...params) as SourceRow[];
  return rows.map(mapSource);
}

export function sourceSummary(): DataSourceSummaryCounts {
  const rows = db
    .prepare('SELECT health_status, COUNT(*) AS count FROM data_sources GROUP BY health_status')
    .all() as Array<{ health_status: SourceHealthStatus; count: number }>;
  const counts = { ok: 0, error: 0, rate_limited: 0, unknown: 0, disabled: 0 };
  for (const row of rows) {
    if (row.health_status in counts) counts[row.health_status] = row.count;
  }
  return {
    total: Object.values(counts).reduce((sum, value) => sum + value, 0),
    healthy: counts.ok,
    error: counts.error,
    rateLimited: counts.rate_limited,
    unknown: counts.unknown,
    disabled: counts.disabled,
  };
}

export interface DataSourceSummaryCounts {
  total: number;
  healthy: number;
  error: number;
  rateLimited: number;
  unknown: number;
  disabled: number;
}

export function listHealthChecks(sourceId: string, limit = 30): SourceHealthCheck[] {
  const rows = db
    .prepare(
      `SELECT * FROM source_health_checks WHERE source_id = ?
       ORDER BY checked_at DESC, rowid DESC LIMIT ?`,
    )
    .all(sourceId, Math.max(1, Math.min(limit, 100))) as Array<{
    id: string;
    source_id: string;
    status: SourceHealthCheck['status'];
    response_time_ms: number | null;
    http_status: number | null;
    error_message: string | null;
    checked_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    status: row.status,
    responseTimeMs: row.response_time_ms,
    httpStatus: row.http_status,
    errorMessage: row.error_message,
    checkedAt: row.checked_at,
  }));
}

export function listQuotaRecords(sourceId: string, limit = 20): SourceQuotaRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM source_quota_records WHERE source_id = ?
       ORDER BY recorded_at DESC, rowid DESC LIMIT ?`,
    )
    .all(sourceId, Math.max(1, Math.min(limit, 100))) as QuotaRow[];
  return rows.map((row) => mapQuota(row)!);
}

export function listRuns(options: {
  taskId?: string;
  sourceId?: string;
  status?: CollectionRunStatus;
  limit?: number;
  offset?: number;
} = {}): { items: CollectionRun[]; total: number } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.taskId) {
    clauses.push('r.task_id = ?');
    params.push(options.taskId);
  }
  if (options.sourceId) {
    clauses.push('r.source_id = ?');
    params.push(options.sourceId);
  }
  if (options.status) {
    clauses.push('r.status = ?');
    params.push(options.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const offset = Math.max(0, options.offset ?? 0);
  const total = (
    db.prepare(`SELECT COUNT(*) AS count FROM collection_runs r ${where}`).get(...params) as {
      count: number;
    }
  ).count;
  const rows = db
    .prepare(`${RUN_SELECT} ${where} ORDER BY r.started_at DESC, r.rowid DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as RunRow[];
  return { items: rows.map(mapRun), total };
}

export function getRun(id: string): CollectionRun | null {
  const row = db.prepare(`${RUN_SELECT} WHERE r.id = ?`).get(id) as RunRow | undefined;
  return row ? mapRun(row) : null;
}

export function getRunRow(id: string): RunRow | null {
  return (db.prepare('SELECT * FROM collection_runs WHERE id = ?').get(id) as RunRow | undefined) ?? null;
}

export function getTaskRow(id: string): TaskRow | null {
  return (db.prepare('SELECT * FROM collection_tasks WHERE id = ?').get(id) as TaskRow | undefined) ?? null;
}

function taskRunStats(taskId: string): { successRate: number | null; avgDurationMs: number | null } {
  const rows = db
    .prepare(
      `SELECT status, duration_ms FROM collection_runs WHERE task_id = ?
       ORDER BY started_at DESC, rowid DESC LIMIT 20`,
    )
    .all(taskId) as Array<{ status: CollectionRunStatus; duration_ms: number | null }>;
  const finished = rows.filter((row) => row.status !== 'running');
  const success = finished.filter((row) => row.status === 'success').length;
  const durations = finished
    .map((row) => row.duration_ms)
    .filter((value): value is number => typeof value === 'number');
  return {
    successRate: finished.length ? Math.round((success / finished.length) * 1000) / 10 : null,
    avgDurationMs: durations.length
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : null,
  };
}

export function mapTask(row: TaskRow): CollectionTask {
  const stats = taskRunStats(row.id);
  const lastRun = latestRun(undefined, row.id);
  return {
    id: row.id,
    taskKey: row.task_key,
    name: row.name,
    sourceId: row.source_id,
    sourceName: row.source_name ?? '',
    sourceKey: row.source_key ?? '',
    description: row.description,
    schedule: row.schedule,
    enabled: Boolean(row.enabled),
    timeoutSeconds: row.timeout_seconds,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    lastRun,
    lastStatus: lastRun?.status ?? 'never',
    successRate: stats.successRate,
    avgDurationMs: stats.avgDurationMs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TASK_SELECT = `
  SELECT t.*, s.name AS source_name, s.source_key AS source_key
  FROM collection_tasks t JOIN data_sources s ON s.id = t.source_id`;

export function getTask(id: string): CollectionTask | null {
  const row = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id) as TaskRow | undefined;
  return row ? mapTask(row) : null;
}

export function listTasks(): CollectionTask[] {
  const rows = db
    .prepare(
      `${TASK_SELECT}
       ORDER BY CASE s.type WHEN 'lifecycle' THEN 0 WHEN 'release' THEN 1
       WHEN 'security' THEN 2 ELSE 3 END, t.name`,
    )
    .all() as TaskRow[];
  return rows.map(mapTask);
}

export function listTasksForSource(sourceId: string): CollectionTask[] {
  const rows = db
    .prepare(`${TASK_SELECT} WHERE t.source_id = ? ORDER BY t.name`)
    .all(sourceId) as TaskRow[];
  return rows.map(mapTask);
}

export function updateTaskNextRun(taskId: string, nextRunAt: string | null): void {
  db.prepare('UPDATE collection_tasks SET next_run_at = ?, updated_at = ? WHERE id = ?').run(
    nextRunAt,
    nowIso(),
    taskId,
  );
}

export function getTaskByKey(key: string): CollectionTask | null {
  const row = db.prepare(`${TASK_SELECT} WHERE t.task_key = ?`).get(key) as TaskRow | undefined;
  return row ? mapTask(row) : null;
}

/**
 * Applies the legacy global collection cron to tasks that still follow it.
 * A task whose cron was edited individually keeps its custom schedule.
 */
export function applyGlobalSyncSchedule(schedule: string): number {
  const result = db
    .prepare(
      `UPDATE collection_tasks SET schedule = ?, next_run_at = NULL, updated_at = ?
       WHERE schedule_custom = 0
         AND source_id IN (SELECT id FROM data_sources WHERE type != 'discovery')`,
    )
    .run(schedule, nowIso());
  return result.changes;
}

export function startRun(taskId: string, sourceId: string, trigger: CollectionTrigger): CollectionRun {
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO collection_runs
      (id, task_id, source_id, trigger_type, status, started_at, created_at)
     VALUES (?, ?, ?, ?, 'running', ?, ?)`,
  ).run(id, taskId, sourceId, trigger, timestamp, timestamp);
  db.prepare('UPDATE collection_tasks SET last_run_at = ?, updated_at = ? WHERE id = ?').run(
    timestamp,
    timestamp,
    taskId,
  );
  return getRun(id)!;
}

export function finishRun(
  id: string,
  input: {
    status: Exclude<CollectionRunStatus, 'running'>;
    fetched: number;
    created: number;
    updated: number;
    skipped: number;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
): CollectionRun | null {
  const row = getRunRow(id);
  if (!row) return null;
  const finishedAt = nowIso();
  const started = safeTime(row.started_at);
  const durationMs = started === null ? null : Math.max(0, Date.now() - started);
  db.prepare(
    `UPDATE collection_runs SET status = ?, finished_at = ?, duration_ms = ?,
       fetched_count = ?, created_count = ?, updated_count = ?, skipped_count = ?,
       error_code = ?, error_message = ?
     WHERE id = ?`,
  ).run(
    input.status,
    finishedAt,
    durationMs,
    input.fetched,
    input.created,
    input.updated,
    input.skipped,
    input.errorCode ?? null,
    input.errorMessage?.slice(0, 1000) ?? null,
    id,
  );
  return getRun(id);
}

export function recordHealthCheck(
  sourceId: string,
  input: {
    status: SourceHealthCheck['status'];
    responseTimeMs: number | null;
    httpStatus: number | null;
    errorMessage: string | null;
  },
): SourceHealthCheck {
  const id = crypto.randomUUID();
  const checkedAt = nowIso();
  db.prepare(
    `INSERT INTO source_health_checks
      (id, source_id, status, response_time_ms, http_status, error_message, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    sourceId,
    input.status,
    input.responseTimeMs,
    input.httpStatus,
    input.errorMessage?.slice(0, 500) ?? null,
    checkedAt,
  );
  const health: SourceHealthStatus =
    input.status === 'ok'
      ? 'ok'
      : input.status === 'rate_limited'
        ? 'rate_limited'
        : input.status === 'unknown'
          ? 'unknown'
          : 'error';
  db.prepare(
    `UPDATE data_sources SET health_status = ?, last_check_at = ?,
       last_failure_at = CASE WHEN ? = 'error' OR ? = 'rate_limited' THEN ? ELSE last_failure_at END,
       last_error = CASE WHEN ? = 'ok' OR ? = 'unknown' THEN NULL ELSE ? END,
       last_error_at = CASE WHEN ? = 'ok' OR ? = 'unknown' THEN last_error_at ELSE ? END,
       updated_at = ?
     WHERE id = ?`,
  ).run(
    health,
    checkedAt,
    input.status,
    input.status,
    checkedAt,
    input.status,
    input.status,
    input.errorMessage?.slice(0, 500) ?? null,
    input.status,
    input.status,
    checkedAt,
    checkedAt,
    sourceId,
  );
  return {
    id,
    sourceId,
    status: input.status,
    responseTimeMs: input.responseTimeMs,
    httpStatus: input.httpStatus,
    errorMessage: input.errorMessage,
    checkedAt,
  };
}

export function recordQuota(
  sourceId: string,
  input: {
    limit: number | null;
    remaining: number | null;
    used: number | null;
    resetAt: string | null;
    rateLimited: boolean;
  },
): SourceQuotaRecord {
  const id = crypto.randomUUID();
  const recordedAt = nowIso();
  db.prepare(
    `INSERT INTO source_quota_records
      (id, source_id, quota_limit, quota_remaining, quota_used, reset_at, rate_limited, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    sourceId,
    input.limit,
    input.remaining,
    input.used,
    input.resetAt,
    input.rateLimited ? 1 : 0,
    recordedAt,
  );
  return {
    id,
    sourceId,
    quotaLimit: input.limit,
    quotaRemaining: input.remaining,
    quotaUsed: input.used,
    resetAt: input.resetAt,
    rateLimited: input.rateLimited,
    recordedAt,
  };
}

function updateSourceAfterCollection(
  sourceId: string,
  input: { ok: boolean; dataChanged: boolean; error: string | null; rateLimited: boolean },
): void {
  const timestamp = nowIso();
  db.prepare(
    `UPDATE data_sources SET
       enabled = enabled,
       health_status = CASE WHEN enabled = 0 THEN 'disabled' WHEN ? THEN 'ok' ELSE ? END,
       last_success_at = CASE WHEN ? THEN ? ELSE last_success_at END,
       last_failure_at = CASE WHEN ? THEN last_failure_at ELSE ? END,
       last_data_updated_at = CASE WHEN ? THEN ? ELSE last_data_updated_at END,
       consecutive_failures = CASE WHEN ? THEN 0 ELSE consecutive_failures + 1 END,
       last_error = CASE WHEN ? THEN NULL ELSE ? END,
       last_error_at = CASE WHEN ? THEN last_error_at ELSE ? END,
       updated_at = ?
     WHERE id = ?`,
  ).run(
    input.ok ? 1 : 0,
    input.rateLimited ? 'rate_limited' : 'error',
    input.ok ? 1 : 0,
    timestamp,
    input.ok ? 0 : 1,
    timestamp,
    input.ok && input.dataChanged ? 1 : 0,
    timestamp,
    input.ok ? 1 : 0,
    input.ok ? 1 : 0,
    input.error?.slice(0, 500) ?? null,
    input.ok ? 1 : 0,
    timestamp,
    timestamp,
    sourceId,
  );
}

function alertTarget(alert: Pick<AlertRow, 'source_id' | 'task_id'>): {
  targetType: 'source' | 'task';
  targetId: string;
  link: string;
} | null {
  if (alert.task_id) {
    return {
      targetType: 'task',
      targetId: alert.task_id,
      link: `/operations/tasks/${alert.task_id}`,
    };
  }
  if (alert.source_id) {
    return {
      targetType: 'source',
      targetId: alert.source_id,
      link: `/operations/sources/${alert.source_id}`,
    };
  }
  return null;
}

function notifyAlertOpened(alert: AlertRow): void {
  const target = alertTarget(alert);
  if (!target) return;
  const name = alert.task_id
    ? (
        db.prepare('SELECT name FROM collection_tasks WHERE id = ?').get(alert.task_id) as
          | { name: string }
          | undefined
      )?.name
    : (
        db.prepare('SELECT name FROM data_sources WHERE id = ?').get(alert.source_id) as
          | { name: string }
          | undefined
      )?.name;
  dispatchOperationNotification({
    ruleType: alert.kind === 'scheduler' ? 'source_anomaly' : alert.kind,
    severity: alert.severity,
    title: alert.title,
    body: alert.body,
    targetType: target.targetType,
    targetId: target.targetId,
    targetName: name ?? alert.title,
    link: target.link,
    dedupeKey: `operation:${alert.alert_key}:cycle:${alert.cycle}`,
  });
}

export function openOperationAlert(input: {
  key: string;
  kind: OperationIssueKind;
  sourceId: string | null;
  taskId: string | null;
  severity: 'urgent' | 'important' | 'normal';
  title: string;
  body: string | null;
}): AlertRow | null {
  const existing = db
    .prepare('SELECT * FROM operation_alerts WHERE alert_key = ?')
    .get(input.key) as AlertRow | undefined;
  const timestamp = nowIso();

  if (existing?.status === 'open') {
    db.prepare(
      `UPDATE operation_alerts SET severity = ?, title = ?, body = ?, last_seen_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(input.severity, input.title, input.body, timestamp, timestamp, existing.id);
    return null;
  }

  if (existing) {
    const cycle = existing.cycle + 1;
    db.prepare(
      `UPDATE operation_alerts SET kind = ?, source_id = ?, task_id = ?, severity = ?, title = ?,
         body = ?, status = 'open', cycle = ?, first_seen_at = ?, last_seen_at = ?,
         resolved_at = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.kind,
      input.sourceId,
      input.taskId,
      input.severity,
      input.title,
      input.body,
      cycle,
      timestamp,
      timestamp,
      timestamp,
      existing.id,
    );
    const row = db.prepare('SELECT * FROM operation_alerts WHERE id = ?').get(existing.id) as AlertRow;
    notifyAlertOpened(row);
    return row;
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO operation_alerts
      (id, alert_key, kind, source_id, task_id, severity, title, body, status, cycle,
       first_seen_at, last_seen_at, resolved_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', 1, ?, ?, NULL, ?, ?)`,
  ).run(
    id,
    input.key,
    input.kind,
    input.sourceId,
    input.taskId,
    input.severity,
    input.title,
    input.body,
    timestamp,
    timestamp,
    timestamp,
    timestamp,
  );
  const row = db.prepare('SELECT * FROM operation_alerts WHERE id = ?').get(id) as AlertRow;
  notifyAlertOpened(row);
  return row;
}

export function resolveOperationAlert(key: string, notifyRecovery = true): AlertRow | null {
  const existing = db
    .prepare('SELECT * FROM operation_alerts WHERE alert_key = ?')
    .get(key) as AlertRow | undefined;
  if (!existing || existing.status !== 'open') return null;
  const timestamp = nowIso();
  db.prepare(
    `UPDATE operation_alerts SET status = 'resolved', resolved_at = ?, last_seen_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(timestamp, timestamp, timestamp, existing.id);
  const row = db.prepare('SELECT * FROM operation_alerts WHERE id = ?').get(existing.id) as AlertRow;

  if (notifyRecovery && (row.kind === 'task_failure' || row.kind === 'task_timeout') && row.task_id) {
    const task = db.prepare('SELECT name FROM collection_tasks WHERE id = ?').get(row.task_id) as
      | { name: string }
      | undefined;
    dispatchOperationNotification({
      ruleType: 'task_recovered',
      severity: 'normal',
      title: `${task?.name ?? '采集任务'}已恢复`,
      body: '任务最近一次执行成功，异常已解除。',
      targetType: 'task',
      targetId: row.task_id,
      targetName: task?.name ?? '采集任务',
      link: `/operations/tasks/${row.task_id}`,
      dedupeKey: `operation:${row.alert_key}:recovered:${row.cycle}`,
    });
  }
  return row;
}

export function recordCollectionSuccess(
  sourceId: string,
  input: { dataChanged: boolean; fetched: number; created: number; updated: number },
): void {
  const source = getSourceRow(sourceId);
  if (!source) return;
  updateSourceAfterCollection(sourceId, {
    ok: true,
    dataChanged: input.dataChanged,
    error: null,
    rateLimited: false,
  });
  resolveOperationAlert(`source_anomaly:${sourceId}`);
  resolveOperationAlert(`rate_limit:${sourceId}`, false);
  void input;
  refreshStaleAlerts();
}

export function recordCollectionFailure(
  sourceId: string,
  input: { error: string; rateLimited: boolean },
): void {
  const source = getSourceRow(sourceId);
  if (!source) return;
  updateSourceAfterCollection(sourceId, {
    ok: false,
    dataChanged: false,
    error: input.error,
    rateLimited: input.rateLimited,
  });
  const detail = input.error.slice(0, 300);
  // A source that was suspended while its run was in flight must stay quiet:
  // updateSource() resolved its alerts, and the run result must not reopen them.
  if (source.enabled) {
    if (input.rateLimited) {
      openOperationAlert({
        key: `rate_limit:${sourceId}`,
        kind: 'rate_limit',
        sourceId,
        taskId: null,
        severity: 'important',
        title: `${source.name} 触发限流`,
        body: detail,
      });
    } else {
      openOperationAlert({
        key: `source_anomaly:${sourceId}`,
        kind: 'source_anomaly',
        sourceId,
        taskId: null,
        severity: 'important',
        title: `${source.name} 采集异常`,
        body: detail,
      });
    }
  }
  refreshStaleAlerts();
}

export function openTaskAlert(
  taskId: string,
  sourceId: string,
  input: { timeout: boolean; error: string },
): void {
  const task = getTaskRow(taskId);
  if (!task) return;
  openOperationAlert({
    key: `${input.timeout ? 'task_timeout' : 'task_failure'}:${taskId}`,
    kind: input.timeout ? 'task_timeout' : 'task_failure',
    sourceId,
    taskId,
    severity: input.timeout ? 'urgent' : 'important',
    title: `${task.name}${input.timeout ? '执行超时' : '执行失败'}`,
    body: input.error.slice(0, 300),
  });
}

export function resolveTaskAlerts(taskId: string): void {
  resolveOperationAlert(`task_failure:${taskId}`);
  resolveOperationAlert(`task_timeout:${taskId}`);
}

export function refreshStaleAlerts(): AlertRow[] {
  const opened: AlertRow[] = [];
  const rows = db.prepare('SELECT * FROM data_sources').all() as SourceRow[];
  for (const row of rows) {
    const freshness = computeFreshness(row);
    if (freshness.status !== 'expired' || !row.enabled) {
      resolveOperationAlert(`data_stale:${row.id}`, false);
      continue;
    }
    const age = freshness.ageHours ?? 0;
    const alert = openOperationAlert({
      key: `data_stale:${row.id}`,
      kind: 'data_stale',
      sourceId: row.id,
      taskId: null,
      severity: 'important',
      title: `${row.name} 数据已过期`,
      body: `距上次实际数据更新已 ${Math.floor(age)} 小时，超过 ${row.freshness_interval} 小时采集周期。`,
    });
    if (alert) opened.push(alert);
  }
  return opened;
}

export function listOperationIssues(kind?: OperationIssueKind): OperationIssue[] {
  const params: unknown[] = [];
  let where = "WHERE a.status = 'open'";
  if (kind) {
    where += ' AND a.kind = ?';
    params.push(kind);
  }
  const rows = db
    .prepare(
      `SELECT a.*, s.name AS source_name, t.name AS task_name
       FROM operation_alerts a
       LEFT JOIN data_sources s ON s.id = a.source_id
       LEFT JOIN collection_tasks t ON t.id = a.task_id
       ${where}
       ORDER BY CASE a.severity WHEN 'urgent' THEN 0 WHEN 'important' THEN 1 ELSE 2 END,
                a.last_seen_at DESC`,
    )
    .all(...params) as Array<
    AlertRow & { source_name: string | null; task_name: string | null }
  >;
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    title: row.title,
    description: row.body ?? '',
    sourceId: row.source_id,
    sourceName: row.source_name,
    taskId: row.task_id,
    taskName: row.task_name,
    link: row.task_id
      ? `/operations/tasks/${row.task_id}`
      : row.source_id
        ? `/operations/sources/${row.source_id}`
        : null,
    occurredAt: row.last_seen_at,
  }));
}

export function issueCounts(): Record<OperationIssueKind, number> {
  const rows = db
    .prepare("SELECT kind, COUNT(*) AS count FROM operation_alerts WHERE status = 'open' GROUP BY kind")
    .all() as Array<{ kind: OperationIssueKind; count: number }>;
  const counts: Record<OperationIssueKind, number> = {
    source_anomaly: 0,
    rate_limit: 0,
    task_failure: 0,
    task_timeout: 0,
    data_stale: 0,
    scheduler: 0,
  };
  for (const row of rows) counts[row.kind] = row.count;
  return counts;
}

export function startOfZonedDayIso(now = new Date()): string {
  const timeZone = process.env.NOTIFICATION_TIMEZONE || 'Asia/Shanghai';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  const offset = asUtc - now.getTime();
  return new Date(
    Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)) - offset,
  ).toISOString();
}

export function getRunDetails(runId: string): Array<{
  id: string;
  label: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  itemsFound: number;
  itemsNew: number;
  itemsUpdated: number;
  itemsSkipped: number;
  error: string | null;
}> {
  const run = getRun(runId);
  if (!run) return [];
  if (run.sourceKey.startsWith('discovery_')) {
    const sourceType = run.sourceKey.slice('discovery_'.length);
    const rows = db
      .prepare('SELECT * FROM discovery_job WHERE run_id = ? ORDER BY started_at')
      .all(runId) as Array<{
      id: string;
      source_type: string;
      status: string;
      started_at: string;
      finished_at: string | null;
      items_found: number;
      items_new: number;
      items_updated: number;
      items_skipped: number;
      items_duplicate: number;
      error_summary: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      label: `${row.source_type === sourceType ? '发现来源' : row.source_type} · ${row.source_type}`,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      itemsFound: row.items_found,
      itemsNew: row.items_new,
      itemsUpdated: row.items_updated,
      itemsSkipped: row.items_skipped + row.items_duplicate,
      error: row.error_summary,
    }));
  }

  const rows = db
    .prepare(
      `SELECT j.*, s.name AS software_name, ss.label AS source_label
       FROM sync_job j JOIN software s ON s.id = j.software_id
       LEFT JOIN software_source ss ON ss.id = j.source_id
       WHERE j.run_id = ? ORDER BY j.started_at, j.rowid`,
    )
    .all(runId) as Array<{
    id: string;
    software_name: string;
    source_label: string | null;
    status: string;
    started_at: string;
    finished_at: string | null;
    items_found: number;
    items_new: number;
    items_updated: number;
    items_skipped: number;
    error: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    label: `${row.software_name} · ${row.source_label ?? '数据源'}`,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    itemsFound: number(row.items_found),
    itemsNew: number(row.items_new),
    itemsUpdated: number(row.items_updated),
    itemsSkipped: number(row.items_skipped),
    error: row.error,
  }));
}

export function recoverInterruptedRuns(): number {
  const timestamp = nowIso();
  const rows = db
    .prepare("SELECT * FROM collection_runs WHERE status = 'running'")
    .all() as RunRow[];
  for (const row of rows) {
    const started = safeTime(row.started_at);
    db.prepare(
      `UPDATE collection_runs SET status = 'timeout', finished_at = ?,
         duration_ms = ?, error_code = 'interrupted',
         error_message = '服务重启，采集任务被中断'
       WHERE id = ?`,
    ).run(
      timestamp,
      started === null ? null : Math.max(0, Date.now() - started),
      row.id,
    );
    openTaskAlert(row.task_id, row.source_id, {
      timeout: true,
      error: '服务重启，采集任务被中断',
    });
  }
  db.prepare(
    `UPDATE sync_job SET status = 'error', finished_at = ?,
       error = COALESCE(error, '服务重启，采集任务被中断')
     WHERE status = 'running'`,
  ).run(timestamp);
  db.prepare(
    `UPDATE discovery_job SET status = 'error', finished_at = ?,
       error_summary = COALESCE(error_summary, '服务重启，采集任务被中断')
     WHERE status = 'running'`,
  ).run(timestamp);
  return rows.length;
}
