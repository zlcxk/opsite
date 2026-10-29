import type {
  DiscoveryJobStatus,
  DiscoverySourceStatus,
  DiscoverySourceType,
  DiscoveryStatus,
} from '@shared/types';

export const discoveryStatusMeta: Record<
  DiscoveryStatus,
  { label: string; className: string; description: string }
> = {
  pending: {
    label: '待评估',
    className: 'warn',
    description: '尚未做决定，可以加入技术雷达、继续观察或忽略。',
  },
  imported: {
    label: '已收录',
    className: 'calm',
    description: '已经进入技术雷达，后续在雷达里维护评估记录。',
  },
  ignored: {
    label: '已忽略',
    className: 'neutral',
    description: '不再出现在待评估列表，来源数据和首次发现时间仍然保留。',
  },
};

export const discoverySourceMeta: Record<
  DiscoverySourceType,
  { label: string; code: string; description: string }
> = {
  github: {
    label: 'GitHub',
    code: 'GH',
    description: '通过 GitHub 搜索 API 按已配置的关键词与主题规则发现仓库。',
  },
  cncf: {
    label: 'CNCF Landscape',
    code: 'CNCF',
    description: '来自 CNCF Landscape 官方公开数据中的毕业与孵化项目。',
  },
};

export const discoverySourceStatusMeta: Record<
  DiscoverySourceStatus,
  { label: string; className: string }
> = {
  never: { label: '尚未采集', className: 'neutral' },
  ok: { label: '采集正常', className: 'calm' },
  partial: { label: '部分规则失败', className: 'warn' },
  error: { label: '采集失败', className: 'danger' },
};

export const discoveryJobStatusMeta: Record<
  DiscoveryJobStatus,
  { label: string; className: string }
> = {
  running: { label: '采集中', className: 'info' },
  success: { label: '成功', className: 'calm' },
  partial: { label: '部分成功', className: 'warn' },
  error: { label: '失败', className: 'danger' },
};

export function formatMetric(value: number | null): string {
  if (value == null) return '未知';
  if (value >= 10_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return value.toLocaleString('zh-CN');
}

export function discoverySourceLabel(type: DiscoverySourceType): string {
  return discoverySourceMeta[type].label;
}
