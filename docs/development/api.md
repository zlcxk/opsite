# HTTP API

本文说明 Opsite `0.1.0` 的 HTTP 接口约定和主要端点。接口实现位于 `server/routes.ts`，请求与响应类型大部分定义在 `shared/types.ts`。

## 1. 基本约定

| 项目 | 说明 |
| --- | --- |
| Base URL | 同源 `/api` |
| 格式 | JSON；请求体上限 `1mb` |
| 认证 | 无 |
| 授权 | 无 |
| CSRF 防护 | 无 |
| CORS | 未启用，仅同源访问 |
| 时间 | ISO 8601 UTC 字符串 |
| 错误格式 | `{ "error": "错误说明" }` |

前端通过 `src/lib/api.ts` 调用接口。开发模式下 Vite 把 `/api` 代理到 `http://127.0.0.1:8787`。

> API 没有认证。任何能访问端口的客户端都可以读写全部数据，包括下载完整数据库。只应在可信本地环境使用。

## 2. 状态码

| 状态码 | 含义 |
| --- | --- |
| `200` | 查询或更新成功 |
| `201` | 创建成功 |
| `202` | 后台任务已启动（采集、发现、重试） |
| `400` | 参数或状态不合法 |
| `404` | 资源不存在 |
| `409` | 资源冲突、任务忙碌或预览失效 |
| `500` | 服务内部错误 |
| `502` | SMTP 测试发送失败 |

未匹配的 `/api/*` 返回 JSON 404；非 API 的 GET 请求回退到前端 `index.html`。

## 3. 健康检查与元数据

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 返回 `{ ok: true, time }`，用于容器健康检查 |
| GET | `/api/meta` | 软件分类、调度器状态、数据源类型 |
| GET | `/api/system/status` | 调度器、最近同步时间、凭据是否配置 |
| GET | `/api/dashboard` | 值班台指标、最近事件、通知摘要 |
| GET | `/api/catalog` | 内置软件目录，支持 `q`、`category`、`coverage` |
| GET | `/api/search?q=` | 跨软件、事件、雷达、知识等搜索 |

## 4. 软件

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/software` | 软件列表；`includeArchived=true` 包含归档 |
| POST | `/api/software` | 创建软件，`201` |
| GET | `/api/software/:id` | 软件详情，包含来源、版本、生命周期、漏洞、事件 |
| PATCH | `/api/software/:id` | 更新软件字段或数据源配置 |
| DELETE | `/api/software/:id` | 归档软件，不物理删除 |
| POST | `/api/software/:id/sync` | 触发单个软件同步；可传 `{ sourceIds: [] }` |
| POST | `/api/sync-all` | 同步全部关注中的软件 |

创建软件时二选一：

- 传 `catalogKey` 使用内置目录；
- 传 `name` 创建自定义软件，并至少提供一个 `sources` 项。

最小自定义示例：

```json
{
  "name": "示例组件",
  "category": "其他",
  "sources": [
    {
      "type": "github_releases",
      "label": "GitHub Releases",
      "enabled": true,
      "config": { "repo": "owner/repo" }
    }
  ]
}
```

同步接口在已有任务运行时返回 `409`。创建软件后会在后台触发首次同步，不会阻塞创建响应。

## 5. 漏洞、事件、版本

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/advisories` | 漏洞列表；`softwareId`、`priority`、`status`、`openOnly`、`limit`、`offset` |
| GET | `/api/advisories/:id` | 漏洞详情 |
| PATCH | `/api/advisories/:id/status` | 更新处置状态 |
| GET | `/api/events` | 事件列表；`softwareId`、`type`、`priority`、`status`、`unread`、`limit`、`offset` |
| PATCH | `/api/events/:id/read` | 标记已读 |
| POST | `/api/events/read-all` | 全部标记已读 |
| PATCH | `/api/events/:id/status` | 更新事件状态 |
| GET | `/api/releases` | 发布列表；`softwareId`、`channel`，最多 200 条 |
| GET | `/api/lifecycle` | 生命周期列表；`softwareId` |
| GET | `/api/jobs` | 同步记录；`softwareId`、`limit`，默认 100 |

