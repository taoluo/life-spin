# LifeLoop UX-first 近期实施与验收计划

状态：基于 `0febfe2` 的增量计划。
上位边界：[`LifeLoop_Action_Loop_UX_Consolidated_Addendum_v2.md`](./LifeLoop_Action_Loop_UX_Consolidated_Addendum_v2.md)。

## 2026-09-13 下一轮：就地处理与连续操作

本轮不扩展数据模型。长期范围与契约继续由 v2 持有；本文记录当前增量与真实宿主验收，旧方向仍保留。

- K0 连续走查 Capture、Task Actions、Quick Reschedule、Inbox、Find/Explain、Now、Progress/Cue，只修可复现的目标混淆、焦点跳动、输入丢失、重复选择和等待。
- Add from Backlog 复用 actionable、Today 和 project semantics，明确分开 Set Now、Schedule Today、Peek 和 Open。
- Waiting → Next Action 提供 Complete、Create next action、Schedule、仅清除直接 `#waiting`；不自动串联或修改父 Project。
- Find Task 在原 QuickPick 内增加 Open、Completed、Waiting、Someday、All scope，保留查询与精确 handle。
- Help Me Start 收敛为 Task Actions 内的 Edit wording、Add first/next action、Attach new context page、Waiting、Someday。

Maintenance lane 只迁移一条 Pre-meeting Brief 到已验证的只读 V8 路径，并补 Notes Process、迟到同步和 observation persistence 的真实缺口；它们不阻塞 Daily Action Loop。Calendar Agenda 标记为 `Product value: High / Implementation readiness: Needs capability spike`，只允许隔离能力验证，不读取个人事件。

退出条件是完成一项后能少找、少点、少重复输入地选择下一项，并始终保持明确的 source identity。Deferred：Narrow Undo、Create Project from Task、full Context、Context Pack、Webview、timer、AI、generic Dashboard/Kanban/database/event store。

实施状态：Add from Backlog、Waiting → Next Action、Find scope 和轻量 Make Actionable 已完成最小实现；本轮进一步完成 page-scoped Project gap、Projects 原地操作、Add Related Link、Task Actions 的 direct Person/Note Open Related Page、Live Review scopes/actions，以及 Find 可选连续预览。新增 `pastScheduled`、Plan Today，以及把**当天事实复盘与明日计划放在同一连续流程**的 Close Today and Plan Tomorrow；没有 Start/Stop、执行顺序或自动 rollover。Weekly Focus 普通 Markdown、Project Resumption、可靠日期的 Review Period Facts、Meeting Wrap-up 和关闭 Project 前的窄事实检查已有最小实现。所有写操作继续通过 guarded mutation。Pre-meeting Brief 已迁移到 `lifeloop-result:` 只读文档，并通过较早的 task-only 与 Foam 0.44.6 gate。Notes 已补“本地 Markdown 写入成功但 observation 持久化失败”的可见失败证据；现有 bridge 回归继续覆盖并发编辑、迟到 plan 和 Process 后停止同步。

Writer audit：当前每个 VS Code extension host 都会独立注册手动 sync，并在 `autoSync` 开启时创建自己的 timer；代码没有跨窗口单写者 gate。因此“当前只允许一个 writer”尚未被 enforce，多窗口 autoSync 上线前需提高 shared authority / writer admission 的优先级。默认 `autoSync=false` 限制了当前暴露面，但不构成 ownership 证明。

