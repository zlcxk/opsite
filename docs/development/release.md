# 测试、构建与发布

本文说明 Opsite `0.1.0` 的本地验证、构建、Docker 镜像、发布和回滚流程。

## 1. 版本号位置

当前版本为 `0.1.0`，需要同步修改：

- `package.json` 的 `version`；
- `package-lock.json` 根包的 `version`（两处）；
- `README.md` 的“当前版本”；
- 用户手册和开发文档中的适用版本说明。

版本号采用语义化版本 `MAJOR.MINOR.PATCH`。`0.x` 阶段允许功能与接口变化，但仍应在发布说明中明确破坏性变更。

## 2. 发布前检查

### 2.1 环境

```bash
node --version   # 22.12+ 或 24.x
npm --version    # 10+
```

避免 Node 23：Vitest 5 会报告 `EBADENGINE`。

### 2.2 安装与测试

```bash
npm ci
npm test
```

测试使用 Vitest，覆盖服务端服务、库函数和部分前端组件。测试不得依赖真实外部 API、真实邮箱或生产数据。

### 2.3 类型检查与构建

```bash
npm run build
npm run build:server
```

- `npm run build` 先执行 `tsc --noEmit`，再用 Vite 构建到 `dist/client`；
- `npm run build:server` 编译到 `dist-server/server`；
- 两者都失败时不得发布。

### 2.4 文档与仓库检查

```bash
git diff --check
git status
```

还需人工确认：

- Markdown 相对链接全部可解析；
- 截图来自真实页面，且不含地址栏、域名、邮箱、Token、密码、内部 IP 或私人笔记；
- 文档没有把计划能力写成已实现能力；
- `.env`、`data/`、数据库、备份和密钥未被加入版本控制；
- `LICENSE`、`NOTICE`、`THIRD_PARTY_NOTICES.md` 存在且与依赖一致。

依赖变化时，需要重新核对 `THIRD_PARTY_NOTICES.md` 中的直接依赖、传递依赖数量和许可证分布。

## 3. 本地生产验证

使用临时数据目录，避免污染开发数据库：

```bash
TMP_DATA="$(mktemp -d)"
PORT=8790 HOST=127.0.0.1 DATA_DIR="$TMP_DATA" CLIENT_DIR=dist/client \
  node dist-server/server/index.js
```

另一个终端：

```bash
curl http://127.0.0.1:8790/api/health
curl -I http://127.0.0.1:8790/
```

预期：

- `/api/health` 返回 `{"ok":true,...}`；
- 根路径返回 `200`，HTML 内容为前端入口；
- 页面可以加载，静态资源无 404；
- 停止进程后，临时目录可以删除。

`curl -I /` 在某些配置下可能只做 HEAD 请求；如果返回 404，改用 `curl -i` 或浏览器确认 SPA fallback。

## 4. Docker 镜像

构建：

```bash
docker build -t opsite:0.1.0 .
```

或：

```bash
docker compose build
```

检查：

```bash
docker run --rm -d --name opsite-smoke \
  -p 127.0.0.1:8791:8787 \
  -v opsite-smoke-data:/app/data \
  opsite:0.1.0

curl http://127.0.0.1:8791/api/health
docker logs opsite-smoke
docker rm -f opsite-smoke
docker volume rm opsite-smoke-data
```

镜像要求：

- 使用 Node 22 Alpine 运行时；
- 非 root 用户 `node`；
- 根文件系统只读；
- 只有 `/app/data` 可写；
- 健康检查请求 `/api/health`；
- 只包含生产依赖、编译后的服务端、前端静态资源和许可证文件。

Docker 不可用时，至少完成静态检查：`Dockerfile`、`docker-compose.yaml`、构建产物路径和 `COPY` 源路径一致。

## 5. 发布步骤

1. 确认工作区只包含本次发布需要的变更；
2. 更新版本号和相关文档；
3. 执行第 2 节的测试、构建和检查；
4. 执行第 3 节的本地生产验证；
5. 如环境允许，执行第 4 节的 Docker 验证；
6. 提交变更；
7. 创建带注释的标签：

```bash
git tag -a v0.1.0 -m "Opsite 0.1.0"
git push origin main
git push origin v0.1.0
```

8. 在 GitHub 创建 Release，说明：
   - 版本定位；
   - 主要能力；
   - 已知限制和安全边界；
   - 升级与备份要求；
   - 许可证和第三方声明。

发布说明面向使用者，不应只复制提交记录，也不应宣称未实现的功能。

## 6. 许可证与第三方声明

发布物包含：

- `LICENSE`：Apache License 2.0；
- `NOTICE`：版权与项目归属；
- `THIRD_PARTY_NOTICES.md`：直接依赖、生产依赖树许可证分布和边界说明。

新增或升级依赖后：

1. 重新生成生产依赖树；
2. 核对许可证；
3. 更新直接依赖表和统计；
4. 确认没有引入不兼容许可证；
5. 保留上游版权声明。

不要在没有版权核查的情况下添加或更换许可证。

## 7. 回滚

### 应用回滚

```bash
git checkout v0.1.0
npm ci
npm run build
npm run build:server
```

或回退 Docker 镜像标签。

### 数据回滚

数据库迁移只增不减，旧版本代码通常可以读取新数据库中的新增列，但不能依赖这一点。回滚前：

1. 停止服务；
2. 备份当前数据库；
3. 恢复升级前的数据库快照；
4. 删除旧 WAL/SHM；
5. 保留匹配的 `OPSITE_SECRET` 或 `.secret`。

数据库回滚会丢失升级后写入的数据，必须先确认。

## 8. 发布检查清单

- [ ] 版本号在 `package.json`、`package-lock.json` 和文档中一致
- [ ] `npm ci` 成功
- [ ] `npm test` 全部通过
- [ ] `npm run build` 成功
- [ ] `npm run build:server` 成功
- [ ] `git diff --check` 无输出
- [ ] 相对链接检查通过
- [ ] 截图为真实页面且已脱敏
- [ ] 未提交 `.env`、`data/`、数据库、备份或密钥
- [ ] `LICENSE`、`NOTICE`、`THIRD_PARTY_NOTICES.md` 与实际依赖一致
- [ ] 本地生产模式冒烟通过
- [ ] Docker 构建与健康检查通过（环境允许时）
- [ ] 发布说明包含限制和安全边界
