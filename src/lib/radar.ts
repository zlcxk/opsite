import type { RadarKind, RadarRecordType, RadarStatus } from '@shared/types';

export const radarKindMeta: Record<RadarKind, { label: string; code: string }> = {
  tool: { label: '工具', code: 'Tool' },
  tech: { label: '技术', code: 'Tech' },
  learning: { label: '学习', code: 'Learning' },
};

export const radarStatusMeta: Record<RadarStatus, { label: string; className: string }> = {
  pending: { label: '待评估', className: 'neutral' },
  trialing: { label: '试用中', className: 'info' },
  adopted: { label: '已采用', className: 'calm' },
  deferred: { label: '稍后关注', className: 'warn' },
  ignored: { label: '已忽略', className: 'neutral' },
};

export const radarRecordTypeMeta: Record<RadarRecordType, { label: string; short: string }> = {
  evaluation: { label: '评估记录', short: '评估' },
  trial: { label: '试用记录', short: '试用' },
  adoption: { label: '采用记录', short: '采用' },
  note: { label: '备注', short: '备注' },
  status_change: { label: '状态变更', short: '状态' },
};

interface StatusAction {
  status: RadarStatus;
  label: string;
}

const transitions: Record<RadarStatus, StatusAction[]> = {
  pending: [
    { status: 'trialing', label: '开始试用' },
    { status: 'deferred', label: '稍后关注' },
    { status: 'ignored', label: '忽略条目' },
  ],
  trialing: [
    { status: 'adopted', label: '标记为已采用' },
    { status: 'pending', label: '回到待评估' },
    { status: 'deferred', label: '稍后关注' },
  ],
  adopted: [{ status: 'trialing', label: '重新试用' }],
  deferred: [{ status: 'pending', label: '重新评估' }],
  ignored: [{ status: 'pending', label: '恢复关注' }],
};

export function radarStatusActions(status: RadarStatus): StatusAction[] {
  return transitions[status] ?? [];
}

export type RadarPrimaryAction =
  | { kind: 'status'; label: string; status: RadarStatus }
  | { kind: 'record'; label: string; recordType: RadarRecordType };

export function radarPrimaryAction(status: RadarStatus): RadarPrimaryAction {
  if (status === 'pending') return { kind: 'record', label: '开始评估', recordType: 'evaluation' };
  if (status === 'trialing') return { kind: 'record', label: '记录试用结果', recordType: 'trial' };
  if (status === 'adopted') return { kind: 'record', label: '记录采用情况', recordType: 'adoption' };
  if (status === 'deferred') return { kind: 'status', label: '重新评估', status: 'pending' };
  return { kind: 'status', label: '恢复关注', status: 'pending' };
}

export function radarRecordAction(
  status: RadarStatus,
): { label: string; recordType: Exclude<RadarRecordType, 'status_change'> } | null {
  if (status === 'pending') return { label: '开始评估', recordType: 'evaluation' };
  if (status === 'trialing') return { label: '记录试用结果', recordType: 'trial' };
  if (status === 'adopted') return { label: '记录采用情况', recordType: 'adoption' };
  return null;
}

export const radarRecordTypeOptions: Array<{ value: Exclude<RadarRecordType, 'status_change'>; label: string }> = [
  { value: 'evaluation', label: '评估 · 判断是否值得投入' },
  { value: 'trial', label: '试用 · 记录验证过程与结果' },
  { value: 'adoption', label: '采用 · 记录落地情况' },
  { value: 'note', label: '备注 · 补充背景或问题' },
];
