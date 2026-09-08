# LifeOS for VS Code

> **本文档定义系统是什么、拒绝成为什么。**
> 阶段划分、工程决策、每个阶段的 gate 与测试，见 `LifeOS Execution Plan.md`。
> 跨 scope 长期有效的 ownership 与 mutation 规则，见 `DESIGN.md`。
>
> 本文第一版有若干条与自身原则冲突的规定，已按 execution plan 的结论修订；
> 每一处都在 §41 记录了改前是什么、为什么改，而不是悄悄改掉。

## 1. Overview

LifeOS for VS Code 是一个 **Markdown-native、local-first、retrieval-first、可渐进结构化的个人知识与行动系统**。

它的目标不是重新实现 Notion、Obsidian 或 SilverBullet，也不是把 VS Code 变成一个新的 productivity platform。

它的核心目标是：

> **让普通 Markdown 成为长期稳定的个人数据层；
> 在其上建立可丢弃、可重建的 semantic index；
> 用最少的结构支持 PKM 和基本 LifeOS；
> 将提醒、日历和移动端 capture 交给已经更擅长这些事情的系统；
> 并为未来 database、dashboard、Kanban 和 AI agent 留出统一而稳定的语义接口。**

系统必须首先解决：

```text
write
find
link
capture
act
review
```

然后才考虑：

```text
database
dashboard
kanban
calendar UI
automation
AI
```

长期产品方向：

```text
Markdown
   ↓
Semantic Core
   ↓
PKM + LifeOS primitives
   ↓
Queries / Projections
   ↓
Human UI + External Systems + Agents
```

而不是：

```text
Rich UI
   ↓
invent metadata
   ↓
invent database
   ↓
force Markdown to fit it
```

---

# 2. Design Thesis

这个系统建立在一个核心判断上：

> **长期可持续的 PKM/LifeOS 不是结构最多的系统，而是未来仍能找到信息、结构可以按需增长、并且几乎不需要全局维护的系统。**

因此：

* Knowledge 默认保持低结构。
* Operational state 才承担明确结构。
* View 永远是 derived。
* 外部系统只拥有它们真正擅长执行的事实。
* Automation 只能消费已经稳定的 semantics。
* AI 最后进入，而不是最先定义系统。

LifeLoop 已经确立了相同的基础约束：Markdown 是 canonical state、derived state 不持久化、context 尽量从已有结构推导，而不是额外要求用户重复填写 metadata。

---

# 3. Core Principles

## 3.1 Markdown owns durable knowledge

用户长期拥有的数据必须是普通 Markdown。

```text
Canonical:

*.md
attachments
human-written metadata
explicit historical facts
```

以下都是 derived：

```text
object index
search index
backlinks index
query results
Today membership
project health
dashboard state
Kanban grouping
AI embeddings
sync cache
```

任何 derived store 都应该允许：

```text
delete
→ rebuild
```

而不会丢失用户事实。

---

## 3.2 One fact has one canonical owner

同一个事实不能由多个系统同时维护。

这是避免双向同步长期失控的核心原则。

LifeLoop 已经明确区分 Journal、Project、Task、Inbox、Projection、Review、Reminders、Calendar 和 AI 的 ownership。

新的 LifeOS 延续这个规则。

---

## 3.3 Retrieval must not depend on correct filing

用户不应该因为：

* 放错 folder；
* 忘记 tag；
* 没有填写 type；
* 当时没有建立 link；

而失去未来找回信息的能力。

因此 V1 的第一等能力包括：

```text
full-text search
fuzzy open
aliases
forward links
backlinks
broken links
recent items
```

系统设计必须允许：

> **先写，未来仍然找得到。**

Folder、tags、properties 和 schemas 都只能提升 retrieval，不应该成为 retrieval 的前置条件。

---

## 3.4 Structure is earned

结构不是预先设计出来的，而是由稳定需求逐步赚取。

推荐的结构化阶梯：

```text
plain Markdown
    ↓
link
    ↓
property
    ↓
typed object
    ↓
query
    ↓
workflow
    ↓
automation
    ↓
agent tool
```

不能跳过前面的阶段，只因为“未来可能有用”就提前引入：

```text
IDs
schemas
relations
priority
dependencies
complex statuses
automation
```

---

## 3.5 Derived state is never manually maintained

如果某个事实可以可靠计算，就不要把它写进 Markdown。

禁止：

```yaml
today: true
stale: true
health: warning
overdue: true
task_count: 7
```

应该通过 query 实时计算。

LifeLoop 对 persisted/derived 的区分已经明确覆盖 Today、overdue、staleness、project counts 等。

---

## 3.6 Only the active operational surface is reviewed

系统永远不要求用户定期维护整个知识库。

Weekly Review 可以检查：

```text
Inbox
Active Projects
Open Tasks
Waiting
Recent completion
```

但不能要求：

```text
review every note
clean every tag
fix every orphan
update every property
review every resource
```

Knowledge 应该：

> **use → improve**
> **reuse → extract**
> **revisit → link**

而不是周期性全局整理。

LifeLoop 的 Audit 也遵循这一边界：只检查 LifeLoop 自己承诺的 invariant，而不判断用户是否“正确使用”整个空间。

---

## 3.7 External systems own execution they already do better

LifeOS 不重新实现：

* push notifications；
* recurring reminders；
* location reminders；
* Calendar recurrence；
* attendee management；
* iPhone-native capture；
* exact-time alarms。

