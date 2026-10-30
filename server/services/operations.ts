import type {
  CollectionRun,
  CollectionRunStatus,
  CollectionTask,
  CollectionTrigger,
  DataSource,
  DiscoveryJobStatus,
  DiscoverySourceType,
  FreshnessResponse,
  FreshnessStatus,
  OperationIssueKind,
  OperationsOverview,
  OperationsStats,
  SourceHealthCheck,
  SourceType,
} from '../../shared/types.js';
import { db, nowIso } from '../db.js';
import { HttpError } from '../lib/http.js';
import { sourceDefinitionByKey, type DataSourceDefinition } from './operations-config.js';
import {
  computeFreshness,
  finishRun,
  getRun,
  getRunDetails,
  getSourceRow,
  getDataSource,
  getTask,
  getTaskRow,
  issueCounts,
  listDataSources,
  listHealthChecks,
  listOperationIssues,
  listQuotaRecords,
  listRuns,
  openOperationAlert,
  openTaskAlert,
  recordCollectionFailure,
  recordCollectionSuccess,
  recordHealthCheck,
  recordQuota,
  refreshStaleAlerts,
  resolveOperationAlert,
  resolveTaskAlerts,
  startOfZonedDayIso,
  startRun,
} from './operations-store.js';
import { runDiscovery } from './discovery.js';
import { syncSoftware } from './sync.js';

interface ProbeQuota {
  limit: number | null;
  remaining: number | null;
  used: number | null;
  resetAt: string | null;
}

export interface ProbeResult {
  status: SourceHealthCheck['status'];
  httpStatus: number | null;
  responseTimeMs: number | null;
  errorMessage: string | null;
  rateLimited: boolean;
  quota: ProbeQuota | null;
}

export class OperationsRequestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'OperationsRequestError';
    this.status = status;
  }
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer ***')
    .replace(/(api[_-]?key|token|authorization)=([^&\s]+)/gi, '$1=***')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 500);
}

function isRateLimit(error: unknown): boolean {
  if (error instanceof HttpError && error.status === 429) return true;
  const message = sanitizeError(error);
  return /(429|rate.?limit|速率|限流|too many requests)/i.test(message);
}

function githubHeaders(accept = 'application/vnd.github+json'): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

function githubQuota(headers: Headers): ProbeQuota | null {
  const limit = Number(headers.get('x-ratelimit-limit'));
  const remaining = Number(headers.get('x-ratelimit-remaining'));
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return null;
  return {
    limit,
    remaining,
    used: Math.max(0, limit - remaining),
    resetAt: Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : null,
  };
}

async function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body is not needed for a reachability probe.
  }
}

async function probeGithub(): Promise<ProbeResult> {
  const startedAt = Date.now();
  const response = await timedFetch('https://api.github.com/rate_limit', {
    headers: githubHeaders(),
  }, 15_000);
  const responseTimeMs = Date.now() - startedAt;
  const quotaFromHeaders = githubQuota(response.headers);
  if (!response.ok) {
    await discardBody(response);
    const rateLimited = response.status === 429 || response.status === 403;
    return {
      status: rateLimited ? 'rate_limited' : 'error',
      httpStatus: response.status,
      responseTimeMs,
      errorMessage: response.status === 403
        ? 'GitHub 拒绝访问，可能是 Token 无效或速率限制'
        : `GitHub 健康检查返回 HTTP ${response.status}`,
      rateLimited,
      quota: quotaFromHeaders,
    };
  }
  const payload = (await response.json()) as {
    resources?: { core?: { limit?: number; remaining?: number; used?: number; reset?: number } };
  };
  const core = payload.resources?.core;
  const quota: ProbeQuota | null = core && typeof core.limit === 'number' && typeof core.remaining === 'number'
    ? {
        limit: core.limit,
        remaining: core.remaining,
        used: typeof core.used === 'number' ? core.used : Math.max(0, core.limit - core.remaining),
        resetAt: typeof core.reset === 'number' ? new Date(core.reset * 1000).toISOString() : null,
      }
    : quotaFromHeaders;
  const remaining = quota?.remaining ?? null;
  const rateLimited = remaining !== null && remaining <= 0;
  return {
    status: rateLimited ? 'rate_limited' : 'ok',
    httpStatus: response.status,
    responseTimeMs,
    errorMessage: rateLimited ? 'GitHub API 配额已用尽' : null,
    rateLimited,
    quota,
  };
}

