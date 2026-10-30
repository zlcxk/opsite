import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowUpRight,
  MessageSquarePlus,
  Pencil,
  Plus,
  Radar as RadarIcon,
} from 'lucide-react';
import type { RadarDetail as RadarDetailData, RadarRecord, RadarRecordType } from '@shared/types';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { api } from '../lib/api';
import { useAppData } from '../contexts/AppDataContext';
import { useToast } from '../contexts/ToastContext';
import { formatDate, formatDateTime } from '../lib/format';
import {
  radarKindMeta,
  radarPrimaryAction,
  radarRecordTypeMeta,
  radarRecordTypeOptions,
  radarStatusActions,
  radarStatusMeta,
} from '../lib/radar';
import { ActionMenu, EmptyState, LoadingBlock, Modal } from '../components/ui';
import { RadarDialog } from '../components/RadarDialog';
import { FollowButton } from '../components/FollowButton';

type RecordInputType = Exclude<RadarRecordType, 'status_change'>;

function isRecordInputType(value: string | null): value is RecordInputType {
  return value === 'evaluation' || value === 'trial' || value === 'adoption' || value === 'note';
}

export function RadarDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, loading, error, refetch } = useApi<RadarDetailData>(id ? `/radar/${id}` : null);
  const { refresh } = useAppData();
  const { push } = useToast();
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordType, setRecordType] = useState<RecordInputType>('evaluation');

  const item = data?.item;
  useDocumentTitle(item?.title ?? '雷达条目');

  useEffect(() => {
    const param = searchParams.get('record');
    if (!isRecordInputType(param)) return;
    setRecordType(param);
    setRecordOpen(true);
  }, [searchParams]);

  const nextAction = useMemo(
    () => (data?.records ?? []).find((record) => Boolean(record.nextAction)) ?? null,
    [data?.records],
  );

  const openRecord = (type: RecordInputType = 'evaluation') => {
    setRecordType(type);
    setRecordOpen(true);
  };

  const closeRecord = () => {
    setRecordOpen(false);
    const params = new URLSearchParams(searchParams);
    params.delete('record');
    setSearchParams(params, { replace: true });
  };

  const afterMutation = async () => {
    await Promise.all([refetch(true), refresh(true)]);
  };

  const updateStatus = async (status: keyof typeof radarStatusMeta) => {
    if (!item) return;
    setBusy(true);
    try {
      await api.patch(`/radar/${item.id}/status`, { status });
      push(`状态已调整为${radarStatusMeta[status].label}`);
      await afterMutation();
    } catch (statusError) {
      push(statusError instanceof Error ? statusError.message : '状态更新失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!item) return;
    setBusy(true);
    try {
      await api.post(`/radar/${item.id}/archive`);
      push('条目已归档，评估记录仍会保留');
      setArchiving(false);
      await afterMutation();
    } catch (archiveError) {
      push(archiveError instanceof Error ? archiveError.message : '归档失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!item) return;
    setBusy(true);
    try {
      await api.post(`/radar/${item.id}/restore`);
      push('条目已恢复到雷达列表');
      await afterMutation();
    } catch (restoreError) {
      push(restoreError instanceof Error ? restoreError.message : '恢复失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="page">
        <LoadingBlock />
        <div className="loading-block mt-4" style={{ minHeight: 320 }} />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="page">
        <EmptyState
          icon={RadarIcon}
          title="雷达条目不存在"
          description={error || '它可能已被永久删除。归档条目仍可在雷达的归档视图中找到。'}
          actions={
            <Link to="/radar" className="btn btn-secondary">
              返回技术雷达
            </Link>
          }
        />
      </div>
    );
  }

  const status = radarStatusMeta[item.status];
  const primary = radarPrimaryAction(item.status);
  const sortedRecords = data?.records ?? [];

  return (
    <div className="page">
      <button className="mb-3 inline-flex items-center gap-1.5 text-[0.71875rem] text-[var(--muted)] hover:text-[var(--ink)]" onClick={() => navigate('/radar')}>
        <ArrowLeft size={12} /> 返回技术雷达
      </button>

      {error && <div className="error-note mb-3">{error}</div>}

      <header className="detail-head">
        <div className="detail-title">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="eyebrow no-rule">{radarKindMeta[item.kind].label}</span>
            <span className={`pill pill-${status.className}`} style={{ height: 19, fontSize: '0.65625rem' }}>
              {status.label}
            </span>
            {item.archivedAt && (
              <span className="pill pill-neutral" style={{ height: 19, fontSize: '0.65625rem' }}>
                已归档
              </span>
            )}
          </div>
          <h1>{item.title}</h1>
          <div className="detail-sub">
            <span>{formatDate(item.createdAt)} 加入</span>
            <span>最近更新 {formatDateTime(item.updatedAt)}</span>
            <span>最近评估 {item.lastEvaluatedAt ? formatDateTime(item.lastEvaluatedAt) : '尚未评估'}</span>
            {item.url && (
              <a href={item.url} target="_blank" rel="noreferrer" className="text-link">
                项目链接 <ArrowUpRight size={10} />
              </a>
            )}
          </div>
          <p className="radar-detail-summary">{item.summary || '还没有记录关注原因。'}</p>
        </div>

        <div className="detail-actions">
          <FollowButton targetType="radar" targetId={item.id} />
          {!item.archivedAt && (
            <button className="btn btn-primary" onClick={() => openRecord()}>
              <Plus size={13} /> 添加记录
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => setEditing(true)}>
            <Pencil size={13} /> 编辑
          </button>
          {item.archivedAt ? (
            <button className="btn btn-secondary" onClick={() => void restore()} disabled={busy}>
              <ArchiveRestore size={13} /> {busy ? '恢复中…' : '恢复条目'}
            </button>
          ) : (
            <ActionMenu
              trigger={
                <span className="btn btn-secondary" style={{ width: 34, padding: 0 }} aria-label="更多操作">
                  ⋯
                </span>
              }
              items={[
                ...radarStatusActions(item.status).map((action) => ({
                  label: action.label,
                  onClick: () => void updateStatus(action.status),
                })),
                {
                  label: '归档条目',
                  icon: Archive,
                  danger: true,
                  separator: true,
                  onClick: () => setArchiving(true),
                },
              ]}
            />
          )}
        </div>
      </header>

      <div className="detail-grid">
        <div className="flex flex-col gap-3.5">
          <section className="panel">
            <div className="panel-head">
              <h3>评估记录</h3>
              <span className="radar-panel-meta">{sortedRecords.length} 条 · 按时间倒序</span>
            </div>
            <div className="panel-body flush">
              {sortedRecords.length ? (
                <div className="radar-timeline">
                  {sortedRecords.map((record) => (
                    <RecordRow key={record.id} record={record} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  compact
                  icon={MessageSquarePlus}
                  title="还没有评估记录"
                  description={
                    item.archivedAt
                      ? '恢复条目后可以继续记录评估和试用过程。'
                      : '第一次试用、判断或踩坑都值得记下来，未来回看时更有依据。'
                  }
                  actions={
                    !item.archivedAt && (
                      <button className="btn btn-secondary btn-sm" onClick={() => openRecord()}>
                        <Plus size={12} /> 添加第一条记录
                      </button>
                    )
                  }
                />
              )}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-3.5">
          <section className="panel">
            <div className="panel-head">
              <h3>基本信息</h3>
            </div>
            <div className="panel-body">
              <div className="radar-info-list">
                <div className="radar-info-row">
                  <span>类型</span>
                  <strong>{radarKindMeta[item.kind].label}</strong>
                </div>
                <div className="radar-info-row">
                  <span>状态</span>
                  <strong>{status.label}</strong>
                </div>
                <div className="radar-info-row">
                  <span>加入时间</span>
                  <strong>{formatDateTime(item.createdAt)}</strong>
                </div>
                <div className="radar-info-row">
                  <span>最近更新</span>
                  <strong>{formatDateTime(item.updatedAt)}</strong>
                </div>
                <div className="radar-info-row">
                  <span>最近评估</span>
                  <strong>{item.lastEvaluatedAt ? formatDateTime(item.lastEvaluatedAt) : '尚未评估'}</strong>
                </div>
                <div className="radar-info-row">
                  <span>参考链接</span>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer" className="text-link">
                      打开 <ArrowUpRight size={10} />
                    </a>
                  ) : (
                    <strong className="muted">未填写</strong>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>后续计划</h3>
              {!item.archivedAt && (
                <button className="text-link" onClick={() => openRecord()}>
                  添加记录 <Plus size={10} />
                </button>
              )}
            </div>
            <div className="panel-body">
              {nextAction ? (
                <div className="radar-next-block">
                  <span className="radar-next-label">下一步</span>
                  <p>{nextAction.nextAction}</p>
                  <span className="radar-next-source">
                    来自 {radarRecordTypeMeta[nextAction.recordType].label} · {formatDateTime(nextAction.createdAt)}
                  </span>
                </div>
              ) : (
                <p className="radar-empty-hint">
                  还没有下一步行动。新增记录时可以顺手写下要验证或跟进的事。
                </p>
              )}
            </div>
          </section>

          {!item.archivedAt && (
            <div className="form-note flex items-start gap-2">
              <RadarIcon size={12} className="mt-0.5 flex-none" />
              {primary.kind === 'record'
                ? `主要动作：${primary.label}。也可以继续记录评估和备注。`
                : `主要动作：${primary.label}。状态与评估记录分开保存。`}
            </div>
          )}
        </div>
      </div>

      <RadarDialog
        open={editing}
        item={item}
        onClose={() => setEditing(false)}
        onSaved={afterMutation}
      />

      <RadarRecordDialog
        open={recordOpen}
        defaultType={recordType}
        itemId={item.id}
        onClose={closeRecord}
        onSaved={async () => {
          await afterMutation();
          closeRecord();
        }}
      />

      <Modal
        open={archiving}
        onClose={() => setArchiving(false)}
        eyebrow="Archive radar item"
        title={`归档「${item.title}」？`}
        description="归档后不会出现在默认列表，但条目、状态和全部评估记录都会保留。"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setArchiving(false)}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => void archive()} disabled={busy}>
              {busy ? '归档中…' : '归档'}
            </button>
          </>
        }
      >
        <div className="form-note">之后可以从雷达的归档视图恢复，历史不会丢失。</div>
      </Modal>
    </div>
  );
}

function RecordRow({ record }: { record: RadarRecord }) {
  const meta = radarRecordTypeMeta[record.recordType];
  const system = record.recordType === 'status_change';
  return (
    <article className={`radar-record-item ${system ? 'system' : ''}`}>
      <div className="radar-record-head">
        <span className="radar-record-badge">{meta.label}</span>
        <time className="radar-record-time">{formatDateTime(record.createdAt)}</time>
      </div>
      <p className="radar-record-body">{record.content}</p>
      {record.nextAction && (
        <div className="radar-record-next">
          <span>下一步</span>
          {record.nextAction}
        </div>
      )}
    </article>
  );
}

function RadarRecordDialog({
  open,
  defaultType,
  itemId,
  onClose,
  onSaved,
}: {
  open: boolean;
  defaultType: RecordInputType;
  itemId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [recordType, setRecordType] = useState<RecordInputType>(defaultType);
  const [content, setContent] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { push } = useToast();

  useEffect(() => {
    if (!open) return;
    setRecordType(defaultType);
    setContent('');
    setNextAction('');
    setError(null);
    setBusy(false);
  }, [open, defaultType]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!content.trim()) {
      setError('记录内容不能为空');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/radar/${itemId}/records`, {
        recordType,
        content: content.trim(),
        nextAction: nextAction.trim() || null,
      });
      push('评估记录已保存');
      await onSaved();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '保存失败，请保留内容后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="New evaluation record"
      title="添加评估记录"
      description="记录这一轮判断、试用结果或备注；下一步行动可以留空。"
      footer={
        <>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" type="submit" form="radar-record-form" disabled={busy}>
            {busy ? '保存中…' : '保存记录'}
          </button>
        </>
      }
    >
      <form id="radar-record-form" onSubmit={submit}>
        {error && <div className="error-note mb-3">{error}</div>}
        <label className="field">
          <span className="field-label">记录类型</span>
          <select
            className="field-input"
            value={recordType}
            onChange={(event) => setRecordType(event.target.value as RecordInputType)}
          >
            {radarRecordTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field mt-3">
          <span className="field-label">记录内容</span>
          <textarea
            className="field-textarea"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="如：在本地 Kubernetes 测试环境验证多环境配置管理，当前满足需求，但文档仍不完整。"
            autoFocus
            maxLength={5000}
          />
        </label>
        <label className="field mt-3">
          <span className="field-label">下一步行动（可选）</span>
          <input
            className="field-input"
            value={nextAction}
            onChange={(event) => setNextAction(event.target.value)}
            placeholder="如：评估现有部署仓库是否适合迁移。"
            maxLength={1000}
          />
        </label>
      </form>
    </Modal>
  );
}
