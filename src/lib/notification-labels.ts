import type {
  DeliveryStatus,
  FollowTargetType,
  NotificationMinSeverity,
  NotificationRuleType,
  NotificationSeverity,
} from '@shared/types';

export const notificationRuleMeta: Record<
  NotificationRuleType,
  { label: string; description: string; code: string }
> = {
  high_risk_advisory: {
    label: '高风险漏洞',
    description: 'P0 / P1 漏洞，包含确认受影响的 KEV 条目。',
    code: 'ADV-H',
  },
  lifecycle_change: {
    label: '生命周期变化',
    description: '进入即将 EOL 或已经 EOL，含维护截止日期变化。',
    code: 'EOL',
  },
  new_vulnerability: {
    label: '新漏洞',
    description: 'P2 / P3 新公告，信息性提醒。',
    code: 'ADV',
  },
  advisory_update: {
    label: '公告更新',
    description: '上游标题、发布时间或优先级发生变化。',
    code: 'ADV-U',
  },
  new_release: {
    label: '版本发布',
    description: '关注对象出现新的稳定版本。',
    code: 'REL',
  },
  project_update: {
    label: '项目更新',
    description: '技术雷达条目新增评估、试用或采用记录。',
    code: 'RAD',
  },
  discovery: {
    label: '发现候选',
    description: '技术发现流出现新的候选项目。',
    code: 'DISC',
  },
};

export const notificationRuleOrder = Object.keys(notificationRuleMeta) as NotificationRuleType[];

export const notificationSeverityMeta: Record<
  NotificationSeverity,
  { label: string; className: string }
> = {
  urgent: { label: '紧急', className: 'critical' },
  important: { label: '重要', className: 'high' },
  normal: { label: '普通', className: 'neutral' },
};

export const targetTypeMeta: Record<FollowTargetType, { label: string; code: string }> = {
  software: { label: '软件', code: 'SW' },
  radar: { label: '雷达条目', code: 'RADAR' },
  discovery: { label: '发现候选', code: 'DISC' },
  advisory: { label: '漏洞公告', code: 'ADV' },
};

export const deliveryStatusMeta: Record<DeliveryStatus, { label: string; className: string }> = {
  pending: { label: '待发送', className: 'neutral' },
  sending: { label: '发送中', className: 'note' },
  sent: { label: '已发送', className: 'calm' },
  failed: { label: '发送失败', className: 'danger' },
  skipped: { label: '已跳过', className: 'warn' },
};

export const minSeverityOptions: Array<{ value: NotificationMinSeverity; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'important', label: '重要及以上' },
  { value: 'urgent', label: '仅紧急' },
];
