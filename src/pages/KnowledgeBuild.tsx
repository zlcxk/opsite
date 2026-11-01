import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpenCheck,
  Check,
  CircleAlert,
  ExternalLink,
  FlaskConical,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Wand2,
} from 'lucide-react';
import type {
  KnowledgeBuildFilters,
  KnowledgeBuildLinkStrategy,
  KnowledgeBuildPendingCandidate,
  KnowledgeBuildPreview,
  KnowledgeBuildRequest,
  KnowledgeBuildResult,
  KnowledgeBuildRule,
  KnowledgeBuildScopeType,
  KnowledgeBuildTemplate,
  KnowledgeBuildTemplateKey,
  KnowledgeBuildTriggerType,
  KnowledgeUrlCheckResult,
  SoftwareSummary,
  TechDomainSummary,
  TechExternalLink,
  TechNodeListResponse,
  TechNodeType,
} from '@shared/types';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { api } from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { contentStatusLabels, techNodeTypeLabels } from '../lib/tech';
import { EmptyState, PageHeader } from '../components/ui';

const actionLabels: Record<string, string> = {
  create_node: '新建节点',
  link_existing: '关联现有节点',
  link_and_initialize: '关联并初始化',
  initialize_doc: '初始化文档',
  skip: '跳过',
  pending: '待人工决定',
};

const resultLabels: Record<string, string> = {
  created: '已创建',
  linked: '已关联',
  initialized: '已初始化',
  skipped: '已跳过',
  pending: '待补充',
  failed: '失败',
};

const triggerLabels: Record<KnowledgeBuildTriggerType, string> = {
  software_created: '新增软件时',
  node_created: '新增技术节点时',
};

const strategyLabels: Record<KnowledgeBuildLinkStrategy, string> = {
  create_node: '新建节点并关联',
  link_existing: '关联现有节点',
  none: '不自动决定，生成待办',
};

function emptyRequest(): KnowledgeBuildRequest {
  return {
    scopeType: 'software',
    software: { selection: 'all' },
    nodes: {},
    filters: {
      onlyMissing: false,
      onlyDraft: false,
      skipVerified: true,
      activeOnly: true,
      skipArchived: true,
    },
    templateKey: 'component-l2-v1',
    mapping: { linkStrategy: 'none' },
    sources: { docsUrl: null, referenceLinks: [] },
  };
}

