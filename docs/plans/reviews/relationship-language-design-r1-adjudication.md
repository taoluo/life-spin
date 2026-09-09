## 独立裁决

结论：**CHANGES REQUIRED；不是 CLEAN。**

- 冻结 artifact SHA-256 与 recovery commit `882412bb8d528fb47d70894ee0a6364cd3408b99` 中内容均核验为 `0dd077f3afb0ce49e4fc3186696bbf1f527c870db46bfc9a9ae97c6f3746e2fa`。
- 无 review-severity P0。
- 存在必须在生产实现前修正的 P1：公共查询契约、live/index freshness、任务 identity、跨 prompt/I/O authority、最终写入 race、Calendar 唯一性。
- P2 可以整体显式延期；若声称交付，则其 Foam/untitled、临时导航和 command-backed 修复要求不可削弱。
- 全程只读，未改文件。

### 源码证据

关键反例均成立：

- 任意非空 custom kind 当前确实计数：[relationships.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/semantic-core/src/relationships.ts:125)。
- `ProjectionArgs` 当前全局共用，投影会静默忽略无关参数：[contract.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/semantic-core/src/contract.ts:37)。
- CLI 和 Lua 向每个 projection 注入默认/无关参数：[main.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/cli/src/main.ts:50)、[host.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/semantic-core/src/lua/host.ts:330)。
- query parser 的全行 `trim()` 丢失 located ranges；编辑器 fence 扫描仅识别三反引号：[preview.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/vscode/src/preview.ts:27)、[query-lens.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/vscode/src/query-lens.ts:22)。
- `taskTarget` 在同时带 `handle/page/offset` 时绕过 handle 重解析：[task-target.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/vscode/src/task-target.ts:36)。
- task-originated logging 跨三个 prompt 保留旧 candidates，最终 mutation 只保护 Journal，不保护 task/Person 输入：[commands.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/vscode/src/commands.ts:83)。
- Brief 在 Calendar read 后未重建 task snapshot；缺失事件还写 conflict registry：[apple.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/vscode/src/apple.ts:187)。
- Calendar 多匹配记录通过 `Map` last-wins，`cancelled` 被无证据地硬编码为 `false`：[calendar.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/apple-bridge/src/calendar.ts:112)。
- relationship diagnostics 目前只随 debounce 后的 index change 更新：[extension.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/vscode/src/extension.ts:97)。

## 按 root cause 的 consolidated corrections

### 1. 查询契约与语言解析不是同一个可靠边界

三个方案中，拒绝“所有 projection 全局 strict”，也拒绝“只在 VS Code adapter 校验”。选择最小正确中间方案：

- Core 仅为四个 relationship projections 增加静态 `allowedArgs`、`requiredArgs`、`fields` 和纯 validator/classifier。
- `runProjection` 仅对这四个 projection 严格校验：
  - `people` 不接受参数；
  - `interactions` 接受 `person/from/to/kind`；
  - `reconnect` 接受 `date`；
  - `person-context` 必须有 exact canonical Person；
  - 日期必须严格 ISO，`from > to` 拒绝；
  - `person` 不存在或不是 Person 时拒绝；
  - `kind` 只要求非空。
- 不改变旧 projections 对额外参数的既有容忍语义。
- CLI/Lua 改为只传用户显式提供且属于目标 projection 的参数，不再给所有 projection 注入 `date/days/project/page`。
- `fields`、`limit` 保持 presentation 参数，不进入 `ProjectionArgs`；query adapter 和 CLI 均要求 `limit` 为非负整数并实际应用。
- `INTERACTION_KINDS` 仅是 UI 生成和 query completion 建议。任意非空 custom kind 仍计数、可筛选、无 unsupported-kind diagnostic；空值才排除并告警。
- 导出最小纯函数来统一 ISO date、birthday、cadence、Journal-date 分类。Cadence 必须有限、正整数且不会使 date shift 溢出；不得让 `Infinity` 到达 `shift()`。
- 公共 `InteractionRow` 显式映射为 `ref/page/date/kind/text/people`；删除内部 `offset` 泄漏。`person-context.recentInteractions` 同样使用公共 row。
- 冻结 optional/null/order：optional 字段缺失时省略；never-contacted 的 `due` 为 `null`；各 projection 的稳定排序写入契约。
- 使用一个小型 located query parser；completion、diagnostics、definition、hover、CodeLens 共用。它覆盖现有 `lifeloop` 和 `query` alias，以及 Markdown preview 已接受的三段以上反引号和 tilde fences。completion 只在这些 fence 的 body/value 内出现。
- 不建立 LSP 或 `LanguageService`。未来只有出现第二编辑器、需要 extension-host 进程隔离，或多个客户端需要共享服务时才重开 LSP gate。