这些属于 Apple Notes、Reminders、Calendar 等 execution surfaces。

LifeOS 保留的是：

> **meaning / commitment / context**

而不是把自己变成 scheduler。

---

## 3.8 UI and AI consume semantics; they do not define them

以下都是同一个 semantic layer 的客户端：

```text
VS Code
Table
Dashboard
Kanban
Calendar view
MCP
AI Agent
Future mobile app
```

不能因为某个 UI 想显示一个字段，就要求 canonical model 新增该字段。

也不能因为 AI 能够推断某个状态，就自动把这个推断变成 canonical fact。

---

# 4. Sustainable Feature Admission

任何永久进入 core 的能力必须同时满足：

1. 真实使用中重复出现。
2. 长期用户维护成本低。
3. 不持久化可以便宜推导的状态。
4. 不破坏普通 Markdown portability。
5. semantics deterministic。
6. 可以组合现有 primitive 时，不重新造 primitive。
7. 没有外部系统明显更适合作为 owner。

LifeLoop 已经采用了类似 admission contract，并要求先使用已有 primitive，再考虑小扩展、external executor、custom implementation，最后才是更重的 plug。

增加一条专门针对未来 UI 的规则：

> **A view may consume existing facts; a view may never justify creating canonical facts solely to make the view richer.**

例如 Dashboard 想显示：

```text
project health
progress
energy
quarter
importance
```

不能成为要求所有 Project 新增五个字段的理由。

只有真正 workflow 消费这些信息时，它们才有资格进入 canonical model。

---

# 5. Scope

## 5.1 V1 Core PKM

V1 PKM 只需要：

```text
Markdown editing
Search
Fuzzy Open
Links
Backlinks
Aliases
Broken-link diagnostics
Basic properties
```

PKM 本身默认不要求 typed objects。

---

## 5.2 V1 Core LifeOS

V1 LifeOS 只有五个核心概念：

```text
Inbox
Project
Task
Journal
Review
```

这是最小可形成闭环的集合：

```text
capture
   ↓
context
   ↓
act
   ↓
today
   ↓
done
   ↓
review
   ↺
```

LifeLoop 当前也以类似最小闭环开始，而不是先实现完整 productivity methodology。

---

## 5.3 Standard Optional Types

以下提供标准 convention，但 **不是 Core 要求**：

```text
Area
Person
Meeting
Goal
Paper
Decision
```

如果用户只是写：

```markdown
Met with [[Alice]]
```

那么 `[[Alice]]` 已经是有效 Person reference。

只有出现明确需求：

```text
list all people
last contact date
meetings by person
CRM workflow
```

才需要：

```yaml
type: person
```

同理，Area 不是 Project 使用的强制 foreign key。

---

# 6. PARA Positioning

这个系统是：

> **PARA-inspired**

而不是严格实现 PARA taxonomy。

采用 PARA 的部分是：

```text
actionability
project lifecycle
active vs inactive work
low filing cost
```

不采用强制：

```text
Project/
Area/
Resource/
Archive/
```

四类必须覆盖所有数据。

尤其：

### Resource

默认就是 ordinary knowledge。

不需要：

```yaml
type: resource
```

### Archive

主要是 lifecycle，而不是必须移动到一个特殊目录。

```text
active
→ completed
→ archived
```

semantic state 与 physical path 解耦。

---

# 7. Knowledge vs Operations

系统明确分成两种不同的数据密度。

## 7.1 Knowledge Layer

默认：

```text
Markdown
Links
Search
Aliases
Optional lightweight properties
```

典型内容：

```text
Concept
Idea
Paper notes
Observation
Research notes
Reference
Long-form writing
```

不要默认 schema 化。

---

## 7.2 Operational Layer

这里才使用较强结构：

```text
Project
Task
Inbox state
Review state
External bindings
```

因为这些确实需要：

```text
status
deadline
completion
query
workflow
synchronization
```

因此：

```text
Knowledge
→ low structure

Operations
→ explicit structure
```

这防止整个 PKM 因为 LifeOS 的需求被强制 database 化。

---

# 8. Core Data Model

Semantic core 只理解基础 primitive：

```text
Page
Heading
Block / Item
Link
Tag
Property
Task
Relation
Ref            ← source identity
```

`Ref` 不是可选的实现细节。它是一个 object 回到 canonical Markdown 的唯一凭据，
有两种形式：`page@pos`，以及页面写了 anchor 时的 `page@anchor`。

所有 projection 与 mutation 都建立在它上面（§20、§27）：

```text
object
  ↓ ref
canonical source
  ↓ re-resolve + verify
write
```

没有 Ref，Table、Kanban、Today、AI tool result 都只能靠显示文本猜测自己指向什么。

而不把：

```text
Project
Person
Paper
Goal
Claim
```

硬编码进 parser/index layer。

这些由 higher-level semantic definitions解释。

---

# 9. Project

Project 是最重要的 structured page type。

最小 canonical state：

```yaml
---
type: project
status: active
---
```

允许状态：

```text
active
paused
completed
archived
```

只有这些是 canonical。

以下全部是 derived signals：

```text
no actionable task
waiting only
stale
deadline approaching
overdue tasks
no recent project-page change
```

LifeLoop 已经使用四态 lifecycle，并明确拒绝把 health/staleness 等 derived signal 写成状态。

Project identity 不依赖 path：

```text
Projects/Foo.md
Work/Foo.md
Foo.md
```

都可以是 Project。

---

# 10. Task

普通 task 必须仍然只是：

