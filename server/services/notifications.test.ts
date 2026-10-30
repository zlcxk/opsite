import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let dataDir: string;
let dbModule: typeof import('../db.js');
let notifications: typeof import('./notifications.js');
let events: typeof import('./events.js');
let softwareService: typeof import('./software.js');
let notes: typeof import('./notes.js');
let discovery: typeof import('./discovery.js');
let settingsService: typeof import('./settings.js');
let smtp: typeof import('./smtp.js');

let softwareId = '';

function createSoftware(name: string): string {
  return softwareService.createSoftware({ name, sources: [] });
}

function event(
  input: Partial<Parameters<typeof events.upsertEvent>[0]> & {
    title: string;
    dedupeKey: string;
    refId?: string;
    priority?: 'P0' | 'P1' | 'P2' | 'P3';
  },
) {
  return events.upsertEvent({
    type: 'vulnerability',
    softwareId,
    summary: '测试摘要',
    priority: 'P1',
    sourceName: 'GitHub Advisory',
    sourceUrl: 'https://github.com/advisories/GHSA-test',
    ...input,
  });
}

function notificationsFor(targetType: 'software' | 'advisory' | 'discovery' | 'radar', targetId: string) {
  return notifications
    .listNotifications({ limit: 100 })
    .items.filter((item) => item.targetType === targetType && item.targetId === targetId);
}

function makeDue(notificationId: string): void {
  dbModule.db
    .prepare(
      `UPDATE notification_delivery SET next_attempt_at = ? WHERE notification_id = ? AND status = 'pending'`,
    )
    .run(new Date(Date.now() - 60_000).toISOString(), notificationId);
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsite-notifications-'));
  process.env.DATA_DIR = dataDir;
  process.env.PUBLIC_BASE_URL = 'https://opsite.example.com';
  dbModule = await import('../db.js');
  notifications = await import('./notifications.js');
  events = await import('./events.js');
  softwareService = await import('./software.js');
  notes = await import('./notes.js');
  discovery = await import('./discovery.js');
  settingsService = await import('./settings.js');
  smtp = await import('./smtp.js');
  softwareId = createSoftware('Redis');
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

describe('follow targets and subscription rules', () => {
  it('deduplicates follows and keeps the target snapshot', () => {
    const first = notifications.followTarget('software', softwareId);
    const second = notifications.followTarget('software', softwareId);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.follow.id).toBe(first.follow.id);
    expect(second.follow.targetName).toBe('Redis');
    expect(notifications.listFollows({ type: 'software' })).toHaveLength(1);
  });

  it('rejects unknown targets instead of accepting arbitrary URLs', () => {
    expect(() => notifications.followTarget('discovery', 'https://evil.example.com')).toThrow(
      notifications.NotificationRequestError,
    );
    expect(() => notifications.followTarget('software', 'missing-software')).toThrow(
      notifications.NotificationRequestError,
    );
  });

  it('merges global defaults with per-target overrides', () => {
    const follow = notifications.followTarget('software', softwareId).follow;
    expect(follow.hasOverrides).toBe(false);
    const global = notifications.getGlobalRules();
    const highRisk = global.find((rule) => rule.eventType === 'high_risk_advisory');
    expect(highRisk?.inApp).toBe(true);

    const rules = notifications
      .getEffectiveRules(follow.id)
      .map((rule) =>
        rule.eventType === 'high_risk_advisory'
          ? { ...rule, email: true, minSeverity: 'important' as const }
          : rule,
      );
    notifications.saveFollowRules(follow.id, rules);
    const effective = notifications.getEffectiveRules(follow.id);
    expect(effective.find((rule) => rule.eventType === 'high_risk_advisory')).toMatchObject({
      email: true,
      minSeverity: 'important',
    });
    expect(notifications.getFollow(follow.id)?.hasOverrides).toBe(true);

    notifications.clearFollowRules(follow.id);
    expect(notifications.getFollow(follow.id)?.hasOverrides).toBe(false);
    expect(
      notifications.getEffectiveRules(follow.id).find((rule) => rule.eventType === 'high_risk_advisory'),
    ).toMatchObject({ inApp: true, email: false, minSeverity: 'all' });
  });
});

