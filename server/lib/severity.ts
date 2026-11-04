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
