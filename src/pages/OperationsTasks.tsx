import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowUpRight,
  CircleAlert,
  Clock3,
  Loader2,
  Pause,
  Play,
  PlayCircle,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { CollectionTask, CollectionTaskListResponse } from '@shared/types';
import { api } from '../lib/api';
import { useApi, useDebouncedValue, useDocumentTitle } from '../lib/hooks';
import { relativeTime } from '../lib/format';
import { formatDuration, formatPercent, runStatusMeta } from '../lib/operations';
import { EmptyState, LoadingBlock, PageHeader } from '../components/ui';
import { useToast } from '../contexts/ToastContext';

type TaskFilter = 'all' | 'enabled' | 'paused' | 'running' | 'failing' | 'never';

const filters: Array<{ value: TaskFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'enabled', label: '已启用' },
  { value: 'paused', label: '已暂停' },
  { value: 'running', label: '执行中' },
  { value: 'failing', label: '最近失败' },
  { value: 'never', label: '未执行' },
];

function matchesFilter(task: CollectionTask, filter: TaskFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'enabled') return task.enabled;
  if (filter === 'paused') return !task.enabled;
  if (filter === 'running') return task.lastStatus === 'running';
  if (filter === 'failing') return task.lastStatus === 'failed' || task.lastStatus === 'timeout';
  return task.lastStatus === 'never';
}

