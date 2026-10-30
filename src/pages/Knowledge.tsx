import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  FilePlus2,
  FileText,
  Network,
  NotebookPen,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  KnowledgeNote,
  TechContentStatus,
  TechDomainSummary,
  TechNodeDetail,
  TechNodeListResponse,
  TechNodeType,
} from '@shared/types';
import { useApi, useDebouncedValue, useDocumentTitle } from '../lib/hooks';
import { api } from '../lib/api';
import { useAppData } from '../contexts/AppDataContext';
import { useToast } from '../contexts/ToastContext';
import { formatDateTime } from '../lib/format';
import {
  contentStatusLabels,
  contentStatusOrder,
  techNodeTypeLabels,
} from '../lib/tech';
import { EmptyState, Modal, PageHeader } from '../components/ui';
import { TechDocEditor, type TechDocEditorHandle } from '../components/TechDocEditor';
import { MarkdownWorkspace } from '../components/markdown/MarkdownWorkspace';

interface Draft {
  title: string;
  content: string;
  tags: string;
  relatedSoftwareId: string;
  techNodeId: string;
}

const emptyDraft: Draft = { title: '', content: '', tags: '', relatedSoftwareId: '', techNodeId: '' };

type Tab = 'tech' | 'notes';

export function Knowledge() {
  useDocumentTitle('知识库');
  const [searchParams] = useSearchParams();
  const initialTab: Tab =
    searchParams.get('noteId') || searchParams.get('new') === '1' ? 'notes' : 'tech';
  const [tab, setTab] = useState<Tab>(initialTab);

  const { push } = useToast();
  const { data: appData } = useAppData();

  // Personal notes
  const {
    data: notesData,
    loading: notesLoading,
    error: notesError,
    refetch: refetchNotes,
    setData: setNotesData,
  } = useApi<KnowledgeNote[]>('/knowledge');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<KnowledgeNote | null>(null);
  const queryApplied = useRef(false);

  // Technology knowledge
  const { data: techDomains } = useApi<TechDomainSummary[]>('/tech/domains');
  const { data: allTechNodes } = useApi<TechNodeListResponse>('/tech/nodes?status=active&limit=300');
  const [techDomainId, setTechDomainId] = useState('');
  const [techSearch, setTechSearch] = useState('');
  const [techStatus, setTechStatus] = useState<TechContentStatus | ''>('');
  const [techType, setTechType] = useState<TechNodeType | ''>('');
  const debouncedTechSearch = useDebouncedValue(techSearch, 300);
  const techQuery = useMemo(() => {
    const params = new URLSearchParams({ status: 'active', limit: '300' });
    if (techDomainId) params.set('domainId', techDomainId);
    if (debouncedTechSearch.trim()) params.set('q', debouncedTechSearch.trim());
    if (techStatus) params.set('contentStatus', techStatus);
    if (techType) params.set('nodeType', techType);
    return `/tech/nodes?${params.toString()}`;
  }, [techDomainId, debouncedTechSearch, techStatus, techType]);
  const {
    data: techList,
    loading: techLoading,
    error: techError,
    refetch: refetchTechList,
    setData: setTechListData,
  } = useApi<TechNodeListResponse>(techQuery);
  const [selectedTechId, setSelectedTechId] = useState<string | null>(null);
  const [techParamApplied, setTechParamApplied] = useState(false);
  const {
    data: techDetail,
    loading: techDetailLoading,
    error: techDetailError,
    setData: setTechDetail,
  } = useApi<TechNodeDetail>(selectedTechId ? `/tech/nodes/${selectedTechId}` : null);
  const techDocRef = useRef<TechDocEditorHandle | null>(null);

  const notes = notesData ?? [];
  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;
  const techItems = techList?.items ?? [];
  const techNode = techDetail?.node ?? null;
  const domainById = useMemo(
    () => new Map((techDomains ?? []).map((domain) => [domain.id, domain])),
    [techDomains],
  );

  const filteredNotes = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return notes;
    return notes.filter(
      (note) =>
        note.title.toLowerCase().includes(term) ||
        note.content.toLowerCase().includes(term) ||
        note.tags.some((tag) => tag.toLowerCase().includes(term)) ||
        (note.techNodeName ?? '').toLowerCase().includes(term),
    );
  }, [notes, search]);

  // Consume noteId/new/techNodeId once, after data loads.
  useEffect(() => {
    if (!notesData || queryApplied.current) return;
    const noteParam = searchParams.get('noteId');
    const newParam = searchParams.get('new');
    if (!noteParam && newParam !== '1') return;
    queryApplied.current = true;
    if (newParam === '1') {
      setTab('notes');
      setSelectedNoteId(null);
      setCreating(true);
      setDraft({ ...emptyDraft, techNodeId: searchParams.get('techNodeId') ?? '' });
      setDirty(false);
      setSaveState('idle');
      return;
    }
    const note = noteParam ? notesData.find((item) => item.id === noteParam) : null;
    if (note) {
      setTab('notes');
      setDraft({
        title: note.title,
        content: note.content,
        tags: note.tags.join(', '),
        relatedSoftwareId: note.relatedSoftwareId ?? '',
        techNodeId: note.techNodeId ?? '',
      });
      setSelectedNoteId(note.id);
      setCreating(false);
      setDirty(false);
      setSaveState('idle');
    }
    // Query parameters are consumed once, after notes load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesData, searchParams]);

  useEffect(() => {
    if (selectedNoteId || creating || notes.length === 0) return;
    if (searchParams.get('noteId') || searchParams.get('new') === '1') return;
    const note = notes[0];
    setDraft({
      title: note.title,
      content: note.content,
      tags: note.tags.join(', '),
      relatedSoftwareId: note.relatedSoftwareId ?? '',
      techNodeId: note.techNodeId ?? '',
    });
    setSelectedNoteId(note.id);
    // Only used for the initial selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes.length, selectedNoteId, creating]);

  useEffect(() => {
    if (techParamApplied || !techList) return;
    const techParam = searchParams.get('techNodeId');
    if (techParam && techItems.some((item) => item.id === techParam)) {
      setSelectedTechId(techParam);
      setTechParamApplied(true);
      return;
    }
    if (!selectedTechId && techItems.length) {
      setSelectedTechId(techItems[0].id);
    }
    setTechParamApplied(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [techList, techParamApplied]);

  const selectTechNode = async (id: string) => {
    if (id === selectedTechId) return;
    const editor = techDocRef.current;
    if (editor?.isDirty()) {
      let saved = await editor.save(true);
      // Edits made while the request was in flight are not in that payload.
      if (saved && editor.isDirty()) saved = await editor.save(true);
      if (!saved) {
        push('当前文档尚未保存，已停留在原节点', 'error');
        return;
      }
    }
    setSelectedTechId(id);
  };

  const persistNote = async (silent = false): Promise<boolean> => {
    if (!draft.title.trim()) {
      if (!silent) push('笔记需要一个标题', 'error');
      return false;
    }
    setSaveState('saving');
    try {
      const body = {
        title: draft.title.trim(),
        content: draft.content,
        tags: draft.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        relatedSoftwareId: draft.relatedSoftwareId || null,
        techNodeId: draft.techNodeId || null,
      };
      const saved = creating
        ? await api.post<KnowledgeNote>('/knowledge', body)
        : await api.patch<KnowledgeNote>(`/knowledge/${selectedNoteId}`, body);
      if (creating) {
        setSelectedNoteId(saved.id);
        setCreating(false);
        await refetchNotes(true);
      } else {
        setNotesData(notes.map((note) => (note.id === saved.id ? saved : note)));
      }
      setDirty(false);
      setSaveState('saved');
      if (!silent) push(creating ? '笔记已创建' : '笔记已保存');
      return true;
    } catch (saveError) {
      setSaveState('error');
      push(saveError instanceof Error ? saveError.message : '保存失败', 'error');
      return false;
    }
  };

  // Autosave edits to existing notes; new notes still need an explicit save.
  useEffect(() => {
    if (!dirty || creating || !selectedNoteId || !draft.title.trim() || saveState === 'saving') return;
    const timer = window.setTimeout(() => {
      void persistNote(true);
    }, 1200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty, creating, selectedNoteId]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const loadNote = (note: KnowledgeNote) => {
    setDraft({
      title: note.title,
      content: note.content,
      tags: note.tags.join(', '),
      relatedSoftwareId: note.relatedSoftwareId ?? '',
      techNodeId: note.techNodeId ?? '',
    });
    setSelectedNoteId(note.id);
    setCreating(false);
    setDirty(false);
    setSaveState('idle');
  };

  const selectNote = async (note: KnowledgeNote) => {
    if (note.id === selectedNoteId) return;
    if (dirty && selectedNoteId && !creating) {
      const saved = await persistNote(true);
      if (!saved) return;
    }
    if (dirty && creating) {
      push('请先保存或丢弃当前新笔记', 'error');
      return;
    }
    loadNote(note);
  };

  const newNote = () => {
    if (dirty && creating) return;
    setTab('notes');
    setSelectedNoteId(null);
    setCreating(true);
    setDraft(emptyDraft);
    setDirty(false);
    setSaveState('idle');
  };

  const removeNote = async () => {
    if (!deleting) return;
    try {
      await api.delete(`/knowledge/${deleting.id}`);
      push('笔记已删除');
      const remaining = notes.filter((note) => note.id !== deleting.id);
      setDeleting(null);
      setDirty(false);
      if (selectedNoteId === deleting.id) {
        if (remaining.length) {
          const note = remaining[0];
          setDraft({
            title: note.title,
            content: note.content,
            tags: note.tags.join(', '),
            relatedSoftwareId: note.relatedSoftwareId ?? '',
            techNodeId: note.techNodeId ?? '',
          });
          setSelectedNoteId(note.id);
        } else {
          setSelectedNoteId(null);
          setCreating(false);
          setDraft(emptyDraft);
        }
      }
      await refetchNotes(true);
    } catch (deleteError) {
      push(deleteError instanceof Error ? deleteError.message : '删除失败', 'error');
    }
  };

  const updateTechSaved = (saved: TechNodeDetail['node']) => {
    if (techDetail) setTechDetail({ ...techDetail, node: saved });
    if (!techList) return;
    setTechListData({
      total: techList.total,
      items: techList.items.map((item) =>
        item.id === saved.id
          ? { ...item, contentStatus: saved.contentStatus, hasContent: Boolean(saved.contentMarkdown) }
          : item,
      ),
    });
  };

  const notesStatusText =
    saveState === 'saving'
      ? '保存中…'
      : saveState === 'error'
        ? '保存失败'
        : dirty
          ? '有未保存的更改'
          : saveState === 'saved'
            ? '已自动保存'
            : selectedNote
              ? `最后编辑 ${formatDateTime(selectedNote.updatedAt)}`
              : '新笔记';

  return (
    <div className="page">
      <PageHeader
        eyebrow="Knowledge · decisions and context"
        title="知识库"
        subtitle="管理技术节点的长期文档，也记录升级决策、兼容性结论和排查经验。"
        actions={
          tab === 'notes' ? (
            <button className="btn btn-primary" onClick={newNote}>
              <FilePlus2 size={14} /> 新建笔记
            </button>
          ) : (
            <span className="knowledge-head-hint">
              技术文档随节点保存，个人笔记独立维护
            </span>
          )
        }
      />

      <div className="knowledge-tabs" role="tablist" aria-label="知识库分类">
        <button
          role="tab"
          aria-selected={tab === 'tech'}
          className={tab === 'tech' ? 'active' : ''}
          onClick={() => setTab('tech')}
        >
          <Network size={13} /> 技术知识
        </button>
        <button
          role="tab"
          aria-selected={tab === 'notes'}
          className={tab === 'notes' ? 'active' : ''}
          onClick={() => setTab('notes')}
        >
          <NotebookPen size={13} /> 个人笔记
        </button>
      </div>

      {tab === 'tech' ? (
        <div className="knowledge-layout knowledge-tech-layout">
          <div className="knowledge-list-column">
            <div className="inline-search mb-2.5">
              <Search size={12} />
              <input
                value={techSearch}
                onChange={(event) => setTechSearch(event.target.value)}
                placeholder="搜索名称、摘要或文档内容"
                aria-label="搜索技术知识"
              />
            </div>
            <div className="knowledge-filters">
              <select
                value={techDomainId}
                onChange={(event) => setTechDomainId(event.target.value)}
                aria-label="按领域筛选"
              >
                <option value="">全部领域</option>
                {(techDomains ?? []).map((domain) => (
                  <option key={domain.id} value={domain.id}>
                    {domain.name}
                  </option>
                ))}
              </select>
              <select
                value={techType}
                onChange={(event) => setTechType(event.target.value as TechNodeType | '')}
                aria-label="按节点类型筛选"
              >
                <option value="">全部类型</option>
                {(Object.keys(techNodeTypeLabels) as TechNodeType[])
                  .filter((type) => type !== 'domain')
                  .map((type) => (
                    <option key={type} value={type}>
                      {techNodeTypeLabels[type]}
                    </option>
                  ))}
              </select>
              <select
                value={techStatus}
                onChange={(event) => setTechStatus(event.target.value as TechContentStatus | '')}
                aria-label="按文档状态筛选"
              >
                <option value="">全部状态</option>
                {contentStatusOrder.map((status) => (
                  <option key={status} value={status}>
                    {contentStatusLabels[status]}
                  </option>
                ))}
              </select>
            </div>
            {techError && <div className="error-note mb-2">{techError}</div>}
            <div className="note-list tech-knowledge-list">
              {techLoading && !techList ? (
                <div className="loading-block" style={{ minHeight: 240 }} />
              ) : techItems.length === 0 ? (
                <div className="p-5 text-center text-[0.75rem] text-[var(--muted)]">
                  没有匹配的技术节点
                </div>
              ) : (
                techItems.map((item) => (
                  <button
                    key={item.id}
                    className={`note-item tech-knowledge-item ${item.id === selectedTechId ? 'active' : ''}`}
                    onClick={() => void selectTechNode(item.id)}
                  >
                    <span className="tech-knowledge-row">
                      <span className={`tech-type-dot type-${item.nodeType}`} />
                      <strong>{item.name}</strong>
                      <span className={`content-badge content-${item.contentStatus}`}>
                        {contentStatusLabels[item.contentStatus]}
                      </span>
                    </span>
                    <span>{item.summary || '暂无摘要'}</span>
                    <span className="tech-knowledge-meta">
                      {domainById.get(item.domainId)?.name ?? '未知领域'} ·{' '}
                      {techNodeTypeLabels[item.nodeType]}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="note-editor tech-knowledge-editor">
            {!selectedTechId ? (
              <EmptyState
                icon={FileText}
                title="选择技术节点"
                description="左侧选择一个技术节点，就可以查看和编辑它的 Markdown 文档。"
              />
            ) : techDetailLoading && !techDetail ? (
              <div className="loading-block" style={{ minHeight: 420 }} />
            ) : techDetailError && !techDetail ? (
              <div className="error-note">{techDetailError}</div>
            ) : techNode && techDetail ? (
              <>
                <div className="tech-knowledge-editor-head">
                  <div>
                    <strong>{techNode.name}</strong>
                    <span>
                      {techDetail.domain.name} · {techNodeTypeLabels[techNode.nodeType]}
                      {techNode.summary ? ` · ${techNode.summary}` : ''}
                    </span>
                  </div>
                  <Link to={`/tech/nodes/${techNode.id}`} className="btn btn-ghost btn-sm">
                    打开节点 <Network size={11} />
                  </Link>
                </div>
                <TechDocEditor
                  key={techNode.id}
                  ref={techDocRef}
                  node={techNode}
                  onSaved={updateTechSaved}
                  minHeight={380}
                />
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          {notesError && <div className="error-note mb-3">{notesError}</div>}
          {notesLoading && !notesData ? (
            <div className="loading-block" style={{ minHeight: 420 }} />
          ) : notes.length === 0 && !creating ? (
            <EmptyState
              icon={NotebookPen}
              title="还没有笔记"
              description="把一次升级评估、一个兼容性坑点或一条排障结论记下来。之后可以关联到具体技术节点或软件。"
              actions={
                <button className="btn btn-primary" onClick={newNote}>
                  <FilePlus2 size={13} /> 写第一条笔记
                </button>
              }
            />
          ) : (
            <div className="knowledge-layout">
              <div>
                <div className="inline-search mb-2.5">
                  <Search size={12} />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="搜索标题、正文、标签或关联节点"
                    aria-label="搜索笔记"
                  />
                </div>
                <div className="note-list">
                  {filteredNotes.length === 0 ? (
                    <div className="p-5 text-center text-[0.75rem] text-[var(--muted)]">
                      没有匹配的笔记
                    </div>
                  ) : (
                    filteredNotes.map((note) => (
                      <button
                        key={note.id}
                        className={`note-item ${note.id === selectedNoteId ? 'active' : ''}`}
                        onClick={() => void selectNote(note)}
                      >
                        <strong>{note.title}</strong>
                        <span>{note.content.trim() || '暂无内容'}</span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-1">
                          {note.techNodeName && (
                            <em className="note-tag note-tag-tech">
                              <Network size={9} /> {note.techNodeName}
                            </em>
                          )}
                          {note.relatedSoftwareName && (
                            <em className="note-tag">{note.relatedSoftwareName}</em>
                          )}
                          {note.tags.slice(0, 2).map((tag) => (
                            <em className="note-tag" key={tag}>
                              #{tag}
                            </em>
                          ))}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="note-editor">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span
                    className={`text-[0.65625rem] ${dirty ? 'text-[var(--high)]' : 'text-[var(--muted-2)]'}`}
                  >
                    {notesStatusText}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {selectedNote && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setDeleting(selectedNote)}
                        aria-label="删除笔记"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => void persistNote()}
                      disabled={saveState === 'saving'}
                    >
                      <Save size={12} /> 保存
                    </button>
                  </div>
                </div>

                <input
                  className="note-title-input"
                  value={draft.title}
                  onChange={(event) => {
                    setDraft({ ...draft, title: event.target.value });
                    setDirty(true);
                  }}
                  placeholder="笔记标题"
                  aria-label="笔记标题"
                />
                <MarkdownWorkspace
                  value={draft.content}
                  onChange={(content) => {
                    setDraft((current) => ({ ...current, content }));
                    setDirty(true);
                  }}
                  onSave={() => void persistNote()}
                  minHeight={260}
                  placeholder="写下背景、结论与下一步。支持 Markdown，适合记录升级评估与排障过程。"
                  empty="还没有正文内容。切换到编辑模式开始记录。"
                />

                <div className="mt-4 grid gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-3">
                  <label className="field">
                    <span className="field-label">关联技术节点</span>
                    <select
                      className="field-input"
                      value={draft.techNodeId}
                      onChange={(event) => {
                        setDraft({ ...draft, techNodeId: event.target.value });
                        setDirty(true);
                      }}
                    >
                      <option value="">不关联</option>
                      {(techDomains ?? []).map((domain) => {
                        const domainNodes = (allTechNodes?.items ?? []).filter(
                          (node) => node.domainId === domain.id,
                        );
                        if (!domainNodes.length) return null;
                        return (
                          <optgroup key={domain.id} label={domain.name}>
                            {domainNodes.map((node) => (
                              <option key={node.id} value={node.id}>
                                {node.name}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                    {draft.techNodeId && (
                      <Link to={`/tech/nodes/${draft.techNodeId}`} className="tech-note-node-link">
                        在技术地图中打开 <Network size={10} />
                      </Link>
                    )}
                  </label>
                  <label className="field">
                    <span className="field-label">关联软件</span>
                    <select
                      className="field-input"
                      value={draft.relatedSoftwareId}
                      onChange={(event) => {
                        setDraft({ ...draft, relatedSoftwareId: event.target.value });
                        setDirty(true);
                      }}
                    >
                      <option value="">不关联</option>
                      {(appData?.software ?? []).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field-label">标签</span>
                    <input
                      className="field-input"
                      value={draft.tags}
                      onChange={(event) => {
                        setDraft({ ...draft, tags: event.target.value });
                        setDirty(true);
                      }}
                      placeholder="用逗号分隔，如 升级, 兼容性"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        eyebrow="Delete note"
        title={`删除「${deleting?.title ?? ''}」？`}
        description="笔记删除后无法恢复，关联的软件与其他情报不受影响。"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setDeleting(null)}>
              取消
            </button>
            <button className="btn btn-danger" onClick={() => void removeNote()}>
              删除笔记
            </button>
          </>
        }
      >
        <div className="form-note">建议先确认这条笔记里的结论已经同步到其他位置。</div>
      </Modal>
    </div>
  );
}