describe('notification generation', () => {
  it('only notifies followed targets and only for enabled rule types', () => {
    const other = createSoftware('PostgreSQL');
    event({
      title: 'CVE-2026-0001 · Redis 严重漏洞',
      dedupeKey: 'test:new:1',
      refId: 'adv-1',
    });
    expect(notificationsFor('software', softwareId)).toHaveLength(1);
    expect(notificationsFor('software', other)).toHaveLength(0);

    const release = events.upsertEvent({
      type: 'release',
      softwareId,
      title: 'Redis 发布 8.0.1',
      summary: null,
      priority: 'P3',
      dedupeKey: 'release:test:1',
    });
    expect(release.created).toBe(true);
    // new_release is opt-in and off by default.
    expect(notificationsFor('software', softwareId)).toHaveLength(1);
  });

  it('is idempotent for repeated collection and suppresses unchanged events', () => {
    const first = event({
      title: 'CVE-2026-0002 · Redis 高危漏洞',
      dedupeKey: 'test:new:2',
      refId: 'adv-2',
    });
    const again = event({
      title: 'CVE-2026-0002 · Redis 高危漏洞',
      dedupeKey: 'test:new:2',
      refId: 'adv-2',
    });
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(notificationsFor('software', softwareId)).toHaveLength(2);
  });

  it('creates one advisory update notification when upstream data changes', () => {
    event({
      title: 'CVE-2026-0002 · Redis 高危漏洞',
      dedupeKey: 'test:new:2',
      refId: 'adv-2',
      priority: 'P1',
    });
    event({
      title: 'CVE-2026-0002 · Redis 高危漏洞（KEV 已利用）',
      dedupeKey: 'test:new:2',
      refId: 'adv-2',
      priority: 'P1',
      sourceName: 'CISA KEV',
    });
    event({
      title: 'CVE-2026-0002 · Redis 高危漏洞（KEV 已利用）',
      dedupeKey: 'test:new:2',
      refId: 'adv-2',
      priority: 'P1',
      sourceName: 'CISA KEV',
    });
    // The first pass created the original row; only the title change adds one.
    expect(notificationsFor('software', softwareId)).toHaveLength(3);
  });

  it('supports advisory follows and severity thresholds', () => {
    const advisoryId = dbModule.db
      .prepare("SELECT id FROM security_advisory WHERE identifier = 'CVE-2026-0003'")
      .get() as { id: string } | undefined;
    expect(advisoryId).toBeUndefined();

    const advisoryRowId = crypto.randomUUID();
    dbModule.db
      .prepare(
        `INSERT INTO security_advisory
          (id, software_id, identifier, title, severity, priority, created_at, updated_at)
         VALUES (?, ?, 'CVE-2026-0003', 'Redis 权限提升', 'high', 'P2', ?, ?)`,
      )
      .run(advisoryRowId, softwareId, new Date().toISOString(), new Date().toISOString());

    const follow = notifications.followTarget('advisory', advisoryRowId).follow;
    const rules = notifications
      .getEffectiveRules(follow.id)
      .map((rule) =>
        rule.eventType === 'new_vulnerability' ? { ...rule, inApp: true, minSeverity: 'urgent' as const } : rule,
      );
    notifications.saveFollowRules(follow.id, rules);

    event({
      title: 'CVE-2026-0003 · Redis 权限提升',
      dedupeKey: 'test:new:3',
      refId: advisoryRowId,
      priority: 'P2',
    });
    expect(notificationsFor('advisory', advisoryRowId)).toHaveLength(0);

    event({
      title: 'CVE-2026-0003 · Redis 权限提升',
      dedupeKey: 'test:new:3',
      refId: advisoryRowId,
      priority: 'P0',
    });
    expect(notificationsFor('advisory', advisoryRowId)).toHaveLength(1);
  });

  it('tracks read state globally and per notification', () => {
    const target = notificationsFor('software', softwareId);
    const first = target[0];
    expect(notifications.getNotificationSummary().unread).toBeGreaterThan(0);
    expect(notifications.setNotificationRead(first.id, true)).toBe(true);
    expect(notifications.getNotification(first.id)?.readAt).not.toBeNull();
    notifications.setNotificationRead(first.id, false);
    expect(notifications.getNotification(first.id)?.readAt).toBeNull();
    notifications.markAllNotificationsRead();
    expect(notifications.getNotificationSummary().unread).toBe(0);
  });
});

