import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  BadgeCheck,
  Check,
  CircleAlert,
  ExternalLink,
  FileText,
  RotateCcw,
  Save,
} from 'lucide-react';
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
  verifiedVersion: string;
  verifiedAt: string | null;
}

function baseFromNode(node: TechNode): BaseDoc {
  return {
    markdown: node.contentMarkdown ?? '',
    status: node.contentStatus,
    source: node.contentSource ?? '',
    versions: node.applicableVersions ?? '',
    verifiedVersion: node.verifiedVersion ?? '',
    verifiedAt: node.contentVerifiedAt,
  };
}

function sameDoc(a: BaseDoc, b: BaseDoc): boolean {
  return (
    a.markdown === b.markdown &&
    a.status === b.status &&
    a.source === b.source &&
    a.versions === b.versions &&
    a.verifiedVersion === b.verifiedVersion &&
    a.verifiedAt === b.verifiedAt
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
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const baseRef = useRef(base);
  baseRef.current = base;
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
    const payload: BaseDoc = { ...draftRef.current };
    try {
      const saved = await api.patch<TechNode>(`/tech/nodes/${nodeRef.current.id}`, {
        contentMarkdown: payload.markdown.trim() ? payload.markdown : null,
        contentStatus: payload.status,
        contentSource: payload.source || null,
        applicableVersions: payload.versions.trim() || null,
        verifiedVersion: payload.verifiedVersion.trim() || null,
      });
      const next = {
        markdown: saved.contentMarkdown ?? '',
        status: saved.contentStatus,
        source: saved.contentSource ?? '',
        versions: saved.applicableVersions ?? '',
        verifiedVersion: saved.verifiedVersion ?? '',
        verifiedAt: saved.contentVerifiedAt,
      } satisfies BaseDoc;
      baseRef.current = next;
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

  const save = async (silent = false): Promise<boolean> => {
    // A save started moments ago (usually autosave) already contains some of
    // the latest keystrokes. Wait for it, then save once more if the draft
    // moved on while the request was in flight. Only one request is ever open.
    if (inFlightRef.current) {
      const first = await inFlightRef.current;
      if (!first) return false;
      if (sameDoc(draftRef.current, baseRef.current)) return true;
      return save(silent);
    }
    if (sameDoc(draftRef.current, baseRef.current)) {
      setSaveState('saved');
      return true;
    }
    const current = draftRef.current;
    if (current.status === 'complete' && !current.markdown.trim()) {
      if (!silent) push('内容为空时无法标记为已完善', 'error');
      return false;
    }
    if (current.status === 'complete' && !current.verifiedVersion.trim()) {
      if (!silent) push('标记已完善前，请填写本次实际验证的版本', 'error');
      return false;
    }
    const task = runSave(silent).finally(() => {
      inFlightRef.current = null;
    });
    inFlightRef.current = task;
    return task;
  };

  useImperativeHandle(ref, () => ({
    save,
    isDirty: () => !sameDoc(draftRef.current, baseRef.current),
  }), [dirty]);

  const verify = async () => {
    const current = draftRef.current;
    if (!current.markdown.trim()) {
      push('没有文档内容，无法验证', 'error');
      return;
    }
    if (!current.verifiedVersion.trim()) {
      push('请填写本次实际验证的版本', 'error');
      return;
    }
    const saved = await save(true);
    if (!saved) return;
    setSaveState('saving');
    setSaveError(null);
    try {
      const verified = await api.post<TechNode>(`/tech/nodes/${nodeRef.current.id}/verify`, {
        version: draftRef.current.verifiedVersion.trim(),
      });
      const next = baseFromNode(verified);
      baseRef.current = next;
      setBase(next);
      setDraft(next);
      setSaveState('saved');
      onSaved?.(verified);
      push(`文档已验证，当前状态为已完善（${next.verifiedVersion}）`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '验证失败';
      setSaveState('error');
      setSaveError(message);
      push(message, 'error');
    }
  };

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
        <label className="field">
          <span className="field-label">已验证版本</span>
          <input
            className="field-input"
            value={draft.verifiedVersion}
            onChange={(event) => setDraft({ ...draft, verifiedVersion: event.target.value })}
            placeholder="如 1.34"
          />
          <span className="field-hint">
            {draft.verifiedAt ? `上次验证 ${formatDateTime(draft.verifiedAt)}` : '尚未人工验证'}
          </span>
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
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void verify()}
            disabled={saveState === 'saving' || !draft.markdown.trim() || !draft.verifiedVersion.trim()}
            title="确认内容已核对，记录验证时间和实际验证版本"
          >
            <BadgeCheck size={12} /> 验证知识
          </button>
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
