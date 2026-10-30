import { Router } from 'express';
import cron from 'node-cron';
import { z } from 'zod';
import type {
  CollectionRunStatus,
  DataSourceType,
  DeliveryStatus,
  FollowTargetType,
  LifecycleFeedItem,
  NotificationRuleType,
  NotificationSeverity,
  OperationIssueKind,
  RadarKind,
  RadarRecordType,
  RadarStatus,
  ReleaseFeedItem,
  SourceHealthStatus,
  SourceType,
  SubscriptionRule,
} from '../shared/types.js';
import { catalog, findCatalogItem } from './catalog.js';
import { db, getSettingsObject, nowIso, setSetting } from './db.js';
import { compareVersions, findCycle } from './lib/version.js';
import { getAdvisory, listAdvisories, setAdvisoryStatus, refreshAdvisoryInsights } from './services/advisories.js';
import { getDashboard } from './services/dashboard.js';
import {
  listEvents,
  markAllEventsRead,
  markEventRead,
  setEventStatus,
} from './services/events.js';
import { searchAll } from './services/search.js';
import { getPublicSettings, updateSettings } from './services/settings.js';
import {
  createNote,
  createRadar,
  createRadarRecord,
  deleteNote,
  deleteRadar,
  getRadarDetail,
  listNotes,
  listRadar,
  listRadarRecords,
  setRadarArchived,
  setRadarStatus,
  updateNote,
  updateRadar,
} from './services/notes.js';
import {
  archiveSoftware,
  createSoftware,
  getSoftwareDetail,
  getSoftwareSummary,
  listSoftware,
  updateSoftware,
} from './services/software.js';
import { listJobs, syncAllActive, syncSoftware } from './services/sync.js';
import {
  getDiscoveryScheduleState,
  getNextCollectionAt,
  getSchedulerState,
  rescheduleScheduler,
} from './services/scheduler.js';
import {
  checkSource,
  getFreshness,
  getIssues,
  getOperationsOverview,
  getRunDetail,
  getSourceDetail,
  getSourceRuns,
  getTaskDetail,
  getTaskRuns,
  OperationsRequestError,
  retryRun,
  startTaskRun,
  updateSource,
  updateTask,
} from './services/operations.js';
import {
  applyGlobalSyncSchedule,
  getRun,
  listDataSources,
  listTasks,
  sourceSummary,
  listRuns,
} from './services/operations-store.js';
import {
  clearFollowRules,
  followTarget,
  getFollow,
  getGlobalRules,
  getFollowStatus,
  listDeliveries,
  listFollows,
  listNotifications,
  markAllNotificationsRead,
  NotificationRequestError,
  retryDelivery,
  saveFollowRules,
  saveGlobalRules,
  sendTestEmail,
  setNotificationRead,
  unfollow,
} from './services/notifications.js';
import {
  getSmtpConfigView,
  saveSmtpConfig,
  sanitizeSmtpError,
} from './services/smtp.js';
import {
  DiscoveryRequestError,
  findCandidateRadarMatch,
  getDiscoveryCandidate,
  getDiscoveryOverview,
  ignoreDiscoveryCandidate,
  importDiscoveryCandidate,
  listDiscoveryCandidates,
  listDiscoveryJobs,
  listDiscoveryRules,
  listDiscoverySources,
  restoreDiscoveryCandidate,
  startDiscoveryRun,
} from './services/discovery.js';

const router = Router();

const asyncRoute =
  (handler: (req: any, res: any, next: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

const sourceSchema = z.object({
  type: z.enum([
    'endoflife',
    'github_releases',
    'github_advisories',
    'nvd',
    'cisa_kev',
    'upstream_advisory',
  ]),
  label: z.string().min(1),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
});

const createSoftwareSchema = z.object({
  catalogKey: z.string().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  aliases: z.array(z.string()).optional(),
  category: z.string().optional(),
  logoUrl: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  repo: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  currentVersion: z.string().optional().nullable(),
  watchLevel: z.enum(['critical', 'high', 'normal']).optional(),
  environment: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  sources: z.array(sourceSchema).optional(),
});

const patchSoftwareSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  currentVersion: z.string().optional().nullable(),
  watchStatus: z.enum(['active', 'paused', 'archived']).optional(),
  watchLevel: z.enum(['critical', 'high', 'normal']).optional(),
  environment: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  pinned: z.boolean().optional(),
  aliases: z.array(z.string()).optional(),
  category: z.string().optional(),
  website: z.string().optional().nullable(),
  repo: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  logoUrl: z.string().optional().nullable(),
  sources: z
    .array(
      z.object({
        id: z.string(),
        enabled: z.boolean().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
});

const radarKinds = ['tool', 'tech', 'learning'] as const;
const radarStatuses = ['pending', 'trialing', 'adopted', 'deferred', 'ignored'] as const;
const radarRecordTypes = ['evaluation', 'trial', 'adoption', 'note'] as const;

const radarUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === '' || /^https?:\/\//i.test(value), {
    message: '链接需以 http:// 或 https:// 开头',
  })
  .optional()
  .nullable();

const radarSchema = z.object({
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().max(1000).default(''),
  kind: z.enum(radarKinds),
  url: radarUrl,
  status: z.enum(radarStatuses).optional(),
});

const radarPatchSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  summary: z.string().trim().max(1000).optional(),
  kind: z.enum(radarKinds).optional(),
  url: radarUrl,
});

