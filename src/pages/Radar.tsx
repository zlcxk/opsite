import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  EyeOff,
  MessageSquarePlus,
  Pencil,
  Play,
  Plus,
  Radar as RadarIcon,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import type { RadarItem, RadarKind, RadarStatus } from '@shared/types';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { api } from '../lib/api';
import { useAppData } from '../contexts/AppDataContext';
import { useToast } from '../contexts/ToastContext';
import { formatDate } from '../lib/format';
import {
  radarKindMeta,
  radarPrimaryAction,
  radarRecordAction,
  radarRecordTypeMeta,
  radarStatusActions,
  radarStatusMeta,
} from '../lib/radar';
import { ActionMenu, EmptyState, Modal, PageHeader } from '../components/ui';
import { RadarDialog } from '../components/RadarDialog';

const kinds: RadarKind[] = ['tool', 'tech', 'learning'];
const statuses: RadarStatus[] = ['pending', 'trialing', 'adopted', 'deferred', 'ignored'];

type SortKey = 'updated' | 'created' | 'evaluated';
type RadarView = 'active' | 'archived';

function statusIcon(status: RadarStatus) {
  if (status === 'trialing') return Play;
  if (status === 'adopted') return CheckCircle2;
  if (status === 'deferred') return Clock3;
  if (status === 'ignored') return EyeOff;
  return RotateCcw;
}

