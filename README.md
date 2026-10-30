# Opsite · 个人运维情报工作台

单用户、本地优先的软件情报站。把关注软件的版本发布、生命周期、安全漏洞和 CISA KEV 实际利用信息收敛到一份软件清单里，首页只呈现需要处理的高信噪比信号。

内置统一事件中心：同一信号按去重键合并为一条主事件，首次发现时间与上游发布时间分开保存，并可按软件、类型、优先级、处置状态、未读和时间范围筛选。P3 增加统一关注与通知：关注软件、雷达条目、发现候选或单条公告后，站内通知先落库，邮件由独立队列按实时或每日摘要发送。P4 增加运行中心：数据源注册表、采集任务与真实执行记录，健康状态和数据新鲜度分开计算。

- 前端：React 19 + TypeScript + Vite + Tailwind CSS 4
- 后端：Express 5 + better-sqlite3 + zod + node-cron + nodemailer
- 数据：SQLite（`data/opsite.db`，WAL 模式）
- 通知：站内通知优先落库，邮件异步发送；SMTP 密码加密存储
- 界面：流式根字号 + 全 rem 字号，桌面、平板和手机共用一套布局
- 单用户，无登录；外部数据全部经后端适配器采集，API 凭据不会下发到浏览器

## 快速开始

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
npm run dev
```

打开 http://localhost:5173 。API 默认运行在 http://localhost:8787 。

首次启动是空库，不包含任何示例情报。添加第一个软件后：

1. 选择内置目录或填写自定义软件名称；
2. 填写当前使用版本（用于漏洞影响判断）；
3. 按需启用 endoflife.date、GitHub Releases、GitHub Advisory、NVD、CISA KEV 数据源；
4. 保存后自动触发该软件的首次同步，其他软件不受影响。

## 界面与自适应

- 根字号使用 `html { font-size: clamp(100%, calc(85% + 0.3vw), 112.5%); }`：小屏保持用户浏览器的基准字号，宽屏最多放大到 18px，不会把字缩到难以阅读。
- 组件字号全部使用 `rem`，因此浏览器缩放、系统字体大小和根字号变化会一起生效；布局尺寸也以 `rem` 为主。
- 页面在 1180px、820px、620px 三档断点重排：双栏收窄、次要表格列隐藏、筛选与设置改为单列，不维护单独的移动端页面。
- 支持键盘焦点样式与 `prefers-reduced-motion`；动画只用于页面进入和状态反馈，不承担信息表达。

## 生产运行

```bash
npm run build
npm start
```

`npm start` 同时提供 API 和 `dist/client` 静态页面，默认 http://localhost:8787 。若修改了 `GITHUB_TOKEN` / `NVD_API_KEY` / `PORT` 等环境变量，需重启 API 进程。

## Docker 部署

```bash
cp .env.example .env       # 可选：填写 GITHUB_TOKEN、NVD_API_KEY 等
docker compose up -d --build
```

打开 http://127.0.0.1:8787 。SQLite 数据保存在命名卷 `opsite-data`（容器内 `/app/data`），重建容器不会丢失。

镜像采用三阶段构建以控制体积：

- `prod-deps`：仅安装生产依赖，并验证 `better-sqlite3` 的 musl 预编译二进制可用；
- `build`：安装完整依赖，编译服务端 TypeScript 并构建前端；
- `runtime`：基于 `node:22-alpine`，只包含生产 `node_modules`、编译后的服务端 JS、前端静态资源和 `package.json`，不包含源码、TypeScript、Vite 或构建工具。

运行阶段以非 root 用户 `node` 启动，根文件系统只读（`read_only: true`），仅数据卷可写。默认只监听宿主机 `127.0.0.1`；需要局域网访问时，把 compose 中的 ports 改为 `"${OPSITE_PORT:-8787}:8787"`。可用 `OPSITE_PORT` 修改宿主机端口，通过 `.env` 传入的变量会被 compose 自动替换。

```bash
docker compose logs -f          # 查看日志
docker compose down             # 停止，保留数据卷
docker compose down -v          # 停止并删除数据卷（不可恢复）
docker build --build-arg NODE_VERSION=22 -t opsite .
```

`.env`、`data/`、`node_modules/` 已通过 `.dockerignore` 排除，数据库和令牌不会进入镜像。SMTP 密码的默认密钥位于数据卷内的 `data/.secret`，会随命名卷保留；若改用 `OPSITE_SECRET`，请在 `.env` 中长期保留同一个值，否则已保存的 SMTP 密码需要重新填写。

## 环境变量

API 启动时会自动读取项目根目录的 `.env`（文件不存在则跳过），无需额外安装 dotenv。也可以直接通过进程环境变量传入，进程环境变量优先。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PORT` | 否 | API / 生产页面端口，默认 `8787` |
| `HOST` | 否 | 监听地址，默认 `127.0.0.1`；局域网访问设为 `0.0.0.0` |
| `GITHUB_TOKEN` | 否 | 提高 GitHub Releases / Advisory 速率上限 |
| `NVD_API_KEY` | 否 | 将 NVD 请求间隔从约 6.3 秒缩短到约 0.7 秒 |
| `DISABLE_SCHEDULER` | 否 | `true` 时关闭软件同步与技术发现定时任务；邮件队列独立运行，手动同步与采集仍可用 |
| `SYNC_CRON` | 否 | 初始采集周期，默认 `0 */6 * * *`；也可在设置页修改 |
| `DISCOVERY_ENABLED` | 否 | `false` 时仅关闭每日技术发现，不影响软件同步；默认启用 |
| `DISCOVERY_CRON` | 否 | 技术发现周期，默认 `0 9 * * *` |
| `DISCOVERY_TIMEZONE` | 否 | 技术发现时区，默认 `Asia/Shanghai` |
| `OPSITE_SECRET` | 否 | 加密 SMTP 密码的应用密钥；留空时自动生成 `data/.secret` |
| `PUBLIC_BASE_URL` | 否 | 邮件内站内链接前缀，例如 `https://opsite.example.com`；默认 `http://127.0.0.1:PORT` |
| `NOTIFICATION_TIMEZONE` | 否 | 免打扰时段与每日摘要使用的时区，默认 `Asia/Shanghai` |
| `DISABLE_EMAIL_QUEUE` | 否 | `true` 时停止后台邮件发送队列；站内通知与待发送记录不受影响 |