const radarStatusSchema = z.object({
  status: z.enum(radarStatuses),
});

const radarRecordSchema = z.object({
  recordType: z.enum(radarRecordTypes),
  content: z.string().trim().min(1).max(5000),
  nextAction: z.string().trim().max(1000).optional().nullable(),
});

const discoveryListSchema = z.object({
  status: z.enum(['all', 'pending', 'imported', 'ignored']).optional(),
  source: z.enum(['github', 'cncf']).optional(),
  category: z.string().trim().max(120).optional(),
  q: z.string().trim().max(120).optional(),
  sort: z.enum(['discovered', 'updated', 'stars', 'title']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const discoveryImportSchema = z.object({
  radarItemId: z.string().trim().min(1).max(100).optional().nullable(),
  title: z.string().trim().min(1).max(160).optional(),
  summary: z.string().trim().max(1000).optional(),
  kind: z.enum(radarKinds).optional(),
  url: radarUrl,
});

const noteSchema = z.object({
  title: z.string().trim().min(1).max(160),
  content: z.string().max(200_000).optional(),
  tags: z.array(z.string().trim().max(40)).max(12).optional(),
  relatedSoftwareId: z.string().optional().nullable(),
});

const settingsSchema = z.object({
  syncEnabled: z.boolean().optional(),
  syncCron: z.string().optional(),
  emailEnabled: z.boolean().optional(),
  emailTo: z.string().optional(),
  emailMode: z.enum(['realtime', 'digest']).optional(),
  digestTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间格式应为 HH:MM')
    .optional(),
  notifyP0: z.boolean().optional(),
  notifyP1: z.boolean().optional(),
  notifyEol: z.boolean().optional(),
  notifyRelease: z.boolean().optional(),
  quietHours: z.string().optional(),
  staleAfterHours: z.number().optional(),
});

const followTargetTypes = ['software', 'radar', 'discovery', 'advisory'] as const;
const notificationRuleTypes = [
  'new_release',
  'lifecycle_change',
  'new_vulnerability',
  'high_risk_advisory',
  'advisory_update',
  'project_update',
  'discovery',
  'source_anomaly',
  'rate_limit',
  'task_failure',
  'task_timeout',
  'data_stale',
  'task_recovered',
] as const;

const followSchema = z.object({
  targetType: z.enum(followTargetTypes),
  targetId: z.string().trim().min(1).max(200),
});

const subscriptionRuleSchema = z.object({
  eventType: z.enum(notificationRuleTypes),
  inApp: z.boolean(),
  email: z.boolean(),
  minSeverity: z.enum(['all', 'important', 'urgent']),
});

const subscriptionRulesSchema = z.object({
  rules: z.array(subscriptionRuleSchema).max(20),
});

const smtpSchema = z.object({
  enabled: z.boolean().optional(),
  host: z.string().trim().max(255).optional(),
  port: z.coerce.number().int().min(1).max(65_535).optional(),
  encryption: z.enum(['none', 'starttls', 'ssl']).optional(),
  username: z.string().trim().max(255).optional(),
  password: z.string().max(1024).optional(),
  fromName: z.string().trim().max(120).optional(),
  fromEmail: z
    .string()
    .trim()
    .max(255)
    .refine((value) => value === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), {
      message: '发件邮箱格式不合法',
    })
    .optional(),
});

const testEmailSchema = z.object({
  to: z
    .string()
    .trim()
    .max(255)
    .refine((value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), { message: '收件邮箱格式不合法' })
    .optional(),
});

const sourcePatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    freshnessEnabled: z.boolean().optional(),
    freshnessInterval: z.number().int().min(1).max(8760).optional(),
    freshnessGracePeriod: z.number().int().min(0).max(8760).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '至少提供一个可更新字段' });

const taskPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    schedule: z.string().trim().min(1).max(120).optional(),
    timeoutSeconds: z.number().int().min(10).max(3600).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '至少提供一个可更新字段' });

function queryInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function sendOperationsError(res: any, error: unknown): boolean {
  if (error instanceof OperationsRequestError) {
    res.status(error.status).json({ error: error.message });
    return true;
  }
  return false;
}

const notificationReadSchema = z.object({
  read: z.boolean(),
});

function sendNotificationError(res: any, error: unknown): boolean {
  if (error instanceof NotificationRequestError) {
    res.status(error.status).json({ error: error.message });
    return true;
  }
  return false;
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown, res: any): T | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({
      error: '请求参数不合法',
      details: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    });
    return null;
  }
  return parsed.data;
}