export function Radar() {
  useDocumentTitle('技术雷达');
  const { data, loading, error, refetch } = useApi<RadarItem[]>('/radar?includeArchived=true');
  const { refresh } = useAppData();
  const { push } = useToast();
  const navigate = useNavigate();
  const [kindFilter, setKindFilter] = useState<RadarKind | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<RadarStatus | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('updated');
  const [view, setView] = useState<RadarView>('active');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<RadarItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<RadarItem | null>(null);
  const [archiving, setArchiving] = useState<RadarItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const items = data ?? [];
  const archivedCount = items.filter((item) => item.archivedAt).length;
  const scoped = useMemo(
    () => items.filter((item) => (view === 'archived' ? Boolean(item.archivedAt) : !item.archivedAt)),
    [items, view],
  );

  const typeCount = (kind: RadarKind) => scoped.filter((item) => item.kind === kind).length;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = scoped.filter((item) => {
      if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (!term) return true;
      return (
        item.title.toLowerCase().includes(term) ||
        item.summary.toLowerCase().includes(term) ||
        (item.url ?? '').toLowerCase().includes(term)
      );
    });
    return rows.slice().sort((a, b) => {
      if (sort === 'created') return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      if (sort === 'evaluated') {
        if (!a.lastEvaluatedAt && !b.lastEvaluatedAt) {
          return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
        }
        if (!a.lastEvaluatedAt) return 1;
        if (!b.lastEvaluatedAt) return -1;
        return Date.parse(b.lastEvaluatedAt) - Date.parse(a.lastEvaluatedAt);
      }
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
  }, [scoped, kindFilter, statusFilter, search, sort]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (item: RadarItem) => {
    setEditing(item);
    setDialogOpen(true);
  };

  const afterMutation = async () => {
    await Promise.all([refetch(true), refresh(true)]);
  };

  const changeStatus = async (item: RadarItem, status: RadarStatus) => {
    setBusyId(item.id);
    try {
      await api.patch(`/radar/${item.id}/status`, { status });
      push(`「${item.title}」已调整为${radarStatusMeta[status].label}`);
      await afterMutation();
    } catch (statusError) {
      push(statusError instanceof Error ? statusError.message : '状态更新失败', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const runPrimary = (item: RadarItem) => {
    const action = radarPrimaryAction(item.status);
    if (action.kind === 'record') {
      navigate(`/radar/${item.id}?record=${action.recordType}`);
      return;
    }
    void changeStatus(item, action.status);
  };

  const archive = async () => {
    if (!archiving) return;
    setBusyId(archiving.id);
    try {
      await api.post(`/radar/${archiving.id}/archive`);
      push('条目已归档，评估记录仍会保留');
      setArchiving(null);
      await afterMutation();
    } catch (archiveError) {
      push(archiveError instanceof Error ? archiveError.message : '归档失败', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const restore = async (item: RadarItem) => {
    setBusyId(item.id);
    try {
      await api.post(`/radar/${item.id}/restore`);
      push('条目已恢复到雷达列表');
      await afterMutation();
    } catch (restoreError) {
      push(restoreError instanceof Error ? restoreError.message : '恢复失败', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      await api.delete(`/radar/${deleting.id}`);
      push('雷达条目已永久删除');
      setDeleting(null);
      await afterMutation();
    } catch (deleteError) {
      push(deleteError instanceof Error ? deleteError.message : '删除失败', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const resetFilters = () => {
    setKindFilter('all');
    setStatusFilter('all');
    setSearch('');
  };

  const noActiveItems = !loading && view === 'active' && archivedCount > 0 && scoped.length === 0;
  const hasFilters = kindFilter !== 'all' || statusFilter !== 'all' || search.trim().length > 0;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Tech radar · assess, try, adopt"
        title="技术雷达"
        subtitle="记录你主动放进来的工具、技术与学习线索，并留下评估过程与下一步。"
        actions={
          <button className="btn btn-primary" onClick={openCreate}>
            <Plus size={14} /> 添加条目
          </button>
        }
      />

      {error && <div className="error-note mb-3">{error}</div>}

      {items.length > 0 && (
        <div className="filter-bar">
          <div className="filter-chips">
            <button
              className={`chip ${kindFilter === 'all' ? 'active' : ''}`}
              onClick={() => setKindFilter('all')}
            >
              全部 <span className="chip-count">{scoped.length}</span>
            </button>
            {kinds.map((kind) => (
              <button
                key={kind}
                className={`chip ${kindFilter === kind ? 'active' : ''}`}
                onClick={() => setKindFilter(kind)}
              >
                {radarKindMeta[kind].label}
                {typeCount(kind) > 0 && <span className="chip-count">{typeCount(kind)}</span>}
              </button>
            ))}
          </div>
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as RadarStatus | 'all')}
            aria-label="按状态筛选"
          >
            <option value="all">全部状态</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {radarStatusMeta[status].label}
              </option>
            ))}
          </select>
          <select
            className="filter-select"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            aria-label="排序方式"
          >
            <option value="updated">最近更新</option>
            <option value="created">最近加入</option>
            <option value="evaluated">最近评估</option>
          </select>
          <div className="filter-spacer" />
          <button
            className={`chip radar-archive-toggle ${view === 'archived' ? 'active' : ''}`}
            onClick={() => setView(view === 'archived' ? 'active' : 'archived')}
          >
            <Archive size={12} />
            归档
            {archivedCount > 0 && <span className="chip-count">{archivedCount}</span>}
          </button>
          <div className="inline-search">
            <Search size={12} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索标题、简介或关注原因"
              aria-label="搜索雷达条目"
            />
          </div>
        </div>
      )}

      {loading && !data ? (
        <div className="loading-block" style={{ minHeight: 260 }} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={RadarIcon}
          title="雷达是空的"
          description="把一个正在评估的工具、一项想跟进的技术，或一个学习主题放进来。"
          actions={
            <button className="btn btn-primary" onClick={openCreate}>
              <Plus size={13} /> 添加第一条
            </button>
          }
        />
      ) : noActiveItems ? (
        <EmptyState
          icon={Archive}
          title="当前没有进行中的条目"
          description={`只有 ${archivedCount} 条已归档条目。它们仍保留在数据库中，可以随时恢复。`}
          actions={
            <>
              <button className="btn btn-secondary" onClick={() => setView('archived')}>
                <Archive size={12} /> 查看归档
              </button>
              <button className="btn btn-primary" onClick={openCreate}>
                <Plus size={12} /> 添加条目
              </button>
            </>
          }
        />
      ) : view === 'archived' && scoped.length === 0 ? (
        <EmptyState
          icon={Archive}
          title="还没有归档条目"
          description="暂时不关注的条目可以归档，历史记录和评估过程都会保留。"
          actions={
            <button className="btn btn-secondary" onClick={() => setView('active')}>
              返回雷达
            </button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="没有符合条件的条目"
          description="调整类型、状态、关键词，或清除筛选后重新查看。"
          actions={
            <button className="btn btn-secondary" onClick={resetFilters}>
              清除筛选
            </button>
          }
        />
      ) : (
        <div className="radar-grid">
          {filtered.map((item) => {
            const status = radarStatusMeta[item.status];
            const primary = radarPrimaryAction(item.status);
            const recordAction = radarRecordAction(item.status);
            const latest = item.latestRecord;
            const busy = busyId === item.id;
            return (
              <article
                className={`radar-card clickable ${item.archivedAt ? 'archived' : ''}`}
                key={item.id}
                role="link"
                tabIndex={0}
                onClick={() => navigate(`/radar/${item.id}`)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(`/radar/${item.id}`);
                  }
                }}
              >
                <div className="radar-card-top">
                  <div className="radar-tags">
                    <span className="radar-kind">{radarKindMeta[item.kind].code}</span>
                    <span className={`pill pill-${status.className} radar-status-pill`}>{status.label}</span>
                    {item.archivedAt && <span className="pill pill-neutral radar-status-pill">已归档</span>}
                  </div>
                  <ActionMenu
                    items={[
                      ...(!item.archivedAt && recordAction
                        ? [
                            {
                              label: recordAction.label,
                              icon: MessageSquarePlus,
                              onClick: () =>
                                navigate(`/radar/${item.id}?record=${recordAction.recordType}`),
                            },
                          ]
                        : []),
                      ...(item.archivedAt
                        ? []
                        : radarStatusActions(item.status).map((action) => ({
                            label: action.label,
                            icon: statusIcon(action.status),
                            onClick: () => void changeStatus(item, action.status),
                          }))),
                      {
                        label: '编辑条目',
                        icon: Pencil,
                        separator: !item.archivedAt,
                        onClick: () => openEdit(item),
                      },
                      ...(item.archivedAt
                        ? [
                            {
                              label: '恢复到雷达',
                              icon: ArchiveRestore,
                              onClick: () => void restore(item),
                            },
                          ]
                        : [
                            {
                              label: '归档条目',
                              icon: Archive,
                              onClick: () => setArchiving(item),
                            },
                          ]),
                      {
                        label: '永久删除',
                        icon: Trash2,
                        danger: true,
                        separator: true,
                        onClick: () => setDeleting(item),
                      },
                    ]}
                  />
                </div>
                <h3>{item.title}</h3>
                <p>{item.summary || '暂无补充说明。'}</p>
                {latest && (
                  <div className="radar-card-record">
                    <span className="radar-record-type">{radarRecordTypeMeta[latest.recordType].short}</span>
                    <span className="radar-record-text">{latest.content}</span>
                  </div>
                )}
                {latest?.nextAction && (
                  <div className="radar-card-next">下一步 · {latest.nextAction}</div>
                )}
                <footer>
                  <span>{formatDate(item.createdAt)} 加入</span>
                  <div className="radar-card-links">
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-link"
                        onClick={(event) => event.stopPropagation()}
                      >
                        项目 <ArrowUpRight size={11} />
                      </a>
                    )}
                    {item.archivedAt ? (
                      <button
                        className="radar-quick"
                        disabled={busy}
                        onClick={(event) => {
                          event.stopPropagation();
                          void restore(item);
                        }}
                      >
                        {busy ? '处理中…' : '恢复'}
                      </button>
                    ) : (
                      <button
                        className="radar-quick"
                        disabled={busy}
                        onClick={(event) => {
                          event.stopPropagation();
                          runPrimary(item);
                        }}
                      >
                        {busy ? '处理中…' : primary.label}
                      </button>
                    )}
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      <RadarDialog
        open={dialogOpen}
        item={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={afterMutation}
      />

      <Modal
        open={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        eyebrow="Archive radar item"
        title={`归档「${archiving?.title ?? ''}」？`}
        description="归档后不会出现在默认列表，但条目、状态和全部评估记录都会保留。"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setArchiving(null)}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => void archive()} disabled={busyId === archiving?.id}>
              {busyId === archiving?.id ? '归档中…' : '归档'}
            </button>
          </>
        }
      >
        <div className="form-note">之后可以从「归档」视图恢复，状态和记录不会丢失。</div>
      </Modal>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        eyebrow="Delete radar item"
        title={`永久删除「${deleting?.title ?? ''}」？`}
        description="永久删除会连同这个条目的全部评估记录一起删除，无法恢复。"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setDeleting(null)}>
              取消
            </button>
            <button className="btn btn-danger" onClick={() => void remove()} disabled={busyId === deleting?.id}>
              {busyId === deleting?.id ? '删除中…' : '永久删除'}
            </button>
          </>
        }
      >
        <div className="form-note">如果只是暂时不关注，建议先归档，历史记录会完整保留。</div>
      </Modal>
    </div>
  );
}
