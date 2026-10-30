import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronsDownUp,
  ChevronsUpDown,
  GitBranch,
  Layers3,
  LayoutTemplate,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  TechContentStatus,
  TechDomainDetail,
  TechNodeDetail,
  TechTreeNode,
  TechView,
  TechViewSummary,
  TechViewType,
} from '@shared/types';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { api } from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { formatDateTime } from '../lib/format';
import {
  contentStatusLabels,
  contentStatusOrder,
  filterTree,
  filterTreeByContent,
  flattenTree,
  formatPercent,
  siblingIds,
  viewTypeLabels,
} from '../lib/tech';
import { EmptyState, Modal, PageHeader } from '../components/ui';
import { TechTree } from '../components/TechTree';
import { TechNodeFormDialog } from '../components/TechNodeFormDialog';

type Tab = 'tree' | 'views';
type DeleteStrategy = 'promote' | 'subtree';

export function TechDomain() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { push } = useToast();
  const { data, loading, error, refetch } = useApi<TechDomainDetail>(id ? `/tech/domains/${id}` : null);
  const detail = data;
  useDocumentTitle(detail?.domain.name ?? '技术领域');

  const [tab, setTab] = useState<Tab>(searchParams.get('tab') === 'views' ? 'views' : 'tree');
  const [search, setSearch] = useState('');
  const [contentFilter, setContentFilter] = useState<TechContentStatus | ''>('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [formParent, setFormParent] = useState<TechTreeNode | null>(null);
  const [formNode, setFormNode] = useState<TechNodeDetail | null>(null);
  const [deleting, setDeleting] = useState<TechTreeNode | null>(null);
  const [strategy, setStrategy] = useState<DeleteStrategy>('promote');
  const [viewOpen, setViewOpen] = useState(false);
  const [viewDraft, setViewDraft] = useState({ name: '', description: '', viewType: 'architecture' as TechViewType });
  const [viewDeleting, setViewDeleting] = useState<TechViewSummary | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!detail) return;
    const next = new Set<string>();
    const walk = (nodes: TechTreeNode[], depth: number) => {
      for (const node of nodes) {
        if (depth < 2 && node.children.length) next.add(node.id);
        walk(node.children, depth + 1);
      }
    };
    walk(detail.tree, 0);
    setExpanded(next);
    setSearch('');
    setContentFilter('');
    setTab(searchParams.get('tab') === 'views' ? 'views' : 'tree');
    // Reset view state only when switching to another domain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.domain.id]);

  const filteredTree = useMemo(
    () => (detail ? filterTree(filterTreeByContent(detail.tree, contentFilter), search) : []),
    [detail, search, contentFilter],
  );
  const forceExpand = search.trim().length > 0 || contentFilter !== '';

  const toggle = (nodeId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const refresh = async () => {
    await refetch(true);
  };

  const openCreate = (parent: TechTreeNode | null) => {
    setFormParent(parent);
    setFormNode(null);
    setFormOpen(true);
  };

  const openEdit = async (node: TechTreeNode) => {
    try {
      const full = await api.get<TechNodeDetail>(`/tech/nodes/${node.id}`);
      setFormNode(full);
      setFormParent(null);
      setFormOpen(true);
    } catch (editError) {
      push(editError instanceof Error ? editError.message : '加载节点失败', 'error');
    }
  };

  const move = async (node: TechTreeNode, direction: 'up' | 'down') => {
    if (!detail) return;
    const ids = siblingIds(detail.tree, node.parentId);
    const index = ids.indexOf(node.id);
    const beforeId = direction === 'up' ? ids[index - 1] : (ids[index + 2] ?? null);
    if (direction === 'up' && index <= 0) return;
    if (direction === 'down' && index >= ids.length - 1) return;
    try {
      await api.post(`/tech/nodes/${node.id}/move`, { parentId: node.parentId, beforeId });
      await refresh();
    } catch (moveError) {
      push(moveError instanceof Error ? moveError.message : '移动失败', 'error');
    }
  };

  const toggleArchive = async (node: TechTreeNode) => {
    try {
      await api.post(`/tech/nodes/${node.id}/archive`, { archived: node.status !== 'archived' });
      push(node.status === 'archived' ? '节点已恢复' : '节点及其子树已归档');
      await refresh();
    } catch (archiveError) {
      push(archiveError instanceof Error ? archiveError.message : '归档失败', 'error');
    }
  };

  const removeNode = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/tech/nodes/${deleting.id}${deleting.childCount > 0 ? `?strategy=${strategy}` : ''}`);
      push('节点已删除，关联的笔记与视图引用已清理');
      setDeleting(null);
      await refresh();
    } catch (deleteError) {
      push(deleteError instanceof Error ? deleteError.message : '删除失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const createView = async () => {
    if (!id || !viewDraft.name.trim()) {
      push('视图需要一个名称', 'error');
      return;
    }
    setBusy(true);
    try {
      const created = await api.post<TechView>(`/tech/domains/${id}/views`, {
        name: viewDraft.name.trim(),
        description: viewDraft.description || null,
        viewType: viewDraft.viewType,
      });
      push('视图已创建');
      setViewOpen(false);
      setViewDraft({ name: '', description: '', viewType: 'architecture' });
      navigate(`/tech/views/${created.id}`);
    } catch (createError) {
      push(createError instanceof Error ? createError.message : '创建视图失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeView = async () => {
    if (!viewDeleting) return;
    setBusy(true);
    try {
      await api.delete(`/tech/views/${viewDeleting.id}`);
      push('视图已删除，技术节点不受影响');
      setViewDeleting(null);
      await refresh();
    } catch (deleteError) {
      push(deleteError instanceof Error ? deleteError.message : '删除视图失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const allIds = useMemo(
    () => (detail ? flattenTree(detail.tree).filter((node) => node.children.length).map((node) => node.id) : []),
    [detail],
  );

  if (loading && !detail) {
    return (
      <div className="page">
        <div className="loading-block" style={{ minHeight: 420 }} />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="page">
        <EmptyState
          icon={Layers3}
          title="技术领域不存在"
          description={error || '它可能已经被删除，或者地址写错了。'}
          actions={
            <Link to="/tech" className="btn btn-primary">
              返回技术地图
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="tech-breadcrumb">
        <Link to="/tech">
          <ArrowLeft size={12} /> 技术地图
        </Link>
        <span>/</span>
        <span>{detail.domain.name}</span>
      </div>

      <PageHeader
        eyebrow={`Domain · ${detail.domain.nodeCount} nodes · ${detail.views.length} views`}
        title={detail.domain.name}
        subtitle={detail.domain.description || '这个领域还没有说明。'}
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => setViewOpen(true)}>
              <LayoutTemplate size={14} /> 新建视图
            </button>
            <button className="btn btn-primary" onClick={() => openCreate(null)}>
              <Plus size={14} /> 新增节点
            </button>
          </>
        }
      />

      {error && <div className="error-note mb-3">{error}</div>}

      <div className="content-stats content-stats-domain">
        <div className="content-stats-main">
          <span className="content-stats-rate">{formatPercent(detail.domain.contentCounts.completionRate)}</span>
          <span className="content-stats-caption">
            文档完成度 · {detail.domain.contentCounts.complete} / {detail.domain.contentCounts.total} 个节点已完善
          </span>
        </div>
        <div className="content-stats-items">
          <span className="content-stats-item">
            待补充 <strong>{detail.domain.contentCounts.missing}</strong>
          </span>
          <span className="content-stats-item">
            草稿 <strong>{detail.domain.contentCounts.draft}</strong>
          </span>
          <span className="content-stats-item">
            待核实 <strong>{detail.domain.contentCounts.needs_review}</strong>
          </span>
          <span className="content-stats-item">
            已完善 <strong>{detail.domain.contentCounts.complete}</strong>
          </span>
        </div>
        <div className="content-stats-bar" aria-hidden="true">
          <span
            className="content-stats-bar-fill"
            style={{ width: `${Math.min(100, detail.domain.contentCounts.completionRate)}%` }}
          />
        </div>
      </div>

      <div className="tech-domain-tabs">
        <div className="segmented">
          <button className={tab === 'tree' ? 'active' : ''} onClick={() => setTab('tree')}>
            <GitBranch size={13} /> 技术树
          </button>
          <button className={tab === 'views' ? 'active' : ''} onClick={() => setTab('views')}>
            <Layers3 size={13} /> 架构视图
          </button>
        </div>
        <span className="tech-domain-tabs-note">
          {tab === 'tree'
            ? '技术树负责层级与学习路径，节点详情里保存完整知识。'
            : '同一批技术节点可以在多张图里以不同关系出现。'}
        </span>
      </div>

      {tab === 'tree' ? (
        <div className="tech-tree-panel">
          <div className="tech-tree-toolbar">
            <div className="inline-search">
              <Search size={12} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索节点名称或摘要"
                aria-label="搜索技术树"
              />
            </div>
            <select
              className="tech-tree-content-filter"
              value={contentFilter}
              onChange={(event) => setContentFilter(event.target.value as TechContentStatus | '')}
              aria-label="按文档状态筛选"
            >
              <option value="">全部文档状态</option>
              {contentStatusOrder.map((status) => (
                <option key={status} value={status}>
                  {contentStatusLabels[status]}
                </option>
              ))}
            </select>
            <span className="tech-tree-toolbar-count">
              {flattenTree(filteredTree).length} / {detail.nodes.length} 个节点
            </span>
            <div className="tech-tree-toolbar-actions">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setExpanded(new Set(allIds))}
                title="展开全部"
              >
                <ChevronsUpDown size={13} /> 全部展开
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(new Set())} title="收起全部">
                <ChevronsDownUp size={13} /> 收起
              </button>
            </div>
          </div>
          {filteredTree.length === 0 ? (
            <div className="tech-tree-empty">
              {detail.nodes.length === 0 ? (
                <>
                  <p>还没有技术节点。</p>
                  <button className="btn btn-primary btn-sm" onClick={() => openCreate(null)}>
                    <Plus size={12} /> 创建第一个节点
                  </button>
                </>
              ) : (
                <p>
                  没有匹配
                  {search.trim() ? `「${search}」` : ''}
                  {contentFilter ? `「${contentStatusLabels[contentFilter]}」` : ''}
                  的节点。
                </p>
              )}
            </div>
          ) : (
            <TechTree
              nodes={filteredTree}
              expanded={expanded}
              forceExpand={forceExpand}
              onToggle={toggle}
              onAddChild={(node) => openCreate(node)}
              onEdit={(node) => void openEdit(node)}
              onMove={(node, direction) => void move(node, direction)}
              onDelete={(node) => {
                setStrategy('promote');
                setDeleting(node);
              }}
              onArchive={(node) => void toggleArchive(node)}
            />
          )}
        </div>
      ) : (
        <div className="tech-view-grid">
          {detail.views.length === 0 ? (
            <div className="tech-view-empty">
              <EmptyState
                icon={LayoutTemplate}
                title="还没有架构视图"
                description="从空白画布开始，把技术节点拖进图里，用连线表达依赖、实现或数据流。"
                actions={
                  <button className="btn btn-primary" onClick={() => setViewOpen(true)}>
                    <Plus size={13} /> 新建视图
                  </button>
                }
              />
            </div>
          ) : (
            detail.views.map((view) => (
              <div key={view.id} className="tech-view-card">
                <Link to={`/tech/views/${view.id}`} className="tech-view-card-main">
                  <div className="tech-view-card-head">
                    <span className="pill pill-neutral">{viewTypeLabels[view.viewType]}</span>
                    <span className="mono tech-view-card-count">
                      {view.nodeCount} nodes · {view.edgeCount} edges
                    </span>
                  </div>
                  <h3>{view.name}</h3>
                  <p>{view.description || '没有视图说明。'}</p>
                  <span className="tech-view-card-time">更新于 {formatDateTime(view.updatedAt)}</span>
                </Link>
                <button
                  className="icon-btn tech-view-card-delete"
                  onClick={() => setViewDeleting(view)}
                  aria-label={`删除视图 ${view.name}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {formOpen && (
        <TechNodeFormDialog
          open={formOpen}
          onClose={() => setFormOpen(false)}
          domainId={detail.domain.id}
          parentId={formNode ? formNode.node.parentId : formParent?.id ?? null}
          parentName={formNode ? formNode.parent?.name ?? null : formParent?.name ?? null}
          node={formNode?.node ?? null}
          onSaved={() => void refresh()}
        />
      )}

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        eyebrow="Delete node"
        title={`删除「${deleting?.name ?? ''}」？`}
        description={
          deleting && deleting.childCount > 0
            ? '这个节点下面还有子节点，需要选择如何处理它们。'
            : '删除后无法恢复；关联的视图引用和知识笔记关联会被清理。'
        }
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setDeleting(null)}>
              取消
            </button>
            <button className="btn btn-danger" onClick={() => void removeNode()} disabled={busy}>
              {busy ? '删除中…' : '确认删除'}
            </button>
          </>
        }
      >
        {deleting && deleting.childCount > 0 && (
          <div className="tech-delete-options">
            <label className={`tech-choice ${strategy === 'promote' ? 'active' : ''}`}>
              <input
                type="radio"
                name="delete-strategy"
                checked={strategy === 'promote'}
                onChange={() => setStrategy('promote')}
              />
              <span>
                <strong>保留子节点，提升一级</strong>
                <em>子节点移动到「{deleting.name}」原来的位置，知识内容继续保留。</em>
              </span>
            </label>
            <label className={`tech-choice ${strategy === 'subtree' ? 'active' : ''}`}>
              <input
                type="radio"
                name="delete-strategy"
                checked={strategy === 'subtree'}
                onChange={() => setStrategy('subtree')}
              />
              <span>
                <strong>连同 {deleting.childCount} 个子树节点一起删除</strong>
                <em>只在确认整块内容都不再需要时使用，无法撤销。</em>
              </span>
            </label>
          </div>
        )}
      </Modal>

      <Modal
        open={viewOpen}
        onClose={() => setViewOpen(false)}
        eyebrow="New view"
        title="新建架构视图"
        description="先建一张空图，再从领域节点里挑选需要展示的部分。"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setViewOpen(false)}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => void createView()} disabled={busy}>
              {busy ? '创建中…' : '创建并打开'}
            </button>
          </>
        }
      >
        <div className="grid gap-3">
          <label className="field">
            <span className="field-label">视图名称</span>
            <input
              className="field-input"
              value={viewDraft.name}
              onChange={(event) => setViewDraft({ ...viewDraft, name: event.target.value })}
              placeholder="如 整体监控架构"
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">视图类型</span>
            <select
              className="field-input"
              value={viewDraft.viewType}
              onChange={(event) => setViewDraft({ ...viewDraft, viewType: event.target.value as TechViewType })}
            >
              {Object.entries(viewTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">说明</span>
            <textarea
              className="field-textarea"
              rows={3}
              value={viewDraft.description}
              onChange={(event) => setViewDraft({ ...viewDraft, description: event.target.value })}
              placeholder="这张图回答什么问题、从哪个角度看系统"
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={Boolean(viewDeleting)}
        onClose={() => setViewDeleting(null)}
        eyebrow="Delete view"
        title={`删除视图「${viewDeleting?.name ?? ''}」？`}
        description="只删除这张图，技术节点和它们的知识内容都会保留。"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setViewDeleting(null)}>
              取消
            </button>
            <button className="btn btn-danger" onClick={() => void removeView()} disabled={busy}>
              删除视图
            </button>
          </>
        }
      >
        <div className="form-note">
          这张图包含 {viewDeleting?.nodeCount ?? 0} 个图形节点，删除后画布布局无法恢复。
        </div>
      </Modal>
    </div>
  );
}
