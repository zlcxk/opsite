import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Boxes,
  ExternalLink,
  FileText,
  GitBranch,
  Link2,
  NotebookPen,
  Pencil,
  Plus,
  Save,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type {
  TechMasteryStatus,
  TechNodeDetail,
  TechNodeListResponse,
  TechRelationType,
  TechRelationWithNodes,
} from '@shared/types';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { api } from '../lib/api';
import { useAppData } from '../contexts/AppDataContext';
import { useToast } from '../contexts/ToastContext';
import { formatDateTime, supportMeta } from '../lib/format';
import {
  contentSourceLabels,
  contentStatusLabels,
  focusLabels,
  masteryColor,
  masteryLabels,
  masteryOrder,
  relationLabels,
  techNodeTypeLabels,
  viewTypeLabels,
} from '../lib/tech';
import { ActionMenu, EmptyState, Modal, PageHeader } from '../components/ui';
import { TechNodeFormDialog } from '../components/TechNodeFormDialog';
import {
  TechDocEditor,
  type TechDocEditorBusy,
  type TechDocEditorHandle,
} from '../components/TechDocEditor';
import { MarkdownPreview } from '../components/markdown/MarkdownPreview';

function UnderstandBlock({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="tech-understand-block">
      <span className="tech-understand-label">{label}</span>
      <p>{value}</p>
    </div>
  );
}

