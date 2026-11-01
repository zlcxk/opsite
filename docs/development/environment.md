# 环境变量与部署

本文说明 Opsite 的运行前提、环境变量、数据目录、部署方式和升级注意事项。

## 1. 运行前提

| 项目 | 要求 |
| --- | --- |
| Node.js | `^22.12.0`、`^24.0.0` 或 `>=26.0.0`，推荐 22 或 24 LTS |
| npm | 10 及以上 |
| 操作系统 | macOS、Linux、Windows（WSL 或原生 Node） |
| Docker（可选） | Docker Engine 24+、Compose v2 |
| 浏览器 | 支持 ES2022 的现代浏览器 |

Node 23 不在支持范围内。Vitest 5 在 Node 23 上会报告 `EBADENGINE`，即使测试可能仍能运行，也不应作为发布环境。

## 2. 配置加载顺序

`server/index.ts` 首先导入 `server/env.ts`：

1. 查找项目根目录的 `.env`；
2. 文件存在时调用 Node 内置 `process.loadEnvFile()`；
3. 已经存在的进程环境变量优先于 `.env`；
4. 文件不存在时跳过，不报错。

Docker 镜像不包含 `.env`。Compose 通过 `environment` 把宿主机 `.env` 中的值传入容器。

修改环境变量后需要重启 API。设置页只能修改部分采集和通知设置，不能修改 `PORT`、`HOST`、`DATA_DIR`、`GITHUB_TOKEN`、`NVD_API_KEY` 等进程级配置。

## 3. 环境变量

| 变量 | 默认值 | 说明 | 修改后重启 |
| --- | --- | --- | --- |
| `PORT` | `8787` | API 和前端监听端口 | 是 |
| `HOST` | `127.0.0.1` | 监听地址；只有明确需要局域网访问时才改为 `0.0.0.0` | 是 |
| `DATA_DIR` | 项目内 `data/` | SQLite、密钥和备份的数据目录 | 是 |
| `CLIENT_DIR` | 项目内 `dist/client` | 前端静态资源目录 | 是 |
| `GITHUB_TOKEN` | 空 | 提高 GitHub Releases、Advisory 和技术发现的速率上限 | 是 |
| `NVD_API_KEY` | 空 | 缩短 NVD 请求间隔 | 是 |
| `DISABLE_SCHEDULER` | `false` | `true` 时停止软件同步和技术发现的定时任务 | 是 |
| `SYNC_CRON` | `0 */6 * * *` | 首次建库时软件同步任务的初始 cron | 是 |
| `DISCOVERY_ENABLED` | `true` | `false` 时关闭技术发现自动采集，手动采集仍可用 | 是 |
| `DISCOVERY_CRON` | `0 9 * * *` | 技术发现任务的初始 cron | 是 |
| `DISCOVERY_TIMEZONE` | `Asia/Shanghai` | 技术发现 cron 的时区 | 是 |
| `OPSITE_SECRET` | 空 | 加密 SMTP 密码的应用密钥；留空时自动生成 `data/.secret` | 是 |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:<PORT>` | 邮件内站内链接前缀 | 是 |
| `NOTIFICATION_TIMEZONE` | `Asia/Shanghai` | 免打扰时段和每日摘要的时区 | 是 |
| `DISABLE_EMAIL_QUEUE` | `false` | `true` 时停止后台邮件发送队列 | 是 |

表中的“项目内”路径以运行入口所在目录为基准：`tsx server/index.ts` 和 `npm start` 是仓库根目录，编译后的 `dist-server/server/index.js` 是 `dist-server`。使用编译产物时请显式设置 `DATA_DIR=data` 和 `CLIENT_DIR=dist/client`。

Docker Compose 额外读取：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `OPSITE_PORT` | `8787` | 宿主机映射端口，仍然只绑定 `127.0.0.1` |

## 4. 配置说明

### HOST 与访问边界

- 默认 `127.0.0.1` 只允许本机访问。
- 设为 `0.0.0.0` 会监听所有网卡；应用没有登录和权限控制，必须用防火墙限制来源。
- Docker 容器内部固定 `HOST=0.0.0.0`，但 Compose 的端口映射是 `127.0.0.1:<OPSITE_PORT>:8787`，不会自动暴露到局域网。
- 需要公网访问时，至少增加反向代理、TLS 和认证；这不是当前版本的默认能力。

### 调度开关

- `DISABLE_SCHEDULER=true` 停止软件同步和技术发现的定时执行，手动执行仍可用。
- 设置页的“启用后台定时采集”是持久化设置，影响软件同步任务；它不是 `DISABLE_SCHEDULER` 的替代品。
- `DISCOVERY_ENABLED=false` 只关闭技术发现，不影响软件同步。
- `DISABLE_EMAIL_QUEUE=true` 只关闭邮件投递，站内通知仍会生成并保存。

### cron 的作用范围

`SYNC_CRON` 和 `DISCOVERY_CRON` 只在首次创建任务时作为初始值。之后：

- 设置页修改全局采集频率，会更新仍跟随全局计划的任务；
- 单独编辑过 cron 的任务标记为自定义计划，不再跟随全局值；
- 修改环境变量不会重排已有任务。

### 密钥

SMTP 密码使用 AES-256-GCM 加密：

- 设置 `OPSITE_SECRET` 时，密钥由该值派生；
- 未设置时，首次需要加密会在 `DATA_DIR/.secret` 生成随机密钥；
- 密钥不包含在 `/api/backup` 导出的数据库中；
- 恢复数据库后，必须保留原 `OPSITE_SECRET` 或 `data/.secret`，否则已保存的 SMTP 密码无法解密。

## 5. 数据目录与权限

默认目录结构：

```text
data/
├── opsite.db
├── opsite.db-wal
├── opsite.db-shm
├── .secret
└── backups/
```

要求：

- 进程对 `DATA_DIR` 有读写权限；
- 对启动目录下的 `data/backups/` 有写权限；它不是 `DATA_DIR` 的子目录约定；
- Docker 中只有 `/app/data` 可写，`/tmp` 是 16 MB tmpfs，根文件系统只读；
- 不要把 `data/` 放进版本控制。

## 6. 本地运行

```bash
npm ci
cp .env.example .env
npm run dev
```

访问：

- 前端：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:8787`