```markdown
- [ ] Write design
```

这是完整合法的一等 Task。

可按需加入：

```markdown
- [ ] Write design
  [deadline: 2026-09-10]
  [scheduled: 2026-09-08]
```

V1 不要求：

```text
id
parent
dependency
priority
assignee
workflow status
```

只有真实需求出现后才引入。

---

## 10.1 Progressive identity

普通 task 不需要 permanent ID。

只有当 task 跨越系统边界，例如：

```text
Apple Reminders
Calendar binding
external agent workflow
```

才获得 stable identity。

```markdown
- [ ] Write design
  [sync: "01K..."]
```

也就是说：

> **Identity tax is paid only by entities that need identity outside the local Markdown context.**

LifeLoop 已经明确预留 richer task entities，但拒绝让普通 task 为未来可能出现的功能提前承担 IDs、parent pointers 等 metadata。

---

# 11. Deadline, Scheduled and Calendar

必须长期保持：

```text
deadline != scheduled != event
```

### deadline

什么时候这个 commitment 开始产生后果。

### scheduled

用户准备在哪一天处理它。

### Calendar Event

一个真实分配的时间区间。

不能自动：

```text
deadline → create calendar event
```

也不能：

```text
event ended → complete task
```

LifeLoop 已经明确区分 deadline/time allocation，并明确拒绝 Calendar elapsed → Task completed。

---

# 12. Inbox

> **Inbox is the superset of all pending captures.**

不是"Apple Notes 一个 inbox、VS Code 一个 inbox，再做一个聚合视图"，
而是**一个 Inbox，多个 source**：

```text
Apple Notes ──┐
VS Code ──────┼──► Inbox ──► process ──► Task / Project / Knowledge
future ───────┘
```

用户每天只需要打开一个地方，不需要记得"哪个 capture source 还有东西没处理"。

Inbox item 有两种，processing 流程完全相同：

```text
native capture       什么都不带，Markdown 从第一次敲键就是 canonical
source-backed        带 [source:] / [source-id:]，pending 期间上游仍是 canonical
```

`source` 是 provenance，不是 taxonomy——UI 默认不按它分组。
普通 capture 不为外部来源支付任何 metadata 成本。

Capture 默认进入 Inbox。

Capture 操作必须比 filing 成本低。

V1 支持：

```text
Keep
Make Task
Link Project
Move to Project
Create Project
Promote Note
Archive
Delete
```

默认操作：

> **Link before Move**

Capture 内容尽量保留发生时的 context。

Project 页面通过 backlinks/query 聚合相关内容。

这沿用 LifeLoop 已有 Inbox processing semantics。

---

# 13. Journal

Journal 是 temporal spine。

它拥有：

```text
observations
chronology
meeting/log context
daily thinking
```

它不拥有：

```text
project durable status
task lifecycle
habit database
duplicated completion history
```

绝大多数 Journal 内容可以永远留在那里。

只有当某段内容：

```text
reused
revisited
repeated
develops independent identity
```

时才 promote/extract 成独立 knowledge。

---

# 14. Today

Today 永远是 projection。

```text
overdue
due today
scheduled today
waiting
```

不能存：

```yaml
today: true
```

Today membership 必须随 source facts 自动变化。

---

# 15. Review

Weekly Review 只针对 active operational surface。

V1 sections：

```text
Completed
Open
Active Projects
Waiting
Inbox
Reflection
```

Review 默认是 live projection。

用户显式：

```text
Freeze Review
```

以后才成为 historical snapshot。

不能自动产生大量：

```text
monthly
quarterly
yearly
```

review pages，除非真实使用证明需要。

---

# 16. Retrieval Layer

Retrieval 是 V1 first-class capability，而不是 query system 的副产品。

必须提供：

```text
full-text search
fuzzy page open
alias lookup
wikilink completion
backlinks
forward links
broken links
recent files
recently modified
```

设计目标：

> 一个 note 即使没有 folder、type、tag、schema，用户未来仍然可以可靠找回。

Semantic query 是 retrieval enhancement，而不是 basic retrieval 的替代品。

---

# 17. Architecture

```text
                         Markdown Vault
                      Canonical Durable State
                              │
                              ▼
                        Semantic Core
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
           Parser        Semantic Index      Search
                              │
                    Query / Mutation API
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
       VS Code            Apple Bridge          MCP / AI
          │                   │
          │            ┌──────┴──────┐
          │            ▼             ▼
          │         EventKit       Notes Bridge
          │        Reminder /      Capture
          │        Calendar
          │
          ▼
      Human UI

Future:
                       Query API
                          │
           ┌──────────────┼──────────────┐
           ▼              ▼              ▼
         Table          Cards          Kanban
                          │
                      Dashboard
```

---

# 18. Semantic Core

## 18.1 V1 implementation strategy

优先形成 UI-independent TypeScript semantic package：

```text
@lifeloop/semantic-core
```

**复用 SilverBullet 的实现，而不是重写它的语义。**

SilverBullet 的语义就是它的实现：`inComment`、inherited `itags`、`links` / `ilinks`、
两种 ref 形式、attribute 解析、什么算一个 item——clean-room rewrite 会保留形状、
悄悄丢掉这些角落，而且没有任何测试会发现。

因此复用是有契约的，分三层：

```text
Tier 1  promised semantics    承诺与 pinned SB 行为一致，differential test 覆盖
Tier 2  vendored implementation  pinned commit 的代码，本地修改保持为零
Tier 3  LifeLoop semantics     projection / signal / mutation，不跟随 SB
```