漏洞处置状态：

```text
pending | to_fix | planned | fixed | not_affected | ignored
```

事件处置状态：

```text
new | acknowledged | resolved | ignored
```

示例：

```json
PATCH /api/advisories/advisory-id/status
{ "status": "to_fix" }
```

把漏洞设为 `fixed`、`not_affected` 或 `ignored` 时，关联的漏洞事件会在同一次请求中被标记为 `resolved`。

## 6. 技术雷达

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/radar` | 列表；`kind`、`status`、`q`、`sort`、`includeArchived`、`archived`、`limit` |
| POST | `/api/radar` | 创建条目，`201` |
| GET | `/api/radar/:id` | 详情与评估记录 |
| PATCH | `/api/radar/:id` | 更新标题、简介、类型、链接 |
| PATCH | `/api/radar/:id/status` | 状态流转 |
| POST | `/api/radar/:id/archive` | 归档 |
| POST | `/api/radar/:id/restore` | 恢复 |
| GET | `/api/radar/:id/records` | 记录列表 |
| POST | `/api/radar/:id/records` | 新增评估、试用、采用或备注记录 |
| DELETE | `/api/radar/:id` | 永久删除条目和全部记录 |

状态值：

```text
pending | trialing | adopted | deferred | ignored
```

状态变更会自动写入一条 `status_change` 记录。删除条目后，来源发现候选的 `radar_item_id` 会被置空并回到待评估。

## 7. 技术发现

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/discovery/candidates` | 候选列表；`status`、`source`、`category`、`q`、`sort`、`limit`、`offset` |
| GET | `/api/discovery/candidates/:id` | 候选详情 |
| GET | `/api/discovery/candidates/:id/radar-match` | 查找相同链接的雷达条目 |
| POST | `/api/discovery/candidates/:id/import` | 导入雷达，`201` |
| POST | `/api/discovery/candidates/:id/ignore` | 忽略 |
| POST | `/api/discovery/candidates/:id/restore` | 恢复为待评估 |
| GET | `/api/discovery/overview` | 采集状态、调度状态、统计 |
| GET | `/api/discovery/sources` | 来源状态 |
| GET | `/api/discovery/rules` | 采集规则 |
| GET | `/api/discovery/jobs` | 最近采集记录；`limit`，默认 12 |
| POST | `/api/discovery/refresh` | 触发手动采集，`202`；运行中返回 `409` |

导入请求：

```json
{
  "title": "项目名称",
  "summary": "关注原因或简介",
  "kind": "tool",
  "url": "https://example.com/project"
}
```

如果雷达中已有相同规范化链接，导入返回 `409`。应改用 `radar-match` 返回的条目。

## 8. 个人笔记

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/knowledge` | 笔记列表；可用 `techNodeId` 过滤 |
| POST | `/api/knowledge` | 创建笔记，`201` |
| PATCH | `/api/knowledge/:id` | 更新笔记 |
| DELETE | `/api/knowledge/:id` | 删除笔记 |

笔记字段包括 `title`、`content`、`tags`、`relatedSoftwareId`、`techNodeId`。关联不存在的技术节点返回 `400`。

## 9. 技术地图

### 领域与总览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/tech/overview` | 领域数、节点数、掌握与文档统计 |
| GET | `/api/tech/domains` | 领域列表 |
| POST | `/api/tech/domains` | 创建领域 |
| GET | `/api/tech/domains/:id` | 领域详情 |
| PATCH | `/api/tech/domains/:id` | 更新领域 |
| DELETE | `/api/tech/domains/:id` | 删除领域及其节点、视图 |
| GET | `/api/tech/domains/:id/tree` | 领域技术树 |
| GET | `/api/tech/domains/:id/views` | 领域架构视图列表 |
| POST | `/api/tech/domains/:id/nodes` | 在领域下创建节点 |
| POST | `/api/tech/domains/:id/views` | 创建架构视图 |

