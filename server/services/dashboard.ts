import type { DashboardBriefing, DashboardData } from '../../shared/types.js';
import { db, getSetting } from '../db.js';
import { compareVersions } from '../lib/version.js';
import { listEvents } from './events.js';
import { getNotificationSummary } from './notifications.js';
import { listRadar } from './notes.js';
import { listSoftware } from './software.js';
import { getNextSyncAt, isSchedulerEnabled } from './scheduler.js';

export function getDashboard(): DashboardData {
  const software = listSoftware();
  const rows = db
    .prepare(
      `SELECT a.priority, a.severity, COALESCE(us.status, 'pending') AS status
       FROM security_advisory a
       JOIN software s ON s.id = a.software_id
       LEFT JOIN advisory_user_state us ON us.advisory_id = a.id
       WHERE s.deleted_at IS NULL AND s.watch_status = 'active'
         AND COALESCE(us.status, 'pending') NOT IN ('fixed', 'not_affected', 'ignored')`,
    )
    .all() as Array<{ priority: string; severity: string; status: string }>;

  const spectrum = { p0: 0, p1: 0, p2: 0, p3: 0 };
  for (const row of rows) {
    if (row.priority === 'P0') spectrum.p0 += 1;
    else if (row.priority === 'P1') spectrum.p1 += 1;
    else if (row.priority === 'P2') spectrum.p2 += 1;
    else spectrum.p3 += 1;
  }

  const unreadRow = db
    .prepare(
      `SELECT COUNT(*) AS count FROM intelligence_event e
       JOIN software s ON s.id = e.software_id
       LEFT JOIN user_event_state u ON u.event_id = e.id
       WHERE s.deleted_at IS NULL AND s.watch_status = 'active' AND u.read_at IS NULL`,
    )
    .get() as { count: number };

  const eolSoon = software.filter(
    (item) =>
      item.lifecycle.status === 'approaching_eol' || item.lifecycle.status === 'eol',
  ).length;

  const newVersions = software.filter((item) => {
    if (!item.currentVersion || !item.latestVersion) return false;
    return compareVersions(item.latestVersion, item.currentVersion) > 0;
  }).length;

  const sourceIssues = software.reduce((total, item) => total + item.sourceIssueCount, 0);

  const briefing: DashboardBriefing = {
    // Signals worth acting on: unresolved high-signal advisories, lifecycle
    // alerts, and failing sources. New releases are informational, not a todo.
    pending: spectrum.p0 + spectrum.p1 + spectrum.p2 + eolSoon + sourceIssues,
    openAdvisories: spectrum.p0 + spectrum.p1 + spectrum.p2 + spectrum.p3,
    p0: spectrum.p0,
    p1: spectrum.p1,
    eolSoon,
    newVersions,
    sourceIssues,
    unread: unreadRow.count,
    spectrum,
  };

  const events = listEvents({ limit: 12 });
  const radarItems = listRadar();

  const lastSync = db
    .prepare('SELECT MAX(last_sync_at) AS value FROM software_source')
    .get() as { value: string | null };

  return {
    briefing,
    events,
    notifications: getNotificationSummary(),
    software,
    radar: radarItems.slice(0, 6),
    radarCount: radarItems.length,
    lastSyncAt: lastSync?.value ?? null,
    schedulerEnabled: isSchedulerEnabled() && getSetting('sync_enabled', 'true') === 'true',
    nextSyncAt: getNextSyncAt(),
  };
}
