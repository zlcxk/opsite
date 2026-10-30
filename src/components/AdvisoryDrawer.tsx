import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, ShieldAlert, X } from 'lucide-react';
import type { Advisory, AdvisoryStatus } from '@shared/types';
import { useApi } from '../lib/hooks';
import { api } from '../lib/api';
import {
  advisoryStatusMeta,
  formatDate,
  formatDateTime,
  impactMeta,
  priorityMeta,
  severityMeta,
} from '../lib/format';
import { useToast } from '../contexts/ToastContext';
import { FollowButton } from './FollowButton';

interface AdvisoryDrawerProps {
  advisoryId: string | null;
  onClose: () => void;
  onUpdated?: (advisory: Advisory) => void;
}

const statuses = Object.keys(advisoryStatusMeta) as AdvisoryStatus[];

export function AdvisoryDrawer({ advisoryId, onClose, onUpdated }: AdvisoryDrawerProps) {
  const { data, refetch, loading, error } = useApi<Advisory>(
    advisoryId ? `/advisories/${advisoryId}` : null,
  );
  const { push } = useToast();

  useEffect(() => {
    if (!advisoryId) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', handler);
    };
  }, [advisoryId, onClose]);

  if (!advisoryId) return null;

  const setStatus = async (status: AdvisoryStatus) => {
    try {
      const result = await api.patch<{ advisory: Advisory }>(`/advisories/${advisoryId}/status`, { status });
      push(`处置状态已更新为「${advisoryStatusMeta[status]}」`);
      await refetch(true);
      if (result.advisory) onUpdated?.(result.advisory);
    } catch (updateError) {
      push(updateError instanceof Error ? updateError.message : '状态更新失败', 'error');
    }
  };

  const advisory = data;
  const severity = advisory ? severityMeta[advisory.severity] : null;
  const impact = advisory ? impactMeta[advisory.versionImpact] : null;
  const priority = advisory ? priorityMeta[advisory.priority] : null;
  const priorityPill = advisory
    ? advisory.priority === 'P0'
      ? 'danger'
      : advisory.priority === 'P1'
        ? 'warn'
        : advisory.priority === 'P2'
          ? 'note'
          : 'neutral'
    : 'neutral';

  return createPortal(
    <>
      <div className="drawer-overlay" onMouseDown={onClose} />
      <aside className="drawer wide" role="dialog" aria-modal="true" aria-label="漏洞详情">
        <div className="drawer-head">
          <div>
            <div className="eyebrow">Advisory detail</div>
            <h2>{advisory?.identifier ?? '加载中'}</h2>
            <p>{advisory?.softwareName ? `${advisory.softwareName} · 上游公告与本地版本判断` : '读取公告与影响范围'}</p>
          </div>
          <div className="flex items-center gap-2">
            {advisory && <FollowButton targetType="advisory" targetId={advisory.id} compact />}
            <button className="close-btn" onClick={onClose} aria-label="关闭漏洞详情">
              <X size={17} />
            </button>
          </div>
        </div>

        <div className="drawer-body">
          {loading && !advisory && <div className="loading-block" style={{ minHeight: 220 }} />}
          {error && <div className="error-note mb-3">{error}</div>}

          {advisory && (
            <div className="advisory-detail">
              <div className="flex flex-wrap items-center gap-2">
                {severity && <span className={`pill pill-${severity.className}`}>{severity.label}</span>}
                {priority && <span className={`pill pill-${priorityPill}`}>{priority.label}</span>}
                {impact && <span className={`pill pill-${impact.className}`}>{impact.label}</span>}
                {advisory.kev && <span className="kev-badge">KEV · 已遭利用</span>}
              </div>

              <h3 className="mt-3">{advisory.title}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.71875rem] text-[var(--muted)]">
                <span>发布 {formatDate(advisory.publishedAt)}</span>
                <span>·</span>
                <span>上游更新 {formatDate(advisory.updatedAt)}</span>
                {advisory.url && (
                  <a href={advisory.url} target="_blank" rel="noreferrer" className="text-link">
                    上游公告 <ExternalLink size={10} />
                  </a>
                )}
              </div>

              {advisory.description && <p className="advisory-description">{advisory.description}</p>}

              <div className="advisory-facts">
                <div className="fact">
                  <span>Severity / 严重程度</span>
                  <strong>{severity?.label ?? '未知'}</strong>
                </div>
                <div className="fact">
                  <span>CVSS / 来源</span>
                  <strong>
                    {advisory.score ?? '—'}
                    {advisory.scoreSource ? ` · ${advisory.scoreSource}` : ''}
                  </strong>
                </div>
                <div className="fact">
                  <span>Version impact / 版本判断</span>
                  <strong>{impact?.label}</strong>
                </div>
                <div className="fact">
                  <span>Confidence / 判断可信度</span>
                  <strong>{advisory.confidence === 'high' ? '高' : advisory.confidence === 'medium' ? '中' : '低'}</strong>
                </div>
                {advisory.kev && (
                  <div className="fact">
                    <span>KEV due date</span>
                    <strong>{formatDate(advisory.kevDueDate)}</strong>
                  </div>
                )}
              </div>

              <div className="advisory-section">
                <h4>Affected range / 受影响范围</h4>
                <div className="range-box">{advisory.affectedRange || '上游未提供可解析的结构化版本范围。'}</div>
                {advisory.fixedVersions.length > 0 && (
                  <div className="range-box">
                    修复版本：{advisory.fixedVersions.join(' / ')}
                  </div>
                )}
              </div>

              <div className="advisory-section">
                <h4>Why this priority / 判定依据</h4>
                <div className="form-note" style={{ marginTop: 0 }}>
                  <ShieldAlert size={12} className="mr-1.5 inline" />
                  {advisory.versionImpact === 'affected'
                    ? '当前版本落在可解析的受影响范围内。'
                    : advisory.versionImpact === 'not_affected'
                      ? '当前版本明确不在所有已解析的受影响范围内。'
                      : advisory.versionImpact === 'possibly_affected'
                        ? '版本范围存在不确定信息，需要人工核实。'
                        : '缺少可解析的当前版本或上游影响范围，无法下结论。'}
                  {advisory.kev
                    ? ' 该漏洞已进入 CISA KEV，意味着存在实际利用证据。'
                    : ' 严重程度只表示潜在危害，不等于已被利用。'}
                </div>
              </div>

              <div className="advisory-section">
                <h4>Provenance / 数据来源</h4>
                {advisory.sources.length ? (
                  advisory.sources.map((source, index) => (
                    <div className="source-ref" key={`${source.sourceType}-${index}`}>
                      <span className="pill pill-neutral" style={{ height: 18, fontSize: '0.65625rem' }}>
                        {source.sourceType === 'github_advisories'
                          ? 'GitHub'
                          : source.sourceType === 'nvd'
                            ? 'NVD'
                            : source.sourceType === 'cisa_kev'
                              ? 'CISA KEV'
                              : source.sourceType}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{source.externalId ?? '上游记录'}</span>
                      <span className="shrink-0">{formatDateTime(source.fetchedAt)}</span>
                      {source.url && (
                        <a href={source.url} target="_blank" rel="noreferrer" className="text-link" aria-label="打开来源">
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-[0.75rem] text-[var(--muted)]">暂无来源引用。</div>
                )}
              </div>
            </div>
          )}
        </div>

        {advisory && (
          <div className="drawer-foot">
            <div>
              <div className="field-label mb-1">我的处置状态</div>
              <select
                className="status-select"
                value={advisory.status}
                onChange={(event) => void setStatus(event.target.value as AdvisoryStatus)}
                aria-label="更新处置状态"
              >
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {advisoryStatusMeta[status]}
                  </option>
                ))}
              </select>
            </div>
            <span className="text-[0.65625rem] text-[var(--muted-2)]">状态由你维护，上游更新不会覆盖</span>
          </div>
        )}
      </aside>
    </>,
    document.body,
  );
}