`npm run dev` 同时启动 `tsx watch server/index.ts` 和 Vite。Vite 将 `/api` 代理到 API 端口。

生产构建：

```bash
npm run build
npm run build:server
DATA_DIR=data CLIENT_DIR=dist/client node dist-server/server/index.js
```

编译后的服务端位于 `dist-server/server`，其默认路径基准是 `dist-server`。如果不设置 `DATA_DIR` 和 `CLIENT_DIR`，数据会写入 `dist-server/data`，静态资源会查找 `dist-server/dist/client`，根路径将返回 404。编译后运行也不会自动读取仓库根目录的 `.env`，应通过进程环境变量传入配置。

或者不构建服务端，直接用 `tsx`：

```bash
npm start
```

`npm start` 需要开发依赖中的 `tsx`；`node dist-server/server/index.js` 只需要生产依赖。

## 7. Docker Compose

```bash
docker compose up -d --build
```

默认：

- 镜像：本地构建的 `opsite:local`；
- 宿主端口：`127.0.0.1:8787`；
- 数据卷：`opsite-data:/app/data`；
- 健康检查：容器内请求 `/api/health`；
- 非 root 用户、只读根文件系统、丢弃全部 capabilities。

检查状态：

```bash
docker compose ps
docker compose logs -f opsite
curl http://127.0.0.1:8787/api/health
```

停止：

```bash
docker compose down
```

停止并删除数据卷：

```bash
docker compose down -v
```

`-v` 会永久删除数据库，执行前必须确认。

## 8. 反向代理与 TLS

当前版本不内置 TLS、认证或 WAF。如果必须在局域网或公网访问：

1. 保持 Opsite 只监听回环地址或容器内部网络；
2. 在反向代理层终止 TLS；
3. 增加身份认证和访问控制；
4. 限制来源 IP；
5. 设置正确的 `PUBLIC_BASE_URL`，否则邮件中的链接仍指向本机地址；
6. 不要代理 `/api/backup` 给不受信任的客户端。

这些是部署方需要自行承担的能力，不是 Opsite 已实现的功能。

## 9. 升级

1. 备份数据库和 `.secret`；
2. 拉取新代码或新镜像；
3. 重新执行 `npm ci` 或 `docker compose build`；
4. 重新构建前端和服务端；
5. 启动后检查 `/api/health`、运行中心和设置页；
6. 确认数据源与任务状态。

数据库使用启动时增量迁移，只支持增加表和列。升级前必须备份；不要期望自动回滚。

## 10. 故障排查

| 现象 | 检查 |
| --- | --- |
| 端口被占用 | `lsof -i :8787`，或修改 `PORT` |
| 页面 404、API 正常 | 确认 `CLIENT_DIR` 指向 `dist/client`，并已执行前端构建 |
| API 启动即退出 | 查看日志中的数据目录权限、SQLite 打开错误 |
| `EBADENGINE` | 使用 Node 22.12+ 或 24 LTS，避免 Node 23 |
| 容器健康检查失败 | `docker compose logs`，确认容器内端口与 `PORT` 一致 |
| 备份失败 | 确认启动目录下 `data/backups/` 可写 |
| SMTP 密码恢复后失效 | 检查 `OPSITE_SECRET` 或 `data/.secret` 是否与备份匹配 |
| 定时任务不执行 | 检查 `DISABLE_SCHEDULER`、任务启用状态、数据源启用状态和 cron |
