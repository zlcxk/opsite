# P5.4.2 技术知识版本治理与文档生命周期规范

版本：1.0  
生效日期：2026-10-31  
适用范围：技术地图中已有 Markdown 文档的技术节点，优先覆盖 Kubernetes 核心链路与 Prometheus 优先节点  
上位规范：[技术知识质量标准](../p5.4/technical-knowledge-standard.md)

## 1. 目的与边界

本规范解决四个问题：

1. 每篇文档说明自己适用于哪些版本、依据哪个版本核实。
2. 版本变化只影响必要的结论，不要求为每个软件版本复制一篇文档。
3. 已完善文档的验证输入变化后，状态能自动失效。
4. Seed 只更新未被用户改动、未被验证的草稿。

本规范不新增数据库字段、表、审核角色、审批流程、版本管理模块、兼容性管理模块或 AI 生成能力。所有治理信息复用现有字段：

| 字段 | 用途 |
| --- | --- |
| `applicableVersions` | 文档覆盖的版本范围与核实基线 |
| `verifiedVersion` | 人工验证时记录的版本 |
| `contentVerifiedAt` | 人工验证时间 |
| `contentStatus` | `missing` / `draft` / `needs_review` / `complete` |
| `contentSource` | `official` / `mixed` / `curated` |
| `docsUrl` | 节点对应的官方入口 |
| `referenceLinks` | 可访问的官方参考资料 |

## 2. 一篇文档，而不是一版一篇

每个技术节点只维护一篇主文档。版本差异写在文档内的 `## 版本差异与兼容性` 章节，只为影响结论的差异增加段落，不复制整篇文档。

主文档的写法：

- 正文以当前仍受支持的版本为主线。
- 历史版本和 EOL 版本只在解释差异、迁移或常见误解时出现。
- 默认值、API 版本、功能状态、命令和兼容矩阵必须标注所属版本。
- 无法核实的行为写“待核实”，不猜测，不用相邻版本的行为替代。

不要求把历史文档统一改成某个最新版本号。版本治理是逐篇核对结论，不是批量替换字符串。

## 3. 版本差异分类

新增或修订 `## 版本差异与兼容性` 时，按以下类别判断差异是否需要写入：

| 类别 | 例子 | 是否必须写入 |
| --- | --- | --- |
| 语法与配置结构 | 配置版本号、字段改名、插件 ID 拆分 | 影响现有配置能否直接使用时必须写 |
| 默认值 | 超时、阈值、并发数、日志级别 | 影响生产行为或排障结论时必须写 |
| API 与功能状态 | Alpha / Beta / Stable、API 组版本、弃用 | 影响能否依赖该功能时必须写 |
| 命令与参数 | 命令行参数弃用、子命令迁移 | 照旧命令会失败或产生误导时必须写 |
| 兼容矩阵 | Kubernetes 与运行时、Operator 与 Prometheus | 选型或升级路径依赖它时必须写 |
| 存储与协议 | TSDB 块格式、Remote Write 协议、快照恢复 | 跨版本恢复或互操作时必须写 |
| 纯文档措辞 | 页面重排、示例风格 | 不写 |

差异描述要说明“从哪个版本开始、当前状态、对本文结论的影响”，避免只写“有变化”。

## 4. 生命周期概念

以下概念不能混为一谈：

| 概念 | 含义 | 不能推断出 |
| --- | --- | --- |
| EOL | 上游已停止维护 | 该版本仍然安全或仍受支持 |
| Maintenance | 仍在维护，但可能只接受修复 | 新功能仍会进入该分支 |
| LTS | 上游承诺较长维护周期 | 功能冻结、绝对稳定或适合所有生产场景 |
| Stable | 功能状态达到稳定级别 | 所有集群默认启用或无需配置 |
| Active | 当前活跃发布分支 | 该分支是 LTS |
| Alpha / Beta | 功能成熟度阶段 | 可以无条件用于生产 |

规则：

- 不得把最新 Release 自动视为推荐生产版本。
- 不得用 EOL、Maintenance、LTS、Stable 互相替代。
- 不得用一个项目的维护周期推断另一个项目。
- 具体日期和版本号必须来自对应项目的官方页面或发布说明。

## 5. 来源优先级

1. 对应版本的官方文档。
2. 官方发布说明、CHANGELOG、KEP、RFC。
3. 官方源码、API 参考和兼容矩阵。
4. 高质量工程博客或厂商文档，仅作补充，不能作为唯一依据。

