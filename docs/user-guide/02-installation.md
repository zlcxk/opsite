# 2. 安装与首次启动

本章覆盖两种运行方式：Docker Compose（推荐）和本地开发运行。二者使用同一套代码和数据库结构。

## 2.1 运行要求

### Docker 方式

- Docker Engine 或 Docker Desktop
- Docker Compose v2（命令为 `docker compose`）
- 可用端口：默认 `8787`

### 本地方式

- Node.js 22.12 LTS 或 24 LTS
- npm 10 或更高版本

> Vitest 当前不支持 Node 23。使用 Node 23 时安装依赖会出现 `EBADENGINE` 警告，测试也可能无法正常运行。

## 2.2 使用 Docker Compose 启动（推荐）

```bash
git clone https://github.com/zlcxk/opsite.git
cd opsite
cp .env.example .env
docker compose up -d --build
```

启动后打开：

```text
http://localhost:8787
```

查看容器状态和日志：

```bash
docker compose ps
docker compose logs -f
```

停止服务但保留数据：

```bash
docker compose down
```

停止并删除数据卷（**不可恢复**）：

```bash
docker compose down -v
```

### 默认容器行为

| 项目 | 默认值 |
| --- | --- |
| 宿主机端口 | `127.0.0.1:8787`，只绑定本机回环地址 |
| 容器内监听 | `0.0.0.0:8787` |
| 数据卷 | 命名卷 `opsite-data`，挂载到 `/app/data` |
| 运行用户 | 非 root 用户 `node` |
| 根文件系统 | 只读，只有数据卷和 `/tmp` 可写 |
| 健康检查 | 每 30 秒请求 `/api/health` |

如需改宿主机端口：

```bash
OPSITE_PORT=8788 docker compose up -d
```

此时访问 `http://localhost:8788`。

> 不要为了“方便访问”把端口改成 `0.0.0.0:8787:8787`。应用没有登录和权限控制。

## 2.3 本地开发运行

```bash
git clone https://github.com/zlcxk/opsite.git
cd opsite
npm ci
cp .env.example .env
npm run dev
```

`npm run dev` 会同时启动两个进程：

- API：`http://127.0.0.1:8787`
- Vite 前端：`http://localhost:5173`

开发时访问 `http://localhost:5173`。Vite 会把 `/api` 请求代理到 API 进程，因此前端不需要单独配置 API 地址。

如果只想运行 API：

```bash
npm run dev:api
```

## 2.4 首次启动会发生什么

首次启动时，服务会自动：

1. 在数据目录创建 SQLite 数据库 `opsite.db`，并启用 WAL 模式。
2. 创建内置数据源和采集任务定义。
3. 写入默认的全局通知订阅规则和技术发现规则。
4. 写入内置技术模板和 Kubernetes、Prometheus 等预置技术内容。

**软件清单初始为空。** 内置技术内容不等于“已经监控了这些软件”，你需要自己添加软件并填写当前使用版本。

数据目录默认是项目根目录下的 `data/`；Docker 中为 `/app/data`。

```text
data/
├── opsite.db
├── opsite.db-wal
├── opsite.db-shm
├── .secret          # 用于加密 SMTP 密码，首次需要时生成
└── backups/         # 通过设置页生成的备份副本
```

`data/` 已被 `.gitignore` 忽略，不要提交数据库、备份或密钥。

## 2.5 推荐的首日配置

1. **添加软件**：进入“软件情报”，点击“添加软件”，填写名称、分类、当前版本、使用状态和仓库地址。
2. **执行同步**：在首页点击“同步全部”，或到“采集任务”手动触发一次执行。
3. **配置采集凭据（可选）**：在 `.env` 中填写 `GITHUB_TOKEN`、`NVD_API_KEY`，提高 API 速率上限。修改后需要重启服务。
4. **检查数据源健康**：打开“运行中心”，确认各数据源状态和最近一次执行结果。
5. **配置通知（可选）**：在“设置”中填写 SMTP，测试邮件；不配置 SMTP 时站内通知仍然可用。
6. **建立备份习惯**：在“设置 → 数据与备份”下载一次数据库快照，确认保存位置。

