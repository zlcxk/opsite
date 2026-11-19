<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 chenxiaokang <chenxiaokang@gumingnc.com> -->

# IR-001: 软件情报列表排序

## 状态

已完成

## 意图

实现 [software-intelligence-lists](../packages/software-intelligence-lists.md) 的全部行为条目。
本意图落实 [DR-001](../decisions/001-software-intelligence-list-ordering.md) 和 [DR-002](../decisions/002-software-intelligence-list-ordering-revision.md) 的排序决定。
本轮主要改变两个对外可见顺序：全局漏洞列表改为影响优先，生命周期列表不再按支持状态分组。
版本发布、概览和采集日志的字段与交互保持不变，排序按本包规则修正。
实现中发现规约不足或需要改变对外行为时，先暂停并与维护者确认后再修订规约。

## 交付项

- [x] 服务端为五类列表提供唯一确定顺序，并以记录标识升序兜底 [[software-intelligence-lists-1](../packages/software-intelligence-lists.md#software-intelligence-lists-1)] [[software-intelligence-lists-4](../packages/software-intelligence-lists.md#software-intelligence-lists-4)]
- [x] 版本号、周期和公告编号使用自然标识比较 [[software-intelligence-lists-3](../packages/software-intelligence-lists.md#software-intelligence-lists-3)]
- [x] 客户端筛选、搜索、日期分组、显示全部和展开时保持服务端顺序 [[software-intelligence-lists-2](../packages/software-intelligence-lists.md#software-intelligence-lists-2)]
- [x] 版本发布列表按有效时间、版本号和记录标识排序，并按日期倒序分组 [[software-intelligence-lists-6](../packages/software-intelligence-lists.md#software-intelligence-lists-6)]
- [x] 生命周期列表按当前周期、周期自然倒序和记录标识排序，全局页面按软件名称分组 [[software-intelligence-lists-7](../packages/software-intelligence-lists.md#software-intelligence-lists-7)]
- [x] 漏洞列表统一按影响、优先级、发布时间、公告编号和记录标识排序 [[software-intelligence-lists-8](../packages/software-intelligence-lists.md#software-intelligence-lists-8)]
- [x] 概览安全状态和最近版本按统一列表顺序截取 [[software-intelligence-lists-9](../packages/software-intelligence-lists.md#software-intelligence-lists-9)] [[software-intelligence-lists-10](../packages/software-intelligence-lists.md#software-intelligence-lists-10)]
- [x] 采集日志按开始时间倒序和记录标识升序排列 [[software-intelligence-lists-11](../packages/software-intelligence-lists.md#software-intelligence-lists-11)]
- [x] 列表不显示内部记录标识，并保留现有字段、筛选、计数、分组、空状态、加载上限和操作 [[software-intelligence-lists-5](../packages/software-intelligence-lists.md#software-intelligence-lists-5)] [[software-intelligence-lists-12](../packages/software-intelligence-lists.md#software-intelligence-lists-12)]
- [x] 规约验证条目 [[software-intelligence-lists-13](../packages/software-intelligence-lists.md#software-intelligence-lists-13)] 至 [[software-intelligence-lists-18](../packages/software-intelligence-lists.md#software-intelligence-lists-18)] 全部执行并留有证据
- [x] 受影响的用户指南与实际结果同步更新
- [x] 本 IR 按实际执行结果更新，未执行或未通过的交付项保持未勾选

## 任务

每项任务对应一次提交。

1. 建立自然标识排序基础：实现版本、周期和公告编号的自然比较，以及所有业务排序键相等时的记录标识升序兜底；补充直接覆盖比较边界的实现测试。

2. 实现服务端版本发布与生命周期排序：统一详情和全局版本发布列表的有效时间、版本和记录标识顺序；统一详情和全局生命周期列表的当前周期、周期和记录标识顺序；保证日期分组与软件分组不覆盖记录顺序。

3. 实现服务端漏洞与采集日志排序：统一概览、详情和全局漏洞列表的影响、优先级、时间、公告编号和记录标识顺序；为采集日志补上开始时间相同时的记录标识顺序。

4. 调整客户端列表展示：移除或替换会改变服务端顺序的本地排序；让概览安全状态取排序后的前 5 条、概览最近版本取前 4 条；保留筛选、搜索、日期分组、显示全部和展开行为。

5. 增加列表排序集成测试：使用真实 SQLite 数据覆盖版本、生命周期、漏洞、采集日志、概览截取、重复请求和接口上限边界；断言详情与全局接口顺序一致。

6. 增加页面级系统验证：用固定数据启动真实应用，检查详情页和全局页面的记录顺序、日期分组、筛选后顺序、空状态、加载上限、内部标识不可见和无新增排序控件；保存命令输出和页面截图作为证据。

7. 更新文档与 IR：同步用户指南和必要的开发说明；把实际执行的命令、测试结果、系统验证证据和未完成项写回本 IR。

## 验证

- 开发自检：`npm test`、`npm run build`、`npm run build:server` 和 `npx @sublang/spex lint` 全部通过。
- 集成验证：新增测试直接写入临时 SQLite，调用真实服务端列表查询，重复请求并检查边界顺序。
- 系统验证：以临时 `DATA_DIR` 启动应用，使用无头浏览器读取真实页面 DOM，核对记录、分组、筛选和空状态。
- 证据保留：命令、测试名称、失败的原始输出、修复后的复测结果和系统验证截图均记录在本 IR 或链接的验证记录中。
- 完成规则：任何未执行或未通过的验证项都保持未勾选，不因代码已完成而标记完成。

| 规约验证 | 验证方法 |
| --- | --- |
| [[software-intelligence-lists-13](../packages/software-intelligence-lists.md#software-intelligence-lists-13)] | 集成测试覆盖同日期 `1.9.0`/`1.10.0`、重复版本和概览前 4 条；系统测试检查日期分组 |
| [[software-intelligence-lists-14](../packages/software-intelligence-lists.md#software-intelligence-lists-14)] | 集成测试覆盖当前周期优先、周期自然倒序、重复周期和全局软件分组；系统测试检查页面分组 |
| [[software-intelligence-lists-15](../packages/software-intelligence-lists.md#software-intelligence-lists-15)] | 集成测试覆盖四种影响、四种优先级、同时间公告编号和概览前 5 条；系统测试检查筛选后顺序 |
| [[software-intelligence-lists-16](../packages/software-intelligence-lists.md#software-intelligence-lists-16)] | 集成测试重复请求同时间日志并检查 60 条上限；系统测试检查日志顺序 |
| [[software-intelligence-lists-17](../packages/software-intelligence-lists.md#software-intelligence-lists-17)] | 系统测试操作筛选、搜索、日期分组、显示全部和页签切换，核对字段、计数、空状态与内部标识 |
| [[software-intelligence-lists-18](../packages/software-intelligence-lists.md#software-intelligence-lists-18)] | 集成测试构造达到接口上限的同值记录，重复请求并检查边界不重复、不遗漏 |

### 实际结果

- 7 项任务对应的代码、文档和测试已完成，业务变更保留在工作区，本轮未创建 Git 提交。
- `npm test`：21 个测试文件通过，1 个 live 测试文件跳过；230 个测试通过，3 个跳过。
- 列表排序单元测试：[list-order.test.ts](../../server/lib/list-order.test.ts) 通过。
- 列表排序集成测试：[list-ordering.test.ts](../../server/services/list-ordering.test.ts) 的 6 个用例通过。
- `npm run build`：通过，保留原有 bundle 体积警告。
- `npm run build:server`：通过。
- `npx @sublang/spex lint`：`no problems found`。
- 系统验证使用真实应用和 Edge CDP，证据见 [验证记录](../../docs/verification/list-ordering/README.md)。
- 系统页面确认 `1.10.0` 排在 `1.9.0` 前，当前周期 `1.9` 排在第一行，全局漏洞按影响优先，内部标识不可见，详情版本默认 40 条并可展开到 47 条。
- 一次与前端构建并行执行的测试出现过 `MarkdownWorkspace` 全屏用例偶发失败；单独重跑后全部通过，失败与本轮列表排序无关。
- 未执行或未通过的交付项：无。
