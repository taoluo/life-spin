# Relationship language design revision 1 — authority/race review

- Artifact: `docs/plans/2026-09-09-relationship-language-features.md`
- Artifact SHA-256: `0dd077f3afb0ce49e4fc3186696bbf1f527c870db46bfc9a9ae97c6f3746e2fa`
- Recovery ref: `refs/codex/recovery/relationship-language-design-r1-20260909`
- Recovery commit: `882412bb8d528fb47d70894ee0a6364cd3408b99`
- Reviewer scope: independent authority/race/recovery review
- Model: GPT-5 (Codex)
- Reasoning effort: xhigh
- Result: `NOT CLEAN` — no P0; 6 P1; 1 P2
- Capture status: durability copy of the completed report; no re-review performed

审查结论：**NOT CLEAN**。冻结文件与 recovery ref 内容均核验为 SHA-256 `0dd077f3...e2fa`，未编辑任何文件。完整 scope 审查发现 6 个 P1、1 个 P2；无 P0。

### P1-1 — numeric ref 会把“落在行内”误当成原任务身份

- 证据：设计要求 numeric ref 的“exact position”不再指向原任务时必须失败（设计 99–114）；现有 `resolveRef` 只取该 offset 所在的整行，`resolveHandle` 只比较行文本/状态（`mutation.ts:199-275`），`taskTarget` 又把结果归一到新的 `lineStart`（`task-target.ts:49-59`）。
- Concrete counterexample：初始文本为 `x\n* [ ] Call [[People/Alice]]`，handle 为 `Page@2`。prompt 期间删除前面的 `x\n`，任务完整文本不变并移动到 `@0`；旧 `@2` 仍落在同一任务行内。`expectedText`、`expectedState` 均通过，`taskTarget` 重定向到 `lineStart=0`，违反“numeric identity 不随移动”的设计。
- Violated invariant：`ref` 是身份而非查找提示；numeric ref 必须精确匹配当前 indexed task ref，不能通过 containing-line 重绑定。
- Minimal correct fix：fresh reindex 后，numeric handle 必须与当前 task 的规范化 ref（含 CRLF offset 转换）完全相等；不要用 `source.lineStart` 重建身份。Anchor 仍按唯一 anchor 重定位。
- Affected surfaces/tests：`resolveHandle`/`taskTarget`、所有 task commands/code actions、Log Interaction、Brief；增加“删除前缀使旧 offset 落在未改任务行内部仍拒绝”、anchor 移动仍成功、duplicate/missing anchor 拒绝。
- Simplification：复用当前 `resolveHandle` 和 indexed task ref，只补一次 exact-ref 比较；不需要 generation store、锁或新身份层。

### P1-2 — `GuardedSourceHandle` 只是 TypeScript 声明，运行时可降级为无 guard

- 证据：类型允许 `{expectedText}` 或 `{expectedState}` 任一项（`mutation.ts:32-34`），而设计要求同时核对 shown source line 与 marker state（设计 111–114）。VS Code command 参数是运行时数据；`taskTarget` 没有 runtime shape validation，core task mutations仍接受 `SourceHandle`。
- Concrete counterexample：另一扩展或 command URI 调用 `lifeloop.completeTask({handle:{ref:"W@0"}})`；源码已变化但 `resolveHandle` 无 receipt 可比，仍修改当前落在 `@0` 的任务。对 Brief/Log 传 state-only handle，也无法证明用户最初看到的行。
- Violated invariant：跨 UI/prompt/bridge 边界的任务动作必须持有不可降级的 guard；未知输入必须拒绝。
- Minimal correct fix：在统一 `taskTarget` admission 增加 runtime validator；editor-originated task action要求合法 ref、`expectedText` 和 `expectedState` 均存在且类型正确。无需扩大 core 公共 mutation API。
- Affected surfaces/tests：所有公开 task command/code action/hover command arguments；测试缺 receipt、单 receipt、错误类型、额外旧 page/offset 均拒绝且无写入。
- Reuse：一个集中 guard 即可；不应在每个 command 重复检查。

### P1-3 — live-buffer freshness 规则只明确覆盖 task actions，其他 index-dependent Providers 仍可让 stale index 胜出

