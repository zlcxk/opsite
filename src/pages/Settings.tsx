import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Check,
  Database,
  Download,
  Info,
  KeyRound,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import type { Settings as SettingsType } from '@shared/types';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { api } from '../lib/api';
import { useAppData } from '../contexts/AppDataContext';
import { useToast } from '../contexts/ToastContext';
import { formatDateTime, relativeTime } from '../lib/format';
import { PageHeader } from '../components/ui';
import { NotificationSettings } from '../components/NotificationSettingsPanel';

type Section = 'sync' | 'notify' | 'data' | 'about';

interface SettingsResponse extends SettingsType {
  scheduler: { enabled: boolean; nextSyncAt: string | null; lastRunAt: string | null };
}

const sections: Array<{ key: Section; label: string; icon: typeof SlidersHorizontal }> = [
  { key: 'sync', label: '采集与调度', icon: SlidersHorizontal },
  { key: 'notify', label: '通知与邮件', icon: Bell },
  { key: 'data', label: '数据与备份', icon: Database },
  { key: 'about', label: '关于 Opsite', icon: Info },
];

const cronPresets = [
  { value: '0 */6 * * *', label: '每 6 小时（推荐）' },
  { value: '0 */12 * * *', label: '每 12 小时' },
  { value: '0 3 * * *', label: '每天 03:00' },
  { value: '0 3 * * 1', label: '每周一 03:00' },
];

function pickSettings(value: SettingsResponse): SettingsType {
  return {
    syncEnabled: value.syncEnabled,
    syncCron: value.syncCron,
    githubTokenConfigured: value.githubTokenConfigured,
    nvdKeyConfigured: value.nvdKeyConfigured,
    emailEnabled: value.emailEnabled,
    emailTo: value.emailTo,
    emailMode: value.emailMode,
    digestTime: value.digestTime,
    notifyP0: value.notifyP0,
    notifyP1: value.notifyP1,
    notifyEol: value.notifyEol,
    notifyRelease: value.notifyRelease,
    quietHours: value.quietHours,
    staleAfterHours: value.staleAfterHours,
  };
}

