import type {
  TechFocusLevel,
  TechMasteryStatus,
  TechNodeType,
  TechRelationType,
  TechTreeNode,
  TechViewType,
} from '@shared/types';

export const techNodeTypeLabels: Record<TechNodeType, string> = {
  domain: '领域',
  concept: '概念',
  component: '组件',
  resource: '资源',
  protocol: '协议',
  practice: '实践',
  direction: '方向',
};

export const masteryLabels: Record<TechMasteryStatus, string> = {
  unknown: '未了解',
  to_learn: '待学习',
  learning: '学习中',
  understood: '已了解',
  mastered: '已掌握',
  deep_dive: '深入研究',
};

export const masteryOrder: TechMasteryStatus[] = [
  'unknown',
  'to_learn',
  'learning',
  'understood',
  'mastered',
  'deep_dive',
];

export const focusLabels: Record<TechFocusLevel, string> = {
  normal: '普通关注',
  focus: '重点关注',
};

export const relationLabels: Record<TechRelationType, string> = {
  contains: '包含',
  depends_on: '依赖',
  based_on: '基础于',
  extends: '扩展',
  alternative: '替代',
  implements: '实现',
  related: '关联',
};

export const viewTypeLabels: Record<TechViewType, string> = {
  architecture: '架构视图',
  workflow: '流程图',
  relation: '关系图',
  deployment: '部署视图',
};

const masteryTone: Record<TechMasteryStatus, string> = {
  unknown: '#b8c0b7',
  to_learn: '#b08a3e',
  learning: '#3b6b87',
  understood: '#34715c',
  mastered: '#1f6b4f',
  deep_dive: '#7a5a9b',
};

export function masteryColor(status: TechMasteryStatus): string {
  return masteryTone[status] ?? masteryTone.unknown;
}

export function flattenTree(nodes: TechTreeNode[]): TechTreeNode[] {
  const result: TechTreeNode[] = [];
  const walk = (list: TechTreeNode[]) => {
    for (const node of list) {
      result.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return result;
}

export function filterTree(nodes: TechTreeNode[], term: string): TechTreeNode[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return nodes;
  const walk = (list: TechTreeNode[]): TechTreeNode[] =>
    list
      .map((node) => {
        const children = walk(node.children);
        const match = node.name.toLowerCase().includes(needle) || (node.summary ?? '').toLowerCase().includes(needle);
        return match || children.length ? { ...node, children } : null;
      })
      .filter((node): node is TechTreeNode => Boolean(node));
  return walk(nodes);
}

export function findTreeNode(nodes: TechTreeNode[], id: string): TechTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findTreeNode(node.children, id);
    if (found) return found;
  }
  return null;
}

export function siblingIds(nodes: TechTreeNode[], parentId: string | null): string[] {
  if (!parentId) return nodes.map((node) => node.id);
  const parent = findTreeNode(nodes, parentId);
  return parent ? parent.children.map((node) => node.id) : [];
}

export function truncate(value: string | null | undefined, length: number): string {
  if (!value) return '';
  return value.length > length ? `${value.slice(0, length)}…` : value;
}
