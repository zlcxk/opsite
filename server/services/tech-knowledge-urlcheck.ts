import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import type { KnowledgeUrlCheckResult } from '../../shared/types.js';

const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_CONCURRENCY = 4;

interface ResolvedAddress {
  address: string;
  family: number;
}

function ipv4ToInt(value: string): number {
  return value
    .split('.')
    .reduce((total, part) => (total << 8) + Number.parseInt(part, 10), 0) >>> 0;
}

function inIpv4Range(address: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(address) & mask) === (ipv4ToInt(base) & mask);
}

const BLOCKED_IPV4_RANGES = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
];

function ipv6ToBytes(value: string): number[] | null {
  let withoutZone = value.split('%')[0];
  if (withoutZone.includes('.')) {
    const lastColon = withoutZone.lastIndexOf(':');
    const ipv4 = withoutZone.slice(lastColon + 1);
    if (!net.isIPv4(ipv4)) return null;
    const int = ipv4ToInt(ipv4);
    const high = ((int >>> 16) & 0xffff).toString(16);
    const low = (int & 0xffff).toString(16);
    withoutZone = `${withoutZone.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const [headRaw, tailRaw] = withoutZone.split('::');
  const head = headRaw ? headRaw.split(':') : [];
  const tail = tailRaw ? tailRaw.split(':') : [];
  if (!withoutZone.includes('::') && head.length !== 8) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail];
  const bytes: number[] = [];
  for (const group of groups) {
    const parsed = Number.parseInt(group || '0', 16);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0xffff) return null;
    bytes.push((parsed >>> 8) & 0xff, parsed & 0xff);
  }
  return bytes.slice(0, 16);
}

function isBlockedAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    return BLOCKED_IPV4_RANGES.some((range) => inIpv4Range(address, range));
  }
  if (!net.isIPv6(address)) return true;
  const bytes = ipv6ToBytes(address);
  if (!bytes) return true;
  const allZero = bytes.every((byte) => byte === 0);
  if (allZero) return true;
  // ::1 loopback
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return true;
  // IPv4-mapped ::ffff:0:0/96
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isBlockedAddress(bytes.slice(12).join('.'));
  }
  // Deprecated IPv4-compatible ::/96 addresses such as ::7f00:1.
  if (bytes.slice(0, 12).every((byte) => byte === 0)) {
    return isBlockedAddress(bytes.slice(12).join('.'));
  }
  // NAT64 64:ff9b::/96 embeds an IPv4 address in the last four bytes.
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((byte) => byte === 0)
  ) {
    return isBlockedAddress(bytes.slice(12).join('.'));
  }
  // 6to4 2002::/16 embeds the IPv4 address in bytes 2..5.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return isBlockedAddress(bytes.slice(2, 6).join('.'));
  }
  // Teredo 2001:0::/32, documentation 2001:db8::/32, discard-only
  // 100::/64 and documentation 3fff::/20.
  if (bytes[0] === 0x20 && bytes[1] === 0x01) {
    if (bytes[2] === 0x00 && bytes[3] === 0x00) return true;
    if (bytes[2] === 0x0d && bytes[3] === 0xb8) return true;
  }
  if (bytes[0] === 0x01 && bytes[1] === 0x00 && bytes.slice(2, 8).every((byte) => byte === 0)) {
    return true;
  }
  if (bytes[0] === 0x3f && bytes[1] === 0xff && (bytes[2] & 0xf0) === 0xf0) return true;
  // fc00::/7 unique local, fe80::/10 link local, fec0::/10 site local, ff00::/8 multicast.
  if ((bytes[0] & 0xfe) === 0xfc) return true;
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return true;
  if (bytes[0] === 0xff) return true;
  return false;
}

function blockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal' ||
    host === 'metadata'
  ) {
    return true;
  }
  return false;
}

interface ParsedTarget {
  url: URL;
  addresses: ResolvedAddress[];
}

async function parseTarget(raw: string): Promise<ParsedTarget> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('URL 格式不合法');
  }
  if (url.protocol !== 'https:') throw new Error('只允许 HTTPS 官方来源');
  if (url.username || url.password) throw new Error('URL 不能包含用户名或密码');
  if (url.port && url.port !== '443') throw new Error('只允许 443 端口');
  if (blockedHostname(url.hostname)) throw new Error('禁止请求本机、内网或云元数据地址');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: ResolvedAddress[];
  if (net.isIP(hostname)) {
    addresses = [{ address: hostname, family: net.isIP(hostname) }];
  } else {
    try {
      addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new Error('域名无法解析');
    }
  }
  if (!addresses.length) throw new Error('域名没有可用地址');
  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new Error('目标地址属于内网、本机或保留地址');
  }
  return { url, addresses };
}

interface SingleResponse {
  status: number;
  location: string | null;
  title: string | null;
  contentType: string | null;
}

function requestOnce(target: ParsedTarget): Promise<SingleResponse> {
  const { url, addresses } = target;
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        protocol: 'https:',
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          'User-Agent': 'Opsite-Knowledge-Build/1.0 (+official-source-check)',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        // Pin the request to the DNS answer that was already validated. This
        // prevents a second lookup from being rebound to a private address.
        lookup: ((_hostname: string, _options: unknown, callback: Function) => {
          callback(null, address.address, address.family);
        }) as never,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = typeof response.headers.location === 'string' ? response.headers.location : null;
        const contentType = typeof response.headers['content-type'] === 'string'
          ? response.headers['content-type']
          : null;
        let body = '';
        let bytes = 0;
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes <= MAX_RESPONSE_BYTES) body += chunk;
          if (bytes > MAX_RESPONSE_BYTES) response.destroy();
        });
        response.on('error', reject);
        response.on('close', () => {
          const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          const title = titleMatch
            ? titleMatch[1]
                .replace(/\s+/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .trim()
                .slice(0, 200)
            : null;
          resolve({ status, location, title: title || null, contentType });
        });
      },
    );
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('请求超时'));
    });
    request.on('error', reject);
    request.end();
  });
}

async function checkOne(raw: string): Promise<KnowledgeUrlCheckResult> {
  const result: KnowledgeUrlCheckResult = {
    url: raw,
    status: 'unreachable',
    httpStatus: null,
    finalUrl: null,
    title: null,
    redirects: [],
    error: null,
    warning: null,
  };
  let current = raw;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const target = await parseTarget(current).catch((error: unknown) => {
        throw Object.assign(new Error(error instanceof Error ? error.message : '地址不可用'), {
          blocked: /禁止|内网|本机|保留|端口|HTTPS|用户名/.test(
            error instanceof Error ? error.message : '',
          ),
        });
      });
      let response: SingleResponse;
      try {
        response = await requestOnce(target);
      } catch (error) {
        const message = error instanceof Error ? error.message : '请求失败';
        result.error = message === '请求超时' ? '请求超时' : `请求失败：${message}`;
        result.status = 'unreachable';
        result.warning = '链接当前不可访问，资料记录保留，但不得标记为已核实。';
        return result;
      }
      result.httpStatus = response.status;
      result.finalUrl = current;
      if (response.title) result.title = response.title;
      if (response.status >= 300 && response.status < 400 && response.location) {
        if (hop === MAX_REDIRECTS) {
          result.status = 'redirect';
          result.warning = '重定向次数超过限制，未确认最终页面。';
          return result;
        }
        const next = new URL(response.location, current).toString();
        // Validate the redirect target before following it. A redirect must
        // never be able to bypass the private-address checks.
        await parseTarget(next).catch((error: unknown) => {
          throw Object.assign(new Error(error instanceof Error ? error.message : '重定向目标不可用'), {
            blocked: true,
          });
        });
        result.redirects.push(next);
        current = next;
        continue;
      }
      if (response.status >= 200 && response.status < 300) {
        result.status = result.redirects.length ? 'redirect' : 'ok';
        result.warning = result.redirects.length
          ? '链接可访问，但发生了重定向；请确认最终页面仍是预期的官方来源。'
          : null;
        return result;
      }
      result.status = 'unreachable';
      result.warning = `HTTP ${response.status}，链接当前不可访问，不得标记为已核实。`;
      return result;
    }
    result.status = 'redirect';
    result.warning = '重定向次数超过限制。';
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : '地址不可用';
    const blocked = Boolean((error as { blocked?: boolean }).blocked);
    result.status = blocked ? 'blocked' : 'invalid';
    result.error = message;
    result.warning = message;
    return result;
  }
}

export async function checkKnowledgeUrls(
  urls: string[],
  options: { concurrency?: number } = {},
): Promise<KnowledgeUrlCheckResult[]> {
  const unique = [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? DEFAULT_CONCURRENCY));
  const results = new Array<KnowledgeUrlCheckResult>(unique.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, unique.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= unique.length) return;
      results[index] = await checkOne(unique[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export { isBlockedAddress };
