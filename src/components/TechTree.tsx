import { useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Pencil,
  Plus,
  Star,
  Trash2,
  Archive,
} from 'lucide-react';
import type { TechTreeNode } from '@shared/types';
import { ActionMenu } from './ui';
import { contentStatusLabels, masteryColor, masteryLabels, techNodeTypeLabels } from '../lib/tech';

export function TechTree({
  nodes,
  expanded,
  forceExpand = false,
  selectedId,
  onToggle,
  onAddChild,
  onEdit,
  onMove,
  onDelete,
  onArchive,
  depth = 0,
}: {
  nodes: TechTreeNode[];
  expanded: Set<string>;
  forceExpand?: boolean;
  selectedId?: string | null;
  onToggle: (id: string) => void;
  onAddChild: (node: TechTreeNode) => void;
  onEdit: (node: TechTreeNode) => void;
  onMove: (node: TechTreeNode, direction: 'up' | 'down') => void;
  onDelete: (node: TechTreeNode) => void;
  onArchive: (node: TechTreeNode) => void;
  depth?: number;
}) {
  return (
    <ul className="tech-tree" role={depth === 0 ? 'tree' : 'group'}>
      {nodes.map((node) => {
        const isOpen = forceExpand || expanded.has(node.id);
        const hasChildren = node.children.length > 0;
        return (
          <li key={node.id} role="treeitem" aria-expanded={hasChildren ? isOpen : undefined}>
            <TreeRow
              node={node}
              depth={depth}
              isOpen={isOpen}
              hasChildren={hasChildren}
              selected={selectedId === node.id}
              onToggle={() => onToggle(node.id)}
              onAddChild={() => onAddChild(node)}
              onEdit={() => onEdit(node)}
              onMoveUp={() => onMove(node, 'up')}
              onMoveDown={() => onMove(node, 'down')}
              onDelete={() => onDelete(node)}
              onArchive={() => onArchive(node)}
            />
            {hasChildren && isOpen && (
              <TechTree
                nodes={node.children}
                expanded={expanded}
                forceExpand={forceExpand}
                selectedId={selectedId}
                onToggle={onToggle}
                onAddChild={onAddChild}
                onEdit={onEdit}
                onMove={onMove}
                onDelete={onDelete}
                onArchive={onArchive}
                depth={depth + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function TreeRow({
  node,
  depth,
  isOpen,
  hasChildren,
  selected,
  onToggle,
  onAddChild,
  onEdit,
  onMoveUp,
  onMoveDown,
  onDelete,
  onArchive,
}: {
  node: TechTreeNode;
  depth: number;
  isOpen: boolean;
  hasChildren: boolean;
  selected: boolean;
  onToggle: () => void;
  onAddChild: () => void;
  onEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onArchive: () => void;
}) {
  const navigate = useNavigate();
  return (
    <div
      className={`tech-tree-row ${selected ? 'active' : ''}`}
      style={{ paddingLeft: 10 + depth * 20 }}
      onClick={() => navigate(`/tech/nodes/${node.id}`)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          navigate(`/tech/nodes/${node.id}`);
        }
      }}
      role="button"
      tabIndex={0}
    >
      {hasChildren ? (
        <button
          className="tech-tree-toggle"
          aria-label={isOpen ? '收起子节点' : '展开子节点'}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      ) : (
        <span className="tech-tree-toggle is-leaf">
          <CornerDownRight size={11} />
        </span>
      )}
      <span className={`tech-type-dot type-${node.nodeType}`} aria-hidden="true" />
      <span className="tech-tree-name">{node.name}</span>
      <span className="tech-type-label">{techNodeTypeLabels[node.nodeType]}</span>
      <span className={`content-badge content-${node.contentStatus}`}>
        {contentStatusLabels[node.contentStatus]}
      </span>
      <span className="tech-tree-summary">{node.summary}</span>
      <span className="tech-tree-flags">
        {node.focusLevel === 'focus' && (
          <span className="tech-focus-flag" title="重点关注">
            <Star size={11} fill="currentColor" />
          </span>
        )}
        <span
          className="tech-mastery-dot"
          style={{ background: masteryColor(node.masteryStatus) }}
          title={masteryLabels[node.masteryStatus]}
        />
      </span>
      <span className="tech-tree-actions" onClick={(event) => event.stopPropagation()}>
        <ActionMenu
          items={[
            { label: '添加子节点', icon: Plus, onClick: onAddChild },
            { label: '编辑节点', icon: Pencil, onClick: onEdit },
            { label: '上移', icon: ChevronDown, onClick: onMoveUp, separator: true },
            { label: '下移', icon: ChevronRight, onClick: onMoveDown },
            {
              label: node.status === 'archived' ? '恢复节点' : '归档子树',
              icon: Archive,
              onClick: onArchive,
              separator: true,
            },
            { label: '删除节点', icon: Trash2, danger: true, onClick: onDelete },
          ]}
        />
      </span>
    </div>
  );
}
