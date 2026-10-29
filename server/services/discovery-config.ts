import type { DiscoverySourceType } from '../../shared/types.js';

export interface DiscoverySourceSeed {
  id: string;
  type: DiscoverySourceType;
  name: string;
  enabled: boolean;
}

export interface DiscoveryRuleSeed {
  id: string;
  sourceId: string;
  name: string;
  query: string;
  category: string;
  enabled: boolean;
}

export const DEFAULT_DISCOVERY_SOURCES: DiscoverySourceSeed[] = [
  { id: 'github', type: 'github', name: 'GitHub', enabled: true },
  { id: 'cncf', type: 'cncf', name: 'CNCF Landscape', enabled: true },
];

// The first phase deliberately uses a small, inspectable rule set. Queries are
// shown in the UI so "coverage" is never presented as all of GitHub.
export const DEFAULT_DISCOVERY_RULES: DiscoveryRuleSeed[] = [
  {
    id: 'github-kubernetes',
    sourceId: 'github',
    name: 'Kubernetes 与云原生',
    query: 'topic:kubernetes stars:>1000 archived:false fork:false',
    category: '云原生',
    enabled: true,
  },
  {
    id: 'github-observability',
    sourceId: 'github',
    name: '监控、日志与可观测性',
    query: 'topic:observability stars:>500 archived:false fork:false',
    category: '可观测性',
    enabled: true,
  },
  {
    id: 'github-devops',
    sourceId: 'github',
    name: 'DevOps 与发布治理',
    query: 'topic:devops stars:>800 archived:false fork:false',
    category: 'DevOps 与发布',
    enabled: true,
  },
  {
    id: 'github-sre',
    sourceId: 'github',
    name: 'SRE 与稳定性',
    query: 'topic:sre stars:>200 archived:false fork:false',
    category: 'SRE 与稳定性',
    enabled: true,
  },
  {
    id: 'github-iac',
    sourceId: 'github',
    name: '基础设施自动化',
    query: 'topic:infrastructure-as-code stars:>300 archived:false fork:false',
    category: '基础设施自动化',
    enabled: true,
  },
  {
    id: 'github-networking',
    sourceId: 'github',
    name: '网络、网关与边缘',
    query: 'topic:service-mesh stars:>300 archived:false fork:false',
    category: '网络与边缘',
    enabled: true,
  },
  {
    id: 'cncf-projects',
    sourceId: 'cncf',
    name: 'CNCF 毕业与孵化项目',
    query: 'maturity:graduated,incubating',
    category: 'CNCF 云原生',
    enabled: true,
  },
];