function sendDiscoveryError(res: any, error: unknown): boolean {
  if (error instanceof DiscoveryRequestError) {
    res.status(error.status).json({
      error: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
    return true;
  }
  return false;
}

router.get('/health', (_req, res) => {
  res.json({ ok: true, time: nowIso() });
});

router.get('/meta', (_req, res) => {
  res.json({
    categories: [...new Set(catalog.map((item) => item.category))],
    scheduler: getSchedulerState(),
    sourceTypes: [
      { type: 'endoflife', label: 'endoflife.date', description: '发布周期与支持截止日期' },
      { type: 'github_releases', label: 'GitHub Releases', description: '版本发布与发布说明' },
      { type: 'github_advisories', label: 'GitHub Advisory', description: '开源组件安全公告' },
      { type: 'nvd', label: 'NVD CVE', description: '通用漏洞库' },
      { type: 'cisa_kev', label: 'CISA KEV', description: '已知遭实际利用的漏洞' },
    ],
  });
});

router.get('/dashboard', (_req, res) => {
  res.json(getDashboard());
});

router.get('/catalog', (req, res) => {
  const q = String(req.query.q ?? '').trim().toLowerCase();
  const category = String(req.query.category ?? '').trim();
  let items = catalog;
  if (q) {
    items = items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.aliases.some((alias) => alias.toLowerCase().includes(q)) ||
        item.description.toLowerCase().includes(q),
    );
  }
  if (category) items = items.filter((item) => item.category === category);
  res.json(items);
});

router.get('/software', (req, res) => {
  res.json(listSoftware({ includeArchived: req.query.includeArchived === 'true' }));
});

router.post('/software', (req, res) => {
  const body = parseBody(createSoftwareSchema, req.body, res);
  if (!body) return;
  const item = body.catalogKey ? findCatalogItem(body.catalogKey) : undefined;
  if (body.catalogKey && !item) {
    res.status(400).json({ error: '未找到该软件目录项' });
    return;
  }
  if (!item && !body.name) {
    res.status(400).json({ error: '自定义软件需要填写名称' });
    return;
  }
  if (!body.sources?.length && !item) {
    res.status(400).json({ error: '自定义软件至少需要配置一个数据源' });
    return;
  }

  const selectedSources = body.sources?.length
    ? body.sources.map((source) => ({
        type: source.type as SourceType,
        label: source.label,
        enabled: source.enabled,
        config: source.config as Record<string, string>,
      }))
    : (item?.sources ?? []).map((source) => ({ ...source, config: source.config as Record<string, string> }));

  try {
    const id = createSoftware({
      name: body.name || item!.name,
      aliases: body.aliases ?? item?.aliases ?? [],
      category: body.category ?? item?.category ?? '其他',
      logoUrl:
        body.logoUrl ??
        (item?.logoSlug ? `https://cdn.simpleicons.org/${item.logoSlug}` : null),
      website: body.website ?? item?.website ?? null,
      repo: body.repo ?? (item?.repo ? item.repo : null),
      description: body.description ?? item?.description ?? null,
      watchLevel: body.watchLevel ?? item?.watchLevel ?? 'normal',
      currentVersion: body.currentVersion ?? null,
      environment: body.environment ?? null,
      notes: body.notes ?? null,
      catalogKey: body.catalogKey ?? null,
      sources: selectedSources,
    });

    // First collection runs in the background so the add flow stays responsive.
    void syncSoftware(id, { trigger: 'initial' }).catch((error) => {
      console.error('[initial sync]', error);
    });

    res.status(201).json({ id, software: getSoftwareSummary(id) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : '创建失败' });
  }
});

router.get('/software/:id', (req, res) => {
  const detail = getSoftwareDetail(req.params.id);
  if (!detail) {
    res.status(404).json({ error: '软件不存在' });
    return;
  }
  res.json(detail);
});

router.patch('/software/:id', (req, res) => {
  const body = parseBody(patchSoftwareSchema, req.body, res);
  if (!body) return;
  try {
    const changedSourceIds = updateSoftware(req.params.id, {
      ...body,
      sources: body.sources?.map((source) => ({
        id: source.id,
        enabled: source.enabled,
        config: source.config as Record<string, string> | undefined,
      })),
    });
    res.json({ ok: true, software: getSoftwareSummary(req.params.id) });
    if (changedSourceIds.length) {
      // Rerun only the collectors whose configuration or enabled state changed.
      // The response is already sent; the shared AppData poll picks up results.
      void syncSoftware(req.params.id, { trigger: 'manual', sourceIds: changedSourceIds }).catch((error) => {
        console.error('[api] source resync failed', error);
      });
    }
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : '更新失败' });
  }
});

router.delete('/software/:id', (req, res) => {
  if (!getSoftwareSummary(req.params.id)) {
    res.status(404).json({ error: '软件不存在' });
    return;
  }
  archiveSoftware(req.params.id);
  res.json({ ok: true });
});

router.post(
  '/software/:id/sync',
  asyncRoute(async (req, res) => {
    const sourceIds = Array.isArray(req.body?.sourceIds) ? req.body.sourceIds.map(String) : undefined;
    const result = await syncSoftware(req.params.id, { trigger: 'manual', sourceIds });
    if (result.busy) {
      res.status(409).json({ error: result.error, jobs: result.jobs });
      return;
    }
    res.json(result);
  }),
);

router.post(
  '/sync-all',
  asyncRoute(async (_req, res) => {
    const result = await syncAllActive('manual');
    res.json(result);
  }),
);

router.get('/events', (req, res) => {
  const events = listEvents({
    softwareId: req.query.softwareId ? String(req.query.softwareId) : undefined,
    type: req.query.type ? String(req.query.type) : undefined,
    priority: req.query.priority ? String(req.query.priority) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    unreadOnly: req.query.unread === 'true',
    limit: req.query.limit ? Number(req.query.limit) : 60,
    offset: req.query.offset ? Number(req.query.offset) : 0,
  });
  res.json(events);
});

router.patch('/events/:id/read', (req, res) => {
  markEventRead(req.params.id);
  res.json({ ok: true });
});

