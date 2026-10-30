import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CircleAlert,
  Compass,
  EyeOff,
  GitFork,
  Link2,
  RotateCcw,
  Star,
} from 'lucide-react';
import type { DiscoveryCandidate } from '@shared/types';
import { api } from '../lib/api';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { categoryColor, formatDate, formatDateTime, relativeTime } from '../lib/format';
import {
  discoverySourceLabel,
  discoverySourceMeta,
  discoveryStatusMeta,
  formatMetric,
} from '../lib/discovery';
import { radarStatusMeta } from '../lib/radar';
import { useToast } from '../contexts/ToastContext';
import { useAppData } from '../contexts/AppDataContext';
import { EmptyState, LoadingBlock } from '../components/ui';
import { DiscoveryImportDialog } from '../components/DiscoveryImportDialog';
import { FollowButton } from '../components/FollowButton';

export function DiscoverDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { push } = useToast();
  const { refresh } = useAppData();
  const { data: candidate, loading, error, refetch } = useApi<DiscoveryCandidate>(
    id ? `/discovery/candidates/${id}` : null,
  );
  const [importing, setImporting] = useState<DiscoveryCandidate | null>(null);
  const [busy, setBusy] = useState(false);

  useDocumentTitle(candidate?.title ?? '技术发现');

  const afterMutation = async () => {
    await Promise.all([refetch(true), refresh(true)]);
  };

  const ignore = async () => {
    if (!candidate) return;
    setBusy(true);
    try {
      await api.post(`/discovery/candidates/${candidate.id}/ignore`);
      push('已忽略该候选，来源记录与首次发现时间仍保留');
      await afterMutation();
    } catch (ignoreError) {
      push(ignoreError instanceof Error ? ignoreError.message : '忽略失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!candidate) return;
    setBusy(true);
    try {
      await api.post(`/discovery/candidates/${candidate.id}/restore`);
      push('已恢复到待评估候选池');
      await afterMutation();
    } catch (restoreError) {
      push(restoreError instanceof Error ? restoreError.message : '恢复失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !candidate) {
    return (
      <div className="page">
        <LoadingBlock />
        <div className="loading-block mt-4" style={{ minHeight: 320 }} />
      </div>
    );
  }

  if (!candidate) {
    return (
      <div className="page">
        <EmptyState
          icon={Compass}
          title="候选技术不存在"
          description={error || '它可能已经被清理，或链接不正确。'}
          actions={
            <Link to="/discover" className="btn btn-secondary">
              返回技术发现
            </Link>
          }
        />
      </div>
    );
  }

  const status = discoveryStatusMeta[candidate.status];
  const linked = candidate.relatedRadarItem;
  const metrics = [
    { label: 'Star 数', value: candidate.starsCount, icon: Star },
    { label: 'Fork 数', value: candidate.forksCount, icon: GitFork },
  ].filter((metric) => metric.value !== null);

  return (
    <div className="page">
      <button
        className="mb-3 inline-flex items-center gap-1.5 text-[0.71875rem] text-[var(--muted)] hover:text-[var(--ink)]"
        onClick={() => navigate('/discover')}
      >
        <ArrowLeft size={12} /> 返回技术发现
      </button>

      {error && <div className="error-note mb-3">{error}</div>}

      <header className="detail-head">
        <div className="detail-title">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="radar-kind">{discoverySourceMeta[candidate.sourceType].code}</span>
            <span className="eyebrow no-rule" style={{ color: categoryColor(candidate.category) }}>
              {candidate.category}
            </span>
            <span className={`pill pill-${status.className}`} style={{ height: 19, fontSize: '0.65625rem' }}>
              {status.label}
            </span>
          </div>
          <h1>{candidate.title}</h1>
          <div className="detail-sub">
            {candidate.sourceRef && <span className="mono">{candidate.sourceRef}</span>}
            <span>首次发现 {formatDate(candidate.firstDiscoveredAt)}</span>
            <span>最近发现 {relativeTime(candidate.lastSeenAt)}</span>
            <a
              href={candidate.canonicalUrl}
              target="_blank"
              rel="noreferrer"
              className="text-link"
            >
              打开项目 <ArrowUpRight size={10} />
            </a>
          </div>
          <p className="radar-detail-summary">
            {candidate.description || '来源未提供项目简介。'}
          </p>
        </div>

        <div className="detail-actions">
          <FollowButton targetType="discovery" targetId={candidate.id} />
          {candidate.status === 'pending' && (
            <>
              <button className="btn btn-primary" onClick={() => setImporting(candidate)}>
                加入技术雷达 <ArrowRight size={13} />
              </button>
              <button className="btn btn-secondary" onClick={() => void ignore()} disabled={busy}>
                <EyeOff size={13} /> {busy ? '处理中…' : '忽略'}
              </button>
            </>
          )}
          {candidate.status === 'ignored' && (
            <>
              <button className="btn btn-primary" onClick={() => void restore()} disabled={busy}>
                <RotateCcw size={13} /> {busy ? '恢复中…' : '恢复待评估'}
              </button>
              <button className="btn btn-secondary" onClick={() => setImporting(candidate)}>
                加入技术雷达
              </button>
            </>
          )}
          {candidate.status === 'imported' && linked && (
            <Link to={`/radar/${linked.id}`} className="btn btn-primary">
              <Link2 size={13} /> 查看雷达条目
            </Link>
          )}
        </div>
      </header>

      <div className="detail-grid">
        <div className="flex flex-col gap-3.5">
          <section className="panel">
            <div className="panel-head">
              <h3>发现来源</h3>
              <span className="radar-panel-meta">{candidate.sources.length} 条来源记录</span>
            </div>
            <div className="panel-body">
              {candidate.sources.length ? (
                <div className="discovery-source-list">
                  {candidate.sources.map((source) => (
                    <div
                      className="discovery-source-row"
                      key={`${source.sourceType}:${source.sourceItemId}`}
                    >
                      <span className="radar-kind">{discoverySourceMeta[source.sourceType].code}</span>
                      <div className="discovery-source-row-main">
                        <strong>{source.sourceRef || discoverySourceLabel(source.sourceType)}</strong>
                        <span>
                          最近发现 {formatDateTime(source.lastSeenAt)}
                          {source.sourceUpdatedAt
                            ? ` · 来源更新 ${formatDateTime(source.sourceUpdatedAt)}`
                            : ' · 来源未提供更新时间'}
                        </span>
                      </div>
                      {source.sourceUrl && (
                        <a
                          href={source.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-link"
                        >
                          原始页面 <ArrowUpRight size={10} />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="radar-empty-hint">没有可展示的来源关联记录。</p>
              )}
              <div className="form-note mt-3">
                同一项目可能同时来自 GitHub 和 CNCF。系统按规范化项目链接合并候选并保留全部来源；无法可靠判断时不会强行合并。
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>来源与时间</h3>
            </div>
            <div className="panel-body">
              <div className="radar-info-list">
                <div className="radar-info-row">
                  <span>首次发现</span>
                  <strong>{formatDateTime(candidate.firstDiscoveredAt)}</strong>
                </div>
                <div className="radar-info-row">
                  <span>来源最近更新</span>
                  <strong>
                    {candidate.sourceUpdatedAt
                      ? formatDateTime(candidate.sourceUpdatedAt)
                      : '来源未提供'}
                  </strong>
                </div>
                <div className="radar-info-row">
                  <span>最近成功发现</span>
                  <strong>{formatDateTime(candidate.lastSeenAt)}</strong>
                </div>
                <div className="radar-info-row">
                  <span>最近抓取</span>
                  <strong>{formatDateTime(candidate.lastFetchedAt)}</strong>
                </div>
                <div className="radar-info-row">
                  <span>来源</span>
                  <strong>{discoverySourceLabel(candidate.sourceType)}</strong>
                </div>
                {candidate.sourcePushedAt && (
                  <div className="radar-info-row">
                    <span>最近推送</span>
                    <strong>{formatDateTime(candidate.sourcePushedAt)}</strong>
                  </div>
                )}
              </div>
              <div className="form-note mt-3">
                首次发现时间由本系统记录；来源更新、推送与发布时间来自上游。采集只更新外部字段，不会覆盖你的收录或忽略决定。
              </div>
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-3.5">
          <section className="panel">
            <div className="panel-head">
              <h3>收录决定</h3>
            </div>
            <div className="panel-body">
              {candidate.status === 'imported' && linked ? (
                <div className="discovery-decision">
                  <span className={`pill pill-${radarStatusMeta[linked.status].className}`}>
                    雷达 · {radarStatusMeta[linked.status].label}
                  </span>
                  <strong>{linked.title}</strong>
                  <p>这个候选已关联到技术雷达条目，后续评估记录请在雷达中维护。</p>
                  {linked.archivedAt && <p>该雷达条目目前处于归档状态。</p>}
                  <Link to={`/radar/${linked.id}`} className="btn btn-secondary btn-sm">
                    打开雷达条目 <ArrowRight size={11} />
                  </Link>
                </div>
              ) : (
                <div className="discovery-decision">
                  <span className={`pill pill-${status.className}`}>{status.label}</span>
                  <p>{status.description}</p>
                  {candidate.status !== 'imported' && (
                    <button className="btn btn-primary btn-sm" onClick={() => setImporting(candidate)}>
                      加入技术雷达 <ArrowRight size={11} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>项目信息</h3>
            </div>
            <div className="panel-body">
              <div className="radar-info-list">
                <div className="radar-info-row">
                  <span>分类</span>
                  <strong>{candidate.category}</strong>
                </div>
                {metrics.map((metric) => {
                  const Icon = metric.icon;
                  return (
                    <div className="radar-info-row" key={metric.label}>
                      <span>{metric.label}</span>
                      <strong className="inline-flex items-center gap-1">
                        <Icon size={10} /> {formatMetric(metric.value)}
                      </strong>
                    </div>
                  );
                })}
                {candidate.language && (
                  <div className="radar-info-row">
                    <span>主要语言</span>
                    <strong>{candidate.language}</strong>
                  </div>
                )}
                {candidate.license && (
                  <div className="radar-info-row">
                    <span>许可证</span>
                    <strong>{candidate.license}</strong>
                  </div>
                )}
                <div className="radar-info-row">
                  <span>项目链接</span>
                  <a href={candidate.canonicalUrl} target="_blank" rel="noreferrer" className="text-link">
                    打开 <ArrowUpRight size={10} />
                  </a>
                </div>
                {candidate.homepageUrl && (
                  <div className="radar-info-row">
                    <span>主页</span>
                    <a href={candidate.homepageUrl} target="_blank" rel="noreferrer" className="text-link">
                      访问 <ArrowUpRight size={10} />
                    </a>
                  </div>
                )}
              </div>
              {metrics.length === 0 && !candidate.language && !candidate.license && (
                <p className="radar-empty-hint mt-3">来源未提供可展示的 GitHub 指标。</p>
              )}
            </div>
          </section>

          <div className="form-note flex items-start gap-2">
            <CircleAlert size={12} className="mt-0.5 flex-none" />
            发现结果只覆盖已配置的搜索规则和官方数据集，不代表整个 GitHub。收录不会克隆、安装或部署任何外部项目。
          </div>
        </div>
      </div>

      <DiscoveryImportDialog
        candidate={importing}
        open={Boolean(importing)}
        onClose={() => setImporting(null)}
        onImported={async (result) => {
          setImporting(null);
          push(
            result.created
              ? '已加入技术雷达，条目处于待评估状态'
              : '已关联到现有技术雷达条目，没有创建重复记录',
          );
          await afterMutation();
        }}
      />
    </div>
  );
}
