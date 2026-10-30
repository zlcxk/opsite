import type {
  TechExternalLink,
  TechGraphData,
  TechNodeType,
  TechRelationType,
  TechViewType,
} from '../../shared/types.js';
import { db, nowIso } from '../db.js';
import { seedTechContent } from './tech-content.js';

export interface SeedNode {
  id: string;
  parentId: string | null;
  name: string;
  nodeType: TechNodeType;
  summary: string;
  description?: string;
  technicalRole?: string;
  corePrinciple?: string;
  solvedProblem?: string;
  keyMechanism?: string;
  useCases?: string;
  commonIssues?: string;
  docsUrl?: string;
  repoUrl?: string;
  referenceLinks?: TechExternalLink[];
  softwareSlug?: string;
}

export interface SeedRelation {
  id: string;
  source: string;
  target: string;
  relationType: TechRelationType;
  description?: string;
}

export interface SeedView {
  id: string;
  name: string;
  description: string;
  viewType: TechViewType;
  graphData: TechGraphData;
}

export interface SeedDomain {
  id: string;
  name: string;
  description: string;
  icon: string;
  nodes: SeedNode[];
  relations: SeedRelation[];
  views: SeedView[];
}

export interface TechTemplate {
  key: string;
  name: string;
  description: string;
  domains: SeedDomain[];
}

function n(
  id: string,
  parentId: string | null,
  name: string,
  nodeType: TechNodeType,
  summary: string,
  extra: Partial<Omit<SeedNode, 'id' | 'parentId' | 'name' | 'nodeType' | 'summary'>> = {},
): SeedNode {
  return { id, parentId, name, nodeType, summary, ...extra };
}

function gn(
  id: string,
  nodeId: string | null,
  label: string,
  x: number,
  y: number,
  extra: { width?: number; height?: number; note?: string } = {},
) {
  return {
    id,
    nodeId,
    label,
    x,
    y,
    width: extra.width ?? 168,
    height: extra.height ?? 54,
    note: extra.note ?? null,
    nodeType: null,
  };
}

function ge(
  id: string,
  source: string,
  target: string,
  label: string | null,
  relationType: TechRelationType | null = null,
) {
  return { id, source, target, label, relationType };
}

/* ------------------------------ Kubernetes ------------------------------ */

