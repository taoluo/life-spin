# Action loop UX enhancement

Status: proposed design; implementation and qualification are not implied.
Date: 2026-09-09. Source baseline: `064b987` (`vscode-implementation`).

## 1. 目标与分工

让已有 `Capture → Context → Act → Done → Review` 闭环少走一步，帮助用户在计划变化、
等待回复、会议结束、项目恢复和同步失败时找回上下文。优先复用现有语义，不要求新增长期维护的 metadata。
频率和收益是工作流判断，尚非使用遥测结论。

| 范围 | Owner / boundary |
|---|---|
| 普通页面、搜索、链接、Backlinks、Graph、模板、文件与编辑 | Foam / VS Code；LifeLoop 不建设第二套 PKM UI |
| 任务选择、继承语义、关系事实、Review、guarded mutation | LifeLoop semantic-core；宿主只组织交互 |
| 通知与重复提醒 | Reminders；不新增 LifeLoop recurrence engine |
| 日程时间、全天事件、重复实例、位置、attendees | Calendar；LifeLoop 使用有限读取和已承诺同步字段 |
| 手机 capture 与 pending note | Apple Notes bridge；沿用现有正文导入、所有权转移及冲突规则 |
| 任务与关系的持久事实 | Markdown；SQLite 与生成视图可重建 |
| 同步 baseline / unresolved state | 现有 bridge 状态；属于操作安全数据，不是可随索引清理的业务数据库 |

本文补充 [relationship data surfaces](2026-09-09-relationship-data-surfaces.md)，不替换其
直接参与人链接、History Sufficiency Rule 和 Markdown authority 契约。
当前能力与历史证据见 [capability matrix](../CAPABILITY-MATRIX.md)；旧测试通过不等于本文已验收。

## 2. 方案选择

选择 **现有 TreeView + contextual QuickPick + native editor / diff / Output Channel**：
在原有入口组合共享查询和 mutation；只在现有 API 缺少具体语义时增加命名操作。

另外两种方案不采用：大量独立命令会增加发现和选择成本；新 Webview Dashboard / workflow engine
会复制状态与导航并扩大维护面。常用入口可以有可搜索命令，细分动作优先放在 Task Actions 中。
本轮不冻结新 API ABI，不引入通用 action registry、事务框架或持久 undo/event store。

## 3. 功能清单与实施顺序

“已有”表示有实现基础，仍需检查目标入口的覆盖；“新增”表示本文要求的新体验，不代表已经编码。

| ID | Feature | 当前基础 / 本轮范围 | 批次 |
|---|---|---|---|
| A1 | Quick Reschedule | 已有 Set Scheduled；新增 Tomorrow / Next week / Clear 快捷选择 | P0 |
| A2 | Inbox Skip / Edit / Resume | 已有连续处理；新增跳过、编辑交接和恢复位置 | P0 |
| A3 | Contextual Task Actions | 已有主要动作；统一状态、binding 与能力判断，补齐入口覆盖 | P0 |
| A4 | Selection / scroll / focus | 在现有 TreeView 中保持连续性，验收宿主实际能力 | P0 |
| A5 | Actionable refusals | 将现有失败原因映射到安全恢复入口 | P0 |
| A6 | External Sync / report / Resolve | 复用现有 sync 与 resolver；补持久可见性及范围准确性 | P0 |
| B1 | Link / Add Context | 已有 Link Project；扩展为选择确切已有 Project / Person / Note | P1 |
| B2 | Waiting → Next Action | 组合完成、清除本地 Waiting、创建后续行动和改期 | P1 |
| B3 | Capture Selected Text + Source | 复用 Capture；先支持 VS Code 编辑器选区和可获得的来源 | P1 |
| B4 | Pick Next Action | 复用 actionable 查询，提供未排期任务选择 | P1 |
| B5 | Clarify Task / Make Actionable | 组织 Edit wording、Add Next Action、Attach Page、Waiting/Someday | P1 |
| B6 | Peek Source + Why Here? | 已有基础；补 Today / Linked Tasks / live Review 一致性 | P1 |
| B7 | Live Weekly Review actions | 从已有 Review 查询进入任务/项目动作，不修改冻结快照 | P1 |
| B8 | Project action-gap resolution | 将已有事实 signals 接到 Capture Next Action / Waiting / Pause / Source | P1 |
| B9 | Backlog resurfacing | Review 中查看 Unscheduled / Someday / Paused；无新调度器 | P1 |
| C1 | Meeting Wrap-up | 复用 Log Interaction，增加可跳过的 follow-up 和 completion 步骤 | P2 |
| C2 | Completed / Logbook Quick Find | 复用 completion facts，增加日期范围查找 | P2 |
| C3 | Project closure checks | Complete / Archive 前显示未完事项及 bindings | P2 |
| C4 | Project resumption brief | 只读聚合现有任务、明确日期事实与上下文 | P2，独立验收 |
| C5 | Pre-meeting / Relationship resurfacing | 复用已有 restricted Brief / Person Context；检查事实、缺失数据与入口 | P2 |
| D1 | Today read-only Calendar Agenda | 新增范围读取，独立日历语义验收 | P3，独立验收 |
| D2 | Recent Actions + Narrow Undo | 当前会话内、有限 Markdown 操作；逐个证明可安全反转 | P3，独立验收 |
| D3 | Create Project from Task | 单独设计命名复合 mutation，不能把 Attach Page 自动当成 Create Project | P3，独立验收 |
| D4 | Associate existing Calendar event | 等 exact selection / recurring-instance identity / ownership 验证可靠 | Deferred |

