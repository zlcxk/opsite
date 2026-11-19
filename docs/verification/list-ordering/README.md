# 软件情报列表排序验证

验证日期：2026-11-19
验证环境：Windows 11、Node v24.22.1、Vitest 5.0.5

## 自动化命令

| 命令 | 结果 |
| --- | --- |
| `npm test` | 21 个测试文件通过，1 个 live 测试文件跳过；230 个测试通过，3 个跳过 |
| `npx vitest run server/services/list-ordering.test.ts` | 6 个集成测试通过 |
| `npm run build` | 通过，保留原有 bundle 体积警告 |
| `npm run build:server` | 通过 |
| `npx @sublang/spex lint` | `no problems found` |

`vitest.config.ts` 使用 `vmThreads` 池；本环境的默认 fork/thread 池无法初始化 suite 上下文，切换后全部现有测试通过。
一次与前端构建并行执行的测试出现过 `MarkdownWorkspace` 全屏用例偶发失败；单独重跑 `npm test` 后 230 个测试全部通过，失败与列表排序无关。

## 集成验证

集成测试使用临时 SQLite 和真实 Express 路由，覆盖：

- 同日期 `1.9.0`/`1.10.0`、重复版本和记录标识兜底；
- 当前周期优先、周期自然倒序和跨软件分组；
- 四种版本影响、优先级、同一发布时间、公告编号自然倒序；
- 相同公告编号的记录标识兜底；
- 采集日志同一开始时间的顺序和 60 条上限；
- 版本发布 200 条、详情发布 150 条、漏洞 300 条及 offset 边界。

测试文件：[server/services/list-ordering.test.ts](../../../server/services/list-ordering.test.ts)

## 系统验证

使用临时 `DATA_DIR` 启动真实应用，通过 Edge CDP 读取真实页面 DOM。

| 页面 | 观测结果 | 截图 |
| --- | --- | --- |
| 详情版本发布 | `1.10.0`, `1.10.0`, `1.9.0`, `1.9.0`, `2.0.0` | [detail-releases.png](detail-releases.png) |
| 详情生命周期 | `1.9`（当前）, `1.10`, `1.8` | [detail-lifecycle.png](detail-lifecycle.png) |
| 详情漏洞 | 待处理前 5 条：`CVE-2026-1000`, `CVE-2026-999`, `ADV-B`, `ADV-A`, `CVE-2026-2` | [detail-vulnerabilities.png](detail-vulnerabilities.png) |
| 详情概览 | 安全状态前 5 条与最近版本前 4 条保持服务端顺序 | [detail-overview.png](detail-overview.png) |
| 全局漏洞 | 影响优先，`CVE-2026-1000`、`CVE-2026-999` 在 P1/P2 记录前 | [global-vulnerabilities.png](global-vulnerabilities.png) |
| 全局生命周期 | 软件分组 Alpha、Beta；组内当前优先、周期自然倒序 | [global-lifecycle.png](global-lifecycle.png) |

其他 DOM 断言：

- 详情采集日志显示 4 条，最近开始时间排在首位。
- 详情版本默认显示 40 条，点击“显示全部”后显示 47 条。
- 空生命周期和空漏洞页保持原空状态。
- 页面未显示 `adv-3`、`rel-0002`、`alpha-19`、`job-a` 等内部标识。
- 页面没有新增排序控件。

原始 DOM 结果：[system-evidence.json](system-evidence.json)
