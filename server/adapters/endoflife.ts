import { fetchJson } from '../lib/http.js';
import { supportStatusFromEol } from '../lib/severity.js';
import type { AdapterContext, AdapterResult, RawLifecycle } from './types.js';

interface EndOfLifeCycle {
  cycle?: string;
  releaseDate?: string | boolean;
  eol?: string | boolean;
  latest?: string;
  latestReleaseDate?: string;
  support?: string | boolean;
  lts?: string | boolean;
}

function dateOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.slice(0, 10) : null;
}

export async function fetchEndOfLife(context: AdapterContext): Promise<AdapterResult> {
  const product = context.config.product?.trim();
  if (!product) throw new Error('缺少 endoflife.date product 标识');

  const url = `https://endoflife.date/api/${encodeURIComponent(product)}.json`;
  const cycles = await fetchJson<EndOfLifeCycle[]>(url);
  if (!Array.isArray(cycles)) throw new Error('endoflife.date 返回格式异常');

  const lifecycle: RawLifecycle[] = cycles
    .filter((cycle) => cycle.cycle)
    .map((cycle) => {
      const eol = supportStatusFromEol(cycle.eol, cycle.support);
      return {
        cycle: String(cycle.cycle),
        releaseDate: dateOrNull(cycle.releaseDate),
        latestVersion: cycle.latest ? String(cycle.latest) : null,
        latestReleaseDate: dateOrNull(cycle.latestReleaseDate),
        eolDate: eol.eolDate,
        supportStatus: eol.status,
        sourceUrl: `https://endoflife.date/${product}`,
        raw: cycle,
      } satisfies RawLifecycle;
    });

  return {
    lifecycle,
    itemCount: lifecycle.length,
    note: `${lifecycle.length} 个发布周期`,
  };
}
