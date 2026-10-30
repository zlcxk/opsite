import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BellOff,
  Filter,
  Inbox,
  Radar,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
} from 'lucide-react';
import type { FollowTarget, FollowTargetType, SubscriptionRule } from '@shared/types';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { api } from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { formatDate } from '../lib/format';
import { notificationRuleMeta, targetTypeMeta } from '../lib/notification-labels';
import { EmptyState, LoadingBlock, Modal, PageHeader } from '../components/ui';
import { NotificationRuleEditor } from '../components/NotificationRuleEditor';

type TypeFilter = 'all' | FollowTargetType;

const typeOrder: FollowTargetType[] = ['software', 'radar', 'discovery', 'advisory'];

export function Follows() {
  useDocumentTitle('关注与订阅');
  const { data, loading, error, refetch } = useApi<{ items: FollowTarget[] }>('/follows');
  const { data: ruleData, refetch: refetchRules } = useApi<{ rules: SubscriptionRule[] }>(
    '/notification-rules',
  );
  const { push } = useToast();
  const [type, setType] = useState<TypeFilter>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<FollowTarget | null>(null);
  const [draft, setDraft] = useState<SubscriptionRule[]>([]);
  const [saving, setSaving] = useState(false);
  const [globalOpen, setGlobalOpen] = useState(false);
  const [globalDraft, setGlobalDraft] = useState<SubscriptionRule[]>([]);
  const [savingGlobal, setSavingGlobal] = useState(false);

  const items = data?.items ?? [];
  const globalRules = ruleData?.rules ?? [];

  const counts = useMemo(() => {
    const result: Record<FollowTargetType, number> = {
      software: 0,
      radar: 0,
      discovery: 0,
      advisory: 0,
    };
    for (const item of items) result[item.targetType] += 1;
    return result;
  }, [items]);

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return items.filter((item) => {
      if (type !== 'all' && item.targetType !== type) return false;
      if (!search) return true;
      return (
        item.targetName.toLowerCase().includes(search) ||
        (item.targetSubtitle ?? '').toLowerCase().includes(search)
      );
    });
  }, [items, type, query]);

  const feedFollow = items.find(
    (item) => item.targetType === 'discovery' && item.targetId === 'feed',
  );

  const followFeed = async () => {
    try {
      await api.post('/follows', { targetType: 'discovery', targetId: 'feed' });
      push('已关注技术发现流');
      await refetch(true);
    } catch (followError) {
      push(followError instanceof Error ? followError.message : '关注失败', 'error');
    }
  };

  const openRules = (item: FollowTarget) => {
    setEditing(item);
    setDraft(item.effectiveRules.map((rule) => ({ ...rule })));
  };

  const saveRules = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const result = await api.patch<{ follow: FollowTarget }>(
        `/follows/${editing.id}/rules`,
        { rules: draft },
      );
      push(`已保存「${editing.targetName}」的订阅规则`);
      setEditing(null);
      await refetch(true);
      if (result.follow) {
        // Keep the modal's source object in sync for the next open.
        setDraft(result.follow.effectiveRules);
      }
    } catch (saveError) {
      push(saveError instanceof Error ? saveError.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const resetRules = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await api.delete(`/follows/${editing.id}/rules`);
      push('已恢复为全局默认规则');
      setEditing(null);
      await refetch(true);
    } catch (resetError) {
      push(resetError instanceof Error ? resetError.message : '恢复失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: FollowTarget) => {
    try {
      await api.delete(`/follows/${item.id}`);
      push(`已取消关注「${item.targetName}」`);
      await refetch(true);
    } catch (removeError) {
      push(removeError instanceof Error ? removeError.message : '取消失败', 'error');
    }
  };

  const openGlobal = () => {
    setGlobalDraft(globalRules.map((rule) => ({ ...rule })));
    setGlobalOpen(true);
  };

  const saveGlobal = async () => {
    setSavingGlobal(true);
    try {
      await api.patch('/notification-rules', { rules: globalDraft });
      push('全局默认规则已保存');
      setGlobalOpen(false);
      await refetchRules(true);
      await refetch(true);
    } catch (saveError) {
      push(saveError instanceof Error ? saveError.message : '保存失败', 'error');
    } finally {
      setSavingGlobal(false);
    }
  };

  const enabledSummary = (rules: SubscriptionRule[]) => {
    const inApp = rules.filter((rule) => rule.inApp).length;
    const email = rules.filter((rule) => rule.email).length;
    return `${inApp} 类站内 · ${email} 类邮件`;
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Follows & subscriptions"
        title="关注与订阅"
        subtitle="关注对象决定“谁的变化值得通知”，订阅规则决定“通过哪个渠道提醒”。单个对象可以覆盖全局默认。"
        actions={
          <>
            {!feedFollow && (
              <button className="btn btn-secondary" onClick={() => void followFeed()}>
                <Radar size={13} /> 关注发现流
              </button>
            )}
            <button className="btn btn-primary" onClick={openGlobal}>
              <SlidersHorizontal size={13} /> 全局默认规则
            </button>
          </>
        }
      />

      <div className="stat-grid">
        {typeOrder.map((targetType) => (
          <div className="stat-card" key={targetType}>
            <span className="stat-label">{targetTypeMeta[targetType].code}</span>
            <span className="stat-value">{counts[targetType]}</span>
            <div className="stat-foot">{targetTypeMeta[targetType].label}关注</div>
          </div>
        ))}
      </div>

      <div className="filter-bar mt-5">
        <div className="filter-chips">
          <button className={`chip ${type === 'all' ? 'active' : ''}`} onClick={() => setType('all')}>
            全部
          </button>
          {typeOrder.map((targetType) => (
            <button
              key={targetType}
              className={`chip ${type === targetType ? 'active' : ''}`}
              onClick={() => setType(targetType)}
            >
              {targetTypeMeta[targetType].label}
            </button>
          ))}
        </div>
        <div className="filter-spacer" />
        <div className="inline-search">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="关注对象名称、说明"
            aria-label="搜索关注对象"
          />
        </div>
        <Link to="/notifications" className="btn btn-secondary btn-sm">
          <Inbox size={12} /> 通知中心
        </Link>
      </div>

      {error && <div className="error-note mb-3">{error}</div>}

      <section className="follow-global-note">
        <div>
          <span className="eyebrow no-rule">Global defaults</span>
          <strong>全局默认规则</strong>
          <p>
            {globalRules.length
              ? enabledSummary(globalRules)
              : '尚未加载全局规则'}
            。单个关注对象保存规则后会形成独立覆盖，可随时恢复默认。
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={openGlobal}>
          <Settings2 size={12} /> 编辑
        </button>
      </section>

      {loading && !data ? (
        <LoadingBlock />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Filter}
          title={items.length ? '没有符合条件的关注对象' : '还没有关注任何对象'}
          description={
            items.length
              ? '调整类型或搜索关键词。'
              : '可以在软件详情、雷达条目或漏洞公告中点击“关注”，也可以直接关注技术发现流。'
          }
          actions={
            <Link to="/software" className="btn btn-primary">
              浏览软件
            </Link>
          }
        />
      ) : (
        <div className="follow-list">
          {filtered.map((item) => {
            const meta = targetTypeMeta[item.targetType];
            const enabled = item.effectiveRules.filter((rule) => rule.inApp || rule.email);
            return (
              <article className="follow-row" key={item.id}>
                <span className="follow-type mono">{meta.code}</span>
                <div className="follow-main">
                  <div className="follow-title-row">
                    <strong>{item.targetName}</strong>
                    {item.hasOverrides && <span className="pill pill-note">自定义规则</span>}
                  </div>
                  <p>{item.targetSubtitle || meta.label}</p>
                  <div className="follow-meta">
                    <span>{enabledSummary(item.effectiveRules)}</span>
                    {enabled.length > 0 && (
                      <span className="follow-enabled-rules">
                        {enabled
                          .slice(0, 3)
                          .map((rule) => notificationRuleMeta[rule.eventType].label)
                          .join(' · ')}
                        {enabled.length > 3 ? ` 等 ${enabled.length} 类` : ''}
                      </span>
                    )}
                    <span>{formatDate(item.createdAt)} 关注</span>
                  </div>
                </div>
                <div className="follow-actions">
                  {item.targetUrl && (
                    <Link className="btn btn-ghost btn-sm" to={item.targetUrl}>
                      打开
                    </Link>
                  )}
                  <button className="btn btn-secondary btn-sm" onClick={() => openRules(item)}>
                    <Settings2 size={12} /> 规则
                  </button>
                  <button
                    className="btn btn-ghost btn-sm follow-remove"
                    onClick={() => void remove(item)}
                    aria-label={`取消关注 ${item.targetName}`}
                  >
                    <BellOff size={12} /> 取消关注
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[0.6875rem] text-[var(--muted-2)]">
        <span>共 {items.length} 个关注对象 · {filtered.length} 条当前可见</span>
        <span>取消关注不会删除已有通知和历史情报事件</span>
      </div>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        eyebrow="Per-target subscription"
        title={editing ? `${editing.targetName} · 订阅规则` : '订阅规则'}
        description="勾选站内或邮件渠道，并设置触发通知的最低级别。关闭两个渠道即停止该类型提醒。"
        wide
        footer={
          <>
            {editing?.hasOverrides && (
              <button className="btn btn-ghost" onClick={() => void resetRules()} disabled={saving}>
                <RotateCcw size={12} /> 恢复全局默认
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => setEditing(null)} disabled={saving}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => void saveRules()} disabled={saving}>
              {saving ? '保存中…' : '保存规则'}
            </button>
          </>
        }
      >
        <NotificationRuleEditor rules={draft} onChange={setDraft} disabled={saving} />
      </Modal>

      <Modal
        open={globalOpen}
        onClose={() => setGlobalOpen(false)}
        eyebrow="Global subscription defaults"
        title="全局默认规则"
        description="未单独设置规则的关注对象会继承这里的配置。邮件开关还需要在设置中启用邮件通知与 SMTP。"
        wide
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setGlobalOpen(false)} disabled={savingGlobal}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => void saveGlobal()} disabled={savingGlobal}>
              {savingGlobal ? '保存中…' : '保存默认规则'}
            </button>
          </>
        }
      >
        <NotificationRuleEditor rules={globalDraft} onChange={setGlobalDraft} disabled={savingGlobal} />
      </Modal>
    </div>
  );
}