P0/P1 可以先交付。P2/P3 不应拖住高频路径；D4 不是本轮完成条件。
Calendar Agenda 是新的受限范围读取，不自动扩大 Calendar 写入或 attendee 推断能力。

## 4. 共用正确性契约

### 4.1 Projection 与 mutation

任务 projection 的可操作节点携带 opaque source identity 与当前 SourceHandle guard；
展示文字、列表序号、旧 offset 和 UI selection 都不能作为写入依据。
页面级动作使用现有页面版本/状态校验；新增目标保留 expected-absence 验证。

流程为：读取 → 生成 projection / handle → 用户选择 → 验证目标与前提 → 调用命名 mutation →
验证结果 → 重新索引 → 更新相关视图。prompt、编辑或异步 bridge 调用后都可能过期。
刷新不能默默把用户原先批准的操作重新指向一个不同任务；来源不确定时只提供读取/重新选择。

Markdown mutation 复用宿主编辑和现有 vault preflight；多页面变更不得用多个未经协调的 direct writes 拼装。
外部操作沿用 verification、idempotency 和 compensation，不能假装跨应用 ACID。
Calendar 创建后绑定失败仍须按现有所有权契约补偿；无法确认或补偿失败时保留可定位报告。

只读表格无需为了展示强行变成可操作表格。若以后提供行操作，该行必须携带同等来源凭据；
导出或冻结 Markdown 不保存可永久信任的 mutation receipt。

### 4.2 不增加隐式语义

- `scheduled` 是计划日期，`deadline` 是期限；改期不能同时改 deadline 或移动 Calendar event。
- 继续尊重自定义任务状态政策，不把 `[x]` / `[ ]` 当成唯一状态。
- 直接 exact Person links 才能作为参与人依据；继承 Person links 仅提供上下文或待确认建议。
- 普通 mention 不计为 Interaction；没有明确日期不伪造历史。
- 新增动作需要回答历史问题时，采用最小 domain Markdown 事实；不记录推测性 analytics 事件。

## 5. P0：高频步骤与信任

### A1. Quick Reschedule

从 Task Actions 的 Schedule 进入 Today、Tomorrow、Next week、Pick date、Clear scheduled。
Tomorrow 是用户本地日历的下一天；Next week 默认下一个星期一，菜单显示实际日期
（例如 `Next week · Mon Sep 14`）。使用日历日期运算，不能用固定 24 小时跨 DST。
展示旧 scheduled 与目标值；取消不写入。Clear 只清任务自身字段；若继承值仍生效，明确解释。

### A2. Inbox Skip / Edit / Resume