export function TechNode() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { push } = useToast();
  const { data: appData } = useAppData();
  const { data, loading, error, refetch, setData } = useApi<TechNodeDetail>(id ? `/tech/nodes/${id}` : null);
  const { data: domainNodes } = useApi<TechNodeListResponse>(
    data ? `/tech/nodes?domainId=${data.node.domainId}&status=active&limit=300` : null,
  );
  const node = data?.node;
  useDocumentTitle(node?.name ?? '技术节点');

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [strategy, setStrategy] = useState<'promote' | 'subtree'>('promote');
  const [busy, setBusy] = useState(false);
  const [cognitionBusy, setCognitionBusy] = useState(false);
  const [cogDraft, setCogDraft] = useState({ personalNotes: '', researchQuestions: '' });
  const [relationOpen, setRelationOpen] = useState(false);
  const [relationDraft, setRelationDraft] = useState({
    targetNodeId: '',
    relationType: 'depends_on' as TechRelationType,
    description: '',
  });
  const [relationSearch, setRelationSearch] = useState('');
  const [relationDeleting, setRelationDeleting] = useState<TechRelationWithNodes | null>(null);
  const [softwarePick, setSoftwarePick] = useState('');
  const [radarPick, setRadarPick] = useState('');
  const [docOpen, setDocOpen] = useState(false);
  const [docDirty, setDocDirty] = useState(false);
  const [docBusy, setDocBusy] = useState<TechDocEditorBusy>({
    saving: false,
    verifying: false,
  });
  const docEditorRef = useRef<TechDocEditorHandle | null>(null);

  useEffect(() => {
    if (!data) return;
    setCogDraft({
      personalNotes: data.node.personalNotes ?? '',
      researchQuestions: data.node.researchQuestions ?? '',
    });
    // Reset only when navigating to a different node.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.node.id]);

  const relationTargets = useMemo(() => {
    const term = relationSearch.trim().toLowerCase();
    return (domainNodes?.items ?? [])
      .filter((item) => item.id !== node?.id)
      .filter((item) => !term || item.name.toLowerCase().includes(term))
      .slice(0, 120);
  }, [domainNodes, node?.id, relationSearch]);

  const linkedSoftwareIds = new Set((data?.software ?? []).map((link) => link.software.id));
  const linkedRadarIds = new Set((data?.radar ?? []).map((link) => link.radarItem.id));
  const softwareOptions = (appData?.software ?? []).filter((item) => !linkedSoftwareIds.has(item.id));
  const radarOptions = (appData?.radar ?? []).filter((item) => !item.archivedAt && !linkedRadarIds.has(item.id));

  const cogDirty =
    Boolean(data) &&
    (cogDraft.personalNotes !== (data?.node.personalNotes ?? '') ||
      cogDraft.researchQuestions !== (data?.node.researchQuestions ?? ''));

  const refresh = async () => {
    await refetch(true);
  };

  const closeDocEditor = async () => {
    const editor = docEditorRef.current;
    // Verify is a two-step write (save then attest). Closing in the middle
    // would hide the outcome and could race the verification request.
    if (editor?.isVerifying()) return;
    if (editor?.isDirty()) {
      const saved = await editor.save();
      if (!saved) return;
    }
    setDocOpen(false);
  };

  const discardDocEditor = async () => {
    const editor = docEditorRef.current;
    if (!editor || editor.isBusy()) return;
    if (!window.confirm('放弃尚未保存的文档更改并关闭？')) return;
    // Wait for any already-issued save, cancel the pending debounce and reset
    // the editor to the last server-confirmed snapshot before closing. If that
    // save fails, the editor keeps the unsaved edits and the dialog stays open.
    const discarded = await editor.discard();
    if (discarded) setDocOpen(false);
  };

  const applySavedDoc = (saved: TechNodeDetail['node']) => {
    if (!data) return;
    setData({ ...data, node: saved });
  };

  const updateCognition = async (patch: { masteryStatus?: TechMasteryStatus; focusLevel?: 'normal' | 'focus' }) => {
    if (!node) return;
    setCognitionBusy(true);
    try {
      await api.patch(`/tech/nodes/${node.id}/cognition`, patch);
      await refresh();
    } catch (updateError) {
      push(updateError instanceof Error ? updateError.message : '更新失败', 'error');
    } finally {
      setCognitionBusy(false);
    }
  };

  const saveCognitionNotes = async () => {
    if (!node) return;
    setCognitionBusy(true);
    try {
      await api.patch(`/tech/nodes/${node.id}`, {
        personalNotes: cogDraft.personalNotes || null,
        researchQuestions: cogDraft.researchQuestions || null,
      });
      push('个人认知已保存');
      await refresh();
    } catch (saveError) {
      push(saveError instanceof Error ? saveError.message : '保存失败', 'error');
    } finally {
      setCognitionBusy(false);
    }
  };

  const toggleArchive = async () => {
    if (!node) return;
    setBusy(true);
    try {
      const archived = node.status !== 'archived';
      await api.post(`/tech/nodes/${node.id}/archive`, { archived });
      push(archived ? '节点及其子树已归档' : '节点已恢复');
      if (archived) navigate(`/tech/domains/${node.domainId}`);
      else await refresh();
    } catch (archiveError) {
      push(archiveError instanceof Error ? archiveError.message : '操作失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeNode = async () => {
    if (!node) return;
    setBusy(true);
    try {
      await api.delete(`/tech/nodes/${node.id}${node.childCount > 0 ? `?strategy=${strategy}` : ''}`);
      push('节点已删除，关联的笔记与视图引用已清理');
      navigate(`/tech/domains/${node.domainId}`, { replace: true });
    } catch (deleteError) {
      push(deleteError instanceof Error ? deleteError.message : '删除失败', 'error');
      setBusy(false);
    }
  };

  const addRelation = async () => {
    if (!node || !relationDraft.targetNodeId) {
      push('请选择目标节点', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post('/tech/relations', {
        sourceNodeId: node.id,
        targetNodeId: relationDraft.targetNodeId,
        relationType: relationDraft.relationType,
        description: relationDraft.description || null,
      });
      push('关系已添加');
      setRelationOpen(false);
      setRelationSearch('');
      setRelationDraft({ targetNodeId: '', relationType: 'depends_on', description: '' });
      await refresh();
    } catch (relationError) {
      push(relationError instanceof Error ? relationError.message : '添加关系失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeRelation = async () => {
    if (!relationDeleting) return;
    setBusy(true);
    try {
      await api.delete(`/tech/relations/${relationDeleting.id}`);
      push('关系已删除，节点本身不受影响');
      setRelationDeleting(null);
      await refresh();
    } catch (relationError) {
      push(relationError instanceof Error ? relationError.message : '删除关系失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const linkSoftware = async (softwareId: string, linked: boolean) => {
    if (!node) return;
    try {
      await api.post(`/tech/nodes/${node.id}/software`, { softwareId, linked });
      if (linked) {
        push('已关联软件，版本与漏洞信息仍以软件情报为准');
        setSoftwarePick('');
      } else {
        push('已取消软件关联');
      }
      await refresh();
    } catch (linkError) {
      push(linkError instanceof Error ? linkError.message : '关联失败', 'error');
    }
  };

  const linkRadar = async (radarItemId: string, linked: boolean) => {
    if (!node) return;
    try {
      await api.post(`/tech/nodes/${node.id}/radar`, { radarItemId, linked });
      if (linked) {
        push('已关联雷达条目');
        setRadarPick('');
      } else {
        push('已取消雷达关联');
      }
      await refresh();
    } catch (linkError) {
      push(linkError instanceof Error ? linkError.message : '关联失败', 'error');
    }
  };

  if (loading && !data) {
    return (
      <div className="page">
        <div className="loading-block" style={{ minHeight: 420 }} />
      </div>
    );
  }

  if (!node || !data) {
    return (
      <div className="page">
        <EmptyState
          icon={GitBranch}
          title="技术节点不存在"
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

  const understanding = [node.description, node.technicalRole, node.solvedProblem, node.corePrinciple, node.keyMechanism, node.useCases, node.commonIssues];
  const hasUnderstanding = understanding.some(Boolean);

  return (
    <div className="page">
      <div className="tech-breadcrumb">
        <Link to="/tech">
          <ArrowLeft size={12} /> 技术地图
        </Link>
        <span>/</span>
        <Link to={`/tech/domains/${data.domain.id}`}>{data.domain.name}</Link>
        {data.breadcrumbs.map((crumb) => (
          <span key={crumb.id} className="tech-breadcrumb-piece">
            <span>/</span>
            <Link to={`/tech/nodes/${crumb.id}`}>{crumb.name}</Link>
          </span>
        ))}
        <span>/</span>
        <span>{node.name}</span>
      </div>

      <PageHeader
        eyebrow={`${data.domain.name} · ${techNodeTypeLabels[node.nodeType]}`}
        title={node.name}
        subtitle={node.summary || '这个节点还没有一句话摘要。'}
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => setEditOpen(true)}>
              <Pencil size={13} /> 编辑节点
            </button>
            <ActionMenu
              label="节点操作"
              trigger={
                <button className="icon-btn" aria-label="更多节点操作">
                  <span className="mono text-[1rem] leading-none">···</span>
                </button>
              }
              items={[
                {
                  label: node.status === 'archived' ? '恢复节点与子树' : '归档节点与子树',
                  icon: node.status === 'archived' ? ArchiveRestore : Archive,
                  onClick: () => void toggleArchive(),
                },
                {
                  label: '删除节点',
                  icon: Trash2,
                  danger: true,
                  separator: true,
                  onClick: () => {
                    setStrategy('promote');
                    setDeleteOpen(true);
                  },
                },
              ]}
            />
          </>
        }
      />

      <div className="tech-node-statusline">
        <span className={`pill type-${node.nodeType}`}>{techNodeTypeLabels[node.nodeType]}</span>
        <span className={`content-badge content-${node.contentStatus}`}>
          {contentStatusLabels[node.contentStatus]}
        </span>
        {node.status === 'archived' && <span className="pill pill-neutral">已归档</span>}
        <span className="tech-node-status-item">
          <span className="tech-mastery-dot" style={{ background: masteryColor(node.masteryStatus) }} />
          {masteryLabels[node.masteryStatus]}
        </span>
        <span className="tech-node-status-item">
          <Star size={11} className={node.focusLevel === 'focus' ? 'tech-focus-flag' : 'text-[var(--muted-2)]'} fill={node.focusLevel === 'focus' ? 'currentColor' : 'none'} />
          {focusLabels[node.focusLevel]}
        </span>
        <span className="tech-node-status-item">更新于 {formatDateTime(node.updatedAt)}</span>
        {node.childCount > 0 && <span className="tech-node-status-item">{node.childCount} 个子节点</span>}
      </div>

      {error && <div className="error-note mb-3">{error}</div>}

      <div className="tech-node-layout">
        <div className="tech-node-main">
          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">Technical understanding</span>
                <h3>技术理解</h3>
              </div>
              <BookOpen size={15} />
            </div>
            <div className="panel-body">
              {hasUnderstanding ? (
                <div className="tech-understanding">
                  <UnderstandBlock label="它是什么" value={node.description} />
                  <UnderstandBlock label="技术角色" value={node.technicalRole} />
                  <UnderstandBlock label="解决的问题" value={node.solvedProblem} />
                  <UnderstandBlock label="核心原理" value={node.corePrinciple} />
                  <UnderstandBlock label="关键机制" value={node.keyMechanism} />
                  <UnderstandBlock label="典型使用场景" value={node.useCases} />
                  <UnderstandBlock label="常见问题" value={node.commonIssues} />
                </div>
              ) : (
                <div className="tech-section-empty">
                  <p>这个节点还没有技术理解内容。</p>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditOpen(true)}>
                    <Pencil size={12} /> 补充内容
                  </button>
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">Technical document</span>
                <h3>技术文档</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className={`content-badge content-${node.contentStatus}`}>
                  {contentStatusLabels[node.contentStatus]}
                </span>
                <button className="btn btn-secondary btn-sm" onClick={() => setDocOpen(true)}>
                  <Pencil size={12} /> {node.contentMarkdown ? '编辑文档' : '撰写文档'}
                </button>
              </div>
            </div>
            <div className="panel-body">
              <div className="tech-doc-facts">
                <span>适用版本：{node.applicableVersions || '未标注'}</span>
                <span>
                  {node.contentStatus === 'complete' ? '已验证版本' : '上次验证版本'}：
                  {node.verifiedVersion || '尚未验证'}
                </span>
                <span>
                  {node.contentStatus === 'complete' ? '最后验证' : '上次验证'}：
                  {node.contentVerifiedAt ? formatDateTime(node.contentVerifiedAt) : '尚未验证'}
                </span>
                <span>内容来源：{node.contentSource ? contentSourceLabels[node.contentSource] : '未标注'}</span>
                <span>
                  内容更新：{node.contentUpdatedAt ? formatDateTime(node.contentUpdatedAt) : '尚未撰写'}
                </span>
              </div>
              {node.contentMarkdown ? (
                <MarkdownPreview content={node.contentMarkdown} className="tech-doc-preview" />
              ) : (
                <div className="tech-section-empty">
                  <p>这个节点还没有技术文档，当前只有上面的结构化知识卡片。</p>
                  <button className="btn btn-secondary btn-sm" onClick={() => setDocOpen(true)}>
                    <Pencil size={12} /> 撰写技术文档
                  </button>
                </div>
              )}
              {(node.docsUrl || node.repoUrl || node.referenceLinks.length > 0) && (
                <div className="tech-doc-refs">
                  <span className="tech-doc-refs-label">参考入口</span>
                  {node.docsUrl && (
                    <a href={node.docsUrl} target="_blank" rel="noreferrer noopener">
                      <ExternalLink size={11} /> 官方文档
                    </a>
                  )}
                  {node.repoUrl && (
                    <a href={node.repoUrl} target="_blank" rel="noreferrer noopener">
                      <ExternalLink size={11} /> 代码仓库
                    </a>
                  )}
                  {node.referenceLinks.map((link) => (
                    <a key={link.url} href={link.url} target="_blank" rel="noreferrer noopener">
                      <ExternalLink size={11} /> {link.label || link.url}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </section>

          {data.children.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <span className="eyebrow">Children</span>
                  <h3>下一层节点</h3>
                </div>
                <span className="mono text-[0.6875rem] text-[var(--muted)]">{data.children.length}</span>
              </div>
              <div className="panel-body">
                <div className="tech-child-grid">
                  {data.children.map((child) => (
                    <Link key={child.id} to={`/tech/nodes/${child.id}`} className="tech-child-card">
                      <span className={`tech-type-dot type-${child.nodeType}`} />
                      <span>
                        <strong>{child.name}</strong>
                        <em>{child.summary || techNodeTypeLabels[child.nodeType]}</em>
                      </span>
                      <span className="tech-mastery-dot" style={{ background: masteryColor(child.masteryStatus) }} />
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">Relations</span>
                <h3>技术关系</h3>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setRelationOpen(true)}>
                <Plus size={12} /> 添加关系
              </button>
            </div>
            <div className="panel-body">
              {data.relations.length === 0 ? (
                <div className="tech-section-empty">
                  <p>还没有手工维护的技术关系。关系只表达你的判断，不会自动推断。</p>
                </div>
              ) : (
                <div className="tech-relation-list">
                  {data.relations.map((relation) => {
                    const outgoing = relation.sourceNodeId === node.id;
                    const other = outgoing ? relation.target : relation.source;
                    return (
                      <div key={relation.id} className="tech-relation-row">
                        <span className="tech-relation-kind">
                          {outgoing ? <ArrowRight size={12} /> : <ArrowLeft size={12} />}
                          {relationLabels[relation.relationType]}
                        </span>
                        <Link to={`/tech/nodes/${other.id}`} className="tech-relation-node">
                          <span className={`tech-type-dot type-${other.nodeType}`} />
                          <span>
                            <strong>{other.name}</strong>
                            <em>{techNodeTypeLabels[other.nodeType]}</em>
                          </span>
                        </Link>
                        {relation.description && <p className="tech-relation-desc">{relation.description}</p>}
                        <button
                          className="icon-btn"
                          onClick={() => setRelationDeleting(relation)}
                          aria-label="删除关系"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">Personal knowledge</span>
                <h3>知识笔记</h3>
              </div>
              <Link to={`/knowledge?new=1&techNodeId=${node.id}`} className="btn btn-ghost btn-sm">
                <NotebookPen size={12} /> 写一条笔记
              </Link>
            </div>
            <div className="panel-body">
              {data.notes.length === 0 ? (
                <div className="tech-section-empty">
                  <p>还没有关联知识笔记。决策、排障结论和验证过程都可以记在这里。</p>
                  <Link to={`/knowledge?new=1&techNodeId=${node.id}`} className="btn btn-secondary btn-sm">
                    <Plus size={12} /> 新建知识笔记
                  </Link>
                </div>
              ) : (
                <div className="tech-note-list">
                  {data.notes.map((note) => (
                    <Link key={note.id} to={`/knowledge?noteId=${note.id}`} className="tech-note-row">
                      <FileText size={13} />
                      <span>
                        <strong>{note.title}</strong>
                        <em>{note.content.trim() || '暂无内容'}</em>
                      </span>
                      <time>{formatDateTime(note.updatedAt)}</time>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="tech-node-rail">
          <section className="panel tech-cognition-panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">Personal cognition</span>
                <h3>个人认知</h3>
              </div>
            </div>
            <div className="panel-body">
              <label className="field">
                <span className="field-label">掌握状态</span>
                <select
                  className="field-input"
                  value={node.masteryStatus}
                  onChange={(event) =>
                    void updateCognition({ masteryStatus: event.target.value as TechMasteryStatus })
                  }
                  disabled={cognitionBusy}
                >
                  {masteryOrder.map((status) => (
                    <option key={status} value={status}>
                      {masteryLabels[status]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field">
                <span className="field-label">关注级别</span>
                <div className="segmented tech-focus-toggle">
                  <button
                    className={node.focusLevel === 'normal' ? 'active' : ''}
                    onClick={() => void updateCognition({ focusLevel: 'normal' })}
                    disabled={cognitionBusy}
                  >
                    普通关注
                  </button>
                  <button
                    className={node.focusLevel === 'focus' ? 'active' : ''}
                    onClick={() => void updateCognition({ focusLevel: 'focus' })}
                    disabled={cognitionBusy}
                  >
                    <Star size={11} fill="currentColor" /> 重点关注
                  </button>
                </div>
              </div>
              <label className="field">
                <span className="field-label">个人笔记</span>
                <textarea
                  className="field-textarea"
                  rows={5}
                  value={cogDraft.personalNotes}
                  onChange={(event) => setCogDraft({ ...cogDraft, personalNotes: event.target.value })}
                  placeholder="用自己的话解释它，记录类比和结论"
                />
              </label>
              <label className="field">
                <span className="field-label">待研究问题</span>
                <textarea
                  className="field-textarea"
                  rows={4}
                  value={cogDraft.researchQuestions}
                  onChange={(event) => setCogDraft({ ...cogDraft, researchQuestions: event.target.value })}
                  placeholder="还不确定、需要继续验证的问题"
                />
              </label>
              <button
                className="btn btn-secondary btn-sm w-full"
                onClick={() => void saveCognitionNotes()}
                disabled={!cogDirty || cognitionBusy}
              >
                <Save size={12} /> {cognitionBusy ? '保存中…' : cogDirty ? '保存个人认知' : '已保存'}
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">Software</span>
                <h3>关联软件</h3>
              </div>
              <Boxes size={15} />
            </div>
            <div className="panel-body">
              {data.software.length === 0 ? (
                <p className="tech-rail-empty">还没有关联软件。关联后复用软件情报里的版本与漏洞数据。</p>
              ) : (
                <div className="tech-asset-list">
                  {data.software.map((link) => (
                    <div key={link.software.id} className="tech-asset-row">
                      <Link to={`/software/${link.software.id}`}>
                        <strong>{link.software.name}</strong>
                        <em>
                          {link.software.currentVersion ? `当前 ${link.software.currentVersion}` : '未记录当前版本'}
                          {link.software.latestVersion ? ` · 最新 ${link.software.latestVersion}` : ''}
                          {link.software.lifecycle.status !== 'unknown'
                            ? ` · ${supportMeta[link.software.lifecycle.status].label}`
                            : ''}
                        </em>
                        {link.recentEvent && (
                          <em className="tech-asset-event">
                            最近情报：{link.recentEvent.title}
                          </em>
                        )}
                      </Link>
                      <button
                        className="icon-btn"
                        onClick={() => void linkSoftware(link.software.id, false)}
                        aria-label="取消软件关联"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {softwareOptions.length > 0 && (
                <div className="tech-link-picker">
                  <select
                    className="field-input"
                    value={softwarePick}
                    onChange={(event) => setSoftwarePick(event.target.value)}
                  >
                    <option value="">选择软件…</option>
                    {softwareOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => void linkSoftware(softwarePick, true)}
                    disabled={!softwarePick}
                  >
                    <Link2 size={12} /> 关联
                  </button>
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">Radar & discovery</span>
                <h3>雷达与发现</h3>
              </div>
              <Star size={15} />
            </div>
            <div className="panel-body">
              {data.radar.length === 0 && data.discovery.length === 0 ? (
                <p className="tech-rail-empty">还没有关联雷达条目或技术发现候选。</p>
              ) : (
                <div className="tech-asset-list">
                  {data.radar.map((link) => (
                    <div key={link.radarItem.id} className="tech-asset-row">
                      <Link to={`/radar/${link.radarItem.id}`}>
                        <strong>{link.radarItem.title}</strong>
                        <em>雷达 · {link.radarItem.summary || '无摘要'}</em>
                      </Link>
                      <button
                        className="icon-btn"
                        onClick={() => void linkRadar(link.radarItem.id, false)}
                        aria-label="取消雷达关联"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  {data.discovery.map((link) => (
                    <div key={link.candidate.id} className="tech-asset-row">
                      <Link to={`/discover/${link.candidate.id}`}>
                        <strong>{link.candidate.title}</strong>
                        <em>发现 · {link.candidate.category}</em>
                      </Link>
                    </div>
                  ))}
                </div>
              )}
              {radarOptions.length > 0 && (
                <div className="tech-link-picker">
                  <select
                    className="field-input"
                    value={radarPick}
                    onChange={(event) => setRadarPick(event.target.value)}
                  >
                    <option value="">选择雷达条目…</option>
                    {radarOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => void linkRadar(radarPick, true)}
                    disabled={!radarPick}
                  >
                    <Link2 size={12} /> 关联
                  </button>
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">In views</span>
                <h3>出现的视图</h3>
              </div>
            </div>
            <div className="panel-body">
              {data.views.length === 0 ? (
                <p className="tech-rail-empty">这个节点还没有放进架构图。</p>
              ) : (
                <div className="tech-view-link-list">
                  {data.views.map((view) => (
                    <Link key={view.id} to={`/tech/views/${view.id}`} className="tech-view-link">
                      <span>
                        <strong>{view.name}</strong>
                        <em>{viewTypeLabels[view.viewType]}</em>
                      </span>
                      <ArrowRight size={13} />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">References</span>
                <h3>外部资料</h3>
              </div>
              <ExternalLink size={15} />
            </div>
            <div className="panel-body">
              {!node.docsUrl && !node.repoUrl && node.referenceLinks.length === 0 ? (
                <p className="tech-rail-empty">还没有外部资料，可以通过编辑节点补充。</p>
              ) : (
                <div className="tech-ref-list">
                  {node.docsUrl && (
                    <a href={node.docsUrl} target="_blank" rel="noreferrer">
                      <BookOpen size={12} /> 官方文档 <ExternalLink size={10} />
                    </a>
                  )}
                  {node.repoUrl && (
                    <a href={node.repoUrl} target="_blank" rel="noreferrer">
                      <GitBranch size={12} /> 代码仓库 <ExternalLink size={10} />
                    </a>
                  )}
                  {node.referenceLinks.map((link, index) => (
                    <a key={`${link.url}-${index}`} href={link.url} target="_blank" rel="noreferrer">
                      <FileText size={12} /> {link.label} <ExternalLink size={10} />
                    </a>
                  ))}
                </div>
              )}
              <div className="tech-node-meta">
                <span>
                  <em>所属领域</em>
                  <Link to={`/tech/domains/${data.domain.id}`}>{data.domain.name}</Link>
                </span>
                <span>
                  <em>父节点</em>
                  {data.parent ? <Link to={`/tech/nodes/${data.parent.id}`}>{data.parent.name}</Link> : '根节点'}
                </span>
                <span>
                  <em>创建时间</em>
                  {formatDateTime(node.createdAt)}
                </span>
                <span>
                  <em>节点 ID</em>
                  <code>{node.id}</code>
                </span>
              </div>
            </div>
          </section>
        </aside>
      </div>

      {editOpen && (
        <TechNodeFormDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          domainId={data.domain.id}
          parentId={node.parentId}
          parentName={data.parent?.name ?? null}
          node={node}
          onSaved={() => void refresh()}
        />
      )}

      <Modal
        open={docOpen}
        onClose={closeDocEditor}
        eyebrow={`${data.domain.name} · ${techNodeTypeLabels[node.nodeType]}`}
        title={`${node.name} · 技术文档`}
        description="Markdown 文档独立于节点基础信息保存，草稿会自动保留最后一次编辑结果。"
        full
        footer={
          <div className="tech-doc-modal-foot">
            <span>
              {docDirty
                ? '还有未保存的更改。点击「保存并关闭」会先保存，失败时保留窗口。'
                : '所有更改已保存。'}
            </span>
            <div className="flex items-center gap-2">
              {docDirty && (
                <button
                  className="btn btn-ghost"
                  onClick={() => void discardDocEditor()}
                  disabled={docBusy.saving || docBusy.verifying}
                  title={
                    docBusy.verifying
                      ? '验证进行中，暂时不能放弃更改'
                      : docBusy.saving
                        ? '保存进行中，完成后再放弃更改'
                        : undefined
                  }
                >
                  放弃更改
                </button>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => void closeDocEditor()}
                disabled={docBusy.verifying}
              >
                {docBusy.verifying ? '验证中…' : docDirty ? '保存并关闭' : '关闭'}
              </button>
            </div>
          </div>
        }
      >
        <TechDocEditor
          ref={docEditorRef}
          node={node}
          onSaved={applySavedDoc}
          onDirtyChange={setDocDirty}
          onBusyChange={setDocBusy}
          minHeight={460}
        />
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        eyebrow="Delete node"
        title={`删除「${node.name}」？`}
        description={
          node.childCount > 0
            ? '这个节点下面还有子节点，需要选择如何处理它们。'
            : '删除后无法恢复；关联的视图引用和知识笔记关联会被清理。'
        }
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setDeleteOpen(false)}>
              取消
            </button>
            <button className="btn btn-danger" onClick={() => void removeNode()} disabled={busy}>
              {busy ? '删除中…' : '确认删除'}
            </button>
          </>
        }
      >
        {node.childCount > 0 && (
          <div className="tech-delete-options">
            <label className={`tech-choice ${strategy === 'promote' ? 'active' : ''}`}>
              <input
                type="radio"
                name="node-delete-strategy"
                checked={strategy === 'promote'}
                onChange={() => setStrategy('promote')}
              />
              <span>
                <strong>保留子节点，提升一级</strong>
                <em>子节点移动到当前节点原来的位置，知识内容继续保留。</em>
              </span>
            </label>
            <label className={`tech-choice ${strategy === 'subtree' ? 'active' : ''}`}>
              <input
                type="radio"
                name="node-delete-strategy"
                checked={strategy === 'subtree'}
                onChange={() => setStrategy('subtree')}
              />
              <span>
                <strong>连同 {node.childCount} 个子树节点一起删除</strong>
                <em>只在确认整块内容都不再需要时使用，无法撤销。</em>
              </span>
            </label>
          </div>
        )}
      </Modal>

      <Modal
        open={relationOpen}
        onClose={() => setRelationOpen(false)}
        eyebrow="New relation"
        title="添加技术关系"
        description="从当前节点指向另一个节点。关系是手工判断，不会根据名称自动生成。"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setRelationOpen(false)}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => void addRelation()} disabled={busy}>
              {busy ? '添加中…' : '添加关系'}
            </button>
          </>
        }
      >
        <div className="grid gap-3">
          <label className="field">
            <span className="field-label">关系类型</span>
            <select
              className="field-input"
              value={relationDraft.relationType}
              onChange={(event) =>
                setRelationDraft({ ...relationDraft, relationType: event.target.value as TechRelationType })
              }
            >
              {Object.entries(relationLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span className="field-label">目标节点</span>
            <div className="inline-search mb-2">
              <Search size={12} />
              <input
                value={relationSearch}
                onChange={(event) => setRelationSearch(event.target.value)}
                placeholder="搜索同一领域内的节点"
              />
            </div>
            <div className="tech-relation-picker">
              {relationTargets.length === 0 ? (
                <p className="tech-form-hint">没有匹配的节点。</p>
              ) : (
                relationTargets.map((target) => (
                  <button
                    key={target.id}
                    className={`tech-relation-pick ${relationDraft.targetNodeId === target.id ? 'active' : ''}`}
                    onClick={() => setRelationDraft({ ...relationDraft, targetNodeId: target.id })}
                  >
                    <span className={`tech-type-dot type-${target.nodeType}`} />
                    <span>{target.name}</span>
                    <em>{techNodeTypeLabels[target.nodeType]}</em>
                  </button>
                ))
              )}
            </div>
          </div>
          <label className="field">
            <span className="field-label">说明（可选）</span>
            <input
              className="field-input"
              value={relationDraft.description}
              onChange={(event) => setRelationDraft({ ...relationDraft, description: event.target.value })}
              placeholder="为什么存在这个关系"
              maxLength={500}
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={Boolean(relationDeleting)}
        onClose={() => setRelationDeleting(null)}
        eyebrow="Delete relation"
        title="删除这条关系？"
        description="只删除两个节点之间的这条关系，节点和知识内容都会保留。"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setRelationDeleting(null)}>
              取消
            </button>
            <button className="btn btn-danger" onClick={() => void removeRelation()} disabled={busy}>
              删除关系
            </button>
          </>
        }
      >
        <div className="form-note">
          {relationDeleting
            ? `${relationDeleting.source.name} → ${relationLabels[relationDeleting.relationType]} → ${relationDeleting.target.name}`
            : ''}
        </div>
      </Modal>
    </div>
  );
}
