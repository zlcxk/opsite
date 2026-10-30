import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Check, CircleAlert, ExternalLink, FileText, RotateCcw, Save } from 'lucide-react';
import type { TechContentSource, TechContentStatus, TechNode } from '@shared/types';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import {
  contentSourceLabels,
  contentStatusLabels,
  contentStatusOrder,
  techDocTemplate,
  techNodeTypeLabels,
} from '../lib/tech';
import { useToast } from '../contexts/ToastContext';
import { MarkdownWorkspace } from './markdown/MarkdownWorkspace';

export interface TechDocEditorHandle {
  save: (silent?: boolean) => Promise<boolean>;
  isDirty: () => boolean;
}

interface BaseDoc {
  markdown: string;
  status: TechContentStatus;
  source: TechContentSource | '';
  versions: string;
}

function baseFromNode(node: TechNode): BaseDoc {
  return {
    markdown: node.contentMarkdown ?? '',
    status: node.contentStatus,
    source: node.contentSource ?? '',
    versions: node.applicableVersions ?? '',
  };
}

function sameDoc(a: BaseDoc, b: BaseDoc): boolean {
  return (
    a.markdown === b.markdown &&
    a.status === b.status &&
    a.source === b.source &&
    a.versions === b.versions
  );
}

export const TechDocEditor = forwardRef<
  TechDocEditorHandle,
  {
    node: TechNode;
    autoSave?: boolean;
    onSaved?: (node: TechNode) => void;
    onDirtyChange?: (dirty: boolean) => void;
    minHeight?: number;
  }