async function probeEndoflife(): Promise<ProbeResult> {
  const startedAt = Date.now();
  const response = await timedFetch('https://endoflife.date/api/nodejs.json', {
    headers: { Accept: 'application/json' },
  }, 15_000);
  const responseTimeMs = Date.now() - startedAt;
  await discardBody(response);
  return {
    status: response.ok ? 'ok' : 'error',
    httpStatus: response.status,
    responseTimeMs,
    errorMessage: response.ok ? null : `endoflife.date 返回 HTTP ${response.status}`,
    rateLimited: response.status === 429,
    quota: null,
  };
}

async function probeNvd(): Promise<ProbeResult> {
  const startedAt = Date.now();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.NVD_API_KEY) headers.apiKey = process.env.NVD_API_KEY;
  const response = await timedFetch(
    'https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=1',
    { headers },
    20_000,
  );
  const responseTimeMs = Date.now() - startedAt;
  await discardBody(response);
  const rateLimited = response.status === 429 || response.status === 403;
  return {
    status: response.ok ? 'ok' : rateLimited ? 'rate_limited' : 'error',
    httpStatus: response.status,
    responseTimeMs,
    errorMessage: response.ok
      ? null
      : response.status === 403
        ? 'NVD 拒绝访问，可能是速率限制或 API Key 无效'
        : `NVD 返回 HTTP ${response.status}`,
    rateLimited,
    quota: null,
  };
}

async function probeCisa(): Promise<ProbeResult> {
  const startedAt = Date.now();
  const response = await timedFetch(
    'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
    { headers: { Accept: 'application/json' } },
    20_000,
  );
  const responseTimeMs = Date.now() - startedAt;
  await discardBody(response);
  return {
    status: response.ok ? 'ok' : response.status === 429 ? 'rate_limited' : 'error',
    httpStatus: response.status,
    responseTimeMs,
    errorMessage: response.ok ? null : `CISA KEV 返回 HTTP ${response.status}`,
    rateLimited: response.status === 429,
    quota: null,
  };
}

async function probeCncf(): Promise<ProbeResult> {
  const startedAt = Date.now();
  const response = await timedFetch(
    'https://api.github.com/repos/cncf/landscape/contents/landscape.yml?ref=master',
    {
      headers: githubHeaders('application/vnd.github.raw+json'),
    },
    20_000,
  );
  const responseTimeMs = Date.now() - startedAt;
  const quota = githubQuota(response.headers);
  await discardBody(response);
  const rateLimited = response.status === 429 || (quota?.remaining ?? 1) <= 0;
  return {
    status: response.ok ? (rateLimited ? 'rate_limited' : 'ok') : rateLimited ? 'rate_limited' : 'error',
    httpStatus: response.status,
    responseTimeMs,
    errorMessage: response.ok
      ? rateLimited
        ? 'GitHub API 配额已用尽'
        : null
      : `CNCF Landscape 返回 HTTP ${response.status}`,
    rateLimited,
    quota,
  };
}

async function probeSource(definition: DataSourceDefinition): Promise<ProbeResult> {
  try {
    switch (definition.probe) {
      case 'github':
        return await probeGithub();
      case 'endoflife':
        return await probeEndoflife();
      case 'nvd':
        return await probeNvd();
      case 'cisa':
        return await probeCisa();
      case 'cncf':
        return await probeCncf();
      default:
        return {
          status: 'unknown',
          httpStatus: null,
          responseTimeMs: null,
          errorMessage: '该数据源尚未提供健康检查接口',
          rateLimited: false,
          quota: null,
        };
    }
  } catch (error) {
    return {
      status: isRateLimit(error) ? 'rate_limited' : 'error',
      httpStatus: null,
      responseTimeMs: null,
      errorMessage: sanitizeError(error),
      rateLimited: isRateLimit(error),
      quota: null,
    };
  }
}

