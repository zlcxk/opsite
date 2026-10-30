import type {
  NotificationMinSeverity,
  NotificationRuleType,
  NotificationSeverity,
  Priority,
  SubscriptionRule,
} from '../../shared/types.js';

export const NOTIFICATION_EVENT_TYPES: NotificationRuleType[] = [
  'high_risk_advisory',
  'lifecycle_change',
  'new_vulnerability',
  'advisory_update',
  'new_release',
  'project_update',
  'discovery',
];

/**
 * Conservative defaults: only high-risk advisories and lifecycle changes are
 * emitted in-app. Releases, discovery and project records are opt-in, and no
 * channel sends email until the user explicitly enables it.
 */
export const DEFAULT_GLOBAL_RULES: SubscriptionRule[] = [
  { eventType: 'high_risk_advisory', inApp: true, email: false, minSeverity: 'all' },
  { eventType: 'lifecycle_change', inApp: true, email: false, minSeverity: 'all' },
  { eventType: 'new_vulnerability', inApp: false, email: false, minSeverity: 'all' },
  { eventType: 'advisory_update', inApp: false, email: false, minSeverity: 'all' },
  { eventType: 'new_release', inApp: false, email: false, minSeverity: 'all' },
  { eventType: 'project_update', inApp: false, email: false, minSeverity: 'all' },
  { eventType: 'discovery', inApp: false, email: false, minSeverity: 'all' },
];

export function defaultRule(eventType: NotificationRuleType): SubscriptionRule {
  return (
    DEFAULT_GLOBAL_RULES.find((rule) => rule.eventType === eventType) ?? {
      eventType,
      inApp: false,
      email: false,
      minSeverity: 'all',
    }
  );
}

export function severityFromPriority(priority: Priority): NotificationSeverity {
  if (priority === 'P0') return 'urgent';
  if (priority === 'P1') return 'important';
  return 'normal';
}

export function severityRank(severity: NotificationSeverity): number {
  if (severity === 'urgent') return 2;
  if (severity === 'important') return 1;
  return 0;
}

export function minSeverityRank(severity: NotificationMinSeverity): number {
  if (severity === 'urgent') return 2;
  if (severity === 'important') return 1;
  return 0;
}

export function meetsSeverity(
  severity: NotificationSeverity,
  minimum: NotificationMinSeverity,
): boolean {
  return severityRank(severity) >= minSeverityRank(minimum);
}
