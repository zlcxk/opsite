import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { DiscoveryOverview } from '../../shared/types.js';
import { db, getSetting } from '../db.js';
import { isDiscoveryRunning } from './discovery.js';
import {
  isCollectionRunning,
  startTaskRun,
} from './operations.js';
import { refreshStaleAlerts, recoverInterruptedRuns, updateTaskNextRun } from './operations-store.js';
import { processEmailQueue } from './notifications.js';

interface TaskRow {
  id: string;
  task_key: string;
  name: string;
  source_key: string;
  source_type: string;
  schedule: string;
  enabled: number;
  source_enabled: number;
}

interface RegisteredTask {
  cron: ScheduledTask;
  row: TaskRow;
  discovery: boolean;
}

const tasks = new Map<string, RegisteredTask>();
let notificationTask: ScheduledTask | null = null;
let lastSyncRunAt: string | null = null;
let lastDiscoveryRunAt: string | null = null;

const discoveryTimezone = process.env.DISCOVERY_TIMEZONE || 'Asia/Shanghai';
const discoveryCron = process.env.DISCOVERY_CRON || '0 9 * * *';

function schedulerDisabled(): boolean {
  return process.env.DISABLE_SCHEDULER === 'true';
}

function syncEnabled(): boolean {
  return getSetting('sync_enabled', 'true') === 'true';
}

function discoveryEnabled(): boolean {
  return process.env.DISCOVERY_ENABLED !== 'false';
}

export function isSchedulerEnabled(): boolean {
  return tasks.size > 0 && !schedulerDisabled();
}

function nextRunOf(task: RegisteredTask): string | null {
  if (schedulerDisabled()) return null;
  try {
    const next = task.cron.getNextRun();
    return next ? next.toISOString() : null;
  } catch {
    return null;
  }
}

export function getNextSyncAt(): string | null {
  const values = [...tasks.values()]
    .filter((task) => !task.discovery)
    .map(nextRunOf)
    .filter((value): value is string => Boolean(value))
    .sort();
  return values[0] ?? null;
}

export function getNextCollectionAt(): string | null {
  const values = [...tasks.values()]
    .map(nextRunOf)
    .filter((value): value is string => Boolean(value))
    .sort();
  return values[0] ?? null;
}

export function getSchedulerState(): {
  enabled: boolean;
  nextSyncAt: string | null;
  lastRunAt: string | null;
} {
  return {
    enabled: isSchedulerEnabled(),
    nextSyncAt: getNextSyncAt(),
    lastRunAt: lastSyncRunAt,
  };
}

export function getDiscoveryScheduleState(): DiscoveryOverview['scheduler'] {
  const values = [...tasks.values()]
    .filter((task) => task.discovery)
    .map(nextRunOf)
    .filter((value): value is string => Boolean(value))
    .sort();
  const discoveryTasks = [...tasks.values()].some((task) => task.discovery);
  return {
    enabled: discoveryTasks && !schedulerDisabled() && discoveryEnabled(),
    nextRunAt: values[0] ?? null,
    timezone: discoveryTimezone,
    cron: discoveryCron,
  };
}

function registerTask(row: TaskRow): void {
  if (!cron.validate(row.schedule)) {
    console.warn(`[scheduler] invalid cron expression for ${row.task_key}: ${row.schedule}`);
    updateTaskNextRun(row.id, null);
    return;
  }
  const discovery = row.source_type === 'discovery';
  const scheduled = cron.schedule(
    row.schedule,
    () => {
      const result = startTaskRun(row.id, 'scheduled');
      if (!result.started) {
        console.warn(`[scheduler] ${row.task_key} skipped: ${result.reason}`);
        return;
      }
      if (discovery) lastDiscoveryRunAt = new Date().toISOString();
      else lastSyncRunAt = new Date().toISOString();
      const registered = tasks.get(row.id);
      if (registered) updateTaskNextRun(row.id, nextRunOf(registered));
    },
    discovery ? { timezone: discoveryTimezone } : undefined,
  );
  const registered: RegisteredTask = { cron: scheduled, row, discovery };
  tasks.set(row.id, registered);
  updateTaskNextRun(row.id, nextRunOf(registered));
}

function taskRows(): TaskRow[] {
  return db
    .prepare(
      `SELECT t.id, t.task_key, t.name, t.schedule, t.enabled,
              s.source_key, s.type AS source_type, s.enabled AS source_enabled
       FROM collection_tasks t JOIN data_sources s ON s.id = t.source_id
       ORDER BY t.name`,
    )
    .all() as TaskRow[];
}

function clearNextRuns(): void {
  db.prepare('UPDATE collection_tasks SET next_run_at = NULL').run();
}

function startCollectionSchedules(): void {
  if (schedulerDisabled()) {
    clearNextRuns();
    return;
  }
  const rows = taskRows();
  for (const row of rows) {
    if (!row.enabled || !row.source_enabled) {
      updateTaskNextRun(row.id, null);
      continue;
    }
    if (row.source_type === 'discovery') {
      if (!discoveryEnabled()) {
        updateTaskNextRun(row.id, null);
        continue;
      }
    } else if (!syncEnabled()) {
      updateTaskNextRun(row.id, null);
      continue;
    }
    registerTask(row);
  }
  for (const task of tasks.values()) {
    console.log(
      `[scheduler] ${task.row.task_key} enabled with "${task.row.schedule}"${
        task.discovery ? ` (${discoveryTimezone})` : ''
      }`,
    );
  }
}

/**
 * Email delivery is deliberately independent of collection schedules. It runs
 * on its own minute tick even when DISABLE_SCHEDULER stops sync and discovery,
 * because in-app notifications are already stored and only the transport is
 * asynchronous.
 */
function startNotificationSchedule(): void {
  if (process.env.DISABLE_EMAIL_QUEUE === 'true') {
    console.log('[email-scheduler] disabled by DISABLE_EMAIL_QUEUE=true');
    return;
  }
  notificationTask = cron.schedule('* * * * *', () => {
    void processEmailQueue().catch((error) => {
      console.error('[email-scheduler] delivery tick failed', error);
    });
  });
  void processEmailQueue().catch((error) => {
    console.error('[email-scheduler] startup delivery failed', error);
  });
  console.log('[email-scheduler] enabled with "* * * * *"');
}

export function startScheduler(): void {
  stopScheduler();

  // A reschedule (triggered by settings) must not mark an active run as
  // interrupted. Only recover orphans when no collection is active.
  if (!isCollectionRunning() && !isDiscoveryRunning()) {
    const recovered = recoverInterruptedRuns();
    if (recovered > 0) {
      console.warn(`[scheduler] marked ${recovered} interrupted collection run(s)`);
    }
    refreshStaleAlerts();
  }

  startNotificationSchedule();
  if (schedulerDisabled()) {
    clearNextRuns();
    return;
  }
  startCollectionSchedules();
}

export function stopScheduler(): void {
  for (const task of tasks.values()) {
    task.cron.stop();
    task.cron.destroy();
  }
  tasks.clear();
  if (notificationTask) {
    notificationTask.stop();
    notificationTask.destroy();
    notificationTask = null;
  }
}

export function rescheduleScheduler(): void {
  startScheduler();
}
