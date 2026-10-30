import type { DataSourceType, DiscoverySourceType, SourceType } from '../../shared/types.js';

export type SourceProbe = 'github' | 'endoflife' | 'nvd' | 'cisa' | 'cncf' | 'unsupported';
export type TaskGroup = 'software' | 'discovery';

export interface DataSourceDefinition {
  key: string;
  name: string;
  type: DataSourceType;
  description: string;
  officialUrl: string | null;
  enabled: boolean;
  freshnessInterval: number;
  freshnessGracePeriod: number;
  freshnessEnabled: boolean;
  probe: SourceProbe;
  group: TaskGroup;
  adapterType?: SourceType;
  discoveryType?: DiscoverySourceType;
}

export interface CollectionTaskDefinition {
  key: string;
  name: string;
  sourceKey: string;
  description: string;
  timeoutSeconds: number;
  enabled: boolean;
}

/**
 * Only sources that are actually backed by an adapter in this repository are
 * registered. The upstream advisory adapter is a real placeholder in the
 * codebase, so it is shown as disabled instead of pretending it is connected.
 */
export const DATA_SOURCE_DEFINITIONS: DataSourceDefinition[] = [
  {
    key: 'endoflife',
    name: 'endoflife.date',
    type: 'lifecycle',
    description: '发布周期、支持状态与维护截止日期。',
    officialUrl: 'https://endoflife.date',
    enabled: true,
    freshnessInterval: 168,
    freshnessGracePeriod: 48,
    freshnessEnabled: true,
    probe: 'endoflife',
    group: 'software',
    adapterType: 'endoflife',
  },
  {
    key: 'github_releases',
    name: 'GitHub Releases',
    type: 'release',
    description: 'GitHub 仓库的稳定版与预发布版本。',
    officialUrl: 'https://docs.github.com/en/rest/releases',
    enabled: true,
    freshnessInterval: 24,
    freshnessGracePeriod: 12,
    freshnessEnabled: true,
    probe: 'github',
    group: 'software',
    adapterType: 'github_releases',
  },
  {
    key: 'github_advisories',
    name: 'GitHub Advisory',
    type: 'security',
    description: 'GitHub 全球安全公告与受影响版本范围。',
    officialUrl: 'https://github.com/advisories',
    enabled: true,
    freshnessInterval: 24,
    freshnessGracePeriod: 12,
    freshnessEnabled: true,
    probe: 'github',
    group: 'software',
    adapterType: 'github_advisories',
  },
  {
    key: 'nvd',
    name: 'NVD CVE',
    type: 'security',
    description: 'NIST 国家漏洞数据库，使用关键词搜索并限速。',
    officialUrl: 'https://nvd.nist.gov',
    enabled: true,
    freshnessInterval: 24,
    freshnessGracePeriod: 12,
    freshnessEnabled: true,
    probe: 'nvd',
    group: 'software',
    adapterType: 'nvd',
  },
  {
    key: 'cisa_kev',
    name: 'CISA KEV',
    type: 'security',
    description: '已知遭实际利用漏洞目录，用于提升漏洞优先级。',
    officialUrl: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
    enabled: true,
    freshnessInterval: 24,
    freshnessGracePeriod: 12,
    freshnessEnabled: true,
    probe: 'cisa',
    group: 'software',
    adapterType: 'cisa_kev',
  },
  {
    key: 'upstream_advisory',
    name: '上游厂商公告',
    type: 'security',
    description: '预留的厂商公告适配器，目前尚未接入具体 API。',
    officialUrl: null,
    enabled: false,
    freshnessInterval: 168,
    freshnessGracePeriod: 24,
    freshnessEnabled: false,
    probe: 'unsupported',
    group: 'software',
    adapterType: 'upstream_advisory',
  },
  {
    key: 'discovery_github',
    name: 'GitHub 技术发现',
    type: 'discovery',
    description: '按可检查的搜索规则发现 GitHub 候选项目。',
    officialUrl: 'https://docs.github.com/en/rest/search',
    enabled: true,
    freshnessInterval: 24,
    freshnessGracePeriod: 12,
    freshnessEnabled: true,
    probe: 'github',
    group: 'discovery',
    discoveryType: 'github',
  },
  {
    key: 'discovery_cncf',
    name: 'CNCF Landscape',
    type: 'discovery',
    description: '读取 CNCF 官方 Landscape 中的毕业与孵化项目。',
    officialUrl: 'https://landscape.cncf.io',
    enabled: true,
    freshnessInterval: 168,
    freshnessGracePeriod: 48,
    freshnessEnabled: true,
    probe: 'cncf',
    group: 'discovery',
    discoveryType: 'cncf',
  },
];

export const COLLECTION_TASK_DEFINITIONS: CollectionTaskDefinition[] = [
  {
    key: 'sync_endoflife',
    name: '生命周期采集',
    sourceKey: 'endoflife',
    description: '为已启用 endoflife.date 数据源的软件同步生命周期记录。',
    timeoutSeconds: 300,
    enabled: true,
  },
  {
    key: 'sync_github_releases',
    name: 'GitHub 版本采集',
    sourceKey: 'github_releases',
    description: '同步已配置仓库的 GitHub Releases。',
    timeoutSeconds: 300,
    enabled: true,
  },
  {
    key: 'sync_github_advisories',
    name: 'GitHub 安全公告采集',
    sourceKey: 'github_advisories',
    description: '同步 GitHub 安全公告及其受影响版本范围。',
    timeoutSeconds: 300,
    enabled: true,
  },
  {
    key: 'sync_nvd',
    name: 'NVD 漏洞采集',
    sourceKey: 'nvd',
    description: '按软件关键词查询 NVD CVE，受 API 限速约束。',
    timeoutSeconds: 600,
    enabled: true,
  },
  {
    key: 'sync_cisa_kev',
    name: 'CISA KEV 匹配',
    sourceKey: 'cisa_kev',
    description: '刷新 CISA KEV 目录并匹配已有漏洞记录。',
    timeoutSeconds: 180,
    enabled: true,
  },
  {
    key: 'sync_upstream_advisory',
    name: '上游公告采集（未接入）',
    sourceKey: 'upstream_advisory',
    description: '厂商公告适配器尚未配置，任务保持停用。',
    timeoutSeconds: 180,
    enabled: false,
  },
  {
    key: 'discovery_github',
    name: 'GitHub 技术发现',
    sourceKey: 'discovery_github',
    description: '执行已启用的 GitHub 发现规则。',
    timeoutSeconds: 300,
    enabled: true,
  },
  {
    key: 'discovery_cncf',
    name: 'CNCF 技术发现',
    sourceKey: 'discovery_cncf',
    description: '读取 CNCF Landscape 并更新候选池。',
    timeoutSeconds: 180,
    enabled: true,
  },
];

export const DATA_SOURCE_TYPE_LABELS: Record<DataSourceType, string> = {
  lifecycle: '生命周期',
  release: '版本发布',
  security: '安全漏洞',
  discovery: '技术发现',
};

export function sourceDefinitionByKey(key: string): DataSourceDefinition | undefined {
  return DATA_SOURCE_DEFINITIONS.find((source) => source.key === key);
}

export function sourceKeyForAdapter(type: SourceType): string {
  return type;
}

export function sourceKeyForDiscovery(type: DiscoverySourceType): string {
  return `discovery_${type}`;
}

export function sourceDefinitionForAdapter(type: SourceType): DataSourceDefinition | undefined {
  return DATA_SOURCE_DEFINITIONS.find((source) => source.adapterType === type);
}
