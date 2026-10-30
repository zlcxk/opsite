import type { NotificationMinSeverity, SubscriptionRule } from '@shared/types';
import {
  minSeverityOptions,
  notificationRuleMeta,
  notificationRuleOrder,
} from '../lib/notification-labels';

export function NotificationRuleEditor({
  rules,
  onChange,
  disabled = false,
}: {
  rules: SubscriptionRule[];
  onChange: (rules: SubscriptionRule[]) => void;
  disabled?: boolean;
}) {
  const byType = new Map(rules.map((rule) => [rule.eventType, rule]));

  const update = (eventType: SubscriptionRule['eventType'], patch: Partial<SubscriptionRule>) => {
    onChange(
      notificationRuleOrder.map((type) => {
        const current =
          byType.get(type) ?? { eventType: type, inApp: false, email: false, minSeverity: 'all' };
        return type === eventType ? { ...current, ...patch } : current;
      }),
    );
  };

  return (
    <div className="rule-editor">
      <div className="rule-editor-head" aria-hidden="true">
        <span>事件类型</span>
        <span>站内</span>
        <span>邮件</span>
        <span>最低级别</span>
      </div>
      {notificationRuleOrder.map((type) => {
        const meta = notificationRuleMeta[type];
        const rule = byType.get(type) ?? {
          eventType: type,
          inApp: false,
          email: false,
          minSeverity: 'all' as NotificationMinSeverity,
        };
        return (
          <div className="rule-row" key={type}>
            <div className="rule-row-main">
              <div className="rule-row-title">
                <span className="rule-code mono">{meta.code}</span>
                <strong>{meta.label}</strong>
              </div>
              <p>{meta.description}</p>
            </div>
            <div className="rule-toggle-cell">
              <button
                className={`switch ${rule.inApp ? 'on' : ''}`}
                role="switch"
                aria-checked={rule.inApp}
                aria-label={`${meta.label}站内通知`}
                onClick={() => update(type, { inApp: !rule.inApp })}
                disabled={disabled}
              />
            </div>
            <div className="rule-toggle-cell">
              <button
                className={`switch ${rule.email ? 'on' : ''}`}
                role="switch"
                aria-checked={rule.email}
                aria-label={`${meta.label}邮件通知`}
                onClick={() => update(type, { email: !rule.email })}
                disabled={disabled}
              />
            </div>
            <div className="rule-select-cell">
              <select
                className="field-input"
                value={rule.minSeverity}
                onChange={(event) =>
                  update(type, { minSeverity: event.target.value as NotificationMinSeverity })
                }
                aria-label={`${meta.label}最低级别`}
                disabled={disabled}
              >
                {minSeverityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        );
      })}
    </div>
  );
}
