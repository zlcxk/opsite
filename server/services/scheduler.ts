import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { DiscoveryOverview } from '../../shared/types.js';
import { getSetting } from '../db.js';
import { syncAllActive } from './sync.js';
import {
  isDiscoveryRunning,
  markInterruptedDiscoveryJobs,
  startDiscoveryRun,
} from './discovery.js';

let syncTask: ScheduledTask | null = null;
let discoveryTask: ScheduledTask | null = null;
let running = false;
let lastRunAt: string | null = null;

const discoveryTimezone = process.env.DISCOVERY_TIMEZONE || 'Asia/Shanghai';
const discoveryCron = process.env.DISCOVERY_CRON || '0 9 * * *';

export function isSchedulerEnabled(): boolean {
  return syncTask !== null && process.env.DISABLE_SCHEDULER !== 'true';
}

export function getNextSyncAt(): string | null {
  if (!syncTask || process.env.DISABLE_SCHEDULER === 'true') return null;
  try {
    const next = syncTask.getNextRun();
    return next ? next.toISOString() : null;
  } catch {
    return null;
  }
}

export function getSchedulerState(): { enabled: boolean; nextSyncAt: string | null; lastRunAt: string | null } {
  return {
    enabled: isSchedulerEnabled(),
    nextSyncAt: getNextSyncAt(),
    lastRunAt,
  };
}

function isDiscoveryScheduleEnabled(): boolean {
  return (
    discoveryTask !== null &&
    process.env.DISABLE_SCHEDULER !== 'true' &&
    process.env.DISCOVERY_ENABLED !== 'false'
  );
}

export function getDiscoveryScheduleState(): DiscoveryOverview['scheduler'] {
  let nextRunAt: string | null = null;
  if (discoveryTask && process.env.DISABLE_SCHEDULER !== 'true') {
    try {
      const next = discoveryTask.getNextRun();
      nextRunAt = next ? next.toISOString() : null;
    } catch {
      nextRunAt = null;
    }
  }
  return {
    enabled: isDiscoveryScheduleEnabled(),
    nextRunAt,
    timezone: discoveryTimezone,
    cron: discoveryCron,
  };
}

function startSyncSchedule(): void {
  if (getSetting('sync_enabled', 'true') !== 'true') return;
  const expression = getSetting('sync_cron', process.env.SYNC_CRON || '0 */6 * * *');
  if (!cron.validate(expression)) {
    console.warn(`[scheduler] invalid cron expression: ${expression}`);
    return;
  }

  syncTask = cron.schedule(expression, async () => {
    if (running) {
      console.warn('[scheduler] previous collection still running, skip this tick');
      return;
    }
    running = true;
    lastRunAt = new Date().toISOString();
    try {
      const result = await syncAllActive('schedule');
      console.log(`[scheduler] sync complete: ${result.succeeded}/${result.total} succeeded`);
    } catch (error) {
      console.error('[scheduler] sync failed:', error);
    } finally {
      running = false;
      lastRunAt = new Date().toISOString();
    }
  });
  console.log(`[scheduler] enabled with "${expression}"`);
}

function startDiscoverySchedule(): void {
  if (process.env.DISCOVERY_ENABLED === 'false') {
    console.log('[discovery-scheduler] disabled by DISCOVERY_ENABLED=false');
    return;
  }
  if (!cron.validate(discoveryCron)) {
    console.warn(`[discovery-scheduler] invalid cron expression: ${discoveryCron}`);
    return;
  }

  discoveryTask = cron.schedule(
    discoveryCron,
    () => {
      if (isDiscoveryRunning()) {
        console.warn('[discovery-scheduler] previous discovery run still running, skip this tick');
        return;
      }
      const result = startDiscoveryRun('schedule');
      console.log(
        result.started
          ? '[discovery-scheduler] discovery run started'
          : `[discovery-scheduler] skipped: ${result.reason}`,
      );
    },
    { timezone: discoveryTimezone },
  );
  console.log(
    `[discovery-scheduler] enabled with "${discoveryCron}" (${discoveryTimezone})`,
  );
}

export function startScheduler(): void {
  stopScheduler();

  // Any job left in "running" belongs to a previous process. Do this even when
  // scheduled runs are disabled, otherwise the UI would report it as running forever.
  if (!isDiscoveryRunning()) markInterruptedDiscoveryJobs();

  if (process.env.DISABLE_SCHEDULER === 'true') return;

  startSyncSchedule();
  startDiscoverySchedule();
}

export function stopScheduler(): void {
  if (syncTask) {
    syncTask.stop();
    syncTask.destroy();
    syncTask = null;
  }
  if (discoveryTask) {
    discoveryTask.stop();
    discoveryTask.destroy();
    discoveryTask = null;
  }
}

export function rescheduleScheduler(): void {
  startScheduler();
}
