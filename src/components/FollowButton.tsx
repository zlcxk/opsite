import { useState } from 'react';
import { BellOff, BellRing, Loader2 } from 'lucide-react';
import type { FollowTarget, FollowTargetType } from '@shared/types';
import { useApi } from '../lib/hooks';
import { api } from '../lib/api';
import { useToast } from '../contexts/ToastContext';

interface FollowButtonProps {
  targetType: FollowTargetType;
  targetId: string;
  compact?: boolean;
  onChange?: (follow: FollowTarget | null) => void;
}

export function FollowButton({ targetType, targetId, compact, onChange }: FollowButtonProps) {
  const { push } = useToast();
  const { data, loading, refetch } = useApi<{ follow: FollowTarget | null }>(
    `/follows/status?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}`,
  );
  const [busy, setBusy] = useState(false);
  const follow = data?.follow ?? null;

  const toggle = async () => {
    setBusy(true);
    try {
      if (follow) {
        await api.delete(`/follows/${follow.id}`);
        push('已取消关注，历史通知仍会保留');
        onChange?.(null);
      } else {
        const result = await api.post<{ follow: FollowTarget; created: boolean }>('/follows', {
          targetType,
          targetId,
        });
        push(result.created ? '已加入关注与订阅' : '该对象已在关注列表中');
        onChange?.(result.follow);
      }
      await refetch(true);
    } catch (error) {
      push(error instanceof Error ? error.message : '操作失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const label = follow ? '已关注' : '关注';
  return (
    <button
      className={`btn btn-secondary follow-btn ${follow ? 'is-following' : ''} ${compact ? 'is-compact' : ''}`}
      onClick={() => void toggle()}
      disabled={loading || busy}
      aria-pressed={Boolean(follow)}
      aria-label={follow ? '取消关注' : '关注'}
      title={follow ? '取消关注（不会删除历史通知）' : '关注后按订阅规则接收站内通知与邮件'}
    >
      {loading || busy ? (
        <Loader2 size={13} className="animate-spin" />
      ) : follow ? (
        <BellOff size={13} />
      ) : (
        <BellRing size={13} />
      )}
      {compact ? null : label}
    </button>
  );
}
