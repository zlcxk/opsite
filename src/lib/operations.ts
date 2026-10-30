import type {
  CollectionRunStatus,
  CollectionTrigger,
  DataSourceType,
  FreshnessStatus,
  OperationIssueKind,
  SourceHealthStatus,
} from '@shared/types';

export const dataSourceTypeMeta: Record<
  DataSourceType,
  { label: string; code: string; className: string }
> = {
  lifecycle: { label: '生命周期', code: 'LIFE', className: 'pill-info' },
  release: { label: '版本发布', code: 'REL', className: 'pill-signal' },
  security: { label: '安全漏洞', code: 'SEC', className: 'pill-warn' },
  discovery: { label: '技术发现', code: 'DISC', className: 'pill-calm' },
};

export const healthStatusMeta: Record<
  SourceHealthStatus,
  { label: string; className: string; dot: string }
> = {
  ok: { label: '健康', className: 'pill-calm', dot: 'ok' },
  error: { label: '异常', className: 'pill-danger', dot: 'error' },
  rate_limited: { label: '限流', className: 'pill-warn', dot: 'warn' },
  unknown: { label: '待检查', className: 'pill-neutral', dot: 'idle' },
  disabled: { label: '已停用', className: 'pill-neutral', dot: 'off' },
};

export const freshnessMeta: Record<
  FreshnessStatus,
  { label: string; className: string; hint: string }
> = {
  fresh: { label: '新鲜', className: 'pill-calm', hint: '最新数据仍在采集周期内' },
  expiring: { label: '临近过期', className: 'pill-warn', hint: '已进入宽限期，建议关注采集结果' },
  expired: { label: '已过期', className: 'pill-danger', hint: '实际数据更新时间超过预期周期' },
  unknown: { label: '未知', className: 'pill-neutral', hint: '尚未记录实际数据更新时间' },
};

export const runStatusMeta: Record<
  CollectionRunStatus,
  { label: string; className: string; dot: string }
> = {
  running: { label: '执行中', className: 'pill-info', dot: 'warn' },
  success: { label: '成功', className: 'pill-calm', dot: 'ok' },
  failed: { label: '失败', className: 'pill-danger', dot: 'error' },
  timeout: { label: '超时', className: 'pill-warn', dot: 'warn' },
};

export const runTriggerMeta: Record<CollectionTrigger, string> = {
  scheduled: '定时',
  manual: '手动',
  retry: '重试',
};

export const issueKindMeta: Record<
  OperationIssueKind,
  { label: string; className: string; code: string }
> = {
  source_anomaly: { label: '数据源异常', className: 'pill-danger', code: 'SRC' },
  rate_limit: { label: '接口限流', className: 'pill-warn', code: 'RATE' },
  task_failure: { label: '任务失败', className: 'pill-danger', code: 'TASK' },
  task_timeout: { label: '任务超时', className: 'pill-warn', code: 'TIME' },
  data_stale: { label: '数据过期', className: 'pill-warn', code: 'STALE' },
  scheduler: { label: '调度异常', className: 'pill-neutral', code: 'CRON' },
};

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatAgeHours(hours: number | null | undefined): string {
  if (hours == null) return '尚未记录';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} 分钟`;
  if (hours < 48) return `${hours.toFixed(1)} 小时`;
  return `${(hours / 24).toFixed(1)} 天`;
}

export function formatPercent(value: number | null | undefined): string {
  return value == null ? '—' : `${value.toFixed(1)}%`;
}