const kubernetesNodes: SeedNode[] = [
  n('k8s-core', null, '核心架构', 'concept', '控制平面、工作节点与声明式 API 共同构成 Kubernetes 的运行基础。', {
    description:
      'Kubernetes 是一个声明式容器编排系统。用户提交期望状态，控制平面持续将实际状态收敛到期望状态，工作节点负责运行容器。',
    technicalRole: '理解集群行为、排查控制面与节点问题的第一层知识。',
    corePrinciple: '控制循环（watch → diff → act）是几乎所有 Kubernetes 行为背后的统一模型。',
    docsUrl: 'https://kubernetes.io/docs/concepts/architecture/',
  }),
  n('k8s-control-plane', 'k8s-core', '控制平面', 'concept', '负责集群决策与状态存储的组件集合，包括 apiserver、etcd、调度器和控制器管理器。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/overview/components/#control-plane-components',
  }),
  n(
    'k8s-apiserver',
    'k8s-control-plane',
    'kube-apiserver',
    'component',
    '集群唯一的 REST API 入口，负责认证、授权、准入控制并把对象状态写入 etcd。',
    {
      description:
        'kube-apiserver 暴露 Kubernetes API。所有客户端（kubectl、控制器、kubelet）都通过它读写对象，其他控制平面组件不会直接访问 etcd。',
      technicalRole: '集群的读写中枢与安全边界。',
      corePrinciple: '请求依次经过认证、授权、准入（mutating → validating）后持久化；watch 机制把变更推送给所有观察者。',
      solvedProblem: '为分布式集群提供一致的、可扩展的声明式 API。',
      keyMechanism: 'Aggregated API、admission webhook、resourceVersion 乐观并发、watch 缓存。',
      useCases: '审计 API 访问、排查 403/429、部署 admission 策略、定位控制面延迟。',
      commonIssues: '请求量过大导致 429；webhook 超时拖慢全部写入；etcd 延迟会直接放大 API 延迟。',
      docsUrl: 'https://kubernetes.io/docs/concepts/overview/components/#kube-apiserver',
    },
  ),
  n(
    'k8s-etcd',
    'k8s-control-plane',
    'etcd',
    'component',
    '保存整个集群状态的强一致键值存储，使用 Raft 复制，是集群备份的核心对象。',
    {
      description:
        'etcd 是 Kubernetes 的唯一数据源。apiserver 把对象序列化后写入 etcd，watch 事件也从这里产生。',
      technicalRole: '集群状态的持久化与一致性基础。',
      corePrinciple: 'Raft 多数派提交；写请求需要达到法定人数，节点故障或磁盘变慢会直接影响写入。',
      solvedProblem: '在多个控制平面节点之间提供强一致的元数据存储。',
      keyMechanism: 'WAL、快照、压缩（compaction）、lease、revision。',
      useCases: 'etcd 快照备份、恢复演练、容量与磁盘延迟监控。',
      commonIssues: '磁盘 fsync 慢导致 leader 抖动；未做 defrag 造成数据库膨胀；备份未验证导致恢复失败。',
      docsUrl: 'https://kubernetes.io/docs/concepts/overview/components/#etcd',
    },
  ),
  n(
    'k8s-scheduler',
    'k8s-control-plane',
    'kube-scheduler',
    'component',
    '为新创建的 Pod 选择合适节点：先按硬性条件过滤，再按软性策略打分排序。',
    {
      description:
        '调度器监听尚未绑定节点的 Pod，结合资源请求、亲和性、污点、拓扑分布等条件选择节点，并写入 binding。',
      technicalRole: '决定 Pod 落在哪个节点。',
      corePrinciple: 'Filter（可行节点）→ Score（打分）→ Bind；调度只看 request，不看实时使用率。',
      solvedProblem: '在异构节点与多样约束下自动放置工作负载。',
      keyMechanism: '调度框架插件、nodeAffinity、podAffinity、taints/tolerations、topology spread。',
      useCases: '排查 Pending、设计多可用区分布、配置专用节点池。',
      commonIssues: '资源 request 过大导致 Pending；节点污点未容忍；亲和性过严导致无法调度。',
      docsUrl: 'https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/',
    },
  ),
  n(
    'k8s-controller-manager',
    'k8s-control-plane',
    'kube-controller-manager',
    'component',
    '运行 Deployment、ReplicaSet、Node、Job 等内置控制器的主循环进程。',
    {
      description:
        '多个内置控制器被编译进同一个进程，通过 leader election 保证同一时刻只有一个实例执行控制逻辑。',
      technicalRole: '维持工作负载与集群对象的期望状态。',
      corePrinciple: '每个控制器 watch 一类资源，比较期望与实际，然后发起最小必要的变更。',
      docsUrl: 'https://kubernetes.io/docs/concepts/overview/components/#kube-controller-manager',
    },
  ),
  n(
    'k8s-cloud-controller-manager',
    'k8s-control-plane',
    'cloud-controller-manager',
    'component',
    '把节点生命周期、路由和 LoadBalancer 等云厂商能力从核心控制器中解耦出来。',
    {
      description: '云控制器管理器运行云厂商相关的控制器，使 Kubernetes 核心代码不依赖具体云平台。',
      docsUrl: 'https://kubernetes.io/docs/concepts/overview/components/#cloud-controller-manager',
    },
  ),
  n('k8s-worker-node', 'k8s-core', '工作节点', 'concept', '运行 Pod 的机器，包含 kubelet、kube-proxy 与容器运行时。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/overview/components/#node-components',
  }),
  n(
    'k8s-kubelet',
    'k8s-worker-node',
    'kubelet',
    'component',
    '节点代理：接收 PodSpec，调用 CRI 运行容器，执行探针并上报状态。',
    {
      description:
        'kubelet 在每个节点上运行，是节点上唯一直接与 apiserver 通信的组件。它负责卷挂载、容器生命周期、探针和状态上报。',
      technicalRole: '把调度结果真正落到节点上。',
      corePrinciple: 'watch 属于本节点的 PodSpec；通过 CRI 管理容器，通过 CSI 挂载卷，通过 PLEG 感知容器状态。',
      solvedProblem: '将声明式 Pod 规范转换为节点上的实际进程。',
      keyMechanism: 'static pod、pod sandbox、liveness/readiness/startup probe、node status 心跳。',
      useCases: '排查 Pod 启动失败、节点 NotReady、探针误杀。',
      commonIssues: '镜像拉取失败；PLEG 延迟触发节点异常；资源压力触发驱逐。',
      docsUrl: 'https://kubernetes.io/docs/concepts/overview/components/#kubelet',
    },
  ),
  n(
    'k8s-kube-proxy',
    'k8s-worker-node',
    'kube-proxy',
    'component',
    '在每个节点上实现 Service 的虚拟 IP 与负载均衡规则，支持 iptables、IPVS 等模式。',
    {
      description:
        'kube-proxy 监听 Service 与 EndpointSlice 变化，把访问 ClusterIP 的流量转发到后端 Pod。部分 CNI（如 Cilium）会完全替换这一层。',
      technicalRole: 'Service 数据面的节点级实现。',
      corePrinciple: '把 Service 规则编程到 iptables/IPVS/nftables，由内核完成 DNAT 与负载均衡。',
      docsUrl: 'https://kubernetes.io/docs/concepts/overview/components/#kube-proxy',
    },
  ),
  n('k8s-container-runtime', 'k8s-worker-node', '容器运行时', 'concept', '真正负责拉取镜像、创建容器与隔离资源的软件层。', {
    docsUrl: 'https://kubernetes.io/docs/setup/production-environment/container-runtimes/',
  }),
  n('k8s-containerd', 'k8s-container-runtime', 'containerd', 'component', '常用的 CRI 容器运行时，负责镜像与容器生命周期，底层调用 runc。', {
    docsUrl: 'https://containerd.io/docs/',
    softwareSlug: 'containerd',
  }),
  n('k8s-cri', 'k8s-container-runtime', 'CRI', 'protocol', 'kubelet 与容器运行时之间的 gRPC 接口，解耦编排层与运行时实现。', {
    docsUrl: 'https://github.com/kubernetes/cri-api',
  }),
  n('k8s-oci', 'k8s-container-runtime', 'OCI 标准', 'protocol', '规定容器镜像格式与运行时行为，使镜像和运行时可以跨工具复用。', {
    docsUrl: 'https://opencontainers.org/',
  }),
  n('k8s-declarative-api', 'k8s-core', '声明式 API', 'concept', '用户描述期望状态而不是执行步骤，系统持续调和差异。', {
    description:
      '声明式 API 是 Kubernetes 与脚本式运维的根本区别：提交 YAML 后，控制器负责补齐或回收资源；重复提交同一对象是幂等的。',
    docsUrl: 'https://kubernetes.io/docs/concepts/overview/working-with-objects/',
  }),
  n('k8s-resource-object', 'k8s-declarative-api', '资源对象', 'concept', 'API 中的持久化实体，由 apiVersion、kind、metadata、spec 与 status 组成。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/overview/working-with-objects/kubernetes-objects/',
  }),
  n('k8s-controller-pattern', 'k8s-declarative-api', '控制器模式', 'concept', '观察资源、比较期望与实际、执行动作并重复的循环。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/architecture/controller/',
  }),
  n('k8s-reconciliation', 'k8s-declarative-api', '调和循环', 'concept', '控制器不断把实际状态拉回期望状态的过程，是自愈能力的来源。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/architecture/controller/#control-loop',
  }),
  n('k8s-label-selector', 'k8s-declarative-api', 'Label 与 Selector', 'concept', '用键值标签组织对象，用选择器表达“哪些对象属于我”。', {
    description: 'Service、Deployment、NetworkPolicy、Operator 的选择器都依赖标签；标签设计错误会造成流量或策略错配。',
    docsUrl: 'https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/',
  }),
  n('k8s-namespace', 'k8s-declarative-api', 'Namespace', 'resource', '在同一集群内划分逻辑隔离与资源配额作用域。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/',
  }),

  n('k8s-workloads', null, '工作负载', 'concept', 'Pod 与各类控制器，决定应用如何运行、扩缩和更新。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/workloads/',
  }),
  n(
    'k8s-pod',
    'k8s-workloads',
    'Pod',
    'resource',
    'Kubernetes 最小调度单元：一个或多个共享网络与卷的容器。',
    {
      description:
        'Pod 内的容器共享网络命名空间和挂载卷，通常包含一个主容器和若干边车。Pod 是临时对象，重建后 IP 和身份会变化。',
      technicalRole: '应用运行的最小载体。',
      corePrinciple: '同一 Pod 内的容器通过 localhost 通信，共享 Pod IP；生命周期由 kubelet 管理。',
      solvedProblem: '为紧耦合进程提供共享网络与存储的原子调度单位。',
      keyMechanism: 'pause 容器持有网络命名空间；init container 顺序初始化；探针决定就绪与重启。',
      useCases: '部署单容器应用；通过边车提供代理、日志或安全能力。',
      commonIssues: '直接修改 Pod 不会持久化；OOMKilled；readiness 失败导致 Service 无端点。',
      docsUrl: 'https://kubernetes.io/docs/concepts/workloads/pods/',
    },
  ),
  n(
    'k8s-deployment',
    'k8s-workloads',
    'Deployment',
    'resource',
    '管理无状态应用的 ReplicaSet，支持滚动更新、回滚与副本伸缩。',
    {
      description:
        'Deployment 声明期望副本数与 Pod 模板。更新模板会创建新的 ReplicaSet，并按 maxSurge / maxUnavailable 逐步替换旧 Pod。',
      technicalRole: '无状态服务最常用的工作负载控制器。',
      corePrinciple: '通过 ReplicaSet 间接管理 Pod；每次模板变更生成新的 ReplicaSet 以保留 revision。',
      solvedProblem: '以可控节奏发布新版本并支持快速回滚。',
      keyMechanism: 'RollingUpdate、Recreate、revisionHistoryLimit、progressDeadlineSeconds。',
      useCases: 'Web 服务、API 服务、无状态后台任务。',
      commonIssues: '镜像 tag 不变导致未触发更新；readiness 缺失导致流量进入未就绪实例；回滚受 revisionHistoryLimit 限制。',
      docsUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/',
    },
  ),
  n('k8s-replicaset', 'k8s-workloads', 'ReplicaSet', 'resource', '维持指定数量的 Pod 副本，通常由 Deployment 托管。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/',
  }),
  n(
    'k8s-statefulset',
    'k8s-workloads',
    'StatefulSet',
    'resource',
    '为有状态应用提供稳定的序号、网络标识和每副本独立存储。',
    {
      description: 'StatefulSet 的 Pod 名称按序号固定（如 db-0、db-1），通常配合 Headless Service 与 volumeClaimTemplates 使用。',
      technicalRole: '运行数据库、消息队列等需要稳定身份的工作负载。',
      corePrinciple: '稳定网络标识 + 稳定存储 + 有序滚动；删除 Pod 不会自动删除其 PVC。',
      useCases: 'PostgreSQL、Kafka、Elasticsearch 等集群化有状态服务。',
      commonIssues: '误以为缩容会删除 PVC；有序启动导致启动慢；Headless Service 配置错误。',
      docsUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/',
    },
  ),
  n('k8s-daemonset', 'k8s-workloads', 'DaemonSet', 'resource', '在符合条件的每个节点上运行一个 Pod，常用于日志、监控和网络代理。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/',
  }),
  n('k8s-job', 'k8s-workloads', 'Job', 'resource', '运行到成功完成的批处理任务，支持并行度与失败重试。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/job/',
  }),
  n('k8s-cronjob', 'k8s-workloads', 'CronJob', 'resource', '按 cron 计划创建 Job，并管理并发策略与历史保留。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/',
  }),
  n('k8s-init-container', 'k8s-workloads', 'Init Container', 'concept', '在主容器启动前顺序执行的一次性初始化容器，必须成功退出。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/workloads/pods/init-containers/',
  }),

  n('k8s-networking', null, '网络', 'concept', 'Pod 网络、Service 负载均衡、入口流量与网络策略。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/services-networking/',
  }),
  n(
    'k8s-service',
    'k8s-networking',
    'Service',
    'resource',
    '为一组 Pod 提供稳定虚拟 IP 与 DNS 名称，并按标签选择后端端点。',
    {
      description:
        'Service 通过 selector 关联 Pod，生成 EndpointSlice，再由 kube-proxy 或 CNI 把 ClusterIP 流量转发到后端。',
      technicalRole: '解耦应用调用方与 Pod 的临时 IP。',
      corePrinciple: '虚拟 IP + 端点列表 + 内核转发规则；DNS 名称格式为 service.namespace.svc.cluster.local。',
      solvedProblem: 'Pod 频繁重建导致地址变化时，仍提供稳定访问入口。',
      keyMechanism: 'ClusterIP、NodePort、LoadBalancer、ExternalName、Headless Service。',
      useCases: '服务间调用、暴露内部 API、为 StatefulSet 提供稳定 DNS。',
      commonIssues: 'selector 与 Pod 标签不匹配导致无端点；targetPort 写错；会话保持需求未实现。',
      docsUrl: 'https://kubernetes.io/docs/concepts/services-networking/service/',
    },
  ),
  n('k8s-clusterip', 'k8s-service', 'ClusterIP', 'concept', '默认 Service 类型，只在集群内部可达的虚拟 IP。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/services-networking/service/#type-clusterip',
  }),
  n('k8s-nodeport', 'k8s-service', 'NodePort', 'concept', '在每个节点上开放固定端口，把流量转发到 Service。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/services-networking/service/#type-nodeport',
  }),
  n('k8s-loadbalancer', 'k8s-service', 'LoadBalancer', 'concept', '通过云厂商或 MetalLB 申请外部负载均衡器，并自动创建 NodePort。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/services-networking/service/#loadbalancer',
  }),
  n('k8s-endpointslice', 'k8s-networking', 'EndpointSlice', 'resource', '把 Service 的后端地址按块存储，替代单一 Endpoints 对象以提升规模与拓扑能力。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/',
  }),
  n(
    'k8s-ingress',
    'k8s-networking',
    'Ingress',
    'resource',
    '声明 HTTP/HTTPS 路由与 TLS，由 Ingress Controller 实际实现。',
    {
      description:
        'Ingress 只描述规则，本身不处理流量；集群必须安装 Nginx、Traefik 等 Ingress Controller，才会创建对应的负载均衡入口。',
      technicalRole: '集群南北向 HTTP 流量的统一入口。',
      corePrinciple: '按 host / path 匹配并转发到 Service；TLS 证书通过 Secret 引用。',
      useCases: '多域名暴露、路径路由、统一 TLS 终止。',
      commonIssues: 'IngressClass 不匹配导致规则不生效；后端 Service 无端点；证书 Secret 缺失。',
      docsUrl: 'https://kubernetes.io/docs/concepts/services-networking/ingress/',
    },
  ),
  n('k8s-gateway-api', 'k8s-networking', 'Gateway API', 'direction', '面向角色的下一代入口 API，用 GatewayClass、Gateway、HTTPRoute 拆分基础设施与应用职责。', {
    docsUrl: 'https://gateway-api.sigs.k8s.io/',
  }),
  n('k8s-cni', 'k8s-networking', 'CNI', 'protocol', '容器网络接口规范，负责为 Pod 分配 IP、配置路由与实现网络策略。', {
    docsUrl: 'https://www.cni.dev/docs/',
  }),
  n('k8s-calico', 'k8s-cni', 'Calico', 'component', '常用的 Kubernetes 网络与网络策略方案，支持 iptables 与 eBPF 数据面。', {
    docsUrl: 'https://docs.tigera.io/calico/latest/about/',
    softwareSlug: 'calico',
  }),
  n('k8s-cilium', 'k8s-cni', 'Cilium', 'component', '基于 eBPF 的网络、安全与可观测性平台，可替代 kube-proxy 并提供 L7 策略。', {
    docsUrl: 'https://docs.cilium.io/',
    softwareSlug: 'cilium',
  }),
  n('k8s-coredns', 'k8s-networking', 'CoreDNS', 'component', '集群 DNS 服务，为 Service 与 Pod 提供名称解析。', {
    docsUrl: 'https://coredns.io/manual/toc/',
  }),
  n('k8s-networkpolicy', 'k8s-networking', 'NetworkPolicy', 'resource', '以标签选择器声明 Pod 间允许的 L3/L4 流量，由 CNI 负责执行。', {
    description:
      'NetworkPolicy 是白名单模型：一旦某个 Pod 被某条策略选中，未被允许的方向默认拒绝。策略能否生效取决于 CNI 是否支持。',
    docsUrl: 'https://kubernetes.io/docs/concepts/services-networking/network-policies/',
  }),

  n('k8s-storage', null, '存储', 'concept', '卷、持久卷、动态供给与配置/密钥数据管理。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/storage/',
  }),
  n('k8s-volume', 'k8s-storage', 'Volume', 'concept', 'Pod 级别的挂载卷，生命周期与 Pod 绑定，用于共享文件或注入配置。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/storage/volumes/',
  }),
  n('k8s-pv', 'k8s-storage', 'PersistentVolume', 'resource', '集群级存储资源，可由管理员静态创建或由 StorageClass 动态供给。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/storage/persistent-volumes/',
  }),
  n('k8s-pvc', 'k8s-storage', 'PersistentVolumeClaim', 'resource', '命名空间内的存储请求，按容量与访问模式绑定到 PV。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/storage/persistent-volumes/#persistentvolumeclaims',
  }),
  n('k8s-storageclass', 'k8s-storage', 'StorageClass', 'resource', '定义动态供给使用的 CSI 驱动、参数与绑定模式。', {
    description: 'WaitForFirstConsumer 会把卷创建推迟到 Pod 调度后，避免跨可用区绑定失败。',
    docsUrl: 'https://kubernetes.io/docs/concepts/storage/storage-classes/',
  }),
  n('k8s-csi', 'k8s-storage', 'CSI', 'protocol', '容器存储接口，标准化块/文件存储的挂载、快照与扩容能力。', {
    docsUrl: 'https://kubernetes-csi.github.io/docs/',
  }),
  n('k8s-configmap', 'k8s-storage', 'ConfigMap', 'resource', '存放非敏感配置，可作为环境变量、命令行参数或文件挂载。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/configuration/configmap/',
  }),
  n('k8s-secret', 'k8s-storage', 'Secret', 'resource', '存放密码、Token 与证书等敏感数据，默认只做 base64 编码而非加密。', {
    description:
      'Secret 的安全性依赖 RBAC、etcd 静态加密、传输 TLS 以及最小权限挂载。base64 不是加密，任何能读取 Secret 的主体都能还原明文。',
    docsUrl: 'https://kubernetes.io/docs/concepts/configuration/secret/',
  }),

  n('k8s-scheduling', null, '调度与弹性', 'concept', '资源请求、放置约束、干扰预算与自动扩缩容。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/scheduling-eviction/',
  }),
  n('k8s-resource-requests', 'k8s-scheduling', '资源请求与限制', 'concept', 'requests 决定调度与保障，limits 决定运行时上限。', {
    description: '调度只看 requests；CPU 超过 limit 会被节流，内存超过 limit 会触发 OOMKilled。',
    docsUrl: 'https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/',
  }),
  n('k8s-qos', 'k8s-scheduling', 'QoS 等级', 'concept', '按 requests/limits 配置把 Pod 分为 Guaranteed、Burstable、BestEffort，影响驱逐顺序。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/',
  }),
  n('k8s-affinity', 'k8s-scheduling', '亲和与反亲和', 'concept', '用节点或 Pod 标签表达强制的/偏好的放置关系。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/',
  }),
  n('k8s-taint-toleration', 'k8s-scheduling', 'Taint 与 Toleration', 'concept', '节点用污点排斥 Pod，Pod 用容忍声明可以接受哪些污点。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/',
  }),
  n('k8s-pdb', 'k8s-scheduling', 'PodDisruptionBudget', 'resource', '限制自愿中断时同时不可用的 Pod 数量，保护滚动维护期间的可用性。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/workloads/pods/disruptions/',
  }),
  n(
    'k8s-hpa',
    'k8s-scheduling',
    'HorizontalPodAutoscaler',
    'resource',
    '根据指标自动调整副本数；资源指标依赖 Metrics Server。',
    {
      description:
        'HPA 周期性读取指标，按目标利用率计算期望副本数，并更新 Deployment/StatefulSet 等控制器的 replicas。',
      technicalRole: '无状态服务的水平弹性。',
      corePrinciple: 'desiredReplicas = ceil(currentReplicas × currentMetric / targetMetric)，并受 min/max 与稳定窗口约束。',
      useCases: '流量波动明显的 Web/API 服务；结合自定义指标按队列长度扩缩。',
      commonIssues: '未配置 requests 导致利用率无意义；指标延迟造成震荡；扩容受节点资源不足限制。',
      docsUrl: 'https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/',
    },
  ),
  n('k8s-vpa', 'k8s-scheduling', 'VerticalPodAutoscaler', 'component', '基于历史使用量推荐或调整容器 requests/limits。', {
    docsUrl: 'https://github.com/kubernetes/autoscaler/tree/master/vertical-pod-autoscaler',
  }),
  n('k8s-cluster-autoscaler', 'k8s-scheduling', 'Cluster Autoscaler', 'component', '在有 Pending Pod 时增加节点，在节点长期低利用时安全缩容。', {
    docsUrl: 'https://github.com/kubernetes/autoscaler/tree/master/cluster-autoscaler',
  }),
  n('k8s-resourcequota', 'k8s-scheduling', 'ResourceQuota', 'resource', '限制命名空间内资源总量与对象数量。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/policy/resource-quotas/',
  }),
  n('k8s-limitrange', 'k8s-scheduling', 'LimitRange', 'resource', '为命名空间内未显式配置的容器设置默认 requests/limits 与取值范围。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/policy/limit-range/',
  }),

  n('k8s-observability', null, '可观测性', 'concept', '指标、事件、日志与追踪共同回答“系统现在怎么样、为什么”。', {
    docsUrl: 'https://kubernetes.io/docs/tasks/debug/',
  }),
  n('k8s-metrics-server', 'k8s-observability', 'Metrics Server', 'component', '从 kubelet 汇总资源用量，提供 metrics.k8s.io API 供 HPA 与 kubectl top 使用。', {
    docsUrl: 'https://github.com/kubernetes-sigs/metrics-server',
  }),
  n('k8s-events', 'k8s-observability', 'Events', 'concept', '记录调度、拉镜像、探针失败等对象状态变化，默认只保留约一小时。', {
    docsUrl: 'https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/event-v1/',
  }),
  n('k8s-logging', 'k8s-observability', '日志', 'concept', '容器 stdout/stderr 由节点收集，集群级检索需要独立的日志后端。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/cluster-administration/logging/',
  }),
  n('k8s-tracing', 'k8s-observability', '分布式追踪', 'concept', '通过 trace 上下文串联跨服务调用，定位延迟与错误传播。', {
    docsUrl: 'https://opentelemetry.io/docs/concepts/signals/traces/',
  }),
  n('k8s-monitoring', 'k8s-observability', 'Kubernetes 指标监控', 'practice', '以 Prometheus 生态采集节点、容器与对象状态指标，并与技术地图中的 Prometheus 领域关联。', {
    description:
      'Kubernetes 本身不提供长期指标存储。常见做法是部署 Prometheus Operator，采集 node-exporter、kube-state-metrics 与业务指标。',
    docsUrl: 'https://prometheus-operator.dev/docs/',
  }),

  n('k8s-security', null, '安全', 'concept', '身份、授权、准入、工作负载加固与供应链安全。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/security/',
  }),
  n(
    'k8s-rbac',
    'k8s-security',
    'RBAC',
    'concept',
    '基于角色与绑定的授权模型，默认拒绝，按 apiGroups/resources/verbs 授权。',
    {
      description:
        'RBAC 通过 Role/ClusterRole 定义权限，通过 RoleBinding/ClusterRoleBinding 授予用户、组或 ServiceAccount。权限只在 API 层生效。',
      technicalRole: 'Kubernetes 授权的主力机制。',
      corePrinciple: '纯加法模型：没有任何绑定允许的请求即被拒绝；不存在显式 deny 规则。',
      solvedProblem: '以最小权限控制谁能读写哪些资源。',
      keyMechanism: 'Role、ClusterRole、RoleBinding、ClusterRoleBinding、aggregationRule。',
      useCases: '为运维、CI/CD、控制器分配最小权限；审计高权限绑定。',
      commonIssues: '给 default ServiceAccount 过大权限；ClusterRoleBinding 过宽；resources 与 verbs 混淆。',
      docsUrl: 'https://kubernetes.io/docs/reference/access-authn-authz/rbac/',
    },
  ),
  n('k8s-role', 'k8s-rbac', 'Role 与 RoleBinding', 'resource', '命名空间范围内的权限定义与授予。', {
    docsUrl: 'https://kubernetes.io/docs/reference/access-authn-authz/rbac/#role-and-rolebinding',
  }),
  n('k8s-clusterrole', 'k8s-rbac', 'ClusterRole 与 ClusterRoleBinding', 'resource', '集群范围的权限定义与授予，也可被多个命名空间的 RoleBinding 复用。', {
    docsUrl: 'https://kubernetes.io/docs/reference/access-authn-authz/rbac/#clusterrole-and-clusterrolebinding',
  }),
  n('k8s-serviceaccount', 'k8s-security', 'ServiceAccount', 'resource', '为 Pod 中的进程提供 API 身份，令牌通过 projected volume 注入。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/security/service-accounts/',
  }),
  n('k8s-psa', 'k8s-security', 'Pod Security Admission', 'concept', '用命名空间标签执行 privileged/baseline/restricted 三档 Pod 安全标准。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/security/pod-security-admission/',
  }),
  n('k8s-admission', 'k8s-security', 'Admission Webhook', 'concept', '在对象持久化前执行变更或校验的外部 HTTP 回调。', {
    docsUrl: 'https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/',
  }),
  n('k8s-policy-engine', 'k8s-security', '策略引擎', 'component', '通过准入控制实施组织策略，如 Kyverno、Gatekeeper/OPA。', {
    docsUrl: 'https://kyverno.io/docs/',
  }),
  n('k8s-image-security', 'k8s-security', '镜像安全', 'practice', '使用可信仓库、摘要固定、漏洞扫描与签名验证降低供应链风险。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/security/',
  }),

  n('k8s-delivery', null, '交付与扩展', 'concept', '把应用与平台能力交付到集群，并扩展 Kubernetes API。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/extend-kubernetes/',
  }),
  n('k8s-kubectl', 'k8s-delivery', 'kubectl', 'component', '通过 apiserver REST API 操作集群的官方命令行工具。', {
    docsUrl: 'https://kubernetes.io/docs/reference/kubectl/',
  }),
  n('k8s-helm', 'k8s-delivery', 'Helm', 'component', '用 Chart 模板化并管理 Kubernetes 资源，以 Release 记录部署版本。', {
    docsUrl: 'https://helm.sh/docs/',
    softwareSlug: 'helm',
  }),
  n('k8s-kustomize', 'k8s-delivery', 'Kustomize', 'component', '用 base 与 overlay 组合 YAML，不引入模板语言，已集成进 kubectl。', {
    docsUrl: 'https://kustomize.io/',
  }),
  n('k8s-crd', 'k8s-delivery', 'CRD', 'resource', '自定义资源定义，用声明式 schema 扩展 Kubernetes API。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/',
  }),
  n(
    'k8s-operator',
    'k8s-delivery',
    'Operator',
    'practice',
    '把领域运维知识编码为控制器与自定义资源，自动完成部署、扩缩、备份和故障恢复。',
    {
      description:
        'Operator = CRD + 自定义控制器。用户声明高层意图（如“3 副本、保留 15 天”），控制器负责生成底层资源并持续调和。',
      technicalRole: '有状态服务与复杂平台自动化的标准扩展方式。',
      corePrinciple: '控制器 watch 自定义资源与其派生资源，按调和循环收敛；状态写入 CR 的 status。',
      solvedProblem: '把需要人工执行的运维手册变成可重复执行的软件。',
      keyMechanism: 'CRD、controller-runtime、leader election、finalizer、status conditions。',
      useCases: 'Prometheus Operator、CloudNativePG、cert-manager、数据库与中间件运维。',
      commonIssues: 'CR 删除卡在 finalizer；控制器权限不足；Operator 升级与 CRD 版本不兼容。',
      docsUrl: 'https://kubernetes.io/docs/concepts/extend-kubernetes/operator/',
    },
  ),
  n('k8s-custom-controller', 'k8s-delivery', '自定义控制器', 'component', '监听资源并执行调和逻辑的进程，是 Operator 的核心实现。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/architecture/controller/',
  }),
  n('k8s-gitops', 'k8s-delivery', 'GitOps', 'practice', '以 Git 作为期望状态唯一来源，由集群内代理持续同步并检测漂移。', {
    docsUrl: 'https://opengitops.dev/',
  }),
  n(
    'k8s-argocd',
    'k8s-delivery',
    'Argo CD',
    'component',
    'Kubernetes 原生 GitOps 持续交付工具，支持 Application、同步策略与漂移检测。',
    {
      docsUrl: 'https://argo-cd.readthedocs.io/',
      softwareSlug: 'argo-cd',
    },
  ),
  n('k8s-flux', 'k8s-delivery', 'Flux', 'component', '由一组控制器组成的 GitOps 工具包，负责拉取、渲染并调和集群资源。', {
    docsUrl: 'https://fluxcd.io/flux/',
  }),
  n('k8s-keda', 'k8s-delivery', 'KEDA', 'component', '基于事件源指标驱动扩缩容，可在无事件时缩到零副本。', {
    docsUrl: 'https://keda.sh/docs/',
  }),

  n('k8s-operations', null, '集群运维', 'concept', '升级、备份、多集群治理与节点维护等日常运维主题。', {}),
  n('k8s-upgrade', 'k8s-operations', '集群升级', 'practice', '先升级控制平面再逐节点升级 kubelet，遵循版本倾斜与弃用 API 检查。', {
    docsUrl: 'https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-upgrade/',
  }),
  n('k8s-backup', 'k8s-operations', '备份与恢复', 'practice', '备份 etcd 快照与持久化数据，并定期演练恢复流程。', {
    docsUrl: 'https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/#backing-up-an-etcd-cluster',
  }),
  n('k8s-velero', 'k8s-operations', 'Velero', 'component', '备份、恢复与迁移集群资源和持久卷。', {
    docsUrl: 'https://velero.io/docs/',
  }),
  n('k8s-multi-cluster', 'k8s-operations', '多集群管理', 'practice', '在多个集群之间统一发布、观测与策略，控制爆炸半径。', {
    docsUrl: 'https://kubernetes.io/docs/concepts/cluster-administration/',
  }),
  n('k8s-cluster-api', 'k8s-operations', 'Cluster API', 'component', '用 CRD 与控制器声明式管理集群生命周期。', {
    docsUrl: 'https://cluster-api.sigs.k8s.io/',
  }),
  n('k8s-node-maintenance', 'k8s-operations', '节点维护', 'practice', 'cordon 停止调度、drain 驱逐 Pod，并尊重 PodDisruptionBudget。', {
    docsUrl: 'https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/',
  }),
];

