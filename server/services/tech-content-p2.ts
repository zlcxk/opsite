import type { TechCardContent, TechContentEntry } from './tech-content.js';

type DocOptions = {
  versions: string;
  docsUrl?: string;
  repoUrl?: string;
};

function d(
  nodeId: string,
  card: TechCardContent,
  contentMarkdown: string,
  options: DocOptions,
): TechContentEntry {
  return {
    nodeId,
    version: 1,
    ...card,
    contentMarkdown,
    contentStatus: 'draft',
    contentSource: 'mixed',
    applicableVersions: options.versions,
    docsUrl: options.docsUrl,
    repoUrl: options.repoUrl,
  };
}

/**
 * P2 knowledge cards and documents. Every document starts as a draft; users
 * must explicitly verify it before it is treated as confirmed knowledge.
 */
export const P2_CONTENT: TechContentEntry[] = [
  d(
    'db-mysql',
    {
      technicalRole: '最常见的 OLTP 数据库之一，负责事务写入、索引查询和基于 binlog 的复制与恢复。',
      corePrinciple: 'InnoDB 以主键聚簇索引组织表数据，通过 redo log 保证崩溃恢复、undo log 支撑 MVCC，binlog 记录逻辑变更用于复制。',
      keyMechanism: '聚簇索引、二级索引回表、MVCC Read View、next-key lock、redo/undo、binlog、组复制。',
      useCases: '事务型业务、读写分离、主从复制、慢查询与锁等待排查、在线 DDL 评估。',
      commonIssues: '缺索引导致全表扫描；长事务撑大 undo 并阻塞 purge；大表 DDL 引发复制延迟；连接池与 max_connections 不匹配。',
    },
    `## 定位

MySQL 是通用关系型数据库，生产环境通常使用 InnoDB 引擎。它承担事务写入、索引查询、复制和备份恢复，是业务系统最直接的数据持久化层。

## 核心模型

InnoDB 的表按主键组织为聚簇索引，叶子节点保存整行数据；二级索引叶子保存主键值，查询非覆盖列时需要回表。理解这一点是分析索引选择和随机 I/O 的基础。

事务隔离依赖 MVCC：每行带有事务版本信息，一致性读通过 Read View 判断可见性；当前读和写操作使用行锁与 next-key lock 防止幻读。

## 写入与复制

一次更新大致经过：修改缓冲页 → 写 redo log（WAL）→ 提交时刷 redo → 后台异步刷脏页。binlog 在提交阶段记录，主从复制通过 binlog 重放。崩溃恢复时 redo 保证已提交事务不丢失，undo 回滚未提交事务。

~~~text
客户端 → 连接池 → SQL 解析/优化 → InnoDB 缓冲池
                                   ├─ redo log（崩溃恢复）
                                   ├─ undo log（MVCC / 回滚）
                                   └─ binlog（复制 / 审计）
~~~

## 排查要点

- **慢查询**：先看 \`EXPLAIN\` 的访问类型、rows、filtered 和 Extra，再判断索引是否覆盖排序与过滤。
- **锁等待**：查询 \`performance_schema.data_locks\` 与 \`data_lock_waits\`，定位阻塞事务。
- **复制延迟**：区分大事务、单线程回放、无主键表和网络问题；并行复制只能缓解部分场景。
- **空间膨胀**：长事务阻止 undo purge，关注 history list length 和 ibdata/表空间增长。

## 适用边界

MySQL 适合事务明确、访问路径稳定的业务。复杂分析、超大规模写入或强扩展性需求通常需要分库分表、读写分离或引入 OLAP 系统，而不是单库无限扩容。

## 参考资料

- [MySQL Reference Manual](https://dev.mysql.com/doc/refman/8.4/en/)
- [InnoDB Transaction Model](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-model.html)`,
    { versions: 'MySQL 8.0+，示例以 8.4 LTS 为准', docsUrl: 'https://dev.mysql.com/doc/refman/8.4/en/' },
  ),
  d(
    'db-postgresql',
    {
      technicalRole: '功能完整的开源关系型数据库，承担复杂查询、事务、扩展类型和多种复制拓扑。',
      corePrinciple: '通过多版本元组（MVCC）实现读写不互相阻塞，WAL 保证持久化，autovacuum 回收死元组并维护统计信息。',
      keyMechanism: 'Heap 表、TOAST、WAL、MVCC 快照、B-tree/GIN/GiST/BRIN 索引、autovacuum、逻辑/物理复制。',
      useCases: '复杂 SQL 与报表、JSONB 半结构化数据、地理与全文检索、逻辑复制、高可用切换。',
      commonIssues: 'autovacuum 跟不上导致表膨胀；长事务阻塞清理；连接数过高；统计信息过期造成错误执行计划。',
    },
    `## 定位

PostgreSQL 以标准兼容、扩展性和查询能力见长。它既能承担常规 OLTP，也能通过 JSONB、GIN、PostGIS 等扩展处理半结构化和专用检索场景。

## 并发控制

PostgreSQL 使用多版本并发控制：更新不会原地覆盖旧行，而是写入新版本，旧版本由 vacuum 回收。读请求读取对自己可见的快照，因此读不会阻塞写，写也不会阻塞读。

这带来一个重要运维后果：长事务或长快照会阻止死元组回收，表和相关索引持续膨胀。监控 \`pg_stat_activity\` 中的长事务与 \`pg_stat_user_tables\` 的 dead tuple 比例非常关键。

## 持久化与复制

所有修改先写 WAL，再异步刷数据页。崩溃恢复通过重放 WAL 达到一致状态。物理复制传输 WAL 字节流，备库与主库完全一致；逻辑复制按表和解码后的变更传输，可跨版本和选择性复制。

## 执行计划

优化器基于统计信息估算代价。常见问题不是“没建索引”，而是统计信息失真、表达式不可索引、连接顺序错误或分区裁剪失效。排查时结合 \`EXPLAIN (ANALYZE, BUFFERS)\` 看实际行数与共享块命中。

## 排查清单

| 现象 | 优先检查 |
|---|---|
| 表持续膨胀 | 长事务、autovacuum 阈值、表级 autovacuum 设置 |
| 查询突然变慢 | 统计信息、执行计划翻转、锁等待、I/O 抖动 |
| 连接耗尽 | 连接池上限、空闲事务、应用泄漏 |
| 复制延迟 | 长事务、网络、备库回放与 I/O、逻辑复制冲突 |

## 参考资料

- [PostgreSQL Documentation](https://www.postgresql.org/docs/current/)
- [Concurrency Control](https://www.postgresql.org/docs/current/mvcc.html)`,
    { versions: 'PostgreSQL 15+', docsUrl: 'https://www.postgresql.org/docs/current/' },
  ),
  d(
    'db-redis',
    {
      technicalRole: '位于数据库前的内存键值层，承担热点缓存、会话、计数、分布式锁和轻量消息。',
      corePrinciple: '命令在主线程串行执行，内存数据结构保证低延迟；通过 RDB/AOF 持久化、主从复制和集群分片扩展。',
      keyMechanism: '单线程命令循环、IO 多线程、过期与淘汰策略、RDB/AOF、Sentinel/Cluster、Lua 脚本、Stream。',
      useCases: '热点数据缓存、会话共享、限流计数、排行榜、简单消息队列、分布式锁。',
      commonIssues: '大 key 与热 key 阻塞主线程；缓存穿透/击穿/雪崩；内存碎片与淘汰；主从切换丢数据。',
    },
    `## 定位

Redis（以及兼容协议的 Valkey）是内存数据存储，不是通用数据库。它适合可重建、访问频繁、延迟敏感的数据；持久化能力不能替代数据库的事务与备份体系。

## 执行模型

Redis 用单线程执行命令，因此单条命令的复杂度直接决定其他客户端要等多久。慢命令、大 key 删除、复杂 Lua 和一次性返回大量元素都会阻塞事件循环。Redis 6 以后引入 IO 多线程处理网络读写，但命令执行仍然是串行的。

## 持久化与高可用

- **RDB**：周期性快照，恢复快但可能丢失最后一次快照后的数据。
- **AOF**：追加写命令，可按秒或每次写入刷盘；重写用于压缩体积。
- **主从复制**：异步复制，主库故障时可能丢失尚未同步的写入。
- **Sentinel / Cluster**：Sentinel 负责故障转移，Cluster 负责分片和槽位迁移。

## 缓存治理

缓存问题通常不在 Redis 本身，而在边界设计：

- **穿透**：查询不存在的数据，使用空值缓存、布隆过滤器或参数校验。
- **击穿**：热点 key 过期瞬间大量回源，使用互斥重建或逻辑过期。
- **雪崩**：大批 key 同时失效，使用随机 TTL、预热和多级缓存。
- **一致性**：优先删除缓存而非更新缓存，并结合业务容忍度选择延迟双删或订阅 binlog。

## 排查要点

\`SLOWLOG\` 定位慢命令，\`INFO memory\` 看 used_memory 与碎片率，\`--bigkeys\` 找大 key，\`CLIENT LIST\` 看连接与阻塞。集群场景还要检查槽位分布、迁移和跨槽命令。

## 参考资料

- [Redis Documentation](https://redis.io/docs/latest/)
- [Valkey Documentation](https://valkey.io/docs/)`,
    { versions: 'Redis 7.x / Valkey 8.x', docsUrl: 'https://redis.io/docs/latest/' },
  ),
  d(
    'db-clickhouse',
    {
      technicalRole: '面向大规模分析的列式数据库，承担日志、指标、事件和行为数据的聚合查询。',
      corePrinciple: '列式存储只读取查询涉及的列，MergeTree 按排序键组织 part，向量化执行和稀疏主键索引降低扫描成本。',
      keyMechanism: 'MergeTree 家族、part/partition、稀疏索引、跳数索引、后台 merge、物化视图、分布式表、Keeper。',
      useCases: '日志与可观测性分析、用户行为漏斗、实时报表、宽表聚合、大批量写入。',
      commonIssues: '小批量频繁写入产生过多 part；排序键设计错误；高基数 GROUP BY 内存超限；mutation 和轻量删除代价高。',
    },
    `## 定位

ClickHouse 是列式 OLAP 数据库，擅长扫描大量行但只读取少数列的聚合查询。它不以单行事务更新为主要目标，表结构、排序键和写入批次决定大部分性能。

## 存储模型

MergeTree 表按分区和排序键组织数据。每次插入生成一个 part，后台线程持续 merge。查询利用稀疏主键索引跳过不相关的 granule，列式压缩减少 I/O，向量化执行提高 CPU 利用率。

排序键应优先覆盖最常用的过滤维度，并兼顾基数。把高基数列放在前面不一定更好，需要结合实际查询的等值、范围和前缀匹配模式。

## 写入与变更

ClickHouse 偏好大批量写入。高频小批量插入会产生大量 part，增加 merge 压力和“too many parts”风险。生产上通常通过 Kafka 表引擎、Buffer 或应用侧攒批解决。

\`ALTER UPDATE/DELETE\` 是异步 mutation，会重写 part，不适合高频行级更新。需要更新频繁的场景应考虑 ReplacingMergeTree、CollapsingMergeTree 或变更数据建模，而不是把 ClickHouse 当 OLTP 使用。

## 查询优化

- 用 \`EXPLAIN\` 和 \`system.query_log\` 查看读取行数、扫描字节和内存峰值。
- 优先使用分区裁剪、主键条件和 PREWHERE。
- 高基数聚合注意 \`max_memory_usage\`，必要时使用近似函数或预聚合。
- 分布式查询关注 shard 间数据倾斜和网络传输。

## 适用边界

ClickHouse 适合“写多读多、批量追加、聚合分析”的场景。强事务、频繁点更新、复杂多表事务不适合直接交给它。

## 参考资料

- [ClickHouse Documentation](https://clickhouse.com/docs)
- [MergeTree Engine](https://clickhouse.com/docs/engines/table-engines/mergetree-family/mergetree)`,
    { versions: 'ClickHouse 24.x 及以后', docsUrl: 'https://clickhouse.com/docs' },
  ),
  d(
    'msg-kafka',
    {
      technicalRole: '高吞吐事件流的主干，承担应用解耦、异步处理、事件回放和流式数据管道。',
      corePrinciple: '消息追加到分区日志，消费者按 offset 顺序读取；副本通过 ISR 同步，消费者组在分区维度实现并行消费。',
      keyMechanism: 'Partition、Offset、ISR、acks、幂等生产者、事务、消费者组再平衡、KRaft、保留与压缩。',
      useCases: '业务事件总线、日志与指标管道、CDC 下游、异步任务、事件溯源与回放。',
      commonIssues: '分区键倾斜；消费者处理慢导致 lag；再平衡风暴；acks 与 min.insync.replicas 配置不匹配；消息过大。',
    },
    `## 定位

Kafka 是可持久化、可回放的分布式事件日志。它不只是“消息队列”：消息按分区追加并保留一段时间，多个消费者可以按自己的 offset 重复读取。

## 核心模型

- **Topic / Partition**：主题被划分为多个分区，分区内严格有序，分区间无序。
- **Offset**：消费者在分区中的位置，由消费者提交，决定重启后从哪里继续。
- **Replication**：每个分区有 leader 和 follower，ISR 表示与 leader 保持同步的副本集合。
- **Consumer Group**：同一组内一个分区只分配给一个消费者，组内并行度上限是分区数。

## 可靠性

生产者 \`acks=all\` 配合 \`min.insync.replicas>=2\` 才能在单副本故障时避免丢消息。启用幂等生产者可避免重试造成的重复；跨分区原子写需要事务。

消费者侧要区分“处理成功”和“offset 提交”。先处理后提交可能重复，先提交后处理可能丢失；业务需要幂等或事务性写出来兜底。

## 运维与排查

- **Lag**：区分生产突增、消费变慢和再平衡。看 \`kafka-consumer-groups --describe\` 的 lag 与分区分布。
- **再平衡**：频繁 rebalance 往往由会话超时、处理时间超过 \`max.poll.interval.ms\` 或消费者频繁上下线引起。
- **分区倾斜**：检查 key 分布，避免少数 key 承载绝大部分流量。
- **磁盘与保留**：按吞吐和保留时长估算容量，合理设置 \`retention.ms\` 与 \`retention.bytes\`。

## 与其他消息系统的区别

Kafka 不按消息逐条删除，而是按时间或大小截断日志；消费是拉模型，消费者自己维护进度。这让它适合事件流和回放，但不像传统队列那样天然支持复杂的路由和优先级。

## 参考资料

- [Kafka Documentation](https://kafka.apache.org/documentation/)
- [Kafka Design](https://kafka.apache.org/documentation/#design)`,
    { versions: 'Kafka 3.7+ / 4.x（KRaft 模式）', docsUrl: 'https://kafka.apache.org/documentation/' },
  ),
  d(
    'msg-rocketmq',
    {
      technicalRole: '面向业务消息的分布式消息系统，承担订单、交易、异步解耦和顺序/事务消息场景。',
      corePrinciple: 'Broker 将消息顺序写入 CommitLog，再异步构建按 Topic/Queue 索引的 ConsumeQueue；NameServer 提供路由。',
      keyMechanism: 'CommitLog、ConsumeQueue、IndexFile、NameServer、主从复制、事务消息、顺序消息、重试与死信队列。',
      useCases: '电商交易链路、异步扣减、事务最终一致性、顺序消费、削峰填谷。',
      commonIssues: '消费堆积与重试风暴；消息重复；顺序消息阻塞；Broker 磁盘写满；NameServer 路由不一致。',
    },
    `## 定位

RocketMQ 起源于电商交易场景，强调业务消息的可靠投递、顺序消息和事务消息。它通过 NameServer 管理路由，Broker 负责存储和投递。

## 存储结构

Broker 把所有消息顺序追加到 CommitLog，再异步生成 ConsumeQueue 作为消费索引，IndexFile 支持按 key 查询。顺序写 CommitLog 是高吞吐的关键，ConsumeQueue 让消费者可以按队列偏移快速定位。

## 消费语义

消费者从队列拉取消息，处理成功后提交偏移。失败会进入重试队列，超过次数进入死信队列。业务必须假设“至少一次”投递，消费逻辑要幂等。

顺序消息要求同一业务 key 路由到同一队列，并且消费端串行处理；这会牺牲并行度，不能滥用。

事务消息通过半消息和回查机制保证本地事务与消息发送的最终一致，但回查逻辑和事务状态表必须可靠。

## 运维排查

| 现象 | 排查方向 |
|---|---|
| 消费堆积 | 消费 TPS、线程数、下游耗时、重试比例 |
| 消息重复 | 生产者重试、消费失败重投、offset 提交时机 |
| 发送超时 | NameServer 路由、Broker 负载、磁盘与网络 |
| 顺序错乱 | 队列选择、消费并行度、重试队列 |

## 适用边界

RocketMQ 适合业务消息和交易链路。超大规模日志流、长期回放和生态连接器通常更适合 Kafka；轻量路由和复杂交换机语义则更适合 RabbitMQ。

## 参考资料

- [RocketMQ Documentation](https://rocketmq.apache.org/docs/)
- [RocketMQ Design](https://rocketmq.apache.org/zh/docs/4.x/introduction/03architecture)`,
    { versions: 'RocketMQ 5.x', docsUrl: 'https://rocketmq.apache.org/docs/' },
  ),
  d(
    'msg-rabbitmq',
    {
      technicalRole: '基于 AMQP 的业务消息代理，承担复杂路由、任务分发、RPC 和工作队列。',
      corePrinciple: '生产者把消息发送到 Exchange，Exchange 按 Binding 和路由键投递到 Queue，消费者通过确认机制控制可靠性。',
      keyMechanism: 'Exchange 类型（direct/fanout/topic/headers）、Binding、Publisher Confirm、Consumer Ack、prefetch、quorum queue、DLX。',
      useCases: '任务队列、复杂路由、延迟/重试、RPC、事件通知。',
      commonIssues: '队列积压导致内存告警；prefetch 不合理；未确认消息堆积；镜像/仲裁队列配置不当；连接数过多。',
    },
    `## 定位

RabbitMQ 实现 AMQP 0-9-1，核心优势是灵活的路由模型和成熟的确认机制。它更适合业务消息、任务分发和需要复杂绑定关系的场景，而不是超大规模日志回放。

## 路由模型

消息先进入 Exchange，再由 Binding 决定进入哪些 Queue：

- **direct**：路由键完全匹配。
- **fanout**：广播到所有绑定队列。
- **topic**：按 \`*\` 和 \`#\` 通配符匹配。
- **headers**：按消息头匹配。

消费者从 Queue 拉取消息。一个队列可以被多个消费者竞争消费，因此队列是并行度的边界。

## 可靠性

生产者使用 Publisher Confirm 确认 Broker 已接收；消费者使用手动 Ack，处理成功后再确认。未确认消息会占用队列资源，prefetch 限制每个消费者的未确认数量，避免把消息全推给慢消费者。

持久化需要 Exchange、Queue 和消息都声明持久化，并且 Broker 使用持久化存储。仅设置消息持久化而不设置队列持久化，重启后队列元数据仍可能丢失。

## 队列类型

经典镜像队列已逐步被 Quorum Queue 取代。Quorum Queue 基于 Raft，提供更好的故障恢复和一致性，但资源开销更高；Stream 适合大容量、可回放场景。

## 排查要点

看队列深度、unacked 数量、消费者数量、发布/确认速率和内存/磁盘告警。积压时先判断是消费能力不足、消费者掉线还是 prefetch 过大。死信队列要单独监控，否则失败消息会静默堆积。

## 参考资料

- [RabbitMQ Documentation](https://www.rabbitmq.com/docs)
- [Queues](https://www.rabbitmq.com/docs/queues)`,
    { versions: 'RabbitMQ 3.13+ / 4.x', docsUrl: 'https://www.rabbitmq.com/docs' },
  ),
  d(
    'msg-pulsar',
    {
      technicalRole: '计算存储分离的多租户消息平台，承担大规模流式消息、多订阅消费和跨地域复制。',
      corePrinciple: 'Broker 无状态处理协议与路由，BookKeeper 负责持久化日志段；Topic 通过订阅和游标管理多个消费进度。',
      keyMechanism: 'Broker、BookKeeper、元数据存储、Ledger/Segment、订阅类型、游标、分层存储、Geo-Replication。',
      useCases: '多租户消息平台、多订阅消费、跨机房复制、大容量流数据、队列与流统一接入。',
      commonIssues: 'BookKeeper 磁盘与写延迟；订阅积压与游标保留；Broker 负载不均；元数据存储异常；跨地域复制延迟。',
    },
    `## 定位

Pulsar 将消息服务拆成无状态 Broker 和有状态存储 BookKeeper。Broker 处理生产、消费和路由，消息写入 BookKeeper 的 ledger；Topic 的持久化与计算可以独立扩展。

## 核心模型

- **Tenant / Namespace / Topic**：多租户隔离与配额管理的层级。
- **Ledger / Segment**：BookKeeper 的追加写单元，构成 Topic 的持久化日志。
- **Subscription**：同一 Topic 可以有多个订阅，每个订阅维护自己的游标。
- **Subscription 类型**：Exclusive、Failover、Shared、Key_Shared，决定消费者如何分配消息。

多订阅是 Pulsar 与 Kafka 消费组模型的重要差异：不同订阅可以独立消费同一份数据，适合多种下游同时处理。

## 可靠性

生产者使用持久化 Topic 并等待确认；BookKeeper 通过副本保证写入持久性。消费者按订阅确认消息，未确认消息在保留策略内可重投。需要区分“消息已持久化”和“订阅已确认”，积压由游标位置决定。

## 运维排查

关注 Broker 的吞吐与连接数、BookKeeper 的写延迟和磁盘使用、订阅 backlog、游标保留时间以及元数据存储健康。分层存储可以把冷数据移到对象存储，但读取延迟和成本需要评估。

## 适用边界

Pulsar 适合需要多租户、多订阅、跨地域复制和存储计算分离的平台型场景。组件更多、运维复杂度更高；中小规模单一事件流用 Kafka 往往更简单。

## 参考资料

- [Pulsar Documentation](https://pulsar.apache.org/docs/)
- [Pulsar Architecture](https://pulsar.apache.org/docs/concepts-architecture-overview)`,
    { versions: 'Pulsar 3.x+', docsUrl: 'https://pulsar.apache.org/docs/' },
  ),
  d(
    'obs-grafana',
    {
      technicalRole: '统一的可视化与告警入口，把指标、日志、链路和业务数据放进同一套 Dashboard。',
      corePrinciple: 'Grafana 不存储数据，而是通过 Data Source 查询外部系统；Panel 把查询结果渲染为图表，Alert Rule 对查询结果持续求值。',
      keyMechanism: 'Data Source、Dashboard、Panel、Variable、Provisioning、Unified Alerting、组织与 RBAC。',
      useCases: '基础设施面板、业务指标看板、日志与链路联动、告警规则与通知、按环境切换变量。',
      commonIssues: 'Dashboard 查询过重拖垮数据源；变量基数过大；告警规则重复；权限与文件夹混乱；配置未纳入版本管理。',
    },
    `## 定位

Grafana 是查询与展示层，本身不产生也不存储遥测数据。它连接 Prometheus、Loki、Elasticsearch、ClickHouse、云监控等数据源，把查询结果统一呈现。

## 核心对象

- **Data Source**：连接后端并保存认证、URL 和查询配置。
- **Dashboard**：一组 Panel 的集合，支持变量、时间范围和链接。
- **Panel**：一次或多次查询的可视化，图表类型由数据形态决定。
- **Alert Rule**：对查询结果按周期求值，触发后进入通知策略。
- **Provisioning**：用文件或 API 管理数据源、Dashboard 和告警，避免手工漂移。

## 设计原则

Dashboard 应该围绕“要回答的问题”组织，而不是把所有指标堆在一起。常用结构是：总览 → 服务/实例下钻 → 日志与链路 → 变更与事件。变量用于切换环境、集群和实例，但要控制基数，避免一次渲染触发大量查询。

## 告警

统一告警支持多数据源查询、多维告警实例、静默和通知策略。告警规则应尽量使用比率、分位数和持续时间，避免单点瞬时阈值。Grafana 告警与 Prometheus 规则可以并存，但需要明确唯一事实来源，防止重复通知。

## 运维要点

关注 Grafana 自身数据库、会话、插件和查询并发。重型 Dashboard 会放大后端压力；对外共享面板时使用快照或只读权限。生产配置应通过 Provisioning 或 IaC 管理。

## 参考资料

- [Grafana Documentation](https://grafana.com/docs/grafana/latest/)
- [Provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/)`,
    { versions: 'Grafana 11+', docsUrl: 'https://grafana.com/docs/grafana/latest/' },
  ),
  d(
    'obs-loki',
    {
      technicalRole: '低成本日志聚合后端，按标签索引日志流并用 LogQL 查询，与 Grafana 指标面板联动。',
      corePrinciple: 'Loki 只索引标签集，日志正文压缩后存入 chunk；查询先按标签缩小流范围，再在流内过滤。',
      keyMechanism: 'Label Set、Stream、Chunk、Index、LogQL、Promtail/Alloy、保留策略、boltdb-shipper/TSDB。',
      useCases: '容器日志集中查询、按 Pod/Namespace 过滤、日志与指标关联、低成本长保留日志。',
      commonIssues: '高基数标签导致索引爆炸；日志量突增；查询范围过大；采集端重复或丢失；保留策略未按租户设置。',
    },
    `## 定位

Loki 的设计取舍是“只索引标签，不索引全文”。这让存储成本远低于全文索引系统，但查询性能依赖标签选择是否足够精确。它通常与 Grafana 配合，承担日志查询和与指标联动。

## 数据模型

一条日志属于一个 stream，stream 由一组标签唯一标识，例如 \`namespace\`、\`pod\`、\`container\`。同一 stream 的日志按时间追加并压缩为 chunk。查询时 Loki 先通过标签找到相关 stream，再在时间范围内扫描 chunk 并执行 LogQL 过滤。

## 标签设计

标签应低基数、稳定且常用于过滤。不要把请求 ID、用户 ID、完整路径等高基数值作为标签，否则会产生海量 stream 和索引条目。高基数信息应放在日志正文中，用 LogQL 过滤。

## LogQL

LogQL 同时支持日志查询和指标查询。日志查询使用 \`{app="api"} |= "error"\` 这类流选择器和过滤表达式；指标查询可以在此基础上做 \`rate\`、\`count_over_time\` 和聚合，用于从日志生成告警指标。

## 采集与保留

Promtail、Alloy 或 OpenTelemetry Collector 负责采集和推送。需要处理多行日志、标签注入、背压和磁盘缓冲。保留策略按租户或 stream 设置，过长保留会显著增加对象存储和索引成本。

## 排查要点

先看摄入速率、活跃 stream 数、索引大小和查询耗时。查询慢通常不是 Loki 本身，而是标签选择器过宽或时间范围过大。采集缺失要检查目标发现、权限和推送失败日志。

## 参考资料

- [Loki Documentation](https://grafana.com/docs/loki/latest/)
- [LogQL](https://grafana.com/docs/loki/latest/query/)`,
    { versions: 'Loki 3.x', docsUrl: 'https://grafana.com/docs/loki/latest/' },
  ),
  d(
    'obs-otel',
    {
      technicalRole: '厂商中立的遥测数据管道，统一接收、处理和导出指标、日志与链路。',
      corePrinciple: 'Collector 由 Receiver、Processor、Exporter 和 Connector 组成，按 pipeline 组合并处理 OTLP 及其他协议的数据。',
      keyMechanism: 'OTLP、Receiver、Processor、Exporter、Connector、Batch、Memory Limiter、Agent/Gateway 部署模式。',
      useCases: '统一采集标准、替换多套 agent、数据脱敏与采样、跨后端转发、边缘缓冲。',
      commonIssues: 'pipeline 配置错误导致数据丢弃；内存限制过小 OOM；批处理与重试参数不当；标签/属性基数失控。',
    },
    `## 定位

OpenTelemetry Collector 是可观测性数据的中间层。它把不同语言和协议的遥测数据标准化为 OTLP，再按需处理并导出到多个后端，避免应用直接绑定某个厂商 SDK。

## 组成

一个 Collector 配置由以下部分组成：

- **Receiver**：接收 OTLP、Prometheus、Jaeger、filelog 等数据。
- **Processor**：批处理、内存保护、属性增删、采样、过滤。
- **Exporter**：发送到 Prometheus、Loki、Jaeger、OTLP 后端或对象存储。
- **Connector**：把一种 pipeline 的输出接到另一种 pipeline。
- **Service Pipelines**：把上述组件按 traces/metrics/logs 组合起来。

## 部署模式

Agent 模式部署在每台节点或每个 Pod 旁，负责采集和初步处理；Gateway 模式集中接收、做全局采样和路由。两者可以组合：agent 轻量转发，gateway 统一治理。

## 关键配置

\`memory_limiter\` 必须放在 pipeline 前部，防止突发流量打爆内存；\`batch\` 提高网络效率但会增加延迟；\`retry\` 与队列需要配合后端限流。配置错误时 Collector 可能启动失败或静默丢弃数据，必须监控其自身指标。

## 数据治理

Collector 是控制基数的好位置：删除无用属性、规范化服务名、按比例采样、过滤健康检查。但不要在 Collector 里做复杂业务计算，它更适合管道治理而不是分析引擎。

## 排查要点

检查 Collector 自身日志、\`otelcol_processor_dropped_*\`、队列长度、导出失败和内存使用。确认 pipeline 中每个 receiver 都被 service 引用，否则配置存在但不会生效。

## 参考资料

- [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/)
- [Configuration](https://opentelemetry.io/docs/collector/configuration/)`,
    { versions: 'Collector 0.100+', docsUrl: 'https://opentelemetry.io/docs/collector/' },
  ),
  d(
    'obs-skywalking',
    {
      technicalRole: '面向分布式系统的 APM 平台，提供服务拓扑、链路追踪、指标和日志关联分析。',
      corePrinciple: '语言 Agent 通过字节码增强采集调用链并上报 OAP，OAP 聚合分析后写入存储，UI 展示拓扑、指标和追踪。',
      keyMechanism: 'Agent、OAP、Storage、Trace、Metrics、Log、Service Mesh 探针、告警规则、动态配置。',
      useCases: 'Java/多语言微服务链路、服务依赖拓扑、慢调用定位、告警、Service Mesh 可观测性。',
      commonIssues: 'Agent 版本与 OAP 不兼容；采样与存储压力；跨线程上下文丢失；存储容量不足；探针重复增强。',
    },
    `## 定位

SkyWalking 是 APM 与可观测性平台，强调服务、实例、端点和依赖关系。它通过 Agent 或 Service Mesh 探针采集数据，OAP 负责聚合、分析和告警，UI 提供服务拓扑与追踪查询。

## 架构

~~~text
应用 Agent / Mesh 探针
          │ gRPC / HTTP
          ▼
         OAP 集群
     ┌────┼─────────┐
     ▼    ▼         ▼
  存储   告警      查询 API
                      │
                      ▼
                     UI
~~~

Agent 通过字节码增强或框架插件采集入口、出口、数据库和缓存调用，生成 trace segment 并上报。OAP 将 segment 组装为 trace，计算服务指标和拓扑。

## 核心概念

- **Service / Instance / Endpoint**：服务、实例和端点的三层标识。
- **Trace / Segment / Span**：一次请求的完整链路、单进程片段和具体调用。
- **Topology**：根据调用关系自动生成的服务依赖图。
- **OAP**：接收、聚合、存储和告警的核心组件。

## 排查要点

慢请求先看 trace 中耗时最长的 span，再区分网络、数据库、缓存和业务逻辑。拓扑异常要检查探针是否覆盖所有服务、上下文是否跨线程传递、采样是否导致数据缺失。

Agent 版本必须与 OAP 兼容；升级时先看兼容矩阵。高流量场景需要调整采样率、缓冲和存储保留，否则 OAP 会成为瓶颈。

## 与 OpenTelemetry 的关系

SkyWalking 支持接收部分 OpenTelemetry 数据，但两者的模型和生态不同。新系统可以优先采用 OpenTelemetry 标准，再通过 Collector 或 SkyWalking 接收端接入；已有 Java 体系可以继续使用 SkyWalking Agent。

## 参考资料

- [SkyWalking Documentation](https://skywalking.apache.org/docs/)
- [Concepts](https://skywalking.apache.org/docs/main/latest/en/concepts-and-designs/overview/)`,
    { versions: 'SkyWalking 10.x+', docsUrl: 'https://skywalking.apache.org/docs/' },
  ),
  d(
    'del-argocd',
    {
      technicalRole: 'Kubernetes GitOps 持续交付控制器，把 Git 中的声明式配置持续同步到集群。',
      corePrinciple: 'Application 定义源仓库、目标集群和路径；控制器周期性比较期望状态与实时状态，执行 sync 并报告 health。',
      keyMechanism: 'Application、AppProject、Sync Policy、Health Assessment、ApplicationSet、RBAC、SSO、多集群。',
      useCases: '声明式发布、多环境管理、应用编排、漂移检测、自动回滚、平台多租户。',
      commonIssues: '自动同步覆盖手工变更；健康检查误判；ApplicationSet 生成爆炸；仓库凭据与权限过大；CRD 顺序问题。',
    },
    `## 定位

Argo CD 是 Kubernetes 的 GitOps 控制器。Git 仓库是期望状态的唯一来源，集群实际状态由控制器持续比对；两者不一致时显示 OutOfSync，并按策略同步。

## 核心对象

- **Application**：源（repo、revision、path）、目标（cluster、namespace）和同步策略。
- **AppProject**：限制可访问的仓库、集群、命名空间和资源类型。
- **ApplicationSet**：用生成器批量创建 Application，适合多环境、多集群。
- **Sync Policy**：手动或自动同步，是否 prune、是否 self-heal。

## 同步与健康

同步是把 Git 渲染出的清单 apply 到集群；健康状态则根据资源类型判断 Pod、Deployment、Service 等是否达到期望。两者不是一回事：同步成功不代表应用健康。

自动同步适合平台组件和稳定环境；核心业务通常保留手动同步或使用分批策略。\`selfHeal\` 会覆盖手工修改，开启前要确认团队约定。

## 多环境实践

常见做法是按目录或 Kustomize/Helm overlay 组织环境差异，用 ApplicationSet 生成 Application。避免在 Git 中保存明文密钥，可结合 Sealed Secrets、External Secrets 或 SOPS。

## 排查要点

先看 Application 的 conditions、sync result 和资源树。常见问题包括 CRD 尚未就绪、Helm values 渲染错误、权限不足、资源被其他控制器修改导致持续 OutOfSync。删除 Application 时注意 finalizer 和级联删除策略。

## 参考资料

- [Argo CD Documentation](https://argo-cd.readthedocs.io/)
- [GitOps Engine](https://argo-cd.readthedocs.io/en/stable/operator-manual/architecture/)`,
    { versions: 'Argo CD 2.10+ / 3.x', docsUrl: 'https://argo-cd.readthedocs.io/' },
  ),
  d(
    'del-harbor',
    {
      technicalRole: '企业级 OCI 制品仓库，承担镜像存储、访问控制、复制、扫描、签名和保留。',
      corePrinciple: 'Harbor 在标准 Registry API 之上增加项目、RBAC、策略和扫描能力，元数据存数据库，镜像层存对象存储或文件系统。',
      keyMechanism: 'Project、Registry、Replication、Vulnerability Scan、Cosign/Notation、Robot Account、Retention、Immutable Tag。',
      useCases: '私有镜像仓库、跨集群复制、镜像扫描门禁、签名验证、清理旧标签、CI 推送凭证。',
      commonIssues: '存储容量与垃圾回收；扫描器不可用；复制失败；机器人账号权限过大；标签覆盖导致不可追溯。',
    },
    `## 定位

Harbor 是构建在开源 Registry 之上的制品管理平台。它保存 OCI 镜像和制品，同时提供项目级权限、复制、扫描、签名、保留和审计。

## 核心对象

- **Project**：权限和策略的边界，仓库位于项目之下。
- **Registry**：Harbor 自身或外部仓库端点。
- **Replication**：在 Harbor 之间或与云 registry 之间同步镜像。
- **Robot Account**：供 CI/CD 使用的非人类账号，应限制到项目和操作。
- **Retention / Immutable Tag**：控制标签保留和防覆盖。

## 存储与垃圾回收

镜像层通常存放在对象存储或本地文件系统，数据库保存元数据。删除标签或制品后，底层 blob 需要执行垃圾回收才能释放空间。GC 会占用 I/O，应在低峰期运行，并先确认没有并发推送。

## 安全能力

漏洞扫描通常由 Trivy 等扫描器完成，结果用于门禁或展示。签名可以使用 Cosign/Notation，配合准入控制器验证镜像来源。扫描和签名只证明“检查过/签名过”，不代表镜像没有漏洞。

## 高可用

生产环境应使用外部 PostgreSQL、Redis 和对象存储，多个 Harbor 实例共享后端。复制用于跨地域分发，不是备份；备份需要覆盖数据库、对象存储和配置。

## 排查要点

检查项目配额、存储使用、GC 历史、扫描器健康和复制任务。推送失败常见于认证、项目不存在、配额不足或网络策略；拉取失败还要检查镜像路径和 tag 是否被覆盖。

## 参考资料

- [Harbor Documentation](https://goharbor.io/docs/)
- [Architecture](https://goharbor.io/docs/2.11.0/administration/)`,
    { versions: 'Harbor 2.10+', docsUrl: 'https://goharbor.io/docs/' },
  ),
  d(
    'del-terraform',
    {
      technicalRole: '声明式基础设施即代码工具，负责云资源的创建、变更、依赖管理和状态跟踪。',
      corePrinciple: 'Terraform 读取 HCL 配置和 State，调用 Provider 获取真实资源，计算 plan 后按依赖图执行 apply。',
      keyMechanism: 'HCL、Provider、State、Plan/Apply、Module、Workspace、Remote Backend、State Lock、Import。',
      useCases: '云资源编排、多环境基础设施、模块复用、变更评审、漂移检测、资源导入。',
      commonIssues: 'State 与真实资源漂移；多人并发操作；密钥写入 State；模块版本不锁；destroy 误删生产资源。',
    },
    `## 定位

Terraform 用声明式配置描述基础设施。它不是脚本执行器：核心是维护配置、State 和真实资源三者的一致性，并通过 plan 在变更前展示差异。

## 工作流程

~~~text
HCL 配置 ──► 初始化 Provider/Module
                 │
                 ▼
           refresh 真实资源
                 │
                 ▼
           生成 plan ──► 人工评审 ──► apply
                 │
                 ▼
             更新 State
~~~

State 记录资源地址、属性和依赖关系。没有 State，Terraform 无法知道某个资源是否已经存在；State 与真实资源不一致时，plan 会出现意外创建或删除。

## 状态管理

生产环境必须使用远程 Backend，并开启状态锁，避免多人同时 apply。State 可能包含敏感信息，应加密存储并限制访问。不要把 State 提交到 Git。

## 模块与环境

模块用于复用一组资源，但不要把环境差异全部塞进一个巨型模块。常见做法是“基础模块 + 环境目录/变量”，每个环境独立 State。Provider 和模块版本要锁定，避免隐式升级。

## 风险控制

- apply 前必须审阅 plan，尤其是 destroy、replace 和 IAM/网络变更。
- 使用 \`prevent_destroy\` 保护关键资源。
- 定期执行 plan 检测漂移，不要用手工修改长期绕过 IaC。
- 导入现有资源时先写配置再 \`terraform import\`，并核对 plan 为空。

## 参考资料

- [Terraform Documentation](https://developer.hashicorp.com/terraform/docs)
- [State](https://developer.hashicorp.com/terraform/language/state)`,
    { versions: 'Terraform 1.6+', docsUrl: 'https://developer.hashicorp.com/terraform/docs' },
  ),
  d(
    'del-ansible',
    {
      technicalRole: '无代理配置管理与自动化工具，负责主机初始化、应用部署和批量运维任务。',
      corePrinciple: '控制节点通过 SSH 等连接把模块推送到被管节点执行，Playbook 按幂等任务描述目标状态，Inventory 定义主机分组。',
      keyMechanism: 'Inventory、Playbook、Role、Module、Task、Handler、Template、Vault、Facts、Strategy。',
      useCases: '主机初始化、配置下发、应用部署、批量命令、滚动变更、云资源后置配置。',
      commonIssues: '任务非幂等导致重复执行出错；Inventory 过期；密钥管理不当；串行执行过慢；错误处理缺失。',
    },
    `## 定位

Ansible 用 SSH 和 Python 模块完成配置管理，不需要在被管节点安装常驻 Agent。它适合“把一组主机带到某个状态”，也适合一次性批量操作，但需要刻意保证幂等。

## 核心组成

- **Inventory**：主机与分组，可静态文件或动态插件生成。
- **Playbook**：按顺序执行的 Play 列表。
- **Role**：可复用的任务、模板、文件和变量集合。
- **Module**：实际执行单元，如 \`apt\`、\`copy\`、\`template\`、\`service\`。
- **Handler**：由任务通知，通常在变更后重启服务。
- **Vault**：加密敏感变量。

## 幂等性

幂等意味着重复执行结果一致。使用 \`command\`/\`shell\` 时容易破坏幂等，应优先使用专用模块，或增加 \`creates\`、\`changed_when\` 等条件。非幂等任务会让滚动发布和重试变得危险。

## 执行策略

默认线性策略按主机批次推进，\`serial\` 可以控制滚动比例，\`max_fail_percentage\` 控制失败容忍。大规模场景要关注 fork 数、连接复用和事实缓存，避免控制节点成为瓶颈。

## 与 Terraform 的分工

Terraform 负责“创建基础设施”，Ansible 负责“配置已有主机和应用”。两者边界要清晰：不要让 Ansible 去创建云资源，也不要让 Terraform 承担主机内配置。若使用云初始化，可通过 user-data 完成最小引导，再由 Ansible 接管。

## 排查要点

使用 \`--check\` 预演、\`-vvv\` 查看连接与模块参数、\`--start-at-task\` 重跑。常见失败是 SSH 认证、Python 解释器缺失、sudo 权限、变量优先级和模板渲染错误。

## 参考资料

- [Ansible Documentation](https://docs.ansible.com/)
- [Playbook Best Practices](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_best_practices.html)`,
    { versions: 'ansible-core 2.16+', docsUrl: 'https://docs.ansible.com/' },
  ),
  d(
    'infra-istio',
    {
      technicalRole: '服务网格控制面与数据面体系，提供流量管理、mTLS、授权和统一遥测。',
      corePrinciple: 'istiod 把 VirtualService、DestinationRule 等配置转换为 xDS 下发给 Envoy；数据面代理拦截并处理服务间流量。',
      keyMechanism: 'istiod、Envoy sidecar/ambient、VirtualService、DestinationRule、Gateway、PeerAuthentication、AuthorizationPolicy、Telemetry。',
      useCases: '灰度发布、流量镜像、超时重试、mTLS、服务级授权、跨集群流量治理。',
      commonIssues: 'sidecar 注入遗漏；配置作用域冲突；mTLS 模式不匹配；资源开销；升级顺序导致控制面与数据面不兼容。',
    },
    `## 定位

Istio 解决服务间通信的治理问题：流量路由、重试超时、熔断、mTLS、授权和遥测。它把治理逻辑从应用代码下沉到数据面代理，由控制面统一下发配置。

## 架构

- **控制面 istiod**：服务发现、配置分发、证书签发。
- **数据面**：Envoy sidecar 或 ambient 模式下的 ztunnel/waypoint。
- **配置资源**：VirtualService 控制路由，DestinationRule 定义子集和连接池，Gateway 管理入口，AuthorizationPolicy 定义访问控制。

~~~text
应用 A ──► Envoy sidecar ──mTLS──► Envoy sidecar ──► 应用 B
                  ▲                        ▲
                  └──────── xDS ───────────┘
                         istiod
~~~

## 流量治理

VirtualService 按 host、header、权重等条件匹配路由；DestinationRule 定义 subset、负载均衡、连接池和异常点检测。重试要设置次数和超时，避免放大故障；熔断阈值要结合实例容量。

## 安全

PeerAuthentication 控制 mTLS 模式，AuthorizationPolicy 基于身份、命名空间和方法授权。启用 STRICT mTLS 前要确认所有工作负载都已注入代理，否则未注入的服务会被拒绝。

## 运维要点

sidecar 会增加资源开销和网络跳数；ambient 模式降低部分开销但引入新的组件。升级要遵循控制面先行的兼容矩阵。排查时先看 istiod 配置分发状态，再看 Envoy 的 route/cluster 配置和访问日志。

## 参考资料

- [Istio Documentation](https://istio.io/latest/docs/)
- [Traffic Management](https://istio.io/latest/docs/concepts/traffic-management/)`,
    { versions: 'Istio 1.20+', docsUrl: 'https://istio.io/latest/docs/' },
  ),
  d(
    'infra-envoy',
    {
      technicalRole: '高性能 L4/L7 代理和数据平面，承担入口网关、服务间代理和动态流量治理。',
      corePrinciple: 'Listener 接收连接，Filter Chain 处理协议，Cluster 定义上游；xDS 动态下发监听器、路由、集群和端点配置。',
      keyMechanism: 'Listener、Filter、Route、Cluster、Endpoint、xDS、Circuit Breaker、Outlier Detection、Retry、Access Log。',
      useCases: 'API 网关、服务网格数据面、边缘代理、灰度路由、限流熔断、TLS 终止。',
      commonIssues: '配置未生效或版本冲突；上游健康检查误判；连接池过小；重试风暴；访问日志与指标缺失。',
    },
    `## 定位

Envoy 是可编程的高性能代理，既可以作为边缘网关，也可以作为服务网格的 sidecar。它的核心价值是把网络治理配置化，并通过 xDS 动态更新而无需重启。

## 配置模型

- **Listener**：监听地址和端口，绑定 Filter Chain。
- **Filter**：处理连接和 HTTP 请求，如 HTTP Connection Manager、TLS Inspector、限流。
- **Route**：按 host、path、header 匹配并选择 Cluster。
- **Cluster**：上游服务集合，定义负载均衡、健康检查、连接池和 TLS。
- **Endpoint**：Cluster 中的具体实例。

## 动态配置

xDS 包括 LDS、RDS、CDS、EDS 等，由控制面推送。Envoy 会校验配置版本并保留最后一次有效配置；控制面故障时通常继续使用旧配置，但新实例可能无法启动。

## 可靠性机制

重试、超时、熔断、异常点检测和连接池共同决定故障时的行为。重试必须限制次数并配合预算，否则会放大后端压力；熔断阈值要根据实例容量设置，而不是照搬默认值。

## 排查要点

使用 \`/config_dump\`、\`/clusters\`、\`/stats\` 和访问日志定位问题。常见现象是 503（无健康上游）、超时（上游慢或连接池耗尽）、配置未更新（xDS 版本或权限问题）。检查 Envoy 自身指标中的 upstream_rq_pending、cx_overflow 和 health check 状态。

## 参考资料

- [Envoy Documentation](https://www.envoyproxy.io/docs/envoy/latest/)
- [Architecture](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/arch_overview)`,
    { versions: 'Envoy 1.30+', docsUrl: 'https://www.envoyproxy.io/docs/envoy/latest/' },
  ),
  d(
    'infra-cert-manager',
    {
      technicalRole: 'Kubernetes 证书生命周期控制器，自动签发、续期和挂载 TLS 证书。',
      corePrinciple: 'Certificate 资源声明所需证书，Issuer/ClusterIssuer 定义签发来源，控制器申请证书并写入 Secret，到期前自动续期。',
      keyMechanism: 'Certificate、Issuer、ClusterIssuer、ACME、HTTP-01/DNS-01、Secret、Ingress Shim、CA Injector、Trust Bundle。',
      useCases: 'Ingress TLS、内部服务证书、私有 CA、ACME 自动签发、证书轮换。',
      commonIssues: 'ACME 挑战失败；DNS 权限不足；Secret 未就绪；证书链不完整；续期失败无人发现。',
    },
    `## 定位

cert-manager 把证书当作 Kubernetes 资源管理。用户声明“我需要什么证书”，控制器负责向 CA 申请、保存到 Secret，并在到期前续期。

## 核心资源

- **Issuer / ClusterIssuer**：命名空间级或集群级的签发者，支持 ACME、CA、Vault、自签等。
- **Certificate**：期望的 DNS 名称、密钥算法、有效期和 Secret 名称。
- **Secret**：控制器写入的 \`tls.crt\`、\`tls.key\` 和 \`ca.crt\`。
- **Ingress Shim**：根据 Ingress 注解自动创建 Certificate。

## ACME 流程

ACME 签发需要证明域名控制权。HTTP-01 通过临时路径校验，DNS-01 通过 TXT 记录校验。DNS-01 支持通配符证书，但需要 DNS Provider 的 API 权限；权限过大是常见安全风险。

## 续期与信任

证书通常在到期前 30 天续期，可通过 \`renewBefore\` 调整。续期后 Secret 更新，挂载该 Secret 的 Pod 需要能感知变化或滚动重启。私有 CA 场景需要分发 trust bundle，确保客户端信任完整证书链。

## 排查要点

先看 Certificate 的 conditions 和 events，再看 Order/Challenge 状态。常见原因是 DNS 记录未生效、ACME 账户注册失败、HTTP 路由被网关拦截、Secret 权限不足。监控证书到期时间和续期失败事件，不要只看 Pod 是否运行。

## 参考资料

- [cert-manager Documentation](https://cert-manager.io/docs/)
- [ACME](https://cert-manager.io/docs/configuration/acme/)`,
    { versions: 'cert-manager 1.14+', docsUrl: 'https://cert-manager.io/docs/' },
  ),
  d(
    'infra-podman',
    {
      technicalRole: '无守护进程的容器与 Pod 管理工具，承担本地开发、rootless 运行和 systemd 集成。',
      corePrinciple: 'Podman 直接调用 OCI 运行时，通过 conmon 监管容器进程；没有常驻 daemon，权限模型跟随调用用户。',
      keyMechanism: 'conmon、rootless、Pod、Quadlet、Buildah、Skopeo、Docker 兼容 CLI、systemd 集成。',
      useCases: '开发环境容器、rootless 生产工作负载、单机 Pod、CI 构建、systemd 管理容器。',
      commonIssues: 'rootless 端口与网络限制；用户命名空间映射；Pod 内共享网络；Quadlet 单元配置错误；与 Docker socket 不兼容。',
    },
    `## 定位

Podman 提供与 Docker 类似的容器 CLI，但没有常驻守护进程。每个容器由 conmon 监管，Podman 命令直接与 OCI 运行时交互。这让权限边界更接近普通进程，也避免了 daemon 单点。

## Rootless

rootless 模式使用用户命名空间，把容器内 UID 映射到宿主机非特权 UID。它提高了安全性，但也带来限制：绑定低端口需要额外配置，部分存储驱动和网络模式不可用，卷权限需要正确映射。

## Pod 与 Quadlet

Podman Pod 把多个容器放进共享网络命名空间，类似 Kubernetes Pod 的最小单元。Quadlet 用 systemd 单元描述容器，由 systemd 负责启动、停止和重启，适合单机生产服务。

## 工具链

- **Buildah**：构建 OCI 镜像，不依赖 daemon。
- **Skopeo**：检查和复制镜像，不需要本地运行时。
- **Podman**：运行和管理容器/Pod。
- **Docker 兼容**：CLI 大部分兼容，但依赖 Docker socket 的工具需要 podman.socket 或替代方案。

## 排查要点

检查 \`podman info\` 的 rootless、cgroup 和存储驱动；网络问题看 CNI/Netavark 配置；权限问题看 subuid/subgid 映射；systemd 场景看 \`journalctl -u\` 和 Quadlet 生成的单元。不要把 Docker daemon 的默认行为直接套用到 Podman。

## 参考资料

- [Podman Documentation](https://podman.io/docs)
- [Rootless](https://github.com/containers/podman/blob/main/docs/tutorials/rootless_tutorial.md)`,
    { versions: 'Podman 4.8+ / 5.x', docsUrl: 'https://podman.io/docs' },
  ),
];