router.post('/events/read-all', (_req, res) => {
  markAllEventsRead();
  res.json({ ok: true });
});

router.patch('/events/:id/status', (req, res) => {
  const parsed = z
    .object({ status: z.enum(['new', 'acknowledged', 'resolved', 'ignored']) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '状态不合法' });
    return;
  }
  setEventStatus(req.params.id, parsed.data.status);
  res.json({ ok: true });
});

router.get('/advisories', (req, res) => {
  const advisories = listAdvisories({
    softwareId: req.query.softwareId ? String(req.query.softwareId) : undefined,
    priority: req.query.priority ? String(req.query.priority) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    openOnly: req.query.openOnly === 'true',
    limit: req.query.limit ? Number(req.query.limit) : 200,
    offset: req.query.offset ? Number(req.query.offset) : 0,
  });
  res.json(advisories);
});

router.get('/advisories/:id', (req, res) => {
  const advisory = getAdvisory(req.params.id);
  if (!advisory) {
    res.status(404).json({ error: '漏洞记录不存在' });
    return;
  }
  res.json(advisory);
});

router.patch('/advisories/:id/status', (req, res) => {
  const parsed = z
    .object({
      status: z.enum(['pending', 'to_fix', 'planned', 'fixed', 'not_affected', 'ignored']),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '状态不合法' });
    return;
  }
  setAdvisoryStatus(req.params.id, parsed.data.status);
  const advisory = getAdvisory(req.params.id);
  if (advisory && ['fixed', 'not_affected', 'ignored'].includes(parsed.data.status)) {
    db.prepare(
      `UPDATE user_event_state SET status = 'resolved', updated_at = ?
       WHERE event_id IN (SELECT id FROM intelligence_event WHERE ref_id = ? AND type = 'vulnerability')`,
    ).run(nowIso(), req.params.id);
  }
  res.json({ ok: true, advisory });
});

router.get('/releases', (req, res) => {
  const softwareId = req.query.softwareId ? String(req.query.softwareId) : null;
  const channel = req.query.channel ? String(req.query.channel) : null;
  const clauses = ['s.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (softwareId) {
    clauses.push('r.software_id = ?');
    params.push(softwareId);
  }
  if (channel === 'stable' || channel === 'prerelease') {
    clauses.push('r.channel = ?');
    params.push(channel);
  }
  const rows = db
    .prepare(
      `SELECT r.*, s.name AS software_name, s.logo_url AS software_logo_url, s.category,
              s.current_version, ss.type AS source_type
       FROM release_record r JOIN software s ON s.id = r.software_id
       LEFT JOIN software_source ss ON ss.id = r.source_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY COALESCE(r.published_at, r.first_seen_at) DESC LIMIT 200`,
    )
    .all(...params) as Array<Record<string, any>>;

  const items: ReleaseFeedItem[] = rows.map((row) => ({
    id: row.id,
    softwareId: row.software_id,
    softwareName: row.software_name,
    softwareLogoUrl: row.software_logo_url,
    category: row.category,
    currentVersion: row.current_version,
    version: row.version,
    channel: row.channel,
    title: row.title,
    notes: row.notes,
    url: row.url,
    publishedAt: row.published_at,
    firstSeenAt: row.first_seen_at,
    sourceType: row.source_type,
    isNewer: Boolean(
      row.current_version &&
        row.channel === 'stable' &&
        compareVersions(row.version, row.current_version) > 0,
    ),
  }));
  res.json(items);
});

router.get('/lifecycle', (req, res) => {
  const softwareId = req.query.softwareId ? String(req.query.softwareId) : null;
  const clauses = ['s.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (softwareId) {
    clauses.push('l.software_id = ?');
    params.push(softwareId);
  }
  const rows = db
    .prepare(
      `SELECT l.*, s.name AS software_name, s.logo_url AS software_logo_url, s.current_version
       FROM lifecycle_record l JOIN software s ON s.id = l.software_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY s.name, l.cycle DESC`,
    )
    .all(...params) as Array<Record<string, any>>;

  const items: LifecycleFeedItem[] = rows.map((row) => {
    const isCurrent = row.current_version ? findCycle(row.current_version, [{ cycle: row.cycle }]) !== null : false;
    return {
      id: row.id,
      softwareId: row.software_id,
      softwareName: row.software_name,
      softwareLogoUrl: row.software_logo_url,
      currentVersion: row.current_version,
      isCurrent,
      cycle: row.cycle,
      releaseDate: row.release_date,
      latestVersion: row.latest_version,
      latestReleaseDate: row.latest_release_date,
      eolDate: row.eol_date,
      supportStatus: row.support_status,
      sourceUrl: row.source_url,
      fetchedAt: row.fetched_at,
      note: isCurrent ? '当前使用版本' : null,
    };
  });
  res.json(items);
});

router.get('/jobs', (req, res) => {
  res.json(
    listJobs({
      softwareId: req.query.softwareId ? String(req.query.softwareId) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 100,
    }),
  );
});

router.get('/search', (req, res) => {
  res.json(searchAll(String(req.query.q ?? '')));
});

