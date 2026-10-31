import type { TechExternalLink } from '../../shared/types.js';
import type { TechCardContent, TechContentEntry } from './tech-content.js';

type DocOptions = {
  versions: string;
  docsUrl?: string;
  repoUrl?: string;
  referenceLinks?: TechExternalLink[];
  version?: number;
  replacesContentHash?: string;
};

function d(
  nodeId: string,
  card: TechCardContent,
  contentMarkdown: string,
  options: DocOptions,
): TechContentEntry {
  return {
    nodeId,
    version: options.version ?? 1,
    ...card,
    contentMarkdown,
    contentStatus: 'draft',
    contentSource: 'mixed',
    applicableVersions: options.versions,
    docsUrl: options.docsUrl,
    repoUrl: options.repoUrl,
    referenceLinks: options.referenceLinks,
    replacesContentHash: options.replacesContentHash,
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
    `## 技术定位

MySQL 是通用关系型数据库管理系统，生产环境通常以 InnoDB 作为存储引擎。它位于业务应用与持久化存储之间，负责事务写入、索引查询、复制、备份和崩溃恢复。

MySQL 适合访问路径相对稳定、需要强事务和二级索引的 OLTP 业务。它不适合把大规模聚合分析、全文检索、队列或跨库强事务当作主要负载；这些场景通常需要 ClickHouse、搜索引擎、消息系统或分布式事务方案。

## 设计原理

InnoDB 以主键组织聚簇索引，叶子节点直接保存整行数据。二级索引的叶子保存索引列和主键值，查询非覆盖列时必须回表。这个设计让主键查询很快，也意味着主键选择、二级索引数量和随机 I/O 会直接影响写入与查询成本。

持久性依赖 WAL：修改先写 redo log，数据页可以在后台异步刷盘。undo log 保存旧版本，支撑回滚和 MVCC 一致性读。binlog 记录逻辑变更，用于复制、审计和 CDC。提交时 redo 与 binlog 需要保持一致，崩溃恢复才能既不丢已提交事务，也不把未提交事务带到备库。

MVCC 不是“无锁读取”。普通一致性读使用 Read View 判断版本可见性，不加行锁；当前读，例如锁定读、更新和删除，读取最新版本并使用行锁、间隙锁或 Next-Key Lock。把两者混为一谈，会错误判断幻读和锁等待。

## 工作机制

一次查询依次经过连接管理、SQL 解析、优化器、执行器和 InnoDB。优化器根据统计信息选择索引与连接顺序；执行器从 Buffer Pool 读取页面，未命中时再从磁盘加载。Buffer Pool 既是读缓存，也是写缓冲，脏页由后台线程按检查点和刷脏策略写回。

一次更新的大致过程是：定位并锁定记录，写 undo，修改 Buffer Pool 中的数据页，写 redo，提交阶段写 binlog 并完成 redo 与 binlog 的一致性，然后释放锁。后台 purge 线程清理不再需要的 undo 版本。

复制通常由主库写 binlog、备库拉取并回放组成。GTID 让备库记录已执行的事务集合，简化切换和断点续传；并行复制可以提升回放能力，但大事务、无主键表和单线程热点仍会造成延迟。

## 关键配置与实践

- innodb_buffer_pool_size 决定缓存能力，过小会让读放大为磁盘 I/O，过大则挤压系统内存。
- innodb_flush_log_at_trx_commit 与 sync_binlog 共同决定提交持久性；放宽刷盘可以提高吞吐，但故障时可能丢失最近事务。
- transaction_isolation 常用 READ COMMITTED 或 REPEATABLE READ；后者依赖 Next-Key Lock 处理幻读，锁范围更大。
- binlog_format 应使用 ROW，binlog_row_image 影响 CDC 和回放的数据量；gtid_mode 影响主从切换方式。
- max_connections 必须与连接池上限匹配，连接数过高会消耗内存并加剧上下文切换。
- 在线 DDL 仍可能持有元数据锁或重建表，执行前应评估锁等待、磁盘空间和复制延迟。

## 版本差异与兼容性

本文以 MySQL 9.7 LTS 为核实基线，覆盖 8.4 LTS 与 9.7 LTS；8.0 已于 2026-04-30 结束生命周期。不能把 9.7 的新默认值直接套到 8.4。

| 版本线 | 状态 | 对本文的影响 |
| --- | --- | --- |
| 9.7 LTS | 当前长期支持基线 | 默认认证插件、字符集和复制行为以 9.7 文档为准 |
| 8.4 LTS | 上一代 LTS，支持至 2032-04-30 | 升级前核对认证插件、默认字符集和废弃参数 |
| 8.0 | 已于 2026-04-30 EOL | 不应作为新部署基线 |

MySQL 与 MariaDB 在部分语法和复制行为上兼容，但不是同一产品，不能用 MariaDB 的版本周期推断 MySQL。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| 查询突然变慢 | 统计信息失真、索引选择变化、锁等待 | EXPLAIN、performance_schema、慢查询日志 |
| 锁等待超时 | 长事务、缺失索引导致锁定范围扩大 | data_locks、data_lock_waits、事务年龄 |
| 主从延迟 | 大事务、无主键表、并行度不足、网络 | 备库回放线程、relay log、GTID 缺口 |
| 磁盘持续增长 | undo 无法 purge、binlog 未清理、临时表 | history list length、binlog 过期策略、表空间 |
| 连接被打满 | 连接池上限过高、应用泄漏、慢查询占用 | 连接来源、Sleep 连接、max_connections |

需要特别区分“SQL 执行慢”和“等锁慢”。前者看执行计划和扫描行数，后者看锁持有者与事务状态，不能只靠增加索引解决。

## 技术关联

应用通过连接池访问 MySQL；Redis 常位于其前承担热点缓存；CDC 工具读取 binlog 把变更送入 Kafka 等流系统；备份与副本用于恢复和读扩展。MySQL 与 PostgreSQL 在通用 OLTP 场景存在替代关系，但事务实现、复制和扩展生态不同。

## 参考资料

- [MySQL 9.7 Reference Manual](https://dev.mysql.com/doc/refman/9.7/en/)
- [InnoDB Storage Engine](https://dev.mysql.com/doc/refman/9.7/en/innodb-storage-engine.html)
- [InnoDB Transaction Model](https://dev.mysql.com/doc/refman/9.7/en/innodb-transaction-model.html)`,
    {
      versions: 'MySQL 8.4 LTS / 9.7 LTS（核实基线 9.7 LTS；8.0 已于 2026-04-30 EOL）',
      docsUrl: 'https://dev.mysql.com/doc/refman/9.7/en/',
      version: 2,
      replacesContentHash: 'f51bc51417038eeb8a8e5b5c423be4c2777a982d6e7bd37b297fec88a0278175',
      referenceLinks: [
        { label: 'MySQL 8.4 Reference Manual', url: 'https://dev.mysql.com/doc/refman/9.7/en/' },
        { label: 'InnoDB Storage Engine', url: 'https://dev.mysql.com/doc/refman/9.7/en/innodb-storage-engine.html' },
        { label: 'InnoDB Transaction Model', url: 'https://dev.mysql.com/doc/refman/9.7/en/innodb-transaction-model.html' },
      ],
    },
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
    `## 技术定位

PostgreSQL 是开源对象关系型数据库，兼顾问标准兼容、扩展性和复杂查询。它位于业务应用与持久化存储之间，承担事务写入、复杂 SQL、JSONB、全文检索、地理数据和多种复制拓扑。

PostgreSQL 适合需要复杂查询、扩展类型、逻辑复制或强一致事务的系统。它不适合把超大规模列式聚合、海量小写入或简单键值缓存作为唯一目标；这些负载通常交给 ClickHouse、消息系统或 Redis。

## 设计原理

PostgreSQL 的 MVCC 通过堆表中的多版本元组实现。更新不会原地覆盖旧行，而是写入新元组，旧元组通过 xmin/xmax 等事务信息判断可见性。读请求使用快照，因此读不阻塞写，写也不阻塞读；代价是死元组需要 VACUUM 回收。

这与 InnoDB 有明显差异：InnoDB 把旧版本放在 undo 表空间，由 purge 清理；PostgreSQL 把旧版本留在堆表中，由 VACUUM 清理。两者都叫 MVCC，但膨胀来源、清理机制和长事务影响不同，不能互相套用。

WAL 记录页面变更，检查点把脏页刷盘并推进可回收的 WAL 位置。崩溃恢复从最后一个检查点重放 WAL。索引包括 B-tree、GIN、GiST、BRIN 等，分别适合等值范围、复合值、几何/全文和超大有序表。

## 工作机制

连接进入后端进程后，解析器生成语法树，重写系统处理规则和视图，规划器根据统计信息估算代价并选择连接顺序、访问方法和并行计划，执行器从共享缓冲区或磁盘读取页面并返回结果。

一次更新会写入新元组、更新索引、产生 WAL，并在提交时刷写 WAL。后台 checkpointer 定期执行检查点，autovacuum 根据阈值和成本延迟清理死元组并更新统计信息。复制分为物理复制和逻辑复制：前者传输 WAL 字节流，备库与主库物理一致；后者按表解码变更，可跨版本和选择性复制。

## 关键配置与实践

- shared_buffers 控制共享缓存；work_mem 影响排序和哈希，按单操作分配，设置过大可能被并发放大。
- max_connections 需要和连接池配合；PostgreSQL 每连接一个后端进程，连接数过高会消耗内存和调度资源。
- autovacuum 参数决定清理频率；表级设置可用于高更新表，但不能长期关闭。
- wal_level、max_wal_senders 和复制槽决定复制能力；未消费的复制槽会保留 WAL 并占满磁盘。
- effective_cache_size 帮助规划器估算缓存，不是实际分配内存。
- 逻辑复制需要发布、订阅和复制标识；无主键表更新会受限或代价很高。

## 版本差异与兼容性

本文以 PostgreSQL 18 为核实基线，覆盖 16–18；15 仍在支持期。具体支持日期以 PostgreSQL 官方版本政策为准。

| 版本线 | 状态 | 对本文的影响 |
| --- | --- | --- |
| 18 | 当前主线，核实基线 | 规划器、复制和监控视图以 18 文档为准 |
| 16–17 | 受支持 | 大部分机制一致，新参数和视图需逐项核对 |
| 15 | 支持期后段 | 升级前核对扩展、复制槽和废弃参数 |

PostgreSQL 与 MySQL 都支持 MVCC，但旧版本存放位置和清理方式不同；不能把 PostgreSQL 的 VACUUM 经验直接套到 InnoDB。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| 表持续膨胀 | 长事务、复制槽、autovacuum 跟不上 | pg_stat_activity、pg_stat_user_tables、pg_stat_progress_vacuum |
| 查询突然变慢 | 统计信息过期、计划翻转、连接顺序变化 | EXPLAIN (ANALYZE, BUFFERS)、pg_stat_statements |
| 连接耗尽 | 连接池过大、空闲事务、应用泄漏 | pg_stat_activity、连接池指标 |
| 复制延迟 | 长事务、网络、备库 I/O、逻辑复制冲突 | pg_stat_replication、pg_stat_subscription、WAL 生成速率 |
| 磁盘被 WAL 占满 | 复制槽未消费、归档失败 | pg_replication_slots、archive_command 日志 |

VACUUM 不是“可选优化”。长期不清理会让表和索引膨胀，查询扫描更多页面，甚至接近事务 ID 回卷风险。

## 技术关联

应用通过连接池访问 PostgreSQL；逻辑复制可把变更送入下游数据库或流系统；物理复制用于高可用；Grafana 可通过数据源查询指标。它与 MySQL 在通用 OLTP 场景存在替代关系，但扩展、索引和复制模型不同。

## 参考资料

- [PostgreSQL Documentation](https://www.postgresql.org/docs/current/)
- [Concurrency Control](https://www.postgresql.org/docs/current/mvcc.html)
- [Write-Ahead Logging](https://www.postgresql.org/docs/current/wal-intro.html)`,
    {
      versions: 'PostgreSQL 16–18（核实基线 18；15 仍在支持期）',
      docsUrl: 'https://www.postgresql.org/docs/current/',
      version: 2,
      replacesContentHash: '6896a99c70090ade11a1de8178ee5ea09d2d4c9ad8ad586eafdeaa257954664e',
      referenceLinks: [
        { label: 'PostgreSQL Documentation', url: 'https://www.postgresql.org/docs/current/' },
        { label: 'Concurrency Control', url: 'https://www.postgresql.org/docs/current/mvcc.html' },
        { label: 'Write-Ahead Logging', url: 'https://www.postgresql.org/docs/current/wal-intro.html' },
      ],
    },
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
    `## 技术定位

Redis 是内存数据结构存储，Valkey 是与其协议兼容、独立演进的另一条版本线。它通常位于数据库之前，承担热点缓存、会话、计数、排行榜、限流、分布式锁和轻量消息，而不是替代关系型数据库的持久化与事务体系。

Redis 适合可重建、访问频繁、延迟敏感的数据。它不适合作为唯一账本、复杂多表事务、超大冷数据仓库或强一致跨键事务系统。

## 设计原理

Redis 的核心取舍是用内存换取低延迟，用简单数据结构换取可预测的命令复杂度。键空间包含字符串、哈希、列表、集合、有序集合、位图、HyperLogLog、Stream 等结构，每种结构的单命令复杂度不同。

“Redis 是单线程”只描述了命令执行模型的一部分。命令在主执行线程串行处理，避免数据结构并发竞争；网络读写、部分删除和持久化可以使用后台线程或子进程。Redis 6 以后支持 IO 多线程处理网络收发，但命令执行仍保持串行。理解这一点，才能判断慢命令、大 key 和阻塞到底发生在哪一层。

持久化是恢复手段，不是数据库级事务保证。RDB 生成时间点快照，AOF 追加写命令，混合持久化结合两者。主从复制默认异步，故障切换可能丢失尚未同步的写入。

## 工作机制

客户端通过 RESP 协议发送命令，事件循环读取并执行，结果写回连接。单条命令执行期间，其他客户端命令排队；因此 O(N) 命令、复杂 Lua、一次性返回大量元素和大 key 删除都会放大尾延迟。

过期键采用惰性删除加定期抽样删除。内存达到 maxmemory 后按淘汰策略处理，例如 noeviction、allkeys-lru、volatile-lru 等。淘汰策略错误会让写入失败或误删重要键。

Sentinel 负责监控、选主和通知，Cluster 把键空间分成 16384 个槽并在节点间迁移。Cluster 的多 key 操作要求键在同一槽，跨槽事务和 Lua 需要特殊设计。

## 关键配置与实践

- maxmemory 与 maxmemory-policy 决定内存上限和淘汰行为；缓存实例与持久化实例应使用不同策略。
- appendonly 与 appendfsync 决定 AOF 持久性；everysec 是常见折中，always 代价更高。
- save 配置决定 RDB 快照频率；快照 fork 会带来内存和 I/O 抖动。
- timeout、tcp-keepalive 和 client-output-buffer-limit 影响连接与慢消费者。
- Cluster 的 cluster-node-timeout 影响故障判定；过短会误判，过长会延长不可用时间。
- 慢查询阈值 slowlog-log-slower-than 应结合业务延迟目标设置。

## 版本差异与兼容性

本文以 Redis 8.10.3 与 Valkey 9.1.3 为参照，核实基线为两条版本线的最新稳定发布。Redis 与 Valkey 已独立演进，版本号、许可、功能和支持周期不能互相推断。

| 版本线 | 状态 | 对本文的影响 |
| --- | --- | --- |
| Redis 8.10.x | 当前主线，核实基线 8.10.3 | 数据结构、持久化和集群行为以 Redis 8.10 文档为准 |
| Valkey 9.1.x | 独立主线，核实基线 9.1.3 | 兼容 RESP，但功能与默认值需查 Valkey 9.1 文档 |
| Redis 7.x | 历史版本 | 新部署优先使用 8.x，升级前核对模块和持久化格式 |

不能把“Redis 是单线程”写成所有版本、所有路径都只用一个线程；也不能用 Redis 的 EOL 日期推断 Valkey。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| 延迟尖刺 | 大 key、慢命令、fork、网络拥塞 | SLOWLOG、LATENCY、INFO commandstats |
| 内存持续增长 | 无淘汰、碎片、过期键未清理 | INFO memory、MEMORY USAGE、键数量 |
| 缓存穿透 | 查询不存在的数据 | 空值缓存、布隆过滤器、参数校验 |
| 缓存击穿 | 热点键过期瞬间回源 | 互斥重建、逻辑过期、预热 |
| 缓存雪崩 | 大批键同时失效 | 随机 TTL、多级缓存、限流 |
| 主从切换丢数据 | 异步复制、确认不足 | WAIT、复制偏移、Sentinel/Cluster 日志 |

分布式锁的安全边界需要单独说明：单实例锁在主从切换时可能失效，Redlock 也依赖时钟和多数派假设。对强一致要求高的场景，应使用数据库条件更新、共识系统或业务幂等，而不是只依赖 Redis 锁。

## 技术关联

应用通过客户端连接 Redis；它通常位于 MySQL 或 PostgreSQL 之前承担缓存；Stream 可作为轻量消息通道，但不能替代 Kafka 的持久回放和分区语义；Grafana 和 Prometheus 可采集其指标。Redis 与 Valkey 在协议层兼容，但版本与支持周期独立。

## 参考资料

- [Redis Documentation](https://redis.io/docs/latest/)
- [Redis Persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Valkey Documentation](https://valkey.io/docs/)`,
    {
      versions: 'Redis 8.10.x / Valkey 9.1.x（核实基线 8.10.3 / 9.1.3；两条版本线独立）',
      docsUrl: 'https://redis.io/docs/latest/',
      version: 2,
      replacesContentHash: '8e6043eadec7beda86886a7a82f72e4cdde97049f14173cef6a02ed21bf61417',
      referenceLinks: [
        { label: 'Redis Documentation', url: 'https://redis.io/docs/latest/' },
        { label: 'Redis Persistence', url: 'https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/' },
        { label: 'Valkey Documentation', url: 'https://valkey.io/docs/' },
      ],
    },
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
    `## 技术定位

ClickHouse 是面向在线分析的列式数据库，位于数据采集与报表/分析层之间，承担日志、指标、事件和行为数据的大规模聚合查询。

它适合“批量追加、扫描多行、只读少数列、聚合分析”的负载。它不适合强事务、频繁单行更新、复杂多表事务或高并发点查；这些场景应由 OLTP 数据库、缓存或检索系统承担。

## 设计原理

ClickHouse 按列存储和压缩，查询只读取涉及的列，减少 I/O。MergeTree 表按分区组织，每个分区内按排序键排序，数据被切成 granule，稀疏主键索引记录每个 granule 的边界，从而跳过不相关的数据块。

分区键、排序键和主键不是一回事：分区键决定数据目录和分区裁剪；排序键决定 part 内有序性和稀疏索引；主键是排序键的前缀，用于索引标记。把三者混为一谈，会导致分区过多、索引失效或查询无法裁剪。

写入采用追加和后台 merge。每次插入生成 part，后台线程把多个 part 合并成更大的 part。向量化执行按列批处理，提高 CPU 利用率和压缩效率。代价是更新和删除需要重写 part，不能当作 OLTP 行级操作。

## 工作机制

一次查询先做分区裁剪，再用稀疏主键索引定位 granule，按列读取并解压，执行过滤、聚合和排序。分布式查询把子查询下发到各 shard，再由发起节点汇总；网络传输和 shard 数据倾斜会显著影响延迟。

ReplicatedMergeTree 通过 Keeper 协调副本，复制 part 和元数据。分布式表本身不存数据，只是查询路由；本地表和分布式表的写入语义需要区分。

Materialized View 在插入时执行预聚合，适合固定维度的指标汇总；它不会自动修复历史数据，模式变更也需要重建。

## 关键配置与实践

- ORDER BY 应覆盖最常用的过滤和前缀匹配列，兼顾基数与压缩；不要盲目把高基数列放最前。
- PARTITION BY 应控制分区数量，通常按时间粒度；过细分区会产生大量 part 和小文件。
- 批量写入每次数万到数十万行更合适；高频小批量写入会触发 too many parts。
- max_memory_usage、max_bytes_before_external_group_by 控制聚合内存，避免 OOM。
- 副本表需要 Keeper；Keeper 不可用时写入和副本协调会受影响。
- Mutation 和轻量删除是异步重写，不能用于高频更新；优先使用 ReplacingMergeTree 或变更建模。

## 版本差异与兼容性

本文以 ClickHouse 26.8 LTS 为核实基线，并覆盖 26.10 当前主线。ClickHouse 按月发布，LTS 与普通版本的维护窗口不同，具体日期以官方 Release 为准。

| 版本线 | 状态 | 对本文的影响 |
| --- | --- | --- |
| 26.8 LTS | 长期支持基线（至 2027-08-27） | MergeTree、Keeper 和查询行为以该版本文档为准 |
| 26.10 | 当前主线 | 新特性先确认是否已进入 LTS |
| 25.x | 历史版本 | 升级前核对表引擎、Keeper 和分布式表兼容性 |

ClickHouse 与 MySQL/PostgreSQL 都可执行 SQL，但事务、更新和索引模型完全不同，不能把 OLTP 的调优经验直接套用。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| too many parts | 小批量高频写入、分区过细 | system.parts、写入批次、分区粒度 |
| 查询扫描量过大 | 分区/排序键不匹配、缺少 PREWHERE | EXPLAIN、query_log、分区裁剪 |
| 聚合内存超限 | 高基数 GROUP BY、大宽表 | max_memory_usage、external aggregation、近似函数 |
| 副本不同步 | Keeper 异常、复制队列积压 | system.replicas、Keeper 日志 |
| 删除/更新很慢 | Mutation 重写 part | system.mutations、part 大小、替代表引擎 |

ClickHouse 的“删除”不是立即物理删除；Mutation 在后台重写数据，期间磁盘和 I/O 压力会上升。需要频繁更新的数据应在建模阶段解决。

## 技术关联

日志和事件通常由 Kafka、Vector 或 OpenTelemetry Collector 写入 ClickHouse；Grafana 通过数据源查询并展示；物化视图承担预聚合；Keeper 为副本提供协调。它与 OLTP 数据库是互补关系，而不是通用替代。

## 参考资料

- [ClickHouse Documentation](https://clickhouse.com/docs)
- [MergeTree Engine](https://clickhouse.com/docs/engines/table-engines/mergetree-family/mergetree)
- [ClickHouse Keeper](https://clickhouse.com/docs/guides/sre/keeper/clickhouse-keeper)`,
    {
      versions: 'ClickHouse 26.8 LTS / 26.10（核实基线 26.8 LTS）',
      docsUrl: 'https://clickhouse.com/docs',
      version: 2,
      replacesContentHash: '6d5db3165916e7bd6a8dc1b038bdbfcae274aa90c857a4a6bb626cce51b56671',
      referenceLinks: [
        { label: 'ClickHouse Documentation', url: 'https://clickhouse.com/docs' },
        { label: 'MergeTree Engine', url: 'https://clickhouse.com/docs/engines/table-engines/mergetree-family/mergetree' },
        { label: 'ClickHouse Keeper', url: 'https://clickhouse.com/docs/guides/sre/keeper/clickhouse-keeper' },
      ],
    },
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
    `## 技术定位

Apache Kafka 是分布式事件流平台，位于生产者与消费者之间，承担高吞吐追加日志、解耦、削峰、事件驱动和流处理。它不是传统消息队列的简单替代，也不是数据库。

Kafka 适合需要持久回放、顺序分区、多消费者独立消费和吞吐优先的场景。它不适合低延迟点对点任务队列、复杂路由、单条消息级事务或需要服务端逐条删除的语义。

## 设计原理

Kafka 把主题分成多个分区，每个分区是一条只能追加的日志，消息以偏移量定位。分区内有序，分区之间不保证顺序。顺序性只能通过“同一业务键进入同一分区”获得。

每个分区有多个副本，领导者处理读写，跟随者拉取日志。ISR 是当前与领导者保持同步的副本集合；acks=all 只保证消息写入 ISR，不自动保证所有副本都已落盘。min.insync.replicas 决定最少需要多少个同步副本，二者必须一起配置。

Kafka 4.0 起仅支持 KRaft 元数据模式，ZooKeeper 模式被移除。KRaft 使用控制器 quorum 管理元数据，元数据也以日志复制，减少了外部系统依赖和控制器与 Broker 之间的状态分裂。

## 工作机制

生产者按分区器选择分区，批量压缩后发送给分区领导者。领导者追加日志并等待副本确认；确认级别由 acks 决定。消费者以消费者组为单位分配分区，每个分区在同一组内只由一个消费者处理，偏移量提交到内部主题。

再均衡会暂停分区消费并重新分配。协作式再均衡减少全量暂停，但不能消除业务处理中的重复；消费者必须在处理成功后提交偏移量，并保证处理幂等。

事务把“消费—处理—生产”和偏移量提交绑定为一个原子单元，但事务边界只覆盖 Kafka 内部读写和偏移量。外部数据库写入、HTTP 调用和文件副作用不在 Kafka 事务内，不能承诺端到端恰好一次。

## 关键配置与实践

- replication.factor 应至少为 3，min.insync.replicas 通常为 2，acks=all 才能在单副本故障时保持可写且不丢已确认消息。
- unclean.leader.election.enable 开启可能让落后副本成为领导者，从而丢失数据；生产环境通常保持关闭。
- 分区数决定并行上限，也影响元数据、再均衡和顺序性；不能把分区数当作无限扩容手段。
- compression.type 与 linger.ms 影响吞吐和延迟；batch.size 过小会降低批量收益。
- auto.offset.reset 只决定没有已提交偏移量时的起点，不等同于“从头消费”。
- log.retention 与 cleanup.policy 决定删除或压实；compact 主题保留每个键的最新值，不适合事件全量审计。

## 版本差异与兼容性

本文以 Apache Kafka 4.4.0 为核实基线，覆盖 4.x。4.0 是架构分界：仅支持 KRaft，ZooKeeper 模式不再可用；3.9 是最后支持 ZooKeeper 的版本线。

| 版本线 | 状态 | 对本文的影响 |
| --- | --- | --- |
| 4.x | 当前主线，核实基线 4.4.0 | 仅 KRaft；生产者、消费者和事务语义按 4.x 文档 |
| 3.9 | 最后支持 ZooKeeper 的版本 | 升级到 4.x 前必须完成 KRaft 迁移 |
| 3.x 更早版本 | 历史版本 | 不能直接套用 4.x 的元数据与默认配置 |

KRaft 迁移不是改一个配置项：需要准备控制器 quorum、迁移元数据、切换客户端和滚动重启。迁移步骤必须以对应版本的官方文档为准。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| 生产端超时 | ISR 不足、磁盘慢、网络、批次过大 | acks、min.insync.replicas、ISR 收缩、Broker 磁盘 |
| 消费积压 | 消费者不足、处理慢、分区倾斜 | 消费组 lag、分区分配、单条处理耗时 |
| 重复消费 | 再均衡、偏移量提交晚于处理、事务边界外副作用 | 提交顺序、幂等键、消费者日志 |
| 消息乱序 | 跨分区、重试改变分区、并发处理 | 分区键、max.in.flight、单分区消费并发 |
| 数据丢失 | unclean 选举、acks=1、未复制即删 | 副本配置、领导者选举、保留策略 |

Kafka 的“持久化”受保留策略约束。消息超过保留时间或大小会被删除，不能把 Kafka 当作无限期归档存储；长期归档应进入对象存储或数据湖。

## 技术关联

Kafka 常接收应用事件、数据库 CDC 和日志采集，向下游提供流处理、索引和数仓入湖。它可与 Pulsar 在事件流场景互为替代，与 RabbitMQ 在任务队列场景互补。Kafka 本身不执行复杂查询，分析通常落到 ClickHouse 等系统。

## 参考资料

- [Apache Kafka Documentation](https://kafka.apache.org/documentation/)
- [Kafka Design](https://kafka.apache.org/documentation/#design)
- [Kafka 4.4 Upgrade Notes](https://kafka.apache.org/44/documentation.html#upgrade)`,
    {
      versions: 'Apache Kafka 4.x（核实基线 4.4.0；4.0 起仅支持 KRaft）',
      docsUrl: 'https://kafka.apache.org/documentation/',
      version: 2,
      replacesContentHash: 'd62a1cf536e6955e450f27207d6a3d5421b8f9be2c23556a99235d65295b371c',
      referenceLinks: [
        { label: 'Apache Kafka Documentation', url: 'https://kafka.apache.org/documentation/' },
        { label: 'Kafka Design', url: 'https://kafka.apache.org/documentation/#design' },
        { label: 'Kafka 4.0 Release Notes', url: 'https://kafka.apache.org/44/documentation.html#upgrade' },
      ],
    },
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
    `## 技术定位

Apache RocketMQ 是分布式消息中间件，面向业务解耦、削峰填谷、顺序消息、事务消息和延迟消息。它位于应用与下游服务之间，强调低延迟、消息可靠性和金融级业务场景。

RocketMQ 适合订单、支付、库存等需要事务消息或严格顺序的业务消息。它不适合超大规模日志回放、任意时间的海量事件重放或纯流式分析；这些场景通常由 Kafka、Pulsar 或数据湖承担。

## 设计原理

RocketMQ 由 NameServer、Broker 和客户端组成。NameServer 是轻量路由注册中心，Broker 向它注册主题和队列信息；客户端从 NameServer 获取路由后直接与 Broker 通信。NameServer 之间不复制状态，靠多个节点提供路由可用性。

消息按主题和队列存储，队列是顺序与并行的基本单位。Broker 把消息追加到 CommitLog，再异步构建 ConsumeQueue 索引；消费者按队列拉取。这个设计让写入顺序化，但索引构建、页缓存和磁盘刷写会影响可靠性。

4.x 以 Broker 内置的 Remoting 协议和客户端为主；5.x 引入 Proxy、gRPC 客户端、POP 消费和更清晰的计算存储分离能力。5.x 不是简单改版本号，部署形态和客户端接入方式都可能变化。

## 工作机制

生产者发送消息到指定主题，Broker 写入 CommitLog 并根据刷盘策略返回确认。同步刷盘在返回前落盘，异步刷盘先写页缓存；主从复制可以同步或异步，具体可靠性取决于刷盘与复制组合。

普通消费使用推拉结合的长轮询，消费者按队列维护偏移量。顺序消息要求同一业务键进入同一队列，并由消费者单线程处理；广播消费每个消费者都收到全量消息。事务消息先发送半消息，执行本地事务后提交或回滚，Broker 通过回查处理未知状态。

延迟消息在 4.x 通过固定延迟级别实现，5.x 支持定时消息。延迟精度、最大延迟和存储成本需要按版本核对，不能把“支持延迟”理解为任意时刻精确触发。

## 关键配置与实践

- brokerRole 与 flushDiskType 决定主从和刷盘组合；同步刷盘加同步复制可靠性更高，但延迟和吞吐代价更大。
- 主题队列数影响并行度和顺序性；队列过多会增加 Broker 元数据和消费协调成本。
- 消费重试与死信队列需要业务幂等配合；重试次数耗尽后消息进入死信主题。
- 事务消息必须实现本地事务检查和回查接口，否则半消息可能长期悬挂。
- 5.x 使用 Proxy 时，要区分 gRPC 客户端与旧 Remoting 客户端的接入地址和权限模型。
- 消息保留时间、CommitLog 文件大小和磁盘水位直接影响写入可用性。

## 版本差异与兼容性

本文以 Apache RocketMQ 5.5.1 为核实基线，覆盖 4.x 与 5.x；4.x 仍存在于大量存量系统，5.x 是当前主线。

| 版本线 | 状态 | 对本文的影响 |
| --- | --- | --- |
| 5.x | 当前主线，核实基线 5.5.1 | Proxy、gRPC、POP 消费和定时消息按 5.x 文档 |
| 4.x | 存量广泛 | NameServer + Broker + Remoting 模型，功能边界与 5.x 不同 |
| 3.x | 历史版本 | 不建议新部署，升级需评估协议和存储兼容 |

4.x 到 5.x 的升级不是只替换 Broker：客户端协议、Proxy 部署、消费模式和运维接口都可能变化。不能把 5.x 的 POP 消费语义直接写成 4.x 行为。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| 发送超时 | Broker 磁盘满、同步刷盘慢、主从同步阻塞 | Broker 日志、磁盘水位、刷盘与复制配置 |
| 消费积压 | 队列倾斜、消费线程不足、单条处理慢 | 消费进度、队列分布、消费 RT |
| 顺序被破坏 | 跨队列发送、消费并发、重试换队列 | 分区键、队列选择、消费并发度 |
| 事务消息悬挂 | 本地事务未回查、回查接口异常 | 半消息状态、回查日志、事务检查器 |
| 消息重复 | 网络重试、消费未确认、主从切换 | 消息 ID、幂等键、消费位点 |

RocketMQ 的“事务消息”解决的是本地事务与消息发送的一致性，不覆盖下游消费者的事务。消费者仍需幂等，并自行处理失败重试与死信。

## 技术关联

RocketMQ 常与订单、支付和库存服务配合，向下游通知、积分、风控等系统投递事件；CDC 和日志场景更多使用 Kafka；需要多租户和分层存储时可能选择 Pulsar。它与 Kafka 在事件流场景存在替代关系，但事务消息、延迟消息和队列模型不同。

## 参考资料

- [Apache RocketMQ Documentation](https://rocketmq.apache.org/docs/)
- [Apache RocketMQ Repository](https://github.com/apache/rocketmq)
- [Apache RocketMQ Releases](https://github.com/apache/rocketmq/releases)`,
    {
      versions: 'Apache RocketMQ 4.x / 5.x（核实基线 5.5.1）',
      docsUrl: 'https://rocketmq.apache.org/docs/',
      version: 2,
      replacesContentHash: '5bfb02cfadbcd1c06049d126b09d5b15566c72ed502c700cda954176c5042c75',
      referenceLinks: [
        { label: 'Apache RocketMQ Documentation', url: 'https://rocketmq.apache.org/docs/' },
        { label: 'RocketMQ 5.x Architecture', url: 'https://github.com/apache/rocketmq' },
        { label: 'Apache RocketMQ Releases', url: 'https://github.com/apache/rocketmq/releases' },
      ],
    },
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
    `## 技术定位

RabbitMQ 是基于 AMQP 的消息代理，位于生产者与消费者之间，承担任务分发、路由、解耦、重试和死信处理。它以灵活路由和低延迟见长，适合业务任务队列，而不是大规模事件日志回放。

RabbitMQ 适合需要复杂交换机路由、每消息确认、优先级、TTL 和死信队列的业务。它不适合超高分区的流式回放、长期事件存储或跨地域大数据管道。

## 设计原理

RabbitMQ 的核心模型是生产者把消息发给交换机，交换机按绑定和路由键把消息路由到一个或多个队列，消费者从队列消费。交换机类型包括 direct、fanout、topic、headers；路由发生在交换机，而不是队列。

消息可靠性分为三个独立阶段：生产者到交换机的发布确认，交换机到队列的路由与持久化，消费者到队列的消费确认。只开启其中一个阶段，不能得到端到端可靠投递。

队列类型决定复制与一致性。经典队列可以是持久化或非持久化；仲裁队列基于 Raft，在多个节点间复制，适合需要高可用的队列。4.0 起不再支持经典镜像队列，迁移应使用仲裁队列或流。

## 工作机制

发布者开启 confirm 后，Broker 返回 basic.ack 或 basic.nack。消息到达队列后，持久化消息写入磁盘，非持久化消息主要留在内存。消费者使用手动 ack 时，消息在确认前处于 unacked 状态；连接断开后重新入队。

prefetch 限制每个消费者未确认消息数量。过大导致单消费者堆积，过小导致吞吐不足。死信交换机在消息被拒绝、过期或超过长度限制时接收消息，但死信不是自动重试机制，需要消费者和 TTL 配合。

RabbitMQ Stream 提供追加日志和偏移量消费，适合需要回放和吞吐的场景，但它的语义与 AMQP 队列不同，不能混为一谈。

## 关键配置与实践

- 队列持久化、消息持久化和发布确认必须同时满足，才能在 Broker 重启后保留消息。
- 手动 ack 配合幂等消费；autoAck 在投递后立即删除，消费者崩溃会丢消息。
- prefetch 按消费耗时和并发调整，不能只追求吞吐。
- 仲裁队列的复制因子通常为 3 或 5，集群节点数和磁盘延迟影响写入。
- TTL、max-length 和死信交换机共同决定消息生命周期；死信队列本身也需要容量和告警。
- 集群不是分区容错系统：网络分区时可用性策略需要明确，不能默认“集群就高可用”。

## 版本差异与兼容性

本文以 RabbitMQ 4.4.0 为核实基线，覆盖 4.x；3.x 已进入历史阶段，升级前需要单独评估。

| 版本线 | 状态 | 对本文的影响 |
| --- | --- | --- |
| 4.x | 当前主线，核实基线 4.4.0 | 仲裁队列、流和 AMQP 行为以 4.x 文档为准 |
| 3.x | 历史版本 | 经典镜像队列可用，但与 4.x 的 HA 模型不同 |
| AMQP 1.0 | 通过插件支持 | 与 AMQP 0-9-1 的模型和客户端不同，需分别核对 |

4.0 移除经典镜像队列是关键分界。把 3.x 的镜像队列配置直接搬到 4.x 会失败，必须迁移到仲裁队列或流。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| 队列积压 | 消费慢、prefetch 不当、消费者离线 | 队列深度、unacked、消费速率 |
| 消息丢失 | autoAck、未持久化、未开发布确认 | confirm、持久化标志、消费确认 |
| 内存告警 | 积压、消息过大、流控触发 | 内存水位、队列长度、publisher confirm |
| 集群不可用 | 网络分区、仲裁队列失去多数派 | 分区策略、节点状态、Raft 日志 |
| 重复消费 | 连接断开、ack 超时、重试 | 幂等键、unacked 回收、消费者日志 |

RabbitMQ 的流控会阻塞发布者，而不是无限缓存。看到发布变慢时，应先查内存和磁盘水位，而不是只扩容消费者。

## 技术关联

RabbitMQ 常承担业务任务分发、通知重试和死信处理；Kafka 更适合事件日志和大规模回放；Pulsar 在多租户和分层存储场景提供另一种选择。它与 Kafka 在消息场景存在替代关系，但路由模型、确认语义和吞吐定位不同。

## 参考资料

- [RabbitMQ Documentation](https://www.rabbitmq.com/docs)
- [RabbitMQ Queue Types](https://www.rabbitmq.com/docs/queues)
- [RabbitMQ Reliability Guide](https://www.rabbitmq.com/docs/reliability)`,
    {
      versions: 'RabbitMQ 4.x（核实基线 4.4.0；4.0 起不再支持经典镜像队列）',
      docsUrl: 'https://www.rabbitmq.com/docs',
      version: 2,
      replacesContentHash: '2d8f875e49dc80fed5ec9a6c491947eae87533d9b147b65ff4975e2db6d8d67d',
      referenceLinks: [
        { label: 'RabbitMQ Documentation', url: 'https://www.rabbitmq.com/docs' },
        { label: 'RabbitMQ Queue Types', url: 'https://www.rabbitmq.com/docs/queues' },
        { label: 'RabbitMQ Reliability Guide', url: 'https://www.rabbitmq.com/docs/reliability' },
      ],
    },
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
    `## 技术定位

Apache Pulsar 是云原生分布式消息与流平台，采用计算与存储分离架构，位于生产者和消费者之间，承担多租户消息、事件流、队列消费和跨地域复制。

Pulsar 适合需要多租户隔离、分层存储、跨地域复制、队列与流统一接入的场景。它不适合极简部署、超低运维成本的小型任务队列；这类场景 RabbitMQ 或单机 Kafka 更直接。

## 设计原理

Pulsar 把服务层和存储层分开：Broker 无状态地处理连接、路由和消费，BookKeeper 负责持久化消息。主题被切分为多个 ledger，ledger 分布在 BookKeeper 的 bookie 上。Broker 故障不会丢数据，但元数据和 BookKeeper 可用性仍决定整体可用性。

分区主题把主题拆成多个分区，分区内有序。非分区主题只有一个分区。订阅是消费状态的核心：exclusive 只允许一个消费者，failover 在主备间切换，shared 在多个消费者间轮询，key_shared 按键保证同一键落到同一消费者。

分层存储把冷数据从 BookKeeper 移到对象存储，Broker 仍按统一接口读取。它降低 BookKeeper 容量压力，但冷读延迟、对象存储一致性和生命周期策略需要单独评估。

## 工作机制

生产者把消息发送到 Broker，Broker 写入 BookKeeper ledger 并向生产者确认。消费者通过订阅读取消息，游标记录消费位置。确认可以逐条或累积确认，未确认消息在重投递策略下再次投递。

跨地域复制在集群间异步复制消息，通常按命名空间配置。它提供最终一致，不是同步复制；地域故障时可能丢失尚未复制的最新消息。

事务支持把多条消息的生产和确认组合为原子操作，但和 Kafka 一样，外部系统副作用不在事务内。Pulsar 的 exactly-once 需要消费者与生产者在事务边界内配合，不能外推到数据库写入。

## 关键配置与实践

- BookKeeper 的 bookie 数量、ledger 复制因子和磁盘类型决定持久性与吞吐；复制因子不足会在节点故障时影响可用性。
- Broker 无状态，但需要足够的 bookie 和元数据存储；不要把 Broker 扩容当作存储扩容。
- 订阅类型必须与业务并发模型匹配；shared 订阅不保证顺序，key_shared 也不能跨键保序。
- retention 与 backlog 配额决定消息保留和积压上限；配额耗尽会阻塞生产或触发淘汰。
- 分层存储需要配置对象存储、凭据和生命周期；冷读性能不能按本地磁盘估算。
- 多租户通过 tenant、namespace 和权限策略隔离，配额应按租户设置。

## 版本差异与兼容性

本文以 Apache Pulsar 5.0.1 为核实基线，覆盖 4.x 与 5.x；4.x 仍有大量存量部署。

| 版本线 | 状态 | 对本文的影响 |
| --- | --- | --- |
| 5.x | 当前主线，核实基线 5.0.1 | 客户端、Broker 和分层存储行为以 5.x 文档为准 |
| 4.x | 受支持存量 | 多数核心模型一致，新特性和默认值需逐项核对 |
| 3.x | 历史版本 | 升级需评估 BookKeeper、客户端和元数据兼容性 |

Pulsar 与 Kafka 都支持分区和消费者组，但 Pulsar 的订阅类型、存储分离和跨地域复制模型不同，不能直接套用 Kafka 的 ISR 或 acks 语义。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| 生产失败 | BookKeeper 写入失败、ledger 复制不足、配额耗尽 | bookie 状态、ledger 元数据、命名空间配额 |
| 消费积压 | 消费者不足、shared 订阅分配不均、确认慢 | backlog、订阅统计、消费者数量 |
| 顺序错乱 | shared 订阅、跨分区、重投递 | 订阅类型、分区键、确认策略 |
| 跨地域延迟 | 异步复制、网络带宽、命名空间配置 | 复制指标、地域链路、积压 |
| 冷读变慢 | 分层存储回源、对象存储限流 | 分层存储指标、缓存命中、对象存储 |

Pulsar 的架构组件更多，故障域也更复杂：Broker、BookKeeper、元数据存储和对象存储任一层异常都可能表现为“消息不可用”。排查必须分层，而不是只看 Broker。

## 技术关联

Pulsar 可承接应用事件、CDC 和日志，向下游提供流处理或分析入湖；分层存储通常落到对象存储；跨地域复制支撑多活。它与 Kafka 在事件流场景存在替代关系，与 RabbitMQ 在任务队列场景互补。

## 参考资料

- [Apache Pulsar Documentation](https://pulsar.apache.org/docs/)
- [Pulsar Architecture](https://pulsar.apache.org/docs/concepts-architecture-overview/)
- [Apache Pulsar Releases](https://github.com/apache/pulsar/releases)`,
    {
      versions: 'Apache Pulsar 4.x / 5.x（核实基线 5.0.1）',
      docsUrl: 'https://pulsar.apache.org/docs/',
      version: 2,
      replacesContentHash: '7d426a0e6070794c12232d1fad37d1674c72dd3dddc16be3c3407f5f417dad65',
      referenceLinks: [
        { label: 'Apache Pulsar Documentation', url: 'https://pulsar.apache.org/docs/' },
        { label: 'Pulsar Architecture', url: 'https://pulsar.apache.org/docs/concepts-architecture-overview/' },
        { label: 'Apache Pulsar Releases', url: 'https://github.com/apache/pulsar/releases' },
      ],
    },
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
    `## 技术定位

Grafana 是可视化与告警平台，位于监控数据源与使用者之间，负责查询编排、面板展示、告警规则和团队协作。它本身通常不存储指标或日志，而是通过数据源代理访问 Prometheus、Loki、ClickHouse、Elasticsearch 等系统。

Grafana 适合统一展示多数据源、构建运维看板和配置告警。它不适合作为长期时序数据库、日志存储或复杂 ETL 引擎；这些能力由后端数据源承担。

## 设计原理

Grafana 的核心抽象是数据源、查询、面板和仪表盘。浏览器发出查询请求，Grafana 服务端通过数据源插件代理到后端，转换结果后返回前端渲染。代理模式避免把数据源凭据暴露给浏览器，也集中处理认证、超时和缓存。

仪表盘以 JSON 模型保存，面板、变量、查询和目标都有稳定结构。 provisioning 通过文件或 API 声明数据源、仪表盘和告警规则，使配置可版本化；手工创建的仪表盘仍可保存到数据库。

统一告警把告警规则、联系点、通知策略和静默分开。规则在服务端评估并写入告警状态，通知策略决定路由和分组。告警状态与仪表盘展示是两条路径，不能把面板上的阈值线当成告警配置。

## 工作机制

用户打开仪表盘时，前端按时间范围和变量发起查询。Grafana 服务端解析数据源、执行查询、合并多查询结果并返回。变量可以来自查询、自定义列表或文本，变量值会进入查询模板，必须防止注入和基数爆炸。

告警规则按评估组周期执行，查询结果进入规则状态机，状态变化触发通知。通知策略按标签匹配联系点，分组等待和重复间隔控制发送频率。Grafana 重启后告警状态依赖数据库和规则重新评估，不能假设内存状态持久。

高可用部署需要共享数据库和一致的数据源配置。多个 Grafana 实例可以同时服务查询，但告警评估的去重与故障转移依赖数据库锁和配置，不能简单多开实例就得到严格单次评估。

## 关键配置与实践

- 数据源应使用服务端代理和最小权限账号；不要把高权限凭据写入前端。
- 查询超时、最大并发和数据源缓存要匹配后端能力，避免看板刷新拖垮 Prometheus。
- 仪表盘变量应限制取值来源和数量，避免高基数标签生成海量查询。
- 告警规则要设置合理的 for 持续时间，避免瞬时抖动触发；no data 和 error 状态需要显式处理。
- provisioning 文件应纳入版本控制，避免手工修改被下一次部署覆盖。
- 组织、团队和 RBAC 按最小权限配置；匿名访问只适用于明确的公开看板。

## 版本差异与兼容性

本文以 Grafana 13.3.0 为核实基线，覆盖 12.x 与 13.x。Grafana 的插件、数据源和告警能力随版本变化，具体以对应版本文档为准。

| 版本线 | 状态 | 对本文的影响 |
| --- | --- | --- |
| 13.x | 当前主线，核实基线 13.3.0 | 数据源、告警和 provisioning 以 13.x 文档为准 |
| 12.x | 受支持存量 | 核心模型一致，新面板和告警特性需逐项核对 |
| 11.x 及更早 | 历史版本 | 升级前核对插件兼容性和数据库迁移 |

Grafana 与后端数据源的版本独立。Grafana 支持某个数据源，不代表该数据源的查询语法和指标名称在所有版本一致。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| 面板加载慢 | 查询范围过大、变量高基数、数据源超时 | 查询检查器、数据源日志、时间范围 |
| 告警不触发 | 规则未评估、no data 处理错误、通知策略不匹配 | 规则状态、评估日志、联系点测试 |
| 告警重复发送 | 分组和重复间隔配置不当、多实例评估 | 通知策略、告警状态、实例日志 |
| 数据源 401/403 | 凭据过期、权限不足、代理配置错误 | 数据源配置、服务账号、网络策略 |
| 仪表盘被覆盖 | 手工修改与 provisioning 冲突 | provisioning 版本、数据库记录 |

Grafana 的告警不是“面板阈值自动同步”。面板改阈值不会自动改告警规则，二者需要分别维护。

## 技术关联

Grafana 查询 Prometheus 指标、Loki 日志、ClickHouse 分析数据和 Elasticsearch 文档；告警通过联系点发送到邮件、Webhook 或 IM。它与 Loki、Prometheus 构成可观测性展示层，但不替代采集与存储。

## 参考资料

- [Grafana Documentation](https://grafana.com/docs/grafana/latest/)
- [Grafana Provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/)
- [Grafana Alerting](https://grafana.com/docs/grafana/latest/alerting/)`,
    {
      versions: 'Grafana 12.x / 13.x（核实基线 13.3.0）',
      docsUrl: 'https://grafana.com/docs/grafana/latest/',
      version: 2,
      replacesContentHash: 'f757bc4368df7660bb3851899371a8e066df3475685ea6da4767ea7cdae35934',
      referenceLinks: [
        { label: 'Grafana Documentation', url: 'https://grafana.com/docs/grafana/latest/' },
        { label: 'Grafana Provisioning', url: 'https://grafana.com/docs/grafana/latest/administration/provisioning/' },
        { label: 'Grafana Alerting', url: 'https://grafana.com/docs/grafana/latest/alerting/' },
      ],
    },
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
    `## 技术定位

Grafana Loki 是日志聚合系统，位于日志采集端与查询展示端之间，负责接收、索引和存储日志，并通过 LogQL 查询。它的设计目标是以较低成本保存大量日志，而不是做全文索引数据库。

Loki 适合按标签定位日志流、按时间范围检索、与指标关联排查。它不适合把日志当结构化数据库做复杂聚合、跨字段任意查询或强事务分析；这类需求应进入 ClickHouse 或搜索引擎。

## 设计原理

Loki 只索引标签，不索引日志正文。每条日志属于一个流，流由标签集合唯一标识；同一流的日志按时间追加。查询先按标签和时间找到流，再扫描流中的日志块并过滤。这个取舍显著降低索引成本，但要求标签设计合理。

标签是索引维度，不是日志字段。把请求 ID、用户 ID 等高基数值放进标签，会制造海量流，导致索引和内存爆炸。高基数信息应放在日志正文或结构化元数据中，通过过滤而不是索引查询。

日志以压缩块存储在对象存储，Ingester 在内存中聚合近期日志，Querier 合并内存与对象存储结果。Compactor 负责合并索引和保留策略。这个架构让存储成本低，但查询延迟取决于扫描量。

## 工作机制

采集端通常使用 Promtail、Alloy 或 OpenTelemetry Collector，把日志推送或抓取到 Distributor。Distributor 校验标签和租户限制，按哈希把日志分发到多个 Ingester。Ingester 追加日志并定期刷写块，Querier 在查询时从 Ingester 和对象存储读取。

LogQL 支持流选择器、行过滤、解析器和聚合。先缩小流范围，再做过滤和解析，性能最好；对全量日志做正则匹配会扫描大量数据。

多租户通过租户 ID 隔离，limits 控制流数量、日志速率、查询长度和结果大小。超过限制会返回 429 或截断结果，这类错误不能只靠扩容解决。

## 关键配置与实践

- 标签应低基数、稳定、可枚举，例如集群、命名空间、应用、级别；不要把请求 ID 放进标签。
- chunk 编码、块大小和刷新周期影响内存与查询效率，应按日志量调整。
- 对象存储生命周期与 retention 要一致，避免索引删除但块仍占用成本。
- distributor 的速率限制和 ingester 的流限制要匹配采集端突发。
- querier 的查询并行度、超时和结果上限影响对象存储压力。
- 结构化元数据可用于高基数过滤，但不能替代合理的标签模型。

## 版本差异与兼容性

本文以 Grafana Loki 3.7.9 为核实基线，覆盖 3.x。Loki 与 Grafana 的版本独立，Grafana 版本不能用来推断 Loki 行为。

| 版本线 | 状态 | 对本文的影响 |
| --- | --- | --- |
| 3.x | 当前主线，核实基线 3.7.9 | 标签索引、存储和 LogQL 以 3.x 文档为准 |
| 2.x | 历史版本 | 索引和配置模型不同，升级需按官方迁移指南 |
| Promtail | 已进入维护尾声 | 新部署优先使用 Alloy 或 OpenTelemetry Collector |

Loki 的“无全文索引”是核心设计，不是配置缺失。使用全文检索数据库的经验直接套到 Loki，容易误判查询成本和标签设计。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| 429 限流 | 租户速率、流数量、突发过大 | limits 配置、采集端批次、租户使用量 |
| 查询很慢 | 标签选择器过宽、扫描时间过长、解析过重 | 查询统计、流数量、时间范围 |
| 索引膨胀 | 高基数标签、动态标签 | 标签模型、流数量、active streams |
| 日志丢失 | ingester 重启、复制不足、采集端丢弃 | 复制因子、ingester 日志、采集端指标 |
| 存储成本高 | 保留策略过长、块未压缩、对象存储生命周期错误 | retention、compactor、桶生命周期 |

Loki 的查询性能高度依赖标签选择器。查询“所有日志里包含某字符串”会扫描大量块，不能按全文索引数据库的预期估算。

## 技术关联

Loki 接收 Promtail、Alloy 或 OpenTelemetry Collector 的日志，向 Grafana 提供 LogQL 数据源；标签常与 Prometheus 指标关联，用于从告警跳到日志。它与 ClickHouse 在日志分析场景存在替代关系，但索引模型和查询成本不同。

## 参考资料

- [Grafana Loki Documentation](https://grafana.com/docs/loki/latest/)
- [Loki Label Best Practices](https://grafana.com/docs/loki/latest/get-started/labels/)
- [Loki Storage](https://grafana.com/docs/loki/latest/operations/storage/)`,
    {
      versions: 'Grafana Loki 3.x（核实基线 3.7.9）',
      docsUrl: 'https://grafana.com/docs/loki/latest/',
      version: 2,
      replacesContentHash: 'aa2d30705e247b5eb7583758464390836aeeb3bb30c995f21f442e5281f23dbf',
      referenceLinks: [
        { label: 'Grafana Loki Documentation', url: 'https://grafana.com/docs/loki/latest/' },
        { label: 'Loki Label Best Practices', url: 'https://grafana.com/docs/loki/latest/get-started/labels/' },
        { label: 'Loki Storage', url: 'https://grafana.com/docs/loki/latest/operations/storage/' },
      ],
    },
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
    `## 技术定位

OpenTelemetry Collector 是厂商中立的遥测数据管道，位于应用、基础设施与后端观测平台之间，负责接收、处理、转换和导出 traces、metrics、logs 和 profiles。

Collector 适合统一采集协议、批量处理、敏感数据脱敏、采样和多后端分发。它不适合替代后端存储和查询系统，也不应被当作无限制的日志缓冲队列。

## 设计原理

Collector 的配置由 receiver、processor、exporter、connector 和 extension 组成。数据沿 pipeline 流动：receiver 接收，processor 按顺序处理，exporter 发送；connector 可以把一种 pipeline 的输出接到另一种 pipeline。

同一份数据可以进入多条 pipeline，分别做不同处理或发往不同后端。pipeline 的数据类型必须匹配，processor 的顺序会改变结果。例如先采样再脱敏与先脱敏再采样，语义不同。

部署形态通常分为 agent 和 gateway：agent 靠近数据源，负责采集和初步处理；gateway 集中做批处理、采样、路由和凭据管理。两者不是互斥，常见组合是 agent 采集、gateway 汇聚。

## 工作机制

receiver 建立监听或主动抓取，把数据转换为内部模型；processor 执行 memory_limiter、batch、attributes、filter、tail_sampling 等处理；exporter 通过 OTLP、Prometheus、Loki 或厂商协议发送。

memory_limiter 应放在 pipeline 前部，按软硬限制拒绝或丢弃数据，防止 OOM。batch 把请求合并以提高吞吐，但会增加延迟。发送失败时，持久化队列可以把数据暂存到磁盘，但容量、恢复和磁盘故障仍需评估。

Collector 的组件有独立稳定性等级。配置一个组件前，应查对应版本文档的 stability 标记，不能因为“Collector 支持”就认为该组件已稳定。

## 关键配置与实践

- receivers 只开放必要协议和端口，启用 TLS 与认证，避免成为开放代理。
- processors 顺序要明确：memory_limiter 靠前，batch 靠近 exporter，脱敏在导出前。
- exporters 配置重试、超时和队列；多后端时注意一份失败不应阻塞另一份。
- service.pipelines 按信号类型拆分，避免把 traces 和 logs 混在同一 pipeline。
- 资源属性使用语义约定，保证服务名、实例和环境可关联。
- 配置变更应版本化和滚动发布，Collector 重启会中断本地缓冲。

## 版本差异与兼容性

本文以 OpenTelemetry Collector 0.164.0 为核实基线，覆盖 0.1xx 系列。Collector 尚未发布 1.0，组件稳定性等级和配置可能变化。

| 版本线 | 状态 | 对本文的影响 |
| --- | --- | --- |
| 0.164.x | 当前主线，核实基线 0.164.0 | 组件、pipeline 和稳定性等级以该版本为准 |
| 更早 0.x | 历史版本 | 组件重命名、配置迁移和默认值需逐项核对 |
| 1.0 | 尚未发布 | 不能把未来稳定性承诺写成当前能力 |

Collector 与 OpenTelemetry SDK、语义约定、后端存储的版本相互独立。升级 Collector 前要核对 receiver/exporter 与后端协议的兼容性。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| 数据丢失 | 队列满、memory_limiter 丢弃、exporter 失败 | Collector 指标、队列长度、后端错误 |
| 内存持续上涨 | 批次过大、队列无界、高基数属性 | memory_limiter、batch、队列配置 |
| 重复数据 | 重试、多 pipeline 重复导出 | 重试策略、pipeline 拓扑、后端去重 |
| 后端 401/403 | 凭据错误、租户配置、网络策略 | exporter 配置、密钥挂载、连通性 |
| 采样不符合预期 | tail_sampling 策略顺序、等待时间不足 | 采样策略、决策等待、trace 完整性 |

Collector 的“至少一次”依赖队列和重试，不是端到端 exactly-once。后端必须能处理重复数据，或用 trace ID 做幂等。

## 技术关联

Collector 接收应用 SDK 的 OTLP 数据，向 Prometheus、Loki、Tempo、Jaeger 或商业后端导出；Grafana 查询这些后端。它也可从 Prometheus 抓取指标并转换。SkyWalking 使用自有 agent 与 OAP 协议，和 OTel 是并行生态，不能默认互通。

## 参考资料

- [OpenTelemetry Collector Documentation](https://opentelemetry.io/docs/collector/)
- [Collector Configuration](https://opentelemetry.io/docs/collector/configuration/)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)`,
    {
      versions: 'OpenTelemetry Collector 0.1xx（核实基线 0.164.0；尚未发布 1.0）',
      docsUrl: 'https://opentelemetry.io/docs/collector/',
      version: 2,
      replacesContentHash: 'cbb5b7e14910be516c640420b6fae8071fe891e870a3df081c21bdbb5f844e98',
      referenceLinks: [
        { label: 'OpenTelemetry Collector Documentation', url: 'https://opentelemetry.io/docs/collector/' },
        { label: 'Collector Configuration', url: 'https://opentelemetry.io/docs/collector/configuration/' },
        { label: 'OpenTelemetry Semantic Conventions', url: 'https://opentelemetry.io/docs/specs/semconv/' },
      ],
    },
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
    `## 技术定位

Apache SkyWalking 是应用性能监控与可观测性平台，位于应用、服务网格与存储之间，负责链路追踪、服务指标、拓扑、日志关联和告警。它提供自有 Agent、OAP 后端和 UI 的完整链路。

SkyWalking 适合 Java、Go、Node.js 等应用的自动埋点、服务拓扑和调用链排查，也支持服务网格和 eBPF 采集。它不适合替代通用日志聚合或大规模业务分析；这些数据通常进入 Loki、ClickHouse 等系统。

## 设计原理

SkyWalking 分为 Agent、OAP 和存储三层。Agent 在应用进程内或旁路采集遥测，通过 gRPC 或 HTTP 上报 OAP；OAP 做聚合、分析、告警和查询；存储保存 traces、metrics、logs 和元数据。

服务、实例和端点构成三级模型：服务是逻辑应用，实例是进程或 Pod，端点是接口或操作。拓扑由跨服务调用关系构建，调用链由 trace segment 和 span 组成。理解这个模型，才能正确配置告警和查询。

SkyWalking 的指标既可从 Agent 上报，也可从服务网格、eBPF 或 OpenTelemetry 接入。不同来源的指标口径和标签可能不同，不能直接混合比较。

## 工作机制

Java Agent 通过字节码增强拦截常见框架，生成 span 并传播上下文。跨进程调用通过 HTTP 头或消息属性传递 trace ID；消息队列、异步线程和线程池需要显式传播，否则链路会断。

OAP 接收数据后按分钟或小时聚合指标，写入存储；查询时从存储读取并组装拓扑和链路。OAP 可以集群部署，但需要共享存储和一致的配置。采样会降低开销，也会让部分链路缺失。

存储可选 Elasticsearch、BanyanDB 等。存储的索引、分片、保留和容量直接决定查询性能；OAP 写入压力和存储写入能力必须匹配。

## 关键配置与实践

- Agent 采样率按流量和排查需求设置；全量采样成本高，过低会漏掉关键链路。
- 跨线程、异步和消息队列需要上下文传播插件或手工埋点。
- OAP 集群要统一存储、命名空间和告警规则，避免实例间状态不一致。
- 存储保留策略要覆盖排查窗口；过短会丢历史，过长会推高成本。
- 告警规则基于服务、实例、端点指标，阈值和静默要结合业务基线。
- 服务网格和 eBPF 接入要明确指标来源，避免与 Agent 指标重复计数。

## 版本差异与兼容性

本文以 Apache SkyWalking 11.0.0 为核实基线，覆盖 10.x 与 11.x。Agent、OAP 和存储的版本需要一起核对。

| 版本线 | 状态 | 对本文的影响 |
| --- | --- | --- |
| 11.x | 当前主线，核实基线 11.0.0 | Agent 协议、OAP 和 UI 以 11.x 文档为准 |
| 10.x | 受支持存量 | 多数模型一致，插件和存储 schema 需逐项核对 |
| 8.x 及更早 | 历史版本 | 升级跨度大，需按官方升级路径迁移 |

SkyWalking 与 OpenTelemetry 都做链路追踪，但数据模型、Agent 和协议不同。OTLP 接入是桥接能力，不代表两套生态的语义完全一致。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| 链路断开 | 异步线程未传播、消息属性缺失、采样 | Agent 插件、上下文传播、trace 查询 |
| OAP 写入堆积 | 存储慢、批量过大、OAP 资源不足 | OAP 指标、存储写入延迟、队列 |
| 拓扑缺失 | 服务名不一致、跨集群未关联 | 服务注册、命名空间、调用关系 |
| 查询超时 | 存储索引差、时间范围过大、分片过多 | 存储查询、索引模板、时间范围 |
| Agent 开销高 | 全量采样、插件过多、同步上报 | 采样率、插件列表、JVM 指标 |

SkyWalking 的拓扑和指标依赖服务命名。服务名随部署变化会让历史数据断裂，命名规范应在接入前确定。

## 技术关联

SkyWalking Agent 采集应用链路，OAP 聚合后由 UI 展示；服务网格和 eBPF 可以作为补充数据源；Grafana 可通过数据源查询部分指标。它与 OpenTelemetry Collector 在采集层存在替代和桥接关系，但存储与查询模型不同。

## 参考资料

- [Apache SkyWalking Documentation](https://skywalking.apache.org/docs/)
- [SkyWalking Java Agent](https://skywalking.apache.org/docs/skywalking-java/latest/readme/)
- [SkyWalking Concepts and Design](https://skywalking.apache.org/docs/main/latest/en/concepts-and-designs/overview/)`,
    {
      versions: 'Apache SkyWalking 10.x / 11.x（核实基线 11.0.0）',
      docsUrl: 'https://skywalking.apache.org/docs/',
      version: 2,
      replacesContentHash: 'ecba23638ccdda0d2606ab22aefdbb7dd8fdd9bd2e3a48dcd4789b851c959236',
      referenceLinks: [
        { label: 'Apache SkyWalking Documentation', url: 'https://skywalking.apache.org/docs/' },
        { label: 'SkyWalking Java Agent', url: 'https://skywalking.apache.org/docs/skywalking-java/latest/readme/' },
        { label: 'SkyWalking OAP', url: 'https://skywalking.apache.org/docs/main/latest/en/concepts-and-designs/overview/' },
      ],
    },
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
    `## 技术定位

Argo CD 是 Kubernetes 的 GitOps 持续交付控制器，位于 Git 仓库与集群之间，负责把声明的期望状态同步到集群，并持续检测漂移。它以应用为中心，不负责构建镜像或运行测试。

Argo CD 适合 Kubernetes 应用的声明式部署、多环境管理和审计。它不适合替代 CI 构建、非 Kubernetes 资源编排或需要命令式步骤的复杂发布；这些通常由 CI、Job 或其他控制器承担。

## 设计原理

Argo CD 的核心模型是 Application：来源仓库、目标集群、目标命名空间和同步策略。Application 控制器周期性拉取 Git 中的清单，渲染 Helm/Kustomize/Jsonnet，与集群实际状态比较，计算差异并按策略同步。

Git 是期望状态的唯一来源，集群是实际状态。同步不是“把 Git 推给集群”的一次性动作，而是持续协调。自动同步会修复漂移，但也会覆盖手工修改；关闭自动同步则只报告差异。

AppProject 提供租户边界：限制可访问的仓库、集群、命名空间和资源类型。没有 AppProject 约束，一个 Application 可能部署到任意集群，GitOps 的权限边界就失效了。

## 工作机制

API Server 接收 UI、CLI 和 Git 事件；Repo Server 拉取仓库、渲染清单并生成缓存；Application Controller 执行比较和同步；Redis 缓存仓库与集群状态；Dex 或外部 IdP 提供认证。

同步可以分阶段执行：PreSync、Sync、PostSync 钩子，以及 Sync Waves 控制资源顺序。钩子失败会中断后续阶段。健康状态来自内置资源健康检查和自定义 Lua 脚本，不能只看同步状态判断业务可用。

多集群部署通过目标集群凭据实现。Argo CD 所在集群故障会影响所有纳管集群的协调，因此生产环境需要高可用和备份。

## 关键配置与实践

- 仓库凭据使用最小权限的 deploy key 或 token，避免把个人凭据写入集群。
- AppProject 限制 destination、sourceRepos 和资源白名单，按团队隔离。
- 自动同步配合 selfHeal 修复漂移；生产环境应评估自动同步对紧急手工操作的影响。
- 同步窗口和 prune 策略要明确，prune 可能删除不在 Git 中的资源。
- Helm values、Kustomize overlay 和环境差异应显式管理，避免用分支承载环境配置。
- 启用 HA 时，API Server、Repo Server、Application Controller 和 Redis 都需要冗余；备份 Application 和集群凭据。

## 版本差异与兼容性

本文以 Argo CD 3.5.6 为核实基线，覆盖 3.x。Argo CD 与 Kubernetes 的兼容矩阵随版本变化，升级前需查官方支持表。

| 版本线 | 状态 | 对本文的影响 |
| --- | --- | --- |
| 3.x | 当前主线，核实基线 3.5.6 | Application、同步和权限模型以 3.x 文档为准 |
| 2.x | 历史版本 | 部分同步策略和 UI 能力不同，升级需按官方指南 |
| Kubernetes | 独立版本线 | 不能由 Argo CD 版本推断支持的 Kubernetes 版本 |

Argo CD 与 Argo Workflows、Argo Rollouts 是不同项目，版本和支持周期独立，不能统称为“Argo 版本”。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| OutOfSync 持续存在 | 集群有控制器改写字段、渲染差异、忽略规则缺失 | diff、live manifest、ignoreDifferences |
| 同步失败 | 权限不足、CRD 未就绪、钩子失败 | sync 日志、RBAC、资源事件 |
| 自动同步反复覆盖 | 手工修改、其他控制器写入 | selfHeal、字段管理、控制器冲突 |
| 仓库拉取失败 | 凭据过期、网络策略、仓库限流 | Repo Server 日志、凭据、连通性 |
| 应用健康但不可用 | 健康检查未覆盖业务、探针缺失 | 健康状态、探针、端到端验证 |

“已同步”不等于“已健康”，更不等于“业务可用”。同步只表示清单与集群一致，健康检查需要覆盖工作负载和自定义资源。

## 技术关联

Argo CD 从 Git 读取 Helm/Kustomize 清单，向 Kubernetes 集群同步；镜像通常由 CI 构建并推送到 Harbor；Terraform 负责集群和基础设施，Argo CD 负责集群内应用。它与 Terraform 的边界是“基础设施”与“工作负载”，但边界需要团队明确。

## 参考资料

- [Argo CD Documentation](https://argo-cd.readthedocs.io/)
- [Argo CD GitOps](https://argo-cd.readthedocs.io/en/stable/operator-manual/declarative-setup/)
- [Argo CD Releases](https://github.com/argoproj/argo-cd/releases)`,
    {
      versions: 'Argo CD 3.x（核实基线 3.5.6）',
      docsUrl: 'https://argo-cd.readthedocs.io/',
      version: 2,
      replacesContentHash: '1131fcd71cb4c080ba96533df8518b6c3f248aef3d06ade41bbb0aa68a29caea',
      referenceLinks: [
        { label: 'Argo CD Documentation', url: 'https://argo-cd.readthedocs.io/' },
        { label: 'Argo CD GitOps', url: 'https://argo-cd.readthedocs.io/en/stable/operator-manual/declarative-setup/' },
        { label: 'Argo CD Releases', url: 'https://github.com/argoproj/argo-cd/releases' },
      ],
    },
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
    `## 技术定位

Harbor 是开源 OCI 镜像与制品仓库，位于 CI 构建与 Kubernetes 运行环境之间，负责镜像存储、访问控制、复制、扫描、签名和垃圾回收。

Harbor 适合企业私有镜像仓库、多项目隔离、镜像扫描和跨集群分发。它不适合作为通用文件存储、包管理器的替代或无需权限控制的公开缓存。

## 设计原理

Harbor 遵循 OCI Distribution 规范，镜像由 manifest、config 和 layer 组成，按仓库和标签组织。项目是权限和策略边界，用户、组和机器人账号在项目内获得角色。

Harbor 在标准 registry 之上增加数据库元数据、RBAC、复制、扫描、签名、保留和审计。镜像内容存对象存储或文件系统，元数据存数据库；两者不一致会导致镜像可见但无法拉取，或反之。

标签是可变引用，digest 是内容寻址。生产部署应使用 digest 或不可变标签，避免同一标签被覆盖后不同节点拉到不同内容。

## 工作机制

CI 推送镜像时，Harbor 校验认证和项目权限，写入 blob 与 manifest，更新数据库。拉取时客户端先取 manifest，再按 digest 拉取 layer。代理缓存可以从上游仓库按需拉取并缓存。

扫描通常由 Trivy 等扫描器执行，结果与制品关联。扫描是异步的，推送成功不代表扫描完成；策略可以阻止有高危漏洞的镜像被拉取，但需要明确阻断范围和例外。

复制在 Harbor 实例或上游仓库之间同步制品，支持推送和拉取模式。垃圾回收删除无引用的 blob，必须先确认没有 manifest 引用，否则可能误删仍在使用的 layer。

## 关键配置与实践

- 项目按团队和环境隔离，机器人账号只授予必要仓库的推送或拉取权限。
- 启用标签不可变策略，生产环境使用 digest 部署。
- 扫描策略要区分“仅报告”和“阻止拉取”，避免扫描未完成时误阻断发布。
- 复制规则要设置过滤器、触发方式和带宽，避免全量复制压垮链路。
- 保留策略按标签模式和天数清理，垃圾回收需在低峰执行并先做 dry run。
- 对象存储、数据库和 Redis 的备份要一致；只备份镜像文件不备份元数据无法恢复。

## 版本差异与兼容性

本文以 Harbor 2.15.4 为核实基线，覆盖 2.13–2.15。Harbor 的 API、扫描器和复制协议随版本变化，升级前需查兼容矩阵。

| 版本线 | 状态 | 对本文的影响 |
| --- | --- | --- |
| 2.15.x | 当前主线，核实基线 2.15.4 | OCI 制品、扫描和复制以 2.15 文档为准 |
| 2.13–2.14 | 受支持存量 | 升级需核对数据库迁移、扫描器和 API |
| 2.12 及更早 | 历史版本 | 核对数据库迁移、扫描器和 API |
| OCI 规范 | 独立规范 | Harbor 支持范围以版本文档为准，不默认支持所有 OCI 特性 |

Harbor 与 Kubernetes、容器运行时、扫描器的版本相互独立；Harbor 能存镜像，不代表集群能拉取或运行该镜像。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| 推送 401/403 | 凭据过期、项目权限、机器人账号范围 | 认证日志、项目成员、token 权限 |
| 拉取 blob 失败 | 对象存储不可用、GC 误删、网络 | registry 日志、对象存储、manifest 引用 |
| 扫描一直未完成 | 扫描器资源不足、队列积压、镜像过大 | 扫描器日志、任务队列、资源限制 |
| 复制失败 | 网络、凭据、过滤器、上游限流 | 复制任务日志、目标仓库、带宽 |
| 磁盘持续增长 | 保留策略未生效、GC 未执行、无引用 blob | 项目配额、保留策略、GC 历史 |

垃圾回收不是“删除标签”。删除标签只移除引用，blob 仍占用空间；GC 需要单独执行，并且可能影响正在进行的推送或拉取。

## 技术关联

CI 构建镜像并推送到 Harbor；Kubernetes 从 Harbor 拉取镜像；Argo CD 部署引用这些镜像的工作负载；扫描和签名结果支持供应链安全。Harbor 与公有云 registry 在镜像存储场景存在替代关系，但权限、复制和扫描能力不同。

## 参考资料

- [Harbor Documentation](https://goharbor.io/docs/)
- [Harbor User Guide](https://goharbor.io/docs/latest/working-with-projects/)
- [Harbor Releases](https://github.com/goharbor/harbor/releases)`,
    {
      versions: 'Harbor 2.13–2.15（核实基线 2.15.4）',
      docsUrl: 'https://goharbor.io/docs/',
      version: 2,
      replacesContentHash: 'f22d10d7fbc988959d0040152a69ecb1304773c826957a6696f7b00f0b50f931',
      referenceLinks: [
        { label: 'Harbor Documentation', url: 'https://goharbor.io/docs/' },
        { label: 'Harbor User Guide', url: 'https://goharbor.io/docs/latest/working-with-projects/' },
        { label: 'Harbor Releases', url: 'https://github.com/goharbor/harbor/releases' },
      ],
    },
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
    `## 技术定位

Terraform 是基础设施即代码工具，位于云 API、虚拟化平台和 Kubernetes 等基础设施与版本化配置之间，负责声明资源、生成执行计划并应用变更。它通过 provider 调用外部 API，不要求在目标主机安装 agent。

Terraform 适合云资源、网络、集群、DNS、IAM 等基础设施的声明式管理。它不适合配置主机内部软件、执行一次性脚本或替代 Kubernetes 工作负载控制器；这些通常由 Ansible、云初始化或 GitOps 承担。

## 设计原理

Terraform 的核心是期望状态、实际状态和状态文件。配置描述资源，provider 把资源映射到 API，状态文件记录上次应用后的资源标识和属性。plan 比较配置、状态和远端实际值，生成增删改计划；apply 执行计划并更新状态。

状态文件是 Terraform 的数据库，不是普通缓存。它包含资源 ID、依赖关系和敏感值；丢失状态会导致重复创建或无法管理，泄露状态会暴露凭据。远程后端配合锁可以避免多人同时 apply 造成状态竞争。

Terraform 的资源图根据引用关系推导依赖，并行执行无依赖资源。它不保证“配置一写就一致”：外部漂移、provider 默认值、API 异步完成和导入资源都会让 plan 出现意外差异。

## 工作机制

一次执行通常经过 init、validate、plan、apply。init 下载 provider 和模块，plan 刷新状态并计算差异，apply 调用 provider 的创建、更新或删除接口。资源创建后，Terraform 把 ID 和属性写回状态。

模块把一组资源封装为可复用单元，变量是输入，output 是输出。workspace 提供同一配置的多状态实例，但不等同于环境隔离；生产环境通常用独立目录、独立后端和独立凭据。

import 把已有资源纳入状态，但不会自动生成完整配置。导入后必须补齐配置并 plan 到无差异，否则下一次 apply 可能修改或删除资源。

## 关键配置与实践

- 使用远程后端和状态锁，启用加密和访问审计；不要把状态文件提交到 Git。
- provider 版本和 Terraform 版本要锁定，升级前在非生产环境验证 plan。
- 敏感变量通过密钥管理注入，标记 sensitive 只影响输出显示，不加密状态。
- 使用 prevent_destroy、create_before_destroy 和 depends_on 时，要理解它们对替换和停机的影响。
- 模块要有清晰输入输出和版本约束，避免跨环境直接引用未固定分支。
- CI 中执行 plan 并保存结果，apply 使用同一计划，减少“计划后漂移”。

## 版本差异与兼容性

本文以 Terraform 1.17.1 为核实基线，覆盖 1.x。Terraform 与 provider 的版本独立，provider 升级可能改变资源和默认值。

| 版本线 | 状态 | 对本文的影响 |
| --- | --- | --- |
| 1.17.x | 当前主线，核实基线 1.17.1 | 语言、状态和 CLI 行为以 1.17 文档为准 |
| 1.x 更早版本 | 受支持存量 | 新语法和状态迁移需逐项核对 |
| Provider | 独立版本线 | 资源行为和默认值由 provider 决定，不由 Terraform 版本决定 |

Terraform 与 OpenTofu 在语言和状态上有渊源，但不是同一产品，版本、provider 兼容和许可不同，不能互相推断。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| plan 出现意外替换 | 不可变属性变化、provider 默认值、状态漂移 | plan 详情、provider 文档、refresh |
| 状态锁冲突 | 上一次执行未释放、多人并发 | 锁信息、后端日志、执行记录 |
| 资源已存在 | 未导入、状态丢失、命名冲突 | import、state list、远端资源 |
| apply 部分失败 | API 限流、超时、依赖未就绪 | 错误日志、资源依赖、重试 |
| 敏感值泄露 | 状态未加密、输出未标记、日志打印 | 后端加密、sensitive、CI 日志 |

Terraform 的 plan 不是保证。API 异步、外部控制器和漂移会在 plan 与 apply 之间改变实际状态，关键变更仍需人工审查。

## 技术关联

Terraform 管理云资源、网络和 Kubernetes 集群；Ansible 负责主机配置和应用部署；Argo CD 负责集群内工作负载；Harbor 提供镜像。Terraform 与 Ansible 都做自动化，但前者面向 API 资源与状态，后者面向主机与命令执行。

## 参考资料

- [Terraform Documentation](https://developer.hashicorp.com/terraform/docs)
- [Terraform State](https://developer.hashicorp.com/terraform/language/state)
- [Terraform Releases](https://github.com/hashicorp/terraform/releases)`,
    {
      versions: 'Terraform 1.x（核实基线 1.17.1；provider 版本独立）',
      docsUrl: 'https://developer.hashicorp.com/terraform/docs',
      version: 2,
      replacesContentHash: '86bc18a0d6bf8027c4718715095481aab68f8b258066150b9bd9232752ee3cfe',
      referenceLinks: [
        { label: 'Terraform Documentation', url: 'https://developer.hashicorp.com/terraform/docs' },
        { label: 'Terraform State', url: 'https://developer.hashicorp.com/terraform/language/state' },
        { label: 'Terraform Releases', url: 'https://github.com/hashicorp/terraform/releases' },
      ],
    },
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
    `## 技术定位

Ansible 是无代理自动化工具，位于控制节点与受管主机之间，通过 SSH 或 WinRM 执行模块，完成配置管理、应用部署、编排和一次性任务。

Ansible 适合主机内部配置、批量命令、中间件部署和跨平台编排。它不适合管理云 API 资源的长期状态，也不适合高频、强实时的配置收敛；云资源通常交给 Terraform，Kubernetes 工作负载交给 GitOps。

## 设计原理

Ansible 不需要在受管主机安装 agent，控制节点通过连接插件登录并传输模块执行。inventory 定义主机和组，playbook 用 YAML 描述任务，role 把任务、变量、模板、文件和 handler 组织为可复用单元。

模块应具备幂等性：重复执行同一任务，结果一致且不产生额外变更。命令模块和 shell 模块本身不保证幂等，必须配合 creates、changed_when、failed_when 或自定义模块。

Ansible 按 play 的主机批次和任务顺序执行，默认线性策略。任务在每台主机上依次执行，失败主机可从 playbook 中移除；这不同于 Terraform 的资源图和并行计划。

## 工作机制

执行 playbook 时，Ansible 解析 inventory、变量和任务，连接目标主机，上传并执行模块，收集返回结果。facts 提供主机事实，变量优先级决定最终值；变量覆盖顺序错误是常见故障源。

handler 在任务通知后执行，通常用于重启服务。handler 在 play 结束时统一运行，且多次通知只执行一次；如果任务失败，handler 可能不执行，需要显式 meta 控制。

check mode 模拟执行，但并非所有模块都完整支持；命令和 shell 在 check mode 下可能不执行或误报。把 check mode 当作绝对安全预演会漏掉副作用。

## 关键配置与实践

- inventory 使用动态插件或版本化静态文件，主机组按环境和角色划分。
- 变量按 group_vars、host_vars、role defaults 分层，避免在命令行随意覆盖。
- 敏感数据使用 Vault 或外部密钥管理，不要明文放在 playbook。
- 任务使用模块而不是 shell，必须用 shell 时设置幂等判断和错误处理。
- handler 只用于服务重启等收尾动作，避免在 handler 中放关键业务逻辑。
- 大规模执行使用 forks、serial 和策略控制并发，避免同时重启全部节点。

## 版本差异与兼容性

本文以 ansible-core 2.21.5 为核实基线，覆盖 2.19–2.21。Ansible Community Package 与 ansible-core 版本不同，collection 也有独立版本。

| 版本线 | 状态 | 对本文的影响 |
| --- | --- | --- |
| ansible-core 2.21.x | 当前主线，核实基线 2.21.5 | 引擎、模块和 playbook 语义以 2.21 文档为准 |
| ansible-core 2.19–2.20 | 受支持存量 | 新参数和模块行为需逐项核对 |
| Collection | 独立版本线 | 模块能力由 collection 决定，不由 core 版本决定 |

不能把 ansible-core 版本等同于 Ansible Community Package 版本；安装包、collection 和 Python 依赖的兼容性需要分别核对。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| 任务每次都 changed | 命令模块无幂等判断、模板时间戳变化 | changed_when、模块选择、diff |
| 变量不生效 | 优先级错误、作用域、拼写 | ansible-inventory、debug、变量优先级 |
| 连接失败 | SSH 密钥、用户权限、网络策略 | -vvv、inventory、防火墙 |
| 部分主机失败 | 主机不可达、任务超时、并发过高 | 失败主机列表、serial、forks |
| handler 未执行 | 任务失败、通知名称不匹配 | handler 名称、play 结果、meta |

Ansible 的“无代理”减少安装成本，但依赖 SSH、Python 和临时文件。目标主机的 Python 版本、sudo 权限和文件系统仍会影响执行。

## 技术关联

Ansible 通过 SSH 配置主机、部署中间件和编排步骤；Terraform 创建云资源和集群；Argo CD 管理 Kubernetes 工作负载；Harbor 提供镜像。它与 Terraform 在自动化层面互补，但状态模型和执行方式不同。

## 参考资料

- [Ansible Documentation](https://docs.ansible.com/)
- [Ansible Playbooks](https://docs.ansible.com/ansible/latest/playbook_guide/)
- [Ansible Core Releases](https://github.com/ansible/ansible/releases)`,
    {
      versions: 'ansible-core 2.19–2.21（核实基线 2.21.5；collection 版本独立）',
      docsUrl: 'https://docs.ansible.com/',
      version: 2,
      replacesContentHash: '93287ee21d691a9bc30841d9b39b820855d06d37c9f9873b5ffd47a4242623bc',
      referenceLinks: [
        { label: 'Ansible Documentation', url: 'https://docs.ansible.com/' },
        { label: 'Ansible Playbooks', url: 'https://docs.ansible.com/ansible/latest/playbook_guide/' },
        { label: 'Ansible Core Releases', url: 'https://github.com/ansible/ansible/releases' },
      ],
    },
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
    `## 技术定位

Istio 是服务网格，位于应用与网络之间，提供服务发现、流量管理、mTLS、授权策略和遥测。它把网络治理从应用代码下沉到基础设施层，但也会引入代理和控制的复杂度。

Istio 适合多服务、多团队、需要统一流量治理和零信任的 Kubernetes 环境。它不适合单体应用、极低延迟且无法承受代理开销的场景，或缺乏 Kubernetes 运维能力的团队。

## 设计原理

Istio 分为控制面和数据面。控制面 istiod 负责服务发现、配置分发、证书签发和 xDS 推送；数据面可以是 sidecar 代理，也可以是 ambient 模式下的 ztunnel 和 waypoint。

sidecar 模式为每个 Pod 注入 Envoy，应用流量经过本地代理。它提供完整的 L7 能力，但增加资源开销、启动依赖和升级复杂度。ambient 模式把 L4 能力放入节点级 ztunnel，L7 能力按需由 waypoint 提供，降低每 Pod 开销，但能力边界和调试方式不同。

mTLS 由 istiod 签发证书，代理之间自动加密和认证。授权策略基于工作负载身份，而不是 IP。身份、命名空间和策略作用域必须一起理解，否则会出现“策略写了但不生效”。

## 工作机制

注入标签或命名空间决定是否启用 sidecar。Pod 启动时，init 容器配置流量重定向，sidecar 启动后从 istiod 获取配置。应用发出流量被拦截到 Envoy，按 VirtualService、DestinationRule 和 Gateway 规则路由。

VirtualService 定义路由匹配、重试、超时和故障注入；DestinationRule 定义子集、负载均衡、连接池和 TLS。Gateway 负责入口流量。配置需要同时满足主机、端口、协议和命名空间作用域，单独一条规则通常不足以生效。

遥测由代理生成指标、访问日志和链路，发送到 Prometheus、Loki 或 OTel。遥测会增加 CPU 和网络开销，采样和指标基数需要控制。

## 关键配置与实践

- 注入策略按命名空间和 Pod 标签控制，避免全集群默认注入导致意外副作用。
- mTLS 模式从 permissive 迁移到 strict 前，要确认所有工作负载都已注入并兼容。
- VirtualService 的超时、重试和熔断要与应用自身策略协调，避免重试风暴。
- AuthorizationPolicy 使用最小权限，先 audit 再 enforce；拒绝规则优先于允许规则。
- sidecar 资源 requests/limits 要按流量设置，代理 OOM 会直接中断业务流量。
- ambient 模式要确认版本状态、L7 需求和 waypoint 部署方式，不能默认与 sidecar 能力完全等价。

## 版本差异与兼容性

本文以 Istio 1.31.3 为核实基线，覆盖 1.29–1.31。Istio 支持窗口通常覆盖最近几个次要版本，具体以官方支持政策为准。

| 版本线 | 状态 | 对本文的影响 |
| --- | --- | --- |
| 1.31.x | 当前主线，核实基线 1.31.3 | 控制面、sidecar 和 ambient 行为以 1.31 文档为准 |
| 1.29–1.30 | 受支持存量 | 新特性和默认值需逐项核对 |
| 更早版本 | 超出支持窗口 | 升级前核对 CRD、Envoy 和 Kubernetes 兼容性 |

Istio 管理的 Envoy 版本由 Istio 发布决定，不能把上游 Envoy 的最新版本直接套到某个 Istio 版本。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| 注入未生效 | 命名空间标签、Pod 标签、准入 webhook | istio-injection、Pod 注解、istiod 日志 |
| 503/UF | 路由无匹配、端点未就绪、mTLS 不一致 | istioctl analyze、proxy-config、端点 |
| mTLS 失败 | 证书过期、信任域、strict 模式不兼容 | 证书、PeerAuthentication、代理日志 |
| 延迟升高 | sidecar 资源不足、重试、遥测开销 | 代理指标、CPU/内存、采样 |
| 策略不生效 | 作用域、标签、拒绝优先 | AuthorizationPolicy、工作负载标签、audit |

“服务能通”不代表网格配置正确。应同时检查路由、mTLS、授权和端点健康，不能只看一个 200 响应。

## 技术关联

Istio 以 Envoy 作为 sidecar/waypoint 数据面，向 Prometheus、Grafana、Loki 和 OTel 提供遥测；cert-manager 可为其证书流程提供补充，但 Istio 自身也管理工作负载证书。它与 Envoy 是控制面与数据面的关系，与 Kubernetes Service 是互补而非替代。

## 参考资料

- [Istio Documentation](https://istio.io/latest/docs/)
- [Istio Traffic Management](https://istio.io/latest/docs/concepts/traffic-management/)
- [Istio Security](https://istio.io/latest/docs/concepts/security/)`,
    {
      versions: 'Istio 1.29–1.31（核实基线 1.31.3）',
      docsUrl: 'https://istio.io/latest/docs/',
      version: 2,
      replacesContentHash: '4b40913c121a9b7bfe392c0921305e391bfa2e3aa8725cb02999da03cb52c450',
      referenceLinks: [
        { label: 'Istio Documentation', url: 'https://istio.io/latest/docs/' },
        { label: 'Istio Traffic Management', url: 'https://istio.io/latest/docs/concepts/traffic-management/' },
        { label: 'Istio Security', url: 'https://istio.io/latest/docs/concepts/security/' },
      ],
    },
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
    `## 技术定位

Envoy 是高性能 L3/L4/L7 代理，位于客户端与服务之间，承担负载均衡、路由、TLS、限流、可观测性和协议转换。它既是独立代理，也是 Istio 等控制面的数据面。

Envoy 适合需要统一入口/出口代理、动态配置和服务网格数据面的场景。它不适合作为应用框架、业务网关的全部逻辑，或无需动态配置的简单反向代理。

## 设计原理

Envoy 的核心配置是 listener、filter chain、route、cluster 和 endpoint。listener 监听端口，filter chain 处理连接和请求，route 匹配请求并选择 cluster，cluster 定义上游和负载均衡策略，endpoint 是实际实例。

Envoy 通过 xDS 动态获取配置：LDS 监听器、RDS 路由、CDS 集群、EDS 端点、SDS 证书。控制面推送版本，代理确认并热更新，不需要重启。静态配置适合小规模或引导阶段，生产网格通常使用动态配置。

线程模型是多 worker 事件循环，每个 worker 处理连接，配置通过主线程分发。过滤器链顺序影响行为和性能；在错误位置插入过滤器，可能导致请求被错误修改或统计缺失。

## 工作机制

下游连接进入 listener，经过 TLS 握手和过滤器链，HTTP 连接管理器解析请求，路由匹配后选择 cluster，负载均衡器选择 endpoint，向上游发起连接并转发。响应沿原路径返回。

超时、重试、熔断和限流是独立机制：路由超时控制总时长，重试会放大流量，熔断保护上游，限流在本地或外部服务执行。它们需要与上游容量和应用语义配合，不能全部开启默认值。

可观测性包括访问日志、统计指标、分布式追踪和管理端点。管理端点暴露配置和健康信息，必须限制访问，不能直接暴露到公网。

## 关键配置与实践

- listener 和 filter chain 的匹配条件要明确，避免流量落入错误链。
- cluster 的连接池、最大连接、最大请求和健康检查要与上游能力匹配。
- 路由重试只对幂等请求启用，并设置重试预算，防止故障放大。
- TLS 证书和 SNI 配置要与上游/下游身份匹配，定期轮换。
- 管理端点绑定本地或受控网络，启用认证和最小权限。
- 动态配置要有版本回退和 xDS 拒绝监控，避免错误配置全网生效。

## 版本差异与兼容性

本文以 Envoy 1.40.2 为核实基线，覆盖 1.38–1.40。Envoy 的发布节奏快，弃用字段和默认值随版本变化。

| 版本线 | 状态 | 对本文的影响 |
| --- | --- | --- |
| 1.40.x | 当前主线，核实基线 1.40.2 | xDS、过滤器和运行时行为以 1.40 文档为准 |
| 1.38–1.39 | 受支持存量 | 新字段和弃用项需逐项核对 |
| 更早版本 | 历史版本 | 升级前核对 xDS API、过滤器和 TLS 默认值 |

Istio 等控制面会固定其兼容的 Envoy 版本。运行 Envoy 时，应使用控制面支持的版本，而不是盲目跟随上游最新版。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| 502/503 | 上游连接失败、健康检查、路由无匹配 | cluster 统计、endpoint 健康、路由配置 |
| 配置未生效 | xDS 版本未确认、资源名称不匹配 | config_dump、xDS 日志、版本 |
| 延迟升高 | 过滤器链过重、连接池不足、重试 | 统计、CPU、连接池、路由超时 |
| TLS 握手失败 | 证书、SNI、协议版本、信任链 | 证书、SNI 匹配、TLS 统计 |
| 管理端点暴露 | 监听地址过宽、缺少认证 | admin 配置、网络策略、访问日志 |

Envoy 的统计维度很多，高基数标签会放大内存和抓取成本。指标标签应在采集端控制，而不是全部导出。

## 技术关联

Envoy 是 Istio 的数据面，接收 istiod 的 xDS 配置；它可向 Prometheus 暴露指标、向 OTel 发送追踪、向 Loki 输出访问日志；Grafana 展示其指标。它与 Istio 是数据面与控制面关系，与 Nginx 等代理在入口场景存在替代关系。

## 参考资料

- [Envoy Documentation](https://www.envoyproxy.io/docs/envoy/latest/)
- [Envoy Architecture](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/arch_overview)
- [Envoy xDS Configuration](https://www.envoyproxy.io/docs/envoy/latest/api-docs/xds_protocol)`,
    {
      versions: 'Envoy 1.38–1.40（核实基线 1.40.2）',
      docsUrl: 'https://www.envoyproxy.io/docs/envoy/latest/',
      version: 2,
      replacesContentHash: '5881444e3b4cb5c7d2b1dcbc7c7f816c595ecd1f6123274e031e4c62981b5896',
      referenceLinks: [
        { label: 'Envoy Documentation', url: 'https://www.envoyproxy.io/docs/envoy/latest/' },
        { label: 'Envoy Architecture', url: 'https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/arch_overview' },
        { label: 'Envoy xDS Configuration', url: 'https://www.envoyproxy.io/docs/envoy/latest/api-docs/xds_protocol' },
      ],
    },
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
    `## 技术定位

cert-manager 是 Kubernetes 证书管理控制器，位于集群工作负载与证书颁发机构之间，负责申请、签发、续期和轮换 X.509 证书，并把证书写入 Secret。

cert-manager 适合为 Ingress、webhook、服务间通信和内部组件自动管理证书。它不适合替代完整 PKI 治理、硬件密钥管理或非 Kubernetes 环境的通用证书生命周期系统。

## 设计原理

cert-manager 用 CRD 表达证书生命周期：Issuer 或 ClusterIssuer 定义签发者，Certificate 定义所需证书，CertificateRequest 表示一次申请，Order 和 Challenge 用于 ACME 流程。控制器协调这些资源，最终生成 Secret。

Issuer 是命名空间级，ClusterIssuer 是集群级。ACME 支持 HTTP-01 和 DNS-01：HTTP-01 需要外部可达的 HTTP 路径，DNS-01 需要 DNS provider 凭据，适合通配符证书。选择哪种挑战方式取决于入口和 DNS 架构。

证书续期不是“到期前手动处理”。控制器根据 renewBefore 提前续期，更新 Secret；工作负载需要重新加载证书。挂载的 Secret 更新有延迟，应用是否自动重载取决于实现。

## 工作机制

创建 Certificate 后，控制器生成 CertificateRequest，Issuer 签发证书并写入 Secret。ACME 流程中，控制器创建 Order，再创建 Challenge，等待 ACME 服务器验证，成功后获取证书。

签发失败会记录在 Certificate 和 CertificateRequest 的状态与事件中。常见原因包括 DNS 记录未生效、HTTP 路径不可达、ACME 账户未注册、速率限制和权限不足。

证书轮换涉及私钥和 Secret 更新。使用 ingress-shim 时，Ingress 注解可以自动创建 Certificate；手工创建时，要确保域名、Secret 名称和命名空间一致。

## 关键配置与实践

- 生产环境使用 ClusterIssuer 或受控 Issuer，限制可签发域名和命名空间。
- ACME 账户私钥和 DNS 凭据存放在 Secret，使用最小权限和轮换策略。
- renewBefore 应大于续期失败的重试窗口，避免临近到期才续期。
- 通配符证书使用 DNS-01；HTTP-01 要确认入口、路径和重定向不会阻断挑战。
- 监控 Certificate 的 Ready 状态、到期时间和续期失败次数。
- 工作负载应验证证书重载；只更新 Secret 不等于应用已使用新证书。

## 版本差异与兼容性

本文以 cert-manager 1.21.3 为核实基线，覆盖 1.19–1.21。cert-manager 与 Kubernetes 的兼容矩阵随版本变化，升级前需查官方支持表。

| 版本线 | 状态 | 对本文的影响 |
| --- | --- | --- |
| 1.21.x | 当前主线，核实基线 1.21.3 | CRD、ACME 和 webhook 行为以 1.21 文档为准 |
| 1.19–1.20 | 受支持存量 | 新字段和默认值需逐项核对 |
| 更早版本 | 历史版本 | 升级需核对 CRD 转换、API 版本和 webhook |

cert-manager 的 CRD 升级是独立步骤，不能只升级控制器镜像。CRD 与控制器版本不匹配会导致资源无法创建或更新。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| Certificate 不 Ready | DNS 未生效、HTTP 挑战不可达、凭据错误 | describe、Challenge、Issuer 状态 |
| 续期失败 | renewBefore 过短、ACME 限流、Secret 权限 | Certificate 事件、ACME 日志、速率限制 |
| 证书已更新但应用仍旧 | 应用未重载、挂载延迟、缓存 | Pod 内证书、应用日志、重启策略 |
| webhook 不可用 | cert-managerPod 异常、网络策略、证书过期 | webhook 日志、端点、证书 |
| 签发被拒绝 | 域名策略、RBAC、Issuer 作用域 | Issuer 配置、ClusterRole、命名空间 |

ACME 有速率限制。频繁重建 Certificate 或反复失败会触发限制，排查时应先看账户和域名维度的配额。

## 技术关联

cert-manager 为 Istio、Ingress、webhook 和工作负载签发证书；证书写入 Secret 后由 Pod 挂载；Grafana 可监控证书到期和续期状态。它与 Istio 自有证书管理有重叠，部署时需明确职责边界，避免两套机制同时签发同一身份。

## 参考资料

- [cert-manager Documentation](https://cert-manager.io/docs/)
- [cert-manager ACME](https://cert-manager.io/docs/configuration/acme/)
- [cert-manager Releases](https://github.com/cert-manager/cert-manager/releases)`,
    {
      versions: 'cert-manager 1.19–1.21（核实基线 1.21.3）',
      docsUrl: 'https://cert-manager.io/docs/',
      version: 2,
      replacesContentHash: '41776fa904b3b985a2a6a1fda41a2fe459296ea4d4f094ecc0aad9fbe5bc8c4a',
      referenceLinks: [
        { label: 'cert-manager Documentation', url: 'https://cert-manager.io/docs/' },
        { label: 'cert-manager ACME', url: 'https://cert-manager.io/docs/configuration/acme/' },
        { label: 'cert-manager Releases', url: 'https://github.com/cert-manager/cert-manager/releases' },
      ],
    },
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
    `## 技术定位

Podman 是无守护进程的容器引擎，位于用户与 OCI 容器/镜像之间，负责拉取、运行、构建和管理容器与 Pod。它提供与 Docker CLI 相近的体验，但架构和权限模型不同。

Podman 适合单机容器、开发环境、CI 构建、rootless 运行和 systemd 集成。它不适合替代 Kubernetes 的集群编排、跨节点调度和服务发现；这些由 Kubernetes 或 Nomad 等系统承担。

## 设计原理

Podman 不依赖常驻 daemon。每个 podman 命令直接调用容器运行时和存储，容器进程由 conmon 监控。没有 daemon 意味着没有单点守护进程，也意味着容器不会因为“引擎重启”而统一管理；生命周期由命令、systemd 或外部编排负责。

rootless 模式使用用户命名空间映射 UID/GID，普通用户可以运行容器。它降低权限风险，但受 subuid/subgid、cgroup v2、网络端口和存储驱动限制。不是所有镜像和端口都能在 rootless 下直接运行。

Pod 是共享网络命名空间的容器组，类似 Kubernetes Pod 的本地概念。Quadlet 把容器/Pod 配置交给 systemd 管理，生成 unit 并随系统启动，适合把单机容器纳入主机生命周期。

## 工作机制

podman run 解析镜像、创建容器、配置命名空间和 cgroup、启动进程。镜像存储按用户和存储驱动隔离；root 与 rootless 的镜像缓存通常不共享，拉取和磁盘占用需要分别计算。

Podman 可以消费 Dockerfile 构建镜像，也可调用 Buildah 做更细粒度构建；Skopeo 负责镜像复制和检查。三者共享 OCI 生态，但命令和存储行为不完全相同。

与 Docker Compose 的兼容通过 podman-compose 或 Quadlet 实现，但网络、卷、健康检查和依赖顺序的语义可能有差异。迁移前应逐项验证，而不是假设命令兼容就等于行为兼容。

## 关键配置与实践

- rootless 运行前配置 /etc/subuid、/etc/subgid 和 cgroup v2，确认用户命名空间可用。
- 使用 Quadlet 管理长期服务，设置 Restart、依赖和资源限制，避免依赖交互式 shell。
- 镜像使用 digest 或不可变标签，定期清理未使用镜像和卷。
- rootless 端口低于 1024 需要额外配置，不能默认绑定。
- 网络模式、DNS 和防火墙规则要与主机网络策略一致。
- 敏感信息使用 Secret 或外部注入，不要把凭据写入镜像层。

## 版本差异与兼容性

本文以 Podman 6.1.4 为核实基线，覆盖 5.x 与 6.x。Podman 与 Docker、Kubernetes 的兼容性按功能分别评估。

| 版本线 | 状态 | 对本文的影响 |
| --- | --- | --- |
| 6.x | 当前主线，核实基线 6.1.4 | 运行时、Quadlet 和网络行为以 6.x 文档为准 |
| 5.x | 受支持存量 | 部分命令和配置需逐项核对 |
| Docker 兼容 | 非版本绑定 | CLI 相近不代表 API、存储和网络语义完全一致 |

Podman 不是 Docker 的版本分支，不能用 Docker 的版本周期推断 Podman 的支持状态；反之亦然。

## 常见问题与限制

| 现象 | 常见原因 | 排查方向 |
| --- | --- | --- |
| rootless 启动失败 | subuid/subgid 缺失、cgroup 未启用 | /etc/subuid、cgroup v2、podman info |
| 端口无法绑定 | 低端口权限、网络命名空间 | rootless 端口配置、防火墙 |
| 镜像拉取失败 | 认证、registry 证书、网络代理 | podman login、registries.conf、TLS |
| 容器重启后消失 | 未使用 systemd/Quadlet、重启策略缺失 | Quadlet unit、Restart、开机启动 |
| 磁盘持续增长 | 未清理镜像/卷、存储驱动 | podman system df、prune、存储配置 |

Podman 的“无 daemon”不等于“无需管理”。长期运行的容器仍需要 systemd、监控和日志收集，否则故障后不会自动恢复。

## 技术关联

Podman 运行 OCI 镜像，可从 Harbor 拉取；Quadlet 与 systemd 集成；Buildah/Skopeo 覆盖构建和镜像复制；Kubernetes 负责集群编排。它与 Docker 在单机容器场景存在替代关系，但不是 Kubernetes 的替代。

## 参考资料

- [Podman Documentation](https://docs.podman.io/)
- [Podman Rootless](https://docs.podman.io/en/latest/markdown/podman.1.html)
- [Podman Quadlet](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html)`,
    {
      versions: 'Podman 5.x / 6.x（核实基线 6.1.4）',
      docsUrl: 'https://docs.podman.io/',
      version: 2,
      replacesContentHash: '98a922fc7711afcc8ec3494912be46da4a3ce347ad2d1a13d55f7be2437519d6',
      referenceLinks: [
        { label: 'Podman Documentation', url: 'https://docs.podman.io/' },
        { label: 'Podman Rootless', url: 'https://docs.podman.io/en/latest/markdown/podman.1.html' },
        { label: 'Podman Quadlet', url: 'https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html' },
      ],
    },
  ),
];
