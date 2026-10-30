import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Check,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';
import type { CatalogItem, CatalogSource, SourceConfig, SourceType, WatchLevel } from '@shared/types';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { useAppData } from '../contexts/AppDataContext';
import { useToast } from '../contexts/ToastContext';
import { categoryColor, sourceTypeLabel } from '../lib/format';
import { Logo } from './Logo';
import { Modal } from './ui';
import { SourceConfigFields, summarizeConfig } from './SourceConfigFields';

interface AddSoftwareDialogProps {
  open: boolean;
  onClose: () => void;
  initialCatalogKey?: string | null;
}

type Mode = 'catalog' | 'custom';

const watchLevels: Array<{ value: WatchLevel; label: string }> = [
  { value: 'critical', label: '重点盯防' },
  { value: 'high', label: '重点关注' },
  { value: 'normal', label: '常规关注' },
];

const customSourceOrder: SourceType[] = [
  'endoflife',
  'github_releases',
  'github_advisories',
  'nvd',
  'cisa_kev',
];

const sourceDescriptions: Record<string, string> = {
  endoflife: '发布周期、支持状态与维护截止日期',
  github_releases: '稳定版与预发布版本、发布说明',
  github_advisories: 'GitHub 开源安全公告',
  nvd: 'NVD 通用漏洞库，按关键词检索',
  cisa_kev: '标记已遭实际利用的 CVE',
};

interface SourceDraft {
  type: SourceType;
  label: string;
  enabled: boolean;
  config: SourceConfig;
}