router.get('/radar', (req, res) => {
  const kindRaw = String(req.query.kind ?? '');
  const statusRaw = String(req.query.status ?? '');
  const sortRaw = String(req.query.sort ?? '');
  const limitRaw = Number(req.query.limit);
  const kind = (radarKinds as readonly string[]).includes(kindRaw)
    ? (kindRaw as RadarKind)
    : undefined;
  const status = (radarStatuses as readonly string[]).includes(statusRaw)
    ? (statusRaw as RadarStatus)
    : undefined;
  const sort = ['created', 'updated', 'evaluated'].includes(sortRaw)
    ? (sortRaw as 'created' | 'updated' | 'evaluated')
    : 'updated';

  res.json(
    listRadar({
      kind,
      status,
      q: req.query.q ? String(req.query.q) : undefined,
      includeArchived: req.query.includeArchived === 'true',
      archivedOnly: req.query.archived === 'true',
      sort,
      limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
    }),
  );
});

router.post('/radar', (req, res) => {
  const body = parseBody(radarSchema, req.body, res);
  if (!body) return;
  res.status(201).json(createRadar(body));
});

router.get('/radar/:id', (req, res) => {
  const detail = getRadarDetail(req.params.id);
  if (!detail) {
    res.status(404).json({ error: '雷达条目不存在' });
    return;
  }
  res.json(detail);
});

router.patch('/radar/:id', (req, res) => {
  const body = parseBody(radarPatchSchema, req.body, res);
  if (!body) return;
  const item = updateRadar(req.params.id, body);
  if (!item) {
    res.status(404).json({ error: '雷达条目不存在' });
    return;
  }
  res.json(item);
});

router.patch('/radar/:id/status', (req, res) => {
  const body = parseBody(radarStatusSchema, req.body, res);
  if (!body) return;
  const item = setRadarStatus(req.params.id, body.status);
  if (!item) {
    res.status(404).json({ error: '雷达条目不存在' });
    return;
  }
  res.json(item);
});

router.post('/radar/:id/archive', (req, res) => {
  const item = setRadarArchived(req.params.id, true);
  if (!item) {
    res.status(404).json({ error: '雷达条目不存在' });
    return;
  }
  res.json(item);
});

router.post('/radar/:id/restore', (req, res) => {
  const item = setRadarArchived(req.params.id, false);
  if (!item) {
    res.status(404).json({ error: '雷达条目不存在' });
    return;
  }
  res.json(item);
});

router.get('/radar/:id/records', (req, res) => {
  const detail = getRadarDetail(req.params.id);
  if (!detail) {
    res.status(404).json({ error: '雷达条目不存在' });
    return;
  }
  res.json(listRadarRecords(req.params.id));
});

router.post('/radar/:id/records', (req, res) => {
  const body = parseBody(radarRecordSchema, req.body, res);
  if (!body) return;
  const record = createRadarRecord(req.params.id, {
    recordType: body.recordType as RadarRecordType,
    content: body.content,
    nextAction: body.nextAction,
  });
  if (!record) {
    res.status(404).json({ error: '雷达条目不存在' });
    return;
  }
  res.status(201).json(record);
});

router.delete('/radar/:id', (req, res) => {
  if (!deleteRadar(req.params.id)) {
    res.status(404).json({ error: '雷达条目不存在' });
    return;
  }
  res.json({ ok: true });
});

router.get('/discovery/candidates', (req, res) => {
  const parsed = discoveryListSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: '筛选参数不合法' });
    return;
  }
  res.json(
    listDiscoveryCandidates({
      status: parsed.data.status,
      sourceType: parsed.data.source,
      category: parsed.data.category,
      q: parsed.data.q,
      sort: parsed.data.sort,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    }),
  );
});

router.get('/discovery/candidates/:id', (req, res) => {
  const candidate = getDiscoveryCandidate(req.params.id);
  if (!candidate) {
    res.status(404).json({ error: '候选技术不存在' });
    return;
  }
  res.json(candidate);
});

router.get('/discovery/candidates/:id/radar-match', (req, res) => {
  try {
    res.json({ radarItem: findCandidateRadarMatch(req.params.id) });
  } catch (error) {
    if (sendDiscoveryError(res, error)) return;
    throw error;
  }
});

router.post('/discovery/candidates/:id/import', (req, res) => {
  const body = parseBody(discoveryImportSchema, req.body ?? {}, res);
  if (!body) return;
  try {
    res.status(201).json(importDiscoveryCandidate(req.params.id, body));
  } catch (error) {
    if (sendDiscoveryError(res, error)) return;
    throw error;
  }
});

router.post('/discovery/candidates/:id/ignore', (req, res) => {
  try {
    res.json(ignoreDiscoveryCandidate(req.params.id));
  } catch (error) {
    if (sendDiscoveryError(res, error)) return;
    throw error;
  }
});

router.post('/discovery/candidates/:id/restore', (req, res) => {
  try {
    res.json(restoreDiscoveryCandidate(req.params.id));
  } catch (error) {
    if (sendDiscoveryError(res, error)) return;
    throw error;
  }
});

router.get('/discovery/overview', (_req, res) => {
  res.json(getDiscoveryOverview(getDiscoveryScheduleState()));
});

router.get('/discovery/sources', (_req, res) => {
  res.json(listDiscoverySources());
});

router.get('/discovery/rules', (_req, res) => {
  res.json(listDiscoveryRules());
});

router.get('/discovery/jobs', (req, res) => {
  const limit = Number(req.query.limit);
  res.json(listDiscoveryJobs(Number.isFinite(limit) && limit > 0 ? limit : 12));
});

