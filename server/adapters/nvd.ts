import type { VersionRange } from '../../shared/types.js';
import { fetchJson } from '../lib/http.js';
import { normalizeSeverity, severityFromScore } from '../lib/severity.js';
import type { AdapterContext, AdapterResult, RawAdvisory } from './types.js';

interface NvdCpeMatch {
  vulnerable: boolean;
  criteria: string;
  versionStartIncluding?: string;
  versionStartExcluding?: string;
  versionEndIncluding?: string;
  versionEndExcluding?: string;
}

interface NvdMetric {
  cvssData?: { baseScore?: number; baseSeverity?: string };
  baseSeverity?: string;
  type?: string;
}

interface NvdVulnerability {
  cve: {
    id: string;
    published: string;
    lastModified: string;
    descriptions: Array<{ lang: string; value: string }>;
    metrics?: {
      cvssMetricV40?: NvdMetric[];
      cvssMetricV31?: NvdMetric[];
      cvssMetricV30?: NvdMetric[];
      cvssMetricV2?: NvdMetric[];
    };
    configurations?: Array<{ nodes?: Array<{ cpeMatch?: NvdCpeMatch[] }> }>;
    references?: Array<{ url: string; tags?: string[] }>;
    vulnStatus?: string;
  };
}

interface NvdResponse {
  totalResults: number;
  vulnerabilities: NvdVulnerability[];
}

let nvdQueue: Promise<unknown> = Promise.resolve();
let lastNvdRequestAt = 0;

async function rateLimited<T>(task: () => Promise<T>): Promise<T> {
  const run = nvdQueue.then(async () => {
    const interval = process.env.NVD_API_KEY ? 700 : 6300;
    const wait = interval - (Date.now() - lastNvdRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastNvdRequestAt = Date.now();
    return task();
  });
  nvdQueue = run.catch(() => undefined);
  return run;
}

function pickMetric(cve: NvdVulnerability['cve']): { score: number | null; severity: string; vector: string | null } {
  const groups = [
    cve.metrics?.cvssMetricV40,
    cve.metrics?.cvssMetricV31,
    cve.metrics?.cvssMetricV30,
    cve.metrics?.cvssMetricV2,
  ];
  for (const group of groups) {
    const metric = group?.[0];
    if (metric?.cvssData) {
      const score = typeof metric.cvssData.baseScore === 'number' ? metric.cvssData.baseScore : null;
      return {
        score,
        severity: metric.cvssData.baseSeverity || metric.baseSeverity || '',
        vector: null,
      };
    }
  }
  return { score: null, severity: '', vector: null };
}

function parseRanges(vulnerability: NvdVulnerability): VersionRange[] {
  const ranges: VersionRange[] = [];
  for (const configuration of vulnerability.cve.configurations ?? []) {
    for (const node of configuration.nodes ?? []) {
      for (const match of node.cpeMatch ?? []) {
        if (!match.vulnerable) continue;
        if (!match.versionStartIncluding && !match.versionStartExcluding && !match.versionEndIncluding && !match.versionEndExcluding) {
          continue;
        }
        const parts: string[] = [];
        const introduced = match.versionStartIncluding || match.versionStartExcluding || null;
        const fixed = match.versionEndExcluding || null;
        const lastAffected = match.versionEndIncluding || null;
        if (match.versionStartIncluding) parts.push(`>= ${match.versionStartIncluding}`);
        if (match.versionStartExcluding) parts.push(`> ${match.versionStartExcluding}`);
        if (match.versionEndExcluding) parts.push(`< ${match.versionEndExcluding}`);
        if (match.versionEndIncluding) parts.push(`<= ${match.versionEndIncluding}`);
        ranges.push({
          introduced,
          fixed,
          lastAffected,
          rangeText: parts.length ? parts.join(', ') : null,
        });
      }
    }
  }
  // De-duplicate identical range text.
  const seen = new Set<string>();
  return ranges.filter((range) => {
    const key = `${range.rangeText}|${range.introduced}|${range.fixed}|${range.lastAffected}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchNvd(context: AdapterContext): Promise<AdapterResult> {
  const keyword = context.config.keyword?.trim();
  const cpeName = context.config.cpeName?.trim();
  if (!keyword && !cpeName) throw new Error('缺少 NVD 关键词或 CPE');

  const params = new URLSearchParams({
    resultsPerPage: '50',
    noRejected: '',
  });
  if (keyword) params.set('keywordSearch', keyword);
  if (cpeName) params.set('cpeName', cpeName);

  const headers: Record<string, string> = {};
  if (process.env.NVD_API_KEY) headers.apiKey = process.env.NVD_API_KEY;

  const data = await rateLimited(() =>
    fetchJson<NvdResponse>(`https://services.nvd.nist.gov/rest/json/cves/2.0?${params.toString()}`, {
      headers,
      timeoutMs: 35_000,
      retries: 1,
    }),
  );

  if (!data?.vulnerabilities) throw new Error('NVD 返回格式异常');

  const rows: RawAdvisory[] = data.vulnerabilities
    .map((item) => {
      const cve = item.cve;
      const description = cve.descriptions.find((entry) => entry.lang === 'en')?.value ?? cve.descriptions[0]?.value ?? '';
      const metric = pickMetric(cve);
      const severity = normalizeSeverity(metric.severity) === 'unknown' ? severityFromScore(metric.score) : normalizeSeverity(metric.severity);
      const refs = cve.references ?? [];
      const primary = refs.find((ref) => ref.tags?.includes('Vendor Advisory'))?.url || refs[0]?.url || `https://nvd.nist.gov/vuln/detail/${cve.id}`;
      return {
        identifier: cve.id.toUpperCase(),
        externalId: cve.id.toUpperCase(),
        title: description.length > 180 ? `${description.slice(0, 177)}...` : description || cve.id,
        description,
        severity,
        score: metric.score,
        scoreSource: metric.score != null ? 'NVD / CVSS' : 'NVD',
        url: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
        publishedAt: cve.published,
        updatedAt: cve.lastModified,
        kev: false,
        kevDueDate: null,
        affectedRanges: parseRanges(item),
        fixedVersions: [],
        confidence: cpeName ? 'high' : 'medium',
        sourceType: 'nvd',
        raw: item,
      } satisfies RawAdvisory;
    })
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
    .slice(0, 40);

  return {
    advisories: rows,
    itemCount: rows.length,
    note: `${cpeName ? 'CPE 精确匹配' : '关键词命中'} ${data.totalResults ?? rows.length} 条，取最近 ${rows.length} 条`,
  };
}
