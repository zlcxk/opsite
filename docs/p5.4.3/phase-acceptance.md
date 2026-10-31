# P5.4.3 验收记录：非 Kubernetes 技术知识深化与关联校准

日期：2026-11-01  
范围：20 篇非 Kubernetes P2 文档、29 篇 Prometheus 文档复核、软件映射核对、P2 关系复核  
依据：[技术知识标准](../p5.4/technical-knowledge-standard.md)、[P5.4.2 版本治理规范](../p5.4.2/version-governance.md)

## 1. 范围与约束

本阶段没有修改 Kubernetes 核心知识：

- 未修改 `server/services/tech-content-kubernetes.ts`。
- 未修改 `server/services/tech-content-kubernetes-docs.ts`。
- 未修改 Kubernetes 节点的 `applicableVersions`、正文、参考链接和关系。
- 未为“统一版本号”批量改动 Kubernetes 内容。
- `git diff --name-only` 未出现上述两个文件。

没有新增节点 ID、数据库表、字段、API、UI 模块或审批流程。所有修订文档保持 `draft`，未执行 Verify，未标记 Complete。

## 2. 20 篇非 Kubernetes 文档

20 篇文档全部来自现有 P2 节点，统一采用八段结构：

1. 技术定位
2. 设计原理
3. 工作机制
4. 关键配置与实践
5. 版本差异与兼容性
6. 常见问题与限制
7. 技术关联
8. 参考资料

全部文档正文长度大于 1,500 字符，内容版本为 2，带旧正文 SHA-256 和 3 条官方来源。

| 节点 | 版本 | 正文字符数 | 官方来源 | `applicableVersions` |
| --- | --- | --- | --- | --- |
| `db-mysql` | 2 | 2588 | 3 | MySQL 8.4 LTS / 9.7 LTS（核实基线 9.7 LTS；8.0 已于 2026-04-30 EOL） |
| `db-postgresql` | 2 | 2314 | 3 | PostgreSQL 16–18（核实基线 18；15 仍在支持期） |
| `db-redis` | 2 | 2401 | 3 | Redis 8.10.x / Valkey 9.1.x（核实基线 8.10.3 / 9.1.3；两条版本线独立） |
| `db-clickhouse` | 2 | 2313 | 3 | ClickHouse 26.8 LTS / 26.10（核实基线 26.8 LTS） |
| `msg-kafka` | 2 | 2329 | 3 | Apache Kafka 4.x（核实基线 4.4.0；4.0 起仅支持 KRaft） |
| `msg-rocketmq` | 2 | 2260 | 3 | Apache RocketMQ 4.x / 5.x（核实基线 5.5.1） |
| `msg-rabbitmq` | 2 | 2048 | 3 | RabbitMQ 4.x（核实基线 4.4.0；4.0 起不再支持经典镜像队列） |
| `msg-pulsar` | 2 | 2256 | 3 | Apache Pulsar 4.x / 5.x（核实基线 5.0.1） |
| `obs-grafana` | 2 | 2177 | 3 | Grafana 12.x / 13.x（核实基线 13.3.0） |
| `obs-loki` | 2 | 2207 | 3 | Grafana Loki 3.x（核实基线 3.7.9） |
| `obs-otel` | 2 | 2439 | 3 | OpenTelemetry Collector 0.1xx（核实基线 0.164.0；尚未发布 1.0） |
| `obs-skywalking` | 2 | 2193 | 3 | Apache SkyWalking 10.x / 11.x（核实基线 11.0.0） |
| `del-argocd` | 2 | 2346 | 3 | Argo CD 3.x（核实基线 3.5.6） |
| `del-harbor` | 2 | 2074 | 3 | Harbor 2.13–2.15（核实基线 2.15.4） |
| `del-terraform` | 2 | 2325 | 3 | Terraform 1.x（核实基线 1.17.1；provider 版本独立） |
| `del-ansible` | 2 | 2300 | 3 | ansible-core 2.19–2.21（核实基线 2.21.5；collection 版本独立） |
| `infra-istio` | 2 | 2393 | 3 | Istio 1.29–1.31（核实基线 1.31.3） |
| `infra-envoy` | 2 | 2126 | 3 | Envoy 1.38–1.40（核实基线 1.40.2） |
| `infra-cert-manager` | 2 | 2377 | 3 | cert-manager 1.19–1.21（核实基线 1.21.3） |
| `infra-podman` | 2 | 2302 | 3 | Podman 5.x / 6.x（核实基线 6.1.4） |