router.post('/discovery/refresh', (_req, res) => {
  const result = startDiscoveryRun('manual');
  if (!result.started) {
    res.status(409).json({ error: result.reason ?? '采集正在进行中' });
    return;
  }
  res.status(202).json({ ok: true, started: true });
});

router.get('/knowledge', (_req, res) => {
  res.json(listNotes());
});

router.post('/knowledge', (req, res) => {
  const body = parseBody(noteSchema, req.body, res);
  if (!body) return;
  res.status(201).json(createNote(body));
});

router.patch('/knowledge/:id', (req, res) => {
  const body = parseBody(noteSchema.partial(), req.body, res);
  if (!body) return;
  const note = updateNote(req.params.id, body);
  if (!note) {
    res.status(404).json({ error: '笔记不存在' });
    return;
  }
  res.json(note);
});

router.delete('/knowledge/:id', (req, res) => {
  deleteNote(req.params.id);
  res.json({ ok: true });
});

router.get('/settings', (_req, res) => {
  res.json({ ...getPublicSettings(), scheduler: getSchedulerState() });
});

router.patch('/settings', (req, res) => {
  const body = parseBody(settingsSchema, req.body, res);
  if (!body) return;
  if (body.syncCron && !cron.validate(body.syncCron)) {
    res.status(400).json({ error: 'cron 表达式不合法' });
    return;
  }
  const previousCron = getPublicSettings().syncCron;
  updateSettings(body);
  // Only a real change to the global collection interval rewrites the tasks
  // that still follow it; per-task custom schedules are left untouched.
  if (body.syncCron !== undefined && body.syncCron !== previousCron) {
    applyGlobalSyncSchedule(body.syncCron);
  }
  rescheduleScheduler();
  res.json({ ok: true, settings: { ...getPublicSettings(), scheduler: getSchedulerState() } });
});

router.get('/follows', (req, res) => {
  const type = typeof req.query.type === 'string' ? req.query.type : undefined;
  if (type && !followTargetTypes.includes(type as FollowTargetType)) {
    res.status(400).json({ error: '关注类型不合法' });
    return;
  }
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : undefined;
  res.json({ items: listFollows({ type: type as FollowTargetType | undefined, q }) });
});

router.get('/follows/status', (req, res) => {
  const targetType = typeof req.query.targetType === 'string' ? req.query.targetType : '';
  const targetId = typeof req.query.targetId === 'string' ? req.query.targetId.trim() : '';
  if (!followTargetTypes.includes(targetType as FollowTargetType) || !targetId) {
    res.status(400).json({ error: '请提供有效的关注对象' });
    return;
  }
  res.json({ follow: getFollowStatus(targetType as FollowTargetType, targetId) });
});

router.post('/follows', (req, res) => {
  const body = parseBody(followSchema, req.body, res);
  if (!body) return;
  try {
    const result = followTarget(body.targetType, body.targetId);
    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    if (!sendNotificationError(res, error)) throw error;
  }
});

router.delete('/follows/:id', (req, res) => {
  if (!unfollow(req.params.id)) {
    res.status(404).json({ error: '关注对象不存在' });
    return;
  }
  res.json({ ok: true });
});

router.patch('/follows/:id/rules', (req, res) => {
  const body = parseBody(subscriptionRulesSchema, req.body, res);
  if (!body) return;
  try {
    const rules = saveFollowRules(req.params.id, body.rules as SubscriptionRule[]);
    res.json({ rules, follow: getFollow(req.params.id) });
  } catch (error) {
    if (!sendNotificationError(res, error)) throw error;
  }
});

router.delete('/follows/:id/rules', (req, res) => {
  try {
    const rules = clearFollowRules(req.params.id);
    res.json({ rules, follow: getFollow(req.params.id) });
  } catch (error) {
    if (!sendNotificationError(res, error)) throw error;
  }
});

router.get('/notification-rules', (_req, res) => {
  res.json({ rules: getGlobalRules() });
});

router.patch('/notification-rules', (req, res) => {
  const body = parseBody(subscriptionRulesSchema, req.body, res);
  if (!body) return;
  res.json({ rules: saveGlobalRules(body.rules as SubscriptionRule[]) });
});

router.get('/notifications', (req, res) => {
  const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
  if (severity && !['urgent', 'important', 'normal'].includes(severity)) {
    res.status(400).json({ error: '通知级别不合法' });
    return;
  }
  const ruleType = typeof req.query.ruleType === 'string' ? req.query.ruleType : undefined;
  if (ruleType && !notificationRuleTypes.includes(ruleType as NotificationRuleType)) {
    res.status(400).json({ error: '通知类型不合法' });
    return;
  }
  const limit = Number(req.query.limit ?? 30);
  const offset = Number(req.query.offset ?? 0);
  res.json(
    listNotifications({
      unreadOnly: req.query.unread === 'true' || req.query.unreadOnly === 'true',
      severity: severity as NotificationSeverity | undefined,
      ruleType: ruleType as NotificationRuleType | undefined,
      limit: Number.isFinite(limit) ? limit : 30,
      offset: Number.isFinite(offset) ? offset : 0,
    }),
  );
});

router.post('/notifications/read-all', (_req, res) => {
  markAllNotificationsRead();
  res.json({ ok: true });
});

