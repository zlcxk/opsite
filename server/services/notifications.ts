import crypto from 'node:crypto';
import type {
  DeliveryRecord,
  DeliveryStatus,
  DiscoveryCandidate,
  EventType,
  FollowTarget,
  FollowTargetType,
  NotificationItem,
  NotificationListResponse,
  NotificationMinSeverity,
  NotificationRuleType,
  NotificationSeverity,
  NotificationSummary,
  NotificationTargetType,
  Priority,
  RadarItem,
  RadarRecord,
  SubscriptionRule,
} from '../../shared/types.js';
import { db, nowIso } from '../db.js';
import {
  defaultRule,
  meetsSeverity,
  NOTIFICATION_EVENT_TYPES,
  severityFromPriority,
} from './notification-config.js';
import { getPublicSettings } from './settings.js';
import {
  escapeHtml,
  getSmtpConfigInternal,
  getSmtpConfigView,
  sanitizeSmtpError,
  sendSmtpMail,
} from './smtp.js';

const MAX_ATTEMPTS = 5;
const RETRY_MINUTES = [1, 5, 15, 60, 180];
const APP_TIMEZONE = process.env.NOTIFICATION_TIMEZONE || 'Asia/Shanghai';
const BASE_URL = (process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8787}`).replace(
  /\/+$/,
  '',
);

export class NotificationRequestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'NotificationRequestError';
    this.status = status;
  }
}

interface FollowRow {
  id: string;
  target_type: FollowTargetType;
  target_id: string;
  target_name: string;
  target_subtitle: string | null;
  target_url: string | null;
  software_id: string | null;
  created_at: string;
  updated_at: string;
}

interface RuleRow {
  event_type: NotificationRuleType;
  in_app: number;
  email: number;
  min_severity: NotificationMinSeverity;
}

interface NotificationRow {
  id: string;
  rule_type: NotificationRuleType;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  target_type: NotificationTargetType;
  target_id: string;
  target_name: string;
  event_id: string | null;
  software_id: string | null;
  link: string | null;
  source_name: string | null;
  source_url: string | null;
  created_at: string;
  read_at: string | null;
  email_status: DeliveryStatus | null;
  email_error: string | null;
}

interface DeliveryRow {
  id: string;
  notification_id: string;
  recipient: string | null;
  status: DeliveryStatus;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  title: string;
  severity: NotificationSeverity;
  body: string | null;
  target_name: string;
  link: string | null;
  source_name: string | null;
  source_url: string | null;
  notification_created_at: string;
}

export interface EventNotificationInput {
  type: EventType;
  softwareId: string;
  refId?: string | null;
  title: string;
  summary?: string | null;
  priority: Priority;
  sourceName?: string | null;
  sourceUrl?: string | null;
  upstreamPublishedAt?: string | null;
}

function mapFollow(row: FollowRow): Omit<FollowTarget, 'effectiveRules' | 'hasOverrides'> {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    targetName: row.target_name,
    targetSubtitle: row.target_subtitle,
    targetUrl: row.target_url,
    softwareId: row.software_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeRules(rules: SubscriptionRule[]): SubscriptionRule[] {
  const byType = new Map<NotificationRuleType, SubscriptionRule>();
  for (const rule of rules) {
    if (!NOTIFICATION_EVENT_TYPES.includes(rule.eventType)) continue;
    byType.set(rule.eventType, {
      eventType: rule.eventType,
      inApp: Boolean(rule.inApp),
      email: Boolean(rule.email),
      minSeverity: rule.minSeverity,
    });
  }
  return NOTIFICATION_EVENT_TYPES.map(
    (eventType) => byType.get(eventType) ?? { ...defaultRule(eventType) },
  );
}

function readRules(scopeType: 'global' | 'follow', scopeId: string): SubscriptionRule[] {
  const rows = db
    .prepare(
      `SELECT event_type, in_app, email, min_severity FROM subscription_rule
       WHERE scope_type = ? AND scope_id = ?`,
    )
    .all(scopeType, scopeId) as RuleRow[];
  return rows.map((row) => ({
    eventType: row.event_type,
    inApp: Boolean(row.in_app),
    email: Boolean(row.email),
    minSeverity: row.min_severity,
  }));
}

export function getGlobalRules(): SubscriptionRule[] {
  const saved = readRules('global', '');
  const byType = new Map(saved.map((rule) => [rule.eventType, rule]));
  return NOTIFICATION_EVENT_TYPES.map((eventType) => byType.get(eventType) ?? defaultRule(eventType));
}

export function saveGlobalRules(input: SubscriptionRule[]): SubscriptionRule[] {
  const rules = normalizeRules(input);
  const run = db.transaction(() => {
    for (const rule of rules) {
      db.prepare(
        `INSERT INTO subscription_rule
          (id, scope_type, scope_id, event_type, in_app, email, min_severity, updated_at)
         VALUES (?, 'global', '', ?, ?, ?, ?, ?)
         ON CONFLICT(scope_type, scope_id, event_type) DO UPDATE SET
           in_app = excluded.in_app, email = excluded.email,
           min_severity = excluded.min_severity, updated_at = excluded.updated_at`,
      ).run(
        `global:${rule.eventType}`,
        rule.eventType,
        rule.inApp ? 1 : 0,
        rule.email ? 1 : 0,
        rule.minSeverity,
        nowIso(),
      );
    }
  });
  run();
  return getGlobalRules();
}

export function getEffectiveRules(followId: string): SubscriptionRule[] {
  const global = new Map(getGlobalRules().map((rule) => [rule.eventType, rule]));
  const overrides = new Map(readRules('follow', followId).map((rule) => [rule.eventType, rule]));
  return NOTIFICATION_EVENT_TYPES.map(
    (eventType) => overrides.get(eventType) ?? global.get(eventType) ?? defaultRule(eventType),
  );
}

export function saveFollowRules(followId: string, input: SubscriptionRule[]): SubscriptionRule[] {
  const follow = db.prepare('SELECT id FROM follow_target WHERE id = ?').get(followId);
  if (!follow) throw new NotificationRequestError('关注对象不存在', 404);
  const rules = normalizeRules(input);
  const run = db.transaction(() => {
    db.prepare(`DELETE FROM subscription_rule WHERE scope_type = 'follow' AND scope_id = ?`).run(followId);
    for (const rule of rules) {
      db.prepare(
        `INSERT INTO subscription_rule
          (id, scope_type, scope_id, event_type, in_app, email, min_severity, updated_at)
         VALUES (?, 'follow', ?, ?, ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        followId,
        rule.eventType,
        rule.inApp ? 1 : 0,
        rule.email ? 1 : 0,
        rule.minSeverity,
        nowIso(),
      );
    }
  });
  run();
  return getEffectiveRules(followId);
}