Skip 不移动或标记 Processed，只在本次遍历跳过；本轮全部跳过后停止，不循环弹出同一项。
Edit 打开原始 item 及子树，交给原生编辑器；不增加第二个正文编辑器。退出处理后可 Resume。

用 VS Code workspace state 保存有界的位置提示（来源标识、匹配摘要等），不保存可跨重启使用的旧 guard，
也不把完整私人正文复制进位置状态。Resume 重新读取 pending items；仅在可唯一核对时恢复原项。
若原项已改变、删除或出现重复，提示重新选择，不按旧 offset 自动操作；匹配失败不丢失 Inbox 内容。
成功处理后进入下一项；失败留在当前项并提供恢复。取消可选 Project / When 不应把 item 提前移走。
Notes-bound pending item 继续沿用现有同步和处理后的所有权转移规则。

### A3–A5. 一致动作与不中断的上下文

Task Actions 根据当前任务状态、绑定、宿主能力和直接上下文提供动作。
Complete/Reopen、Deadline、Schedule、Reminder、Calendar、Waiting/Someday、Project、Open/Peek Source
复用现有 commands；不另写业务逻辑。延迟选择后重新验证，外部动作必须使用被选节点的目标而非活动光标。

Tree item identity 应与来源关联，不能随 label 或日期变化。保留展开状态和仍存在的选择；
任务离开当前 projection 后选择相邻项，最后一项完成后落到合理父组。
只刷新相关视图，不强制抢走编辑器焦点。VS Code 未公开精确 scroll restoration API 时，
使用稳定节点、局部刷新和 reveal 保持选项可见；不承诺像素级滚动，也不重写 TreeView。

| 原因 | 用户恢复动作 | 禁止行为 |
|---|---|---|
| Stale source | Refresh、Open Source、重新确认操作 | 用刷新后另一项替代原目标 |
| Ambiguous / duplicate anchor / collision | Open Source、修正或重新选择 | 猜测匹配项 |
| Missing source | Refresh、返回剩余项目 | 自动重建被删任务 |
| External missing / unknown effect | 查看报告、核实外部对象、显式 Resolve/Detach（适用时） | 盲目重试或重新创建 |
| 确认未执行且可安全重试的 transient failure | 有界 Retry | 多层自动重试放大 |

### A6. Sync visibility 与集中 Resolve

用户主要入口为 `Sync External`、`Sync Report`、`Resolve Conflicts`。底层仍保留 Notes、Reminders、Calendar
各自契约；某一 provider 不可用不应谎报全体成功。已有自动同步策略可以复用，本轮不新建 scheduler。

现有 `apple.ts` 持久化 conflict 记录并写 Output Channel；这不能证明全部 report 能跨重启存续。
目标是在现有 workspace state 中保留最近一次运行摘要和仍未解决的异常，每个受影响 binding 合并当前状态，
不建无限历史日志。至少包含时间、provider、pulled/pushed/refused/conflict/missing/unknown/compensation 结果、
可定位来源和下一步。正常流水在 Output Channel 展示，未解决异常在重启后仍可发现。
除现有 resolver 必要数据外不把私人正文复制到报告；删除报告不应删除 binding 或解除安全暂停。

同步仅比较已管理字段、使用有效 baseline 和确切身份：

| 已验证情况 | 结果 |
|---|---|
| 无变化 | 不写入 |
| 单边变化，另一侧及 baseline 可验证 | 传播受管内容，验证后更新 baseline |
| 双方变化但受管内容已一致 | 验证后一致化 baseline，不制造 conflict |
| 双方变化且受管内容不同 | 保留 binding 与双方内容，暂停该对象自动写入，进入 Resolve |
| baseline/身份不明、对象缺失、执行结果未知、格式不可安全覆盖 | 独立异常/拒绝状态；先核实，不冒充普通 conflict |

LifeLoop in VS Code 是唯一 conflict-resolution control plane。Notes 展示支持范围内的 text diff，
Calendar/Reminder 展示受管 field diff。使用一致的 `Use LifeLoop` / `Use External` 标签和实际应用名，
不引入另一个叫 LifeOS 的产品。选择后重新验证双方版本、身份及绑定，写入并验证后更新 baseline、恢复同步。
差异展示后任何一侧变化则拒绝旧选择；不做自动 three-way merge、逐字段合并或 conflict markers。
Calendar 当前共享 title，不借 Resolve 改写 time/recurrence/attendees；Notes 保留富文本写入限制。
Recurring Reminder 不进入普通 complete/reopen 冲突流程。Detach 始终是用户显式选择：解除绑定、保留两侧内容。

