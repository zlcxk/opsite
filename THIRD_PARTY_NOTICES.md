# 第三方软件与资源说明

Opsite 以 Apache-2.0 许可证发布。本项目使用的第三方依赖仍归各自作者所有，并遵循各自的许可证。

本文件列出直接依赖和运行环境中需要特别说明的第三方资源，便于分发源码或 Docker 镜像时核对。完整的传递依赖许可证文本随 `node_modules` 中各包一起分发；构建镜像时也会保留这些文件。

## 直接生产依赖

| 包 | 版本 | 许可证 |
| --- | --- | --- |
| `@codemirror/commands` | 6.11.1 | MIT |
| `@codemirror/lang-markdown` | 6.5.2 | MIT |
| `@codemirror/language` | 6.13.1 | MIT |
| `@codemirror/language-data` | 6.5.2 | MIT |
| `@codemirror/state` | 6.7.6 | MIT |
| `@codemirror/view` | 6.43.15 | MIT |
| `better-sqlite3` | 13.0.3 | MIT |
| `codemirror` | 6.0.2 | MIT |
| `express` | 5.3.0 | MIT |
| `node-cron` | 4.6.0 | ISC |
| `nodemailer` | 7.0.13 | MIT-0 |
| `react-markdown` | 10.1.0 | MIT |
| `rehype-highlight` | 7.0.2 | MIT |
| `rehype-sanitize` | 6.0.0 | MIT |
| `remark-gfm` | 4.0.1 | MIT |
| `yaml` | 2.9.1 | ISC |
| `zod` | 4.6.7 | MIT |

版本以 `package.json` 和 `package-lock.json` 为准。直接依赖的具体许可证文本位于对应包的 `LICENSE` 或 `package.json` 中。

## 传递依赖

当前生产依赖树（去重后）共 188 个包，许可证分布为：

- MIT：180 个
- ISC：5 个
- BSD-3-Clause：2 个
- MIT-0：1 个

未发现 GPL、AGPL 等 copyleft 许可证。安装依赖后，可运行以下命令重新核对：

```bash
npm ls --omit=dev --all
```

## 图标与品牌资源

- 软件图标通过 `https://cdn.simpleicons.org/` 按需加载，不随仓库或镜像打包。
- Simple Icons 项目自身以 CC0 1.0 发布；各品牌图标仍是其各自权利人的商标或标识。
- Opsite 仅将这些图标用于识别对应软件，不表示与相关项目或公司存在关联、赞助或背书。
- 如果部署环境需要完全离线运行，图标会回退为软件名称首字母，不影响核心功能。

## 用户数据与内置知识文档

- 内置的 Kubernetes、Prometheus 等技术知识文档由项目维护者整理，随项目一起按 Apache-2.0 发布。
- 文档中的外部链接、产品名称和商标归各自权利人所有。
- 用户自行录入的文档、笔记、软件记录和截图不属于本项目许可证的授权范围。

如发现第三方许可证或署名信息有遗漏，请通过仓库 Issue 或 Security Advisory 联系维护者。
