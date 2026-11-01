# 数据库设计

Opsite 使用单个 SQLite 数据库保存全部业务数据。本文说明数据文件、表分组、关键约束、迁移方式和维护注意事项。

## 1. 数据文件

默认数据目录由 `DATA_DIR` 决定，未设置时为项目根目录下的 `data/`：

```text
data/
├── opsite.db          # 主数据库
├── opsite.db-wal      # WAL 日志
├── opsite.db-shm      # 共享内存索引
├── .secret            # 自动生成的 SMTP 加密密钥
└── backups/           # /api/backup 生成的快照
```

数据库连接参数：

| 参数 | 值 |
| --- | --- |
| 驱动 | `better-sqlite3` |
| 日志模式 | `journal_mode = WAL` |
| 外键 | `foreign_keys = ON` |
| 忙等待 | `busy_timeout = 5000` |

WAL 模式允许读写并发，但只适合单进程访问。不要让多个 Opsite 实例同时写同一个数据库文件。

## 2. 通用约定

- 主键统一使用 `TEXT` UUID。
- 时间使用 ISO 8601 UTC 字符串，例如 `2026-11-01T06:30:00.000Z`。
- 布尔值使用 `INTEGER` 的 `0/1`。
- 结构化数据使用 JSON 文本，例如别名、标签、配置、受影响范围、图数据。
- 外键开启，但部分历史表使用逻辑关联而非外键，例如 `follow_target.software_id`、`intelligence_event.ref_id`。
- 删除软件默认是**归档**（写 `deleted_at`），不是物理删除。

## 3. 表分组

当前共有 44 张表。

### 3.1 配置与运行状态

| 表 | 用途 | 关键约束 |
| --- | --- | --- |
| `settings` | 键值配置 | `key` 主键 |
| `smtp_config` | 单行 SMTP 配置 | `id = 1` |
| `sync_job` | 单次软件同步记录 | 关联软件与数据源 |
| `kev_entry` | CISA KEV 缓存 | `cve_id` 主键 |

### 3.2 软件与情报

| 表 | 用途 | 关键关系 |
| --- | --- | --- |
| `software` | 软件主数据 | `slug` 唯一，`deleted_at` 表示归档 |
| `software_source` | 软件的数据源配置 | 删除软件时级联删除 |
| `lifecycle_record` | 生命周期周期 | 唯一键：软件 + 数据源 + cycle |
| `release_record` | 版本发布 | 唯一键：软件 + 数据源 + external_id |
| `security_advisory` | 安全公告 | 唯一键：软件 + identifier |
| `advisory_source` | 公告来源记录 | 删除公告时级联删除 |
| `advisory_affected_range` | 受影响版本范围 | 删除公告时级联删除 |
| `advisory_user_state` | 漏洞处置状态 | 与公告一对一 |
| `intelligence_event` | 统一情报事件 | `dedupe_key` 唯一 |
| `user_event_state` | 事件已读与处置 | 与事件一对一 |

`software` 与来源、发布、生命周期、公告、事件之间使用 `ON DELETE CASCADE`。因此物理删除软件会带走关联数据；正常界面操作只做归档。

### 3.3 关注与通知

| 表 | 用途 | 关键约束 |
| --- | --- | --- |
| `follow_target` | 关注对象 | 唯一键：类型 + 对象 ID |
| `subscription_rule` | 全局或单个关注对象的订阅规则 | 唯一键：范围 + 范围 ID + 事件类型 |
| `notification` | 站内通知 | `dedupe_key` 唯一 |
| `notification_delivery` | 邮件投递记录 | 唯一键：通知 + 渠道 |

`notification_delivery.notification_id` 使用级联删除。通知本身通常不删除；目前没有自动清理机制。

### 3.4 雷达与知识

| 表 | 用途 | 关键关系 |
| --- | --- | --- |
| `radar_item` | 技术雷达条目 | `archived_at` 表示归档 |
| `radar_record` | 评估、试用、采用、备注、状态变更记录 | 删除条目时级联删除 |
| `knowledge_note` | 个人笔记 | 可关联软件和技术节点 |

`knowledge_note.tech_node_id` 由增量迁移添加，没有外键；删除技术节点不会自动删除笔记，笔记中的关联 ID 可能失效。

### 3.5 技术发现

| 表 | 用途 | 关键约束 |
| --- | --- | --- |
| `discovery_source` | 来源状态 | `type` 唯一 |
| `discovery_rule` | GitHub 搜索规则 | 唯一键：来源 + 名称 |
| `discovery_candidate` | 候选项目 | 唯一键：来源类型 + 来源条目 ID |
| `discovery_candidate_source` | 候选的多来源记录 | 主键：来源类型 + 来源条目 ID |
| `discovery_job` | 采集任务记录 | 关联一次运行 |

候选的 `radar_item_id` 使用 `ON DELETE SET NULL`：删除雷达条目后，候选回到待评估，但候选本身保留。

### 3.6 运行中心

| 表 | 用途 | 关键关系 |
| --- | --- | --- |
| `data_sources` | 全局数据源注册表 | `source_key` 唯一 |
| `collection_tasks` | 采集任务与 cron | 关联数据源 |
| `collection_runs` | 采集执行记录 | 关联任务和数据源 |
| `source_health_checks` | 数据源检查历史 | 关联数据源 |
| `source_quota_records` | 上游配额与限流记录 | 关联数据源 |
| `operation_alerts` | 待处理运行问题 | `alert_key` 唯一 |

