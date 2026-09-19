**我建议把 LifeLoop 做成“跨生活领域的行动与上下文管家”，而不是“在 VS Code 里重新实现所有个人管理 app”。**

本文统一汇总候选能力、产品边界、已实现能力和剩余实施评估；完整总表见
[第九节](#九实施现状与剩余功能评估)。长期契约以
[`LifeLoop_Action_Loop_UX_Consolidated_Addendum_v2.md`](./plans/LifeLoop_Action_Loop_UX_Consolidated_Addendum_v2.md)
为准；可执行实现证据以 [`CAPABILITY-MATRIX.md`](./CAPABILITY-MATRIX.md) 为准；近期交付顺序
以 [`ux-first.md`](./plans/ux-first.md) 为准。

目标应该是：

> **管理范围可以广，但核心语义要少；用户工作流要完整，但底层数据不必集中归 LifeLoop 所有。**

具体而言，LifeLoop 应当深入支持 **捕获、承诺、上下文、适时浮现、复盘、跨工具交接**；学习、职业、生活行政等领域先用这些能力组合出来。完整日历、阅读器、财务账本、健康数据库、通用数据库编辑器，不应成为它的内建职责。

以下产品能力依据官方文档；LifeLoop 的现状依据你提供的设计说明，**不等同于已经验证过代码实现和实际运行表现**。你的文档已经明确把任务、项目、Capture、Review 和外部桥接列为现有能力，因此下面不少“必须支持”意味着应当保证体验，而不是重新开发模块。

## 一、从现有产品看，最值得借鉴的不是“功能最多”，而是三种整合方式

### 1. Org-mode：文本是事实，聚合视图帮助行动

Org-mode 的 Agenda 可以从分散的文本中汇总待办、日期事项、标签匹配和停滞项目；聚合结果可以跳回原文，并通过命令操作源内容。它展示了一条很适合 LifeLoop 的路线：**不要求所有任务进入一个独立任务数据库，也能形成统一的行动界面。**([orgmode.org][1])

对 LifeLoop 的启发是：重点不是增加更多独立页面，而是让现有 Markdown 中的事实进入可靠、可操作的聚合视图。

### 2. NotePlan：统一笔记、任务与时间，但不取代外部日历

NotePlan 把 Daily Notes、Project Notes、任务和日历放在相邻的工作流里，同时连接 Apple Calendar 和 Reminders，并使用本地 Markdown 保存笔记。([NotePlan][2])

值得借鉴的是 **“做这件事时，相关背景和时间约束就在旁边”**，而不是照搬它的全部界面。

### 3. Sunsama：核心产品是规划与复盘过程，不只是任务列表

Sunsama 的日计划包括回顾、选择任务、检查预计工作量、安排顺序和时间；周复盘则结合已完成工作、目标和文字反思。([Sunsama User Manual][3])

这提示 LifeLoop：

> **真正的“管家感”来自把事情推进到下一步，而不只是把更多数据显示出来。**

Notion 的数据库、属性和多视图则代表另一条路线：提供可自由组合的通用工作空间。它确实能够组织很多领域，但对已经依赖 Foam/Markdown 的 LifeLoop，重新建设这一层不是必要条件。([Notion][4])

---

## 二、个人管理 app 的功能版图，以及 LifeLoop 应如何覆盖

这里要区分四种“支持”：**原生语义、宿主复用、外部桥接、模板组合**。它们都可以构成完整产品体验，不必全部变成 LifeLoop 新代码。

| 功能领域                 | 典型功能                                                                         | LifeLoop 建议                                                    |
| -------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Capture / Inbox**  | 快速记录、移动输入、来源保留、分类和处理。NotePlan、TickTick 都提供多入口捕获。([NotePlan][2])              | **核心支持。** LifeLoop 管处理闭环，手机入口复用 Notes 等桥接                      |
| **笔记 / PKM / 资料组织**  | 编辑、链接、反链、标签、附件、模板、查询；Foam 已覆盖其中大量能力。([Foam Bubble][5])                       | **必须可用，但宿主拥有。** 不再做第二套笔记库、搜索和文件导航                              |
| **任务 / 项目**          | 待办、状态、日期、分组、下一步、停滞项目和筛选。([TickTick][6])                                      | **LifeLoop 原生核心。** 重点是承诺生命周期，而非复杂项目管理                          |
| **日程 / 日计划**         | 日程展示、任务安排、time blocking、工作量检查。([NotePlan][2])                                | **Today 原生，Calendar 桥接。** 完整只读 agenda 和容量规划按需求升级               |
| **个人 CRM**           | 人员背景、互动历史、联系提醒、重要日期。Dex、Monica 都围绕这些能力组织产品。([Dex][7])                        | **原生轻量关系闭环。** 不做销售 CRM、关系评分和自动联系人抓取                            |
| **Journal / Review** | 日记、模板、历史回看、周复盘和反思。([Day One | Your Journal for Life][8])                     | **Foam 管写作，LifeLoop 管事实汇总和复盘动作**                               |
| **目标 / 职业发展 / 决策**   | 目标、阶段计划、结果、反思；例如 Sunsama 支持 weekly objectives 与复盘。([Sunsama User Manual][9]) | **先用页面、Project 和 Review 组合。** 不立即增加 Goal / Skill / Decision 引擎 |
| **习惯 / 专注**          | 重复行为、打卡、统计、番茄钟；TickTick 同时提供这些能力。([TickTick][6])                             | **暂不内建。** 重复提醒交外部；行为历史确有需求时再讨论                                 |
| **阅读 / 学习**          | 稍后读、批注、高亮、回顾、导出；Readwise 将阅读与高亮复习连接起来。([Readwise][10])                       | **支持资料→项目→行动的连接。** 不自己实现阅读器或复习调度器                              |
| **生活行政 / 家庭物品**      | 文档、物品、保修、购买和维护记录；HomeBox 是典型专门产品。([GitHub][11])                              | **先模板组合。** LifeLoop 管待办、截止和证据链接，不做完整家庭 ERP                     |
| **个人财务**             | 账户、交易、预算、储蓄目标、支出与净资产报告。([YNAB][12])                                          | **管理财务相关行动，不拥有金融账本**                                           |
| **健康管理**             | 活动记录、设备数据、手动记录、多来源汇总。([Apple Support][13])                                   | **管理预约、计划和相关笔记，不拥有健康数据平台**                                     |
| **AI / 自动化**         | 查询上下文、提出建议、调用动作；VS Code 已提供扩展工具和 MCP 接入路径。([Visual Studio Code][14])         | **以后提供受限语义接口。** 不先做自己的聊天客户端、模型系统或自主代理平台                        |

**这里最重要的区分是：覆盖某个生活领域，不等于建设那个领域的专门软件。**

例如：

* 不做财务账本，仍然可以管理“报销材料、保险续保、预算复盘”。
* 不做健康数据库，仍然可以管理“预约体检、记录咨询问题、安排锻炼”。
* 不做 Goal 引擎，仍然可以支持“职业目标、阶段项目、反馈与复盘”。

---

## 三、真正应该保证的核心能力：不是更多对象，而是六个完整工作流

### 1. 捕获之后，必须有明确去向

我会把 **Capture → Process → Context → Action/Reference** 放在全局最高优先级。

最低要求不是“有个输入框”，而是用户能清楚知道：

> 这条内容已经保存在哪里？还需要处理吗？变成任务了吗？以后从哪里找回？

建议保证来源可追溯、重复导入不会重复造任务、处理状态可解释、失败不会静默丢失。移动端也应区分“已保存到 Notes”和“已进入本地 LifeLoop”，不能把两者显示成同一个成功状态。

你的方案已经有 Capture、持续处理和 Notes 导入，因此重点应是检验这条路径是否真正省心，而不是再增加一个通用 Inbox。

### 2. 管理“承诺生命周期”，不只是 checkbox

一个个人管家应当帮助区分：

| 状态或时间含义                | 应回答的问题           |
| ---------------------- | ---------------- |
| 未安排的待办                 | 我还承诺做哪些事情？       |
| Scheduled              | 我打算什么时候处理？       |
| Deadline               | 最晚什么时候必须完成？      |
| Waiting                | 我现在在等谁或什么条件？     |
| Completed / Cancelled  | 事情如何结束？          |
| Project actionable gap | 这个项目是否缺少可执行的下一步？ |

这里不一定需要增加字段；优先用已有状态和日期语义实现。

**“计划今天做”“今天到期”“等别人回复”必须在 Today 中有所区别。** 否则 Today 很容易成为一张永远清不完的红色列表，而不是行动入口。

你的文档已列出 overdue、due、scheduled、waiting、upcoming 和项目 actionable gaps；这些比新增生日、图表或更多对象类型更接近全局核心。

### 3. 在行动发生的位置提供上下文

用户正在处理任务时，应能直接看到所属项目、相关笔记、明确关联的人和已有外部绑定，而不是先去几个列表中搜索。

这里值得原生支持的是：

**Task Context、Project Context、Person Context，以及少量上下文动作。**

不值得原生建设的是：新的文件浏览器、新的笔记详情页、新的反链系统。Foam 已经提供了链接、反链、查询和导航；LifeLoop 应补上它独有的任务与关系含义。([Foam Bubble][5])

不过，**关联不等于参与，更不等于事实已经发生**。即使任务直接链接 Alice，也可能只是“读 Alice 的论文”。因此记录 Interaction 时仍应明确确认参与者；不能仅凭链接或任务完成，就更新 last contact。

### 4. 把需要注意的事情适时浮现，而不是制造通知流

我认为这是“管家感”最重要的原生能力之一。

适合浮现的内容包括到期事项、等待跟进、无下一步的活跃项目、明确设置的 reconnect，以及生日等重要日期。每个信号都应能够回答：

> **为什么现在显示它？依据在哪？我可以采取什么动作？**

建议默认集中在 Today 或 Review，并让用户能采取完成、改期、取消或回到来源等动作。不要把每条信息都变成弹窗，也不要为了清除信号而自动生成任务。

你当前生日设计已经采用“事实→信号→用户决定行动”，而不自动创建 Reminder 或 Calendar event，这个模式值得推广。

### 5. Review 要产生下一步，而不只是报告

我的建议是把 Weekly Review 定义为一个**修正承诺和方向的过程**：

> 回看事实 → 判断哪些继续、停止、改期 → 更新任务和项目 → 保留反思。

Sunsama 的周复盘把完成工作与文字反思连接起来，说明复盘可以是一条工作流，而不仅是统计页面。([Sunsama User Manual][9])

对 LifeLoop，先使用完成记录、等待事项、项目状态、显式 Interaction 和已有 Review 快照即可。不要从不足的数据推出“投入时间”“生产力”“关系质量”。

特别是：

**任务完成数不是产出质量；Calendar 时长不是实际工作时长；提到某个人也不是一次联系。**

这并不要求建设通用 event store，但要求每个指标先明确其事实依据。

### 6. 外部交接必须可验证、可修复

“创建了 Reminder”“绑定了 Calendar”不能成为不可检查的黑箱。用户应知道外部对象是什么、当前连接是否有效、哪一方拥有哪个字段，以及冲突如何处理。

你的设计已经有绑定、核验、冲突解决和补偿路径。下一步应该优先验证这些现有能力，而不是追求支持更多 provider。

**一个可靠的 Calendar bridge，通常比五个偶尔重复或漏同步的 integration 更值得投入。** 这是我的工程取舍判断，不是要求所有外部操作都实现通用双向同步。

---

## 四、扩大 all-in-one 覆盖面，优先增加“场景配方”，不是增加模型

这是我认为当前设计最值得补充的一层。

你目前的文档很好地约束了关系扩展，但其本身不是完整的 LifeLoop 场景路线图。它明确把当前 pass 限定为 projections、birthday、task-originated Interaction 和 Pre-meeting Brief。

为了让产品具备更广的个人管理能力，可以增加一组 **官方模板＋使用流程＋已有命令组合**：

| 场景配方                 | 用户要完成的事情             | 复用的现有能力                                       |
| -------------------- | -------------------- | --------------------------------------------- |
| **工作 / 研究项目**        | 保存背景，明确下一步，检查阻塞，回看结果 | Project、Note、Task、Waiting、Review              |
| **会议与关系**            | 会前准备，记录讨论，产生后续承诺     | Person、Interaction、Calendar binding、Follow-up |
| **学习计划**             | 保存资料，把学习变成实践，记录收获    | Note、Project、Task、Journal                     |
| **职业成长 / 决策**        | 记录目标、比较选择、保留反馈、定期重看  | 普通页面、Project、Review、复查任务                      |
| **生活行政**             | 办理手续、维护设备、整理材料、处理续期  | 页面、附件引用、Task、Deadline、外部 Reminder             |
| **出行 / 搬家 / 大型个人事项** | 管理清单、预订引用、日期和待确认事项   | Project、Task、Note、Calendar 引用                 |

这里的配方**不是可执行插件包，也不要求引入新的 ontology**。

例如，“职业成长”页面完全可以先记录：

> 我想提升什么 → 准备通过哪个项目实践 → 收到什么反馈 → 下次复盘检查什么。

不用立刻创建 `Skill`、`CapabilityScore`、`Intervention`、`GrowthExperiment` 等模型。

这能让 LifeLoop **功能覆盖广，但实现仍然窄**。

---

## 五、哪些功能值得待定观察？

“观察”应当有准入条件，而不是一张默认最终都要实现的 P2 清单。

| 待观察能力                  | 何时值得做                                         | 最小可接受实现                            |
| ---------------------- | --------------------------------------------- | ---------------------------------- |
| **Today 完整只读 agenda**  | 用户反复切去 Calendar，只为确认今天还剩哪些时间                  | 只读当天事件，显示来源；不把每个事件转成任务             |
| **预计时长 / 容量规划**        | 每天选任务时频繁高估可用时间，并愿意提供估时                        | 可选估时与简单汇总；不自动全局排程                  |
| **专注计时 / 实际工时**        | 真有定期使用的时间分配问题，且用户愿意记录                         | 少量显式记录或复用外部工具；不默认后台监控              |
| **Inbox → Person 等转换** | 相同的建页、加 metadata、链接动作频繁重复                     | 一个可预览的语义命令，不是通用对象创建器               |
| **阅读、Issue 等来源桥接**     | 某一来源反复手工复制，来源链接又经常丢失                          | 先做选择性引用或导入，不做全量镜像                  |
| **Goal / Habit 的专门语义** | 页面和项目表达已经稳定使用，且确实缺少独立生命周期或 occurrence history | 仅补足具体语义，不搭完整目标/习惯平台                |
| **语义搜索**               | 有真实“找不到”的例子，关键词、链接和属性查询仍解决不了                  | 可删除重建、带来源的可选检索层                    |
| **有限图表 / 看板 / 批量操作**   | 已有查询或操作被反复使用，当前呈现确实影响决策或增加错误                  | 单个受限视图或命名批量动作，不做 Dashboard builder |
| **AI 建议 / Agent 接口**   | 确定性查询和动作已经稳定，存在明确的总结、规划或操作需求                  | 先只读和草稿，再考虑经确认的语义写入                 |

这里有三个重要细节。

**第一，预计时长和实际时长不能混为一谈。** Sunsama 明确区分这两种数据；LifeLoop 若以后建设时间分析，也应保留这个区分，而不是把完成任务的估时当作测量结果。([Sunsama User Manual][15])

**第二，不应永久排除轻量表格或图表，但也没有理由现在建设通用可视化平台。** 你已有的 chart gate——稳定查询、反复使用、形状影响决策——是合理准入方式。

**第三，AI 可以是一种调用方式，而不必成为另一个产品模块。** VS Code 已支持扩展提供领域工具，也支持 MCP；LifeLoop 以后可以只暴露自己的语义查询和受保护动作，不需要再开发聊天界面、模型路由和通用 Agent runtime。([Visual Studio Code][14])

---

## 六、哪些能力应该明确拒绝成为 LifeLoop 的职责？

这里的“拒绝”，是拒绝**内建拥有和维护这类产品能力**，不是禁止用户在 Markdown 中记录相关内容。

| 应明确避免                                              | 原因                            | 保留的替代路径                        |
| -------------------------------------------------- | ----------------------------- | ------------------------------ |
| **第二套 canonical 对象/任务/联系人数据库**                     | 与 Markdown 或外部系统产生权威冲突        | disposable index、派生查询、明确绑定     |
| **通用 Type / Schema / Formula / Dashboard builder** | 把 LifeLoop 变成另一套低代码平台，扩大长期维护面 | Foam 查询、普通 metadata、模板和命名动作    |
| **完整 Calendar / Reminder / recurrence engine**     | 把日历执行与通知可靠性变成插件自己的职责          | 外部 owner＋受限桥接                  |
| **全功能邮件、聊天、阅读器、通讯录客户端**                            | 偏离个人行动与上下文核心                  | 来源链接、选定内容导入、上下文摘要              |
| **财务账本、医疗记录平台、密码保险箱**                              | 需要各自的数据语义、访问控制和可靠性设计          | 只管理相关行动和必要引用                   |
| **无边界双向同步、自动合并身份、自动补全事实**                          | 错误会跨系统传播，且难以解释和恢复             | 按字段 ownership、显式 identity、冲突保留 |
| **未经确认的外部自主行为**                                    | “给建议”升级为“代用户承担后果”             | 草稿、预览、明确授权的有限动作                |
| **默认全量监听和个人评分**                                    | 增加隐私暴露，又可能制造缺乏证据的结论           | 用户选择的数据、可解释信号、显式记录             |
| **团队协作平台和插件内的第二套扩展生态**                             | 引入账户、权限、协同编辑和第三方执行环境          | 当前保持个人工作流；复用宿主能力               |

尤其要避免两种看起来“智能”、实际上损害可信度的行为：

**自动建立事实。** 从 title、mention、Calendar summary 推断参与者、联系发生、任务完成，不应该直接进入 durable facts。你当前文档已经明确禁止这类推断。

**为了功能完整而复制外部领域。** Finance、Health、Calendar 都可以成为 LifeLoop 工作流的一部分，但不意味着它应该保存、编辑并推导这些系统的全部数据。

---

## 七、作为 VS Code 插件，有四个不能忽略的架构取舍

### 1. “本地”不是“安全保险箱”

VS Code 官方文档明确说明，扩展宿主拥有与 VS Code 相同的权限，扩展可以读写文件、联网、运行外部进程。([Visual Studio Code][16])

因此建议：

**个人 vault 与日常代码工作环境尽量分开管理；精简启用的扩展；不要默认把整个 vault 暴露给 Agent。** 独立 profile/workspace 可以降低误用和配置混杂，但不能把它宣传成安全沙箱。

连接凭据也不应因为“Markdown canonical”而写入 frontmatter。VS Code 提供加密的 `SecretStorage`，它与普通业务事实应属于不同存储类别。([Visual Studio Code][17])

### 2. 不能承诺“VS Code 不运行也会准时执行”

扩展依赖 extension host 运行；它不是独立的可靠常驻执行服务。([Visual Studio Code][18])

所以建议明确产品边界：

> **LifeLoop 决定、组织和交接；系统 Calendar / Reminders 负责离开编辑器后的提醒与重复执行。**

若某项未来能力必须依赖独立后台服务，它就应被视为一次架构升级，而不是一个普通插件 feature。

### 3. 本地、Remote SSH 和浏览器不是同一种运行环境

VS Code 区分本地、远程与 Web extension host；Workspace Extension 在远程工作区中可能运行于远端。直接调用本机程序或平台 API 的功能，不能假定在所有环境都成立。([Visual Studio Code][19])

LifeLoop 应明确支持矩阵：本地 Markdown 核心、Foam 增强、Apple bridge、远程环境分别支持什么。没有 bridge 时，应正常降级，不应出现“看起来可点击、实际执行到错误机器”的行为。

### 4. 性能、可恢复性和可解释性属于核心功能

你文档末尾把 performance tests 也放进未来 feature gate，这一点我会修正：**统计功能的性能测试可以延后，但代表性 vault 下的索引、编辑响应和 Today 更新测试不应延后。**

此外，“删除 SQLite 可重建”只证明派生索引可恢复，不意味着 Markdown 本身已经有备份。两类故障必须分开考虑。

建议核心验收至少覆盖：不覆盖未保存内容、重复操作不产生重复外部对象、索引重建结果一致、每个信号可回到来源、外部失败有可执行的修复入口。你已有的 guarded mutation 和重建验证要求可以作为基础。

---

## 八、我会怎样安排 LifeLoop 的优先级

### 第一优先级：把已有核心变成可信赖的日常系统

重点检查：

**Capture / Inbox → Task / Project → Today → Review → 外部交接。**

这里还要包含移动捕获、命令可发现性、来源跳转和错误恢复。用户不应为了得到基本体验，先设计 schema 或编写查询。

这不是要求增加一批新模块，而是优先修掉已有闭环中的摩擦。

### 第二优先级：完成高价值的跨领域组合

当前关系扩展可以继续保持：

**Relationship projections → Interaction logging → Birthday → Pre-meeting Brief。**

但要明确：**Interaction logging 是关系闭环里的高优先级，不应盖过整个 LifeLoop 的捕获和任务可靠性。**

同时通过模板和示例覆盖学习、职业、生活行政等场景，不增加核心数据模型。

### 第三优先级：按真实摩擦选择一个增强方向

例如，只有当“经常需要切出去看当天安排”得到验证，才增加完整只读 agenda；只有当“找不到已经存过的资料”反复发生，才考虑语义搜索。

不要同时启动 Goal、Habit、Analytics、AI、Calendar timeline 五条产品线。

我建议采用这个功能准入顺序：

> **先用模板解决 → 再用现有查询解决 → 再增加命名动作 → 再增加受限桥接 → 最后才考虑新模型或新运行时。**

评估时记录具体场景、出现频率、手工步骤、错误后果和新增维护成本即可，不需要再做一个产品分析 Dashboard。

---
## 九、实施现状与剩余功能评估

本节是当前实现与剩余候选的唯一整体汇总。v2 继续保存完整契约和反例；language roadmap
保存 provider 边界；ownership ADR 保存外部系统决策。这里的“已实现”与“真实宿主已合格”
分开，Roadmap 也不等于承诺实施。

评估尺度：频率为日／周／月／事件触发／低频；收益指减少步骤、找回上下文或避免错误的
程度；复用越高表示越能使用现有 query、mutation 和 native UI；成本包含实现与长期维护；
风险主要指错误目标、数据丢失、外部副作用、宿主兼容和状态分叉。

### 已实现或已有最小闭环

| 能力 | 当前状态 | 仍未证明或需要打磨 |
|---|---|---|
| Capture / Capture Here / Capture Selection + Source | 已实现，普通 Capture 失败正文可恢复 | 当前 task-only 已验证 Capture/Selection 成功后回到原编辑器并保留光标/选区，输入后 Escape 不写入；普通 Capture 的真实失败注入与 Find 自身 IME 仍分别记录 |
| Inbox Skip / Edit / Resume | 已实现本次遍历的连续处理 | selection/scroll、长正文和快速连续操作；不持久化游标 |
| Task Actions / Complete / Reopen / Deadline / Schedule / Waiting / Someday / Source | 已实现 guarded commands 和动态入口 | K0 菜单深度、焦点、结果文案一致性 |
| Quick Reschedule | 已实现 Today/Tomorrow/Next week/Pick/Clear | 改期后仍被 deadline/inherited value 命中的解释与真实键盘体验 |
| Find / Explain / Peek / Return to Last Find | 已实现关键词、scope、来源、session-only 返回和可选连续预览；旧异步 preview 不覆盖最新选择 | Foam GUI 已验证键盘预览、快速取消、query/exact handle 恢复及窄窗口长标题；planning QuickPick 已验证真实简体拼音，Find 自身未单独重复 IME 路径 |
| Now / Progress / Resume Cue | 已实现 session-only Now 与普通 Markdown 记录 | 当前 task-only 已验证从 TreeView 明确任务 A 保存 Resume Cue 后仍回到编辑器 B；失效 source 的真实宿主路径仍由自动反例和后续走查覆盖 |
| Add from Backlog | 已实现 Set Now、Schedule Today、Peek/Open 的意图区分 | 候选连续处理与真实列表连续性 |
| Waiting → Next Action | 已实现独立 Complete/Create/Schedule/Clear 意图 | 当前 task-only 已验证只在明确 Waiting 任务下创建后续行动；Live Review 清除一个 direct Waiting 后保持 Waiting scope 并选择剩余相邻项；不把收到回复自动解释为完成或 Interaction |
| Make Actionable / Help Me Start | 已实现轻量 Edit/Add step/Attach/Waiting/Someday | 不扩成 AI 拆解或新的 task workflow |
| Today / Upcoming / Waiting / Projects / Linked Tasks | 已实现共享 predicates、事实信号和精确 SourceHandle；Project gap 只陈述 active Project 本页事实 | task-only/Foam 已验证窄信号；其余连续操作仍待 K0 |
| Plan Today / Close Today and Plan Tomorrow | 已实现连续 native picker；区分期限、当日安排、旧计划和 Backlog 候选；晚间在同一流程复盘当天事实并规划明日；可打开规划日期所在周的 Focus 并返回原位置 | Focus/返回增量已有自动测试；2026-09-14 的隔离 task-only/Foam 0.44.6 宿主确认正确周文件及 picker/scope/长标题选择保留，Problems 为 0；此前两种 profile 已验证晚间 scope 切换、取消、显式安排、刷新与返回，task-only 另验证真实简体拼音组合输入 |
| Projects 原地处理 | 已实现稳定节点及 Preview/Open/Add Next Action/Pause/Leave Unchanged；Preview 复用只读 Resumption 结果，同时显示本页与跨页 related work | membership 仍只统计 `task.page === project`；新 Preview/Review 返回有自动测试，2026-09-14 的隔离 task-only/Foam 0.44.6 宿主确认两组结果、边界说明、来源返回、0 Problems 且无 Foam provider error；不声称覆盖全部项目工作 |
| Project Resumption / Closure Facts | 已实现只读 Project Preview／恢复简报；关闭前显示本页 open、跨页相关 open、Waiting 和已知 Reminder/Calendar bindings，状态写入重新验证 | task-only 已打开 paused-project 简报并在 closure facts 后取消，Project 保持 active；不声称发现全部项目工作或外部对象 |
| Add / Open Related Page | 已实现选择现有 Project/Person/Note 并向明确任务写 direct link；Task Actions 可直接打开已有 direct Person/Note page | Add 已有 task-only GUI 证据；Open 的自动测试及 task-only/Foam 目标、候选、精确打开和返回已验证；当前冷启动 task-only 又验证完整 `Open Relat` 输入不泄漏到后台 B、Enter 打开长路径、Escape 取消、`Ctrl+-` 返回以及 Problems 为 0；不改变 ownership、不 Process Inbox、不创建 Interaction |
| Weekly Review / Freeze / Weekly Focus | 已实现 live facts、冻结 Markdown 和一个连续 fresh-query Review session；Waiting/Someday 已拆分，Backlog scopes 由用户进入；可打开普通下周重点 note | Foam GUI 已验证 mutation 后原地刷新、相邻选择和快速 Return/Escape；当前 task-only 又验证 Waiting mutation 后保持同一 picker/scope 并选择相邻项；task-only 已生成并打开下周 Focus note，未复制活跃 checkbox |
| Review Period Facts | 已实现只读本周报告，只列可靠 completion date 和明确日期的 Interaction | task-only 已打开当前周报告并显示 fixture 的 dated completion；无可靠 created/processed timestamp，因此明确省略 new tasks 与 processed Inbox |
| Person / Interaction / Reconnect / Birthday / Person Context / Meeting Wrap-up | 已实现轻量 relationship loop；exact Calendar-bound task 可独立选择 Log Interaction、Add follow-up、Complete | participant 只来自 direct exact Person links；组合入口仅有自动测试，真实宿主 K0 待补 |
| Pre-meeting Brief | 已实现只读 `lifeloop-result:` 聚合 | Calendar 读取不合格时只能分别展示本地事实与缺失状态 |
| Notes full-body pending / Process / reconciliation | fake-backed 实现 | 真实 Notes、迟到编辑和部分失败的宿主资格仍需补 |
| Reminder / Calendar limited binding and sync | fake-backed 实现，冲突保留 binding 并集中 Resolve | 真实 Apple、跨 extension-host writer admission、完整 shared authority |
| Query Result / Brief 只读派生文档 | 已实现并通过 task-only/Foam gate | Review/Resolve 只在有收益时逐项迁移 |
| Managed-field completion | 已实现 `scheduled`/`deadline` 字段和绝对日期 | 当前 build 的 suggestion widget accept/cancel 仍待 K0；真实简体拼音已在 planning QuickPick 验证，不能替代 editor widget 证据 |
| References / Symbols / Hover / Diagnostics / Code Actions | 已存在；热路径已去除 eager reindex | provider 延迟、删除/依赖诊断和长期 Foam 共存 |
| Semantic Selection | Host-satisfied | 原生 Expand/Shrink 已足够，不新增 provider |
| Lua / SLIQ / query table / baking / X-Ray | 已实现 bounded compatibility | 不扩大为完整 SilverBullet runtime 或通用 app platform |

### 每日／每周规划与执行增强

下一阶段的规划闭环是：**本周关注什么 → 今天有哪些约束与候选 → 用户自行选择 → 变化后低成本调整 → 下次容易继续。**
它优先组合已有 Today、Upcoming、Backlog、Schedule、Now、Waiting、Progress/Cue 和 Live Review，
不另建 planner、Goal 层级或第二套任务状态。

LifeLoop 不要求用户为每个任务执行 Start/Stop、check-in/check-out 或维护执行顺序。`Now` 只是用户需要时
设置的会话内返回书签，不是开工记录、计时器或完成前提。Today 应提供足够的期限、安排、来源、项目、
Waiting/Someday 与进入原因；现实中的会议、精力、地点和临时事件由用户判断，系统提供 Preview、Open、
Reschedule、Waiting/Someday 和 Clear scheduled 等低成本调整动作。

| 能力 | 当前复用与实际缺口 | 成本 | 主要风险 | 最小交付边界 |
|---|---|---:|---|---|
| Plan Today | 已复用 Today、Backlog、Now、Schedule、Peek/Open，并补 `pastScheduled` 与连续入口 | 中 | 把 deadline、系统信号和用户今日承诺混为一谈 | **已实现最小版并取得 task-only/Foam K0**；不要求排序、逐项 Set Now 或开始打卡 |
| Replan Remaining Day | 已由同一连续入口复用 Quick Reschedule、Waiting/Someday 和 guarded mutation | 小到中 | 清除字段或改期后仍因其他事实出现，却错误报告已移除 | **已实现最小版**；用户结合外部条件随时调整，每项重新验证 |
| 当天复盘＋明日计划 | 已复用 factual `dayReview`、Progress/Resume Cue、Quick Reschedule、Backlog 和本地日期工具 | 小到中 | 变成强制复盘或自动 rollover | **已实现 `Close Today and Plan Tomorrow`**；当天完成/遗留与明日约束在同一流程，明日安排必须显式选择 |
| Weekly Review → 下周重点 | 已复用持续 Review picker、项目动作和普通 Weekly Focus 模板 | 小到中 | 从最终状态反推周初计划，或把 frozen Review 当写入来源 | **已实现最小版**；Review 中原地处理并可打开下周普通 Markdown note |
| Backlog resurfacing | 已复用现有 Unscheduled、Someday、Paused 和 Waiting scopes | 小 | 自动污染 Today，或引入 last-reviewed/cadence 状态 | **已实现手动 scopes**；保持搁置是正常结果 |
| 本周重点／候选 | 已实现 Weekly Note 模板与导航；Plan Today 和前晚明日规划可打开正确周并返回原 picker；没有专用 task membership | 模板小；专用操作中高 | 复制第二组 checkbox、offset 漂移、维护负担 | **模板最小版与规划入口已实现**；不创建 anchor 或复制任务；专用加入/移出操作仍按真实摩擦准入 |
| Upcoming 准备行动 | Upcoming task 已复用 Task Actions 的 Open/Peek、Add Next Action、Add Related Link | 小 | 自动倒排或重复创建准备任务 | **已有最小入口**；不自动创建准备任务 |

Plan Today 需要先补一个窄语义缺口：当前 Today 只收录当天 `scheduled`，Backlog 又排除所有已有
`scheduled` 的任务，因此过去日期仍未完成的安排需要独立的 `past scheduled` 事实。它必须与 overdue
deadline 去重，并明确表示“旧计划待处理”，不能自动滚到今天或明天。

本周重点首版不承诺精确、耐久的 task reference。`SourceHandle` 是短期 guarded mutation 凭据，
不是跨周计划身份；`page@offset` 会漂移，也不能为了加入候选偷偷创建 `$anchor`。模板与页面链接
不能满足实际使用时，再单独设计“加入／移出本周”的窄 Markdown 语义。

### 近期应实施或完成资格的项目

| 剩余项目 | 频率 | UX／安全收益 | 复用 | 成本 | 主要风险 | 结论 |
|---|---:|---:|---:|---:|---|---|
| 真实 K0 连续走查与摩擦修复 | 日 | 很高 | 高 | 中 | 自动测试掩盖 IME、焦点、错误目标和刷新跳动 | **立即做**；逐条走真实 task-only/Foam 路径 |
| 跨 extension-host writer admission | 事件触发 | 很高安全收益 | 中 | 中高 | 多窗口同时 sync 使用不同 authority，产生覆盖或错误成功报告 | **启用多窗口 autoSync 前必须做** |
| Plan Today → Replan → 当天复盘＋明日计划 | 日／事件触发 | 高 | 高 | 中 | 形成第二套 planner、混淆 deadline 与主动安排、自动 rollover | **最小实现完成，task-only/Foam K0 已通过**；明日安排需用户显式选择，简体拼音已在 native picker 验证 |
| Weekly Review → 下周重点与 Backlog resurfacing | 周／月 | 高 | 高 | 小到中 | 强迫清积压、增加 cadence 状态、从当前状态伪造历史 | **最小实现完成，待新增出口 K0** |
| Upcoming 准备行动 | 周／事件触发 | 中高 | 高 | 小 | 自动倒排、重复任务或把未来 deadline 当今日承诺 | **已有 Task Actions 入口**；真实路径继续观察 |
| Project resumption brief | 月／事件触发 | 高 | 高 | 中 | 把 mention 当进展、把生成时间当事实时间 | **最小实现完成，task-only K0 已通过**；只显示页面、相关任务和可靠完成事实 |
| Review period facts / What changed | 周／月 | 中高 | 高 | 小到中 | 缺少通用 event store 时夸大历史完整性 | **最小实现完成，task-only K0 已通过**；仅 completion dates 与明确 dated interactions |
| Meeting Wrap-up | 事件触发 | 高 | 高 | 中 | 重放步骤、错误 participant、自动完成相关任务 | **最小实现完成，待真实 K0**；三个步骤由用户独立勾选并分别验证 |

### 独立资格或状态设计项目

| 项目 | 频率／收益 | 成本 | 风险 | 准入结论 |
|---|---|---:|---|---|
| Calendar read-only Agenda | 日用潜力高 | 中高 | TCC/发布宿主、多 Calendar、全天/跨日、DST、recurring occurrence | `Product value: High / readiness: Needs capability spike`；先与 Calendar 并排使用实测 |
| Notes/Reminders/Calendar 真实宿主验证 | 事件触发，正确性收益高 | 中 | 权限、个人数据、外部对象清理、迟到同步 | 使用明确授权的可丢弃对象；fake 不能替代 |
| Durable shared sync authority migration | 多 writer 时安全收益高 | 高 | 迁移旧 baseline、单写者、失败表达、provider/vault 隔离 | 单窗口当前 UX 不阻塞；新增 writer 或跨 host 前单独设计 |
| Cancel / Drop | 周／事件触发，中高收益 | 中 | 与 Complete/Delete/Someday 混义，历史与外部完成状态不清 | 先确定状态政策与查询语义；未确定前不显示 |
| Create Project from Task | 周，中等收益 | 中高 | 页面 collision、子树搬移、取消和部分失败 | Attach Page 不算完成；重复操作得到证据后再做 D3 |
| Associate existing Calendar event | 事件触发，中等收益 | 高 | exact occurrence、master/instance、identifier 漂移、重复绑定 | 等 D4 identity/event selection 合格，不做模糊匹配 |
| Project closure checks | 月／事件触发，中等收益 | 中 | 漏掉 open/waiting/binding 后给出虚假安全感 | **最小实现完成，task-only K0 已验证事实提示与取消无写入**；只显示本页/相关 open、Waiting 与已知 bindings，不自动完成或删除 |
| Walkthrough / Keyboard Help / result empty states | 首次／低频，中等收益 | 小到中 | 文档与真实 command/keymap 漂移 | 用原生 walkthrough/short docs；不做强制设置向导 |
| Review/Resolve 迁移到 V8 | 周／异常，中低收益 | 小到中 | live/frozen 或 diff approval 语义混淆 | 只在现有呈现确有问题时逐项迁移 |

### 只有真实摩擦才进入的候选

| 候选 | 可能收益 | 成本／风险 | 默认决策与最小版本 |
|---|---|---|---|
| Paste with Source | 原位整理资料时少补一次来源 | 中；clipboard metadata 仅限窗口，offset 不耐久 | Deferred；先比较普通粘贴与 Capture Selection，必要时插入正文＋来源 |
| Inherited-only Inlay Hints | 少开 Hover，减少隐藏继承误解 | 中；噪声、性能、与 Foam 装饰竞争 | 默认关闭；只显示会改变操作判断且正文未表达的继承值 |
| Narrow Undo | 修复误完成/误改期 | 高；与原生 Undo、stale、外部效果交错 | Deferred D2；仅 session 内安全 semantic mutation，绝不整页恢复 |
| Full Context / Pin / Follow | 更快恢复一组工作背景 | 高；新状态、布局和跨窗口复杂度 | 继续用 Now、Find、Project/Person Context；有重复摩擦才设计 |
| Cross-workspace Capture/Now | 在代码 workspace 与个人 vault 间少切换 | 高；错误 vault、remote host、隐私和 URI routing | 先显式选择 vault；不建后台协调器 |
| Read-only deep links | 从外部材料返回确定来源 | 中高；错误窗口、路径越界、过期身份 | 只读、重新验证 vault/source，不传正文或任意 command |
| Context Pack / handoff summary | 重复整理同一组资料时节省时间 | 中高；隐私、过期副本、范围扩大 | 用户选 source、预览、带出处的只读输出；不建 RAG 数据库 |
| AI suggestions / native tool | 摘要或下一步建议 | 高；隐私、幻觉、授权和依赖 | 先只读/草稿；写入仅调用已有 guarded mutation，不建聊天/runtime |
| Short timebox / timer | 降低开始阻力 | 中；睡眠/重启/多窗和“实际工时”误解 | 仅显式短 timebox；不统计工时，不承诺宿主退出后提醒 |
| Estimate / capacity planning | 减少每天高估可用时间 | 中；新增 metadata、估时维护和假精度 | Agenda/真实时间约束先可见，且用户愿意持续估时后才做简单汇总；缺失值不按零，不自动排程 |
| Limited chart / Kanban / batch action | 稳定查询的形状确实影响决策 | 中高；row identity、批量 stale、第二套 UI | 单个命名只读视图或受限批量动作；不建 builder |
| Single-purpose Webview | 原生组合无法解决一处高频复杂交互 | 高；安全、可访问性、状态分叉、Foam 共存 | 每次只准一个场景且有原生对照；失败即回退 native UI |
| Semantic search | 关键词、link、属性查询仍反复找不到 | 高；索引、隐私、相关性解释 | 可删除重建、带来源的可选层；当前 Find/Foam Search 优先 |
| Goal / Habit semantics | 普通页面/Project 无法表达真实生命周期 | 很高；recurrence/history/新模型 | 继续用模板、Project、Review、Reminders；有稳定案例再补窄语义 |
| Inbox → Person 等转换 | 建页、metadata、链接步骤反复出现 | 中；容易演化为 generic object builder | 单个可预览命名 mutation；不建设 Type builder |
| 阅读／Issue／聊天来源桥接 | 同一来源反复复制且 provenance 丢失 | 中高；权限、身份和无边界镜像 | 先选择性引用/导入；不做全量双向同步 |
| Area / 生活领域 | 长期责任需要少量入口 | 小到中 | 新类型、继承或虚假 action-gap | 只做普通页面与 Foam 模板；不增加 core entity |
| Document Drop / binding links / Signature Help / Workspace Symbols | 某个原生入口被证明不够 | 中；API 覆盖本身没有产品收益 | 保持 language roadmap；优先现有 Capture、Hover、Find、Open Binding |

### 应交给宿主、外部应用或第三方产品

| 能力 | Owner / 替代方案 | LifeLoop 只保留什么 |
|---|---|---|
| 文件、编辑、普通搜索、Quick Open、Outline、Git | VS Code | 精确 source navigation 与 guarded mutation |
| Wiki links、backlinks、graph、tags、templates、普通查询 | Foam | task-level inherited context、Linked Tasks 和命名 projections |
| 通用表格管理、transform、图表和看板 | Foam/SilverBullet query 或专门数据工具 | 稳定 LifeLoop projection；只有决策受呈现限制时加单个受限视图 |
| Calendar 浏览、编辑、拖拽、recurrence、attendees | Apple Calendar | 有资格的 read-only Agenda、受限 title binding 和 Open External |
| 通知与 recurring reminder engine | Apple Reminders | 明确 binding、有限 reconciliation、冲突与来源报告 |
| 邮件、聊天、阅读器、联系人 enrichment | 对应专门应用 | 用户选择的 source 引用、capture 和必要 context |
| 财务、医疗、密码、家庭库存数据库 | 对应专业产品 | 与这些领域有关的任务、deadline、笔记和证据链接 |

### 明确不属于剩余实现

以下能力不会因为出现在 all-in-one 讨论中自动进入 backlog：第二套 canonical object/task/person
数据库、generic Type/Schema/Formula/Dashboard builder、generic event store、完整 Calendar 或
Reminder engine、无边界双向同步、自动 identity merge、relationship/project health score、
全功能邮件/聊天/阅读器/通讯录客户端、完整财务/医疗/密码平台、团队协作平台、插件内第二套
扩展生态、全面 SilverBullet runtime parity。

上述 daily/weekly 最小切片已进入 working tree。下一顺序是：**完成这些新增入口的真实 K0 → 修复实际摩擦 →
再决定是否增加本周候选专用操作或新的产品切片。** Calendar/Apple 资格独立推进；writer admission 是启用
多窗口 autoSync 前的安全门槛。本周候选专用操作和容量规划只在最小版本取得真实使用证据后进入实施。
默认不建设任务 Start/Stop、每日执行顺序或工时记录。

## 最终定位
我会把 LifeLoop 的产品承诺收敛成：

> **把生活中的信息和承诺可靠地接住，在需要时带着上下文呈现出来，帮助用户完成、跟进和复盘。**

它应该深入拥有的是 **行动语义、关系语义、复盘语义，以及这些语义之间的连接**。

它应该广泛支持、但不必拥有的是 **笔记、资料、时间、学习、职业、生活行政、财务相关事项和健康相关事项**。

它应当坚决避免的是 **第二套数据库平台、第二套执行系统，以及未经确认就改变现实世界的“智能管家”**。

**最好的 all-in-one 不是“什么都在这里实现”，而是“处理一件事时，信息、下一步和结果不会在不同工具之间断掉”。**

[1]: https://orgmode.org/manual/Agenda-Views.html "Agenda Views (The Org Manual)"
[2]: https://noteplan.co/?utm_source=chatgpt.com "Looking for an alternative to Standard Notes?"
[3]: https://help.sunsama.com/docs/usage-guides/daily-planning "Daily Planning — Sunsama User Manual"
[4]: https://www.notion.com/help/intro-to-databases "Intro to databases in Notion | Notion Help – Notion Help Center"
[5]: https://foambubble.github.io/foam/ "Using Foam | Foam"
[6]: https://www.ticktick.com/features "Features - TickTick"
[7]: https://getdex.com/product-overview/?utm_source=chatgpt.com "Product Overview | Dex"
[8]: https://dayoneapp.com/features/ "Features of Day One App"
[9]: https://help.sunsama.com/docs/usage-guides/weekly-objectives/weekly-review "Weekly Review — Sunsama User Manual"
[10]: https://readwise.io/read "Readwise Reader | The first read-it-later app built for power readers."
[11]: https://github.com/sysadminsmedia/homebox "GitHub - sysadminsmedia/homebox: A continuation of HomeBox the inventory and organization system built for the Home User · GitHub"
[12]: https://www.ynab.com/features "Features | YNAB"
[13]: https://support.apple.com/en-us/108779 "support.apple.com"
[14]: https://code.visualstudio.com/api/extension-guides/tools "Language Model Tool API | Visual Studio Code Extension API"
[15]: https://help.sunsama.com/docs/usage-guides/tasks/planned-and-actual-times "Planned and Actual Times — Sunsama User Manual"
[16]: https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security "Extension runtime security"
[17]: https://code.visualstudio.com/api/extension-capabilities/common-capabilities "Common Capabilities | Visual Studio Code Extension API"
[18]: https://code.visualstudio.com/api/advanced-topics/extension-host "Extension Host | Visual Studio Code Extension API"
[19]: https://code.visualstudio.com/api/advanced-topics/remote-extensions "Supporting Remote Development and GitHub Codespaces | Visual Studio Code Extension API"







## 跨场景产品边界与扩展原则

**LifeLoop 提供跨场景反复使用的操作；模板承载各场景的内容结构；外部应用负责专业数据与执行；用户负责需求、判断和取舍。**

重点不是让 LifeLoop 理解“汽车、菜谱、岗位”的全部含义，而是让这些活动都能顺畅地完成：

> **明确需要 → 收集依据 → 作出选择 → 安排行动 → 等待／执行 → 确认结果 → 留下经验。**

这条活动链是描述性框架，不是新的状态机。用户可以从任意环节进入，也不需要让每件事经过或记录每个阶段。以下内容用于约束产品边界和评估候选方向，不生成新的整体 implementation backlog。

“已有能力”与“已通过某个真实宿主入口验收”是两件事。当前实现状态以 [Capability Matrix](./CAPABILITY-MATRIX.md) 和当前 HEAD 为准；“可以拓展”不表示已经批准实施。

## 一、LifeLoop 可以考虑拓展哪些通用核心能力？

其中不少已有实现基础。表中的“性质”描述这一行当前在 roadmap 中扮演的角色，不替代 Capability Matrix 的实施证据。

| 通用能力 | 性质 | 当前状态与复用基础 | 在日常活动中的体现 | 建议边界 |
| --- | --- | --- | --- | --- |
| **带上下文的捕获、补充与找回** | UX 增量 | Capture、Capture Selection、Find、Source、Progress、Add Related Link 已有实现；Task Actions 已补 direct Person/Note Open Related Page；当前 task-only 已验证成功、取消、补充和返回连续性 | 收到报价后补到选购项目；招聘回复补到对应机会；想到食材时快速记录 | 不自动分类全部内容，不要求每次选择一串字段；已有入口顺畅时不再新增命令 |
| **周／日选择与执行衔接** | 已有能力 | Backlog、Schedule、Now、Cue、Plan Today、晚间复盘与明日计划、Weekly Focus 已有实现或模板基础 | 这周推进面试准备；早上或前一晚选择今天；临时有事后调整剩余安排 | 不保存默认执行顺序，不加入 Start/Stop tracking，不把“本周想做”写成假 deadline，不强制估时或自动滚动 |
| **Review 中直接处理问题** | 已有能力 | Live Review 已有 fresh query、原地动作和连续刷新；Foam 与当前 task-only 均已有 mutation 后保持 scope/相邻选择的宿主证据 | 发现项目页缺少下一步时直接处理；检查 Waiting 后决定后续行动 | 只解释实际统计范围，不把项目页统计扩大成整个项目结论；冻结 Review 只导航 |
| **比较 → 核实 → 决策** | 模板验证 | 普通页面、Markdown 表格、来源链接和现有 Task 已可承载；先验证是否仍有重复操作 | 对照主板、车源或 offer；标出未知；核实后记录选择理由 | 比较维度由用户定义；不自建评分、产品数据库、查询构建器或推荐引擎 |
| **准备材料与引用留存** | UX 增量 | 文件、链接、Capture、Git/外部版本能力与 direct Open Related Page 已形成最小组合；长路径材料的筛选、打开和返回已有 task-only/Foam 宿主证据 | 面试前找回简历；预约前准备材料；采购时保留对应报价引用 | 区分材料位置、明确版本或不可变副本、用户记录的提交事实和外部回执；任何一项都不能替代另一项 |
| **Waiting → 检查 → 结果确认** | 已有能力 | Waiting 与 Complete/Create Next Action/Schedule/Clear Waiting 等独立动作已有实现；当前 task-only 已验证明确目标和连续 Review 返回 | 等卖家答复、招聘反馈、退款到账或维修完成 | 收到回复不自动等于完成或创建下一行动；提醒到时不证明对方没有回复 |
| **查看已知关联事项** | UX 增量 | core 的直接关系、确定性继承、Linked Tasks、Find/来源查询与 direct Open Related Page 已覆盖当前可证明范围；未复现需要新汇总器的摩擦 | 面试改期后查看已知准备事项；出行取消后查看明确关联的预约；更换部件后复查已链接条件 | 显示关系类型、范围、来源与新鲜度；不按标题或时间相似度猜测，不把相关性当作 blocker、participant 或因果影响，不宣称完整，不自动级联修改 |
| **按当前情境集中处理** | UX 增量 | 现有 Find scopes、明确链接、Person Context、Project view 和原生文件导航覆盖当前路径；未复现需要新 Context 状态或视图的摩擦 | 与同一个人通话时一起处理明确相关问题；在一个项目背景中集中核实事项 | 情境由用户明确选择或来自已有关系；不监视活动应用猜情境，不强迫全库加标签，不复制任务 |
| **结果记录 → 经验复用** | 模板验证 | Progress、Resume Cue、普通页面与模板可记录经验；先验证人工整理是否已经足够 | 上次申请遗漏的材料进入下次准备说明；上次装机问题成为检查提示 | 用户决定哪些经验值得复用；不自动改模板，不把一次例外升级为规则，不要求每次事后整理 |

“准备材料与引用留存”中的几类事实必须分开：路径只说明当前位置；Git revision 或不可变副本标识具体内容；“已提交”是用户明确记录的业务事实；外部提交回执由相应系统拥有。路径、文件存在或 Git revision 本身都不能证明已经提交，LifeLoop 不建设版本系统。

“查看已知关联事项”只能对显式直接关系和 core 已定义的确定性继承作只读汇总。查询不完整的风险应通过范围、来源、新鲜度和 unavailable 状态表达；未来若从结果执行写入，仍需另行取得 fresh `SourceHandle` 并执行相应 guard。只读结果的不完整性与写入错误目标是两类风险。

### 本轮通用能力验收结论

| 路径 | 结论 | 当前证据与边界 |
| --- | --- | --- |
| 捕获／补充／返回 | **现有实现满足本轮范围** | task-only 中 Capture、Capture Selection 和 Resume Cue 都在写入后回到原编辑器；选区与明确 TreeView 目标保留，Capture 输入可用 Escape 无写入取消 |
| 准备材料与来源定位 | **LifeLoop 最小入口已实现，普通定位由宿主满足** | direct Person/Note 通过 Open Related Page 显示类型与完整路径；长路径可键盘筛选、Enter 打开并用 Go Back 返回。任意文件、正文搜索和 Git 版本继续由 VS Code/Foam/Git 提供 |
| 查看已知关联事项 | **现有有限语义满足本轮范围** | Linked Tasks、direct link、确定性继承、Find 和来源导航覆盖可证明关系；没有证据支持新增相似度推断、完整性声明或通用关系汇总器 |
| 按当前情境集中处理 | **由现有 LifeLoop surface 与宿主组合满足** | 用户可从明确 Project、Person Context、Find scope 或 direct link 进入；本轮未复现必须保存新 Context/Pin/Follow 状态的断点 |
| 场景模板 | **普通模板由 Foam 满足；LifeLoop 只保留语义模板** | Foam 已拥有并验证普通/日记模板路径；LifeLoop 仅实现 Review 与 Weekly Focus 的语义模板，不新增求职、采购或 Meal lifecycle/parser |

这些结论只关闭本轮没有可复现缺口的实现请求；未来若出现稳定、重复、可计数的操作断点，仍按同一准入标准重新评估。

### 两类值得保留，但需要单独设计的语义

**局部 checklist 与正式 Task 的区别。**
这是**新语义候选**。食材、装机检查项、面试前检查步骤可能需要勾选，却不应全部进入 Today。若外部清单或普通列表已经足够，就不新增；只有本地可勾选清单反复污染全局任务，才重新评估 core type、parser 和查询语义。

**显式阻塞关系。**
这是**新语义候选**。“相关”不等于“必须等它完成”。先用准备说明和关联任务；只有用户反复需要查询“什么挡住了这件事”，才考虑有限的 blocker 语义，而不是直接做依赖图与自动排程。

持续新鲜度、变化自动传播和复杂计划状态同样属于新语义候选。**跨场景出现只是准入理由，不是立即 core 化的理由。** 先检查已有页面、链接、宿主能力和操作能否满足；没有重复摩擦证据就不新增 core type、parser 规则或通用引擎。

---

## 二、哪些应该交给用户定制或少量模板？

模板负责的是：

> **这个场景通常需要考虑什么、记录哪些字段、如何组织文字。**

它可以使用 LifeLoop 已支持的语法，但不应该重新实现任务、日期、Waiting、关系和来源逻辑，也不能通过字段约定悄悄新增生命周期、继承或自动化规则。

| 场景                | 适合模板／用户填写的内容                    | 不应因此新增的核心模型                       |
| ----------------- | ------------------------------- | --------------------------------- |
| **大件购买**          | 必须满足的条件、偏好、预算、候选、疑点、决定、验收事项     | Product、Purchase Pipeline、自动性价比评分 |
| **组装电脑**          | 部件清单、配置方案、具体拓扑要求、兼容性证据          | 硬件规格库、兼容性规则引擎                     |
| **买车**            | 车型与具体车源、报价范围、试驾记录、待核实问题         | Vehicle、车辆估值与金融模型                 |
| **求职／跳槽**         | 公司、岗位、阶段、相关人、提交材料、面试记录、offer 比较 | 默认新增 Opportunity 状态机、申请漏斗平台       |
| **Meal planning** | 每周菜单、人数、偏好、特殊准备、实际调整            | Recipe、Ingredient、Pantry 模型       |
| **家庭与照护**         | 自己承担的责任、已确认安排、需要询问的内容、准备清单      | 家庭成员分派系统、协作权限平台                   |
| **健康预约／生活行政**     | 问题、材料、预约背景、提交依据、后续检查            | 医疗档案、保险或行政流程引擎                    |
| **学习与实践**         | 学习问题、资料、练习计划、结果与反思              | Skill Score、课程平台、自动掌握度判断          |

### 用户定制与产品责任要分清

**用户应提供的：**真正的需求、比较标准、必要材料、取舍、结果判断。

**不应长期推给用户的：**反复复制链接、寻找同一资料、手写重复查询、重新选择同一目标、修复隐式状态混淆。

例如：

* “买车时我更重视什么”应由用户决定。
* “每次切换候选都要打开四个文件才能对照”可能是产品 UX 缺口。
* “这份材料是否足够提交”通常需要用户判断。
* “我上次提交的具体版本找不到”应先使用明确版本、不可变副本或外部回执，并改善它们的引用与定位。

**让用户定制内容，不等于让用户自己搭建和维护一套软件。**

模板应少量、可选、不强制填满，也不默认生成大量活跃 checkbox。

比较场景先使用表格、普通页面和链接。如果真实使用仍反复出现查来源、创建核实任务、补充材料或返回位置的摩擦，应修对应的通用 UX，不能以“模板能表达”为由让用户长期绕路。

---

## 三、哪些应交给宿主或外部应用？

这里不仅包括“通过 LifeLoop 集成完成”，也包括**直接在外部完成，不进入 LifeLoop**。

| 能力范围                      | 建议 owner／替代方式       | LifeLoop 保留的连接                      |
| ------------------------- | ------------------- | ----------------------------------- |
| **普通编辑、文件、搜索、版本控制**       | VS Code／文件系统／已有版本工具 | 精确来源、就地动作、上下文与返回                    |
| **Wiki links、反链、普通页面与模板** | Foam／现有 Markdown 工具 | LifeLoop 独有的任务语义与派生查询               |
| **日历时间、邀请、重复实例**          | Calendar            | 有资格的只读摘要、准备与后续事项、来源导航               |
| **提醒、重复生活事项、移动端清单**       | Reminders 或选定任务应用   | 明确交接；必要时读写同一外部对象，不默认复制任务            |
| **手机捕获、扫描、照片与原始材料**       | Notes／Files／扫描工具    | 选择性导入、引用、处理状态；保留现有 Notes pending 契约 |
| **菜谱、份数换算、食材合并、库存**       | 专门菜谱／采购应用           | 用餐安排与需要用户处理的准备事项                    |
| **职位搜索、申请表填充、邮件线程**       | 招聘网站、申请工具、邮件客户端     | shortlist 背景、面试准备、Waiting、材料与决定     |
| **实时价格、专业规格、兼容性辅助**       | 商品平台、官方资料、专业选件工具    | 用户的要求、核实结果和最终取舍                     |
| **预算、复杂金额与方案计算**          | 表格或专业工具             | 假设、来源、结论与相关行动                       |
| **医疗、财务、密码等专业记录**         | 相应专业产品              | 必要任务与引用，不默认复制敏感数据库                  |

### 连接方式按需要选择，不默认双向同步

| 实际需求                   | 优先方案               |
| ---------------------- | ------------------ |
| 一件事在外部已经能完整完成          | **外部直接使用**         |
| 只需要从项目回到资料             | **引用与导航**          |
| 需要在工作中看见外部安排           | **只读聚合，说明范围和新鲜度**  |
| 需要将捕获变成长期记录            | **明确导入／交接**        |
| 需要在 LifeLoop 中操作外部原生对象 | **受限地操作同一个 owner** |
| 两边都必须长期独立编辑同一承诺        | **才讨论已有或新增同步契约**   |

新分工不能静默改变已有 Notes pending 双边编辑、Process 或 legacy binding 行为；迁移需要另行决定。

外部 alternative 按完整旅程判断，包括进入、操作、来源定位、返回、新鲜度、失败恢复和键盘连续性。外部或模板实现成本较低，不足以证明体验完整；LifeLoop 集成也不因技术可行就自动具有产品价值。选择能够完整解决已观察问题的最小方案。

---

## 四、放进日常活动里，它们如何共同工作？

### 1. 求职：换模板，不换工作方式

用户建立一篇普通机会页面，填写岗位、阶段、材料与相关人。外部网站负责发现和提交；Calendar 管面试时间。

LifeLoop 帮助：

> 保存明确材料 → 核实岗位疑问 → 安排准备 → 找回面试背景 → 记录结果 → Waiting → 下一行动。

**模板负责公司、职位、轮次；核心负责来源、任务、关系、等待、计划与记录。**

如果只是几个重要机会，普通页面与查询通常足够。只有长期反复遇到跨机会 stage 操作的困难，才重新评估专门 projection，不能因为叫“求职”就立即新增类型。

### 2. 装机／买车：用户判断取舍，工具减少整理成本

用户决定必须满足的条件，用模板组织候选。规格、车源和计算来自外部工具。

LifeLoop 帮助：

> 对照依据 → 把未知变成核实任务 → 收集答复 → 保留报价／材料的明确引用 → 记录决定 → 跟进交付与验收。

**它不替用户定义“哪辆车最好”或“哪个配置一定兼容”，但应让证据、疑问和下一步不容易丢。**

### 3. Meal planning：LifeLoop 可以只管较高层的安排

用户在普通周菜单页或外部餐食工具中规划这周吃什么。菜谱、份数与食材清单由专业工具维护，到店采购在手机清单中完成。

LifeLoop 只需帮助：

> 确认这周哪些天需要准备 → 安排采购／备餐 → 保存值得保留的调整经验。

不需要把每个食材、每顿饭都变成任务，也不需要把外部采购清单复制一份。

### 4. 维修／报销／家庭事务：同样复用交接闭环

用户用模板记录问题、材料和期待结果，外部服务负责处理。

LifeLoop 帮助：

> 准备 → 提交 → 保存依据 → 等待 → 检查 → 确认结果。

“提交了”与“办妥了”分开，但不强制每件小事走一套状态机。哪些步骤需要记录，由实际后果和使用需求决定。

---

## 五、每天、每周应该呈现为怎样的使用节奏？

| 时机           | 用户在做什么         | LifeLoop 应提供什么                       | 外部／模板承担什么             |
| ------------ | -------------- | ------------------------------------ | --------------------- |
| **每周规划**     | 选择少量重点，检查近期约束  | 从项目、Backlog、Waiting 中形成选择；需要时在普通 Weekly Note 中引用已有任务或项目 | 用户写方向；Calendar 提供真实安排 |
| **当天开始或前一晚** | 根据期限、计划和现实条件选择今天做什么 | 看清期限与计划，选择 Today／Now，打开所需背景；不要求保存执行顺序 | 不要求先整理全部生活领域 |
| **执行过程中**    | 找材料、核实、沟通、记录进展 | 就地来源、关联查询、Capture、Progress、Waiting   | 专业工具负责交易、计算、发送和领域执行   |
| **计划变化时**    | 调整剩余安排         | 保留上下文，查看明确关联事项，逐项改期或决定               | 不自动取消外部预约或级联修改        |
| **结束一天／一件事** | 保存下一步，确认哪些仍待结果；需要时顺手规划明日 | Cue、结果记录、后续事项、晚间复盘与明日计划、明确返回 | 用户判断是否真正完成 |
| **周度回顾**     | 继续、暂缓、澄清、复用经验  | 在发现问题的位置直接操作；只展示可验证事实                | 不要求填所有栏目，不制造完整历史的假象   |

**不是每一天都必须执行这套完整流程。** 产品应支持用户从中间进入，也允许只记一条内容、只处理一个问题，然后离开。Weekly Note 中的本周重点只是对已有任务或项目的引用；移出候选不改变任务状态，也不触发自动滚动或 review cadence。

---

## 六、建议怎样收敛到 roadmap？

本节不是新的整体 implementation backlog。下列小切片先确认当前覆盖；现有路径已经完整时，以“已有覆盖”结束，不新增重复命令、视图或状态。

| 小切片 | 当前 HEAD 基础 | 只在什么情况下修改 | 窄退出条件 |
| --- | --- | --- | --- |
| **捕获／补充后返回** | Capture、Capture Selection、Progress、Add Related Link 已有 guarded 路径 | 真实 task-only/Foam 仍出现重复选择目标、输入丢失、焦点抢回或无法返回 | 一个键盘路径完成补充并回到原工作；取消和失败保留输入与明确目标 |
| **Review 原地操作并继续** | Live Review 已有 fresh query、原地动作、刷新与相邻选择 | 观察到 scope/选择丢失、旧 handle 被复用或每项都重开流程 | 每次操作独立验证；刷新后留在同一 scope 并选择仍存在或合理相邻项 |
| **Waiting 后续动作** | 独立的 Complete、Create Next Action、Schedule、Clear Waiting 已有实现基础 | 动作入口难找、目标重复选择或结果表达不清 | 用户明确选择一种意图；不自动串联、不改变父 Project 或推断 Interaction |
| **选择已有页面建立明确关联** | Add Related Link 已有自动和 task-only 宿主证据 | Foam 路径、键盘连续性或完整路径辨识仍有实际断点 | 从明确 Task 选择已有 Project/Person/Note，写 direct link，并保留来源/返回 |
| **准备材料与来源定位** | 文件、Git、链接、Capture 和 Open Source 提供基础；Task Actions 已能打开明确任务的 direct Person/Note page | 真实宿主仍出现多次查找、返回丢失或不能辨认重名材料 | 一个键盘路径定位已记录引用并可返回；明确区分位置、版本、提交事实和外部回执 |
| **查看已知关联事项** | 直接关系、确定性继承、Linked Tasks 和查询可复用 | 用户确实因变化而反复手工寻找已知关联 | 只读列出可证明关系，显示范围、来源、新鲜度和 unavailable；首版只 Open Source |

所有切片保留完整键盘入口、目标校验、输入、scope 和选择连续性。TreeView 选择 A 时不能静默回退到后台编辑器 B；异步结果不能把准备操作的 A 换成 B。

### 先用模板与真实场景验证，再决定是否产品化

**比较决策、本周重点、材料引用与经验复用。**

先用一个真实选购项目、一次求职流程或几周生活安排检查：模板解决之后，究竟还剩哪些反复操作？本周重点先用普通 Weekly Note 引用已有任务或项目；不新增成员关系、自动滚动或 review cadence。只有真实摩擦仍存在时，才补相应的窄命令或视图。

### 单独设计，不顺手加入

**局部 checklist、显式依赖、持续的新鲜度管理、变化自动传播、复杂计划状态。**

它们可能有价值，但会改变索引、生命周期或历史含义，不能靠一个 UI 按钮掩盖。

本文以及前文中的频率、收益、用户维护成本和工程成本均为规划判断，不是实测结果。真实宿主体验、性能和使用频率必须另行记录；仅修订文档不代表任何功能、测试或 K0 验收完成。

---

## 最终分工原则

可以概括为四句话：

**LifeLoop 管通用动作与连接：让信息进入、事情推进、上下文找回、结果留下。**

**模板管领域结构：告诉用户这次值得考虑哪些问题，而不是强迫填写统一 schema。**

**外部应用管专业数据与执行：日历、提醒、采购、菜谱、申请、交易和复杂计算各有合适位置。**

**用户管意义与判断：什么重要、哪些条件必须满足、接受什么取舍、怎样才算办妥。**

最终理想不是“所有事情都在 LifeLoop 里”，而是：

> **换一个生活场景，只需要换内容和少量模板；通用操作仍然熟悉，专业工作仍在合适的工具里，信息与承诺在交接处不丢失。**
