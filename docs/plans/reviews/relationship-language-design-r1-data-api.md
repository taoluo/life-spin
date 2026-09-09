# Relationship language design revision 1 — data/API/editor correctness review

Status: completed independent review; durability capture only.

- Frozen artifact: `docs/plans/2026-09-09-relationship-language-features.md`
- Frozen SHA-256: `0dd077f3afb0ce49e4fc3186696bbf1f527c870db46bfc9a9ae97c6f3746e2fa`
- Recovery ref: `refs/codex/recovery/relationship-language-design-r1-20260909`
- Recovery commit: `882412bb8d528fb47d70894ee0a6364cd3408b99`
- Reviewer task: `/root/design_data_api`
- Model: inherited parent model; exact runtime model identifier was not exposed to the reviewer
- Reasoning effort: high, per the critical-review assignment policy
- Result: NOT CLEAN — no P0; six P1 and one P2 findings

The following report body is the exact completed report returned by the reviewer.

---

冻结 revision 1 审查完成。Digest 与 recovery ref 均匹配；未编辑文件。

结论：未发现 P0；发现 6 个 P1、1 个 P2。不能标记 CLEAN。

### F1 — P1：projection 参数契约无法同时满足严格校验与现有 consumer parity

- 反例：
  - `runProjection(store, "people", { person: "Missing" })` 当前静默忽略非法参数。
  - `interactions` 对不存在的 `person`、非法 `from/to`、`from > to` 只返回空数组，无法区分合法空结果和无效请求。
  - 若按设计在 `runProjection` 严格拒绝非法参数，CLI 当前给每个 projection 都注入 `date/days/project/page`，Lua 也给每个 projection 注入 `date`，于是合法 `people`、`interactions`、`person-context` 调用反而会失败。
  - CLI 的 `--limit` 对 named projection 当前完全不生效，而 query block 会 slice，已经不 parity。
- 违反：
  - core 是唯一参数语义权威；
  - 1.1.0 的 projection 意义稳定；
  - core/preview/hover/CodeLens/baking/CLI 过滤一致。
- 最小修复：
  - 在现有 `projections` 表增加每个 projection 的 allowed/required args 与 fields；
  - 由一个 core validator 在 `runProjection` 前校验日期、Person、kind 和区间；
  - CLI/Lua 只传显式且属于该 projection 的参数，默认值留在 projection 自身；
  - 明确定义并统一 `limit`，同时校验非负整数。
- 影响面/测试：
  - [contract.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/semantic-core/src/contract.ts:37)
  - [main.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/cli/src/main.ts:50)
  - [host.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/semantic-core/src/lua/host.ts:333)
  - [preview.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/vscode/src/preview.ts:51)
  - 增加非法/缺失/reversed 参数及相同 snapshot 的 CLI、Lua/bake、query block parity 测试。
- 简化路径：复用 `projections` 和 `runProjection`；不需要 schema/DSL engine。

### F2 — P1：1.1.0 的四个公开 row schema 未完整冻结，且当前泄漏内部 offset

- 反例：
  - 基线 `InteractionRow` 没有 `offset`，当前 `interactionRows()` 却直接返回内部 `Interaction[]`，公开 `offset`。
  - `person-context.recentInteractions` 也包含内部 `offset`。
  - `fields: offset` 当前可显示；若后续按“known fields”移除，会成为设计自己定义的 breaking change。
  - `ReconnectRow`、`PersonContextRow` 的字段、嵌套类型、null/undefined 规则和排序没有在 revision 1 中冻结，completion/diagnostics 无法可靠发现字段。
- 违反：
  - public rows 是稳定、normalized contract；
  - removing/changing a field requires major bump；
  - known-field discovery 必须来自 core。
- 最小修复：
  - 在设计中明确四个 projection 的完整公开 row 类型、字段顺序无关性、nullability、嵌套形状和排序；
  - `interactionRows` 显式映射到无内部 `offset` 的公开行；
  - `recentInteractions` 使用同一公开 `InteractionRow`。