`GITHUB_TOKEN` / `NVD_API_KEY` 只从服务端环境变量读取，设置页仅显示“已配置 / 未配置”，不会返回密钥内容。SMTP 密码在设置页保存后由服务端加密，接口只返回“是否已配置”。

## 关注、订阅与通知

### 关注对象

关注对象有四种：`software`（软件）、`radar`（技术雷达条目）、`discovery`（发现候选或发现流）、`advisory`（单条漏洞公告）。可以在软件详情、雷达详情、发现候选、公告抽屉中点击“关注”，也可以在“关注与订阅”页面直接关注技术发现流。

- 关注接口只接受目标类型和内部 ID，由后端从本地数据库解析名称与链接；不接受用户任意指定 URL，避免 SSRF。
- 关注时保存对象名称与链接快照；重新关注会刷新快照。取消关注只删除关注记录，已有通知与历史情报事件全部保留。
- 同一目标重复关注不会产生重复记录。

### 订阅规则

规则分全局默认与单对象覆盖两级。单对象保存规则后形成独立覆盖，可随时恢复全局默认。每条规则独立控制：

- 站内通知开关；
- 邮件通知开关；
- 最低级别：全部 / 重要及以上 / 仅紧急。

默认规则偏保守：只把高风险漏洞与生命周期变化发到站内，邮件全部关闭，版本发布、发现候选与雷达记录默认不通知。