### 节点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/tech/nodes` | 节点列表；支持 `domainId`、`status`、`limit` 等查询 |
| GET | `/api/tech/nodes/:id` | 节点详情 |
| PATCH | `/api/tech/nodes/:id` | 更新节点或文档 |
| DELETE | `/api/tech/nodes/:id?strategy=promote\|subtree` | 删除节点 |
| POST | `/api/tech/nodes/:id/move` | 移动节点 |
| POST | `/api/tech/nodes/:id/archive` | 归档或恢复节点 |
| PATCH | `/api/tech/nodes/:id/cognition` | 更新掌握状态和关注级别 |
| PATCH | `/api/tech/nodes/:id/relation-review` | 记录“独立确认”决定 |
| POST | `/api/tech/nodes/:id/verify` | 验证文档，设置“已完善” |
| POST | `/api/tech/nodes/:id/software` | 关联软件 |
| POST | `/api/tech/nodes/:id/radar` | 关联雷达条目 |
| POST | `/api/tech/nodes/:id/discovery` | 关联发现候选 |

删除策略：

- `promote`：保留子节点，提升一级；
- `subtree`：连同子树一起删除；
- 不传时，无子节点可直接删除，有子节点返回 `400`。

验证前正文必须已保存且非空，请求只需提供本次实际验证的版本：

```json
{
  "version": "1.30"
}
```

### 关系、视图与模板

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/tech/relations` | 关系列表；可按节点过滤 |
| POST | `/api/tech/relations` | 创建关系 |
| DELETE | `/api/tech/relations/:id` | 删除关系 |
| GET | `/api/tech/views/:id` | 视图详情与图数据 |
| PATCH | `/api/tech/views/:id` | 保存名称、说明、类型、图数据 |
| DELETE | `/api/tech/views/:id` | 删除视图，只删画布和连线 |
| GET | `/api/tech/templates` | 内置技术模板 |
| POST | `/api/tech/templates/:key/apply` | 应用模板，只补缺失项 |

视图保存采用整图覆盖，没有版本历史或冲突合并。

## 10. 知识建档与体检

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/tech/knowledge-build/templates` | 5 套建档模板 |
| POST | `/api/tech/knowledge-build/preview` | 生成预览 |
| POST | `/api/tech/knowledge-build/execute` | 执行建档 |
| POST | `/api/tech/knowledge-build/check-urls` | 检查来源 URL |
| GET | `/api/tech/knowledge-build/rules` | 自动规则列表 |
| POST | `/api/tech/knowledge-build/rules` | 创建规则 |
| PATCH | `/api/tech/knowledge-build/rules/:id` | 更新或启停规则 |
| DELETE | `/api/tech/knowledge-build/rules/:id` | 删除规则 |
| GET | `/api/tech/knowledge-build/pending` | 待人工决定项 |
| DELETE | `/api/tech/knowledge-build/pending/:id` | 忽略待处理项 |
| POST | `/api/tech/knowledge-build/lint` | 只读文档体检 |

预览和执行是两步流程：

```text
POST /api/tech/knowledge-build/preview
  → { previewId, previewHash, counts, items, warnings, expiresAt }

POST /api/tech/knowledge-build/execute
  { ...同一份请求, confirmed: true, previewId, previewHash }
```

预览有效期为 10 分钟，只能使用一次。范围、数据或请求参数变化后返回 `409`。

请求的核心字段：

```json
{
  "scopeType": "software",
  "software": { "ids": ["software-id"] },
  "filters": { "skipVerified": true },
  "templateKey": "component-l2-v1",
  "mapping": { "linkStrategy": "none" },
  "sources": { "docsUrl": null, "referenceLinks": [] }
}
```

`scopeType` 取值：`software`、`nodes`、`combined`、`new`。服务端会拒绝没有明确范围的请求。

