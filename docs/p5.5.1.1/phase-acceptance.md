# P5.5.1.1 知识建档可靠性修正 · 阶段验收

## 1. 交付范围

本阶段只修正 P5.5.1 的可靠性问题，不扩展建档能力。

### P0

1. 预览快照与执行范围绑定；
2. 软件关联与文档初始化拆分；
3. Linter 技术关联检查改为结构化人工确认；
4. Linter 占位提示去掉模板注释与固定提示误报；
5. 新增知识来源使用严格 HTTPS，并去重。

### P1

1. 新建知识摘要写入 `tech_nodes.summary`，不再复制到 `description`；
2. 自动规则支持完整回填编辑，PATCH 复用同一套校验，不回溯历史执行结果。

未新增 AI 生成、爬虫、自动技术关联推断、自动状态变更、批量重写、Kubernetes 核心知识修改或通用工作流引擎。

## 2. 数据模型

### 2.1 预览快照表

```sql
CREATE TABLE IF NOT EXISTS tech_knowledge_build_previews (
  id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  candidate_hash TEXT NOT NULL,
  candidate_snapshot TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tech_build_previews_expiry
  ON tech_knowledge_build_previews(expires_at);
```

- `request_hash`：规范化请求参数的 SHA-256；
- `candidate_hash`：稳定排序后的候选快照 SHA-256；
- `candidate_snapshot`：逐项候选及元数据指纹；
- 默认有效期 10 分钟；
- 创建预览与执行前都会清理过期记录。

### 2.2 关联审查字段

`tech_nodes` 前向兼容新增：

| 字段 | 用途 |
| --- | --- |
| `relation_review_status` | `unreviewed` / `independent`，默认 `unreviewed` |
| `relation_review_note` | 人工确认独立主题时的原因 |

旧节点不变，关联关系不变，不根据正文关键词自动写入。

### 2.3 新建摘要

`tech_nodes.summary` 保存新建知识时填写的摘要（最多 500 字符）。`description` 保持为空，不再重复写入摘要。

## 3. 预览快照机制

### 3.1 预览返回

`POST /tech/knowledge-build/preview` 返回：

- `previewId`
- `previewHash`
- `expiresAt`
- `counts`
- `items`
- `warnings`

### 3.2 快照内容

每个候选按 `key`、`action` 稳定排序后计算哈希。指纹包括：

- 操作类型；
- 软件名称、分类、描述、官网、仓库、关注状态、安装版本、上游最新版本；
- 节点名称、领域、父节点、类型、状态、正文哈希、内容来源、适用版本、验证字段、文档地址、参考链接、摘要、结构化描述字段、关系审查字段；
- 节点已关联软件 ID 与关系 ID；
- 新建目标领域、父节点、节点类型、名称、摘要、同名节点状态；
- 模板与规范化来源。

### 3.3 执行校验

`POST /tech/knowledge-build/execute` 要求：

1. `confirmed === true`；
2. 携带 `previewId`；
3. `previewHash` 与当前请求一致；
4. 预览存在、未过期、未消费；
5. 预览请求哈希与执行请求一致；
6. 重新解析候选并计算候选哈希，与快照一致。

失败行为：

| 情况 | 结果 |
| --- | --- |
| 缺少确认 | 400，要求确认预览范围 |
| 缺少 `previewId` | 400，要求先预览 |
| 预览不存在、过期或已清理 | 409 |
| 预览已消费 | 409 |
| 请求参数变化 | 409 |
| 候选集合、操作类型或关键元数据变化 | 409，要求重新生成预览 |

预览消费使用 `consumed_at IS NULL` 条件原子占用。逐项失败不会抛出；只有非预期异常会释放消费标记，避免预览被错误地永久占用。

## 4. 关联与初始化拆分

| 操作 | 行为 |
| --- | --- |
| `link_existing` | 只建立 `tech_node_software` 关联，可作用于有正文、草稿、已完善节点 |
| `initialize_doc` | 只初始化空文档，执行时再次检查正文为空 |
| `link_and_initialize` | 同一事务内建立关联并初始化空文档 |

- 关联使用 `ON CONFLICT(node_id, software_id) DO NOTHING`，重复执行不产生重复关联。
- 初始化 SQL 仍带 `content_markdown IS NULL OR TRIM(content_markdown) = ''` 条件。
- `link_and_initialize` 初始化失败会回滚整个事务，不留下半完成关联。
- 不覆盖任何已有 Markdown；不修改个人笔记；不自动把草稿改为已完善。
- 前端在 `link_existing` 策略下提供显式复选框 `initializeOnLink`，默认关闭。

## 5. Linter 修正

### 5.1 技术关联

- 存在任意技术关系 → 通过；
- 无关系，且 `relation_review_status = independent` 且原因非空 → 通过；
- 其他情况 → 警告；
- 不再根据正文“独立”关键词判定。

新增接口：

```text
PATCH /tech/nodes/:id/relation-review
{ "status": "unreviewed" | "independent", "note": "..." }
```

