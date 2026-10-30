import { db, nowIso } from '../db.js';
import { fetchJson } from '../lib/http.js';
import type { AdapterContext, AdapterResult } from './types.js';

interface KevFeed {
  vulnerabilities?: Array<{
    cveID: string;
    vendorProject?: string;
    product?: string;
    vulnerabilityName?: string;
    dateAdded?: string;
    shortDescription?: string;
    requiredAction?: string;
    dueDate?: string;
    knownRansomwareCampaignUse?: string;
    notes?: string;
  }>;
}

const FEED_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
let lastFetchAt = 0;
let inFlight: Promise<boolean> | null = null;

function feedSignature(entries: Array<{ cveId: string; dateAdded: string | null; dueDate: string | null }>): string {
  return entries
    .map((entry) => `${entry.cveId.toUpperCase()}|${entry.dateAdded ?? ''}|${entry.dueDate ?? ''}`)
    .sort()
    .join(';');
}

async function refreshFeed(force = false): Promise<boolean> {
  if (!force && Date.now() - lastFetchAt < 6 * 60 * 60 * 1000) return false;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const feed = await fetchJson<KevFeed>(FEED_URL, { timeoutMs: 30_000 });
    const entries = (feed.vulnerabilities ?? []).filter((entry) => Boolean(entry.cveID));
    if (!entries.length) throw new Error('CISA KEV 数据为空');
    const signature = feedSignature(
      entries.map((entry) => ({
        cveId: entry.cveID,
        dateAdded: entry.dateAdded ?? null,
        dueDate: entry.dueDate ?? null,
      })),
    );
    // Compare against the stored catalog instead of module memory. A restart
    // must not make an unchanged feed look like a data change. Rows that the
    // feed no longer lists are ignored here because this adapter preserves
    // historical KEV matches rather than deleting them.
    const upstreamIds = new Set(entries.map((entry) => entry.cveID.toUpperCase()));
    const previous = (
      db.prepare('SELECT cve_id, date_added, due_date FROM kev_entry').all() as Array<{
        cve_id: string;
        date_added: string | null;
        due_date: string | null;
      }>
    ).filter((row) => upstreamIds.has(row.cve_id));
    const changed =
      signature !==
      feedSignature(
        previous.map((row) => ({
          cveId: row.cve_id,
          dateAdded: row.date_added,
          dueDate: row.due_date,
        })),
      );
    const fetchedAt = nowIso();
    const upsert = db.prepare(`
      INSERT INTO kev_entry (cve_id, vendor_project, product, vulnerability_name, date_added, short_description,
        required_action, due_date, known_ransomware_use, notes, fetched_at)
      VALUES (@cveId, @vendor, @product, @name, @dateAdded, @description, @action, @dueDate, @ransomware, @notes, @fetchedAt)
      ON CONFLICT(cve_id) DO UPDATE SET
        vendor_project = excluded.vendor_project, product = excluded.product,
        vulnerability_name = excluded.vulnerability_name, date_added = excluded.date_added,
        short_description = excluded.short_description, required_action = excluded.required_action,
        due_date = excluded.due_date, known_ransomware_use = excluded.known_ransomware_use,
        notes = excluded.notes, fetched_at = excluded.fetched_at
    `);
    const transaction = db.transaction(() => {
      for (const entry of entries) {
        if (!entry.cveID) continue;
        upsert.run({
          cveId: entry.cveID.toUpperCase(),
          vendor: entry.vendorProject ?? null,
          product: entry.product ?? null,
          name: entry.vulnerabilityName ?? null,
          dateAdded: entry.dateAdded ?? null,
          description: entry.shortDescription ?? null,
          action: entry.requiredAction ?? null,
          dueDate: entry.dueDate ?? null,
          ransomware: entry.knownRansomwareCampaignUse ?? null,
          notes: entry.notes ?? null,
          fetchedAt,
        });
      }
      db.prepare(`
        UPDATE security_advisory
        SET kev = 1,
            kev_due_date = (SELECT due_date FROM kev_entry WHERE cve_id = security_advisory.identifier),
            updated_at = ?
        WHERE identifier IN (SELECT cve_id FROM kev_entry)
      `).run(fetchedAt);
    });
    transaction();
    lastFetchAt = Date.now();
    return changed;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

export async function fetchCisaKev(context: AdapterContext): Promise<AdapterResult> {
  const dataChanged = await refreshFeed();
  const count = db
    .prepare(
      `SELECT COUNT(*) AS count FROM security_advisory
       WHERE software_id = ? AND kev = 1`,
    )
    .get(context.softwareId) as { count: number };

  return {
    advisories: [],
    itemCount: count.count,
    note: `本地已匹配 ${count.count} 条 KEV 记录`,
    dataChanged,
  };
}

export function getKevLastFetch(): string | null {
  const row = db.prepare('SELECT MAX(fetched_at) AS fetched_at FROM kev_entry').get() as { fetched_at: string | null };
  return row?.fetched_at ?? null;
}