export async function checkSource(sourceId: string): Promise<{
  source: DataSource;
  check: SourceHealthCheck;
  quota: ReturnType<typeof recordQuota> | null;
}> {
  const source = getSourceRow(sourceId);
  if (!source) throw new OperationsRequestError('数据源不存在', 404);
  const definition = sourceDefinitionByKey(source.source_key);
  if (!definition) throw new OperationsRequestError('数据源缺少适配器定义', 409);
  if (!source.enabled) throw new OperationsRequestError('数据源已停用，请先启用后再检查', 409);

  const result = await probeSource(definition);
  const check = recordHealthCheck(sourceId, {
    status: result.status,
    responseTimeMs: result.responseTimeMs,
    httpStatus: result.httpStatus,
    errorMessage: result.errorMessage,
  });
  const quota = result.quota ? recordQuota(sourceId, { ...result.quota, rateLimited: result.rateLimited }) : null;

  if (result.status === 'ok') {
    resolveOperationAlert(`source_anomaly:${sourceId}`);
    resolveOperationAlert(`rate_limit:${sourceId}`, false);
  } else if (result.status === 'rate_limited') {
    openOperationAlert({
      key: `rate_limit:${sourceId}`,
      kind: 'rate_limit',
      sourceId,
      taskId: null,
      severity: 'important',
      title: `${source.name} 触发限流`,
      body: result.errorMessage ?? 'API 配额不足或请求被限流',
    });
  } else if (result.status === 'error') {
    openOperationAlert({
      key: `source_anomaly:${sourceId}`,
      kind: 'source_anomaly',
      sourceId,
      taskId: null,
      severity: 'important',
      title: `${source.name} 健康检查失败`,
      body: result.errorMessage ?? '健康检查请求失败',
    });
  }
  refreshStaleAlerts();
  return { source: getDataSource(sourceId)!, check, quota };
}

interface TaskOutcome {
  status: 'success' | 'failed';
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  dataChanged: boolean;
  error: string | null;
  rateLimited: boolean;
}

function triggerForSync(trigger: CollectionTrigger): 'manual' | 'schedule' {
  return trigger === 'scheduled' ? 'schedule' : 'manual';
}