const kubernetesRelations: SeedRelation[] = [
  { id: 'rel-k8s-cp-api', source: 'k8s-control-plane', target: 'k8s-apiserver', relationType: 'contains', description: '控制平面包含 API Server。' },
  { id: 'rel-k8s-cp-etcd', source: 'k8s-control-plane', target: 'k8s-etcd', relationType: 'contains' },
  { id: 'rel-k8s-cp-sched', source: 'k8s-control-plane', target: 'k8s-scheduler', relationType: 'contains' },
  { id: 'rel-k8s-cp-cm', source: 'k8s-control-plane', target: 'k8s-controller-manager', relationType: 'contains' },
  { id: 'rel-k8s-api-etcd', source: 'k8s-apiserver', target: 'k8s-etcd', relationType: 'depends_on', description: 'API Server 是唯一直接读写 etcd 的控制面组件。' },
  { id: 'rel-k8s-sched-api', source: 'k8s-scheduler', target: 'k8s-apiserver', relationType: 'depends_on' },
  { id: 'rel-k8s-kubelet-cri', source: 'k8s-kubelet', target: 'k8s-cri', relationType: 'depends_on', description: 'kubelet 通过 CRI 调用容器运行时。' },
  { id: 'rel-k8s-cri-containerd', source: 'k8s-cri', target: 'k8s-containerd', relationType: 'implements' },
  { id: 'rel-k8s-containerd-oci', source: 'k8s-containerd', target: 'k8s-oci', relationType: 'implements', description: 'containerd 拉取并运行 OCI 镜像。' },
  { id: 'rel-k8s-deploy-rs', source: 'k8s-deployment', target: 'k8s-replicaset', relationType: 'contains', description: 'Deployment 通过 ReplicaSet 管理 Pod。' },
  { id: 'rel-k8s-rs-pod', source: 'k8s-replicaset', target: 'k8s-pod', relationType: 'contains' },
  { id: 'rel-k8s-sts-pod', source: 'k8s-statefulset', target: 'k8s-pod', relationType: 'contains' },
  { id: 'rel-k8s-ds-pod', source: 'k8s-daemonset', target: 'k8s-pod', relationType: 'contains' },
  { id: 'rel-k8s-cron-job', source: 'k8s-cronjob', target: 'k8s-job', relationType: 'contains' },
  { id: 'rel-k8s-pod-runtime', source: 'k8s-pod', target: 'k8s-container-runtime', relationType: 'depends_on' },
  { id: 'rel-k8s-service-eps', source: 'k8s-service', target: 'k8s-endpointslice', relationType: 'depends_on' },
  { id: 'rel-k8s-service-proxy', source: 'k8s-service', target: 'k8s-kube-proxy', relationType: 'depends_on' },
  { id: 'rel-k8s-ingress-service', source: 'k8s-ingress', target: 'k8s-service', relationType: 'depends_on' },
  { id: 'rel-k8s-gateway-ingress', source: 'k8s-gateway-api', target: 'k8s-ingress', relationType: 'alternative', description: 'Gateway API 是 Ingress 的演进方向。' },
  { id: 'rel-k8s-calico-cni', source: 'k8s-calico', target: 'k8s-cni', relationType: 'implements' },
  { id: 'rel-k8s-cilium-cni', source: 'k8s-cilium', target: 'k8s-cni', relationType: 'implements' },
  { id: 'rel-k8s-cilium-calico', source: 'k8s-cilium', target: 'k8s-calico', relationType: 'alternative' },
  { id: 'rel-k8s-netpol-cni', source: 'k8s-networkpolicy', target: 'k8s-cni', relationType: 'depends_on', description: 'NetworkPolicy 需要支持策略的 CNI 才能真正生效。' },
  { id: 'rel-k8s-pvc-sc', source: 'k8s-pvc', target: 'k8s-storageclass', relationType: 'depends_on' },
  { id: 'rel-k8s-sc-csi', source: 'k8s-storageclass', target: 'k8s-csi', relationType: 'depends_on' },
  { id: 'rel-k8s-pv-csi', source: 'k8s-pv', target: 'k8s-csi', relationType: 'implements' },
  { id: 'rel-k8s-hpa-metrics', source: 'k8s-hpa', target: 'k8s-metrics-server', relationType: 'depends_on' },
  { id: 'rel-k8s-vpa-hpa', source: 'k8s-vpa', target: 'k8s-hpa', relationType: 'related', description: '两者同时调整 CPU/内存时可能互相冲突。' },
  { id: 'rel-k8s-rbac-role', source: 'k8s-rbac', target: 'k8s-role', relationType: 'contains' },
  { id: 'rel-k8s-rbac-clusterrole', source: 'k8s-rbac', target: 'k8s-clusterrole', relationType: 'contains' },
  { id: 'rel-k8s-sa-rbac', source: 'k8s-serviceaccount', target: 'k8s-rbac', relationType: 'related' },
  { id: 'rel-k8s-operator-crd', source: 'k8s-operator', target: 'k8s-crd', relationType: 'depends_on' },
  { id: 'rel-k8s-operator-loop', source: 'k8s-operator', target: 'k8s-controller-pattern', relationType: 'implements' },
  { id: 'rel-k8s-argocd-gitops', source: 'k8s-argocd', target: 'k8s-gitops', relationType: 'implements' },
  { id: 'rel-k8s-flux-gitops', source: 'k8s-flux', target: 'k8s-gitops', relationType: 'implements' },
  { id: 'rel-k8s-argocd-flux', source: 'k8s-argocd', target: 'k8s-flux', relationType: 'alternative' },
  { id: 'rel-k8s-helm-kustomize', source: 'k8s-helm', target: 'k8s-kustomize', relationType: 'alternative' },
  { id: 'rel-k8s-monitoring-prom', source: 'k8s-monitoring', target: 'prom-core', relationType: 'related', description: 'Kubernetes 指标监控通常由 Prometheus 生态承担。' },
];

