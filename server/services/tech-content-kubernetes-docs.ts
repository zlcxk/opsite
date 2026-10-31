import type { TechExternalLink } from '../../shared/types.js';
import type { TechContentEntry } from './tech-content.js';

const d = (
  nodeId: string,
  contentMarkdown: string,
  options: {
    versions?: string;
    docsUrl?: string;
    repoUrl?: string;
    source?: 'official' | 'mixed' | 'curated';
    referenceLinks?: TechExternalLink[];
    version?: number;
    replacesContentHash?: string;
  } = {},
): TechContentEntry => ({
  nodeId,
  version: options.version ?? 1,
  contentMarkdown,
  contentStatus: 'draft',
  contentSource: options.source ?? 'mixed',
  applicableVersions: options.versions ?? 'Kubernetes 1.28+（除单独标注外）',
  docsUrl: options.docsUrl,
  repoUrl: options.repoUrl,
  referenceLinks: options.referenceLinks,
  replacesContentHash: options.replacesContentHash,
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
    `## 技术定位

kube-apiserver 是 Kubernetes 控制面中唯一对外提供 REST API 的组件，也是所有持久化读写经过的安全边界。kubectl、kube-scheduler、kube-controller-manager、kubelet、kube-proxy 以及外部控制器都通过它读取和写入对象；只有 kube-apiserver 配置了 etcd 端点并直接与 etcd 通信，其他组件即使需要集群状态，也只能通过 API 获取。这个单向关系是理解控制面故障传播的起点：apiserver 不可用时，已有 Pod 可能继续运行，但调度、控制器调和、状态上报和新变更都会停滞。

apiserver 本身不保存权威状态。它把对象编码后写入 etcd，在内存中维护 watch cache 和 discovery 信息，并把多个副本部署在负载均衡之后。副本之间不选主，每个副本都可以处理读写；它们共享同一组 etcd，但各自的缓存独立。因此“apiserver 高可用”不等于“etcd 高可用”，两者要分别设计。

## 设计原理

apiserver 把“状态存储”和“状态访问”分开：etcd 只负责持久化字节，apiserver 负责对象语义、版本转换、默认值、准入、并发控制和 watch。这样所有客户端共享同一套校验规则，控制器不需要理解存储格式，也不需要各自实现缓存失效。

副本无状态（watch cache 是可重建的本地缓存）使水平扩展变得简单；但“无状态”不等于“无一致性约束”。读的一致性由 resourceVersion 语义表达，写的一致性由 etcd 的 Raft 和 resourceVersion 前置条件保证。准入 webhook 与聚合 API 把扩展点放进请求路径，代价是外部依赖的延迟和可用性会直接影响 API。

## 工作机制

### 请求处理链路

一个写请求通常依次经过：

1. **TLS 与认证**：确认请求者身份。常见方式包括客户端证书、ServiceAccount Token、OIDC 和认证 webhook；匿名访问可以关闭。认证失败返回 401。
2. **授权**：按 Node、RBAC、Webhook 等授权器判断该身份是否允许对目标资源执行该 verb。授权失败返回 403，和“未认证”是不同问题。
3. **解码、转换与默认值**：把请求体从 JSON 或 protobuf 解码为内部类型，完成版本转换和字段默认值填充。
4. **变更准入**：运行 MutatingAdmissionWebhook、MutatingAdmissionPolicy 以及内置的变更型插件，可能补默认值、注入边车或修改标签。
5. **校验**：执行 OpenAPI schema、字段校验和对象级校验，然后运行 ValidatingAdmissionWebhook、ValidatingAdmissionPolicy 及内置校验插件。任一步拒绝，整个请求立即失败。
6. **持久化**：在 etcd 事务中写入对象；更新和删除会以 resourceVersion 做前置条件。成功后 etcd 返回新的 revision，apiserver 把它映射为对象的 resourceVersion。
7. **响应与通知**：返回响应，同时更新本副本的 watch cache，并向 watch 客户端分发事件。

读请求（get/list/watch）不经过准入控制。它们可以命中 watch cache，也可能需要 etcd 参与，具体取决于请求的一致性语义。

### 读路径与一致性

resourceVersion 是理解读行为的关键：

- **不设置 resourceVersion**：请求“最新”数据。语义上要求一致读；在 Kubernetes 1.34 中，当 etcd 为 3.4.31+ 或 3.5.13+ 时，apiserver 可以通过 watch cache 加 progress notification 提供该语义，而不必每次直读 etcd。1.31 起该能力默认启用。
- **resourceVersion=0**：表示“任意版本”，总是由 watch cache 返回，可能比客户端已见过的版本更旧；适合先 list 再 watch 的场景，不适合强一致读取。
- **指定具体 resourceVersion**：要求精确版本；若该版本已被压缩，返回 410 Gone，客户端必须重新 list。
- **resourceVersionMatch=NotOlderThan**：list 时常用的折中，保证结果不旧于给定版本，同时允许使用缓存。

watch 从某个 resourceVersion 开始持续推送 ADDED/MODIFIED/DELETED 事件，并可用 bookmark 事件推进客户端记录的版本。历史 revision 被压缩后，旧 watch 会收到 410，客户端应重新建立 list/watch，而不是无限重连同一个版本。

### 写入、并发与扩展

更新和删除可以携带 resourceVersion。若对象在读取后被其他客户端修改，apiserver 会发现版本不匹配并返回 409 Conflict，这就是乐观并发控制；重试前应重新读取对象。PATCH 支持 JSON Patch、Merge Patch、内置资源的 Strategic Merge Patch 以及 Server-Side Apply。Server-Side Apply 以字段所有权解决多管理者冲突，冲突时同样返回 409，需要显式 force 或调整字段归属。

CRD 由 apiserver 直接提供发现、校验和持久化，数据仍写入同一 etcd。聚合 API 则把请求转发给独立的扩展 apiserver；扩展服务的存储由它自己决定，不保证与核心 etcd 相同。Admission webhook 也是 apiserver 的外部依赖，超时或不可达会直接增加写延迟，\`failurePolicy: Fail\` 时还会阻断写入。

## 关键配置与实践

### 请求治理与高可用

apiserver 用 API Priority and Fairness（APF）隔离不同客户端。APF 自 1.29 起为 Stable，默认启用；FlowSchema 按请求属性分类，PriorityLevelConfiguration 为每个优先级维护独立并发上限和队列。启用 APF 时，\`--max-requests-inflight\`（默认 400）与 \`--max-mutating-requests-inflight\`（默认 200）相加构成总并发预算，再分配给各优先级；不再简单地把所有请求放进一个池子。被限流的请求返回 429，并带 Retry-After，客户端应退避重试。

其他关键配置包括 \`--etcd-servers\`、\`--etcd-prefix\`（默认 \`/registry\`）、\`--authorization-mode\`、\`--enable-admission-plugins\`、\`--audit-policy-file\`、\`--encryption-provider-config\` 和 \`--watch-cache\`。审计策略决定记录哪些请求和响应体；静态加密让 etcd 中保存的是密文，但密钥管理仍在集群外。

生产环境通常部署 3 个或更多 apiserver 副本，放在负载均衡之后，共享同一组 etcd。副本无 leader，扩容可以提升读与请求处理能力，但不能替代 etcd 的法定人数。apiserver 的 watch cache 是每副本本地的，滚动重启会让缓存重新建立，期间 etcd 读压力会上升。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
|---|---|---|
| 401 Unauthorized | 证书、Token 过期或认证配置错误 | 检查 kubeconfig、证书 SAN、ServiceAccount Token |
| 403 Forbidden | RBAC 未授权或 Node 授权器拒绝 | \`kubectl auth can-i\`、RoleBinding、Node 身份 |
| 429 Too Many Requests | APF 限流或客户端高频 list/watch | 看 FlowSchema、PriorityLevel 指标和客户端 QPS |
| 写入超时或 500 | admission webhook 不可达、etcd 慢或法定人数丢失 | webhook 超时、etcd fsync、leader 变化 |
| 409 Conflict | resourceVersion 冲突或 SSA 字段所有权冲突 | 重新读取对象，检查 field manager |
| watch 频繁 410 | 客户端版本过旧或 etcd 压缩过快 | 重新 list/watch，检查压缩间隔和客户端处理 |
| 所有副本不健康 | etcd 不可用、证书过期、磁盘满 | 先查 etcd 健康，再查 apiserver 日志与证书 |

## 技术关联

kube-scheduler 通过 apiserver 读取未绑定 Pod、写入 Binding；kube-controller-manager 通过 apiserver watch 对象并写回状态；kubelet 通过 apiserver 获取绑定到本节点的 Pod、上报 Node 与 Pod 状态，并通过 Lease 维持心跳；kube-proxy 通过 apiserver watch Service 和 EndpointSlice。它们都不直接访问 etcd。etcd 只与 apiserver 建立连接，因此 etcd 故障首先表现为 API 写入失败和 watch 中断，而不是某个节点立即停止运行。

## 参考资料

- [Kubernetes Components](https://kubernetes.io/docs/concepts/overview/components/#kube-apiserver)
- [Kubernetes API Concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/)
- [API Priority and Fairness](https://kubernetes.io/docs/concepts/cluster-administration/flow-control/)
- [Admission Control](https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/)
- [kube-apiserver reference](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/)
- [API Server Bypass Risks](https://kubernetes.io/docs/concepts/security/api-server-bypass-risks/)`,
    {
      versions: 'Kubernetes 1.28+；APF 1.29 Stable；watch cache 提供 Most recent 读自 1.31 起默认',
      docsUrl: 'https://kubernetes.io/docs/concepts/overview/components/#kube-apiserver',
      version: 2,
      replacesContentHash: '81c6092c321002cfe808bdd6eff1d7c44a99a276e312d64bf82d96d1939c775b',
      referenceLinks: [
        {
          label: 'Kubernetes API Concepts',
          url: 'https://kubernetes.io/docs/reference/using-api/api-concepts/',
        },
        {
          label: 'API Priority and Fairness',
          url: 'https://kubernetes.io/docs/concepts/cluster-administration/flow-control/',
        },
        {
          label: 'Admission Control',
          url: 'https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/',
        },
        {
          label: 'kube-apiserver reference',
          url: 'https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/',
        },
        {
          label: 'API Server Bypass Risks',
          url: 'https://kubernetes.io/docs/concepts/security/api-server-bypass-risks/',
        },
      ],
    },
  ),
  d(
    'k8s-etcd',
    `## 技术定位

etcd 是 Kubernetes 的持久化后端，保存所有 API 对象的权威副本。它本身是一个通用的强一致键值存储，并不理解 Pod、Deployment 或 Service；对象由 kube-apiserver 编码后写入，读取时再由 apiserver 解码、转换并发给客户端。只有 kube-apiserver 直接连接 etcd，scheduler、controller-manager、kubelet 和 kube-proxy 都只通过 API 读写状态。

这个边界很重要：直接修改 etcd 中的 \`/registry\` 数据会绕过认证、授权、准入、默认值、resourceVersion 和 watch 通知，可能让对象处于 apiserver 无法解释的状态。etcd 是“后端存储”，不是给运维人员使用的 Kubernetes 管理接口。

### 版本与兼容性

etcd 版本必须跟随所用 Kubernetes 版本，而不是直接采用 etcd 最新版。以 kubeadm 的版本映射为例：kubeadm 1.34 默认安装 etcd 3.6.5，支持的外部 etcd 最低版本为 3.5.24；kubeadm 1.31–1.33 默认仍为 3.5.24。Kubernetes 运维文档中“生产环境最低建议 3.4.29+/3.5.11+”是通用下限，不等同于某个 Kubernetes 版本受支持的组合。

升级前应查阅对应 Kubernetes 版本的 kubeadm 常量、发布说明和 etcd 升级文档，确认目标版本、数据目录格式和回滚路径。跨多个 minor 直接升级、混用不同 etcd 版本、或在未备份时替换成员，都会放大恢复难度。

## 设计原理

etcd 把共识、持久化和版本历史集中到一个后端：Raft 决定哪些写已提交，WAL 保证崩溃后可恢复，MVCC 保留 revision 供 watch 追赶。Kubernetes 只消费这些原语，不要求 etcd 理解对象语义。这种分层让 apiserver 可以独立演进 API 版本，而 etcd 保持通用；代价是 etcd 的磁盘延迟、容量和法定人数会直接成为 API 的写入瓶颈。

Kubernetes 默认把对象放在 \`/registry/<资源>/<命名空间>/<名称>\` 下，集群级资源省略命名空间；前缀可以通过 apiserver 的 \`--etcd-prefix\` 修改。对象默认以 protobuf 编码写入，而不是直接保存 YAML。

etcd 使用多版本并发控制（MVCC）：每次写操作产生一个全局递增的 revision，旧版本在压缩前仍然可读。watch 可以从指定 revision 开始推送变更，因此 apiserver 能先 list 再 watch，并在断线后从上次版本继续。压缩会删除旧 revision，客户端若请求已被压缩的版本，会收到 410 Gone，必须重新 list。

写请求由 Raft leader 接收，复制到多数派并持久化后才确认。3 个成员可以容忍 1 个成员故障，5 个成员可以容忍 2 个；偶数成员不会提高容错能力，2 个成员反而无法容忍任何 1 个故障。默认读是线性一致的，要求读到最新已提交状态；这会受 leader 和网络影响，不是免费的本地读。

## 工作机制

- **Raft**：负责 leader 选举、日志复制和成员变更；失去多数派后集群无法提交新写入。
- **WAL**：预写日志，写请求在落盘后才算提交；磁盘 fsync 延迟直接转化为 apiserver 写延迟。
- **Backend 与快照**：bbolt 保存键值数据，etcd 按 \`--snapshot-count\`（自 v3.2 起默认 100000）触发快照并截断旧 Raft 日志。
- **Compaction**：清理旧 revision。kube-apiserver 默认每 5 分钟发起一次压缩，可通过 \`--etcd-compaction-interval\` 调整；压缩不等于回收磁盘空间。
- **Defrag**：重写 backend 文件以回收碎片空间，需要逐成员执行；执行期间该成员的服务会受影响。
- **空间配额**：etcd 达到配额后触发 NOSPACE 告警并拒绝写入，只允许读和删除；需要先压缩、再碎片整理，并清除告警后才能恢复写入。
- **Watch**：apiserver 通过 watch 获取变更；etcd 不保存“当前对象”的语义，只保存键值历史。

## 关键配置与实践

etcd 对磁盘延迟和 fsync 稳定性非常敏感。优先使用本地 SSD，避免网络存储和高争用磁盘；控制面节点通常为 3 或 5 个，跨故障域部署，并保证成员之间的网络延迟稳定。CPU 饱和、内存压力和磁盘抖动都可能导致心跳超时、leader 切换，进而表现为 apiserver 写入变慢或超时。

需要持续观察的指标包括：

- \`etcd_server_has_leader\` 与 \`etcd_server_leader_changes_seen_total\`：是否稳定有 leader。
- \`etcd_disk_wal_fsync_duration_seconds\`：WAL 落盘延迟。
- \`etcd_disk_backend_commit_duration_seconds\`：backend 提交延迟。
- \`etcd_mvcc_db_total_size_in_bytes\` 与配额使用率：是否接近 NOSPACE。
- \`etcd_network_peer_round_trip_time_seconds\`：成员间网络。
- \`etcd_server_slow_apply_total\`、\`etcd_server_slow_read_indexes_total\`：慢 Apply 与慢读。

定期压缩和碎片整理只能控制空间，不能替代容量规划。大量 Event、频繁更新的大对象和失控控制器都会放大写入量；Event 默认保留 1 小时，可以通过 apiserver 的 \`--event-ttl\` 调整，但缩短保留时间只是缓解手段。

### 备份与恢复

快照备份应包含所有成员的一致状态，并实际演练恢复。常用命令：

~~~bash
ETCDCTL_API=3 etcdctl snapshot save /backup/etcd-$(date +%F).db \\
  --endpoints=https://127.0.0.1:2379 \\
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \\
  --cert=/etc/kubernetes/pki/etcd/server.crt \\
  --key=/etc/kubernetes/pki/etcd/server.key

etcdutl snapshot status /backup/etcd-$(date +%F).db --write-out=table
~~~

自 etcd 3.5 起，\`etcdctl snapshot status\` 和 \`etcdctl snapshot restore\` 已弃用；etcd 3.6 文档只提供 \`etcdutl\` 方式，校验和恢复应直接使用 \`etcdutl\`。恢复时先停止 apiserver 和 etcd，把快照恢复到新的数据目录，再按原集群配置启动所有成员：

~~~bash
etcdutl snapshot restore /backup/etcd.db \\
  --name etcd-1 \\
  --initial-cluster etcd-1=https://10.0.0.11:2380,etcd-2=https://10.0.0.12:2380,etcd-3=https://10.0.0.13:2380 \\
  --initial-cluster-token etcd-cluster-1 \\
  --initial-advertise-peer-urls https://10.0.0.11:2380 \\
  --data-dir /var/lib/etcd-restored
~~~

恢复后要检查成员健康、leader、数据 revision 和关键对象。不要把“快照文件存在”当成“可以恢复”；RPO 取决于最近一次成功备份，RTO 取决于恢复演练和证书、DNS、负载均衡等外围配置。

### 升级与成员变更

升级应逐成员进行：先升级一个 follower，确认健康并追上 leader，再处理下一个，最后升级 leader；同时遵循 etcd 版本自身的升级路径，不要跨多个 minor 跳跃。成员替换时先加入新成员并等待数据同步完成，再移除旧成员；peer 证书的 SAN 必须覆盖新成员的地址。

在多数派丢失时，不要随意使用强制新建集群的方式“修复”，这会产生分叉数据。优先从经过验证的快照恢复，并确认所有成员使用相同的集群配置和 token。

## 常见问题与限制

| 现象 | 原因 | 处理 |
|---|---|---|
| leader 频繁切换 | 磁盘慢、网络抖动、CPU 饱和 | 查 fsync、网络和成员日志 |
| 数据库持续增长 | 未压缩、Event 或对象写入量过大 | 检查压缩间隔、Event 保留和对象规模 |
| NOSPACE 告警 | 达到空间配额 | 压缩、逐成员 defrag、清除告警 |
| 写入全部失败 | 失去多数派、成员证书过期 | 恢复成员或从快照重建，检查 peer 证书 |
| 恢复后数据不对 | 快照过旧或恢复步骤错误 | 校准 RPO，定期演练 |
| 成员无法加入 | peer 证书或初始集群配置错误 | 检查 peer URLs、SAN 和初始集群参数 |

## 技术关联

etcd 故障会首先表现为 apiserver 写入失败、watch 中断和控制器停止推进；已经运行的 Pod 不会因为 etcd 短暂不可用而立即停止，kubelet 会继续按最后一次拿到的 PodSpec 运行容器并重试上报。不要把 etcd 当成应用数据库，也不要在应用侧直接连接 etcd 保存业务数据；Kubernetes 的 API 语义、准入和 watch 都在 apiserver 层。

## 参考资料

- [etcd 官方文档](https://etcd.io/docs/v3.6/)
- [etcd Maintenance](https://etcd.io/docs/v3.6/op-guide/maintenance/)
- [etcd Recovery](https://etcd.io/docs/v3.6/op-guide/recovery/)
- [Operating etcd clusters for Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)`,
    {
      versions: 'Kubernetes 1.34；kubeadm 默认 etcd 3.6.5，外部 etcd 最低 3.5.24（1.31–1.33 为 3.5.24）',
      docsUrl: 'https://etcd.io/docs/v3.6/',
      version: 2,
      replacesContentHash: '933548092960c40af1fa0ec0f20da6130cb803d917fe12e5f1fc6e91ecf430bf',
      referenceLinks: [
        {
          label: 'etcd Maintenance',
          url: 'https://etcd.io/docs/v3.6/op-guide/maintenance/',
        },
        {
          label: 'etcd Recovery',
          url: 'https://etcd.io/docs/v3.6/op-guide/recovery/',
        },
        {
          label: 'Operating etcd clusters for Kubernetes',
          url: 'https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/',
        },
      ],
    },
  ),
  d(
    'k8s-scheduler',
    `## 技术定位

kube-scheduler 是 Kubernetes 控制面中的放置决策组件。它监听尚未绑定节点的 Pod，根据资源请求、亲和性、污点、拓扑和存储约束筛选节点，再通过打分选出最合适的一个，最后写入 Binding。调度器只决定“Pod 应该去哪”，不负责拉镜像、挂载存储或启动容器，这些由目标节点上的 kubelet 完成。

调度器是集群容量与业务约束之间的协调者：它既要避免节点过载，也要满足高可用、故障域隔离、专用节点池和存储拓扑等要求。它不创建节点，也不直接迁移运行中的 Pod；节点扩容通常由 Cluster Autoscaler 等外部组件根据 Pending Pod 触发。

## 设计原理

### 调度队列

调度器通过 informer 监听 Pod 变化，把未绑定节点且未被删除的 Pod 放入队列。队列通常分为：

- **activeQ**：当前可被调度的 Pod，按优先级排序。
- **backoffQ**：上一次调度失败、正在退避的 Pod。
- **unschedulableQ**：因硬约束暂时无法调度的 Pod，等待集群状态变化后重试。

调度器一次只为一个 Pod 执行调度周期，但绑定周期可以与后续 Pod 的调度并行。若绑定失败，调度器会从缓存中撤销对该 Pod 的假设，并把它重新放回队列。这个 assume/forget 机制避免了多个 Pod 同时争抢同一份资源。

### 重新入队与 QueueingHint

调度失败后不能对所有 Pending Pod 做无差别全量重试。大规模集群中，节点、Pod、PVC、污点或资源配额的任何变化都可能触发事件；如果每个事件都把所有等待中的 Pod 重新完整调度一遍，调度器会被大量无效的 Filter/Score 计算淹没，真正可调度的 Pod 反而得不到及时处理。

因此，调度失败且被判定为 Unschedulable 的 Pod 会进入 unschedulableQ（较新的实现中也称 unschedulable Pods pool），处于退避期的 Pod 留在 backoffQ，可立即调度的 Pod 才进入 activeQ。集群事件发生时，调度器需要判断哪些等待中的 Pod 值得重试，而不是无条件全部唤醒。

EnqueueExtension 是调度框架中用于控制“某个集群变化是否应触发重试”的接口。实现 PreEnqueue、PreFilter、Filter、Reserve 或 Permit 的插件可以实现它。QueueingHint 是其中的回调：每当相关类型的对象发生变化，调度器向插件询问该事件是否可能让这个 Pod 变得可调度；只有在提示为“可能”时，才把 Pod 放入 activeQ 或 backoffQ 重试。

QueueingHint 不是调度周期的一个阶段，不参与单个 Pod 的 Filter/Score，也不改变调度决策；它属于调度队列的事件过滤机制，作用是减少无效重试。特性门控 \`SchedulerQueueingHints\` 在 1.28 引入 Beta，1.29–1.31 默认关闭，1.32–1.33 恢复默认开启但仍为 Beta，1.34 转为 Stable 并默认启用。更早的版本或关闭该门控时，调度器只能依赖更粗粒度的事件触发和周期重试，调度延迟与无效计算都会更高。

### 调度框架阶段

调度框架把调度周期拆成可插拔扩展点，插件可以在这些阶段插入逻辑：

1. **PreEnqueue**：决定 Pod 是否允许进入调度队列。
2. **QueueSort**：定义队列排序，通常由优先级决定。
3. **PreFilter**：预计算 Pod 的调度需求，或提前判断不可能满足的条件。
4. **Filter**：逐个节点检查硬约束，返回可行节点集合。
5. **PostFilter**：没有可行节点时执行，默认实现是抢占。
6. **PreScore**：为打分做准备。
7. **Score**：对可行节点打分。
8. **NormalizeScore**：把插件分数归一化到统一范围。
9. **Reserve**：为选中的节点预留资源，失败则进入 Unreserve。
10. **Permit**：允许插件延迟或拒绝绑定。
11. **PreBind**：绑定前准备，例如挂载卷。
12. **Bind**：写入 Pod 的 nodeName。
13. **PostBind**：绑定成功后的清理和通知。

### 过滤与打分

Filter 阶段常见的硬约束包括节点可分配资源、节点是否可调度、污点与容忍、节点亲和性、Pod 亲和与反亲和、拓扑分布、卷拓扑和端口冲突。节点可分配资源是 allocatable 减去已请求资源；调度器看的是 requests 和 Pod overhead，而不是容器实时 CPU 使用率。

Score 阶段对通过过滤的节点排序。常见插件考虑资源均衡度、镜像本地性、Pod 亲和性和拓扑分布。NodeResourcesFit 支持 LeastAllocated、MostAllocated 和 RequestedToCapacityRatio 等策略；默认倾向把 Pod 放到资源使用比例较低的节点，以减少热点。

### 优先级与抢占

高优先级 Pod 无法调度时，PostFilter 的默认抢占逻辑会在某个节点上选择一组低优先级 Pod 作为牺牲者，尝试腾出足够资源。抢占会选择对集群影响较小的方案，并尽量降低对 PodDisruptionBudget 的违反，但 PDB 不是抢占的硬约束。

抢占成功后，高优先级 Pod 获得 nominated node 标记，牺牲者进入终止流程。最终绑定仍取决于资源是否真正释放；如果其他 Pod 先占了资源，调度可能再次失败并重试。抢占不是即时驱逐，也不保证一定成功。

## 工作机制

1. Pod 被控制器创建，spec.nodeName 为空。
2. 调度器从队列取出 Pod，执行 PreFilter 并计算调度需求。
3. 对所有节点执行 Filter，得到可行节点集合。
4. 若集合为空，执行 PostFilter；默认尝试抢占，仍失败则记录 FailedScheduling 事件。
5. 对可行节点执行 Score 和 NormalizeScore，选择最高分节点。
6. Reserve 阶段预留资源，Permit 阶段决定是否放行。
7. PreBind 完成卷等准备工作，Bind 写入 nodeName。
8. 目标节点的 kubelet 观察到绑定结果，开始创建 Pod sandbox 和容器。

调度器通常通过 schedulerName 选择调度配置。未指定时使用 default-scheduler。直接设置 nodeName 会绕过调度器，因此不会经过资源过滤和打分，通常只用于调试或特殊场景。

## 关键配置与实践

- **requests 必须准确**：调度完全依赖 requests；设置过低会导致节点超卖，过高会造成虚假容量不足。
- **Pod overhead**：RuntimeClass 带来的额外开销会计入 Pod 的有效请求，评估容量时不能只看容器 requests。
- **节点亲和性**：requiredDuringSchedulingIgnoredDuringExecution 是硬约束，preferred 是软约束；后者不保证满足。
- **污点与容忍**：NoSchedule 阻止新 Pod，PreferNoSchedule 只是倾向，NoExecute 会驱逐不容忍的现有 Pod。
- **Pod 反亲和**：适合把同一服务的副本打散到不同节点或可用区；大规模集群中应控制标签选择器范围，避免调度开销过高。
- **拓扑分布**：TopologySpreadConstraints 用 maxSkew 和 whenUnsatisfiable 控制分布；DoNotSchedule 是硬约束，ScheduleAnyway 允许在不满足时仍然调度。
- **卷拓扑**：使用 WaitForFirstConsumer 的 StorageClass 时，卷绑定会等待 Pod 调度，调度器必须同时满足 PV 的节点亲和性。
- **专用节点池**：给节点打污点，再为特定工作负载配置容忍和节点亲和性，避免普通 Pod 占用。
- **优先级**：为关键系统组件设置高优先级 PriorityClass，但不要滥用，否则会频繁触发抢占。

## 常见问题与限制

- **Pod 一直 Pending**：先看 FailedScheduling 事件中的具体原因，再检查 requests、污点、亲和性、PVC 和配额。PDB 不会阻止调度，但配额和准入会。
- **节点看起来空闲却调度失败**：调度器看 requests 而非实时使用率；可能已有 Pod 预留了资源，或 allocatable 已被系统保留扣减。
- **亲和性写错**：topologyKey 不存在、标签不匹配或 required 条件互相冲突，都会导致无可行节点。
- **拓扑分布无法满足**：节点数量、可用区数量或 minDomains 设置与集群实际拓扑不符。
- **抢占没有解决问题**：牺牲者尚未真正退出，或资源碎片仍不足以容纳 Pod；也可能被更高优先级 Pod 再次抢占。
- **调度器不是实时负载均衡器**：它不会因为某个节点 CPU 升高就迁移 Pod；运行后的再平衡需要 descheduler 等组件。
- **大规模集群的调度开销**：Pod 亲和性和大范围拓扑约束会增加 Filter/Score 成本，应控制选择器范围并监控调度延迟。
- **DaemonSet 与调度**：DaemonSet 控制器为节点生成带节点亲和性的 Pod，仍由调度器绑定；节点污点需要相应容忍。

## 技术关联

controller-manager 中的工作负载控制器创建 Pod，scheduler 为 Pod 选择节点并写入 Binding，kubelet 在目标节点执行 Pod。apiserver 提供 watch 和 Binding 写入，etcd 保存绑定结果。CNI 和 CSI 分别影响网络与存储可用性，卷拓扑会直接参与调度约束。Cluster Autoscaler 观察 Pending Pod 并扩容节点，descheduler 可以在运行后重新平衡。Service 和 EndpointSlice 不参与调度决策，但决定 Pod 就绪后是否接收流量。

## 参考资料

- [kube-scheduler](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/)
- [Scheduling Framework](https://kubernetes.io/docs/concepts/scheduling-eviction/scheduling-framework/)
- [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/)
- [Pod Priority and Preemption](https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/)`,
    {
      versions: 'Kubernetes 1.28+；QueueingHint 1.28 Beta、1.29–1.31 默认关闭、1.32–1.33 Beta、1.34 Stable',
      docsUrl: 'https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/',
      version: 3,
      replacesContentHash: 'ed02356a1fd408738f5af436df9443889b59b55ac0a6e4d4372013f70518ee1f',
      referenceLinks: [
        {
          label: 'Scheduling Framework',
          url: 'https://kubernetes.io/docs/concepts/scheduling-eviction/scheduling-framework/',
        },
        {
          label: 'Assigning Pods to Nodes',
          url: 'https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/',
        },
        {
          label: 'Pod Priority and Preemption',
          url: 'https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/',
        },
        {
          label: 'Taints and Tolerations',
          url: 'https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/',
        },
      ],
    },
  ),
  d(
    'k8s-controller-manager',
    `## 技术定位

kube-controller-manager 是 Kubernetes 控制面中的内置控制器集合。它把数十个控制器编译进同一个进程，通过 apiserver 持续观察对象状态，并把实际状态调和到期望状态。Deployment 创建 ReplicaSet、ReplicaSet 维持 Pod 副本、Node 生命周期管理、EndpointSlice 生成、Job 与 CronJob 推进、Namespace 删除、HPA 扩缩容等，都由这个组件中的不同控制器完成。

它不是“一个负责所有事情的控制器”，而是一组共享进程、缓存和客户端的控制循环。每个控制器只关心自己负责的资源类型，通过 API 对象解耦。云厂商相关的负载均衡、路由和节点控制器通常拆到 cloud-controller-manager，调度决策由 kube-scheduler 负责，节点上的实际执行由 kubelet 负责。

## 设计原理

### 控制循环

控制器遵循 Kubernetes 的声明式控制模型：

1. 观察期望状态（spec）和当前状态（status）。
2. 计算两者差异。
3. 发起最小必要变更，使当前状态接近期望状态。
4. 记录事件和状态，等待下一次观察或重试。

调和必须幂等：同一个对象被重复处理多次，结果应保持一致。控制器不假设事件只到达一次，也不依赖事件顺序；它每次都从缓存中读取最新对象并重新计算。

### Informer 与工作队列

控制器通常使用 client-go 的 informer 对 apiserver 做 list-watch，在本地维护资源缓存，并把变更事件分发给事件处理器。事件处理器通常只把对象的 namespace/name 放入工作队列，由工作协程取出后再从缓存读取最新对象。这样即使短时间内收到多次更新，也只会合并处理，避免使用过期对象。

工作队列提供去重、限速和重试。调和失败时，对象会按指数退避重新入队；成功时通常不再排队，等待下一次 watch 事件或周期 resync。队列深度、重试次数和调和耗时是判断控制器是否健康的重要指标。

### 控制器示例

- **Deployment 控制器**：根据 Pod 模板生成 ReplicaSet，管理修订历史和滚动更新。
- **ReplicaSet 控制器**：统计匹配 selector 的 Pod，创建或删除 Pod 以维持副本数。
- **StatefulSet 控制器**：按序号管理 Pod、PVC 和稳定网络标识。
- **DaemonSet 控制器**：为每个符合条件的节点生成 Pod。
- **Job 与 CronJob 控制器**：跟踪任务完成、失败重试和定时调度。
- **Node 生命周期控制器**：根据 kubelet 心跳更新 Node 状态，并在节点失联时触发 Pod 驱逐。
- **EndpointSlice 控制器**：根据 Service selector 和 Pod 就绪状态维护后端切片。
- **Namespace 控制器**：命名空间删除时清理其下资源。
- **HPA 控制器**：根据指标计算并修改工作负载副本数。
- **垃圾回收控制器**：根据 ownerReference 清理失去所有者的对象。

### Leader election

生产环境通常运行多个 controller-manager 副本，但同一时刻只有一个副本作为 leader 执行调和。leader 通过 Lease 对象续约，其他副本处于待命状态。leader 失去续约后会停止工作，新 leader 接管，从而避免多个副本同时修改同一对象造成冲突。

Leader election 依赖 apiserver 和 etcd 的可用性。网络分区、apiserver 高延迟或时钟漂移都可能导致续约失败和 leader 切换。切换期间控制器会短暂停止推进，但已提交的对象状态不会丢失。

## 工作机制

1. controller-manager 启动后加载控制器和共享 informer，建立对 apiserver 的 watch。
2. 多个副本竞争 Lease，获得租约的副本成为 leader。
3. 各控制器把关注对象的变更放入工作队列。
4. 工作协程取出 key，从 informer 缓存读取最新对象。
5. 控制器比较期望与实际，通过 apiserver 创建、更新或删除对象。
6. 若写入冲突，控制器重新读取并重试；若失败，按退避策略重新入队。
7. 控制器更新对象 status 和 events，供用户和其他组件观察。

控制器只与 apiserver 交互，不直接读写 etcd。apiserver 负责认证、授权、准入和持久化；etcd 负责一致性存储。kubelet 上报 Node 和 Pod 状态，scheduler 写入 Pod 绑定，这些状态变化又会成为控制器的输入。

### OwnerReference 与级联删除

控制器创建从属对象时通常写入 ownerReference。Kubernetes 根据 ownerReference 判断归属，并在所有者删除时执行级联删除。Deployment 拥有 ReplicaSet，ReplicaSet 拥有 Pod；删除 Deployment 时，垃圾回收会按传播策略清理下游对象。

foreground 删除会先删除从属对象，再删除所有者；background 删除先删除所有者，再异步清理从属对象；orphan 删除保留从属对象但移除 ownerReference。理解传播策略可以避免误删或残留资源。

## 关键配置与实践

- **leader election**：多副本部署必须启用，并确保各副本能稳定访问 apiserver；单副本部署也应关注租约状态。
- **RBAC**：controller-manager 使用独立身份，权限缺失会表现为“对象存在但状态不推进”，日志中通常有 forbidden。
- **准入 webhook**：失败的 webhook 会阻塞控制器写入；应设置合理的 failurePolicy、超时和命名空间豁免。
- **API 优先级与限流**：大规模集群中 controller-manager 可能触发 apiserver 限流，表现为 429、调和延迟和队列堆积。
- **节点失联处理**：Node 生命周期控制器会给失联节点打 NoExecute 污点，Pod 在容忍时间结束后被驱逐；容忍时间需要与业务恢复时间匹配。
- **控制器并发度**：部分控制器支持 concurrent-syncs，提高并发可以加快收敛，但会增加 apiserver 压力。
- **监控**：关注 leader 状态、workqueue 深度、调和错误率、apiserver 请求延迟和 429 比例，而不是只看进程是否存活。

## 常见问题与限制

- **对象存在但状态不推进**：先确认 controller-manager 是否持有 leader、日志是否有 RBAC forbidden、webhook 是否超时，以及 apiserver 是否限流。
- **频繁 leader 切换**：apiserver 延迟、网络抖动或 CPU 饥饿会导致续约失败；切换期间调和暂停。
- **控制器热循环**：持续写入 status 或 spec 会触发自身再次入队，造成 CPU 和 apiserver 压力。
- **级联删除误伤**：ownerReference 配置错误可能导致删除上层对象时清理了不该清理的资源。
- **Node 驱逐延迟**：节点失联后 Pod 不会立即迁移，需等待污点容忍和驱逐流程；有状态服务仍需应用层保障。
- **控制器不是事务系统**：多个对象之间的变更不是原子操作，失败后依靠重试收敛，业务需要容忍中间状态。
- **云资源不在内置控制器中**：LoadBalancer、路由和部分存储操作由 cloud-controller-manager 或外部控制器完成。
- **不要直接修改由控制器管理的字段**：手动修改副本数、selector 或 status 可能与控制器冲突，应修改上层声明或使用受支持的接口。

## 技术关联

apiserver 是 controller-manager 唯一的读写入口，etcd 保存集群状态。scheduler 为控制器创建的 Pod 选择节点，kubelet 上报节点与 Pod 状态并执行容器。Deployment、ReplicaSet、StatefulSet、DaemonSet、Job 和 CronJob 的控制器都在 controller-manager 中运行；EndpointSlice 控制器为 Service 维护后端；HPA 控制器调整工作负载副本。cloud-controller-manager 负责云厂商相关的节点、路由和负载均衡控制。垃圾回收器依据 ownerReference 清理级联对象。

## 参考资料

- [kube-controller-manager](https://kubernetes.io/docs/concepts/overview/components/#kube-controller-manager)
- [Controllers](https://kubernetes.io/docs/concepts/architecture/controller/)
- [Leases](https://kubernetes.io/docs/concepts/architecture/leases/)
- [Garbage Collection](https://kubernetes.io/docs/concepts/architecture/garbage-collection/)`,
    {
      versions: 'Kubernetes 1.28+',
      docsUrl: 'https://kubernetes.io/docs/concepts/overview/components/#kube-controller-manager',
      version: 2,
      replacesContentHash: 'bfe324197d60767d85104185dd2425174f38fc93a3085828b238f6ca8a6cc78a',
      referenceLinks: [
        { label: 'Controllers', url: 'https://kubernetes.io/docs/concepts/architecture/controller/' },
        { label: 'Leases', url: 'https://kubernetes.io/docs/concepts/architecture/leases/' },
        {
          label: 'Garbage Collection',
          url: 'https://kubernetes.io/docs/concepts/architecture/garbage-collection/',
        },
      ],
    },
  ),
  d(
    'k8s-kubelet',
    `## 技术定位

kubelet 是运行在每个节点上的节点代理，负责把 API 中“应该在本节点运行的 Pod”落实为实际的容器、卷挂载和网络环境。它不是控制面组件，不参与调度决策，也不直接访问 etcd；它只通过 kube-apiserver 获取绑定到本节点的 Pod、上报 Node 与 Pod 状态，并通过 Lease 维持节点心跳。

kubelet 是 Kubernetes 声明式模型在节点侧的最后一环。scheduler 只写出 Binding，controller 只维护副本数量；真正创建 sandbox、拉取镜像、挂载卷、启动容器、执行探针和处理驱逐的是 kubelet 及其调用的容器运行时、CSI 驱动和 CNI 插件。

## 设计原理

kubelet 采用 level-triggered（水平触发）的调谐模型：它不依赖 apiserver 推送的每一条事件来执行一次性动作，而是持续比较“本节点期望的 PodSpec”和“运行时中的实际状态”，把差异补上。事件和周期同步都只是触发一次比较，因此重复同步是安全的，失败也可以在下一轮重试。这个模型让 kubelet 能在 apiserver 短暂不可用时继续维持已有 Pod。

节点侧能力被拆成几个明确边界：kubelet 负责编排和状态机，CRI 负责容器与镜像，CSI 负责卷挂载，CNI 由 CRI 运行时调用。这样替换容器运行时不需要改 kubelet 的 Pod 逻辑，但边界也意味着排查时必须判断问题落在哪一层。

它的职责包括：

- 向 apiserver 注册 Node，持续上报容量、可分配资源、conditions 和 Pod 状态。
- watch 绑定到本节点的 PodSpec，运行 Pod sync loop，使实际状态向期望状态收敛。
- 通过 CRI 调用容器运行时创建 Pod sandbox、管理容器和镜像。
- 通过 CSI 驱动完成卷的挂载、卸载和挂载点清理；底层块设备的 attach/detach 通常由外部 attach/detach controller 完成。
- 执行 startup、readiness、liveness 探针，维护 Pod conditions 和容器状态。
- 监控节点资源压力，按驱逐策略回收 Pod；执行镜像垃圾回收和容器日志轮转。
- 管理 static Pod 和 mirror Pod，使关键节点组件在 apiserver 不可用时仍能运行。

## 工作机制

### 启动与节点注册

kubelet 启动时读取 \`--config\` 指定的 KubeletConfiguration（kubeadm 通常为 \`/var/lib/kubelet/config.yaml\`），加载 kubeconfig、容器运行时端点和证书。它向 apiserver 注册 Node；使用 TLS bootstrap 时，先通过 bootstrap token 申请证书，之后由证书轮换机制续期。节点就绪后，kubelet 开始 watch 分配给自己的 Pod。

### Pod sync loop

sync loop 会处理配置变更、Pod 变更、PLEG 事件和周期同步。一次同步大致包括：检查 Pod 是否仍属于本节点、准备卷、创建或复用 sandbox、按顺序运行 Init Container、启动普通容器、执行探针、更新状态。同步是幂等的：已经达到期望状态的容器不会被重复创建，失败的操作会在后续循环中重试。

PLEG（Pod Lifecycle Event Generator）周期性地 relist 容器状态，把容器启动、退出等事件转换成同步触发器。它避免 kubelet 对每个容器高频轮询；PLEG 长时间不健康会导致状态更新滞后，节点可能表现为 NotReady 或 Pod 状态不准确。

### 节点心跳与状态

kubelet 在 \`kube-node-lease\` 命名空间维护一个以节点名命名的 Lease，默认每 10 秒续约一次，Lease 时长为 40 秒。节点控制器根据 Lease 判断节点是否存活；Lease 过期后 Node 会被标记为 NotReady，并触发 Pod 驱逐相关的 toleration 计时。

Node status 还会上报 MemoryPressure、DiskPressure、PIDPressure 和 Ready 等 conditions。kubelet 默认每 10 秒计算一次节点状态；启用 Lease 后，如果状态没有变化，默认每 5 分钟才向 apiserver 上报一次完整状态，状态一旦变化则立即上报。这样既保证故障发现速度，又避免大量重复写入。

### 容器、网络与存储

kubelet 通过 CRI 请求运行时创建 Pod sandbox。sandbox 持有 Pod 的网络命名空间，运行时（例如 containerd 的 CRI 插件）负责调用 CNI 配置网络；kubelet 不直接执行 CNI 插件。业务容器随后加入该 sandbox 的命名空间，因此共享 Pod IP 和端口空间。

卷由 kubelet 的 volume manager 协调：它调用 CSI 驱动的 NodeStageVolume/NodePublishVolume 完成挂载，在 Pod 删除后执行卸载和清理。PersistentVolume 的 attach/detach 属于控制面控制器职责，不应和节点侧挂载混为一谈。

### 探针与终止

kubelet 按 periodSeconds、timeoutSeconds、failureThreshold 和 successThreshold 执行探针。readiness 失败只把 Pod 从就绪端点移除，不重启容器；liveness 失败会重启容器；startup 成功前会抑制 liveness 和 readiness。Pod 的 Ready condition 还受所有普通容器就绪和 readinessGates 影响，不只是某一个 readinessProbe。

删除 Pod 时，kubelet 先执行 preStop，再向容器主进程发送 SIGTERM，等待 terminationGracePeriodSeconds；仍未退出则发送 SIGKILL。preStop 的执行时间计入宽限期，应用不处理 SIGTERM 时会一直等到强制杀死。

### 驱逐与镜像回收

kubelet 根据 evictionHard/evictionSoft 阈值监控 memory.available、nodefs.available、nodefs.inodesFree、imagefs.available 等信号。触发硬阈值后会立即驱逐，软阈值需要持续超过 evictionPressureTransitionPeriod。驱逐顺序不是简单的 QoS 排序：kubelet 优先回收用量超过 requests 的 Pod，再参考 Pod Priority 和超出幅度；Guaranteed Pod 也不是绝对免疫。

镜像回收按 imageGCHighThresholdPercent 和 imageGCLowThresholdPercent 执行；容器日志由 kubelet 按 containerLogMaxSize 和 containerLogMaxFiles 轮转。磁盘和 inode 压力往往先表现为镜像回收、Pod 驱逐，最后才是节点 NotReady。

## 关键配置与实践

以下为 Kubernetes 1.34 默认值。多数旧命令行标志已弃用，推荐写入 KubeletConfiguration（\`kubelet.config.k8s.io/v1beta1\`），命令行标志仅用于覆盖：

- \`nodeStatusUpdateFrequency\`：10s，计算节点状态的频率。
- \`nodeStatusReportFrequency\`：5m；若显式设置了 nodeStatusUpdateFrequency，则默认跟随该值。
- \`nodeLeaseDurationSeconds\`：40，Lease 时长；实际每 10s 续约。
- \`maxPods\`：110。
- \`cgroupDriver\`：默认 cgroupfs；kubeadm 通常设为 systemd，必须与容器运行时一致。
- \`evictionHard\`：memory.available 100Mi、nodefs.available 10%、nodefs.inodesFree 5%、imagefs.available 15%。
- \`imageGCHighThresholdPercent\` / \`imageGCLowThresholdPercent\`：85 / 80。
- \`containerLogMaxSize\` / \`containerLogMaxFiles\`：10Mi / 5。
- \`podPidsLimit\`：-1；\`failSwapOn\`：true；\`serializeImagePulls\`：true；\`registryPullQPS\`：5。
- \`containerRuntimeEndpoint\`：命令行标志的默认值为 \`unix:///run/containerd/containerd.sock\`，实际部署应按运行时配置。
- \`kubeReserved\` / \`systemReserved\`：分别为 Kubernetes 组件和系统进程预留 CPU、内存等资源；不设置会让 Pod 与系统进程直接争抢。

这些默认值只对 1.34 成立。升级 Kubernetes 或切换发行版后应重新核对配置，不能把旧版本的默认值直接套用。

## 常见问题与限制

| 现象 | 常见原因 | 排查 |
|---|---|---|
| Node NotReady | kubelet 停止、运行时 socket 不可用、证书过期、到 apiserver 的网络中断 | \`systemctl status kubelet\`、节点日志、Lease 与证书 |
| ContainerCreating 卡住 | 镜像拉取失败、CNI 未配置、CSI 挂载失败、sandbox 创建失败 | \`kubectl describe pod\`、kubelet 与运行时日志 |
| Pod 被驱逐 | 内存、磁盘或 inode 压力，超过 requests | 看 Node conditions、eviction 事件和节点磁盘 |
| 探针反复失败 | 应用启动慢、超时过短、端口或路径错误 | 检查 probe 参数、容器日志和网络 |
| 镜像拉取失败 | 仓库凭证、限流、证书或磁盘空间 | 检查 imagePullSecrets、运行时 registry 配置 |
| kubelet 与运行时通信失败 | socket 路径不一致、CRI 版本不兼容、权限不足 | \`crictl info\`、\`--container-runtime-endpoint\` |
| cgroup 驱动不一致 | kubelet 与运行时一个用 cgroupfs、一个用 systemd | 对比配置并统一后重启 |

## 技术关联

kubelet 只通过 apiserver 读取 PodSpec、写入状态和续约 Lease，不直接访问 etcd。它通过 CRI 依赖容器运行时；CNI 由运行时在创建 sandbox 时调用，不由 kubelet 直接调用；CSI 由 kubelet 的 volume manager 调用，控制面的 attach/detach 由外部控制器完成。kube-proxy 与 kubelet 同节点运行，但职责独立：前者维护 Service 转发规则，后者管理 Pod 生命周期。

apiserver 短暂不可用时，kubelet 会继续运行已经拿到的 Pod，static Pod 也不受影响；但新的 Pod 变更、状态上报和证书轮换会受阻。这个行为解释了为什么“控制面挂了，已有业务仍在跑”，也解释了为什么不能把 kubelet 当成 etcd 的客户端。

## 参考资料

- [kubelet](https://kubernetes.io/docs/concepts/overview/components/#kubelet)
- [Kubelet Configuration (v1beta1)](https://kubernetes.io/docs/reference/config-api/kubelet-config.v1beta1/)
- [Node Status](https://kubernetes.io/docs/reference/node/node-status/)
- [kubelet command-line reference](https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/)
- [Node-pressure Eviction](https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/)`,
    {
      versions: 'Kubernetes 1.34；默认值以该版本 KubeletConfiguration 为准',
      docsUrl: 'https://kubernetes.io/docs/concepts/overview/components/#kubelet',
      version: 2,
      replacesContentHash: 'b06009e6508d296ac938b86be03e81a1d3bd5b67249a0eaa838ae8bd6fa0dc36',
      referenceLinks: [
        {
          label: 'Kubelet Configuration (v1beta1)',
          url: 'https://kubernetes.io/docs/reference/config-api/kubelet-config.v1beta1/',
        },
        {
          label: 'Node Status',
          url: 'https://kubernetes.io/docs/reference/node/node-status/',
        },
        {
          label: 'kubelet command-line reference',
          url: 'https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/',
        },
        {
          label: 'Node-pressure Eviction',
          url: 'https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/',
        },
      ],
    },
  ),
  d(
    'k8s-cri',
    `## 技术定位

CRI（Container Runtime Interface）是 kubelet 与容器运行时之间的 gRPC 协议。它定义“节点代理如何请求运行时创建 sandbox、启停容器、拉取镜像、执行命令和读取状态”，不定义容器本身如何运行，也不定义网络和存储。kubelet 是客户端，容器运行时是服务端，双方通过 Unix socket 通信；kubelet 的 \`containerRuntimeEndpoint\`（命令行标志 \`--container-runtime-endpoint\`）指向该 socket。

CRI 的价值在于解耦。kubelet 不需要为每种运行时编写专用代码，运行时也不必实现 Kubernetes 的全部对象语义。containerd 通过内置 CRI 插件实现 CRI，CRI-O 则把 CRI 作为自身的主要接口；两者都可以在 kubelet 看来提供相同的 RuntimeService 和 ImageService。

## 设计原理

在 CRI 之前，kubelet 内置了针对特定运行时的适配代码，运行时变更会牵动 Kubernetes 核心。CRI 把节点侧运行时操作抽象成稳定的 gRPC 契约，使运行时可以独立演进、替换和裁剪。它只覆盖“运行时能力”，不试图统一 CNI、CSI、镜像仓库协议或 OCI 运行时规范。

CRI 也不是 Pod 调度或控制器逻辑的一部分。它不决定 Pod 放在哪个节点，不维护副本数，不创建 Service；这些职责属于 scheduler、controller-manager 和 kube-proxy。

## 工作机制

### 核心接口

CRI 由两组 gRPC 服务组成，运行时必须同时提供：

- **RuntimeService**：负责 Pod sandbox 与容器的生命周期。核心 RPC 包括 \`Version\`、\`RunPodSandbox\`、\`StopPodSandbox\`、\`RemovePodSandbox\`、\`PodSandboxStatus\`、\`ListPodSandbox\`、\`CreateContainer\`、\`StartContainer\`、\`StopContainer\`、\`RemoveContainer\`、\`ContainerStatus\`、\`ListContainers\`、\`UpdateContainerResources\`、\`ExecSync\`、\`Exec\`、\`Attach\`、\`PortForward\`、\`ContainerStats\`、\`PodSandboxStats\`、\`ReopenContainerLog\`、\`UpdateRuntimeConfig\` 和 \`Status\`。部分版本还提供 checkpoint、容器事件流和 Pod sandbox 指标等可选能力。
- **ImageService**：负责镜像。核心 RPC 包括 \`ListImages\`、\`ImageStatus\`、\`PullImage\`、\`RemoveImage\` 和 \`ImageFsInfo\`；\`ImageFsInfo\` 返回镜像文件系统用量，供 kubelet 做镜像回收判断。

\`Version\` 用于协商 API 版本并返回运行时名称和版本；\`Status\` 返回 RuntimeReady、NetworkReady 等运行时条件。kubelet 通过这些结果判断运行时是否可用，而不是只检查进程是否存在。

### PodSandbox 与容器

Pod 在 CRI 中不是一个单独的“容器”，而是 sandbox 加若干容器。\`RunPodSandbox\` 创建 Pod 级运行环境，通常是一个持有网络命名空间的 pause 容器；运行时随后调用 CNI 配置网络，并把 Pod IP、additional IPs、命名空间等信息写入 sandbox 状态。业务容器由 \`CreateContainer\` 创建并加入该 sandbox，因此共享网络和 IPC 命名空间。

这个分工解释了常见故障的归属：sandbox 创建失败通常指向 CNI、pause 镜像或运行时；容器创建失败则可能是镜像、命令、卷挂载或安全上下文。kubelet 只负责发起请求和解释结果，不直接执行 CNI 插件。

\`RuntimeClass\` 通过 \`runtime_handler\` 选择运行时处理器，例如默认 runc、gVisor 或 Kata。处理器必须在运行时的 CRI 配置中预先定义，否则 Pod 无法启动。

### 调用流程

一次典型的 Pod 启动大致是：

1. kubelet 调用 \`Version\` 确认 API 兼容，调用 \`Status\` 确认运行时和网络就绪。
2. 调用 \`RunPodSandbox\` 创建 sandbox；运行时配置 CNI 并返回 sandbox ID。
3. 通过 ImageService \`PullImage\` 拉取镜像；镜像已存在时可以跳过或校验。
4. 调用 \`CreateContainer\` 创建容器，再调用 \`StartContainer\` 启动。
5. kubelet 通过 \`ContainerStatus\`、\`PodSandboxStatus\` 和 stats 更新 Pod 状态、执行探针和资源统计。
6. 删除时依次 \`StopContainer\`、\`RemoveContainer\`、\`StopPodSandbox\`、\`RemovePodSandbox\`。

\`ExecSync\` 用于短命令并同步返回输出；\`Exec\`、\`Attach\` 和 \`PortForward\` 通过流式连接工作，kubelet 负责把客户端连接代理到运行时。\`ReopenContainerLog\` 用于日志轮转后重新打开日志文件。

## 关键配置与实践

### 版本与兼容性

CRI API 自 Kubernetes 1.23 起为 Stable。Kubernetes 1.26 及以后，kubelet 要求运行时支持 v1 CRI API；运行时不支持 v1 时，kubelet 无法注册节点。更早的 v1alpha2 已不再被新 kubelet 使用，升级节点时必须先确认运行时的 CRI 版本。

版本不匹配的典型表现是 kubelet 启动日志中的 CRI 连接错误、节点无法注册，或 \`crictl info\` 无法连接。此时应检查 kubelet 的 endpoint、运行时 CRI 插件是否启用，以及双方支持的 API 版本，而不是只重启 kubelet。

## 常见问题与限制

### 运维与排查

\`crictl\` 是直接调用 CRI 的调试工具，常用于绕过 kubectl 观察节点侧状态：

~~~bash
crictl --runtime-endpoint unix:///run/containerd/containerd.sock info
crictl pods
crictl ps -a
crictl images
crictl logs <container-id>
crictl inspect <container-id>
~~~

\`crictl\` 与 kubelet 使用同一套 CRI，能看到 kubelet 看到的 sandbox 和容器；但它也可以停止、删除容器，生产环境应只用于只读排查或明确的维护操作。

常见问题包括：socket 路径不一致或权限不足；运行时 CRI 插件未启用；CNI 配置缺失导致 sandbox 创建失败；镜像仓库认证失败；磁盘或 inode 耗尽；运行时与 kubelet 的 cgroup 驱动不一致；gRPC 超时或运行时过载。排查时应同时看 kubelet 日志、运行时日志和 \`crictl info\` 的 RuntimeReady/NetworkReady 条件。

## 技术关联

CRI 不是 OCI。CRI 是编排层与运行时之间的高层接口，OCI runtime spec 规定底层如何创建进程、命名空间和 cgroup；containerd 同时涉及两者：对外实现 CRI，对内调用 runc 等 OCI 运行时。

CRI 也不是 CNI 或 CSI。CNI 由运行时在创建 sandbox 时调用，CSI 由 kubelet 的 volume manager 调用；它们分别解决网络和存储，不通过 CRI 传递。

## 参考资料

- [Container Runtime Interface (CRI)](https://kubernetes.io/docs/concepts/architecture/cri/)
- [CRI v1 API proto (release-1.34)](https://github.com/kubernetes/cri-api/blob/release-1.34/pkg/apis/runtime/v1/api.proto)
- [Debugging Kubernetes nodes with crictl](https://kubernetes.io/docs/tasks/debug/debug-cluster/crictl/)
- [kubelet command-line reference](https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/)`,
    {
      versions: 'CRI v1 自 Kubernetes 1.23 Stable；kubelet 1.26+ 要求运行时支持 v1',
      docsUrl: 'https://kubernetes.io/docs/concepts/architecture/cri/',
      repoUrl: 'https://github.com/kubernetes/cri-api',
      version: 2,
      referenceLinks: [
        {
          label: 'CRI v1 API proto (release-1.34)',
          url: 'https://github.com/kubernetes/cri-api/blob/release-1.34/pkg/apis/runtime/v1/api.proto',
        },
        {
          label: 'Debugging Kubernetes nodes with crictl',
          url: 'https://kubernetes.io/docs/tasks/debug/debug-cluster/crictl/',
        },
        {
          label: 'kubelet command-line reference',
          url: 'https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/',
        },
      ],
    },
  ),
  d(
    'k8s-containerd',
    `## 技术定位

containerd 是 CNCF 毕业的容器运行时守护进程，负责镜像分发、内容存储、文件系统快照、容器任务和运行时调用。Kubernetes 通过 containerd 内置的 CRI 插件使用它：kubelet 调用 CRI，CRI 插件再调用 containerd 内部的 content store、snapshotter 和 runtime v2，最终由 runc 等 OCI 运行时创建容器进程。

containerd 不只是“runc 的包装”。它维护镜像内容的本地存储、层解包后的快照、容器元数据和任务生命周期；runc 只负责按 OCI spec 创建一次进程然后退出，真正长期托管容器的是 shim 进程。理解这层分工，才能解释为什么 containerd 重启通常不会杀死运行中的容器，以及为什么镜像、快照和 shim 会成为不同的故障面。

本文以 containerd 2.0 的版本化文档为准。1.x 的插件 ID、配置版本和 sandbox 镜像字段与 2.x 不同，不能把 2.x 的配置直接套到 1.x，反之亦然。

## 设计原理

containerd 的核心设计是解耦：镜像内容、文件系统快照、容器任务和底层 OCI 运行时分别由 content store、snapshotter、runtime v2/shim 和 runc 负责。守护进程只做编排和元数据管理，容器进程由独立 shim 托管。这样组件可以独立演进和替换，故障域也被切开——例如 containerd 重启不必杀死容器，某个 shim 崩溃也未必影响其他容器。

containerd 以守护进程方式运行，对外提供 gRPC 服务，内部由插件组成。与 Kubernetes 相关的主要部分包括：

- **CRI 插件**：实现 Kubernetes CRI。containerd 2.x 把它拆成两个插件 ID：\`io.containerd.cri.v1.runtime\` 负责 Pod sandbox、容器、CNI 和流式接口，\`io.containerd.cri.v1.images\` 负责镜像、仓库和 snapshotter。containerd 1.x 使用单一的 \`io.containerd.grpc.v1.cri\`。
- **Content Store**：按 digest 保存镜像 manifest、config 和 layer，内容不可变，天然支持去重和校验。
- **Snapshotter**：把镜像层解包成文件系统快照。默认通常是 overlayfs；它负责 committed snapshot 和容器可写的 active snapshot。
- **Runtime v2 与 shim**：containerd 为每个容器启动 \`containerd-shim-runc-v2\` 之类的 shim。shim 调用 runc 创建容器，runc 完成命名空间、cgroup 和进程启动后退出；shim 继续作为容器进程的父进程，管理 stdio、回收退出状态并向 containerd 报告。
- **OCI 运行时**：runc 按 OCI runtime spec 创建进程；gVisor、Kata 等可以通过不同的 runtime handler 接入。
- **CNI**：由 CRI 插件在创建 sandbox 时调用，使用 \`/etc/cni/net.d\` 中的配置和 \`/opt/cni/bin\` 中的插件。kubelet 不直接执行 CNI。

containerd 使用命名空间隔离不同客户端。Kubernetes 的镜像和容器位于 \`k8s.io\` 命名空间，因此用 \`ctr\` 查看时必须加 \`-n k8s.io\`，否则会看到空列表；\`crictl\` 则直接走 CRI，不需要手动指定该命名空间。

## 工作机制

### 镜像与容器数据流

拉取镜像时，containerd 先解析 registry 返回的 index 或 manifest，确定目标平台的 manifest，再把 config 和 layers 按 digest 写入 content store。随后 snapshotter 按顺序解包每一层，形成 committed snapshot；创建容器时再在其上建立可写的 active snapshot，作为容器 rootfs。

这个流程意味着镜像“拉取成功”不等于“可以启动”：内容可能已下载但解包失败，snapshotter 可能磁盘不足，或者镜像的 entrypoint 与安全上下文不兼容。排查时要把 pull、unpack 和 create/start 三个阶段分开看。

容器启动时，CRI 插件把 OCI bundle 交给 runtime v2，shim 调用 runc 创建进程。容器退出后，shim 保留退出状态，直到 containerd 或 kubelet 读取并清理。shim 崩溃会影响对应容器，但不会影响其他容器；containerd 守护进程重启时，已有 shim 和容器通常继续运行，只是 CRI 服务短暂不可用，kubelet 会重试。

镜像回收由 containerd 的垃圾回收机制完成，kubelet 通过 CRI 的 \`ImageFsInfo\` 和删除镜像请求参与决策。删除镜像只是移除引用，不代表 content 和 snapshot 立即释放；未被引用的内容要等 GC 运行后才回收。

## 关键配置与实践

### 配置与版本

containerd 的主配置通常位于 \`/etc/containerd/config.toml\`。containerd 2.0 引入配置版本 3：

~~~toml
version = 3

[plugins.'io.containerd.cri.v1.images']
  snapshotter = 'overlayfs'
  [plugins.'io.containerd.cri.v1.images'.pinned_images]
    sandbox = 'registry.k8s.io/pause:3.10'

[plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.runc]
  runtime_type = 'io.containerd.runc.v2'
  [plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.runc.options]
    SystemdCgroup = true
~~~

1.x 的配置版本为 2，插件 ID 为 \`io.containerd.grpc.v1.cri\`，sandbox 镜像字段为 \`sandbox_image\`。containerd 2.x 仍能读取版本 2 并自动转换为版本 3，但版本 1 已在 2.0 移除。升级前应备份配置并检查转换结果，而不是假定旧字段仍然生效。

几个容易出错的点：

- \`SystemdCgroup = true\` 必须与 kubelet 的 \`cgroupDriver: systemd\` 一致。两者不一致时，容器可能启动失败或资源限制行为异常。kubeadm 通常把两边都设为 systemd。
- \`pinned_images.sandbox\`（1.x 为 \`sandbox_image\`）必须能从节点访问的仓库拉取；离线环境要提前同步 pause 镜像。
- registry 的镜像、TLS 和认证通过 \`config_path\` 指向的 \`hosts.toml\` 配置，例如 \`/etc/containerd/certs.d/docker.io/hosts.toml\`。kubelet 传递的 imagePullSecrets 会作为 CRI 拉取凭证使用，但仓库地址和 TLS 仍由 containerd 配置决定。
- CRI socket 的默认路径通常是 \`/run/containerd/containerd.sock\`；kubelet 的 endpoint 必须指向实际路径。

## 常见问题与限制

### 运维与排查

常用检查命令：

~~~bash
systemctl status containerd
journalctl -u containerd --since "30 min ago"
containerd config dump
ctr plugins ls
ctr -n k8s.io images ls
ctr -n k8s.io containers ls
ctr -n k8s.io tasks ls
crictl info
~~~

\`ctr\` 是 containerd 原生客户端，适合看 content、snapshot 和插件状态；\`crictl\` 走 CRI，更接近 kubelet 的视角。两者看到的是同一份数据，但命名空间和接口不同。

containerd 的数据目录通常在 \`/var/lib/containerd\`，包含 content store 和各个 snapshotter 的快照。磁盘或 inode 耗尽时，镜像拉取、层解包和容器创建都会失败；应先确认是 content、snapshot 还是容器日志占用，再执行镜像回收或清理，不要直接删除数据目录。

升级 containerd 时建议先 cordon 并 drain 节点，停止 kubelet，备份配置，再升级并重启 containerd，确认 \`crictl info\` 的 RuntimeReady/NetworkReady 正常后再恢复 kubelet 和调度。仅重启 containerd 通常不会杀死运行中的容器，但会造成短暂的 CRI 不可用。

### 常见故障与排查

| 现象 | 常见原因 | 排查 |
|---|---|---|
| 节点无法注册或 CRI 连接失败 | socket 路径错误、containerd 未启动、CRI 插件未启用 | \`systemctl status containerd\`、\`crictl info\`、kubelet endpoint |
| Pod sandbox 创建失败 | sandbox 镜像拉取失败、CNI 配置缺失、网络插件未就绪 | containerd 日志、\`/etc/cni/net.d\`、pause 镜像 |
| 镜像拉取失败 | 仓库认证、TLS、限流、磁盘空间 | \`crictl pull\`、hosts.toml、节点磁盘 |
| 容器启动失败 | snapshotter 解包失败、cgroup 驱动不一致、权限或 seccomp 限制 | containerd/runc 日志、\`SystemdCgroup\`、安全上下文 |
| 磁盘持续增长 | 镜像和快照未回收、日志占用 | \`ctr -n k8s.io images ls\`、snapshot 用量、GC |
| shim 崩溃或容器异常退出 | 运行时缺陷、OOM、runc 配置错误 | \`crictl ps -a\`、shim 日志、内核日志 |
| 节点重启后容器未恢复 | kubelet 未启动、CRI 未就绪、状态目录损坏 | 启动顺序、\`crictl pods\`、containerd 数据目录 |

## 技术关联

containerd 通过 CRI 插件实现 CRI，kubelet 通过 CRI 调用它；它通过 runc 等 OCI 运行时实现容器创建，通过 CNI 配置 Pod 网络，通过 snapshotter 管理文件系统。它不直接访问 etcd，也不参与调度和 Service 转发。Pod 的网络命名空间由 sandbox 持有，CNI 由 CRI 插件调用；存储卷由 kubelet 通过 CSI 协调，不经过 containerd 的 snapshotter（除非是镜像层本身）。

## 参考资料

- [containerd CRI plugin architecture (release/2.0)](https://github.com/containerd/containerd/blob/release/2.0/docs/cri/architecture.md)
- [containerd CRI config guide (release/2.0)](https://github.com/containerd/containerd/blob/release/2.0/docs/cri/config.md)
- [containerd PLUGINS (release/2.0)](https://github.com/containerd/containerd/blob/release/2.0/docs/PLUGINS.md)
- [containerd Content Flow (release/2.0)](https://github.com/containerd/containerd/blob/release/2.0/docs/content-flow.md)
- [Containerd docs](https://containerd.io/docs/)`,
    {
      versions: 'containerd 2.0（配置版本 3）；1.x 使用配置版本 2 和 io.containerd.grpc.v1.cri',
      docsUrl: 'https://github.com/containerd/containerd/blob/release/2.0/docs/cri/config.md',
      repoUrl: 'https://github.com/containerd/containerd',
      version: 2,
      referenceLinks: [
        {
          label: 'containerd CRI architecture (release/2.0)',
          url: 'https://github.com/containerd/containerd/blob/release/2.0/docs/cri/architecture.md',
        },
        {
          label: 'containerd CRI config (release/2.0)',
          url: 'https://github.com/containerd/containerd/blob/release/2.0/docs/cri/config.md',
        },
        {
          label: 'containerd Content Flow (release/2.0)',
          url: 'https://github.com/containerd/containerd/blob/release/2.0/docs/content-flow.md',
        },
        {
          label: 'containerd PLUGINS (release/2.0)',
          url: 'https://github.com/containerd/containerd/blob/release/2.0/docs/PLUGINS.md',
        },
      ],
    },
  ),
  d(
    'k8s-pod',
    `## 技术定位

Pod 是 Kubernetes 中可被调度、部署和替换的最小工作负载单元。它不是“容器的别名”，而是围绕一组需要协同运行的容器建立的运行环境：同一个 Pod 内的容器共享网络命名空间、Pod IP、IPC 命名空间和 Pod 级存储卷，因此可以像同一台主机上的进程一样通过 localhost 通信。

Pod 在技术体系中的位置很特殊：调度器以 Pod 为单位选择节点，kubelet 以 Pod 为单位落实容器，Service 和 EndpointSlice 以 Pod 为后端，Deployment、StatefulSet、DaemonSet 和 Job 也都通过 Pod 模板描述最终运行形态。Pod 是工作负载对象与节点运行时之间的交接点。

Pod 解决的核心问题是“哪些容器必须一起调度、一起共享环境、一起被替换”。例如 Web 服务与日志收集边车、应用与本地缓存代理，需要共享网络和生命周期；把它们拆成独立 Pod 会失去 localhost 通信和共同调度的保证。反过来，不需要共享环境的组件不应强行塞进同一个 Pod，否则会放大故障域并让扩缩容失去独立性。

## 设计原理

### 为什么 Pod 是最小调度单位

调度器只处理 Pod，而不是单个容器。一个 Pod 中的所有容器一定落在同一个节点上，这是共享网络和卷的前提。Pod 在调度意义上是原子的，但在运行意义上并非原子：单个容器可能崩溃并由 kubelet 按 restartPolicy 重启，而其他容器继续运行。

### 共享网络

kubelet 首先通过 CRI 创建 Pod sandbox，常见实现会启动一个 pause 容器持有网络命名空间。随后业务容器和初始化容器加入该命名空间，因此它们共享同一个 IP 和端口空间。两个容器不能同时监听同一个端口；容器之间访问 localhost 时，实际访问的是同一个网络栈。

Pod IP 由 CNI 插件分配，并在 Pod 重建后变化。因此 Pod IP 不能作为稳定服务地址，稳定访问应通过 Service、Headless Service 或 StatefulSet 的稳定网络标识实现。

### 共享存储

卷定义在 Pod 级别，再由各个容器分别挂载。emptyDir 的生命周期跟随 Pod 而不是容器：容器重启后数据仍在，Pod 被删除后数据丢失。ConfigMap、Secret、PVC 等卷则由各自的后端决定持久性。多个容器可以挂载同一个卷并通过文件系统共享数据，但应用仍需自行处理并发写入和锁。

### 容器形态

- **普通容器**：Pod 的主要工作负载，并行启动。
- **Init Container**：按声明顺序串行执行，全部成功后才启动普通容器；适合初始化数据、等待依赖、修改权限。任一 Init Container 失败时，Pod 会按 restartPolicy 重试。
- **原生边车容器**：Kubernetes 1.29 进入 Beta、1.33 转为 Stable，通过 initContainers 中的 restartPolicy: Always 声明。它在普通容器之前启动，之后持续运行，并在 Pod 终止时晚于普通容器退出，解决了传统边车启动顺序和退出顺序不可控的问题。
- **Ephemeral Container**：通过调试接口临时加入运行中的 Pod，用于排障；不参与调度，也不支持探针和资源保证。

## 工作机制

### 创建流程

1. 客户端向 kube-apiserver 提交 Pod 或由控制器创建 Pod。
2. scheduler 观察到未绑定节点（nodeName 为空）的 Pod，完成过滤和打分后写入 Binding。
3. 目标节点的 kubelet 观察到 Pod，执行准入检查，调用 CRI 创建 sandbox。
4. CNI 为 sandbox 配置网络和 IP，CSI 或卷插件挂载存储。
5. kubelet 按顺序运行 Init Container，再启动普通容器。
6. kubelet 执行探针并把 Pod 状态、容器状态和条件上报到 apiserver。

### 生命周期与终止

Pod 的 phase 包括 Pending、Running、Succeeded、Failed 和 Unknown。phase 是 Pod 级摘要，不足以描述单个容器；容器还有 Waiting、Running 和 Terminated 三种状态。Pod conditions 中的 PodScheduled、Initialized、ContainersReady 和 Ready 更适合判断具体阶段。

删除 Pod 时，apiserver 先设置 deletionTimestamp。EndpointSlice 控制器会把该 Pod 标记为 terminating 或从就绪端点移除；kubelet 执行 preStop 钩子，然后向容器主进程发送 SIGTERM，等待 terminationGracePeriodSeconds，仍未退出则发送 SIGKILL。若容器以 PID 1 运行却不转发信号，SIGTERM 可能无效，最终只能等待强制杀死。

### 探针

- **readinessProbe**：失败时 Pod 从 Service 的就绪端点移除，但容器不重启；用于控制是否接收流量。
- **livenessProbe**：失败时 kubelet 重启容器；用于处理进程仍在但无法恢复的情况。
- **startupProbe**：启动成功前抑制 liveness 和 readiness 探针，适合启动时间较长的应用。

探针的 initialDelaySeconds、periodSeconds、timeoutSeconds、failureThreshold 和 successThreshold 会共同决定判定时间。探针过严会把正常启动或短暂抖动误判为故障，过松则会延长故障流量时间。

## 关键配置与实践

- **resources.requests**：调度器选择节点、kubelet 判断资源压力的基线；requests 过低会导致节点超卖，过高会浪费容量。
- **resources.limits**：限制容器可用资源；CPU 超限会被节流，内存超限通常触发 OOMKill。
- **QoS**：QoS 由 Pod 内所有容器的 CPU/内存 requests 与 limits 共同决定，不是单个容器的属性。Guaranteed 要求每个容器都同时设置 CPU 和内存的 request 与 limit，且两者相等、均大于 0；只设置内存或只设置 CPU、只有部分容器设置，都不满足 Guaranteed。不满足 Guaranteed、但至少有一个容器（或 Pod 级资源）设置了 CPU/内存 request 或 limit 时为 Burstable；所有容器都没有设置 CPU/内存 request 和 limit 时为 BestEffort。
- **Pod 级资源**：Kubernetes 1.34 起，\`spec.resources\` 允许在 Pod 层声明 CPU/内存的 requests 与 limits，由 Pod 内所有容器共享。Pod 级 requests 参与调度，Pod 级 limits 约束整个 Pod；同时存在容器级资源时，Pod 级资源优先影响调度与 QoS 判定。它适合容器之间难以静态拆分、但整体预算需要可控的场景（例如主容器与边车共享一个资源池）。该能力由 \`PodLevelResources\` 特性门控控制，1.34 进入 Beta 并默认启用；截至本文核对时仍为 Beta，不应假定所有 1.34+ 集群都已启用。
- **节点压力驱逐不是简单的 QoS 排序**：kubelet 依据“用量是否超过 requests”、Pod Priority 和超出 requests 的程度决定顺序。先驱逐用量超过 requests 的 BestEffort/Burstable Pod，按 Priority 和超出幅度排序；最后才驱逐 Guaranteed，以及用量未超过 requests 的 Burstable Pod，同样按 Priority 排序。Guaranteed 只是最不容易因其他 Pod 消耗资源而被驱逐，并非免疫：当系统守护进程消耗超过预留、节点必须回收资源时，Guaranteed Pod 仍可能被驱逐。QoS 是资源配置的分类结果，不是容量规划、限流或可用性保证；真正的资源保障需要准确的 requests/limits、PriorityClass、PDB 和节点预留共同配合。
- **terminationGracePeriodSeconds**：应覆盖应用处理未完成请求的最长时间；preStop 的执行时间也计入该窗口。
- **serviceAccountName**：决定 Pod 访问 API 的身份，应按最小权限配置。
- **securityContext**：可设置运行用户、只读根文件系统、能力集和 seccomp 等；Pod 级配置可被容器级覆盖。

生产环境通常不直接创建裸 Pod，而是通过 Deployment、StatefulSet、DaemonSet 或 Job 管理。裸 Pod 缺少副本维持、滚动更新和自愈能力，节点故障后也不会自动重建。

## 常见问题与限制

- **把 Pod 当成稳定主机**：Pod 重建后 IP、名称（除非由 StatefulSet 管理）和所在节点都可能变化。
- **探针配置错误**：readiness 过严导致“有 Pod 但没流量”；liveness 过严导致反复重启；startup 缺失导致慢启动应用被提前杀死。
- **忽略 PID 1 信号处理**：应用不处理 SIGTERM 时会一直等到宽限期结束，造成发布或缩容变慢。
- **端口冲突**：同一 Pod 内共享网络命名空间，多个容器不能监听同一端口。
- **hostNetwork 的副作用**：使用宿主机网络后 Pod 没有独立 IP，端口直接占用节点端口，调度和隔离假设都会改变。
- **emptyDir 被误当持久存储**：Pod 删除后数据消失；需要持久化时应使用 PVC。
- **缺少 requests**：调度器无法准确放置 Pod，QoS 也会下降，节点压力时更易被驱逐。

## 技术关联

Pod 由 ReplicaSet 维持副本，Deployment 通过 ReplicaSet 管理无状态 Pod，StatefulSet 提供稳定序号和存储，DaemonSet 在每个节点运行一个 Pod，Job 和 CronJob 管理批处理任务。Service 通过标签选择就绪 Pod，EndpointSlice 保存后端地址。kubelet 通过 CRI 创建 sandbox 和容器，通过 CNI 配置网络，通过 CSI 挂载存储。scheduler 决定 Pod 落在哪个节点，controller-manager 中的控制器决定创建多少 Pod、何时替换 Pod。

## 参考资料

- [Pods](https://kubernetes.io/docs/concepts/workloads/pods/)
- [Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- [Sidecar Containers](https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/)
- [Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Pod Quality of Service Classes](https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/)
- [Assign Pod-level CPU and memory resources](https://kubernetes.io/docs/tasks/configure-pod-container/assign-pod-level-resources/)
- [Node-pressure Eviction](https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/)`,
    {
      versions: 'Kubernetes 1.28+；原生边车容器 1.29 Beta、1.33 Stable；Pod 级资源 1.34 Beta',
      docsUrl: 'https://kubernetes.io/docs/concepts/workloads/pods/',
      version: 3,
      replacesContentHash: '843eacb1a5e965fc554c842bc724ea8282dd9533b9ef68661787c474a8224b6c',
      referenceLinks: [
        { label: 'Pod Lifecycle', url: 'https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/' },
        { label: 'Sidecar Containers', url: 'https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/' },
        {
          label: 'Liveness, Readiness and Startup Probes',
          url: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/',
        },
        { label: 'Pod QoS Classes', url: 'https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/' },
        {
          label: 'Pod-level CPU and Memory Resources',
          url: 'https://kubernetes.io/docs/tasks/configure-pod-container/assign-pod-level-resources/',
        },
        {
          label: 'Node-pressure Eviction',
          url: 'https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/',
        },
      ],
    },
  ),
  d(
    'k8s-deployment',
    `## 技术定位

Deployment 是 Kubernetes 管理无状态应用的标准工作负载控制器。它声明“期望运行多少个 Pod、Pod 长什么样、升级时如何替换”，并把副本维持和滚动发布交给 ReplicaSet 执行。Deployment 不直接管理 Pod，而是管理 ReplicaSet；每个 Pod 模板版本通常对应一个 ReplicaSet，Pod 则带有 pod-template-hash 标签以标明归属。

它适合可以任意替换副本、实例之间不保存本地状态的业务，例如无状态 Web 服务、API 网关和内部微服务。需要稳定网络标识或每副本独立存储时应使用 StatefulSet；需要在每个节点运行一份时应使用 DaemonSet；需要一次性任务时应使用 Job 或 CronJob。

## 设计原理

### 三层对象关系

Deployment → ReplicaSet → Pod 是理解滚动更新的关键。Deployment 保存期望状态和发布策略，ReplicaSet 负责把当前副本数调整到期望值，Pod 才是实际运行单元。每次修改 Pod 模板都会生成新的 ReplicaSet；旧 ReplicaSet 通常缩容到 0 但保留在历史中，以便回滚。

Pod 模板的哈希会写入 pod-template-hash 标签，并附加到 ReplicaSet 的 selector 和 Pod 标签上。这样即使多个 ReplicaSet 的 Pod 具有相同的业务标签，也能通过哈希区分归属，避免旧 ReplicaSet 误删新 Pod。

### 滚动更新

RollingUpdate 通过 maxSurge 和 maxUnavailable 控制节奏：

- **maxSurge**：允许超出期望副本数的 Pod 数量，可以是整数或百分比。
- **maxUnavailable**：更新过程中允许不可用的 Pod 数量，可以是整数或百分比。

两者不能同时为 0，否则无法推进。默认值都是 25%。maxSurge 越大，发布越快但资源峰值越高；maxUnavailable 越大，发布越快但容量下降越明显。关键服务通常设置 maxUnavailable: 0，并保留一定 maxSurge，同时用 PodDisruptionBudget 约束自愿中断。

Recreate 策略会先删除全部旧 Pod，再创建新 Pod，适用于不能同时运行两个版本的场景，但必然产生停机。

### 进度与可用性

Deployment 通过 conditions 暴露状态。Progressing 表示控制器是否在推进发布；Available 表示可用副本是否达到期望。progressDeadlineSeconds 默认 600 秒，超过该时间没有进展时 Progressing 会变为 False，reason 为 ProgressDeadlineExceeded。这个超时只报告问题，不会自动回滚；需要人工检查并执行 rollout undo。

minReadySeconds 要求新 Pod 在就绪后继续稳定运行一段时间才计入可用，能减少“刚就绪就崩溃”被误判为成功的情况。observedGeneration 用于判断控制器是否已经处理了最新一次 spec 变更。

## 工作机制

### 创建与扩缩容

1. Deployment 控制器计算当前 Pod 模板的哈希，查找对应的 ReplicaSet。
2. 若不存在，则创建新 ReplicaSet，并写入 revision 注解。
3. ReplicaSet 控制器根据 selector 统计 Pod，创建或删除 Pod 以达到 replicas。
4. 新 Pod 通过调度、拉镜像、启动容器和 readinessProbe 后就绪。
5. Deployment 根据就绪数量继续调整新旧 ReplicaSet 的副本数，直到旧副本为 0。

扩缩容只修改 replicas 时通常不会创建新 ReplicaSet；HPA 也是通过修改 Deployment 的 replicas 来工作。若同时修改副本数和模板，控制器会先按新模板推进发布，再调整规模。

### 更新与回滚

修改 Pod 模板中的镜像、环境变量、资源或标签都会触发新 ReplicaSet。仅修改 replicas、minReadySeconds 或策略字段不一定产生新修订。镜像标签不变但实际 digest 变化时，Pod 模板文本没有变化，因此不会自动触发发布；应使用不可变标签、显式 digest，或执行 rollout restart 触发模板注解变化。

回滚通过 rollout undo 切换到历史 ReplicaSet。回滚本身会生成新的修订记录，而不是删除当前修订。revisionHistoryLimit 默认保留 10 个旧 ReplicaSet；设置过小会导致无法回滚到更早版本，设置过大则会保留大量已缩容对象。

### 暂停与恢复

paused: true 可以暂停发布，使多次模板修改合并为一次滚动；恢复后控制器按最新模板推进。暂停期间扩缩容仍可生效，但新修订不会立即展开。该能力适合批量调整配置，不能替代发布审批。

## 关键配置与实践

- **selector**：必须匹配 template.metadata.labels，且创建后不可修改。多个 Deployment 的 selector 不应重叠，否则会争抢同一批 Pod。
- **readinessProbe**：滚动更新以 Pod 就绪为前提。探针缺失或过松会让未真正可用的实例提前接收流量。
- **minReadySeconds**：给新 Pod 一段稳定观察期，避免瞬时就绪被计入可用。
- **strategy**：无状态在线服务通常使用 RollingUpdate；必须独占版本的场景才使用 Recreate。
- **revisionHistoryLimit**：根据回滚窗口设置，不要为了“干净”设为 0。
- **progressDeadlineSeconds**：应大于应用最慢启动时间与探针判定时间之和，否则会把正常慢启动误报为失败。
- **PDB**：限制节点维护或驱逐时的自愿中断，但它不能阻止滚动更新本身；Deployment 的 maxUnavailable 与 PDB 需要一起评估。

## 常见问题与限制

- **发布卡住**：新 Pod 无法调度、镜像拉取失败、readinessProbe 一直失败或配额不足都会让旧副本无法继续缩减。应先看 Deployment conditions、ReplicaSet 事件和 Pod 状态。
- **误以为超时会自动回滚**：progressDeadlineSeconds 只标记失败，不会自动恢复旧版本。
- **selector 冲突**：手工创建的 Pod 或其他控制器管理的 Pod 若带有相同标签，可能被 ReplicaSet 计入或删除。
- **滚动更新没有真正发生**：只改了相同镜像标签，Pod 模板未变化；需要使用 digest、不可变标签或 rollout restart。
- **容量规划错误**：maxSurge 会临时增加 Pod 数量，节点资源和配额必须能容纳峰值。
- **把有状态服务放进 Deployment**：副本之间共享身份或本地数据时会出问题，应使用 StatefulSet。
- **忽略终止过程**：滚动更新会删除旧 Pod，应用若不处理 SIGTERM，会拖长发布并造成请求失败。
- **回滚不等于数据回滚**：Deployment 只能回滚 Pod 模板，数据库迁移和外部配置变更需要单独处理。

## 技术关联

Deployment 由 kube-controller-manager 中的 Deployment 控制器驱动，后者创建并管理 ReplicaSet；ReplicaSet 再创建 Pod。Service 通过标签选择 Deployment 创建的 Pod，EndpointSlice 记录就绪后端。HPA 修改 Deployment 的副本数，PDB 约束驱逐时的可用副本。scheduler 为每个新 Pod 选择节点，kubelet 负责实际运行。Ingress 或 Gateway 通常把流量转发到 Service，而不是直接指向 Deployment。

## 参考资料

- [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [ReplicaSet](https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/)
- [Specifying a Disruption Budget for your Application](https://kubernetes.io/docs/tasks/run-application/configure-pdb/)
- [Horizontal Pod Autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/)`,
    {
      versions: 'Kubernetes 1.28+',
      docsUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/',
      version: 2,
      replacesContentHash: '3784a8b6a3b9d237979eb5b1b416b80ca90c343ea4154ac19ccfab826c8ad6fb',
      referenceLinks: [
        { label: 'ReplicaSet', url: 'https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/' },
        { label: 'PodDisruptionBudget', url: 'https://kubernetes.io/docs/tasks/run-application/configure-pdb/' },
        {
          label: 'Horizontal Pod Autoscaling',
          url: 'https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/',
        },
      ],
    },
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
    `## 技术定位

Service 为一组 Pod 提供稳定的虚拟 IP、DNS 名称和端口，是 Kubernetes 服务发现与四层负载均衡的抽象层。Pod 会因发布、驱逐或节点故障而重建，IP 随之变化；调用方不应直接依赖 Pod IP。Service 用标签选择后端，并把稳定地址与不断变化的 Pod 集合解耦。

Service 位于 Pod 与上层入口之间：集群内客户端通过 ClusterIP 或 DNS 访问 Service，集群外流量可通过 NodePort 或 LoadBalancer 进入，七层流量则通常由 Ingress 或 Gateway 转发到 Service。Service 本身不运行代理进程，数据面由 kube-proxy、eBPF CNI 或云负载均衡器实现。

## 设计原理

### 虚拟 IP 与数据面

ClusterIP 是分配自 Service CIDR 的虚拟地址，通常不绑定到任何网卡，因此不能像普通主机地址那样直接 ping 通。访问 ClusterIP 时，节点上的转发规则会把连接重定向到某个后端 Pod。常见实现包括 iptables、IPVS 和 eBPF；它们监听 Service 与 EndpointSlice 的变化并更新数据面。

kube-proxy 是常见实现之一，但并非唯一实现。使用 eBPF 数据面的 CNI 可以在内核中直接完成 Service 转发，从而替代 kube-proxy。理解这一点很重要：Service 是 API 对象和转发语义，kube-proxy 只是可选的数据面实现。

### EndpointSlice 与端点状态

EndpointSlice 控制器根据 Service 的 selector 选出 Pod，并把符合条件的后端写入 EndpointSlice。切片中保存的是“被 selector 选中的端点”，并不等于“全部 ready 的端点”：未就绪的 Pod 仍可能出现在切片里，只是 condition 不同。每个端点记录 addresses、ports、nodeName、zone 等地址、端口和拓扑信息，并通过 kubernetes.io/service-name 标签关联 Service。默认每个切片最多包含 100 个端点，分片降低了大规模集群的更新和 watch 压力。

每个端点带有三个 condition：

- **serving**：端点当前正在提供服务；对 Pod 后端而言，它对应 Pod 的 Ready condition。
- **terminating**：Pod 已收到删除时间戳，正在终止，通常早于容器真正退出。
- **ready**：本质上是“serving 且未 terminating”的快捷判断；当 Service 设置 \`publishNotReadyAddresses: true\` 时，ready 还会恒为 true。

因此，“Pod 通过 readinessProbe”并不等于 EndpointSlice 端点立刻 ready。Pod 的 Ready condition 还取决于所有普通容器的就绪状态（配置了 readinessProbe 的容器需要探针成功，未配置的容器运行即视为就绪）、readinessGates 中声明的自定义条件等；任一条件不满足，Pod 就不会 Ready，端点也不会 ready。readinessProbe 只是影响容器就绪的因素之一。

默认数据面只把 ready 端点作为转发目标。正在终止但仍 serving 的端点通常会被忽略；当所有可用端点都在终止时，部分数据面仍可能继续向 serving 且 terminating 的端点转发，以减少滚动更新期间的连接中断。\`publishNotReadyAddresses: true\` 会把未就绪地址也发布出去，常用于 Headless Service 的成员发现，但不代表这些端点可以安全接收业务流量。

### 服务类型

- **ClusterIP**：默认类型，仅集群内可访问，获得虚拟 IP 和 DNS 名称。
- **NodePort**：在每个节点上分配一个端口，把该端口流量转发到 Service；端口范围默认 30000–32767。
- **LoadBalancer**：在 NodePort 基础上请求外部负载均衡器，具体行为由云厂商或控制器实现。
- **ExternalName**：不分配 ClusterIP，通过 DNS CNAME 指向外部域名，仅做名称映射。

clusterIP: None 创建 Headless Service，不分配虚拟 IP。DNS 直接返回后端 Pod 地址，客户端自行选择连接哪一个，适合 StatefulSet 成员发现和需要自定义负载均衡的场景。

### 流量策略

- **internalTrafficPolicy**：控制集群内流量是否只转发到本节点 Pod。Local 可减少跨节点跳转，但本节点没有后端时连接会失败。
- **externalTrafficPolicy**：控制 NodePort 和 LoadBalancer 流量的节点范围。Cluster 允许任意节点转发，通常会发生源地址 SNAT；Local 只转发到本节点 Pod，可保留客户端源 IP，但需要外部负载均衡器把流量送到有后端的节点。

## 工作机制

### 创建与端点维护

1. 创建 Service 后，控制器分配 ClusterIP（Headless 除外）。
2. EndpointSlice 控制器监听 Service 与 Pod，按 selector 计算被选中的后端集合。
3. 控制器把端点写入 EndpointSlice，并根据 Pod 的 Ready condition 与删除状态维护 serving、terminating、ready。
4. 数据面组件监听 EndpointSlice 变化，只把 ready 端点加入转发规则。
5. CoreDNS 根据 Service 生成 DNS 记录，集群内可通过名称访问。

Service 没有 selector 时不会自动生成 EndpointSlice，需要手工维护 Endpoints 或 EndpointSlice，或由 Operator 管理。选择器与 Pod 标签不一致时，端点集合为空，连接会失败而不是自动回退。

### DNS 与 Headless

普通 Service 的 DNS 名称形如 web.default.svc.cluster.local，解析到 ClusterIP。Headless Service 解析到一组 Pod IP；当端口有名称时，还会生成 SRV 记录。StatefulSet 的每个 Pod 还可通过 pod-name.service-name 形式的稳定域名访问。

客户端对 Headless Service 的地址列表通常需要自行做健康检查和负载均衡。DNS 缓存、连接池和长连接会让 Pod 变更不能立即反映到客户端，因此 Headless 并不等于自动高可用。

### 端口与协议

port 是 Service 暴露的端口，targetPort 是后端容器端口，默认与 port 相同。多端口 Service 必须为每个端口命名，名称用于 DNS SRV 记录和避免歧义。协议默认 TCP，也支持 UDP 和 SCTP。appProtocol 可提示上层实现使用 HTTP、gRPC 等应用层协议，但 Service 本身仍按四层转发。

sessionAffinity: ClientIP 可以把同一客户端 IP 的请求固定到同一后端，默认超时 10800 秒。它依赖源 IP，经过 NAT 或代理后可能失效，也不适用于需要真正会话状态的场景。

## 关键配置与实践

- **selector 与 Pod 标签保持一致**：这是“Service 存在但没有后端”的最常见原因。
- **正确配置 readinessProbe**：未就绪 Pod 不会进入转发集合；探针过松会让故障实例继续接收流量。
- **targetPort 使用命名端口**：容器端口变更时只需改 Pod 模板，Service 无需同步修改。
- **避免 ClusterIP 被当作真实主机**：不要对 ClusterIP 做 ICMP 健康检查，也不要假设它能被外部直接路由。
- **长连接与滚动更新**：Service 只在建立连接时选择后端，长连接不会因 Pod 终止自动迁移；应用需要处理连接断开和重连。
- **NodePort/LoadBalancer 的源 IP**：需要保留客户端 IP 时评估 externalTrafficPolicy: Local 及外部负载均衡器的健康检查配置。
- **PDB 与端点移除**：Pod 进入终止流程后会从就绪端点移除，但已有连接仍可能短暂存在，应用应配合优雅终止。

## 常见问题与限制

- **EndpointSlice 为空**：selector 与 Pod 标签不匹配、命名空间不一致，或 Service 没有 selector 且未手工维护端点；Pod 未就绪不会让切片变空，而是让端点 ready=false。
- **有 Pod 但没流量**：Pod 未 Ready、readinessProbe 失败、readinessGates 未满足、端口名不匹配或 NetworkPolicy 阻断了流量。
- **连接被拒绝**：targetPort 与实际监听端口不一致，或后端只监听 127.0.0.1。
- **Headless 被误解为负载均衡**：Headless 只返回地址列表，不提供虚拟 IP 和自动选路。
- **会话保持不可靠**：ClientIP 亲和依赖源地址，经过 NAT、Ingress 或服务网格后可能失效。
- **LoadBalancer 行为不一致**：地址分配、健康检查、跨可用区流量和源 IP 保留都取决于具体实现。
- **ClusterIP 不可 ping**：虚拟 IP 由转发规则实现，ICMP 行为依数据面而异，不能作为可用性判断依据。
- **Service 不是七层代理**：路径路由、TLS 终止、灰度发布应使用 Ingress、Gateway API 或服务网格。

## 技术关联

Pod 是 Service 的后端，Service 通过 selector 选择就绪 Pod。EndpointSlice 保存后端地址和端口，是数据面的实际上游数据。kube-proxy 或 eBPF CNI 实现 ClusterIP、NodePort 等转发语义；CoreDNS 提供 Service 域名解析。Ingress 和 Gateway 提供七层入口并转发到 Service。NetworkPolicy 决定哪些 Pod 可以访问 Service。Deployment、StatefulSet 和 DaemonSet 创建的 Pod 都可以成为 Service 后端。

## 参考资料

- [Service](https://kubernetes.io/docs/concepts/services-networking/service/)
- [EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/)
- [EndpointSlice API reference](https://kubernetes.io/docs/reference/kubernetes-api/service-resources/endpoint-slice-v1/)
- [DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/)
- [Virtual IPs and Service Proxies](https://kubernetes.io/docs/reference/networking/virtual-ips/)`,
    {
      versions: 'Kubernetes 1.28+',
      docsUrl: 'https://kubernetes.io/docs/concepts/services-networking/service/',
      version: 3,
      replacesContentHash: '7545b630d27792ac92b14fa12ddf7c4a7b1896d81676255c833ff658e0f554df',
      referenceLinks: [
        {
          label: 'EndpointSlices',
          url: 'https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/',
        },
        {
          label: 'EndpointSlice API Reference',
          url: 'https://kubernetes.io/docs/reference/kubernetes-api/service-resources/endpoint-slice-v1/',
        },
        {
          label: 'DNS for Services and Pods',
          url: 'https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/',
        },
        {
          label: 'Virtual IPs and Service Proxies',
          url: 'https://kubernetes.io/docs/reference/networking/virtual-ips/',
        },
      ],
    },
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