- 证据：设计 105–107 只明确“before exposing index-dependent task actions”；诊断仅说 range 不依赖 debounce（138–151），但 `person:` 存在性/Person tag、completion、definition、relationship hover 都依赖跨页语义索引。正确契约应是任何未同步 index 都不得优先于 live `TextDocument`。
- Concrete counterexample：Person 页 dirty buffer 刚移除 `tags: person`，尚处 400ms debounce；查询页立即请求 `person:` diagnostic/definition/completion。若 Provider 直接读 store，会继续把该页当 Person，返回错误定义/无错误诊断。
- Violated invariant：live buffer 是当前语义 authority；400ms 仅是 UI 优化。
- Minimal correct fix：把 freshness 条款推广到所有依赖 indexed semantic identity 的 Provider；先等待现有 serialized reindex/live-buffer refresh，失败则返回空/UNKNOWN。纯词法 token/range 继续直接读 supplied `TextDocument`。
- Affected surfaces/tests：completion、relationship diagnostics、definitions、semantic hover、symbols/CodeActions。用可控 barrier 制造 stale store，不用固定 sleep；断言 dirty live text 胜出。
- Reuse：复用 `LifeLoop.reindex()`/现有 serial queue 和 core parsing/validation；不需要通用 LanguageService。

### P1-4 — prompt 后复验没有封入 Journal 写入的最终 optimistic commit；dirty Journal 语义也自相矛盾

- 证据：设计 162–167 只要求 prompt 后 refresh/recompute；现有 `logInteraction` 的 `ChangeSet.expected` 仅包含 Journal（`relationships.ts:31-53`），不包含源 task 或 Person pages。设计 116 说 dirty/UNKNOWN 拒绝，但 `WorkspaceVault.write` 会修改并保存 open dirty buffer（`workspace.ts:37-69`）；测试矩阵又只写“open dirty buffer preserved”。
- Concrete counterexamples：
  1. 最后一次 prompt 复验后，外部 CLI 把 task 的 Alice link 改成 Bob；Journal 未变，仍成功写入 Alice Interaction。
  2. Alice page 在验证后被取消 `person` tag；Journal append 仍成功。
  3. 今日 Journal 有未保存草稿；Log Interaction 会保存整份 dirty buffer，产生超出“追加 Interaction”的副作用。若用户随后原本会 discard 草稿，行为已被不可逆改变。
- Violated invariant：参与人必须在 effect commit 时仍是源 task 的 direct exact People；失败/dirty refusal 不得触碰 Journal 或悄悄保存用户草稿。
- Minimal correct fix：task-originated `logInteraction` 在同一个 core mutation 中解析 guarded task，并把 task source、每个 Person page、Journal 的 expected contents 全部放入现有 `ChangeSet.expected`。VS Code 最终 admission 对 dirty Journal 明确拒绝；按设计原文，dirty task/Person 也应拒绝，除非文档明确改为接受 live-buffer authority及其耐久性后果。
- Affected surfaces/tests：core relationship mutation、task command orchestration、WorkspaceVault integration；覆盖 task/Person 在 final check 后改变、dirty Journal content/isDirty/disk 全不变、dirty prerequisite source。
- Alternatives：仅靠 extension serial queue 不能挡 CLI/外部写者；全局锁过重。复用 `ChangeSet.expected` 是最小方案。

### P1-5 — `UNKNOWN => 没写 Journal，可重新调用` 的声明在响应丢失后不可成立

- 证据：设计 116–118 把 UNKNOWN 与确定无副作用混为一类。`apply` 顺序执行异步 write/rollback（`mutation.ts:103-162`）；写入可能已经落地后 promise 才失败，rollback 也可能失败或状态不明。
- Concrete counterexample：fake Vault 在持久化 `next` 后抛出“response lost”，随后 rollback 也无法确认。调用方看到失败，但 Journal 已有 Interaction；按“user can invoke again”重试会追加重复 Interaction，改变 last-contact/reconnect 结果。
- Violated invariant：不确定执行状态不能声明“writes nothing”，也不能未经权威 reconciliation 建议重试。
- Minimal correct fix：区分 pre-effect index/read failure 与 post-write UNKNOWN。写异常后权威重读 Journal：等于 `before` 才可说未执行/可重试；等于完整 `after` 才可认定 postcondition；其他状态报告 UNKNOWN、保留现场、禁止重试建议。先用 whole-file before/after reconciliation，无需新增 operation ID。
- Affected surfaces/tests：core `apply`/`applied`、Log Interaction command reporting，以及所有复用该 mutation path 的错误文案；测试“write applied then throws”“rollback response lost”“并发第三态”，确保不重复。
- Deferral：只有 whole-file reconciliation 实测不足时才引入 durable idempotency token。