const kubernetesViews: SeedView[] = [
  {
    id: 'k8s-view-architecture',
    name: '控制平面与工作节点',
    description: '从 API Server 到 kubelet、运行时和网络的整体请求路径。',
    viewType: 'architecture',
    graphData: {
      nodes: [
        gn('kn-kubectl', 'k8s-kubectl', 'kubectl / 控制器', 40, 80),
        gn('kn-api', 'k8s-apiserver', 'kube-apiserver', 290, 80),
        gn('kn-etcd', 'k8s-etcd', 'etcd', 540, 40),
        gn('kn-sched', 'k8s-scheduler', 'kube-scheduler', 540, 130),
        gn('kn-cm', 'k8s-controller-manager', 'controller-manager', 540, 220),
        gn('kn-kubelet', 'k8s-kubelet', 'kubelet', 290, 330),
        gn('kn-cri', 'k8s-cri', 'CRI', 540, 330),
        gn('kn-containerd', 'k8s-containerd', 'containerd / runc', 790, 330),
        gn('kn-pod', 'k8s-pod', 'Pod', 1040, 330),
        gn('kn-svc', 'k8s-service', 'Service', 1040, 440),
      ],
      edges: [
        ge('ke-1', 'kn-kubectl', 'kn-api', 'REST / watch'),
        ge('ke-2', 'kn-api', 'kn-etcd', '持久化', 'depends_on'),
        ge('ke-3', 'kn-sched', 'kn-api', 'watch / bind', 'depends_on'),
        ge('ke-4', 'kn-cm', 'kn-api', 'watch / update', 'depends_on'),
        ge('ke-5', 'kn-api', 'kn-kubelet', 'PodSpec'),
        ge('ke-6', 'kn-kubelet', 'kn-cri', 'gRPC', 'depends_on'),
        ge('ke-7', 'kn-cri', 'kn-containerd', '创建沙箱与容器', 'implements'),
        ge('ke-8', 'kn-containerd', 'kn-pod', '运行'),
        ge('ke-9', 'kn-svc', 'kn-pod', 'EndpointSlice 选择', 'depends_on'),
      ],
    },
  },
];

/* ------------------------------ Prometheus ------------------------------ */