export function clearFollowRules(followId: string): SubscriptionRule[] {
  db.prepare(`DELETE FROM subscription_rule WHERE scope_type = 'follow' AND scope_id = ?`).run(followId);
  return getEffectiveRules(followId);
}

function hasOverrides(followId: string): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM subscription_rule WHERE scope_type = 'follow' AND scope_id = ?`,
    )
    .get(followId) as { count: number };
  return row.count > 0;
}

export function findFollow(targetType: FollowTargetType, targetId: string): FollowRow | null {
  return (
    (db
      .prepare('SELECT * FROM follow_target WHERE target_type = ? AND target_id = ?')
      .get(targetType, targetId) as FollowRow | undefined) ?? null
  );
}

export function getFollow(followId: string): FollowTarget | null {
  const row = db.prepare('SELECT * FROM follow_target WHERE id = ?').get(followId) as
    | FollowRow
    | undefined;
  if (!row) return null;
  return {
    ...mapFollow(row),
    effectiveRules: getEffectiveRules(row.id),
    hasOverrides: hasOverrides(row.id),
  };
}

export function listFollows(options: { type?: FollowTargetType; q?: string } = {}): FollowTarget[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.type) {
    clauses.push('target_type = ?');
    params.push(options.type);
  }
  if (options.q) {
    clauses.push('target_name LIKE ?');
    params.push(`%${options.q.replace(/[%_\\]/g, (match) => `\\${match}`)}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM follow_target ${where} ORDER BY created_at DESC`)
    .all(...params) as FollowRow[];
  return rows.map((row) => ({
    ...mapFollow(row),
    effectiveRules: getEffectiveRules(row.id),
    hasOverrides: hasOverrides(row.id),
  }));
}

function targetSnapshot(type: FollowTargetType, id: string): Omit<
  FollowTarget,
  'id' | 'createdAt' | 'updatedAt' | 'effectiveRules' | 'hasOverrides'
> | null {
  if (type === 'software') {
    const row = db
      .prepare(
        'SELECT id, name, category, current_version, deleted_at FROM software WHERE id = ?',
      )
      .get(id) as
      | { id: string; name: string; category: string; current_version: string | null; deleted_at: string | null }
      | undefined;
    if (!row || row.deleted_at) return null;
    return {
      targetType: type,
      targetId: id,
      targetName: row.name,
      targetSubtitle: [row.category, row.current_version ? `当前 ${row.current_version}` : '版本未采集']
        .filter(Boolean)
        .join(' · '),
      targetUrl: `/software/${id}`,
      softwareId: id,
    };
  }
  if (type === 'radar') {
    const row = db.prepare('SELECT id, title, summary FROM radar_item WHERE id = ?').get(id) as
      | { id: string; title: string; summary: string }
      | undefined;
    if (!row) return null;
    return {
      targetType: type,
      targetId: id,
      targetName: row.title,
      targetSubtitle: row.summary.slice(0, 120),
      targetUrl: `/radar/${id}`,
      softwareId: null,
    };
  }
  if (type === 'discovery') {
    if (id === 'feed') {
      return {
        targetType: type,
        targetId: 'feed',
        targetName: '技术发现候选',
        targetSubtitle: '来自可信来源的新候选技术',
        targetUrl: '/discover',
        softwareId: null,
      };
    }
    const row = db
      .prepare('SELECT id, title, category, source_type FROM discovery_candidate WHERE id = ?')
      .get(id) as
      | { id: string; title: string; category: string; source_type: string }
      | undefined;
    if (!row) return null;
    return {
      targetType: type,
      targetId: id,
      targetName: row.title,
      targetSubtitle: `${row.category} · ${row.source_type}`,
      targetUrl: `/discover/${id}`,
      softwareId: null,
    };
  }
  const row = db
    .prepare(
      `SELECT a.id, a.identifier, a.title, a.severity, a.software_id, s.name AS software_name
       FROM security_advisory a JOIN software s ON s.id = a.software_id
       WHERE a.id = ? AND s.deleted_at IS NULL`,
    )
    .get(id) as
    | {
        id: string;
        identifier: string;
        title: string;
        severity: string;
        software_id: string;
        software_name: string;
      }
    | undefined;
  if (!row) return null;
  return {
    targetType: type,
    targetId: id,
    targetName: `${row.identifier} · ${row.title}`.slice(0, 200),
    targetSubtitle: `${row.software_name} · ${row.severity}`,
    targetUrl: `/software/${row.software_id}?tab=vulnerabilities&advisory=${row.id}`,
    softwareId: row.software_id,
  };
}

export function followTarget(
  type: FollowTargetType,
  targetId: string,
): { follow: FollowTarget; created: boolean } {
  const snapshot = targetSnapshot(type, targetId);
  if (!snapshot) throw new NotificationRequestError('关注对象不存在或已删除', 404);
  const existing = findFollow(type, targetId);
  if (existing) {
    db.prepare(
      `UPDATE follow_target SET target_name = ?, target_subtitle = ?, target_url = ?,
         software_id = ?, updated_at = ? WHERE id = ?`,
    ).run(
      snapshot.targetName,
      snapshot.targetSubtitle,
      snapshot.targetUrl,
      snapshot.softwareId,
      nowIso(),
      existing.id,
    );
    return { follow: getFollow(existing.id)!, created: false };
  }

  const id = crypto.randomUUID();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO follow_target
      (id, target_type, target_id, target_name, target_subtitle, target_url, software_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    type,
    targetId,
    snapshot.targetName,
    snapshot.targetSubtitle,
    snapshot.targetUrl,
    snapshot.softwareId,
    timestamp,
    timestamp,
  );
  return { follow: getFollow(id)!, created: true };
}

export function unfollow(followId: string): boolean {
  // Notifications and deliveries deliberately survive unfollowing.
  return db.prepare('DELETE FROM follow_target WHERE id = ?').run(followId).changes > 0;
}

export function getFollowStatus(
  type: FollowTargetType,
  targetId: string,
): FollowTarget | null {
  const row = findFollow(type, targetId);
  return row ? getFollow(row.id) : null;
}

function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function eventLink(input: EventNotificationInput): string {
  const tab =
    input.type === 'vulnerability' ? 'vulnerabilities' : input.type === 'release' ? 'releases' : 'lifecycle';
  const query = new URLSearchParams({ tab });
  if (input.type === 'vulnerability' && input.refId) query.set('advisory', input.refId);
  return `/software/${input.softwareId}?${query.toString()}`;
}

function softwareFollowTargets(input: EventNotificationInput): Array<[FollowTargetType, string]> {
  const targets: Array<[FollowTargetType, string]> = [['software', input.softwareId]];
  if (input.type === 'vulnerability' && input.refId) {
    targets.push(['advisory', input.refId]);
  }
  return targets;
}

function eventRuleType(input: EventNotificationInput): NotificationRuleType {
  if (input.type === 'vulnerability') {
    return input.priority === 'P0' || input.priority === 'P1'
      ? 'high_risk_advisory'
      : 'new_vulnerability';
  }
  if (input.type === 'lifecycle') return 'lifecycle_change';
  if (input.type === 'release') return 'new_release';
  return 'new_release';
}

function validEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function zonedParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
  };
}

function zoneOffsetMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    pick('year'),
    pick('month') - 1,
    pick('day'),
    pick('hour'),
    pick('minute'),
    pick('second'),
  );
  return Math.round((asUtc - date.getTime()) / 60_000);
}

function zonedDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  return new Date(guess - zoneOffsetMinutes(new Date(guess)) * 60_000);
}

export function nextDigestAt(digestTime: string, now = new Date()): Date {
  const [rawHour, rawMinute] = digestTime.split(':').map(Number);
  const hour = Number.isFinite(rawHour) ? rawHour : 9;
  const minute = Number.isFinite(rawMinute) ? rawMinute : 0;
  const local = zonedParts(now);
  const targetToday = local.hour * 60 + local.minute;
  const target = hour * 60 + minute;
  const dayOffset = target > targetToday ? 0 : 1;
  const base = new Date(Date.UTC(local.year, local.month - 1, local.day + dayOffset));
  return zonedDate(
    base.getUTCFullYear(),
    base.getUTCMonth() + 1,
    base.getUTCDate(),
    hour,
    minute,
  );
}

export function quietHoursEnd(quietHours: string, now = new Date()): Date | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)$/.exec(
    quietHours.trim(),
  );
  if (!match) return null;
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  if (start === end) return null;
  const local = zonedParts(now);
  const current = local.hour * 60 + local.minute;
  const inQuiet =
    start < end ? current >= start && current < end : current >= start || current < end;
  if (!inQuiet) return null;
  const dayOffset = end > current ? 0 : 1;
  const base = new Date(Date.UTC(local.year, local.month - 1, local.day + dayOffset));
  return zonedDate(
    base.getUTCFullYear(),
    base.getUTCMonth() + 1,
    base.getUTCDate(),
    Math.floor(end / 60),
    end % 60,
  );
}

export function computeNextAttempt(
  attempts: number,
  now = new Date(),
): { status: DeliveryStatus; nextAttemptAt: string | null } {
  if (attempts >= MAX_ATTEMPTS) return { status: 'failed', nextAttemptAt: null };
  const minutes = RETRY_MINUTES[Math.min(attempts - 1, RETRY_MINUTES.length - 1)];
  return {
    status: 'pending',
    nextAttemptAt: new Date(now.getTime() + minutes * 60_000).toISOString(),
  };
}

interface InsertNotificationInput {
  ruleType: NotificationRuleType;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  targetType: NotificationTargetType;
  targetId: string;
  targetName: string;
  eventId: string | null;
  softwareId: string | null;
  link: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  inApp: boolean;
  dedupeKey: string;
}

function queueEmail(notificationId: string, recipient: string, scheduledFor: Date): void {
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO notification_delivery
      (id, notification_id, channel, recipient, status, attempts, last_error, next_attempt_at, sent_at, created_at, updated_at)
     VALUES (?, ?, 'email', ?, 'pending', 0, NULL, ?, NULL, ?, ?)
     ON CONFLICT(notification_id, channel) DO NOTHING`,
  ).run(
    crypto.randomUUID(),
    notificationId,
    recipient,
    scheduledFor.toISOString(),
    timestamp,
    timestamp,
  );
}

