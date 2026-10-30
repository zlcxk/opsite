import type { TechContentEntry } from './tech-content.js';

const d = (
  nodeId: string,
  contentMarkdown: string,
  options: { versions?: string; docsUrl?: string; source?: 'official' | 'mixed' | 'curated' } = {},
): TechContentEntry => ({
  nodeId,
  version: 1,
  contentMarkdown,
  contentStatus: 'draft',
  contentSource: options.source ?? 'mixed',
  applicableVersions: options.versions ?? 'Prometheus 2.45+ / Prometheus Operator 0.70+（除单独标注外）',
  docsUrl: options.docsUrl,
});

/**
 * Level-2 Markdown documents for the Prometheus priority nodes. All documents
 * start as drafts; users confirm "已完善" after reviewing them.
 */
export const PROMETHEUS_DOCS: TechContentEntry[] = [
  d(
    'prom-core',
    `## 概念定义

Prometheus 是一套以拉取（pull）为核心的指标监控系统，包含抓取、时序存储、查询、规则评估和告警五部分能力。

## 设计目的

它解决的是“如何以统一的数据模型持续采集和查询时序指标”。与日志系统不同，Prometheus 关注可聚合的数值序列，并通过标签维度支持灵活的下钻和聚合。

## 整体架构

~~~text
        服务发现 / 静态配置
                │
                ▼
        ┌──────────────┐      ┌─────────────┐
        │  Retrieval   │─────►│    TSDB     │
        └──────────────┘      └──────┬──────┘
                                      │
              ┌──────────────┬────────┴────────┐
              ▼              ▼                 ▼
          PromQL 查询    规则评估         Remote Write
              │              │                 │
              ▼              ▼                 ▼
          Grafana / API   Alertmanager    长期存储
~~~

## 核心机制

- **抓取**：按 job 主动请求目标 /metrics，解析样本。
- **存储**：样本按时间序列写入本地 TSDB，按块持久化。
- **查询**：PromQL 从 TSDB 读取序列并计算。
- **规则**：按 evaluation_interval 执行 Recording/Alerting Rules。
- **告警**：firing 告警推送到 Alertmanager，由其去重和路由。

## 关键设计取舍

- 拉取模型便于发现目标和控制采集节奏，但不适合短生命周期任务（需要 Pushgateway 或 OTel）。
- 本地 TSDB 简单可靠，但单机容量有限，长期保留需要 Remote Write 或 Thanos/Mimir。
- 标签是查询能力的来源，也是基数风险的来源；高基数值不能放进标签。

## 典型使用场景

- Kubernetes 与云原生基础设施监控。
- 应用 RED/USE 指标和 SLO 计算。
- 基于规则的告警和值班通知。

## 相关组件

Prometheus Server 是运行载体；TSDB 保存数据；Alertmanager 负责通知；Grafana 负责可视化；Operator 负责 Kubernetes 下的声明式管理。

## 参考资料

- [Prometheus Overview](https://prometheus.io/docs/introduction/overview/)
- [Prometheus Architecture](https://prometheus.io/docs/introduction/faq/#architecture)`,
    { docsUrl: 'https://prometheus.io/docs/introduction/overview/' },
  ),
  d(
    'prom-server',
    `## 组件定位

Prometheus Server 是实际运行的进程，组合抓取管理器、TSDB、查询引擎、规则管理器和 HTTP API。

## 核心职责

- 加载并热重载配置。
- 按 job 抓取目标并写入 TSDB。
- 提供 PromQL 查询和 UI。
- 周期性评估 Recording/Alerting Rules。
- 向 Alertmanager 发送告警，向远端写入样本。

## 工作原理

启动时读取 prometheus.yml，初始化服务发现和抓取管理器；TSDB 打开数据目录并恢复 WAL；规则管理器加载规则文件。运行期间，scrape loop 按间隔抓取目标，样本进入 head block；查询从 head 和持久化块读取。配置重载通过 SIGHUP 或 /-/reload 触发。

## 关键配置

- **--config.file**：主配置文件。
- **--storage.tsdb.path**：数据目录。
- **--storage.tsdb.retention.time / size**：本地保留策略。
- **--web.enable-lifecycle**：允许 HTTP 触发重载。
- **--web.enable-admin-api**：启用快照等管理接口。
- **--storage.remote.write**：通过配置启用 Remote Write。

## 资源与容量

内存主要受活跃序列数、head block 和查询影响；磁盘受样本量和保留时间影响。抓取目标数、规则数和查询复杂度共同决定 CPU。容量规划应基于活跃序列数和样本增长率，而不是只看磁盘。

## 常见故障与排查

| 现象 | 常见原因 | 排查方向 |
|---|---|---|
| 目标大量 down | 网络、认证、端口或 relabel 错误 | 看 Targets 页面和抓取错误 |
| 查询超时 | 查询范围过大、序列过多 | 缩小范围、优化 PromQL、看慢查询 |
| 内存持续增长 | 基数爆炸、查询大范围加载 | 看 TSDB 序列数和 top 指标 |
| 规则评估延迟 | 规则过多或查询昂贵 | 看规则组耗时和评估间隔 |
| 配置重载失败 | YAML 语法或校验错误 | 看日志和 promtool check config |

## 相关组件

TSDB 是存储核心；服务发现提供目标；Alertmanager 接收告警；Grafana 消费查询 API；Operator 管理其生命周期。

## 参考资料

- [Prometheus Configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)
- [Storage](https://prometheus.io/docs/prometheus/latest/storage/)`,
    { docsUrl: 'https://prometheus.io/docs/prometheus/latest/configuration/configuration/' },
  ),
  d(
    'prom-tsdb',
    `## 组件定位

TSDB 是 Prometheus 的本地时序存储引擎，负责样本写入、压缩、保留和查询。

## 核心职责

- 接收抓取和规则产生的样本。
- 按时间窗口把内存数据切分为持久化块。
- 通过倒排索引支持按标签选择序列。
- 执行保留策略和块压缩。

## 核心原理

TSDB 使用 **head block** 接收最新写入，默认每 2 小时切分为一个持久化块。每个块包含 chunks（压缩后的样本）和 index（标签到序列的索引）。删除按时间保留策略整块进行，而不是逐条删除。查询先定位块，再按序列读取。

## 关键机制

- **WAL**：head 的预写日志，进程崩溃后恢复未落盘数据。
- **Compaction**：合并小块、去重、降低查询开销。
- **Retention**：按时间或大小删除旧块。
- **Postings index**：标签倒排索引，支持高效选择器。
- **Snapshot**：通过 admin API 创建一致性快照，用于备份。

## 容量规划

关键指标是活跃序列数、每秒样本数、块数量和磁盘增长速率。一个样本约占 1–2 字节压缩后空间，但索引和标签会额外占用。保留时间乘以每日增长量是磁盘下限，还要预留压缩和快照空间。

## 配置示例

~~~yaml
storage:
  tsdb:
    path: /prometheus
    retention:
      time: 15d
      size: 100GB
    wal-compression: true
~~~

## 常见故障与排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 磁盘快速增长 | 高基数、短保留、重复抓取 | 看 top 指标和序列增长 |
| 查询变慢 | 块过多、范围过大、索引膨胀 | 优化查询、检查 compaction |
| 启动慢 | WAL 回放或块损坏 | 检查磁盘和日志，必要时恢复快照 |
| 写入被拒绝 | 磁盘满或达到 max samples | 扩容、清理、限制基数 |

## 相关组件

Prometheus Server 负责读写；Remote Write 把数据送出；Thanos/Mimir 等长期存储接收块或样本；Grafana 通过查询引擎访问。

## 参考资料

- [Prometheus Storage](https://prometheus.io/docs/prometheus/latest/storage/)`,
    { docsUrl: 'https://prometheus.io/docs/prometheus/latest/storage/' },
  ),
  d(
    'prom-promql',
    `## 概念定义

PromQL 是 Prometheus 的函数式查询语言，用来选择和聚合时间序列。

## 设计目的

它让用户用标签选择器精确定位序列，再通过函数和聚合表达速率、分位数、预测等监控语义。

## 核心概念

- **Instant vector**：某一时刻的一组序列。
- **Range vector**：一段时间窗口内的样本，如 \`http_requests_total[5m]\`。
- **Scalar**：单个数值。
- **String**：字符串字面量。

## 常用模式

~~~promql
# 每秒请求速率（counter）
sum by (service) (rate(http_requests_total[5m]))

# 错误率
sum(rate(http_requests_total{status=~"5.."}[5m]))
  / sum(rate(http_requests_total[5m]))

# P95 延迟（histogram）
histogram_quantile(0.95,
  sum by (le, service) (rate(http_request_duration_seconds_bucket[5m])))

# 内存使用率（gauge）
1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes
~~~

## 关键规则

- \`rate\`、\`increase\` 只适用于 counter，必须配合区间向量。
- 区间窗口至少包含两个样本，窗口过短会出现空值或抖动。
- 聚合用 \`by\` 保留维度，用 \`without\` 去掉维度。
- 避免在标签匹配中使用过宽正则。
- \`histogram_quantile\` 需要保留 \`le\` 标签。

## 常见错误

| 错误 | 后果 | 正确做法 |
|---|---|---|
| 对 gauge 使用 rate | 结果无意义 | 用 delta 或直接比较 |
| counter 重置未处理 | 速率出现负值 | rate 会自动处理重置 |
| 忽略空结果 | 告警表达式误判 | 用 absent 或 or 兜底 |
| 区间过短 | 抖动、丢点 | 至少 4 倍抓取间隔 |
| 高基数聚合 | 内存和查询压力 | 先按业务维度聚合 |

## 调试方法

使用表达式浏览器或 /api/v1/query 逐步验证：先看原始序列，再加 rate，再加聚合，最后加告警阈值。不要一次性写完复杂表达式再猜哪里错。

## 参考资料

- [Querying basics](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [PromQL functions](https://prometheus.io/docs/prometheus/latest/querying/functions/)`,
    { docsUrl: 'https://prometheus.io/docs/prometheus/latest/querying/basics/' },
  ),
  d(
    'prom-data-model',
    `## 概念定义

Prometheus 的数据模型由指标名、标签集、时间戳和值组成。指标名加标签集唯一标识一条时间序列。

## 设计目的

标签让同一指标可以按服务、实例、状态码等维度拆分和聚合，是 Prometheus 查询能力的核心。

## 样本结构

~~~text
http_requests_total{job="api", instance="10.0.0.1:8080", status="200"} 1234 @ 1710000000
~~~

- **metric name**：指标语义，如 \`http_requests_total\`。
- **labels**：键值对，如 job、instance、status。
- **timestamp**：毫秒时间戳。
- **value**：float64 数值。

## 指标类型

| 类型 | 语义 | 典型指标 |
|---|---|---|
| Counter | 只增不减，可重置 | 请求数、错误数 |
| Gauge | 可增可减的瞬时值 | 内存使用、队列长度 |
| Histogram | 分桶统计，支持分位数 | 请求延迟 |
| Summary | 客户端计算分位数 | 请求延迟（客户端侧） |

Histogram 暴露 \`_bucket\`、\`_sum\`、\`_count\`，可在服务端聚合；Summary 的分位数不可跨实例聚合。因此服务端 SLO 通常优先使用 Histogram。

## 标签设计原则

- 标签值必须有界，不能是用户 ID、请求 ID、时间戳。
- 统一命名：环境、集群、服务、实例、状态码。
- 不要重复已有维度，也不要把指标名拆成标签。
- 高基数维度应通过日志或 tracing 分析，而不是指标。

## 常见问题

- 标签基数爆炸导致内存和磁盘耗尽。
- 同一指标在不同服务中单位不一致。
- counter 命名缺少 \`_total\` 后缀。
- 用 gauge 表达累计值，导致 rate 无意义。
- 标签值大小写和格式不统一，聚合结果分裂。

## 参考资料

- [Data model](https://prometheus.io/docs/concepts/data_model/)
- [Metric types](https://prometheus.io/docs/concepts/metric_types/)`,
    { docsUrl: 'https://prometheus.io/docs/concepts/data_model/' },
  ),
  d(
    'prom-service-discovery',
    `## 概念定义

服务发现让 Prometheus 动态获得抓取目标，而不是在配置中写死地址。

## 设计目的

在 Kubernetes、云主机和弹性伸缩环境中，实例会频繁创建和销毁。服务发现把目标列表从静态配置变成动态数据。

## 核心原理

服务发现组件从数据源读取目标及元数据，生成目标组。每个目标带有一组 \`__meta_*\` 标签，随后经过 relabel 处理，最终形成抓取目标。

## 常见类型

- **kubernetes_sd_configs**：node、pod、service、endpoints、endpointslice、ingress。
- **file_sd_configs**：从 JSON/YAML 文件读取，适合配置管理系统。
- **dns_sd_configs**：A/SRV 记录。
- **static_configs**：固定地址。
- **云厂商 SD**：EC2、GCE、Azure 等。

## 处理流程

~~~text
数据源 → 目标组（含 __meta_* 标签）
      → relabel_configs（保留/丢弃/改写）
      → 最终 target（地址、标签、抓取参数）
      → scrape loop
~~~

## 配置示例

~~~yaml
scrape_configs:
  - job_name: kubernetes-pods
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: "true"
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_port]
        action: replace
        target_label: __address__
        regex: (.+)
        replacement: $1
~~~

## 常见问题

- RBAC 不足，服务发现无法列出对象。
- 未使用 relabel 过滤，导致抓取所有 Pod。
- 元数据标签直接保留，增加基数。
- 目标更新后旧目标未及时移除。
- 服务发现组件异常时目标列表为空，表现为大量指标消失。

## 相关组件

relabel 决定目标去留；scrape_config 定义任务；Kubernetes SD 依赖 apiserver；file_sd 依赖文件更新。

## 参考资料

- [Service discovery](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#scrape_config)
- [Kubernetes SD](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#kubernetes_sd_config)`,
    { docsUrl: 'https://prometheus.io/docs/prometheus/latest/configuration/configuration/#kubernetes_sd_config' },
  ),
  d(
    'prom-scraping',
    `## 概念定义

抓取（scraping）是 Prometheus 主动从目标端点读取指标的过程。scrape_configs 定义抓什么、怎么抓、保留哪些标签。

## 设计目的

拉取模型让 Prometheus 控制采集节奏，并能通过 up 指标直接判断目标是否可达。

## 核心配置

~~~yaml
global:
  scrape_interval: 30s
  scrape_timeout: 10s
  evaluation_interval: 30s

scrape_configs:
  - job_name: node
    static_configs:
      - targets: ["node-1:9100", "node-2:9100"]
        labels:
          env: prod

  - job_name: api
    metrics_path: /metrics
    scheme: http
    kubernetes_sd_configs:
      - role: endpoints
    relabel_configs:
      - source_labels: [__meta_kubernetes_service_name]
        action: keep
        regex: api
~~~

## 关键参数

- **scrape_interval**：抓取间隔。
- **scrape_timeout**：单次抓取超时，必须小于间隔。
- **metrics_path / scheme**：端点路径和协议。
- **sample_limit**：单次抓取样本上限。
- **honor_labels**：标签冲突处理。
- **relabel_configs / metric_relabel_configs**：抓取前/后的标签处理。

## 抓取生命周期

1. 服务发现生成目标。
2. relabel 过滤和改写目标。
3. 按间隔发起 HTTP 请求。
4. 解析文本/OpenMetrics。
5. 应用 metric relabel。
6. 写入 TSDB，并记录 up、scrape_duration_seconds 等元指标。

## 常见问题

- 抓取间隔小于超时，导致请求重叠和资源浪费。
- 目标响应慢，单次抓取超过 timeout，up 变为 0。
- 样本数超过 sample_limit，整次抓取被丢弃。
- relabel 规则错误，目标被静默丢弃。
- 重复抓取同一目标，造成样本重复或标签冲突。

## 验证方式

在 Prometheus UI 的 Status → Targets 查看每个目标的健康状态、最近错误和抓取耗时；用 \`up{job="..."}\` 和 \`scrape_duration_seconds\` 建立监控。

## 参考资料

- [Configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#scrape_config)
- [Instrumentation](https://prometheus.io/docs/practices/instrumentation/)`,
    { docsUrl: 'https://prometheus.io/docs/prometheus/latest/configuration/configuration/#scrape_config' },
  ),
  d(
    'prom-relabel',
    `## 概念定义

relabel_configs 在抓取前对目标及其元数据标签进行改写、保留或丢弃。

## 设计目的

服务发现会产生大量目标和元数据，relabel 让用户精确控制哪些目标被抓取，以及最终标签长什么样。

## 核心原理

规则按顺序执行。每条规则从 \`source_labels\` 取值，用 \`separator\` 拼接，再用 \`regex\` 匹配，根据 \`action\` 执行替换、保留或丢弃。特殊标签 \`__address__\` 决定抓取地址，\`__metrics_path__\` 决定路径，\`__scheme__\` 决定协议。

## 常用 action

| action | 作用 |
|---|---|
| replace | 用 regex 捕获组替换 target_label |
| keep | 仅保留匹配的目标 |
| drop | 丢弃匹配的目标 |
| labelmap | 把匹配的标签名映射为新标签 |
| labeldrop / labelkeep | 删除/保留匹配的标签 |
| hashmod | 按哈希取模，用于分片 |

## 配置示例

~~~yaml
relabel_configs:
  # 只抓取带 prometheus.io/scrape=true 注解的 Pod
  - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
    action: keep
    regex: "true"

  # 把 Pod 注解中的端口写入抓取地址
  - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
    action: replace
    regex: ([^:]+)(?::\\d+)?;(\\d+)
    replacement: $1:$2
    target_label: __address__

  # 添加命名空间标签
  - source_labels: [__meta_kubernetes_namespace]
    target_label: namespace
~~~

## 与 metric_relabel_configs 的区别

- **relabel_configs**：抓取前，作用于目标和目标标签，可以决定是否抓取。
- **metric_relabel_configs**：抓取后，作用于样本标签，可以丢弃指标或标签，但不能阻止抓取。

## 常见问题

- 正则未使用锚点，导致误匹配。
- keep/drop 顺序错误，目标在后续规则中被意外保留。
- 修改了 \`__address__\` 但端口格式错误。
- 保留过多 \`__meta_*\` 标签，增加存储基数。
- 在 metric relabel 中删除告警依赖的指标。

## 调试方法

Prometheus UI 的 Targets 页面可以展开目标的 final labels 和 discovered labels，直接看到 relabel 前后的差异。用 \`promtool check config\` 校验语法。

## 参考资料

- [relabel_config](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#relabel_config)`,
    { docsUrl: 'https://prometheus.io/docs/prometheus/latest/configuration/configuration/#relabel_config' },
  ),
  d(
    'prom-exporter',
    `## 概念定义

Exporter 把不易直接观测的系统指标转换为 Prometheus 可抓取的文本格式。

## 设计目的

很多系统只提供自有 API 或日志，Exporter 作为适配层，把状态映射为稳定的指标名和标签。

## 核心原理

Exporter 通常暴露 \`/metrics\`，在每次抓取时读取目标系统状态并输出样本。部分 Exporter 采用被动模式（node-exporter 直接读本机），部分采用主动探测（blackbox-exporter 接收 target 参数）。

## 常见 Exporter

- **node-exporter**：主机 CPU、内存、磁盘、网络。
- **kube-state-metrics**：Kubernetes 对象状态。
- **blackbox-exporter**：HTTP/TCP/ICMP/DNS 探测。
- **pushgateway**：接收短任务推送。
- **数据库/中间件 Exporter**：MySQL、PostgreSQL、Redis、Kafka 等。

## 设计规范

- 指标名使用 snake_case，counter 以 \`_total\` 结尾。
- 单位写入指标名，如 \`_seconds\`、\`_bytes\`。
- 标签值有界，避免把动态字符串作为标签。
- 采集失败要通过 \`up\` 或 Exporter 自身指标暴露。
- 控制单次采集耗时，避免超过 scrape_timeout。

## 配置示例

~~~yaml
scrape_configs:
  - job_name: node
    static_configs:
      - targets: ["localhost:9100"]

  - job_name: blackbox-http
    metrics_path: /probe
    params:
      module: [http_2xx]
    static_configs:
      - targets: ["https://example.com"]
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox-exporter:9115
~~~

## 常见问题

- Exporter 与目标版本不兼容，指标缺失或含义变化。
- 采集开销大，影响被监控系统。
- Exporter 自身没有监控，故障时只看到指标消失。
- 指标命名不符合规范，难以聚合。
- 多实例 Exporter 使用相同标签，导致序列冲突。

## 参考资料

- [Exporters and integrations](https://prometheus.io/docs/instrumenting/exporters/)
- [Writing exporters](https://prometheus.io/docs/instrumenting/writing_exporters/)`,
    { docsUrl: 'https://prometheus.io/docs/instrumenting/exporters/' },
  ),
  d(
    'prom-operator',
    `## 组件定位

Prometheus Operator 用 Kubernetes 自定义资源和控制器管理 Prometheus、Alertmanager 及其配置。

## 核心职责

- 根据 Prometheus CR 创建 StatefulSet、Service、ServiceAccount 和配置 Secret。
- 监听 ServiceMonitor、PodMonitor、Probe、ScrapeConfig、PrometheusRule，生成抓取和规则配置。
- 通过 config-reloader 触发热重载。
- 管理 Alertmanager 集群和配置。

## 工作原理

Operator 持续 watch 自定义资源，把用户声明的抓取对象和规则合并为 Prometheus 原生配置，写入 Secret 并挂载到 Prometheus Pod。配置变化时，config-reloader sidecar 检测到文件变化并调用 Prometheus 的 reload 接口。

## 核心资源

| 资源 | 作用 |
|---|---|
| Prometheus | 定义 Prometheus 实例 |
| Alertmanager | 定义 Alertmanager 集群 |
| ServiceMonitor | 按 Service 选择抓取目标 |
| PodMonitor | 按 Pod 选择抓取目标 |
| Probe | 黑盒探测 |
| ScrapeConfig | 原生抓取配置 |
| PrometheusRule | 告警和记录规则 |
| ThanosRuler | 跨集群规则评估 |

## 配置示例

~~~yaml
apiVersion: monitoring.coreos.com/v1
kind: Prometheus
metadata:
  name: main
  namespace: monitoring
spec:
  replicas: 2
  retention: 15d
  serviceAccountName: prometheus
  serviceMonitorSelector:
    matchLabels:
      team: platform
  ruleSelector:
    matchLabels:
      team: platform
  resources:
    requests:
      cpu: 500m
      memory: 2Gi
    limits:
      memory: 4Gi
~~~

## 常见问题

- CR 的 selector 与对象标签不匹配，配置未生效。
- 生成的 Secret 过大，超过 Kubernetes 对象大小限制。
- Operator 与 CRD 版本不兼容，升级后资源无法调和。
- 多个 Prometheus 实例重复抓取同一目标。
- 规则选择器跨命名空间未配置。

## 验证方式

~~~bash
kubectl -n monitoring get prometheus,servicemonitor,podmonitor,probe,prometheusrule
kubectl -n monitoring get secret <prometheus>-prometheus  # 查看生成配置
kubectl -n monitoring logs deploy/prometheus-operator
~~~

## 相关组件

Prometheus CR 是实例声明；ServiceMonitor/PodMonitor 是抓取声明；PrometheusRule 是规则声明；config-reloader 负责重载。

## 参考资料

- [Prometheus Operator](https://prometheus-operator.dev/)
- [API reference](https://prometheus-operator.dev/docs/api-reference/api/)`,
    { docsUrl: 'https://prometheus-operator.dev/' },
  ),
  d(
    'prom-cr',
    `## 资源定义

Prometheus CR 声明一个 Prometheus 实例的副本、存储、资源、抓取选择器、规则选择器和告警配置。

## 解决的问题

它把 Prometheus 的部署和配置从手工 YAML 变成 Kubernetes 原生声明式资源，由 Operator 负责生成实际工作负载和配置。

## 核心字段

- **replicas**：副本数。
- **retention / retentionSize**：本地保留策略。
- **storage**：PVC 模板或 emptyDir。
- **serviceMonitorSelector / podMonitorSelector / probeSelector / scrapeConfigSelector**：选择抓取对象。
- **ruleSelector / ruleNamespaceSelector**：选择规则。
- **alerting**：Alertmanager 端点。
- **remoteWrite / remoteRead**：远端存储。
- **resources**：Prometheus 容器资源。
- **externalLabels**：跨集群唯一标识。

## 生命周期

创建 Prometheus CR 后，Operator 生成 StatefulSet、Service、ServiceAccount、配置 Secret 和规则文件。修改 CR 会触发重新调和和滚动更新。删除 CR 会删除由 Operator 管理的资源，但 PVC 是否保留取决于配置。

## 配置示例

~~~yaml
apiVersion: monitoring.coreos.com/v1
kind: Prometheus
metadata:
  name: main
  namespace: monitoring
spec:
  replicas: 2
  retention: 15d
  storage:
    volumeClaimTemplate:
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 100Gi
  serviceMonitorSelector:
    matchLabels:
      team: platform
  ruleSelector:
    matchLabels:
      team: platform
  alerting:
    alertmanagers:
      - namespace: monitoring
        name: alertmanager-main
        port: web
  externalLabels:
    cluster: prod-a
~~~

## 常见问题

- selector 未匹配任何对象，Prometheus 配置中没有对应 job。
- 未配置 storage，Pod 重建后数据丢失。
- 资源 request/limit 过低，导致 OOM 或 CPU 节流。
- 多副本未配置 externalLabels，Thanos 查询无法去重。
- 配置 Secret 过大，ConfigMap/Secret 大小超限。

## 相关资源

ServiceMonitor/PodMonitor/Probe/ScrapeConfig 提供抓取目标；PrometheusRule 提供规则；Alertmanager CR 提供告警接收端；config-reloader 负责重载。

## 参考资料

- [Prometheus CRD](https://prometheus-operator.dev/docs/api-reference/api/#monitoring.coreos.com/v1.Prometheus)`,
    { docsUrl: 'https://prometheus-operator.dev/docs/api-reference/api/' },
  ),
  d(
    'prom-service-monitor',
    `## 资源定义

ServiceMonitor 声明如何抓取由 Service 暴露的一组端点。

## 解决的问题

它让应用团队用标签声明监控接入，而不需要修改 Prometheus 主配置。

## 核心字段

- **selector**：选择同命名空间（或 namespaceSelector 指定命名空间）的 Service。
- **endpoints**：端口名、路径、间隔、超时、参数、TLS、认证。
- **namespaceSelector**：选择哪些命名空间。
- **jobLabel**：用 Service 标签生成 job 名。
- **relabelings / metricRelabelings**：标签处理。

## 生命周期

创建 ServiceMonitor 后，Operator 检查 Prometheus CR 的 serviceMonitorSelector 是否匹配。匹配后，Operator 读取对应 Service 的 Endpoints，生成抓取配置。Service 或 Pod 变化会自动反映到目标列表。

## 配置示例

~~~yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: api
  namespace: app
  labels:
    team: platform
spec:
  selector:
    matchLabels:
      app: api
  namespaceSelector:
    matchNames: ["app"]
  endpoints:
    - port: http
      path: /metrics
      interval: 30s
      scrapeTimeout: 10s
      relabelings:
        - sourceLabels: [__meta_kubernetes_pod_node_name]
          targetLabel: node
~~~

## 常见问题

- Service 标签与 selector 不匹配。
- endpoint 的 port 名与 Service 端口名不一致。
- namespaceSelector 默认只匹配 ServiceMonitor 所在命名空间。
- Prometheus CR 的 serviceMonitorSelector 未匹配 ServiceMonitor 标签。
- 端口指向错误容器，导致抓取失败。

## 相关资源

Service 定义端点；Endpoints/EndpointSlice 提供实际地址；Prometheus CR 决定是否纳入；PodMonitor 用于无 Service 的场景。

## 参考资料

- [ServiceMonitor](https://prometheus-operator.dev/docs/operator/api/#monitoring.coreos.com/v1.ServiceMonitor)`,
    { docsUrl: 'https://prometheus-operator.dev/docs/operator/api/' },
  ),
  d(
    'prom-pod-monitor',
    `## 资源定义

PodMonitor 直接按标签选择 Pod 并抓取其暴露的指标端口，不依赖 Service。

## 解决的问题

对于 DaemonSet、批处理或没有 Service 的工作负载，PodMonitor 提供了直接的抓取声明方式。

## 核心字段

- **selector**：选择 Pod。
- **namespaceSelector**：选择命名空间。
- **podMetricsEndpoints**：端口名或端口号、路径、间隔、超时、TLS、认证。
- **relabelings / metricRelabelings**：标签处理。

## 生命周期

Operator 根据 PodMonitor 生成基于 \`role: pod\` 的抓取配置。Pod 创建、删除或标签变化会自动更新目标。Pod 必须有明确的容器端口，或通过数字端口指定。

## 配置示例

~~~yaml
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: node-agent
  namespace: monitoring
  labels:
    team: platform
spec:
  selector:
    matchLabels:
      app: node-agent
  namespaceSelector:
    matchNames: ["monitoring"]
  podMetricsEndpoints:
    - port: metrics
      interval: 30s
      relabelings:
        - sourceLabels: [__meta_kubernetes_pod_node_name]
          targetLabel: node
~~~

## 常见问题

- Pod 没有命名端口，endpoint 无法解析。
- selector 匹配到无关 Pod，产生重复或错误指标。
- Pod 未 Ready 时仍被抓取，导致 up=0。
- Prometheus CR 的 podMonitorSelector 未匹配。
- 端口号写错，抓取到错误容器。

## 相关资源

Pod 提供目标；Prometheus CR 决定纳入；ServiceMonitor 更适合有 Service 的应用；relabel 控制最终标签。

## 参考资料

- [PodMonitor](https://prometheus-operator.dev/docs/operator/api/#monitoring.coreos.com/v1.PodMonitor)`,
    { docsUrl: 'https://prometheus-operator.dev/docs/operator/api/' },
  ),
  d(
    'prom-scrape-config-cr',
    `## 资源定义

ScrapeConfig 以 Kubernetes 自定义资源的形式提供原生 scrape_configs 能力。

## 解决的问题

ServiceMonitor 和 PodMonitor 覆盖了常见场景，但集群外目标、特殊服务发现或原生配置项仍需要更灵活的表达。ScrapeConfig 让这些配置也能声明式管理。

## 核心字段

- **staticConfigs**：静态目标。
- **kubernetesSDConfigs**：Kubernetes 服务发现。
- **fileSDConfigs / dnsSDConfigs / httpSDConfigs**：其他发现方式。
- **relabelings / metricRelabelings**：标签处理。
- **metricsPath / scheme / scrapeInterval / scrapeTimeout**：抓取参数。

## 生命周期

Operator 把 ScrapeConfig 渲染为 Prometheus 原生抓取配置，并由 Prometheus CR 的 \`scrapeConfigSelector\` 决定是否纳入。修改 CR 会触发配置重新生成和重载。

## 配置示例

~~~yaml
apiVersion: monitoring.coreos.com/v1alpha1
kind: ScrapeConfig
metadata:
  name: external-api
  namespace: monitoring
  labels:
    team: platform
spec:
  staticConfigs:
    - targets: ["api.example.com:443"]
      labels:
        env: prod
  metricsPath: /metrics
  scheme: https
  scrapeInterval: 60s
~~~

## 常见问题

- Prometheus CR 未配置 scrapeConfigSelector。
- 字段版本与 Operator 版本不兼容。
- 多实例重复抓取同一目标。
- 原生配置项名称与 Prometheus 版本不一致。
- 集群外目标网络不通或证书校验失败。

## 相关资源

Prometheus CR 决定纳入；relabel 处理标签；原生 scrape_configs 是最终形态；ServiceMonitor/PodMonitor 是更上层的封装。

## 参考资料

- [ScrapeConfig](https://prometheus-operator.dev/docs/operator/api/#monitoring.coreos.com/v1alpha1.ScrapeConfig)`,
    { docsUrl: 'https://prometheus-operator.dev/docs/operator/api/' },
  ),
  d(
    'prom-probe',
    `## 资源定义

Probe 声明黑盒探测任务，由 Blackbox Exporter 实际执行探测。

## 解决的问题

它让外部可用性探测也能通过 Kubernetes 声明式管理，而不需要手写复杂的 relabel 配置。

## 核心字段

- **jobName**：任务名。
- **prober.url / prober.path**：Blackbox Exporter 地址。
- **module**：探测模块，如 http_2xx、icmp、tcp_connect、dns。
- **targets.staticConfig / ingress / service**：探测目标来源。
- **relabelings**：标签处理。

## 生命周期

Operator 生成抓取配置，让 Prometheus 抓取 Blackbox Exporter 的 /probe 端点，并把实际目标作为参数传入。Blackbox Exporter 执行探测并返回 probe_success、probe_duration_seconds 等指标。

## 配置示例

~~~yaml
apiVersion: monitoring.coreos.com/v1
kind: Probe
metadata:
  name: website
  namespace: monitoring
  labels:
    team: platform
spec:
  jobName: website
  prober:
    url: blackbox-exporter:9115
  module: http_2xx
  targets:
    staticConfig:
      static:
        - https://example.com
        - https://status.example.com
~~~

## 常见问题

- Blackbox Exporter 未部署或地址错误。
- module 名称不存在。
- 探测源网络策略限制，导致内网目标不可达。
- 超时短于探测耗时，probe_success 为 0。
- 目标需要认证或自定义 Header，module 未配置。

## 相关资源

Blackbox Exporter 执行探测；Prometheus CR 的 probeSelector 决定纳入；ServiceMonitor/PodMonitor 用于抓取应用自身指标。

## 参考资料

- [Probe](https://prometheus-operator.dev/docs/operator/api/#monitoring.coreos.com/v1.Probe)
- [Blackbox Exporter](https://github.com/prometheus/blackbox_exporter)`,
    { docsUrl: 'https://github.com/prometheus/blackbox_exporter' },
  ),
  d(
    'prom-rule-cr',
    `## 资源定义

PrometheusRule 声明告警规则和 Recording Rules，由 Operator 加载到 Prometheus。

## 解决的问题

它让规则和应用配置一起版本化、按标签选择，并通过 Operator 自动热重载。

## 核心字段

- **groups[].name**：规则组名称。
- **groups[].interval**：评估间隔。
- **rules[].record / alert**：记录或告警名称。
- **rules[].expr**：PromQL 表达式。
- **rules[].for**：持续满足时间。
- **rules[].labels / annotations**：标签和说明。

## 生命周期

创建 PrometheusRule 后，Operator 根据 Prometheus CR 的 ruleSelector 和 ruleNamespaceSelector 选择规则，渲染为规则文件并挂载。配置变化触发 config-reloader 重载。

## 配置示例

~~~yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: api-alerts
  namespace: app
  labels:
    team: platform
spec:
  groups:
    - name: api.rules
      interval: 30s
      rules:
        - alert: ApiHighErrorRate
          expr: |
            sum(rate(http_requests_total{job="api",status=~"5.."}[5m]))
              / sum(rate(http_requests_total{job="api"}[5m])) > 0.05
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: "API 错误率超过 5%"
            description: "当前错误率 {{ $value | humanizePercentage }}"
~~~

## 常见问题

- ruleSelector 未匹配，规则未加载。
- 规则跨越命名空间但 ruleNamespaceSelector 未配置。
- 表达式语法错误导致整个规则组失效。
- 规则文件过大，超过 Secret 限制。
- 告警缺少 for，造成抖动。
- 记录规则命名与原始指标冲突。

## 验证方式

在 Prometheus UI 的 Status → Rules 查看规则组和最近评估结果；用 \`promtool check rules\` 校验语法；用表达式浏览器单独验证 expr。

## 相关资源

Prometheus CR 决定规则纳入；Alertmanager 接收告警；Recording Rules 生成新序列；PromQL 是表达式语言。

## 参考资料

- [PrometheusRule](https://prometheus-operator.dev/docs/operator/api/#monitoring.coreos.com/v1.PrometheusRule)
- [Alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)`,
    { docsUrl: 'https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/' },
  ),
  d(
    'prom-generated-config',
    `## 概念定义

生成的配置是 Operator 把 Prometheus CR、ServiceMonitor、PodMonitor、Probe、ScrapeConfig 和 PrometheusRule 合并后得到的 prometheus.yaml 与规则文件。

## 设计目的

用户只声明高层对象，Operator 负责生成语法正确、选择器生效的最终配置，并通过 config-reloader 热重载。

## 工作原理

1. Operator 监听相关 CR 变化。
2. 根据选择器收集抓取对象和规则。
3. 渲染为 Prometheus 原生 YAML。
4. 写入 Secret，挂载到 Prometheus Pod。
5. config-reloader 检测文件变化，调用 /-/reload。
6. Prometheus 校验并加载新配置。

## 配置位置

通常位于 \`<prometheus-name>-prometheus\` Secret 中，挂载到 \`/etc/prometheus/config_out/prometheus.env.yaml\`。规则文件挂载到规则目录。

## 常见问题

- Secret 超过 1MiB 限制，导致配置生成或挂载失败。
- 生成配置语法错误，Prometheus 拒绝重载。
- config-reloader 未运行或权限不足。
- 选择器不匹配，生成配置中没有预期 job。
- 多个 Operator 实例同时管理同一资源，产生冲突。

## 排查方式

~~~bash
kubectl -n monitoring get secret <prometheus>-prometheus -o jsonpath='{.data.prometheus\\.yaml}' | base64 -d
kubectl -n monitoring logs <prometheus-pod> -c config-reloader
kubectl -n monitoring logs <prometheus-pod> -c prometheus
~~~

查看最终配置比猜测 CR 是否生效更直接。

## 相关组件

Prometheus Operator 生成配置；config-reloader 触发热重载；Prometheus Server 校验并加载；ServiceMonitor/PodMonitor/PrometheusRule 是输入。

## 参考资料

- [Prometheus Operator config](https://prometheus-operator.dev/docs/platform/troubleshooting/)`,
    { docsUrl: 'https://prometheus-operator.dev/docs/platform/troubleshooting/' },
  ),
  d(
    'prom-alertmanager',
    `## 组件定位

Alertmanager 接收 Prometheus 产生的告警，负责去重、分组、抑制、静默和路由到通知渠道。

## 核心职责

- 对相同告警去重。
- 按 group_by 合并通知。
- 按 route 树分发到 receiver。
- 按 inhibit_rules 抑制低优先级告警。
- 管理静默窗口。
- 在集群模式下同步通知状态。

## 工作原理

Prometheus 把 firing 告警推送到 Alertmanager。Alertmanager 根据标签匹配路由，聚合后发送通知。通知状态保存在本地，多个副本通过 gossip 同步，避免重复发送。配置通过 Secret 或文件挂载，修改后需要重载。

## 关键配置

~~~yaml
route:
  receiver: default
  group_by: [alertname, cluster, service]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers: [severity="critical"]
      receiver: oncall
      continue: false

receivers:
  - name: default
    slack_configs:
      - channel: "#alerts"
  - name: oncall
    pagerduty_configs:
      - service_key: <key>

inhibit_rules:
  - source_matchers: [alertname="ClusterDown"]
    target_matchers: [severity="warning"]
    equal: [cluster]
~~~

## 高可用

多个 Alertmanager 副本组成集群，通过 gossip 同步静默和通知日志。Prometheus 同时向所有副本发送告警，副本之间去重。生产环境建议至少 3 副本，并持久化数据目录。

## 常见问题

- 配置错误导致告警静默丢失。
- group_by 过细造成通知风暴。
- 未配置持久化，重启后静默丢失。
- 副本之间无法通信，导致重复通知。
- receiver 凭证错误或渠道限流。

## 排查方式

访问 Alertmanager UI 查看告警、静默和通知状态；检查 \`/-/ready\` 和集群状态；查看日志中的通知失败原因；用 \`amtool check-config\` 校验配置。

## 参考资料

- [Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/)
- [Configuration](https://prometheus.io/docs/alerting/latest/configuration/)`,
    { docsUrl: 'https://prometheus.io/docs/alerting/latest/alertmanager/' },
  ),
  d(
    'prom-am-config',
    `## 概念定义

Alertmanager 配置由 route 树、receivers、inhibit_rules、templates 和全局参数组成，决定告警如何被分组、抑制和发送。

## 设计目的

把“告警如何通知人”与“何时产生告警”分离，让通知策略可以独立调整。

## 核心结构

- **route**：匹配告警标签并分发到 receiver。
- **receivers**：通知渠道及其配置。
- **inhibit_rules**：高优先级告警抑制低优先级告警。
- **templates**：自定义通知内容。
- **global**：SMTP 等全局配置。

## 路由机制

从根 route 开始，按 matchers 匹配子路由。命中后发送到 receiver；若 \`continue: true\`，继续匹配后续兄弟路由。没有命中的告警使用根 route 的 receiver。

## 分组与节奏

- **group_by**：决定哪些告警合并为一条通知。
- **group_wait**：首次通知前的等待时间，用于收集同组告警。
- **group_interval**：同组新告警的发送间隔。
- **repeat_interval**：未恢复告警的重复通知间隔。

## 配置示例

~~~yaml
route:
  receiver: default
  group_by: [alertname, service]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers: [team="payments", severity=~"critical|warning"]
      receiver: payments
    - matchers: [severity="critical"]
      receiver: oncall

receivers:
  - name: default
    webhook_configs:
      - url: http://alert-sink:8080/alerts
  - name: payments
    email_configs:
      - to: payments@example.com
  - name: oncall
    pagerduty_configs:
      - service_key: <key>
~~~

## 常见问题

- matcher 语法错误，配置无法加载。
- 根 route 未设置 receiver。
- continue 使用不当，告警重复或遗漏。
- group_by 包含高基数字段，通知无法合并。
- 模板字段拼写错误，通知渲染失败。
- 抑制规则 equal 标签缺失，抑制不生效。

## 验证方式

使用 \`amtool check-config alertmanager.yml\` 校验；在 UI 中用 routing 测试功能模拟标签；观察 Silences 和 Notifications 页面。

## 参考资料

- [Alertmanager configuration](https://prometheus.io/docs/alerting/latest/configuration/)`,
    { docsUrl: 'https://prometheus.io/docs/alerting/latest/configuration/' },
  ),
  d(
    'prom-alert-routing',
    `## 概念定义

告警路由是 Alertmanager 根据标签把告警分发到一个或多个 receiver 的规则树。

## 设计目的

不同团队、环境和严重级别需要不同的通知渠道和响应节奏。路由把这一策略从代码中解耦出来。

## 核心原理

根 route 匹配所有告警，子 route 通过 matchers 进一步筛选。匹配成功后发送到指定 receiver。默认一旦匹配就停止；设置 \`continue: true\` 可以继续匹配后续路由。

## 路由设计建议

- 先按团队或服务分区，再按严重级别细分。
- 根 route 指向一个兜底 receiver，避免告警丢失。
- 避免过深嵌套，保持可读性。
- 对 critical 使用电话/值班渠道，warning 使用 IM/邮件。
- 用 inhibit_rules 处理同一故障的上下游告警。

## 配置示例

~~~yaml
route:
  receiver: fallback
  routes:
    - matchers: [team="platform"]
      receiver: platform
      routes:
        - matchers: [severity="critical"]
          receiver: platform-oncall
        - matchers: [severity="warning"]
          receiver: platform-chat

    - matchers: [team="payments"]
      receiver: payments
      continue: true

    - matchers: [env="prod", severity="critical"]
      receiver: global-oncall
~~~

## 常见问题

- 子路由 matcher 不匹配，告警落到兜底渠道。
- continue 导致同一告警发送多次。
- 路由顺序影响匹配结果。
- receiver 名称拼写错误，配置校验失败。
- 没有兜底 receiver，未匹配告警被丢弃。

## 验证方式

在 Alertmanager UI 的 Status 页面查看配置树；用 \`amtool config routes test\` 输入标签模拟路由；发送测试告警验证端到端。

## 相关概念

分组决定“合并多少”，路由决定“发给谁”，抑制决定“哪些不发”，静默决定“暂时不发”。

## 参考资料

- [Alertmanager routing](https://prometheus.io/docs/alerting/latest/configuration/#route)`,
    { docsUrl: 'https://prometheus.io/docs/alerting/latest/configuration/#route' },
  ),
  d(
    'prom-remote-write',
    `## 概念定义

Remote Write 让 Prometheus 把本地样本持续推送到兼容的远端存储。

## 设计目的

单机 TSDB 容量有限，跨集群查询也需要集中存储。Remote Write 在不改变抓取模型的前提下扩展保留和查询能力。

## 核心原理

Prometheus 的 WAL watcher 读取新写入的样本，按队列分批发送到远端。发送失败会重试；远端不可用时会背压，WAL 可能堆积。每个 remote_write 配置有独立的队列和分片。

## 关键配置

~~~yaml
remote_write:
  - url: https://metrics.example.com/api/v1/write
    name: primary
    remote_timeout: 30s
    write_relabel_configs:
      - source_labels: [__name__]
        regex: "go_.*"
        action: drop
    queue_config:
      capacity: 10000
      max_shards: 50
      max_samples_per_send: 2000
      batch_send_deadline: 5s
      min_backoff: 30ms
      max_backoff: 5s
~~~

## 关键参数

- **url**：远端写入端点。
- **write_relabel_configs**：发送前过滤样本。
- **queue_config**：队列容量、分片数、批量大小和退避。
- **headers / auth / tls_config**：认证和传输安全。
- **metadata_config**：是否发送指标元数据。

## 常见问题

- 远端不可用导致队列积压和 WAL 增长。
- 分片过多压垮远端，分片过少吞吐不足。
- 未过滤高基数指标，远端成本爆炸。
- 认证或证书配置错误，持续重试。
- 多个远端重复写入，造成重复数据。

## 监控指标

关注 \`prometheus_remote_storage_samples_pending\`、\`prometheus_remote_storage_samples_failed_total\`、\`prometheus_remote_storage_queue_highest_sent_timestamp_seconds\` 和 WAL 大小。

## 相关组件

TSDB 提供样本；WAL 是传输来源；Thanos/Mimir/VictoriaMetrics 是常见接收端；Remote Read 用于查询历史数据。

## 参考资料

- [Remote write](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#remote_write)
- [Remote write tuning](https://prometheus.io/docs/practices/remote_write/)`,
    { docsUrl: 'https://prometheus.io/docs/practices/remote_write/' },
  ),
  d(
    'prom-federation',
    `## 概念定义

联邦（federation）让上级 Prometheus 从下级 Prometheus 的 /federate 端点拉取选定的时间序列。

## 设计目的

在多集群或分层监控中，上级只需要关键聚合指标，而不是所有原始序列。联邦提供了一种轻量的分层汇总方式。

## 核心原理

下级 Prometheus 暴露 \`/federate?match[]=<selector>\`，按选择器返回当前样本。上级把它当作普通抓取目标，通过 \`params.match[]\` 指定要拉取的指标。

## 配置示例

~~~yaml
scrape_configs:
  - job_name: federate-cluster-a
    honor_labels: true
    metrics_path: /federate
    params:
      match[]:
        - '{__name__=~"job:.*"}'
        - 'up{job="api"}'
    static_configs:
      - targets: ["prometheus-a:9090"]
~~~

## 适用场景

- 多集群汇总关键 SLO 指标。
- 分层监控，上级只保留聚合结果。
- 临时跨集群查询，不要求长期保留。

## 不适用场景

- 长期存储：联邦不保存历史，只拉取当前样本。
- 全量原始指标汇总：会把下级的高基数压力带到上级。
- 需要全局查询和去重：应使用 Thanos/Mimir。

## 常见问题

- match[] 过宽，拉取大量原始序列。
- honor_labels 设置不当，标签冲突。
- 下级不可达时上级出现抓取失败。
- 误以为联邦会保留历史数据。
- 多层联邦导致延迟和重复。

## 相关组件

Prometheus Server 提供 /federate；relabel 控制标签；Remote Write 更适合长期集中存储；Thanos Query 提供全局查询。

## 参考资料

- [Federation](https://prometheus.io/docs/prometheus/latest/federation/)`,
    { docsUrl: 'https://prometheus.io/docs/prometheus/latest/federation/' },
  ),
  d(
    'prom-scale',
    `## 概念定义

长期存储与扩展解决单机 Prometheus 的容量、跨集群查询和高可用问题。

## 设计目的

单机 Prometheus 的本地 TSDB 有保留上限，也无法天然跨集群查询。扩展方案把存储和查询从单个实例中拆出来。

## 常见方案

| 方案 | 特点 | 适用场景 |
|---|---|---|
| Thanos | 对象存储、全局查询、降采样 | 多集群、低成本长期保留 |
| Grafana Mimir | 水平扩展、多租户 | 大规模共享指标平台 |
| VictoriaMetrics | 高压缩、兼容 Prometheus | 高性能长期存储 |
| Remote Read | 查询远端历史 | 保留本地写入、远端读历史 |

## 核心模式

1. Prometheus 本地保留短期数据，保证查询性能。
2. 通过 Remote Write 把样本送到长期存储。
3. 查询层聚合多个 Prometheus 和长期存储。
4. 用 external_labels 区分集群和副本。
5. HA 副本在查询层去重。

## 选型考虑

- 数据规模和增长率。
- 查询延迟要求。
- 多租户和权限需求。
- 运维复杂度和成本。
- 是否需要降采样和长期合规保留。

## 常见问题

- 把 federation 当长期存储。
- Remote Write 队列积压，导致数据延迟。
- 查询层跨大量块，延迟升高。
- 未设置 external_labels，副本数据无法去重。
- 对象存储生命周期配置错误，块被提前删除。

## 相关组件

Remote Write 是数据出口；Thanos/Mimir/VictoriaMetrics 是接收和查询层；Grafana 连接全局查询端点；Prometheus HA 提供本地冗余。

## 参考资料

- [Thanos](https://thanos.io/)
- [Grafana Mimir](https://grafana.com/oss/mimir/)
- [VictoriaMetrics](https://victoriametrics.com/)`,
    { docsUrl: 'https://thanos.io/' },
  ),
  d(
    'prom-thanos',
    `## 组件定位

Thanos 为 Prometheus 提供全局查询、对象存储长期保留、降采样和跨集群规则评估。

## 核心组件

- **Sidecar**：与 Prometheus 同 Pod 运行，上传 TSDB 块到对象存储。
- **Query**：聚合多个 Prometheus 和 Store Gateway，提供全局 PromQL。
- **Store Gateway**：从对象存储读取历史块。
- **Compactor**：合并块、降采样、执行保留策略。
- **Ruler**：基于全局数据评估规则。
- **Bucket**：对象存储抽象层。

## 工作原理

Sidecar 定期把 Prometheus 生成的块上传到对象存储。Query 同时查询本地 Prometheus（实时数据）和 Store Gateway（历史块），按 external_labels 去重。Compactor 在后台合并小块并生成 5 分钟/1 小时降采样。

## 配置示例

~~~yaml
# Prometheus sidecar 关键参数
thanos-sidecar:
  --tsdb.path=/prometheus
  --objstore.config-file=/etc/thanos/bucket.yaml
  --grpc-address=0.0.0.0:10901
  --http-address=0.0.0.0:10902
~~~

~~~yaml
# bucket.yaml
type: S3
config:
  bucket: metrics-prod
  endpoint: s3.example.com
  region: us-east-1
~~~

## 常见问题

- 对象存储权限或 endpoint 配置错误，块上传失败。
- Compactor 单实例运行，成为瓶颈。
- 查询跨大量块，延迟升高。
- external_labels 不一致，去重失效。
- 降采样未启用，长期查询成本高。
- 块上传延迟，实时查询和历史查询出现缺口。

## 运维要点

监控 sidecar 上传延迟、Store Gateway 查询延迟、Compactor 运行状态和对象存储成本。Compactor 需要单实例或分片运行，避免并发修改同一 bucket。

## 相关组件

Prometheus 产生块；Remote Write 是另一种数据入口；Query 对接 Grafana；Ruler 连接 Alertmanager。

## 参考资料

- [Thanos 文档](https://thanos.io/tip/thanos/getting-started.md/)`,
    { docsUrl: 'https://thanos.io/' },
  ),
  d(
    'prom-ha',
    `## 实践定义

Prometheus 高可用通过多副本抓取相同目标、查询层去重，以及 Alertmanager 集群来实现。

## 适用场景

生产监控不能接受单点故障；跨可用区部署需要容忍实例或区域故障。

## 实施前提

- 至少两个 Prometheus 副本，配置一致。
- 每个副本有独立的持久化存储。
- 设置唯一的 external_labels 区分副本和集群。
- 查询层支持去重（Thanos Query、Mimir 等）。
- Alertmanager 至少 3 副本并组成集群。

## 实施步骤

1. 使用相同配置部署两个 Prometheus 副本。
2. 为每个副本配置 persistent volume。
3. 设置 external_labels，如 \`replica: a\`、\`cluster: prod\`。
4. 配置 Remote Write 到全局存储，或使用 Thanos Sidecar。
5. 部署 Alertmanager 集群，Prometheus 同时指向所有副本。
6. 在查询层按 \`cluster\`、\`replica\` 去重。

## 验证方式

- 停止一个 Prometheus 副本，查询仍可用。
- 停止一个 Alertmanager 副本，通知不中断。
- 检查查询结果没有重复序列。
- 对比两个副本的抓取目标数量和规则状态。

## 风险与回滚

多副本会增加抓取和存储成本。配置不一致会导致数据差异。远程写重复可能放大后端压力。回滚时先确认查询层和数据完整性。

## 常见问题

- 副本使用相同 external_labels，去重失效。
- 只做 Prometheus 副本，Alertmanager 仍是单点。
- 查询层没有去重，图表出现重复线。
- 副本共享存储，失去冗余意义。
- 配置漂移导致两个副本抓取不同目标。

## 参考资料

- [High availability](https://prometheus.io/docs/introduction/faq/#can-prometheus-be-made-highly-available)
- [Alertmanager clustering](https://prometheus.io/docs/alerting/latest/alertmanager/#high-availability)`,
    { docsUrl: 'https://prometheus.io/docs/introduction/faq/#can-prometheus-be-made-highly-available' },
  ),
  d(
    'prom-backup',
    `## 实践定义

Prometheus 备份包括 TSDB 数据快照、配置文件和规则文件；长期存储方案还需要保护对象存储中的块。

## 适用场景

灾备、集群迁移、升级前保护、误删恢复。

## 实施前提

- 明确 RPO/RTO。
- 准备独立备份存储。
- 记录 Prometheus 版本、配置和 external_labels。
- 定期演练恢复，而不仅是备份成功。

## 操作步骤

1. 启用 admin API。
2. 调用 snapshot API 创建一致性快照。
3. 备份 prometheus.yml、规则文件和 Alertmanager 配置。
4. 将快照上传到独立存储。
5. 在隔离环境恢复并验证查询。
6. 对 Thanos/Mimir 方案，保护对象存储和 bucket 配置。

~~~bash
curl -X POST http://localhost:9090/api/v1/admin/tsdb/snapshot
# 返回 {"data":{"name":"20240101T000000Z-..."}}

tar czf prometheus-snapshot.tar.gz -C /prometheus/snapshots <name>
~~~

## 验证方式

- 快照能在新实例中加载。
- 历史查询返回预期数据。
- 规则和告警配置完整。
- 恢复耗时满足 RTO。

## 风险与回滚

快照会占用额外磁盘，避免在磁盘紧张时执行。恢复时要使用兼容的 Prometheus 版本。Remote Write 方案不能替代本地快照，因为远端可能缺少未发送的数据。

## 常见问题

- 只备份数据不备份配置。
- 快照未验证，恢复时发现损坏。
- 磁盘空间不足导致快照失败。
- 恢复后 retention 设置错误，历史数据被立即删除。
- 忽略 Alertmanager 静默和通知状态。

## 参考资料

- [Snapshot API](https://prometheus.io/docs/prometheus/latest/querying/api/#snapshot)
- [Storage](https://prometheus.io/docs/prometheus/latest/storage/)`,
    { docsUrl: 'https://prometheus.io/docs/prometheus/latest/querying/api/#snapshot' },
  ),
  d(
    'prom-kubernetes-sd',
    `## 概念定义

Kubernetes 服务发现让 Prometheus 通过 Kubernetes API 自动获得抓取目标。

## 设计目的

Pod、Service 和 Endpoint 会动态变化，手工维护目标列表不可行。Kubernetes SD 把 API 对象转换为带元数据的目标。

## 支持的角色

- **node**：节点。
- **pod**：Pod。
- **service**：Service。
- **endpoints**：Endpoints。
- **endpointslice**：EndpointSlice。
- **ingress**：Ingress。

## 工作原理

Prometheus 使用 ServiceAccount 访问 apiserver，按 role 列出对象。每个对象生成一组目标，并附带 \`__meta_kubernetes_*\` 标签。用户通过 relabel 选择目标、改写地址和保留标签。

## 配置示例

~~~yaml
scrape_configs:
  - job_name: kubernetes-nodes
    kubernetes_sd_configs:
      - role: node
    relabel_configs:
      - action: labelmap
        regex: __meta_kubernetes_node_label_(.+)
~~~

## RBAC 要求

需要 list/watch nodes、pods、services、endpoints、endpointslices、ingresses 等资源。权限不足时服务发现失败，表现为目标列表为空或部分缺失。

## 常见问题

- RBAC 不足，发现不到对象。
- 未过滤角色，抓取所有 Pod 或节点。
- 元数据标签全部保留，导致基数膨胀。
- 端口未命名或注解缺失，无法确定抓取地址。
- apiserver 限流导致发现延迟。

## 相关组件

relabel 处理目标和标签；scrape_config 定义任务；ServiceMonitor/PodMonitor 是 Operator 层的封装；kube-state-metrics 提供对象状态指标。

## 参考资料

- [Kubernetes SD configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#kubernetes_sd_config)`,
    { docsUrl: 'https://prometheus.io/docs/prometheus/latest/configuration/configuration/#kubernetes_sd_config' },
  ),
  d(
    'prom-node-exporter',
    `## 组件定位

node-exporter 暴露主机层 CPU、内存、磁盘、文件系统、网络和内核指标，通常以 DaemonSet 或 systemd 服务运行。

## 核心职责

- 读取 /proc、/sys 和系统调用。
- 以 Prometheus 格式暴露指标。
- 支持按 collector 开关控制采集范围。
- 通过 textfile collector 暴露自定义指标。

## 工作原理

node-exporter 是无状态的被动采集器。每次 /metrics 请求时，启用的 collector 读取本机状态并输出样本。它必须访问宿主机命名空间，容器部署时需要挂载 /proc、/sys 和根文件系统，并使用 host network。

## 关键指标

- \`node_cpu_seconds_total\`：CPU 时间。
- \`node_memory_MemAvailable_bytes\`：可用内存。
- \`node_filesystem_avail_bytes\`：文件系统可用空间。
- \`node_disk_io_time_seconds_total\`：磁盘 IO。
- \`node_network_receive_bytes_total\`：网络流量。
- \`node_load1\`：负载。

## 配置示例

~~~yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-exporter
spec:
  selector:
    matchLabels:
      app: node-exporter
  template:
    metadata:
      labels:
        app: node-exporter
    spec:
      hostNetwork: true
      hostPID: true
      containers:
        - name: node-exporter
          image: prom/node-exporter:v1.8.2
          args:
            - --path.procfs=/host/proc
            - --path.sysfs=/host/sys
            - --path.rootfs=/host/root
          volumeMounts:
            - name: proc
              mountPath: /host/proc
              readOnly: true
            - name: sys
              mountPath: /host/sys
              readOnly: true
            - name: root
              mountPath: /host/root
              readOnly: true
      volumes:
        - name: proc
          hostPath:
            path: /proc
        - name: sys
          hostPath:
            path: /sys
        - name: root
          hostPath:
            path: /
~~~

## 常见问题

- 容器未挂载 host 路径，指标显示容器而非宿主机。
- 未使用 host network，网络指标不准确。
- 重复部署或重复抓取，导致序列冲突。
- textfile 文件权限或目录配置错误。
- 高基数挂载点导致序列膨胀。

## 相关组件

Prometheus 抓取 node-exporter；kube-state-metrics 提供对象状态；Grafana 使用节点指标构建资源看板。

## 参考资料

- [node_exporter](https://github.com/prometheus/node_exporter)`,
    { docsUrl: 'https://github.com/prometheus/node_exporter' },
  ),
  d(
    'prom-kube-state-metrics',
    `## 组件定位

kube-state-metrics 从 Kubernetes API 读取对象状态，暴露 Deployment、Pod、PVC、Job 等资源指标。

## 核心职责

- watch Kubernetes 对象。
- 把对象状态转换为 \`kube_*\` 指标。
- 支持按资源类型和标签过滤。
- 暴露自定义资源指标。

## 工作原理

kube-state-metrics 使用 ServiceAccount 访问 apiserver，维护对象缓存，并在 /metrics 请求时输出指标。它不采集容器资源使用率，那是 metrics-server 或 cAdvisor 的职责。

## 关键指标

- \`kube_deployment_status_replicas_available\`
- \`kube_pod_status_phase\`
- \`kube_pod_container_status_restarts_total\`
- \`kube_persistentvolumeclaim_status_phase\`
- \`kube_job_status_failed\`
- \`kube_node_status_condition\`

## 配置示例

~~~yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kube-state-metrics
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kube-state-metrics
  template:
    metadata:
      labels:
        app: kube-state-metrics
    spec:
      serviceAccountName: kube-state-metrics
      containers:
        - name: kube-state-metrics
          image: registry.k8s.io/kube-state-metrics/kube-state-metrics:v2.13.0
          args:
            - --resources=pods,deployments,statefulsets,daemonsets,jobs,nodes,persistentvolumeclaims
            - --metric-labels-allowlist=pods=[app,team]
~~~

## 常见问题

- RBAC 不足，部分资源指标缺失。
- 开启所有资源和高基数标签，导致内存和存储压力。
- 与 metrics-server 混淆，误以为它提供 CPU/内存使用率。
- 大规模集群下 watch 压力大，需要分片。
- 指标标签包含动态值，导致基数爆炸。

## 相关组件

apiserver 提供对象数据；Prometheus 抓取指标；metrics-server 提供资源使用率；Grafana 构建工作负载看板。

## 参考资料

- [kube-state-metrics](https://github.com/kubernetes/kube-state-metrics)`,
    { docsUrl: 'https://github.com/kubernetes/kube-state-metrics' },
  ),
];