## 6. P1：Context 与 Review 闭环

### B1–B3. 补上下文、收到回复与来源 capture

Link/Add Context 选择已经存在的 exact page，显示类型和完整路径，追加普通 Wiki link。
不自动搬迁 item/body、创建 Person 或决定参与人；链接 Person 不等于记录 Interaction。
先区分“补链接，仍 pending”和“补链接并处理完成”，避免复用 Link Project 时隐式归档。

Waiting 菜单提供 Clear local Waiting、Complete waiting task、Create next action、Schedule。
这些是用户的不同意图，不自动串联；收到回复不会自动完成原任务。执行后展示剩余继承状态和项目条件，
不自动改父级。新 next action 显式选择目标和上下文，不能把继承 Person 自动变成参与人。

Capture Selection 首版取当前 VS Code 编辑器文本快照，附可获得的文件 URI/相对路径及行范围或明确 URL，
写入现有 Inbox 格式并保留多行内容。未命名 buffer 标记来源不可持久定位；dirty buffer 标明未保存快照。
行号是当时位置，后续可能漂移；绝不据此执行任务 mutation。没有选区时引导普通 Capture。
不抓取其他应用、剪贴板历史、聊天 API 或推断远端 URL，也不执行捕获内容中的命令。

### B4–B6. 选行动与解释

Pick Next Action 从共享 actionable 查询选择未 scheduled 的任务，复用项目/停放语义，
排除已出现在 Today 的项，避免重复。无效/未知日期不能被当成“未排期”。
用稳定的现有排序和 QuickPick 文本筛选，不增加 energy/priority 分数。
选择默认进入任务上下文/Task Actions，只有明确 Schedule 才写日期；没有候选时不放宽过滤规则。

Clarify 是动作分组，不是新状态。Edit wording 使用原生源编辑；Add Next Action 使用现有 capture；
Attach Page 沿用已有安全创建。Create Project 属于 D3，未实现前不展示可用动作。
不自动重写措辞，也不保证移除某个标签后即 actionable。

Why Here 使用共享查询依据解释 due、scheduled、Waiting、project 和 direct/inherited context；
不能在 UI 重写一套筛选规则。Peek Source 使用原生 peek；缺失或过期则提供刷新/打开页面。

### B7–B9. Review 与项目缺口

Live Review 使用现有 Review section/query 和原生列表/QuickPick 进入 Task Actions 或项目动作，
支持 Reschedule、Waiting、Pause、Open Source、Capture Next Action；每次写前获取新 guard。
冻结 Markdown 仅保留历史事实，从其中跳转后重新定位当前来源，不能把快照变成永久可写 projection。

`no actionable task` 信号直接给 Capture Next Action / Open Project / Pause；
Mark Waiting 应明确针对某个 task 或捕获一条等待事项，不发明未支持的 Project Waiting 状态。
保持事实计数和共享语义，不增加 health score。

Weekly/Monthly Review 可手动展开 Unscheduled、Someday、Paused Projects；保留日期/分组范围的含义，
不把 backlog 自动塞入 Today，不写每项 review cadence、last-reviewed 或 snooze metadata。

## 7. P2：每周、长期与事件触发

### C1. Meeting Wrap-up

复用当前直接 Person links / explicit Interaction mutation：确认日期、类型、参与人后记录 Interaction；
接着可选 Capture Follow-up；最后可选 Complete related task。每步可以跳过，分别报告结果。
后一步取消或失败不撤销已记录事实，也不从第一步自动重跑。成功后在当前流程禁用重复提交该步骤；
遇到结果未知先核实 Journal，不盲目追加。不建设跨重启 workflow engine，也不承诺任意重启 exactly-once。

### C2–C3. Logbook 与 closure