const prometheusNodes: SeedNode[] = [
  n('prom-core', null, '核心架构', 'concept', 'Prometheus Server 的抓取、时序存储、查询与告警评估能力。', {
    description:
      'Prometheus 是一个拉取式监控系统：按配置发现目标、周期抓取指标、写入本地时序数据库，并通过 PromQL 查询与规则评估产生告警。',
    technicalRole: '云原生指标监控的事实标准。',
    corePrinciple: 'Pull + 多维标签 + 本地 TSDB + PromQL；告警由规则评估产生并推送给 Alertmanager。',
    docsUrl: 'https://prometheus.io/docs/introduction/overview/',
  }),
  n(
    'prom-server',
    'prom-core',
    'Prometheus Server',
    'component',
    '负责服务发现、抓取、写入 TSDB、执行 PromQL 与规则评估的核心进程。',
    {
      description:
        '单个 Prometheus Server 即可完成抓取、存储、查询与告警规则评估。生产环境通常以多副本运行，并在查询层做去重。',
      technicalRole: '监控系统的采集与查询核心。',
      corePrinciple: '每个 scrape job 按 interval 抓取目标，样本追加到 TSDB；规则按 evaluation_interval 评估。',
      solvedProblem: '用统一的数据模型和查询语言观测动态基础设施。',
      keyMechanism: 'scrape manager、rule manager、TSDB、HTTP API、remote write。',
      useCases: '采集 Kubernetes 与主机指标、定义 SLO 告警、为 Grafana 提供数据源。',
      commonIssues: '单机存储容量有限；抓取目标过多导致 CPU/内存上涨；副本之间数据不完全一致。',
      docsUrl: 'https://prometheus.io/docs/introduction/overview/',
      softwareSlug: 'prometheus',
    },
  ),
  n('prom-data-model', 'prom-core', '指标模型', 'concept', '每个样本由指标名、标签集、时间戳和值组成；标签组合唯一确定一条时间序列。', {
    docsUrl: 'https://prometheus.io/docs/concepts/data_model/',
  }),
  n(
    'prom-tsdb',
    'prom-core',
    'TSDB',
    'component',
    'Prometheus 内置的本地时序数据库，使用 WAL、2 小时块与后台压缩，按时间或大小保留数据。',
    {
      description:
        'TSDB 把样本按时间序列追加写入 WAL，并周期性落盘为 block。查询通过倒排索引定位序列，再读取压缩块。',
      technicalRole: '指标查询与规则评估的数据基础。',
      corePrinciple: 'WAL 保证崩溃恢复；block 压缩降低存储；retention 控制本地保留窗口。',
      commonIssues: '本地盘容量不足；高基数标签导致索引膨胀；大量乱序样本增加写入压力。',
      docsUrl: 'https://prometheus.io/docs/prometheus/latest/storage/',
    },
  ),
  n('prom-promql', 'prom-core', 'PromQL', 'concept', 'Prometheus 的函数式查询语言，支持瞬时向量、区间向量、聚合与时间函数。', {
    description:
      'PromQL 以标签选择器定位序列，配合 rate、increase、histogram_quantile 等函数计算。rate 只适用于 counter，且区间内至少需要两个样本。',
    technicalRole: '把原始指标转化为可读的速率、分位数与聚合结果。',
    keyMechanism: '向量匹配、by/without 聚合、offset、@ modifier、子查询。',
    useCases: '计算 QPS、错误率、P99 延迟、容量趋势与告警表达式。',
    commonIssues: '对 gauge 误用 rate；区间过短导致结果抖动或为空；高基数聚合消耗内存。',
    docsUrl: 'https://prometheus.io/docs/prometheus/latest/querying/basics/',
  }),
  n('prom-scrape-model', 'prom-core', '抓取模型', 'concept', 'Prometheus 主动按间隔请求目标的 /metrics，每个目标每次抓取产生一个样本集合。', {
    description: '抓取是 Pull 模型：目标只需暴露 HTTP 指标端点。抓取失败会产生 up=0，而不是让已有序列自动消失。',
    docsUrl: 'https://prometheus.io/docs/concepts/jobs_instances/',
  }),
  n('prom-service-discovery', 'prom-core', '服务发现', 'concept', '动态获得抓取目标列表，避免在配置中硬编码实例地址。', {
    docsUrl: 'https://prometheus.io/docs/prometheus/latest/configuration/configuration/#scrape_config',
  }),
  n('prom-exporter', 'prom-core', 'Exporter', 'concept', '把不易直接观测的系统指标转换为 Prometheus 文本或 OpenMetrics 格式。', {
    docsUrl: 'https://prometheus.io/docs/instrumenting/exporters/',
  }),
  n('prom-remote-write', 'prom-core', 'Remote Write', 'concept', '把本地样本持续推送到远端存储，用于长期保留、全局查询与容灾。', {
    description:
      'Remote Write 是单向的样本推送协议，支持队列、分片、重试与鉴权；它不是把远端数据拉回本地的手段（那是 Remote Read）。',
    docsUrl: 'https://prometheus.io/docs/specs/remote_write_spec/',
  }),

  n('prom-scraping', null, '采集配置', 'concept', 'scrape_configs、服务发现与 relabel 共同决定抓什么、怎么抓、保留哪些标签。', {
    docsUrl: 'https://prometheus.io/docs/prometheus/latest/configuration/configuration/#scrape_config',
  }),
  n('prom-scrape-config', 'prom-scraping', 'scrape_configs', 'concept', 'Prometheus 配置中的抓取任务列表，每个 job 有自己的目标、间隔与抓取路径。', {
    docsUrl: 'https://prometheus.io/docs/prometheus/latest/configuration/configuration/#scrape_config',
  }),
  n('prom-job-instance', 'prom-scraping', 'Job 与 Instance', 'concept', 'job 表示一组同类目标，instance 默认是目标地址，二者由抓取自动附加。', {
    docsUrl: 'https://prometheus.io/docs/concepts/jobs_instances/',
  }),
  n('prom-relabel', 'prom-scraping', 'relabel_configs', 'concept', '在抓取前对目标标签和 __meta_* 元数据做改写、保留或丢弃。', {
    description:
      'relabel_configs 作用于目标发现阶段，常用于从 Kubernetes 元数据生成 job、namespace、pod 标签，或用 keep/drop 过滤目标。',
    docsUrl: 'https://prometheus.io/docs/prometheus/latest/configuration/configuration/#relabel_config',
  }),
  n('prom-metric-relabel', 'prom-scraping', 'metric_relabel_configs', 'concept', '在抓取后、入库前对样本标签做过滤和改写，常用于丢弃高基数指标。', {
    docsUrl: 'https://prometheus.io/docs/prometheus/latest/configuration/configuration/#metric_relabel_configs',
  }),
  n('prom-honor-labels', 'prom-scraping', 'honor_labels', 'concept', '决定目标自带 job/instance 标签时，是否保留目标值并重命名抓取端标签。', {
    docsUrl: 'https://prometheus.io/docs/prometheus/latest/configuration/configuration/#scrape_config',
  }),
  n('prom-kubernetes-sd', 'prom-scraping', 'Kubernetes 服务发现', 'concept', '通过 Kubernetes API 发现 node、pod、service、endpoints、endpointslice、ingress 等角色。', {
    description:
      'kubernetes_sd_configs 使用角色（role）发现目标，并暴露大量 __meta_kubernetes_* 标签，通常需要配合 RBAC 授权 Prometheus 读取对应资源。',
    docsUrl: 'https://prometheus.io/docs/prometheus/latest/configuration/configuration/#kubernetes_sd_config',
  }),
  n('prom-file-sd', 'prom-scraping', 'file_sd', 'concept', '从本地 JSON/YAML 文件读取目标，文件变化后自动重新加载。', {
    docsUrl: 'https://prometheus.io/docs/guides/file-sd/',
  }),
  n('prom-static-config', 'prom-scraping', 'static_configs', 'concept', '在配置中直接写死目标地址，适合小规模或固定端点。', {
    docsUrl: 'https://prometheus.io/docs/prometheus/latest/configuration/configuration/#static_config',
  }),
  n('prom-dns-sd', 'prom-scraping', 'DNS 服务发现', 'concept', '通过 A 或 SRV 记录发现目标，适合没有服务注册中心的传统环境。', {
    docsUrl: 'https://prometheus.io/docs/prometheus/latest/configuration/configuration/#dns_sd_config',
  }),

  n('prom-operator', null, 'Prometheus Operator', 'concept', '用自定义资源与控制器管理 Prometheus、Alertmanager 及其配置生成。', {
    description:
      'Prometheus Operator 把 Prometheus 配置抽象为 ServiceMonitor、PodMonitor、Probe、ScrapeConfig、PrometheusRule 等 CR，由控制器生成实际配置与工作负载。',
    technicalRole: 'Kubernetes 上管理 Prometheus 生态的标准方式。',
    corePrinciple: '控制器监听 CR 与选择器，渲染 prometheus.yaml 到 Secret，config-reloader 检测变化并触发热重载。',
    docsUrl: 'https://prometheus-operator.dev/docs/operator/design/',
  }),
  n('prom-crd', 'prom-operator', 'Operator CRD', 'concept', 'Prometheus Operator 安装的自定义资源类型集合。', {
    docsUrl: 'https://prometheus-operator.dev/docs/operator/api/',
  }),
  n(
    'prom-cr',
    'prom-operator',
    'Prometheus CR',
    'resource',
    '声明 Prometheus 实例的副本、存储、资源与各类选择器，Operator 据此生成配置和 StatefulSet。',
    {
      description:
        'Prometheus CR 的核心是选择器：serviceMonitorSelector、podMonitorSelector、probeSelector、scrapeConfigSelector、ruleSelector 与各自的 namespaceSelector 决定纳入哪些监控资源。',
      technicalRole: '声明式定义一套 Prometheus 实例。',
      corePrinciple: 'Operator 把被选中的 CR 渲染成 prometheus.yaml，并生成带 config-reloader 的 StatefulSet。',
      commonIssues: '选择器为空导致监控对象未被纳入；namespaceSelector 未覆盖目标命名空间；直接修改生成的 Secret 会被覆盖。',
      docsUrl: 'https://prometheus-operator.dev/docs/operator/api/#monitoring.coreos.com/v1.Prometheus',
    },
  ),
  n(
    'prom-service-monitor',
    'prom-operator',
    'ServiceMonitor',
    'resource',
    '按标签选择 Service，并把其 Endpoints 转换为抓取目标。',
    {
      description:
        'ServiceMonitor 通过 selector 选择 Service，通过 endpoints 声明端口、path、interval 等；Operator 再把 Service 背后的 Endpoint 转成实际 target。',
      technicalRole: 'Kubernetes Service 级指标采集的标准声明方式。',
      corePrinciple: 'Service 标签选择 + endpoints 端口映射 + namespaceSelector；不直接选择 Pod。',
      useCases: '采集以 Service 暴露的中间件、Operator 或业务应用指标。',
      commonIssues: 'Service 无 Endpoints；endpoint 端口名与 Service 端口不一致；Prometheus CR 的 serviceMonitorSelector 未选中它。',
      docsUrl: 'https://prometheus-operator.dev/docs/operator/api/#monitoring.coreos.com/v1.ServiceMonitor',
    },
  ),
  n(
    'prom-pod-monitor',
    'prom-operator',
    'PodMonitor',
    'resource',
    '按标签直接选择 Pod，并抓取 Pod 暴露的指标端口。',
    {
      description:
        'PodMonitor 不依赖 Service，直接按 Pod 标签选择目标，适合没有 Service 或需要逐 Pod 抓取的场景（如 DaemonSet）。',
      technicalRole: 'Pod 级指标采集的声明方式。',
      corePrinciple: 'Pod selector + podMetricsEndpoints；Operator 根据 Pod 的容器端口生成 target。',
      commonIssues: 'Pod 没有命名端口导致无法解析；选择器过宽采集到大量无关 Pod；与 ServiceMonitor 重复采集。',
      docsUrl: 'https://prometheus-operator.dev/docs/operator/api/#monitoring.coreos.com/v1.PodMonitor',
    },
  ),
  n(
    'prom-scrape-config-cr',
    'prom-operator',
    'ScrapeConfig',
    'resource',
    '为 Operator 补充原生 scrape_configs 能力，支持静态、文件、云厂商等 Prometheus 服务发现。',
    {
      description:
        'ScrapeConfig CR 允许在 Operator 管理下使用 ServiceMonitor/PodMonitor 未覆盖的服务发现类型，由 Prometheus CR 的 scrapeConfigSelector 选择。',
      technicalRole: 'Operator 生态的通用抓取扩展。',
      commonIssues: '误以为所有 CRD 都会被自动采集；实际仍需 scrapeConfigSelector 选中。',
      docsUrl: 'https://prometheus-operator.dev/docs/operator/api/#monitoring.coreos.com/v1alpha1.ScrapeConfig',
    },
  ),
  n(
    'prom-probe',
    'prom-operator',
    'Probe',
    'resource',
    '通过 Blackbox Exporter 等 prober 对 Ingress、Service 或静态目标做黑盒探测。',
    {
      description:
        'Probe 不抓取应用自身指标，而是让 prober 从外部发起 HTTP/TCP/ICMP/DNS 探测，并返回 probe_success、probe_duration_seconds 等指标。',
      technicalRole: '从外部视角验证可用性与延迟。',
      corePrinciple: 'Probe CR 指定 prober 与 target；Operator 生成抓取配置，由 Prometheus 抓取 prober 的 /probe 端点。',
      useCases: '站点可用性、TLS 证书到期、DNS 解析、跨区域访问延迟。',
      commonIssues: 'prober 网络策略阻断目标；module 配置错误；把 Probe 当成应用指标采集。',
      docsUrl: 'https://prometheus-operator.dev/docs/operator/api/#monitoring.coreos.com/v1.Probe',
    },
  ),
  n(
    'prom-rule-cr',
    'prom-operator',
    'PrometheusRule',
    'resource',
    '声明 recording/alerting 规则组，由 Prometheus CR 的 ruleSelector 选择后加载。',
    {
      description:
        'PrometheusRule 中的 spec.groups 与原生规则文件结构一致。Operator 只加载被 ruleSelector 选中、且位于 ruleNamespaceSelector 允许命名空间内的规则。',
      technicalRole: '以 Kubernetes 资源管理告警与预计算规则。',
      commonIssues: 'ruleSelector 为空或未匹配；命名空间未被 ruleNamespaceSelector 覆盖；规则表达式错误只在 reload 日志中体现。',
      docsUrl: 'https://prometheus-operator.dev/docs/operator/api/#monitoring.coreos.com/v1.PrometheusRule',
    },
  ),
  n('prom-alertmanager-cr', 'prom-operator', 'Alertmanager CR', 'resource', '声明 Alertmanager 副本、存储与配置，Operator 生成配置 Secret 和工作负载。', {
    docsUrl: 'https://prometheus-operator.dev/docs/operator/api/#monitoring.coreos.com/v1.Alertmanager',
  }),
  n('prom-thanosruler-cr', 'prom-operator', 'ThanosRuler CR', 'resource', '运行可连接 Thanos 全局查询的规则评估器，用于跨集群告警。', {
    docsUrl: 'https://prometheus-operator.dev/docs/operator/api/#monitoring.coreos.com/v1.ThanosRuler',
  }),
  n('prom-kube-prometheus-stack', 'prom-operator', 'kube-prometheus-stack', 'component', '社区 Helm Chart，打包 Operator、Prometheus、Alertmanager、Grafana、导出器与默认规则。', {
    docsUrl: 'https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack',
  }),
  n('prom-generated-config', 'prom-operator', '生成的配置', 'concept', 'Operator 渲染出的 prometheus.yaml 与规则文件，通过 Secret 挂载并由 config-reloader 触发热重载。', {
    description:
      '生成的配置是只读产物。应修改 Prometheus CR、ServiceMonitor、PodMonitor 或 PrometheusRule，而不是直接编辑生成的 Secret。',
    docsUrl: 'https://prometheus-operator.dev/docs/operator/design/#resource-reconciliation',
  }),

  n('prom-exporters', null, '指标导出器', 'concept', '把主机、Kubernetes 对象、黑盒探测与业务指标统一暴露为 Prometheus 格式。', {
    docsUrl: 'https://prometheus.io/docs/instrumenting/exporters/',
  }),
  n('prom-node-exporter', 'prom-exporters', 'node-exporter', 'component', '暴露 CPU、内存、磁盘、文件系统与网络等主机指标，通常以 DaemonSet 部署。', {
    docsUrl: 'https://github.com/prometheus/node_exporter',
  }),
  n('prom-kube-state-metrics', 'prom-exporters', 'kube-state-metrics', 'component', '从 Kubernetes API 读取对象状态，暴露 Deployment、Pod、PVC 等资源的状态指标。', {
    description: 'kube-state-metrics 提供的是对象状态（如副本数、重启次数），不是 CPU/内存使用量；后者来自 kubelet/cAdvisor。',
    docsUrl: 'https://github.com/kubernetes/kube-state-metrics',
  }),
  n('prom-blackbox-exporter', 'prom-exporters', 'Blackbox Exporter', 'component', '通过 HTTP、HTTPS、TCP、ICMP、DNS 模块从外部探测目标可用性。', {
    docsUrl: 'https://github.com/prometheus/blackbox_exporter',
  }),
  n('prom-pushgateway', 'prom-exporters', 'Pushgateway', 'component', '接收短生命周期任务的推送指标并持续暴露，适合无法被拉取的批处理任务。', {
    description: 'Pushgateway 不会自动过期指标，任务消失后指标仍可能保留；应结合 push_time_seconds 判断新鲜度。',
    docsUrl: 'https://github.com/prometheus/pushgateway',
  }),
  n('prom-app-metrics', 'prom-exporters', '应用指标', 'concept', '业务应用通过客户端库暴露 /metrics，包含请求、延迟、错误与业务计数器。', {
    docsUrl: 'https://prometheus.io/docs/instrumenting/clientlibs/',
  }),
  n('prom-otel-collector', 'prom-exporters', 'OpenTelemetry Collector', 'component', '统一接收、处理并导出指标、日志与追踪，可暴露 Prometheus 或 Remote Write 端点。', {
    docsUrl: 'https://opentelemetry.io/docs/collector/',
  }),

  n('prom-alerting', null, '告警', 'concept', '由规则评估产生告警，再由 Alertmanager 分组、抑制、静默并路由到通知渠道。', {
    docsUrl: 'https://prometheus.io/docs/alerting/latest/overview/',
  }),
  n('prom-alerting-rules', 'prom-alerting', '告警规则', 'concept', '带 for 持续时间的 PromQL 表达式，条件满足后从 pending 变为 firing。', {
    docsUrl: 'https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/',
  }),
  n('prom-recording-rules', 'prom-alerting', 'Recording Rules', 'concept', '周期性预计算昂贵或高频查询，结果保存为新的时间序列。', {
    docsUrl: 'https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/',
  }),
  n('prom-rule-evaluation', 'prom-alerting', '规则评估', 'concept', 'Prometheus 按 evaluation_interval 和规则组 interval 执行表达式并更新告警状态。', {
    docsUrl: 'https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/',
  }),
  n('prom-alert-state', 'prom-alerting', '告警生命周期', 'concept', 'inactive → pending（满足条件但未达到 for）→ firing（达到持续时间后发送）。', {
    docsUrl: 'https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/',
  }),
  n(
    'prom-alertmanager',
    'prom-alerting',
    'Alertmanager',
    'component',
    '接收 Prometheus 推送的告警，负责去重、分组、抑制、静默、路由与通知。',
    {
      description:
        'Alertmanager 不评估规则。它接收 firing 告警，按 group_by 合并，应用 inhibition 与 silence，再按路由树发送到 receiver。',
      technicalRole: '告警通知的统一收敛与分发层。',
      corePrinciple: '去重键由标签集决定；分组、等待与重复间隔共同控制通知频率。',
      useCases: '将同一服务的多条告警合并，按严重级别路由到不同渠道。',
      commonIssues: 'group_wait 过长导致通知延迟；repeat_interval 过短导致打扰；抑制规则误伤。',
      docsUrl: 'https://prometheus.io/docs/alerting/latest/alertmanager/',
    },
  ),
  n('prom-am-config', 'prom-alerting', 'Alertmanager 配置', 'concept', 'route 树、receivers、inhibit_rules 与模板组成的通知策略。', {
    docsUrl: 'https://prometheus.io/docs/alerting/latest/configuration/',
  }),
  n('prom-alert-grouping', 'prom-alerting', '告警分组', 'concept', '按 group_by 标签把相关告警合并为一次通知，减少噪声。', {
    docsUrl: 'https://prometheus.io/docs/alerting/latest/alertmanager/#grouping',
  }),
  n('prom-alert-inhibition', 'prom-alerting', '告警抑制', 'concept', '当高优先级告警存在时，按 equal 标签抑制低优先级告警。', {
    docsUrl: 'https://prometheus.io/docs/alerting/latest/alertmanager/#inhibition',
  }),
  n('prom-silence', 'prom-alerting', '静默', 'concept', '在指定时间窗口内按 matcher 屏蔽告警，常用于计划维护。', {
    docsUrl: 'https://prometheus.io/docs/alerting/latest/alertmanager/#silences',
  }),
  n('prom-alert-routing', 'prom-alerting', '告警路由', 'concept', '按 matcher 把告警分发到不同 receiver，支持 continue 继续匹配后续分支。', {
    docsUrl: 'https://prometheus.io/docs/alerting/latest/alertmanager/#routing',
  }),
  n('prom-receiver', 'prom-alerting', '接收器', 'concept', 'Email、Webhook、Slack、PagerDuty 等通知目标及其消息模板。', {
    docsUrl: 'https://prometheus.io/docs/alerting/latest/configuration/#receiver',
  }),

  n('prom-visualization', null, '可视化', 'concept', '查询、仪表盘与告警状态的可视化入口。', {}),
  n('prom-grafana', 'prom-visualization', 'Grafana', 'component', '多数据源仪表盘平台，通过 Prometheus 数据源执行 PromQL 并展示图表与告警。', {
    docsUrl: 'https://grafana.com/docs/',
    softwareSlug: 'grafana',
  }),
  n('prom-expression-browser', 'prom-visualization', '表达式浏览器', 'component', 'Prometheus 自带的 /graph 页面与 HTTP API，用于即时调试 PromQL。', {
    docsUrl: 'https://prometheus.io/docs/prometheus/latest/querying/api/',
  }),
  n('prom-dashboard', 'prom-visualization', '仪表盘', 'concept', '围绕 RED/USE 等方法组织的可视化页面，通常由 Grafana 管理。', {}),

  n('prom-scale', null, '长期存储与扩展', 'concept', '解决单机 Prometheus 存储有限、跨集群查询与高可用问题。', {}),
  n('prom-thanos', 'prom-scale', 'Thanos', 'component', '通过 sidecar、query、store、compact 等组件提供全局查询、对象存储长期保留与降采样。', {
    docsUrl: 'https://thanos.io/tip/thanos/design.md/',
  }),
  n('prom-victoriametrics', 'prom-scale', 'VictoriaMetrics', 'component', '兼容 Prometheus 查询与写入协议的高性能时序数据库。', {
    docsUrl: 'https://docs.victoriametrics.com/',
  }),
  n('prom-mimir', 'prom-scale', 'Grafana Mimir', 'component', '水平扩展的多租户时序数据库，使用对象存储并兼容 PromQL。', {
    docsUrl: 'https://grafana.com/docs/mimir/latest/',
  }),
  n('prom-remote-read', 'prom-scale', 'Remote Read', 'concept', '让 Prometheus 从远端存储读取历史序列，查询延迟通常高于本地 TSDB。', {
    docsUrl: 'https://prometheus.io/docs/prometheus/latest/querying/api/#remote-read',
  }),
  n('prom-federation', 'prom-scale', '联邦', 'concept', '上级 Prometheus 从下级 /federate 端点拉取选定序列，适合分层聚合而非长期存储。', {
    docsUrl: 'https://prometheus.io/docs/prometheus/latest/federation/',
  }),

  n('prom-deploy', null, '部署与运维', 'concept', '部署方式、高可用、安全与备份。', {}),
  n('prom-binary-deploy', 'prom-deploy', '二进制部署', 'component', '直接运行 Prometheus 二进制并以 systemd 管理，配置与数据目录由运维自行维护。', {
    docsUrl: 'https://prometheus.io/docs/prometheus/latest/getting_started/',
  }),
  n('prom-helm', 'prom-deploy', 'Helm 部署', 'component', '通过 prometheus-community Chart 或 kube-prometheus-stack 部署。', {
    docsUrl: 'https://github.com/prometheus-community/helm-charts',
    softwareSlug: 'helm',
  }),
  n('prom-ha', 'prom-deploy', '高可用', 'practice', '多副本抓取相同目标，查询层去重；Alertmanager 以集群模式运行并通过 gossip 协调通知。', {
    docsUrl: 'https://prometheus.io/docs/alerting/latest/alertmanager/#high-availability',
  }),
  n('prom-security', 'prom-deploy', '安全配置', 'practice', '为抓取与查询启用 TLS、认证与授权，避免指标端点裸奔。', {
    docsUrl: 'https://prometheus.io/docs/operating/security/',
  }),
  n('prom-backup', 'prom-deploy', '备份与恢复', 'practice', '通过 TSDB snapshot API 备份，或依赖 Remote Write/对象存储实现长期保留。', {
    docsUrl: 'https://prometheus.io/docs/prometheus/latest/querying/api/#snapshot',
  }),
];