本轮自动证据以本文末尾的当前验证记录为准。Open Related Page 自动反例覆盖显式任务与后台编辑器冲突、direct link 范围及类型/完整路径选择；当前 task-only 与 Foam 0.44.6 GUI 已确认编辑器保持 B 时目标仍是 A、候选范围正确、精确 Note 打开、Go Back 返回 B 且 Problems 为 0。最新冷启动 task-only 又验证 Task Actions 不等待全量 task-state refresh，立即输入的完整 `Open Relat` 全部进入 QuickPick，没有前缀写进 B；Return 进入候选并打开长路径 Note，Escape 取消，`Ctrl+-` 返回 B。此前约 1000 px 的窄窗口长标题/长路径识别仍通过。后台 integration runner 仍在扩展加载前因 AppKit `_RegisterApplication` `SIGABRT` 退出。Foam 0.44.6 GUI 补证了 Live Review mutation 后原 scope 内刷新、结果消失后的相邻选择、快速 Return/Escape、Find 键盘预览与取消后恢复 query/exact handle，以及窄窗口长标题的识别、预览和 Task Actions。最新 task-only 还验证了 Capture、Capture Selection、Resume Cue 和 Waiting → Next Action 都保留后台编辑器 B 与明确目标；Live Review 清除一个 Waiting 后仍保持 Waiting scope 并选择剩余相邻项。新增晚间入口也已在 Foam 与 task-only 当前 build 中从当天事实复盘切换到明日约束与候选；task-only 还验证了单独 Plan Today 的 scope/cancel、显式安排保存、Project Resumption、Project closure-check 取消和 Review Period Facts。macOS 简体拼音通过逐键输入组合出 `ming tian`，Space 接受为“明天”，随后快速 Return/Escape 未执行 mutation。两种 profile 均返回同一编辑器且 Problems 为 0。

v2 规定长期产品范围和正确性契约；本文只管理近期体验切片。目标是：

> **编辑不卡顿 → 键盘就地操作 → 捕获后返回 → 快速找回任务 → 留下进展并继续。**

优先顺序为安全底线、高频操作的效率与连续性、实现成本。功能已存在和目标入口已在真实宿主中合格必须分开记录。

本文收缩的是近期交付职责，不删除旧需求：长期 feature、反例和资格条件继续由 v2 与原始 action-loop 设计持有；Integration 文档中的已选 ownership、未选方案及后果由 ADR 持有。改写前文本另有已校验的 non-normative recovery snapshot，只用于逐字恢复，不作为并行规范维护。

## 1. 当前 delta audit

