# P5.4 第一批技术知识治理验收记录

日期：2026-10-31  
范围：Kubernetes 领域的五个质量样本节点  
依据：[技术知识质量标准](./technical-knowledge-standard.md)

## 1. 本批范围

| 节点 ID | 名称 | 等级 | 内容版本 |
| --- | --- | --- | --- |
| `k8s-pod` | Pod | L3 | 2 |
| `k8s-deployment` | Deployment | L3 | 2 |
| `k8s-service` | Service | L3 | 2 |
| `k8s-scheduler` | kube-scheduler | L3 | 2 |
| `k8s-controller-manager` | kube-controller-manager | L3 | 2 |

本批仅处理以上五个节点。其余 Kubernetes 与 Prometheus 节点保持原内容，未批量重写。

## 2. 官方来源核对

核对时间：2026-10-31。以下链接均返回 HTTP 200，主题与引用内容匹配。

| 文档 | 官方来源 | 核对要点 |
| --- | --- | --- |
| Pod | https://kubernetes.io/docs/concepts/workloads/pods/ | Pod 是最小调度单元；容器共享网络命名空间与卷 |
| Pod | https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/ | phase、容器状态、conditions、终止流程 |
| Pod | https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/ | 原生边车 1.29 Beta、1.33 Stable；启动与退出顺序 |
| Pod | https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/ | 三类探针的失败语义 |
| Pod | https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/ | Guaranteed / Burstable / BestEffort 判定 |
| Deployment | https://kubernetes.io/docs/concepts/workloads/controllers/deployment/ | Deployment→ReplicaSet→Pod；滚动更新与回滚 |
| Deployment | https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/ | ReplicaSet 的副本维持与 pod-template-hash |
| Deployment | https://kubernetes.io/docs/tasks/run-application/configure-pdb/ | PDB 约束自愿中断，不是滚动更新的硬门槛 |
| Deployment | https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/ | HPA 通过修改工作负载副本数工作 |
| Service | https://kubernetes.io/docs/concepts/services-networking/service/ | 四种 Service 类型、虚拟 IP、Headless、流量策略 |
| Service | https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/ | EndpointSlice 分片、conditions、就绪端点 |
| Service | https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/ | Service DNS 与 Headless 记录 |
| Service | https://kubernetes.io/docs/reference/networking/virtual-ips/ | Service 转发由数据面实现，kube-proxy 不是唯一实现 |
| Scheduler | https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/ | 调度队列、过滤与打分、绑定 |
| Scheduler | https://kubernetes.io/docs/concepts/scheduling-eviction/scheduling-framework/ | PreEnqueue 至 PostBind 的完整扩展点 |
| Scheduler | https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/ | 节点亲和、Pod 亲和与反亲和、拓扑分布 |
| Scheduler | https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/ | 抢占流程、nominated node、PDB 非硬约束 |
| Scheduler | https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/ | NoSchedule / PreferNoSchedule / NoExecute |
| Controller Manager | https://kubernetes.io/docs/concepts/overview/components/#kube-controller-manager | 内置控制器集合与控制面位置 |
| Controller Manager | https://kubernetes.io/docs/concepts/architecture/controller/ | 声明式控制循环、期望状态与幂等调和 |
| Controller Manager | https://kubernetes.io/docs/concepts/architecture/leases/ | Leader election 使用 Lease |
| Controller Manager | https://kubernetes.io/docs/concepts/architecture/garbage-collection/ | ownerReference 与级联删除 |

### 本批修正或强化的关键事实