function skipEmail(notificationId: string, reason: string): void {
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO notification_delivery
      (id, notification_id, channel, recipient, status, attempts, last_error, next_attempt_at, sent_at, created_at, updated_at)
     VALUES (?, ?, 'email', NULL, 'skipped', 0, ?, NULL, NULL, ?, ?)
     ON CONFLICT(notification_id, channel) DO NOTHING`,
  ).run(crypto.randomUUID(), notificationId, reason, timestamp, timestamp);
}

function scheduleEmail(notificationId: string, wanted: boolean): void {
  if (!wanted) return;
  const settings = getPublicSettings();
  const recipient = settings.emailTo.trim();
  if (!settings.emailEnabled) {
    skipEmail(notificationId, '邮件通知已关闭');
    return;
  }
  if (!recipient || !validEmail(recipient)) {
    skipEmail(notificationId, '收件邮箱未配置或不合法');
    return;
  }
  const smtp = getSmtpConfigView();
  if (!smtp.configured || !smtp.enabled) {
    skipEmail(notificationId, 'SMTP 未配置或已停用');
    return;
  }
  let scheduled = new Date();
  if (settings.emailMode === 'digest') {
    scheduled = nextDigestAt(settings.digestTime);
  } else {
    const quietEnd = quietHoursEnd(settings.quietHours);
    if (quietEnd) scheduled = quietEnd;
  }
  queueEmail(notificationId, recipient, scheduled);
}

function insertNotification(input: InsertNotificationInput, emailWanted: boolean): string | null {
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const run = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO notification
          (id, rule_type, severity, title, body, target_type, target_id, target_name,
           event_id, software_id, link, source_name, source_url, in_app, dedupe_key, created_at, read_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(dedupe_key) DO NOTHING`,
      )
      .run(
        id,
        input.ruleType,
        input.severity,
        input.title.slice(0, 500),
        input.body?.slice(0, 2000) ?? null,
        input.targetType,
        input.targetId,
        input.targetName.slice(0, 300),
        input.eventId,
        input.softwareId,
        input.link,
        input.sourceName,
        input.sourceUrl,
        input.inApp ? 1 : 0,
        input.dedupeKey,
        timestamp,
      );
    if (!result.changes) return false;
    scheduleEmail(id, emailWanted);
    return true;
  });
  return run() ? id : null;
}