### 2.1 分批实施

| 批次 | 领域 | 节点 |
| --- | --- | --- |
| P5.4.3.1 | 数据库与缓存 | `db-mysql`、`db-postgresql`、`db-redis`、`db-clickhouse` |
| P5.4.3.2 | 消息与流 | `msg-kafka`、`msg-rocketmq`、`msg-rabbitmq`、`msg-pulsar` |
| P5.4.3.3 | 可观测性与日志 | `obs-grafana`、`obs-loki`、`obs-otel`、`obs-skywalking` |
| P5.4.3.4 | 发布与基础设施自动化 | `del-argocd`、`del-harbor`、`del-terraform`、`del-ansible` |
| P5.4.3.5 | 云原生基础设施 | `infra-istio`、`infra-envoy`、`infra-cert-manager`、`infra-podman` |

### 2.2 内容校核重点

| 主题 | 已写入的关键机制 |
| --- | --- |
| MySQL | 聚簇索引、二级索引回表、redo/undo/binlog、Read View、Next-Key Lock、组提交与崩溃恢复 |
| PostgreSQL | 堆表多版本、VACUUM 与膨胀、WAL、检查点、B-tree/GIN/GiST/BRIN、物理与逻辑复制 |
| Redis / Valkey | 命令串行执行与 IO 多线程边界、RDB/AOF、Sentinel、Cluster 16384 槽、大 key、分布式锁边界、Valkey 独立版本线 |
| ClickHouse | MergeTree part、分区键/排序键/主键区别、稀疏索引与 granule、Keeper、分布式表、Mutation |
| Kafka | 分区日志、ISR 与 min.insync.replicas、acks、KRaft、消费者组、EOS 的事务边界 |
| RocketMQ | NameServer/Broker、CommitLog 与 ConsumeQueue、4.x 与 5.x 的 Proxy/gRPC/POP 差异、事务与延迟消息 |
| RabbitMQ | AMQP 交换机路由、发布确认/队列持久化/消费确认三阶段、经典队列与仲裁队列、prefetch/死信 |
| Pulsar | Broker 与 BookKeeper 分离、ledger、四种订阅、分层存储、跨地域复制、事务边界 |
| Grafana | 数据源代理、仪表盘 JSON、provisioning、统一告警、通知策略、HA 边界 |
| Loki | 只索引标签、日志流与高基数风险、chunk/对象存储、LogQL、Compactor |
| OTel Collector | receiver/processor/exporter/connector/pipeline、agent 与 gateway、memory_limiter、队列与重试 |
| SkyWalking | Agent/OAP/存储、服务-实例-端点模型、trace segment、上下文传播、存储与采样 |
| Argo CD | Application/AppProject、Git 期望状态、同步与漂移、钩子与 Sync Waves、多集群与 HA |
| Harbor | OCI manifest/layer、项目 RBAC、复制、扫描、签名、保留策略与垃圾回收 |
| Terraform | 状态文件、provider、plan/apply、远程后端与锁、模块、import、漂移 |
| Ansible | 无代理 SSH、inventory、playbook/role、模块幂等、handler、check mode 边界 |
| Istio | istiod、sidecar、ambient 的 ztunnel/waypoint、mTLS、VirtualService/DestinationRule、AuthorizationPolicy |
| Envoy | listener/filter chain/route/cluster/endpoint、xDS、超时重试熔断、管理端点 |
| cert-manager | Issuer/ClusterIssuer、Certificate/CertificateRequest、ACME HTTP-01/DNS-01、renewBefore、Secret 轮换 |
| Podman | 无守护进程、rootless 用户命名空间、Pod、Quadlet/systemd、与 Docker 和 Kubernetes 的边界 |

## 3. Prometheus 文档复核

29 篇现有文档均保留原有版本章节，没有做无意义的整篇重写。

| 项目 | 结果 |
| --- | --- |
| 文档数量 | 29 |
| 版本章节 | 29 篇均存在，且位于 `## 参考资料` 之前 |
| 版本章节内容 | Prometheus Server、Operator、Alertmanager、Exporter、Thanos 的生命周期分开描述 |
| `/latest/` 依赖 | 正文不再使用 `prometheus.io/docs/prometheus/latest/` 或 `alerting/latest/` 作为唯一来源 |
| 过短文档 | 3 篇补足到 1,500 字符以上 |
| 官方链接 | 修复 Prometheus Operator API 文档路径 |

