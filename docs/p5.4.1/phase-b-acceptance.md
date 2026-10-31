# P5.4.1 阶段 B 验收记录：Kubernetes 核心运行链路深化

日期：2026-10-31  
范围：复用现有节点 ID，深化 API Server、etcd、kubelet、CRI、containerd 五篇文档  
依据：[技术知识质量标准](../p5.4/technical-knowledge-standard.md)、[阶段 A 验收记录](./phase-a-acceptance.md)

## 1. 本阶段范围与结果

本阶段没有新建技术节点，没有复制节点 ID，没有新增业务模块、导航入口、审核流程、AI 生成能力、数据库表、字段或 API。五篇文档均以 `draft` 写入，未执行 Verify，也未标记为 Complete。

| 节点 | 层级 | 内容版本 | 新正文长度 | 旧内容哈希 | 新内容哈希 |
| --- | --- | --- | --- | --- | --- |
| `k8s-apiserver` | L3 | 2 | 4835 | `81c6092c321002cfe808bdd6eff1d7c44a99a276e312d64bf82d96d1939c775b` | `03c744af826696692600c39f92048e93e71a3c3a04809adb6922ec878615f619` |
| `k8s-etcd` | L3 | 2 | 4688 | `933548092960c40af1fa0ec0f20da6130cb803d917fe12e5f1fc6e91ecf430bf` | `0d3afa829e0da7bd899e512510f5c4891655a5cbf4bb996116963ce184902e8c` |
| `k8s-kubelet` | L3 | 2 | 5642 | `b06009e6508d296ac938b86be03e81a1d3bd5b67249a0eaa838ae8bd6fa0dc36` | `088b7eedc30f8ff1c0e50b87459ea2effe6e8fe7fbbd199b68d5b1d6c6fb701f` |
| `k8s-cri` | L2–L3 | 2 | 4009 | 原先无 Markdown | `00ad27a7a6934fdddea3b474d0e6a1990eecbcb7a7dcac50afa9ea06836e88df` |
| `k8s-containerd` | L3 | 2 | 5621 | 原先无 Markdown | `0fe722ef8676333a29757c44181544839fb20c9bdebe9f36aab96aa97117e206` |

CRI 与 containerd 的节点早已存在，且一级知识卡已以版本 1 写入；本次文档条目使用版本 2，避免被 `tech_content_seed` 中已有的版本 1 记录跳过。

## 2. 官方依据与核对结论

核对时间：2026-10-31。以下链接均返回 HTTP 200，主题与引用内容匹配。