并且 **永远不自动跟随 upstream main**：升级 pin 是一次有意的动作，
跑完 differential suite，逐条 accept/reject。

但新核心不得依赖：

```text
CodeMirror UI
DOM
SilverBullet page runtime
SilverBullet widgets
IndexedDB
```

VS Code 是第一个 client，不是 semantic ownership boundary。

---

## 18.2 Future native daemon

只有真实 profiling 证明存在瓶颈时，才考虑：

```text
Rust semanticd
```

候选瓶颈：

```text
100k+ files
1M+ objects
startup
incremental indexing
FTS
relation traversal
query latency
```

不能因为“Rust 更漂亮”提前重写。

---

# 19. Query Layer

Query 必须返回 structured data，而不是直接输出某种 UI。

例如：

```text
source: project
filter: status == active
sort: lastModified desc
```

返回：

```text
QueryResult<Project>
```

然后消费者可以是：

```text
TreeView
Table
Cards
Kanban
Dashboard
Agent
CLI
```

核心 invariant：

> **Query != View**

---

# 20. VS Code Client

V1 尽可能 native-first。

映射：

```text
Search          → VS Code Search / custom index
Backlinks       → References / TreeView
Projects        → TreeView
Tasks           → TreeView
Inbox           → TreeView
Today           → TreeView（见下）
Commands        → Command Palette
Capture         → InputBox
Selection       → QuickPick
Schema issues   → Diagnostics
```

V1 不做 generic Webview dashboard。

VS Code 应该是：

> **knowledge workbench**

而不是把整个应用重新嵌进 Webview。

## 20.1 Projection identity

Today 用 TreeView 还是 virtual document，第一版曾写成二选一。它不是。
真正需要固定下来的是它们背后的 invariant，而 UI 只是它的一种实现：

> **每一个可操作的 projection 行都携带一个 opaque source handle。
> 显示文本、排序、分组、在视图中的位置，永远不能用来反推它指向什么。
> 写入前重新 resolve source 并验证；stale 或 ambiguous 一律 NO WRITE。**

handle 至少是：

```text
SourceHandle
├── ref               ← identity，来自 §8
├── expectedState     ← 渲染时该 marker 的状态
├── expectedTextHash  ← 渲染时该行的内容
└── capturedAt
```

两个字段分工不同，混为一谈是有记录的错误：
**ref 是 identity，hash 只是 staleness guard，永远不能用来"找到"一个 task。**

LifeLoop 已经踩过这个坑：query view 里的 tick 拿不到足够信息定位 source，
写入落地而 stamp 没有。所以这条不是 Today 的实现选择，
而是 Table、Cards、Kanban、Dashboard、AI tool result 未来共同遵守的规则。

V1 选 TreeView，正是因为 TreeItem 天然持有真实的 page / range / text；
换成任何别的表现形式，都必须先满足上面这条。

---

# 21. Apple Interoperability

Apple integration 的原则不是：

> everything bidirectionally mirrors everything

也不是：

> 每个 app 只准做一件事

而是：

> **View everywhere. Edit where natural. Sync by ownership.**

**写入权限不等于 ownership。** §3.2 约束的是"哪个系统决定一个 fact"，
从来不是"用户可以在哪个 app 里打字"。把这两件事混在一起，
会让一条正确的数据原则退化成一条难用的 UI 限制。

所以四个 surface 都是 first-class，只是 owns 的东西不同：

```text
                    Semantic Core
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
      Notes           Reminders          Calendar
   pending capture    提醒 / 重复 / 位置      时间区间
        └─────────────────┼─────────────────┘
                          ▼
                       VS Code
              读全部；直接写 LifeOS 的 fact，
              通过 bridge 写别人拥有的 fact
```

reconciliation 因此是 **field-level** 的，不是整个对象比时间戳。
而且 field 不止两类——"我们拥有"和"他们拥有"盖不住真正会出事的两类：

```text
CANONICAL        task text / deadline / project status      一个 owner，写在这边
EXTERNAL-OWNED   alarm / recurrence / calendar interval     一个 owner，写在那边
PROJECTION       reminder title / note                      向外复制；对面改了叫 divergence
SEMANTIC EVENT   completed / reopened                       不是要两边相等的值，是要翻译的 transition
```

在这边改 deadline、同时在手机上改 alarm，不是冲突——是两次不相交的写入。

这不是新机制：`External.md` 记录的 "only ever pushes the title, the note and the flags
— never the schedule" 就已经是一次 field 划分，只是当时是一事一议。

**时间戳是 freshness guard，不是裁判。**

```text
ownership          → canonical fact 在哪里
version/timestamp  → projection 是否已经 diverge；不要覆盖对面的显式修改
```

你在 Reminders 里改了标题，后台就停止推送。这不是 Reminders 拿到了 title ownership，
而是一个 projection 发生了 divergence，正确的出口是
**保留对面 / 恢复本地 / 采纳进 note** ——一个被摆出来的选择，而不是一个沉默的胜者。

一旦允许时间戳决定我们拥有的 field 的**取值**，那个 field 就悄悄变成了 last-write-wins，
而这正是 field ownership 要消除的东西。

第四类最关键：completion 不是一个要在两边保持相等的属性，而是一个需要翻译的事件。
这样看，recurring reminder 的坑就不再隐蔽——
新 occurrence 显示 `incomplete`，那是**一个新对象的状态**，从来不是一次 reopen event。

