import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { SoftwareSource, SoftwareSummary, SourceConfig, WatchLevel, WatchStatus } from '@shared/types';
import { api } from '../lib/api';
import { categoryColor, sourceTypeLabel } from '../lib/format';
import { useAppData } from '../contexts/AppDataContext';
import { useToast } from '../contexts/ToastContext';
import { Modal } from './ui';
import { SourceConfigFields, summarizeConfig } from './SourceConfigFields';
import { Logo } from './Logo';

interface EditSoftwareDialogProps {
  software: SoftwareSummary | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

const levels: Array<{ value: WatchLevel; label: string }> = [
  { value: 'critical', label: '重点盯防' },
  { value: 'high', label: '重点关注' },
  { value: 'normal', label: '常规关注' },
];

export function EditSoftwareDialog({ software, open, onClose, onUpdated }: EditSoftwareDialogProps) {
  const [form, setForm] = useState({
    name: '',
    category: '',
    currentVersion: '',
    environment: '',
    notes: '',
    aliases: '',
    website: '',
    repo: '',
    logoUrl: '',
    description: '',
    watchLevel: 'normal' as WatchLevel,
    watchStatus: 'active' as WatchStatus,
  });
  const [sources, setSources] = useState<SoftwareSource[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refresh } = useAppData();
  const { push } = useToast();

  useEffect(() => {
    if (!open || !software) return;
    setForm({
      name: software.name,
      category: software.category,
      currentVersion: software.currentVersion ?? '',
      environment: software.environment ?? '',
      notes: software.notes ?? '',
      aliases: software.aliases.join(', '),
      website: software.website ?? '',
      repo: software.repo ?? '',
      logoUrl: software.logoUrl ?? '',
      description: software.description ?? '',
      watchLevel: software.watchLevel,
      watchStatus: software.watchStatus,
    });
    setSources(software.sources.map((source) => ({ ...source, config: { ...source.config } })));
    setError(null);
  }, [open, software]);

  if (!software) return null;

  const target = software;

  const updateSource = (index: number, patch: Partial<SoftwareSource>) => {
    setSources((prev) => prev.map((source, position) => (position === index ? { ...source, ...patch } : source)));
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!form.name.trim()) {
      setError('软件名称不能为空');
      return;
    }
    for (const source of sources.filter((item) => item.enabled)) {
      if (source.type === 'endoflife' && !source.config.product?.trim()) {
        setError('endoflife.date 产品标识不能为空');
        return;
      }
      if (source.type === 'github_releases' && !source.config.repo?.trim()) {
        setError('GitHub 仓库不能为空');
        return;
      }
      if (source.type === 'github_advisories' && !source.config.package?.trim()) {
        setError('GitHub Advisory 软件包不能为空');
        return;
      }
      if (source.type === 'nvd' && !source.config.keyword?.trim()) {
        setError('NVD 关键词不能为空');
        return;
      }
    }
    const versionChanged = (target.currentVersion ?? '') !== form.currentVersion.trim();

    setSubmitting(true);
    try {
      await api.patch(`/software/${target.id}`, {
        name: form.name.trim(),
        category: form.category.trim() || '其他',
        currentVersion: form.currentVersion.trim() || null,
        environment: form.environment.trim() || null,
        notes: form.notes.trim() || null,
        aliases: form.aliases
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        website: form.website.trim() || null,
        repo: form.repo.trim() || null,
        logoUrl: form.logoUrl.trim() || null,
        description: form.description.trim() || null,
        watchLevel: form.watchLevel,
        watchStatus: form.watchStatus,
        sources: sources.map((source) => ({
          id: source.id,
          enabled: source.enabled,
          config: source.config,
        })),
      });
      await refresh(true);
      onUpdated?.();
      push(versionChanged ? '配置已保存，漏洞影响已按新版本重新计算' : '软件配置已保存');
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Edit watchlist item"
      title={`编辑 ${software.name}`}
      description="修改当前版本或数据源配置不会影响其他软件。"
      wide
      footer={
        <>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" type="submit" form="edit-software-form" disabled={submitting}>
            {submitting ? '保存中…' : '保存配置'}
          </button>
        </>
      }
    >
      <form id="edit-software-form" onSubmit={submit}>
        {error && <div className="error-note mb-3">{error}</div>}
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-[var(--line)] bg-white p-3">
          <Logo name={form.name || software.name} logoUrl={form.logoUrl || null} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-[570]">{form.name || software.name}</div>
            <div className="mt-1 flex items-center gap-2 text-[9.5px] text-[var(--muted)]">
              <span className="category-dot" style={{ background: categoryColor(form.category) }} />
              {form.category || '未分类'} · {sources.filter((source) => source.enabled).length} 个启用数据源
            </div>
          </div>
          <div className="segmented">
            <button
              type="button"
              className={form.watchStatus === 'active' ? 'active' : ''}
              onClick={() => setForm({ ...form, watchStatus: 'active' })}
            >
              关注中
            </button>
            <button
              type="button"
              className={form.watchStatus === 'paused' ? 'active' : ''}
              onClick={() => setForm({ ...form, watchStatus: 'paused' })}
            >
              暂停
            </button>
          </div>
        </div>

        <div className="field-row">
          <label className="field">
            <span className="field-label">软件名称</span>
            <input
              className="field-input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">分类</span>
            <input
              className="field-input"
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
            />
          </label>
        </div>

        <div className="field-row mt-[13px]">
          <label className="field">
            <span className="field-label">当前使用版本</span>
            <div className="relative">
              <input
                className="field-input pr-8"
                value={form.currentVersion}
                onChange={(event) => setForm({ ...form, currentVersion: event.target.value })}
                placeholder="留空显示待配置"
              />
              {form.currentVersion !== (software.currentVersion ?? '') && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--high)]" title="修改后会重新计算漏洞影响">
                  <AlertTriangle size={13} />
                </span>
              )}
            </div>
          </label>
          <label className="field">
            <span className="field-label">使用环境 / 备注</span>
            <input
              className="field-input"
              value={form.environment}
              onChange={(event) => setForm({ ...form, environment: event.target.value })}
              placeholder="如 生产集群"
            />
          </label>
        </div>

        <div className="field-row mt-[13px]">
          <label className="field">
            <span className="field-label">别名</span>
            <input
              className="field-input"
              value={form.aliases}
              onChange={(event) => setForm({ ...form, aliases: event.target.value })}
              placeholder="用逗号分隔"
            />
          </label>
          <label className="field">
            <span className="field-label">关注级别</span>
            <select
              className="field-input"
              value={form.watchLevel}
              onChange={(event) => setForm({ ...form, watchLevel: event.target.value as WatchLevel })}
            >
              {levels.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field-row mt-[13px]">
          <label className="field">
            <span className="field-label">官方网站</span>
            <input
              className="field-input"
              value={form.website}
              onChange={(event) => setForm({ ...form, website: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">上游仓库</span>
            <input
              className="field-input"
              value={form.repo}
              onChange={(event) => setForm({ ...form, repo: event.target.value })}
            />
          </label>
        </div>

        <label className="field mt-[13px]">
          <span className="field-label">Logo 地址</span>
          <input
            className="field-input"
            value={form.logoUrl}
            onChange={(event) => setForm({ ...form, logoUrl: event.target.value })}
            placeholder="https://…"
          />
        </label>

        <label className="field mt-[13px]">
          <span className="field-label">简介 / 关注备注</span>
          <textarea
            className="field-textarea"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </label>
        <label className="field mt-[13px]">
          <span className="field-label">个人备注</span>
          <input
            className="field-input"
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
            placeholder="如：暂不能升级，先跟踪安全修复"
          />
        </label>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="field-label">数据源</span>
            <span className="field-hint">关闭后保留历史数据，但不再参与常规采集</span>
          </div>
          <div className="flex flex-col gap-2">
            {sources.map((source, index) => (
              <div className="rounded-[10px] border border-[var(--line)] bg-[#fafbf8] p-3" key={source.id}>
                <div className="flex items-center gap-3">
                  <label className="check-row flex-1">
                    <input
                      type="checkbox"
                      checked={source.enabled}
                      onChange={(event) => updateSource(index, { enabled: event.target.checked })}
                    />
                    <span>
                      <strong className="block text-[11px] font-[550]">{source.label}</strong>
                      <span className="mt-0.5 block font-mono text-[8px] text-[var(--muted-2)]">
                        {sourceTypeLabel(source.type)} · {summarizeConfig(source.type, source.config)}
                      </span>
                    </span>
                  </label>
                  <span className={`pill ${source.lastStatus === 'error' ? 'pill-danger' : source.lastStatus === 'ok' ? 'pill-calm' : 'pill-neutral'}`} style={{ height: 19, fontSize: 8 }}>
                    {source.lastStatus === 'error' ? '采集异常' : source.lastStatus === 'ok' ? '正常' : '未同步'}
                  </span>
                </div>
                {source.enabled && (
                  <div className="mt-3 border-t border-[var(--line)] pt-3">
                    <SourceConfigFields
                      type={source.type}
                      config={source.config}
                      onChange={(config: SourceConfig) => updateSource(index, { config })}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {form.watchStatus === 'paused' && (
          <div className="form-note mt-3 flex items-start gap-2">
            <RefreshCw size={12} className="mt-0.5 flex-none" />
            暂停关注会停止定时采集和通知，但仍保留历史数据；你仍可在详情页手动触发同步。
          </div>
        )}
      </form>
    </Modal>
  );
}