router.get('/notifications/deliveries', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  if (status && !['pending', 'sending', 'sent', 'failed', 'skipped'].includes(status)) {
    res.status(400).json({ error: '投递状态不合法' });
    return;
  }
  const limit = Number(req.query.limit ?? 20);
  res.json({
    items: listDeliveries({
      status: status as DeliveryStatus | undefined,
      limit: Number.isFinite(limit) ? limit : 20,
    }),
  });
});

router.post('/notifications/deliveries/:id/retry', (req, res) => {
  const delivery = retryDelivery(req.params.id);
  if (!delivery) {
    res.status(404).json({ error: '投递记录不存在' });
    return;
  }
  res.json({ delivery });
});

router.get('/notifications/smtp', (_req, res) => {
  res.json({ smtp: getSmtpConfigView() });
});

router.patch('/notifications/smtp', asyncRoute(async (req, res) => {
  const body = parseBody(smtpSchema, req.body, res);
  if (!body) return;
  const password = body.password?.trim() ? body.password : undefined;
  const current = getSmtpConfigView();
  const prospectiveEnabled = body.enabled ?? current.enabled;
  const prospectiveHost = body.host ?? current.host;
  const prospectiveFromEmail = body.fromEmail ?? current.fromEmail;
  const prospectiveUsername = body.username ?? current.username;
  const prospectivePassword = Boolean(password) || current.passwordConfigured;
  if (
    prospectiveEnabled &&
    (!prospectiveHost || !prospectiveFromEmail || (prospectiveUsername && !prospectivePassword))
  ) {
    res.status(400).json({
      error: '启用 SMTP 前请填写服务器、发件邮箱，以及账号对应的密码',
      smtp: current,
    });
    return;
  }
  const smtp = saveSmtpConfig({ ...body, password });
  res.json({ smtp });
}));

router.post('/notifications/smtp/test', asyncRoute(async (req, res) => {
  const body = parseBody(testEmailSchema, req.body ?? {}, res);
  if (!body) return;
  const to = body.to || getPublicSettings().emailTo;
  if (!to) {
    res.status(400).json({ error: '请先填写收件邮箱' });
    return;
  }
  try {
    await sendTestEmail(to);
    res.json({ ok: true, to });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SMTP 测试失败';
    res.status(502).json({ error: sanitizeSmtpError({ message }) });
  }
}));

router.patch('/notifications/:id', (req, res) => {
  const body = parseBody(notificationReadSchema, req.body, res);
  if (!body) return;
  if (!setNotificationRead(req.params.id, body.read)) {
    res.status(404).json({ error: '通知不存在' });
    return;
  }
  res.json({ ok: true });
});

router.get('/operations/overview', (_req, res) => {
  const scheduler = getSchedulerState();
  res.json(
    getOperationsOverview({
      enabled: scheduler.enabled,
      nextRunAt: getNextCollectionAt(),
    }),
  );
});

router.get('/operations/issues', (req, res) => {
  const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
  const kinds: OperationIssueKind[] = [
    'source_anomaly',
    'rate_limit',
    'task_failure',
    'task_timeout',
    'data_stale',
    'scheduler',
  ];
  if (kind && !kinds.includes(kind as OperationIssueKind)) {
    res.status(400).json({ error: '问题类型不合法' });
    return;
  }
  res.json(getIssues(kind as OperationIssueKind | undefined));
});

router.get('/operations/freshness', (_req, res) => {
  res.json(getFreshness());
});

router.get('/sources', (req, res) => {
  const type = typeof req.query.type === 'string' ? req.query.type : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const types: DataSourceType[] = ['lifecycle', 'release', 'security', 'discovery'];
  const statuses: SourceHealthStatus[] = ['ok', 'error', 'rate_limited', 'unknown', 'disabled'];
  if (type && !types.includes(type as DataSourceType)) {
    res.status(400).json({ error: '数据源类型不合法' });
    return;
  }
  if (status && !statuses.includes(status as SourceHealthStatus)) {
    res.status(400).json({ error: '数据源状态不合法' });
    return;
  }
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : undefined;
  res.json({
    items: listDataSources({
      type: type as DataSourceType | undefined,
      status: status as SourceHealthStatus | undefined,
      q,
    }),
    summary: sourceSummary(),
  });
});

router.get('/sources/:id/runs', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const statuses: CollectionRunStatus[] = ['running', 'success', 'failed', 'timeout'];
  if (status && !statuses.includes(status as CollectionRunStatus)) {
    res.status(400).json({ error: '执行状态不合法' });
    return;
  }
  try {
    const result = getSourceRuns(req.params.id, {
      limit: queryInteger(req.query.limit, 20, 1, 100),
      offset: queryInteger(req.query.offset, 0, 0, 1_000_000),
      status: status as CollectionRunStatus | undefined,
    });
    res.json({ ...result, limit: queryInteger(req.query.limit, 20, 1, 100), offset: queryInteger(req.query.offset, 0, 0, 1_000_000) });
  } catch (error) {
    if (!sendOperationsError(res, error)) throw error;
  }
});

router.get('/sources/:id/health', (req, res) => {
  try {
    const detail = getSourceDetail(req.params.id);
    res.json({ source: detail.source, checks: detail.checks, quotas: detail.quotas });
  } catch (error) {
    if (!sendOperationsError(res, error)) throw error;
  }
});

