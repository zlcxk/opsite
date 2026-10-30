import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CircleAlert,
  Clock3,
  Database,
  Inbox,
  Loader2,
  RotateCcw,
  Timer,
} from 'lucide-react';
import type { CollectionRunDetailResponse } from '@shared/types';
import { api } from '../lib/api';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { formatDateTime } from '../lib/format';
import { formatDuration, runStatusMeta, runTriggerMeta } from '../lib/operations';
import { EmptyState, LoadingBlock, PageHeader } from '../components/ui';
import { useToast } from '../contexts/ToastContext';

const detailStatusMeta: Record<string, { label: string; className: string }> = {
  success: { label: '成功', className: 'pill-calm' },
  error: { label: '失败', className: 'pill-danger' },
  failed: { label: '失败', className: 'pill-danger' },
  running: { label: '执行中', className: 'pill-info' },
  skipped: { label: '已跳过', className: 'pill-neutral' },
};

export function OperationsRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { push } = useToast();
  const [pollMs, setPollMs] = useState(3000);
  const { data, loading, error, refetch } = useApi<CollectionRunDetailResponse>(
    id ? `/collection-runs/${id}` : null,
    pollMs,
  );
  const [retrying, setRetrying] = useState(false);

  const run = data?.run;
  useDocumentTitle(run ? `执行 ${run.taskName}` : '执行详情');

  useEffect(() => {
    setPollMs(data?.run.status === 'running' ? 3000 : 0);
  }, [data?.run.status]);

  if (loading && !data) {
    return (
      <div className="page">
        <PageHeader eyebrow="Operations · run" title="执行详情" />
        <LoadingBlock count={3} />
      </div>
    );
  }

  if (!data || !run) {
    return (
      <div className="page">
        <PageHeader eyebrow="Operations · run" title="执行详情" />
        <div className="error-note">{error ?? '执行记录不存在'}</div>
        <Link to="/operations" className="btn btn-ghost mt-4">
          <ArrowLeft size={13} /> 返回运行中心
        </Link>
      </div>
    );
  }

  const status = runStatusMeta[run.status];
  const canRetry = run.status === 'failed' || run.status === 'timeout';
  const finished = run.status !== 'running';

  const retry = async () => {
    setRetrying(true);
    try {
      const result = await api.post<{ run: { id: string } }>(`/collection-runs/${run.id}/retry`);
      push('已重新提交执行任务', 'success');
      navigate(`/operations/runs/${result.run.id}`);
    } catch (err) {
      push(err instanceof Error ? err.message : '重试失败', 'error');
      setRetrying(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operations · run"
        title={`${run.taskName} · 执行记录`}
        subtitle={
          <span className="ops-detail-sub">
            <span>{formatDateTime(run.startedAt)}</span>
            <span className="ops-detail-sep">·</span>
            <span className="ops-source-key">{run.id}</span>
          </span>
        }
        actions={
          <>
            <Link to={`/operations/tasks/${run.taskId}`} className="btn btn-ghost">
              <ArrowLeft size={13} /> 返回任务
            </Link>
            {finished && <button className="btn btn-ghost" onClick={() => void refetch(true)}>刷新</button>}
            {canRetry && (
              <button className="btn btn-primary" onClick={() => void retry()} disabled={retrying}>
                {retrying ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                重试
              </button>
            )}
          </>
        }
      />

      <div className="ops-detail-badges">
        <span className={`pill ${status.className}`}>{status.label}</span>
        <span className="pill pill-neutral">{runTriggerMeta[run.triggerType]}触发</span>
        <Link to={`/operations/sources/${run.sourceId}`} className="pill pill-info ops-pill-link">
          <Database size={11} /> {run.sourceName}
        </Link>
        {run.status === 'running' && (
          <span className="ops-run-muted">
            <Loader2 size={11} className="animate-spin" /> 页面每 3 秒刷新执行状态
          </span>
        )}
      </div>

      {run.errorMessage && (
        <div className="ops-callout danger">
          <CircleAlert size={14} />
          <div>
            <strong>{run.status === 'timeout' ? '执行超时' : '执行失败'}</strong>
            <p>{run.errorMessage}</p>
            {run.errorCode && <span>错误代码：{run.errorCode}</span>}
          </div>
        </div>
      )}

      <div className="stat-grid ops-stat-grid">
        <div className="stat-card">
          <div className="stat-label">
            <Inbox size={12} /> 获取条目
          </div>
          <div className="stat-value">{run.fetchedCount}</div>
          <div className="stat-foot">适配器本轮返回的记录数</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">新增</div>
          <div className="stat-value">{run.createdCount}</div>
          <div className="stat-foot">写入的新记录</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">更新</div>
          <div className="stat-value">{run.updatedCount}</div>
          <div className="stat-foot">字段实际发生变化的记录</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">跳过</div>
          <div className="stat-value">{run.skippedCount}</div>
          <div className="stat-foot">内容未变化或重复的记录</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <Timer size={12} /> 耗时
          </div>
          <div className="stat-value ops-stat-value-text">{formatDuration(run.durationMs)}</div>
          <div className="stat-foot">开始 {formatDateTime(run.startedAt)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <Clock3 size={12} /> 结束时间
          </div>
          <div className="stat-value ops-stat-value-text">{formatDateTime(run.finishedAt)}</div>
          <div className="stat-foot">{finished ? '任务已结束' : '任务仍在执行'}</div>
        </div>
      </div>

      <section className="panel mt-4">
        <div className="panel-head">
          <h3>明细记录</h3>
          <span className="section-count">{data.details.length}</span>
        </div>
        <div className="panel-body flush">
          {data.details.length === 0 ? (
            <div className="panel-body">
              <EmptyState
                compact
                icon={Inbox}
                title={run.status === 'running' ? '正在等待明细' : '没有明细记录'}
                description={
                  run.status === 'running'
                    ? '任务执行中，底层数据源作业完成后会写入明细。'
                    : '本次执行没有产生底层数据源作业记录。'
                }
              />
            </div>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>对象</th>
                    <th>状态</th>
                    <th>开始</th>
                    <th>结束</th>
                    <th>获取 / 新增 / 更新 / 跳过</th>
                    <th>错误</th>
                  </tr>
                </thead>
                <tbody>
                  {data.details.map((detail) => {
                    const meta = detailStatusMeta[detail.status] ?? {
                      label: detail.status,
                      className: 'pill-neutral',
                    };
                    return (
                      <tr key={detail.id}>
                        <td className="ops-cell-strong">{detail.label}</td>
                        <td>
                          <span className={`pill ${meta.className}`}>{meta.label}</span>
                        </td>
                        <td>{formatDateTime(detail.startedAt)}</td>
                        <td>{formatDateTime(detail.finishedAt)}</td>
                        <td>
                          {detail.itemsFound} / {detail.itemsNew} / {detail.itemsUpdated} /{' '}
                          {detail.itemsSkipped}
                        </td>
                        <td className="ops-cell-error">{detail.error ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="panel mt-4">
        <div className="panel-head">
          <h3>执行上下文</h3>
        </div>
        <div className="panel-body">
          <dl className="ops-kv">
            <div>
              <dt>任务</dt>
              <dd>
                <Link to={`/operations/tasks/${run.taskId}`} className="text-link">
                  {run.taskName}
                </Link>
                <span className="ops-run-muted">{run.taskKey}</span>
              </dd>
            </div>
            <div>
              <dt>数据源</dt>
              <dd>
                <Link to={`/operations/sources/${run.sourceId}`} className="text-link">
                  {run.sourceName}
                </Link>
                <span className="ops-run-muted">{run.sourceKey}</span>
              </dd>
            </div>
            <div>
              <dt>触发来源</dt>
              <dd>{runTriggerMeta[run.triggerType]}</dd>
            </div>
            <div>
              <dt>记录创建</dt>
              <dd>{formatDateTime(run.createdAt)}</dd>
            </div>
            <div>
              <dt>错误代码</dt>
              <dd>{run.errorCode ?? '—'}</dd>
            </div>
          </dl>
        </div>
      </section>
    </div>
  );
}