---

# 22. Apple Notes

Apple Notes 主要负责：

```text
fast mobile capture
offline capture
Share Sheet
scan/image capture
Siri/native Apple UX
```

同步范围默认只有：

```text
Apple Notes/
└── LifeOS Inbox
```

进入：

```text
LifeOS/
└── Inbox/
    └── AppleNotes/
```

### 单向：Notes 是 capture frontend，Inbox 是 processing surface

```text
Apple Notes ──► Inbox ──► process ──► LifeOS canonical
   pending 期间             ownership handoff
   Notes 是 canonical
   Inbox 是它的 projection
```

**任何时刻都只有一个 writer**，所以这里没有 merge、没有 baseline hash、
没有 conflict UI，也没有"push 之后要重置时间戳"这种回环。
§3.2 不是靠冲突处理满足的，而是靠根本不产生冲突。

**有损转换因此从数据丢失降级成显示问题。** Apple Notes 有 rich text、表格、附件、
扫描件、手写和内部链接，导入必然不完美——但因为永远不写回，
原件在 Notes 里完好无损。有损的预览可以忍，有损的 round trip 不行。

**镜像不是便利，是 retrieval 的前提。** §3.3 承诺"先写，未来仍然找得到"。
一条只存在于 Apple Notes 里的 capture，对 Phase 1 建的所有检索面都是不可见的。
把它镜像进 Markdown，才能让手机上记的东西进入 search、fuzzy open 和 backlinks。

**在本地改了镜像内容，视为 ownership claim，而不是错误。**
"导入的正文只读"这条规则没法执行——Inbox 就是一个 Markdown 文件，
VS Code 没有诚实的方式把它的一部分变成只读。所以既不假装，也不静默覆盖：

```text
检测到本地修改（文本 ≠ 上次同步写下的文本）
      → 该 item 转为 native：解除绑定，[source:] 保留为 provenance
      → 之后 Notes 那边的修改不再流入；Notes 原件不受影响
```

你在这里改了，它就归你了——和 processing 是同一个动作，只是用打字触发的。

**processed 由本地判定。** `## Processed` 下面的 item 就是已处理，
这是 Inbox 本来就有的语义，不需要新状态。
把 Apple note 移到 `LifeOS Processed` 文件夹是 Notes 那边的整洁措施
——自描述，而且自动退出被扫描的范围——但它是 best effort，
**绝不能成为 precondition**：一次 AppleScript 失败不允许阻塞或半完成一个 LifeLoop mutation。

注意"source 只向 Inbox 同步，永不反向"这句需要限定范围：
它对**内容**成立；移动一条 note 本身是一次写入，属于
§21 已经确立的另一类——我们从不把内容镜像出去，但可以请求 source 修改它自己的 lifecycle。

### Promote 后

```text
Apple Note
    ↓
LifeOS Project / Knowledge / Task
```

LifeOS 成为 canonical owner。

不再要求永久 mirror。

因此 Apple Notes 不是：

```text
Knowledge database
```

而是：

```text
Capture surface
```

---

# 23. Apple Reminders

Reminders 是最适合真正双向 interoperability 的系统。

LifeOS Task owns：

```text
commitment
task text
deadline
completion lifecycle
project context
```

Reminders owns：

```text
alarm
recurrence
location
notification
```

一个最重要 reverse direction：

```text
Apple Watch / iPhone
    ↓
complete reminder
    ↓
EventKit
    ↓
LifeOS semantic mutation
    ↓
completeTask(...)
```

LifeLoop roadmap 也已经识别 Reminders completion 回流为最有价值的 reverse direction。

### 一个 completed reminder 可能说不出它是什么时候完成的

Apple 明确说明 `completionDate` 可以为 nil，而 `isCompleted` 仍为 true
——在别的 client 上完成时就会这样。

这与 `DESIGN.md` 的 **historical facts are recorded, never reconstructed** 正面相撞，
所以规则先定，再写代码：

```text
有 completion date        → 原样使用
没有 completion date      → stamp 观察到它的那次 sync 的日期
中间的任何值              → 永远不猜
```

第二条记录的是"LifeOS 什么时候知道的"，而不是"手表上什么时候点的"——
它是能站得住的最早事实，并且诚实地承认这一点：合盖四天，
得到的是一个偏晚的日期，而不是一个编出来的日期。

本项目的规矩是 **checked against the dictionary, not assumed**
（`External.md` 对 Calendar 缺少 modification date 就是这么记录的），
所以 reverse flow 动工前先去问实际使用的那条路径究竟报什么，答案写回 `External.md`。

---

# 24. Calendar

Calendar owns：

```text
start
end
recurrence
attendees
location
calendar membership
```

LifeOS 允许：

```text
Task
  ↓ explicit Schedule action
Calendar Event
```

但 Calendar reverse flow 只能更新：

```text
event state
start/end
cancellation
location
```

不能改变：

```text
task completion
project status
```

---

# 25. Identity

> **No universal internal ID. Identity is earned.**

第一版规定"LifeOS 自己拥有 `lifeos_id`，external ID 只是 binding"。
这和 §10.1 冲突：普通 task 不应该为一个它永远用不到的能力预付 identity tax。
而 §26 又要求 binding identity 不能只存在于 sync DB——也就是说 id 终究要落回 Markdown，
那再多一层 UUID 就没有意义了。

阶梯是：