### 2. Live 文档与 index 必须分层，而非统一全库 reindex

采用两级 freshness：

- 纯词法路径直接读取传入 `TextDocument`：fence/token/range、固定 projection/argument/field/kind 建议、本地日期/生日/cadence/空 kind 诊断。不得触发全库 reindex。
- index-dependent 路径只能使用“已 settled 且 generation 与 source revision 相等”的 snapshot。否则：
  - completion 只返回仍可由 live 文档确定的固定建议；
  - derived hover/eligibility 返回空；
  - identity diagnostic 暂缓；
  - 不允许旧 index 压过 live buffer。
- exact definition 不需要 index：从 live origin 提取 token，通过 `WorkspaceVault` 读取 exact target，并以 live frontmatter 复验 Person tag；任何缺失、歧义或读取 UNKNOWN 返回空。
- task code-action eligibility、Log、Brief 属于 authority-sensitive 路径，可以显式刷新并等待 serial index。
- `onDidChangeTextDocument` 必须立即重算该 URI 的 relationship lexical diagnostics；400 ms 只用于 index touch。index settled 后再补跨文件 identity diagnostics。
- 诊断严重度必须分层：
  - **Error**：未知 projection/relationship argument/field、非法或逆序 query date、非法 limit、缺失/不存在的 required `person`；
  - **Warning**：会被忽略的 birthday/cadence、空 Interaction kind、无可信 Journal date、无 direct exact Person 的 Interaction；
  - **Information**：保留现有兼容性说明；
  - 非空 custom kind：无 diagnostic。
- case-only canonical typo 保留其 Error/Warning 严重度，同时提供 command-backed fix；不能靠降级严重度掩盖执行失败。

### 3. Task identity 和 mutation authority 必须端到端封印

- `taskTarget` 成为唯一 admission：
  - runtime 校验 `ref`、`expectedText`、`expectedState` 都是合法字符串；
  - supplied `page/offset` 只作 presentation receipt，不得绕过 handle resolution；
  - 每次先重解析 handle，再绑定 fresh indexed task。
- numeric handle 必须满足：
  - numeric offset 正好是 live task line start；
  - fresh indexed task 的 CRLF-normalized canonical ref 与原 handle 完全相等。
  - 删除前缀后旧 offset 落入相同未改 task 行内部，必须拒绝。
- anchor handle 继续允许位置移动，但 anchor 必须唯一，且 line/state receipts 仍一致。
- 所有 task 和 diagnostic CodeAction 均只有注册 command，`CodeAction.edit` 必须为空。命令再次校验 version、range、expected text 和 located token 后才能创建 edit。
- Task Log 在每个实际 QuickPick/InputBox 返回后刷新并重验原 handle、task identity、direct Person set、Person identities，以及影响默认 kind 的 event binding。
- Person-page Log 同样在每个 prompt 后复验 live Person identity。
- 最终 core log ChangeSet 的 `expected` 同时包含：
  - origin task 全文（task-originated 时）；
  - 每个 selected Person 全文；
  - Journal before-value。
- dirty task/Person buffer 是 live authority，可作为只读输入，但不得被隐式保存；dirty Journal 是写目标，必须明确拒绝且保持 buffer/save 状态不变。
- admission 阶段的 UNKNOWN 保证尚未产生 effect。写入阶段 response-loss 的 UNKNOWN 不得声称“什么也没写”：
  - bounded authoritative reread 全部 affected files；
  - 全 before：not applied；
  - 全 intended-after 且 durable save 已确认：success；
  - 可证明仅为本次的 before/after partial：沿用一次 serial rollback，并复验；
  - 任一 other/unreadable 或 rollback 不确定：UNKNOWN，保留现场，不自动重试，不建议用户直接重跑。
- 不增加 journal、takeover 或 recovery-of-recovery 系统。

### 4. Brief 必须绑定 exact external authority

- 封印 `{task handle, UID, calendarName, direct Person set}`。
- `requireApp` 返回后重验；`Calendar.readExact` 返回后再次重验；只有此后才计算 contexts 和输出。
- `calendarName` 在 I/O 后必须仍等于 sealed 值。
- Bridge 增加窄的单 UID seam，返回 `found | missing | ambiguous`；同一 named calendar 内重复 UID 必须拒绝，不能 Map last-wins。
- 当前桥接层不能权威读取 cancelled，因此删除 Brief 的 cancelled 承诺与硬编码判断；以后只有桥接层能证明状态时再加入。
- Brief 不写 sync-conflict registry。missing/ambiguous/read failure 只显示错误并可写普通 audit output；正式 conflict ownership 留给现有 Sync。
- 任何 prompt/I/O 后验证失败均不开临时文档、不缓存局部 brief。
- 成功路径只向 Calendar 发送 sealed 的一个 UID，且不写 Markdown/Calendar。

