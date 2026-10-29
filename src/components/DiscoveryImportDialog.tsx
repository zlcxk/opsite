import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Link2, Radar as RadarIcon } from 'lucide-react';
import type {
  DiscoveryCandidate,
  DiscoveryImportResult,
  RadarItem,
  RadarKind,
} from '@shared/types';
import { api, ApiError } from '../lib/api';
import { useApi } from '../lib/hooks';
import { radarKindMeta } from '../lib/radar';
import { Modal } from './ui';

const kinds: RadarKind[] = ['tool', 'tech', 'learning'];

function duplicateFromError(error: unknown): RadarItem | null {
  if (!(error instanceof ApiError)) return null;
  const details = error.details as { duplicateRadarItem?: RadarItem } | undefined;
  return details?.duplicateRadarItem ?? null;
}

export function DiscoveryImportDialog({
  candidate,
  open,
  onClose,
  onImported,
}: {
  candidate: DiscoveryCandidate | null;
  open: boolean;
  onClose: () => void;
  onImported: (result: DiscoveryImportResult) => Promise<void> | void;
}) {
  const matchApi = useApi<{ radarItem: RadarItem | null }>(
    open && candidate ? `/discovery/candidates/${candidate.id}/radar-match` : null,
  );
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [kind, setKind] = useState<RadarKind>('tool');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [raceMatch, setRaceMatch] = useState<RadarItem | null>(null);

  useEffect(() => {
    if (!open || !candidate) return;
    setTitle(candidate.title);
    setSummary((candidate.description ?? '').slice(0, 1000));
    setKind('tool');
    setUrl(candidate.canonicalUrl);
    setBusy(false);
    setError(null);
    setRaceMatch(null);
  }, [open, candidate]);

  if (!candidate) return null;

  const match = raceMatch ?? matchApi.data?.radarItem ?? null;
  const checkingMatch = Boolean(open && matchApi.loading && !matchApi.data && !raceMatch);

  const runImport = async (radarItemId?: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<DiscoveryImportResult>(
        `/discovery/candidates/${candidate.id}/import`,
        radarItemId
          ? { radarItemId }
          : {
              title: title.trim(),
              summary: summary.trim(),
              kind,
              url: url.trim() || null,
            },
      );
      await onImported(result);
    } catch (submitError) {
      const duplicate = duplicateFromError(submitError);
      if (duplicate) {
        setRaceMatch(duplicate);
        setError('技术雷达中已有相同项目，请改为关联现有条目。');
      } else {
        setError(
          submitError instanceof Error
            ? submitError.message
            : '收录失败，请保留输入后重试',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('标题不能为空');
      return;
    }
    void runImport();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Import to tech radar"
      title={match ? '关联已有雷达条目' : `把「${candidate.title}」加入技术雷达`}
      description={
        match
          ? '技术雷达中已经存在相同项目链接。关联后不会创建重复条目，候选和来源信息仍保留在技术发现中。'
          : '收录会创建一条待评估的雷达条目。之后在技术雷达中继续试用、评估或忽略。'
      }
      footer={
        match ? (
          <>
            <button className="btn btn-ghost" onClick={onClose}>
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void runImport(match.id)}
              disabled={busy}
            >
              <Link2 size={13} /> {busy ? '关联中…' : '关联并收录'}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={onClose}>
              取消
            </button>
            <button
              className="btn btn-primary"
              type="submit"
              form="discovery-import-form"
              disabled={busy || checkingMatch}
            >
              <RadarIcon size={13} /> {busy ? '收录中…' : '加入技术雷达'}
            </button>
          </>
        )
      }
    >
      {error && <div className="error-note mb-3">{error}</div>}

      {checkingMatch ? (
        <div className="discovery-match-check">正在检查技术雷达中是否已有相同项目…</div>
      ) : match ? (
        <div className="discovery-match">
          <span className="discovery-match-mark">
            <Link2 size={15} />
          </span>
          <div>
            <span className="eyebrow no-rule">已匹配雷达条目</span>
            <strong>{match.title}</strong>
            <p>链接相同，不会再创建第二条雷达记录。</p>
            <Link to={`/radar/${match.id}`} className="text-link" onClick={onClose}>
              查看已有条目 <ArrowUpRight size={10} />
            </Link>
          </div>
        </div>
      ) : (
        <form id="discovery-import-form" onSubmit={submit}>
          {matchApi.error && (
            <div className="form-note mb-3">
              暂时无法预检查雷达重复项；收录时后端仍会再次校验，不会自动创建重复记录。
            </div>
          )}
          <label className="field">
            <span className="field-label">雷达标题</span>
            <input
              className="field-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={160}
              autoFocus
            />
          </label>
          <label className="field mt-3">
            <span className="field-label">关注原因或简介</span>
            <textarea
              className="field-textarea"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              maxLength={1000}
              placeholder="为什么值得评估？可以从项目简介开始补充。"
            />
          </label>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <label className="field">
              <span className="field-label">类型</span>
              <select
                className="field-input"
                value={kind}
                onChange={(event) => setKind(event.target.value as RadarKind)}
              >
                {kinds.map((value) => (
                  <option key={value} value={value}>
                    {radarKindMeta[value].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">链接</span>
              <input
                className="field-input"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                maxLength={500}
                placeholder="https://"
              />
            </label>
          </div>
        </form>
      )}
    </Modal>
  );
}
