import type {
  TechContentSource,
  TechContentStatus,
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

export const contentStatusLabels: Record<TechContentStatus, string> = {
  missing: '待补充',
  draft: '草稿',
  complete: '已完善',
  needs_review: '待核实',
};

export const contentSourceLabels: Record<TechContentSource, string> = {
  official: '官方文档',
  practice: '实践经验',
  curated: '整理归纳',
  mixed: '综合',
};

export const contentStatusOrder: TechContentStatus[] = [
  'missing',
  'draft',
  'needs_review',
  'complete',
];

const docTemplates: Record<TechNodeType, string> = {
  domain: `## 领域定义

## 为什么值得关注

## 关键能力

## 成熟度与风险

## 适用场景

## 相关技术

## 参考入口`,
  concept: `## 概念定义

## 设计目的

## 核心原理

## 工作机制

## 典型场景

## 与其他概念的区别

## 参考资料`,
  component: `## 组件定位

## 核心职责

## 工作原理

## 关键配置

## 常见故障与排查

## 相关组件

## 参考资料`,
  resource: `## 资源定义

## 解决的问题

## 核心字段

## 生命周期

## 配置示例

## 常见问题

## 相关资源`,
  protocol: `## 协议定位

## 通信模型

## 交互过程

## 关键能力

## 常见问题

## 验证方式

## 参考资料`,
  practice: `## 适用场景

## 实施前提

## 操作步骤

## 配置示例

## 验证方式

## 风险与回滚

## 常见问题`,
  direction: `## 方向定义

## 为什么值得关注

## 关键能力

## 成熟度与风险

## 适用场景

## 相关技术

## 参考入口`,
};

export function techDocTemplate(nodeType: TechNodeType): string {
  return docTemplates[nodeType] ?? docTemplates.concept;
}

export function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

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

export function filterTreeByContent(
  nodes: TechTreeNode[],
  status: TechContentStatus | '',
): TechTreeNode[] {
  if (!status) return nodes;
  const walk = (list: TechTreeNode[]): TechTreeNode[] =>
    list
      .map((node) => {
        const children = walk(node.children);
        return node.contentStatus === status || children.length
          ? { ...node, children }
          : null;
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