| 路径 | 当前实现 | 近期结论 |
|---|---|---|
| Editor provider 热路径 | Code Actions 不再 eager reindex；当前文档 diagnostics 增量更新 | 已有且有回归覆盖；保留真实宿主延迟与日志审计 |
| Managed-field completion | `scheduled` / `deadline` 字段名和 Today/Tomorrow 绝对日期已在 working tree 实现 | 不扩大到 task state、binding 或 completion history |
| Quick Reschedule | Today / Tomorrow / Next week / Pick Date / Clear 已有 | 审计目标、反馈、连续操作，不重做 |
| Inbox processing | Skip、Edit Source、连续处理已有 | 审计位置、取消、失败恢复，不持久化处理游标 |
| Capture / Capture Here / Capture Selection | 三条路径已有；成功后不会强制导航 | 补普通 Capture 写入失败后的正文恢复 |
| Task Actions | 动态动作与 guarded target 已有 | 审计最短键盘路径；不得从后台光标替代显式目标 |
| Find / Explain Task | 索引搜索和有限 Today/actionable 解释已有 | 补 Find 查询与选择的 session-only 返回 |
| Find 连续预览 | 可选开启；方向键移动时后台预览当前任务，旧异步结果受 generation guard 限制 | 真实宿主比较显式 Preview 与连续预览的按键、焦点和返回体验 |
| Project page gap / actions | active Project 只报告本页 no-open、waiting-only、no-actionable；Paused 不报告 gap；稳定节点可 Preview/Open/Add Next Action/Pause | 真实宿主验证窄文案、稳定选择和操作后自然继续 |
| Add Related Link | 已有任务可选择现有 Project/Person/Note 并追加 direct link | task-only 已验证类型、完整路径与明确任务写入；Foam 的重名选择与焦点仍按需补证；不声称改变 Project ownership |
| Open Related Page | Task Actions 仅在明确任务已有 direct Person/Note link 时出现；多个候选显示类型与完整路径 | 自动测试及 task-only/Foam 的目标、候选、精确打开、返回和零 Problems已验证；冷启动 task-only 已补完整 Enter/Escape、立即输入不泄漏、长路径打开与返回，约 1000 px 窄窗口证据保留；Project 继续使用 Open Project |
| Plan Today / 当天复盘＋明日计划 | 同一连续 picker 复用 Today、Backlog 和现有 task actions；当天 completed/remaining 与明日 constraints/candidates 分 scope 呈现 | 最小实现与自动回归完成；Foam 与 task-only 当前 build 已端到端验证晚间键盘进入、scope 切换、候选、无写入取消、显式安排、刷新和返回；task-only 另验证单独 Plan Today scope/cancel 与真实简体拼音组合输入 |
| Live Review / Backlog | 一个 fresh-query QuickPick 支持 Open、Projects、Waiting、Someday、Completed、Unscheduled、Paused scopes 及对应动作；可打开下周普通 Weekly Focus note | Foam 已验证连续处理；task-only 已打开生成的下周 Focus note；Frozen Review 仍只导航 |
| Review Period Facts | 只读列出本周可靠 completion date 和明确 dated Interaction | task-only 已打开当前周只读事实文档；不声称拥有 task-created 或 Inbox-processed 历史 |
| Project Resumption / Closure | 只读恢复简报分开本页 membership 与跨页相关 context；complete/archive 前显示 open、Waiting 和已知 bindings | task-only 已打开 paused-project 简报并验证 closure facts 后取消无写入；不自动完成 task 或删除外部对象 |
| Meeting Wrap-up | exact Calendar-bound task 可独立选择 Log Interaction、Add follow-up、Complete | participant 只取 direct exact Person links；真实宿主 pending |
| Progress / Resume Cue | 共用普通 Markdown 子项和 guarded mutation | 审计保存后焦点与来源返回，不引入 session schema |
| Now | session-only Set / Return / Clear 已有 | 审计失效解释和直接返回，不加计时、跟随或跨重启 |
| External observation persistence | `0febfe2` 已让启用的 sync/Resolve 路径等待 flush 并报告失败 | 保留完整 shared authority 为独立 milestone |
| 只读派生文档 | Query Result 与 Pre-meeting Brief 已使用 custom scheme/language 的只读 provider | 已通过 task-only/Foam 共存 gate；Review/Resolve 是否迁移按实际收益逐项决定 |
| Calendar Agenda | 现有 bridge 只按 UID 读取一个 Calendar | API spike 通过，宿主权限资格未通过；不进入产品实现 |

基线 targeted tests：`commands.test.ts`、`apple.test.ts`、`views.test.ts`、`language-features.test.ts` 共 148 tests passed。历史整体验证不能自动作为本轮新改动的证据。

本轮最新增量证据：focused commands 为 51 passed；三个相关测试文件合计 143 passed；`npm run verify` 为 65 files、910 passed、3 skipped。2026-09-14 使用 VS Code 1.136.1 的隔离 task-only 与 Foam 0.44.6 Extension Development Host 补验 Focus 正确周/返回和合并后的 Project Preview：两种 profile 均打开 `Weekly/2026-09-14.md` 并保留 planning picker、scope 与长标题选择；Preview 均区分本页 open tasks 与跨页 related tasks、显示 membership 边界并返回 Project 来源；Problems 为 0，未出现 Foam provider error。普通 VS Code 的旧安装清单未作为本轮证据，也未安装或发布扩展。此前真实 VS Code runner 在测试/扩展加载前被 AppKit `SIGABRT` 阻断；较早的 task-only 27 passed / 8 Foam-only pending 与 Foam 34 passed / 1 folder-rename pending 不自动覆盖新切片。当前 Foam 与 task-only build 已补晚间 review-today → plan-tomorrow 的范围切换、候选、Escape 无写入返回，以及显式安排后刷新并返回的零 Problems 证据；task-only 还补了单独 Plan Today、真实简体拼音、Resumption/Closure 和 Review Period Facts。Open Related Page 已补两种 profile 的目标、候选、精确打开、返回和零 Problems证据，并在冷启动 task-only 中补齐 Enter/Escape、立即输入焦点和 `Ctrl+-` 返回。最新 task-only 同时验证 Capture/Selection/Resume Cue 返回，以及 Waiting mutation 后 Live Review scope/相邻选择连续性。Query Result 与 Pre-meeting Brief 的 `lifeloop-result:` 较早宿主证据仍有效；其余新增组合入口仍分别验收。

