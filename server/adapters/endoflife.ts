import type { SupportStatus } from '../../shared/types.js';
import { fetchJson } from '../lib/http.js';
import type { AdapterContext, AdapterResult, RawLifecycle } from './types.js';

interface EndOfLifeRelease {
  name?: unknown;
  label?: unknown;
  releaseDate?: unknown;
  isEol?: unknown;
  eolFrom?: unknown;
  isEoas?: unknown;
  eoasFrom?: unknown;
  isEoes?: unknown;
  eoesFrom?: unknown;
  isMaintained?: unknown;
  latest?: unknown;
  [key: string]: unknown;
}

interface EndOfLifeProductResult {
  name?: unknown;
  label?: unknown;
  labels?: unknown;
  links?: unknown;
  releases?: unknown;
  [key: string]: unknown;
}

interface EndOfLifeProductPayload {
  schema_version?: unknown;
  generated_at?: unknown;
  last_modified?: unknown;
  result?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Only a real calendar date is accepted. Booleans, descriptions and version
 * strings are never coerced into a date; callers keep them out of the model.
 */
export function parseLifecycleDate(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(text);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

function collectDate(
  value: unknown,
  options: { cycle: string; field: string; warnings: string[] },
): string | null {
  if (value == null || value === '') return null;
  const parsed = parseLifecycleDate(value);
  if (parsed) return parsed;
  options.warnings.push(
    `${options.cycle}.${options.field}: 不是有效日期，已留空（原始值：${describeValue(value)}）`,
  );
  return null;
}

function collectBoolean(
  value: unknown,
  options: { cycle: string; field: string; warnings: string[] },
): boolean | null {
  if (value == null) return null;
  if (typeof value === 'boolean') return value;
  options.warnings.push(
    `${options.cycle}.${options.field}: 期望布尔值，已忽略（原始值：${describeValue(value)}）`,
  );
  return null;
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.slice(0, 80));
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return Array.isArray(value) ? 'array' : typeof value;
}

export function deriveSupportStatus(input: {
  eolDate: string | null;
  isEol: boolean | null;
  isMaintained: boolean | null;
  now?: Date;
  approachingDays?: number;
}): SupportStatus {
  const { eolDate, isEol, isMaintained, now = new Date(), approachingDays = 180 } = input;

  // Explicit upstream flags win: isEol=true or isMaintained=false means no
  // upstream support, even when no date was published.
  if (isEol === true || isMaintained === false) return 'eol';

  if (eolDate) {
    const date = new Date(`${eolDate}T23:59:59Z`);
    const diffDays = (date.getTime() - now.getTime()) / 86_400_000;
    if (diffDays <= 0) return 'eol';
    if (diffDays <= approachingDays) return 'approaching_eol';
    return 'supported';
  }

  // An explicit "still maintained" flag is valid evidence without a date.
  // Vendor/extended support dates are deliberately not consulted here.
  if (isMaintained === true) return 'supported';
  return 'unknown';
}

export interface EndOfLifeMapping {
  lifecycle: RawLifecycle[];
  warnings: string[];
}

export function mapEndOfLifeProduct(
  payload: unknown,
  product: string,
  now = new Date(),
): EndOfLifeMapping {
  const root = asRecord(payload);
  const result = asRecord(root?.result) as EndOfLifeProductResult | null;
  if (!root || !result) throw new Error('endoflife.date v1 返回格式异常：缺少 result');

  const warnings: string[] = [];
  const labels = asRecord(result.labels) ?? {};
  const activeSupportLabel = readString(labels.eoas);
  const eolLabel = readString(labels.eol);

  if (!eolLabel) warnings.push('labels.eol: 来源未提供上游支持阶段名称');
  if (!Array.isArray(result.releases)) {
    throw new Error('endoflife.date v1 返回格式异常：缺少 releases 数组');
  }

  const links = asRecord(result.links);
  const sourceUrl =
    (typeof links?.html === 'string' && /^https?:\/\//.test(links.html) ? links.html : null)
    ?? `https://endoflife.date/${product}`;
  const productLabel = readString(result.label) ?? product;
  const schemaVersion = readString(root.schema_version);
  const generatedAt = readString(root.generated_at);
  const lastModified = readString(root.last_modified);
  const seen = new Set<string>();
  const lifecycle: RawLifecycle[] = [];

  for (const rawRelease of result.releases as unknown[]) {
    const release = asRecord(rawRelease) as EndOfLifeRelease | null;
    if (!release) {
      warnings.push('releases: 跳过非对象发布记录');
      continue;
    }
    const cycle = readString(release.name);
    if (!cycle) {
      warnings.push('releases: 跳过缺少 name 的发布记录');
      continue;
    }
    if (seen.has(cycle)) {
      warnings.push(`${cycle}: 重复的发布周期，已忽略后一条`);
      continue;
    }
    seen.add(cycle);

    const rowWarnings: string[] = [];
    const context = (field: string) => ({ cycle, field, warnings: rowWarnings });

    const releaseDate = collectDate(release.releaseDate, context('releaseDate'));
    const eolDate = collectDate(release.eolFrom, context('eolFrom'));
    const activeSupportEnd = activeSupportLabel
      ? collectDate(release.eoasFrom, context('eoasFrom'))
      : null;
    // Only a phase explicitly labelled as maintenance is exposed as the
    // maintenance deadline. "Security Support" or "Support" are not relabelled.
    const maintenanceSupportEnd =
      eolLabel && /maintenance/i.test(eolLabel) ? eolDate : null;
    const vendorSupportEnd = collectDate(release.eoesFrom, context('eoesFrom'));

    const isEol = collectBoolean(release.isEol, context('isEol'));
    const isMaintained = collectBoolean(release.isMaintained, context('isMaintained'));
    const latest = asRecord(release.latest);
    if (release.latest != null && !latest) {
      rowWarnings.push(`${cycle}.latest: 期望对象，已忽略（原始值：${describeValue(release.latest)}）`);
    }
    const latestVersion = latest ? readString(latest.name) : null;
    const latestReleaseDate = latest
      ? collectDate(latest.date, { cycle, field: 'latest.date', warnings: rowWarnings })
      : null;

    const supportStatus = deriveSupportStatus({ eolDate, isEol, isMaintained, now });

    for (const warning of rowWarnings) console.warn(`[lifecycle] ${product} ${warning}`);

    lifecycle.push({
      cycle,
      releaseDate,
      latestVersion,
      latestReleaseDate,
      eolDate,
      activeSupportEnd,
      maintenanceSupportEnd,
      vendorSupportEnd,
      supportStatus,
      sourceUrl,
      warnings: rowWarnings,
      raw: {
        schemaVersion,
        generatedAt,
        lastModified,
        product,
        productLabel,
        labels,
        sourceUrl,
        release,
      },
    });
  }

  if (!lifecycle.length) {
    throw new Error('endoflife.date v1 未返回可识别的发布周期');
  }

  return { lifecycle, warnings };
}

export async function fetchEndOfLife(context: AdapterContext): Promise<AdapterResult> {
  const product = context.config.product?.trim();
  if (!product) throw new Error('缺少 endoflife.date product 标识');

  const url = `https://endoflife.date/api/v1/products/${encodeURIComponent(product)}`;
  const payload = await fetchJson<EndOfLifeProductPayload>(url);
  const { lifecycle, warnings } = mapEndOfLifeProduct(payload, product);

  for (const warning of warnings) console.warn(`[lifecycle] ${product} ${warning}`);

  return {
    lifecycle,
    itemCount: lifecycle.length,
    note:
      warnings.length > 0
        ? `${lifecycle.length} 个发布周期，${warnings.length} 条解析提示`
        : `${lifecycle.length} 个发布周期`,
  };
}