const prometheusRelations: SeedRelation[] = [
  { id: 'rel-prom-core-server', source: 'prom-core', target: 'prom-server', relationType: 'contains' },
  { id: 'rel-prom-core-model', source: 'prom-core', target: 'prom-data-model', relationType: 'contains' },
  { id: 'rel-prom-server-tsdb', source: 'prom-server', target: 'prom-tsdb', relationType: 'contains' },
  { id: 'rel-prom-server-sd', source: 'prom-server', target: 'prom-service-discovery', relationType: 'depends_on' },
  { id: 'rel-prom-server-promql', source: 'prom-server', target: 'prom-promql', relationType: 'contains' },
  { id: 'rel-prom-model-tsdb', source: 'prom-data-model', target: 'prom-tsdb', relationType: 'related' },
  { id: 'rel-prom-promql-tsdb', source: 'prom-promql', target: 'prom-tsdb', relationType: 'depends_on' },
  { id: 'rel-prom-scrape-config', source: 'prom-scraping', target: 'prom-scrape-config', relationType: 'contains' },
  { id: 'rel-prom-scrape-job', source: 'prom-scrape-config', target: 'prom-job-instance', relationType: 'contains' },
  { id: 'rel-prom-scrape-relabel', source: 'prom-scrape-config', target: 'prom-relabel', relationType: 'depends_on' },
  { id: 'rel-prom-relabel-metric', source: 'prom-relabel', target: 'prom-metric-relabel', relationType: 'related', description: '前者在抓取前处理目标标签，后者在抓取后处理样本标签。' },
  { id: 'rel-prom-scrape-kubernetes', source: 'prom-scrape-config', target: 'prom-kubernetes-sd', relationType: 'related' },
  { id: 'rel-prom-kubernetes-file', source: 'prom-kubernetes-sd', target: 'prom-file-sd', relationType: 'alternative' },
  { id: 'rel-prom-operator-crd', source: 'prom-operator', target: 'prom-crd', relationType: 'depends_on' },
  { id: 'rel-prom-operator-cr', source: 'prom-operator', target: 'prom-cr', relationType: 'contains' },
  { id: 'rel-prom-operator-amcr', source: 'prom-operator', target: 'prom-alertmanager-cr', relationType: 'contains' },
  { id: 'rel-prom-cr-sm', source: 'prom-cr', target: 'prom-service-monitor', relationType: 'related', description: 'serviceMonitorSelector 决定纳入哪些 ServiceMonitor。' },
  { id: 'rel-prom-cr-pm', source: 'prom-cr', target: 'prom-pod-monitor', relationType: 'related', description: 'podMonitorSelector 决定纳入哪些 PodMonitor。' },
  { id: 'rel-prom-cr-sc', source: 'prom-cr', target: 'prom-scrape-config-cr', relationType: 'related', description: 'scrapeConfigSelector 决定纳入哪些 ScrapeConfig。' },
  { id: 'rel-prom-cr-probe', source: 'prom-cr', target: 'prom-probe', relationType: 'related', description: 'probeSelector 决定纳入哪些 Probe。' },
  { id: 'rel-prom-cr-rule', source: 'prom-cr', target: 'prom-rule-cr', relationType: 'related', description: 'ruleSelector 与 ruleNamespaceSelector 决定加载哪些规则。' },
  { id: 'rel-prom-cr-alerting', source: 'prom-cr', target: 'prom-alertmanager', relationType: 'related', description: 'spec.alerting 指向 Alertmanager 端点。' },
  { id: 'rel-prom-sm-svc', source: 'prom-service-monitor', target: 'k8s-service', relationType: 'related', description: 'ServiceMonitor 按标签选择 Kubernetes Service，并抓取其 Endpoints。' },
  { id: 'rel-prom-pm-pod', source: 'prom-pod-monitor', target: 'k8s-pod', relationType: 'related', description: 'PodMonitor 直接按标签选择 Pod。' },
  { id: 'rel-prom-probe-blackbox', source: 'prom-probe', target: 'prom-blackbox-exporter', relationType: 'depends_on' },
  { id: 'rel-prom-sc-cr-raw', source: 'prom-scrape-config-cr', target: 'prom-scrape-config', relationType: 'extends' },
  { id: 'rel-prom-generated-config', source: 'prom-generated-config', target: 'prom-operator', relationType: 'depends_on' },
  { id: 'rel-prom-kps-operator', source: 'prom-kube-prometheus-stack', target: 'prom-operator', relationType: 'contains' },
  { id: 'rel-prom-node-k8s', source: 'prom-node-exporter', target: 'k8s-worker-node', relationType: 'related' },
  { id: 'rel-prom-ksm-api', source: 'prom-kube-state-metrics', target: 'k8s-apiserver', relationType: 'depends_on' },
  { id: 'rel-prom-rule-alerting', source: 'prom-alerting-rules', target: 'prom-rule-cr', relationType: 'related' },
  { id: 'rel-prom-recording-promql', source: 'prom-recording-rules', target: 'prom-promql', relationType: 'depends_on' },
  { id: 'rel-prom-eval-rules', source: 'prom-rule-evaluation', target: 'prom-alerting-rules', relationType: 'related' },
  { id: 'rel-prom-am-grouping', source: 'prom-alertmanager', target: 'prom-alert-grouping', relationType: 'contains' },
  { id: 'rel-prom-am-inhibit', source: 'prom-alertmanager', target: 'prom-alert-inhibition', relationType: 'contains' },
  { id: 'rel-prom-am-silence', source: 'prom-alertmanager', target: 'prom-silence', relationType: 'contains' },
  { id: 'rel-prom-am-routing', source: 'prom-alertmanager', target: 'prom-alert-routing', relationType: 'contains' },
  { id: 'rel-prom-am-receiver', source: 'prom-alertmanager', target: 'prom-receiver', relationType: 'contains' },
  { id: 'rel-prom-state-rules', source: 'prom-alert-state', target: 'prom-alerting-rules', relationType: 'related' },
  { id: 'rel-prom-grafana-promql', source: 'prom-grafana', target: 'prom-promql', relationType: 'related' },
  { id: 'rel-prom-thanos-rw', source: 'prom-thanos', target: 'prom-remote-write', relationType: 'depends_on' },
  { id: 'rel-prom-vm-tsdb', source: 'prom-victoriametrics', target: 'prom-tsdb', relationType: 'alternative' },
  { id: 'rel-prom-mimir-thanos', source: 'prom-mimir', target: 'prom-thanos', relationType: 'alternative' },
  { id: 'rel-prom-remote-read', source: 'prom-remote-read', target: 'prom-remote-write', relationType: 'related' },
  { id: 'rel-prom-helm-binary', source: 'prom-helm', target: 'prom-binary-deploy', relationType: 'alternative' },
  { id: 'rel-prom-ha-server', source: 'prom-ha', target: 'prom-server', relationType: 'related' },
];