```text
page@pos             ← 默认，什么都不写
   ↓ 需要跨编辑保持稳定
$anchor              ← 用户写下的名字，ref 随之变成 page@anchor
   ↓ 跨系统
[reminder: "..."]    ← external binding，直接写在 task 行上
[event: "..."]
   ↓ 只有在真实失败出现之后
domain ID
```

普通 task 停在第一级：

```markdown
- [ ] Write paper
```

投影到 Reminders 之后停在第三级：

```markdown
- [ ] Write paper [reminder: "..."]
```

**两个会让 domain ID 被赚到的触发条件**，都还没发生：
同一个 task 同时绑定 Reminders、Calendar 和 agent history；
或者外部系统删除并重建对象，使 external id 不再稳定。
在那之前，ref 和 anchor 就够了。

External identifier 依然不能成为 primary identity——它是 binding，不是身份。

---

# 26. Derived Store

**一个文件，一条 rebuild path。**

```text
.lifeos/index.sqlite
├── objects      object index
├── fts          alias / object lookup
├── pages        hash / mtime
└── sync         external reconciliation state
```

第一版把 sync cache 和 object index 分成两个 store。两个 store 就是两条
invalidation path、两个 schema version、两种"重建到一半"的状态。
它们的规则本来就相同（删掉不丢用户事实），所以合成一个文件、若干张表。

之所以安全，正是因为 §25 的结论：binding 写在 Markdown 的 task 行上，
这个文件里没有任何一条是用户会失去的事实。

sync 这部分只能包含 operational derived state：

```text
cached external IDs
last observed hashes
last-seen modification state
reconciliation cursors
conflict state
```

必须满足：

> **删除 `.lifeos/index.sqlite` 不丢用户事实。**

进一步要求：

> **External bindings 必须能够从 canonical Markdown + external systems 重新发现。**

因此 critical binding identity 不允许只存在 sync DB。

---

# 27. Mutation Contract

所有 semantic mutation 都遵守：

```text
resolve source
    ↓
verify preconditions
    ↓
construct ChangeSet
    ↓
validate
    ↓
apply
```

任何不确定：

```text
stale source
collision
ambiguous identity
missing target
user cancel
external mismatch
```

都应该：

```text
NO WRITE
```

Composite action 不能产生半完成状态。

LifeLoop 对 Inbox、task ticking、promotion、page attachment 和 review freezing 已经建立了同样的 mutation discipline。

**这条 contract 是基础设施，不是后期原则。** 它必须在任何 workflow 写 Markdown 之前就存在，
否则 UI 一条写路径、Apple sync 一条、AI 再一条。依赖顺序是：

```text
parse → index → source identity → mutation API
                                      ↓
                        LifeOS workflow → external sync → AI
```

所以它属于 Phase 0，见 execution plan 0.5。
需要建的不是新 API，而是把 LifeLoop 已经测过的 mutation contract 从 Space Lua 升格为 first-class core API。

---

# 28. AI

AI 必须最后进入。

演进顺序：

```text
workflow
    ↓
semantics
    ↓
deterministic API
    ↓
AI
```

LifeLoop 已明确拒绝：

```text
AI
→ arbitrary Markdown edits
→ workflow somehow emerges
```

---

## 28.1 Level 1 — Read only

```text
What deserves attention today?
Which projects have no next action?
What changed this week?
Find possible duplicates.
Summarize this project.
Surface related notes.
```

没有 mutation。

---

## 28.2 Level 2 — Suggestions

AI 可以提出：

```text
link this inbox item to Project X
convert this line to a Task
these two notes may duplicate
```

但必须：

```text
proposal
→ human Apply
```

---

## 28.3 Level 3 — Named semantic mutations

AI 只能调用：

```text
capture()
createTask()
setTaskDue()
completeTask()
createProject()
completeProject()
processInbox()
bindReminder()
```

不能调用：

```text
writeFile()
replaceArbitraryText()
evalScript()
```

---

## 28.4 Level 4 — Maintenance

AI 可以负责：

```text
probable duplicates
stale operational items
inbox suggestions
missing next actions
inconsistent metadata
```

但输出必须区分：

```text
deterministic safe fix
AI suggestion
human decision
```

---

# 29. Future Work — Database-style Views

长期目标是支持 Notion-like interaction，但不引入 Notion-like canonical database。

架构：

```text
Markdown
    ↓
Semantic Index
    ↓
Query
    ↓
View Model
    ↓
Table / Cards / Kanban / Calendar / Dashboard
```

View 永远不拥有业务数据。

---

# 30. View Definition

未来统一定义：

```text
ViewDefinition
├── source
├── filter
├── sort
├── group
├── fields
└── renderer
```

例如：

```yaml
source:
  type: project

filter:
  status: active

sort:
  - deadline

renderer: table
```

同一个 source 可以渲染：

```text
Table
Cards
Kanban
List
```

---

# 31. Database Table

例如：

```text
Projects

┌──────────────┬─────────┬───────────┐
│ Name         │ Status  │ Deadline  │
├──────────────┼─────────┼───────────┤
│ LifeOS       │ Active  │ Sep 30    │
│ Paper        │ Paused  │ —         │
└──────────────┴─────────┴───────────┘
```

Cell edit：

```text
UI event
   ↓
semantic mutation
   ↓
Markdown patch
```

而不是：

```text
UI database
   ↓ export to Markdown
```

---

# 32. Kanban

Kanban 只是：

```text
query
+
group by property
+
drag → semantic mutation
```

例如：

```text
Active    Paused    Completed
```

拖动卡片：

