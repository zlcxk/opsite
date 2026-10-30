import type { TechContentEntry } from './tech-content.js';

const d = (
  nodeId: string,
  contentMarkdown: string,
  options: { versions?: string; docsUrl?: string; repoUrl?: string; source?: 'official' | 'mixed' | 'curated' } = {},
): TechContentEntry => ({
  nodeId,
  version: 1,
  contentMarkdown,
  contentStatus: 'draft',
  contentSource: options.source ?? 'mixed',
  applicableVersions: options.versions ?? 'Kubernetes 1.28+（除单独标注外）',
  docsUrl: options.docsUrl,
  repoUrl: options.repoUrl,
});

/**
 * Level-2 Markdown documents for the first content batch. Everything is stored
 * as a draft: only the user can confirm a document as "已完善".
 */
export const KUBERNETES_DOCS: TechContentEntry[] = [
  d(
    'k8s-core',
    `## 概念定义

Kubernetes 是一个声明式容器编排平台。用户通过 API 提交“期望状态”，控制平面持续把实际状态收敛到期望状态，工作节点负责运行容器。

## 设计目的

它解决的是大规模容器在异构机器上的部署、调度、服务发现、滚动更新和故障自愈问题。核心不是“运行容器”，而是“持续维持一个被描述的系统状态”。

## 核心原理

所有对象都保存在 etcd 中。kube-apiserver 是唯一读写入口，kube-scheduler 决定 Pod 落在哪个节点，kube-controller-manager 运行内置控制器，kubelet 在节点上落实 Pod。各组件通过 watch 机制感知变化，而不是互相直接调用。

~~~text
kubectl / controller / kubelet
            │
            ▼
      kube-apiserver  ──►  etcd
            │
   ┌────────┼─────────┐
   ▼        ▼         ▼
scheduler  controllers  kubelet
~~~

## 工作机制

一次 Deployment 更新大致经过：Deployment 控制器创建新 ReplicaSet → ReplicaSet 创建 Pod → scheduler 绑定节点 → kubelet 拉取镜像并启动容器 → EndpointSlice 更新 → kube-proxy 下发转发规则。每一步都是异步的，所以“提交成功”不等于“已经可用”。

## 典型场景

- 排查 Pending、CrashLoopBackOff、Service 无后端等跨组件问题。
- 设计控制面高可用、节点池和故障域。
- 向团队解释为什么 Kubernetes 需要控制器而不是脚本。

## 与其他概念的区别

Kubernetes 不是 PaaS，也不负责构建镜像或运行业务代码。它只负责把容器放到合适的位置并维持副本；发布策略、配置管理和可观测性需要额外组件配合。

## 参考资料

- [Kubernetes Architecture](https://kubernetes.io/docs/concepts/architecture/)
- [Kubernetes Components](https://kubernetes.io/docs/concepts/overview/components/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/architecture/' },
  ),
  d(
    'k8s-apiserver',
    `## 组件定位

kube-apiserver 是集群唯一的 REST API 入口和安全边界。kubectl、控制器、kubelet 以及外部系统都通过它读写对象，其他控制平面组件不会直接访问 etcd。

## 核心职责

- 暴露 Kubernetes API（内置资源、聚合 API 和 CRD）。
- 对请求执行认证、授权和准入控制。
- 把对象持久化到 etcd，并通过 watch 向观察者推送变更。
- 提供限流、审计和乐观并发控制。

## 工作原理

一个写请求通常经过：

1. **认证**：确认请求者身份（证书、Bearer Token、OIDC 等）。
2. **授权**：RBAC 或 webhook 判断是否允许该操作。
3. **变更准入**：Mutating Webhook 修改对象，补默认值或注入边车。
4. **校验准入**：Validating Webhook 或 CEL 策略拒绝不合规对象。
5. **持久化**：写入 etcd，返回 resourceVersion。
6. **通知**：watch 事件推送给控制器和 kubelet。

读请求可以走 watch cache，但一致性读仍会落到 etcd。

## 关键配置

- **--max-requests-inflight / --max-mutating-requests-inflight**：控制并发，防止过载。
- **--enable-admission-plugins**：启用内置准入插件。
- **--audit-policy-file**：定义审计级别和保留内容。
- **--etcd-servers**：etcd 端点。
- **--authorization-mode**：通常为 Node,RBAC。

## 典型使用场景

- 排查 401/403：先确认身份，再检查 RBAC 和准入。
- 排查 429：观察 apiserver 请求量、限流和客户端 list 行为。
- 排查写入变慢：同时看 apiserver 延迟、webhook 耗时和 etcd fsync。

## 常见故障与排查

| 现象 | 常见原因 | 排查方向 |
|---|---|---|
| 所有写入超时 | admission webhook 不可用 | 检查 webhook 的 failurePolicy、Service 和超时 |
| 大量 429 | 客户端高频 list/watch 或控制器失控 | 看 apiserver 指标和客户端 QPS |
| 控制面延迟升高 | etcd 磁盘慢、leader 抖动 | 看 etcd WAL fsync、leader change |
| 证书错误 | 证书过期或 SAN 不匹配 | 检查 apiserver 证书和 kubeconfig |

## 相关组件

etcd 决定持久化延迟；kube-scheduler 和 controller-manager 通过 watch 消费变更；kubelet 通过 apiserver 上报节点和 Pod 状态。任何 webhook 故障都会放大为整个集群的写入故障。

## 参考资料

- [kube-apiserver](https://kubernetes.io/docs/concepts/overview/components/#kube-apiserver)
- [Admission Control](https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/overview/components/#kube-apiserver' },
  ),
  d(
    'k8s-etcd',
    `## 组件定位

etcd 是 Kubernetes 的唯一数据源，保存所有对象、配置和状态。它使用 Raft 在多个成员之间复制数据，是集群备份和恢复的核心。

## 核心职责

- 提供强一致的键值存储。
- 通过 Raft 多数派提交写请求。
- 通过 watch 向 apiserver 推送变更。
- 通过快照、压缩和碎片整理控制数据规模。

## 核心原理

写请求必须到达 leader 并复制到多数派才能确认。因此 etcd 的磁盘 fsync 延迟会直接转化为 apiserver 写延迟。成员数为 3 时最多容忍 1 个成员故障；成员数为偶数不会增加容错能力。

## 关键机制

- **WAL**：预写日志，保证崩溃恢复。
- **Snapshot**：定期快照，避免无限回放 WAL。
- **Revision / MVCC**：每次写入产生新 revision，watch 从指定 revision 开始。
- **Compaction**：清理旧 revision，防止数据库无限增长。
- **Defrag**：回收碎片空间，需要在成员上逐个执行。

## 运维要点

- 使用低延迟本地 SSD，避免网络存储带来的 fsync 抖动。
- 控制面节点数通常为 3 或 5，跨故障域部署。
- 定期执行快照备份，并实际演练恢复。
- 监控 \`etcd_server_leader_changes_seen_total\`、\`etcd_disk_wal_fsync_duration_seconds\`、数据库大小和告警。

## 备份与恢复

~~~bash
ETCDCTL_API=3 etcdctl snapshot save /backup/etcd-$(date +%F).db \\
  --endpoints=https://127.0.0.1:2379 \\
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \\
  --cert=/etc/kubernetes/pki/etcd/server.crt \\
  --key=/etc/kubernetes/pki/etcd/server.key
~~~

恢复前必须停止 apiserver 和 etcd，恢复后检查成员健康和数据完整性。不要把“备份文件存在”当成“可以恢复”。

## 常见故障

| 现象 | 原因 | 处理 |
|---|---|---|
| leader 频繁切换 | 磁盘慢、网络抖动、CPU 饱和 | 查 fsync、网络和成员日志 |
| 数据库持续增长 | 未压缩或写入量过大 | 配置 compaction，检查事件和对象规模 |
| 恢复后数据不对 | 快照过旧或恢复步骤错误 | 校准 RPO，定期演练 |
| 成员无法加入 | peer 证书或初始集群配置错误 | 检查 peer URLs 和证书 SAN |

## 参考资料

- [etcd 官方文档](https://etcd.io/docs/)
- [Operating etcd for Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)`,
    { docsUrl: 'https://etcd.io/docs/' },
  ),
  d(
    'k8s-scheduler',
    `## 组件定位

kube-scheduler 为新创建且未绑定节点的 Pod 选择节点。它是资源放置策略的执行者，不负责实际启动容器。

## 核心职责

- 过滤不满足硬性条件的节点。
- 对可行节点打分并选择最优节点。
- 写入 Binding，通知 kubelet 接管 Pod。
- 在资源不足时支持优先级和抢占。

## 工作原理

调度分为两个阶段：

1. **Filter**：检查资源请求、节点选择器、亲和性、污点、PVC 拓扑等硬约束。
2. **Score**：按资源均衡、拓扑分布、镜像本地性等策略打分，选出最高分节点。

调度只看 Pod 的 request，不看节点的实时使用率。因此 request 设置不准确会直接导致放置错误。

## 关键机制

- **调度框架插件**：Filter、Score、Bind 等扩展点。
- **nodeAffinity / podAffinity / podAntiAffinity**：节点和 Pod 之间的约束。
- **Taints / Tolerations**：节点主动排斥 Pod。
- **TopologySpreadConstraints**：按可用区、节点等拓扑打散。
- **PriorityClass / Preemption**：高优先级 Pod 可以驱逐低优先级 Pod。

## 典型场景

- Pod 一直 Pending：看 Events 中的 \`FailedScheduling\` 原因。
- 多可用区高可用：用 topologySpread 或反亲和打散。
- 专用节点池：给节点打污点，只让特定工作负载容忍。

## 常见故障与排查

~~~bash
kubectl describe pod <pod> -n <ns> | sed -n '/Events/,$p'
kubectl get nodes -o custom-columns=NAME:.metadata.name,CPU:.status.allocatable.cpu,MEM:.status.allocatable.memory
~~~

常见原因包括：request 超过节点可分配资源、污点未容忍、亲和性无解、PVC 绑定的可用区与节点不匹配、PDB 或配额限制。

## 相关组件

kubelet 负责节点上的实际运行；controller-manager 创建 Pod；Cluster Autoscaler 根据 Pending Pod 扩容节点；descheduler 可以在运行后重新平衡。

## 参考资料

- [kube-scheduler](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/)
- [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/' },
  ),
  d(
    'k8s-controller-manager',
    `## 组件定位

kube-controller-manager 把多个内置控制器编译进同一个进程，负责维持工作负载和集群对象的期望状态。

## 核心职责

- Deployment、ReplicaSet、StatefulSet、DaemonSet、Job 等控制器。
- Node 生命周期、EndpointSlice、Namespace、ServiceAccount 等控制器。
- 通过 leader election 保证同一时刻只有一个实例执行控制逻辑。

## 工作原理

每个控制器 watch 一类资源，把事件放入工作队列，在 reconcile 中比较期望与实际，然后发起最小必要变更。控制器必须幂等：重复执行同一调和不会产生额外副作用。

## 关键机制

- **Informer**：本地缓存和事件分发。
- **Work queue**：失败重试和限速。
- **Leader election**：多副本高可用。
- **OwnerReference**：资源级联删除和归属。
- **Conditions**：对象状态的可读表达。

## 典型场景

- Deployment 副本数不齐：看 Deployment/ReplicaSet 事件和控制器日志。
- Node 长期 NotReady：检查 node lifecycle controller 和 kubelet 心跳。
- Job 一直未完成：检查 Pod 失败原因和 backoffLimit。

## 常见故障与排查

控制器本身故障通常表现为“对象存在但状态不推进”。优先看 controller-manager 日志、leader 状态、RBAC 权限和 webhook 是否阻塞写入。若 apiserver 返回 429 或超时，控制器会退避重试，表现为整体调和不及时。

## 相关组件

apiserver 提供 watch 和写入；etcd 保存状态；kubelet 上报节点和 Pod 状态；scheduler 负责 Pod 绑定。

## 参考资料

- [kube-controller-manager](https://kubernetes.io/docs/concepts/overview/components/#kube-controller-manager)
- [Controllers](https://kubernetes.io/docs/concepts/architecture/controller/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/overview/components/#kube-controller-manager' },
  ),
  d(
    'k8s-kubelet',
    `## 组件定位

kubelet 是节点上的主要代理，负责让本节点实际运行的容器与 API 中的 PodSpec 保持一致。

## 核心职责

- watch 分配到本节点的 Pod。
- 通过 CRI 调用容器运行时创建、启动和删除容器。
- 通过 CSI 挂载存储，通过 CNI 配置网络。
- 执行存活、就绪和启动探针。
- 上报节点和 Pod 状态，资源不足时触发驱逐。

## 工作原理

kubelet 的 Pod sync loop 会对比期望 PodSpec 和实际容器状态，调用运行时完成变更。PLEG（Pod Lifecycle Event Generator）周期性检查容器状态，发现异常后触发同步。节点心跳通过 Lease 对象上报，超过阈值后 Node 变为 NotReady。

## 关键配置

- **--container-runtime-endpoint**：CRI socket 地址。
- **--kube-reserved / --system-reserved**：为系统和 kubelet 预留资源。
- **--eviction-hard**：节点压力驱逐阈值。
- **--node-status-update-frequency**：状态上报频率。
- **--image-gc-high-threshold / low-threshold**：镜像回收阈值。

## 常见故障与排查

| 现象 | 常见原因 | 排查 |
|---|---|---|
| ContainerCreating 卡住 | 镜像拉取、CNI、CSI 或 sandbox 失败 | \`kubectl describe pod\`、节点 kubelet 日志 |
| Node NotReady | kubelet 停止、运行时异常、证书过期 | \`systemctl status kubelet\`、节点日志 |
| Pod 被驱逐 | 磁盘、内存或 inode 压力 | 看节点 conditions 和 eviction 事件 |
| 探针反复失败 | 应用启动慢或探针配置错误 | 检查 probe 参数和应用日志 |

## 相关组件

容器运行时通过 CRI 对接；CNI 负责网络；CSI 负责存储；apiserver 接收状态；scheduler 决定 Pod 落点。

## 参考资料

- [kubelet](https://kubernetes.io/docs/concepts/overview/components/#kubelet)
- [Node Status](https://kubernetes.io/docs/reference/node/node-status/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/overview/components/#kubelet' },
  ),
  d(
    'k8s-pod',
    `## 资源定义

Pod 是 Kubernetes 最小的调度和运行单元，包含一个或多个共享网络命名空间和存储卷的容器。

## 解决的问题

Pod 把“必须一起调度、一起共享网络和存储”的容器组合成一个原子单位，同时为上层控制器提供可替换的副本。

## 核心字段

- **containers**：主容器列表，包含镜像、命令、端口、资源、探针。
- **initContainers**：主容器启动前顺序执行的初始化容器。
- **volumes**：Pod 级存储卷。
- **restartPolicy**：Always、OnFailure、Never。
- **serviceAccountName**：Pod 使用的身份。
- **nodeSelector / affinity / tolerations**：调度约束。
- **resources.requests/limits**：资源声明。

## 生命周期

Pod 创建后经历 Pending → Running → Succeeded/Failed。容器可能经历 Waiting、Running、Terminated。删除时先发送 SIGTERM，等待 terminationGracePeriodSeconds，再发送 SIGKILL。Pod 重建后 IP 会变化，因此不应把 Pod IP 当作稳定地址。

## 配置示例

~~~yaml
apiVersion: v1
kind: Pod
metadata:
  name: web
  labels:
    app: web
spec:
  containers:
    - name: web
      image: nginx:1.27
      ports:
        - containerPort: 80
      resources:
        requests:
          cpu: 100m
          memory: 128Mi
        limits:
          cpu: 500m
          memory: 256Mi
      readinessProbe:
        httpGet:
          path: /
          port: 80
        periodSeconds: 5
~~~

## 常见问题

- 直接管理裸 Pod 缺少自愈和滚动更新能力，生产环境应使用工作负载控制器。
- 探针配置不当会导致反复重启或流量过早进入。
- 未设置 request 会让调度和 QoS 失真，节点压力时更容易被驱逐。
- 容器以 PID 1 运行但不处理信号，会导致优雅终止失效。

## 相关资源

Deployment、StatefulSet、DaemonSet、Job 都通过 Pod template 创建 Pod；Service 通过标签选择 Pod；EndpointSlice 记录就绪 Pod 地址。

## 参考资料

- [Pods](https://kubernetes.io/docs/concepts/workloads/pods/)
- [Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/workloads/pods/' },
  ),
  d(
    'k8s-deployment',
    `## 资源定义

Deployment 是管理无状态应用的控制器，声明 Pod 模板、副本数和更新策略。

## 解决的问题

它让应用发布变成可回滚、可观察的滚动过程，而不是手工替换 Pod。

## 核心字段

- **replicas**：期望副本数。
- **selector**：选择由该 Deployment 管理的 Pod。
- **template**：Pod 模板。
- **strategy.rollingUpdate.maxSurge / maxUnavailable**：滚动更新节奏。
- **revisionHistoryLimit**：保留的历史 ReplicaSet 数量。
- **progressDeadlineSeconds**：发布超时判定。

## 生命周期

Deployment 创建 ReplicaSet，ReplicaSet 创建 Pod。更新镜像或模板时，Deployment 创建新 ReplicaSet，按策略扩新缩旧。回滚通过切换到历史 ReplicaSet 完成。

## 配置示例

~~~yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1.27
          readinessProbe:
            httpGet:
              path: /
              port: 80
~~~

## 常见问题

- 新 Pod 一直不就绪会导致滚动更新卡住；先看 readinessProbe 和事件。
- maxUnavailable 过大可能造成容量不足；关键服务建议配 PDB。
- selector 是不可变字段，创建后修改会失败。
- 只改镜像标签但标签指向同一镜像，不会触发预期发布。

## 相关资源

ReplicaSet 负责副本维持；Service/EndpointSlice 按标签选择 Pod；HPA 调整 Deployment 的副本数；PDB 限制自愿中断。

## 参考资料

- [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/' },
  ),
  d(
    'k8s-replicaset',
    `## 资源定义

ReplicaSet 确保指定数量的 Pod 副本持续运行，通常由 Deployment 创建和管理。

## 解决的问题

它提供副本维持和基于标签的 Pod 归属，是 Deployment 滚动更新的底层执行者。

## 核心字段

- **replicas**：期望副本数。
- **selector**：必须匹配 Pod 模板标签。
- **template**：Pod 模板。

## 生命周期

ReplicaSet 统计匹配 selector 的 Pod：不足则创建，多余则删除。Pod 删除后会被重新创建。Deployment 更新时保留旧 ReplicaSet 用于回滚，并按 revisionHistoryLimit 清理。

## 常见问题

- 直接修改 Deployment 管理的 ReplicaSet 会被下一次调和覆盖。
- selector 创建后不可变，标签设计错误只能重建。
- 如果手动创建的 Pod 带有相同标签，可能被 ReplicaSet 接管或删除。

## 相关资源

Deployment 管理 ReplicaSet；Pod 是实际副本；HPA 通过 Scale 子资源修改副本数。

## 参考资料

- [ReplicaSet](https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/' },
  ),
  d(
    'k8s-statefulset',
    `## 资源定义

StatefulSet 为有状态应用提供稳定的 Pod 身份、稳定的网络标识和稳定的存储绑定。

## 解决的问题

无状态控制器无法保证“同一个副本始终使用同一块存储和同一个 DNS 名称”。StatefulSet 通过固定序号解决这个问题。

## 核心字段

- **serviceName**：关联的 Headless Service。
- **replicas**：副本数。
- **selector / template**：与普通工作负载类似。
- **volumeClaimTemplates**：为每个副本创建独立 PVC。
- **podManagementPolicy**：OrderedReady 或 Parallel。
- **updateStrategy**：RollingUpdate 或 OnDelete，支持 partition。

## 生命周期

Pod 按序号创建和删除，默认 OrderedReady 会等待前一个 Ready。每个 Pod 的 DNS 名称为 \`<pod>.<service>.<namespace>.svc\`。缩容时不会自动删除 PVC，避免误删数据。更新默认从最大序号开始逐个进行。

## 配置示例

~~~yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: db
spec:
  serviceName: db-headless
  replicas: 3
  selector:
    matchLabels:
      app: db
  template:
    metadata:
      labels:
        app: db
    spec:
      containers:
        - name: db
          image: postgres:16
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 20Gi
~~~

## 常见问题

- Headless Service 未创建或 selector 不匹配，导致 DNS 不解析。
- PVC 未清理导致缩容/重建卡住。
- 有序更新可能长时间不可用，需结合 partition 和业务复制状态。
- 误以为 StatefulSet 会自动处理主从选举和数据复制，实际需要应用或 Operator 实现。

## 相关资源

Headless Service 提供稳定 DNS；PVC/PV/StorageClass 提供存储；Operator 通常封装 StatefulSet 的运维逻辑。

## 参考资料

- [StatefulSets](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/' },
  ),
  d(
    'k8s-daemonset',
    `## 资源定义

DaemonSet 确保每个符合条件的节点上运行一个 Pod，常用于节点级代理。

## 解决的问题

日志采集、监控、网络和存储插件需要覆盖所有节点，DaemonSet 让新增节点自动获得对应 Pod。

## 核心字段

- **selector / template**：选择和管理 Pod。
- **updateStrategy**：RollingUpdate 或 OnDelete，支持 maxUnavailable。
- **nodeSelector / affinity / tolerations**：控制覆盖哪些节点。

## 生命周期

DaemonSet 控制器监听节点和 Pod，节点加入时创建 Pod，节点删除时清理。默认会容忍部分节点污点，但是否调度到控制面节点取决于 tolerations 配置。

## 配置示例

~~~yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-agent
spec:
  selector:
    matchLabels:
      app: node-agent
  template:
    metadata:
      labels:
        app: node-agent
    spec:
      tolerations:
        - operator: Exists
      containers:
        - name: agent
          image: example/node-agent:1.0
~~~

## 常见问题

- 控制面节点有 NoSchedule 污点，未加容忍导致 Pod 不覆盖。
- 滚动更新 maxUnavailable 过大可能同时重启所有节点代理。
- 资源 request 过高会占用节点容量，影响业务 Pod。

## 相关资源

Node 对象决定覆盖范围；kubelet 运行 Pod；Prometheus 等监控系统通常通过 DaemonSet 部署 node-exporter。

## 参考资料

- [DaemonSet](https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/' },
  ),
  d(
    'k8s-service',
    `## 资源定义

Service 为一组 Pod 提供稳定的虚拟 IP、DNS 名称和负载均衡。

## 解决的问题

Pod 是临时对象，IP 会变化。Service 通过标签选择后端 Pod，让调用方使用稳定地址。

## 核心字段

- **selector**：选择后端 Pod。
- **ports.port / targetPort**：Service 端口和后端容器端口。
- **type**：ClusterIP、NodePort、LoadBalancer、ExternalName。
- **clusterIP: None**：Headless Service，直接返回 Pod 地址。
- **sessionAffinity**：会话保持。
- **externalTrafficPolicy**：保留源 IP 或减少一跳。

## 生命周期

Service 创建后获得 ClusterIP。EndpointSlice 控制器根据 selector 和 Pod 就绪状态维护后端地址。kube-proxy 监听变化并更新节点转发规则。Pod 重建后地址自动更新，调用方无感知。

## 配置示例

~~~yaml
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 8080
  type: ClusterIP
~~~

## 常见问题

- selector 与 Pod 标签不一致，EndpointSlice 为空。
- targetPort 写错，连接被拒绝。
- readinessProbe 失败时 Pod 不会进入 ready 端点，表现为“有 Pod 但没流量”。
- Headless Service 不提供负载均衡，客户端需要自己处理地址列表。

## 相关资源

Pod 是后端；EndpointSlice 保存地址；kube-proxy 实现转发；Ingress/Gateway 提供七层入口；CoreDNS 提供 Service 域名。

## 参考资料

- [Service](https://kubernetes.io/docs/concepts/services-networking/service/)
- [EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/services-networking/service/' },
  ),
  d(
    'k8s-endpointslice',
    `## 资源定义

EndpointSlice 保存 Service 后端的一组地址和端口，是 Service 转发规则的实际上游数据。

## 解决的问题

早期 Endpoints 对象在大规模集群中会变得巨大且频繁更新。EndpointSlice 把后端拆成多个切片，降低单对象压力和 watch 成本。

## 核心字段

- **addressType**：IPv4、IPv6、FQDN。
- **endpoints[].addresses**：后端地址。
- **endpoints[].conditions.ready / serving / terminating**：端点状态。
- **ports**：后端端口。

## 生命周期

EndpointSlice 控制器监听 Service 和 Pod，根据 selector 与就绪状态维护切片。kube-proxy 订阅 EndpointSlice 变化并更新转发规则。Pod 进入 terminating 时，端点状态会变化，配合优雅终止减少 502。

## 常见问题

- Pod 未 Ready 不会进入 ready 端点。
- terminating 端点处理不当会导致请求打到正在关闭的 Pod。
- 大规模集群需要关注 EndpointSlice 数量和更新频率。
- 手动修改 EndpointSlice 会被控制器覆盖。

## 相关资源

Service 定义选择规则；Pod 提供就绪状态；kube-proxy 消费 EndpointSlice；Ingress Controller 也可能直接 watch EndpointSlice。

## 参考资料

- [EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/' },
  ),
  d(
    'k8s-coredns',
    `## 组件定位

CoreDNS 是集群内 DNS 服务，为 Service 和 Pod 提供域名解析。

## 核心职责

- 解析 \`<service>.<namespace>.svc.cluster.local\`。
- 解析 Headless Service 的 Pod 地址。
- 转发集群外部域名到上游 DNS。
- 提供缓存，降低上游压力。

## 工作原理

CoreDNS 以 Deployment 运行，通常暴露为 kube-dns Service。kubernetes 插件 watch Service 和 EndpointSlice，动态生成 DNS 记录。Pod 的 /etc/resolv.conf 指向 CoreDNS 的 ClusterIP，并按 ndots 和 search 域进行解析。

## 关键配置

Corefile 示例：

~~~text
.:53 {
    errors
    health
    ready
    kubernetes cluster.local in-addr.arpa ip6.arpa {
        pods insecure
        fallthrough in-addr.arpa ip6.arpa
    }
    prometheus :9153
    forward . /etc/resolv.conf
    cache 30
    loop
    reload
    loadbalance
}
~~~

## 常见故障与排查

| 现象 | 原因 | 排查 |
|---|---|---|
| 全集群 DNS 失败 | CoreDNS Pod 不可用或 Service 无端点 | 检查 Deployment、Pod、EndpointSlice |
| 外部域名解析慢 | 上游 DNS 不通或 ndots 导致多次查询 | 检查 forward、网络策略和 resolv.conf |
| 间歇性解析失败 | conntrack、缓存或 CoreDNS 过载 | 看 CoreDNS 指标和副本资源 |

~~~bash
kubectl -n kube-system get pod -l k8s-app=kube-dns
kubectl -n kube-system logs deploy/coredns
kubectl run -it --rm dns-test --image=busybox:1.36 -- nslookup kubernetes.default
~~~

## 相关组件

Service/EndpointSlice 提供记录来源；kubelet 配置 Pod DNS；网络插件影响 CoreDNS 可达性；NodeLocal DNSCache 可降低延迟。

## 参考资料

- [DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/)
- [CoreDNS](https://coredns.io/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/' },
  ),
  d(
    'k8s-cni',
    `## 协议定位

CNI（Container Network Interface）定义容器运行时如何调用网络插件为 Pod 配置网络。

## 通信模型

kubelet 在创建 Pod sandbox 时调用 CNI 插件，传入网络配置和容器命名空间。插件负责创建网络接口、分配 IP、配置路由，并返回结果。删除 Pod 时调用 DEL 清理。

## 交互过程

1. 容器运行时创建 network namespace。
2. kubelet 读取 CNI 配置（通常由网络插件 DaemonSet 写入）。
3. 调用 ADD，插件通过 IPAM 分配地址并配置 veth/路由。
4. Pod 获得 IP，网络插件确保跨节点连通。
5. 删除时调用 DEL 回收地址和接口。

## 关键能力

- Pod IP 分配（IPAM）。
- 跨节点 Pod 通信（overlay 或路由）。
- NetworkPolicy 执行（取决于插件）。
- MTU、双栈、带宽限制等扩展。

## 常见问题

- CNI 插件未就绪，Pod 卡在 ContainerCreating 且没有 IP。
- IP 池耗尽，新 Pod 无法分配地址。
- 跨节点不通：路由、BGP、VXLAN 或防火墙问题。
- MTU 不一致导致大包丢失，表现为连接建立但大数据传输失败。
- NetworkPolicy 不被插件支持或实现不完整。

## 验证方式

~~~bash
kubectl get pod -o wide
kubectl exec <pod> -- ip addr
kubectl exec <pod> -- ping <other-pod-ip>
kubectl -n kube-system get pod -l k8s-app=calico-node
~~~

## 参考资料

- [Cluster Networking](https://kubernetes.io/docs/concepts/cluster-administration/networking/)
- [CNI Specification](https://github.com/containernetworking/cni/blob/main/SPEC.md)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/cluster-administration/networking/' },
  ),
  d(
    'k8s-pv',
    `## 资源定义

PersistentVolume（PV）是集群级别的持久存储资源，代表一块实际可用的存储。

## 解决的问题

它把存储的生命周期与 Pod 解耦，使 Pod 重建后仍能访问同一份数据。

## 核心字段

- **capacity.storage**：容量。
- **accessModes**：ReadWriteOnce、ReadOnlyMany、ReadWriteMany、ReadWriteOncePod。
- **persistentVolumeReclaimPolicy**：Retain、Delete、Recycle。
- **storageClassName**：所属存储类。
- **csi**：CSI 驱动和卷句柄。
- **nodeAffinity**：卷可被哪些节点访问。

## 生命周期

PV 可以静态创建，也可以由 StorageClass 动态供给。绑定到 PVC 后进入 Bound；PVC 删除后按回收策略进入 Released 或删除。Released 的 PV 仍保留数据，需要人工清理后才能重新绑定。

## 常见问题

- 容量或访问模式不匹配导致无法绑定。
- 回收策略为 Delete 时误删后端数据。
- 节点亲和性与 Pod 调度不匹配。
- Released PV 未清理，导致新 PVC 无法复用。

## 相关资源

PVC 表达需求；StorageClass 定义供给方式；CSI 驱动实现挂载；Pod 通过 PVC 使用存储。

## 参考资料

- [Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/storage/persistent-volumes/' },
  ),
  d(
    'k8s-pvc',
    `## 资源定义

PersistentVolumeClaim（PVC）是用户对存储的声明，表达容量、访问模式和存储类需求。

## 解决的问题

它让应用不需要了解后端存储细节，只需声明“我需要 20Gi 可读写存储”。

## 核心字段

- **accessModes**：访问模式。
- **resources.requests.storage**：请求容量。
- **storageClassName**：指定存储类；留空使用默认类。
- **volumeMode**：Filesystem 或 Block。
- **selector**：按标签选择已有 PV。

## 生命周期

PVC 创建后由绑定控制器寻找匹配 PV；动态供给时 StorageClass 创建 PV 并绑定。Pod 引用 PVC 后，kubelet 通过 CSI 挂载。删除 PVC 后，PV 按回收策略处理。

## 配置示例

~~~yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 20Gi
  storageClassName: fast-ssd
~~~

## 常见问题

- 没有匹配 PV 或默认 StorageClass，PVC 一直 Pending。
- 访问模式与后端能力不匹配。
- 扩容后文件系统未扩展，需要驱动和文件系统支持。
- 多副本同时挂载 RWO 卷会失败；需要 RWX 或每副本独立 PVC。

## 相关资源

PV 是实际存储；StorageClass 定义动态供给；CSI 实现挂载；StatefulSet 通过 volumeClaimTemplates 为每个副本创建 PVC。

## 参考资料

- [Persistent Volume Claims](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#persistentvolumeclaims)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/storage/persistent-volumes/' },
  ),
  d(
    'k8s-storageclass',
    `## 资源定义

StorageClass 定义动态存储供给的类型和参数，是 PVC 自动创建 PV 的模板。

## 解决的问题

它让存储供给从人工创建 PV 变成按需自动创建，并允许按性能、可用性和回收策略区分存储。

## 核心字段

- **provisioner**：CSI 驱动名称。
- **parameters**：驱动特定参数，如磁盘类型、加密。
- **reclaimPolicy**：Delete 或 Retain。
- **volumeBindingMode**：Immediate 或 WaitForFirstConsumer。
- **allowVolumeExpansion**：是否允许扩容。
- **mountOptions**：挂载参数。

## 生命周期

PVC 引用 StorageClass 后，外部 provisioner 调用 CSI 创建后端存储和 PV，再完成绑定。WaitForFirstConsumer 会等到 Pod 调度后再创建卷，适合有拓扑约束的存储。

## 配置示例

~~~yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
reclaimPolicy: Retain
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
~~~

## 常见问题

- 多个默认 StorageClass 导致行为不确定。
- volumeBindingMode 与节点拓扑不匹配，Pod 无法调度。
- 参数不被 CSI 驱动支持，PVC 创建失败。
- reclaimPolicy 为 Delete 时删除 PVC 会删除后端数据。

## 相关资源

PVC 引用 StorageClass；PV 由 provisioner 创建；CSI 驱动执行实际存储操作。

## 参考资料

- [Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/storage/storage-classes/' },
  ),
  d(
    'k8s-csi',
    `## 协议定位

CSI（Container Storage Interface）是 Kubernetes 与存储系统之间的标准接口，让第三方存储以插件方式接入。

## 通信模型

CSI 驱动实现三组 gRPC 服务：

- **Identity**：驱动信息和能力。
- **Controller**：创建、删除、挂载、快照等卷级操作。
- **Node**：节点上的挂载、卸载和状态查询。

kubelet 调用 Node 服务；external-provisioner、external-attacher 等 sidecar 调用 Controller 服务。

## 交互过程

1. PVC 创建后，external-provisioner 调用 CreateVolume。
2. 卷创建后生成 PV，并绑定 PVC。
3. Pod 调度到节点后，attacher 调用 ControllerPublish，kubelet 调用 NodeStage/NodePublish 挂载。
4. 删除时按相反顺序卸载和删除卷。

## 关键能力

- 动态供给。
- 卷快照和克隆。
- 拓扑感知调度。
- 扩容和健康检查。

## 常见问题

- 驱动未安装或版本不兼容。
- 挂载超时：节点插件、网络或后端存储异常。
- 拓扑与节点不匹配导致 Pod Pending。
- 权限不足，驱动无法调用云 API。
- 快照类不存在或与驱动不匹配。

## 相关资源

PV/PVC/StorageClass 是声明层；CSI 驱动是执行层；external-provisioner/attacher 是控制器 sidecar。

## 参考资料

- [CSI 规范](https://github.com/container-storage-interface/spec)
- [Kubernetes CSI](https://kubernetes.io/docs/concepts/storage/volumes/#csi)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/storage/volumes/#csi' },
  ),
  d(
    'k8s-resource-requests',
    `## 概念定义

requests 和 limits 是容器资源声明的两个维度：requests 是调度和 QoS 依据，limits 是运行时上限。

## 设计目的

让调度器知道每个 Pod 需要多少资源，让内核在资源争抢时有一致的约束，并为扩缩容和容量规划提供依据。

## 核心原理

- **CPU**：request 影响调度和 CPU 权重；超过 limit 会被节流（throttle），不会被杀死。
- **内存**：request 影响调度；超过 limit 会触发 OOM Kill。
- 未设置 request 时，调度器认为 Pod 不需要资源，容易造成节点超卖。

## 配置示例

~~~yaml
resources:
  requests:
    cpu: 250m
    memory: 256Mi
  limits:
    cpu: 1000m
    memory: 512Mi
~~~

## 典型场景

- 关键服务设置合理 request，避免节点超卖。
- 延迟敏感服务适当提高 CPU limit，减少节流。
- 内存密集型服务留足 limit，避免 OOM。
- 配合 LimitRange 设置命名空间默认值。

## 常见问题

- request 过高导致 Pending，过低导致节点过载。
- 只设 limits 不设 requests，QoS 和调度都不准确。
- CPU limit 过低导致持续节流，表现为延迟升高但 CPU 使用率不高。
- 内存 limit 过低导致周期性 OOM Kill，日志中可见 137 退出码。

## 相关知识

QoS 等级由 requests/limits 组合决定；HPA 基于 request 计算利用率；VPA 根据历史使用推荐资源。

## 参考资料

- [Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/' },
  ),
  d(
    'k8s-qos',
    `## 概念定义

QoS（Quality of Service）等级是 Kubernetes 根据容器的 requests/limits 组合自动给 Pod 分配的优先级类别。

## 设计目的

在节点资源紧张时，用一致的规则决定先驱逐谁，保护关键工作负载。

## 核心原理

- **Guaranteed**：每个容器都设置了 CPU 和内存的 requests 与 limits，且两者相等。
- **Burstable**：至少一个容器设置了 requests 或 limits，但不满足 Guaranteed。
- **BestEffort**：所有容器都没有设置 requests 和 limits。

节点压力驱逐时，BestEffort 最先被驱逐，Burstable 次之，Guaranteed 最后。OOM score 也与 QoS 相关。

## 典型场景

- 核心服务配置 Guaranteed，降低被驱逐概率。
- 批处理任务可以使用 Burstable 或 BestEffort，但要有可重试设计。
- 排查节点压力下为什么某些 Pod 先消失。

## 常见问题

- 只设置 limits 不设置 requests，无法成为 Guaranteed。
- 多个容器中只要有一个未设置，整个 Pod 就不是 Guaranteed。
- 把 QoS 当成绝对保护：资源严重不足时 Guaranteed Pod 仍可能被驱逐。

## 相关知识

resources.requests/limits 决定 QoS；节点压力驱逐和 kubelet eviction 阈值决定驱逐时机；PDB 只约束自愿中断，不约束资源驱逐。

## 参考资料

- [Pod Quality of Service Classes](https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/' },
  ),
  d(
    'k8s-taint-toleration',
    `## 概念定义

Taint 是节点上的排斥标记，Toleration 是 Pod 上允许被该污点节点调度的声明。

## 设计目的

让节点可以主动拒绝不匹配的工作负载，实现专用节点池、控制面隔离和维护驱逐。

## 核心原理

Taint 由 key、value、effect 组成。effect 有三种：

- **NoSchedule**：新 Pod 不能调度，已有 Pod 不受影响。
- **PreferNoSchedule**：尽量不调度，但不是硬约束。
- **NoExecute**：不能调度，并且会驱逐不容忍的现有 Pod。

Toleration 可以匹配全部或部分字段，operator 为 Equal 或 Exists。

## 配置示例

~~~yaml
# 节点
kubectl taint nodes gpu-1 dedicated=gpu:NoSchedule

# Pod
tolerations:
  - key: dedicated
    operator: Equal
    value: gpu
    effect: NoSchedule
~~~

## 典型场景

- 控制面节点只运行系统组件。
- GPU/专用硬件节点只运行特定工作负载。
- 节点维护时用 NoExecute 驱逐普通 Pod。

## 常见问题

- 忘记加 toleration 导致 Pod Pending。
- NoExecute 误驱逐关键 Pod；可用 tolerationSeconds 控制宽限。
- 污点与容忍只匹配了 key，value/effect 不一致导致不生效。
- 认为 toleration 会“吸引”Pod：它只是允许，不会主动调度到该节点。

## 相关知识

nodeAffinity 表达“我想去哪些节点”，taint/toleration 表达“节点允许谁来”。两者常配合使用。

## 参考资料

- [Taints and Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/' },
  ),
  d(
    'k8s-affinity',
    `## 概念定义

亲和与反亲和用于表达 Pod 与节点、或其他 Pod 之间的调度约束和偏好。

## 设计目的

让工作负载可以按可用区、机架、节点标签或彼此关系进行放置，提升可用性和性能。

## 核心原理

- **nodeAffinity**：根据节点标签约束。
- **podAffinity**：要求 Pod 与某些 Pod 在同一拓扑域。
- **podAntiAffinity**：要求 Pod 与某些 Pod 分开。
- required 规则是硬约束，preferred 规则是打分偏好。

## 配置示例

~~~yaml
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchLabels:
            app: web
        topologyKey: kubernetes.io/hostname
~~~

## 典型场景

- 同一应用副本打散到不同节点或可用区。
- 缓存与计算 Pod 尽量同节点，降低网络延迟。
- 专用硬件节点通过 nodeAffinity 选择。

## 常见问题

- required 规则过严导致无节点可调度。
- topologyKey 标签在节点上缺失，规则无法生效。
- 大集群中 podAntiAffinity 计算成本高，可能拖慢调度。
- 反亲和只保证调度时分散，运行后节点标签变化不会触发迁移。

## 相关知识

topologySpreadConstraints 提供更平滑的打散能力；taint/toleration 控制节点准入；scheduler 负责实际打分。

## 参考资料

- [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/' },
  ),
  d(
    'k8s-crd',
    `## 资源定义

CustomResourceDefinition（CRD）用于扩展 Kubernetes API，注册新的资源类型。

## 解决的问题

它让平台团队把领域对象（如 Prometheus、Application、Database）变成 Kubernetes 原生资源，复用 API、RBAC、watch 和声明式管理。

## 核心字段

- **group / names**：API 组、复数名、单数名、kind。
- **versions[].schema**：OpenAPI v3 schema。
- **scope**：Namespaced 或 Cluster。
- **subresources.status / scale**：状态和扩缩子资源。
- **conversion**：多版本转换。

## 生命周期

创建 CRD 后，apiserver 开始提供对应 API。用户可以创建自定义资源，控制器监听并调和其他资源。删除 CRD 会删除所有自定义资源，必须谨慎。

## 配置示例

~~~yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: databases.example.com
spec:
  group: example.com
  scope: Namespaced
  names:
    plural: databases
    singular: database
    kind: Database
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                size:
                  type: integer
~~~

## 常见问题

- schema 过于宽松，错误配置直到控制器才暴露。
- 升级 CRD 时删除旧版本，导致已有对象无法读取。
- 删除 CRD 会级联删除所有自定义资源。
- 控制器未处理 status 子资源，状态更新冲突。

## 相关资源

Operator/自定义控制器实现行为；RBAC 控制访问；Admission Webhook 可以做默认值和校验。

## 参考资料

- [Custom Resources](https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/' },
  ),
  d(
    'k8s-operator',
    `## 实践定义

Operator 是把领域运维知识编码成控制器的模式：用 CRD 描述期望状态，用控制器调和出底层资源。

## 适用场景

- 有状态中间件（数据库、消息队列、缓存）的部署、扩缩、备份和故障恢复。
- 需要复杂生命周期管理的平台组件。
- 希望用 Kubernetes 原生方式管理外部资源。

## 实施前提

- 清楚领域对象的期望状态和调和步骤。
- 控制器逻辑必须幂等、可重试、可观察。
- 需要完善的 RBAC、升级和回滚策略。
- 有状态应用的脑裂、备份和恢复必须由 Operator 正确处理。

## 核心机制

Operator 通常包含：

1. CRD 定义对象结构。
2. 控制器 watch CR 及其子资源。
3. reconcile 读取当前状态，创建/更新 Deployment、StatefulSet、Service、PVC 等。
4. 通过 status.conditions 暴露健康状态。
5. 使用 finalizer 处理删除清理。

## 配置示例

~~~yaml
apiVersion: example.com/v1
kind: Database
metadata:
  name: orders
spec:
  replicas: 3
  storage: 50Gi
  version: "16"
~~~

控制器根据该对象创建 StatefulSet、Headless Service、备份 CronJob，并持续报告 \`Ready\` 条件。

## 验证方式

- 创建 CR 后检查底层资源是否按预期生成。
- 删除 Pod/节点，观察 Operator 是否恢复。
- 修改副本数、版本，观察滚动过程和状态条件。
- 模拟备份和恢复，验证数据安全。

## 风险与回滚

Operator 升级可能改变 CRD schema 或调和行为。升级前阅读 release notes，备份 CR 和底层数据，先在非生产验证。回滚时要确认旧版本能读取新 schema。

## 常见问题

- 调和逻辑不幂等，重复执行产生重复资源。
- 状态条件不清晰，用户不知道系统是否健康。
- 权限过大或过小。
- 只处理正常路径，未处理部分失败和脑裂。

## 参考资料

- [Operator Pattern](https://kubernetes.io/docs/concepts/extend-kubernetes/operator/)
- [Operator SDK](https://sdk.operatorframework.io/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/extend-kubernetes/operator/' },
  ),
  d(
    'k8s-admission',
    `## 概念定义

Admission Webhook 在对象持久化前拦截请求，用于修改对象或校验策略。

## 设计目的

在不修改 apiserver 源码的情况下扩展集群策略，实现默认值注入、安全校验和平台约束。

## 核心原理

- **Mutating Webhook**：先执行，可以修改对象。
- **Validating Webhook**：后执行，只能允许或拒绝。
- Webhook 由 apiserver 通过 HTTPS 调用，匹配规则基于资源、操作、命名空间等。
- failurePolicy 决定 webhook 不可用时是拒绝还是放行。

## 配置示例

~~~yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: policy.example.com
webhooks:
  - name: policy.example.com
    admissionReviewVersions: ["v1"]
    sideEffects: None
    failurePolicy: Fail
    clientConfig:
      service:
        name: policy
        namespace: policy-system
        path: /validate
    rules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["pods"]
~~~

## 典型场景

- 注入 sidecar、标签、资源默认值。
- 限制镜像仓库、特权容器、HostPath。
- 校验命名规范和必填标签。

## 常见问题

- webhook 超时或不可用会阻塞所有匹配的写入；failurePolicy: Fail 时影响更大。
- 规则范围过宽，导致系统组件也被拦截。
- webhook 没有正确处理 UPDATE 和 DELETE。
- 证书过期或 Service 不可达。
- 多个 mutating webhook 顺序不确定，互相覆盖字段。

## 相关资源

RBAC 控制谁能创建 webhook；Service 提供后端；CRD/策略引擎可以实现更复杂的策略；apiserver 的 admission 链决定执行顺序。

## 参考资料

- [Admission Controllers](https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/)
- [Dynamic Admission Control](https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/)`,
    { docsUrl: 'https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/' },
  ),
  d(
    'k8s-rbac',
    `## 概念定义

RBAC（Role-Based Access Control）基于角色决定主体能对哪些资源执行哪些操作。

## 设计目的

用最小权限原则控制用户、ServiceAccount 和组对 API 的访问，降低误操作和凭证泄露的影响。

## 核心原理

- **Role/ClusterRole**：定义规则（apiGroups、resources、verbs）。
- **RoleBinding/ClusterRoleBinding**：把角色授予 User、Group 或 ServiceAccount。
- Role 是命名空间级，ClusterRole 是集群级。
- RoleBinding 可以引用 ClusterRole，把集群级规则限制在某个命名空间。

## 配置示例

~~~yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: app
  name: pod-reader
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  namespace: app
  name: pod-reader
subjects:
  - kind: ServiceAccount
    name: app
    namespace: app
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: pod-reader
~~~

## 验证方式

~~~bash
kubectl auth can-i get pods -n app --as=system:serviceaccount:app:app
kubectl auth can-i --list -n app --as=system:serviceaccount:app:app
~~~

## 常见问题

- 使用 cluster-admin 图省事，扩大攻击面。
- 通配符 \`*\` 权限过大。
- ServiceAccount token 泄露后权限未及时回收。
- 资源子资源（如 pods/log、pods/exec）未单独授权。
- RoleBinding 与 ClusterRoleBinding 作用域混淆。

## 相关知识

ServiceAccount 是 Pod 的身份；PSA 控制 Pod 安全配置；Admission Webhook 可以做额外授权校验。

## 参考资料

- [RBAC Authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)`,
    { docsUrl: 'https://kubernetes.io/docs/reference/access-authn-authz/rbac/' },
  ),
  d(
    'k8s-hpa',
    `## 资源定义

HorizontalPodAutoscaler（HPA）根据指标自动调整工作负载的副本数。

## 解决的问题

让应用容量随负载变化，避免固定副本数造成资源浪费或容量不足。

## 核心字段

- **scaleTargetRef**：目标 Deployment/StatefulSet 等。
- **minReplicas / maxReplicas**：副本范围。
- **metrics**：CPU、内存、自定义指标或外部指标。
- **behavior**：扩缩容速率和稳定窗口。

## 生命周期

HPA 控制器周期性读取指标，计算期望副本数并更新 Scale 子资源。扩容通常较快，缩容默认有稳定窗口，避免抖动。

## 配置示例

~~~yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: web
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
~~~

## 常见问题

- metrics-server 不可用或指标缺失，HPA 无法计算。
- 未设置 request，CPU 利用率计算失真。
- 指标波动导致频繁扩缩，需要配置 behavior。
- 与 VPA 同时基于 CPU 调整会冲突。
- 集群容量不足，扩容后 Pod 仍然 Pending。

## 相关资源

metrics-server 提供资源指标；Prometheus Adapter 提供自定义指标；Cluster Autoscaler 扩容节点；VPA 调整资源请求。

## 参考资料

- [Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)`,
    { docsUrl: 'https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/' },
  ),
  d(
    'k8s-pdb',
    `## 资源定义

PodDisruptionBudget（PDB）限制自愿中断时同时不可用的 Pod 数量。

## 解决的问题

节点排水、集群升级和主动维护会驱逐 Pod。PDB 保证这些操作不会一次性带走太多副本。

## 核心字段

- **minAvailable**：最少可用数量或百分比。
- **maxUnavailable**：最多不可用数量或百分比。
- **selector**：选择受保护的 Pod。

## 生命周期

驱逐 API 在驱逐 Pod 前检查 PDB 预算。如果驱逐会导致可用数低于 minAvailable 或超过 maxUnavailable，请求会被拒绝，排水会等待。

## 配置示例

~~~yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: web
~~~

## 常见问题

- PDB 设置过严（如 minAvailable 等于副本数），导致节点永远无法排水。
- selector 不匹配，PDB 实际没有保护任何 Pod。
- 只保护 Deployment，不保护 StatefulSet 或自定义控制器。
- PDB 不约束资源驱逐和节点故障，只约束自愿中断。

## 相关资源

Deployment/StatefulSet 提供副本；节点 drain 触发驱逐；cluster-autoscaler 缩容也受 PDB 约束。

## 参考资料

- [Pod Disruption Budgets](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/)`,
    { docsUrl: 'https://kubernetes.io/docs/concepts/workloads/pods/disruptions/' },
  ),
  d(
    'k8s-upgrade',
    `## 适用场景

Kubernetes 小版本升级、安全补丁和节点池轮换。

## 实施前提

- 阅读目标版本的 release notes 和废弃 API 列表。
- 确认控制面、节点、CNI、CSI、Ingress、监控等组件兼容。
- 备份 etcd，验证恢复流程。
- 检查 PDB、副本数和容量余量。
- 准备回滚方案，但注意控制面降级通常不受支持。

## 操作步骤

1. 升级控制面第一个节点，确认 apiserver、scheduler、controller-manager、etcd 健康。
2. 逐个升级其余控制面节点。
3. 逐个 cordon → drain → 升级 kubelet/kube-proxy → uncordon 工作节点。
4. 升级 CNI、CSI、Ingress 等附加组件。
5. 观察工作负载、事件和关键指标。

~~~bash
kubectl drain node-1 --ignore-daemonsets --delete-emptydir-data
# 在节点上执行升级
kubectl uncordon node-1
~~~

## 验证方式

- 所有节点 Ready，kube-system 组件正常。
- Deployment 副本齐全，Service 有 Endpoint。
- 关键业务探针和监控正常。
- 无持续 Pending、CrashLoopBackOff 或高频驱逐。

## 风险与回滚

控制面升级后通常不能简单降级。回滚应以恢复 etcd 快照和重建节点为主，因此升级前必须备份并验证。节点升级可以逐台回退，但 kubelet 版本不能高于 apiserver。

## 常见问题

- 跳过中间版本，违反版本偏差策略。
- 未检查废弃 API，升级后控制器或清单失效。
- drain 被 PDB 或本地存储 Pod 阻塞。
- 附加组件版本不兼容。

## 参考资料

- [Upgrading kubeadm clusters](https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-upgrade/)
- [Version Skew Policy](https://kubernetes.io/releases/version-skew-policy/)`,
  ),
  d(
    'k8s-backup',
    `## 适用场景

集群灾备、误删恢复、迁移和升级前保护。

## 实施前提

- 明确 RPO/RTO：能接受丢失多少数据、多久恢复。
- etcd 和持久卷需要分别备份。
- 准备独立于生产集群的备份存储。
- 定期演练恢复，而不是只检查备份任务成功。

## 操作步骤

1. 定期保存 etcd 快照，并记录 Kubernetes 版本和证书信息。
2. 使用 Velero 或 CSI 快照备份命名空间资源和 PV。
3. 备份 CRD、Operator 配置和外部依赖（镜像仓库、密钥）。
4. 在隔离环境执行恢复演练。
5. 校验对象数量、PV 数据和关键应用可用性。

## 验证方式

- 能从快照恢复一个测试集群。
- 能恢复单个命名空间和 PVC。
- 恢复后 Service、Endpoint、控制器状态正常。
- 记录实际恢复耗时，校准 RTO。

## 风险与回滚

恢复 etcd 会覆盖当前集群状态，必须在隔离环境或确认故障后执行。PV 快照恢复要注意 StorageClass、拓扑和访问模式。恢复顺序通常是 CRD → 命名空间 → 工作负载 → 数据。

## 常见问题

- 只备份 etcd，不备份 PV，恢复后数据缺失。
- 备份文件未验证，恢复时才发现损坏。
- 版本不兼容导致快照无法恢复。
- 恢复后遗漏镜像、密钥或外部依赖。

## 参考资料

- [etcd recovery](https://etcd.io/docs/latest/op-guide/recovery/)
- [Velero 文档](https://velero.io/docs/)`,
  ),
];