function softwareTargets(type: SourceType): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT s.id FROM software s
       JOIN software_source ss ON ss.software_id = s.id
       WHERE ss.type = ? AND ss.enabled = 1
         AND s.deleted_at IS NULL AND s.watch_status = 'active'
       ORDER BY s.created_at`,
    )
    .all(type) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

async function executeSoftwareTask(
  definition: DataSourceDefinition,
  trigger: CollectionTrigger,
  runId: string,
): Promise<TaskOutcome> {
  if (!definition.adapterType) throw new Error('数据源缺少软件适配器类型');
  const type = definition.adapterType;
  const softwareIds = softwareTargets(type);
  let fetched = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let rateLimited = false;
  let dataChanged = false;
  const errors: string[] = [];

  for (const softwareId of softwareIds) {
    const result = await syncSoftware(softwareId, {
      trigger: triggerForSync(trigger),
      sourceTypes: [type],
      runId,
    });
    for (const job of result.jobs) {
      fetched += job.itemsFound;
      created += job.itemsNew;
      updated += job.itemsUpdated;
      skipped += job.itemsSkipped;
      dataChanged ||= job.dataChanged;
      if (job.status === 'error') {
        failed += 1;
        if (job.error) {
          errors.push(`${job.softwareName ?? softwareId}：${job.error}`);
          if (/(429|rate.?limit|速率|限流|too many requests)/i.test(job.error)) rateLimited = true;
        }
      }
    }
    if (result.busy) {
      failed += 1;
      errors.push(`${softwareId}：该软件正在同步中`);
    } else if (result.jobs.length === 0 && result.error) {
      failed += 1;
      errors.push(result.error);
    }
  }

  return {
    status: failed === 0 ? 'success' : 'failed',
    fetched,
    created,
    updated,
    skipped,
    dataChanged,
    error: failed === 0 ? null : errors.slice(0, 2).join('；').slice(0, 800) || '采集失败',
    rateLimited,
  };
}

function outcomeFromDiscoveryJob(status: DiscoveryJobStatus): 'success' | 'failed' {
  return status === 'success' ? 'success' : 'failed';
}

async function executeDiscoveryTask(
  definition: DataSourceDefinition,
  trigger: CollectionTrigger,
  runId: string,
): Promise<TaskOutcome> {
  if (!definition.discoveryType) throw new Error('数据源缺少发现适配器类型');
  const type: DiscoverySourceType = definition.discoveryType;
  const result = await runDiscovery({
    trigger: trigger === 'scheduled' ? 'schedule' : 'manual',
    sourceTypes: [type],
    runId,
  });
  const rows = db
    .prepare('SELECT * FROM discovery_job WHERE run_id = ? ORDER BY started_at')
    .all(runId) as Array<{
    status: DiscoveryJobStatus;
  }>;
  let fetched = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const job of result.jobs) {
    fetched += job.itemsFound;
    created += job.itemsNew;
    updated += job.itemsUpdated;
    skipped += job.itemsSkipped + job.itemsDuplicate;
  }
  const failedJobs = rows.filter((job) => outcomeFromDiscoveryJob(job.status) === 'failed');
  const errors = result.jobs
    .filter((job) => job.status !== 'success' && job.errorSummary)
    .map((job) => job.errorSummary!)
    .slice(0, 2);
  const rateLimited = errors.some((message) => /(429|rate.?limit|速率|限流|too many requests)/i.test(message));
  return {
    status: failedJobs.length === 0 && result.failed === 0 ? 'success' : 'failed',
    fetched,
    created,
    updated,
    skipped,
    dataChanged: created + updated > 0,
    error:
      failedJobs.length === 0 && result.failed === 0
        ? null
        : errors.join('；').slice(0, 800) || '技术发现采集失败',
    rateLimited,
  };
}

async function executeTask(
  task: NonNullable<ReturnType<typeof getTaskRow>>,
  source: NonNullable<ReturnType<typeof getSourceRow>>,
  definition: DataSourceDefinition,
  trigger: CollectionTrigger,
  runId: string,
  isCancelled: () => boolean = () => false,
): Promise<TaskOutcome> {
  const outcome =
    definition.group === 'discovery'
      ? await executeDiscoveryTask(definition, trigger, runId)
      : await executeSoftwareTask(definition, trigger, runId);

  // A timed-out run was already closed and reported. Do not let late-arriving
  // adapter results rewrite the source health or data freshness afterwards.
  if (isCancelled()) return outcome;

  if (outcome.status === 'success') {
    recordCollectionSuccess(source.id, {
      dataChanged: outcome.dataChanged,
      fetched: outcome.fetched,
      created: outcome.created,
      updated: outcome.updated,
    });
    resolveTaskAlerts(task.id);
  } else {
    recordCollectionFailure(source.id, {
      error: outcome.error ?? '采集失败',
      rateLimited: outcome.rateLimited,
    });
    openTaskAlert(task.id, source.id, {
      timeout: false,
      error: outcome.error ?? '采集失败',
    });
  }
  return outcome;
}

let activeRun: { taskId: string; runId: string } | null = null;

export function isCollectionRunning(): boolean {
  return activeRun !== null;
}

export function getRunningTask(): { taskId: string; runId: string } | null {
  return activeRun ? { ...activeRun } : null;
}

async function performRun(
  taskId: string,
  sourceId: string,
  definition: DataSourceDefinition,
  trigger: CollectionTrigger,
  runId: string,
  timeoutSeconds: number,
): Promise<void> {
  const task = getTaskRow(taskId);
  const source = getSourceRow(sourceId);
  if (!task || !source) return;

  let timedOut = false;
  const work = executeTask(task, source, definition, trigger, runId, () => timedOut);
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timer = new Promise<'timeout'>((resolve) => {
    timeoutHandle = setTimeout(() => resolve('timeout'), Math.max(10, timeoutSeconds) * 1000);
    timeoutHandle.unref?.();
  });

  try {
    const result = await Promise.race([
      work.then((outcome) => ({ kind: 'done' as const, outcome })),
      timer.then(() => ({ kind: 'timeout' as const })),
    ]);
    if (result.kind === 'timeout') {
      timedOut = true;
      finishRun(runId, {
        status: 'timeout',
        fetched: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errorCode: 'timeout',
        errorMessage: `任务执行超过 ${timeoutSeconds} 秒，已标记为超时`,
      });
      openTaskAlert(taskId, sourceId, {
        timeout: true,
        error: `任务执行超过 ${timeoutSeconds} 秒`,
      });
      recordCollectionFailure(sourceId, {
        error: `任务执行超过 ${timeoutSeconds} 秒`,
        rateLimited: false,
      });
      // Keep the in-process lock until the underlying work settles. The database
      // run is already closed, but a second run must not overlap.
      try {
        await work;
      } catch {
        // executeTask records failures in the database; nothing else to do.
      }
      return;
    }

    const outcome = result.outcome;
    finishRun(runId, {
      status: outcome.status,
      fetched: outcome.fetched,
      created: outcome.created,
      updated: outcome.updated,
      skipped: outcome.skipped,
      errorCode: outcome.status === 'failed' ? (outcome.rateLimited ? 'rate_limited' : 'collection_failed') : null,
      errorMessage: outcome.error,
    });
  } catch (error) {
    const message = sanitizeError(error);
    finishRun(runId, {
      status: 'failed',
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errorCode: 'internal_error',
      errorMessage: message,
    });
    recordCollectionFailure(sourceId, { error: message, rateLimited: isRateLimit(error) });
    openTaskAlert(taskId, sourceId, { timeout: false, error: message });
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function releaseRun(runId: string): void {
  if (activeRun?.runId === runId) activeRun = null;
}

export function startTaskRun(
  taskId: string,
  trigger: CollectionTrigger,
): { started: boolean; run?: CollectionRun; reason?: string } {
  const task = getTask(taskId);
  if (!task) return { started: false, reason: '采集任务不存在' };
  if (!task.enabled) return { started: false, reason: '任务已暂停，请先恢复任务' };
  const source = getSourceRow(task.sourceId);
  if (!source) return { started: false, reason: '数据源不存在' };
  if (!source.enabled) return { started: false, reason: '数据源已停用，请先启用数据源' };
  const definition = sourceDefinitionByKey(source.source_key);
  if (!definition) return { started: false, reason: '数据源缺少适配器定义' };
  if (activeRun) {
    return {
      started: false,
      reason: activeRun.taskId === taskId ? '该任务正在执行中，请勿重复触发' : '已有采集任务正在运行，请稍后再试',
    };
  }

  const run = startRun(taskId, source.id, trigger);
  activeRun = { taskId, runId: run.id };
  void performRun(
    taskId,
    source.id,
    definition,
    trigger,
    run.id,
    task.timeoutSeconds,
  )
    .catch((error) => {
      console.error('[operations] task run failed:', sanitizeError(error));
    })
    .finally(() => releaseRun(run.id));

  return { started: true, run };
}

export function retryRun(runId: string): { started: boolean; run?: CollectionRun; reason?: string } {
  const run = getRun(runId);
  if (!run) return { started: false, reason: '执行记录不存在' };
  if (run.status === 'running') return { started: false, reason: '该执行仍在进行中' };
  if (run.status === 'success') return { started: false, reason: '成功的执行无需重试' };
  return startTaskRun(run.taskId, 'retry');
}

function operationsStats(): OperationsStats {
  const summary = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN enabled = 1 AND health_status = 'ok' THEN 1 ELSE 0 END) AS healthy,
         SUM(CASE WHEN enabled = 1 AND health_status IN ('error', 'rate_limited') THEN 1 ELSE 0 END) AS abnormal
       FROM data_sources`,
    )
    .get() as { total: number; healthy: number | null; abnormal: number | null };
  const todayStart = startOfZonedDayIso();
  const runs = db
    .prepare(
      `SELECT status, COUNT(*) AS count FROM collection_runs
       WHERE started_at >= ? GROUP BY status`,
    )
    .all(todayStart) as Array<{ status: CollectionRunStatus; count: number }>;
  const todayRuns = runs.reduce((sum, row) => sum + row.count, 0);
  const completed = runs
    .filter((row) => row.status !== 'running')
    .reduce((sum, row) => sum + row.count, 0);
  const succeeded = runs.find((row) => row.status === 'success')?.count ?? 0;
  const openIssues = (
    db.prepare("SELECT COUNT(*) AS count FROM operation_alerts WHERE status = 'open'").get() as {
      count: number;
    }
  ).count;
  return {
    totalSources: summary.total,
    healthySources: summary.healthy ?? 0,
    abnormalSources: summary.abnormal ?? 0,
    todayRuns,
    successRate: completed ? Math.round((succeeded / completed) * 1000) / 10 : null,
    openIssues,
  };
}

