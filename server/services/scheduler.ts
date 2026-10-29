import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { getSetting } from '../db.js';
import { syncAllActive } from './sync.js';

let task: ScheduledTask | null = null;
let running = false;
let lastRunAt: string | null = null;

export function isSchedulerEnabled(): boolean {
  return task !== null && process.env.DISABLE_SCHEDULER !== 'true';
}

export function getNextSyncAt(): string | null {
  if (!task || process.env.DISABLE_SCHEDULER === 'true') return null;
  try {
    const next = task.getNextRun();
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

export function startScheduler(): void {
  stopScheduler();
  if (process.env.DISABLE_SCHEDULER === 'true') return;
  if (getSetting('sync_enabled', 'true') !== 'true') return;

  const expression = getSetting('sync_cron', process.env.SYNC_CRON || '0 */6 * * *');
  if (!cron.validate(expression)) {
    console.warn(`[scheduler] invalid cron expression: ${expression}`);
    return;
  }

  task = cron.schedule(expression, async () => {
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

export function stopScheduler(): void {
  if (task) {
    task.stop();
    task.destroy();
    task = null;
  }
}

export function rescheduleScheduler(): void {
  startScheduler();
}
