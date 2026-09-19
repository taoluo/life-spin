# LifeLoop 用户指南审阅决议

状态：**修改后接受**

核对基线：`0febfe2` 与 2026-09-13 当前 working tree

定位：用户指南修订与小范围 UX 验证依据，不是新的 implementation roadmap。

LifeLoop 已经具备 Capture、Plan Today、连续 Review、Now、Progress/Resume Cue、Project
Actions、Find/Explain、Brief 和 Wrap-up。本轮目标是减少理解、选择和返回成本，不重新实现
这些能力，也不因审阅提出了候选就扩展数据模型。

## 1. 审阅方法

每条意见按当前代码与 Capability Matrix 分为四类：

| 结论 | 含义 |
|---|---|
| 文档修正 | 行为已有明确证据，直接修正文案或示例 |
| UX 审计 | 能力已有，但是否需要改入口或反馈必须由真实操作证明 |
| 新能力候选 | 当前没有对应行为，不进入本轮完成条件 |
| Deferred | 与当前产品边界冲突，或收益不足以支持新增语义 |

实现状态、自动测试与真实宿主资格分别记录。测试通过不自动证明中文 IME、焦点、窄窗口、
Foam 共存或 Apple 权限行为。

## 2. 已确认的文档修正

### 2.1 Inbox、Project link 与 membership

`Process Inbox → Make task → 选择 Project` 的实际结果是：

1. 在该 Inbox item 上增加 direct `[[Project]]` link；
2. 把整项移动到同一 `Inbox.md` 的 `## Processed` 下；
3. 不移动到 Project 页面；
4. 不成为 `task.page === project` 的 Project-page member。

`Link project` 则给原内容增加 link，并同样把整项移动到 `## Processed`，但不把它改成
checkbox。用户指南必须分别说明两者的内容变化和后续含义，不能只说“选择项目”或“加入项目”。

Processed 表示 Inbox processing 已结束。Processed 下的 checkbox 仍是任务；不能把整个区域
从任务索引中排除，也不能把 Archive 描述为完成或取消承诺。

### 2.2 完成状态与期间事实

Find Task 的 Completed scope 使用当前 `done` 状态，包括没有 `completed` 日期的任务。
Review Period Facts 只包含处于目标日期范围内的明确 `completed` 日期。因此两处数量可能不同，
用户指南应直接解释这一点。

不从 checkbox、文件 mtime、发现时间或当前日期补写历史。本轮不新增完成日期回填命令。

### 2.3 Person 与 Interaction 日期

`contact-every` 只接受正整数天数加 `d`，例如 `30d`；`30` 不是有效 cadence。

Interaction 的可靠 Journal 日期来自：

- Journal 页面有效的 ISO `date: YYYY-MM-DD`；或
- Journal 页面名最后一段本身是有效的 `YYYY-MM-DD`。

普通提及、无效日期或没有 direct Person link 的 item 不构成 Interaction fact。

### 2.4 Capture 与 external sync

Recover Last Failed Capture 只保存当前 extension session 中最近一次普通 Capture 的正文。
Capture Here 和 Capture Selection 不共享这份恢复槽；不确定结果必须先检查目标位置，不能盲目
重试。

`Sync External` 依次执行 Reminder/Calendar projection sync 和 Notes import。启用 `autoSync`
后，定时器调用同一个入口，因此当前范围包含 Notes、Reminders 和 Calendar 的受支持路径。
真实 Apple、TCC、发布宿主及多窗口 writer 资格仍必须与 fake-backed 自动测试分开说明。

## 3. 已有语义需要更集中地解释

### 3.1 Today 的组合条件

Today 先排除 completed、Waiting 和 Someday，再按互斥优先级显示 overdue deadline、due today、
scheduled today 和 past scheduled；parked tasks 在 Waiting 区域单列。

| 组合 | 当前结果 |
|---|---|
| Waiting + overdue deadline | 出现在 Waiting，不进入 overdue bucket |
| scheduled 明天 + deadline 今天 | 仍进入 due today；deadline 优先 |
| paused Project + deadline | Today 不按 Project status 排除；真实 deadline 仍可出现 |
| task related 到 paused Project | Backlog 会排除它；这不是 Project-page membership |

Quick Reschedule 只修改 direct `scheduled`。当前反馈已能说明 deadline 未改变；清除 direct 值后
是否仍受 inherited value 影响，应在具体入口走查，不在文档中假定所有反馈已经完整。

### 3.2 三种返回

用户指南应集中区分：

- VS Code Go Back/Forward：回到编辑位置历史；
- Return to Last Find：恢复当前 session 中仍有效的 query、scope 和选择；
- Return to Now：重新打开当前 session 的 Now source hint。