export function getOperationsOverview(scheduler: {
  enabled: boolean;
  nextRunAt: string | null;
}): OperationsOverview {
  refreshStaleAlerts();
  return {
    stats: operationsStats(),
    scheduler: {
      ...scheduler,
      runningTasks: activeRun ? 1 : 0,
    },
    sources: listDataSources(),
    runs: listRuns({ limit: 8 }).items,
    issues: listOperationIssues().slice(0, 8),
  };
}

export function getIssues(kind?: OperationIssueKind): {
  items: ReturnType<typeof listOperationIssues>;
  counts: Record<OperationIssueKind, number>;
} {
  refreshStaleAlerts();
  return { items: listOperationIssues(kind), counts: issueCounts() };
}

export function getFreshness(): FreshnessResponse {
  refreshStaleAlerts();
  const sources = listDataSources();
  const items = sources.map((source) => ({
    sourceId: source.id,
    sourceName: source.name,
    status: source.freshnessStatus,
    lastDataUpdatedAt: source.lastDataUpdatedAt,
    ageHours: source.freshnessAgeHours,
    intervalHours: source.freshnessInterval,
    graceHours: source.freshnessGracePeriod,
    enabled: source.enabled && source.freshnessEnabled,
  }));
  const summary: Record<FreshnessStatus, number> = {
    fresh: 0,
    expiring: 0,
    expired: 0,
    unknown: 0,
  };
  for (const item of items) summary[item.status] += 1;
  return { items, summary };
}