- **Pod**：补充 sandbox 与共享网络命名空间的机制；明确原生边车的版本边界（1.29 Beta、1.33 Stable）；区分 readiness 与 liveness 的失败后果；补充 QoS 判定和驱逐顺序。
- **Deployment**：明确 Deployment 不直接管理 Pod，而是管理 ReplicaSet；补充 pod-template-hash、progressDeadlineSeconds 不自动回滚、相同镜像标签不触发新修订、minReadySeconds 与 PDB 的边界。
- **Service**：明确 ClusterIP 是虚拟地址且通常不可 ping；kube-proxy 只是可选数据面，eBPF CNI 可以替代；补充 EndpointSlice conditions、Headless 的客户端责任、externalTrafficPolicy 的源 IP 取舍。
- **Scheduler**：补齐调度队列和调度框架全部阶段；明确调度依据 requests 与 Pod overhead，而不是实时使用率；说明抢占不保证成功且 PDB 不是硬约束。
- **Controller Manager**：补充 informer 本地缓存、workqueue 去重/退避、Lease leader election、ownerReference 三种删除传播策略，以及 apiserver 限流和 webhook 阻塞的故障表现。

## 3. 内容修订与迁移记录

### 3.1 文档版本

所有五个节点从内容版本 1 升到 2。适用版本从通用表述改为具体边界：

- Pod：`Kubernetes 1.28+；原生边车容器 1.29 Beta、1.33 Stable`
- Deployment / Service / Scheduler / Controller Manager：`Kubernetes 1.28+`

### 3.2 旧内容哈希门控

Seed 只会在以下条件同时成立时替换文档：

1. 库中 Markdown 的 SHA-256 等于下表的“旧内容哈希”；
2. `content_status` 仍为 `draft`；
3. `content_verified_at` 为空。

| 节点 | 旧内容哈希（SHA-256） | 新内容哈希（SHA-256） | 新正文长度 |
| --- | --- | --- | --- |
| `k8s-pod` | `5e911f0e59c21e80cd187baf2ce022fc4c27e36b0b232c361cd1fb0277568e84` | `843eacb1a5e965fc554c842bc724ea8282dd9533b9ef68661787c474a8224b6c` | 4322 |
| `k8s-deployment` | `3784a8b6a3b9d237979eb5b1b416b80ca90c343ea4154ac19ccfab826c8ad6fb` | `67c82aebca8355ae1b3fdeec1cd8d29d2be0610c170dea402489824c0b2967bf` | 3965 |
| `k8s-service` | `f543df9d2761736fabe6dc64131dd18c4c91432f6b7fc9b824a0ef71b2fda409` | `7545b630d27792ac92b14fa12ddf7c4a7b1896d81676255c833ff658e0f554df` | 4325 |
| `k8s-scheduler` | `d1a3218423d6d34ae7bac29720a9f7099a7bf8e0cae921555392ea83f3483b4c` | `ed02356a1fd408738f5af436df9443889b59b55ac0a6e4d4372013f70518ee1f` | 4082 |
| `k8s-controller-manager` | `bfe324197d60767d85104185dd2425174f38fc93a3085828b238f6ca8a6cc78a` | `ce3ab274301190eebed9f72c8982ba291803f45e0d7790baa4e8141901bbf793` | 4167 |

结果：

- 未改动、未验证的旧 Seed 文档会被升级为版本 2。
- 用户编辑过的文档哈希不匹配，不会被替换。
- 已标记 `complete` 或已有验证时间的文档不会被替换，即使哈希恰好匹配。
- 用户已有 `applicableVersions` 不会被覆盖；只有空值或允许替换的 Seed 文档会更新。
- 文档已有的 `referenceLinks` 不会被清空；只在为空时补齐。
- 不删除节点、软件、笔记、视图或关系。

## 4. 关系修正记录

本批只修改四个关系相关项，其余关系全部保留。

| 关系 ID | 变更 | 依据 |
| --- | --- | --- |
| `rel-k8s-service-proxy` | `depends_on` → `related` | Service 是 API 与转发语义；kube-proxy 只是常见数据面实现，eBPF CNI 可替代。Service 对象本身不依赖 kube-proxy 进程存在。 |
| `rel-k8s-service-pod` | 新增 `related` | Service 通过 selector 选择就绪 Pod，EndpointSlice 维护后端地址。 |
| `rel-k8s-cm-deploy` | 新增 `related` | Deployment 控制器运行在 kube-controller-manager 中，通过 ReplicaSet 调和副本。 |
| `rel-k8s-cm-api` | 新增 `depends_on` | controller-manager 只通过 API Server 读写集群状态，不直接访问 etcd。 |