## 2. 第一切片：原有操作更快、更可恢复

### 2.1 Capture 失败恢复

正常路径保持 `调用 → 输入 → 保存 → 返回`。写入失败时必须保留用户刚输入的正文，并提供明确恢复动作。

- 已确定未写入的 refusal 可以让用户用预填原文 Edit and Retry。
- `unknown` 表示结果无法确定，不自动重试；提供复制正文和打开 Inbox 核对。
- 恢复操作不降低 checked write、durable save 或 reindex 后报告成功的条件。
- 首版只修普通 Capture；Capture Here 的 stale 恢复继续打开来源，因为旧 offset 不能作为重试许可。

### 2.2 Find Task 返回

Find 使用现有 task index 和原生 QuickPick。一次选择后仅在 extension session 内保存：

- QuickPick 的过滤文字；
- 被选择任务的 opaque handle identity；
- 可验证时恢复的活动项。

`Return to Last Find` 重新读取索引、重建候选并恢复查询。旧任务不存在或 handle 已变化时保留查询但不猜另一个任务。它不持久化、不创建第二套搜索引擎，也不从渲染标题反推 source。

### 2.3 现有路径体验审计

按真实顺序走查：

1. Capture → 保存 → 返回原工作；
2. 原文或列表中的 Complete / Reschedule / Task Actions；
3. Find → Peek/Open/Action → Return to Last Find；
4. Inbox 连续 Skip/Edit/处理；
5. Progress/Cue → 离开 → Return to Now 或 Find。

每条路径至少有一个最短键盘入口和一个可发现入口。检查重复选目标、菜单深度、输入丢失、刷新跳动、焦点抢占、结果不明和拒绝后的恢复。TreeView 选中 A、后台编辑器停在 B 时只能操作 A；目标不确定就拒绝并重新选择。

连续走查还必须检查：

- mutation 后保留仍有效的 selection、scroll、filter 和展开状态；
- 当前项离开结果集时只选择可预期的相邻项，不自动执行下一项；
- 快速重复按键不会把上一项的残留动作施加到下一项；
- 异步完成时用户已切换位置，不抢回编辑器焦点；
- 加载、空结果、scope 限制、拒绝、失败和结果未知有不同反馈；
- 长标题、窄侧栏和中文输入不隐藏日期、状态或主动作。

性能按端到端路径记录调用到可输入、候选更新、提交到 durable result、提交到可继续下一步。区分冷启动、热路径、索引更新中和外部 bridge；样本足够时报告 p50/p95，否则只报告观测值，不用“异步”代替体验证据。

## 3. Project／Review 就地处理增量

这组能力已完成最小实现，当前工作是补真实宿主 K0，而不是继续扩展功能面。

- **Project gap**：只对 active Project 陈述项目页自身的 `no open task`、`waiting only`、`no actionable task`；Paused 不产生 gap。Projects 节点稳定标识，并提供 Preview、Open、Add Next Action、Pause、Leave Unchanged。
- **Project mutation**：Add Next Action 和 Pause 都在执行时重新读取 Project，验证页面仍存在、仍是 Project、状态和版本仍符合预期。新增任务即使继续继承 Waiting/Someday，也明确报告，不自动清父级状态。
- **Add Related Link**：明确任务可选择已有 Project/Person/Note，候选显示类型和完整路径；写入 direct link 前同时验证任务和目标页。它不改变 Project ownership，因此跨页任务不会自动计入 project-page gap。
- **Live Review**：一个持续 QuickPick 支持 Open tasks、Active projects、Waiting、Someday、Completed this week、Unscheduled 和 Paused scopes。每次动作后重新查询并保留 scope、输入与合理相邻选择；Frozen Review 仍只导航。
- **Find preview**：用户可显式开关 selection preview。移动选择时用 `preserveFocus` 打开来源，generation guard 防止较慢的 A 覆盖最新 B；最终操作仍使用所选结果的 guarded handle。

