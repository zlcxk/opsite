import { describe, expect, it } from 'vitest';
import {
  compareAdvisoryRows,
  compareLifecycleFeedItems,
  compareLifecycleItems,
  compareNaturalIdentifiers,
  compareReleaseItems,
  compareVersionIdentifiers,
} from './order.js';

describe('natural identifier ordering', () => {
  it('compares numeric runs by value instead of text', () => {
    expect(compareNaturalIdentifiers('CVE-2026-1000', 'CVE-2026-999')).toBeGreaterThan(0);
    expect(compareNaturalIdentifiers('CVE-2026-0999', 'CVE-2026-999')).toBe(0);
    expect(compareNaturalIdentifiers('GHSA-abcd-2', 'GHSA-abcd-10')).toBeLessThan(0);
  });

  it('compares text runs without case sensitivity', () => {
    expect(compareNaturalIdentifiers('cve-2026-1', 'CVE-2026-1')).toBe(0);
    expect(compareNaturalIdentifiers('alpha-2', 'beta-1')).toBeLessThan(0);
  });

  it('orders version-like identifiers with version precedence', () => {
    expect(compareVersionIdentifiers('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersionIdentifiers('1.10', '1.9')).toBeGreaterThan(0);
    expect(compareVersionIdentifiers('1.9.0', '1.9.0')).toBe(0);
    expect(compareVersionIdentifiers('1.0-ALPHA', '1.0-alpha')).toBe(0);
  });

  it('falls back to natural text when a cycle is not version-like', () => {
    expect(compareVersionIdentifiers('release-b', 'release-a')).toBeGreaterThan(0);
  });
});

describe('release ordering', () => {
  it('orders by effective time, version precedence and record id', () => {
    const older = { id: 'z', version: '9.0.0', publishedAt: '2025-01-01', firstSeenAt: '2025-01-01' };
    const newer = { id: 'a', version: '1.0.0', publishedAt: '2026-01-01', firstSeenAt: '2026-01-01' };
    expect(compareReleaseItems(newer, older)).toBeLessThan(0);

    const v9 = { id: 'b', version: '1.9.0', publishedAt: '2026-01-01', firstSeenAt: '2026-01-01' };
    const v10 = { id: 'a', version: '1.10.0', publishedAt: '2026-01-01', firstSeenAt: '2026-01-01' };
    expect(compareReleaseItems(v10, v9)).toBeLessThan(0);

    const duplicateA = { id: 'a', version: '1.9.0', publishedAt: '2026-01-01', firstSeenAt: '2026-01-01' };
    const duplicateB = { id: 'b', version: '1.9.0', publishedAt: '2026-01-01', firstSeenAt: '2026-01-01' };
    expect(compareReleaseItems(duplicateA, duplicateB)).toBeLessThan(0);
  });

  it('uses first-seen time when the upstream date is absent', () => {
    const missing = { id: 'a', version: '1.0.0', publishedAt: null, firstSeenAt: '2026-02-01' };
    const published = { id: 'b', version: '2.0.0', publishedAt: '2026-01-01', firstSeenAt: '2026-01-01' };
    expect(compareReleaseItems(missing, published)).toBeLessThan(0);
  });
});

describe('advisory ordering', () => {
  it('orders impact first, then priority, date, identifier and id', () => {
    const base = {
      published_at: '2026-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
      version_impact: 'affected' as const,
      priority: 'P0' as const,
    };
    const affectedP1 = { ...base, id: 'a', identifier: 'CVE-2026-1', priority: 'P1' as const };
    const affectedP0 = { ...base, id: 'b', identifier: 'CVE-2026-999' };
    const possibleP0 = { ...base, id: 'c', identifier: 'CVE-2026-1', version_impact: 'possibly_affected' as const };
    expect(compareAdvisoryRows(affectedP0, affectedP1)).toBeLessThan(0);
    expect(compareAdvisoryRows(affectedP0, possibleP0)).toBeLessThan(0);

    const id1000 = { ...base, id: 'd', identifier: 'CVE-2026-1000' };
    expect(compareAdvisoryRows(id1000, affectedP0)).toBeLessThan(0);

    const sameA = { ...base, id: 'a', identifier: 'CVE-2026-1000' };
    const sameB = { ...base, id: 'b', identifier: 'CVE-2026-1000' };
    expect(compareAdvisoryRows(sameA, sameB)).toBeLessThan(0);
  });
});

describe('lifecycle ordering', () => {
  it('orders the current cycle first, then natural cycles and record id', () => {
    const current = { id: 'z', cycle: '1.9', isCurrent: true, softwareName: '软件 A' };
    const latest = { id: 'a', cycle: '1.10', isCurrent: false, softwareName: '软件 A' };
    const older = { id: 'b', cycle: '1.8', isCurrent: false, softwareName: '软件 A' };
    expect(compareLifecycleItems(current, latest)).toBeLessThan(0);
    expect(compareLifecycleItems(latest, older)).toBeLessThan(0);
    expect(compareLifecycleItems(latest, { ...latest, id: 'b' })).toBeLessThan(0);
  });

  it('orders global lifecycle groups by software name', () => {
    const a = { id: 'a', cycle: '1.0', isCurrent: true, softwareName: 'Alpha' };
    const b = { id: 'b', cycle: '2.0', isCurrent: true, softwareName: 'Beta' };
    expect(compareLifecycleFeedItems(a, b)).toBeLessThan(0);
  });
});
