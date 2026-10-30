import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { TechExternalLink, TechFocusLevel, TechMasteryStatus, TechNode, TechNodeType } from '@shared/types';
import { api } from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { Modal } from './ui';
import {
  focusLabels,
  masteryLabels,
  masteryOrder,
  techNodeTypeLabels,
} from '../lib/tech';

interface Draft {
  name: string;
  nodeType: TechNodeType;
  summary: string;
  description: string;
  technicalRole: string;
  corePrinciple: string;
  solvedProblem: string;
  keyMechanism: string;
  useCases: string;
  commonIssues: string;
  docsUrl: string;
  repoUrl: string;
  referenceLinks: TechExternalLink[];
  personalNotes: string;
  researchQuestions: string;
  masteryStatus: TechMasteryStatus;
  focusLevel: TechFocusLevel;
}

const emptyDraft: Draft = {
  name: '',
  nodeType: 'concept',
  summary: '',
  description: '',
  technicalRole: '',
  corePrinciple: '',
  solvedProblem: '',
  keyMechanism: '',
  useCases: '',
  commonIssues: '',
  docsUrl: '',
  repoUrl: '',
  referenceLinks: [],
  personalNotes: '',
  researchQuestions: '',
  masteryStatus: 'unknown',
  focusLevel: 'normal',
};