function dispatchToTarget(options: {
  ruleType: NotificationRuleType;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  target: FollowRow;
  eventId: string | null;
  softwareId: string | null;
  link: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  dedupeKey: string;
}): number {
  const rule = getEffectiveRules(options.target.id).find(
    (item) => item.eventType === options.ruleType,
  );
  if (!rule || (!rule.inApp && !rule.email)) return 0;
  if (!meetsSeverity(options.severity, rule.minSeverity)) return 0;
  const created = insertNotification(
    {
      ruleType: options.ruleType,
      severity: options.severity,
      title: options.title,
      body: options.body,
      targetType: options.target.target_type,
      targetId: options.target.target_id,
      targetName: options.target.target_name,
      eventId: options.eventId,
      softwareId: options.softwareId,
      link: options.link,
      sourceName: options.sourceName,
      sourceUrl: safeHttpUrl(options.sourceUrl),
      inApp: rule.inApp,
      dedupeKey: options.dedupeKey,
    },
    rule.email,
  );
  return created ? 1 : 0;
}

export function dispatchEventCreated(input: EventNotificationInput, eventId: string): number {
  const ruleType = eventRuleType(input);
  const severity = severityFromPriority(input.priority);
  let created = 0;
  for (const [targetType, targetId] of softwareFollowTargets(input)) {
    const target = findFollow(targetType, targetId);
    if (!target) continue;
    created += dispatchToTarget({
      ruleType,
      severity,
      title: input.title,
      body: input.summary ?? null,
      target,
      eventId,
      softwareId: input.softwareId,
      link: eventLink(input),
      sourceName: input.sourceName ?? null,
      sourceUrl: input.sourceUrl ?? null,
      dedupeKey: `event:${eventId}:${targetType}:${targetId}`,
    });
  }
  return created;
}

