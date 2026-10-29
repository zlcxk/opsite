import { parse as parseYaml } from 'yaml';
import type { DiscoverySourceType } from '../../shared/types.js';
import { fetchJson, fetchText } from '../lib/http.js';

export interface DiscoveryAdapterContext {
  query: string;
  category: string;
}

export interface DiscoveryFetchedItem {
  sourceType: DiscoverySourceType;
  sourceItemId: string;
  sourceRef: string | null;
  title: string;
  description: string | null;
  category: string;
  canonicalUrl: string;
  homepageUrl: string | null;
  sourceUrl: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  sourcePushedAt: string | null;
  starsCount: number | null;
  forksCount: number | null;
  language: string | null;
  license: string | null;
}

export interface DiscoveryAdapterResult {
  items: DiscoveryFetchedItem[];
  note?: string;
}

export interface DiscoveryAdapter {
  type: DiscoverySourceType;
  fetch(context: DiscoveryAdapterContext): Promise<DiscoveryAdapterResult>;
}

interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  homepage?: string | null;
  description?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  pushed_at?: string | null;
  stargazers_count?: number | null;
  forks_count?: number | null;
  language?: string | null;
  license?: { spdx_id?: string | null; name?: string | null } | null;
  archived?: boolean | null;
  fork?: boolean | null;
}

