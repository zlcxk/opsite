import { describe, expect, it } from 'vitest';
import {
  computePriority,
  daysUntil,
  normalizeSeverity,
  severityFromScore,
  supportStatusFromEol,
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

describe('supportStatusFromEol', () => {
  const now = new Date('2026-10-29T00:00:00Z');

  it('treats an upstream false EOL as ended', () => {
    expect(supportStatusFromEol(false, null, now)).toEqual({ status: 'eol', eolDate: null });
  });

  it('flags approaching EOL inside the threshold', () => {
    expect(supportStatusFromEol('2027-03-01', null, now).status).toBe('approaching_eol');
    expect(supportStatusFromEol('2028-01-01', null, now).status).toBe('supported');
    expect(supportStatusFromEol('2026-02-28', null, now).status).toBe('eol');
  });

  it('returns unknown when no trusted date exists', () => {
    expect(supportStatusFromEol(null, null, now)).toEqual({ status: 'unknown', eolDate: null });
    expect(supportStatusFromEol('not a date', null, now)).toEqual({ status: 'unknown', eolDate: null });
  });

  it('computes whole days to the end of the EOL day', () => {
    expect(daysUntil('2026-10-30', now)).toBe(2);
    expect(daysUntil('2026-02-28', now)).toBeLessThan(0);
    expect(daysUntil(null, now)).toBeNull();
  });
});