### 5. Foam 与临时文档所有权

- 解析 `[[X@Y]]` 时先检查完整 literal `X@Y.md`：
  - 若存在，LifeLoop 返回 `undefined`，由 Foam 处理；
  - 否则才拆最后一个 `@`，执行现有 exact/unique page resolution 和 live `resolveRef`。
- `person:` 只接受 exact canonical path，不 basename/fuzzy。
- Definition selector 覆盖 `file` 和 `untitled`，但仍只接管 SB special ref 与 query `person:` value。
- 仅 full query-result 和成功 Brief 做 presentation mapping：
  - Person → escaped ordinary wikilink；
  - source ref → SB special ref，并在 CRLF 文档中将 parser offset 转为 original-source offset。
- raw projection rows、CLI JSON、preview rows和 hover 内容不改变；hover 继续 untrusted。
- 必须先用 Foam `0.44.6` 验证 untitled wikilink ownership。若 Foam 不支持，临时输出改用标准 Markdown file URI；不得新增普通 wikilink provider。

## Reviewer finding 裁决

| Finding | 裁决 |
|---|---|
| Scope F1 literal `@` page precedence | **接受** |
| Scope F2 immediate live diagnostics | **接受** |
| Scope F3 `lifeloop`/`query` alias parity | **接受** |
| Scope F4 evidence/test matrix | **修改接受**：自动测试必须 pre-fix RED；Apple real-host 可 skip 但记 not covered；最终 gate 绑定 VSIX SHA |
| Scope F5 temporary navigation | **修改接受**：仅 full temporary output；Foam untitled 结果决定 wikilink 或 file URI |
| Scope F6 unsupported kind / limit | **部分拒绝、部分接受**：拒绝 unsupported custom kind；接受空 kind 与严格 nonnegative-integer limit |
| Scope F7 freshness levels | **修改接受**：按 lexical/live、settled-index、mutation-refresh 三层 |
| Data F1 projection args/parity | **修改接受**：仅 relationship projections 在 core strict；拒绝全局收紧 legacy projections |
| Data F2 public row leak | **接受**：`offset` 不属于 1.1 public row |
| Data F3 shared classifiers | **修改接受**：接受 pure classifiers/overflow fix；拒绝 closed kind enum |
| Data F4 located parser/fences | **接受**：四反引号/tilde 是现有 Markdown preview 语义，不是新增 DSL |
| Data F5 CRLF Interaction ref | **修改接受**：仅 navigation presentation 转换；拒绝全局改 numeric `resolveRef` |
| Data F6 cancelled authority | **接受**：当前取消 cancelled 承诺 |
| Data F7 untitled Foam ownership | **接受，条件化** |
| Authority F1 numeric ref aliasing | **接受** |
| Authority F2 malformed runtime handles | **接受** |
| Authority F3 dirty Person/index | **修改接受**：live target authority；stale index 返回空，不全库重建纯词法路径 |
| Authority F4 final Log race | **接受** |
| Authority F5 uncertain write outcome | **修改接受**：bounded reconcile + existing serial rollback；不建新恢复系统 |
| Authority F6 calendar sealing/conflict write | **接受**：seal config，删除 Brief conflict mutation |
| Authority F7 duplicate UID/no sleeps | **接受** |

明确拒绝的设计方向：

- LSP、generic `LanguageService`、schema/DSL engine；
- 所有 projection 的全局 strictness；
- pure lexical provider 每次全库 reindex；
- 将 `INTERACTION_KINDS` 当作语义有效值白名单；
- 全局重解释 numeric refs；
- 无权威证据的 cancelled 状态；
- Brief 主动维护 Sync conflict registry；
- 未经 host test 假设 Foam 支持 untitled wikilinks。

## 必须先红的测试账本