router.get('/sources/:id', (req, res) => {
  try {
    res.json(getSourceDetail(req.params.id));
  } catch (error) {
    if (!sendOperationsError(res, error)) throw error;
  }
});

router.post('/sources/:id/check', asyncRoute(async (req, res) => {
  try {
    res.json(await checkSource(req.params.id));
  } catch (error) {
    if (!sendOperationsError(res, error)) throw error;
  }
}));

router.post('/sources/:id/collect', (req, res) => {
  try {
    const detail = getSourceDetail(req.params.id);
    const task = detail.tasks[0];
    if (!task) {
      res.status(404).json({ error: '该数据源没有关联的采集任务' });
      return;
    }
    const result = startTaskRun(task.id, 'manual');
    if (!result.started) {
      res.status(409).json({ error: result.reason ?? '无法启动采集' });
      return;
    }
    res.status(202).json({ run: result.run });
  } catch (error) {
    if (!sendOperationsError(res, error)) throw error;
  }
});

router.patch('/sources/:id', (req, res) => {
  const body = parseBody(sourcePatchSchema, req.body, res);
  if (!body) return;
  try {
    const source = updateSource(req.params.id, body);
    rescheduleScheduler();
    res.json({ source });
  } catch (error) {
    if (!sendOperationsError(res, error)) throw error;
  }
});

router.get('/collection-tasks', (_req, res) => {
  res.json({ items: listTasks(), schedulerEnabled: getSchedulerState().enabled });
});

router.get('/collection-tasks/:id/runs', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const statuses: CollectionRunStatus[] = ['running', 'success', 'failed', 'timeout'];
  if (status && !statuses.includes(status as CollectionRunStatus)) {
    res.status(400).json({ error: '执行状态不合法' });
    return;
  }
  try {
    const limit = queryInteger(req.query.limit, 20, 1, 100);
    const offset = queryInteger(req.query.offset, 0, 0, 1_000_000);
    res.json({
      ...getTaskRuns(req.params.id, {
        limit,
        offset,
        status: status as CollectionRunStatus | undefined,
      }),
      limit,
      offset,
    });
  } catch (error) {
    if (!sendOperationsError(res, error)) throw error;
  }
});

router.get('/collection-tasks/:id', (req, res) => {
  try {
    res.json(getTaskDetail(req.params.id));
  } catch (error) {
    if (!sendOperationsError(res, error)) throw error;
  }
});

router.post('/collection-tasks/:id/run', (req, res) => {
  const result = startTaskRun(req.params.id, 'manual');
  if (!result.started) {
    res.status(409).json({ error: result.reason ?? '无法启动采集' });
    return;
  }
  res.status(202).json({ run: result.run });
});

router.patch('/collection-tasks/:id', (req, res) => {
  const body = parseBody(taskPatchSchema, req.body, res);
  if (!body) return;
  if (body.schedule && !cron.validate(body.schedule)) {
    res.status(400).json({ error: 'cron 表达式不合法' });
    return;
  }
  try {
    const task = updateTask(req.params.id, body);
    rescheduleScheduler();
    res.json({ task });
  } catch (error) {
    if (!sendOperationsError(res, error)) throw error;
  }
});

router.get('/collection-runs', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const statuses: CollectionRunStatus[] = ['running', 'success', 'failed', 'timeout'];
  if (status && !statuses.includes(status as CollectionRunStatus)) {
    res.status(400).json({ error: '执行状态不合法' });
    return;
  }
  const limit = queryInteger(req.query.limit, 20, 1, 100);
  const offset = queryInteger(req.query.offset, 0, 0, 1_000_000);
  const taskId = typeof req.query.taskId === 'string' ? req.query.taskId.slice(0, 100) : undefined;
  const sourceId = typeof req.query.sourceId === 'string' ? req.query.sourceId.slice(0, 100) : undefined;
  res.json({
    ...listRuns({
      taskId,
      sourceId,
      status: status as CollectionRunStatus | undefined,
      limit,
      offset,
    }),
    limit,
    offset,
  });
});

router.get('/collection-runs/:id', (req, res) => {
  try {
    res.json(getRunDetail(req.params.id));
  } catch (error) {
    if (!sendOperationsError(res, error)) throw error;
  }
});

router.post('/collection-runs/:id/retry', (req, res) => {
  if (!getRun(req.params.id)) {
    res.status(404).json({ error: '执行记录不存在' });
    return;
  }
  const result = retryRun(req.params.id);
  if (!result.started) {
    res.status(409).json({ error: result.reason ?? '无法重试' });
    return;
  }
  res.status(202).json({ run: result.run });
});

router.get('/backup', asyncRoute(async (_req, res) => {
  const path = await import('node:path');
  const fs = await import('node:fs');
  const dir = path.resolve(process.cwd(), 'data', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `opsite-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.prepare('VACUUM INTO ?').run(file);
  res.download(file, path.basename(file));
}));

router.get('/system/status', (_req, res) => {
  const settings = getSettingsObject();
  res.json({
    scheduler: getSchedulerState(),
    lastSyncAt:
      (db.prepare('SELECT MAX(last_sync_at) AS value FROM software_source').get() as { value: string | null }).value,
    configured: {
      githubToken: Boolean(process.env.GITHUB_TOKEN),
      nvdKey: Boolean(process.env.NVD_API_KEY),
    },
    settingsUpdatedAt: settings.settings_updated_at ?? null,
  });
});

export default router;
