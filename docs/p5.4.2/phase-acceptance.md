# P5.4.2 验收记录：技术知识版本治理与文档生命周期管理

日期：2026-10-31  
范围：现有技术节点的版本治理、状态失效逻辑、Seed 保护和一致性复核  
依据：[版本治理规范](./version-governance.md)、[技术知识质量标准](../p5.4/technical-knowledge-standard.md)

## 1. 本阶段范围与结果

本阶段没有新增技术节点、数据库表、字段、API、审核流程、审批角色、版本管理模块、兼容性管理模块或 UI 模块。所有内容修订仍通过现有 Markdown 编辑器和 Verify 操作维护。

完成内容：

- 修正 `updateNode` 的状态失效逻辑：正文、`applicableVersions`、`docsUrl`、`referenceLinks` 任一变化都会把 `complete` 降级为 `draft`；只改 `personalNotes` 不降级。
- 九篇 Kubernetes 核心文档增加 `## 版本差异与兼容性`，并把适用版本统一到 1.35–1.37、核实基线 1.37.2。
- 二十九篇 Prometheus 文档增加版本差异章节，按 Prometheus Server、Operator、Alertmanager、Exporter、Thanos 分开治理。
- 所有被修订的文档提升内容版本并设置 `replacesContentHash`；全部保持 `draft`，未执行 Verify。
- 新增版本治理规范、版本差异分类、来源优先级与一致性复核清单。

## 2. 状态失效逻辑

修改位置：`server/services/tech.ts` 的 `updateNode`。

在写入前计算四个验证输入是否变化：

| 输入 | 比较方式 |
| --- | --- |
| `contentMarkdown` | 与库中正文逐字比较 |
| `applicableVersions` | 去除首尾空白后比较 |
| `docsUrl` | 去除首尾空白后比较 |
| `referenceLinks` | 先过滤非 `https://` 链接，再比较规范化 JSON |

任一变化且当前状态为 `complete` 时，写入状态改为 `draft`；上一次 `verifiedVersion` 和 `contentVerifiedAt` 保留为历史记录。普通 PATCH 仍不能写入 `complete`、`verifiedVersion` 或 `contentVerifiedAt`，只有现有 Verify 操作能恢复 `complete`。

新增测试覆盖：

- 只改个人笔记时保持 `complete`。
- 修改适用版本后降级为 `draft`，并保留上次验证信息。
- 降级后普通 PATCH 设为 `complete` 被拒绝，重新 Verify 后恢复 `complete`。
- 修改 `docsUrl` 后降级。
- 修改 `referenceLinks` 后降级。
- 重复提交相同正文、版本、来源和链接时不降级。

## 3. Kubernetes 文档治理

九篇文档全部来自现有节点，没有复制或新增节点。核实日期 2026-10-31。