URL 检查请求：

```json
{ "urls": ["https://example.com/docs"] }
```

只接受 HTTPS，结果状态为 `ok`、`redirect`、`unreachable`、`blocked`、`invalid`。

## 11. 设置与关注

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/settings` | 公开设置和调度状态 |
| PATCH | `/api/settings` | 更新采集与通知设置；cron 非法返回 `400` |
| GET | `/api/follows` | 关注列表；`type`、`q` |
| GET | `/api/follows/status?targetType=&targetId=` | 查询是否已关注 |
| POST | `/api/follows` | 关注对象；已存在时返回 `200` |
| DELETE | `/api/follows/:id` | 取消关注 |
| PATCH | `/api/follows/:id/rules` | 保存单个对象的订阅规则 |
| DELETE | `/api/follows/:id/rules` | 清除单个对象的规则 |
| GET | `/api/notification-rules` | 全局订阅规则 |
| PATCH | `/api/notification-rules` | 保存全局订阅规则 |

## 12. 通知与 SMTP

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/notifications` | 通知列表；`unread`、`severity`、`ruleType`、`limit`、`offset` |
| PATCH | `/api/notifications/:id` | 设置已读/未读 |
| POST | `/api/notifications/read-all` | 全部已读 |
| GET | `/api/notifications/deliveries` | 邮件投递记录；`status`、`limit` |
| POST | `/api/notifications/deliveries/:id/retry` | 重试投递 |
| GET | `/api/notifications/smtp` | SMTP 配置视图，不返回密码 |
| PATCH | `/api/notifications/smtp` | 保存 SMTP |
| POST | `/api/notifications/smtp/test` | 发送测试邮件，失败返回 `502` |

SMTP 密码只在写入时提交，读取时只返回 `passwordConfigured`。

## 13. 运行中心

### 概览与数据源

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/operations/overview` | 调度器、健康、执行统计 |
| GET | `/api/operations/issues` | 待处理问题 |
| GET | `/api/operations/freshness` | 数据新鲜度 |
| GET | `/api/sources` | 数据源列表 |
| GET | `/api/sources/:id` | 数据源详情 |
| PATCH | `/api/sources/:id` | 更新启用状态、新鲜度设置 |
| POST | `/api/sources/:id/check` | 健康检查，不写业务数据 |
| POST | `/api/sources/:id/collect` | 触发关联任务 |
| GET | `/api/sources/:id/health` | 最近健康检查 |
| GET | `/api/sources/:id/runs` | 最近执行 |

### 任务与执行

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/collection-tasks` | 任务列表 |
| GET | `/api/collection-tasks/:id` | 任务详情 |
| PATCH | `/api/collection-tasks/:id` | 更新启用、cron、超时 |
| POST | `/api/collection-tasks/:id/run` | 立即执行，`202` |
| GET | `/api/collection-tasks/:id/runs` | 任务执行历史 |
| GET | `/api/collection-runs` | 全部执行记录 |
| GET | `/api/collection-runs/:id` | 执行详情 |
| POST | `/api/collection-runs/:id/retry` | 重试失败或超时执行，`202` |

任务忙碌或已有采集运行时返回 `409`。重试成功执行返回 `409`。

## 14. 备份

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/backup` | 通过 `VACUUM INTO` 生成并下载完整数据库快照 |

备份文件写入服务启动目录下的 `data/backups/`，不是 `DATA_DIR`。接口没有鉴权，返回内容包含完整数据库和 SMTP 密码密文。

## 15. 错误处理

服务端统一把未捕获异常转换为：

```json
{
  "error": "服务内部错误，请稍后重试；如果持续失败，请检查服务日志与 data/ 目录权限。"
}
```

内部异常和数据库细节只写入服务端日志。业务校验错误由路由层返回更具体的中文说明。

客户端应检查 HTTP 状态码和 `error` 字段，不要依赖错误文本做程序判断；需要区分冲突时使用状态码。
