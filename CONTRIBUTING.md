# 贡献指南

感谢你关注 Opsite。Opsite 是一个单用户、本地优先的运维情报与技术知识工作台，当前仍处于 `0.1.x` 阶段。提交改动前，请先确认它符合项目边界，并尽量把改动控制在可审查的范围内。

## 可以贡献的内容

- 缺陷修复和可靠性改进
- 测试补充
- 文档修正与用户手册完善
- 数据源适配器的兼容性修正
- 可访问性、性能和构建问题修复
- 许可证、依赖和安全相关问题的报告

以下内容目前不属于项目范围：

- 多用户、RBAC、登录体系
- 云端同步、跨设备协作
- AI 自动生成知识或自动推断技术关系
- 通用工作流引擎
- 为公网直接暴露而设计的安全加固
- 与现有 SQLite 并行的第二套数据库

如果准备增加较大的能力，请先通过 Issue 说明使用场景、数据模型和边界，避免在未确认方向前提交大改动。

## 开发环境

要求：

- Node.js 22.12 LTS 或 24 LTS（测试工具 Vitest 当前不支持 Node 23）
- npm 10 或更高版本
- 可选：Docker 与 Docker Compose v2

```bash
git clone https://github.com/zlcxk/opsite.git
cd opsite
npm ci
cp .env.example .env
npm run dev
```

前端开发地址为 `http://localhost:5173`，API 默认运行在 `http://127.0.0.1:8787`。Vite 会把 `/api` 代理到 API 进程。

`.env.example` 默认使用 `HOST=127.0.0.1`。除非明确需要局域网访问，否则不要改成 `0.0.0.0`；应用没有登录和权限控制。

## 常用命令

```bash
npm run dev            # 同时启动 API 和 Vite
npm run test           # 运行全部 Vitest 测试
npm run test:watch     # 监听模式
npm run build          # TypeScript 检查 + 前端生产构建
npm run build:server   # 编译服务端
```

提交前至少执行：

```bash
npm test
npm run build
npm run build:server
```

如果改动涉及 Docker、启动参数或持久化路径，请同时验证：

```bash
docker compose up -d --build
docker compose logs -f
```

## 代码约定

- 使用 TypeScript，保持现有严格模式设置。
- 前端组件和页面优先复用 `src/components/`、`src/lib/` 和 `src/contexts/` 中已有模式。
- 服务端路由只做参数校验和响应组织，业务逻辑放在 `server/services/`。
- 对外部输入使用 Zod 校验；不要把异常堆栈、数据库路径、密钥或上游响应原文返回给浏览器。
- 数据库迁移必须是前向兼容的，优先使用 `ensureColumn` 增加字段，不要直接删除或重建用户表。
- 新增测试时使用临时 `DATA_DIR`，不要读写仓库内的 `data/opsite.db`。
- 不要在测试、示例或文档中使用真实邮箱、Token、内部 IP、个人笔记或生产数据。
- 文档默认使用中文；命令、代码和配置项保留原文。

## 数据与安全

- 不要提交 `.env`、`data/`、数据库文件、备份、日志或任何凭据。
- 不要为了演示而伪造数据源响应、截图或已验证状态。
- 知识文档中的技术结论需要可核实的来源；链接可达不等于技术结论正确。
- 涉及外部 URL 请求时，必须保留现有的 SSRF 防护、超时、大小和并发限制。
- 安全问题不要公开提交 Issue，请按 [SECURITY.md](SECURITY.md) 的流程私下报告。

## 提交与 Pull Request

- 一个 Pull Request 尽量只解决一个问题，避免混入无关格式化或重构。
- 说明改动目的、影响范围、验证命令和未覆盖的限制。
- 涉及界面变化时，附上真实运行截图或文字说明；不要使用生成图冒充产品截图。
- 涉及数据库、备份、采集、通知或知识建档的改动，请说明失败路径和幂等性。
- 提交信息使用简洁的中文或英文均可，但应与仓库现有风格一致。
- 合并前请确保测试和构建通过，并处理审查意见。

## 许可证

除非你明确声明，提交到本仓库的贡献将按 [Apache License 2.0](LICENSE) 授权。提交前请确认你有权提交相关内容，并保留必要的第三方署名。
