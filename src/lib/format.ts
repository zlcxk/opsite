import type {
  AdvisoryStatus,
  EventType,
  Priority,
  SupportStatus,
  VersionImpact,
  WatchLevel,
} from '@shared/types';

const relative = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
const shortDateFormatter = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' });
const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function relativeTime(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return '尚未同步';
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60_000) return '刚刚';
  if (abs < 3_600_000) return relative.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return relative.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 2_592_000_000) return relative.format(Math.round(diff / 86_400_000), 'day');
  return formatDate(value);
}

export function formatDate(value: string | null | undefined): string {
  const date = toDate(value);
  return date ? dateFormatter.format(date).replaceAll('/', '-') : '—';
}

export function formatShortDate(value: string | null | undefined): string {
  const date = toDate(value);
  return date ? shortDateFormatter.format(date) : '—';
}

export function formatDateTime(value: string | null | undefined): string {
  const date = toDate(value);
  return date ? dateTimeFormatter.format(date) : '—';
}

export function daysFromNow(value: string | null | undefined): number | null {
  const date = toDate(value);
  if (!date) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

export function eolLabel(value: string | null | undefined): string {
  const days = daysFromNow(value);
  if (days === null) return '未知';
  if (days < 0) return `已过期 ${Math.abs(days)} 天`;
  if (days === 0) return '今天到期';
  if (days <= 180) return `${days} 天后到期`;
  return formatDate(value);
}

export const priorityMeta: Record<Priority, { label: string; short: string; className: string }> = {
  P0: { label: 'P0 · 立即处理', short: 'P0', className: 'p0' },
  P1: { label: 'P1 · 高优先级', short: 'P1', className: 'p1' },
  P2: { label: 'P2 · 需要核实', short: 'P2', className: 'p2' },
  P3: { label: 'P3 · 一般公告', short: 'P3', className: 'p3' },
};

export const supportMeta: Record<SupportStatus, { label: string; className: string }> = {
  supported: { label: '支持中', className: 'calm' },
  approaching_eol: { label: '即将停止支持', className: 'warn' },
  eol: { label: '已停止支持', className: 'danger' },
  unknown: { label: '生命周期未知', className: 'neutral' },
};

export const impactMeta: Record<VersionImpact, { label: string; className: string }> = {
  affected: { label: '确认受影响', className: 'danger' },
  possibly_affected: { label: '可能受影响', className: 'warn' },
  not_affected: { label: '不受影响', className: 'calm' },
  insufficient: { label: '版本信息不足', className: 'neutral' },
};

export const advisoryStatusMeta: Record<AdvisoryStatus, string> = {
  pending: '待确认',
  to_fix: '待修复',
  planned: '已计划',
  fixed: '已修复',
  not_affected: '确认不受影响',
  ignored: '已忽略',
};

export const eventTypeMeta: Record<EventType, { label: string; icon: string }> = {
  vulnerability: { label: '安全漏洞', icon: 'shield' },
  release: { label: '版本发布', icon: 'tag' },
  lifecycle: { label: '生命周期', icon: 'clock' },
  source_issue: { label: '数据源', icon: 'plug' },
};

export const watchLevelMeta: Record<WatchLevel, { label: string; className: string }> = {
  critical: { label: '重点盯防', className: 'danger' },
  high: { label: '重点关注', className: 'warn' },
  normal: { label: '常规关注', className: 'neutral' },
};

export const severityMeta: Record<string, { label: string; className: string }> = {
  critical: { label: '严重', className: 'danger' },
  high: { label: '高危', className: 'warn' },
  medium: { label: '中危', className: 'note' },
  low: { label: '低危', className: 'neutral' },
  unknown: { label: '未知', className: 'neutral' },
};

const categoryColors: Record<string, string> = {
  容器与编排: '#3e6b8a',
  数据库: '#a06a2c',
  'Web 与代理': '#437865',
  可观测性: '#6d5a8f',
  运行时: '#5b7a3c',
  操作系统: '#9a5a47',
  基础设施: '#5d6b77',
  'CI/CD': '#8c5470',
  消息与流: '#7a6637',
  其他: '#6d7972',
};

export function categoryColor(category: string): string {
  return categoryColors[category] ?? '#6d7972';
}

export function initials(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}]/gu, '');
  if (!cleaned) return '?';
  if (/^[a-zA-Z]/.test(cleaned)) {
    const words = name.split(/[\s._-]+/).filter(Boolean);
    if (words.length > 1) return `${words[0][0]}${words[1][0]}`.toUpperCase();
    return cleaned.slice(0, 2).toUpperCase();
  }
  return cleaned.slice(0, 2);
}

export function daysUntilLabel(date: string | null | undefined): string {
  const days = daysFromNow(date);
  if (days === null) return '未知';
  if (days < 0) return '已停止支持';
  if (days <= 180) return `${days} 天后`;
  return formatDate(date);
}

export function sourceTypeLabel(type: string): string {
  return {
    endoflife: 'endoflife.date',
    github_releases: 'GitHub Releases',
    github_advisories: 'GitHub Advisory',
    nvd: 'NVD CVE',
    cisa_kev: 'CISA KEV',
    upstream_advisory: '上游公告',
  }[type] ?? type;
}
