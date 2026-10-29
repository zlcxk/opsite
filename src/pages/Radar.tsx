import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Pencil, Plus, Radar as RadarIcon, Trash2 } from 'lucide-react';
import type { RadarItem, RadarKind } from '@shared/types';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { api } from '../lib/api';
import { useAppData } from '../contexts/AppDataContext';
import { useToast } from '../contexts/ToastContext';
import { formatDate } from '../lib/format';
import { ActionMenu, EmptyState, Modal, PageHeader } from '../components/ui';

const kinds: Array<{ value: RadarKind; label: string; hint: string }> = [
  { value: 'tool', label: '工具', hint: '正在评估或准备采用的新工具' },
  { value: 'tech', label: '技术', hint: '值得跟进的技术方向或实践' },
  { value: 'learning', label: '学习', hint: '计划阅读、实践或补齐的知识' },
];

const kindLabel: Record<RadarKind, string> = { tool: 'Tool', tech: 'Tech', learning: 'Learning' };

export function Radar() {
  useDocumentTitle('技术雷达');
  const { data, loading, error, refetch } = useApi<RadarItem[]>('/radar');
  const { refresh } = useAppData();
  const { push } = useToast();
  const [filter, setFilter] = useState<RadarKind | 'all'>('all');
  const [editing, setEditing] = useState<RadarItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<RadarItem | null>(null);

  const items = data ?? [];
  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter((item) => item.kind === filter)),
    [items, filter],
  );

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (item: RadarItem) => {
    setEditing(item);
    setDialogOpen(true);
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api.delete(`/radar/${deleting.id}`);
      push('雷达条目已删除');
      setDeleting(null);
      await refetch(true);
      await refresh(true);
    } catch (deleteError) {
      push(deleteError instanceof Error ? deleteError.message : '删除失败', 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Tech radar · your own shortlist"
        title="技术雷达"
        subtitle="这里不抓取外部热点，只记录你主动放进来的工具、技术与学习线索。"
        actions={
          <button className="btn btn-primary" onClick={openCreate}>
            <Plus size={14} /> 添加条目
          </button>
        }
      />

      {items.length > 0 && (
        <div className="filter-bar">
          <div className="filter-chips">
            <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
              全部 <span className="chip-count">{items.length}</span>
            </button>
            {kinds.map((kind) => {
              const count = items.filter((item) => item.kind === kind.value).length;
              return (
                <button
                  key={kind.value}
                  className={`chip ${filter === kind.value ? 'active' : ''}`}
                  onClick={() => setFilter(kind.value)}
                >
                  {kind.label}
                  {count > 0 && <span className="chip-count">{count}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && <div className="error-note mb-3">{error}</div>}

      {loading && !data ? (
        <div className="loading-block" style={{ minHeight: 260 }} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={RadarIcon}
          title={items.length ? '这个分类还没有条目' : '雷达是空的'}
          description={
            items.length
              ? '换一个分类，或添加一条新的技术线索。'
              : '把一个正在评估的工具、一项想跟进的技术，或一个学习主题放进来。'
          }
          actions={
            <button className="btn btn-primary" onClick={openCreate}>
              <Plus size={13} /> 添加第一条
            </button>
          }
        />
      ) : (
        <div className="radar-grid">
          {filtered.map((item) => (
            <article className="radar-card" key={item.id}>
              <div className="flex items-start justify-between gap-2">
                <span className="radar-kind">{kindLabel[item.kind]}</span>
                <ActionMenu
                  items={[
                    { label: '编辑条目', icon: Pencil, onClick: () => openEdit(item) },
                    {
                      label: '删除条目',
                      icon: Trash2,
                      danger: true,
                      onClick: () => setDeleting(item),
                    },
                  ]}
                />
              </div>
              <h3>{item.title}</h3>
              <p>{item.summary || '暂无补充说明。'}</p>
              <footer>
                <span>{formatDate(item.createdAt)} 加入</span>
                {item.url && (
                  <a href={item.url} target="_blank" rel="noreferrer" className="text-link">
                    打开 <ArrowUpRight size={11} />
                  </a>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}

      <RadarDialog
        open={dialogOpen}
        item={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={async () => {
          await refetch(true);
          await refresh(true);
        }}
      />

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        eyebrow="Remove radar item"
        title={`删除「${deleting?.title ?? ''}」？`}
        description="删除后不会影响任何软件或情报数据。"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setDeleting(null)}>
              取消
            </button>
            <button className="btn btn-danger" onClick={() => void remove()}>
              删除
            </button>
          </>
        }
      >
        <div className="form-note">这个操作不可撤销。</div>
      </Modal>
    </div>
  );
}

function RadarDialog({
  open,
  item,
  onClose,
  onSaved,
}: {
  open: boolean;
  item: RadarItem | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [kind, setKind] = useState<RadarKind>('tool');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { push } = useToast();

  useEffect(() => {
    if (!open) return;
    setTitle(item?.title ?? '');
    setSummary(item?.summary ?? '');
    setKind(item?.kind ?? 'tool');
    setUrl(item?.url ?? '');
    setError(null);
  }, [open, item]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('标题不能为空');
      return;
    }
    setBusy(true);
    try {
      const body = { title: title.trim(), summary: summary.trim(), kind, url: url.trim() || null };
      if (item) {
        await api.patch(`/radar/${item.id}`, body);
        push('雷达条目已更新');
      } else {
        await api.post('/radar', body);
        push('已加入技术雷达');
      }
      await onSaved();
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={item ? 'Edit radar item' : 'New radar item'}
      title={item ? '编辑雷达条目' : '添加雷达条目'}
      description="用一两句话写清楚为什么值得关注，未来回看时更有用。"
      footer={
        <>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" type="submit" form="radar-form" disabled={busy}>
            {busy ? '保存中…' : item ? '保存修改' : '加入雷达'}
          </button>
        </>
      }
    >
      <form id="radar-form" onSubmit={submit}>
        {error && <div className="error-note mb-3">{error}</div>}
        <label className="field">
          <span className="field-label">标题</span>
          <input
            className="field-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="如 Cilium Gateway API"
            autoFocus
          />
        </label>
        <label className="field mt-3">
          <span className="field-label">类型</span>
          <select
            className="field-input"
            value={kind}
            onChange={(event) => setKind(event.target.value as RadarKind)}
          >
            {kinds.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} · {option.hint}
              </option>
            ))}
          </select>
        </label>
        <label className="field mt-3">
          <span className="field-label">为什么关注</span>
          <textarea
            className="field-textarea"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="记录评估背景、待验证的问题或下一步动作。"
          />
        </label>
        <label className="field mt-3">
          <span className="field-label">参考链接（可选）</span>
          <input
            className="field-input"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://…"
          />
        </label>
      </form>
    </Modal>
  );
}
