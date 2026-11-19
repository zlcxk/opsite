import type { Priority, VersionImpact } from '../../shared/types.js';
import { compareVersions, parseVersion } from './version.js';

const IMPACT_RANK: Record<VersionImpact, number> = {
  affected: 0,
  possibly_affected: 1,
  insufficient: 2,
  not_affected: 3,
};

const PRIORITY_RANK: Record<Priority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

/** Stable final tie-breaker shared by every ordered list. */
export function compareRecordIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/\d+|\D+/g) ?? [];
}

function compareTextSegments(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareNumericSegments(a: string, b: string): number {
  const left = a.replace(/^0+(?=\d)/, '');
  const right = b.replace(/^0+(?=\d)/, '');
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return compareTextSegments(left, right);
}

/**
 * Case-insensitive natural comparison for identifiers such as CVE/GHSA
 * advisories and unparseable cycle names.
 */
export function compareNaturalIdentifiers(a: string, b: string): number {
  const left = tokenize(a);
  const right = tokenize(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const aSegment = left[index];
    const bSegment = right[index];
    if (aSegment === undefined) return -1;
    if (bSegment === undefined) return 1;
    if (aSegment === bSegment) continue;

    const aNumeric = /^\d+$/.test(aSegment);
    const bNumeric = /^\d+$/.test(bSegment);
    if (aNumeric && bNumeric) {
      const diff = compareNumericSegments(aSegment, bSegment);
      if (diff !== 0) return diff;
      continue;
    }
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    const diff = compareTextSegments(aSegment, bSegment);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Version/cycle identifiers use version precedence, then natural text. */
export function compareVersionIdentifiers(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left && right) {
    const version = compareVersions(a, b);
    // Version suffixes are case-insensitive for list ordering.
    if (version === 0 || compareNaturalIdentifiers(a, b) === 0) return 0;
    return version;
  }
  return compareNaturalIdentifiers(a, b);
}

export interface ReleaseOrderItem {
  id: string;
  version: string;
  publishedAt: string | null;
  firstSeenAt: string;
}

function releaseEffectiveTime(item: ReleaseOrderItem): string {
  return item.publishedAt ?? item.firstSeenAt;
}

export function compareReleaseItems(a: ReleaseOrderItem, b: ReleaseOrderItem): number {
  const aTime = releaseEffectiveTime(a);
  const bTime = releaseEffectiveTime(b);
  if (aTime !== bTime) return aTime < bTime ? 1 : -1;

  const version = compareVersionIdentifiers(b.version, a.version);
  if (version !== 0) return version;
  return compareRecordIds(a.id, b.id);
}

export interface AdvisoryOrderRow {
  id: string;
  identifier: string;
  priority: Priority;
  version_impact: VersionImpact;
  published_at: string | null;
  created_at: string;
}

function advisoryEffectiveTime(row: AdvisoryOrderRow): string {
  return row.published_at ?? row.created_at;
}

export function compareAdvisoryRows(a: AdvisoryOrderRow, b: AdvisoryOrderRow): number {
  const impact = IMPACT_RANK[a.version_impact] - IMPACT_RANK[b.version_impact];
  if (impact !== 0) return impact;

  const priority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (priority !== 0) return priority;

  const aTime = advisoryEffectiveTime(a);
  const bTime = advisoryEffectiveTime(b);
  if (aTime !== bTime) return aTime < bTime ? 1 : -1;

  const identifier = compareNaturalIdentifiers(b.identifier, a.identifier);
  if (identifier !== 0) return identifier;
  return compareRecordIds(a.id, b.id);
}

export interface LifecycleOrderItem {
  id: string;
  cycle: string;
  isCurrent: boolean;
}

export function compareLifecycleItems(a: LifecycleOrderItem, b: LifecycleOrderItem): number {
  if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;

  const cycle = compareVersionIdentifiers(b.cycle, a.cycle);
  if (cycle !== 0) return cycle;
  return compareRecordIds(a.id, b.id);
}

export interface LifecycleFeedOrderItem extends LifecycleOrderItem {
  softwareName: string;
}

export function compareLifecycleFeedItems(
  a: LifecycleFeedOrderItem,
  b: LifecycleFeedOrderItem,
): number {
  const name = a.softwareName.localeCompare(b.softwareName, 'zh-CN');
  if (name !== 0) return name;
  return compareLifecycleItems(a, b);
}
