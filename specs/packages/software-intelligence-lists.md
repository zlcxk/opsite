<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 chenxiaokang <chenxiaokang@gumingnc.com> -->

# software-intelligence-lists: 软件情报列表排序

## 意图

本包定义软件情报详情页和对应全局页面中列表的标识排序与稳定顺序。
本包覆盖概览的安全状态与最近版本、版本发布、生命周期、漏洞和采集日志。
本包依据 [DR-001](../decisions/001-software-intelligence-list-ordering.md) 和 [DR-002](../decisions/002-software-intelligence-list-ordering-revision.md) 作出上述排序决定。
本包不依赖其他同级规约包，也不改变其他规约包的行为。
本包不引入用户自定义排序、排序表头、排序持久化、新数据库字段或界面重设计。

## 外部行为

### 排序契约

#### software-intelligence-lists-1

当服务端返回本包定义的任一类列表时，服务端应按本包声明的主排序键、同值排序键和记录标识返回唯一确定的顺序，不得依赖数据库自然顺序或请求顺序。

#### software-intelligence-lists-2

当客户端对本包定义的列表执行筛选、搜索、日期分组、显示全部或展开切换时，客户端应保持服务端返回的相对顺序不变。

#### software-intelligence-lists-3

当比较版本号、生命周期周期或公告编号时，系统应按自然标识规则确定先后：

| 标识 | 比较规则 |
| --- | --- |
| 版本号 | 按点分隔的数字段逐段比较，缺失段按 0 处理；同核心版本的预发布版本低于正式版本；其余后缀按不区分大小写的自然文本比较 |
| 生命周期周期 | 按版本号规则比较 |
| 公告编号 | 按交替的文本段和数字段比较，文本段不区分大小写，数字段按数值比较 |

- 无法按数字段解析的版本或周期应按不区分大小写的自然文本比较，且不得推断缺失数值。
- 自然标识比较只决定先后，不改变标识原文或业务含义。

#### software-intelligence-lists-4

当列表中所有业务排序键都相等时，系统应按记录标识升序排列，以获得稳定顺序。

#### software-intelligence-lists-5

列表不应在行号、标题、列内容或说明文字中显示内部记录标识。

### 列表顺序

#### software-intelligence-lists-6

当展示版本发布列表时，系统应按以下规则确定记录和日期分组的顺序：