要求：

- 引用具体版本行为时，优先使用该版本文档，而不是 `/latest/`。
- `docsUrl` 指向官方入口；能从版本化路径访问时使用版本化路径。
- `referenceLinks` 至少 2 条，建议 3–4 条，全部为 `https://`。
- 提交前检查 HTTP 状态与主题匹配；无法访问的来源不得写成已核实。
- 同一篇文档内的 `applicableVersions`、正文、`docsUrl`、`referenceLinks` 必须指向同一版本主线。

## 6. 状态与验证生命周期

状态流转：

~~~text
missing --写入正文--> draft --人工验证--> complete
                         ^                   |
                         |                   | 正文 / 适用版本 / docsUrl / 参考链接变化
                         +-------------------+
complete --正文清空--> missing
~~~

硬性规则：

1. 普通创建和 PATCH 不能写入 `complete`、`verifiedVersion`、`contentVerifiedAt`。
2. 只有现有 Verify 操作能设置 `complete`，并记录 `verifiedVersion` 与 `contentVerifiedAt`。
3. 以下任一字段变化时，`complete` 自动降级为 `draft`：
   - `contentMarkdown`
   - `applicableVersions`
   - `docsUrl`
   - `referenceLinks`
4. 仅修改 `personalNotes` 不降级。
5. 降级后保留上一次验证版本和时间，只作为历史记录展示，不能表示当前内容已验证。
6. 只有再次执行 Verify 才能恢复 `complete`；普通 PATCH 不能恢复。
7. 不得为了提高 Complete 数量而提前 Verify。

## 7. Seed 保护

Seed 更新必须同时满足：

- 库中正文的 SHA-256 与 `replacesContentHash` 完全一致；
- `content_status` 仍为 `draft`；
- `content_verified_at` 为空；
- 用户没有编辑过正文。

任一条件不满足时，不替换正文，也不修改 `verifiedVersion`、`contentVerifiedAt` 或 `applicableVersions`。`docsUrl`、`repoUrl` 只在空字段时填充；`referenceLinks` 只在允许替换时追加缺失项，不删除用户已有链接。

## 8. 文档章节模板

纳入治理的节点在“关键配置与实践”和“常见问题与限制”之间增加：

~~~markdown
## 版本差异与兼容性

本文以 <具体版本> 为核实基线，主线覆盖 <支持范围>；<EOL 版本> 仅作为历史差异。

| 版本 | 机制 / 字段 | 状态 | 差异与影响 |
| --- | --- | --- | --- |
| ... | ... | ... | ... |

<说明该差异对选型、升级或排障的影响；无法核实的结论保留待核实说明。>
~~~

写作出入：

- 只写与本文主题相关的差异，不复制完整 Release Notes。
- 表格中的状态使用上游术语，不自行创造“推荐”“稳定”标签。
- 兼容矩阵要写明来源项目，不能把 Kubernetes 的矩阵套到 Prometheus。
- 不把 `/latest/` 页面上的行为直接写成所有版本的行为。

## 9. Kubernetes 治理结果

核实日期：2026-10-31。当前主线为 Kubernetes 1.35–1.37，核实基线 1.37.2；1.34 已于 2026-10-27 EOL。

| 节点 | `applicableVersions` | 关键版本差异 |
| --- | --- | --- |
| `k8s-apiserver` | Kubernetes 1.35–1.37；基线 1.37.2 | APF 1.29 Stable；CBOR Alpha 1.32；AuthorizeWithSelectors 1.34 Stable；WatchListClient 1.35 Beta；WatchCacheInitializationPostStartHook 1.37 Stable |
| `k8s-etcd` | Kubernetes 1.35–1.37；etcd 3.7.x | kubeadm 默认 etcd 3.6.6 / 3.6.8 / 3.7.0；外部 etcd 最低 3.5.24；上游 3.5.35 / 3.6.16 / 3.7.3 |
| `k8s-kubelet` | Kubernetes 1.35–1.37；默认值以 1.37 为准 | KubeletCgroupDriverFromCRI 1.34 Stable；KubeletFineGrainedAuthz 1.36 Stable；1.35–1.37 默认值未变 |
| `k8s-cri` | Kubernetes 1.35–1.37；CRI v1 | CRI v1 自 1.23 Stable；1.26+ 强制要求 v1 |
| `k8s-containerd` | containerd 2.3 LTS / 2.4 Active | 2.3 支持至 2028-04-30；2.4 支持至 2027-05-16；2.2 支持至 2026-11-06；1.7 于 2026-09-30 EOL |
| `k8s-pod` | Kubernetes 1.35–1.37；基线 1.37.2 | PodLevelResources 1.34 Beta 至今未 GA；InPlacePodLevelResourcesVerticalScaling 1.35 Alpha / 1.36 Beta |
| `k8s-scheduler` | Kubernetes 1.35–1.37；基线 1.37.2 | SchedulerQueueingHints 1.34 Stable；QueueingHint 不是独立调度阶段 |
| `k8s-service` | Kubernetes 1.35–1.37；基线 1.37.2 | ServiceTrafficDistribution 1.33 Stable；PreferSameTrafficDistribution 1.35 Stable |
| `k8s-deployment` | Kubernetes 1.35–1.37；基线 1.37.2 | DeploymentReplicaSetTerminatingReplicas 1.33 Alpha / 1.35 Beta |