- 影响面/测试：
  - [relationships.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/semantic-core/src/relationships.ts:6)
  - [relationships.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/semantic-core/src/relationships.ts:201)
  - exact-key snapshots 覆盖 core、CLI JSON、Lua、query `fields:`。
- 简化路径：删除内部字段泄漏并复用现有 row mapping；无需 runtime schema。

### F3 — P1：诊断/hover 所需的分类理由没有共享 core API，现有计数语义已矛盾

- 反例：
  - `[interaction: video]` 当前会进入 Interaction、last-contact 和 reconnect 计算；mutation 却只接受四个 `INTERACTION_KINDS`。Provider 若按设计诊断“unsupported”，将与 projection 的“仍然计数”矛盾。
  - `birthday`、`cadence`、`pageDate` 都是私有且只返回值/undefined，无法区分 absent 与 malformed；Provider 为精确诊断只能复制规则。
  - 极长 `contact-every: 999…d` 可成为 `Infinity`，随后 `shift()` 抛 `RangeError`，而不是被诊断并忽略。
- 违反：
  - strict relationship semantics 由 core 唯一拥有；
  - hover、diagnostic、symbols 和 projection 对“是否计数/为何排除”一致；
  - malformed data fail closed。
- 最小修复：
  - 明确 unsupported kind 是否计数；推荐不计数，与 mutation/completion 一致；
  - 暴露最小纯 validator/classifier，返回 normalized value 或稳定 reason code；
  - projection 与 Provider 都调用它，Provider 自己只负责 live token/range。
- 影响面/测试：
  - [relationships.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/semantic-core/src/relationships.ts:61)
  - [relationships.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/semantic-core/src/relationships.ts:125)
  - unsupported/empty kind、invalid Journal date、missing exact Person、quoted/scalar cadence、overflow cadence。
- 简化路径：复用一个 classifier；删除各 Provider 的重复语义判断。

### F4 — P1：没有规定一个带位置的共享 query parser，现有 fence/runtime 会漂移

- 反例：
  - Markdown preview 能接收四反引号或 tilde fenced block，但当前 `findQueryFences` 只认恰好三个反引号。
  - 四反引号 block 内合法出现的三反引号会被当前 scanner 提前当作 closing fence。
  - `parseQueryBlock` 会 trim/filter blank lines并丢失所有 token offsets；精确 completion/diagnostic 只能另写第二套 parser。
- 违反：
  - query parser/runtime/provider parity；
  - live TextDocument 最小 token range；
  - 不增加第二 grammar。
- 最小修复：
  - 定义一个 located query-block parse result，保留 projection/key/value/field 的 live offsets；
  - completion、diagnostics、preview、hover、CodeLens 共用；
  - fence 边界复用 vendored Markdown parser，或至少完整记录 opening marker 字符和长度。
- 影响面/测试：
  - [query-lens.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/vscode/src/query-lens.ts:22)
  - [preview.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/vscode/src/preview.ts:39)
  - 三/四反引号、tilde、内部短 fence、CRLF、emoji/UTF-16、空行和重复 key。
- 简化路径：复用现有 Markdown parser；不要新增通用 LanguageService。

### F5 — P1：Interaction source ref 的坐标系未定义，CRLF 导航会落错位置

- 反例：
  - `InteractionRow.ref` 来自 upstream parser 的 CR-stripped offset。
  - `resolveRef` 对 numeric ref 按原始 live-source offset解释，只对 anchor parser offset做 CRLF translation。
  - 因此 CRLF Journal 中 query row 的 `Journal/date@N` 若直接渲染成 SB ref，会按累计 `\r` 数量落偏；但全局修改 `resolveRef` 又会破坏用户手写的 raw `[[Page@9]]`。
- 违反：
  - source ref 是精确身份；
  - CRLF/UTF-16 definition 和 temporary-result navigation 精确；
  - 不得双重转换 raw cursor ref。
