# Opsite · 个人运维情报工作台

单用户、本地优先的软件情报站。把关注软件的版本发布、生命周期、安全漏洞和 CISA KEV 实际利用信息收敛到一份软件清单里，首页只呈现需要处理的高信噪比信号。

内置统一事件中心：同一信号按去重键合并为一条主事件，首次发现时间与上游发布时间分开保存，并可按软件、类型、优先级、处置状态、未读和时间范围筛选。

- 前端：React 19 + TypeScript + Vite + Tailwind CSS 4
- 后端：Express 5 + better-sqlite3 + zod + node-cron
- 数据：SQLite（`data/opsite.db`，WAL 模式）
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

## 生产运行

```bash
npm run build
npm start
```

`npm start` 同时提供 API 和 `dist/client` 静态页面，默认 http://localhost:8787 。若修改了 `GITHUB_TOKEN` / `NVD_API_KEY` / `PORT` 等环境变量，需重启 API 进程。

## 环境变量

API 启动时会自动读取项目根目录的 `.env`（文件不存在则跳过），无需额外安装 dotenv。也可以直接通过进程环境变量传入，进程环境变量优先。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PORT` | 否 | API / 生产页面端口，默认 `8787` |
| `HOST` | 否 | 监听地址，默认 `127.0.0.1`；局域网访问设为 `0.0.0.0` |
| `GITHUB_TOKEN` | 否 | 提高 GitHub Releases / Advisory 速率上限 |
| `NVD_API_KEY` | 否 | 将 NVD 请求间隔从约 6.3 秒缩短到约 0.7 秒 |
| `DISABLE_SCHEDULER` | 否 | `true` 时关闭全部内置定时任务，手动同步与手动采集仍可用 |
| `SYNC_CRON` | 否 | 初始采集周期，默认 `0 */6 * * *`；也可在设置页修改 |
| `DISCOVERY_ENABLED` | 否 | `false` 时仅关闭每日技术发现，不影响软件同步；默认启用 |
| `DISCOVERY_CRON` | 否 | 技术发现周期，默认 `0 9 * * *` |
| `DISCOVERY_TIMEZONE` | 否 | 技术发现时区，默认 `Asia/Shanghai` |

凭据只从服务端环境变量读取。设置页仅显示“已配置 / 未配置”，不会返回密钥内容。

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

## 测试

```bash
npm test          # 版本比较、范围匹配、影响判断、优先级、EOL 判定、雷达迁移与记录、技术发现采集/去重/收录
npm run build     # TypeScript 类型检查 + 前端生产构建
```

## 当前边界

- 邮件通知属于 P1：邮件地址与通知偏好可以保存，但 SMTP 发送尚未接入，界面会明确提示，不会伪装成已发送。
- 上游公告适配器（`upstream_advisory`）尚未接入具体厂商 API。
- 没有多用户、权限、同步冲突合并等企业能力。
- 采集失败时保留上一次成功数据，并将数据源标记为异常/过期；首页会继续展示旧数据并提示来源问题。