| 节点 | 版本 | 新正文长度 | 旧内容哈希（`replacesContentHash`） | 新内容哈希 |
| --- | --- | --- | --- | --- |
| `k8s-apiserver` | 3 | 5734 | `03c744af826696692600c39f92048e93e71a3c3a04809adb6922ec878615f619` | `fca7e8acb40111ab03b7dcfd0b3229458c4af7947825d5bb7734da628f3d15c2` |
| `k8s-etcd` | 3 | 5320 | `0d3afa829e0da7bd899e512510f5c4891655a5cbf4bb996116963ce184902e8c` | `ecf3c436b6cbff7b65c2efc87ac7c782e5f98e4476ca05752a1ae74f08127178` |
| `k8s-kubelet` | 3 | 6212 | `088b7eedc30f8ff1c0e50b87459ea2effe6e8fe7fbbd199b68d5b1d6c6fb701f` | `2a58cb3adcfe4c4841a4aeec76b689a291842b70ca48e5154a99bc0d1b553820` |
| `k8s-cri` | 3 | 4512 | `00ad27a7a6934fdddea3b474d0e6a1990eecbcb7a7dcac50afa9ea06836e88df` | `ff432d135e0d54a3df9ed66d60d06fb41229b0001c48f10effacd178c0f48408` |
| `k8s-containerd` | 3 | 6457 | `0fe722ef8676333a29757c44181544839fb20c9bdebe9f36aab96aa97117e206` | `cd61b151bfbdf53fd7e4ca198ba2549a6f140617ea00e2ad3a99ed1ef24f9955` |
| `k8s-pod` | 4 | 6116 | `9c646ec6ca0de6153bab9a7d50c99352ef367a1bd98c3bff19f1a399be973453` | `6ab7a0fcd442658f68f78da4259122cb6ef968b8942727d6eff42119c45a6eb9` |
| `k8s-scheduler` | 4 | 5408 | `b1bda716dbdbfacad309caac96833a6872839dfc44e7553c9bc4baf66e17e427` | `050776e4d60ec948dc4680303ce84939107645753a1c9c16f88596338ad6eb54` |
| `k8s-service` | 4 | 5756 | `eb83525ad578d6044ff382dbd07142dfaf595417c60d516188e0f53217646f0d` | `db86f29fb684b5927fc49c1ae739ed63b81d025995df1afb874625a765e42666` |
| `k8s-deployment` | 3 | 4526 | `67c82aebca8355ae1b3fdeec1cd8d29d2be0610c170dea402489824c0b2967bf` | `7bb9060a0321834e6ed80d00e6c05c2ad683b60a827ccf3004d605e84840a521` |

主要修正：

| 主题 | 旧问题 | 新结论 |
| --- | --- | --- |
| Kubernetes 主线 | 多个节点仍写 1.28+ 或 1.34 默认值 | 统一为 1.35–1.37，核实基线 1.37.2；1.34 于 2026-10-27 EOL |
| kubelet 默认值 | 正文按 1.34 描述 | 改为 1.37 KubeletConfiguration，并说明 1.35–1.37 未变 |
| etcd 版本 | 版本边界模糊，参考链接停留在 v3.6 | kubeadm 1.35/1.36/1.37 默认 3.6.6/3.6.8/3.7.0；外部最低 3.5.24；来源改为 v3.7 |
| containerd | 以 2.0 为版本化依据 | 2.3 LTS（至 2028-04-30）、2.4 Active（至 2027-05-16）；2.2 Active 至 2026-11-06；1.7 于 2026-09-30 EOL |
| CRI | 引用 release-1.34 proto | 引用 release-1.37 proto；v1 自 1.23 Stable、1.26+ 强制 |
| Pod | 可能被读成 PodLevelResources 已 GA | 1.34 Beta 至今未 GA；InPlacePodLevelResourcesVerticalScaling 1.35 Alpha / 1.36 Beta |
| scheduler | QueueingHint 容易被当成调度阶段 | 1.34 Stable，且不是独立调度阶段 |
| Service | 端点条件与流量分布版本不清 | EndpointSlice 条件语义稳定；ServiceTrafficDistribution 1.33 Stable；PreferSameTrafficDistribution 1.35 Stable |
| Deployment | 终止副本字段版本不清 | DeploymentReplicaSetTerminatingReplicas 1.33 Alpha / 1.35 Beta，属于观测能力 |

九篇文档的 `## 版本差异与兼容性` 均位于“关键配置与实践”和“常见问题与限制”之间。

## 4. Prometheus 文档治理

二十九篇文档全部提升为内容版本 2，并设置旧正文哈希。每个版本差异章节位于“参考资料”之前，只描述与本文主题相关的差异。

