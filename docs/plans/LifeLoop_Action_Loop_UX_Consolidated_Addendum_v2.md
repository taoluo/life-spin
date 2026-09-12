# LifeLoop Action Loop UX — Consolidated Addendum

**Revision 2 — Editor-first · Native-first · Keyboard-complete**

Status: **product direction plus the bounded implementation milestone in section 14; features outside that milestone remain proposed.**
Revision date: **2026-09-12**.
Current source baseline: `2d9010b` (`vscode-implementation`), verified on 2026-09-12. Historical source baseline: `064b987`.

## 阅读入口

- [0. 基线与本次修订](#sec-0)
- [1. 产品决策与交互架构](#sec-1)
- [2. Ownership、数据与安全边界](#sec-2)
- [3. 需求总表与原设计映射](#sec-3)
- [4. E1–E3：Today、Now 与开始行动](#sec-4)
- [5. E4–E7：捕获、记录、查找与结束承诺](#sec-5)
- [6. E8–E10：恢复、生活领域与结果反馈](#sec-6)
- [7. V1–V6：编辑器内的操作、理解与导航](#sec-7)
- [8. V7–V10：上下文视图、派生文档与上手](#sec-8)
- [9. K0：完整键盘交互契约](#sec-9)
- [10. W1：单用途 Webview 准入](#sec-10)
- [11. 宿主、性能、隐私与恢复资格](#sec-11)
- [12. 受限试验与后续 roadmap](#sec-12)
- [13. 实现落点与复用要求](#sec-13)
- [14. 交付顺序与退出条件](#sec-14)
- [15. 验收与反例矩阵](#sec-15)
- [16. 明确不做与待决事项](#sec-16)
- [17. 来源与技术依据](#sec-17)

<a id="sec-0"></a>
## 0. 基线与本次修订

### 0.1 文件关系与证据范围

本文件**完整替代上一版 `LifeLoop_Action_Loop_UX_Consolidated_Addendum.md` 增补稿**，不是在其后再叠加一份待办。

仍以用户提供的《Action loop UX enhancement》ownership / delivery-boundary clarification 修订版为基础设计，保留 **A1–D4、G1–G3、各功能独立资格条件及原测试反例**。本文件不逐字复制原设计；未明确修订的细节仍沿用原文。Relationship data surfaces 中的 Markdown authority、明确 Interaction 和关系语义继续适用。

资料来源按性质分开：

| 来源 | 本文件如何使用 | 不能由此推导 |
|---|---|---|
| 用户粘贴的 Action loop UX 修订版 | 基础需求、ownership、source guards、同步与交付边界 | 当前实现已满足需求 |
| 上一版 Consolidated Addendum | 保留 E1–E10、K0、X1/X2 及生活领域、执行辅助需求 | 功能已编码、已被用户验证 |
| 后续 editor-first / VS Code UI 讨论 | 本次新增 V1–V10、W1 与 roadmap 决策 | 每一种宿主能力都必须实现 |
| 第 17 节 VS Code / W3C 官方资料 | 核对可用技术路径与交互原则 | LifeLoop 的实际 API 兼容性、性能或医疗效果 |

本次已在 `2d9010b` 核对 provider、命令、索引、临时文档和 Apple sync 调用链，并重新运行 `npm run verify`：856 tests passed，3 个需要运行中 SilverBullet client 的检查 skipped。没有重新运行真实 VS Code/Foam host gate、验证 extension package、迁移个人 vault 或连接真实 Apple 对象；这些旧证据不自动成为本轮证据。

实施时若源码与基线不一致，应记录差异并修订对应需求，不得根据本文反推“已有实现”。术语、命令显示名称、候选模块名不等于已存在的 command ID、配置项或公共 API。

### 0.2 本次明确改变的设计决策

| 上一版倾向 | 本版决策 |
|---|---|
| TreeView + QuickPick 是主要且几乎唯一的交互组合 | **Editor-first / native-first**：在原文中就地操作、理解和修复；其他界面按用途组合 |
| 键盘覆盖以列表、命令与跳转为主 | K0 覆盖新增 Code Actions、诊断、Peek、虚拟文档、Diff 和获准 Webview 的完整路径 |
| 不做 Webview Dashboard 容易被理解为不允许任何 Webview | 继续拒绝通用 Dashboard；允许一个有证据支持的**单用途 Webview**，独立准入 |
| Brief / Review 主要是临时内容的呈现问题 | 明确区分虚拟只读内容、冻结导出与原始事实，防止重复索引和伪写入目标 |
| 增强功能可能各自增加面板 | 一项语义可以有多种薄入口，但只保留一份查询与 mutation 实现 |
| “原生控件”容易被视为自动获得正确交互 | 增加实际键盘、共存、dirty buffer、性能和可访问性验收 |

不改变：业务事实由 Markdown 持有；安全同步状态独立于索引；Calendar / Reminders 拥有其执行语义；不建设通用数据库、action registry、workflow engine 或事件历史平台。

### 0.3 优先级与范围

P0–P3 表示交付顺序，不表示数据安全严重程度。G1–G3 独立适用；K0 是已启用产品路径的 keyboard-ready 资格，不能替代安全 gate。

“必须”指某功能**决定交付时**必须满足的契约，不代表本文件所有 roadmap 功能都进入本轮开发。近期切片、后置试验与明确排除分开管理。

产品目标：**可靠接住信息，降低启动负担，保持当前上下文，允许中断和重新开始，确认承诺结果，并照顾长期生活责任。**

当前近期目标进一步收缩为：**编辑不卡顿 → 键盘就地操作 → 捕获后返回 → 快速找回任务 → 留下进展并继续。** v2 的完整功能表是产品方向和约束，不是一次性 implementation milestone。

实施前 delta audit 的当前结论如下。“已有”只表示代码基础；真实宿主资格仍单独记录。

| 范围 | `2d9010b` 当前事实 | 近期处理 |
|---|---|---|
| V1 Code Actions | 已有任务动作，但 provider 调用 `currentTaskStates()`，会触发全量 reindex | 修热路径并审计覆盖，不重建 provider |
| V4 Hover / V5 diagnostics | 已有 task/relationship/query Hover、diagnostics 和部分 Quick Fix；输入时 diagnostics 仍遍历全 vault | 当前文档即时更新，索引收敛后全局校验 |
| V6 navigation | 已有 Open/Peek Source 和 guarded target | 补目标/返回/键盘宿主验收 |
| V8 derived documents | Query result 与 Brief 使用可编辑 `untitled:` Markdown；Foam 曾报告 provider 日志 | 独立 spike；不能称为已实现只读虚拟文档 |
| A1 | 已有 Set Scheduled 日期输入 | 新增确定性快捷选择 |
| A2 | 已有连续 Inbox processing | 增加本次遍历 Skip、Edit Source；首版不持久化处理游标 |
| A3–A5 | Task Actions、SourceHandle 和多种拒绝已有基础 | 增量统一入口、反馈和焦点连续性 |
| Find / Why / Capture Selection / Progress / Now | Find Task、完整 Why Not Here、选区 provenance、Progress/Resume Cue、Now 尚未形成完整入口 | 分成独立小切片，不相互阻塞 |
| External sync authority | 手动与 autoSync 共用 VS Code 入口；无 CLI writer；部分 observation 更新未等待持久化 | 已启用路径先硬化，完整共享 authority 单独迁移 |

<a id="sec-1"></a>
## 1. 产品决策与交互架构

### 1.1 编辑器是主要工作位置，聚合视图是辅助

LifeLoop 不应只是在侧栏中列出 Markdown 已经包含的任务。用户应能在原文里写、理解、定位和行动，需要跨页面背景时再打开聚合界面。

原生语言能力可以直接通过 VS Code provider API 提供，不要求先建设独立 Language Server。[VS1] **本项目先使用薄 provider adapter，不新增 LSP runtime。**

| Surface | 合适的工作 | LifeLoop 用法 | 不承担的职责 |
|---|---|---|---|
| Native editor | 长文本、实际源编辑 | Capture 编辑交接、进展、用户维护的页面 | 第二套正文编辑器 |
| Code Actions / completion / snippets | 就地动作与写对语法 | Task Actions、受管字段、场景内容 | 保存时自动完成任务或同步 |
| Hover / CodeLens / diagnostics | 就地理解和修复 | 有效字段、命中原因、受管格式问题 | 人生评分、注意力评估 |
| TreeView / 可移动 Context view | 聚合与保持当前目标 | Today、Inbox、Now、Context | 每个生活领域一个 sidebar |
| QuickPick / Command Palette | 查找和短选择 | Find Task、日期与关联选择 | 长表单或复杂多步 wizard |
| Peek / source navigation | 查看关联而少切换 | 相关任务、明确 Interaction、背景来源 | 通用 Wiki link provider 的副本 |
| Read-only document / native diff | 阅读派生内容与核对差异 | Brief、Review facts、Sync Resolve | 新的事实存储与永久 mutation receipt |
| Restricted Webview | 经验证确需组合交互的场景 | 仅 W1 获准的一个工作流 | Dashboard builder、任意脚本与编辑平台 |

不要为了“每种原生 API 都用上”实现全部 surface。每项增强必须对应一个反复发生的具体困难；已能用原生页面和短命令解决时，不增加专用 UI。

### 1.2 一份语义，多种入口

```text
Markdown / 既有外部 owner
          ↓
共享解析、索引、命名查询与校验
          ↓
编辑器 / TreeView / QuickPick / Peek / 虚拟文档 / 获准 Webview
          ↓ 用户明确选择
薄交互编排 → 重新验证来源与前提 → 命名 mutation / bridge
          ↓
核实结果 → 更新本地索引与相关视图 → 就地反馈 / 返回
```

薄入口可以传递来源描述和用户意图，不能独立计算 actionable、继承、参与人、同步许可或字段 ownership。新增公共语义只在现有 API 确实无法表达时进入 semantic-core，不冻结新的通用 ABI。

### 1.3 低负担默认体验

全局 Capture 仅内容必填；不要求先分类、估时或设置优先级。Now 帮助返回用户选定的一件事；Help Me Start 只明确下一小步；进展无需完成任务；Review 可以跳过；重新开始不要求清空旧账。

这些是认知可访问性的产品假设，不是 ADHD 诊断或治疗方案。采用减少记忆负担、可选步骤与用户控制干扰的原则，并用实际走查验证。[COGA] 不设必填诊断问卷，不建设大型“ADHD 模式”、streak、效率分或行为监测。

<a id="sec-2"></a>
## 2. Ownership、数据与安全边界

### 2.1 Authority 与存储

| 数据或能力 | Owner | 必须保持的边界 |
|---|---|---|
| 页面、任务、项目、Area 内容、进展、cue、显式 Interaction | Markdown | 唯一持久业务事实；不创建并列 canonical Object DB |
| 普通编辑、文件搜索、Wiki links、Backlinks、Outline 等 | VS Code / Foam 的实际可用 provider | LifeLoop 不抢占通用 PKM ownership |
| 任务选择、继承、关系事实、Review、命名 mutation | LifeLoop semantic-core | 所有 UI / CLI 入口共享语义 |
| 索引与派生查询 | SQLite / 内存缓存 | 可重建；不保存同步写入许可 |
| baseline、unresolved conflict、suspended binding | 共享 bridge state | 操作安全数据；不可随索引或 UI 摘要清除 |
| 时间区间、全天/重复实例、位置、attendees | Calendar | 只读取或同步已经承诺的字段；不扩大写入范围 |
| 通知、重复提醒 | Reminders | 不新增 LifeLoop recurrence / 后台提醒引擎 |
| 手机 pending note | Apple Notes bridge | 保留正文导入、所有权转移、富文本与冲突限制 |
| Now、scope、调用位置、未提交输入 | 有界 UI / 会话状态 | 可丢失；不是业务历史或安全 authority |
| 虚拟文档与 Webview 状态 | 展示层 | 可销毁重建；不能成为任务事实、同步 baseline 或长期工作流日志 |
| 凭据与外部专业数据 | 已有适当 owner | 不复制到正文、报告、URI、HTML 或默认 AI 上下文 |

### 2.2 G1–G3 原样适用

| Gate | 阻断条件 | 影响范围 |
|---|---|---|
| G1 Source / mutation | 错误对象写入、缺少 stale/ambiguous 校验、破坏无关正文 | 所有依赖该写入路径的功能与 UI 入口 |
| G2 Sync authority | baseline/暂停状态丢失后仍写入、不同执行者使用不同 truth、持久化失败却报成功 | 受影响 provider 的 sync / Resolve |
| G3 External effects | 危险覆盖、未核实重试、创建后绑定失败且补偿不可定位 | 受影响的外部写入功能 |

独立只读和本地路径可以先交付；受影响写入必须修复或明确禁用。新增 Code Action、preview 按钮或 AI 工具不构成绕过 gate 的理由。

### 2.3 Projection、源文档与 mutation

可操作对象携带 opaque source identity 和适用于当前快照的 guard。label、title、列表序号、行号、旧 offset、DOM data attribute、展示选中状态均不是写入 authority。

prompt、原生编辑、异步读取、diff 查看和 provider resolve 后，来源都可能变化。执行时重新验证目标及用户批准的前提；不能把旧选择默默重定向到另一个任务。找不到唯一来源时只读、刷新或重新选择。

复用宿主编辑与既有 vault preflight；dirty document 不能被磁盘 direct write 覆盖。多页面动作不得用多个未经协调的写入拼装。跨应用没有 ACID；外部动作继续核实、幂等检查和补偿，结果未知时先核实，不盲目重试。

原生手工编辑、普通 snippets/completion 和 semantic command 是不同路径。前两者沿用宿主 Undo；后者执行自己的 guard 与副作用契约。最终文本仍要进入同一解析和校验，不能因为由补全生成就视为已验证。

### 2.4 明确事实与历史范围

- `scheduled` 是计划日期，`deadline` 是期限，Calendar time 是外部日程；改其中之一不自动改另外两者。
- 尊重自定义任务状态政策；不把 `[ ]` / `[x]` 当作唯一状态，不自动完成子任务。
- Person 精确链接提供候选与明确上下文，仍需用户确认真实参与人；直接链接本身也不能证明某次互动发生。
- 继承 Person links 不自动成为参与人；普通 mention 不计 Interaction；不从标题、mtime、编辑活动推断联系或完成。
- 日期明确的用户记录可以进入已支持的事实查询；completion stamp 不是完整的完成/重开历史。
- History Sufficiency Rule 保留：确有历史问题需要时，增加最小显式 domain Markdown 事实，不把通用事件流藏进 SQLite。

### 2.5 Sync authority 与迁移

当前代码确认 observations、Notes baseline 和 conflict 主要处于 `apple.ts` workspace state。手动与 autoSync 共用同一个 VS Code command，当前没有 CLI sync writer，也没有已知静默覆盖证据。

同时已确认 Reminder 和 Calendar observation 的 `Memento.update()` 结果未等待，其中 Reminder store 还会从 memento 重新读取而没有同步 cache。observation 参与单边/双边修改判断，因此它不是可随意丢失的展示缓存。首个独立硬化必须让同一次运行看到一致状态、串行并等待持久化；持久化失败不能报告完整成功。完整 durable shared state、旧状态迁移和单写者准入仍是后续独立 milestone，不阻塞无外部副作用的本地 UX。

共享 bridge 层应持有 baseline、未解决异常、暂停与写入准入；VS Code 是当前唯一用户 Resolve control plane。手动、autoSync 及未来 CLI 都必须使用同一 authority。

迁移先读取和验证旧状态，再明确切换；新旧存储不能并行决定写入。缺失、损坏或矛盾的 baseline 不得视为首次同步并覆盖任一侧。外部效果发生后状态持久化失败，保留不确定性，重新核实后才能继续。

共享文件不等于并发安全。首版可只允许一个执行者，竞争窗口/进程明确拒绝；不自动接管、不引入分布式协调。vault/provider/binding 必须隔离。清理 UI 摘要、关闭 Webview、重建索引或恢复工作区都不能解除同步暂停。

Resolve 保留 fresh validation、受管字段 diff、Use LifeLoop / Use External、显式 Detach 和富文本/recurring Reminder 特例；不新增自动 three-way merge、逐字段合并或 conflict markers。

<a id="sec-3"></a>
## 3. 需求总表与原设计映射

### 3.1 A1–D4 保留与调整

以下仅标记本增补的影响，原文的完整流程、反例和独立资格仍适用。

| 基础 ID | 原能力 | 本版影响 |
|---|---|---|
| A1 | Quick Reschedule | 保留确定性日期和继承解释；增加 V1 就地入口与 E1 结果说明 |
| A2 | Inbox Skip / Edit / Resume | 保留 pending/所有权语义；增强输入返回和捕获后回原工作 |
| A3 | Contextual Task Actions | 多 surface 共用；键盘和编辑器不回退到错误目标 |
| A4 | Selection / scroll / focus | 扩展原列表返回、Peek/文档跳转、Context/Now；不承诺像素级恢复 |
| A5 | Actionable refusals | 保留恢复入口；补正常、部分成功与未知结果 |
| A6 | External Sync / report / Resolve | 共享 bridge authority 迁移与 G2/G3 不变；完整键盘与 native diff |
| B1 | Link / Add Context | 区分 Add Related Link 与真正 Set Project Context；增加已有事项补充 |
| B2 | Waiting → Next Action | 保持各意图独立；提交行动和最终结果分开 |
| B3 | Capture Selected Text + Source | 保留来源快照、dirty/untitled 限制；与 contextual capture 组合 |
| B4 | Pick Next Action | 保留原筛选但命名为 Add from Backlog；Now 为另一意图 |
| B5 | Clarify Task / Make Actionable | 加入无 AI 的 Help Me Start；不自动生成完整子任务树 |
| B6 | Peek Source + Why Here? | 新增 Why Not Here 与 editor Hover、原生多来源 Peek |
| B7 | Live Weekly Review actions | 原动作和 guard 不变；虚拟/冻结内容仍非永久可写 projection |
| B8 | Project action-gap resolution | 仅 Project 已有语义；不复制给 Area |
| B9 | Backlog resurfacing | 与手动重新开始组合；无自动 rollover 或 per-item cadence |
| C1 | Meeting Wrap-up | 独立提交步骤、确认参与人、禁止重放；V1/V8 可提供入口 |
| C2 | Completed / Logbook Quick Find | 最小完成查找可提前复用；完整期间解释继续原资格 |
| C3 | Project closure checks | 显示未完与已知 bindings，不声称发现全部外部对象 |
| C4 | Project resumption brief | 复用只读文档；不推断最近进展或决定 |
| C5 | Pre-meeting / Relationship resurfacing | 来源明确；外部失败时本地事实可单独看，明确缺失数据 |
| C6 | Review period facts | 只含可靠时间事实；不是完整事件历史 |
| C7 | Minimal Resume Cue | 已存在；最小版提前，与进展记录共用入口 |
| D1 | Today read-only Calendar Agenda | Calendar 范围/实例/时区资格不变；W1 不绕过它 |
| D2 | Recent Actions + Narrow Undo | 会话内窄反转及原生 Undo 共存；仍独立、后置 |
| D3 | Create Project from Task | 仍单独设计；不把 snippet 或 Attach Page 冒充完成 |
| D4 | Associate existing Calendar event | 继续 Deferred；不得按标题/时间相似度匹配 |

### 3.2 E1–E10：保留的产品需求

| ID | 需求 | 最小交付 | 顺序 |
|---|---|---|---|
| E1 | Today 与下一行动的意图区分 | 区分计划/期限/关注信号；B4 更名 | P1；新鲜度并入 P0 |
| E2 | Now / 当前任务 | 明确选定一个目标，随时返回，不改业务状态 | P1 |
| E3 | Help Me Start | 只明确一个下一步或缺少条件 | P1，无 AI 前置 |
| E4 | 上下文捕获、补充已有事项 | 可见目标、必要来源、保存后返回 | P1 |
| E5 | 进展、结果与 Resume Cue | 普通 Markdown，共同记录入口 | P1 最小版 |
| E6 | Find Task、scope、Why Not Here | 复用任务索引与已有语义 | P1 |
| E7 | 等待结果与结束承诺 | Complete/Cancel/Someday 等真实意图区分 | P1；新状态另行设计 |
| E8 | 日计划、收尾、重新开始 | 短而可跳步的组合流程 | P1/P2 |
| E9 | 轻量 Area 与生活领域 | 普通页面模板，必要查询另验收 | 模板可先行 |
| E10 | 可理解结果、空状态与上手 | 正常/部分成功/未知；轻量引导 | P0 基础 |

### 3.3 V1–V10：新增宿主接入，不是新增业务模型

| ID | Surface 增强 | 复用需求 | 建议交付 |
|---|---|---|---|
| V1 | Task / page Code Actions | A1/A3、B1/B5、E2–E5 | 首个 editor-first 切片 |
| V2 | 受管字段 completion | 日期、当前状态政策与已支持格式 | 与 V1 相邻，限制语法范围 |
| V3 | Snippets / 模板 | E5/E9，已有 Foam 模板 | 内容可先行，不做生成器平台 |
| V4 | Hover / 少量 CodeLens / decorations | B6/E1/E2；共享上下文摘要 | Hover 优先；其他按噪声与性能验收 |
| V5 | Diagnostics + 有限 Quick Fix | 现有受管字段与身份校验 | 已有 validator 到 Problems |
| V6 | 原生 Peek / 多来源导航 | B6/E6、Project/Person/Review | K0 重点路径 |
| V7 | 可移动 Context view / 单个 Now 状态入口 | A4/E2/E6 | 先复用现有 view，不强改布局 |
| V8 | 只读虚拟文档与 native diff | A6、B7、C4–C6 | 先一条 Brief/Resolve 路径 |
| V9 | 受限 Markdown preview 增强 | 既有 query table、Review/baking | 仅填补已证明的呈现缺口 |
| V10 | Walkthrough、帮助、能力与快捷键发现 | E10/K0、平台支持矩阵 | 轻量并行 |

K0 适用于每条已启用路径。W1、X1/X2、R1–R4 是后置准入项，不因为出现在清单中自动进入本轮。

<a id="sec-4"></a>
## 4. E1–E3：Today、Now 与开始行动

### 4.1 E1 — 不把计划、期限与提醒混为一谈

B4 原规则只选择未 scheduled、且未出现在 Today 的 actionable 任务，保留该规则并更名为 **Add from Backlog**。真正选择当前工作的路径应包含当前 scope 内符合共享 actionable 语义的 Today 任务。无候选时不放宽规则，未知或无效日期不当作未排期。

Today 展示区分：计划今天做、deadline 到期/逾期、过去计划未结束、Waiting/关系等关注信号。关注事项不自动成为可立即执行的任务。

同一任务多个命中原因应能识别为同一个 source，优先合并 reason；任务计数和信号计数分别说明，不更改底层过滤语义来凑 UI。

Quick Reschedule 保留 Today / Tomorrow / Next week / Pick date / Clear scheduled。Tomorrow 使用本地日历下一天，Next week 为下一个星期一，显示实际日期；使用日历运算跨 DST，不用固定 24 小时。取消不写入。

改期或 Clear scheduled 后若任务仍因 deadline 出现，必须说明剩余原因。`scheduled` 和 `deadline` 当前不是继承字段；继承来源提示适用于 `#waiting` / `#someday` 等 parked tags。绝不顺带修改 Calendar event。

跨本地午夜、休眠后恢复、窗口激活时按需核对日期/新鲜度。不得宣称某个未经核实的 sleep event API 一定存在；允许采用窗口激活等可验证路径。重新计算不改目标，不清空正在输入的内容。

### 4.2 E2 — Now 是工作目标，不是活动追踪

用户明确选择、切换或清除一个 Now。它不随活动文件自动变化，不改变 scheduled/deadline/任务状态/Calendar，不记录工时。

任务完成、取消、删除、变得不可用时说明变化，不自动开始下一项。默认可以只保留当前会话的来源提示；跨重启保留必须重新确认可唯一定位，不能复用 SourceHandle。

Now、当前浏览的 Context、固定的 Context、列表 scope 是四种不同 UI 意图。固定某个 Project 面板不自动把它设为 Now，也不假定当前代码编辑就是该项目的实际工作。

最小入口为 Return to Now、Open/Peek Source、Switch/Clear。状态栏或 TreeView 只是表现形式，不能成为唯一可达入口。

### 4.3 E3 — Help Me Start

复用 B5，支持写一个下一步、打开所需资料、缩小当前动作、记录缺少条件。默认只产生一段用户确认的文字或一个明确行动；不要求 effort、energy、priority、估时或完整拆解。

示例：将“完善评测流程”澄清为“打开最近一次失败结果，选一个需要复现的输入”。这是用户可编辑的示例，不是系统推断事实。

不自动完成上层任务、创建 Project、批量插入子任务或改日期。输入过程中打开材料后可以返回；AI 未配置或关闭时本功能仍完整可用。

<a id="sec-5"></a>
## 5. E4–E7：捕获、记录、查找与结束承诺

### 5.1 E4 — 捕获与补充已有事项

全局 Capture 默认进入既有 Inbox，只有内容必填。从 Task/Project/Person 发起时显示将使用的目标与上下文，允许更改，但不每次强迫重复选择。

Link/Add Context 的文案应准确：**Add Related Link** 只是补链接；**Set Project Context** 仅在已有语义真正支持改变归属时出现。不把普通链接、参与人和任务归属混为一谈。

给已有任务补充内容时，先精确选择目标，再说明追加位置和形式。多行、子树、Markdown 特殊语法需要既有或新命名 mutation 的契约；没有安全契约就打开源编辑器，不 direct write。

保留“补链接仍 pending”和“补链接并完成处理”的差别。Notes-bound pending item 继续原导入和所有权转移规则；取消可选 Project/When 不提前移动 item。

Capture Selection 只读取当前明确选区快照及可获得来源。dirty/untitled 状态如实标注；行范围只是捕获当时的导航线索。无选区引导普通 Capture。不读取剪贴板历史、其他应用内容或推断远端链接；不执行捕获正文中的命令。

保存后默认回到发起位置，提供 Open Result，而非强制切到 Inbox。临时想法寄存后不立即弹整理流程，不新建 distraction inbox。

### 5.2 E5 — 进展、结果与 Resume Cue

普通想法、进展和结果不是 Task，也不是 completion 或 Interaction。优先使用原生编辑器或 Capture Here 写普通 Markdown。

C7 已存在，继续可选，与进展使用同一路径；已有明确 next action 时不要求再写。记录日期不得冒充活动发生日期；只在符合已有 Journal/显式日期语义时进入期间事实。

Cue 保存失败需说明，不能声称与暂停项目构成跨页面原子事务；取消 cue 不阻止独立的暂停动作。未找到可靠 cue 时继续显示 C4 的事实背景，不自动识别普通文字为下一行动。

### 5.3 E6 — 查找与范围

Find Task 使用现有索引，默认只要求文字输入，按需筛选状态和 exact Project/Person。若当前入口已有明确范围，应显示而不是隐式隐藏。普通正文、文件和 Wiki link 检索仍由宿主负责。

结果显示状态、必要上下文与完整路径；重名不按标题决定 identity。可 Open、Open to Side、Peek、Task Actions。完成查找复用 C2，不声称覆盖完整 reopen 历史。

scope 显式可见且可键盘清除；过滤后为空不等于全库为空。scope 不提供权限或隐私隔离。

Why Not Here 针对一个已选定任务和一个明确目标视图，复用共享 predicate/reason，解释不匹配原因；不做模糊全库推断，不自动清除 Waiting、改日期或恢复 Project。没有解释契约的规则，应明确未知并提供 source，而不是编造理由。

Area 仅使用已有可证明 convention；未有共享查询时仅提供页面导航和模板。UI 不得临时实现隐式继承。

### 5.4 E7 — 等待结果与真实终止

区分“提交/发出请求”与“最终结果已确认”。B2 的清除本地 Waiting、Complete、创建下一行动、Schedule 是独立意图，不自动串联，不声称对方已收到、接受或完成。

菜单区分 Complete、Cancel/Drop、Someday、Clear scheduled 与 Delete。Cancel/Drop 只在当前状态政策有明确非完成终止语义时启用；否则单独设计，不猜 checkbox 字符。

不要求所有等待事项设跟进日期，不按模板自动催办。Project closure 检查的 open tasks、Waiting 和 bindings 只代表已索引/已知范围，不能宣称发现全部外部责任。

<a id="sec-6"></a>
## 6. E8–E10：恢复、生活领域与结果反馈

### 6.1 E8 — 日计划、日终整理、重新开始

三个入口是已有命令的短组合，不是 DailyPlan 对象或持久步骤引擎。可以跳过、暂停，不要求先清空 Inbox、完成昨日复盘或填写三个目标。

日计划帮助查看期限、旧计划并选择当前承诺；收尾帮助保留/改期/停放/取消并可选留 cue；重新开始允许先处理真实期限和一件当前事项，其他 backlog 稍后整理。

不自动把全部过去 scheduled 改成今天，也不为了减轻负担隐藏真正 deadline。先做连续逐项整理；多选批量修改需另验部分成功、stale 与外部边界。

### 6.2 E9 — 长期领域，不是永久项目或资本数据库

Area 表示长期需要照顾的责任，Project 表示有限工作。Area 无任务不等于缺口；不复用 Project 的 no-actionable signal 报错。不强制建齐所有领域，不强制每条任务分类。

一件事可跨领域引用，但执行事实只有一份。健康、财务、关系、家庭、事业、学业用于检查覆盖；不引入 `capital_value`、ROI、技能或关系评分。家人不是可优化的资产。

| 模板场景 | 支持的活动 | 边界 |
|---|---|---|
| 健康/预约 | 记录问题、准备材料、预约、明确后续 | 不诊断、不建健康数据库；关键提醒不依赖 VS Code 常开 |
| 财务/事务 | 提交、保存依据、等待、核实结果 | 不做账本、付款、税务或投资执行 |
| 家庭/照护 | 自己承担的责任、协商、确认安排与交接 | 链接家人不等于家人接受任务；不建多人平台 |
| 关系 | 准备互动、显式记录、兑现承诺 | 无记录只说明未知；不自动推断联系人状态 |
| 工作/学习 | 实践、进展、结果、作品、反馈与来源 | 完成数不等于能力增长；不复制专业资料系统 |
| 居住/维修/出行 | 问题、资料、预约、等待、确认 | 不建家庭 ERP 或全量资产库 |
| 休闲/恢复 | 可选安排、想法、体验 | 允许完全不记录、不任务化 |

模板默认普通标题、段落或有序文字；不一插入就生成全套活跃任务。领域盘点是用户手动选择一两个 Area 的反思模板，不新增 review cadence、last-reviewed、健康分或全库审计要求。

### 6.3 E10 — 正常成功也要可解释

| 已知状态 | 应表达的结果 |
|---|---|
| dirty buffer 已修改 | 已更新编辑器，尚未保存磁盘 |
| Markdown 已保存、索引更新中 | 保存成功，视图尚在更新 |
| 清除本地 `#waiting` / `#someday` 但父级继承仍生效 | 本地 tag 已清除，显示剩余来源 |
| 本地成功、外部失败或未知 | 分开说明，提供报告，不重做本地动作 |
| 手机上捕获、桌面尚未核实导入 | 显示可验证的读取/导入状态，不宣称已全量同步 |
| 多步 Wrap-up 部分完成 | 分步骤显示；后续取消不撤销或重放先前已提交事实 |

空状态统一区分：确实没有、过滤无匹配、加载中、过期、读取失败、未配置。读取时间不冒充成功同步时间。

步骤间 Back 保留会话内输入；Esc/退出、保存草稿到 Inbox、提交后取消后续步骤是不同结果。不要把全文草稿暗存 workspace state。

反馈优先留在当前 view 或文档，避免成功 toast 洪泛与抢焦点；需要用户决策的异常有键盘可达入口。通知的克制使用符合宿主 UX 指南。[VS12]

首次使用只需确认 vault、捕获一条并找回来源。Area、Person、Apple bridge、timer 和 AI 均不是基础使用的前置条件。

<a id="sec-7"></a>
## 7. V1–V6：编辑器内的操作、理解与导航

本节将 E/A/B/C 需求接入宿主，不改变业务语义。官方 provider/API 的存在只证明技术路径可行；注册范围、最小版本、延迟和 Foam 共存仍需实际验证。[VS1][VS2]

### 7.1 V1 — Code Actions：在任务原文上行动

用户将光标放在一个可识别的真实任务上，可以调用 Code Actions 获得少量高频动作，例如 Schedule、Set as Now、Add Progress Note、Open Context，以及 More Task Actions。页面级动作仅在页面身份与类型可证明时出现。

命名操作复用当前命令及 semantic-core；没有实现的操作不展示为可用。默认不把所有低频任务菜单展开成几十条 Code Actions。

**提供/解析 Code Action 与执行 Code Action 必须分开：**

- `provideCodeActions` / `resolveCodeAction` 只查询或准备展示，不进行 Markdown 写入、同步、AI 调用或外部创建。
- 用户实际执行后，重新验证来源、相关版本、状态政策和所选参数。返回的 range 或 command arguments 不构成永不过期的许可。
- 普通任务动作不是错误修复。只有真正受管格式/语义问题才标为 Quick Fix；不为出现灯泡而制造诊断。
- 不把 Complete、Interaction、Schedule、Reminder/Calendar 动作纳入 `source.fixAll`、on-save 或格式化自动执行。`CodeActionTriggerKind.Invoke` 也可能由扩展请求，不能被视为用户已批准业务写入的证据。[VS2]
- Code Action 中的预计算 `WorkspaceEdit` 不能用来绕过延迟后验证。优先转到既有命名命令，在执行时生成实际变更；不同时执行重复的预编辑和命令编辑。

多光标、多任务选区、例子代码块、注释、生成文档均不能静默选择“第一条”。只支持单一可证明目标；不满足时提供选择器或只读解释。普通编辑器 `Cmd+.` / `Ctrl+.` 路径必须与 Task Actions 语义一致。[VS4]

### 7.2 V2 — Completion：少记受管语法

只在真实 vault Markdown 中、核心解析器可证明是受管字段的位置提供补全。范围包括已有字段名、当前状态政策允许的值、有效日期候选；具体字段以现有 parser/contract 为准，不从本文发明新语法。[VS1]

输入日期时可提供 Today/Tomorrow 等**显示实际日期、插入已支持格式**的候选；跨日后重新计算。日期计算复用 A1，不单独实现一套规则。

“Pick date…”不是一个可写入的日期值，放在 Code Action/日期命令中，或以单独明示的命令处理，不能作为 completion 文本误插入。动态明天日期由 provider/命令计算，不假定静态 snippet 自动完成。

接受 completion 只是用户原生编辑，不自动触发 processing、状态转换、Journal Interaction 或外部同步。若需要业务命令，必须显示另一个明确动作。

不覆盖 Foam 的 Wiki link、alias、page name 或普通路径补全。不对整篇 frontmatter 注册全局 YAML schema，不在不确定语法片段中强行建议。新字段键入未完成时不闪烁报错或反复改写输入。

补全的 edit range 来自当前文档版本；源已变更的旧候选不能删除其他内容。IME、multi-cursor、CRLF、引号和特殊字符必须测试。候选过多时缩小范围，不借此创建 schema builder。

### 7.3 V3 — Snippets 与场景模板

复用现有 Foam 模板优先；缺少的通用内容可以通过 VS Code snippets 分发。[VS8] 使用清楚的 LifeLoop 前缀与自然名称，避免挤占所有 Markdown 补全。

建议首批只提供：普通进展/结果、Resume Cue、预约准备、请求与等待、项目收尾、领域盘点。示例内容不包含真实个人数据或外部 binding。

示例（内容模板，不是新的解析协议）：

```markdown
## 本次进展

结果：

仍需确认：

下一步：

相关资料：
```

插入模板不自动创建 Person/Project、不自动标记 Interaction、不执行命令。需要实例任务时由用户明确 Capture 或手动写入受支持语法。

同一模板不同时在 Foam 和 LifeLoop 注册两个相同默认入口；选择一种分发方式并文档化。模板、只读示例与真实业务页面在索引中必须可区分，见第 11 节。

### 7.4 V4 — Hover、CodeLens、Decorations：少量就地信息

Hover 优先解释受管字段与当前任务：有效值、direct/inherited 来源、Why Here/Why Not Here、相关的可验证上下文。详细内容提供 Open Context，不复制整页正文。[VS1]

CodeLens 优先放在 Project/Person 页头、受支持 section 或 query block，展示少量可操作摘要；不默认给每条任务加一整排按钮。摘要来自共享查询，在同一 snapshot/scope 下应与 TreeView 一致。

Decorations 仅用于少量可关闭的标记，例如 Now、受管字段状态；不改变正文、不靠颜色独自传达含义。不得用编辑器占用时间推断进度或生产力。[VS2]

Hover/CodeLens/decoration 本身不发起外部读取。绑定是否存在与事件是否当前可用必须区分；需要最新 Calendar 数据由用户命令读取。

MarkdownString/HTML 中的用户文本须安全转义。命令链接只允许受控命名入口；不对用户来源内容整体设置 unrestricted trust，不允许用户文本生成任意 command URI。

Hover 或 CodeLens 关闭时仍可通过 K0 的命令或选择器取得相同信息。加入这些 surface 不应导致每次索引刷新都改变大量文档行间布局。

### 7.5 V5 — Diagnostics + Problems + 有限 Quick Fix

将现有 validator 能明确定位的结果接入 LifeLoop 自己的 DiagnosticCollection。[VS1] 先覆盖已拥有的受管字段和身份问题，不扩建新审计平台。

| 可呈现问题 | 不应呈现为问题 |
|---|---|
| 有效性不满足契约的日期或状态值 | 未完成任务、过期计划本身 |
| 影响可靠定位的重复 anchor | 很久未联系某人 |
| 可定位的受管 binding 格式冲突 | Area 没有任务 |
| 当前支持字段中可证实的非法值 | 用户未填写可选 metadata |

每项包括来源、具体范围、简明原因和可执行恢复入口。与 Foam/宿主已有 diagnostics 重复时选择单一 owner；不清除其他 provider 的诊断。

dirty buffer 支持时基于其版本重新验证；当前 core 不支持该路径时，标明诊断是磁盘快照、暂停对旧范围的修复，不伪装为实时结论。键入中的不完整字段避免激进报错，可延迟到可稳定判断时或保存后。

Quick Fix 只修当前明确问题，经命名 mutation 或经验证的有限编辑执行；无通用 Fix All、无修复后自动同步。无法准确定位的外部异常留在 Sync Report，不在任意一行画红线。

来源删除、更名或问题已修复后，移除或更新对应诊断；不能让旧诊断把操作引向复用同一行号的新内容。

### 7.6 V6 — Peek、Go to Locations 与原生返回

已有语义查询可把明确的来源列表交给 `editor.action.goToLocations` / `editor.action.peekLocations`，或使用原生打开/侧开；无需重做通用 definition/reference provider。[VS3]

典型路径：Task → 相关背景；Project → 关联任务；Person → 显式 Interaction；Review fact → 当前仍可定位的来源。

原生 Peek 命令需要有效起始文档与位置；从无编辑器的 TreeView 调用时若缺少合法起点，使用 source picker 或先打开源，不伪造位置。无结果显示原因，不回退到模糊 basename 搜索。

普通 Wiki links 的 F12、References、Outline 和 Breadcrumbs 由实际可用的 Foam/宿主 provider 负责。LifeLoop 不全局拦截 Markdown 的定义/引用/rename 语义。

导航位置只用于读取；导航到旧位置后采取动作仍重新获取 guard。生成文档的来源映射明确区分它展示的原始任务与文档自身，不能直接执行生成行中的文本。

<a id="sec-8"></a>
## 8. V7–V10：上下文视图、派生文档与上手

### 8.1 V7 — Context view、Now 与布局

优先复用现有 TreeView。确需持续上下文时，可以提供一个用户可移动的 Context view，而不是每个类型一个新 view。VS Code 支持移动 views，具体位置由用户决定。[VS6]

支持 Follow current context 与 Pin this context 时，模式必须可见并可键盘切换/清除；跟随浏览不自动改变 Now。不要根据焦点跳转把输入中的处理对象换掉。

推荐布局只写在帮助中：主编辑器保留实际工作，Today/Inbox 聚合，Context 可选放第二侧栏。安装或升级不得自动重排用户窗口、关闭编辑组或修改 keymap。

Now 状态栏入口短且可关闭，初版同一时间只保留一个主要工作状态入口；异常仍有独立可发现的报告，不能被 Now 掩盖。状态栏不是唯一操作入口。[VS11]

Tree items 使用稳定来源身份而非 label/date 生成临时 ID；scope、展开、选择与局部刷新沿用 A4。不能承诺宿主未公开的像素级 scroll restoration。

若启用 TreeView checkbox，应显式避免默认父子联动映射为批量完成。可使用宿主手动管理 checkbox 的能力，但具体单项状态政策与事件处理必须验收；checkbox 不是覆盖自定义状态的通用二态模型。[VS2]

Multi-select / drag-and-drop 只有在相应批量/迁移语义已经获准时启用。选中多项不自动扩大单项命令作用范围。拖拽必须有等价键盘路径，且不得顺带改变 Calendar、项目状态或任务顺序的持久语义。

### 8.2 V8 — 只读虚拟文档、Brief 与 Diff

VS Code 的 `TextDocumentContentProvider` 可提供只读文本，支持更新并参与普通打开文档流程。[VS7] LifeLoop 优先用它呈现临时 Brief、Review facts 和受限上下文摘要；不为只读内容实现完整 FileSystemProvider。

每份内容显示对象范围、当前生成/读取时间、事实的真实日期、缺失或过期信息；不得用生成时间代替业务事实发生时间。内容读取来自已取得的共享结果，不因 document provider 被重复请求而再次执行外部操作。

优先生成普通可选取文本，支持原生查找、复制和并排阅读。语法高亮和 Markdown preview 可复用，但必须验证资源解析与来源跳转；不能假定 custom URI scheme 自动获得所有 Wiki link 能力。

**生成内容不是 canonical：**

- 自有虚拟 scheme 不进入 canonical index，也不接受以自身文本为目标的 task mutation。
- 从生成内容操作原始任务时，通过受控来源映射重新验证；没有映射则只读/选源。
- URI 使用有限、不敏感的标识，正文不编码进 URI、标题或诊断日志。敏感标题也应最小化。
- live view 与 frozen Review 不同：冻结内容不随底层变化改写；用户从快照跳回来源后才操作当前事实。
- Bake/export 为显式动作，重新检查目标存在性与写入范围；导出不自动保留可永久信任的 receipt。

Calendar 读取失败可按 C5 展示独立的 Markdown facts，但必须明确外部部分不可用；不能渲染为一份所有字段都权威的完整会议 Brief，也不以过期缓存掩盖失败。

Sync Resolve 使用 `vscode.diff` 或已验证的原生字段比较表示；这里只比较受管内容。[VS3] 打开或关闭 diff 都不批准覆盖。用户选择 Use LifeLoop / Use External 后仍重新验证双方、binding 和 baseline。

### 8.3 V9 — Markdown preview 的窄增强

VS Code 提供 Markdown preview 样式和解析扩展路径。[VS9] 先复用当前 LifeLoop table/hover/baking 与 Foam hooks，不新建通用 renderer。

只增强 LifeLoop 自己生成的 query blocks、来源提示和必要状态标记。CSS scope 限制到自身容器，不重置全局 Markdown 样式；分别验证两种扩展加载顺序。

脚本默认不引入。确有需要时按 W1 的信任原则处理：用户文本不变成任意 HTML/command，按钮不自行推断 source，不能直接写文件或桥接 Apple。表格没有可证明行身份时保持只读。

浏览器式 preview 中无法完整键盘操作的地方，应有同查询的 native picker/文档入口；不要求为了一个链接再做 editable grid。

### 8.4 V10 — Walkthrough、帮助与能力发现

使用少量原生 Walkthrough steps 与视图空状态说明，帮助用户确认 vault、捕获、定位来源和执行一个基本动作。宿主 Walkthrough 是引导入口，不是安装后强制运行的设置向导。[VS13]

首次使用不扫描/迁移个人数据、不安装额外工具、不创建一套生活领域页面。示例只能在用户选择的位置插入，不混入现有真实任务。

提供 Keyboard Help、Open Keyboard Shortcuts、当前 view 的 scope/禁用原因、平台能力说明。依赖缺失时仍保留不依赖它的基础路径。

帮助中的宿主命令和 LifeLoop 命令必须核对实际 manifest；动态快捷键如果无法可靠读取，链接到宿主设置而不是假装获取了用户当前绑定。

<a id="sec-9"></a>
## 9. K0：完整键盘交互契约

K0 沿用上一版 K1–K6，并扩展 K7/K8。它适用于所有交付的 surface，不能以“底层命令注册了”宣称 keyboard-ready。

### K1. 覆盖入口、完成、返回与失败恢复

所有启用的 LifeLoop 用户操作必须有键盘路径：进入、选择、修改参数、执行、取消、返回、查看结果、修复异常。图标、hover、CodeLens、状态栏、toast、拖拽或 preview 链接均不能是唯一入口。

覆盖插件拥有的交互和已验证宿主衔接，不承诺控制所有第三方扩展、系统权限弹窗和外部应用内部 UI。不支持的平台或缺失 provider 如实降级。

### K2. 命令可发现，快捷键不泛滥

保留少量稳定可搜索入口：Capture、Today/Inbox、Task Actions、Find Task、Go to Context、Return to Now、Open/Peek Source、Resume Processing、Review、Sync Report/Resolve、Keyboard Help。

细分操作可在短 QuickPick 中选择，不要求每个字段有独立快捷键。Code Actions 和列表菜单使用同一实现，不建立 generic action registry。[VS5]

默认快捷键须检查 VS Code、Foam、系统、键盘布局和可选 Vim keymap；不全局抢占字符、Tab、Enter、Esc、方向键。帮助优先打开实际 shortcut 配置。[VS14]

以下仅作默认参考，用户绑定与实际宿主版本优先；Linux 需单独核实。[VS4]

| 操作 | macOS 默认 | Windows 默认 | 注意 |
|---|---|---|---|
| Command Palette | Cmd+Shift+P | Ctrl+Shift+P | 搜索命名入口 |
| Quick Open | Cmd+P | Ctrl+P | 普通文件导航归宿主 |
| Code Actions / Quick Fix | Cmd+. | Ctrl+. | 仅在 provider 可用处；不保证灯泡始终显示 |
| Go to Definition | F12 | F12 | 相应语言/链接 provider 必须可用 |
| Peek Definition | Option+F12 | Alt+F12 | LifeLoop 多来源 Peek 可有自己的显式入口 |
| 编辑历史后退 | Ctrl+- | Alt+Left | 不等于返回自定义列表 |
| 编辑历史前进 | Ctrl+Shift+- | Alt+Right | 沿用宿主历史 |
| 显示 Hover | Cmd+K Cmd+I | Ctrl+K Ctrl+I | 长内容仍有文档/picker 替代 |
| 快捷键设置 | Cmd+K Cmd+S | Ctrl+K Ctrl+S | 检查真实命令与冲突 |

可选 chord 示意：`<LL> c=Capture`、`t=Today`、`a=Task Actions`、`n=Return to Now`、`f=Find Task`。`<LL>` 是待选择并排查冲突的前缀，不是已实现的 keybinding。默认不自动写入用户 keybindings.json。

### K3. 跳转与三种返回

| 路径 | 行为 |
|---|---|
| Today/Inbox/Review → source | 定位当前可证明来源，可打开/侧开，不据旧行号写入 |
| 原文 → Task Actions | 当前 task 唯一且 fresh；否则选择器 |
| Task → Project/Person/Area | 一个明确关联可直达，多个则选择 |
| Project/Person → related sources | 共享查询 → native Peek 或 picker；标明范围 |
| Problems → source → Quick Fix | 问题仍成立才修，不重放旧 edit |
| Brief/preview → source | 使用原始来源映射，没有映射则只读 |
| source → 原列表 | 恢复 view/scope/可确认选择；消失则邻近项或父组 |
| 任意受支持入口 → Now | 显式 Now；失效时重新选择，不自动改任务 |

宿主 Go Back、Return to Invoking View、Return to Now 是三个不同意图。保留有界调用线索，不建立无限导航历史、布局快照或窗口管理器。不承诺像素级滚动。

### K4. 正确目标先于快捷操作

有显式 node/action 参数时使用该目标。无参数的 Command Palette/快捷键入口只有在当前真实焦点来源可证明时才推导；不能用后台 editor cursor、最后选择或 Now 替代不确定目标。

`when` / context keys 仅决定入口适用性，不是授权或 guard。[VS15] 弹框、Peek、diff、刷新之后重验原批准目标，不能静默重定向。

Enter 默认打开或确认当前选择；不把它在所有控件中重绑定成 Complete。Space、单字符和多选操作只有在明确隔离的控件内才考虑，不能破坏正文输入或 IME。

### K5. 输入、取消与 Resolve

Back 保留尚未提交输入；Esc 不被重新定义为全局 Undo。关闭整个流程和返回上一步应清晰区分。长文本留给 native editor。

输入法候选确认、重复 Enter、快速触发命令不能造成提前提交或重复创建。独立步骤已完成后取消后续步骤，不回放之前步骤。

Resolve 全路径需纯键盘可完成：选择异常 → 看差异 → 返回选择 → 明确 Use LifeLoop/Use External/Detach → fresh validation → 结果/未知说明。不能核实未执行的操作不提供盲目 Retry。

### K6. 可访问性与验证范围

焦点可见；状态不只依赖颜色/声音/动画；文本可读，label、禁用原因和 loading/unknown 有明确含义。缩放、窄窗口、高对比度和辅助技术需实际验证。[VS17]

记录平台、VS Code/Foam 版本、键盘布局和已测试 keymap。鼠标走查或自动命令测试不替代真实键盘证据。

### K7. 新 surface 的键盘等价路径

- Code Actions 无需鼠标灯泡；键盘入口可发现且只列适用动作。
- CodeLens/decoration 可关闭，信息仍可从 Context/命令找到。
- Hover 长内容或命令无法可靠聚焦时提供 native document/picker。
- Peek 能返回起始工作；宿主行为不足时明确提供返回列表命令。
- 虚拟文档支持原生查找、选取、复制；原文操作需单独定位，不编辑派生内容。
- Webview 获准时必须完整 tab/focus/Back/退出，不允许拖拽成为唯一操作。

### K8. 低负担不等于跳过验证

普通确定性 Schedule 的实际日期选择可表达一次操作意图，无须再弹内容相同的确认；guard 仍然执行。外部覆盖、不可逆或新增副作用仍按原契约确认。

确认次数按副作用与用户意图设计，不用重复弹窗替代正确目标，也不为了减少步骤取消 G1–G3。

<a id="sec-10"></a>
## 10. W1：单用途 Webview 准入

### 10.1 允许，但不是默认实现路线

VS Code 官方建议只有原生能力不足时使用 Webview，并要求遵守宿主的主题与可访问性体验。[VS10] LifeLoop 继续拒绝通用 Dashboard，但不永久排除解决一个具体困难的自定义视图。

| 候选 | 必须先证明的原生方案不足 | 最小允许范围 |
|---|---|---|
| Today planning | 日程与候选任务并看时持续重复切换，分栏+TreeView 仍不足 | Calendar 只读、任务选择、现有 Schedule；D1 先合格 |
| 长内容 Inbox 处理 | 阅读长正文与选择去向反复丢上下文 | 只读内容+少量动作；长文本编辑仍回 native editor |
| 固定结构 Review | 用户需要同时看事实和当前事项，现有文档+列表明显不足 | 单一 Review 流程；无任意组件和布局搭建 |

每次只选择一个候选，写明手工路径、频率证据、预期减少的切换和放弃条件。没有证据就保持 Deferred。不能因为“像独立 app”而扩大 scope。

### 10.2 数据与命令边界

Webview 只展示共享查询和当前选择，不保存自己的任务、日计划、CRM 或同步数据库。`setState` / serializer 如使用，只保存少量展示线索，不保存凭据、全文草稿、guard、baseline 或完成步骤历史。

每条 message 均为不可信输入。extension 端验证消息类型、长度、枚举、当前 view 实例、source/scope 与版本；只允许小而明确的命名操作，不提供 `execute arbitrary command`、任意路径写入或通用 SQL/脚本入口。

前端携带 row ID、snapshot 标识、按钮参数，均不能单独授权写入；仍从 extension/core 重新解析与校验。旧 panel、重复消息、刷新后的旧确认必须安全拒绝或重新选择。一次交互中的重入可局部抑制，不承诺跨重启 exactly-once。

### 10.3 Web 安全、输入与降级

限制 `localResourceRoots`、采用适当 CSP、转义用户内容；只有需要时启用脚本，不用宽泛远程资源加载和任意 inline 执行。命令 URI 默认不用，确需时仅白名单入口；消息及 HTML 不包含 bridge secrets。[VS18]

网络默认关闭；请求外部数据通过既有 bridge 路径，不在前端私建客户端。隐藏/销毁 panel 不取消已经发生的外部事实，也不解除暂停。

完整支持键盘、可见焦点、合理 tab 顺序、IME、主题/高对比度/缩放；无 focus trap，拖拽有命令等价路径。能导出/打开同一结果的普通文本，关闭 Webview 后原生核心流程仍可用。

不新增长期文档编辑器或自动接管 `.md` 的 Custom Editor。微软原 Webview UI Toolkit 仓库已标记 deprecated；不要照旧教程默认引入，依赖选择需单独核实。[VS19]

### 10.4 放弃条件

若原生组合已消除主要摩擦、Webview 引入更多确认/状态分叉、不能达到 K0、或测试/安全成本超过已验证收益，则撤回试验。撤回不得丢失业务事实或改变外部绑定。

<a id="sec-11"></a>
## 11. 宿主、性能、隐私与恢复资格

### 11.1 热路径不得做重工作

Completion、Hover、CodeLens、diagnostics、decorations 可能因编辑和选择反复请求。它们只读取已有本地索引/缓存或受控的当前文档解析，不触发全库扫描、Calendar/Notes 同步、网络请求或 AI。

当前实现不满足这条：Code Actions 会通过 `currentTaskStates()` reindex；输入事件虽然传入 live document，diagnostics 仍遍历并清空全 vault collection。第一步只修这两个具体调用链：provider 不 reindex，索引未 settle 时只返回无需陈旧上下文即可安全表达的有限动作；mutation command 继续执行完整 fresh validation。输入时只替换当前 document diagnostics，不清空其他页面；debounced `touch()` 成功后首版保留现有全局发布，只有测量证明它仍是瓶颈时才增加受影响依赖跟踪。

缓存按正确的 vault、document version、index snapshot、必要的日期/配置条件失效。多个 surface 尽量复用已算结果；不引入新查询引擎。保留取消/过期结果处理，较早请求晚返回时不能覆盖较新的内容。

dirty buffer 与磁盘索引不一致时，优先使用 core 支持的文档快照路径；不支持则明确“源已变更/等待刷新”，不拼凑一份看似一致的权威结果。provider 不能复制一个 UI 私有 parser 来掩盖不一致。

按相关变化局部更新，隐藏或不可见内容避免持续重算；频繁输入时合并刷新。对即时数据不做错误的永久缓存，对外部数据不把缓存存在等同于当前有效。首轮性能证据优先记录 provider 请求触发的 reindex/全库扫描次数；wall-clock latency 是辅助证据，不为此加入生产 telemetry 或通用缓存框架。

**基础性能不是可推迟到 Analytics 阶段的功能。** 每个 editor-first 切片至少测：激活开销、输入响应、provider 延迟、索引刷新、内存及打开大文件时的退化。在写验收前记录代表性 vault 规模和目标预算；本文件不虚构已经达到的毫秒指标。

### 11.2 注册范围、Foam 共存与 API 版本

实施时核对 `engines.vscode`、实际 `@types/vscode` 和所用稳定 API；网络文档存在不意味着最低支持版本已有。不要为一项 UX 默认启用 Proposed API。

DocumentSelector 及运行时 scope 仅覆盖获准 vault、支持的 URI scheme 与 Markdown 语法位置；过滤生成文档、帮助样例、无关 code workspace。具体 remote scheme 在资格明确前不得自动放开。

通用 Wiki link、Backlinks、搜索、Outline、rename、格式化与已拥有 diagnostics 不重复提供。保留 task-only 与 Foam 共存两个 profile，不通过修改用户 Markdown association、全局配置或禁用 Foam 来宣称兼容。

### 11.3 本地、远程、Web 与多窗口

VS Code 的 UI/workspace extension 可能在不同 extension host 运行；本地 Apple bridge 不会因为 UI 在桌面上就自然可从远端调用。[VS16][VS23]

| 环境 | 基础策略 |
|---|---|
| 本地桌面 + 明确本地 vault | 逐功能验证；支持能力从 manifest 和测试记录确认 |
| 本地桌面，无 Foam | 任务与显式 source 操作正常；普通 Wiki 导航按真实 provider 降级 |
| Remote SSH / container / Codespaces | 不把远端路径当本机 vault，不把 Apple 调用派给错误宿主；按能力禁用或提示 |
| Web / virtual workspace | 未验证写入与 native bridge 前仅支持明确合格部分，不宣称完整 parity |
| 多窗口 / 多 vault | UI 状态按 vault 隔离；同步遵守单一执行者准入；跨窗路由另设计 |

不自动把个人 vault 加进工作代码 workspace。跨工作区便捷入口属于 R1，不能以增加一个侧栏绕过隐私与执行位置问题。

### 11.4 Workspace Trust 与隐私

明确声明并处理 Restricted Mode：不可信 workspace 的设置、正文、链接或脚本不能触发进程、外部桥接或超出授权 vault 的读取/写入；核心中可安全的只读部分是否开放需分别说明。[VS20]

Workspace Trust 是宿主保护机制，不是 LifeLoop 的所有权模型，也不等于不同扩展之间的强沙箱。VS Code 扩展具有广泛的文件与进程访问能力；单独 profile 可以减少配置混杂，但不能被称为安全保险箱。[VS21]

不把家人/工作资料默认导入 AI，不从未选择的 vault 取上下文。任何日志、URI、Webview、状态栏标题和导出都考虑最小披露；不要为了调试保存私人全文。

### 11.5 派生内容、示例与恢复

虚拟文档同样会出现在宿主文档事件中，因此索引和 provider 必须检查 scheme，而不是以“已经打开”判断为源文档。[VS7]

当前 `openTextDocument({content})` 产生可编辑 `untitled:` document，不是只读虚拟文档；Foam 对这些 Markdown document 的 provider 日志仍是已知问题。V8 首次实施前只验证一个最小输出的 custom scheme/language、只读性、Foam 共存、Open Source、生命周期和不重复入库。首版不从生成行直接 mutation，也不预建通用派生文档平台。

试验时必须证明：打开 Brief/Review/diff、刷新 preview、反复关闭重开，不增加 canonical task/Interaction 数量。generated content 不产生新的跟进或完成事实。

对 bake/export 或模板示例的磁盘副本，沿用已验证的非执行表示/排除契约；若当前 parser 无法证明不会重复索引，先只提供虚拟只读结果，不把可执行 checkbox 文本写进参与索引的路径。具体 marker/排除格式需与 core 一起验证，不能单靠文件名约定假定安全。

删除 SQLite 只能恢复从原始资料可重建的索引，不是 Markdown 或 bridge state 的备份。升级/恢复演练需区分：原始文档、操作安全状态、索引、UI 提示与生成内容。

恢复后 bridge baseline 不明必须暂停受影响写入，而非把外部对象当作首次导入。使用隔离副本演练，不默认创建云备份、上传 Git 或执行个人 vault 迁移。

<a id="sec-12"></a>
## 12. 受限试验与后续 roadmap

### 12.1 X1 / X2：执行辅助，不变成新平台

**X1：短 timebox。** 用户主动开始，可无声、无动画、关闭。它表示愿意先投入的范围，不是预计工期、实际工时或专注测量。结束后仅继续/暂停/记录下一步，不自动 Complete。

睡眠、时钟变化、关闭窗口、重启、多窗口行为先定义。extension host 不在运行时不能承诺插件继续执行提醒；离开编辑器的可靠提醒仍交既有外部 owner。[VS23] 不为 timer 建后台 service、FocusSession 或工时统计。

**X2a：当前任务的 AI 下一步建议。** 沿用上一版 X2，用户选择并可查看输入范围，只呈现候选，确认后才调用现有 mutation。无 AI 时 E3 完整可用。不要在 completion/hover 热路径调用模型，不自动拆几十项、改时间、记录 Interaction 或读取整个 vault。

**X2b：外部陪伴共工入口。** 沿用上一版 X2 的另一部分，先只是用户选定的链接或日程引用；不上传任务正文，不内建视频、评分或临床效果宣传。

### 12.2 R1–R4：明确保留，但不自动排进本轮

| ID | 路线图候选 | 何时进入设计 | 最小范围与不能做的事 |
|---|---|---|---|
| R1 | 跨工作区回到个人 Capture / Now | 用户反复在代码 workspace 与个人 vault 间切换且现有方式明显受阻 | 先明确选择并打开正确 vault；不默认多 root 混入、不跨远端误读本地、不搭后台协调器 |
| R2 | 只读 deep link / 复制来源引用 | 外部资料和提醒反复需要返回 LifeLoop | 路由到确定 vault/source；无自动写入、自动创建或标题模糊匹配 |
| R3 | 受限 Context Pack / 交接摘要 | 重复向自己或工具提供同一组资料且手工整理成本明确 | 用户选择 sources、预览范围和敏感内容、带出处、只读输出；默认不上传，不变长期事实副本 |
| R4 | 原生 AI tool 接入 | 稳定命名查询/动作已有真实需求 | 复用宿主工具接口；先只读，再分别验收用户批准的写入，不做聊天客户端或 Agent runtime |

VS Code 的 URI handler 在多窗口下有特定路由行为，不能假定链接总被正确 vault 的窗口接收；当前 API 文档说明由最上层窗口处理。[VS2] R2 须重新核对 vault、scheme、path 与身份，限制允许动作；URL 中不放个人正文或秘密，拒绝路径越界和任意 command 转发。只读深链接也不是自动跨窗授权。

VS Code 提供 Language Model Tool 扩展路径，可作为 R4 技术选项。[VS22] 该接口本身不替代用户许可、数据最小化或 G1–G3；宿主工具/Agent 的调用参数同样不可信。只读工具也可能泄露敏感内容，因此先验证 scope 和输出。源笔记中的指令不构成扩大权限的理由。

R3 不是通用 RAG/记忆数据库。没有稳定引用与排除敏感数据的策略时，保持手动选择和 native 文档，不增加自动全图导出。

### 12.3 原有 D1–D4 的独立资格继续保留

| ID | 不可被 UI 增强省略的条件 |
|---|---|
| D1 Agenda | 与本地日区间相交；全天/跨日/DST/时区/重复例外正确；空结果与失败区分；无自动任务或绑定 |
| D2 Narrow Undo | 仅会话内最多 20 个合格候选；当前状态、版本、继承和 binding 校验；不整页恢复；与原生 Undo/Redo 共存；正文再次相等不复活旧 receipt；不声称撤销外部效果 |
| D3 Create Project | 名称/位置/expected absence、原任务/子树/链接处理、取消与失败契约完整；不能把 Attach Page/snippet 标成已完成 |
| D4 Existing Calendar association | exact event/occurrence、重复绑定拒绝、master/instance、删除重建检测、fresh validation；不按标题/时间猜测 |

W1、timer 或新的快捷键不提前授权这些能力。有限批量改期也需单独证明目标集合、逐项结果、stale 与外部边界；不建设通用批量事务框架。

<a id="sec-13"></a>
## 13. 实现落点与复用要求

路径来自基础设计；本表是责任建议，不证明对应代码当前存在，也不要求为了文件结构进行重构。

| 候选位置 | 责任 | 限制 |
|---|---|---|
| `packages/semantic-core/src/contract.ts` 及已有查询 | task/context/reason/validation 的共享语义 | UI 不重写；缺少具体能力才扩展 |
| `packages/semantic-core/src/mutations/` | 日期、状态、Capture、记录、Interaction 等受保护写入 | 保留 source guards、状态政策与历史边界 |
| `packages/vscode/src/commands.ts` | 短流程、任务/页面命令、目标解析与调用 | 使用既有命令 ID；不变 generic registry |
| `packages/vscode/src/views.ts` | 稳定节点、局部刷新、scope、Now/Context、结果反馈 | UI 状态不能决定同步许可 |
| `packages/vscode/src/` 下薄 editor adapter | V1–V6 providers、源映射、宿主导航 | 文件名实施时确定；不复制 parser / validator，不新增 LSP |
| 现有 temporary document / preview 路径 | V8/V9、baking、来源导航、native diff | 先复用，避免并存两套渲染 ownership |
| `packages/vscode/src/apple.ts` | Sync / Report / Resolve UI | 从共享 authority 读取；workspace state 仅展示 |
| `packages/apple-bridge/src/` | baseline/conflict/suspension、准入与迁移 | provider/vault 隔离，验证持久化与单写者 |
| `packages/apple-bridge/src/calendar.ts` | 原有限读取与 D1 获准范围读取 | 不因界面扩大默认写入或 attendee 推断 |
| extension manifest / snippets / walkthrough / docs | 入口、语言选择器、可选键位、帮助与支持矩阵 | 不猜新 command ID，不自动改用户配置 |

各 surface 的展示 label、禁用原因和命名动作保持一致。可以共享小型 utility，但不因接口增多新建泛型 workflow engine、全局 action bus 或持久化编排框架。

UI 与 CLI 同名业务语义保持一致；UI-only focus、scroll、Now 和普通 hover 不要求成为 CLI feature。新的 CLI 外部写入未符合共同 authority 与准入前不能启用。

<a id="sec-14"></a>
## 14. 交付顺序与退出条件

### 14.1 近期目标与切片规则

近期只证明：**编辑不卡顿 → 键盘就地操作 → 捕获后返回 → 快速找回任务 → 留下进展并继续。** 每个切片单独提交和验收，不要求下一切片完成才交付；已有实现与通过目标入口/真实宿主验收分开记录。

### 14.2 切片 0：editor 热路径

移除 Code Actions 的 eager reindex；输入时仅发布当前文档 diagnostics，索引 settle 后保留正确的全局校验。用 isolated representative vault 记录修改前后的 provider latency、reindex/扫描次数和重复计算。退出条件：provider 请求不触发 reindex、bridge、网络或 AI；mutation 的 SourceHandle/task-state/dirty-buffer guard 没有减少；旧 diagnostics 最终会在索引更新、删除或依赖变化后清理。

### 14.3 切片 1：已有高频操作

按 A1–A5 和现有 V1/V4/V5/V6 基础，依次交付 Quick Reschedule、Inbox 本次遍历 Skip/Edit、Task Actions 覆盖、actionable refusals 和来源/返回连续性。每项只要求一个最短键盘路径和一个可发现入口。首版 Inbox Resume 重新从仍 pending 的内容开始，不把游标或正文写入 workspace state。

退出条件：TreeView 明确选中任务 A、后台 editor 光标在 B 时只作用于 A；取消不写入；semantic mutation 只在 durable save 和必要索引刷新后报告成功；改期不改变 deadline/Calendar，并能说明仍由 deadline 命中。

### 14.4 切片 2：接住信息并找回

分别交付 Find Task、有限 Today/actionable Why Here/Why Not Here、Capture Selection，以及共用普通 Markdown 路径的 Progress/Resume Cue。Find Task 直接使用 task index 和 QuickPick；Why 由共享 predicate/reason 产生；Capture provenance 首版使用 vault ref 或 workspace-relative source snapshot，不新增 schema。缺少安全多行/子树 mutation 时打开原文编辑。

退出条件：完成“工作中捕获 → 回到原任务 → 留下一步 → 切走 → Find Task 找回并继续”；不建设搜索引擎、规则引擎、历史平台或第二套编辑器。

### 14.5 切片 3：最小 Now

来源导航和返回稳定后，复用现有 Task Actions/视图提供 Set/Open/Return/Clear。只在 extension session 内保存可丢失 source hint，打开时重新验证；不写 workspace state，不改 scheduled/status/Calendar，不自动跟随焦点，不加入 timer、Pin、scope、跨窗口或重启恢复。

### 14.6 独立线：Sync authority

先修当前已启用路径的 observation 内存一致性、串行 awaited persistence 和失败报告；其证据只约束受影响 sync/Resolve，不阻塞纯本地 UX。完整 durable shared state、迁移、provider/vault 隔离和单写者准入另作 milestone。ObservationStore 的失败表达和调用链一起修改，不能只换存储位置。

### 14.7 独立线与 roadmap

V8 派生文档只在近期功能需要时先做一个最小 coexistence spike。Agenda、Narrow Undo、Create Project、完整 Context、Webview、timer、AI、deep link、Context Pack、跨工作区、E8/E9 和其余 C/D/W/X/R 项不进入上述切片退出条件；按证据分别合格、受限、Deferred 或放弃。

### 14.8 独立资格与能力矩阵

| 资格 | 判断方式 | 不能替代它的证据 |
|---|---|---|
| G1–G3 | 原始反例、实际写入路径与 provider 宿主资格 | 漂亮 UI、mock-only、命令注册成功 |
| K0 | 真实宿主端到端键盘操作，含错误/返回 | 鼠标视频、只有 command unit test |
| Native coexistence | task-only 与 Foam 两种 profile、实际版本 | 假定原生 provider 自动共存 |
| Provider 性能 | 代表性文件/vault、响应和刷新测量 | 未测的大致毫秒估计 |
| W1 | 对原生方案不足的证据＋安全/可访问性测试 | “功能多”“更像独立应用” |
| Remote / AI / 外部能力 | 单独声明环境、权限和数据范围 | 本地可用、API 文档有此能力 |

<a id="sec-15"></a>
## 15. 验收与反例矩阵

### 15.1 不替代原测试

继续使用隔离 mock vault、明确授权的可丢弃外部对象和原反例。需要格式回归时使用 trial / SilverBullet 示例的隔离副本，不修改个人 vault。

每个小切片先 targeted tests，再执行仓库实际存在的 verify 命令；`npm run verify` 来自基线，实施前核对。UI 测试分别跑 task-only、Foam 共存；打包行为跑 packaged-extension gate。

Notes 正文/pending conflict、Reminders completion/recurrence、Calendar 受管 title/补偿/conflict 与 D1 范围读取分别记录；fake 通过不等于真实 Apple 合格。无宿主标 SKIP 与未验证能力。历史上已有 live-SB skips 和 Foam folder rename 限制不能因本文件发布而消失。

### 15.2 新增反例与场景

| 编号 | 场景 | 必须证明 |
|---|---|---|
| T01 | 纯键盘编辑器 Capture 后返回 | 内容之外无必填；目标可见；不丢输入/焦点，不重复捕获 |
| T02 | 同名任务、TreeView A 与后台 editor B | 不论命令/按键/Code Action 均操作明确来源，不回退到 B |
| T03 | 光标落在注释、代码例子、多任务/多光标范围 | 不猜第一条、不产生伪任务或隐式批量写入 |
| T04 | 自动请求 Code Actions、resolve、保存、格式化 | 不发生业务 mutation、同步或网络副作用 |
| T05 | Code Action 展示后正文/状态/binding 改变 | 原选择重新验证；不应用旧 WorkspaceEdit 或重定向 |
| T06 | completion 中未完成字段、引号、CRLF、Unicode、IME | 不破坏正文；范围正确；候选确认不被误当业务提交 |
| T07 | 日期候选跨午夜、DST、月年边界 | 与 A1 相同语义；Clear scheduled 后 deadline 原样保留；Calendar 不变 |
| T08 | Hover/CodeLens 与 TreeView 同一快照 | 相同语义、reason 和计数；无外部读取；关闭装饰仍可用 |
| T09 | diagnostics 与 dirty source 不同版本 | 明确陈旧状态；旧范围不修新内容；修复后清理自身诊断 |
| T10 | Foam 也提供 links/completion/diagnostics | 不重复或抢占；两种加载顺序验证；task-only 有合理降级 |
| T11 | Project/Person/Review → native Peek → source → 原列表 | 起点合法、范围明确、返回正确；导航位置非写入 authority |
| T12 | 无活动编辑器、source 消失、更名或重复 anchor | 有明确 picker/只读退路，不伪造位置、不 fuzzy mutate |
| T13 | 打开/刷新/关闭多个虚拟 Brief、diff、preview | canonical 数量不变；内容不参与 mutation；过期 mapping 失效 |
| T14 | bake/export 到会被索引的位置 | 非执行表示或排除契约获证；否则拒绝该保存路径 |
| T15 | C5 Calendar 失败但 Markdown facts 可用 | 两种可信度分开，无伪完整会议、旧事件冒充新读取 |
| T16 | Resolve 从键盘查看 diff、返回并选择 | 无隐式批准；版本变化拒绝；unknown 不盲目 Retry |
| T17 | 同步后安全状态保存失败、多窗竞争、删除 UI cache | 保留不确定性/暂停；单写者准入；索引清理不解除暂停 |
| T18 | 将 Today 任务设为 Now、固定另一个 Context | Now/浏览/Pin/scope 分开，不改日期或状态 |
| T19 | 改期后 deadline 仍命中、同任务多个 reason | 解释剩余原因，不制造重复事实或混淆计数 |
| T20 | 工作进展未完成、已有 next action、cue 取消/失败 | 不伪造 completion/Interaction；不重复记录；暂停不依赖 cue |
| T21 | 等待退款、请求家人帮助、取消承诺 | 提交不等于结果；他人未被默认接受；取消不冒充完成 |
| T22 | Area 无任务、一个任务跨多个领域、插入模板 | 无假 gap、无重复任务、无强制资本评分或自动全步骤待办 |
| T23 | Back/Esc/输入法、重复 Enter、切到编辑器再返回 | 不误提交、不丢会话输入、不重放已完成步骤 |
| T24 | Tree checkbox 父子、多选、刷新、折叠 | 不自动级联完成，不把单项动作扩大为整组 |
| T25 | 窄窗口、放大、高对比度、辅助技术、键盘专用 | 焦点和含义清楚，无 hover-only 或颜色-only 信息 |
| T26 | 睡眠跨日、窗口重激活、外部超时 | Today 重新判断；保留输入；读取失败不显示为空 |
| T27 | 大文件/代表性 vault、快速输入、多次取消 provider | 延迟/内存可测；旧请求不覆盖新结果；无全库/bridge 热路径 |
| T28 | local / remote / untrusted / 多 vault | 路径/authority 不混用，bridge 不跑错宿主，无默认个人数据暴露 |
| T29 | W1 旧 panel/伪消息/脚本注入/重复点击 | 白名单与 fresh validation；无任意 command/path；键盘完整 |
| T30 | Deep link 在错误窗口、非法路径/身份、过期引用 | 只读核对或重新选择，不越权读取或执行写入 |
| T31 | Context Pack / AI 选定范围与恶意源文本 | 不扩大读取、不上传未选资料、不把源指令当用户授权 |
| T32 | timer / AI / Apple / Webview 未启用 | Capture、Task、Now、定位和原生路径仍可用 |
| T33 | 从备份副本恢复，index 重建，bridge baseline 缺失 | 业务事实与安全状态区别明确；受影响外部写入暂停 |
| T34 | D2 与 native Undo/Redo 交错及文本恢复相同 | 原独立反转资格保留，旧 receipt 不复活，不撤销未证明外部效果 |

### 15.3 实际使用走查与证据格式

除了正确性，记录完成一个真实任务需要的决策数、重复输入、失去位置次数、必须用鼠标的断点、对结果的误解。可以人工记录，不建设遥测 Dashboard，不保存私人正文。

每个已交付路径至少记录：需求 ID、版本/平台、vault 类型与规模、入口、操作步骤、预期/实际、PASS/FAIL/SKIP、已知限制。所有尚未实施的项目标为 proposed/deferred，不能把“设计已完成”写成“已通过”。

没有对照或实际使用证据时，不声称提高效率、减少分心或改善 ADHD 症状。用户可关闭辅助功能，不要求提供诊断信息。

<a id="sec-16"></a>
## 16. 明确不做与待决事项

### 16.1 当前产品边界

不新增 canonical object/property/type DB、generic Dashboard/Kanban/editable database builder、通用 action registry、workflow/event/undo 平台、全面 SilverBullet parity 或第二套 PKM 搜索/编辑器。

不做完整 Calendar/Reminder/recurrence、邮件/聊天客户端、健康与财务数据库、家庭多人协作、关系/生产力/资本评分、默认活动监测、自动生命周期推断或后台个人管家 service。

不为了 provider 增加独立 LSP，不用 Custom Editor 接管 `.md`，不为 all-in-one 集成 Notebook、SCM、Debug、Terminal 等与已选工作流无关的 API。未来有具体独立需求再评估，不能以“VS Code 支持”作为实现理由。

自然语言日期继续后置。受管字段的确定性补全和 Tomorrow/Next week 不等于允许从任意任务标题自动提取时间。需要窄 NLP 时再声明语言、歧义确认和日期边界。

不安装、发布、迁移个人 vault、改个人 Apple 数据或批量写入用户设置；本文是设计授权，不是这些操作的授权。

### 16.2 实施前需要记录、但不阻塞无关切片的决策

| 待决问题 | 当前保守默认 | 何时改变 |
|---|---|---|
| 最低 VS Code 版本 | 沿用并核对现有 manifest；不假定所有 API 可用 | 某功能确需升级，明确兼容成本 |
| 哪些字段补全/诊断 | 已有 parser 与 validator 明确支持的范围 | 有具体语义和反例覆盖 |
| Now 跨重启保存 | 会话内即可 | 用户反复需要且身份恢复安全 |
| CodeLens 与 decorations 默认密度 | 少量；非必要可关闭 | 真实走查证明信息帮助大于噪声 |
| Area 查询/继承 | 普通页面模板，已有契约才聚合 | semantic-core 明确支持 |
| 生成磁盘内容的非执行格式 | 优先只读虚拟文档 | bake/parser 排除契约经过验证 |
| Webview 选哪个场景 | 不选，继续原生 | 一项工作流反复失败且 W1 合格 |
| 跨工作区与 deep link | 在明确 vault 内使用 | R1/R2 单独解决路由与权限 |
| 快捷键默认前缀 | 不冻结；可绑定命令与配置示例 | 完成平台/keymap 冲突检查 |

本版近期目标不是把 V1–V10 全部做满，而是交付少数完整路径：**原文就地行动、解释与修复；键盘跳转后能返回；当前工作不因捕获和上下文切换而丢失。**

<a id="sec-17"></a>
## 17. 来源与技术依据

### 17.1 用户材料与设计来源

- **B0 — Action loop UX enhancement**：用户在当前对话提供的 ownership / delivery-boundary clarification 修订版；原始日期 2026-09-09、历史 baseline `064b987`。本 revision 已针对 `2d9010b` 核对近期调用链；A1–D4、G1–G3、同步迁移、各独立资格和原测试仍作为产品约束。
- **B1 — LifeLoop_Action_Loop_UX_Consolidated_Addendum.md**：用户上传的上一版文件。本版完整替代其增补内容，保留 E1–E10、K0/K1–K6、X1/X2，并明确新增 K7/K8、V1–V10、W1、R1–R4。
- **B2 — Relationship data surfaces**：当前对话中的文件与后续修订说明；关系事实、明确参与人、guard 和 Markdown authority 继续按实际基础设计适用。旧文中未反映后续修订的内容不能覆盖 B0。
- **B3 — 后续产品讨论**：ADHD 相关执行辅助、生活领域/Area、editor-first/native-first 和 keyboard-first 为用户要求的设计方向；属于需求，不是临床、遥测或实现证据。

### 17.2 官方公开资料

以下公开文档在 **2026-09-12** 核查。其作用是确认宿主技术能力或设计原则；本文件的范围、优先级、安全和测试要求是 LifeLoop 的设计决策，不声称由这些资料直接规定。API 仍需针对实际最低支持版本核实。

| 引用 | 官方资料 | 本文件用途 |
|---|---|---|
| [VS1] | Programmatic Language Features | 直接 provider、completion、Hover、Code Actions、CodeLens、diagnostics 的能力范围 |
| [VS2] | VS Code API reference | CodeAction、TreeView checkbox/selection、decoration、URI handler 等精确契约 |
| [VS3] | Built-in Commands | 原生 Peek/Go to Locations、native diff 与导航接入 |
| [VS4] | Default keyboard shortcuts | 默认键位参考，不替代用户绑定 |
| [VS5] | Quick Picks UX | 少量短选择而非复杂 wizard |
| [VS6] | Views UX | 少量可移动视图与上下文交互 |
| [VS7] | Virtual documents | TextDocumentContentProvider、更新、文档事件与 scheme 隔离 |
| [VS8] | Snippet Guide | 原生内容片段分发 |
| [VS9] | Markdown Extension | 受限 preview 样式与解析扩展 |
| [VS10] | Webviews UX | 原生不足时的自定义 UI 与一致交互 |
| [VS11] | Status Bar UX | 短而克制的常驻状态入口 |
| [VS12] | Notifications UX | 避免过量通知、就地反馈 |
| [VS13] | Walkthroughs UX | 少步骤上手与可操作帮助 |
| [VS14] | Keyboard shortcuts / keybindings | 可绑定命令、chords、冲突与用户配置 |
| [VS15] | when clause contexts | 入口适用性，不是运行时许可 |
| [VS16] | Remote extensions | 本地/远端执行位置与能力边界 |
| [VS17] | Accessibility | 键盘、焦点、视觉与辅助技术验收参考 |
| [VS18] | Webview API | 消息、资源、CSP 与内容安全 |
| [VS19] | Webview UI Toolkit repository | 旧 UI Toolkit 已标记弃用，避免直接沿用旧依赖方案 |
| [VS20] | Workspace Trust guide | Restricted Mode 与扩展行为边界 |
| [VS21] | Extension runtime security | 扩展权限与非沙箱的隐私限制 |
| [VS22] | Language Model Tool API | 后续受限工具接入，不自建聊天/runtime |
| [VS23] | Extension Host | 运行位置与生命周期限制 |
| [COGA] | W3C cognitive accessibility guidance | 减少记忆负担、干扰和可选步骤的设计参考，非 ADHD 疗效证明 |

[VS1]: https://code.visualstudio.com/api/language-extensions/programmatic-language-features
[VS2]: https://code.visualstudio.com/api/references/vscode-api
[VS3]: https://code.visualstudio.com/api/references/commands
[VS4]: https://code.visualstudio.com/docs/reference/default-keybindings
[VS5]: https://code.visualstudio.com/api/ux-guidelines/quick-picks
[VS6]: https://code.visualstudio.com/api/ux-guidelines/views
[VS7]: https://code.visualstudio.com/api/extension-guides/virtual-documents
[VS8]: https://code.visualstudio.com/api/language-extensions/snippet-guide
[VS9]: https://code.visualstudio.com/api/extension-guides/markdown-extension
[VS10]: https://code.visualstudio.com/api/ux-guidelines/webviews
[VS11]: https://code.visualstudio.com/api/ux-guidelines/status-bar
[VS12]: https://code.visualstudio.com/api/ux-guidelines/notifications
[VS13]: https://code.visualstudio.com/api/ux-guidelines/walkthroughs
[VS14]: https://code.visualstudio.com/docs/configure/keybindings
[VS15]: https://code.visualstudio.com/api/references/when-clause-contexts
[VS16]: https://code.visualstudio.com/api/advanced-topics/remote-extensions
[VS17]: https://code.visualstudio.com/docs/configure/accessibility/accessibility
[VS18]: https://code.visualstudio.com/api/extension-guides/webview
[VS19]: https://github.com/microsoft/vscode-webview-ui-toolkit
[VS20]: https://code.visualstudio.com/api/extension-guides/workspace-trust
[VS21]: https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security
[VS22]: https://code.visualstudio.com/api/extension-guides/ai/tools
[VS23]: https://code.visualstudio.com/api/advanced-topics/extension-host
[COGA]: https://www.w3.org/TR/coga-usable/