补足的三篇：

| 节点 | 原长度 | 新长度 | 内容版本 | 补充内容 |
| --- | --- | --- | --- | --- |
| `prom-federation` | 1439 | 1541 | 3 | 父子抓取间隔、时间戳对齐、标签冲突和层级控制 |
| `prom-scale` | 1437 | 1527 | 3 | Remote Write 非同步复制、去重键、external_labels、故障切换 |
| `prom-backup` | 1463 | 1586 | 3 | 备份窗口与 retention/compactor、对象存储生命周期、恢复后的标签核对 |

这三篇的 `replacesContentHash` 已改为修订前正文哈希，版本从 2 提升到 3。其余 26 篇保持版本 2，不做无关改动。

Prometheus Operator 的 API 参考路径从已失效的 `/docs/operator/api/` 更新为 `/docs/api-reference/api/`，同时覆盖 `ServiceMonitor`、`PodMonitor`、`Probe`、`PrometheusRule`、`ScrapeConfig` 等链接。

## 4. 软件映射核对

20 个节点的 `softwareSlug` 全部存在于 `server/catalog.ts`，且没有两个节点映射到同一个软件。

| 节点 | `softwareSlug` | 目录产品 |
| --- | --- | --- |
| `db-mysql` | `mysql` | MySQL |
| `db-postgresql` | `postgresql` | PostgreSQL |
| `db-redis` | `redis` | Redis |
| `db-clickhouse` | `clickhouse` | ClickHouse |
| `msg-kafka` | `kafka` | Apache Kafka |
| `msg-rocketmq` | `rocketmq` | Apache RocketMQ |
| `msg-rabbitmq` | `rabbitmq` | RabbitMQ |
| `msg-pulsar` | `apache-pulsar` | Apache Pulsar |
| `obs-grafana` | `grafana` | Grafana |
| `obs-loki` | `loki` | Grafana Loki |
| `obs-otel` | `opentelemetry-collector` | OpenTelemetry Collector |
| `obs-skywalking` | `skywalking` | Apache SkyWalking |
| `del-argocd` | `argo-cd` | Argo CD |
| `del-harbor` | `harbor` | Harbor |
| `del-terraform` | `terraform` | Terraform |
| `del-ansible` | `ansible` | Ansible |
| `infra-istio` | `istio` | Istio |
| `infra-envoy` | `envoy-proxy` | Envoy |
| `infra-cert-manager` | `cert-manager` | cert-manager |
| `infra-podman` | `podman` | Podman |

`db-redis` 节点名称为“Redis / Valkey”，节点只映射到 `redis`。Valkey 在目录中是独立软件，不能用一个 `softwareSlug` 同时表示两个产品；正文已明确 Redis 8.10 与 Valkey 9.1 版本线独立，避免把 Valkey 的事实写成 Redis 的版本结论。反向查询时 `redis` 只回到 `db-redis`，不存在重复映射。

## 5. 关系复核与变更

### 5.1 原有 10 条关系

原 10 条 Seed 关系逐条复核方向、类型和描述，未发现需要修正的错误，全部保留原元组：

| ID | 源 → 目标 | 类型 | 结论 |
| --- | --- | --- | --- |
| `rel-db-mysql-pg` | `db-mysql` → `db-postgresql` | `alternative` | 方向与类型正确 |
| `rel-db-redis-mysql` | `db-redis` → `db-mysql` | `related` | 缓存与数据库的关联，正确 |
| `rel-msg-kafka-pulsar` | `msg-kafka` → `msg-pulsar` | `alternative` | 事件流替代关系，正确 |
| `rel-msg-rabbitmq-kafka` | `msg-rabbitmq` → `msg-kafka` | `alternative` | 业务消息与事件流的定位差异，正确 |
| `rel-obs-grafana-loki` | `obs-grafana` → `obs-loki` | `related` | 查询展示与日志数据源，正确 |
| `rel-obs-otel-grafana` | `obs-otel` → `obs-grafana` | `related` | 采集管道与展示层，正确 |
| `rel-del-harbor-argocd` | `del-harbor` → `del-argocd` | `related` | 制品仓库与部署控制器的关联，正确 |
| `rel-del-terraform-ansible` | `del-terraform` → `del-ansible` | `related` | 基础设施与主机配置的分工，正确 |
| `rel-infra-istio-envoy` | `infra-istio` → `infra-envoy` | `depends_on` | 控制面依赖数据面，正确 |
| `rel-infra-cert-istio` | `infra-cert-manager` → `infra-istio` | `related` | 入口证书与 TLS 终止的关联，正确 |