export function OperationsTasksPage() {
  useDocumentTitle('采集任务');
  const { push } = useToast();
  const { data, loading, error, refetch } = useApi<CollectionTaskListResponse>('/collection-tasks', 5000);
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [busy, setBusy] = useState<string | null>(null);

  if (loading && !data) {
    return (
      <div className="page">
        <PageHeader eyebrow="Operations · tasks" title="采集任务" />
        <LoadingBlock count={3} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <PageHeader eyebrow="Operations · tasks" title="采集任务" />
        <div className="error-note">{error ?? '无法加载采集任务'}</div>
      </div>
    );
  }

  const query = debouncedSearch.trim().toLowerCase();
  const items = data.items.filter(
    (task) =>
      matchesFilter(task, filter) &&
      (!query ||
        task.name.toLowerCase().includes(query) ||
        task.sourceName.toLowerCase().includes(query) ||
        task.taskKey.toLowerCase().includes(query)),
  );
  const enabled = data.items.filter((task) => task.enabled).length;
  const running = data.items.filter((task) => task.lastStatus === 'running').length;
  const failing = data.items.filter(
    (task) => task.lastStatus === 'failed' || task.lastStatus === 'timeout',
  ).length;

  const toggle = async (task: CollectionTask) => {
    setBusy(`toggle:${task.id}`);
    try {
      await api.patch(`/collection-tasks/${task.id}`, { enabled: !task.enabled });
      push(task.enabled ? `已暂停 ${task.name}` : `已启用 ${task.name}`, 'success');
      await refetch(true);
    } catch (err) {
      push(err instanceof Error ? err.message : '更新任务失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const run = async (task: CollectionTask) => {
    setBusy(`run:${task.id}`);
    try {
      await api.post(`/collection-tasks/${task.id}/run`);
      push(`已开始执行 ${task.name}`, 'success');
      await refetch(true);
    } catch (err) {
      push(err instanceof Error ? err.message : '无法启动任务', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operations · tasks"
        title="采集任务"
        subtitle="同一时间只允许一个采集任务执行。暂停只影响后续调度，不中断已经开始的任务，也不删除历史记录。"
        actions={
          <>
            <Link to="/operations" className="btn btn-ghost">
              <Activity size={13} /> 运行概览
            </Link>
            <Link to="/operations/sources" className="btn btn-ghost">
              数据源
            </Link>
          </>
        }
      />

      <div className={`ops-scheduler-banner ${data.schedulerEnabled ? '' : 'paused'}`}>
        <span className="ops-scheduler-icon">
          {data.schedulerEnabled ? <Activity size={17} /> : <Clock3 size={17} />}
        </span>
        <div className="ops-scheduler-main">
          <strong>{data.schedulerEnabled ? '调度器运行中' : '调度器已暂停'}</strong>
          <span>
            共 {data.items.length} 个任务，{enabled} 个启用
            {running > 0 ? `，${running} 个正在执行` : ''}
            {failing > 0 ? `，${failing} 个最近失败` : ''}。手动执行不会修改定时规则。
          </span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => void refetch(true)}>
          <RefreshCw size={12} /> 刷新
        </button>
      </div>

      <div className="filter-bar">
        <div className="filter-chips">
          {filters.map((option) => {
            const count = data.items.filter((task) => matchesFilter(task, option.value)).length;
            return (
              <button
                key={option.value}
                className={`chip ${filter === option.value ? 'active' : ''}`}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
                <span className="chip-count">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="filter-spacer" />
        <label className="inline-search">
          <Search size={13} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索任务或数据源"
            aria-label="搜索采集任务"
          />
        </label>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={PlayCircle}
          title="没有匹配的采集任务"
          description="任务会随服务启动自动注册。调整筛选条件后重试。"
          actions={
            <button
              className="btn btn-primary"
              onClick={() => {
                setFilter('all');
                setSearch('');
              }}
            >
              清除筛选
            </button>
          }
        />
      ) : (
        <div className="ops-task-grid">
          {items.map((task) => {
            const status = runStatusMeta[task.lastStatus === 'never' ? 'running' : task.lastStatus];
            return (
              <article key={task.id} className={`ops-task-card ${task.enabled ? '' : 'is-paused'}`}>
                <div className="ops-task-head">
                  <div className="ops-task-title">
                    <Link to={`/operations/tasks/${task.id}`}>{task.name}</Link>
                    <span>
                      {task.sourceName} · <code>{task.taskKey}</code>
                    </span>
                  </div>
                  <span className={`pill ${task.enabled ? 'pill-calm' : 'pill-neutral'}`}>
                    {task.enabled ? '已启用' : '已暂停'}
                  </span>
                </div>

                {task.description && <p className="ops-task-desc">{task.description}</p>}

                <div className="ops-task-facts">
                  <div>
                    <span>调度</span>
                    <code>{task.schedule}</code>
                  </div>
                  <div>
                    <span>下次执行</span>
                    <strong>{task.enabled ? relativeTime(task.nextRunAt) : '暂停中'}</strong>
                  </div>
                  <div>
                    <span>成功率</span>
                    <strong>{formatPercent(task.successRate)}</strong>
                  </div>
                  <div>
                    <span>平均耗时</span>
                    <strong>{formatDuration(task.avgDurationMs)}</strong>
                  </div>
                </div>

                <div className="ops-task-last">
                  {task.lastStatus === 'never' ? (
                    <span className="ops-run-muted">尚未执行过，等待首次调度或手动触发。</span>
                  ) : (
                    <>
                      <span className={`pill ${status.className}`}>{status.label}</span>
                      <span>{relativeTime(task.lastRunAt)}</span>
                      {task.lastRun && (
                        <span className="ops-run-muted">
                          +{task.lastRun.createdCount} / ~{task.lastRun.updatedCount}
                        </span>
                      )}
                    </>
                  )}
                  {task.timeoutSeconds > 0 && (
                    <span className="ops-run-muted ops-task-timeout">超时 {task.timeoutSeconds}s</span>
                  )}
                </div>

                {task.lastRun?.errorMessage && (
                  <div className="ops-source-error">
                    <CircleAlert size={12} />
                    <span>{task.lastRun.errorMessage}</span>
                  </div>
                )}

                <div className="ops-task-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void run(task)}
                    disabled={!task.enabled || busy !== null || task.lastStatus === 'running'}
                  >
                    {busy === `run:${task.id}` ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Play size={12} />
                    )}
                    {task.lastStatus === 'running' ? '执行中' : '手动执行'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void toggle(task)}
                    disabled={busy !== null}
                  >
                    {busy === `toggle:${task.id}` ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : task.enabled ? (
                      <Pause size={12} />
                    ) : (
                      <PlayCircle size={12} />
                    )}
                    {task.enabled ? '暂停' : '启用'}
                  </button>
                  <Link to={`/operations/tasks/${task.id}`} className="btn btn-ghost btn-sm">
                    详情 <ArrowUpRight size={12} />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