上述九篇文档已增加 `## 版本差异与兼容性`，全部保持 `draft`，未执行 Verify。

## 10. Prometheus 治理结果

核实日期：2026-10-31。Prometheus Server 主线为 3.13 LTS、3.14、3.15，核实基线 3.15.1；3.13 LTS 支持至 2027-07-31；2.x 已 EOL。

| 文档组 | 节点 | 版本主线 |
| --- | --- | --- |
| Prometheus Server | `prom-core`、`prom-server`、`prom-tsdb`、`prom-promql`、`prom-data-model`、`prom-service-discovery`、`prom-scraping`、`prom-relabel`、`prom-remote-write`、`prom-federation`、`prom-scale`、`prom-ha`、`prom-backup`、`prom-kubernetes-sd` | 3.13 LTS / 3.14 / 3.15；基线 3.15.1；2.x EOL |
| Prometheus Operator | `prom-operator`、`prom-cr`、`prom-service-monitor`、`prom-pod-monitor`、`prom-scrape-config-cr`、`prom-probe`、`prom-rule-cr`、`prom-generated-config` | Operator 0.94.x；基线 0.94.2；Kubernetes >= 1.25；Prometheus 2.0+，e2e 主要覆盖 3.14 |
| Alertmanager | `prom-alertmanager`、`prom-am-config`、`prom-alert-routing` | Alertmanager 0.34.x；基线 0.34.0；与 Server 版本独立 |
| Exporter / kube-state-metrics | `prom-exporter`、`prom-node-exporter`、`prom-kube-state-metrics` | Node Exporter 1.x、blackbox_exporter 0.2x、kube-state-metrics 2.x；各自独立 |
| Thanos | `prom-thanos` | Thanos 0.42.x；基线 0.42.5；与 Server 版本独立 |

Prometheus 文档不把 Operator、Alertmanager、Exporter、Thanos 的版本混入 Prometheus Server 的主线，也不把 kube-prometheus-stack 的 Chart 版本当成 Operator 或 Prometheus 版本。

## 11. 一致性复核清单

每篇纳入治理的文档提交前检查：

- `applicableVersions` 是否为支持范围加核实基线，而不是空白或过期的“2.45+ / 0.70+”。
- 正文默认值、API 版本、功能状态、命令是否与 `applicableVersions` 指向的版本一致。
- `docsUrl` 与 `referenceLinks` 是否指向同一版本主线，是否存在失效的 `/latest/` 或旧版本链接。
- 是否把 EOL、Maintenance、LTS、Stable、Active 混用。
- 是否用一个项目的维护周期推断另一个项目。
- 是否存在无法核实却写成肯定结论的版本行为。
- 是否有重复文档、重复节点或按版本复制的主文档。
- 状态是否为 `draft`；是否有未经 Verify 的 `complete`。

## 12. 待核实与后续

以下事项在本轮没有完成，需要在上游发布新版本或用户实际核实后继续：

- Kubernetes 1.38 发布后重新核对 1.35 是否退出支持窗口。
- containerd 2.2 在 2026-11-06 结束 Active 支持后，从推荐矩阵中移除的表述需复核。
- Prometheus 3.16 发布后确认 3.13 LTS 的支持窗口和 3.14 的维护状态。
- Prometheus Operator 新版本发布后核对 CRD 与 Kubernetes 的 CEL 要求。
- 所有九篇 Kubernetes 文档和二十九篇 Prometheus 文档仍需用户逐篇执行 Verify；本规范不代替核实。
