import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DISCOVERY_RULES, DEFAULT_DISCOVERY_SOURCES } from './services/discovery-config.js';
import { DEFAULT_GLOBAL_RULES } from './services/notification-config.js';
import {
  COLLECTION_TASK_DEFINITIONS,
  DATA_SOURCE_DEFINITIONS,
} from './services/operations-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');

fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'opsite.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS software (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  aliases TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL DEFAULT '其他',
  logo_url TEXT,
  website TEXT,
  repo TEXT,
  description TEXT,
  watch_status TEXT NOT NULL DEFAULT 'active',
  watch_level TEXT NOT NULL DEFAULT 'normal',
  current_version TEXT,
  environment TEXT,
  notes TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  latest_version TEXT,
  latest_release_at TEXT,
  catalog_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS software_source (
  id TEXT PRIMARY KEY,
  software_id TEXT NOT NULL REFERENCES software(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config TEXT NOT NULL DEFAULT '{}',
  last_sync_at TEXT,
  last_status TEXT NOT NULL DEFAULT 'never',
  last_error TEXT,
  last_item_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_software ON software_source(software_id);

CREATE TABLE IF NOT EXISTS lifecycle_record (
  id TEXT PRIMARY KEY,
  software_id TEXT NOT NULL REFERENCES software(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES software_source(id) ON DELETE SET NULL,
  cycle TEXT NOT NULL,
  release_date TEXT,
  latest_version TEXT,
  latest_release_date TEXT,
  eol_date TEXT,
  eol_raw TEXT,
  support_status TEXT NOT NULL DEFAULT 'unknown',
  source_url TEXT,
  fetched_at TEXT NOT NULL,
  raw TEXT,
  UNIQUE(software_id, source_id, cycle)
);
CREATE INDEX IF NOT EXISTS idx_lifecycle_software ON lifecycle_record(software_id);

CREATE TABLE IF NOT EXISTS release_record (
  id TEXT PRIMARY KEY,
  software_id TEXT NOT NULL REFERENCES software(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES software_source(id) ON DELETE SET NULL,
  external_id TEXT NOT NULL,
  version TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'stable',
  title TEXT,
  notes TEXT,
  url TEXT,
  published_at TEXT,
  first_seen_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  raw TEXT,
  UNIQUE(software_id, source_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_release_software ON release_record(software_id, published_at DESC);

CREATE TABLE IF NOT EXISTS security_advisory (
  id TEXT PRIMARY KEY,
  software_id TEXT NOT NULL REFERENCES software(id) ON DELETE CASCADE,
  identifier TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL DEFAULT 'unknown',
  score REAL,
  score_source TEXT,
  url TEXT,
  published_at TEXT,
  upstream_updated_at TEXT,
  kev INTEGER NOT NULL DEFAULT 0,
  kev_due_date TEXT,
  version_impact TEXT NOT NULL DEFAULT 'insufficient',
  priority TEXT NOT NULL DEFAULT 'P3',
  confidence TEXT NOT NULL DEFAULT 'low',
  fixed_versions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(software_id, identifier)
);
CREATE INDEX IF NOT EXISTS idx_advisory_software ON security_advisory(software_id);
CREATE INDEX IF NOT EXISTS idx_advisory_priority ON security_advisory(priority);

CREATE TABLE IF NOT EXISTS advisory_source (
  id TEXT PRIMARY KEY,
  advisory_id TEXT NOT NULL REFERENCES security_advisory(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES software_source(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL,
  external_id TEXT,
  url TEXT,
  fetched_at TEXT NOT NULL,
  raw TEXT,
  UNIQUE(advisory_id, source_type, external_id)
);
CREATE INDEX IF NOT EXISTS idx_advisory_source_advisory ON advisory_source(advisory_id);

CREATE TABLE IF NOT EXISTS advisory_affected_range (
  id TEXT PRIMARY KEY,
  advisory_id TEXT NOT NULL REFERENCES security_advisory(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES software_source(id) ON DELETE SET NULL,
  range_text TEXT,
  introduced TEXT,
  fixed TEXT,
  last_affected TEXT,
  ecosystem TEXT,
  confidence TEXT NOT NULL DEFAULT 'low',
  raw TEXT
);
CREATE INDEX IF NOT EXISTS idx_range_advisory ON advisory_affected_range(advisory_id);

CREATE TABLE IF NOT EXISTS advisory_user_state (
  advisory_id TEXT PRIMARY KEY REFERENCES security_advisory(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intelligence_event (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  software_id TEXT NOT NULL REFERENCES software(id) ON DELETE CASCADE,
  ref_id TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  priority TEXT NOT NULL DEFAULT 'P3',
  source_name TEXT,
  source_url TEXT,
  first_seen_at TEXT NOT NULL,
  upstream_published_at TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_software ON intelligence_event(software_id);
CREATE INDEX IF NOT EXISTS idx_event_created ON intelligence_event(first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_priority ON intelligence_event(priority, first_seen_at DESC);

CREATE TABLE IF NOT EXISTS user_event_state (
  event_id TEXT PRIMARY KEY REFERENCES intelligence_event(id) ON DELETE CASCADE,
  read_at TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS follow_target (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_name TEXT NOT NULL,
  target_subtitle TEXT,
  target_url TEXT,
  software_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_follow_type ON follow_target(target_type, created_at DESC);

CREATE TABLE IF NOT EXISTS subscription_rule (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  in_app INTEGER NOT NULL DEFAULT 0,
  email INTEGER NOT NULL DEFAULT 0,
  min_severity TEXT NOT NULL DEFAULT 'all',
  updated_at TEXT NOT NULL,
  UNIQUE(scope_type, scope_id, event_type)
);
CREATE INDEX IF NOT EXISTS idx_subscription_scope ON subscription_rule(scope_type, scope_id);

CREATE TABLE IF NOT EXISTS notification (
  id TEXT PRIMARY KEY,
  rule_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'normal',
  title TEXT NOT NULL,
  body TEXT,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_name TEXT NOT NULL,
  event_id TEXT,
  software_id TEXT,
  link TEXT,
  source_name TEXT,
  source_url TEXT,
  in_app INTEGER NOT NULL DEFAULT 1,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notification_created ON notification(in_app, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_unread ON notification(in_app, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_target ON notification(target_type, target_id);

CREATE TABLE IF NOT EXISTS notification_delivery (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notification(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'email',
  recipient TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(notification_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_delivery_due ON notification_delivery(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_delivery_created ON notification_delivery(created_at DESC);

CREATE TABLE IF NOT EXISTS smtp_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  host TEXT NOT NULL DEFAULT '',
  port INTEGER NOT NULL DEFAULT 587,
  encryption TEXT NOT NULL DEFAULT 'starttls',
  username TEXT NOT NULL DEFAULT '',
  password_ciphertext TEXT,
  from_name TEXT NOT NULL DEFAULT 'Opsite',
  from_email TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_job (
  id TEXT PRIMARY KEY,
  software_id TEXT NOT NULL REFERENCES software(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES software_source(id) ON DELETE SET NULL,
  source_type TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  trigger TEXT NOT NULL DEFAULT 'manual',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  items_found INTEGER NOT NULL DEFAULT 0,
  items_new INTEGER NOT NULL DEFAULT 0,
  items_updated INTEGER NOT NULL DEFAULT 0,
  items_skipped INTEGER NOT NULL DEFAULT 0,
  data_changed INTEGER NOT NULL DEFAULT 0,
  run_id TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_started ON sync_job(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_software ON sync_job(software_id, started_at DESC);

CREATE TABLE IF NOT EXISTS kev_entry (
  cve_id TEXT PRIMARY KEY,
  vendor_project TEXT,
  product TEXT,
  vulnerability_name TEXT,
  date_added TEXT,
  short_description TEXT,
  required_action TEXT,
  due_date TEXT,
  known_ransomware_use TEXT,
  notes TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS radar_item (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'tool',
  url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_evaluated_at TEXT,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS radar_record (
  id TEXT PRIMARY KEY,
  radar_item_id TEXT NOT NULL REFERENCES radar_item(id) ON DELETE CASCADE,
  record_type TEXT NOT NULL DEFAULT 'note',
  content TEXT NOT NULL,
  next_action TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_note (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  related_software_id TEXT REFERENCES software(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discovery_source (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error_summary TEXT,
  last_status TEXT NOT NULL DEFAULT 'never',
  last_result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discovery_rule (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES discovery_source(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '其他',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_result TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_id, name)
);
CREATE INDEX IF NOT EXISTS idx_discovery_rule_source ON discovery_rule(source_id, enabled);

CREATE TABLE IF NOT EXISTS discovery_candidate (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  source_ref TEXT,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT '其他',
  status TEXT NOT NULL DEFAULT 'pending',
  canonical_url TEXT NOT NULL,
  homepage_url TEXT,
  source_url TEXT,
  source_created_at TEXT,
  source_updated_at TEXT,
  source_pushed_at TEXT,
  stars_count INTEGER,
  forks_count INTEGER,
  language TEXT,
  license TEXT,
  first_discovered_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_fetched_at TEXT NOT NULL,
  radar_item_id TEXT REFERENCES radar_item(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_type, source_item_id)
);
CREATE INDEX IF NOT EXISTS idx_discovery_status ON discovery_candidate(status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_category ON discovery_candidate(category);
CREATE INDEX IF NOT EXISTS idx_discovery_canonical ON discovery_candidate(canonical_url);
CREATE INDEX IF NOT EXISTS idx_discovery_radar ON discovery_candidate(radar_item_id);

CREATE TABLE IF NOT EXISTS discovery_candidate_source (
  candidate_id TEXT NOT NULL REFERENCES discovery_candidate(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  source_ref TEXT,
  source_url TEXT,
  source_updated_at TEXT,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (source_type, source_item_id)
);
CREATE INDEX IF NOT EXISTS idx_discovery_candidate_source ON discovery_candidate_source(candidate_id);

CREATE TABLE IF NOT EXISTS discovery_job (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  items_found INTEGER NOT NULL DEFAULT 0,
  items_new INTEGER NOT NULL DEFAULT 0,
  items_updated INTEGER NOT NULL DEFAULT 0,
  items_skipped INTEGER NOT NULL DEFAULT 0,
  items_duplicate INTEGER NOT NULL DEFAULT 0,
  run_id TEXT,
  error_summary TEXT
);
CREATE INDEX IF NOT EXISTS idx_discovery_job_started ON discovery_job(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_job_source ON discovery_job(source_type, started_at DESC);

CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  official_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  health_status TEXT NOT NULL DEFAULT 'unknown',
  last_check_at TEXT,
  last_success_at TEXT,
  last_failure_at TEXT,
  last_data_updated_at TEXT,
  freshness_interval INTEGER NOT NULL DEFAULT 24,
  freshness_grace_period INTEGER NOT NULL DEFAULT 12,
  freshness_enabled INTEGER NOT NULL DEFAULT 1,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_error_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_data_source_type ON data_sources(type, name);
CREATE INDEX IF NOT EXISTS idx_data_source_health ON data_sources(health_status);

CREATE TABLE IF NOT EXISTS collection_tasks (
  id TEXT PRIMARY KEY,
  task_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  description TEXT,
  schedule TEXT NOT NULL,
  schedule_custom INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  timeout_seconds INTEGER NOT NULL DEFAULT 120,
  last_run_at TEXT,
  next_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collection_task_source ON collection_tasks(source_id);

CREATE TABLE IF NOT EXISTS collection_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES collection_tasks(id),
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collection_run_task ON collection_runs(task_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_run_source ON collection_runs(source_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_run_status ON collection_runs(status, started_at DESC);

CREATE TABLE IF NOT EXISTS source_health_checks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  status TEXT NOT NULL,
  response_time_ms INTEGER,
  http_status INTEGER,
  error_message TEXT,
  checked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_health_source ON source_health_checks(source_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS source_quota_records (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  quota_limit INTEGER,
  quota_remaining INTEGER,
  quota_used INTEGER,
  reset_at TEXT,
  rate_limited INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_quota_source ON source_quota_records(source_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS operation_alerts (
  id TEXT PRIMARY KEY,
  alert_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  source_id TEXT REFERENCES data_sources(id),
  task_id TEXT REFERENCES collection_tasks(id),
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  cycle INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_operation_alert_status ON operation_alerts(status, last_seen_at DESC);
`);

// Forward-compatible migration for databases created by earlier releases.
// Existing radar rows are preserved; new columns receive safe defaults.
function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('radar_item', 'status', "TEXT NOT NULL DEFAULT 'pending'");
ensureColumn('radar_item', 'updated_at', 'TEXT');
ensureColumn('radar_item', 'last_evaluated_at', 'TEXT');
ensureColumn('radar_item', 'archived_at', 'TEXT');
ensureColumn('sync_job', 'run_id', 'TEXT');
ensureColumn('sync_job', 'items_updated', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('sync_job', 'items_skipped', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('sync_job', 'data_changed', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('discovery_job', 'run_id', 'TEXT');
ensureColumn('discovery_job', 'items_skipped', 'INTEGER NOT NULL DEFAULT 0');
// Tasks seeded from the global sync schedule keep following it until the user
// edits that task's cron directly.
ensureColumn('collection_tasks', 'schedule_custom', 'INTEGER NOT NULL DEFAULT 0');
db.prepare("UPDATE radar_item SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''").run();

db.exec(`
CREATE INDEX IF NOT EXISTS idx_radar_archived ON radar_item(archived_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_radar_status ON radar_item(status);
CREATE INDEX IF NOT EXISTS idx_radar_record_item ON radar_record(radar_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_job_run ON sync_job(run_id);
CREATE INDEX IF NOT EXISTS idx_discovery_job_run ON discovery_job(run_id);
`);

const seedTimestamp = new Date().toISOString();
for (const source of DEFAULT_DISCOVERY_SOURCES) {
  db.prepare(
    `INSERT INTO discovery_source (id, type, name, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(source.id, source.type, source.name, source.enabled ? 1 : 0, seedTimestamp, seedTimestamp);
}
for (const rule of DEFAULT_DISCOVERY_RULES) {
  db.prepare(
    `INSERT INTO discovery_rule (id, source_id, name, query, category, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(
    rule.id,
    rule.sourceId,
    rule.name,
    rule.query,
    rule.category,
    rule.enabled ? 1 : 0,
    seedTimestamp,
    seedTimestamp,
  );
}

// Global subscription defaults are seeded once. Existing databases keep any
// choices the user has already made.
for (const rule of DEFAULT_GLOBAL_RULES) {
  db.prepare(
    `INSERT INTO subscription_rule
      (id, scope_type, scope_id, event_type, in_app, email, min_severity, updated_at)
     VALUES (?, 'global', '', ?, ?, ?, ?, ?)
     ON CONFLICT(scope_type, scope_id, event_type) DO NOTHING`,
  ).run(
    `global:${rule.eventType}`,
    rule.eventType,
    rule.inApp ? 1 : 0,
    rule.email ? 1 : 0,
    rule.minSeverity,
    seedTimestamp,
  );
}

// P4 source and task registry. Existing choices are never overwritten.
const syncSchedule = getSetting('sync_cron', process.env.SYNC_CRON || '0 */6 * * *');
const discoverySchedule = process.env.DISCOVERY_CRON || '0 9 * * *';
for (const source of DATA_SOURCE_DEFINITIONS) {
  db.prepare(
    `INSERT INTO data_sources
      (id, source_key, name, type, description, official_url, enabled, health_status,
       freshness_interval, freshness_grace_period, freshness_enabled, consecutive_failures,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(source_key) DO NOTHING`,
  ).run(
    `source_${source.key}`,
    source.key,
    source.name,
    source.type,
    source.description,
    source.officialUrl,
    source.enabled ? 1 : 0,
    source.enabled ? 'unknown' : 'disabled',
    source.freshnessInterval,
    source.freshnessGracePeriod,
    source.freshnessEnabled ? 1 : 0,
    seedTimestamp,
    seedTimestamp,
  );
}
// Older P4 databases only knew "unknown" for a disabled source. Keep the
// displayed health status aligned with the enabled flag so filters and stats
// do not count suspended sources as healthy or abnormal.
db.prepare(
  `UPDATE data_sources SET health_status = 'disabled'
   WHERE enabled = 0 AND health_status != 'disabled'`,
).run();
for (const task of COLLECTION_TASK_DEFINITIONS) {
  const source = DATA_SOURCE_DEFINITIONS.find((item) => item.key === task.sourceKey);
  const schedule = source?.group === 'discovery' ? discoverySchedule : syncSchedule;
  db.prepare(
    `INSERT INTO collection_tasks
      (id, task_key, name, source_id, description, schedule, enabled, timeout_seconds,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(task_key) DO NOTHING`,
  ).run(
    `task_${task.key}`,
    task.key,
    task.name,
    `source_${task.sourceKey}`,
    task.description,
    schedule,
    task.enabled ? 1 : 0,
    task.timeoutSeconds,
    seedTimestamp,
    seedTimestamp,
  );
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function getSetting(key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, nowIso());
}

export function getSettingsObject(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
