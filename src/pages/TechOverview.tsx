import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Boxes,
  BookOpenCheck,
  Layers3,
  Network,
  Plus,
  Sparkles,
  Star,
  Target,
} from 'lucide-react';
import type {
  TechDomainSummary,
  TechFocusLevel,
  TechOverview,
  TechTemplateApplyResult,
  TechTemplateSummary,
} from '@shared/types';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { api } from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { formatDateTime, relativeTime } from '../lib/format';
import { masteryColor, masteryLabels, masteryOrder, techNodeTypeLabels } from '../lib/tech';
import { EmptyState, Modal, PageHeader } from '../components/ui';

const domainIcons: Record<string, typeof Boxes> = { Boxes, Activity, Network };

function DomainGlyph({ icon }: { icon: string | null }) {
  const Icon = (icon && domainIcons[icon]) || Network;
  return (
    <span className="tech-domain-glyph">
      <Icon size={18} strokeWidth={1.6} />
    </span>
  );
}

function MasteryBar({ domain }: { domain: TechDomainSummary }) {
  const total = Math.max(domain.nodeCount, 1);
  return (
    <div className="tech-mastery-bar" aria-label="掌握状态分布">
      {masteryOrder.map((status) => {
        const count = domain.masteryCounts[status] ?? 0;
        if (!count) return null;
        return (
          <span
            key={status}
            style={{ width: `${(count / total) * 100}%`, background: masteryColor(status) }}
            title={`${masteryLabels[status]} ${count}`}
          />
        );
      })}
    </div>
  );
}