### 5.2 新增 3 条关系

只补充有官方文档支撑、且现有 10 条没有覆盖的跨产品关联：

| ID | 源 → 目标 | 类型 | 旧关系 | 新关系 | 原因 | 官方依据 |
| --- | --- | --- | --- | --- | --- | --- |
| `rel-msg-kafka-clickhouse` | `msg-kafka` → `db-clickhouse` | `related` | 无 | 新增 | ClickHouse 通过 Kafka 引擎表消费主题数据，是日志/事件入分析的常见路径 | https://clickhouse.com/docs/engines/table-engines/integrations/kafka |
| `rel-obs-otel-loki` | `obs-otel` → `obs-loki` | `related` | 无 | 新增 | Collector 可通过 OTLP 或 Loki 导出器把日志发送到 Loki | https://grafana.com/docs/loki/latest/send-data/otel/ |
| `rel-obs-grafana-clickhouse` | `obs-grafana` → `db-clickhouse` | `related` | 无 | 新增 | Grafana 通过 ClickHouse 数据源查询分析结果，与指标和日志面板联动 | https://grafana.com/docs/plugins/grafana-clickhouse-datasource/latest/ |

没有删除任何用户关系，没有修改节点 ID，没有修改已有 10 条 Seed 元组。新增关系仍通过现有 `seedTemplateRelations()` 的 `INSERT ... ON CONFLICT(id) DO NOTHING` 写入；用户已存在的同 ID 关系不会被覆盖。

### 5.3 未做关系修正的原因

本轮没有发现方向或类型明显错误到需要迁移的 Seed 关系，因此没有新增 P5.4.3 关系修正项。现有 P5.4 的 `migrateP54Relations()` 仍只处理完全匹配的旧元组，并在描述非空时保留用户描述；本阶段没有扩大其作用范围。

## 6. Seed 与数据保护

- 20 篇 P2 文档均提升到内容版本 2，`replacesContentHash` 记录修订前正文的 SHA-256。
- 3 篇 Prometheus 文档提升到内容版本 3，`replacesContentHash` 记录其版本 2 正文的 SHA-256；其余 26 篇保持版本 2。
- Seed 只在正文哈希完全匹配、状态为 `draft`、且没有 `content_verified_at` 时替换正文。
- 用户编辑过、已验证或状态不是 `draft` 的文档不会被替换。
- `docsUrl`、`repoUrl` 仍只在空字段时填充；`referenceLinks` 不删除用户已有链接。
- 所有修订文档保持 `draft`，未调用 Verify，未写入验证人和验证时间。
- 测试使用临时数据目录，没有连接或修改 `data/opsite.db`。
- 另外复制现有数据库到临时目录执行 Seed，验证 20 篇文档全部写入、最短 2,048 字符、全部为 `draft`、每篇 3 条参考链接，3 条新增关系均存在。

## 7. 官方来源与版本核实

版本基线通过上游发布页、项目文档和生命周期数据核对，未用其他产品的周期推断：

