import type { Settings } from '../../shared/types.js';
import { getSettingsObject, setSetting, nowIso } from '../db.js';

function bool(message: Record<string, string>, key: string, fallback: boolean): boolean {
  const value = message[key];
  if (value === undefined) return fallback;
  return value === 'true';
}

export function getPublicSettings(): Settings {
  const values = getSettingsObject();
  return {
    syncEnabled: bool(values, 'sync_enabled', true),
    syncCron: values.sync_cron || process.env.SYNC_CRON || '0 */6 * * *',
    githubTokenConfigured: Boolean(process.env.GITHUB_TOKEN),
    nvdKeyConfigured: Boolean(process.env.NVD_API_KEY),
    emailEnabled: bool(values, 'email_enabled', false),
    emailTo: values.email_to || '',
    emailMode: values.email_mode === 'digest' ? 'digest' : 'realtime',
    digestTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(values.digest_time || '') ? values.digest_time : '09:00',
    notifyP0: bool(values, 'notify_p0', true),
    notifyP1: bool(values, 'notify_p1', true),
    notifyEol: bool(values, 'notify_eol', true),
    notifyRelease: bool(values, 'notify_release', false),
    quietHours: values.quiet_hours || '',
    staleAfterHours: Number(values.stale_after_hours || 36),
  };
}

export interface SettingsPatch {
  syncEnabled?: boolean;
  syncCron?: string;
  emailEnabled?: boolean;
  emailTo?: string;
  emailMode?: 'realtime' | 'digest';
  digestTime?: string;
  notifyP0?: boolean;
  notifyP1?: boolean;
  notifyEol?: boolean;
  notifyRelease?: boolean;
  quietHours?: string;
  staleAfterHours?: number;
}

export function updateSettings(patch: SettingsPatch): void {
  const mapping: Array<[keyof SettingsPatch, string]> = [
    ['syncEnabled', 'sync_enabled'],
    ['emailEnabled', 'email_enabled'],
    ['emailTo', 'email_to'],
    ['emailMode', 'email_mode'],
    ['digestTime', 'digest_time'],
    ['notifyP0', 'notify_p0'],
    ['notifyP1', 'notify_p1'],
    ['notifyEol', 'notify_eol'],
    ['notifyRelease', 'notify_release'],
    ['quietHours', 'quiet_hours'],
  ];
  for (const [property, key] of mapping) {
    const value = patch[property];
    if (value !== undefined) setSetting(key, typeof value === 'boolean' ? String(value) : String(value));
  }
  if (patch.syncCron !== undefined) setSetting('sync_cron', patch.syncCron);
  if (patch.staleAfterHours !== undefined) {
    setSetting('stale_after_hours', String(Math.max(1, Math.min(720, patch.staleAfterHours))));
  }
  setSetting('settings_updated_at', nowIso());
}