LifeLoop 生成的结果优先使用 Open/Peek Source。SB special refs 继续由专门命令验证，不新增
第二套 link 或 rename engine。

### 3.3 主要入口与命令结果

上手应先走不依赖 Project 或 Apple 的最小闭环，再介绍 Project-page membership 与 related
link。主要命令尽量回答：保存在哪里、修改什么、不修改什么、结束后停在哪里、失败如何恢复。

Today、Inbox 和 Projects 可在 onboarding 中作为主要入口；Linked Tasks、Person Context 和
Mentions 按上下文使用。这是说明层级，不修改默认 VS Code 布局。

可提供可复制的快捷键示例，但不静默修改用户全局键位，也不建设 keymap/profile 系统。

## 4. Freeze、Bake 与模板的索引边界

三者不能统一声称“不会进入任务索引”：

| 内容 | 当前边界 |
|---|---|
| Freeze Review | 当前 renderer 输出普通 bullet，不生成 checkbox |
| 标准 query baking | `toMarkdown` 输出表格，不生成 checkbox |
| 自定义 baked output | baked body 是普通 Markdown；若自定义 Space Lua 输出 checkbox，它可被索引 |
| 内置 Weekly Focus/Review 模板 | 内置正文不复制活跃 checkbox |
| 自定义模板页面 | 仍是 vault 中的普通 Markdown；其中的 checkbox 可被索引 |

教程应建议：正式承诺使用 Task；资料、比较、模板示例使用普通文字、列表或表格。当前没有
“可勾选但不进入 LifeLoop”的局部 checklist 语义，不虚构标签约定，也不新增 task type。

## 5. 修改后接受的 UX 处置

| 项目 | 当前复用点 | 本轮决定 | 证据与限制 |
|---|---|---|---|
| Project Preview 显示本页与 related 两组 | Project Resumption Brief 已提供两组结果，且 active Project 也可调用 | 已把 Project Actions 与 Live Review 的 Preview 统一到现有只读结果 | 自动测试覆盖两组来源、只读路径及 Review scope/query/selection 恢复；2026-09-14 的隔离 task-only/Foam 0.44.6 宿主确认两组显示、membership 说明、来源返回与 0 Problems |
| Plan Today 打开本周重点 | Weekly Focus 模板、日期工具和连续 planning picker | 已增加“规划日期所在周”的 Focus 入口 | 自动测试覆盖 Plan Today、前晚规划跨周及返回位置；2026-09-14 的隔离 task-only/Foam 0.44.6 宿主确认正确周文件、picker/scope/长标题选择保留与 0 Problems |
| 操作后直接显示 Why | Explain Task；scheduled 修改已提示 deadline 未变 | 对可复现的 inherited parked tag 缺口补窄提示 | 移除 direct `#waiting/#someday` 后若仍继承同一 tag 会明确说明；不新增 explanation framework |
| 可选日常快捷键方案 | VS Code Keyboard Shortcuts | 只给文档示例 | 未修改用户全局键位 |
| “完成但日期未知”专门 UI | Find Completed 与 Period Facts 已有不同语义 | 用户指南轻量说明 | 不推断或补写 completion history |
| 跨场景教程 | 已有 Task、Waiting、source 与 Review | 后续附录候选 | 本轮未新增场景模型 |

Close Today and Plan Tomorrow 已允许在同一 picker 中自由选择今日回顾、明日计划和明日
Backlog scopes；已有自动与真实宿主 K0。它不是本轮新功能缺口。

## 6. 继续 Deferred

- 自动推断或补写 completion history；
- 新 `next-check` 字段；
- 局部 checklist 新类型；
- 新 Project membership、Context、planner、持久排序或 event store；
- 为 SB special refs 接管 Foam link/rename；
- 未完成真实资格的 Apple 扩张或 Calendar Agenda 产品实现。

等待检查的当前推荐方式是保留原 Waiting 事实，并另建明确的检查任务或使用已获资格的外部
Reminder。给 Waiting item 设置 `scheduled` 不会自动清除 Waiting，也不能被描述成通知。

## 7. 验收与退出

文档修订检查示例、命令名、本地链接和 Markdown 格式。行为改变才增加对应自动测试；宿主 UX
主张必须另做 task-only/Foam K0，覆盖键盘、中文 IME、快速 Enter/Escape、焦点、dirty buffer
和 stale source。

本轮退出条件：已确认事实在用户指南中准确；两项已批准的导航增强通过自动回归，并如实标出
尚缺的真实宿主证据；其余候选没有被写成已实现。
