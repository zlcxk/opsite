import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  Clock3,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Play,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import type { SoftwareSummary } from '@shared/types';
import { api } from '../lib/api';
import { hasUpdate } from '../lib/version';
import {
  categoryColor,
  eolLabel,
  priorityMeta,
  relativeTime,
  supportMeta,
} from '../lib/format';
import { useAppData } from '../contexts/AppDataContext';
import { useToast } from '../contexts/ToastContext';
import { Logo } from './Logo';
import { ActionMenu, Modal } from './ui';

interface SoftwareCardProps {
  software: SoftwareSummary;
  onEdit: (software: SoftwareSummary) => void;
}

export function SoftwareCard({ software, onEdit }: SoftwareCardProps) {
  const navigate = useNavigate();
  const { refresh } = useAppData();
  const { push } = useToast();
  const [syncing, setSyncing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const updateAvailable = hasUpdate(software.currentVersion, software.latestVersion);
  const lifecycle = supportMeta[software.lifecycle.status];
  const securityState =
    software.counts.affectedVulns > 0
      ? 'critical'
      : software.counts.openVulns > 0
        ? 'warn'
        : 'muted';
  const lifecycleState =
    software.lifecycle.status === 'eol'
      ? 'critical'
      : software.lifecycle.status === 'approaching_eol'
        ? 'warn'
        : software.lifecycle.status === 'supported'
          ? 'calm'
          : 'muted';

  const openDetail = (tab?: string) => {
    navigate(`/software/${software.id}${tab ? `?tab=${tab}` : ''}`);
  };

  const handleCardClick = (event: React.MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input, [data-no-nav]')) return;
    openDetail();
  };

  const sync = async () => {
    setSyncing(true);
    push(`正在采集 ${software.name}…`, 'info');
    try {
      const result = await api.post<{ ok: boolean; jobs: Array<{ status: string; error: string | null }> }>(
        `/software/${software.id}/sync`,
      );
      const failed = result.jobs?.find((job) => job.status === 'error');
      push(
        failed ? `${software.name} 部分数据源采集失败：${failed.error ?? '未知错误'}` : `${software.name} 采集完成`,
        failed ? 'error' : 'success',
      );
      await refresh(true);
    } catch (error) {
      push(error instanceof Error ? error.message : '同步失败', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const togglePause = async () => {
    const next = software.watchStatus === 'paused' ? 'active' : 'paused';
    try {
      await api.patch(`/software/${software.id}`, { watchStatus: next });
      await refresh(true);
      push(next === 'paused' ? '已暂停关注，历史数据保留' : '已恢复关注');
    } catch (error) {
      push(error instanceof Error ? error.message : '操作失败', 'error');
    }
  };

  const togglePin = async () => {
    try {
      await api.patch(`/software/${software.id}`, { pinned: !software.pinned });
      await refresh(true);
    } catch (error) {
      push(error instanceof Error ? error.message : '操作失败', 'error');
    }
  };

  const archive = async () => {
    setArchiving(true);
    try {
      await api.delete(`/software/${software.id}`);
      await refresh(true);
      push(`${software.name} 已归档，历史数据仍保留`);
      setConfirmArchive(false);
    } catch (error) {
      push(error instanceof Error ? error.message : '归档失败', 'error');
    } finally {
      setArchiving(false);
    }
  };

  return (
    <>
      <article
        className="software-card"
        onClick={handleCardClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.target === event.currentTarget) openDetail();
        }}
        tabIndex={0}
        role="link"
        aria-label={`查看 ${software.name} 详情`}
      >
        <div className="signal-rail" aria-hidden="true">
          <span className={`security ${securityState}`} />
          <span className={`lifecycle ${lifecycleState}`} />
          <span className={`update ${updateAvailable ? 'info' : 'muted'}`} />
        </div>

        <div className="sw-head">
          <Logo name={software.name} logoUrl={software.logoUrl} />
          <div className="sw-title-wrap">
            <h3 className="sw-title">{software.name}</h3>
            <div className="sw-category">
              <span className="category-dot" style={{ background: categoryColor(software.category) }} />
              <span>{software.category}</span>
              {software.environment && <span className="faint">· {software.environment}</span>}
              {software.watchStatus === 'paused' && (
                <span className="pill pill-neutral" style={{ height: 17, fontSize: 7.5 }}>
                  已暂停
                </span>
              )}
            </div>
          </div>
          {software.pinned && <Pin size={12} className="faint shrink-0" aria-label="已置顶" />}
          <ActionMenu
            items={[
              { label: '编辑配置', icon: Pencil, onClick: () => onEdit(software) },
              {
                label: syncing ? '正在同步…' : '立即同步',
                icon: RefreshCw,
                onClick: () => void sync(),
              },
              {
                label: software.watchStatus === 'paused' ? '恢复关注' : '暂停关注',
                icon: software.watchStatus === 'paused' ? Play : Pause,
                onClick: () => void togglePause(),
              },
              {
                label: software.pinned ? '取消置顶' : '置顶到首页',
                icon: software.pinned ? PinOff : Pin,
                onClick: () => void togglePin(),
              },
              {
                label: '查看采集日志',
                icon: ScrollText,
                onClick: () => openDetail('sources'),
              },
              {
                label: '归档软件',
                icon: Archive,
                onClick: () => setConfirmArchive(true),
                danger: true,
                separator: true,
              },
            ]}
          />
        </div>

        <div className="sw-body">
          <div className="version-strip">
            <button
              className="min-w-0 text-left"
              onClick={(event) => {
                event.stopPropagation();
                openDetail('releases');
              }}
              title="查看版本历史"
            >
              <span className="version-label">Current / 当前</span>
              <span className="version-current">
                {software.currentVersion ? (
                  <strong>{software.currentVersion}</strong>
                ) : (
                  <span className="pending">待配置</span>
                )}
              </span>
            </button>
            <button
              className="version-latest min-w-0 text-left"
              onClick={(event) => {
                event.stopPropagation();
                openDetail('releases');
              }}
              title="查看版本历史"
            >
              <span className="version-label">Latest / 最新稳定</span>
              <span className="version-latest-value">
                <span>{software.latestVersion ?? '尚未采集'}</span>
                {updateAvailable && <span className="update-pill">↑ 可更新</span>}
              </span>
            </button>
          </div>

          <div className="sw-status-grid">
            <button
              className="status-cell"
              onClick={(event) => {
                event.stopPropagation();
                openDetail('vulnerabilities');
              }}
              title="查看该软件的漏洞"
            >
              <span className="status-cell-label">
                {software.counts.openVulns > 0 ? <ShieldAlert size={10} /> : <ShieldCheck size={10} />}
                安全情报
              </span>
              <span className={`status-cell-value ${securityState === 'critical' ? 'danger' : securityState === 'warn' ? 'warn' : 'neutral'}`}>
                {software.counts.openVulns === 0 ? (
                  '无待处理漏洞'
                ) : (
                  <>
                    {software.counts.openVulns} 项
                    <small>
                      {software.counts.affectedVulns > 0
                        ? `确认受影响 ${software.counts.affectedVulns}`
                        : software.counts.highVulns > 0
                          ? `高危 ${software.counts.highVulns}`
                          : '待核实'}
                    </small>
                  </>
                )}
              </span>
            </button>

            <button
              className="status-cell"
              onClick={(event) => {
                event.stopPropagation();
                openDetail('lifecycle');
              }}
              title="查看生命周期"
            >
              <span className="status-cell-label">
                <Clock3 size={10} /> 生命周期
              </span>
              <span className={`status-cell-value ${lifecycle.className === 'danger' ? 'danger' : lifecycle.className === 'warn' ? 'warn' : lifecycle.className === 'calm' ? 'calm' : 'neutral'}`}>
                {software.lifecycle.status === 'unknown' ? '未知' : lifecycle.label}
                {software.lifecycle.eolDate && (
                  <small>
                    {software.lifecycle.status === 'eol'
                      ? eolLabel(software.lifecycle.eolDate)
                      : software.lifecycle.status === 'approaching_eol'
                        ? eolLabel(software.lifecycle.eolDate)
                        : software.lifecycle.eolDate}
                  </small>
                )}
              </span>
            </button>
          </div>
        </div>

        <div className="sw-foot">
          <span>SYNC {relativeTime(software.lastSyncAt)}</span>
          {software.sourceIssueCount > 0 ? (
            <span className="sync-issue">
              <span className="dot" /> {software.sourceIssueCount} 个数据源异常
            </span>
          ) : (
            <span className="ml-auto inline-flex items-center gap-1.5">
              {software.riskLevel === 'critical' ? (
                <span className="pill pill-danger" style={{ height: 17, fontSize: 7.5 }}>
                  P0 风险
                </span>
              ) : software.riskLevel === 'high' ? (
                <span className="pill pill-warn" style={{ height: 17, fontSize: 7.5 }}>
                  高优先级
                </span>
              ) : null}
            </span>
          )}
          <span className="open-arrow" aria-hidden="true">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </article>

      <Modal
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        eyebrow="Archive software"
        title={`归档 ${software.name}？`}
        description="归档后首页不再展示该软件，但历史版本、漏洞和采集记录会保留。"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setConfirmArchive(false)}>
              取消
            </button>
            <button className="btn btn-danger" onClick={() => void archive()} disabled={archiving}>
              {archiving ? '归档中…' : '确认归档'}
            </button>
          </>
        }
      >
        <div className="form-note flex items-start gap-2">
          <Archive size={13} className="mt-0.5 flex-none" />
          当前关注配置不会被删除；后续如需恢复，可直接在数据库中调整。归档操作不可从界面撤销。
        </div>
      </Modal>
    </>
  );
}