### P1-6 — Calendar authority identity 缺少 `calendarName`，Brief 冲突副作用可跨 Calendar 误用

- 证据：设计只复验 task/binding/People（设计 171–178），未把 configured calendar 纳入 receipt。现有 conflict key 为 `calendar:${uid}`，记录不含 calendar 名（`apple.ts:119-126`），resolve 时读取当前配置（`apple.ts:418-427`）。
- Concrete counterexample：Brief 开始从 Calendar A 读取 UID U，期间用户把配置改为 B；Markdown 未变，post-read checks 全通过，显示 A 的事实。若 A 返回 missing 并存成 conflict，之后 B 里恰有同 UID/同 summary，Resolve “Use Markdown” 可写 B 的事件；该 conflict 实际来自 A。
- Violated invariant：Calendar-owned事实与冲突的 authority key 必须是 sealed `(calendarName, uid)`；任何 stale post-read result 在 effect/output 前拒绝。
- Minimal correct fix：Brief 捕获 calendarName 并在 read 后复验配置未变。最简单方案是 Brief 对 missing/cancelled 只警告/审计，不写可操作 conflict registry，让正式 Sync 负责冲突；若必须复用 Resolve，则 conflict 必须存 calendarName、按 `(calendarName, uid)` key，并始终用保存的 calendarName 解决。持久化 conflict 前必须完成第二次 source/config 复验；persist UNKNOWN 不得宣称“saved for Resolve”。
- Affected surfaces/tests：Brief orchestration、SyncConflict schema/key、resolver、配置变更监听；fake read 期间切换 calendar/binding，断言无 brief、无 conflict side effect；resolve 前切 calendar，断言无外部写。
- Simplification：优先删除 Brief 的 conflict insertion；这是最小且保持 Brief read-only 的方案。

### P1-7 — “exact UID read” 接口会吞掉多匹配/取消状态，无法执行 ambiguous fail-closed

- 证据：AppleScript 明确遍历 `every event ... whose uid`（`calendar.ts:37-49`），`Calendar.read` 最终构造 `Map`，同 UID 多行会静默 last-wins（112–124）；`cancelled` 当前固定为 `false`。设计却声称 ambiguous/cancelled 都可安全处理（116、175–177）。
- Concrete counterexample：配置 Calendar 内出现两个 UID U 的事件（导入重复或 recurrence instance），时间/summary 不同；reader 把两个 record 压成一个，Brief 以未定义枚举顺序展示其中之一，而非拒绝。取消分支在现有 production reader 中不可达。
- Violated invariant：exact identity 必须是唯一匹配；外部状态无法确定时拒绝，不能任选一个。
- Minimal correct fix：exact-read seam 返回 `found | missing | ambiguous`（以及仅在桥能权威观测时返回 cancelled），按 UID 分组且要求 exactly one。若平台能证明该作用域 UID 唯一，应把保证写入契约并测试；否则 recurring/duplicate case 明确 defer/refuse。无法权威观测 cancellation 时删除 cancellation 声明，按 missing 处理。
- Affected surfaces/tests：`Calendar.read` seam、Brief、Calendar fake/real-host contract、sync callers；测试重复 UID、缺失字段、取消能力不可用。
- Reuse：在 bridge 边界增加一次计数即可，不需要事件模型或 attendee/recurrence 新功能。

### P2-1 — 400ms 测试条目未明确禁止时间睡眠作为正确性 oracle

- Concrete counterexample：测试固定 sleep 400ms 后读 store；慢 CI 上 touch 尚未完成会随机失败，或错误实现只“等 debounce”也能通过，却没有证明 command/provider显式等待 current index work。
- Violated invariant：正确性依赖同步 barrier 与 live `TextDocument`，不是 wall-clock。
- Minimal correct fix：将测试矩阵行改为“stale-index/live-buffer authority”；用 fake/barrier 控制 queued indexing，并在 command/provider 调用时断言其等待/刷新。400ms 只保留为无固定 sleep 的复现背景。
- Affected surfaces/tests：VS Code provider/command stale-index tests。
- Simplification：只改测试 oracle，无生产机制。

已确认设计中正确且应保留的部分：Markdown/Calendar/Foam authority 边界清晰；Provider 保持薄适配、core 复用 parsing/validation/metadata；拒绝 LSP/通用 LanguageService；每个 prompt/Calendar I/O 后复验方向正确；Brief 在所有 Person contexts 完整生成后才 open，明确禁止 partial output；Calendar read failure 不重试、Brief 不直接写 Calendar。
