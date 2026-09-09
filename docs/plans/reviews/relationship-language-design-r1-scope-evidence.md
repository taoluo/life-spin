# Relationship language design revision 1 — scope/evidence review

- Artifact: `docs/plans/2026-09-09-relationship-language-features.md`
- Artifact SHA-256: `0dd077f3afb0ce49e4fc3186696bbf1f527c870db46bfc9a9ae97c6f3746e2fa`
- Recovery ref: `refs/codex/recovery/relationship-language-design-r1-20260909`
- Recovery commit: `882412bb8d528fb47d70894ee0a6364cd3408b99`
- Reviewer scope: independent scope/evidence/testability review
- Model: GPT-5 (Codex)
- Reasoning effort: high
- Result: `NEEDS_REVISION` — no P0; 4 P1; 3 P2
- Capture status: durability copy of the completed report; no re-review performed

审查结论：`NEEDS_REVISION`。无 P0；4 个 P1、3 个 P2。冻结 artifact SHA-256 与 recovery ref/commit 均核验一致；审查未编辑文件，artifact 末次复核仍为 `0dd077…e2fa`。

## Findings

### F1 — P1：新 DefinitionProvider 未保留普通 `@` 文件名优先语义

- Concrete counterexample：同时存在 `Foam/Ordinary@anchor.md`，且 `Foam/Ordinary.md` 内有 `$anchor`。`[[Foam/Ordinary@anchor]]` 当前必须由 Foam 打开前者；若新 Provider 直接拆 `@` 后调用 `resolveRef`，会错误跳到后者的 anchor。
- Violated invariant：Foam 继续拥有普通 wikilink；LifeLoop 不得接管或错误重定向合法页面名。
- 证据：设计 [93–95、155–158] 未写 literal-page precedence；现有 `retrieval.ts:9–20, 33`、`docs/FOAM.md:47–50` 和 Foam 集成回归已明确该规则。
- Minimal correct fix：定义 special-ref eligibility：先精确检查完整 target 是否为现存普通页面；存在则返回 `undefined`，否则才解析 unambiguous base + `resolveRef`。复用现有 `resolveTarget/openSbRef` 判定，不建新解析层。
- Affected surfaces/tests：DefinitionProvider、临时结果 SB 导航、task-only 与 Foam host；保留 existing-`@` page、missing anchor、ambiguous basename、no-write 回归。
- Resolution mode：reuse + simplification。

### F2 — P1：live diagnostics 只定义数据来源，未定义即时发布生命周期

- Concrete counterexample：用户在 Person 页输入 `birthday: 02-31`，随后在 400 ms 内改正。当前 diagnostics 仅由 `lifeloop.onDidChange` 触发，而文本变更要等 debounce 后 `touch`；因此错误可能延迟出现或改正后继续残留。
- Violated invariant：设计 [138–151] 承诺 live-document、最小 token range 且独立于 debounced index。
- 证据：当前 `extension.ts:97, 104–111` 的发布仍跟随索引刷新；设计未给出 open/change/close 的 document-scoped 更新规则。
- Minimal correct fix：文本变更时立即仅重算该 document 的 relationship diagnostics；索引变化再处理跨文件 identity 影响。不要每次击键全库 reindex。
- Affected surfaces/tests：birthday/cadence、Interaction、query diagnostics 和 quick-fix availability；加入无需等待 400 ms 的出现、清除、CRLF/UTF-16 精确 range host 回归。
- Resolution mode：reuse existing collection；无需 DiagnosticProvider/LSP。

### F3 — P1：遗漏现有 `query` fence alias