| 主题 | 官方来源 | 核对结论 |
| --- | --- | --- |
| API 请求链路 | https://kubernetes.io/docs/concepts/overview/components/ | apiserver 是控制面 API 入口；scheduler、controller-manager、kubelet 通过它协作 |
| 准入控制 | https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/ | 写请求先经过认证、授权，再依次运行变更准入和校验准入；读请求不经过准入 |
| API 一致性读 | https://v1-34.docs.kubernetes.io/docs/reference/using-api/api-concepts/ | 1.34 文档说明：etcd 3.4.31+/3.5.13+ 时，Most recent 读可由 watch cache 加 progress notification 提供；`resourceVersion=0` 为 Any；精确版本被压缩后返回 410 |
| APF | https://kubernetes.io/docs/concepts/cluster-administration/flow-control/ | Feature State 为 1.29 Stable；`flowcontrol.apiserver.k8s.io/v1` 自 1.29 引入；默认启用 |
| apiserver 参数 | https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/ | `--etcd-prefix` 默认 `/registry`；`--etcd-compaction-interval` 默认 5m；`--event-ttl` 默认 1h；`--storage-media-type` 默认 protobuf；APF 开启时两个 in-flight 参数相加构成总并发预算 |
| etcd 版本映射 | https://raw.githubusercontent.com/kubernetes/kubernetes/release-1.34/cmd/kubeadm/app/constants/constants.go | kubeadm 1.34 默认 etcd 3.6.5，外部 etcd 最低 3.5.24；1.31–1.33 默认 3.5.24 |
| etcd 运维下限 | https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/ | 生产环境通用最低建议为 3.4.29+/3.5.11+；这是通用下限，不等同于 1.34 的受支持组合 |
| etcd 维护 | https://etcd.io/docs/v3.6/op-guide/maintenance/ | 压缩清理历史 revision；defrag 回收空间；空间配额触发 NOSPACE 后只允许读和删除 |
| etcd 恢复 | https://etcd.io/docs/v3.6/op-guide/recovery/ | 使用 `etcdutl` 恢复；`etcdctl snapshot status/restore` 自 3.5 起弃用，3.6 文档只提供 `etcdutl` 方式 |
| kubelet 默认值 | https://v1-34.docs.kubernetes.io/docs/reference/config-api/kubelet-config.v1beta1/ | 1.34 默认：nodeStatusUpdateFrequency 10s、nodeStatusReportFrequency 5m、nodeLeaseDurationSeconds 40、maxPods 110、cgroupDriver cgroupfs、imageGC 85/80、containerLogMaxSize 10Mi/5、podPidsLimit -1、failSwapOn true、serializeImagePulls true、registryPullQPS 5 |
| kubelet 驱逐阈值 | https://v1-34.docs.kubernetes.io/docs/reference/config-api/kubelet-config.v1beta1/ | evictionHard 默认 memory.available 100Mi、nodefs.available 10%、nodefs.inodesFree 5%、imagefs.available 15% |
| kubelet 命令行 | https://v1-34.docs.kubernetes.io/docs/reference/command-line-tools-reference/kubelet/ | `--kube-reserved`、`--system-reserved`、`--eviction-hard`、`--node-status-update-frequency`、`--image-gc-*` 等均已弃用，应写入 KubeletConfiguration |
| CRI 版本 | https://v1-34.docs.kubernetes.io/docs/concepts/architecture/cri/ | CRI API 自 1.23 Stable；1.26+ kubelet 要求运行时支持 v1，否则无法注册节点 |
| CRI 接口 | https://github.com/kubernetes/cri-api/blob/release-1.34/pkg/apis/runtime/v1/api.proto | RuntimeService 与 ImageService 两组 gRPC 接口；包含 sandbox、容器、exec/attach、stats、日志重开和镜像操作 |
| containerd 架构 | https://github.com/containerd/containerd/blob/release/2.0/docs/cri/architecture.md | CRI 插件接收 kubelet 请求，管理 sandbox、CNI、镜像和容器；pause 容器持有网络命名空间 |
| containerd 配置 | https://github.com/containerd/containerd/blob/release/2.0/docs/cri/config.md | 2.0 配置版本 3；插件 ID 为 `io.containerd.cri.v1.runtime` 与 `io.containerd.cri.v1.images`；1.x 为配置版本 2 和 `io.containerd.grpc.v1.cri`；SystemdCgroup 必须与 kubelet 一致 |
| containerd 插件与内容流 | https://github.com/containerd/containerd/blob/release/2.0/docs/PLUGINS.md、https://github.com/containerd/containerd/blob/release/2.0/docs/content-flow.md | runtime v2 通过 shim 托管容器；内容按 digest 存入 content store，再由 snapshotter 解包 |

## 3. 关键事实修正

### 3.1 kubelet 与 CNI 的调用方向

旧文档在 kubelet 职责中写“通过 CNI 配置网络”，容易被理解为 kubelet 直接执行 CNI 插件。实际链路是：kubelet 通过 CRI 请求创建 sandbox，运行时的 CRI 插件负责调用 CNI 配置网络。新文档明确写出“kubelet 不直接执行 CNI 插件”，并把它与 CSI 的职责区分开。

### 3.2 kubelet 配置字段

旧文档列出的 `--kube-reserved`、`--system-reserved`、`--eviction-hard`、`--node-status-update-frequency`、`--image-gc-high-threshold` 等命令行参数在 1.34 已弃用或不再推荐。新文档改用 KubeletConfiguration 字段，并逐项给出 1.34 默认值；同时说明这些默认值不能跨版本套用。

### 3.3 etcd 版本选择

旧文档只写“etcd 官方文档”，没有版本边界。新文档明确：不能直接使用 etcd 最新版；kubeadm 1.34 默认 etcd 3.6.5，外部 etcd 最低 3.5.24；1.31–1.33 默认 3.5.24。Kubernetes 运维页的 3.4.29+/3.5.11+ 是通用下限，不等于 1.34 的受支持组合。

### 3.4 apiserver 读一致性

旧文档写“读请求可以走 watch cache，但一致性读仍会落到 etcd”，在 1.34 下过于绝对。新文档按 `resourceVersion` 语义拆分为 Most recent、Any（`0`）、精确版本和 `NotOlderThan`，并说明 Most recent 在满足 etcd 版本条件时可由 watch cache 加 progress notification 提供；精确版本被压缩后返回 410。

### 3.5 APF 与并发限制

旧文档只列 `--max-requests-inflight` / `--max-mutating-requests-inflight`。新文档补充：APF 自 1.29 Stable 并默认启用；启用 APF 时两个参数相加构成总并发预算，由 FlowSchema 和 PriorityLevelConfiguration 分配；限流返回 429 并带 Retry-After。

### 3.6 CRI 与 containerd 的版本边界

