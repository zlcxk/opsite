import { useEffect, useState } from 'react';
import { Loader2, Mail, RefreshCw, RotateCcw, Save, Send } from 'lucide-react';
import type {
  DeliveryRecord,
  Settings as SettingsType,
  SmtpConfigView,
  SmtpEncryption,
  SubscriptionRule,
} from '@shared/types';
import { useApi } from '../lib/hooks';
import { api } from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { formatDateTime, relativeTime } from '../lib/format';
import { deliveryStatusMeta } from '../lib/notification-labels';
import { NotificationRuleEditor } from './NotificationRuleEditor';

interface SmtpForm {
  enabled: boolean;
  host: string;
  port: number;
  encryption: SmtpEncryption;
  username: string;
  fromName: string;
  fromEmail: string;
}

export function NotificationSettings({
  form,
  set,
}: {
  form: SettingsType;
  set: <K extends keyof SettingsType>(key: K, value: SettingsType[K]) => void;
}) {
  const { push } = useToast();
  const { data: smtpData, refetch: refetchSmtp } = useApi<{ smtp: SmtpConfigView }>(
    '/notifications/smtp',
  );
  const { data: rulesData, refetch: refetchRules } = useApi<{ rules: SubscriptionRule[] }>(
    '/notification-rules',
  );
  const { data: deliveryData, refetch: refetchDeliveries } = useApi<{ items: DeliveryRecord[] }>(
    '/notifications/deliveries?limit=12',
    20_000,
  );

  const [smtpForm, setSmtpForm] = useState<SmtpForm>({
    enabled: false,
    host: '',
    port: 587,
    encryption: 'starttls',
    username: '',
    fromName: 'Opsite',
    fromEmail: '',
  });
  const [password, setPassword] = useState('');
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [testing, setTesting] = useState(false);
  const [rulesDraft, setRulesDraft] = useState<SubscriptionRule[]>([]);
  const [savingRules, setSavingRules] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);

  useEffect(() => {
    const value = smtpData?.smtp;
    if (!value) return;
    setSmtpForm({
      enabled: value.enabled,
      host: value.host,
      port: value.port,
      encryption: value.encryption,
      username: value.username,
      fromName: value.fromName,
      fromEmail: value.fromEmail,
    });
  }, [smtpData?.smtp]);

  useEffect(() => {
    if (rulesData?.rules) setRulesDraft(rulesData.rules.map((rule) => ({ ...rule })));
  }, [rulesData?.rules]);

  const smtpView = smtpData?.smtp ?? null;
  const rulesDirty =
    Boolean(rulesData?.rules) &&
    JSON.stringify(rulesDraft) !== JSON.stringify(rulesData?.rules ?? []);

  const updateSmtp = <K extends keyof SmtpForm>(key: K, value: SmtpForm[K]) => {
    setSmtpForm((current) => ({ ...current, [key]: value }));
  };

  const saveSmtp = async () => {
    setSavingSmtp(true);
    try {
      await api.patch<{ smtp: SmtpConfigView }>('/notifications/smtp', {
        ...smtpForm,
        ...(password ? { password } : {}),
      });
      push('SMTP 配置已保存');
      setPassword('');
      await refetchSmtp(true);
    } catch (error) {
      push(error instanceof Error ? error.message : 'SMTP 保存失败', 'error');
    } finally {
      setSavingSmtp(false);
    }
  };

  const sendTest = async () => {
    if (!form.emailTo) {
      push('请先填写收件邮箱', 'error');
      return;
    }
    setTesting(true);
    try {
      await api.post('/notifications/smtp/test', { to: form.emailTo });
      push(`测试邮件已发送到 ${form.emailTo}`);
    } catch (error) {
      push(error instanceof Error ? error.message : '测试邮件发送失败', 'error');
    } finally {
      setTesting(false);
    }
  };

  const saveRules = async () => {
    setSavingRules(true);
    try {
      await api.patch('/notification-rules', { rules: rulesDraft });
      push('全局通知规则已保存');
      await refetchRules(true);
    } catch (error) {
      push(error instanceof Error ? error.message : '保存通知规则失败', 'error');
    } finally {
      setSavingRules(false);
    }
  };

  const retry = async (delivery: DeliveryRecord) => {
    setRetrying(delivery.id);
    try {
      await api.post(`/notifications/deliveries/${delivery.id}/retry`);
      push('已重新加入发送队列');
      await refetchDeliveries(true);
    } catch (error) {
      push(error instanceof Error ? error.message : '重试失败', 'error');
    } finally {
      setRetrying(null);
    }
  };

  return (
    <>
      <section className="settings-section">
        <div className="settings-section-head">
          <h2>邮件通知</h2>
          <p>
            站内通知始终优先落库，邮件由后台队列独立发送。这里的开关保存后，下一次点击页面底部的“保存设置”才会生效。
          </p>
        </div>

        <div className="setting-row">
          <div className="setting-row-label">
            <strong>启用邮件通知</strong>
            <p>邮件规则仍可在全局与单个关注对象中配置；关闭后所有邮件投递会标记为“已跳过”。</p>
          </div>
          <div className="setting-row-control">
            <button
              className={`switch ${form.emailEnabled ? 'on' : ''}`}
              role="switch"
              aria-checked={form.emailEnabled}
              aria-label="启用邮件通知"
              onClick={() => set('emailEnabled', !form.emailEnabled)}
            />
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-row-label">
            <strong>收件邮箱</strong>
            <p>只用于个人通知，不会作为外部数据源凭据，也不会返回给其他客户端。</p>
          </div>
          <div className="setting-row-control w-[280px]">
            <input
              type="email"
              className="field-input"
              value={form.emailTo}
              onChange={(event) => set('emailTo', event.target.value)}
              placeholder="you@example.com"
              disabled={!form.emailEnabled}
            />
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-row-label">
            <strong>发送方式</strong>
            <p>实时模式逐条发送；摘要模式按固定时间合并，减少打扰。</p>
          </div>
          <div className="setting-row-control flex-wrap gap-2">
            <button
              className={`chip ${form.emailMode === 'realtime' ? 'active' : ''}`}
              onClick={() => set('emailMode', 'realtime')}
              disabled={!form.emailEnabled}
            >
              实时发送
            </button>
            <button
              className={`chip ${form.emailMode === 'digest' ? 'active' : ''}`}
              onClick={() => set('emailMode', 'digest')}
              disabled={!form.emailEnabled}
            >
              每日摘要
            </button>
            {form.emailMode === 'digest' && (
              <input
                type="time"
                className="field-input w-[120px]"
                value={form.digestTime}
                onChange={(event) => set('digestTime', event.target.value)}
                aria-label="每日摘要发送时间"
                disabled={!form.emailEnabled}
              />
            )}
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-row-label">
            <strong>免打扰时段</strong>
            <p>例如 23:00-08:00。实时邮件会顺延到时段结束；摘要邮件不受影响。</p>
          </div>
          <div className="setting-row-control w-[160px]">
            <input
              className="field-input"
              value={form.quietHours}
              onChange={(event) => set('quietHours', event.target.value)}
              placeholder="23:00-08:00"
              disabled={!form.emailEnabled}
            />
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h2>SMTP 服务器</h2>
          <p>密码使用 AES-256-GCM 加密后保存在本机数据库，接口不会返回明文，也不会写入日志。</p>
        </div>

        <div className="setting-row">
          <div className="setting-row-label">
            <strong>启用 SMTP</strong>
            <p>
              {smtpView?.configured
                ? '配置完整。建议先发送一封测试邮件确认连通性。'
                : '填写服务器、发件邮箱，以及账号对应的密码后才能启用。'}
            </p>
          </div>
          <div className="setting-row-control flex items-center gap-2">
            <span className={`pill ${smtpView?.configured ? 'pill-calm' : 'pill-neutral'}`}>
              {smtpView?.configured ? '已配置' : '未配置完整'}
            </span>
            <button
              className={`switch ${smtpForm.enabled ? 'on' : ''}`}
              role="switch"
              aria-checked={smtpForm.enabled}
              aria-label="启用 SMTP"
              onClick={() => updateSmtp('enabled', !smtpForm.enabled)}
            />
          </div>
        </div>

        <div className="smtp-grid">
          <label className="smtp-field smtp-field-host">
            <span>SMTP 主机</span>
            <input
              className="field-input"
              value={smtpForm.host}
              onChange={(event) => updateSmtp('host', event.target.value)}
              placeholder="smtp.example.com"
              autoComplete="off"
            />
          </label>
          <label className="smtp-field">
            <span>端口</span>
            <input
              type="number"
              min={1}
              max={65535}
              className="field-input"
              value={smtpForm.port}
              onChange={(event) => updateSmtp('port', Number(event.target.value))}
            />
          </label>
          <label className="smtp-field">
            <span>加密方式</span>
            <select
              className="field-input"
              value={smtpForm.encryption}
              onChange={(event) => updateSmtp('encryption', event.target.value as SmtpEncryption)}
            >
              <option value="starttls">STARTTLS（587）</option>
              <option value="ssl">SSL / TLS（465）</option>
              <option value="none">不加密</option>
            </select>
          </label>
          <label className="smtp-field">
            <span>用户名</span>
            <input
              className="field-input"
              value={smtpForm.username}
              onChange={(event) => updateSmtp('username', event.target.value)}
              placeholder="可选"
              autoComplete="username"
            />
          </label>
          <label className="smtp-field">
            <span>密码</span>
            <input
              type="password"
              className="field-input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={smtpView?.passwordConfigured ? '已保存，留空则不修改' : 'SMTP 密码'}
              autoComplete="new-password"
            />
          </label>
          <label className="smtp-field">
            <span>发件人名称</span>
            <input
              className="field-input"
              value={smtpForm.fromName}
              onChange={(event) => updateSmtp('fromName', event.target.value)}
              placeholder="Opsite"
            />
          </label>
          <label className="smtp-field smtp-field-wide">
            <span>发件邮箱</span>
            <input
              type="email"
              className="field-input"
              value={smtpForm.fromEmail}
              onChange={(event) => updateSmtp('fromEmail', event.target.value)}
              placeholder="opsite@example.com"
              autoComplete="off"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[0.6875rem] text-[var(--muted-2)]">
            {smtpView?.updatedAt ? `上次保存 ${relativeTime(smtpView.updatedAt)}` : '尚未保存 SMTP 配置'}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => void sendTest()}
              disabled={testing || !smtpView?.configured || !form.emailTo}
            >
              {testing ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              {testing ? '发送中…' : '发送测试邮件'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => void saveSmtp()} disabled={savingSmtp}>
              {savingSmtp ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {savingSmtp ? '保存中…' : '保存 SMTP'}
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h2>全局订阅规则</h2>
          <p>
            所有关注对象默认继承这里的规则。单个对象可在关注与订阅页面覆盖。站内规则独立于邮件通道。
          </p>
        </div>
        {rulesData?.rules ? (
          <>
            <NotificationRuleEditor rules={rulesDraft} onChange={setRulesDraft} disabled={savingRules} />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[0.6875rem] text-[var(--muted-2)]">
                {rulesDirty ? '有未保存的规则更改' : '规则已与本地数据库同步'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setRulesDraft((rulesData.rules ?? []).map((rule) => ({ ...rule })))}
                  disabled={!rulesDirty || savingRules}
                >
                  <RotateCcw size={12} /> 撤销更改
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => void saveRules()}
                  disabled={!rulesDirty || savingRules}
                >
                  <Save size={12} /> {savingRules ? '保存中…' : '保存规则'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="loading-block" style={{ minHeight: 120 }} />
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h2>最近邮件投递</h2>
          <p>投递记录与通知生成解耦。失败会自动退避重试，五次后停止，也可以手动重试。</p>
        </div>
        {deliveryData?.items.length ? (
          <div className="delivery-list">
            {deliveryData.items.map((delivery) => {
              const status = deliveryStatusMeta[delivery.status];
              return (
                <div className="delivery-row" key={delivery.id}>
                  <div className="delivery-main">
                    <div className="delivery-title-row">
                      <strong>{delivery.title}</strong>
                      <span className={`pill pill-${status.className}`}>{status.label}</span>
                    </div>
                    <div className="delivery-meta">
                      <span>{delivery.recipient ?? '未设置收件人'}</span>
                      <span>尝试 {delivery.attempts} 次</span>
                      <span>{relativeTime(delivery.createdAt)}</span>
                      {delivery.sentAt && <span>发送于 {relativeTime(delivery.sentAt)}</span>}
                      {delivery.status === 'pending' && delivery.nextAttemptAt && (
                        <span>下次 {formatDateTime(delivery.nextAttemptAt)}</span>
                      )}
                    </div>
                    {delivery.lastError && <p className="delivery-error">{delivery.lastError}</p>}
                  </div>
                  <div className="delivery-actions">
                    {delivery.status !== 'sent' && delivery.status !== 'sending' && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => void retry(delivery)}
                        disabled={retrying === delivery.id}
                      >
                        <RefreshCw size={11} className={retrying === delivery.id ? 'animate-spin' : ''} />
                        重试
                      </button>
                    )}
                    <a className="btn btn-ghost btn-sm" href="/notifications">
                      <Mail size={11} /> 通知
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="form-note">暂无邮件投递记录。启用邮件规则并触发一次通知后会出现。</div>
        )}
      </section>
    </>
  );
}