export function getSourceDetail(sourceId: string): {
  source: DataSource;
  checks: SourceHealthCheck[];
  quotas: ReturnType<typeof listQuotaRecords>;
  runs: CollectionRun[];
  tasks: CollectionTask[];
} {
  const source = getDataSource(sourceId);
  if (!source) throw new OperationsRequestError('数据源不存在', 404);
  return {
    source,
    checks: listHealthChecks(sourceId),
    quotas: listQuotaRecords(sourceId),
    runs: listRuns({ sourceId, limit: 20 }).items,
    tasks: (
      db
        .prepare('SELECT id FROM collection_tasks WHERE source_id = ?')
        .all(sourceId) as Array<{ id: string }>
    )
      .map((row) => getTask(row.id))
      .filter((task): task is CollectionTask => task !== null),
  };
}

export function getTaskDetail(taskId: string): {
  task: CollectionTask;
  source: DataSource;
  runs: CollectionRun[];
} {
  const task = getTask(taskId);
  if (!task) throw new OperationsRequestError('采集任务不存在', 404);
  const source = getDataSource(task.sourceId);
  if (!source) throw new OperationsRequestError('任务关联的数据源不存在', 404);
  return {
    task,
    source,
    runs: listRuns({ taskId, limit: 30 }).items,
  };
}

export function getRunDetail(runId: string): {
  run: CollectionRun;
  task: CollectionTask;
  source: DataSource;
  details: ReturnType<typeof getRunDetails>;
} {
  const run = getRun(runId);
  if (!run) throw new OperationsRequestError('执行记录不存在', 404);
  const task = getTask(run.taskId);
  const source = getDataSource(run.sourceId);
  if (!task || !source) throw new OperationsRequestError('执行关联的任务或数据源不存在', 404);
  return { run, task, source, details: getRunDetails(runId) };
}