export function AddSoftwareDialog({ open, onClose, initialCatalogKey }: AddSoftwareDialogProps) {
  const [mode, setMode] = useState<Mode>('catalog');
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [category, setCategory] = useState('全部');
  const [currentVersion, setCurrentVersion] = useState('');
  const [watchLevel, setWatchLevel] = useState<WatchLevel>('normal');
  const [environment, setEnvironment] = useState('');
  const [notes, setNotes] = useState('');
  const [drafts, setDrafts] = useState<SourceDraft[]>([]);
  const [custom, setCustom] = useState({
    name: '',
    category: '',
    website: '',
    repo: '',
    logoUrl: '',
    description: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: catalog, loading } = useApi<CatalogItem[]>(open ? '/catalog' : null);
  const { refresh } = useAppData();
  const { push } = useToast();
  const navigate = useNavigate();

  const categories = useMemo(
    () => ['全部', ...new Set((catalog ?? []).map((item) => item.category))],
    [catalog],
  );

  useEffect(() => {
    if (!open) return;
    setMode('catalog');
    setSelected(null);
    setCatalogSearch('');
    setCategory('全部');
    setCurrentVersion('');
    setWatchLevel('normal');
    setEnvironment('');
    setNotes('');
    setError(null);
    setCustom({ name: '', category: '', website: '', repo: '', logoUrl: '', description: '' });
    setDrafts([]);
  }, [open]);

  useEffect(() => {
    if (!open || !initialCatalogKey || !catalog) return;
    const found = catalog.find((item) => item.key === initialCatalogKey);
    if (found) {
      chooseCatalog(found);
    }
    // only respond when the dialog is opened with a suggestion
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialCatalogKey, catalog]);

  const filtered = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    return (catalog ?? []).filter((item) => {
      const categoryMatch = category === '全部' || item.category === category;
      const queryMatch =
        !query ||
        item.name.toLowerCase().includes(query) ||
        item.aliases.some((alias) => alias.toLowerCase().includes(query)) ||
        item.description.toLowerCase().includes(query);
      return categoryMatch && queryMatch;
    });
  }, [catalog, catalogSearch, category]);

  function chooseCatalog(item: CatalogItem) {
    setSelected(item);
    setWatchLevel(item.watchLevel);
    setCurrentVersion('');
    setEnvironment('');
    setNotes('');
    setDrafts(
      item.sources.map((source: CatalogSource) => ({
        type: source.type,
        label: source.label,
        enabled: source.enabled,
        config: { ...source.config },
      })),
    );
    setError(null);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setSelected(null);
    setError(null);
    if (next === 'custom') {
      setDrafts(
        customSourceOrder.map((type) => ({
          type,
          label: sourceTypeLabel(type),
          enabled: false,
          config: {},
        })),
      );
      setWatchLevel('normal');
    }
  }

  function updateDraft(index: number, patch: Partial<SourceDraft>) {
    setDrafts((prev) => prev.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)));
  }

  function validateSources(list: SourceDraft[]): string | null {
    const enabled = list.filter((source) => source.enabled);
    if (!enabled.length) return '至少启用一个情报数据源';
    for (const source of enabled) {
      if (source.type === 'endoflife' && !source.config.product?.trim()) {
        return '请填写 endoflife.date 产品标识';
      }
      if (source.type === 'github_releases' && !source.config.repo?.trim()) {
        return '请填写 GitHub 仓库（owner/repo）';
      }
      if (source.type === 'github_advisories' && !source.config.package?.trim()) {
        return '请填写 GitHub Advisory 软件包名称';
      }
      if (source.type === 'nvd' && !source.config.keyword?.trim()) {
        return '请填写 NVD 关键词';
      }
    }
    return null;
  }

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    setError(null);
    if (mode === 'custom' && !custom.name.trim()) {
      setError('请填写软件名称');
      return;
    }
    const sourceError = validateSources(drafts);
    if (sourceError) {
      setError(sourceError);
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        ...(mode === 'catalog' && selected
          ? {
              catalogKey: selected.key,
              name: selected.name,
              aliases: selected.aliases,
              category: selected.category,
              website: selected.website,
              repo: selected.repo,
              description: selected.description,
              logoUrl: selected.logoSlug ? `https://cdn.simpleicons.org/${selected.logoSlug}` : null,
            }
          : {
              name: custom.name.trim(),
              category: custom.category.trim() || '其他',
              website: custom.website.trim() || null,
              repo: custom.repo.trim() || null,
              logoUrl: custom.logoUrl.trim() || null,
              description: custom.description.trim() || null,
            }),
        currentVersion: currentVersion.trim() || null,
        watchLevel,
        environment: environment.trim() || null,
        notes: notes.trim() || null,
        sources: drafts
          .filter((source) => source.enabled)
          .map((source) => ({
            type: source.type,
            label: source.label,
            enabled: true,
            config: source.config,
          })),
      };
      const result = await api.post<{ id: string }>('/software', payload);
      await refresh(true);
      push(`${mode === 'catalog' ? selected?.name : custom.name} 已加入关注，正在首次采集`);
      onClose();
      navigate(`/software/${result.id}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '添加失败');
    } finally {
      setSubmitting(false);
    }
  }

  const footer = (
    <>
      <span className="mr-auto hidden text-[0.75rem] text-[var(--muted)] sm:block">
        保存后会立即触发一次后台采集
      </span>
      <button className="btn btn-ghost" type="button" onClick={onClose}>
        取消
      </button>
      {mode === 'catalog' && !selected ? (
        <span className="btn btn-secondary pointer-events-none opacity-60">
          选择目录项
        </span>
      ) : (
        <button className="btn btn-primary" type="submit" form="add-software-form" disabled={submitting}>
          {submitting ? '正在加入…' : '保存并开始采集'} <ArrowRight size={14} />
        </button>
      )}
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Add to watchlist"
      title={selected ? `关注 ${selected.name}` : '添加软件'}
      description="软件清单是全部情报的锚点。选择目录项，或为内部工具创建自定义条目。"
      footer={footer}
      wide
    >
      <div className="mb-4 flex items-center gap-2">
        <div className="segmented">
          <button type="button" className={mode === 'catalog' ? 'active' : ''} onClick={() => switchMode('catalog')}>
            从目录选择
          </button>
          <button type="button" className={mode === 'custom' ? 'active' : ''} onClick={() => switchMode('custom')}>
            自定义软件
          </button>
        </div>
        {mode === 'catalog' && selected && (
          <button
            type="button"
            className="btn btn-ghost btn-sm ml-auto"
            onClick={() => {
              setSelected(null);
              setError(null);
            }}
          >
            <ArrowLeft size={13} /> 重新选择
          </button>
        )}
      </div>

      {error && <div className="error-note mb-3">{error}</div>}

      {mode === 'catalog' && !selected && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-search" style={{ minWidth: 230 }}>
              <Search size={13} />
              <input
                autoFocus
                value={catalogSearch}
                onChange={(event) => setCatalogSearch(event.target.value)}
                placeholder="搜索 Kubernetes、PostgreSQL…"
              />
            </div>
            <div className="filter-chips">
              {categories.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`chip ${category === item ? 'active' : ''}`}
                  onClick={() => setCategory(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid max-h-[430px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {loading && !catalog ? (
              <div className="loading-block col-span-full" />
            ) : filtered.length === 0 ? (
              <div className="empty-state col-span-full">
                <Boxes size={18} className="mb-2 text-[var(--muted)]" />
                <h3>没有匹配的软件</h3>
                <p>可以切换到自定义软件，手动配置数据源。</p>
              </div>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-white p-3 text-left transition-all hover:border-[var(--line-strong)]"
                  onClick={() => chooseCatalog(item)}
                >
                  <Logo name={item.name} logoUrl={item.logoSlug ? `https://cdn.simpleicons.org/${item.logoSlug}` : null} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <strong className="truncate text-[0.90625rem] font-[560]">{item.name}</strong>
                      <span
                        className="category-dot"
                        style={{ background: categoryColor(item.category) }}
                      />
                    </span>
                    <span className="mt-0.5 block text-[0.6875rem] text-[var(--muted)]">{item.category}</span>
                    <span className="mt-1.5 line-clamp-2 block text-[0.71875rem] leading-relaxed text-[var(--muted)]">
                      {item.description}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-1">
                      {item.sources.slice(0, 3).map((source) => (
                        <span className="tag" key={source.type}>
                          {source.label}
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}

      {(mode === 'custom' || (mode === 'catalog' && selected)) && (
        <form id="add-software-form" onSubmit={submit}>
          {mode === 'custom' ? (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-[var(--line)] bg-white p-3">
              <span className="empty-mark" style={{ width: 38, height: 38, margin: 0 }}>
                <Sparkles size={15} />
              </span>
              <div>
                <div className="text-[0.875rem] font-[560]">为内部工具或缺少模板的软件创建条目</div>
                <p className="mt-1 text-[0.71875rem] leading-relaxed text-[var(--muted)]">
                  自定义软件不会自动获得生命周期或漏洞匹配能力，需要你提供可靠的数据源标识。
                </p>
              </div>
            </div>
          ) : (
            selected && (
              <div className="mb-4 flex items-center gap-3 rounded-xl border border-[var(--line)] bg-white p-3">
                <Logo name={selected.name} logoUrl={selected.logoSlug ? `https://cdn.simpleicons.org/${selected.logoSlug}` : null} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[1.125rem] font-[570] tracking-[-0.02em]">{selected.name}</div>
                  <div className="mt-1 text-[0.75rem] text-[var(--muted)]">
                    {selected.category}
                    {selected.repo ? ` · ${selected.repo.replace('https://github.com/', '')}` : ''}
                  </div>
                  <p className="mt-1.5 text-[0.71875rem] leading-relaxed text-[var(--muted)]">{selected.description}</p>
                </div>
              </div>
            )
          )}

          {mode === 'custom' && (
            <>
              <div className="field-row">
                <label className="field">
                  <span className="field-label">软件名称 *</span>
                  <input
                    className="field-input"
                    autoFocus
                    value={custom.name}
                    onChange={(event) => setCustom({ ...custom, name: event.target.value })}
                    placeholder="如 内部 Redis 代理"
                  />
                </label>
                <label className="field">
                  <span className="field-label">分类</span>
                  <input
                    className="field-input"
                    list="category-options"
                    value={custom.category}
                    onChange={(event) => setCustom({ ...custom, category: event.target.value })}
                    placeholder="如 数据库"
                  />
                  <datalist id="category-options">
                    {categories.filter((item) => item !== '全部').map((item) => (
                      <option key={item} value={item} />
                    ))}
                  </datalist>
                </label>
              </div>
              <div className="field-row mt-[13px]">
                <label className="field">
                  <span className="field-label">官方网站</span>
                  <input
                    className="field-input"
                    value={custom.website}
                    onChange={(event) => setCustom({ ...custom, website: event.target.value })}
                    placeholder="https://…"
                  />
                </label>
                <label className="field">
                  <span className="field-label">上游仓库</span>
                  <input
                    className="field-input"
                    value={custom.repo}
                    onChange={(event) => setCustom({ ...custom, repo: event.target.value })}
                    placeholder="https://github.com/owner/repo"
                  />
                </label>
              </div>
              <div className="field-row mt-[13px]">
                <label className="field">
                  <span className="field-label">Logo 地址（可选）</span>
                  <input
                    className="field-input"
                    value={custom.logoUrl}
                    onChange={(event) => setCustom({ ...custom, logoUrl: event.target.value })}
                    placeholder="https://…/logo.svg"
                  />
                </label>
                <label className="field">
                  <span className="field-label">当前使用版本</span>
                  <input
                    className="field-input"
                    value={currentVersion}
                    onChange={(event) => setCurrentVersion(event.target.value)}
                    placeholder="如 8.2.1，可稍后填写"
                  />
                </label>
              </div>
              <label className="field mt-[13px]">
                <span className="field-label">简介</span>
                <textarea
                  className="field-textarea"
                  style={{ minHeight: 58 }}
                  value={custom.description}
                  onChange={(event) => setCustom({ ...custom, description: event.target.value })}
                  placeholder="这个软件在你的环境中承担什么角色？"
                />
              </label>
            </>
          )}

          {mode === 'catalog' && (
            <div className="field-row">
              <label className="field">
                <span className="field-label">当前使用版本</span>
                <input
                  className="field-input"
                  autoFocus
                  value={currentVersion}
                  onChange={(event) => setCurrentVersion(event.target.value)}
                  placeholder="如 v1.32.4，可稍后填写"
                />
                <span className="field-hint">
                  未配置时页面会显示「待配置」，不会推断版本差异。
                </span>
              </label>
              <label className="field">
                <span className="field-label">使用环境 / 备注</span>
                <input
                  className="field-input"
                  value={environment}
                  onChange={(event) => setEnvironment(event.target.value)}
                  placeholder="如 生产集群 · 华东"
                />
              </label>
            </div>
          )}

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="field-label">关注级别</span>
              <span className="field-hint">影响首页排序与通知策略</span>
            </div>
            <div className="segmented w-full">
              {watchLevels.map((level) => (
                <button
                  key={level.value}
                  type="button"
                  className={`flex-1 ${watchLevel === level.value ? 'active' : ''}`}
                  onClick={() => setWatchLevel(level.value)}
                >
                  {level.label}
                </button>
              ))}
            </div>
          </div>

          {mode === 'custom' && (
            <label className="field mt-[13px]">
              <span className="field-label">使用环境 / 备注</span>
              <input
                className="field-input"
                value={environment}
                onChange={(event) => setEnvironment(event.target.value)}
                placeholder="如 生产集群 · 华东"
              />
            </label>
          )}

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="field-label">启用的情报类型</span>
              <span className="field-hint">{drafts.filter((source) => source.enabled).length} 个数据源</span>
            </div>
            <div className="flex flex-col gap-2">
              {drafts.map((draft, index) => (
                <div
                  className={`rounded-[10px] border p-3 transition-colors ${
                    draft.enabled ? 'border-[var(--line-strong)] bg-white' : 'border-[var(--line)] bg-[#f7f8f4] opacity-70'
                  }`}
                  key={draft.type}
                >
                  <label className="check-row cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(event) => updateDraft(index, { enabled: event.target.checked })}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <strong className="text-[0.84375rem] font-[550]">{draft.label}</strong>
                        <span className="tag">{draft.type}</span>
                        {draft.type === 'cisa_kev' && draft.enabled && (
                          <span className="pill pill-calm" style={{ height: 18, fontSize: '0.65625rem' }}>
                            <Check size={9} /> 建议开启
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-[0.6875rem] text-[var(--muted)]">
                        {sourceDescriptions[draft.type]}
                      </span>
                      {mode === 'catalog' && (
                        <span className="mt-1 block font-mono text-[0.65625rem] text-[var(--muted-2)]">
                          {summarizeConfig(draft.type, draft.config)}
                        </span>
                      )}
                    </span>
                  </label>
                  {mode === 'custom' && draft.enabled && (
                    <div className="mt-3 border-t border-[var(--line)] pt-3">
                      <SourceConfigFields
                        type={draft.type}
                        config={draft.config}
                        onChange={(config) => updateDraft(index, { config })}
                      />
                    </div>
                  )}
                </div>
              ))}
              {mode === 'catalog' && drafts.length === 0 && (
                <div className="empty-state" style={{ minHeight: 110 }}>
                  <Plus size={16} className="text-[var(--muted)]" />
                  <h3>该目录项暂无数据源</h3>
                  <p>添加后可在软件设置中补充数据源。</p>
                </div>
              )}
            </div>
          </div>

          <label className="field mt-[13px]">
            <span className="field-label">关注备注</span>
            <input
              className="field-input"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="如：生产环境短期无法升级，先跟踪安全公告"
            />
          </label>
        </form>
      )}
    </Modal>
  );
}