- 有效时间取上游发布时间，缺失时取首次发现时间。
- 记录先按有效时间倒序排列。
- 有效时间相同时，按版本号自然倒序排列 [[software-intelligence-lists-3](#software-intelligence-lists-3)]。
- 版本号也相同时，按记录标识升序排列 [[software-intelligence-lists-4](#software-intelligence-lists-4)]。
- 页面按有效时间的日期部分倒序分组，组内顺序与记录顺序一致。
- 详情页和全局版本发布页使用同一规则。

#### software-intelligence-lists-7

当展示生命周期列表时，系统应按以下规则确定记录和软件分组的顺序：

- 当前使用版本所属的周期排在其软件分组的第一行。
- 其余周期按周期自然倒序排列 [[software-intelligence-lists-3](#software-intelligence-lists-3)]。
- 周期相同时，按记录标识升序排列 [[software-intelligence-lists-4](#software-intelligence-lists-4)]。
- 周期顺序不得被支持状态分组覆盖。
- 详情页按上述记录顺序平铺展示。
- 全局生命周期页按软件名称的中文排序升序分组，组内使用上述记录顺序。

#### software-intelligence-lists-8

当展示漏洞列表时，系统应按以下规则确定记录顺序：

- 先按版本影响排序：确认受影响 → 可能受影响 → 版本信息不足 → 不受影响。
- 影响相同时，按优先级 P0 → P1 → P2 → P3 排序。
- 影响和优先级都相同时，按有效发布时间倒序排列，有效时间取上游发布时间，缺失时取本地首次记录时间。
- 有效发布时间也相同时，按公告编号自然倒序排列 [[software-intelligence-lists-3](#software-intelligence-lists-3)]。
- 公告编号也相同时，按记录标识升序排列 [[software-intelligence-lists-4](#software-intelligence-lists-4)]。
- 详情概览、详情漏洞页和全局漏洞页使用同一规则。
- 详情漏洞页的待处理与全部筛选、全局漏洞页的状态和其他筛选只移除记录，不改变剩余记录的相对顺序 [[software-intelligence-lists-2](#software-intelligence-lists-2)]。

#### software-intelligence-lists-9

当软件详情概览展示安全状态时，系统应从待处理公告中按漏洞列表顺序 [[software-intelligence-lists-8](#software-intelligence-lists-8)] 取前 5 条显示。

- 待处理公告包括待确认、待修复和已计划状态。
- 少于 5 条时显示全部待处理公告。
- 没有待处理公告时保持现有空状态。

#### software-intelligence-lists-10

当软件详情概览展示最近版本时，系统应按版本发布列表顺序 [[software-intelligence-lists-6](#software-intelligence-lists-6)] 取前 4 条显示。

- 少于 4 条时显示全部版本记录。
- 概览不重新排序版本记录。

#### software-intelligence-lists-11

当展示采集日志时，系统应按开始时间倒序排列，并在开始时间相同时按记录标识升序排列 [[software-intelligence-lists-4](#software-intelligence-lists-4)]。

### 保持不变的行为

#### software-intelligence-lists-12

当展示本包定义的列表时，系统应保持列表的字段、筛选条件、搜索、计数、分组标题、空状态、展开与收起、加载上限和操作不变。

- 详情版本发布接口最多返回 150 条，页面默认显示 40 条，并可显示全部。
- 全局版本发布列表最多返回 200 条。
- 详情采集日志最多返回 60 条。
- 全局漏洞列表最多返回 300 条。
- 列表不新增用户排序控件。

## 验证

#### software-intelligence-lists-13

给定同一有效日期下包含 `1.9.0`、`1.10.0` 和重复版本的固定数据，当请求详情与全局版本发布列表并渲染日期分组时，验证应断言版本顺序、同值顺序和分组顺序：

- 详情接口和全局接口都先返回 `1.10.0`，再返回 `1.9.0` [[software-intelligence-lists-1](#software-intelligence-lists-1)] [[software-intelligence-lists-3](#software-intelligence-lists-3)] [[software-intelligence-lists-6](#software-intelligence-lists-6)]。
- 相同版本号的记录按记录标识升序排列 [[software-intelligence-lists-4](#software-intelligence-lists-4)]。
- 同一日期分组的组内顺序与接口顺序一致 [[software-intelligence-lists-2](#software-intelligence-lists-2)]。
- 概览最近版本取排序后的前 4 条 [[software-intelligence-lists-10](#software-intelligence-lists-10)]。

#### software-intelligence-lists-14

给定一个当前版本属于 `1.9` 的软件和一个当前版本不属于任何 `1.10`/`1.9` 周期的软件，当请求详情与全局生命周期列表时，验证应断言当前周期优先、周期自然倒序和软件分组顺序：

- 当前周期 `1.9` 排在该软件分组第一行，即使 `1.10` 的周期数值更大 [[software-intelligence-lists-1](#software-intelligence-lists-1)] [[software-intelligence-lists-7](#software-intelligence-lists-7)]。
- 没有当前周期的软件按 `1.10`、`1.9` 的自然倒序排列 [[software-intelligence-lists-3](#software-intelligence-lists-3)]。
- 相同周期的记录按记录标识升序排列 [[software-intelligence-lists-4](#software-intelligence-lists-4)]。
- 全局页面的软件分组按中文名称升序排列，且组内顺序与详情一致 [[software-intelligence-lists-2](#software-intelligence-lists-2)] [[software-intelligence-lists-7](#software-intelligence-lists-7)]。

#### software-intelligence-lists-15

给定固定公告数据覆盖四种版本影响、四种优先级、同一发布时间和多个公告编号，当请求详情概览、详情漏洞页和全局漏洞页时，验证应断言影响优先、优先级次序、编号自然倒序和记录标识兜底：

- 所有确认受影响的公告排在可能受影响、版本信息不足和不受影响的公告之前 [[software-intelligence-lists-8](#software-intelligence-lists-8)]。
- 同一影响下 P0 排在 P1、P2、P3 之前 [[software-intelligence-lists-8](#software-intelligence-lists-8)]。
- 同一影响和优先级下按发布时间倒序排列 [[software-intelligence-lists-8](#software-intelligence-lists-8)]。
- 同一影响、同一优先级和同一发布时间下 `CVE-2026-1000` 排在 `CVE-2026-999` 之前 [[software-intelligence-lists-3](#software-intelligence-lists-3)]。
- 公告编号相同的记录按记录标识升序排列 [[software-intelligence-lists-4](#software-intelligence-lists-4)]。
- 概览只显示排序后的前 5 条待处理公告 [[software-intelligence-lists-9](#software-intelligence-lists-9)]。
- 详情待处理、详情全部和全局筛选后的记录保持同一相对顺序 [[software-intelligence-lists-2](#software-intelligence-lists-2)]。

#### software-intelligence-lists-16

给定同一开始时间的多条采集日志和超过 60 条的日志集合，当重复请求详情采集日志并渲染列表时，验证应断言同值稳定和加载上限不变：

- 同一开始时间的日志按记录标识升序排列 [[software-intelligence-lists-4](#software-intelligence-lists-4)] [[software-intelligence-lists-11](#software-intelligence-lists-11)]。
- 连续两次请求返回完全相同的日志顺序 [[software-intelligence-lists-1](#software-intelligence-lists-1)]。
- 页面最多展示 60 条日志 [[software-intelligence-lists-12](#software-intelligence-lists-12)]。

#### software-intelligence-lists-17

给定包含普通记录、空列表和超过默认展示数量的固定数据，当在浏览器中操作筛选、搜索、日期分组、显示全部和详情页签切换时，验证应断言排序不改变现有交互：

- 筛选、搜索和加载上限不改变剩余记录的顺序 [[software-intelligence-lists-2](#software-intelligence-lists-2)]。
- 列表字段、计数、分组标题、空状态、展开与收起和操作保持原样 [[software-intelligence-lists-12](#software-intelligence-lists-12)]。
- 页面不显示内部记录标识，也不出现新的排序控件 [[software-intelligence-lists-5](#software-intelligence-lists-5)] [[software-intelligence-lists-12](#software-intelligence-lists-12)]。

#### software-intelligence-lists-18

给定记录数达到或超过接口返回上限且边界两侧记录具有相同排序键的固定数据，当重复请求列表并跨越返回上限检查边界记录时，验证应断言稳定顺序和边界一致性：

- 两次请求返回的首批记录顺序完全一致 [[software-intelligence-lists-1](#software-intelligence-lists-1)]。
- 边界两侧的记录按记录标识升序决出先后，不出现重复或遗漏 [[software-intelligence-lists-4](#software-intelligence-lists-4)]。
- 版本发布和漏洞列表的接口上限保持不变 [[software-intelligence-lists-6](#software-intelligence-lists-6)] [[software-intelligence-lists-8](#software-intelligence-lists-8)] [[software-intelligence-lists-12](#software-intelligence-lists-12)]。
