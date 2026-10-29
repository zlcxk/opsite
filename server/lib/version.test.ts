import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  evaluateVersionImpact,
  isStableVersion,
  isVersionInRange,
  matchesCycle,
  parseVersion,
} from './version.js';

describe('compareVersions', () => {
  it('compares numeric segments instead of strings', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('2.0', '2.0.1')).toBe(-1);
  });

  it('orders prereleases before the stable release', () => {
    expect(compareVersions('1.38.0-alpha.3', '1.38.0')).toBe(-1);
    expect(compareVersions('1.38.0', '1.38.0-alpha.3')).toBe(1);
    expect(compareVersions('1.38.0-alpha.2', '1.38.0-alpha.3')).toBe(-1);
  });

  it('treats release suffixes as newer than the bare version', () => {
    expect(compareVersions('1.2.3-1', '1.2.3')).toBe(1);
  });

  it('parses common release prefixes', () => {
    expect(parseVersion('release-v1.2.3')?.core).toEqual([1, 2, 3]);
    expect(isStableVersion('1.38.0-alpha.3')).toBe(false);
    expect(isStableVersion('1.38.0')).toBe(true);
  });
});

describe('isVersionInRange', () => {
  it('supports comma-separated comparators with optional spaces', () => {
    expect(isVersionInRange('1.5.0', '>=1.0.0, <2.0.0')).toBe(true);
    expect(isVersionInRange('2.0.0', '>=1.0.0, <2.0.0')).toBe(false);
    expect(isVersionInRange('1.5.0', '>= 1.0.0, < 2.0.0')).toBe(true);
  });

  it('supports hyphen ranges and wildcards', () => {
    expect(isVersionInRange('1.5.0', '1.0.0 - 2.0.0')).toBe(true);
    expect(isVersionInRange('2.0.1', '1.0.0 - 2.0.0')).toBe(false);
    expect(isVersionInRange('9.9.9', '*')).toBe(true);
  });

  it('returns null for unreadable expressions instead of guessing', () => {
    expect(isVersionInRange('1.5.0', 'before the next release')).toBeNull();
    expect(isVersionInRange('not-a-version', '>=1.0.0')).toBeNull();
  });
});

describe('evaluateVersionImpact', () => {
  it('reports affected when any supplied range matches', () => {
    const result = evaluateVersionImpact('1.5.0', [
      { introduced: null, fixed: '1.4.0', lastAffected: null, rangeText: null },
      { introduced: '1.5.0', fixed: '1.6.0', lastAffected: null, rangeText: null },
    ]);
    expect(result.status).toBe('affected');
    expect(result.matchedRange).toBe('>= 1.5.0, < 1.6.0');
  });

  it('reports not_affected only when every range is understood', () => {
    const result = evaluateVersionImpact('3.0.0', [
      { introduced: '1.0.0', fixed: '2.0.0', lastAffected: null, rangeText: null },
      { introduced: null, fixed: null, lastAffected: null, rangeText: '< 2.5.0' },
    ]);
    expect(result.status).toBe('not_affected');
  });

  it('stays insufficient when a range cannot be parsed', () => {
    const result = evaluateVersionImpact('3.0.0', [
      { introduced: '1.0.0', fixed: '2.0.0', lastAffected: null, rangeText: null },
      { introduced: null, fixed: null, lastAffected: null, rangeText: 'all versions before the rewrite' },
    ]);
    expect(result.status).toBe('insufficient');
  });

  it('never claims safety without a current version or ranges', () => {
    expect(evaluateVersionImpact(null, []).status).toBe('insufficient');
    expect(evaluateVersionImpact('1.0.0', []).status).toBe('insufficient');
  });
});

describe('matchesCycle', () => {
  it('matches distro-style cycles on segment boundaries', () => {
    expect(matchesCycle('1.32.4', '1.32')).toBe(true);
    expect(matchesCycle('1.32', '1.32')).toBe(true);
    expect(matchesCycle('1.320.0', '1.32')).toBe(false);
    expect(matchesCycle('22.04.3', '22.04')).toBe(true);
    expect(matchesCycle('1.32.4-alpha.1', '1.32')).toBe(true);
  });
});
