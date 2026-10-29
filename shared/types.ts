export type SourceType =
  | 'endoflife'
  | 'github_releases'
  | 'github_advisories'
  | 'nvd'
  | 'cisa_kev'
  | 'upstream_advisory';

export type WatchStatus = 'active' | 'paused' | 'archived';
export type WatchLevel = 'critical' | 'high' | 'normal';
export type SyncStatus = 'ok' | 'error' | 'running' | 'never';
export type SupportStatus = 'supported' | 'approaching_eol' | 'eol' | 'unknown';
export type VersionImpact = 'affected' | 'possibly_affected' | 'not_affected' | 'insufficient';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type EventType = 'release' | 'vulnerability' | 'lifecycle' | 'source_issue';
export type UserEventStatus = 'new' | 'acknowledged' | 'resolved' | 'ignored';
export type AdvisoryStatus =
  | 'pending'
  | 'to_fix'
  | 'planned'
  | 'fixed'
  | 'not_affected'
  | 'ignored';

export interface SourceConfig {
  product?: string;
  repo?: string;
  package?: string;
  ecosystem?: string;
  keyword?: string;
  cpeName?: string;
  feed?: string;
  url?: string;
}

export interface VersionRange {
  introduced?: string | null;
  fixed?: string | null;
  lastAffected?: string | null;
  rangeText?: string | null;
}

export interface SoftwareSource {
  id: string;
  type: SourceType;
  label: string;
  enabled: boolean;
  config: SourceConfig;
  lastSyncAt: string | null;
  lastStatus: SyncStatus;
  lastError: string | null;
  lastItemCount: number;
  stale: boolean;
}

export interface LifecycleView {
  status: SupportStatus;
  cycle: string | null;
  eolDate: string | null;
  latestPatch: string | null;
  sourceUrl: string | null;
  lastVerifiedAt: string | null;
  notice: string | null;
}

export interface SoftwareSummary {
  id: string;
  name: string;
  slug: string;
  aliases: string[];
  category: string;
  logoUrl: string | null;
  website: string | null;
  repo: string | null;
  description: string | null;
  watchStatus: WatchStatus;
  watchLevel: WatchLevel;
  currentVersion: string | null;
  environment: string | null;
  notes: string | null;
  pinned: boolean;
  latestVersion: string | null;
  latestReleaseAt: string | null;
  createdAt: string;
  updatedAt: string;
  riskLevel: 'critical' | 'high' | 'normal';
  counts: {
    openVulns: number;
    criticalVulns: number;
    highVulns: number;
    affectedVulns: number;
  };
  lifecycle: LifecycleView;
  sources: SoftwareSource[];
  lastSyncAt: string | null;
  sourceIssueCount: number;
}

export interface ReleaseRecord {
  id: string;
  softwareId: string;
  version: string;
  channel: 'stable' | 'prerelease';
  title: string | null;
  notes: string | null;
  url: string | null;
  publishedAt: string | null;
  firstSeenAt: string;
  sourceType: SourceType;
}

export interface LifecycleRecord {
  id: string;
  softwareId: string;
  cycle: string;
  releaseDate: string | null;
  latestVersion: string | null;
  latestReleaseDate: string | null;
  eolDate: string | null;
  supportStatus: SupportStatus;
  sourceUrl: string | null;
  fetchedAt: string;
  isCurrent: boolean;
}

export interface Advisory {
  id: string;
  softwareId: string;
  softwareName?: string;
  identifier: string;
  title: string;
  description: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
  score: number | null;
  scoreSource: string | null;
  url: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  kev: boolean;
  kevDueDate: string | null;
  versionImpact: VersionImpact;
  affectedRange: string | null;
  fixedVersions: string[];
  confidence: 'high' | 'medium' | 'low';
  priority: Priority;
  status: AdvisoryStatus;
  sources: Array<{
    sourceType: SourceType;
    externalId: string | null;
    url: string | null;
    fetchedAt: string;
  }>;
}