const ALLOWED_SOURCE_TYPES = ['lifecycle', 'release', 'security', 'discovery'] as const;

export function updateSource(
  sourceId: string,
  patch: {
    enabled?: boolean;
    freshnessEnabled?: boolean;
    freshnessInterval?: number;
    freshnessGracePeriod?: number;
  },
): DataSource {
  const source = getSourceRow(sourceId);
  if (!source) throw new OperationsRequestError('数据源不存在', 404);
  const wasEnabled = Boolean(source.enabled);
  const nextEnabled = patch.enabled ?? wasEnabled;
  const nextFreshnessEnabled = patch.freshnessEnabled ?? Boolean(source.freshness_enabled);
  const nextInterval = patch.freshnessInterval ?? source.freshness_interval;
  const nextGrace = patch.freshnessGracePeriod ?? source.freshness_grace_period;
  if (!ALLOWED_SOURCE_TYPES.includes(source.type)) {
    throw new OperationsRequestError('数据源类型不合法', 400);
  }
  // A suspended source is "disabled", never "ok"/"error". Re-enabling it starts
  // from unknown until the next real check or collection reports a status.
  const nextHealth = !nextEnabled ? 'disabled' : wasEnabled ? source.health_status : 'unknown';
  db.prepare(
    `UPDATE data_sources SET enabled = ?, health_status = ?, freshness_enabled = ?,
       freshness_interval = ?, freshness_grace_period = ?, updated_at = ? WHERE id = ?`,
  ).run(
    nextEnabled ? 1 : 0,
    nextHealth,
    nextFreshnessEnabled ? 1 : 0,
    Math.max(1, Math.min(8760, nextInterval)),
    Math.max(0, Math.min(8760, nextGrace)),
    nowIso(),
    sourceId,
  );
  if (!nextEnabled) {
    resolveOperationAlert(`source_anomaly:${sourceId}`);
    resolveOperationAlert(`rate_limit:${sourceId}`, false);
    resolveOperationAlert(`data_stale:${sourceId}`, false);
  }
  refreshStaleAlerts();
  return getDataSource(sourceId)!;
}

export function updateTask(
  taskId: string,
  patch: { enabled?: boolean; schedule?: string; timeoutSeconds?: number },
): CollectionTask {
  const task = getTaskRow(taskId);
  if (!task) throw new OperationsRequestError('采集任务不存在', 404);
  db.prepare(
    `UPDATE collection_tasks SET enabled = ?, schedule = ?,
       schedule_custom = CASE WHEN ? THEN 1 ELSE schedule_custom END, timeout_seconds = ?,
       next_run_at = CASE WHEN ? THEN next_run_at ELSE NULL END, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.enabled === undefined ? task.enabled : patch.enabled ? 1 : 0,
    patch.schedule ?? task.schedule,
    patch.schedule !== undefined && patch.schedule !== task.schedule ? 1 : 0,
    Math.max(10, Math.min(3600, patch.timeoutSeconds ?? task.timeout_seconds)),
    (patch.enabled === undefined ? task.enabled : patch.enabled ? 1 : 0),
    nowIso(),
    taskId,
  );
  if (patch.enabled === false) {
    resolveOperationAlert(`task_failure:${taskId}`);
    resolveOperationAlert(`task_timeout:${taskId}`);
  }
  return getTask(taskId)!;
}

export function getSourceRuns(
  sourceId: string,
  options: { limit?: number; offset?: number; status?: CollectionRunStatus },
) {
  if (!getSourceRow(sourceId)) throw new OperationsRequestError('数据源不存在', 404);
  return listRuns({ sourceId, ...options });
}

export function getTaskRuns(
  taskId: string,
  options: { limit?: number; offset?: number; status?: CollectionRunStatus },
) {
  if (!getTaskRow(taskId)) throw new OperationsRequestError('采集任务不存在', 404);
  return listRuns({ taskId, ...options });
}

export function getFreshnessFor(sourceId: string) {
  const source = getSourceRow(sourceId);
  if (!source) throw new OperationsRequestError('数据源不存在', 404);
  return computeFreshness(source);
}