Logbook 提供 Today / This week / Last week / Custom range；默认周一到周日，展示实际日期范围，
按本地日期包含两端，使用有效 completion stamps。没有可靠完成日期的项标为未知，不伪造日期。
重新打开任务可能移除 completion stamp，因此此处是“当前可查的完成事实”，不是完整的完成/重开事件历史。

Complete/Archive Project 前显示 open tasks、Waiting 和已知 Reminder/Calendar bindings；
允许 Open Source、返回处理或显式继续改项目状态。信息变化后重新展示相关检查再确认。
不自动完成子任务、detach、删除外部对象，也不声称索引发现了全部外部对象。

### C4–C5. 恢复与会前 context

Resumption brief 使用项目文字、open tasks、Waiting、已明确日期的 Journal mentions/Interactions 和完成事实。
无日期内容可作为 source context 展示，不能称为 recent；没有事实就显示未知。
不从 mtime 推断进展，不自动抽取“决定”，不要求用户维护 project summary。
先以临时只读文档复用现有渲染；恢复项目状态是独立、明确的动作。

Pre-meeting / Person Context 复用已有实现：只读显示 last Interaction、open follow-ups、相关项目和有出处的 context。
没有 exact Person/event 关联时不猜 attendee；事件读取失败不妨碍查看 Markdown facts，并明确标出缺失。

## 8. P3 与独立资格条件

### D1. Read-only Agenda

在 Today 提供紧凑 Agenda 分组，读取与用户本地当天区间相交的事件，显示时间、全天/跨日标识和读取时间。
不以“当天开始”过滤而丢失跨日事件；不做 free-time 算法，不自动生成 tasks 或绑定。
保持 Calendar 原始时区与 occurrence identity，正确处理 DST、全天区间结束边界和 recurring exceptions。
无权限、超时或旧缓存应显示不可用/过期，不能把空结果表示为“没有会议”。
只用现有 bridge 可可靠暴露的 calendar 范围；若无法证明实例身份则暂不交付相关能力。

### D2. Recent Actions / Narrow Undo

会话内有界保留最近 20 次成功的候选操作，不跨重启恢复，不作为业务历史。
首选 Schedule/Waiting 等纯 Markdown 变更；Complete/Reopen 只有证明不会隐式反转外部执行后才纳入。
每项保留必要的前后状态和定位凭据；Undo 通过命名 semantic mutation 验证当前仍等于操作后的预期状态。
任何不相关内容、继承条件、状态政策或绑定变化影响安全性时拒绝反转，不整页恢复旧文本。
旧 receipt 不能跳过重新验证。完成一个反转后重新索引；不能证明安全的项仅提供 Open Source。
普通编辑继续用 VS Code Undo；不纳入外部创建/同步、跨页面搬迁或复合流程。

### D3–D4. 项目创建与已有事件关联

Create Project 必须单独落实名称/位置选择、expected absence、原任务保留、链接/子树处理和取消/失败契约。
未有具体设计和对应测试前，使用现有 Attach Page + 原生 metadata 编辑，不把半完成行为标成 Create Project。

Existing Calendar association 暂缓，直到明确：calendar + exact event/occurrence selection、重复绑定拒绝、
recurring master 与 instance 区别、删除重建检测，以及绑定前双方 fresh validation。
不得按标题/时间相似度自动匹配。

## 9. 实现落点与复用

| 落点 | 责任 |
|---|---|
| `packages/vscode/src/commands.ts` | QuickPick 编排、Inbox flow、任务与项目入口；不复制查询/修改语义 |
| `packages/vscode/src/views.ts` | 稳定节点、局部刷新、facts 与 source/context 展示 |
| `packages/semantic-core/src/contract.ts` 及现有查询模块 | 复用 named projections；缺少具体选择规则时增加共享查询 |
| `packages/semantic-core/src/mutations/` | 复用日期、状态、capture、Inbox、页面/Interaction mutation；新增操作保留 guards |
| `packages/vscode/src/apple.ts` | 集中 sync/report/Resolve UI 与现有 workspace state |
| `packages/apple-bridge/src/calendar.ts` | 仅 D1 所需的范围读取与事件语义，不扩张默认写入范围 |

