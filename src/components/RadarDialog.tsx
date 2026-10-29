import { useEffect, useState } from 'react';
import type { RadarItem, RadarKind } from '@shared/types';
import { api } from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { radarKindMeta } from '../lib/radar';
import { Modal } from './ui';

const kinds: Array<{ value: RadarKind; label: string; hint: string }> = [
  { value: 'tool', label: radarKindMeta.tool.label, hint: '正在评估或准备采用的新工具' },
  { value: 'tech', label: radarKindMeta.tech.label, hint: '值得跟进的技术方向或实践' },
  { value: 'learning', label: radarKindMeta.learning.label, hint: '计划阅读、实践或补齐的知识' },
];

export function RadarDialog({
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
    setBusy(false);
  }, [open, item]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('标题不能为空');
      return;
    }
    const trimmedUrl = url.trim();
    if (trimmedUrl && !/^https?:\/\//i.test(trimmedUrl)) {
      setError('参考链接需以 http:// 或 https:// 开头');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        title: title.trim(),
        summary: summary.trim(),
        kind,
        url: trimmedUrl || null,
      };
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
            maxLength={160}
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
            maxLength={1000}
          />
        </label>
        <label className="field mt-3">
          <span className="field-label">参考链接（可选）</span>
          <input
            className="field-input"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://…"
            maxLength={500}
          />
        </label>
      </form>
    </Modal>
  );
}