## 2.6 环境变量

`.env.example` 已包含全部常用变量。主要项如下：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | API 和生产页面端口 |
| `HOST` | `127.0.0.1` | 监听地址；仅明确需要局域网访问时才改为 `0.0.0.0` |
| `DATA_DIR` | 项目内 `data/` | 数据库和密钥目录；Docker 中为 `/app/data` |
| `CLIENT_DIR` | 项目内 `dist/client` | 前端静态资源目录；Docker 中为 `/app/dist/client` |
| `GITHUB_TOKEN` | 空 | GitHub Releases、Advisory、技术发现的速率上限 |
| `NVD_API_KEY` | 空 | NVD 请求间隔 |
| `DISABLE_SCHEDULER` | `false` | `true` 时停止软件同步和技术发现定时任务 |
| `SYNC_CRON` | `0 */6 * * *` | 初始软件同步周期 |
| `DISCOVERY_ENABLED` | `true` | `false` 时只关闭技术发现自动采集 |
| `DISCOVERY_CRON` | `0 9 * * *` | 技术发现采集周期 |
| `DISCOVERY_TIMEZONE` | `Asia/Shanghai` | 技术发现时区 |
| `OPSITE_SECRET` | 空 | 加密 SMTP 密码；留空时自动生成 `data/.secret` |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:<PORT>` | 邮件内站内链接前缀 |
| `NOTIFICATION_TIMEZONE` | `Asia/Shanghai` | 免打扰时段和每日摘要时区 |
| `DISABLE_EMAIL_QUEUE` | `false` | `true` 时停止后台邮件发送队列 |

说明：

- API 启动时读取项目根目录 `.env`；进程环境变量优先于 `.env`。
- `GITHUB_TOKEN`、`NVD_API_KEY` 只从服务端读取，设置页只显示“已配置 / 未配置”。
- 修改环境变量后需要重启进程或容器。

## 2.7 不使用 Docker 运行生产构建

先完整安装依赖，再构建并启动：

```bash
npm ci
npm run build
npm run build:server
node dist-server/server/index.js
```

前端静态资源由同一进程从 `dist/client` 提供，默认访问 `http://127.0.0.1:8787`。

`npm start` 使用 `tsx` 直接运行 TypeScript 源码，依赖开发依赖；`node dist-server/server/index.js` 运行编译后的 JavaScript，适合只安装生产依赖的环境。

## 2.8 升级

升级前先下载备份或复制 `data/opsite.db`。

Docker 方式：

```bash
git pull
docker compose up -d --build
```

本地方式：

```bash
git pull
npm ci
npm run build
npm run build:server
```

数据库迁移在启动时执行，优先增加字段，不重建用户表。仍建议在跨版本升级前保留备份。

## 2.9 卸载

Docker：

```bash
docker compose down       # 保留数据卷
docker compose down -v    # 同时删除数据卷
```

本地方式：停止进程后删除项目目录。若数据目录不在项目内，请单独删除 `DATA_DIR`。

## 2.10 常见启动问题

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| `Cannot connect to the Docker daemon` | Docker 未启动 | 启动 Docker Desktop 或 Docker Engine |
| 端口被占用 | 已有进程使用 8787 | 修改 `OPSITE_PORT`（Docker）或 `PORT`（本地） |
| 页面能打开但接口报错 | API 未启动或代理失败 | 检查 `npm run dev` 的两个进程和终端日志 |
| 数据目录不可写 | 权限或只读文件系统 | 确认 `DATA_DIR` 可写；Docker 只允许数据卷可写 |
| 依赖安装出现 `EBADENGINE` | Node 版本不在支持范围 | 切换到 Node 22.12 LTS 或 24 LTS |
| 忘记 SMTP 密码无法解密 | `OPSITE_SECRET` 或 `data/.secret` 丢失 | 在设置页重新填写 SMTP 密码 |

更多故障排查见[运行中心、设置与故障排查](14-operations-settings.md)。

下一步：[首页与今日值班台](03-dashboard.md)。