| ID | 精确反例 | 冻结 baseline 为何 RED | Gate |
|---|---|---|---|
| R1 | direct core：`people({person})`、invalid/reversed interaction dates、missing Person | 当前静默忽略或返回空 | semantic-core |
| R2 | 同一 fixture 经 core、preview、Lua、CLI；CLI named projection `--limit 1` | 参数注入不一致，CLI limit 不生效 | core + CLI |
| R3 | `interactionRows`、`person-context.recentInteractions` deep-equal 无 `offset` | 当前泄漏 `offset` | semantic-core |
| R4 | 巨大 `contact-every` + 已有 interaction 不抛异常并产 Warning | 当前可到 `Infinity`/`shift()` RangeError | semantic-core + VS Code |
| R5 | custom `[interaction: coffee]` 计数且无 unsupported diagnostic；空值排除并 Warning | relationship diagnostics 尚不存在 | core + VS Code |
| R6 | `query` 与 `lifeloop`、四反引号、tilde、CRLF、emoji 前缀；completion 仅 body/value | 当前 scanner 只认三反引号且 parser 无 located range | VS Code unit |
| R7 | edit invalid birthday 后不推进 fake timer，诊断立即更新；spy 证明 lexical provider 未调用全库 reindex | 当前诊断等 index change | VS Code unit |
| R8 | index 仍称 Person、live buffer 已移除 tag：definition/action/derived hover 不得用旧身份 | 当前 task action 可读 stale store | VS Code mock |
| R9 | literal `Foam/Ordinary@anchor.md` 存在时 LifeLoop 不定义；不存在时 special anchor 精确跳转；含 CRLF | 新 DefinitionProvider 尚不存在 | task-only + Foam host |
| R10 | 原文件 `prefix\n* [ ] task`，删前缀后旧 numeric offset 落在同一 task 内：拒绝；唯一 anchor 位移：成功 | 当前 `resolveHandle` 可误通过 numeric case | core + VS Code |
| R11 | supplied `page/offset` + stale handle、缺 expectedText/state、wrong runtime types 全部拒绝 | 当前 bypass/弱 runtime admission | VS Code unit |
| R12 | 每个 Log QuickPick/InputBox callback 分别修改 task/link/Person/event；Journal byte-identical | 当前保留旧 candidates 并写入 | VS Code command |
| R13 | final validation 后、apply 前修改 task 或 Person；dirty Journal；均不写/不保存 Journal | 当前 ChangeSet 不保护 task/Person，dirty Journal 会被编辑保存 | core + VS Code |
| R14 | fake write：before-throw、write-after-throw、third-state-after-throw；分别证明 not-applied/success/UNKNOWN-no-retry | 当前会尝试回滚且不能可靠分类 response loss | semantic-core |
| R15 | Brief 在 `requireApp` 后或 Calendar read 中修改 binding/People/tag/calendarName；无临时输出 | 当前只 pre-read 验证 | Calendar fake |
| R16 | exact reader 返回 duplicate/missing/throw；无 output、无 Brief conflict-registry write；成功仅请求 `[uid]` | 当前 Map last-wins，missing 会写 registry | Apple bridge + VS Code |
| R17 | 每个 task/diagnostic CodeAction 的 `edit` 为空；command 收到 stale version/text 后拒绝 | providers 尚不存在 | VS Code unit |
| R18 | custom/empty Interaction hover与 symbol；普通 wikilink无 LifeLoop hover | providers 尚不存在 | VS Code unit |
| R19 | full query/Brief 有导航链接；raw rows、CLI、hover无 presentation mutation；CRLF source link 定位正确 | 当前 full output 无该映射 | VS Code unit |
| R20 | 最终 VSIX 在 task-only 中断言 Foam 缺席；Foam `0.44.6` 验证 ordinary `@`、untitled 和 provider ownership；报告绑定 artifact SHA | 当前证据未绑定最终 artifact | packaged integration |

不得用固定 sleep 验 freshness；使用可控 promise/barrier。真实 Apple exact-read smoke 只读、可跳过，但跳过必须标成 **NOT COVERED**。

## P0–P2 disposition

- **Delivery P0 保留但先修设计**：relationship contract metadata/validation、located parser、completion、分层 diagnostics、narrow definitions、Log stale/atomic boundary、exact Brief。
- **Delivery P1 保留**：command-backed task actions、semantic hover、projection parity/recipes。公共 row normalization 和 adapter parity 是 P0 实现的前置，不得留到后补。
- **Delivery P2 可整体显式延期**：Interaction symbols、deterministic diagnostic actions、temporary-result navigation。若保留，则 R17–R20 和 Foam fallback 是完成条件。
- **继续 out of scope**：LSP/LanguageService、普通 wikilink/rename/backlinks 接管、Calendar attendee/title inference、saved brief/cache/Webview、generic schema/CRM/chart/AI。

按 brainstorming/YAGNI 的裁决结果是：使用 relationship-only strict core metadata、一个 located parser、两级 provider freshness 和现有 ChangeSet 的最小强化；不引入服务层或恢复子系统。