- 最小修复：
  - 明确 public source-ref 坐标系；
  - 推荐在生成 navigation markup 时，用该行所属的已验证 source body 对 indexed numeric ref 做一次 `originalSourceOffset`，不改变用户手写 numeric ref 的含义；
  - 或让公开 row 从一开始携带 original-coordinate ref。
- 影响面/测试：
  - [relationships.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/semantic-core/src/relationships.ts:137)
  - [mutation.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/semantic-core/src/mutation.ts:193)
  - 多个 CRLF、astral UTF-16 字符、anchor/numeric ref、query result definition。
- 简化路径：复用 `originalSourceOffset`；不要改变 `resolveRef` 的所有 numeric refs。

### F6 — P1：设计承诺 cancelled-event refusal，但生产 Calendar 永远报告 `cancelled: false`

- 反例：
  - 一个取消但仍可由 UID 读取的邀请会被 `Calendar.read` 返回为 `cancelled: false`，brief 将照常打开。
  - fake 可以制造 cancelled event，但无法证明生产行为。
- 违反：
  - Calendar 是 event facts 的外部权威；
  - cancelled event 不得生成看似有效的 brief；
  - fake 与 production seam 语义一致。
- 最小修复：
  - Ponytail 最小方案：删除本轮 cancelled detection 的承诺，明确只能权威检测 missing；
  - 若 cancelled 必须保留，则 bridge 必须读取可靠 cancellation/status 字段；无法读取时标记 UNKNOWN 并拒绝，而非 false。
- 影响面/测试：
  - [calendar.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/apple-bridge/src/calendar.ts:112)
  - [apple.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/vscode/src/apple.ts:213)
  - exact-UID fake、cancelled/missing/throwing reader；真实 host 只能对实际可观察字段给 PASS。
- 简化路径：删除未受 production API 支持的 cancelled claim，最符合当前边界。

### F7 — P2：temporary Person wikilinks 在 untitled document 中没有已证明的 owner

- 反例：
  - full result/brief 由 `openTextDocument({content})` 创建 untitled Markdown。
  - LifeLoop 当前 Markdown providers 只注册 `scheme: "file"`，设计又禁止其接管 ordinary wikilinks。
  - 若 Foam 不为 untitled documents 提供 definition，`[[People/Alice]]` 会显示但不能导航。
- 违反：
  - temporary-result navigation 必须真实可用；
  - ordinary source wikilink 仍由 Foam 所有。
- 最小修复：
  - 先用 pinned Foam real-host test 证明 untitled wikilink navigation；
  - 若失败，temporary outputs 例外地使用标准 Markdown file-URI links；LifeLoop 仍不接管普通 source wikilinks。
- 影响面/测试：
  - [query-lens.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/vscode/src/query-lens.ts:123)
  - [extension.ts](/Users/tao/.codex/worktrees/b49a/silverbullet-lifeloop/packages/vscode/src/extension.ts:58)
  - 实际打开 full result/brief 后验证 Person 与 SB source navigation，分别跑 task-only 和 pinned Foam。
- 简化/延期：若不采用标准 Markdown URI，可明确 defer temporary Person navigation；不能仅凭显示出 wikilink 就报 PASS。

---

## Post-report source-evidence correction

This correction was supplied after the completed report and does not represent a new review round:

- Custom non-empty Interaction kinds are valid and counted. `INTERACTION_KINDS` constrains UI completion/mutation choices only; providers must not diagnose a custom non-empty kind as unsupported. Only an empty kind is uncounted. Accordingly, F3's recommendation to exclude unsupported/custom kinds is superseded; its shared core classifier/validator concern remains.
- Diagnostic severity is semantic: ignored optional metadata or an uncounted Interaction uses Information/Hint rather than Warning/Error.
- Completion is limited to `findQueryFences` body/value context.
- Providers remain thin adapters; core owns parsing, validation, and metadata.
