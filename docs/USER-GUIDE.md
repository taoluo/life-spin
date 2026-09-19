# LifeLoop 用户指南

LifeLoop 帮你把分散在 Markdown 中的事项接成一个可继续的行动闭环：

> **捕获 → 补充背景 → 选择行动 → 完成或调整 → 留下下一步 → 回顾**

你的 Markdown 文件是持久事实。LifeLoop 的 Today、Projects、Review 和查询结果都从这些
文件计算出来；`.lifeloop/index.sqlite` 只是可重建索引。

本指南以 VS Code 版为主。LifeLoop 负责任务语义、安全修改、执行和回顾；
[Foam](https://marketplace.visualstudio.com/items?itemName=foam.foam-vscode) 负责普通 Wiki link、
backlink、graph、tag、Daily Note 和一般模板；VS Code 负责文件、搜索、编辑和 Git。

## 使用 Demo Vault 对照学习

仓库包含一份不接触个人数据或 Apple 对象的日期化 Demo。运行：

```bash
npm run demo:vault
```

命令会在 `dist/lifeloop-demo-vault-YYYY-MM-DD` 创建新目录，并拒绝覆盖已有目录。在 VS Code 中
打开命令输出的文件夹，从 `START-HERE.md` 开始，依次练习 Capture、Inbox、Plan Today、Now、
Progress/Cue、Find、Project Preview、Weekly Review 和受管字段补全。Demo 内同时准备了
task-only 与 Foam 共存时可观察的链接、中文输入和长标题场景。

首版教程使用命令名、示例数据和预期结果，不绑定特定 VS Code 主题或窗口布局。完整语义边界和
故障排查仍以本指南为准。

---

## 1. 十五分钟上手

### 1.1 准备工作区

LifeLoop 需要 VS Code 1.102 或更新版本。Foam 不是必需，但推荐同时使用；当前验证过的
Foam 0.44.6 需要 VS Code 1.110 或更新版本。

从本仓库安装开发版本：

```bash
npm install
npm run install-extension
```

安装后，在 VS Code 中打开一个存放 Markdown 文件的文件夹。LifeLoop 不会在激活时转换
已有笔记，也不会自动修改 Apple 应用。

第一次使用不需要先建立 Project，也不需要连接 Apple 应用。先完成一条本地任务闭环，再决定
是否需要项目组织或外部执行。

### 1.2 捕获一件事

打开 Command Palette，运行 **LifeLoop: Capture**，输入：

```text
准备申请材料
```

LifeLoop 会把它加入默认的 `Inbox.md`。Capture 不要求你立刻决定 Project、日期或优先级。

另外两种入口：

- **LifeLoop: Capture Here**：在当前 Markdown 位置插入一条任务。
- **LifeLoop: Capture Selection with Source**：保存当前选区，同时记录当时可获得的来源。

Capture Selection 的路径和行号是 provenance，方便以后找回；它们不是永久定位凭据，也不
会授权将来的任务修改。

### 1.3 处理 Inbox

运行 **LifeLoop: Process Inbox**。对刚才的内容选择 **Make task**。第一次可以跳过 Project，
然后选择 Today、具体日期、Waiting，或跳过时间安排。

Make task 会把原内容改成 checkbox，并把整项移动到同一 `Inbox.md` 的 `## Processed` 下。
如果同时选择 Project，只会在任务上增加 direct Project link；任务不会移动到 Project 页面，
也不会因此成为 Project-page member。

Inbox 还支持：

- **Link project**：给原内容增加 Project link，并把整项移动到同一 Inbox 的 Processed；不把
  原内容改成 checkbox。
- **Skip**：本轮不处理，继续下一项。
- **Edit source**：打开原文编辑，稍后重新运行 Process Inbox。
- **Archive**：原样移动到 Processed，结束本次 Inbox processing；如果原内容已经是 checkbox，
  它仍然是任务，并没有因此完成或取消。

取消、过期或写入失败时，LifeLoop 不会把该项假装成已经处理。

### 1.4 选择今天，而不是制造假期限

运行 **LifeLoop: Plan Today**。你会看到真实期限、已有安排、未处理的旧安排和可选择的
Backlog。选择任务后可以：

- **Schedule Today**：写入今天的 `scheduled`；
- **Set Now**：只把它设为当前会话的工作目标；
- **Open / Preview**：先查看背景。
- **Open focus for week …**：打开今天所在周的普通 Weekly Focus note；返回后保留当前
  planning scope、输入和选择。

Schedule Today 和 Set Now 是两个独立意图。Plan Today 不会要求你给每个任务排序，也不会
记录 Start/Stop 或自动把所有旧任务滚到今天。

### 1.5 开始、调整并留下下一步

从 Today 或任务行打开 **LifeLoop: Task Actions**：

- **Set as Now**，然后打开来源；
- 用 **Add Progress / Resume Cue** 写下进展或下一步；
- 计划变化时用 **Quick Reschedule**；
- 需要别人回复时选择 **Mark Waiting**；
- 完成后选择 **Complete**。

`Now` 只存在于当前 extension session，不改变任务状态、`scheduled` 或 Calendar。完成任务的
命令会同时维护 `[completed: "YYYY-MM-DD"]`；直接用其他编辑器勾 checkbox 只是文本编辑，
不保证产生 completion fact。

### 1.6 找回工作并结束一天

运行 **LifeLoop: Find Task**，选择 Open、Completed、Waiting、Someday 或 All scope。你可以
Preview、Open Source 或执行 Task Actions。退出后运行 **LifeLoop: Return to Last Find**，会
恢复仍有效的查询和选择。

晚上运行 **LifeLoop: Close Today and Plan Tomorrow**：

1. 查看当天可靠的完成事实和仍未完成的安排；
2. 对剩余事项保持、改期、Waiting 或 Someday；
3. 查看明日约束和候选，明确安排需要的任务。

其中 **Open focus for week …** 按明天所在周打开 Focus note；周日晚上会打开次日周一开始的
新一周。返回后仍停留在原 planning picker。

在同一个 picker 中可以只查看今日、直接切换到明日计划、两者都做，或随时退出。它适合把
当天复盘和前一晚的明日规划放在一起，也可以完全跳过。LifeLoop 不要求清空 Inbox、填写反思
或把所有未完成任务滚到明天。

### 1.7 需要时再加入 Project

Project 是带明确身份的普通 Markdown 页面：

```markdown
---
tags: project
status: active
---

# Outcome

完成申请并收到确认。

# Tasks

- [ ] 准备申请材料
```

文件可以保存为 `Projects/Application.md`。项目身份来自 `tags: project`，不来自文件夹名。
写在这个页面上的任务属于 Project-page membership；Inbox、Journal 或会议记录里的任务即使
链接 `[[Projects/Application]]`，也只作为 related task。Project Actions 中的
**Preview project context** 可同时查看这两组事实，active 和 paused Project 都可使用。

---

## 2. 必须先理解的 Markdown 语义

### 2.1 Task 与日期

普通 Markdown checkbox 就是 Task：

```markdown
- [ ] Review application [deadline: "2026-09-18"] [scheduled: "2026-09-16"]
```

| 字段 | 表示什么 | 不表示什么 |
|---|---|---|
| `deadline` | 事情何时必须完成或开始产生后果 | 你打算哪天做 |
| `scheduled` | 你主动安排在哪一天处理 | 最终期限或 Calendar 时间块 |
| `completed` | 命名完成动作记录的日期事实 | 从当前 checkbox 状态猜出的历史 |
| `reminder` | 已绑定 Reminder 的身份 | deadline 或通知时间本身 |
| `event` | 已绑定 Calendar event 的 UID | 任务已经执行或完成 |

Task Actions、Code Actions 和 managed-field completion 可以帮助写入这些值。日期使用本地日历
日和 ISO 格式，不用固定 24 小时推算“明天”。

### 2.2 Waiting 与 Someday

```markdown
- [ ] 等待对方确认 #waiting
- [ ] 以后也许整理旧照片 #someday
```

Waiting 和 Someday 会让任务离开 actionable 集合。它们可以通过父列表或上下文继承，因此
清除任务行上的直接 tag 后，任务仍可能因为继承值继续处于 Waiting/Someday。此时用
**Explain Task** 查看原因。

收到回复不自动意味着：

- 原 Waiting 任务已经完成；
- 一定要创建下一行动；
- 父 Project 应改变状态；
- 相关 Person 自动成为 Interaction participant。

使用 **Waiting to Next Action**，明确选择 Complete、Create next action、Schedule 或
Clear Waiting。

如果仍在等待、但需要周五主动检查，保留原 Waiting 事实，并另建一条明确的检查任务安排到
周五；也可以在真实 Apple 资格已验证后使用 Reminder。给 Waiting item 设置 `scheduled`
不会清除 Waiting，也不等于创建通知。

### 2.3 Project membership 与 related link

首版 Project 统计只把**写在 Project 页面上的任务**算作该 Project 的成员：

```markdown
Projects/Application.md
- [ ] Prepare references
```

其他页面中的任务即使链接 `[[Projects/Application]]`，也只是 related task，不会自动改变
membership。因此界面会说“本项目页面没有可执行事项”，不会声称“整个项目没有下一步”。

两种不同操作：

- **Attach Page to Task**：创建一个新页面，并把新页面链接加到任务；
- **Add Related Link**：从已有 Project、Person 或 Note 中选择一个，给任务增加 direct link。

Add Related Link 不会移动任务、创建页面、Process Inbox 或创建 Interaction。

### 2.4 Direct 与 inherited context

LifeLoop 保留 SilverBullet 的对象语义：子任务可以继承父列表或页面的 tags 和 links。界面在
能证明时会区分 direct 与 inherited。相似标题、相近日期或共同出现不会被猜成关系。
移除任务行上的 direct `#waiting` 或 `#someday` 后，如果父级仍提供同一 inherited tag，结果
会明确说明任务仍处于该有效状态。

### 2.5 哪些内容会成为任务

任何进入 canonical Markdown 的 checkbox 都可能成为 LifeLoop Task，包括 Processed、自定义
模板页面或自定义 baked output 中的 checkbox。正式承诺使用 checkbox；参考资料、比较维度、
模板示例和流程说明优先使用普通文字、表格或不带 checkbox 的列表。当前没有“可以勾选但不
进入 LifeLoop”的局部 checklist 类型。

---

## 3. 六个侧栏视图

第一次使用先看 Today、Inbox 和 Projects。Linked Tasks、Person Context 和 Mentions 是随当前
页面或身份按需使用的上下文视图。

| 视图 | 用途 | 关键边界 |
|---|---|---|
| **Today** | Overdue、Due、Scheduled、Past Scheduled、Waiting | 各日期 bucket 去重；显示不等于承诺今天全部完成 |
| **Projects** | Active/Paused Project 与窄范围 signals | signal 只陈述测量到的项目页面事实 |
| **Inbox** | 查看和处理未整理捕获 | Processed 不再作为 pending；其中的 checkbox 仍是任务 |
| **Linked Tasks** | 当前页面明确关联的任务 | 不取代 Foam backlinks |
| **Person Context** | 当前 Person 的互动与 follow-up | 只使用明确 Person 和 Interaction facts |
| **Mentions** | 指向当前 identity 的 `@name` | identity 未配置时不猜用户是谁 |

常用操作可以从视图行末的 action、右键菜单或 **Task Actions** 进入。TreeView 选择任务 A、
编辑器光标位于任务 B 时，操作必须以明确传入的 A 为目标；如果凭据过期，LifeLoop 会拒绝，
不会静默回退到 B。

---

## 4. 日常执行参考

### Today 为什么出现这项任务？

Today 按以下事实分组，并让每项只出现一次：

1. deadline 已过；
2. deadline 是今天；
3. scheduled 是今天；
4. scheduled 早于今天且任务仍未完成；
5. Waiting 项目单独显示。

常见组合的结果：

| 组合 | Today / Backlog 行为 |
|---|---|
| Waiting + overdue deadline | 在 Waiting 显示，不进入 overdue bucket |
| scheduled 明天 + deadline 今天 | deadline 优先，仍在 Due Today |
| paused Project 中有真实 deadline | Today 不因 Project paused 而隐藏真实期限 |
| 任务在其他页面关联 paused Project | 不改变 membership，但会从 Backlog 候选中排除 |

运行 **LifeLoop: Explain Task** 或在 Task Actions 中选择 **Why here?**，可以看到当前共享
predicate 给出的原因。数据过期或无法解释时，LifeLoop 应明确表示，而不是在 UI 复制一套
筛选逻辑。

### Quick Reschedule

快捷目标包括 Today、Tomorrow、Next week、Pick Date 和 Clear scheduled。它只修改
`scheduled`：

- 不修改 deadline；
- 不移动 Calendar event；
- Clear 只清除任务行上的 direct scheduled；
- 修改 scheduled 时会明确说明已有 deadline 未改变。

### Add from Backlog

Backlog 是可执行、尚未安排、未进入 Today、不是 Waiting/Someday，而且既不位于也没有通过
有效 links 关联 paused Project 的 open tasks。选择后可以 Set Now、Schedule Today 或
Open/Preview。Set Now 与 Schedule 不会自动合并。

### Make Actionable

这是 Task Actions 中的一组轻量动作，用于：

- 修改措辞；
- 添加 first/next action；
- 补上下文；
- 设为 Waiting；
- 设为 Someday。

它不会用 AI 自动拆解任务，也不会增加 effort、energy 或 difficulty metadata。

---

## 5. Project：发现事实、原地决定、继续

Project 页面使用：

```yaml
---
tags: project
status: active
---
```

支持的状态为 `active`、`paused`、`completed` 和 `archived`。

Active Project 可能显示：

- 本页没有未完成任务；
- 本页事项都在 Waiting；
- 本页没有 actionable task，并列出 Waiting/Someday 数量；
- 本页存在 overdue task；
- Project 页面长时间未修改。

“页面未修改”不是“项目没有进展”；工作可能发生在 Journal、会议记录或外部系统中。

从 Projects 运行 **Project Actions** 可以 Preview Project Context/Open、Add Next Action、
Pause 或 Leave Unchanged。Preview 使用只读结果，同时列出本页和其他页面的明确 related
工作；从结果打开来源后可用 VS Code Go Back 返回。Add Next Action 会写入明确 Project 页面；
若新任务仍继承 Waiting/Someday，界面会说明，而不会假装 gap 已解决。

需要核对 active 或 paused Project 的背景时，运行 **Project Resumption Brief**。只读简报分别列出：

- Project 页面上的 open tasks；
- 其他页面中明确 related 的 open tasks；
- 有可靠日期的近期完成事项；
- 已知 Reminder/Calendar bindings。

完成或归档前的 Closure Facts 也只报告这些可证明事实，不自动完成子任务或清理外部对象。

---

## 6. Weekly Review

### 创建与连续处理

运行 **LifeLoop: Weekly Review** 创建本周 Review。默认模板包含 Completed、Still open、Active
projects、Waiting、Inbox 和 Reflection，也可以在 `Templates/Review.md` 中自定义。

运行 **LifeLoop: Review in Place**，在一个持续的 Quick Pick 中切换：

- Open tasks；
- Active projects；
- Waiting；
- Someday；
- Completed this week；
- Unscheduled；
- Paused projects。

每个动作单独取得 fresh handle。处理后重新查询并尽量保留 scope、输入和合理相邻选择；取消
或失败留在当前项，不把整批流程假装成成功。

### Weekly Focus

**LifeLoop: Open Next Week Focus** 创建普通的 `Weekly/YYYY-MM-DD.md`，用于记录少量下周重点、
相关 Project/Page 和 Not This Week。它引用已有工作，不复制第二组活跃 checkbox，也不会在
移出候选时改变原任务状态。

Plan Today 会打开今天所在周的 Focus；Close Today and Plan Tomorrow 会打开明天所在周的
Focus。两条入口均以只保留预览焦点的方式打开，并返回原 planning scope、输入和选择。

### Review Period Facts 与 Freeze

**Review Period Facts** 只列出：

- 本周有明确 `[completed: ...]` 的任务；
- 有可靠 Journal 日期的明确 Interaction。

当前没有可靠 task-created 或 Inbox-processed 时间戳，因此不会伪造“本周新增任务”或
“本周处理 Inbox”统计。

Find Task 的 Completed scope 回答“哪些任务当前是完成状态”，包括没有 `completed` 日期的
checkbox；Review Period Facts 回答“哪些完成事实有可靠日期且落在本周”。两处数量不同不表示
索引丢失。LifeLoop 不从 mtime、发现时间或当前日期猜补历史。

**Freeze Review** 把当时的 Review 变成历史 Markdown 快照。冻结文字只能用于查看和导航；
任何后续写入仍必须回到当前来源重新验证。当前 Freeze renderer 使用普通 bullet，不复制
checkbox，因此冻结结果不会形成第二组任务。

---

## 7. 查找、预览和返回

### Find Task

Find Task 支持关键词和以下 scopes：Open、Completed、Waiting、Someday、All。选择结果后可以：

- Preview 当前项；
- Open/Peek Source；
- 打开 Task Actions；
- 返回上一条或下一条继续查看。

Preview 会显示必要的页面或父级背景，但不会修改 Now，也不构成写入授权。较慢的旧 preview
结果不会覆盖当前选择。

### 三种返回

| 要回到哪里 | 使用方式 | 生命周期 |
|---|---|---|
| 上一个编辑位置 | VS Code Go Back/Forward；macOS 默认 `Ctrl+-` / `Ctrl+Shift+-` | VS Code 导航历史 |
| 上一次 Find | **LifeLoop: Return to Last Find** | 当前 extension session；恢复仍有效的 query、scope 和选择 |
| 当前目标 | **LifeLoop: Return to Now** | 当前 extension session；来源会重新验证 |

### Open Related Page

当任务已有 direct Person/Note links 时，Task Actions 会显示 **Open Related Page**。多个候选
显示页面类型和完整路径，方便辨认同名或长路径材料。Project 仍使用 **Open Project**。

打开后使用 VS Code 的 Go Back（macOS 默认 `Ctrl+-`）返回。普通文件定位、全文搜索、版本
历史和任意页面跳转继续使用 VS Code、Foam 和 Git。

### SB special refs

对 `[[Page@anchor]]` 或 `[[Page@position]]`，把光标放在引用中并运行
**LifeLoop: Open SB Reference at Cursor**。普通 Foam click 可能把它当成文件名；不要选择
“创建 Page@anchor 页面”。LifeLoop 会拒绝 missing 或 ambiguous target，也不会自动创建文件。

---

## 8. Person、Interaction 与会议

Person 是普通 Foam 页面：

```yaml
---
tags: person
groups:
  - friends
birthday: 1990-05-20
contact-every: 30d
---
```

只有需要相应功能时才填写可选字段。`contact-every` 使用正整数天数加 `d`，例如 `7d` 或
`30d`；没有单位的 `30` 会被忽略并产生诊断。

### Interaction

在有明确 Person link 的上下文中运行 **LifeLoop: Log Interaction**。Interaction 写入有可靠
日期的 Journal 页面，例如：

```markdown
- Discussed next interview with [[People/Alice]] [interaction: meeting]
```

可靠日期来自 Journal 页有效的 ISO `date: YYYY-MM-DD`，或页面名最后一段本身是有效的
`YYYY-MM-DD`。无效日期、普通提及或没有 direct Person link 的 item 不计为 Interaction。

Person Context、last interaction、reconnect 和 recent interactions 都从这些事实推导，不写回
缓存。普通提及或 `@mention` 不算 Interaction。

### Mentions 与签名

设置 `lifeloop.identity` 后，输入 `@` 可以补全已知 identity。Mentions 视图显示指向自己的
mention；References 查找同一 identity 的出现位置。**Sign This Block** 给当前 block 增加当前
identity，不配置时不会猜测。

### Reconnect、Pre-meeting 与 Wrap-up

- **Create Reconnect Task**：为当前 Person 创建普通 follow-up task；
- **Pre-meeting Brief**：对 exact Calendar-bound task 汇总明确 Person 和本地背景；
- **Meeting Wrap-up**：分别选择 Log Interaction、Add follow-up、Complete。

Meeting Wrap-up 的每一步都可跳过。participant 只取 direct exact Person links，不从标题、
attendees 或上下文相似度推断。

---

## 9. 编辑器帮助

LifeLoop 在 Markdown 中提供受限 language features：

- `scheduled` / `deadline` 字段名与日期 completion；
- Today/Tomorrow 候选显示并插入同一个绝对 ISO 日期；
- LifeLoop query 的 projection、参数、字段和 Person completion；
- Task、Project、Interaction 和 query diagnostics；
- Quick Fix / Code Actions；
- Document Symbols、Hover、Definition 和 References；
- query result count CodeLens；
- Reminder/Calendar 的轻量 decoration 和 action Hover。

不完整输入也可以触发受管字段补全：

```markdown
- [ ] Review results [sche
```

LifeLoop 不接管普通 Wiki link、页面路径或 heading completion，也不在代码块和普通 Markdown
文字中看到 `[` 就随意触发；这些继续由 Foam/VS Code 处理。接受 completion 只是文本编辑，
不会自动完成任务、创建外部对象或写历史事实。

默认快捷键只有：

| 快捷键 | 命令 |
|---|---|
| macOS `Cmd+Enter` / 其他平台 `Ctrl+Enter` | Cycle Task State |
| macOS `Cmd+Shift+B` / 其他平台 `Ctrl+Shift+B` | Update Baked Sections |

其他命令可以在 VS Code Keyboard Shortcuts 中自行绑定。LifeLoop 不静默修改全局快捷键。

---

## 10. 查询与只读结果

在 Markdown 中使用 `lifeloop` fenced block：

````markdown
```lifeloop
today
```
````

常用 projections：

| Projection | 回答的问题 |
|---|---|
| `today` | 今天的 overdue、due、scheduled、past scheduled 与 Waiting |
| `upcoming` | 未来 N 天的 scheduled/deadline tasks |
| `review` | 指定周的 live Review sections |
| `signals` | 一个 Project 的窄范围 signals |
| `open` | 所有未完成任务 |
| `actionable` | 未完成且非 Waiting/Someday 的任务 |
| `parked` | Waiting/Someday，包括继承 |
| `universe` | 除 comment 内内容之外的全部任务 |
| `backlinks` | 明确提到某页面的页面 |
| `broken` | 无法解析的 links |
| `people` | Person pages 与推导关系事实 |
| `interactions` | 可按 Person、日期或 kind 过滤的 Interaction |
| `reconnect` | 到达明确 contact cadence 的 Person |
| `person-context` | 一个 exact Person 的关系背景 |

示例：

````markdown
```lifeloop
interactions
person: People/Alice
from: 2026-09-01
to: 2026-09-30
kind: meeting
fields: date, kind, text, people
limit: 20
```
````

CodeLens 显示结果数量，Hover 显示 Markdown 结果，**Open Query Result** 打开只读的
`lifeloop-result:` 文档。只读结果不写入 vault、不会进入 canonical index，也不会产生重复任务。

### Baking

**Bake Section at Cursor** 把受支持的动态结果写成普通 Markdown；**Update Baked Sections**
重新计算；**Unbake** 恢复动态表达。Baking 用于需要可复制静态内容的窄场景，不是通用发布
系统。标准 query baking 输出表格，不生成 checkbox；baked body 仍是 canonical Markdown，
所以自定义 Space Lua 若明确输出 checkbox，它会像其他 checkbox 一样进入任务索引。修改来源后
仍需按来源语义重新验证。

---

## 11. Apple Notes、Reminders 与 Calendar

> 当前自动正确性主要由 fake-backed tests 证明。真实 Apple 应用、TCC 权限、发布宿主和多窗口
> writer 仍有未完成资格。先在隔离、可丢弃对象上验证，不要把个人数据当测试数据。

### 分工

| 系统 | 拥有的事实 | LifeLoop 做什么 |
|---|---|---|
| Markdown | commitment、任务文字、deadline、scheduled、completion | canonical source 与 guarded mutation |
| Reminders | 通知、提醒执行、recurrence | 创建/绑定，有限 completion reconciliation |
| Calendar | 时间区间、全天、recurrence、location、attendees | 绑定并共享有限 task title；event 结束不完成任务 |
| Notes | 手机端捕获与 pending 正文 | 从指定 folder 导入 Inbox，Process 后转交 Markdown 管理 |

### 设置与入口

- `lifeloop.notesFolder`：只读取指定 Notes folder，默认 `LifeLoop Inbox`；
- `lifeloop.reminderList`：新 Reminder 的目标 list；
- `lifeloop.calendarName`：新 Calendar event 和现有 binding lookup 的单一 Calendar；
- `lifeloop.eventMinutes`：新 event 默认时长；
- `lifeloop.autoSync`：默认 `false`；启用后定时调用同一个 Sync External 入口；
- `lifeloop.syncMinutes`：autoSync 间隔。

常用命令：Add Reminder、Add to Calendar、Sync External、Show External Sync Report、Resolve
External Sync Conflict、Open External App、Detach External Binding、Copy External Binding ID。
Sync External 当前依次处理 Reminder/Calendar projection sync 和 Notes import；autoSync 因此也
覆盖这三条受支持路径。任何一条仍受各自权限、配置和真实宿主资格限制。

### Sync 与 conflict

正常单边变化可以同步；双方均改变时，binding 保留并暂停，进入 Resolve：

- **Use Markdown / LifeLoop**：重新验证后覆盖受管 external fields；
- **Use Apple / External**：重新验证后接受 external 版本；
- **Detach**：明确解除 binding，保留两侧内容。

Calendar 当前只共享受管 title，不借 Resolve 修改 time、recurrence、attendees 或 location。
Notes rich text 不承诺无损 Markdown round trip。Recurring Reminder 不进入普通 reopen 流程。

如果持久化、补偿或最终验证不确定，LifeLoop 会停止受影响操作并报告 uncertainty，不会把
`unknown` 当作成功，也不会盲目重试可能已经执行的外部写入。

---

## 12. 配置参考

| 设置 | 默认值 | 用途 |
|---|---:|---|
| `lifeloop.inboxPage` | `Inbox` | Capture 目标页面 |
| `lifeloop.reviewFolder` | `Reviews` | Weekly Review folder |
| `lifeloop.upcomingDays` | `14` | Upcoming horizon |
| `lifeloop.staleDays` | `21` | Project page unchanged signal 的天数 |
| `lifeloop.reminderList` | 空 | 新 Reminder list；空表示系统默认 |
| `lifeloop.calendarName` | `Calendar` | event 创建与 binding lookup 的 Calendar |
| `lifeloop.eventMinutes` | `60` | 新 Calendar event 默认分钟数 |
| `lifeloop.notesFolder` | `LifeLoop Inbox` | Notes 导入 folder |
| `lifeloop.autoSync` | `false` | 周期性运行 Sync External：Notes、Reminder、Calendar 的当前受支持路径 |
| `lifeloop.syncMinutes` | `5` | autoSync interval |
| `lifeloop.queryCodeLens` | `true` | query block 上方显示结果数量 |
| `lifeloop.executeSpaceLua` | `false` | 允许运行受限 Space Lua |
| `lifeloop.spaceLuaBudgetMs` | `2000` | 单个 Space Lua script 时间预算 |
| `lifeloop.taskStates` | 空 | 自定义有序 task state policy |
| `lifeloop.identity` | 空 | Mentions 与 Sign 使用的 `@name` |

修改 task state policy 后，LifeLoop 会重新验证和重建相关索引；不认识的 state 会拒绝，而
不是悄悄映射成 done/open。非 `[ ]`、`[x]` marker 对其他 Markdown 工具未必仍是 checkbox。

---

## 13. 高级能力

### Space Lua 与 SilverBullet compatibility

Space Lua 默认关闭。启用后可以运行受限、只读、有限时的脚本，以及部分保留的声明：

- `command.define`：通过 **Run Declared Command** 选择和执行；
- `taskState.define`：提供有序 task states；
- `actionButton.define`：适配为 VS Code status bar command；
- safe `space-style`：只用于受限 Markdown preview 样式；
- SLIQ、query rendering 和 allowlisted widget output。

这不是完整 SilverBullet runtime。任意 JavaScript import、shell、network、后台 service、通用
event bus、持久 message queue 和任意 DOM access 都没有因为脚本存在而获得执行权限。

**Report Unsupported Blocks** 可以查看当前 workspace 中未支持或只保留声明的 block。
**Toggle X-Ray** 显示 LifeLoop 索引对象的 JSON，适合解释和调试，不是普通工作视图。

### Outline 操作

Move Item Up/Down、Indent/Outdent 使用当前 Markdown 列表结构，并保持 subtree 一起移动。
LifeLoop 不占用 VS Code 常用的 Alt-arrow 默认编辑键；需要时自行绑定这些命令。

### CLI

CLI 与 VS Code 使用同一个 projection contract：

```bash
npx tsx packages/cli/src/main.ts index ~/vault
npx tsx packages/cli/src/main.ts query ~/vault today
npx tsx packages/cli/src/main.ts query ~/vault interactions --person People/Alice --json
npx tsx packages/cli/src/main.ts dump ~/vault
```

`index --rebuild` 删除并重建指定 index；`--db :memory:` 可用于一次性验证；自定义 task states
必须通过 `--task-states '<json>'` 显式传入，CLI 不会读取 VS Code workspace settings。

---

## 14. 命令地图

不必记住全部命令。日常使用优先记住 Capture、Process Inbox、Plan Today、Task Actions、Find
Task、Review in Place 和 Close Today and Plan Tomorrow。

| 场景 | 命令 |
|---|---|
| Capture / Inbox | Capture、Capture Here、Capture Selection with Source、Recover Last Failed Capture、Open Inbox、Process Inbox |
| 日／周计划 | Today、Plan Today、Close Today and Plan Tomorrow、Add from Backlog、Weekly Review、Review in Place、Open Next Week Focus、Review Period Facts、Freeze Review |
| Task lifecycle | Task Actions、Complete、Reopen、Set Deadline、Set Scheduled、Quick Reschedule、Toggle Waiting、Toggle Someday、Waiting to Next Action、Make Actionable |
| Context / source | Add Next Action、Add Progress / Resume Cue、Attach Page to Task、Add Related Link、Open/Peek Source、Explain Task、Find Task、Return to Last Find |
| Now | Set Task as Now、Return to Now、Clear Now |
| Project | Project Actions、Set Project Status、Project Resumption Brief、Open Project（Task Actions 内） |
| Person | Log Interaction、Create Reconnect Task、Meeting Wrap-up、Pre-meeting Brief、Show Mentions、Sign This Block |
| External | Add Reminder、Add to Calendar、Sync External、Show External Sync Report、Resolve External Sync Conflict、Open External App、Detach Binding、Copy Binding ID |
| Query / Lua | Open Query Result、Evaluate Space Lua、Run Space Lua Blocks、Run Declared Command、Add Declared Action Buttons、Report Unsupported Blocks |
| Editing / maintenance | Cycle Task State、Move Item Up/Down、Indent/Outdent、Bake/Unbake/Update Baked Sections、Toggle X-Ray、Rebuild Index、Refresh |
| Compatibility | Open SB Reference at Cursor |

某些底层命令只从 Task Actions、Hover 或 context menu 出现，Command Palette 会隐藏它们，避免
没有明确目标时误用。

---

## 15. 恢复与故障排查

### 操作说目标已经改变

LifeLoop 在菜单打开后不会把旧快照当作写入许可。重新打开来源或视图、确认当前内容，再执行
动作。不要通过复制生成行文字来猜 canonical source。

### 清除 scheduled 后任务仍在 Today

检查 deadline、父级/页面继承以及旧的其他 direct values。运行 Explain Task 查看当前 predicate
依据。Quick Reschedule 不会为了让项目消失而偷偷改 deadline。

### Capture 失败

运行 **Recover Last Failed Capture**。它恢复最近一次普通 Capture 的正文，供你重新决定；
无法确认先前写入结果时不会自动重试。这个 session-only 恢复槽不包含 Capture Here 或
Capture Selection；Capture Here 的输入不会进入该恢复槽，Capture Selection 的原始正文仍在
来源文档中。

### 视图看起来过期

先运行 **LifeLoop: Refresh**。索引可由 **LifeLoop: Rebuild Index** 重建；不要手工编辑
`.lifeloop/index.sqlite`。Markdown 文件仍是 authority。

Rebuild Index 只能恢复从 Markdown 推导出的索引，不能恢复被删除或覆盖的 Markdown。Now、
Last Find 等 UI state 也不是业务备份。使用 Git 或文件备份保护 Markdown source。

### Foam link 或 rename 问题

普通 file rename 已验证；Foam 0.44.6 的 folder rename 仍可能改写 links 后失去 definition
target。移动整个文件夹后检查和修复 links。LifeLoop 不提供第二个 rename engine。

### 生成的结果不能编辑

`lifeloop-result:` 是有意只读的派生文档。使用 Open Source 回到 Markdown；生成结果不会进入
vault 或 index。

### 同步不确定或失败

打开 **Show External Sync Report**。如果 binding suspended 或双方已改变，使用 Resolve；如果
external object 缺失，按报告选择恢复或明确 Detach。不要反复触发可能已经执行的外部创建。

---

## 16. LifeLoop 不负责什么

LifeLoop 不建设第二套通用 PKM、Dashboard、Kanban、database builder、CRM、Calendar/Reminder
应用、semantic-search platform 或 AI planner。

- 普通页面、Wiki links、backlinks、graph、tags、Daily Notes、通用模板：Foam；
- 文件、全文搜索、编辑、Outline、Git：VS Code；
- 日历浏览、拖拽、recurrence、attendees：Apple Calendar；
- 通知与 recurring reminders：Apple Reminders；
- 需求、判断、取舍和是否完成：用户。

当前未实现的 Calendar read-only Agenda、完整 shared sync authority、跨窗口 writer admission
等能力不应出现在教程中作为可用功能。具体实施状态与宿主证据见
[Capability Matrix](./CAPABILITY-MATRIX.md)，未来候选和产品边界见
[All-in-one Roadmap](./all-in-one-app-roadmap.md)。

---

## 17. 原始 SilverBullet 版本

仓库的 [`LifeLoop/`](../LifeLoop/) 是原始 SilverBullet library；`packages/` 是共享 semantic
core 上的 VS Code 实现。它们可以读取相同的基础 Markdown，但命令入口、模板变量、视图和
兼容范围不同。

SilverBullet 版提供 Setup、Capture、Inbox processing、Today、Upcoming、Projects、Audit、
Attach、Project lifecycle、Review freeze 及有限 Reminders/Calendar 命令。VS Code 版把普通
PKM 交给 Foam，并增加当前指南描述的 native views、language features、guarded actions、
Find/Now、连续 Review 和集中 external Resolve。

不要把 SilverBullet template 的 Lua interpolation 或 `|^|` cursor marker 原样交给 Foam。
迁移、命令替换、special refs 和已知边界见 [Foam setup and migration](./FOAM.md) 与
[Compatibility](../COMPATIBILITY.md)。
