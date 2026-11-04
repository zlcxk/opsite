import { describe, expect, it } from 'vitest';
import {
  deriveSupportStatus,
  mapEndOfLifeProduct,
  parseLifecycleDate,
} from './endoflife.js';
import { ENDOFLIFE_FIXTURES } from './fixtures/endoflife.js';

const now = new Date('2026-11-04T00:00:00Z');

function map(product: string, payload: unknown = ENDOFLIFE_FIXTURES[product]) {
  return mapEndOfLifeProduct(payload, product, now);
}

function cycle(product: string, name: string) {
  const row = map(product).lifecycle.find((item) => item.cycle === name);
  if (!row) throw new Error(`fixture missing cycle ${product} ${name}`);
  return row;
}

describe('lifecycle date parsing', () => {
  it('accepts calendar dates and ISO timestamps only', () => {
    expect(parseLifecycleDate('2026-11-04')).toBe('2026-11-04');
    expect(parseLifecycleDate('2026-11-04T12:00:00Z')).toBe('2026-11-04');
    expect(parseLifecycleDate(' 2026-11-04 ')).toBe('2026-11-04');
  });

  it('never coerces booleans, descriptions or invalid calendar dates', () => {
    expect(parseLifecycleDate(false)).toBeNull();
    expect(parseLifecycleDate(true)).toBeNull();
    expect(parseLifecycleDate('false')).toBeNull();
    expect(parseLifecycleDate('best effort')).toBeNull();
    expect(parseLifecycleDate('2026-02-30')).toBeNull();
    expect(parseLifecycleDate('2026-1-1')).toBeNull();
  });
});

describe('support status derivation', () => {
  it('does not treat an upstream false EOL flag as ended', () => {
    expect(
      deriveSupportStatus({ eolDate: null, isEol: false, isMaintained: true, now }),
    ).toBe('supported');
  });

  it('uses explicit end-of-life flags without inventing a date', () => {
    expect(
      deriveSupportStatus({ eolDate: null, isEol: true, isMaintained: false, now }),
    ).toBe('eol');
    expect(
      deriveSupportStatus({ eolDate: null, isEol: null, isMaintained: false, now }),
    ).toBe('eol');
  });

  it('flags approaching EOL from a trusted date', () => {
    expect(
      deriveSupportStatus({ eolDate: '2026-11-06', isEol: false, isMaintained: true, now }),
    ).toBe('approaching_eol');
    expect(
      deriveSupportStatus({ eolDate: '2028-01-01', isEol: false, isMaintained: true, now }),
    ).toBe('supported');
    expect(
      deriveSupportStatus({ eolDate: '2026-02-28', isEol: false, isMaintained: true, now }),
    ).toBe('eol');
  });

  it('returns unknown when no trusted evidence exists', () => {
    expect(
      deriveSupportStatus({ eolDate: null, isEol: null, isMaintained: null, now }),
    ).toBe('unknown');
  });
});

describe('Kubernetes lifecycle mapping', () => {
  it('maps active and maintenance phases separately from upstream EOL', () => {
    const row = cycle('kubernetes', '1.37');
    expect(row.releaseDate).toBe('2026-08-26');
    expect(row.activeSupportEnd).toBe('2027-08-28');
    expect(row.maintenanceSupportEnd).toBe('2027-10-28');
    expect(row.eolDate).toBe('2027-10-28');
    expect(row.vendorSupportEnd).toBeNull();
    expect(row.supportStatus).toBe('supported');
    expect(row.latestVersion).toBe('1.37.2');
    expect(row.warnings).toEqual([]);
  });

  it('does not carry a past active-support date into EOL status', () => {
    const row = cycle('kubernetes', '1.34');
    expect(row.activeSupportEnd).toBe('2026-08-27');
    expect(row.eolDate).toBe('2026-10-27');
    expect(row.supportStatus).toBe('eol');
  });
});

describe('Apache Kafka lifecycle mapping', () => {
  it('keeps the Confluent deadline as vendor support, not upstream EOL', () => {
    const row = cycle('apache-kafka', '4.4');
    expect(row.eolDate).toBeNull();
    expect(row.vendorSupportEnd).toBe('2028-10-27');
    expect(row.maintenanceSupportEnd).toBeNull();
    expect(row.activeSupportEnd).toBeNull();
    expect(row.supportStatus).toBe('supported');
  });

  it('preserves the raw labels and release fields for diagnostics', () => {
    const row = cycle('apache-kafka', '4.4');
    const raw = row.raw as {
      labels: { eol: string; eoes: string };
      release: { eoesFrom: string; eolFrom: null };
    };
    expect(raw.labels.eol).toBe('Support');
    expect(raw.labels.eoes).toBe('Confluent Community software End of Support');
    expect(raw.release.eoesFrom).toBe('2028-10-27');
    expect(raw.release.eolFrom).toBeNull();
  });
});