export function Settings() {
  useDocumentTitle('设置');
  const { data, loading, error, refetch } = useApi<SettingsResponse>('/settings');
  const { refresh } = useAppData();
  const { push } = useToast();
  const [section, setSection] = useState<Section>('sync');
  const [form, setForm] = useState<SettingsType | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (data) setForm(pickSettings(data));
  }, [data]);

  const dirty = useMemo(() => {
    if (!data || !form) return false;
    return (Object.keys(form) as Array<keyof SettingsType>).some((key) => form[key] !== data[key]);
  }, [data, form]);

  const set = <K extends keyof SettingsType>(key: K, value: SettingsType[K]) => {
    if (!form) return;
    setForm({ ...form, [key]: value });
  };

  const save = async () => {
    if (!form) return;
    if (form.emailEnabled && form.emailTo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.emailTo)) {
      push('收件邮箱格式不正确', 'error');
      return;
    }
    setSaving(true);
    try {
      const result = await api.patch<{ settings: SettingsResponse }>('/settings', form);
      setForm(pickSettings(result.settings));
      await refetch(true);
      await refresh(true);
      push('设置已保存');
    } catch (saveError) {
      push(saveError instanceof Error ? saveError.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const syncAll = async () => {
    setSyncing(true);
    try {
      const result = await api.post<{ total: number; succeeded: number; failed: number }>('/sync-all');
      push(`同步完成：${result.succeeded}/${result.total} 成功`, result.failed ? 'error' : 'success');
      await Promise.all([refetch(true), refresh(true)]);
    } catch (syncError) {
      push(syncError instanceof Error ? syncError.message : '同步失败', 'error');
    } finally {
      setSyncing(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="page">
        <div className="loading-block" style={{ minHeight: 300 }} />
      </div>
    );
  }

  if (!data || !form) {
    return (
      <div className="page">
        <PageHeader eyebrow="Settings" title="设置" />
        <div className="error-note">{error ?? '无法加载设置'}</div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Settings · local-first"
        title="设置"
        subtitle="所有配置保存在本机 SQLite。外部凭据只从服务端环境变量读取，不会下发给前端。"
        actions={
          section === 'about' ? undefined : (
            <button className="btn btn-primary" onClick={() => void save()} disabled={!dirty || saving}>
              <Save size={13} /> {saving ? '保存中…' : dirty ? '保存设置' : '已保存'}
            </button>
          )
        }
      />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分区">
          {sections.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={section === item.key ? 'active' : ''}
                onClick={() => setSection(item.key)}
              >
                <Icon size={13} />
                {item.label}
              </button>
            );
          })}
          <div className="settings-nav-status mt-4 rounded-lg border border-[var(--line)] bg-white/55 p-3">
            <div className="flex items-center gap-1.5 text-[0.65625rem] uppercase tracking-[0.08em] text-[var(--muted-2)]">
              <span className={`live-dot ${data.scheduler.enabled ? '' : 'warn'}`} />
              {data.scheduler.enabled ? 'Scheduler active' : 'Scheduler paused'}
            </div>
            <p className="mt-2 text-[0.6875rem] leading-5 text-[var(--muted)]">
              {data.scheduler.enabled
                ? `下次自动采集 ${formatDateTime(data.scheduler.nextSyncAt)}`
                : '定时采集当前未运行，仍可手动同步。'}
            </p>
          </div>
        </nav>

        <div>
          {section === 'sync' && (
            <>
              <section className="settings-section">
                <div className="settings-section-head">
                  <h2>定时采集</h2>
                  <p>新加入的软件会自动进入已启用的采集流程；暂停的软件不参与定时任务。</p>
                </div>

                <div className="setting-row">
                  <div className="setting-row-label">
                    <strong>启用后台定时采集</strong>
                    <p>关闭后不会自动拉取上游数据，手动同步不受影响。</p>
                  </div>
                  <div className="setting-row-control">
                    <button
                      className={`switch ${form.syncEnabled ? 'on' : ''}`}
                      role="switch"
                      aria-checked={form.syncEnabled}
                      aria-label="启用后台定时采集"
                      onClick={() => set('syncEnabled', !form.syncEnabled)}
                    />
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-row-label">
                    <strong>采集频率</strong>
                    <p>使用标准 cron 表达式。保存后调度器会立即重新加载；已单独设置 cron 的采集任务不会被覆盖。</p>
                  </div>
                  <div className="setting-row-control w-[300px]">
                    <input
                      className="field-input font-mono"
                      value={form.syncCron}
                      onChange={(event) => set('syncCron', event.target.value)}
                      aria-label="采集 cron 表达式"
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {cronPresets.map((preset) => (
                        <button
                          key={preset.value}
                          className={`chip ${form.syncCron === preset.value ? 'active' : ''}`}
                          style={{ height: 24, fontSize: '0.65625rem' }}
                          onClick={() => set('syncCron', preset.value)}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-row-label">
                    <strong>数据过期阈值</strong>
                    <p>超过该时长未成功采集的数据源会标记为“过期”，卡片保留上一次成功数据。</p>
                  </div>
                  <div className="setting-row-control flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={720}
                      className="field-input w-[90px] text-right"
                      value={form.staleAfterHours}
                      onChange={(event) => set('staleAfterHours', Number(event.target.value))}
                      aria-label="数据过期小时数"
                    />
                    <span className="text-[0.75rem] text-[var(--muted)]">小时</span>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-row-label">
                    <strong>调度状态</strong>
                    <p>
                      {data.scheduler.enabled
                        ? `下次运行 ${formatDateTime(data.scheduler.nextSyncAt)} · 上次运行 ${relativeTime(data.scheduler.lastRunAt)}`
                        : '调度器未运行。生产环境若设置了 DISABLE_SCHEDULER=true 也会显示为未运行。'}
                    </p>
                  </div>
                  <div className="setting-row-control">
                    <button className="btn btn-secondary btn-sm" onClick={() => void syncAll()} disabled={syncing}>
                      <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
                      {syncing ? '同步中…' : '立即同步全部'}
                    </button>
                  </div>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-head">
                  <h2>上游凭据</h2>
                  <p>凭据只在服务端使用，前端只能看到“是否已配置”。修改 .env 后需要重启 API 服务。</p>
                </div>
                <div className="setting-row">
                  <div className="setting-row-label">
                    <strong>
                      <KeyRound size={11} /> GitHub Token
                    </strong>
                    <p>提高 GitHub Releases 与 Advisory 的速率上限。未配置时以匿名请求访问。</p>
                  </div>
                  <div className="setting-row-control">
                    <span className={`pill ${form.githubTokenConfigured ? 'pill-calm' : 'pill-neutral'}`}>
                      {form.githubTokenConfigured ? (
                        <>
                          <Check size={10} /> 已配置
                        </>
                      ) : (
                        '未配置'
                      )}
                    </span>
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-row-label">
                    <strong>
                      <KeyRound size={11} /> NVD API Key
                    </strong>
                    <p>配置后 NVD 请求间隔从约 6.3 秒缩短到 0.7 秒，建议启用。</p>
                  </div>
                  <div className="setting-row-control">
                    <span className={`pill ${form.nvdKeyConfigured ? 'pill-calm' : 'pill-neutral'}`}>
                      {form.nvdKeyConfigured ? (
                        <>
                          <Check size={10} /> 已配置
                        </>
                      ) : (
                        '未配置'
                      )}
                    </span>
                  </div>
                </div>
                <div className="form-note mt-3">
                  在项目根目录的 <code className="font-mono">.env</code> 中设置 GITHUB_TOKEN / NVD_API_KEY。不要把凭据写入前端或提交到版本库。
                </div>
              </section>
            </>
          )}

          {section === 'notify' && <NotificationSettings form={form} set={set} />}

          {section === 'data' && (
            <>
              <section className="settings-section">
                <div className="settings-section-head">
                  <h2>备份与恢复</h2>
                  <p>数据库使用 SQLite WAL 模式。备份通过 VACUUM INTO 生成一致性快照，不包含前端资源。</p>
                </div>
                <div className="backup-card">
                  <div>
                    <div className="flex items-center gap-1.5 text-[0.875rem] font-[540]">
                      <Download size={13} /> 下载数据库备份
                    </div>
                    <p className="mt-1 text-[0.71875rem] text-[var(--muted)]">
                      下载后请自行保管。恢复时需要停止服务，用备份文件替换 data/opsite.db。
                    </p>
                  </div>
                  <a className="btn btn-secondary btn-sm" href="/api/backup">
                    导出 .db
                  </a>
                </div>

                <div className="setting-row mt-2">
                  <div className="setting-row-label">
                    <strong>数据保留</strong>
                    <p>
                      归档软件不删除历史；数据源停用后也不会清除旧记录。采集任务只保留每个来源的运行结果，不做自动清理。
                    </p>
                  </div>
                  <div className="setting-row-control">
                    <span className="pill pill-calm">历史保留</span>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-row-label">
                    <strong>恢复步骤</strong>
                    <p>
                      1. 停止 API 服务。2. 将备份文件复制为 data/opsite.db。3. 删除同目录的 -wal / -shm 文件。4. 重启服务。
                    </p>
                  </div>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-head">
                  <h2>系统状态</h2>
                  <p>来自当前服务进程的只读信息。</p>
                </div>
                <div className="setting-row">
                  <div className="setting-row-label">
                    <strong>调度器</strong>
                    <p>
                      {data.scheduler.enabled ? '运行中' : '未运行'} · 下次 {formatDateTime(data.scheduler.nextSyncAt)} · 上次{' '}
                      {relativeTime(data.scheduler.lastRunAt)}
                    </p>
                  </div>
                  <div className="setting-row-control">
                    <span className={`pill ${data.scheduler.enabled ? 'pill-calm' : 'pill-neutral'}`}>
                      {data.scheduler.enabled ? 'active' : 'paused'}
                    </span>
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-row-label">
                    <strong>数据存储在本地</strong>
                    <p>所有软件、公告、版本、事件和个人状态都保存在本机 SQLite，不会上传到第三方服务。</p>
                  </div>
                  <div className="setting-row-control">
                    <ShieldCheck size={16} className="text-[var(--calm)]" />
                  </div>
                </div>
              </section>
            </>
          )}

          {section === 'about' && (
            <>
              <section className="settings-section">
                <div className="settings-section-head">
                  <h2>Opsite · 个人运维情报台</h2>
                  <p>一个单用户、本地优先的软件变更与漏洞情报工作台。</p>
                </div>
                <div className="mini-list">
                  <div className="mini-row">
                    <div className="mini-row-main">
                      <strong>软件身份</strong>
                      <span>所有情报关联到稳定的 software_id 与来源映射，漏洞不会只按显示名称匹配。</span>
                    </div>
                  </div>
                  <div className="mini-row">
                    <div className="mini-row-main">
                      <strong>采集来源</strong>
                      <span>endoflife.date · GitHub Releases · GitHub Global Security Advisories · NVD CVE · CISA KEV</span>
                    </div>
                  </div>
                  <div className="mini-row">
                    <div className="mini-row-main">
                      <strong>设计原则</strong>
                      <span>缺失证据就显示未知；有冲突就保留并标记；有新版本不等于建议升级。</span>
                    </div>
                  </div>
                  <div className="mini-row">
                    <div className="mini-row-main">
                      <strong>运行时</strong>
                      <span>React + Express + SQLite，本地运行，无多租户与云端同步。</span>
                    </div>
                  </div>
                </div>
              </section>
              <section className="settings-section">
                <div className="settings-section-head">
                  <h2>已知边界</h2>
                </div>
                <div className="mini-list">
                  <div className="mini-row">
                    <div className="mini-row-main">
                      <strong>邮件依赖你自己的 SMTP</strong>
                      <span>
                        Opsite 不内置邮件服务，也不会代为投递。未配置 SMTP 时站内通知照常工作，邮件投递会被标记为已跳过。
                      </span>
                    </div>
                  </div>
                  <div className="mini-row">
                    <div className="mini-row-main">
                      <strong>单用户、无多租户</strong>
                      <span>关注与通知属于本机实例，没有账号体系、角色或云端同步。</span>
                    </div>
                  </div>
                  <div className="mini-row">
                    <div className="mini-row-main">
                      <strong>兼容性不自动推断</strong>
                      <span>兼容性结论来自知识库中的手工记录，系统不会猜测组件兼容性。</span>
                    </div>
                  </div>
                  <div className="mini-row">
                    <div className="mini-row-main">
                      <strong>NVD 关键词匹配存在噪声风险</strong>
                      <span>NVD 结果标记为中等可信度，请结合 GitHub Advisory 与版本范围核实。</span>
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