function emptyRuleDraft() {
  return {
    name: '',
    triggerType: 'software_created' as KnowledgeBuildTriggerType,
    templateKey: 'component-l2-v1' as KnowledgeBuildTemplateKey,
    category: '',
    domainId: '',
    nodeType: 'component' as TechNodeType,
    parentId: '',
    linkStrategy: 'create_node' as KnowledgeBuildLinkStrategy,
    initializeOnLink: false,
    docsUrl: '',
    refs: [
      { label: '官方文档', url: '' },
      { label: '源码仓库', url: '' },
    ] as TechExternalLink[],
  };
}

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function KnowledgeBuild() {
  useDocumentTitle('知识建档');
  const { push } = useToast();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<'manual' | 'rules'>('manual');
  const { data: templates } = useApi<KnowledgeBuildTemplate[]>('/tech/knowledge-build/templates');
  const { data: softwareList } = useApi<SoftwareSummary[]>('/software');
  const { data: domains } = useApi<TechDomainSummary[]>('/tech/domains');
  const { data: allNodes } = useApi<TechNodeListResponse>('/tech/nodes?status=active&limit=300');
  const { data: rules, refetch: refetchRules } = useApi<KnowledgeBuildRule[]>(
    '/tech/knowledge-build/rules',
  );
  const { data: pending, refetch: refetchPending } = useApi<KnowledgeBuildPendingCandidate[]>(
    '/tech/knowledge-build/pending',
  );

  const [scopeType, setScopeType] = useState<KnowledgeBuildScopeType>('software');
  const [templateKey, setTemplateKey] = useState<KnowledgeBuildTemplateKey>('component-l2-v1');
  const [softwareIds, setSoftwareIds] = useState<string[]>([]);
  const [softwareSearch, setSoftwareSearch] = useState('');
  const [softwareCategory, setSoftwareCategory] = useState('');
  const [softwareSelection, setSoftwareSelection] = useState<
    '' | 'all' | 'unlinked' | 'linked_without_markdown' | 'linked_draft'
  >('');
  const [nodeIds, setNodeIds] = useState<string[]>([]);
  const [nodeDomainId, setNodeDomainId] = useState('');
  const [nodeParentId, setNodeParentId] = useState('');
  const [nodeType, setNodeType] = useState<TechNodeType | ''>('');
  const [includeSubtree, setIncludeSubtree] = useState(false);
  const [nodeSelection, setNodeSelection] = useState<
    '' | 'all' | 'no_body' | 'draft' | 'needs_review'
  >('');
  const [nodeSearch, setNodeSearch] = useState('');
  const [newNode, setNewNode] = useState({
    name: '',
    domainId: '',
    parentId: '',
    nodeType: 'component' as TechNodeType,
    summary: '',
  });
  const [mappingDomainId, setMappingDomainId] = useState('');
  const [mappingParentId, setMappingParentId] = useState('');
  const [mappingNodeType, setMappingNodeType] = useState<TechNodeType>('component');
  const [linkStrategy, setLinkStrategy] = useState<KnowledgeBuildLinkStrategy>('none');
  const [initializeOnLink, setInitializeOnLink] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [onlyDraft, setOnlyDraft] = useState(false);
  const [skipVerified, setSkipVerified] = useState(true);
  const [excludeSoftwareIds, setExcludeSoftwareIds] = useState('');
  const [excludeNodeIds, setExcludeNodeIds] = useState('');
  const [docsUrl, setDocsUrl] = useState('');
  const [referenceLinks, setReferenceLinks] = useState<TechExternalLink[]>([
    { label: '官方文档', url: '' },
    { label: '源码仓库', url: '' },
  ]);
  const [urlResults, setUrlResults] = useState<KnowledgeUrlCheckResult[]>([]);
  const [preview, setPreview] = useState<KnowledgeBuildPreview | null>(null);
  const [result, setResult] = useState<KnowledgeBuildResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [ruleDraft, setRuleDraft] = useState(emptyRuleDraft);
  const [ruleBusy, setRuleBusy] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleExtras, setRuleExtras] = useState<{
    scopeConfig: Record<string, unknown>;
    mappingConfig: Record<string, unknown>;
  }>({ scopeConfig: {}, mappingConfig: {} });

  const searchKey = searchParams.toString();
  useEffect(() => {
    const params = new URLSearchParams(searchKey);
    const softwareId = params.get('softwareId');
    const nodeId = params.get('nodeId');
    if (softwareId) {
      setScopeType('software');
      setSoftwareIds([softwareId]);
    }
    if (nodeId) {
      setScopeType('nodes');
      setNodeIds([nodeId]);
    }
  }, [searchKey]);

  const activeDomains = useMemo(
    () => (domains ?? []).filter((domain) => domain.status === 'active'),
    [domains],
  );
  const activeSoftware = useMemo(
    () => (softwareList ?? []).filter((item) => item.watchStatus !== 'archived'),
    [softwareList],
  );
  const softwareCategories = useMemo(
    () => [...new Set(activeSoftware.map((item) => item.category))].sort(),
    [activeSoftware],
  );
  const filteredSoftware = useMemo(() => {
    const term = softwareSearch.trim().toLowerCase();
    return activeSoftware
      .filter((item) => !softwareCategory || item.category === softwareCategory)
      .filter(
        (item) =>
          !term ||
          item.name.toLowerCase().includes(term) ||
          item.category.toLowerCase().includes(term),
      )
      .slice(0, 200);
  }, [activeSoftware, softwareCategory, softwareSearch]);

  const nodesForDomain = useMemo(() => {
    if (!nodeDomainId) return allNodes?.items ?? [];
    return (allNodes?.items ?? []).filter((node) => node.domainId === nodeDomainId);
  }, [allNodes, nodeDomainId]);
  const parentOptions = useMemo(
    () => nodesForDomain.filter((node) => !nodeParentId || node.id !== nodeParentId),
    [nodesForDomain, nodeParentId],
  );

  const request = useMemo<KnowledgeBuildRequest>(() => {
    const splitIds = (value: string) =>
      value
        .split(/[\s,，]+/)
        .map((item) => item.trim())
        .filter(Boolean);
    const filters: KnowledgeBuildFilters = {
      onlyMissing,
      onlyDraft,
      skipExistingBody: true,
      skipVerified,
      activeOnly: true,
      skipArchived: true,
      excludeSoftwareIds: splitIds(excludeSoftwareIds),
      excludeNodeIds: splitIds(excludeNodeIds),
    };
    const links = referenceLinks
      .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
      .filter((link) => link.label && link.url);
    return {
      scopeType,
      software:
        scopeType === 'software' || scopeType === 'combined'
          ? {
              ids: softwareIds,
              category: softwareCategory || null,
              selection: softwareSelection || undefined,
            }
          : undefined,
      nodes:
        scopeType === 'nodes' || scopeType === 'combined'
          ? {
              ids: nodeIds,
              domainId: nodeDomainId || null,
              parentId: nodeParentId || null,
              includeSubtree,
              nodeType: nodeType || null,
              selection: nodeSelection || undefined,
            }
          : undefined,
      newNode:
        scopeType === 'new'
          ? {
              name: newNode.name,
              domainId: newNode.domainId,
              parentId: newNode.parentId || null,
              nodeType: newNode.nodeType,
              summary: newNode.summary.trim() || null,
            }
          : undefined,
      filters,
      templateKey,
      mapping: {
        domainId: mappingDomainId || null,
        parentId: mappingParentId || null,
        nodeType: mappingNodeType,
        linkStrategy,
        initializeOnLink,
      },
      sources: { docsUrl: docsUrl || null, referenceLinks: links },
    };
  }, [
    scopeType,
    softwareIds,
    softwareCategory,
    softwareSelection,
    nodeIds,
    nodeDomainId,
    nodeParentId,
    includeSubtree,
    nodeType,
    nodeSelection,
    newNode,
    templateKey,
    mappingDomainId,
    mappingParentId,
    mappingNodeType,
    linkStrategy,
    initializeOnLink,
    onlyMissing,
    onlyDraft,
    skipVerified,
    excludeSoftwareIds,
    excludeNodeIds,
    docsUrl,
    referenceLinks,
  ]);

  const signature = JSON.stringify(request);
  useEffect(() => {
    setPreview(null);
    setConfirmed(false);
  }, [signature]);

  const toggleSoftware = (id: string) => {
    setSoftwareIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };
  const toggleNode = (id: string) => {
    setNodeIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };
  const setLink = (index: number, patch: Partial<TechExternalLink>) => {
    setReferenceLinks((current) =>
      current.map((link, position) => (position === index ? { ...link, ...patch } : link)),
    );
  };

  const runPreview = async () => {
    setBusy('preview');
    setResult(null);
    try {
      const data = await api.post<KnowledgeBuildPreview>('/tech/knowledge-build/preview', request);
      setPreview(data);
      setConfirmed(false);
      push(
        `预览完成：${
          data.counts.createNode +
          data.counts.initializeDoc +
          data.counts.linkExisting +
          data.counts.linkAndInitialize
        } 项可执行`,
      );
    } catch (error) {
      push(error instanceof Error ? error.message : '预览失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const runExecute = async () => {
    if (!preview) return;
    setBusy('execute');
    try {
      const data = await api.post<KnowledgeBuildResult>('/tech/knowledge-build/execute', {
        ...request,
        confirmed: true,
        previewId: preview.previewId,
        previewHash: preview.previewHash,
      });
      setResult(data);
      setPreview(null);
      setConfirmed(false);
      push('建档任务已执行');
    } catch (error) {
      const message = error instanceof Error ? error.message : '执行失败';
      if (/预览|409/.test(message)) {
        setPreview(null);
        setConfirmed(false);
      }
      push(message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const checkUrls = async () => {
    const urls = [docsUrl, ...referenceLinks.map((link) => link.url)].filter(Boolean);
    if (!urls.length) {
      push('先填写至少一个来源地址', 'error');
      return;
    }
    setBusy('urls');
    try {
      const data = await api.post<{ results: KnowledgeUrlCheckResult[] }>(
        '/tech/knowledge-build/check-urls',
        { urls },
      );
      setUrlResults(data.results);
      push('链接检查完成。可访问不代表技术结论正确。');
    } catch (error) {
      push(error instanceof Error ? error.message : '检查失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const buildRulePayload = () => {
    const softwareTrigger = ruleDraft.triggerType === 'software_created';
    return {
      name: ruleDraft.name.trim(),
      enabled: true,
      targetType: softwareTrigger ? ('software' as const) : ('node' as const),
      triggerType: ruleDraft.triggerType,
      scopeType: softwareTrigger ? ('software' as const) : ('nodes' as const),
      scopeConfig: softwareTrigger
        ? { ...ruleExtras.scopeConfig, category: ruleDraft.category || null }
        : {
            ...ruleExtras.scopeConfig,
            domainId: ruleDraft.domainId || null,
            nodeType: ruleDraft.nodeType,
          },
      mappingConfig: softwareTrigger
        ? {
            ...ruleExtras.mappingConfig,
            domainId: ruleDraft.domainId || null,
            parentId: ruleDraft.parentId || null,
            nodeType: ruleDraft.nodeType,
            linkStrategy: ruleDraft.linkStrategy,
            initializeOnLink:
              ruleDraft.linkStrategy === 'link_existing' && ruleDraft.initializeOnLink,
          }
        : { ...ruleExtras.mappingConfig },
      templateKey: ruleDraft.templateKey,
      sourceConfig: {
        docsUrl: ruleDraft.docsUrl || null,
        referenceLinks: ruleDraft.refs
          .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
          .filter((link) => link.label && link.url),
      },
    };
  };

  const saveRule = async () => {
    if (!ruleDraft.name.trim()) {
      push('规则需要名称', 'error');
      return;
    }
    setRuleBusy(true);
    try {
      const payload = {
        ...buildRulePayload(),
        enabled: editingRuleId
          ? (rules?.find((rule) => rule.id === editingRuleId)?.enabled ?? true)
          : true,
      };
      if (editingRuleId) {
        await api.patch<KnowledgeBuildRule>(
          `/tech/knowledge-build/rules/${editingRuleId}`,
          payload,
        );
        push('自动建档规则已更新；历史建档结果不会回填');
      } else {
        await api.post<KnowledgeBuildRule>('/tech/knowledge-build/rules', payload);
        push('自动建档规则已创建');
      }
      setRuleDraft(emptyRuleDraft());
      setEditingRuleId(null);
      setRuleExtras({ scopeConfig: {}, mappingConfig: {} });
      await refetchRules(true);
    } catch (error) {
      push(error instanceof Error ? error.message : '保存规则失败', 'error');
    } finally {
      setRuleBusy(false);
    }
  };

  const editRule = (rule: KnowledgeBuildRule) => {
    const softwareTrigger = rule.triggerType === 'software_created';
    const sourceConfig = rule.sourceConfig ?? {};
    setEditingRuleId(rule.id);
    setRuleExtras({
      scopeConfig: { ...(rule.scopeConfig ?? {}) },
      mappingConfig: { ...(rule.mappingConfig ?? {}) },
    });
    setRuleDraft({
      name: rule.name,
      triggerType: rule.triggerType,
      templateKey: rule.templateKey,
      category: rule.scopeConfig?.category ?? '',
      domainId:
        rule.mappingConfig?.domainId ??
        rule.scopeConfig?.domainId ??
        '',
      nodeType:
        rule.mappingConfig?.nodeType ??
        rule.scopeConfig?.nodeType ??
        'component',
      parentId: rule.mappingConfig?.parentId ?? rule.scopeConfig?.parentId ?? '',
      linkStrategy: rule.mappingConfig?.linkStrategy ?? (softwareTrigger ? 'none' : 'create_node'),
      initializeOnLink: rule.mappingConfig?.initializeOnLink ?? false,
      docsUrl: sourceConfig.docsUrl ?? '',
      refs: (sourceConfig.referenceLinks ?? []).map((link) => ({ ...link })),
    });
  };

  const cancelRuleEdit = () => {
    setEditingRuleId(null);
    setRuleDraft(emptyRuleDraft());
    setRuleExtras({ scopeConfig: {}, mappingConfig: {} });
  };

  const toggleRule = async (rule: KnowledgeBuildRule) => {
    try {
      await api.patch(`/tech/knowledge-build/rules/${rule.id}`, { enabled: !rule.enabled });
      await refetchRules(true);
    } catch (error) {
      push(error instanceof Error ? error.message : '更新规则失败', 'error');
    }
  };

  const removeRule = async (rule: KnowledgeBuildRule) => {
    if (!window.confirm(`删除规则「${rule.name}」？已创建的节点和文档不会删除。`)) return;
    try {
      await api.delete(`/tech/knowledge-build/rules/${rule.id}`);
      await refetchRules(true);
      push('规则已删除');
    } catch (error) {
      push(error instanceof Error ? error.message : '删除规则失败', 'error');
    }
  };

  const dismissPending = async (item: KnowledgeBuildPendingCandidate) => {
    try {
      await api.delete(`/tech/knowledge-build/pending/${item.id}`);
      await refetchPending(true);
    } catch (error) {
      push(error instanceof Error ? error.message : '操作失败', 'error');
    }
  };

  return (
    <div className="page kb-page">
      <div className="tech-breadcrumb">
        <Link to="/tech">
          <ArrowLeft size={12} /> 技术地图
        </Link>
        <span>/</span>
        <span>知识建档</span>
      </div>

      <PageHeader
        eyebrow="Knowledge intake · deterministic templates, no AI"
        title="知识建档"
        subtitle="选择范围、模板与官方来源，批量初始化标准草稿。自动建档不会生成未核实的技术结论，也不会覆盖已有正文。"
        actions={
          <Link to="/tech" className="btn btn-secondary">
            <ArrowLeft size={13} /> 返回技术地图
          </Link>
        }
      />

      <div className="kb-mode">
        <div className="segmented">
          <button className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')}>
            <Wand2 size={12} /> 手动建档
          </button>
          <button className={mode === 'rules' ? 'active' : ''} onClick={() => setMode('rules')}>
            <FlaskConical size={12} /> 自动规则
          </button>
        </div>
        <span className="kb-mode-note">
          默认策略：只初始化空文档，保留个人笔记，永不自动标记为已完善。
        </span>
      </div>

      {mode === 'manual' ? (
        <div className="kb-layout">
          <div className="kb-form">
            <section className="panel">
              <div className="panel-head">
                <div>
                  <span className="eyebrow">1 · Scope</span>
                  <h3>选择建档范围</h3>
                </div>
              </div>
              <div className="panel-body">
                <div className="segmented kb-scope-tabs">
                  {[
                    ['software', '软件'],
                    ['nodes', '技术节点'],
                    ['combined', '软件 + 领域'],
                    ['new', '新建知识'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      className={scopeType === value ? 'active' : ''}
                      onClick={() => setScopeType(value as KnowledgeBuildScopeType)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {(scopeType === 'software' || scopeType === 'combined') && (
                  <div className="kb-section">
                    <div className="kb-section-title">软件范围</div>
                    <div className="field-row">
                      <label className="field">
                        <span className="field-label">分类</span>
                        <select
                          className="field-input"
                          value={softwareCategory}
                          onChange={(event) => setSoftwareCategory(event.target.value)}
                        >
                          <option value="">全部分类</option>
                          {softwareCategories.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span className="field-label">筛选</span>
                        <select
                          className="field-input"
                          value={softwareSelection}
                          onChange={(event) =>
                            setSoftwareSelection(
                              event.target.value as typeof softwareSelection,
                            )
                          }
                        >
                          <option value="">请选择筛选条件</option>
                          <option value="all">全部软件（需确认范围）</option>
                          <option value="unlinked">未关联技术节点</option>
                          <option value="linked_without_markdown">已关联但无文档</option>
                          <option value="linked_draft">已关联且为草稿</option>
                        </select>
                      </label>
                    </div>
                    <input
                      className="field-input kb-search"
                      value={softwareSearch}
                      onChange={(event) => setSoftwareSearch(event.target.value)}
                      placeholder="搜索软件名称…"
                    />
                    <div className="kb-list">
                      {filteredSoftware.map((item) => (
                        <label key={item.id} className="kb-check">
                          <input
                            type="checkbox"
                            checked={softwareIds.includes(item.id)}
                            onChange={() => toggleSoftware(item.id)}
                          />
                          <span>
                            <strong>{item.name}</strong>
                            <em>
                              {item.category}
                              {item.currentVersion ? ` · 安装 ${item.currentVersion}` : ''}
                            </em>
                          </span>
                        </label>
                      ))}
                      {!filteredSoftware.length && <p className="field-hint">没有匹配的软件。</p>}
                    </div>
                    <div className="kb-list-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setSoftwareIds([])}>
                        清空选择
                      </button>
                      <span className="field-hint">已选择 {softwareIds.length} 个软件</span>
                    </div>

                    <div className="kb-section-title mt-3">未关联软件的处理方式</div>
                    <div className="field-row">
                      <label className="field">
                        <span className="field-label">目标领域</span>
                        <select
                          className="field-input"
                          value={mappingDomainId}
                          onChange={(event) => {
                            setMappingDomainId(event.target.value);
                            setMappingParentId('');
                          }}
                        >
                          <option value="">未指定（生成待办）</option>
                          {activeDomains.map((domain) => (
                            <option key={domain.id} value={domain.id}>
                              {domain.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span className="field-label">处理方式</span>
                        <select
                          className="field-input"
                          value={linkStrategy}
                          onChange={(event) =>
                            setLinkStrategy(event.target.value as KnowledgeBuildLinkStrategy)
                          }
                        >
                          {Object.entries(strategyLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="field-row">
                      <label className="field">
                        <span className="field-label">父节点</span>
                        <select
                          className="field-input"
                          value={mappingParentId}
                          onChange={(event) => setMappingParentId(event.target.value)}
                        >
                          <option value="">领域根节点</option>
                          {mappingDomainId
                            ? (allNodes?.items ?? [])
                                .filter((node) => node.domainId === mappingDomainId)
                                .map((node) => (
                                  <option key={node.id} value={node.id}>
                                    {node.name}
                                  </option>
                                ))
                            : null}
                        </select>
                      </label>
                      <label className="field">
                        <span className="field-label">节点类型</span>
                        <select
                          className="field-input"
                          value={mappingNodeType}
                          onChange={(event) =>
                            setMappingNodeType(event.target.value as TechNodeType)
                          }
                        >
                          {Object.entries(techNodeTypeLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {linkStrategy === 'link_existing' && (
                      <label className="check-row mt-3">
                        <input
                          type="checkbox"
                          checked={initializeOnLink}
                          onChange={(event) => setInitializeOnLink(event.target.checked)}
                        />
                        关联现有节点时，若该节点没有正文，同时初始化标准草稿（不会覆盖已有正文）
                      </label>
                    )}
                  </div>
                )}

                {(scopeType === 'nodes' || scopeType === 'combined') && (
                  <div className="kb-section">
                    <div className="kb-section-title">技术节点范围</div>
                    <div className="field-row">
                      <label className="field">
                        <span className="field-label">领域</span>
                        <select
                          className="field-input"
                          value={nodeDomainId}
                          onChange={(event) => {
                            setNodeDomainId(event.target.value);
                            setNodeParentId('');
                          }}
                        >
                          <option value="">全部领域</option>
                          {activeDomains.map((domain) => (
                            <option key={domain.id} value={domain.id}>
                              {domain.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span className="field-label">节点类型</span>
                        <select
                          className="field-input"
                          value={nodeType}
                          onChange={(event) => setNodeType(event.target.value as TechNodeType | '')}
                        >
                          <option value="">全部类型</option>
                          {Object.entries(techNodeTypeLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="field-row">
                      <label className="field">
                        <span className="field-label">父节点</span>
                        <select
                          className="field-input"
                          value={nodeParentId}
                          onChange={(event) => setNodeParentId(event.target.value)}
                        >
                          <option value="">不限</option>
                          {parentOptions.map((node) => (
                            <option key={node.id} value={node.id}>
                              {node.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span className="field-label">文档筛选</span>
                        <select
                          className="field-input"
                          value={nodeSelection}
                          onChange={(event) =>
                            setNodeSelection(event.target.value as typeof nodeSelection)
                          }
                        >
                          <option value="">请选择筛选条件</option>
                          <option value="all">全部节点（需确认范围）</option>
                          <option value="no_body">仅无文档</option>
                          <option value="draft">仅草稿</option>
                          <option value="needs_review">仅待核实</option>
                        </select>
                      </label>
                    </div>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={includeSubtree}
                        onChange={(event) => setIncludeSubtree(event.target.checked)}
                      />
                      包含父节点的整个子树
                    </label>
                    <input
                      className="field-input kb-search"
                      value={nodeSearch}
                      onChange={(event) => setNodeSearch(event.target.value)}
                      placeholder="搜索节点名称…"
                    />
                    <div className="kb-list">
                      {nodesForDomain
                        .filter((node) => !nodeType || node.nodeType === nodeType)
                        .filter((node) =>
                          !nodeSearch.trim()
                            ? true
                            : node.name.toLowerCase().includes(nodeSearch.trim().toLowerCase()),
                        )
                        .slice(0, 300)
                        .map((node) => (
                          <label key={node.id} className="kb-check">
                            <input
                              type="checkbox"
                              checked={nodeIds.includes(node.id)}
                              onChange={() => toggleNode(node.id)}
                            />
                            <span>
                              <strong>{node.name}</strong>
                              <em>
                                {techNodeTypeLabels[node.nodeType]} · {contentStatusLabels[node.contentStatus]}
                              </em>
                            </span>
                          </label>
                        ))}
                      {!nodesForDomain.length && <p className="field-hint">没有匹配的节点。</p>}
                    </div>
                    <div className="kb-list-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setNodeIds([])}>
                        清空选择
                      </button>
                      <span className="field-hint">已选择 {nodeIds.length} 个节点</span>
                    </div>
                  </div>
                )}

                {scopeType === 'new' && (
                  <div className="kb-section">
                    <div className="field-row">
                      <label className="field">
                        <span className="field-label">节点名称</span>
                        <input
                          className="field-input"
                          value={newNode.name}
                          onChange={(event) =>
                            setNewNode((current) => ({ ...current, name: event.target.value }))
                          }
                          placeholder="如 Raft 共识"
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">目标领域</span>
                        <select
                          className="field-input"
                          value={newNode.domainId}
                          onChange={(event) =>
                            setNewNode((current) => ({ ...current, domainId: event.target.value }))
                          }
                        >
                          <option value="">选择领域</option>
                          {activeDomains.map((domain) => (
                            <option key={domain.id} value={domain.id}>
                              {domain.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="field-row">
                      <label className="field">
                        <span className="field-label">父节点</span>
                        <select
                          className="field-input"
                          value={newNode.parentId}
                          onChange={(event) =>
                            setNewNode((current) => ({ ...current, parentId: event.target.value }))
                          }
                        >
                          <option value="">领域根节点</option>
                          {(allNodes?.items ?? [])
                            .filter((node) => node.domainId === newNode.domainId)
                            .map((node) => (
                              <option key={node.id} value={node.id}>
                                {node.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className="field">
                        <span className="field-label">节点类型</span>
                        <select
                          className="field-input"
                          value={newNode.nodeType}
                          onChange={(event) =>
                            setNewNode((current) => ({
                              ...current,
                              nodeType: event.target.value as TechNodeType,
                            }))
                          }
                        >
                          {Object.entries(techNodeTypeLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="field mt-3">
                      <span className="field-label">节点摘要（可选，最多 500 字符）</span>
                      <input
                        className="field-input"
                        maxLength={500}
                        value={newNode.summary}
                        onChange={(event) =>
                          setNewNode((current) => ({ ...current, summary: event.target.value }))
                        }
                        placeholder="只填写已确认的事实，不写未核实的技术结论"
                      />
                    </label>
                  </div>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <span className="eyebrow">2 · Template & sources</span>
                  <h3>模板与官方来源</h3>
                </div>
              </div>
              <div className="panel-body">
                <div className="kb-template-grid">
                  {(templates ?? []).map((template) => (
                    <button
                      key={template.key}
                      type="button"
                      className={`kb-template-card ${templateKey === template.key ? 'active' : ''}`}
                      onClick={() => setTemplateKey(template.key)}
                    >
                      <strong>{template.name}</strong>
                      <span>{template.description}</span>
                      <em>
                        {template.sections.length} 个固定章节 · v{template.version}
                      </em>
                    </button>
                  ))}
                </div>

                <label className="field mt-3">
                  <span className="field-label">官方文档地址（可选）</span>
                  <input
                    className="field-input"
                    value={docsUrl}
                    onChange={(event) => setDocsUrl(event.target.value)}
                    placeholder="https://…"
                  />
                </label>
                <div className="kb-source-head">
                  <span className="field-label">参考来源</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setReferenceLinks((current) => [...current, { label: '', url: '' }])}
                  >
                    <Plus size={12} /> 添加
                  </button>
                </div>
                <div className="kb-source-list">
                  {referenceLinks.map((link, index) => (
                    <div className="kb-source-row" key={index}>
                      <input
                        className="field-input"
                        value={link.label}
                        onChange={(event) => setLink(index, { label: event.target.value })}
                        placeholder="来源名称"
                      />
                      <input
                        className="field-input"
                        value={link.url}
                        onChange={(event) => setLink(index, { url: event.target.value })}
                        placeholder="https://…"
                      />
                      <button
                        className="icon-btn"
                        aria-label="删除来源"
                        onClick={() =>
                          setReferenceLinks((current) => current.filter((_, position) => position !== index))
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="kb-source-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => void checkUrls()} disabled={busy === 'urls'}>
                    <ShieldCheck size={12} /> {busy === 'urls' ? '检查中…' : '检查链接'}
                  </button>
                  <span className="field-hint">只检查 HTTPS 可达性，不判断技术结论是否正确。</span>
                </div>
                {urlResults.length > 0 && (
                  <div className="kb-url-results">
                    {urlResults.map((item) => (
                      <div key={item.url} className={`kb-url-result is-${item.status}`}>
                        <span>{item.status === 'ok' || item.status === 'redirect' ? <Check size={11} /> : <CircleAlert size={11} />}</span>
                        <div>
                          <strong>{item.url}</strong>
                          <em>
                            {item.status}
                            {item.httpStatus ? ` · HTTP ${item.httpStatus}` : ''}
                            {item.title ? ` · ${item.title}` : ''}
                          </em>
                          {item.warning && <small>{item.warning}</small>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="kb-filter-grid mt-3">
                  <label className="check-row">
                    <input type="checkbox" checked={onlyMissing} onChange={(event) => setOnlyMissing(event.target.checked)} />
                    仅处理无文档项
                  </label>
                  <label className="check-row">
                    <input type="checkbox" checked={onlyDraft} onChange={(event) => setOnlyDraft(event.target.checked)} />
                    仅处理草稿
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={skipVerified}
                      onChange={(event) => setSkipVerified(event.target.checked)}
                    />
                    跳过已验证项
                  </label>
                  <label className="check-row">
                    <input type="checkbox" checked disabled />
                    永不覆盖已有正文
                  </label>
                  <label className="check-row">
                    <input type="checkbox" checked disabled />
                    仅处理活跃项，跳过归档
                  </label>
                </div>
                <div className="field-row mt-3">
                  <label className="field">
                    <span className="field-label">排除软件 ID（逗号分隔）</span>
                    <input
                      className="field-input"
                      value={excludeSoftwareIds}
                      onChange={(event) => setExcludeSoftwareIds(event.target.value)}
                      placeholder="可留空"
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">排除节点 ID（逗号分隔）</span>
                    <input
                      className="field-input"
                      value={excludeNodeIds}
                      onChange={(event) => setExcludeNodeIds(event.target.value)}
                      placeholder="可留空"
                    />
                  </label>
                </div>
              </div>
            </section>
          </div>

          <aside className="kb-preview">
            <section className="panel">
              <div className="panel-head">
                <div>
                  <span className="eyebrow">3 · Preview</span>
                  <h3>执行预览</h3>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => void runPreview()} disabled={busy === 'preview'}>
                  <RefreshCw size={12} /> {busy === 'preview' ? '生成中…' : '生成预览'}
                </button>
              </div>
              <div className="panel-body">
                {!preview ? (
                  <EmptyState
                    icon={BookOpenCheck}
                    compact
                    title="还没有预览"
                    description="先明确范围，再生成预览。系统不会默认处理整个软件目录或整张技术地图。"
                  />
                ) : (
                  <>
                    <p className="field-hint">
                      预览有效期至 {new Date(preview.expiresAt).toLocaleTimeString()}。范围或数据变化后需要重新预览。
                    </p>
                    <div className="kb-counts">
                      {[
                        ['选中软件', preview.counts.selectedSoftware],
                        ['选中节点', preview.counts.selectedNodes],
                        ['新建节点', preview.counts.createNode],
                        ['关联现有', preview.counts.linkExisting],
                        ['关联并初始化', preview.counts.linkAndInitialize],
                        ['初始化文档', preview.counts.initializeDoc],
                        ['跳过', preview.counts.skip],
                        ['待人工决定', preview.counts.pending],
                        ['缺少官方来源', preview.counts.missingOfficialSource],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="kb-count">
                          <strong>{value}</strong>
                          <span>{label}</span>
                        </div>
                      ))}
                    </div>
                    {preview.warnings.length > 0 && (
                      <div className="kb-warnings">
                        {preview.warnings.map((warning) => (
                          <p key={warning}>
                            <CircleAlert size={11} /> {warning}
                          </p>
                        ))}
                      </div>
                    )}
                    <div className="kb-items">
                      {preview.items.slice(0, 120).map((item) => (
                        <div key={item.key} className={`kb-item action-${item.action}`}>
                          <Badge tone={item.action === 'pending' ? 'pill-warn' : item.action === 'skip' ? 'pill-neutral' : 'pill-calm'}>
                            {actionLabels[item.action]}
                          </Badge>
                          <div>
                            <strong>{item.nodeName || item.softwareName || '未命名'}</strong>
                            {item.softwareName && item.nodeName !== item.softwareName && (
                              <em>软件：{item.softwareName}</em>
                            )}
                            {item.domainName && <em>{item.domainName}</em>}
                            {item.reason && <small>{item.reason}</small>}
                          </div>
                        </div>
                      ))}
                    </div>
                    {preview.items.length > 120 && (
                      <p className="field-hint">仅显示前 120 项，共 {preview.items.length} 项。</p>
                    )}
                    <label className="check-row kb-confirm">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                      我确认以上范围。执行只初始化空文档，不覆盖已有 Markdown、不修改个人笔记、不自动标记为已完善。
                    </label>
                    <button
                      className="btn btn-primary kb-execute"
                      disabled={!confirmed || busy === 'execute'}
                      onClick={() => void runExecute()}
                    >
                      <Play size={13} /> {busy === 'execute' ? '执行中…' : '执行建档'}
                    </button>
                  </>
                )}
              </div>
            </section>

            {result && (
              <section className="panel mt-4">
                <div className="panel-head">
                  <div>
                    <span className="eyebrow">Result</span>
                    <h3>执行结果</h3>
                  </div>
                </div>
                <div className="panel-body">
                  <div className="kb-result-counts">
                    {Object.entries(resultLabels).map(([status, label]) => (
                      <span key={status} className={`pill ${status === 'failed' ? 'pill-danger' : status === 'pending' ? 'pill-warn' : 'pill-calm'}`}>
                        {label} {result.counts[status as keyof typeof result.counts]}
                      </span>
                    ))}
                  </div>
                  <div className="kb-items">
                    {result.items.map((item) => (
                      <div key={item.key} className={`kb-item result-${item.status}`}>
                        <Badge tone={item.status === 'failed' ? 'pill-danger' : item.status === 'pending' ? 'pill-warn' : 'pill-calm'}>
                          {resultLabels[item.status]}
                        </Badge>
                        <div>
                          <strong>{item.nodeName || item.softwareName || '未命名'}</strong>
                          <small>{item.message}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </aside>
        </div>
      ) : (
        <div className="kb-rules-layout">
          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">Automatic rules</span>
                <h3>{editingRuleId ? '编辑自动建档规则' : '新建自动建档规则'}</h3>
              </div>
            </div>
            <div className="panel-body">
              <label className="field">
                <span className="field-label">规则名称</span>
                <input
                  className="field-input"
                  value={ruleDraft.name}
                  onChange={(event) => setRuleDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="如：新增数据库软件时创建组件节点"
                />
              </label>
              <div className="field-row mt-3">
                <label className="field">
                  <span className="field-label">触发方式</span>
                  <select
                    className="field-input"
                    value={ruleDraft.triggerType}
                    onChange={(event) =>
                      setRuleDraft((current) => ({
                        ...current,
                        triggerType: event.target.value as KnowledgeBuildTriggerType,
                      }))
                    }
                  >
                    {Object.entries(triggerLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">模板</span>
                  <select
                    className="field-input"
                    value={ruleDraft.templateKey}
                    onChange={(event) =>
                      setRuleDraft((current) => ({
                        ...current,
                        templateKey: event.target.value as KnowledgeBuildTemplateKey,
                      }))
                    }
                  >
                    {(templates ?? []).map((template) => (
                      <option key={template.key} value={template.key}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {ruleDraft.triggerType === 'software_created' ? (
                <>
                  <div className="field-row mt-3">
                    <label className="field">
                      <span className="field-label">软件分类筛选（可选）</span>
                      <select
                        className="field-input"
                        value={ruleDraft.category}
                        onChange={(event) =>
                          setRuleDraft((current) => ({ ...current, category: event.target.value }))
                        }
                      >
                        <option value="">全部分类</option>
                        {softwareCategories.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span className="field-label">目标领域</span>
                      <select
                        className="field-input"
                        value={ruleDraft.domainId}
                        onChange={(event) =>
                          setRuleDraft((current) => ({ ...current, domainId: event.target.value }))
                        }
                      >
                        <option value="">未指定（生成待办）</option>
                        {activeDomains.map((domain) => (
                          <option key={domain.id} value={domain.id}>
                            {domain.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="field-row mt-3">
                    <label className="field">
                      <span className="field-label">关联策略</span>
                      <select
                        className="field-input"
                        value={ruleDraft.linkStrategy}
                        onChange={(event) =>
                          setRuleDraft((current) => ({
                            ...current,
                            linkStrategy: event.target.value as KnowledgeBuildLinkStrategy,
                          }))
                        }
                      >
                        {Object.entries(strategyLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span className="field-label">节点类型</span>
                      <select
                        className="field-input"
                        value={ruleDraft.nodeType}
                        onChange={(event) =>
                          setRuleDraft((current) => ({
                            ...current,
                            nodeType: event.target.value as TechNodeType,
                          }))
                        }
                      >
                        {Object.entries(techNodeTypeLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {ruleDraft.linkStrategy === 'link_existing' && (
                    <label className="check-row mt-3">
                      <input
                        type="checkbox"
                        checked={ruleDraft.initializeOnLink}
                        onChange={(event) =>
                          setRuleDraft((current) => ({
                            ...current,
                            initializeOnLink: event.target.checked,
                          }))
                        }
                      />
                      关联现有节点时初始化空文档（已有正文不覆盖）
                    </label>
                  )}
                  <label className="field mt-3">
                    <span className="field-label">父节点（可选）</span>
                    <select
                      className="field-input"
                      value={ruleDraft.parentId}
                      onChange={(event) =>
                        setRuleDraft((current) => ({ ...current, parentId: event.target.value }))
                      }
                    >
                      <option value="">领域根节点</option>
                      {(allNodes?.items ?? [])
                        .filter((node) => node.domainId === ruleDraft.domainId)
                        .map((node) => (
                          <option key={node.id} value={node.id}>
                            {node.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </>
              ) : (
                <div className="field-row mt-3">
                  <label className="field">
                    <span className="field-label">目标领域筛选</span>
                    <select
                      className="field-input"
                      value={ruleDraft.domainId}
                      onChange={(event) =>
                        setRuleDraft((current) => ({ ...current, domainId: event.target.value }))
                      }
                    >
                      <option value="">全部领域</option>
                      {activeDomains.map((domain) => (
                        <option key={domain.id} value={domain.id}>
                          {domain.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field-label">节点类型筛选</span>
                    <select
                      className="field-input"
                      value={ruleDraft.nodeType}
                      onChange={(event) =>
                        setRuleDraft((current) => ({
                          ...current,
                          nodeType: event.target.value as TechNodeType,
                        }))
                      }
                    >
                      {Object.entries(techNodeTypeLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              <label className="field mt-3">
                <span className="field-label">官方文档地址（可选）</span>
                <input
                  className="field-input"
                  value={ruleDraft.docsUrl}
                  onChange={(event) =>
                    setRuleDraft((current) => ({ ...current, docsUrl: event.target.value }))
                  }
                  placeholder="https://…"
                />
              </label>
              <div className="kb-source-head">
                <span className="field-label">规则来源</span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    setRuleDraft((current) => ({
                      ...current,
                      refs: [...current.refs, { label: '', url: '' }],
                    }))
                  }
                >
                  <Plus size={12} /> 添加
                </button>
              </div>
              <div className="kb-source-list">
                {ruleDraft.refs.map((link, index) => (
                  <div className="kb-source-row" key={index}>
                    <input
                      className="field-input"
                      value={link.label}
                      onChange={(event) =>
                        setRuleDraft((current) => ({
                          ...current,
                          refs: current.refs.map((item, position) =>
                            position === index ? { ...item, label: event.target.value } : item,
                          ),
                        }))
                      }
                      placeholder="来源名称"
                    />
                    <input
                      className="field-input"
                      value={link.url}
                      onChange={(event) =>
                        setRuleDraft((current) => ({
                          ...current,
                          refs: current.refs.map((item, position) =>
                            position === index ? { ...item, url: event.target.value } : item,
                          ),
                        }))
                      }
                      placeholder="https://…"
                    />
                    <button
                      className="icon-btn"
                      aria-label="删除来源"
                      onClick={() =>
                        setRuleDraft((current) => ({
                          ...current,
                          refs: current.refs.filter((_, position) => position !== index),
                        }))
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="field-hint mt-3">
                自动规则只在创建软件或节点时运行。无法确定领域、父节点或关联方式时，会生成待处理项，不会猜测。
              </p>
              <div className="field-row mt-3">
                <button className="btn btn-primary" disabled={ruleBusy} onClick={() => void saveRule()}>
                  {ruleBusy
                    ? '保存中…'
                    : editingRuleId
                      ? '保存修改'
                      : '创建规则'}
                </button>
                {editingRuleId && (
                  <button className="btn btn-ghost" onClick={cancelRuleEdit}>
                    取消编辑
                  </button>
                )}
              </div>
            </div>
          </section>

          <div className="kb-rule-list">
            <section className="panel">
              <div className="panel-head">
                <div>
                  <span className="eyebrow">Configured</span>
                  <h3>规则列表</h3>
                </div>
                <span className="section-count">{rules?.length ?? 0}</span>
              </div>
              <div className="panel-body">
                {!rules?.length ? (
                  <EmptyState
                    icon={FlaskConical}
                    compact
                    title="还没有自动规则"
                    description="自动模式默认关闭。创建规则后，它只对之后新增的软件或节点生效。"
                  />
                ) : (
                  <div className="kb-rules">
                    {rules.map((rule) => (
                      <div key={rule.id} className={`kb-rule ${rule.enabled ? '' : 'is-paused'}`}>
                        <div className="kb-rule-head">
                          <strong>{rule.name}</strong>
                          <Badge tone={rule.enabled ? 'pill-calm' : 'pill-neutral'}>
                            {rule.enabled ? '启用' : '已暂停'}
                          </Badge>
                        </div>
                        <div className="kb-rule-meta">
                          <span>{triggerLabels[rule.triggerType]}</span>
                          <span>{rule.templateKey}</span>
                          <span>{strategyLabels[rule.mappingConfig.linkStrategy ?? 'none']}</span>
                        </div>
                        <div className="kb-rule-meta">
                          <span>最近运行：{rule.lastRunAt ? new Date(rule.lastRunAt).toLocaleString() : '尚未运行'}</span>
                          {rule.lastRunStatus && <span>结果：{rule.lastRunStatus}</span>}
                        </div>
                        {rule.lastError && <p className="field-hint">{rule.lastError}</p>}
                        <div className="kb-rule-actions">
                          <button className="btn btn-ghost btn-sm" onClick={() => editRule(rule)}>
                            <RefreshCw size={12} /> 编辑
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => void toggleRule(rule)}>
                            {rule.enabled ? <Pause size={12} /> : <Play size={12} />}
                            {rule.enabled ? '暂停' : '启用'}
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => void removeRule(rule)}>
                            <Trash2 size={12} /> 删除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="panel mt-4">
              <div className="panel-head">
                <div>
                  <span className="eyebrow">Needs decision</span>
                  <h3>待处理建档项</h3>
                </div>
                <span className="section-count">{pending?.length ?? 0}</span>
              </div>
              <div className="panel-body">
                {!pending?.length ? (
                  <p className="field-hint">没有待处理项。规则无法安全决定目标时，会出现在这里。</p>
                ) : (
                  <div className="kb-pending">
                    {pending.map((item) => (
                      <div key={item.id} className="kb-pending-item">
                        <div>
                          <strong>{item.name}</strong>
                          <em>{item.sourceType === 'software' ? '软件' : '技术节点'} · {item.reason}</em>
                        </div>
                        <div className="kb-pending-actions">
                          <Link
                            to={`/tech/build?${item.sourceType === 'software' ? 'softwareId' : 'nodeId'}=${encodeURIComponent(item.sourceId)}`}
                            className="btn btn-secondary btn-sm"
                          >
                            <ExternalLink size={11} /> 手动处理
                          </Link>
                          <button className="btn btn-ghost btn-sm" onClick={() => void dismissPending(item)}>
                            忽略
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