export function TechOverview() {
  useDocumentTitle('技术地图');
  const navigate = useNavigate();
  const { push } = useToast();
  const { data, loading, error, refetch } = useApi<TechOverview>('/tech/overview');
  const { data: templates, refetch: refetchTemplates } = useApi<TechTemplateSummary[]>('/tech/templates');
  const [domainOpen, setDomainOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [domainDraft, setDomainDraft] = useState({ name: '', description: '', focusLevel: 'normal' as TechFocusLevel });
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);

  const domains = data?.domains ?? [];
  const activeDomains = useMemo(() => domains.filter((domain) => domain.status === 'active'), [domains]);

  const createDomain = async () => {
    if (!domainDraft.name.trim()) {
      push('领域需要一个名称', 'error');
      return;
    }
    setSaving(true);
    try {
      const created = await api.post<{ id: string }>('/tech/domains', {
        name: domainDraft.name.trim(),
        description: domainDraft.description || null,
        focusLevel: domainDraft.focusLevel,
      });
      push('技术领域已创建');
      setDomainOpen(false);
      setDomainDraft({ name: '', description: '', focusLevel: 'normal' });
      navigate(`/tech/domains/${created.id}`);
    } catch (createError) {
      push(createError instanceof Error ? createError.message : '创建失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = async (template: TechTemplateSummary) => {
    setApplying(template.key);
    try {
      const result = await api.post<TechTemplateApplyResult>(`/tech/templates/${template.key}/apply`);
      const { inserted } = result;
      push(
        inserted.nodes > 0
          ? `${template.name}：新增 ${inserted.nodes} 个节点、${inserted.views} 张视图`
          : `${template.name} 已是最新，已有内容未覆盖`,
      );
      await Promise.all([refetch(), refetchTemplates()]);
    } catch (applyError) {
      push(applyError instanceof Error ? applyError.message : '应用模板失败', 'error');
    } finally {
      setApplying(null);
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Technology map · systems, relations and understanding"
        title="技术地图"
        subtitle="把技术体系画成可以逐层展开的树和图，再把自己的理解、掌握程度和问题留在一个个节点上。"
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => setTemplateOpen(true)}>
              <Sparkles size={14} /> 技术模板
            </button>
            <button className="btn btn-primary" onClick={() => setDomainOpen(true)}>
              <Plus size={14} /> 新建领域
            </button>
          </>
        }
      />

      {error && <div className="error-note mb-3">{error}</div>}

      {loading && !data ? (
        <div className="loading-block" style={{ minHeight: 420 }} />
      ) : activeDomains.length === 0 ? (
        <EmptyState
          icon={Network}
          title="地图上还没有技术领域"
          description="可以先从 Kubernetes、Prometheus 模板开始，也可以新建一个自己的领域。"
          actions={
            <>
              <button className="btn btn-primary" onClick={() => setTemplateOpen(true)}>
                <Sparkles size={13} /> 查看技术模板
              </button>
              <button className="btn btn-secondary" onClick={() => setDomainOpen(true)}>
                <Plus size={13} /> 新建领域
              </button>
            </>
          }
        />
      ) : (
        <>
          <div className="tech-summary-line">
            <span>
              <strong className="mono">{data?.stats.domains ?? 0}</strong> 个领域
            </span>
            <span>
              <strong className="mono">{data?.stats.nodes ?? 0}</strong> 个技术节点
            </span>
            <span>
              <strong className="mono">{data?.stats.learning ?? 0}</strong> 个正在学习
            </span>
            <span>
              <strong className="mono">{data?.stats.focus ?? 0}</strong> 个重点关注
            </span>
            <span className="tech-summary-note">
              {data?.stats.mastered ?? 0} 个已掌握 · 掌握状态由你自己维护
            </span>
          </div>

          <div className="tech-overview-layout">
            <section>
              <div className="section-label">技术领域 / Domains</div>
              <div className="tech-domain-grid">
                {activeDomains.map((domain) => (
                  <Link key={domain.id} to={`/tech/domains/${domain.id}`} className="tech-domain-card">
                    <div className="tech-domain-card-head">
                      <DomainGlyph icon={domain.icon} />
                      <div>
                        <h2>{domain.name}</h2>
                        <span className="mono">{domain.nodeCount} nodes</span>
                      </div>
                      {domain.focusLevel === 'focus' && (
                        <span className="tech-domain-focus" title="重点关注">
                          <Star size={11} fill="currentColor" />
                        </span>
                      )}
                      <ArrowRight size={15} className="tech-domain-arrow" />
                    </div>
                    <p>{domain.description || '还没有领域描述。'}</p>
                    <MasteryBar domain={domain} />
                    <div className="tech-domain-card-foot">
                      <span className="tech-domain-counts">
                        {masteryOrder.map((status) => {
                          const count = domain.masteryCounts[status] ?? 0;
                          return count ? (
                            <em key={status} title={masteryLabels[status]}>
                              <i style={{ background: masteryColor(status) }} />
                              {masteryLabels[status]} {count}
                            </em>
                          ) : null;
                        })}
                      </span>
                      <span className="tech-domain-updated">
                        {domain.lastNodeUpdatedAt ? relativeTime(domain.lastNodeUpdatedAt) : '尚无节点'}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            <aside className="tech-overview-rail">
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <span className="eyebrow">Learning queue</span>
                    <h3>继续研究</h3>
                  </div>
                  <BookOpenCheck size={15} />
                </div>
                <div className="panel-body">
                  {(data?.learningNodes ?? []).length === 0 ? (
                    <p className="tech-rail-empty">把节点标记为“待学习”“学习中”或“深入研究”后，会出现在这里。</p>
                  ) : (
                    <div className="tech-rail-list">
                      {(data?.learningNodes ?? []).map((node) => (
                        <Link key={node.id} to={`/tech/nodes/${node.id}`} className="tech-rail-item">
                          <span className="tech-mastery-dot" style={{ background: masteryColor(node.masteryStatus) }} />
                          <span>
                            <strong>{node.name}</strong>
                            <em>{masteryLabels[node.masteryStatus]}</em>
                          </span>
                          <span className="tech-type-label">{techNodeTypeLabels[node.nodeType]}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <div>
                    <span className="eyebrow">Focus</span>
                    <h3>重点关注</h3>
                  </div>
                  <Target size={15} />
                </div>
                <div className="panel-body">
                  {(data?.focusNodes ?? []).length === 0 ? (
                    <p className="tech-rail-empty">还没有标记为重点关注的节点。</p>
                  ) : (
                    <div className="tech-rail-list">
                      {(data?.focusNodes ?? []).map((node) => (
                        <Link key={node.id} to={`/tech/nodes/${node.id}`} className="tech-rail-item">
                          <Star size={11} className="tech-focus-flag" fill="currentColor" />
                          <span>
                            <strong>{node.name}</strong>
                            <em>{masteryLabels[node.masteryStatus]}</em>
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <div>
                    <span className="eyebrow">Recently touched</span>
                    <h3>最近更新</h3>
                  </div>
                  <Layers3 size={15} />
                </div>
                <div className="panel-body">
                  {(data?.recentNodes ?? []).length === 0 ? (
                    <p className="tech-rail-empty">还没有技术节点。</p>
                  ) : (
                    <div className="tech-rail-list">
                      {(data?.recentNodes ?? []).map((node) => (
                        <Link key={node.id} to={`/tech/nodes/${node.id}`} className="tech-rail-item">
                          <span className={`tech-type-dot type-${node.nodeType}`} />
                          <span>
                            <strong>{node.name}</strong>
                            <em>更新于 {formatDateTime(node.updatedAt)}</em>
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </>
      )}

      <Modal
        open={domainOpen}
        onClose={() => setDomainOpen(false)}
        eyebrow="New domain"
        title="新建技术领域"
        description="领域是技术树和架构视图的边界，例如 Kubernetes、Prometheus 或数据库。"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setDomainOpen(false)}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => void createDomain()} disabled={saving}>
              {saving ? '创建中…' : '创建领域'}
            </button>
          </>
        }
      >
        <div className="grid gap-3">
          <label className="field">
            <span className="field-label">领域名称</span>
            <input
              className="field-input"
              value={domainDraft.name}
              onChange={(event) => setDomainDraft({ ...domainDraft, name: event.target.value })}
              placeholder="如 Kubernetes"
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">领域说明</span>
            <textarea
              className="field-textarea"
              rows={3}
              value={domainDraft.description}
              onChange={(event) => setDomainDraft({ ...domainDraft, description: event.target.value })}
              placeholder="这个领域包含哪些技术，你希望理解到什么程度"
            />
          </label>
          <label className="field">
            <span className="field-label">关注级别</span>
            <select
              className="field-input"
              value={domainDraft.focusLevel}
              onChange={(event) =>
                setDomainDraft({ ...domainDraft, focusLevel: event.target.value as TechFocusLevel })
              }
            >
              <option value="normal">普通关注</option>
              <option value="focus">重点关注</option>
            </select>
          </label>
        </div>
      </Modal>

      <Modal
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        wide
        eyebrow="Templates"
        title="技术模板"
        description="模板提供一套可编辑的初始结构和示例内容。重复应用只会补齐缺失的部分，不会覆盖你改过的节点。"
      >
        <div className="tech-template-list">
          {(templates ?? []).map((template) => (
            <div key={template.key} className="tech-template-row">
              <div>
                <div className="flex items-center gap-2">
                  <strong>{template.name}</strong>
                  {template.appliedAt && <span className="pill pill-neutral">已初始化</span>}
                </div>
                <p>{template.description}</p>
                {template.appliedAt && (
                  <span className="tech-template-time">初始化于 {formatDateTime(template.appliedAt)}</span>
                )}
              </div>
              <button
                className={`btn ${template.appliedAt ? 'btn-secondary' : 'btn-primary'} btn-sm`}
                onClick={() => void applyTemplate(template)}
                disabled={Boolean(applying)}
              >
                {applying === template.key ? '处理中…' : template.appliedAt ? '补齐缺失内容' : '应用模板'}
              </button>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
