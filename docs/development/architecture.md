# 系统架构与模块边界

本文说明 Opsite `0.1.0` 的运行时结构、代码分层、主要数据流和扩展点。文档以当前代码为准，不描述尚未实现的能力。

## 1. 总体结构

Opsite 是一个单进程、单用户的本地 Web 应用：

```text
浏览器
  │  HTTP /api/* 与静态资源
  ▼
Express 5（server/index.ts）
  ├── /api 路由（server/routes.ts）
  ├── 静态前端（dist/client）
  └── SPA fallback（index.html）
        │
        ├── 服务层（server/services/）
        ├── 采集适配器（server/adapters/）
        ├── SQLite / WAL（data/opsite.db）
        └── 调度器（node-cron）

外部来源：endoflife.date、GitHub、NVD、CISA KEV、CNCF Landscape
外部出口：用户配置的 SMTP 服务器
```

- 前端是 React 单页应用，构建产物默认在 `dist/client`。
- 后端是 Express 5 应用，编译产物默认在 `dist-server`。
- 前后端共享 TypeScript 类型，位于 `shared/types.ts`。
- SQLite 由 `better-sqlite3` 同步访问，不引入独立数据库服务。
- 定时任务和 Web 服务在同一个 Node 进程内运行。
- 没有登录、会话、RBAC 或多租户隔离；所有能访问端口的客户端都被视为同一用户。

## 2. 目录与职责

```text
server/
├── index.ts              # 进程入口、Express 中间件、静态资源、启动与退出
├── env.ts                # 读取项目根目录 .env
├── db.ts                 # SQLite 连接、建表、增量列迁移、基础种子数据
├── routes.ts             # 全部 HTTP 路由、Zod 校验、错误映射
├── catalog.ts            # 内置软件目录
├── adapters/             # 外部数据源适配器
├── lib/                  # HTTP、版本、严重度、密钥等通用逻辑
└── services/             # 业务逻辑、采集编排、调度、通知、技术地图

shared/
└── types.ts              # 前后端共享的请求、响应与枚举类型

src/
├── App.tsx               # React Router 路由表
├── pages/                # 页面级组件
├── components/           # 可复用 UI 与业务组件
├── contexts/             # 全局应用数据、Toast
├── lib/                  # API 客户端、格式化、标签、钩子
└── styles*.css           # Tailwind 入口与页面样式

docs/                     # 用户手册、开发文档、历史验收记录
data/                     # 运行时数据目录，不提交版本控制
```

## 3. 启动与关闭

启动顺序：

1. `server/index.ts` 导入 `server/env.ts`，读取项目根目录的 `.env`；已存在的进程环境变量优先。
2. 创建 Express 应用，注册 JSON 解析（`1mb` 上限）、安全响应头和 `/api` 路由。
3. 导入 `server/db.ts`：创建数据目录、打开 SQLite、设置 WAL、外键和忙等待，然后建表、补齐增量列、写入基础种子数据。
4. 注册静态资源目录 `CLIENT_DIR`（默认 `dist/client`）和 SPA fallback。
5. 监听 `PORT`（默认 `8787`）和 `HOST`（默认 `127.0.0.1`）。
6. 监听成功后执行 `seedTechnologyTemplates()`，再执行 `startScheduler()`。
7. 收到 `SIGINT` / `SIGTERM` 时停止调度器、关闭 HTTP 服务、关闭 SQLite。

`/api/*` 未匹配路由返回 JSON 404；非 API 的 GET 请求回退到 `index.html`。

## 4. 代码分层

### 4.1 路由层

`server/routes.ts` 负责：

- 解析路径、查询参数和请求体；
- 使用 Zod 校验输入；
- 调用服务层；
- 把业务错误映射为 JSON 错误和 HTTP 状态码；
- 触发调度器重排或后台任务。

路由层不直接实现采集、排序或数据合并。少量简单查询（如发布列表、生命周期列表）直接在路由内使用 `db` 查询。

### 4.2 服务层

