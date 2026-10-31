# P5.4.1 阶段 A 验收记录：样板定稿

日期：2026-10-31  
范围：P5.4 第一批五个 Kubernetes 样本文档的定稿、编辑器保存/丢弃竞争修复、CRI/containerd 关系方向修正  
依据：[技术知识质量标准](../p5.4/technical-knowledge-standard.md)

## 1. 本阶段范围

| 节点 | 本阶段动作 | 内容版本 | 新正文长度 |
| --- | --- | --- | --- |
| `k8s-pod` | 修正 QoS、Pod 级资源与节点压力驱逐 | 3 | 5450 |
| `k8s-service` | 修正 EndpointSlice 端点语义与 Pod Ready 依赖 | 3 | 5172 |
| `k8s-scheduler` | 补充重新入队与 QueueingHint | 3 | 4885 |
| `k8s-deployment` | 最终复核，无需修改 | 2 | 3965 |
| `k8s-controller-manager` | 最终复核，无需修改 | 2 | 4167 |

本阶段未重写第一批之外的 Kubernetes 文档，未新增业务模块、导航、审核流程、AI 生成能力或数据库表。

## 2. 内容修正与官方依据

核对时间：2026-10-31。以下链接均返回 HTTP 200，主题与引用内容匹配。

| 主题 | 官方来源 | 核对结论 |
| --- | --- | --- |
| QoS 判定 | https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/ | Guaranteed 要求每个容器同时设置 CPU/内存 request 与 limit，且各自相等、大于 0；并非“所有容器设置 requests 且等于 limits”这一简化表述 |
| Pod 级资源 | https://kubernetes.io/docs/tasks/configure-pod-container/assign-pod-level-resources/ | 1.34 进入 Beta 并默认启用；`PodLevelResources` 截至核对时仍为 Beta；Pod 级 requests/limits 优先影响调度与 QoS |
| 节点压力驱逐 | https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/ | kubelet 不以 QoS 类直接排序；先看用量是否超过 requests，再看 Pod Priority 与超出幅度；Guaranteed 不是免疫 |
| EndpointSlice 条件 | https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/ | 切片保存被 selector 选中的端点；ready = serving 且未 terminating；publishNotReadyAddresses 会让 ready 恒为 true |
| EndpointSlice API | https://kubernetes.io/docs/reference/kubernetes-api/service-resources/endpoint-slice-v1/ | 端点字段包含地址、端口、nodeName、zone 与三个 conditions |
| 调度框架 | https://kubernetes.io/docs/concepts/scheduling-eviction/scheduling-framework/ | QueueingHint 属于 EnqueueExtension，是队列事件过滤机制，不是调度周期阶段；1.28 引入，1.34 Stable |
| 特性门控 | https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/ | `SchedulerQueueingHints`：1.28 Beta；1.29–1.31 默认关闭；1.32–1.33 Beta；1.34 Stable 且默认启用 |

### 2.1 Pod

- 删除“所有容器设置 requests 且等于 limits 即 Guaranteed”的简化描述，改为逐容器、逐资源的完整判定。
- 增加 Pod 级 CPU/内存资源的用途、调度与 QoS 影响、1.34 Beta 边界和当前 Feature State。
- 重写驱逐说明：QoS 只是估算顺序的线索；实际顺序由“是否超过 requests”、Pod Priority 和超出幅度决定；Guaranteed 在系统守护进程挤占预留资源时仍可能被驱逐；QoS 不是容量规划或可用性保证。
- 增加 Pod 级资源与节点压力驱逐的官方参考链接。

### 2.2 Service

- 明确 EndpointSlice 保存的是“被 selector 选中的端点”，不是“全部 ready 的端点”；未就绪 Pod 仍可出现，只是 condition 不同。
- 补充端点地址、端口、nodeName、zone 等元数据。
- 分别解释 serving、terminating、ready，并说明 ready 是“serving 且未 terminating”的快捷判断。
- 说明 terminating 但 serving 的端点通常被忽略，仅在所有端点都在终止时可能继续承接流量。
- 修正“readinessProbe 成功直接使端点 ready”的因果关系：Pod Ready 还取决于所有普通容器就绪与 readinessGates；readinessProbe 只是容器就绪的因素之一。
- 修正“EndpointSlice 为空”的排查项：Pod 未就绪不会让切片为空，而是让端点 ready=false。

### 2.3 Scheduler

- 新增“重新入队与 QueueingHint”小节，说明无法全量重试的原因、unschedulableQ/backoffQ、集群事件驱动的重试。
- 说明 EnqueueExtension 与 QueueingHint 的职责：按事件判断 Pod 是否可能变得可调度，只把值得重试的 Pod 放回 activeQ 或 backoffQ。
- 明确 QueueingHint 不是调度周期阶段，不参与 Filter/Score。
- 补充完整版本边界：1.28 Beta、1.29–1.31 默认关闭、1.32–1.33 Beta、1.34 Stable，避免写成“1.28 Beta、1.34 Stable”而遗漏默认关闭区间。

### 2.4 Deployment 与 Controller Manager

逐节复核了对象关系、滚动更新、进度条件、EndpointSlice 控制器、informer/workqueue、Lease leader election、级联删除与故障表现。未发现需要修正的事实错误，因此保持版本 2，不做无依据改动。

## 3. 内容迁移与哈希门控

版本 3 文档只会在以下条件同时成立时替换库中内容：

1. 库中 Markdown 的 SHA-256 等于“旧内容哈希”；
2. `content_status` 仍为 `draft`；
3. `content_verified_at` 为空。