>(function TechDocEditor({ node, autoSave = true, onSaved, onDirtyChange, minHeight = 420 }, ref) {
  const { push } = useToast();
  const [draft, setDraft] = useState<BaseDoc>(() => baseFromNode(node));
  const [base, setBase] = useState<BaseDoc>(() => baseFromNode(node));
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const dirty = !sameDoc(draft, base);
  const nodeRef = useRef(node);
  nodeRef.current = node;

  useEffect(() => {
    const next = baseFromNode(node);
    setDraft(next);
    setBase(next);
    setSaveState('idle');
    setSaveError(null);
  }, [node.id]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const runSave = async (silent: boolean): Promise<boolean> => {
    setSaveState('saving');
    setSaveError(null);
    const payload: BaseDoc = { ...draft };
    try {
      const saved = await api.patch<TechNode>(`/tech/nodes/${nodeRef.current.id}`, {
        contentMarkdown: payload.markdown.trim() ? payload.markdown : null,
        contentStatus: payload.status,
        contentSource: payload.source || null,
        applicableVersions: payload.versions.trim() || null,
      });
      const next = {
        markdown: saved.contentMarkdown ?? '',
        status: saved.contentStatus,
        source: saved.contentSource ?? '',
        versions: saved.applicableVersions ?? '',
      } satisfies BaseDoc;
      setBase(next);
      setDraft((current) => (sameDoc(current, payload) ? next : current));
      setSaveState('saved');
      if (!silent) push('技术文档已保存');
      onSaved?.(saved);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败';
      setSaveState('error');
      setSaveError(message);
      if (!silent) push(message, 'error');
      return false;
    }
  };

  const save = (silent = false): Promise<boolean> => {
    // A save started moments ago (usually autosave) already contains the
    // latest committed keystrokes. Share its result instead of failing.
    if (inFlightRef.current) return inFlightRef.current;
    if (!dirty) {
      setSaveState('saved');
      return Promise.resolve(true);
    }
    if (draft.status === 'complete' && !draft.markdown.trim()) {
      if (!silent) push('内容为空时无法标记为已完善', 'error');
      return Promise.resolve(false);
    }
    const task = runSave(silent).finally(() => {
      inFlightRef.current = null;
    });
    inFlightRef.current = task;
    return task;
  };

  useImperativeHandle(ref, () => ({ save, isDirty: () => dirty }), [save, dirty]);

  useEffect(() => {
    // Stay on the failure state until the author retries, instead of hammering
    // the API every debounce interval.
    if (!autoSave || !dirty || saveState === 'saving' || saveState === 'error') return;
    const timer = window.setTimeout(() => {
      void save(true);
    }, 1400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty, autoSave, saveState]);

  const updateMarkdown = (markdown: string) => {
    setDraft((current) => ({
      ...current,
      markdown,
      // Editing a verified document invalidates its verification until the
      // author explicitly marks it complete again.
      status:
        markdown !== base.markdown && current.status === 'complete' ? 'draft' : current.status,
    }));
  };

  const statusText =
    saveState === 'saving'
      ? '保存中…'
      : saveState === 'error'
        ? '保存失败'
        : dirty
          ? '有未保存的更改'
          : saveState === 'saved'
            ? '已保存'
            : node.contentUpdatedAt
              ? `内容更新于 ${formatDateTime(node.contentUpdatedAt)}`
              : '尚未保存过文档';

  return (
    <div className="tech-doc-editor">
      <div className="tech-doc-meta">
        <label className="field">
          <span className="field-label">内容状态</span>
          <select
            className="field-input"
            value={draft.status}
            onChange={(event) =>
              setDraft({ ...draft, status: event.target.value as TechContentStatus })
            }
          >
            {contentStatusOrder.map((status) => (
              <option key={status} value={status}>
                {contentStatusLabels[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">来源</span>
          <select
            className="field-input"
            value={draft.source}
            onChange={(event) =>
              setDraft({ ...draft, source: event.target.value as TechContentSource | '' })
            }
          >
            <option value="">未标注</option>
            {(Object.keys(contentSourceLabels) as TechContentSource[]).map((source) => (
              <option key={source} value={source}>
                {contentSourceLabels[source]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">适用版本</span>
          <input
            className="field-input"
            value={draft.versions}
            onChange={(event) => setDraft({ ...draft, versions: event.target.value })}
            placeholder="如 Kubernetes 1.28+"
          />
        </label>
      </div>

      {!draft.markdown.trim() && (
        <div className="tech-doc-template">
          <FileText size={14} />
          <div>
            <strong>{techNodeTypeLabels[node.nodeType]}文档结构建议</strong>
            <span>按节点类型生成章节骨架，插入后可自由调整。</span>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => updateMarkdown(techDocTemplate(node.nodeType))}
          >
            插入模板
          </button>
        </div>
      )}

      <MarkdownWorkspace
        value={draft.markdown}
        onChange={updateMarkdown}
        minHeight={minHeight}
        onSave={() => void save()}
        placeholder="按「定义 → 设计目的 → 机制 → 配置示例 → 排查 → 参考」组织内容…"
        empty="这份文档还没有内容。切换到编辑模式开始撰写。"
      />

      <div className="tech-doc-foot">
        <div className="tech-doc-save-state">
          {saveState === 'error' ? (
            <CircleAlert size={12} />
          ) : saveState === 'saved' && !dirty ? (
            <Check size={12} />
          ) : null}
          <span className={saveState === 'error' ? 'text-[var(--high)]' : ''}>{statusText}</span>
          {saveError && <span className="tech-doc-error-inline">{saveError}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {node.docsUrl && (
            <a className="btn btn-ghost btn-sm" href={node.docsUrl} target="_blank" rel="noreferrer noopener">
              <ExternalLink size={12} /> 官方文档
            </a>
          )}
          {node.repoUrl && (
            <a className="btn btn-ghost btn-sm" href={node.repoUrl} target="_blank" rel="noreferrer noopener">
              <ExternalLink size={12} /> 代码仓库
            </a>
          )}
          {saveState === 'error' && (
            <button className="btn btn-secondary btn-sm" onClick={() => void save()}>
              <RotateCcw size={12} /> 重试
            </button>
          )}
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => void save()}
            disabled={saveState === 'saving'}
          >
            <Save size={12} /> 保存
          </button>
        </div>
      </div>
    </div>
  );
});
