export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const cleaned = value.trim().replace(/^v/i, '');
    const core = cleaned.match(/^\d+(?:\.\d+)*/)?.[0] ?? '0';
    const prerelease = /-(alpha|beta|rc|pre|dev|snapshot)/i.test(cleaned);
    return { parts: core.split('.').map(Number), prerelease };
  };
  const pa = parse(a);
  const pb = parse(b);
  const length = Math.max(pa.parts.length, pb.parts.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (pa.parts[i] ?? 0) - (pb.parts[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  if (pa.prerelease && !pb.prerelease) return -1;
  if (!pa.prerelease && pb.prerelease) return 1;
  return 0;
}

export function hasUpdate(current: string | null, latest: string | null): boolean {
  if (!current || !latest) return false;
  return compareVersions(latest, current) > 0;
}