确认 `independent` 时必须填写原因，否则 400。

### 5.2 占位提示

- 扫描前剥离 HTML 注释，模板写作提示不再误报；
- 排除版本表固定行与参考资料固定提示；
- 仅检查：`TODO`、`TBD`、`请填写`、`待补充`、`需要补充说明`（大小写不敏感）；
- 命中时返回所在章节与最多 160 字符的片段；
- `待核实` 不再作为占位错误处理，由版本检查单独提示。

### 5.3 来源

- 官方来源只统计合法的 HTTPS 链接，并按规范化 URL 去重；
- 历史 HTTP 来源保留，但 `source-format` 标记为不通过，并提示“历史记录保留，但新增来源必须使用 HTTPS”；
- 来源可达性仍只代表可访问，不代表官方或技术结论正确。

## 6. 严格 HTTPS 来源

以下入口拒绝 HTTP：

- 手动建档 `sources.docsUrl` / `referenceLinks`；
- 自动规则 `sourceConfig`；
- 新建 / 更新技术节点的 `docsUrl` / `referenceLinks`（服务层）。

规则：

- 仅允许 `https:`；
- 禁止用户名、密码与非 443 端口；
- 参考来源与官方文档地址做规范化去重，同一 URL 不会同时写入两处；
- 历史 HTTP 行不自动改写；更新历史节点时，只有原值未被修改才允许保留，新增或变更 URL 仍必须是 HTTPS；
- 渲染与合并只接受 HTTPS；已有历史 HTTP 参考资料不会因初始化被删除。

URL 可达性检查沿用既有 SSRF 防护：DNS 全地址校验、私网 / 环回 / 元数据 / NAT64 / 6to4 / Teredo / 文档保留段阻断、DNS pinning、重定向再校验、8 秒超时、256 KB 上限与并发限制。

## 7. UI

- 预览显示有效期，执行携带 `previewId`；409 时自动清空旧预览并提示重新预览。
- 预览计数增加“关联并初始化”。
- `link_existing` 下可勾选“关联时初始化空文档”。
- 新建知识支持 500 字符摘要。
- 自动规则支持编辑：完整回填名称、触发方式、模板、筛选、目标领域、父节点、节点类型、关联策略、初始化选项、来源；保存后刷新列表，可取消编辑。
- 技术节点“技术关系”面板增加独立主题人工确认、原因填写与取消确认。
- 文档体检展示占位提示的章节与片段。

## 8. 测试与构建结果

实际执行：

```text
npm run test
Test Files  15 passed (15)
Tests       189 passed (189)

npm run build
✓ built in 478ms
（仅保留既有的大 chunk 警告）

npm run build:server
tsc -p tsconfig.server.json
（无输出，成功）

npx tsc --noEmit
（无输出，成功）

git diff --check
（无输出）
```

以临时 `DATA_DIR` 启动 API 的人工冒烟结果：

- `POST /tech/knowledge-build/preview` 返回 `previewId`、`previewHash`、`expiresAt` 与逐项结果；
- 首次执行成功创建草稿节点；
- 同一 `previewId` 再次执行返回 409「该预览已经执行」；
- HTTP `docsUrl` 预览返回 400，错误为「官方文档地址必须使用 HTTPS」。

新增覆盖：

- 预览返回并持久化 `previewId`、候选哈希、快照与有效期；
- 软件版本变化后执行返回 409，且预览未被消费；
- 目标文档在预览后被修改返回 409，正文保持不变；
- 请求参数与预览不一致、过期预览返回 409；
- 同一预览只能执行一次；
- `link_existing` 保留已有正文；
- 空节点只关联、不初始化；
- `link_and_initialize` 关联并初始化；
- 关联重复执行不产生重复行；
- 预览后文档变化时不留下关联；
- HTTP 手动来源、规则来源与技术节点来源被拒绝；
- 新来源去重，历史 HTTP 来源保留并被 Linter 标记；
- 新建摘要写入 `summary`，`description` 为空；
- 规则完整回填更新与 HTTP 来源拒绝；
- 占位提示忽略模板注释与固定提示，并返回章节和片段；
- 无关联时正文“独立”关键词不通过，人工确认后通过；
- 已有技术关系通过。

## 9. 明确未做

- 不增加 AI 文档生成；
- 不增加知识爬虫；
- 不增加自动技术关联推断；
- 不自动修改 `complete` / `draft` 等文档状态；
- 不批量重写既有知识文档；
- 不修改 Kubernetes 核心知识内容；
- 不引入通用工作流引擎；
- 不默认对所有软件启用自动建档；
- 不自动把历史 HTTP 来源改写为 HTTPS。

## 10. 限制

- 预览快照绑定的是执行前可观察的数据；执行期间仍可能出现单条记录级并发，但逐项事务与“不覆盖正文”条件保证不会改写已有文档。
- 链接可达性、来源官方性与技术正确性仍需人工核实，Linter 与 URL 检查不构成“已验证”。
- 自动规则只影响之后的创建事件，编辑规则不回填历史节点或历史文档。
