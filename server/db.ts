import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
db.prepare("UPDATE radar_item SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''").run();

db.exec(`
CREATE INDEX IF NOT EXISTS idx_radar_archived ON radar_item(archived_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_radar_status ON radar_item(status);
CREATE INDEX IF NOT EXISTS idx_radar_record_item ON radar_record(radar_item_id, created_at DESC);
`);

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