const prometheusViews: SeedView[] = [
  {
    id: 'prom-view-overall',
    name: '整体监控架构',
    description: '目标发现、抓取、存储、查询、规则评估与告警通知的端到端结构。',
    viewType: 'architecture',
    graphData: {
      nodes: [
        gn('pv1-exp', 'prom-node-exporter', 'node-exporter', 40, 60),
        gn('pv1-ksm', 'prom-kube-state-metrics', 'kube-state-metrics', 40, 150),
        gn('pv1-app', 'prom-app-metrics', '业务应用 /metrics', 40, 240),
        gn('pv1-bbx', 'prom-blackbox-exporter', 'Blackbox Exporter', 40, 330),
        gn('pv1-sd', 'prom-kubernetes-sd', '服务发现', 290, 180, { width: 176, height: 62 }),
        gn('pv1-server', 'prom-server', 'Prometheus Server', 540, 170, { width: 184, height: 70 }),
        gn('pv1-tsdb', 'prom-tsdb', 'TSDB', 790, 60),
        gn('pv1-eval', 'prom-rule-evaluation', '规则评估', 790, 180),
        gn('pv1-grafana', 'prom-grafana', 'Grafana', 1030, 60),
        gn('pv1-am', 'prom-alertmanager', 'Alertmanager', 790, 310),
        gn('pv1-recv', 'prom-receiver', '通知渠道', 1030, 310),
        gn('pv1-note', null, 'Prometheus 主动拉取目标；抓取失败会表现为 up=0，而不是删除已有序列。', 540, 330, {
          width: 240,
          height: 78,
          note: '采集与查询是两条独立路径：TSDB 服务查询，规则评估在本地执行。',
        }),
      ],
      edges: [
        ge('pe1-1', 'pv1-exp', 'pv1-sd', '标签与元数据'),
        ge('pe1-2', 'pv1-ksm', 'pv1-sd', '标签与元数据'),
        ge('pe1-3', 'pv1-app', 'pv1-sd', '标签与元数据'),
        ge('pe1-4', 'pv1-bbx', 'pv1-sd', 'Probe 目标'),
        ge('pe1-5', 'pv1-sd', 'pv1-server', 'target 列表', 'depends_on'),
        ge('pe1-6', 'pv1-server', 'pv1-tsdb', '写入样本'),
        ge('pe1-7', 'pv1-tsdb', 'pv1-grafana', 'PromQL 查询'),
        ge('pe1-8', 'pv1-tsdb', 'pv1-eval', '读取序列'),
        ge('pe1-9', 'pv1-eval', 'pv1-am', 'firing 告警'),
        ge('pe1-10', 'pv1-am', 'pv1-recv', '分组后通知'),
      ],
    },
  },
  {
    id: 'prom-view-operator',
    name: 'Operator 资源关系',
    description: 'Prometheus CR 的选择器如何纳管 ServiceMonitor、PodMonitor、ScrapeConfig、Probe 与规则。',
    viewType: 'relation',
    graphData: {
      nodes: [
        gn('pv2-sm', 'prom-service-monitor', 'ServiceMonitor', 40, 40),
        gn('pv2-svc', 'k8s-service', 'Service / Endpoints', 40, 125),
        gn('pv2-pm', 'prom-pod-monitor', 'PodMonitor', 40, 220),
        gn('pv2-pod', 'k8s-pod', 'Pod', 40, 305),
        gn('pv2-sc', 'prom-scrape-config-cr', 'ScrapeConfig', 40, 400),
        gn('pv2-probe', 'prom-probe', 'Probe', 40, 495),
        gn('pv2-bbx', 'prom-blackbox-exporter', 'Blackbox Exporter', 280, 495),
        gn('pv2-operator', 'prom-operator', 'Prometheus Operator', 320, 40, { width: 186, height: 62 }),
        gn('pv2-cr', 'prom-cr', 'Prometheus CR', 320, 220, { width: 186, height: 70 }),
        gn('pv2-rule', 'prom-rule-cr', 'PrometheusRule', 600, 40),
        gn('pv2-secret', 'prom-generated-config', '生成的配置 Secret', 600, 145, { width: 196 }),
        gn('pv2-pod-core', 'prom-server', 'Prometheus Pod', 900, 145, { width: 178, height: 66 }),
        gn('pv2-amcr', 'prom-alertmanager-cr', 'Alertmanager CR', 600, 330),
        gn('pv2-am', 'prom-alertmanager', 'Alertmanager Pod', 900, 330, { width: 178 }),
        gn('pv2-note', null, '选择器为空时默认不选中任何资源；规则选择器与命名空间选择器是独立的两道条件。', 320, 420, {
          width: 250,
          height: 84,
          note: '生成的 Secret 是只读产物，直接修改会在下一次调和时被覆盖。',
        }),
      ],
      edges: [
        ge('pe2-1', 'pv2-sm', 'pv2-cr', 'serviceMonitorSelector', 'related'),
        ge('pe2-2', 'pv2-pm', 'pv2-cr', 'podMonitorSelector', 'related'),
        ge('pe2-3', 'pv2-sc', 'pv2-cr', 'scrapeConfigSelector', 'related'),
        ge('pe2-4', 'pv2-probe', 'pv2-cr', 'probeSelector', 'related'),
        ge('pe2-5', 'pv2-rule', 'pv2-cr', 'ruleSelector', 'related'),
        ge('pe2-6', 'pv2-amcr', 'pv2-cr', 'alerting.alertmanagers', 'related'),
        ge('pe2-7', 'pv2-operator', 'pv2-cr', '监听与调和', 'related'),
        ge('pe2-8', 'pv2-operator', 'pv2-amcr', '监听与调和', 'related'),
        ge('pe2-9', 'pv2-cr', 'pv2-secret', '渲染 prometheus.yaml'),
        ge('pe2-10', 'pv2-secret', 'pv2-pod-core', 'config-reloader 重载'),
        ge('pe2-11', 'pv2-sm', 'pv2-svc', '按标签选择', 'related'),
        ge('pe2-12', 'pv2-pm', 'pv2-pod', '按标签选择', 'related'),
        ge('pe2-13', 'pv2-probe', 'pv2-bbx', '调用 prober', 'depends_on'),
        ge('pe2-14', 'pv2-amcr', 'pv2-am', '生成工作负载'),
      ],
    },
  },
  {
    id: 'prom-view-scrape-flow',
    name: '指标采集流程',
    description: '从目标暴露指标到样本入库与规则评估的抓取链路。',
    viewType: 'workflow',
    graphData: {
      nodes: [
        gn('pv3-target', 'prom-app-metrics', '目标暴露 /metrics', 40, 80),
        gn('pv3-sd', 'prom-kubernetes-sd', '服务发现', 320, 80),
        gn('pv3-relabel', 'prom-relabel', 'relabel_configs', 600, 80),
        gn('pv3-scrape', 'prom-scrape-model', 'Scrape', 880, 80),
        gn('pv3-tsdb', 'prom-tsdb', '追加到 TSDB', 1160, 80),
        gn('pv3-promql', 'prom-promql', 'PromQL 查询', 1160, 270),
        gn('pv3-eval', 'prom-rule-evaluation', '规则评估', 880, 270),
        gn('pv3-am', 'prom-alertmanager', 'Alertmanager', 600, 270),
        gn('pv3-remote', 'prom-remote-write', 'Remote Write', 320, 270),
        gn('pv3-note1', null, 'scrape_interval 控制周期，scrape_timeout 必须小于间隔；超时或连接失败记为 up=0。', 40, 230, {
          width: 240,
          height: 82,
        }),
        gn('pv3-note2', null, '指标只在被成功抓取时写入；目标消失后旧序列不会立即删除，查询时需结合 up 与时间窗口判断。', 40, 350, {
          width: 240,
          height: 92,
        }),
      ],
      edges: [
        ge('pe3-1', 'pv3-target', 'pv3-sd', '发现目标'),
        ge('pe3-2', 'pv3-sd', 'pv3-relabel', '生成 target'),
        ge('pe3-3', 'pv3-relabel', 'pv3-scrape', '过滤与改写标签', 'depends_on'),
        ge('pe3-4', 'pv3-scrape', 'pv3-tsdb', '样本写入'),
        ge('pe3-5', 'pv3-tsdb', 'pv3-promql', '按时间范围查询'),
        ge('pe3-6', 'pv3-promql', 'pv3-eval', '规则表达式'),
        ge('pe3-7', 'pv3-eval', 'pv3-am', 'firing 告警'),
        ge('pe3-8', 'pv3-tsdb', 'pv3-remote', '持续推送', 'related'),
      ],
    },
  },
  {
    id: 'prom-view-alert-flow',
    name: '告警处理流程',
    description: 'PrometheusRule 如何经过规则评估、Alertmanager 与路由最终到达通知渠道。',
    viewType: 'workflow',
    graphData: {
      nodes: [
        gn('pv4-rule', 'prom-rule-cr', 'PrometheusRule', 40, 70),
        gn('pv4-gen', 'prom-generated-config', '生成规则文件', 280, 70),
        gn('pv4-eval', 'prom-rule-evaluation', '规则评估', 520, 70),
        gn('pv4-pending', 'prom-alert-state', 'pending', 760, 70, { width: 132 }),
        gn('pv4-firing', 'prom-alert-state', 'firing', 980, 70, { width: 132 }),
        gn('pv4-am', 'prom-alertmanager', 'Alertmanager', 980, 250),
        gn('pv4-group', 'prom-alert-grouping', '分组 group_by', 760, 250, { width: 160 }),
        gn('pv4-inhibit', 'prom-alert-inhibition', '抑制', 540, 250, { width: 140 }),
        gn('pv4-silence', 'prom-silence', '静默', 340, 250, { width: 140 }),
        gn('pv4-route', 'prom-alert-routing', '路由', 140, 250, { width: 140 }),
        gn('pv4-recv', 'prom-receiver', '接收器', 40, 370, { width: 150 }),
        gn('pv4-note', null, 'for 满足后 pending 才转为 firing；Alertmanager 只处理 firing 告警，不执行规则。', 500, 390, {
          width: 260,
          height: 78,
          note: '接收器可以是 Email、Webhook、Slack 或 PagerDuty，取决于 Alertmanager 配置。',
        }),
      ],
      edges: [
        ge('pe4-1', 'pv4-rule', 'pv4-gen', 'Operator 渲染'),
        ge('pe4-2', 'pv4-gen', 'pv4-eval', 'config-reloader 重载'),
        ge('pe4-3', 'pv4-eval', 'pv4-pending', '条件满足但未达 for'),
        ge('pe4-4', 'pv4-pending', 'pv4-firing', '持续时间满足'),
        ge('pe4-5', 'pv4-firing', 'pv4-am', '推送告警'),
        ge('pe4-6', 'pv4-am', 'pv4-group', 'group_by'),
        ge('pe4-7', 'pv4-group', 'pv4-inhibit', '抑制匹配'),
        ge('pe4-8', 'pv4-inhibit', 'pv4-silence', '静默匹配'),
        ge('pe4-9', 'pv4-silence', 'pv4-route', 'matchers'),
        ge('pe4-10', 'pv4-route', 'pv4-recv', '匹配 receiver'),
      ],
    },
  },
];

