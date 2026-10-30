import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import type {
  TechGraphData,
  TechNodeListResponse,
  TechView as TechViewRecord,
  TechViewDetail,
  TechViewType,
} from '@shared/types';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { api } from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { viewTypeLabels } from '../lib/tech';
import { EmptyState, Modal, PageHeader } from '../components/ui';
import { TechGraphEditor } from '../components/TechGraphEditor';

export function TechView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { push } = useToast();
  const { data, loading, error, refetch } = useApi<TechViewDetail>(id ? `/tech/views/${id}` : null);
  const { data: nodeList } = useApi<TechNodeListResponse>('/tech/nodes?status=active&limit=300');
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draft, setDraft] = useState({ name: '', description: '', viewType: 'architecture' as TechViewType });
  const [saving, setSaving] = useState(false);
  const [graphSaving, setGraphSaving] = useState(false);
  const view = data?.view;
  useDocumentTitle(view?.name ?? '架构视图');

  const availableNodes = useMemo(() => {
    const items = nodeList?.items ?? [];
    if (!view) return items;
    const known = new Set(items.map((node) => node.id));
    const extras = (data?.nodes ?? []).filter((node) => !known.has(node.id));
    return [...items.filter((node) => node.domainId === view.domainId), ...extras];
  }, [nodeList, data?.nodes, view]);

  const openEdit = () => {
    if (!view) return;
    setDraft({ name: view.name, description: view.description ?? '', viewType: view.viewType });
    setEditOpen(true);
  };

  const saveMeta = async () => {
    if (!view || !draft.name.trim()) {
      push('视图需要一个名称', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.patch<TechViewRecord>(`/tech/views/${view.id}`, {
        name: draft.name.trim(),
        description: draft.description || null,
        viewType: draft.viewType,
      });
      push('视图信息已更新');
      setEditOpen(false);
      await refetch(true);
    } catch (saveError) {
      push(saveError instanceof Error ? saveError.message : '更新失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveGraph = async (graph: TechGraphData): Promise<boolean> => {
    if (!view) return false;
    setGraphSaving(true);
    try {
      await api.patch<TechViewRecord>(`/tech/views/${view.id}`, { graphData: graph });
      await refetch(true);
      push('画布布局已保存');
      return true;
    } catch (saveError) {
      push(saveError instanceof Error ? saveError.message : '保存画布失败', 'error');
      return false;
    } finally {
      setGraphSaving(false);
    }
  };

  const remove = async () => {
    if (!view) return;
    setSaving(true);
    try {
      await api.delete(`/tech/views/${view.id}`);
      push('视图已删除，技术节点不受影响');
      navigate(`/tech/domains/${view.domainId}?tab=views`, { replace: true });
    } catch (deleteError) {
      push(deleteError instanceof Error ? deleteError.message : '删除失败', 'error');
      setSaving(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="page">
        <div className="loading-block" style={{ minHeight: 420 }} />
      </div>
    );
  }

  if (!view) {
    return (
      <div className="page">
        <EmptyState
          icon={ArrowLeft}
          title="架构视图不存在"
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
    <div className="page tech-view-page">
      <div className="tech-breadcrumb">
        <Link to="/tech">
          <ArrowLeft size={12} /> 技术地图
        </Link>
        <span>/</span>
        <Link to={`/tech/domains/${view.domainId}`}>{data?.domain.name}</Link>
        <span>/</span>
        <span>{view.name}</span>
      </div>

      <PageHeader
        eyebrow={`${viewTypeLabels[view.viewType]} · editable canvas`}
        title={view.name}
        subtitle={view.description || '拖动节点安排布局，用连线表达节点之间的关系。'}
        actions={
          <>
            <button className="btn btn-ghost" onClick={openEdit}>
              <Pencil size={13} /> 编辑信息
            </button>
            <button className="btn btn-ghost" onClick={() => setDeleteOpen(true)}>
              <Trash2 size={13} /> 删除视图
            </button>
            <Link to={`/tech/domains/${view.domainId}`} className="btn btn-secondary">
              <ArrowLeft size={13} /> 回到技术树
            </Link>
          </>
        }
      />

      {error && <div className="error-note mb-3">{error}</div>}

      <TechGraphEditor
        key={view.id}
        view={view}
        availableNodes={availableNodes}
        onSave={saveGraph}
        saving={graphSaving}
      />

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        eyebrow="Edit view"
        title="编辑视图信息"
        description="修改名称和说明不会改变画布上的节点与布局。"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEditOpen(false)}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => void saveMeta()} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        <div className="grid gap-3">
          <label className="field">
            <span className="field-label">名称</span>
            <input
              className="field-input"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">视图类型</span>
            <select
              className="field-input"
              value={draft.viewType}
              onChange={(event) => setDraft({ ...draft, viewType: event.target.value as TechViewType })}
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
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="这张图回答什么问题"
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        eyebrow="Delete view"
        title={`删除「${view.name}」？`}
        description="只删除画布和图上的连线，技术节点、知识内容和笔记都会保留。"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setDeleteOpen(false)}>
              取消
            </button>
            <button className="btn btn-danger" onClick={() => void remove()} disabled={saving}>
              删除视图
            </button>
          </>
        }
      >
        <div className="form-note">删除后这个布局无法恢复，但技术树不受影响。</div>
      </Modal>
    </div>
  );
}