export function dispatchEventUpdated(
  input: EventNotificationInput,
  eventId: string,
  previous: { title: string; priority: Priority; upstreamPublishedAt: string | null },
): number {
  if (input.type !== 'vulnerability') return 0;
  const upstream = input.upstreamPublishedAt ?? null;
  const changed =
    previous.title !== input.title ||
    previous.priority !== input.priority ||
    previous.upstreamPublishedAt !== upstream;
  if (!changed) return 0;

  const ruleType: NotificationRuleType =
    input.priority === 'P0' || input.priority === 'P1'
      ? 'high_risk_advisory'
      : 'advisory_update';
  const severity = severityFromPriority(input.priority);
  const signature = crypto
    .createHash('sha1')
    .update(`${input.title}|${input.priority}|${upstream ?? ''}`)
    .digest('hex')
    .slice(0, 16);

  let created = 0;
  for (const [targetType, targetId] of softwareFollowTargets(input)) {
    const target = findFollow(targetType, targetId);
    if (!target) continue;
    created += dispatchToTarget({
      ruleType,
      severity,
      title: input.title,
      body: input.summary ?? '上游公告已更新',
      target,
      eventId,
      softwareId: input.softwareId,
      link: eventLink(input),
      sourceName: input.sourceName ?? null,
      sourceUrl: input.sourceUrl ?? null,
      dedupeKey: `event:${eventId}:update:${signature}:${targetType}:${targetId}`,
    });
  }
  return created;
}

export function dispatchDiscoveryCandidate(
  candidate: DiscoveryCandidate,
  created: boolean,
): number {
  if (!created) return 0;
  const timestamp = nowIso();
  const targets = new Set<string>();
  const feed = findFollow('discovery', 'feed');
  if (feed) targets.add(feed.id);
  const single = findFollow('discovery', candidate.id);
  if (single) targets.add(single.id);

  let count = 0;
  for (const followId of targets) {
    const target = db.prepare('SELECT * FROM follow_target WHERE id = ?').get(followId) as
      | FollowRow
      | undefined;
    if (!target) continue;
    count += dispatchToTarget({
      ruleType: 'discovery',
      severity: 'normal',
      title: `发现候选：${candidate.title}`,
      body: [candidate.category, candidate.description].filter(Boolean).join(' · ') || null,
      target,
      eventId: null,
      softwareId: null,
      link: `/discover/${candidate.id}`,
      sourceName: candidate.sourceType,
      sourceUrl: candidate.sourceUrl,
      dedupeKey: `discovery:${candidate.id}:${target.target_type}:${target.target_id}:${target.id}`,
    });
  }
  return count;
}

const radarRecordLabels: Record<string, string> = {
  evaluation: '评估记录',
  trial: '试用记录',
  adoption: '采用记录',
  note: '备注',
  status_change: '状态变更',
};

/**
 * Operation alerts are global platform events, not follow targets. They use
 * the global subscription rules and point at the source/task detail page.
 */
export function dispatchOperationNotification(input: {
  ruleType: NotificationRuleType;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  targetType: 'source' | 'task';
  targetId: string;
  targetName: string;
  link: string;
  dedupeKey: string;
}): number {
  const rule = getGlobalRules().find((item) => item.eventType === input.ruleType);
  if (!rule || (!rule.inApp && !rule.email)) return 0;
  if (!meetsSeverity(input.severity, rule.minSeverity)) return 0;
  const created = insertNotification(
    {
      ruleType: input.ruleType,
      severity: input.severity,
      title: input.title,
      body: input.body,
      targetType: input.targetType,
      targetId: input.targetId,
      targetName: input.targetName,
      eventId: null,
      softwareId: null,
      link: input.link,
      sourceName: input.targetType === 'source' ? input.targetName : '采集任务',
      sourceUrl: null,
      inApp: rule.inApp,
      dedupeKey: input.dedupeKey,
    },
    rule.email,
  );
  return created ? 1 : 0;
}