export interface IntelEvent {
  id: string;
  type: EventType;
  softwareId: string;
  softwareName: string;
  softwareLogoUrl: string | null;
  category: string;
  title: string;
  summary: string | null;
  priority: Priority;
  sourceName: string | null;
  sourceUrl: string | null;
  firstSeenAt: string;
  upstreamPublishedAt: string | null;
  readAt: string | null;
  status: UserEventStatus;
  refId: string | null;
}

export interface SyncJob {
  id: string;
  softwareId: string;
  softwareName?: string;
  sourceId: string | null;
  sourceType: SourceType | null;
  sourceLabel: string | null;
  status: 'running' | 'success' | 'error';
  trigger: 'manual' | 'schedule' | 'initial';
  startedAt: string;
  finishedAt: string | null;
  itemsFound: number;
  itemsNew: number;
  error: string | null;
}

export interface DashboardBriefing {
  pending: number;
  openAdvisories: number;
  p0: number;
  p1: number;
  eolSoon: number;
  newVersions: number;
  sourceIssues: number;
  unread: number;
  spectrum: { p0: number; p1: number; p2: number; p3: number };
}

export interface DashboardData {
  briefing: DashboardBriefing;
  events: IntelEvent[];
  software: SoftwareSummary[];
  radar: RadarItem[];
  radarCount: number;
  lastSyncAt: string | null;
  schedulerEnabled: boolean;
  nextSyncAt: string | null;
}

export type RadarKind = 'tool' | 'tech' | 'learning';
export type RadarStatus = 'pending' | 'trialing' | 'adopted' | 'deferred' | 'ignored';
export type RadarRecordType = 'evaluation' | 'trial' | 'adoption' | 'note' | 'status_change';

export interface RadarRecord {
  id: string;
  radarItemId: string;
  recordType: RadarRecordType;
  content: string;
  nextAction: string | null;
  createdAt: string;
}

export interface RadarItem {
  id: string;
  title: string;
  summary: string;
  kind: RadarKind;
  url: string | null;
  status: RadarStatus;
  createdAt: string;
  updatedAt: string;
  lastEvaluatedAt: string | null;
  archivedAt: string | null;
  latestRecord: RadarRecord | null;
}

export interface RadarDetail {
  item: RadarItem;
  records: RadarRecord[];
}

export interface KnowledgeNote {
  id: string;
  title: string;
  content: string;
  tags: string[];
  relatedSoftwareId: string | null;
  relatedSoftwareName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SoftwareDetail {
  software: SoftwareSummary;
  releases: ReleaseRecord[];
  lifecycle: LifecycleRecord[];
  advisories: Advisory[];
  events: IntelEvent[];
  sources: SoftwareSource[];
  jobs: SyncJob[];
}

export interface CatalogSource {
  type: SourceType;
  label: string;
  enabled: boolean;
  config: SourceConfig;
}

export interface CatalogItem {
  key: string;
  name: string;
  aliases: string[];
  category: string;
  logoSlug: string | null;
  website: string | null;
  repo: string | null;
  description: string;
  watchLevel: WatchLevel;
  sources: CatalogSource[];
}

export interface Settings {
  syncEnabled: boolean;
  syncCron: string;
  githubTokenConfigured: boolean;
  nvdKeyConfigured: boolean;
  emailEnabled: boolean;
  emailTo: string;
  notifyP0: boolean;
  notifyP1: boolean;
  notifyEol: boolean;
  notifyRelease: boolean;
  quietHours: string;
  staleAfterHours: number;
}

export interface ReleaseFeedItem extends ReleaseRecord {
  softwareName: string;
  softwareLogoUrl: string | null;
  category: string;
  currentVersion: string | null;
  isNewer: boolean;
}

export interface LifecycleFeedItem extends LifecycleRecord {
  softwareName: string;
  softwareLogoUrl: string | null;
  currentVersion: string | null;
  note: string | null;
}

export interface SearchResult {
  software: Array<{ id: string; name: string; category: string }>;
  events: IntelEvent[];
  advisories: Array<{ id: string; softwareId: string; identifier: string; title: string; severity: string }>;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