```text
setProjectStatus(...)
```

Kanban 不保存额外 state。

---

# 33. Dashboard

Dashboard 只保存：

```text
Query + Renderer + Layout
```

不保存 query results。

例如：

```text
Today
├── Today's Tasks
├── Active Projects
├── Waiting
└── Recent Notes
```

Dashboard config 可以是：

```text
.lifeos/views/home.yaml
```

但该文件只能描述 view。

---

# 34. Rich-view Admission Rule

任何未来 rich view 上线之前必须回答：

> **如果用户永远不使用这个 View，他的 Markdown 是否完全不需要新增任何字段？**

理想答案：

> yes

如果答案是：

> “为了 Dashboard/Kanban 好看，每个 Project 都必须新增 3–5 个字段”

该功能不应该进入 core。

---

# 35. No New Plugin Platform

LifeOS 不计划重新建立自己的：

```text
plugin marketplace
plugin runtime
theme ecosystem
plugin SDK
```

系统只提供：

```text
Semantic API
Query API
Mutation API
MCP
CLI
View definitions
```

优先复用 VS Code extension ecosystem。

避免重新制造：

> plugin compatibility + dependency + abandonment debt。

---

# 36. Implementation Phases

阶段的**权威版本在 `LifeOS Execution Plan.md`**：每个阶段的 deliverable、definition of done、
gate、测试策略和风险都在那里。本节只保留形状，避免两份文档各说各的。

**Phase 0–3 是要做的工作。Phase 4–5 是 future roadmap，不是排期。**
这不是措辞上的谨慎：§29 把 rich views 放在 Future Work，§37 明说
"Future Work 不代表最终一定实现，没有通过 admission rule 的功能可以永远不存在"。
写下它们，是为了在真到那一天之前先把**约束**定死，
而不是为了承诺去建——**预期结果是其中大部分永远不会出现**，而那是成功，不是欠账。

## 要做的

```text
Phase 0   Semantic Core
          why port（含 abandonment criterion）
          → compatibility contract + pinned vendoring
          → store / indexer
          → source identity
          → mutation API
          → differential conformance（extraction / index primitives / mutation bytes）
          没有 UI

Phase 1   Retrieval + minimal loop
          先 retrieval，再 capture → inbox → project → today → review
          gate：连续三周真实使用，不回退到 SilverBullet

Phase 2   Selective Apple interoperability（四个独立 gate 的切片）
          2a Task → Reminder
          2b Reminder completion → completeTask      ← 整个阶段的目的
          2c Task → Calendar binding
          2d Apple Notes → Inbox，单向；Inbox 是所有 capture 的 superset

Phase 3   Query as a public contract
          engine 在 Phase 0 就有了；这里冻结它、命名 projection、用第二个 client 证明
```

## Future roadmap — 不排期，默认不发生

```text
Phase 4   Rich views：Table → Cards → Kanban → Dashboard
          先决条件：Phase 3 已稳定，且 FRICTION.md 里有一条真实摩擦说明这个 view 解决什么
          "有了 query layer 就很容易做" 不是理由——便宜不是理由
          Table → Cards → Kanban 只是"万一真开始"的顺序，不是开始的计划

Phase 5   AI：read → suggestions → named mutations → maintenance
          顺序本身就是内容：semantics 稳定之前进场的 assistant 会变成 semantics
```

**这一节最大的风险是被当成 roadmap 读。** 一个没有 friction 记录就上线的 view，
正是整份计划在防的失败模式，而它会最先出现在这里。

不过 §34 的 admission rule 值得**现在就变成一个可执行的检查**：
系统读取的 frontmatter / task attribute key 集合，从 Phase 1 起不允许扩大。
这条检查无论将来有没有 view 都成立，
因为它同时能抓住 Phase 1、2 的代码悄悄把 schema 撑大。

两处与第一版不同，原因记在 §41：

* **mutation API 从"后面某个阶段"移到 Phase 0**，因为 Phase 1 和 Phase 2 都要写 Markdown。
* **Phase 0 不再只是"parser + index"**，semantic drift 才是它真正的风险，
  所以 compatibility contract 与 differential conformance 是它的 exit gate。

Phase gate 一律是：

> **真实连续使用，而不是 feature checklist。**

---

# 37. Non-goals

Core 明确不做：

```text
strict PARA taxonomy
generic Notion clone
habit tracker
goal scoring framework
recurring task engine
dependency graph
multi-stage task workflow
generic CRM
full Apple Notes mirror
Calendar scheduler
plugin marketplace
WYSIWYG editor
autonomous AI filesystem editing
```

“Future Work” 不代表最终一定实现。

没有通过 admission rule 的功能可以永远不存在。

---

# 38. V1 Success Criteria

这八条里，四条机器能跑，四条只有用过一个月的人能回答。
把第二类写得像测试，是让它彻底失去意义的方法，所以先分开：

```text
可以是 test                     只能是 gate
─────────────────────────       ─────────────────────────
Rebuildability                  Retrieval
Deterministic mutation          Capture
Data durability                 Operational loop
Metadata tax                    External interoperability
```

四条 gate 没有测试，也不需要有。它们对应的是 `FRICTION.md`。
每一条落在哪个阶段，见 execution plan §4。

## Data durability

删除 extension：

> Markdown 仍然完整可理解。

---

## Rebuildability

删除 semantic index：

> 仅从 Markdown 可完整重建。

---

## Retrieval

用户即使：