| 节点 | 旧内容哈希（v2） | 新内容哈希（v3） |
| --- | --- | --- |
| `k8s-pod` | `843eacb1a5e965fc554c842bc724ea8282dd9533b9ef68661787c474a8224b6c` | `9c646ec6ca0de6153bab9a7d50c99352ef367a1bd98c3bff19f1a399be973453` |
| `k8s-service` | `7545b630d27792ac92b14fa12ddf7c4a7b1896d81676255c833ff658e0f554df` | `eb83525ad578d6044ff382dbd07142dfaf595417c60d516188e0f53217646f0d` |
| `k8s-scheduler` | `ed02356a1fd408738f5af436df9443889b59b55ac0a6e4d4372013f70518ee1f` | `b1bda716dbdbfacad309caac96833a6872839dfc44e7553c9bc4baf66e17e427` |

参考链接的合并规则保持保守：

- 原有链接为空时写入作者链接；
- 只有哈希门控允许替换时，才追加缺失链接；
- 不删除、不重写用户已有链接；
- 不覆盖用户编辑或已验证明细。

## 4. 编辑器保存与丢弃竞争修复

此前“放弃更改”只关闭弹窗，不等待进行中的自动保存，也不取消防抖定时器。已经发出的 PATCH 仍可能在关闭后写入，用户看到的“放弃”与实际结果不一致。

修复后的语义：

- 保存进行中或验证进行中，禁用“放弃更改”。
- Verify 进行中，禁止关闭弹窗、点击遮罩和按 Esc。
- 丢弃前取消待执行的防抖定时器。
- 若已有保存请求在途，先等待它完成；成功后才丢弃剩余的本地修改。
- 丢弃只把草稿重置为最后一次服务端确认的快照，并同步脏状态，不发送新的写请求。
- 若在途保存失败，保留未保存编辑并保持弹窗，允许用户重试。
- 关闭弹窗仍走“先保存、失败不关闭”的路径。
- 没有使用 AbortController，也没有声称浏览器取消请求就能撤销服务端写入。

新增测试 `src/components/TechDocEditor.test.tsx` 覆盖：

1. 保存进行中调用丢弃会等待；保存成功后丢弃剩余本地修改。
2. 保存失败时保留本地编辑。
3. Verify 进行中丢弃返回失败且被阻止。
4. 丢弃会取消待执行的自动保存防抖，之后不会再发出 PATCH。

## 5. CRI/containerd 关系方向

原 Seed 把关系写成 `k8s-cri -> k8s-containerd`（`implements`），语义上是“CRI 实现 containerd”，方向错误。现修正为：

| 关系 ID | 方向 | 类型 | 依据 |
| --- | --- | --- | --- |
| `rel-k8s-cri-containerd` | `k8s-containerd` → `k8s-cri` | `implements` | containerd 通过内置 CRI Plugin 实现 CRI 接口；kubelet 通过 CRI 调用容器运行时 |

迁移规则：

- 只匹配 `id`、旧 `source`、旧 `target`、旧 `relation_type` 完全一致的记录；
- 同时更新方向、类型和空描述；
- 重复执行不会再次修改，具备幂等性；
- 用户已改方向、类型或删除重建的关系不会被覆盖；
- 不删除任何关系行。

其余核心关系复核后保持不变：

- API Server → etcd：`depends_on`，API Server 是唯一直接读写 etcd 的控制面组件。
- kubelet → CRI：`depends_on`，kubelet 通过 CRI 调用运行时。
- containerd → OCI：`implements`，方向与语义正确。
- scheduler → API Server、controller-manager → API Server：`depends_on`，二者都不直接访问 etcd。
- Service → EndpointSlice：保留 `depends_on`，数据面依赖 EndpointSlice 提供转发目标，本阶段不强制改型。

## 6. 自动化验证

在临时测试数据库中执行，未接触用户生产数据目录。

| 命令 | 结果 |
| --- | --- |
| `npm run test` | 12 个测试文件、128 个测试全部通过 |
| `npm run build` | TypeScript 检查与 Vite 构建通过 |
| `npm run build:server` | 通过 |

构建仅有既有的“部分 chunk 大于 500 kB”提示，不影响产物生成。

新增依赖仅用于前端组件测试：`@testing-library/react`、`@testing-library/dom`、`jsdom`。

新增或调整的测试覆盖：

- P5.4.1 三篇文档的版本、旧哈希与关键事实存在性。
- Deployment/Controller Manager 保持版本 2 且达到长度要求。
- 参考链接在哈希门控升级时只追加、不删除。
- CRI/containerd 默认方向正确。
- 旧方向精确迁移、幂等执行、保留用户修改。
- 编辑器保存/丢弃/验证竞争场景。

## 7. 阶段 A 验收结论

| 验收项 | 结论 |
| --- | --- |
| Pod QoS、Pod 级资源、驱逐语义修正 | 通过 |
| Service EndpointSlice 端点语义修正 | 通过 |
| Scheduler 重新入队与 QueueingHint 补充 | 通过 |
| 五篇样本文档最终复核 | 通过（两篇无需修改） |
| 版本边界与当前 Feature State | 通过（基于 2026-10-31 官方文档） |
| 编辑器丢弃/保存竞争 | 通过（实现 + 单元测试） |
| CRI/containerd 关系方向 | 通过（Seed + 精确迁移 + 单元测试） |
| 用户内容与关系保护 | 通过 |
| 测试与构建 | 通过 |

阶段 A 通过。按 PRD 门禁，可以进入阶段 B；阶段 B 仍逐节点核实、逐篇迁移，不一次性批量标记 Complete。