export function TechNodeFormDialog({
  open,
  onClose,
  domainId,
  parentId,
  parentName,
  node,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  domainId: string;
  parentId?: string | null;
  parentName?: string | null;
  node?: TechNode | null;
  onSaved: (node: TechNode) => void;
}) {
  const { push } = useToast();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(
      node
        ? {
            name: node.name,
            nodeType: node.nodeType,
            summary: node.summary ?? '',
            description: node.description ?? '',
            technicalRole: node.technicalRole ?? '',
            corePrinciple: node.corePrinciple ?? '',
            solvedProblem: node.solvedProblem ?? '',
            keyMechanism: node.keyMechanism ?? '',
            useCases: node.useCases ?? '',
            commonIssues: node.commonIssues ?? '',
            docsUrl: node.docsUrl ?? '',
            repoUrl: node.repoUrl ?? '',
            referenceLinks: node.referenceLinks ?? [],
            personalNotes: node.personalNotes ?? '',
            researchQuestions: node.researchQuestions ?? '',
            masteryStatus: node.masteryStatus,
            focusLevel: node.focusLevel,
          }
        : emptyDraft,
    );
  }, [open, node]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!draft.name.trim()) {
      push('节点需要一个名称', 'error');
      return;
    }
    const links = draft.referenceLinks
      .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
      .filter((link) => link.label && link.url);
    if (links.some((link) => !/^https?:\/\//i.test(link.url))) {
      push('参考链接需要以 http:// 或 https:// 开头', 'error');
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...draft,
        name: draft.name.trim(),
        summary: draft.summary || null,
        description: draft.description || null,
        technicalRole: draft.technicalRole || null,
        corePrinciple: draft.corePrinciple || null,
        solvedProblem: draft.solvedProblem || null,
        keyMechanism: draft.keyMechanism || null,
        useCases: draft.useCases || null,
        commonIssues: draft.commonIssues || null,
        docsUrl: draft.docsUrl || null,
        repoUrl: draft.repoUrl || null,
        referenceLinks: links,
        personalNotes: draft.personalNotes || null,
        researchQuestions: draft.researchQuestions || null,
      };
      const saved = node
        ? await api.patch<TechNode>(`/tech/nodes/${node.id}`, body)
        : await api.post<TechNode>(`/tech/domains/${domainId}/nodes`, {
            ...body,
            parentId: parentId ?? null,
          });
      push(node ? '节点已更新' : '节点已创建');
      onSaved(saved);
      onClose();
    } catch (error) {
      push(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      eyebrow={node ? 'Edit node' : 'New node'}
      title={node ? `编辑「${node.name}」` : parentName ? `在「${parentName}」下新增节点` : '新增技术节点'}
      description="节点是可被树、架构视图和知识笔记共同引用的最小知识单元。"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : node ? '保存节点' : '创建节点'}
          </button>
        </>
      }
    >
      <div className="tech-form-grid">
        <label className="field">
          <span className="field-label">名称</span>
          <input
            className="field-input"
            value={draft.name}
            onChange={(event) => set('name', event.target.value)}
            placeholder="如 kube-apiserver"
            autoFocus
          />
        </label>
        <label className="field">
          <span className="field-label">节点类型</span>
          <select
            className="field-input"
            value={draft.nodeType}
            onChange={(event) => set('nodeType', event.target.value as TechNodeType)}
          >
            {Object.entries(techNodeTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">掌握状态</span>
          <select
            className="field-input"
            value={draft.masteryStatus}
            onChange={(event) => set('masteryStatus', event.target.value as TechMasteryStatus)}
          >
            {masteryOrder.map((value) => (
              <option key={value} value={value}>
                {masteryLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">关注级别</span>
          <select
            className="field-input"
            value={draft.focusLevel}
            onChange={(event) => set('focusLevel', event.target.value as TechFocusLevel)}
          >
            {Object.entries(focusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field tech-form-full">
          <span className="field-label">一句话摘要</span>
          <input
            className="field-input"
            value={draft.summary}
            onChange={(event) => set('summary', event.target.value)}
            placeholder="用一句话说明它是什么、解决什么问题"
            maxLength={500}
          />
        </label>

        <div className="tech-form-section tech-form-full">技术理解</div>
        <label className="field tech-form-full">
          <span className="field-label">它是什么</span>
          <textarea
            className="field-textarea"
            value={draft.description}
            onChange={(event) => set('description', event.target.value)}
            rows={3}
            placeholder="定义、定位与边界"
          />
        </label>
        <label className="field">
          <span className="field-label">技术角色</span>
          <textarea
            className="field-textarea"
            value={draft.technicalRole}
            onChange={(event) => set('technicalRole', event.target.value)}
            rows={3}
            placeholder="在整体架构中承担什么职责"
          />
        </label>
        <label className="field">
          <span className="field-label">解决的问题</span>
          <textarea
            className="field-textarea"
            value={draft.solvedProblem}
            onChange={(event) => set('solvedProblem', event.target.value)}
            rows={3}
            placeholder="没有它时会遇到什么问题"
          />
        </label>
        <label className="field">
          <span className="field-label">核心原理</span>
          <textarea
            className="field-textarea"
            value={draft.corePrinciple}
            onChange={(event) => set('corePrinciple', event.target.value)}
            rows={3}
            placeholder="为什么它能工作"
          />
        </label>
        <label className="field">
          <span className="field-label">关键机制</span>
          <textarea
            className="field-textarea"
            value={draft.keyMechanism}
            onChange={(event) => set('keyMechanism', event.target.value)}
            rows={3}
            placeholder="对象、协议、流程或算法"
          />
        </label>
        <label className="field">
          <span className="field-label">典型使用场景</span>
          <textarea
            className="field-textarea"
            value={draft.useCases}
            onChange={(event) => set('useCases', event.target.value)}
            rows={3}
          />
        </label>
        <label className="field">
          <span className="field-label">常见问题</span>
          <textarea
            className="field-textarea"
            value={draft.commonIssues}
            onChange={(event) => set('commonIssues', event.target.value)}
            rows={3}
            placeholder="排障时最容易踩的坑"
          />
        </label>

        <div className="tech-form-section tech-form-full">外部资料</div>
        <label className="field">
          <span className="field-label">官方文档</span>
          <input
            className="field-input"
            value={draft.docsUrl}
            onChange={(event) => set('docsUrl', event.target.value)}
            placeholder="https://..."
          />
        </label>
        <label className="field">
          <span className="field-label">代码仓库</span>
          <input
            className="field-input"
            value={draft.repoUrl}
            onChange={(event) => set('repoUrl', event.target.value)}
            placeholder="https://github.com/..."
          />
        </label>

        <div className="tech-form-full">
          <div className="tech-form-links-head">
            <span className="field-label">文章与参考链接</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() =>
                set('referenceLinks', [...draft.referenceLinks, { label: '', url: '' }])
              }
              type="button"
            >
              <Plus size={12} /> 添加链接
            </button>
          </div>
          {draft.referenceLinks.length === 0 ? (
            <p className="tech-form-hint">可以放官方设计文档、源码目录或值得反复读的文章。</p>
          ) : (
            <div className="tech-form-links">
              {draft.referenceLinks.map((link, index) => (
                <div className="tech-form-link-row" key={index}>
                  <input
                    className="field-input"
                    value={link.label}
                    onChange={(event) => {
                      const next = [...draft.referenceLinks];
                      next[index] = { ...next[index], label: event.target.value };
                      set('referenceLinks', next);
                    }}
                    placeholder="标题"
                  />
                  <input
                    className="field-input"
                    value={link.url}
                    onChange={(event) => {
                      const next = [...draft.referenceLinks];
                      next[index] = { ...next[index], url: event.target.value };
                      set('referenceLinks', next);
                    }}
                    placeholder="https://..."
                  />
                  <button
                    className="icon-btn"
                    type="button"
                    aria-label="移除链接"
                    onClick={() =>
                      set(
                        'referenceLinks',
                        draft.referenceLinks.filter((_, rowIndex) => rowIndex !== index),
                      )
                    }
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="tech-form-section tech-form-full">个人认知</div>
        <label className="field">
          <span className="field-label">个人笔记</span>
          <textarea
            className="field-textarea"
            value={draft.personalNotes}
            onChange={(event) => set('personalNotes', event.target.value)}
            rows={4}
            placeholder="你的理解、类比和结论"
          />
        </label>
        <label className="field">
          <span className="field-label">待研究问题</span>
          <textarea
            className="field-textarea"
            value={draft.researchQuestions}
            onChange={(event) => set('researchQuestions', event.target.value)}
            rows={4}
            placeholder="还不确定、需要继续验证的问题"
          />
        </label>
      </div>
    </Modal>
  );
}