export const TECH_TEMPLATES: TechTemplate[] = [
  {
    key: 'kubernetes',
    name: 'Kubernetes 技术体系',
    description: '从控制平面、工作负载、网络存储到安全与交付的 Kubernetes 全景，含核心架构视图。',
    domains: [
      {
        id: 'tech-domain-kubernetes',
        name: 'Kubernetes',
        description: '容器编排平台的核心组件、对象模型、网络存储、调度弹性、安全与交付体系。',
        icon: 'Boxes',
        nodes: kubernetesNodes,
        relations: kubernetesRelations,
        views: kubernetesViews,
      },
    ],
  },
  {
    key: 'prometheus',
    name: 'Prometheus 监控体系',
    description: 'Prometheus 的抓取、存储、PromQL、Operator 资源模型与告警链路，含四张架构与流程图。',
    domains: [
      {
        id: 'tech-domain-prometheus',
        name: 'Prometheus',
        description: '以 Pull 模型、多维标签和 PromQL 为核心的云原生监控与告警体系。',
        icon: 'Activity',
        nodes: prometheusNodes,
        relations: prometheusRelations,
        views: prometheusViews,
      },
    ],
  },
];

function softwareIdBySlug(slug: string): string | null {
  const row = db
    .prepare(
      `SELECT id FROM software
       WHERE deleted_at IS NULL AND (slug = ? OR catalog_key = ?)
       ORDER BY CASE WHEN slug = ? THEN 0 ELSE 1 END
       LIMIT 1`,
    )
    .get(slug, slug, slug) as { id: string } | undefined;
  return row?.id ?? null;
}

export interface ApplyTemplateResult {
  key: string;
  inserted: {
    domains: number;
    nodes: number;
    relations: number;
    views: number;
    links: number;
  };
}

export function applyTechTemplate(key: string): ApplyTemplateResult | null {
  const template = TECH_TEMPLATES.find((entry) => entry.key === key);
  if (!template) return null;

  const timestamp = nowIso();
  const inserted = { domains: 0, nodes: 0, relations: 0, views: 0, links: 0 };
  const insertedNodeIds = new Set<string>();

  const run = db.transaction(() => {
    for (const domain of template.domains) {
      inserted.domains += db
        .prepare(
          `INSERT INTO tech_domains (id, name, description, icon, cover, status, focus_level, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, 'active', 'normal', 0, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
        )
        .run(domain.id, domain.name, domain.description, domain.icon, timestamp, timestamp).changes;

      for (const [index, node] of domain.nodes.entries()) {
        const nodeChanges = db
          .prepare(
            `INSERT INTO tech_nodes
              (id, domain_id, parent_id, name, node_type, summary, description, technical_role, core_principle,
               solved_problem, key_mechanism, use_cases, common_issues, docs_url, repo_url, reference_links,
               personal_notes, research_questions, mastery_status, focus_level, status, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'unknown', 'normal', 'active', ?, ?, ?)
             ON CONFLICT(id) DO NOTHING`,
          )
          .run(
            node.id,
            domain.id,
            node.parentId,
            node.name,
            node.nodeType,
            node.summary,
            node.description ?? null,
            node.technicalRole ?? null,
            node.corePrinciple ?? null,
            node.solvedProblem ?? null,
            node.keyMechanism ?? null,
            node.useCases ?? null,
            node.commonIssues ?? null,
            node.docsUrl ?? null,
            node.repoUrl ?? null,
            JSON.stringify(node.referenceLinks ?? []),
            index + 1,
            timestamp,
            timestamp,
          ).changes;
        inserted.nodes += nodeChanges;
        if (nodeChanges > 0) insertedNodeIds.add(node.id);

        if (node.softwareSlug) {
          const softwareId = softwareIdBySlug(node.softwareSlug);
          if (softwareId) {
            inserted.links += db
              .prepare(
                `INSERT INTO tech_node_software (node_id, software_id, created_at)
                 VALUES (?, ?, ?) ON CONFLICT(node_id, software_id) DO NOTHING`,
              )
              .run(node.id, softwareId, timestamp).changes;
          }
        }
      }

      for (const [index, view] of domain.views.entries()) {
        inserted.views += db
          .prepare(
            `INSERT INTO tech_views (id, domain_id, name, description, view_type, graph_data, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO NOTHING`,
          )
          .run(
            view.id,
            domain.id,
            view.name,
            view.description,
            view.viewType,
            JSON.stringify(view.graphData),
            index + 1,
            timestamp,
            timestamp,
          ).changes;
      }
    }

    db.prepare(
      `INSERT INTO tech_seed (key, applied_at) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET applied_at = excluded.applied_at`,
    ).run(template.key, timestamp);
  });

  run();
  // Relations are seeded after nodes so cross-domain links are not dropped when
  // the target domain is applied later.
  inserted.relations += seedTemplateRelations(template);
  // Freshly inserted nodes cannot have user content yet, so their authored
  // knowledge is applied even when the same template key was seeded before.
  if (insertedNodeIds.size) {
    seedTechContent({ nodeIds: insertedNodeIds, force: true });
  }
  return { key: template.key, inserted };
}

export function seedTemplateRelations(template: TechTemplate): number {
  const timestamp = nowIso();
  let inserted = 0;
  const insert = db.prepare(
    `INSERT INTO tech_relations (id, source_node_id, target_node_id, relation_type, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  for (const domain of template.domains) {
    for (const relation of domain.relations) {
      const exists = db
        .prepare('SELECT 1 FROM tech_nodes WHERE id = ? AND id IN (SELECT id FROM tech_nodes)')
        .get(relation.target);
      if (!exists) continue;
      inserted += insert.run(
        relation.id,
        relation.source,
        relation.target,
        relation.relationType,
        relation.description ?? null,
        timestamp,
        timestamp,
      ).changes;
    }
  }
  return inserted;
}

export function seedTechnologyTemplates(): void {
  for (const template of TECH_TEMPLATES) {
    const applied = db.prepare('SELECT 1 FROM tech_seed WHERE key = ?').get(template.key);
    if (applied) continue;
    try {
      const result = applyTechTemplate(template.key);
      if (result) {
        console.log(
          `[tech] seeded ${template.key}: ${result.inserted.nodes} nodes, ${result.inserted.views} views`,
        );
      }
    } catch (error) {
      console.error(`[tech] failed to seed ${template.key}`, error);
    }
  }
  // A template applied in an earlier release may still miss a cross-domain
  // relation whose target was seeded later. Re-checking is idempotent.
  for (const template of TECH_TEMPLATES) seedTemplateRelations(template);
  // Backfill knowledge content for databases created before P5.2. This only
  // fills empty columns and is tracked per node in tech_content_seed.
  try {
    const content = seedTechContent();
    if (content.applied > 0) {
      console.log(`[tech] applied knowledge content to ${content.applied} nodes`);
    }
  } catch (error) {
    console.error('[tech] failed to seed knowledge content', error);
  }
}