| 产品 | 核实来源 | 采用基线 |
| --- | --- | --- |
| MySQL | https://dev.mysql.com/doc/refman/9.7/en/、https://endoflife.date/mysql | 9.7 LTS；8.4 LTS 仍受支持；8.0 EOL 2026-04-30 |
| PostgreSQL | https://www.postgresql.org/docs/current/、https://endoflife.date/postgresql | 18；16–18 覆盖 |
| Redis / Valkey | https://redis.io/docs/latest/、https://valkey.io/docs/、https://endoflife.date/redis、https://endoflife.date/valkey | Redis 8.10.3；Valkey 9.1.3 |
| ClickHouse | https://clickhouse.com/docs、https://endoflife.date/clickhouse | 26.8 LTS；26.10 当前主线 |
| Kafka | https://kafka.apache.org/44/documentation.html、https://endoflife.date/kafka | 4.4.0；4.0 起仅 KRaft |
| RocketMQ | https://rocketmq.apache.org/docs/、https://github.com/apache/rocketmq/releases | 5.5.1；覆盖 4.x |
| RabbitMQ | https://www.rabbitmq.com/docs、https://endoflife.date/rabbitmq | 4.4.0；4.0 起移除经典镜像队列 |
| Pulsar | https://pulsar.apache.org/docs/、https://endoflife.date/apache-pulsar | 5.0.1；覆盖 4.x |
| Grafana | https://grafana.com/docs/grafana/latest/、https://endoflife.date/grafana | 13.3.0；覆盖 12.x |
| Loki | https://grafana.com/docs/loki/latest/、https://endoflife.date/loki | 3.7.9 |
| OTel Collector | https://opentelemetry.io/docs/collector/、https://github.com/open-telemetry/opentelemetry-collector/releases | 0.164.0；尚未发布 1.0 |
| SkyWalking | https://skywalking.apache.org/docs/、https://github.com/apache/skywalking/releases | 11.0.0；覆盖 10.x |
| Argo CD | https://argo-cd.readthedocs.io/、https://endoflife.date/argo-cd | 3.5.6 |
| Harbor | https://goharbor.io/docs/、https://endoflife.date/harbor | 2.15.4；覆盖 2.13–2.15 |
| Terraform | https://developer.hashicorp.com/terraform/docs、https://endoflife.date/terraform | 1.17.1；provider 独立 |
| Ansible | https://docs.ansible.com/、https://endoflife.date/ansible-core | ansible-core 2.21.5；collection 独立 |
| Istio | https://istio.io/latest/docs/、https://endoflife.date/istio | 1.31.3；覆盖 1.29–1.31 |
| Envoy | https://www.envoyproxy.io/docs/envoy/latest/、https://endoflife.date/envoy | 1.40.2 |
| cert-manager | https://cert-manager.io/docs/、https://endoflife.date/cert-manager | 1.21.3 |
| Podman | https://docs.podman.io/、https://endoflife.date/podman | 6.1.4 |

## 8. 自动化验证

实际执行结果：

| 命令 | 结果 |
| --- | --- |
| `npm run test` | 14 个测试文件、159 个测试全部通过 |
| `npm run build` | TypeScript 检查与 Vite 构建通过 |
| `npm run build:server` | 通过 |
| `npm run build:docker` | 通过 |

构建仅有既有的“部分 chunk 大于 500 kB”提示，不影响产物生成。

新增测试覆盖：

- 20 篇文档固定八段结构、顺序、1,500 字符下限、版本 2、`draft` 和旧哈希。
- 每篇文档至少有 2 条官方参考链接和 HTTPS `docsUrl`。
- 各产品的关键机制词覆盖，防止只改标题不补内容。
- 20 个 `softwareSlug` 与目录一致、唯一、可反向查询。
- 原有 10 条关系元组不变，新增 3 条关系端点、类型和 ID 唯一性。
- 再次执行 Seed 时，用户修改过的新增关系类型和描述保持不变。
- Prometheus 29 篇版本章节存在且在参考资料之前；三篇补足文档版本为 3。
- Prometheus 正文不再依赖 `/latest/` 作为唯一来源。
- Prometheus Operator API 链接更新为新路径。

## 9. 待核实与后续

- 所有 20 篇 P2 文档和 3 篇修订的 Prometheus 文档仍需用户在实际核实后逐篇 Verify；本记录不代替 Verify。
- MySQL 9.7 手册、ClickHouse 26.8 LTS、Harbor 2.15.4 等基线随上游发布变化，下次维护时需复核生命周期页。
- OpenTelemetry Collector 尚未发布 1.0，组件稳定性等级在升级时需逐项核对。
- 新增的 3 条关系依赖上游文档能力；如果对应产品移除 Kafka 引擎、Loki OTLP 接入或 Grafana ClickHouse 插件，需要重新评估关系。
- Kubernetes 核心知识在本阶段保持冻结，未做任何修改。

## 10. 验收结论

| 验收项 | 结论 |
| --- | --- |
| 未修改 Kubernetes 核心文件、版本属性、正文、链接和关系 | 通过 |
| 20 篇非 Kubernetes 文档全部采用固定八段结构 | 通过 |
| 20 篇正文均不少于 1,500 字符 | 通过（最短 2,048） |
| 版本差异与兼容性章节存在且可核对 | 通过 |
| 每篇至少 2 条官方参考来源 | 通过（均为 3 条） |
| 20 个软件映射存在、同产品、唯一、可反向查询 | 通过 |
| 原有 10 条关系保留，新增关系有官方依据 | 通过 |
| Seed 哈希门控、用户修改保护和 Draft 状态 | 通过 |
| 未提前 Verify 或标记 Complete | 通过 |
| 未新增 UI、API、数据库字段或模块 | 通过 |