export function dispatchRadarRecord(item: RadarItem, record: RadarRecord): number {
  const target = findFollow('radar', item.id);
  if (!target) return 0;
  return dispatchToTarget({
    ruleType: 'project_update',
    severity: 'normal',
    title: `${item.title} · ${radarRecordLabels[record.recordType] ?? '项目更新'}`,
    body: [record.content, record.nextAction ? `下一步：${record.nextAction}` : null]
      .filter(Boolean)
      .join('\n'),
    target,
    eventId: null,
    softwareId: null,
    link: `/radar/${item.id}`,
    sourceName: '技术雷达',
    sourceUrl: item.url,
    dedupeKey: `radar:${record.id}:${target.id}`,
  });
}

function mapNotification(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    ruleType: row.rule_type,
    severity: row.severity,
    title: row.title,
    body: row.body,
    targetType: row.target_type,
    targetId: row.target_id,
    targetName: row.target_name,
    eventId: row.event_id,
    softwareId: row.software_id,
    link: row.link,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    createdAt: row.created_at,
    readAt: row.read_at,
    emailStatus: row.email_status,
    emailError: row.email_error,
  };
}

const NOTIFICATION_SELECT = `
  SELECT n.*, d.status AS email_status, d.last_error AS email_error
  FROM notification n
  LEFT JOIN notification_delivery d ON d.notification_id = n.id AND d.channel = 'email'
  WHERE n.in_app = 1
`;