| 事件类型 | 触发条件 | 默认站内 | 默认邮件 |
| --- | --- | --- | --- |
| `high_risk_advisory` | P0 / P1 漏洞，含已确认受影响的 KEV 条目 | 开 | 关 |
| `lifecycle_change` | 进入即将 EOL、已经 EOL 或维护截止日期变化 | 开 | 关 |
| `new_vulnerability` | 新出现的 P2 / P3 漏洞公告 | 关 | 关 |
| `advisory_update` | 上游公告标题、优先级或发布时间变化 | 关 | 关 |
| `new_release` | 关注软件出现新的稳定版本 | 关 | 关 |
| `project_update` | 雷达条目新增评估、试用或采用记录 | 关 | 关 |
| `discovery` | 技术发现流出现新的候选项目 | 关 | 关 |

通知按固定去重键写入：事件创建为 `事件 + 目标`，公告更新还会带上标题、优先级和上游时间的签名，发现候选与雷达记录同样包含来源记录 ID。重复采集、字段刷新或采集时间变化不会重复发送；首次历史回填也不会产生通知洪水。

### 通知中心

- 通知先生成站内记录，再决定是否加入邮件队列。SMTP 不可用、密码错误或邮件关闭都不会阻止站内通知。
- 情报采集、发现与技术雷达写入只在下游 `try/catch` 中调用通知服务；通知服务异常会记录日志，但不会阻塞采集。
- 通知中心支持按未读、级别、事件类型和关键词筛选；打开通知会自动标记已读，也可以一键全部已读。
- 顶部铃铛抽屉与首页通知条只展示最近通知，完整列表在“通知中心”。

### 邮件发送

设置页“通知与邮件”包含邮件开关、收件邮箱、实时/摘要模式、摘要时间、免打扰时段、SMTP 配置、全局规则和最近投递记录。

- **SMTP 密码**：使用 AES-256-GCM 加密后存入 SQLite；密钥来自 `OPSITE_SECRET`，未设置时自动生成 `data/.secret`（权限 `0600`）。接口只返回 `passwordConfigured`，不返回明文，错误信息会用 `***` 覆盖密码片段。
- **实时模式**：符合条件的通知立即进入队列；若当前处于免打扰时段，发送时间顺延到时段结束。
- **摘要模式**：每天在 `digestTime` 合并发送尚未投递的通知，不受免打扰时段影响。
- **队列**：后台每分钟检查一次到期投递。失败按 1 / 5 / 15 / 60 / 180 分钟退避，最多尝试 5 次；超过 10 分钟仍处于 `sending` 的记录会在下一轮恢复为 `pending`。
- **跳过**：邮件关闭、收件邮箱为空或不合法、SMTP 未配置/停用，都会写入 `skipped` 投递记录并说明原因，不会静默丢弃。
- **测试邮件**：保存 SMTP 后可向当前收件邮箱发送测试邮件；失败信息同样经过密码脱敏。
- **内容安全**：邮件正文对外部标题、摘要和来源名称做 HTML 转义；外部链接只允许 `http` / `https`，其他协议不生成链接。
- 邮件发送与通知生成完全解耦。`DISABLE_EMAIL_QUEUE=true` 只停止发送队列，不影响采集、站内通知或投递记录。

### 通知 API