迁移实现：

- 新增关系使用固定 ID 和 `ON CONFLICT(id) DO NOTHING`，重复启动不会重复创建。
- 类型修正只匹配 `id`、`source_node_id`、`target_node_id`、旧 `relation_type` 全部一致的记录。
- 用户删除、重建或改成其他类型的关系不会被覆盖。
- 只在描述为空时补写依据，不覆盖用户已有描述。
- 不删除任何关系行。

已通过测试验证：模拟旧库中将 `rel-k8s-service-proxy` 还原为 `depends_on` 后，迁移改为 `related`；将同一关系改为 `alternative` 后，迁移返回 0 并保留用户类型与说明。

## 5. 内容状态与验证行为

本批同时修复了绕过“验证”直接标记已完善的路径：

- 创建节点时提交 `contentStatus: complete` → 拒绝。
- 普通 PATCH 提交 `contentStatus: complete` → 拒绝。
- 普通 PATCH 提交 `verifiedVersion` → 拒绝。
- Verify 缺少正文 → 拒绝。
- Verify 缺少版本或版本为空白 → 拒绝。
- Verify 成功 → 写入 `contentVerifiedAt` 与 `verifiedVersion`，正文不变。
- 编辑已完善文档正文 → 状态降级为 `draft`，上一次验证时间和版本保留为历史。
- 前端状态下拉框不再提供可选的“已完善”；当前为已完善时显示为不可选状态，并提示通过“验证知识”维护。
- 编辑器的验证版本输入独立于普通保存：修改该输入不会产生文档脏状态，也不会被 PATCH 提交。

## 6. 自动化验证结果

在临时测试数据库中执行，未接触用户实际数据目录。

| 命令 | 结果 |
| --- | --- |
| `npm run test` | 10 个测试文件、118 个测试全部通过 |
| `npm run build` | TypeScript 检查通过，Vite 构建通过 |
| `npm run build:server` | 通过 |
| `npm run build:docker` | 通过 |

构建仅有既有的“部分 chunk 大于 500 kB”提示，不影响产物生成。

新增或调整的测试覆盖：

- 普通创建/更新不能设置 `complete`。
- 普通 PATCH 不能写验证版本。
- Verify 必须有正文和版本。
- Verify 记录版本与时间且不修改正文。
- 编辑已完善文档降级为草稿并保留历史记录。
- Seed 不覆盖用户 Markdown、技术角色和适用版本。
- 哈希门控只替换未改动的旧草稿；用户编辑、已验证、待复核的文档均不替换。
- P5.4 关系存在且类型正确。
- 关系迁移只修正精确旧记录，保留用户修改。

## 7. 第一批验收结论

| 验收项 | 结论 |
| --- | --- |
| 五个样本文档达到 L3 深度 | 通过（正文 3965–4325 字符） |
| 固定章节结构完整 | 通过 |
| 官方来源可访问且主题匹配 | 通过（22 个链接，HTTP 200） |
| 适用版本和版本边界明确 | 通过 |
| 标题、可读性、术语一致性 | 通过 |
| 关系有依据且无重复 | 通过 |
| 用户内容不被 Seed 覆盖 | 通过（哈希门控 + 现有测试） |
| 不能绕过 Verify 设置已完善 | 通过（前后端双重约束） |
| 数据迁移可追溯、向前兼容 | 通过（哈希表 + 精确关系迁移） |
| 测试与构建 | 通过 |

结论：第一批满足验收条件，可以进入人工阅读复核。人工复核通过后，第二批再按同一标准推广；在复核完成前不批量重写其余节点。
