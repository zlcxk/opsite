import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  Boxes,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type { SoftwareSummary } from '@shared/types';
import { useAppData } from '../contexts/AppDataContext';
import { useToast } from '../contexts/ToastContext';
import { api } from '../lib/api';
import { hasUpdate } from '../lib/version';
import {
  categoryColor,
  eolLabel,
  relativeTime,
  supportMeta,
  watchLevelMeta,
} from '../lib/format';
import { AddSoftwareDialog } from '../components/AddSoftwareDialog';
import { EditSoftwareDialog } from '../components/EditSoftwareDialog';
import { Logo } from '../components/Logo';
import { ActionMenu, EmptyState, Modal, PageHeader } from '../components/ui';
import { useDocumentTitle } from '../lib/hooks';

type StatusFilter = 'all' | 'active' | 'paused';

export function SoftwareList() {
  useDocumentTitle('软件清单');
  const navigate = useNavigate();
  const { data, loading, refresh } = useAppData();
  const { push } = useToast();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [category, setCategory] = useState('all');
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<SoftwareSummary | null>(null);
  const [archiving, setArchiving] = useState<SoftwareSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const software = data?.software ?? [];
  const categories = useMemo(
    () => [...new Set(software.map((item) => item.category))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [software],
  );

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return software.filter((item) => {
      if (status !== 'all' && item.watchStatus !== status) return false;
      if (category !== 'all' && item.category !== category) return false;
      if (!search) return true;
      return (
        item.name.toLowerCase().includes(search) ||
        item.aliases.some((alias) => alias.toLowerCase().includes(search)) ||
        (item.environment ?? '').toLowerCase().includes(search) ||
        (item.notes ?? '').toLowerCase().includes(search)
      );
    });
  }, [software, query, status, category]);

  const counts = useMemo(
    () => ({
      all: software.length,
      active: software.filter((item) => item.watchStatus === 'active').length,
      paused: software.filter((item) => item.watchStatus === 'paused').length,
      issues: software.filter((item) => item.sourceIssueCount > 0).length,
      vulnerable: software.filter((item) => item.counts.openVulns > 0).length,
      updates: software.filter((item) => hasUpdate(item.currentVersion, item.latestVersion)).length,
    }),
    [software],
  );

  const patch = async (item: SoftwareSummary, body: Record<string, unknown>, message: string) => {
    try {
      await api.patch(`/software/${item.id}`, body);
      await refresh(true);
      push(message);
    } catch (error) {
      push(error instanceof Error ? error.message : '操作失败', 'error');
    }
  };

  const sync = async (item: SoftwareSummary) => {
    setBusyId(item.id);
    try {
      const result = await api.post<{ jobs: Array<{ status: string; error: string | null }> }>(
        `/software/${item.id}/sync`,
      );
      const failed = result.jobs?.find((job) => job.status === 'error');
      push(failed ? `${item.name} 部分数据源失败` : `${item.name} 采集完成`, failed ? 'error' : 'success');
      await refresh(true);
    } catch (error) {
      push(error instanceof Error ? error.message : '同步失败', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const archive = async () => {
    if (!archiving) return;
    try {
      await api.delete(`/software/${archiving.id}`);
      push(`${archiving.name} 已归档，历史数据保留`);
      setArchiving(null);
      await refresh(true);
    } catch (error) {
      push(error instanceof Error ? error.message : '归档失败', 'error');
    }
  };

  const statusTabs: Array<[StatusFilter, string, number]> = [
    ['all', '全部', counts.all],
    ['active', '关注中', counts.active],
    ['paused', '已暂停', counts.paused],
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Watchlist · single source of identity"
        title="软件清单"
        subtitle="每个软件只维护一份身份标识与当前版本，发布、生命周期和漏洞统一关联到它。"
        actions={
          <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
            <Plus size={14} /> 添加软件
          </button>
        }
      />

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">
            <Boxes size={10} /> 关注软件
          </span>
          <span className="stat-value">{counts.all}</span>
          <div className="stat-foot">{counts.active} 个正在采集 · {counts.paused} 个暂停</div>
        </div>
        <div className="stat-card">
          <span className="stat-label">
            <ShieldAlert size={10} /> 存在未处理漏洞
          </span>
          <span className="stat-value">{counts.vulnerable}</span>
          <div className="stat-foot">安全状态按确认影响程度计算</div>
        </div>
        <div className="stat-card">
          <span className="stat-label">可升级</span>
          <span className="stat-value">{counts.updates}</span>
          <div className="stat-foot">Latest 领先当前版本</div>
        </div>
        <div className="stat-card">
          <span className="stat-label">数据源异常</span>
          <span className="stat-value">{counts.issues}</span>
          <div className="stat-foot">最近一次采集失败或数据已过期</div>
        </div>
      </div>

      <div className="filter-bar mt-5">
        <div className="filter-chips">
          {statusTabs.map(([value, label, count]) => (
            <button
              key={value}
              className={`chip ${status === value ? 'active' : ''}`}
              onClick={() => setStatus(value)}
            >
              {label}
              {count > 0 && <span className="chip-count">{count}</span>}
            </button>
          ))}
        </div>
        <div className="filter-spacer" />
        <div className="inline-search">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索名称、环境、备注"
            aria-label="搜索软件"
          />
        </div>
        <select
          className="filter-select"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          aria-label="按分类筛选"
        >
          <option value="all">全部分类</option>
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      {loading && !data ? (
        <div className="loading-block" style={{ minHeight: 300 }} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={software.length ? '没有符合条件的软件' : '清单还是空的'}
          description={
            software.length
              ? '换一个关键词或分类。每个软件都可以单独配置关注级别和数据源。'
              : '从软件目录选择，或添加自定义软件并配置至少一个数据源。'
          }
          actions={
            <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
              <Plus size={13} /> 添加软件
            </button>
          }
        />
      ) : (
        <div className="data-list software-table">
          <div className="software-table-head" aria-hidden="true">
            <span>Software</span>
            <span>Version</span>
            <span>Security</span>
            <span>Lifecycle</span>
            <span>Sources</span>
            <span>Last sync</span>
            <span />
          </div>
          {filtered.map((item) => {
            const updateAvailable = hasUpdate(item.currentVersion, item.latestVersion);
            const lifecycle = supportMeta[item.lifecycle.status];
            const enabledSources = item.sources.filter((source) => source.enabled).length;
            return (
              <div
                className="software-table-row"
                key={item.id}
                onClick={() => navigate(`/software/${item.id}`)}
                role="link"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') navigate(`/software/${item.id}`);
                }}
              >
                <div className="software-cell-identity">
                  <Logo name={item.name} logoUrl={item.logoUrl} size="sm" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <strong>{item.name}</strong>
                      {item.pinned && <Pin size={10} className="shrink-0 text-[var(--signal)]" />}
                      {item.watchStatus === 'paused' && (
                        <span className="pill pill-neutral" style={{ height: 16, fontSize: '0.65625rem' }}>暂停</span>
                      )}
                    </div>
                    <span>
                      <i className="category-dot" style={{ background: categoryColor(item.category) }} />
                      {item.category}
                      {item.environment ? ` · ${item.environment}` : ''}
                      {item.watchLevel !== 'normal' && (
                        <em className={`soft-level ${watchLevelMeta[item.watchLevel].className}`}>
                          {watchLevelMeta[item.watchLevel].label}
                        </em>
                      )}
                    </span>
                  </div>
                </div>

                <div className="software-cell-version">
                  <strong>{item.currentVersion ?? '待配置'}</strong>
                  <span>
                    {item.latestVersion ?? '未采集'}
                    {updateAvailable && <i className="update-pill">可更新</i>}
                  </span>
                </div>

                <button
                  className="software-cell-metric"
                  onClick={(event) => {
                    event.stopPropagation();
                    navigate(`/software/${item.id}?tab=vulnerabilities`);
                  }}
                >
                  {item.counts.openVulns === 0 ? (
                    <span className="inline-flex items-center gap-1 text-[var(--calm)]">
                      <ShieldCheck size={11} /> 无待处理
                    </span>
                  ) : (
                    <>
                      <strong className={item.counts.affectedVulns ? 'danger' : 'warn'}>
                        {item.counts.openVulns} 项
                      </strong>
                      <span>{item.counts.affectedVulns ? `确认 ${item.counts.affectedVulns}` : '待核实'}</span>
                    </>
                  )}
                </button>

                <button
                  className="software-cell-metric"
                  onClick={(event) => {
                    event.stopPropagation();
                    navigate(`/software/${item.id}?tab=lifecycle`);
                  }}
                >
                  <span className={`soft-support ${lifecycle.className}`}>{lifecycle.label}</span>
                  <span>
                    {item.lifecycle.eolDate
                      ? item.lifecycle.status === 'eol' || item.lifecycle.status === 'approaching_eol'
                        ? eolLabel(item.lifecycle.eolDate)
                        : `EOL ${item.lifecycle.eolDate}`
                      : '尚无可靠日期'}
                  </span>
                </button>

                <button
                  className="software-cell-metric"
                  onClick={(event) => {
                    event.stopPropagation();
                    navigate(`/software/${item.id}?tab=sources`);
                  }}
                >
                  <strong className={item.sourceIssueCount ? 'warn' : ''}>
                    {item.sourceIssueCount ? `${item.sourceIssueCount} 个异常` : '正常'}
                  </strong>
                  <span>{enabledSources} 个启用数据源</span>
                </button>

                <div className="software-cell-sync">
                  <span>{relativeTime(item.lastSyncAt)}</span>
                  <span className="mono-cell">{item.sources.length} src</span>
                </div>

                <ActionMenu
                  items={[
                    { label: '编辑配置', icon: Pencil, onClick: () => setEditing(item) },
                    {
                      label: busyId === item.id ? '正在同步…' : '立即同步',
                      icon: RefreshCw,
                      onClick: () => void sync(item),
                    },
                    {
                      label: item.watchStatus === 'paused' ? '恢复关注' : '暂停关注',
                      icon: item.watchStatus === 'paused' ? Play : Pause,
                      onClick: () =>
                        void patch(
                          item,
                          { watchStatus: item.watchStatus === 'paused' ? 'active' : 'paused' },
                          item.watchStatus === 'paused' ? '已恢复关注' : '已暂停关注，历史保留',
                        ),
                    },
                    {
                      label: item.pinned ? '取消置顶' : '置顶到首页',
                      icon: item.pinned ? PinOff : Pin,
                      onClick: () => void patch(item, { pinned: !item.pinned }, item.pinned ? '已取消置顶' : '已置顶'),
                    },
                    { label: '归档软件', icon: Archive, danger: true, separator: true, onClick: () => setArchiving(item) },
                  ]}
                />
              </div>
            );
          })}
        </div>
      )}

      <AddSoftwareDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <EditSoftwareDialog
        software={editing}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        onUpdated={() => void refresh(true)}
      />
      <Modal
        open={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        eyebrow="Archive software"
        title={`归档 ${archiving?.name ?? ''}？`}
        description="归档后不再出现在首页和清单里，但发布、生命周期、漏洞和采集日志都会保留。"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setArchiving(null)}>
              取消
            </button>
            <button className="btn btn-danger" onClick={() => void archive()}>
              确认归档
            </button>
          </>
        }
      >
        <div className="form-note">
          归档不会删除数据库记录。当前没有界面入口恢复已归档软件，请确认不再需要持续关注。
        </div>
      </Modal>
    </div>
  );
}