export function listNotifications(
  options: {
    unreadOnly?: boolean;
    severity?: NotificationSeverity;
    ruleType?: NotificationRuleType;
    limit?: number;
    offset?: number;
  } = {},
): NotificationListResponse {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.unreadOnly) clauses.push('n.read_at IS NULL');
  if (options.severity) {
    clauses.push('n.severity = ?');
    params.push(options.severity);
  }
  if (options.ruleType) {
    clauses.push('n.rule_type = ?');
    params.push(options.ruleType);
  }
  const where = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
  const offset = Math.max(0, options.offset ?? 0);

  const rows = db
    .prepare(
      `${NOTIFICATION_SELECT}${where}
       ORDER BY CASE n.severity WHEN 'urgent' THEN 0 WHEN 'important' THEN 1 ELSE 2 END,
                n.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as NotificationRow[];
  const total = db
    .prepare(`SELECT COUNT(*) AS count FROM notification n WHERE n.in_app = 1${where}`)
    .get(...params) as { count: number };
  const unread = db
    .prepare('SELECT COUNT(*) AS count FROM notification WHERE in_app = 1 AND read_at IS NULL')
    .get() as { count: number };

  return {
    items: rows.map(mapNotification),
    total: total.count,
    unread: unread.count,
    limit,
    offset,
  };
}

export function getNotification(id: string): NotificationItem | null {
  const row = db.prepare(`${NOTIFICATION_SELECT} AND n.id = ?`).get(id) as
    | NotificationRow
    | undefined;
  return row ? mapNotification(row) : null;
}

export function getNotificationSummary(limit = 4): NotificationSummary {
  const recent = listNotifications({ limit });
  const urgent = db
    .prepare(
      `SELECT COUNT(*) AS count FROM notification
       WHERE in_app = 1 AND read_at IS NULL AND severity = 'urgent'`,
    )
    .get() as { count: number };
  return { unread: recent.unread, urgent: urgent.count, recent: recent.items };
}

export function setNotificationRead(id: string, read: boolean): boolean {
  const result = db
    .prepare('UPDATE notification SET read_at = ? WHERE id = ?')
    .run(read ? nowIso() : null, id);
  return result.changes > 0;
}

export function markAllNotificationsRead(): void {
  db.prepare('UPDATE notification SET read_at = ? WHERE in_app = 1 AND read_at IS NULL').run(
    nowIso(),
  );
}

export function listDeliveries(options: { status?: DeliveryStatus; limit?: number } = {}): DeliveryRecord[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.status) {
    clauses.push('d.status = ?');
    params.push(options.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const rows = db
    .prepare(
      `SELECT d.*, n.title, n.severity, n.body, n.target_name, n.link, n.source_name, n.source_url,
              n.created_at AS notification_created_at
       FROM notification_delivery d JOIN notification n ON n.id = d.notification_id
       ${where}
       ORDER BY d.created_at DESC LIMIT ?`,
    )
    .all(...params, limit) as DeliveryRow[];
  return rows.map((row) => ({
    id: row.id,
    notificationId: row.notification_id,
    title: row.title,
    recipient: row.recipient,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    nextAttemptAt: row.next_attempt_at,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  }));
}

export function retryDelivery(id: string): DeliveryRecord | null {
  const row = db
    .prepare(
      `UPDATE notification_delivery SET status = 'pending', attempts = 0, last_error = NULL,
         next_attempt_at = ?, updated_at = ? WHERE id = ?`,
    )
    .run(nowIso(), nowIso(), id);
  if (!row.changes) return null;
  void processEmailQueue().catch((error) => {
    console.error('[email] queue processing failed', error);
  });
  return listDeliveries({ limit: 100 }).find((item) => item.id === id) ?? null;
}

interface EmailItem {
  title: string;
  body: string | null;
  targetName: string;
  severity: NotificationSeverity;
  link: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  createdAt: string;
}

const severityLabels: Record<NotificationSeverity, string> = {
  urgent: '紧急',
  important: '重要',
  normal: '普通',
};

function absoluteLink(link: string | null): string | null {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return safeHttpUrl(link);
  return `${BASE_URL}${link.startsWith('/') ? '' : '/'}${link}`;
}

export function buildEmailContent(
  items: EmailItem[],
  mode: 'single' | 'digest' = 'single',
): { subject: string; text: string; html: string } {
  const count = items.length;
  const subject =
    mode === 'digest' || count > 1
      ? `[Opsite] ${count} 条新通知`
      : `[Opsite] ${items[0]?.title ?? '新通知'}`;

  const textLines = items.map((item) => {
    const link = absoluteLink(item.link);
    return [
      `[${severityLabels[item.severity]}] ${item.title}`,
      `对象：${item.targetName}`,
      item.body ?? '',
      link ? `查看：${link}` : '',
      item.sourceUrl ? `来源：${item.sourceUrl}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  });
  const text = `${textLines.join('\n\n---\n\n')}\n\n--\nOpsite 运维情报台`;

  const cards = items
    .map((item) => {
      const link = absoluteLink(item.link);
      const color =
        item.severity === 'urgent' ? '#cd3d31' : item.severity === 'important' ? '#cc7d1f' : '#34715c';
      const source = item.sourceUrl
        ? `<a href="${escapeHtml(safeHttpUrl(item.sourceUrl) ?? '#')}" style="color:#6d7871;text-decoration:none">${escapeHtml(item.sourceName ?? '来源')}</a>`
        : escapeHtml(item.sourceName ?? 'Opsite');
      return `
        <tr><td style="padding:0 0 14px">
          <div style="border:1px solid #e3e7df;border-radius:12px;padding:16px 18px;background:#fbfcfa">
            <div style="font:600 11px/1.4 -apple-system,Segoe UI,sans-serif;letter-spacing:.08em;color:${color};text-transform:uppercase">
              ${severityLabels[item.severity]} · ${escapeHtml(item.targetName)}
            </div>
            <div style="font:600 16px/1.5 -apple-system,Segoe UI,sans-serif;color:#101915;margin-top:6px">
              ${escapeHtml(item.title)}
            </div>
            ${item.body ? `<div style="font:400 13px/1.7 -apple-system,Segoe UI,sans-serif;color:#4d5b53;margin-top:6px">${escapeHtml(item.body)}</div>` : ''}
            <div style="font:400 12px/1.5 -apple-system,Segoe UI,sans-serif;color:#6d7871;margin-top:10px">
              ${source} · ${escapeHtml(new Date(item.createdAt).toLocaleString('zh-CN'))}
            </div>
            ${link ? `<a href="${escapeHtml(link)}" style="display:inline-block;margin-top:12px;padding:7px 12px;border-radius:7px;background:#101915;color:#ffffff;font:500 12px/1 -apple-system,Segoe UI,sans-serif;text-decoration:none">查看详情</a>` : ''}
          </div>
        </td></tr>`;
    })
    .join('');

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f1f3ee">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f3ee;padding:24px 12px">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
          <tr><td style="padding:0 0 16px">
            <div style="font:600 11px/1.4 -apple-system,Segoe UI,sans-serif;letter-spacing:.16em;color:#6d7871;text-transform:uppercase">OPSITE · WATCH DESK</div>
            <div style="font:600 24px/1.2 -apple-system,Segoe UI,sans-serif;color:#101915;margin-top:6px">${mode === 'digest' || count > 1 ? `今日 ${count} 条通知` : '新情报通知'}</div>
          </td></tr>
          ${cards}
          <tr><td style="padding:8px 0 0;font:400 11px/1.6 -apple-system,Segoe UI,sans-serif;color:#98a29b">
            此邮件由 Opsite 发送。可以在通知设置中调整订阅规则或关闭邮件。
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
  return { subject, text, html };
}

function deliveryItems(rows: DeliveryRow[]): EmailItem[] {
  return rows.map((row) => ({
    title: row.title,
    body: row.body,
    targetName: row.target_name,
    severity: row.severity,
    link: row.link,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    createdAt: row.notification_created_at,
  }));
}

