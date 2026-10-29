import type { Priority, SupportStatus, VersionImpact } from '../../shared/types.js';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

export function normalizeSeverity(input: unknown): Severity {
  const value = String(input ?? '').toLowerCase();
  if (value === 'critical' || value === '严重') return 'critical';
  if (value === 'high' || value === 'important' || value === '高' || value === '重要') return 'high';
  if (value === 'medium' || value === 'moderate' || value === '中' || value === '中等') return 'medium';
  if (value === 'low' || value === '低') return 'low';
  return 'unknown';
}

export function severityFromScore(score: number | null | undefined): Severity {
  if (score == null || Number.isNaN(score)) return 'unknown';
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  if (score > 0) return 'low';
  return 'unknown';
}

export function severityRank(severity: Severity): number {
  return { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 }[severity];
}

export function computePriority(input: {
  severity: Severity;
  versionImpact: VersionImpact;
  kev: boolean;
  confidence?: 'high' | 'medium' | 'low';
}): Priority {
  const { severity, versionImpact, kev } = input;
  if (kev && versionImpact === 'affected') return 'P0';
  if (versionImpact === 'affected' && (severity === 'critical' || severity === 'high')) return 'P1';
  if (versionImpact === 'affected') return 'P2';
  if (versionImpact === 'possibly_affected') return kev ? 'P1' : 'P2';
  if (versionImpact === 'insufficient' && (kev || severity === 'critical' || severity === 'high')) return 'P2';
  return 'P3';
}

export function isOpenAdvisory(status: string): boolean {
  return status !== 'fixed' && status !== 'not_affected' && status !== 'ignored';
}

export function supportStatusFromEol(
  eolRaw: unknown,
  supportRaw: unknown,
  now = new Date(),
  approachingDays = 180,
): { status: SupportStatus; eolDate: string | null } {
  const candidate = normalizeDateCandidate(eolRaw);
  const supportCandidate = normalizeDateCandidate(supportRaw);

  if (candidate === false || supportCandidate === false) {
    return { status: 'eol', eolDate: supportCandidate || null };
  }

  const dateValue = candidate || supportCandidate;
  if (!dateValue) {
    return { status: 'unknown', eolDate: null };
  }

  const date = new Date(dateValue.includes('T') ? dateValue : `${dateValue}T23:59:59Z`);
  if (Number.isNaN(date.getTime())) {
    return { status: 'unknown', eolDate: null };
  }
  const diffMs = date.getTime() - now.getTime();
  const diffDays = diffMs / 86_400_000;
  if (diffDays <= 0) return { status: 'eol', eolDate: dateValue };
  if (diffDays <= approachingDays) return { status: 'approaching_eol', eolDate: dateValue };
  return { status: 'supported', eolDate: dateValue };
}

function normalizeDateCandidate(value: unknown): string | false | null {
  if (value === false) return false;
  if (value === true) return new Date().toISOString().slice(0, 10);
  if (typeof value === 'string' && value.trim()) {
    const text = value.trim();
    if (text.toLowerCase() === 'false') return false;
    if (text.toLowerCase() === 'true') return new Date().toISOString().slice(0, 10);
    return text.slice(0, 10);
  }
  return null;
}

export function daysUntil(date: string | null, now = new Date()): number | null {
  if (!date) return null;
  const parsed = new Date(date.length > 10 ? date : `${date}T23:59:59Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.ceil((parsed.getTime() - now.getTime()) / 86_400_000);
}

export const SUPPORT_LABELS: Record<SupportStatus, string> = {
  supported: '支持中',
  approaching_eol: '即将停止支持',
  eol: '已停止支持',
  unknown: '未知',
};
