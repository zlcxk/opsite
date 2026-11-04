import { describe, expect, it } from 'vitest';
import { fetchEndOfLife } from './endoflife.js';

/**
 * Real-API verification is deliberately opt-in so normal unit tests stay
 * deterministic and offline. Run with ENDOFLIFE_LIVE=1.
 */
const describeLive = process.env.ENDOFLIFE_LIVE === '1' ? describe : describe.skip;

async function fetchProduct(product: string) {
  const result = await fetchEndOfLife({
    sourceId: 'live',
    softwareId: 'live',
    config: { product },
  });
  return result.lifecycle ?? [];
}

function find(rows: Awaited<ReturnType<typeof fetchProduct>>, cycle: string) {
  const row = rows.find((item) => item.cycle === cycle);
  if (!row) throw new Error(`live payload missing cycle ${cycle}`);
  return row;
}

describeLive('endoflife.date v1 live verification', () => {
  it('Kubernetes active/maintenance phases match the official payload', async () => {
    const rows = await fetchProduct('kubernetes');
    const current = find(rows, '1.37');
    expect(current.activeSupportEnd).toBe('2027-08-28');
    expect(current.maintenanceSupportEnd).toBe('2027-10-28');
    expect(current.eolDate).toBe(current.maintenanceSupportEnd);
    expect(current.vendorSupportEnd).toBeNull();
  }, 40_000);

  it('Kafka Confluent support stays out of upstream EOL', async () => {
    const rows = await fetchProduct('apache-kafka');
    const current = find(rows, '4.4');
    expect(current.eolDate).toBeNull();
    expect(current.vendorSupportEnd).toBe('2028-10-27');
    expect(current.supportStatus).not.toBe('eol');
  }, 40_000);

  it('covers PostgreSQL, Redis, nginx and Prometheus', async () => {
    const [postgresql, redis, nginx, prometheus] = await Promise.all([
      fetchProduct('postgresql'),
      fetchProduct('redis'),
      fetchProduct('nginx'),
      fetchProduct('prometheus'),
    ]);
    expect(find(postgresql, '18').eolDate).toBe('2030-11-14');
    expect(find(redis, '8.8').eolDate).toBeNull();
    expect(find(nginx, '1.31').eolDate).toBeNull();
    expect(find(prometheus, '3.15').eolDate).toBe('2026-11-06');
  }, 60_000);
});
