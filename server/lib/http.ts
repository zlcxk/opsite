export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
}

export class HttpError extends Error {
  status: number;
  url: string;
  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

const DEFAULT_UA = 'Opsite/0.1 (personal operations intelligence; +https://github.com/zlcxk/opsite)';

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const { headers = {}, timeoutMs = 25_000, retries = 2 } = options;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': DEFAULT_UA,
          ...headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.ok) return (await response.json()) as T;

      const body = await response.text().catch(() => '');
      const message = `HTTP ${response.status}${body ? ` · ${body.slice(0, 220)}` : ''}`;
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 20_000) : 1200 * (attempt + 1);
        await sleep(waitMs);
        lastError = new HttpError(message, response.status, url);
        continue;
      }
      throw new HttpError(message, response.status, url);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries && !(error instanceof HttpError && error.status < 500 && error.status !== 429)) {
        await sleep(900 * (attempt + 1));
        continue;
      }
      break;
    }
  }

  if (lastError instanceof HttpError) {
    throw new Error(`${lastError.status === 403 ? '访问受限或速率超限' : '请求失败'}：${lastError.message}`);
  }
  throw new Error(`请求失败：${lastError?.message ?? '未知错误'}`);
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const { headers = {}, timeoutMs = 25_000, retries = 1 } = options;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': DEFAULT_UA, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return await response.text();
      lastError = new Error(`HTTP ${response.status}`);
      if (attempt < retries) await sleep(1000);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries) await sleep(1000);
    }
  }
  throw new Error(`请求失败：${lastError?.message ?? '未知错误'}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
