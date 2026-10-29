import type { VersionRange } from '../../shared/types.js';

export type { VersionRange };

export interface VersionMatch {
  status: 'affected' | 'not_affected' | 'insufficient';
  reason: string;
  matchedRange?: string;
}

const PRERELEASE_WORDS = /^(alpha|beta|rc|pre|preview|dev|snapshot|nightly|canary)\b/i;

export function cleanVersion(input: string): string {
  return String(input)
    .trim()
    .replace(/^release[-_/]?/i, '')
    .replace(/^[vV]\s*/, '')
    // Tags such as "release-v1.2.3" only become clean after the prefix that
    // precedes the v is gone, so strip the release prefix once more.
    .replace(/^release[-_/]?/i, '')
    .trim();
}

interface ParsedVersion {
  core: number[];
  prerelease: string | null;
  postSuffix: string | null;
}

export function parseVersion(input: string): ParsedVersion | null {
  const cleaned = cleanVersion(input);
  const match = cleaned.match(/^(\d+(?:\.\d+)*)(?:[-_.]?(.*))?$/);
  if (!match) return null;
  const core = match[1].split('.').map(Number);
  const suffix = match[2]?.trim() ?? '';
  if (!suffix) return { core, prerelease: null, postSuffix: null };
  if (PRERELEASE_WORDS.test(suffix)) {
    return { core, prerelease: suffix, postSuffix: null };
  }
  return { core, prerelease: null, postSuffix: suffix };
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return cleanVersion(a).localeCompare(cleanVersion(b), undefined, { numeric: true });
  const length = Math.max(pa.core.length, pb.core.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  if (pa.prerelease && !pb.prerelease) return -1;
  if (!pa.prerelease && pb.prerelease) return 1;
  if (pa.prerelease && pb.prerelease) {
    return pa.prerelease.localeCompare(pb.prerelease, undefined, { numeric: true });
  }
  if (pa.postSuffix && pb.postSuffix) {
    return pa.postSuffix.localeCompare(pb.postSuffix, undefined, { numeric: true });
  }
  if (pa.postSuffix && !pb.postSuffix) return 1;
  if (!pa.postSuffix && pb.postSuffix) return -1;
  return 0;
}

export function isStableVersion(version: string): boolean {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  return !parsed.prerelease;
}

/** Compare a loose lifecycle cycle ("1.32", "22") to a version. */
export function matchesCycle(version: string, cycle: string): boolean {
  const v = cleanVersion(version);
  const c = cleanVersion(cycle);
  if (!c || !/^\d/.test(c)) return false;
  return v === c || v.startsWith(`${c}.`) || v.startsWith(`${c}-`) || v.startsWith(`${c}+`);
}

export function findCycle<T extends { cycle: string }>(version: string | null, cycles: T[]): T | null {
  if (!version) return null;
  const matches = cycles.filter((item) => matchesCycle(version, item.cycle));
  matches.sort((a, b) => cleanVersion(b.cycle).length - cleanVersion(a.cycle).length);
  return matches[0] ?? null;
}

interface Comparator {
  op: string;
  version: string;
}

function parseComparators(expression: string): Comparator[] | null {
  const normalized = expression
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || normalized === '*') return [];

  // NuGet / OSV style: ">= 1.0.0, < 2.0.0" or "1.0.0 - 2.0.0".
  const hyphen = normalized.match(/^([^\s,]+)\s+-\s+([^\s,]+)$/);
  if (hyphen && !/^[<>]=?/.test(hyphen[1])) {
    return [
      { op: '>=', version: hyphen[1] },
      { op: '<=', version: hyphen[2] },
    ];
  }

  const comparators: Comparator[] = [];
  const tokens = normalized.split(',').map((part) => part.trim()).filter(Boolean);
  for (const token of tokens) {
    // range expressions with spaces: ">= 1.2.3"
    const match = token.match(/^(<=|>=|<|>|=|==)?\s*([vV]?\d[^\s]*)$/);
    if (!match) return null;
    let op = match[1] || '=';
    if (op === '==') op = '=';
    comparators.push({ op, version: cleanVersion(match[2]) });
  }
  return comparators;
}

function checkComparator(version: string, comparator: Comparator): boolean {
  const result = compareVersions(version, comparator.version);
  switch (comparator.op) {
    case '>':
      return result > 0;
    case '>=':
      return result >= 0;
    case '<':
      return result < 0;
    case '<=':
      return result <= 0;
    case '=':
    default:
      return result === 0;
  }
}

/** Returns null when the expression cannot be interpreted, so callers never guess. */
export function isVersionInRange(version: string, expression: string): boolean | null {
  const comparators = parseComparators(expression);
  if (comparators === null) return null;
  if (!parseVersion(version)) return null;
  return comparators.every((comparator) => checkComparator(version, comparator));
}

export function isInStructuredRange(version: string, range: VersionRange): boolean | null {
  if (range.rangeText) {
    const direct = isVersionInRange(version, range.rangeText);
    if (direct !== null) return direct;
  }
  if (!range.introduced && !range.fixed && !range.lastAffected) return null;
  if (!parseVersion(version)) return null;

  let matched = true;
  if (range.introduced) {
    const result = isVersionInRange(version, `>= ${range.introduced}`);
    if (result === null) return null;
    matched = matched && result;
  }
  if (range.fixed) {
    const result = isVersionInRange(version, `< ${range.fixed}`);
    if (result === null) return null;
    matched = matched && result;
  }
  if (range.lastAffected) {
    const result = isVersionInRange(version, `<= ${range.lastAffected}`);
    if (result === null) return null;
    matched = matched && result;
  }
  return matched;
}

/**
 * Only returns not_affected when every supplied range was understood.
 * If any range is unreadable, the result is insufficient rather than a guess.
 */
export function evaluateVersionImpact(currentVersion: string | null, ranges: VersionRange[]): VersionMatch {
  if (!currentVersion?.trim()) {
    return { status: 'insufficient', reason: '未配置当前使用版本' };
  }
  if (!ranges.length) {
    return { status: 'insufficient', reason: '公告未提供可解析的受影响版本范围' };
  }

  let matchedAny = false;
  let matchedRange: string | undefined;
  let unreadable = 0;

  for (const range of ranges) {
    const result = isInStructuredRange(currentVersion, range);
    if (result === null) {
      unreadable += 1;
      continue;
    }
    if (result) {
      matchedAny = true;
      matchedRange = range.rangeText || formatStructuredRange(range);
    }
  }

  if (matchedAny) {
    return { status: 'affected', reason: '当前版本落在受影响范围内', matchedRange };
  }
  if (unreadable > 0) {
    return { status: 'insufficient', reason: '存在无法解析的版本范围，需人工核实' };
  }
  return { status: 'not_affected', reason: '当前版本不在已提供的受影响范围内' };
}

export function formatStructuredRange(range: VersionRange): string {
  if (range.rangeText) return range.rangeText;
  if (range.introduced && range.fixed) return `>= ${range.introduced}, < ${range.fixed}`;
  if (range.introduced && range.lastAffected) return `>= ${range.introduced}, <= ${range.lastAffected}`;
  if (range.introduced) return `>= ${range.introduced}`;
  if (range.fixed) return `< ${range.fixed}`;
  if (range.lastAffected) return `<= ${range.lastAffected}`;
  return '未知范围';
}

export function maxVersion(versions: string[]): string | null {
  const valid = versions.filter((version) => parseVersion(version));
  if (!valid.length) return null;
  return valid.reduce((max, current) => (compareVersions(current, max) > 0 ? current : max));
}