`source_health_checks`、`source_quota_records`、`collection_runs` 目前没有自动清理策略，会随运行时间累积。备份和数据库大小需要自行关注。

### 3.7 技术地图

| 表 | 用途 | 关键关系 |
| --- | --- | --- |
| `tech_domains` | 技术领域 | 删除领域时级联删除节点和视图 |
| `tech_nodes` | 技术节点与文档 | `parent_id` 自关联，级联删除子树 |
| `tech_relations` | 节点关系 | 源节点和目标节点均级联删除 |
| `tech_views` | 架构视图与图数据 | 随领域级联删除 |
| `tech_node_software` | 节点与软件关联 | 复合主键 |
| `tech_node_radar` | 节点与雷达关联 | 复合主键 |
| `tech_node_discovery` | 节点与发现候选关联 | 复合主键 |
| `tech_seed` | 内置模板是否已应用 | `key` 主键 |
| `tech_content_seed` | 内置内容版本 | `key` 主键 |

`tech_nodes.content_markdown`、`content_status`、`content_source`、`applicable_versions`、`content_updated_at`、`content_verified_at`、`verified_version`、`relation_review_status`、`relation_review_note` 由增量迁移添加。

### 3.8 知识建档

| 表 | 用途 | 关键约束 |
| --- | --- | --- |
| `tech_knowledge_build_rules` | 自动建档规则 | 按启用状态和触发方式建索引 |
| `tech_knowledge_build_pending` | 无法自动决定的目标 | 状态和创建时间建索引 |
| `tech_knowledge_build_previews` | 预览快照 | 记录请求哈希、候选哈希、过期时间、消费时间 |

预览表在每次生成预览时删除已过期记录；执行后也会删除对应预览。自动规则和待处理项属于用户数据，升级时不应清理。

## 4. 迁移方式

项目没有独立迁移框架，也没有 `schema_migrations` 版本表。迁移分三层：

1. **建表**：`server/db.ts` 使用 `CREATE TABLE IF NOT EXISTS`。
2. **增量列**：`ensureColumn(table, column, definition)` 检查 `PRAGMA table_info`，缺失时执行 `ALTER TABLE ... ADD COLUMN`。
3. **索引与种子**：每次启动执行 `CREATE INDEX IF NOT EXISTS` 和 `ON CONFLICT DO NOTHING` 的幂等写入。

这种方式的边界：

- 只能安全地增加表、索引和可空/带默认值的列；
- 不支持删除列、重命名列、修改列类型；
- 不记录迁移顺序，不能回滚；
- 复杂数据变换需要写成启动时幂等 SQL，或提供一次性脚本；
- 修改表结构时必须同时考虑旧数据库，不能只改建表语句。

修改结构的检查清单：

- 新列必须允许旧行存在，提供默认值或允许 `NULL`；
- 新表必须使用 `IF NOT EXISTS`；
- 新索引必须使用 `IF NOT EXISTS`；
- 种子数据必须可重复执行；
- 评估旧数据库升级后的查询兼容性；
- 在升级前备份 `opsite.db`。

## 5. 种子数据

首次启动和每次启动都会执行幂等种子：

- 默认技术发现来源和规则；
- 全局通知订阅规则；
- 数据源注册表；
- 采集任务；
- 技术地图模板和内置内容。

种子只插入缺失记录，不覆盖用户修改。`tech_seed` 和 `tech_content_seed` 记录模板与内容的版本，避免重复应用。

## 6. 事务与并发

- `better-sqlite3` 是同步驱动，单条语句自动提交。
- 跨多条语句的写操作使用 `db.transaction()`，例如创建软件、应用模板、更新通知规则、执行知识建档。
- WAL 允许多个读事务与一个写事务并发。
- `busy_timeout=5000` 让写锁冲突等待最多 5 秒。
- 没有跨进程锁；不要同时运行两个 Opsite 实例写同一个数据库。

## 7. 备份与恢复

### 在线快照

`GET /api/backup` 使用：

```sql
VACUUM INTO 'data/backups/opsite-....db'
```

生成一致性快照并下载。快照不包含 WAL/SHM 文件，但包含数据库中的全部已提交数据。

### 手动拷贝

先停止服务，再复制 `opsite.db`。运行中只复制主文件可能丢失 WAL 中尚未检查点的数据。

恢复步骤：

1. 停止服务；
2. 备份当前数据库；
3. 用快照替换 `opsite.db`；
4. 删除旧的 `opsite.db-wal` 和 `opsite.db-shm`；
5. 重启服务。

### 密钥

数据库中的 SMTP 密码是密文。恢复数据库后，必须保留原来的 `OPSITE_SECRET` 或 `data/.secret`，否则密文无法解密。

## 8. 数据保留与敏感信息

- 没有统一的数据保留策略；通知、运行记录、健康检查、配额记录和备份会持续累积。
- 删除软件默认归档；物理删除只通过数据库操作发生。
- `data/`、`.env`、备份文件、`.secret` 都不得提交到版本库。
- 备份和数据库包含软件配置、SMTP 密文、笔记、Token 配置状态等敏感信息。
- `/api/backup` 没有鉴权，只应在可信本地环境中使用。