所有接口以 `/api` 为前缀。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/follows?type=&q=` | 列出关注对象，可按类型和关键词过滤 |
| `GET` | `/follows/status?targetType=&targetId=` | 查询单个目标是否已关注 |
| `POST` | `/follows` | 关注目标，重复关注返回已有记录 |
| `DELETE` | `/follows/:id` | 取消关注，保留历史通知 |
| `PATCH` | `/follows/:id/rules` | 保存单对象规则覆盖 |
| `DELETE` | `/follows/:id/rules` | 恢复全局默认规则 |
| `GET` / `PATCH` | `/notification-rules` | 读取 / 保存全局规则 |
| `GET` | `/notifications?unread=&severity=&ruleType=&limit=&offset=` | 通知列表与未读数 |
| `PATCH` | `/notifications/:id` | 标记单条已读 |
| `POST` | `/notifications/read-all` | 全部标记已读 |
| `GET` | `/notifications/deliveries?status=&limit=` | 邮件投递记录 |
| `POST` | `/notifications/deliveries/:id/retry` | 手动重试投递 |
| `GET` / `PATCH` | `/notifications/smtp` | 读取 / 保存 SMTP 配置（不含密码） |
| `POST` | `/notifications/smtp/test` | 发送测试邮件 |

## 数据源

| 数据源 | 采集内容 | 备注 |
| --- | --- | --- |
| endoflife.date | 生命周期、EOL、周期最新补丁 | 只使用来源提供的日期，不根据发布时间推断 EOL |
| GitHub Releases | 稳定版与预发布版本、发布说明、链接 | 首次同步只为最新稳定版创建事件，避免历史版本刷屏 |
| GitHub Advisory | GHSA / CVE、严重程度、受影响范围、修复版本 | 优先使用 CVE 编号，与 NVD 合并为同一主记录 |
| NVD | CVE 详情、CVSS、配置范围 | 使用关键词搜索，带队列限速 |
| CISA KEV | 实际利用标记与处置截止日期 | 命中后事件会标记 KEV 并更新优先级 |
| upstream_advisory | 预留 | 目前会明确报“尚未配置”，不会伪造数据 |

软件身份由稳定的 `software_id` 维护，漏洞关联基于软件记录和数据源标识，不使用显示名称模糊匹配。

## 判断规则

- 版本比较支持 semver 风格、预发布后缀和 `release-v1.2.3` 前缀；生命周期周期按段边界匹配（`1.32.4` 属于 `1.32`，不属于 `1.3`）。
- 漏洞影响只有三种结果：`affected`、`not_affected`、`insufficient`。任一版本范围无法解析时，结果为 `insufficient`，不会猜测“不受影响”。
- 优先级综合严重程度、KEV、本地版本影响；P0 = KEV + 当前版本确认受影响。
- 用户处置状态保存在独立的 `advisory_user_state`，上游公告更新不会覆盖它。
- 多来源生命周期冲突会保留并标记“待核实”，不会静默选一个覆盖另一个。
- 首次发现时间（`first_seen_at`）与上游发布时间（`upstream_published_at`）分开存储。

## 技术雷达

- 条目状态为 `待评估 / 试用中 / 已采用 / 稍后关注 / 已忽略`，新建默认“待评估”；状态变更由用户操作触发，并单独记录一条状态变更记录。
- 每个条目可以持续添加评估、试用、采用和备注记录，以及可选的下一步行动；列表卡片展示最近一条评估摘要和下一步。
- 支持类型、状态、关键词组合筛选，以及按最近更新、最近加入、最近评估排序；归档条目默认隐藏，可在“归档”视图查看和恢复。
- 编辑在原条目上完成；归档保留状态与全部记录；永久删除会级联删除该条目的评估记录，并在确认框中明确提示。
- 内置软件目录补充了 RocketMQ、Flannel、Calico、Java、Tomcat、OpenSSH、Nacos、Dubbo、NFS 和 Docker Compose。

## 技术发现

“技术发现”是与技术雷达独立的候选池：系统从可信来源发现候选技术，由用户决定是否加入雷达。

- **GitHub**：使用官方 Search API（`/search/repositories`）按少量可检查的规则查询，默认 6 条规则（Kubernetes、可观测性、DevOps、SRE、IaC、Service Mesh）。规则只覆盖明确写出的查询条件，不代表整个 GitHub。结果按最近更新排序，跳过归档仓库和 fork。
- **CNCF**：读取 CNCF 官方 Landscape 仓库的 `landscape.yml`（经 GitHub Contents API，`Accept: application/vnd.github.raw+json`），按 `project` 字段筛选 graduated / incubating 项目。未提供星标、语言、许可证等字段时保持“未知”，不填 0。
- 默认每天 09:00（`Asia/Shanghai`）自动采集一次，也可在页面点击“立即采集”。同一时间只允许一个采集任务运行；单条规则失败不会中断其他规则，单个来源失败不会清空已有候选。
- 候选按来源稳定 ID 去重；不同来源指向同一规范化项目 URL 时合并为一条候选，并保留多条来源引用。
- 候选状态为 `待评估 / 已收录 / 已忽略`。自动采集只更新外部来源字段，不会覆盖用户状态、备注、首次发现时间或已关联的雷达条目。
- 加入雷达前会按规范化 URL 检查雷达中是否已有同一项目；发现重复时只提供“关联已有条目”，不会自动创建重复记录。删除雷达条目后，关联候选会回到“待评估”。

采集结果只写入 `discovery_*` 表，不会克隆、安装、运行或部署任何被发现的仓库。

### 来源与限制

| 来源 | 接口 | 限制 |
| --- | --- | --- |
| GitHub | `api.github.com/search/repositories` | 未配置 `GITHUB_TOKEN` 时匿名搜索约 10 次/分钟，规则较多时可能返回 403，本次运行标记为“部分成功” |
| CNCF | `api.github.com/repos/cncf/landscape/contents/landscape.yml` | 通过 GitHub Contents API 读取官方文件；同样受 GitHub 速率限制影响 |

`GITHUB_TOKEN` 只由服务端读取，不返回前端、不写入日志。页面展示的规则查询串即实际采集范围，不声称覆盖全部 GitHub。

## 运行中心

运行中心是一级页面，包含 **运行概览**、**数据源管理** 和 **采集任务** 三个入口，以及数据源、任务和执行记录的详情页。页面中的数字全部来自 SQLite 中的 `data_sources`、`collection_tasks`、`collection_runs`、`source_health_checks`、`source_quota_records` 和 `operation_alerts`，不使用模拟数据。

### 注册的数据源

服务启动时按当前代码中真实存在的适配器写入注册表；尚未接入 API 的 `upstream_advisory` 以停用状态展示。

| 数据源 | 类型 | 健康检查 | 新鲜度窗口（间隔 + 宽限） |
| --- | --- | --- | --- |
| endoflife.date | 生命周期 | 请求一次已知产品的 API | 168h + 48h |
| GitHub Releases | 版本发布 | `GET /rate_limit`，记录真实 core 配额 | 24h + 12h |
| GitHub Advisory | 安全漏洞 | 同上 | 24h + 12h |
| NVD CVE | 安全漏洞 | 请求 `resultsPerPage=1` | 24h + 12h |
| CISA KEV | 安全漏洞 | 请求官方 KEV JSON | 24h + 12h |
| upstream_advisory | 安全漏洞 | 不支持探测，显示“未知” | 不启用 |
| GitHub 技术发现 | 技术发现 | `GET /rate_limit` | 24h + 12h |
| CNCF Landscape | 技术发现 | GitHub Contents API（含配额响应头） | 168h + 48h |

健康状态（`ok / error / rate_limited / unknown / disabled`）来自最近一次健康检查或采集结果，限流与普通采集异常分开记录。只有上游确实提供配额时才展示配额：GitHub 使用 `/rate_limit` 的真实 core 配额，NVD、CISA、endoflife 等不提供配额查询的来源显示“未提供配额信息”，不会补 0。

### 数据新鲜度

- `last_data_updated_at` 只在采集成功且数据内容实际发生变化时前移：新增记录、字段更新或新事件都算变化；返回内容与库中一致时只增加“跳过”计数，不刷新新鲜度。
- 采集失败、超时、部分失败不会刷新该时间；停用数据源也不会清空历史。
- 状态按 `fresh → expiring → expired` 计算，从未采到内容的来源为 `unknown`；`unknown` 不会被判定为异常。
- 已有数据库升级到 P4 时不会伪造历史更新时间：旧记录没有保存“内容变化时间”，因此新鲜度保持 `unknown`，直到下一次真实内容变化。这是有意的保守处理。

### 采集任务

- 8 个任务与数据源一一对应，每个任务有独立 cron、启用状态和超时（按任务配置为 180–600 秒）。
- 全局“采集间隔”只更新尚未单独修改过 cron 的任务；在任务详情保存过 cron 后，该任务保持自定义调度。暂停只停止后续定时触发，不影响已开始的执行，也不删除历史记录。
- 同一时间只允许一个采集任务执行，重复触发返回 409。手动执行不修改定时规则，执行记录会保存触发来源（`schedule / manual / retry`）。
- 执行超时会标记为 `timeout`；服务重启时遗留的 `running` 记录会被识别为中断并标记异常终止。失败或超时的执行可以手动重试，重试会创建新记录。
- 失败、超时、限流和数据过期会生成带去重键的问题记录，恢复后自动关闭；同一问题再次出现会重新打开。P3 的通知规则可以订阅这些运行事件。

### 运行中心 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/operations/overview` | 概览统计、调度器状态、数据源、最近执行和未恢复问题 |
| `GET` | `/operations/issues?kind=` | 未恢复问题列表，可按类型筛选 |
| `GET` | `/operations/freshness` | 各数据源新鲜度汇总 |
| `GET` | `/sources?type=&status=&q=` | 数据源列表 |
| `GET` / `PATCH` | `/sources/:id` | 数据源详情 / 更新启用、新鲜度窗口 |
| `GET` | `/sources/:id/health` | 健康检查与配额历史 |
| `GET` | `/sources/:id/runs?status=&limit=&offset=` | 数据源执行记录 |
| `POST` | `/sources/:id/check` | 立即执行健康检查 |
| `POST` | `/sources/:id/collect` | 立即触发该数据源的采集任务 |
| `GET` | `/collection-tasks` | 任务列表 |
| `GET` / `PATCH` | `/collection-tasks/:id` | 任务详情 / 更新启用、cron、超时 |
| `GET` | `/collection-tasks/:id/runs?status=&limit=&offset=` | 任务执行历史 |
| `POST` | `/collection-tasks/:id/run` | 手动执行（写入手动触发来源） |
| `GET` | `/collection-runs?taskId=&sourceId=&status=&limit=&offset=` | 执行记录列表 |
| `GET` | `/collection-runs/:id` | 执行详情与底层数据源作业明细 |
| `POST` | `/collection-runs/:id/retry` | 重试失败或超时的执行 |