describe('email delivery', () => {
  beforeAll(() => {
    settingsService.updateSettings({
      emailEnabled: true,
      emailTo: 'ops@example.com',
      emailMode: 'realtime',
      quietHours: '',
    });
    smtp.saveSmtpConfig({
      enabled: true,
      host: 'smtp.example.com',
      port: 587,
      encryption: 'starttls',
      username: 'mailer',
      password: 'supersecret',
      fromName: 'Opsite',
      fromEmail: 'opsite@example.com',
    });
    const rules = notifications
      .getGlobalRules()
      .map((rule) =>
        rule.eventType === 'high_risk_advisory' ? { ...rule, email: true } : rule,
      );
    notifications.saveGlobalRules(rules);
  });

  it('queues and sends one email per notification, idempotently', async () => {
    event({
      title: 'CVE-2026-0010 · Redis 邮件测试',
      dedupeKey: 'test:email:1',
      refId: 'adv-email-1',
      priority: 'P1',
      sourceUrl: 'javascript:alert(1)',
    });
    const item = notificationsFor('software', softwareId).find((entry) =>
      entry.title.includes('CVE-2026-0010'),
    );
    expect(item?.emailStatus).toBe('pending');
    makeDue(item!.id);

    const sends: Array<{ to: string; subject: string; html: string }> = [];
    const summary = await notifications.processEmailQueue({
      sender: async (input) => {
        sends.push(input);
      },
    });
    expect(summary.sent).toBe(1);
    expect(sends).toHaveLength(1);
    expect(sends[0].to).toBe('ops@example.com');
    expect(sends[0].html).not.toContain('javascript:alert');
    expect(notifications.getNotification(item!.id)?.emailStatus).toBe('sent');

    const second = await notifications.processEmailQueue({
      sender: async (input) => {
        sends.push(input);
      },
    });
    expect(second.sent).toBe(0);
    expect(sends).toHaveLength(1);
  });

  it('sanitizes SMTP errors and backs off failed deliveries', async () => {
    event({
      title: 'CVE-2026-0011 · Redis 失败重试',
      dedupeKey: 'test:email:2',
      refId: 'adv-email-2',
      priority: 'P1',
    });
    const item = notificationsFor('software', softwareId).find((entry) =>
      entry.title.includes('CVE-2026-0011'),
    );
    makeDue(item!.id);

    const summary = await notifications.processEmailQueue({
      sender: async () => {
        throw Object.assign(new Error('auth failed for supersecret'), { code: 'EAUTH' });
      },
    });
    expect(summary.failed).toBe(1);
    const delivery = notifications.listDeliveries({ limit: 100 }).find(
      (entry) => entry.notificationId === item!.id,
    );
    expect(delivery?.attempts).toBe(1);
    expect(delivery?.status).toBe('pending');
    expect(delivery?.nextAttemptAt).toBeTruthy();
    expect(delivery?.lastError).toContain('EAUTH');
    expect(delivery?.lastError).not.toContain('supersecret');
  });

  it('marks deliveries skipped when email is disabled, without losing the in-app notification', () => {
    settingsService.updateSettings({ emailEnabled: false });
    event({
      title: 'CVE-2026-0012 · Redis 跳过邮件',
      dedupeKey: 'test:email:3',
      refId: 'adv-email-3',
      priority: 'P1',
    });
    settingsService.updateSettings({ emailEnabled: true });
    const item = notificationsFor('software', softwareId).find((entry) =>
      entry.title.includes('CVE-2026-0012'),
    );
    expect(item?.emailStatus).toBe('skipped');
    expect(item?.emailError).toContain('邮件通知已关闭');
    expect(item).not.toBeNull();
  });

  it('groups due messages into a single digest email', async () => {
    settingsService.updateSettings({ emailMode: 'digest', digestTime: '23:59' });
    // Move any older pending deliveries out of the way.
    dbModule.db
      .prepare(
        `UPDATE notification_delivery SET next_attempt_at = '2999-01-01T00:00:00.000Z'
         WHERE status = 'pending'`,
      )
      .run();

    const titles = ['CVE-2026-0020 · Redis 摘要一', 'CVE-2026-0021 · Redis 摘要二'];
    titles.forEach((title, index) => {
      event({
        title,
        dedupeKey: `test:digest:${index}`,
        refId: `adv-digest-${index}`,
        priority: 'P1',
      });
    });
    for (const title of titles) {
      const item = notificationsFor('software', softwareId).find((entry) => entry.title === title);
      makeDue(item!.id);
    }

    const sends: Array<{ subject: string; text: string }> = [];
    const summary = await notifications.processEmailQueue({
      sender: async (input) => {
        sends.push(input);
      },
    });
    expect(summary.sent).toBe(2);
    expect(sends).toHaveLength(1);
    expect(sends[0].subject).toContain('2 条新通知');
    expect(sends[0].text).toContain('Redis 摘要一');
    expect(sends[0].text).toContain('Redis 摘要二');
    settingsService.updateSettings({ emailMode: 'realtime' });
  });

  it('escapes external content and builds absolute links', () => {
    const content = notifications.buildEmailContent(
      [
        {
          title: '<script>alert(1)</script>',
          body: '<img src=x onerror=alert(1)>',
          targetName: 'A&B',
          severity: 'urgent',
          link: '/software/1?tab=vulnerabilities&advisory=2',
          sourceName: 'feed',
          sourceUrl: 'javascript:alert(1)',
          createdAt: new Date().toISOString(),
        },
      ],
      'single',
    );
    expect(content.html).toContain('&lt;script&gt;');
    expect(content.html).not.toContain('<script>alert(1)</script>');
    expect(content.html).not.toContain('<img src=x');
    expect(content.html).toContain('https://opsite.example.com/software/1?tab=vulnerabilities&amp;advisory=2');
  });

  it('computes digest and quiet-hour boundaries in the configured timezone', () => {
    const digest = notifications.nextDigestAt('09:00', new Date('2026-10-30T00:30:00.000Z'));
    expect(digest.toISOString()).toBe('2026-10-30T01:00:00.000Z');
    const quietEnd = notifications.quietHoursEnd(
      '22:00-07:00',
      new Date('2026-10-30T15:00:00.000Z'),
    );
    expect(quietEnd?.toISOString()).toBe('2026-10-30T23:00:00.000Z');
    expect(
      notifications.quietHoursEnd('22:00-07:00', new Date('2026-10-30T04:00:00.000Z')),
    ).toBeNull();
  });

  it('stops retrying after five attempts', () => {
    expect(notifications.computeNextAttempt(4)).toMatchObject({ status: 'pending' });
    expect(notifications.computeNextAttempt(5)).toEqual({
      status: 'failed',
      nextAttemptAt: null,
    });
  });
});

