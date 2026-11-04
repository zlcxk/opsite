import { describe, expect, it } from 'vitest';
import {
  computePriority,
  daysUntil,
  normalizeSeverity,
  severityFromScore,
} from './severity.js';

describe('severity normalization', () => {
  it('accepts upstream severity labels and CVSS scores', () => {
    expect(normalizeSeverity('CRITICAL')).toBe('critical');
    expect(normalizeSeverity('moderate')).toBe('medium');
    expect(normalizeSeverity('重要')).toBe('high');
    expect(normalizeSeverity('n/a')).toBe('unknown');
    expect(severityFromScore(9.8)).toBe('critical');
    expect(severityFromScore(7)).toBe('high');
    expect(severityFromScore(0.1)).toBe('low');
    expect(severityFromScore(null)).toBe('unknown');
  });
});

describe('computePriority', () => {
  it('raises a confirmed affected KEV to P0', () => {
    expect(computePriority({ severity: 'critical', versionImpact: 'affected', kev: true })).toBe('P0');
  });

  it('keeps severity and version evidence separate', () => {
    expect(computePriority({ severity: 'high', versionImpact: 'affected', kev: false })).toBe('P1');
    expect(computePriority({ severity: 'critical', versionImpact: 'not_affected', kev: true })).toBe('P3');
    expect(computePriority({ severity: 'medium', versionImpact: 'possibly_affected', kev: false })).toBe('P2');
    expect(computePriority({ severity: 'high', versionImpact: 'insufficient', kev: false })).toBe('P2');
    expect(computePriority({ severity: 'low', versionImpact: 'insufficient', kev: false })).toBe('P3');
  });
});

describe('daysUntil', () => {
  const now = new Date('2026-10-29T00:00:00Z');

  it('computes whole days to the end of the day', () => {
    expect(daysUntil('2026-10-30', now)).toBe(2);
    expect(daysUntil('2026-02-28', now)).toBeLessThan(0);
    expect(daysUntil(null, now)).toBeNull();
  });
});