后台 integration runner 仍在扩展加载前发生 AppKit `SIGABRT`。Foam GUI 已补齐 mutation 后的 Review 连续刷新与相邻选择、Find 键盘预览/取消/恢复、快速 Return/Escape 和窄窗口长标题路径；延迟的父 QuickPick hide 不再错误结束 Review session。最新 task-only 直接复验 Waiting scope：清除明确任务的 direct `#waiting` 后，父项和继承子项退出该 scope，picker 保持打开并选中剩余相邻项，后台编辑器 B 未变。task-only 也已补 Plan Today/晚间组合入口、简体拼音组合、Resumption/Closure 与 Review Period Facts。自动 stale/明确目标回归继续覆盖拒绝和 TreeView A/editor B；managed-field suggestion widget 的 IME/accept/cancel 仍由 language-feature 文档单独记录。

## 4. 第二切片：最小 V8 只读派生文档

首个迁移对象是 Query Result，随后仅因已复现的 Foam provider 问题让 Pre-meeting Brief 复用同一路径：

- 使用 `TextDocumentContentProvider` 和 LifeLoop 专用 scheme/language；
- 内容只存在内存，关闭后释放；重新从历史打开时显示已过期说明；
- 不进入 vault 文件列表或 SQLite 索引；
- 保留 Person 与 SB source ref 的只读导航；
- 首版只允许 Open Source，不从生成行执行 mutation；
- 不自动迁移 Review、Resolve，也不抽象通用派生文档平台。

该切片的目标是证明只读性、生命周期、来源导航和 Foam 共存。单元测试不能抹去真实 Foam provider 日志；task-only 与 Foam profile 都要单独记录。

## 5. 独立 Agenda spike 结论

已在不请求 Calendar 权限、不读取任何个人事件的条件下验证：

- JXA 能载入 EventKit、创建 `EKEventStore`；
- 能构造日期范围 predicate；
- 能从内存事件读取 start/end、all-day、timezone 和 recurrence 字段；
- EventKit header 明确提供同步 range query，并展开指定范围内的 recurring occurrences。

当前不能上线 Agenda：

- 当前授权状态为 `not determined`，尚未验证 VS Code 发布扩展通过 `osascript` 调 EventKit 时的 TCC/usage-description 归属；
- 现有 AppleScript bridge 只按 UID 在一个命名 Calendar 中读取，不能证明多 Calendar、重复实例、时区和 DST 契约；
- Swift helper 探针受本机 Command Line Tools/SDK 版本不匹配影响，不能作为可分发 helper 的证据。

比较后的选择：

| 方案 | 优点 | 缺口 | 决策 |
|---|---|---|---|
| 受限 Calendar AppleScript baseline | 改动最小，适合单 Calendar UX 对照 | 不能证明完整 occurrence、多 Calendar、时区和性能契约 | 可作 baseline，不作为完整 D1 |
| JXA + EventKit | 无新二进制，range/occurrence API 合适 | TCC 宿主与发布权限未验证 | 保留下一次真实宿主 spike |
| 签名 native EventKit helper | 权限与 API 契约最清楚 | 构建、签名、架构与发布成本最高 | 仅当 Agenda 使用价值被证实时考虑 |

后续资格测试使用隔离、可丢弃 Calendar，覆盖权限、多个 Calendar、全天/跨日、DST、重复例外、空结果、读取失败和新鲜度。用户未另行授权前不得读取或修改个人 Calendar。