| 服务 | 职责 |
| --- | --- |
| `software.ts` | 软件增删改查、目录项、软件摘要与详情 |
| `sync.ts` | 单个/全部软件的采集编排，写 `sync_job` |
| `advisories.ts` | 漏洞合并、版本影响、优先级、处置状态 |
| `events.ts` | 情报事件去重、读取与处置状态 |
| `dashboard.ts` | 值班台指标与最近事件 |
| `notifications.ts` | 关注对象、订阅规则、通知生成、投递队列 |
| `smtp.ts` | SMTP 配置、密码加解密、邮件发送 |
| `notes.ts` | 技术雷达、雷达记录、个人笔记 |
| `discovery.ts` | 技术发现候选、导入雷达、忽略/恢复、采集任务 |
| `operations.ts` | 数据源检查、采集执行、健康与新鲜度、问题列表 |
| `operations-store.ts` | 运行中心持久化查询 |
| `scheduler.ts` | 注册 cron、重排任务、恢复中断执行、邮件队列 tick |
| `tech.ts` | 技术领域、节点、关系、视图、文档、验证、体检 |
| `tech-seed.ts` | 内置技术模板与首次种子 |
| `tech-content*.ts` | 内置技术知识内容与文档种子 |
| `tech-knowledge-build.ts` | 知识建档预览、执行、自动规则、待处理项、文档体检 |
| `tech-knowledge-templates.ts` | 5 套建档模板与文档渲染 |
| `tech-knowledge-urlcheck.ts` | HTTPS 来源检查与 SSRF 防护 |
| `settings.ts` | 设置读写与公开字段 |
| `search.ts` | 全局搜索聚合 |

### 4.3 适配器层

适配器把外部 API 转换成统一结构，服务层不依赖各来源的原始字段。

| 适配器 | 来源 | 主要输出 |
| --- | --- | --- |
| `endoflife.ts` | endoflife.date | 生命周期周期、EOL、支持状态 |
| `github.ts` | GitHub Releases / Advisories | 版本发布、安全公告 |
| `nvd.ts` | NVD CVE | CVE、CVSS、受影响范围 |
| `cisa.ts` | CISA KEV | 已被利用漏洞清单 |
| `discovery.ts` | GitHub 搜索 / CNCF Landscape | 候选项目及来源信息 |

统一接口见 `server/adapters/types.ts`。网络请求集中在 `server/lib/http.ts`，包含超时、重试和错误封装。

### 4.4 数据层

- `server/db.ts` 在模块加载时执行建表 SQL。
- 表结构使用 `CREATE TABLE IF NOT EXISTS`。
- 旧数据库通过 `ensureColumn()` 增加新列，不删除或重命名已有列。
- 基础数据使用 `ON CONFLICT DO NOTHING` 幂等写入。
- 时间统一保存为 ISO 8601 UTC 字符串。
- 结构化字段（别名、标签、配置、图数据）以 JSON 文本保存。

详见[数据库设计](database.md)。

## 5. 前端结构

- `src/App.tsx` 定义全部页面路由。
- `src/components/Layout.tsx` 提供侧边栏、顶栏、搜索和通知抽屉。
- `src/contexts/AppDataContext.tsx` 维护跨页面共享的软件、通知和搜索数据。
- `src/lib/api.ts` 封装 `fetch('/api...')`，统一解析 JSON 和错误。
- `src/pages/` 是页面级数据加载与交互。
- `src/lib/format.ts`、`radar.ts`、`discovery.ts`、`tech.ts`、`operations.ts` 维护界面标签和状态映射。
- Markdown 使用 `react-markdown`、`remark-gfm`、`rehype-sanitize` 渲染；技术文档编辑器基于 CodeMirror。

开发模式下：

- Vite 在 `5173` 提供前端；
- `/api` 代理到 `http://127.0.0.1:8787`；
- `npm run dev` 同时启动 API（`tsx watch`）和 Vite。

生产模式下，Express 直接提供 `dist/client`，不存在独立前端服务器。

## 6. 主要数据流

### 6.1 软件采集

```text
cron / 手动触发
  → collection_tasks + collection_runs（运行中心）
  → syncSoftware()
  → 对应 adapter（endoflife / GitHub / NVD / CISA）
  → release_record / lifecycle_record / security_advisory
  → 版本影响、优先级、KEV 匹配
  → intelligence_event（去重）
  → notification + notification_delivery
  → 运行记录、数据源健康、新鲜度
```

一次软件同步可以写入多个数据源的结果。单个来源失败不会清空已有数据，失败信息写入 `sync_job` 和运行中心。

### 6.2 技术发现