## 备份与恢复

设置页“数据与备份”可以下载 SQLite 快照（`VACUUM INTO`，生成的副本位于 `data/backups/`）。

手动恢复：

```bash
# 先停止服务，避免写入竞争
copy data\opsite.db data\opsite.before-restore.db
copy data\backups\opsite-YYYY-MM-DD....db data\opsite.db
npm start
```

`data/` 已在 `.gitignore` 中，不会被提交。

数据库备份不包含 `data/.secret`。恢复后如果要继续解密已有的 SMTP 密码，请保留原来的 `OPSITE_SECRET` 或同时恢复 `data/.secret`；否则在设置页重新填写 SMTP 密码即可。

## 测试

```bash
npm test          # 版本/范围/影响判断、EOL、雷达、技术发现，关注规则、通知去重、邮件队列、时区与退避，以及运行中心
npm run build     # TypeScript 类型检查 + 前端生产构建
npm run build:server  # 服务端编译
```

## 当前边界

- 没有多用户、权限、角色、同步冲突合并等企业能力；关注、通知和设置都属于当前本机实例。
- 邮件依赖用户自己的 SMTP 服务。Opsite 不内置邮件网关，也不会代为投递；未配置 SMTP 时站内通知照常工作，邮件记录会标记为已跳过。
- 后台邮件队列依赖 API 进程常驻。服务停止期间的待发送邮件会保留，重启后继续尝试，不会立即补发全部历史通知。
- 没有浏览器 Web Push、桌面通知或移动端推送；通知只在站内展示，邮件是唯一的外部提醒渠道。
- 上游公告适配器（`upstream_advisory`）尚未接入具体厂商 API，因此在运行中心保持停用。
- 采集失败时保留上一次成功数据，并将数据源标记为异常/过期；首页会继续展示旧数据并提示来源问题。
- 运行中心不提供任意 URL 导入或自定义请求；所有采集只能通过仓库内的固定适配器执行，避免 SSRF。数据源详情只允许调整启用状态和新鲜度窗口，不能修改适配器代码或上游地址。
- 旧数据库升级后，运行中心的数据新鲜度在首次真实内容变化前显示为 `unknown`，不会用历史采集时间回填成“新鲜”。