describe('other lifecycle sources', () => {
  it('maps PostgreSQL support end without inventing a maintenance phase', () => {
    const row = cycle('postgresql', '18');
    expect(row.eolDate).toBe('2030-11-14');
    expect(row.maintenanceSupportEnd).toBeNull();
    expect(row.supportStatus).toBe('supported');
  });

  it('maps Redis active support without treating its end as EOL', () => {
    const current = cycle('redis', '8.10');
    expect(current.eolDate).toBeNull();
    expect(current.activeSupportEnd).toBeNull();
    expect(current.supportStatus).toBe('supported');

    const securityOnly = cycle('redis', '8.8');
    expect(securityOnly.activeSupportEnd).toBe('2026-07-29');
    expect(securityOnly.eolDate).toBeNull();
    expect(securityOnly.supportStatus).toBe('supported');
  });

  it('maps nginx open-ended security support and ended cycles', () => {
    expect(cycle('nginx', '1.31').supportStatus).toBe('supported');
    expect(cycle('nginx', '1.31').eolDate).toBeNull();
    expect(cycle('nginx', '1.29').supportStatus).toBe('eol');
    expect(cycle('nginx', '1.29').eolDate).toBe('2026-05-13');
  });

  it('maps Prometheus approaching and ended cycles from its EOL date', () => {
    expect(cycle('prometheus', '3.15').supportStatus).toBe('approaching_eol');
    expect(cycle('prometheus', '3.15').eolDate).toBe('2026-11-06');
    expect(cycle('prometheus', '3.14').supportStatus).toBe('eol');
  });

  it('keeps the original label when a cycle name has annotations', () => {
    const row = cycle('prometheus', '3.13');
    expect(row.cycle).toBe('3.13');
    expect((row.raw as { release: { label: string } }).release.label).toBe('3.13 (LTS)');
  });
});

describe('defensive parsing', () => {
  it('keeps unknown fields raw and does not map them to dates', () => {
    const payload = {
      result: {
        labels: { eol: 'Support' },
        releases: [
          {
            name: '1.0',
            support: 'best effort',
            eol: false,
            isMaintained: true,
            latest: { name: '1.0.1', date: '2026-01-01' },
          },
        ],
      },
    };
    const row = map('unknown-product', payload).lifecycle[0];
    expect(row.eolDate).toBeNull();
    expect(row.activeSupportEnd).toBeNull();
    expect(row.maintenanceSupportEnd).toBeNull();
    expect(row.vendorSupportEnd).toBeNull();
    expect(row.supportStatus).toBe('supported');
    expect((row.raw as { release: { support: string } }).release.support).toBe('best effort');
  });

  it('does not turn malformed dates or string booleans into lifecycle data', () => {
    const payload = {
      result: {
        labels: { eol: 'Support' },
        releases: [
          {
            name: '2.0',
            releaseDate: false,
            eolFrom: '2030-02-30',
            isEol: 'false',
            latest: { name: '2.0.1', date: 'not-a-date' },
          },
        ],
      },
    };
    const row = map('broken-product', payload).lifecycle[0];
    expect(row.releaseDate).toBeNull();
    expect(row.eolDate).toBeNull();
    expect(row.latestReleaseDate).toBeNull();
    expect(row.supportStatus).toBe('unknown');
    expect(row.warnings.join('\n')).toContain('releaseDate');
    expect(row.warnings.join('\n')).toContain('eolFrom');
    expect(row.warnings.join('\n')).toContain('isEol');
    expect(row.warnings.join('\n')).toContain('latest.date');
  });

  it('accepts missing optional fields without inventing values', () => {
    const payload = {
      result: { labels: { eol: 'Support' }, releases: [{ name: '3.0' }] },
    };
    const row = map('sparse-product', payload).lifecycle[0];
    expect(row).toMatchObject({
      cycle: '3.0',
      releaseDate: null,
      latestVersion: null,
      latestReleaseDate: null,
      eolDate: null,
      activeSupportEnd: null,
      maintenanceSupportEnd: null,
      vendorSupportEnd: null,
      supportStatus: 'unknown',
      warnings: [],
    });
  });

  it('rejects an unusable payload instead of returning empty data', () => {
    expect(() => map('missing-result', {})).toThrow(/缺少 result/);
    expect(() => map('missing-releases', { result: { labels: { eol: 'Support' } } })).toThrow(
      /缺少 releases/,
    );
    expect(() =>
      map('empty-releases', { result: { labels: { eol: 'Support' }, releases: [] } }),
    ).toThrow(/未返回可识别的发布周期/);
  });
});