```text
cron / 手动采集
  → discovery_job
  → GitHub 搜索规则或 CNCF Landscape
  → 按规范化项目 URL 合并 discovery_candidate
  → 更新来源字段，不覆盖已收录/已忽略决定
  → 用户导入 → radar_item（待评估）
```

### 6.3 通知

```text
采集或事件变化
  → 匹配关注对象与订阅规则
  → notification（站内，去重键唯一）
  → 需要邮件时创建 notification_delivery
  → 每分钟邮件队列 tick
  → SMTP 发送，记录尝试次数和错误
```

邮件队列独立于采集调度。`DISABLE_SCHEDULER=true` 不会停止邮件投递；`DISABLE_EMAIL_QUEUE=true` 才会停止队列 tick。

### 6.4 知识建档

```text
手动范围 / 自动规则
  → 候选解析与安全判定
  → preview（服务端快照，10 分钟、单次使用）
  → 用户确认
  → execute（校验预览哈希与快照）
  → 新建节点 / 关联软件 / 初始化空文档
  → 规则无法决定时写 pending
```

建档是确定性的：只使用固定模板与结构化字段，不调用 AI，不覆盖已有正文，不自动设置“已完善”。

## 7. 调度与并发

- 所有采集任务通过 `node-cron` 注册，任务和 cron 存于 `collection_tasks`。
- 软件采集与技术发现使用同一套任务表，通过数据源类型区分。
- 通过运行中心启动的采集任务由进程内 `activeRun` 串行化，同一时间只允许一个任务运行。
- 技术发现另有进程内运行标志，防止手动“立即采集”与定时发现任务重叠。
- 服务重启时，未结束的采集执行会被标记为 `interrupted`。
- SQLite 使用 WAL 和 `busy_timeout=5000`，适合单进程读写；不支持多实例同时写同一个数据库。

## 8. 安全边界

- 默认只监听回环地址；Docker 宿主机端口也只绑定 `127.0.0.1`。
- 没有认证、授权、CSRF 防护或审计日志，不能直接暴露到公网。
- `/api/backup` 可导出完整数据库，必须视为高敏感接口。
- SMTP 密码使用 AES-256-GCM 加密；密钥来自 `OPSITE_SECRET` 或 `data/.secret`。
- 知识来源检查限制 HTTPS、443 端口、固定 DNS 解析，并阻止私网、回环和云元数据地址。
- Markdown 渲染使用 `rehype-sanitize`；邮件正文对外部字段做 HTML 转义。
- 外部数据可能不准确，界面和文档都不把“可访问”等同于“已核实”。

## 9. 构建产物

| 命令 | 产物 |
| --- | --- |
| `npm run dev` | API + Vite 开发服务器，无构建产物 |
| `npm run build` | `dist/client` 前端静态资源 |
| `npm run build:server` | `dist-server/server` 编译后的服务端 |
| `npm run build:docker` | 同时生成前端和服务端产物 |
| `npm start` | 用 `tsx` 直接运行 TypeScript 服务端 |
| `node dist-server/server/index.js` | 运行编译后的服务端 |

编译后直接运行时，入口位于 `dist-server/server`，默认路径基准是 `dist-server`；需要设置 `DATA_DIR=data` 和 `CLIENT_DIR=dist/client` 才能使用仓库内的数据目录和前端产物。

Docker 镜像只包含生产依赖、`dist/client`、`dist-server/server`、`package.json` 和许可证文件，以非 root 用户运行，根文件系统只读，数据写入 `/app/data`。

## 10. 扩展点与约束

新增数据源时：

1. 在 `server/adapters/` 实现适配器；
2. 在 `server/services/operations-config.ts` 注册数据源和采集任务；
3. 在 `server/adapters/types.ts` 对齐输出结构；
4. 在同步或发现服务中接入；
5. 更新运行中心标签和文档。

新增页面时：

1. 在 `src/pages/` 创建页面；
2. 在 `src/App.tsx` 注册路由；
3. 在 `src/components/Sidebar.tsx` 增加导航；
4. 复用 `src/lib/api.ts` 和共享类型；
5. 遵守单用户、本地优先和无登录的现有边界。

不应在当前架构中假设：

- 多实例部署；
- 多用户并发写；
- 独立任务队列或消息中间件；
- 数据库迁移框架；
- 前后端分离部署。

这些能力当前都不存在，引入时需要单独设计。