let queueRunning = false;

type EmailSender = (input: { to: string; subject: string; text: string; html: string }) => Promise<void>;

export async function processEmailQueue(options: {
  sender?: EmailSender;
  now?: Date;
} = {}): Promise<{ sent: number; failed: number; skipped: number }> {
  if (queueRunning) return { sent: 0, failed: 0, skipped: 0 };
  queueRunning = true;
  const summary = { sent: 0, failed: 0, skipped: 0 };
  try {
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    db.prepare(
      `UPDATE notification_delivery SET status = 'pending', updated_at = ?
       WHERE channel = 'email' AND status = 'sending' AND updated_at < ?`,
    ).run(nowIso(), stale);

    const settings = getPublicSettings();
    if (!settings.emailEnabled) return summary;
    const smtp = getSmtpConfigView();
    if (!smtp.configured || !smtp.enabled) return summary;

    const now = options.now ?? new Date();
    const due = db
      .prepare(
        `SELECT d.*, n.title, n.severity, n.body, n.target_name, n.link, n.source_name,
                n.source_url, n.created_at AS notification_created_at
         FROM notification_delivery d JOIN notification n ON n.id = d.notification_id
         WHERE d.channel = 'email' AND d.status = 'pending' AND d.next_attempt_at <= ?
         ORDER BY d.next_attempt_at ASC LIMIT 40`,
      )
      .all(now.toISOString()) as DeliveryRow[];
    if (!due.length) return summary;

    const groups: DeliveryRow[][] = [];
    if (settings.emailMode === 'digest') {
      groups.push(due);
    } else {
      for (const row of due) groups.push([row]);
    }

    let smtpPassword: string | null = null;
    try {
      smtpPassword = getSmtpConfigInternal()?.password ?? null;
    } catch {
      // A decryption failure is reported on the delivery itself.
    }

    const sender: EmailSender =
      options.sender ??
      ((input) => sendSmtpMail(input));

    for (const group of groups) {
      const ids = group.map((row) => row.id);
      const marks = ids.map(() => '?').join(',');
      db.prepare(
        `UPDATE notification_delivery SET status = 'sending', updated_at = ? WHERE id IN (${marks})`,
      ).run(nowIso(), ...ids);

      const content = buildEmailContent(
        deliveryItems(group),
        settings.emailMode === 'digest' ? 'digest' : 'single',
      );
      const recipient = group[0].recipient;
      if (!recipient) {
        db.prepare(
          `UPDATE notification_delivery SET status = 'skipped', last_error = ?, updated_at = ?
           WHERE id IN (${marks})`,
        ).run('收件邮箱为空', nowIso(), ...ids);
        summary.skipped += group.length;
        continue;
      }

      try {
        await sender({ to: recipient, ...content });
        const timestamp = nowIso();
        db.prepare(
          `UPDATE notification_delivery SET status = 'sent', attempts = attempts + 1,
             last_error = NULL, sent_at = ?, next_attempt_at = NULL, updated_at = ?
           WHERE id IN (${marks})`,
        ).run(timestamp, timestamp, ...ids);
        summary.sent += group.length;
      } catch (error) {
        const message = sanitizeSmtpError(error, smtpPassword);
        const timestamp = nowIso();
        for (const row of group) {
          const attempts = row.attempts + 1;
          const next = computeNextAttempt(attempts, now);
          db.prepare(
            `UPDATE notification_delivery SET status = ?, attempts = ?, last_error = ?,
               next_attempt_at = ?, updated_at = ? WHERE id = ?`,
          ).run(next.status, attempts, message, next.nextAttemptAt, timestamp, row.id);
        }
        summary.failed += group.length;
      }
    }
    return summary;
  } finally {
    queueRunning = false;
  }
}

export async function sendTestEmail(to: string): Promise<void> {
  const config = getSmtpConfigInternal();
  if (!config) throw new Error('SMTP 尚未配置');
  if (!config.enabled) throw new Error('SMTP 已停用');
  const subject = '[Opsite] SMTP 测试邮件';
  const text = [
    '这是一封来自 Opsite 的测试邮件。',
    '',
    '如果你收到这封邮件，说明 SMTP 配置可用。',
    `发送时间：${new Date().toLocaleString('zh-CN')}`,
  ].join('\n');
  const html = `<div style="font:14px/1.7 -apple-system,Segoe UI,sans-serif;color:#101915;padding:20px">
    <h2 style="font-size:18px;margin:0 0 10px">SMTP 测试成功</h2>
    <p style="margin:0 0 8px">这是一封来自 Opsite 的测试邮件。</p>
    <p style="margin:0;color:#6d7871">发送时间：${escapeHtml(new Date().toLocaleString('zh-CN'))}</p>
  </div>`;
  try {
    await sendSmtpMail({ to, subject, text, html });
  } catch (error) {
    throw new Error(sanitizeSmtpError(error, config.password));
  }
}