| 文档组 | 数量 | `applicableVersions` |
| --- | --- | --- |
| Prometheus Server | 14 | Prometheus 3.13 LTS / 3.14 / 3.15；核实基线 3.15.1；2.x 已 EOL |
| Prometheus Operator | 8 | Operator 0.94.x；核实基线 0.94.2；兼容 Prometheus 2.0+，e2e 主要覆盖 3.14 |
| Alertmanager | 3 | Alertmanager 0.34.x；核实基线 0.34.0；与 Prometheus Server 版本独立 |
| Exporter / kube-state-metrics | 3 | Node Exporter 1.x / blackbox_exporter 0.2x / kube-state-metrics 2.x |
| Thanos | 1 | Thanos 0.42.x；核实基线 0.42.5；与 Prometheus Server 版本独立 |

主要修正：

- 删除默认的 `Prometheus 2.45+ / Prometheus Operator 0.70+（除单独标注外）`，不再用一个版本号覆盖 Server、Operator 和 Alertmanager。
- Prometheus Server 文档改用 3.15 版本化来源；Alertmanager 文档改用 0.34 版本化来源。
- 正文中的 `prometheus.io/docs/prometheus/latest/` 和 `alerting/latest/` 参考链接替换为对应版本路径。
- Operator 文档明确 Kubernetes >= 1.25（0.84+ 的 CEL 要求）和 kube-prometheus-stack 独立版本。
- Exporter 文档明确版本独立，不能由 Prometheus 的 LTS 或 EOL 推断。
- Thanos 文档明确 Operator 兼容 Thanos >= 0.10，e2e 基线 0.42.5，但对象存储和降采样以 Thanos 自身版本为准。

## 5. Seed 与用户数据保护

- 所有修订文档均提升内容版本，并以修订前正文的 SHA-256 作为 `replacesContentHash`。
- Seed 只在库中正文哈希完全匹配、状态为 `draft`、且没有验证时间时替换正文。
- 用户编辑过、已验证或状态不是 `draft` 的文档不会被替换。
- `docsUrl`、`repoUrl` 仍只在空字段时填充；`referenceLinks` 不删除用户已有链接。
- Seed 不修改 `verifiedVersion` 和 `contentVerifiedAt`。
- 测试使用 `os.tmpdir()` 下的临时数据目录，未连接或修改用户生产数据库。

## 6. 一致性复核

本轮复核并修正：

| 检查项 | 结果 |
| --- | --- |
| `applicableVersions` 与正文版本一致 | 九篇 Kubernetes、二十九篇 Prometheus 已核对 |
| `docsUrl` 与参考链接版本一致 | etcd v3.7、CRI release-1.37、Prometheus 3.15、Alertmanager 0.34 已对齐 |
| 过期默认值 | kubelet 默认值改为 1.37 基线 |
| 过期 API / 功能状态 | PodLevelResources 保持 Beta；QueueingHint、TrafficDistribution、AuthorizeWithSelectors 等按已验证状态描述 |
| 过期命令 | etcd 恢复统一使用 `etcdutl`；kubelet 使用 KubeletConfiguration 字段 |
| 兼容矩阵 | Kubernetes 与 containerd、kubeadm 与 etcd、Operator 与 Kubernetes/Prometheus 分开描述 |
| EOL / Maintenance / LTS / Stable 混用 | 规范中单列概念表；正文按上游术语使用 |
| 跨项目生命周期推断 | Prometheus 与 Operator、Alertmanager、Exporter、Thanos 已拆开 |
| 无法核实的行为 | 保留待核实说明，不写成确定结论 |
| 重复文档 / 按版本复制 | 未新增节点或按版本复制文档 |

## 7. 官方来源