interface GitHubSearchResponse {
  total_count?: number;
  incomplete_results?: boolean;
  items?: GitHubRepository[];
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

function text(value: string | null | undefined, max = 4000): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function httpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function canonicalProjectUrl(value: string | null | undefined): string | null {
  const safe = httpUrl(value);
  if (!safe) return null;
  try {
    const parsed = new URL(safe);
    parsed.protocol = 'https:';
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname
      .replace(/\/+$/, '')
      .replace(/\.git$/i, '')
      .replace(/\/+$/, '');
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function licenseName(license: GitHubRepository['license']): string | null {
  if (!license) return null;
  const spdx = license.spdx_id && license.spdx_id !== 'NOASSERTION' ? license.spdx_id : null;
  return spdx || text(license.name, 120);
}

export function mapGitHubRepository(
  repository: GitHubRepository,
  category: string,
): DiscoveryFetchedItem | null {
  const canonicalUrl = canonicalProjectUrl(repository.html_url);
  const title = text(repository.name, 160) || text(repository.full_name, 160);
  if (!canonicalUrl || !title || !Number.isFinite(repository.id)) return null;

  return {
    sourceType: 'github',
    sourceItemId: String(repository.id),
    sourceRef: text(repository.full_name, 240),
    title,
    description: text(repository.description),
    category,
    canonicalUrl,
    homepageUrl: httpUrl(repository.homepage),
    sourceUrl: httpUrl(repository.html_url),
    sourceCreatedAt: repository.created_at ?? null,
    sourceUpdatedAt: repository.updated_at ?? null,
    sourcePushedAt: repository.pushed_at ?? null,
    starsCount: numberOrNull(repository.stargazers_count),
    forksCount: numberOrNull(repository.forks_count),
    language: text(repository.language, 80),
    license: licenseName(repository.license),
  };
}

export const githubDiscoveryAdapter: DiscoveryAdapter = {
  type: 'github',
  async fetch(context) {
    const query = context.query.trim();
    if (!query) throw new Error('GitHub 发现规则缺少查询条件');
    const params = new URLSearchParams({
      q: query,
      sort: 'updated',
      order: 'desc',
      per_page: '15',
    });
    const result = await fetchJson<GitHubSearchResponse>(
      `https://api.github.com/search/repositories?${params.toString()}`,
      { headers: githubHeaders(), timeoutMs: 25_000, retries: 1 },
    );
    if (!Array.isArray(result.items)) throw new Error('GitHub 搜索返回格式异常');

    const items = result.items
      .filter((repository) => !repository.archived && !repository.fork)
      .map((repository) => mapGitHubRepository(repository, context.category))
      .filter((item): item is DiscoveryFetchedItem => item !== null);
    const total = numberOrNull(result.total_count);
    return {
      items,
      note: `查询 ${query}，返回 ${items.length} 条${total != null ? `（匹配 ${total} 条）` : ''}`,
    };
  },
};

interface CncfYamlItem {
  item?: unknown;
  name?: string | null;
  description?: string | null;
  homepage_url?: string | null;
  repo_url?: string | null;
  project?: string | null;
}

interface CncfYamlSubcategory {
  subcategory?: unknown;
  name?: string | null;
  items?: CncfYamlItem[];
}

interface CncfYamlCategory {
  category?: unknown;
  name?: string | null;
  subcategories?: CncfYamlSubcategory[];
}

interface CncfLandscape {
  landscape?: CncfYamlCategory[];
}

const CNCF_LANDSCAPE_URL =
  'https://api.github.com/repos/cncf/landscape/contents/landscape.yml?ref=master';
const CNCF_SOURCE_URL = 'https://landscape.cncf.io/';

function maturityFilter(query: string): Set<string> {
  if (!query.trim()) return new Set(['graduated', 'incubating']);
  const [key, raw] = query.split(':', 2);
  if (key?.trim() !== 'maturity' || !raw?.trim()) {
    throw new Error('CNCF 发现规则仅支持 maturity:graduated,incubating 形式');
  }
  return new Set(
    raw
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function parseCncfLandscape(raw: string): CncfLandscape {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    throw new Error('CNCF Landscape YAML 解析失败');
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as CncfLandscape).landscape)) {
    throw new Error('CNCF Landscape 数据格式异常');
  }
  return parsed as CncfLandscape;
}

export function mapCncfLandscape(
  data: CncfLandscape,
  context: DiscoveryAdapterContext,
): DiscoveryFetchedItem[] {
  if (!Array.isArray(data.landscape)) throw new Error('CNCF Landscape 数据格式异常');
  const maturities = maturityFilter(context.query);
  const items: DiscoveryFetchedItem[] = [];

  for (const category of data.landscape) {
    const categoryName = text(category.name, 160);
    for (const subcategory of category.subcategories ?? []) {
      const subcategoryName = text(subcategory.name, 160);
      for (const item of subcategory.items ?? []) {
        const project = item.project?.toLowerCase();
        if (!project || !maturities.has(project)) continue;
        const name = text(item.name, 160);
        if (!name) continue;
        const canonicalUrl = canonicalProjectUrl(item.repo_url ?? item.homepage_url);
        if (!canonicalUrl) continue;
        // The YAML file has no stable project ID. Category + subcategory + name
        // is the stable official identity we can rely on without guessing.
        const sourceItemId = text(
          [categoryName ?? context.category, subcategoryName ?? '', name].join(' / '),
          240,
        );
        if (!sourceItemId) continue;

        items.push({
          sourceType: 'cncf',
          sourceItemId,
          sourceRef: `CNCF ${project.charAt(0).toUpperCase()}${project.slice(1)}`,
          title: name,
          description: text(item.description),
          category: categoryName || context.category,
          canonicalUrl,
          homepageUrl: httpUrl(item.homepage_url),
          sourceUrl: httpUrl(CNCF_SOURCE_URL),
          sourceCreatedAt: null,
          sourceUpdatedAt: null,
          sourcePushedAt: null,
          starsCount: null,
          forksCount: null,
          language: null,
          license: null,
        });
      }
    }
  }

  return items
    .sort((a, b) => {
      const rank = (value: DiscoveryFetchedItem) =>
        value.sourceRef?.includes('Graduated') ? 0 : 1;
      return rank(a) - rank(b) || a.title.localeCompare(b.title);
    })
    .slice(0, 200);
}

export const cncfDiscoveryAdapter: DiscoveryAdapter = {
  type: 'cncf',
  async fetch(context) {
    const raw = await fetchText(CNCF_LANDSCAPE_URL, {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
      timeoutMs: 45_000,
      retries: 1,
    });
    const items = mapCncfLandscape(parseCncfLandscape(raw), context);
    return {
      items,
      note: `CNCF Landscape 官方 landscape.yml，筛选 ${context.query}，返回 ${items.length} 条`,
    };
  },
};

export const discoveryAdapters: Record<DiscoverySourceType, DiscoveryAdapter> = {
  github: githubDiscoveryAdapter,
  cncf: cncfDiscoveryAdapter,
};