- Concrete counterexample：现有 ```` ```query\ninteractions\n... ```` 仍会渲染、hover、CodeLens，但按设计文字“Inside `lifeloop` fenced blocks”实现后，不会获得 completion、diagnostics 或 `person:` definition。
- Violated invariant：保留现有可观察语义；同一已支持 grammar 不应只在部分 surface 生效。
- 证据：当前 `query-lens.ts:22` 与 `preview.ts:410` 明确同时支持 `lifeloop|query`；设计未退役 `query`，out-of-scope 也未列出。
- Minimal correct fix：明确所有新 language features 同时覆盖两个现有 fence alias；复用同一个 fence finder/parser，测试参数化两种 info string。
- Affected surfaces/tests：completion、diagnostics、definitions、semantic hover、diagnostic actions。
- Resolution mode：reuse；不增加新 grammar。

### F4 — P1：测试矩阵不是可执行的 red-green/evidence ledger，且弱化了 packaged gate

- Concrete counterexample：现有矩阵“query projection/argument/field/date/person”可以标绿，同时仍遗漏 F1 的 `@` 页面、F2 的 debounce、F3 的 `query` alias、duplicate event binding、untitled navigation 和 false-positive syntax。开发态 host 通过也不能证明最终 VSIX 中相同 manifest/bundle 可用。
- Violated invariant：每个 P0–P2 行为必须有可证伪 RED、修复后 GREEN 和明确环境/skip disposition；上游 data-surfaces [478–486] 要求 packaged task-only/Foam qualification。
- Minimal correct fix：用一张紧凑表补全“feature/counterexample → exact test file/case → pre-fix RED → required gate”。复用现有 Vitest、`test:integration`、`test:foam`、`LIFELOOP_TEST_EXTENSION_PATH` 和 `PACKAGE-EVIDENCE.json`：
  - task-only host 必跑并断言 Foam 缺席；
  - Foam 0.44.6 host 覆盖普通 ownership、`@` 页面和 untitled Person link；
  - exact-UID Calendar fake 必跑；
  - real Apple 只读检查可 SKIP，但必须记录为未覆盖，且不得写个人 Calendar；
  - 最终 VSIX 重跑 packaged task-only/Foam 并绑定 artifact SHA。
- Affected surfaces/tests：全部 P0–P2、package manifest/bundle、Apple/Foam evidence。
- Resolution mode：reuse existing harness；无需新框架或新环境系统。

### F5 — P2：temporary-output navigation 缺少精确 presentation contract

- Concrete counterexample：
  1. 当前临时文档是 `untitled:`，LifeLoop 共用 selector 却是 `{scheme:"file"}`；special-ref DefinitionProvider 若沿用它不会运行。
  2. 当前 `toMarkdown` 同时服务 untrusted hover 和 full output，且只输出普通 scalar；若直接全局改成 wikilink，会把 hover 也改掉并模糊 row-parity，若不改则临时导航不存在。
- Violated invariant：P2 临时导航可用、hover 仍 untrusted、core/CLI row values 不被 presentation markup 污染。
- Minimal correct fix：明确只在 full temporary output 做 presentation-only 映射：
  - canonical Person → ordinary escaped wikilink；
  - source `ref` → SB special wikilink；
  - raw projection rows保持不变；
  - LifeLoop special DefinitionProvider selector显式含 `file` 与 `untitled`。
  Brief 同样规定 exact heading/context link 格式。无需 Webview/cache。
- Affected surfaces/tests：`openQueryResult`、brief renderer、DefinitionProvider、Foam coexistence、row parity；真实 host 对两个 untitled 输出执行 definition，并断言 hover 无 command/trusted link。
- Resolution mode：small formatter + native untitled document；不新增 renderer。

### F6 — P2：completion 暴露的 `kind`/`limit` 没有对应严格诊断

- Concrete counterexample：`interactions\nkind: phone` 静默返回空；`limit: -1` 使用 `slice(0,-1)` 意外丢最后一行；`limit: nope` 转为 `NaN` 后结果含义异常。设计 completion 却只提供固定 kinds 与 `limit`。
- Violated invariant：completion、parser、diagnostics 使用同一 contract；无结果不能掩盖拼写/类型错误。
- Minimal correct fix：在现有静态 metadata 中加入 `interactions.kind ∈ INTERACTION_KINDS` 与 `limit` 非负整数验证，指向 value token；不提供推断式 quick fix。
- Affected surfaces/tests：query diagnostics、completion、preview/hover/CodeLens/full result；加入上述三个 RED cases。
- Resolution mode：reuse `INTERACTION_KINDS` 和现有 parser；不建 schema engine。

### F7 — P2：400 ms freshness 规则在正文和矩阵之间范围冲突

- Concrete counterexample：正文 [105–107] 仅要求 index-dependent task actions refresh；矩阵 [252] 却写“provider/command refreshes before decision”。实现者可能因此每次 completion/hover 都全库 reindex，或反向让 exact Person definition 使用未核验的 stale identity。
- Violated invariant：只在 effect/eligibility 前付出强 freshness 成本；只读 provider 不应扩大同步或复杂度。
- Minimal correct fix：明确分级：
  - task eligibility、task commands、brief pre/post Calendar 必须 serialize + live reindex；
  - completion/hover 使用 settled index + live current document；
  - exact definition 在返回目标前用 live vault 精确核验；
  - UNKNOWN 返回空/undefined，索引变化后自然刷新。
- Affected surfaces/tests：所有 providers、workspace indexing、400 ms regression；测试只读 provider 不触发全库 reindex，definition 不返回已消失目标。
- Resolution mode：clarification + reuse；避免锁、缓存和新协调层。

## 已确认覆盖良好的部分

- 明确 only VS Code、拒绝 LSP/generic LanguageService。
- Foam 与 Calendar ownership 总体边界正确；无 attendee/title inference 或 Calendar write。
- P0–P2 功能清单、fail-closed brief/logging、command-backed actions 与 deterministic quick-fix 边界基本完整。
- 明确不做项充分，符合 YAGNI；静态 metadata + direct providers 是最小路线。
- 交付顺序先修 shared freshness/guard，再加 providers，最后 parity/package review，依赖方向合理。

工作树末次只读检查时额外出现了并发产生的 `?? node_modules`；本审查没有创建或修改文件。