```text
放错目录
忘记 metadata
没有 tag
没有 link
```

仍可以依靠 search/fuzzy retrieval 找回信息。

---

## Capture

新的 thought 可以在几秒内进入 Inbox。

不要求提前分类。

---

## Operational loop

用户可以连续数周完成：

```text
Capture
→ Process Inbox
→ Work Project/Task
→ Today
→ Complete
→ Weekly Review
```

而不需要维护 LifeOS 本身。

---

## Metadata tax

普通 knowledge note：

```markdown
# Some Idea

...
```

完全合法。

普通 task：

```markdown
- [ ] Do something
```

完全合法。

---

## External interoperability

可以：

```text
Apple Notes → Inbox

LifeOS Task → Reminder

Reminder completed on iPhone/Watch
→ LifeOS Task completed

LifeOS Task → Calendar binding
```

而不会把 LifeOS 变成 notification/calendar engine。

---

## Deterministic mutation

任何：

```text
AI
sync
UI
automation
```

都必须通过相同 semantic mutation API。

不能 fuzzy-edit 未验证 Markdown。

---

# 39. Long-term Architecture

最终 LifeOS 的 boundary 是：

```text
Markdown
+
Semantic Core
```

而不是：

```text
VS Code
SilverBullet
Apple
Notion-style UI
AI provider
```

最终可以演进为：

```text
                         Markdown
                            │
                      Semantic Core
                            │
          ┌─────────────────┼──────────────────┐
          │                 │                  │
          ▼                 ▼                  ▼
       VS Code           Web/PWA            Agent
       Desktop            Mobile             MCP
          │
          ▼
   Deep knowledge work

External execution:

Apple Notes       → Capture
Reminders         → Notification / recurrence
Calendar          → Time allocation
```

未来即使：

```text
VS Code → Zed
Web/PWA → native mobile
Claude → another agent
```

Canonical LifeOS 不需要迁移。

---

# 40. Final Product Principle

整个项目最终应该满足一句话：

> **Users should spend their time using their knowledge and running their life, not maintaining the system that represents it.**

因此所有未来功能都必须面对三个问题：

### Does it improve retrieval, action or understanding?

如果没有，不应该存在。

### Does it impose permanent metadata or maintenance tax?

如果有，必须证明收益长期高于成本。

### Could this remain a derived view instead?

如果可以，就不要把它变成 canonical state。

这三条比任何具体的 PARA、Notion、Obsidian 或 SilverBullet feature list 都优先。

---

# 41. 修订记录

第一版有五处与本文自身原则冲突。按 execution plan 的结论改掉了，
改前是什么、为什么改，记在这里——一份悄悄改了主意的设计文档，不如没有记录。

**1. Apple Notes：无边界双向 → 单向，且 Inbox 成为所有 capture 的 superset（§12、§22）。**
原文允许 pending 期间"有限双向更新"，既没说边界，也没说冲突怎么办。
这一条前后改了三次，完整记下来，因为中间两版都被推翻过：

1. 先改成**完全单向**：pending capture 只有 text 一个 field，
   field ownership 无从划分，双向即 free-text multi-master。
2. 再改回**双向 + 冲突即停**：上一条的理由对"自动合并"成立，
   推广到"一切双向"过头了；个人使用几乎总是串行，检测到冲突就停也符合本项目
   "不确定就不写"的习惯。
3. 现在是**单向，但重新构造了问题**：真正该问的不是"Notes 要不要双向"，
   而是"用户要不要维护两个 inbox"。答案是不要——
   Notes 是 capture frontend，Inbox 是唯一的 processing surface。

第三版不是在两个等价方案里换口味：它**根本不产生冲突**就满足了 §3.2，
比前两版都简单；有损转换也从数据丢失降级为显示问题，因为永不写回。
唯一的洞——本地改了镜像怎么办——用 ownership claim 补上，而不是用一条执行不了的只读规则。

值得记一句：这一条每一轮都在翻，说明它背后没有真实使用数据支撑，
而这正是本项目的 gate 要拦的东西。所以模型写下来，2d 仍然按 gate 走。

**2. `lifeos_id` → identity is earned（§25）。**
原文给所有东西一个 LifeOS UUID，与 §10.1 冲突，而且 §26 本来就要求 binding 落回 Markdown。
改成阶梯：`page@pos` → `$anchor` → external binding → 只有真实失败之后才是 domain ID。
注意这不是"永远不要 internal identity"，而是"不要 universal internal identity"。

**3. Today = TreeView / virtual document → projection identity invariant（§20.1）。**
原文把它写成 UI 二选一。真正要固定的是 handle 与 verification 规则；
TreeView 只是 V1 满足它的方式。这一条同时约束未来的 Table / Kanban / Dashboard / AI tool result，
并已写入 `DESIGN.md`。

**4. Mutation API 从原 Phase 列表后段移到 Phase 0（§27、§36）。**
原文把 deterministic mutation 说成 fundamental invariant，却没有任何阶段负责建它，
而 Phase 1/2 已经在写 Markdown 了。

**5. Sync cache 与 object index 合并为一个 derived store（§26）。**
两个 store、两条 rebuild 规则，没有理由。合并之所以安全，是第 2 条的结果。

另有两处是补充而非修正：
§8 把 `Ref` 明确列为 primitive（第 3 条依赖它）；
§18.1 把"复用 SilverBullet"写成有 tier 的 compatibility contract，
因为不写清楚承诺兼容的是哪一部分，differential conformance 就没有判定标准。