| 主题 | 来源 | 结论 |
| --- | --- | --- |
| Kubernetes 支持窗口 | https://kubernetes.io/releases/ | 1.35–1.37 为当前主线；1.34 于 2026-10-27 EOL |
| kubeadm etcd 版本 | https://raw.githubusercontent.com/kubernetes/kubernetes/release-1.37/cmd/kubeadm/app/constants/constants.go | 1.35/1.36/1.37 默认 etcd 3.6.6/3.6.8/3.7.0；外部最低 3.5.24 |
| etcd 版本与维护 | https://etcd.io/docs/v3.7/、https://github.com/etcd-io/etcd/releases | 3.5.35、3.6.16、3.7.3 于 2026-10-22 发布 |
| containerd 生命周期 | https://containerd.io/releases/ | 2.3 LTS 至 2028-04-30；2.4 Active 至 2027-05-16；2.2 Active 至 2026-11-06；1.7 EOL 2026-09-30 |
| containerd Kubernetes 矩阵 | https://github.com/containerd/containerd/blob/main/docs/cri/compatibility.md | 1.35 推荐 2.2.0+/2.1.5+/1.7.28+；1.36 推荐 2.3.0+/2.2.0+；1.37 推荐 2.4.0+/2.3.0+ |
| kubelet 默认值 | https://kubernetes.io/docs/reference/config-api/kubelet-config.v1beta1/ | 1.37 与 1.34 的已核对默认值一致 |
| 功能状态 | https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/ | 各 Feature State 与正文一致 |
| Prometheus 发布周期 | https://prometheus.io/docs/introduction/release-cycle/ | 3.13 LTS 至 2027-07-31；3.14/3.15 为当前主线；2.x EOL |
| Prometheus 版本 | https://github.com/prometheus/prometheus/releases | 3.15.1 为核实基线 |
| Operator 兼容性 | https://prometheus-operator.dev/docs/getting-started/compatibility/ | Operator 0.94.2；Kubernetes >= 1.25（0.84+）；Prometheus 2.0+，e2e 主要覆盖 3.14；Thanos 0.42.5；Alertmanager 0.34.0 |

## 8. 自动化验证

| 命令 | 结果 |
| --- | --- |
| `npm run test` | 13 个测试文件、145 个测试全部通过 |
| `npm run build` | TypeScript 检查与 Vite 构建通过 |
| `npm run build:server` | 通过 |
| `npm run build:docker` | 通过 |

构建仅有既有的“部分 chunk 大于 500 kB”提示，不影响产物生成。

新增或更新的测试覆盖：

- 版本、来源或参考链接变化导致 `complete` 降级。
- 个人笔记变化不降级。
- 降级后只有 Verify 能恢复 `complete`。
- Kubernetes 九篇文档的版本主线、核实基线、版本章节位置和 containerd 独立生命周期。
- Prometheus 二十九篇文档的版本 2、旧哈希门控、版本章节位置和五组独立生命周期。
- 文档正文不再使用 `prometheus.io/docs/prometheus/latest/` 或 `alerting/latest/` 作为唯一来源。

## 9. 验收结论

| 验收项 | 结论 |
| --- | --- |
| 未新增数据库表、字段、模块或审批流程 | 通过 |
| 每个技术节点只保留一篇主文档 | 通过 |
| 版本差异写入 `## 版本差异与兼容性` | 通过（9 篇 Kubernetes、29 篇 Prometheus） |
| `applicableVersions` 与核实基线明确 | 通过 |
| 正文、版本、`docsUrl`、参考链接相互一致 | 通过 |
| Complete 在验证输入变化后自动降级 | 通过 |
| 个人笔记不触发降级 | 通过 |
| 只有 Verify 能恢复 Complete | 通过 |
| Seed 不覆盖已验证或用户编辑内容 | 通过 |
| 使用临时数据库验证 | 通过 |
| 未提前 Verify、未标记 Complete | 通过（全部为 `draft`） |

## 10. 待核实与后续

- 2026-11-06 containerd 2.2 结束 Active 支持后，需复核推荐矩阵中的相关表述。
- Kubernetes 1.38 发布后需重新核对支持窗口和 kubeadm 默认 etcd 版本。
- Prometheus 3.16 发布后需复核 3.13 LTS 窗口与 3.14 的维护状态。
- 所有九篇 Kubernetes 文档和二十九篇 Prometheus 文档仍需用户在实际核实后逐篇执行 Verify；本记录不代替 Verify。