UI 与 CLI 的同名语义必须一致；UI-only selection/scroll 不需要扩成 CLI feature。
未来 AI 只能调用已命名、经用户批准且同样受 guard 约束的 mutation；本轮不增加 AI subsystem。

## 10. 验收与测试策略

测试以边界和反例为主，不以数量宣称功能完成。使用现有测试框架及 isolated mock vault；
需要格式回归时复用 trial / SB 官方示例的隔离副本，不修改原 vault 或个人 Apple 对象。

| 范围 | 必须覆盖的反例/验收 |
|---|---|
| 日期快捷动作 | 月/年边界、周一、DST、invalid date、取消；deadline 与 Calendar time 不变 |
| Inbox | 重复正文、编辑/移动/删除、重启 Resume、全部 Skip、子树/多行 Notes、可选步骤取消与失败 |
| Task selection/context | Waiting/Someday 继承、paused project、注释排除、自定义状态、direct/inherited Person、重复链接 |
| Source/mutation | CRLF、Unicode、dirty document、stale prompt、duplicate anchor、节点与光标不同、删除重建 |
| Tree/Review | 完成首/中/末项、过滤后节点消失、展开/selection/focus、冻结快照不变、从快照操作必须重新验证 |
| Capture provenance | 多行/Markdown 特殊文本、dirty/untitled buffer、无选区、来源移动后不按旧位置写入 |
| Logbook/Brief | 无完成日期、重开、范围边界、无日期 context、mtime 不作事实、缺失 event/Person 不推断 |
| Wrap-up/closure | 中途取消、后一步失败不重复 Interaction、project 确认时关联项变化、不自动触碰外部对象 |
| Sync/Resolve/report | 单边变更、双边收敛/分歧、baseline 不明、missing/recreated object、stale resolution、recurring Reminder、rich Notes 限制、补偿失败、重启后异常可见 |
| Agenda | 跨日、全天、DST、时区、recurring exception、空结果 vs 读取失败/过期、无隐式绑定或写入 |
| Narrow Undo | 后续编辑、绑定/政策变化、过期 receipt、反转失败、会话结束失效、不覆盖其他内容 |

每批先跑相关 targeted tests，收敛后跑 `npm run verify`。
涉及 UI/宿主行为时分别运行 task-only VS Code 与 VS Code + Foam gates；涉及打包时运行 packaged gate。
真实宿主必须记录版本和具体路径：VS Code/Foam 测交互共存；Notes 测完整正文/pending 冲突；
Reminders 测完成及 recurrence 特例；Calendar 测受管 title、补偿/冲突，D1 另测范围读取。
外部集成先用 fake 验证；真实 Apple 验收只用明确授权的可丢弃测试对象。宿主不可用时标 SKIP 和未获证明的能力。
历史上的 3 个 live-SB skip 与 Foam folder rename 限制不能因本轮设计完成而消失。

### 批次退出条件

| 批次 | 可交付标准 |
|---|---|
| P0 | 改期、处理恢复、任务动作与拒绝恢复可用；刷新连续性有真实宿主证据；未解决 sync 异常跨重启可见 |
| P1 | Context、Waiting、选区 Capture、Next Action、Review 和 backlog 共用现有语义；无新增业务状态 |
| P2 | Wrap-up、Logbook、closure 和受限 briefs 各自通过反例；未知历史明确呈现 |
| P3 | Agenda/Undo/Create Project 各自资格单独报告；未满足条件的项保持 deferred，不影响前面批次 |

实施时按小而完整的功能里程碑验证和提交，更新 capability/support 文档。
本设计不授权安装、发布、迁移个人 vault 或修改个人 Apple 数据。

## 11. 明确不做

本轮不做 generic Dashboard / Kanban / editable database builder、health score、复杂 priority/energy/effort metadata、
Goal hierarchy/OKR、recurrence/habits engine、generic CRM database、独立 Recent Activity subsystem、
semantic-search platform 或新 plugin/runtime framework。也不为满足本文而扩建全面 SB parity。

普通表格、图表、搜索、文件与笔记编辑继续优先采用 Foam/VS Code/现成扩展。
只有具体、反复出现的工作流不足才能重新开启这些范围；“未来可用”不足以成为实现理由。