describe('discovery and radar follow targets', () => {
  it('notifies the discovery feed for new candidates only', () => {
    const rules = notifications
      .getGlobalRules()
      .map((rule) => (rule.eventType === 'discovery' ? { ...rule, inApp: true } : rule));
    notifications.saveGlobalRules(rules);
    notifications.followTarget('discovery', 'feed');

    const candidateId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    dbModule.db
      .prepare(
        `INSERT INTO discovery_candidate
          (id, source_type, source_item_id, source_ref, title, description, category, status,
           canonical_url, homepage_url, source_url, first_discovered_at, last_seen_at,
           last_fetched_at, created_at, updated_at)
         VALUES (?, 'github', 'test:1', 'demo/repo', 'DemoRepo', 'A demo catalog project',
                 '云原生', 'pending', 'https://github.com/demo/repo', NULL,
                 'https://github.com/demo/repo', ?, ?, ?, ?, ?)`,
      )
      .run(candidateId, timestamp, timestamp, timestamp, timestamp, timestamp);
    const candidate = discovery.getDiscoveryCandidate(candidateId)!;
    expect(notifications.dispatchDiscoveryCandidate(candidate, true)).toBe(1);
    expect(notifications.dispatchDiscoveryCandidate(candidate, false)).toBe(0);
    expect(notificationsFor('discovery', 'feed')).toHaveLength(1);
  });

  it('honors per-follow overrides for radar records and resets cleanly', () => {
    const item = notes.createRadar({
      title: 'OpenTelemetry Collector',
      summary: '统一遥测采集',
      kind: 'tool',
    });
    const follow = notifications.followTarget('radar', item.id).follow;
    notifications.saveGlobalRules(
      notifications
        .getGlobalRules()
        .map((rule) => (rule.eventType === 'project_update' ? { ...rule, inApp: true } : rule)),
    );

    notifications.saveFollowRules(
      follow.id,
      notifications
        .getEffectiveRules(follow.id)
        .map((rule) => (rule.eventType === 'project_update' ? { ...rule, inApp: false } : rule)),
    );
    notes.createRadarRecord(item.id, { recordType: 'note', content: '不会被通知的记录' });
    expect(notificationsFor('radar', item.id)).toHaveLength(0);

    notifications.clearFollowRules(follow.id);
    notes.createRadarRecord(item.id, { recordType: 'evaluation', content: '完成初步评估' });
    const items = notificationsFor('radar', item.id);
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain('OpenTelemetry Collector');
    expect(items[0].link).toBe(`/radar/${item.id}`);
  });
});

describe('unfollowing', () => {
  it('keeps history but stops new notifications', () => {
    const follow = notifications.getFollowStatus('software', softwareId);
    expect(follow).not.toBeNull();
    const before = notificationsFor('software', softwareId).length;

    expect(notifications.unfollow(follow!.id)).toBe(true);
    expect(notifications.getFollowStatus('software', softwareId)).toBeNull();
    event({
      title: 'CVE-2026-0099 · 取关后的漏洞',
      dedupeKey: 'test:unfollow:1',
      refId: 'adv-unfollow',
      priority: 'P1',
    });
    expect(notificationsFor('software', softwareId)).toHaveLength(before);
  });
});
