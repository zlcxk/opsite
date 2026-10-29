import { useEffect, useMemo, useState } from 'react';
import { FilePlus2, NotebookPen, Save, Search, Trash2 } from 'lucide-react';
import type { KnowledgeNote } from '@shared/types';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { api } from '../lib/api';
import { useAppData } from '../contexts/AppDataContext';
import { useToast } from '../contexts/ToastContext';
import { formatDateTime } from '../lib/format';
import { EmptyState, Modal, PageHeader } from '../components/ui';

interface Draft {
  title: string;
  content: string;
  tags: string;
  relatedSoftwareId: string;
}

const emptyDraft: Draft = { title: '', content: '', tags: '', relatedSoftwareId: '' };

export function Knowledge() {
  useDocumentTitle('知识库');
  const { data, loading, error, refetch, setData } = useApi<KnowledgeNote[]>('/knowledge');
  const { data: appData } = useAppData();
  const { push } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<KnowledgeNote | null>(null);

  const notes = data ?? [];
  const selected = notes.find((note) => note.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return notes;
    return notes.filter(
      (note) =>
        note.title.toLowerCase().includes(term) ||
        note.content.toLowerCase().includes(term) ||
        note.tags.some((tag) => tag.toLowerCase().includes(term)),
    );
  }, [notes, search]);

  const loadDraft = (note: KnowledgeNote) => {
    setDraft({
      title: note.title,
      content: note.content,
      tags: note.tags.join(', '),
      relatedSoftwareId: note.relatedSoftwareId ?? '',
    });
    setSelectedId(note.id);
    setCreating(false);
    setDirty(false);
    setSaveState('idle');
  };

  useEffect(() => {
    if (selectedId || creating || notes.length === 0) return;
    loadDraft(notes[0]);
    // Only used for the initial selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes.length, selectedId, creating]);

  const persist = async (silent = false): Promise<boolean> => {
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
      };
      const saved = creating
        ? await api.post<KnowledgeNote>('/knowledge', body)
        : await api.patch<KnowledgeNote>(`/knowledge/${selectedId}`, body);
      if (creating) {
        setSelectedId(saved.id);
        setCreating(false);
        await refetch(true);
      } else {
        setData(notes.map((note) => (note.id === saved.id ? saved : note)));
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
    if (!dirty || creating || !selectedId || !draft.title.trim() || saveState === 'saving') return;
    const timer = window.setTimeout(() => {
      void persist(true);
    }, 1200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty, creating, selectedId]);

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

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void persist();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, creating, selectedId]);

  const selectNote = async (note: KnowledgeNote) => {
    if (note.id === selectedId) return;
    if (dirty && selectedId && !creating) {
      const saved = await persist(true);
      if (!saved) return;
    }
    if (dirty && creating) {
      push('请先保存或丢弃当前新笔记', 'error');
      return;
    }
    loadDraft(note);
  };

  const newNote = () => {
    if (dirty && creating) return;
    setSelectedId(null);
    setCreating(true);
    setDraft(emptyDraft);
    setDirty(false);
    setSaveState('idle');
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api.delete(`/knowledge/${deleting.id}`);
      push('笔记已删除');
      const remaining = notes.filter((note) => note.id !== deleting.id);
      setDeleting(null);
      setDirty(false);
      if (selectedId === deleting.id) {
        if (remaining.length) loadDraft(remaining[0]);
        else {
          setSelectedId(null);
          setCreating(false);
          setDraft(emptyDraft);
        }
      }
      await refetch(true);
    } catch (deleteError) {
      push(deleteError instanceof Error ? deleteError.message : '删除失败', 'error');
    }
  };

  const statusText =
    saveState === 'saving'
      ? '保存中…'
      : saveState === 'error'
        ? '保存失败'
        : dirty
          ? '有未保存的更改'
          : saveState === 'saved'
            ? '已自动保存'
            : selected
              ? `最后编辑 ${formatDateTime(selected.updatedAt)}`
              : '新笔记';

  return (
    <div className="page">
      <PageHeader
        eyebrow="Knowledge · decisions and context"
        title="知识库"
        subtitle="记录升级决策、兼容性结论和排查经验，避免下次从零开始。"
        actions={
          <button className="btn btn-primary" onClick={newNote}>
            <FilePlus2 size={14} /> 新建笔记
          </button>
        }
      />

      {error && <div className="error-note mb-3">{error}</div>}

      {loading && !data ? (
        <div className="loading-block" style={{ minHeight: 420 }} />
      ) : notes.length === 0 && !creating ? (
        <EmptyState
          icon={NotebookPen}
          title="还没有笔记"
          description="把一次升级评估、一个兼容性坑点或一条排障结论记下来。之后可以关联到具体软件。"
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
                placeholder="搜索标题、内容或标签"
                aria-label="搜索笔记"
              />
            </div>
            <div className="note-list">
              {filtered.length === 0 ? (
                <div className="p-5 text-center text-[10px] text-[var(--muted)]">没有匹配的笔记</div>
              ) : (
                filtered.map((note) => (
                  <button
                    key={note.id}
                    className={`note-item ${note.id === selectedId ? 'active' : ''}`}
                    onClick={() => void selectNote(note)}
                  >
                    <strong>{note.title}</strong>
                    <span>{note.content.trim() || '暂无内容'}</span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-1">
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
              <span className={`text-[8.5px] ${dirty ? 'text-[var(--high)]' : 'text-[var(--muted-2)]'}`}>
                {statusText}
              </span>
              <div className="flex items-center gap-1.5">
                {selected && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setDeleting(selected)}
                    aria-label="删除笔记"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
                <button className="btn btn-secondary btn-sm" onClick={() => void persist()} disabled={saveState === 'saving'}>
                  <Save size={12} /> 保存
                </button>
              </div>
            </div>

            <input
              value={draft.title}
              onChange={(event) => {
                setDraft({ ...draft, title: event.target.value });
                setDirty(true);
              }}
              placeholder="笔记标题"
              aria-label="笔记标题"
            />
            <textarea
              value={draft.content}
              onChange={(event) => {
                setDraft({ ...draft, content: event.target.value });
                setDirty(true);
              }}
              placeholder="写下背景、结论与下一步。支持纯文本，适合记录升级评估与排障过程。"
              aria-label="笔记内容"
            />

            <div className="mt-4 grid gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-2">
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
            <button className="btn btn-danger" onClick={() => void remove()}>
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