## 6. Ownership 与独立工程线

- Markdown 仍是任务、关系、Interaction、Progress/Cue 的 durable truth。
- Foam / VS Code 继续拥有通用 PKM、文件、搜索、普通链接和编辑行为。
- External app 拥有其原生对象；LifeLoop 只执行已声明的 binding/reconciliation。
- Notes pending 在 Process 前保持现有双边编辑与 reconciliation；Process 成功后 ownership 转入 Markdown。
- legacy binding 不自动迁移。完整 durable shared sync authority 另立 milestone。

详见 [`LifeLoop_Integration_Architecture_Alternatives_and_Codex_Handoff.md`](./LifeLoop_Integration_Architecture_Alternatives_and_Codex_Handoff.md)。

## 7. 验证与退出条件

每个切片先跑 targeted tests，收敛后运行 `npm run verify`、适用的 VS Code integration gate 和 Foam 0.44.6 gate。实际 macOS + VS Code 路径另检查中文输入法、键盘接受/取消、快速连续操作、selection/scroll/focus 和 provider 日志。

如实保留：

- live SilverBullet checks 的 SKIP；
- Foam folder rename PENDING；
- 未解决的 provider 日志；
- Apple 外部读写只有 fake-backed 或无数据探针证据的部分。

本轮退出条件：

1. Capture 失败不丢正文，`unknown` 不自动重试；
2. Find → action/source 后能恢复查询和仍有效的选择；
3. Query Result 与 Pre-meeting Brief 是不入库的只读 custom-scheme 文档，并通过 task-only/Foam 共存检查；
4. 现有 Capture/Task/Inbox/Now/Progress 路径没有目标混淆或新的 provider 热路径回归；
5. Agenda 留下明确可行性证据和未通过的宿主资格，不发布半正确实现。

上述自动化证明命令注册、明确目标、dirty-buffer mutation、custom document、来源导航与 Foam ownership。当前真实宿主补证覆盖了 planning QuickPick 的简体拼音组合与 Enter/Escape，但 managed-field suggestion widget 的接受/取消、尚未逐项走查的 selection/scroll/focus 仍是独立 K0，不能由单元测试替代。

Agenda、Narrow Undo、Create Project、完整 Context、Webview、timer、AI、deep link、Context Pack 和跨工作区不进入本轮退出条件。

## 8. 当前剩余实施顺序

完整的成本、风险、收益、宿主分工和剩余候选评估维护在
[`all-in-one-app-roadmap.md`](../all-in-one-app-roadmap.md)；已完成能力及其证据只记录在
[`CAPABILITY-MATRIX.md`](../CAPABILITY-MATRIX.md)。本文只保留近期交付顺序。

1. **立即完成**：本轮 Capture/补充/返回、Open Related Page、Waiting 与 Live Review 连续性 K0 已补；剩余独立 K0 是 Meeting Wrap-up 与 language-feature 文档中的 managed-field suggestion widget。Plan Today、晚间组合入口、Weekly Focus、Project Resumption/Closure 与 Review Period Facts 已有 task-only 当前-build 证据。在启用多窗口 autoSync 前增加跨 extension-host writer admission。
2. **已完成最小实现、部分 Foam K0 已补证**：Add Related Link、page-scoped Project gap、Live Review、Find preview，以及上述 daily/weekly/project/relationship 小切片；新增入口仍不能继承旧宿主证据。
3. **独立资格**：Calendar Agenda 的真实 TCC/range/occurrence spike；Notes/Reminders/Calendar 的可丢弃真实宿主验证；Cancel/Drop、Create Project、existing-event association 分别验收自己的状态和 identity 契约。
4. **按摩擦准入**：本周候选专用操作、Paste with Source、inherited-only Inlay Hints、跨 workspace/deep link、完整 Context、Narrow Undo、timer、AI/Context Pack 和受限图表/看板。没有可复现场景时保持 Deferred。
