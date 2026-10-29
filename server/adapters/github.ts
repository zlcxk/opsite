import type { VersionRange } from '../../shared/types.js';
import { fetchJson } from '../lib/http.js';
import { normalizeSeverity, severityFromScore } from '../lib/severity.js';
import type { AdapterContext, AdapterResult, RawAdvisory, RawRelease } from './types.js';

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
}

interface GitHubAdvisory {
  ghsa_id: string;
  cve_id: string | null;
  summary: string;
  description: string | null;
  severity: string;
  cvss?: { score?: number | null; vector_string?: string | null } | null;
  cvss_severities?: {
    cvss_v3?: { score?: number | null } | null;
    cvss_v4?: { score?: number | null } | null;
  } | null;
  html_url: string;
  published_at: string | null;
  updated_at: string | null;
  vulnerabilities?: Array<{
    package?: { ecosystem?: string; name?: string };
    vulnerable_version_range?: string | null;
    first_patched_version?: { identifier?: string | null } | null;
  }>;
}

function repoSlug(input: string): string {
  const cleaned = input
    .trim()
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(cleaned)) throw new Error('GitHub 仓库格式应为 owner/repo');
  return cleaned;
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

export async function fetchGitHubReleases(context: AdapterContext): Promise<AdapterResult> {
  const repo = repoSlug(context.config.repo || '');
  const releases = await fetchJson<GitHubRelease[]>(
    `https://api.github.com/repos/${repo}/releases?per_page=40`,
    { headers: githubHeaders() },
  );
  if (!Array.isArray(releases)) throw new Error('GitHub Releases 返回格式异常');

  const rows: RawRelease[] = releases
    .filter((release) => !release.draft && release.tag_name)
    .map((release) => ({
      externalId: String(release.id),
      version: release.tag_name,
      channel: release.prerelease ? 'prerelease' : 'stable',
      title: release.name || release.tag_name,
      notes: release.body ? release.body.slice(0, 20_000) : null,
      url: release.html_url,
      publishedAt: release.published_at,
      raw: release,
    }));

  return { releases: rows, itemCount: rows.length, note: `${rows.length} 个发布版本` };
}

export async function fetchGitHubAdvisories(context: AdapterContext): Promise<AdapterResult> {
  const pkg = context.config.package?.trim();
  if (!pkg) throw new Error('缺少 GitHub Advisory package 标识');
  const query = new URLSearchParams({ affects: pkg, per_page: '100' });
  if (context.config.ecosystem?.trim()) query.set('ecosystem', context.config.ecosystem.trim());

  const advisories = await fetchJson<GitHubAdvisory[]>(`https://api.github.com/advisories?${query.toString()}`, {
    headers: githubHeaders(),
  });
  if (!Array.isArray(advisories)) throw new Error('GitHub Advisory 返回格式异常');

  const rows: RawAdvisory[] = advisories.map((advisory) => {
    const vulnerabilities = (advisory.vulnerabilities ?? []).filter((item) => {
      if (!item.package?.name) return true;
      return item.package.name.toLowerCase() === pkg.toLowerCase();
    });
    const affectedRanges: VersionRange[] = vulnerabilities
      .filter((item) => item.vulnerable_version_range)
      .map((item) => ({
        rangeText: item.vulnerable_version_range,
        fixed: item.first_patched_version?.identifier || null,
      }));
    const fixedVersions = [
      ...new Set(
        vulnerabilities
          .map((item) => item.first_patched_version?.identifier)
          .filter((version): version is string => Boolean(version)),
      ),
    ];
    const score = advisory.cvss_severities?.cvss_v4?.score ?? advisory.cvss?.score ?? null;
    const severity = normalizeSeverity(advisory.severity) === 'unknown' ? severityFromScore(score) : normalizeSeverity(advisory.severity);

    return {
      identifier: (advisory.cve_id || advisory.ghsa_id).toUpperCase(),
      externalId: advisory.ghsa_id,
      title: advisory.summary,
      description: advisory.description ?? null,
      severity,
      score,
      scoreSource: score != null ? 'GitHub / CVSS' : 'GitHub',
      url: advisory.html_url,
      publishedAt: advisory.published_at,
      updatedAt: advisory.updated_at,
      kev: false,
      kevDueDate: null,
      affectedRanges,
      fixedVersions,
      confidence: 'high',
      sourceType: 'github_advisories',
      raw: advisory,
    };
  });

  return { advisories: rows, itemCount: rows.length, note: `${rows.length} 条安全公告` };
}