CRI 文档明确 v1 自 1.23 Stable、1.26+ 强制要求 v1；containerd 文档以 2.0 的版本化文档为准，区分 2.x 的配置版本 3、拆分后的插件 ID 与 1.x 的配置版本 2、单一 CRI 插件 ID。没有把 main 分支或 1.x 配置写成所有版本的通用事实。

## 4. 关系复核

本阶段没有修改任何技术关系行。逐项复核结果：

| 关系 | 方向与类型 | 结论 |
| --- | --- | --- |
| `rel-k8s-api-etcd` | apiserver → etcd，`depends_on` | 正确：只有 apiserver 直接读写 etcd |
| `rel-k8s-sched-api` | scheduler → apiserver，`depends_on` | 正确：调度器不直接访问 etcd |
| `rel-k8s-cm-api` | controller-manager → apiserver，`depends_on` | 正确：控制器不直接访问 etcd |
| `rel-k8s-kubelet-cri` | kubelet → CRI，`depends_on` | 正确：kubelet 是 CRI 客户端 |
| `rel-k8s-cri-containerd` | containerd → CRI，`implements` | 正确：containerd 通过内置 CRI 插件实现 CRI |
| `rel-k8s-containerd-oci` | containerd → OCI，`implements` | 正确：containerd 使用 OCI 镜像与运行时规范 |

五篇文档都明确写出 kubelet、scheduler、controller-manager 不直接访问 etcd；没有新增或暗示这些组件与 etcd 的直接依赖。未新增节点，未复用重复 ID，未批量重建关系。

## 5. 内容迁移与用户数据保护

- 三篇已有 Markdown 的文档使用版本 2，并设置 `replacesContentHash` 为旧正文哈希；只有库中正文哈希完全匹配、`content_status` 为 `draft` 且 `content_verified_at` 为空时才替换。
- CRI 与 containerd 原先没有 Markdown，文档写入空字段；版本 2 只用于越过已记录的一级卡片版本 1。
- 参考链接沿用阶段 A 的规则：原为空时写入；哈希门控允许替换时只追加缺失链接，不删除或重写用户已有链接。
- 用户编辑过的正文、已验证明细、已有 docsUrl/repoUrl 不会被覆盖。
- 测试使用临时数据库，未连接或修改用户生产数据库。

## 6. 自动化验证

| 命令 | 结果 |
| --- | --- |
| `npm run test` | 12 个测试文件、134 个测试全部通过 |
| `npm run build` | TypeScript 检查与 Vite 构建通过 |
| `npm run build:server` | 通过 |

构建仅有既有的“部分 chunk 大于 500 kB”提示，不影响产物生成。

新增测试覆盖：

- 五篇文档的版本、旧哈希（有旧正文的三篇）、长度下限与关键事实。
- API Server 的 apiserver-only etcd 边界、APF、resourceVersion 语义和 409 冲突。
- etcd 的 kubeadm 1.34 版本映射、NOSPACE、`etcdutl` 恢复和 apiserver-only 边界。
- kubelet 的 1.34 默认值、CNI 由运行时调用、不直接访问 etcd。
- CRI 的 RuntimeService/ImageService、v1 强制要求和 CNI 归属。
- containerd 2.0 的配置版本 3、拆分插件 ID、shim 与 SystemdCgroup。
- 五篇文档均按质量标准的固定章节顺序组织：技术定位、设计原理、工作机制、关键配置与实践、常见问题与限制、技术关联、参考资料。

## 7. 阶段 B 验收结论

| 验收项 | 结论 |
| --- | --- |
| 五个现有节点深化，无重复节点 | 通过 |
| API Server、etcd、kubelet、containerd ≥3000 字符 | 通过 |
| CRI ≥1500 字符 | 通过（3975） |
| 官方来源核对与 HTTP 200 | 通过（2026-10-31） |
| etcd 版本跟随 Kubernetes 兼容性 | 通过（1.34 默认 3.6.5，外部最低 3.5.24） |
| kubelet 默认值按 1.34 核对 | 通过 |
| containerd 使用 2.0 版本化文档 | 通过 |
| CRI v1 版本边界 | 通过 |
| 统一控制面与节点运行链路、无直接 etcd 误述 | 通过 |
| 关系复核，无未经验证的改动 | 通过（本阶段未改关系） |
| 哈希门控与用户数据保护 | 通过 |
| 测试与构建 | 通过 |
| 未执行 Verify、未标记 Complete | 通过（五篇均为 draft） |

阶段 B 完成。按 PRD 要求，五篇文档仍需由用户在实际核实后，通过现有 Verify 操作逐篇标记为 Complete；本记录不代替 Verify，也不把“文档已写入”当成“内容已验收”。
