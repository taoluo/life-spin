# Relationship language design revision 2 — authority/race closure review

- Artifact: `docs/plans/2026-09-09-relationship-language-features.md`
- Artifact SHA-256: `9d9d168b84cdf9d948e76bd6dee8c1b67ee2a5af1cd1601f64e32b7243068c9c`
- Recovery ref: `refs/codex/recovery/relationship-language-design-r2-20260909`
- Recovery commit: `70b0ba6e0a05b8833b1028b4d37736d22c36fe0a`
- Reviewer scope: revision-2 closure review of every prior authority/race counterexample plus dependency closure
- Model: GPT-5 (Codex)
- Reasoning effort: xhigh
- Result: `NOT CLEAN` — no P0; 3 P1; no P2
- Capture status: full persisted closure report; frozen artifact was not edited

## Conclusion

`NOT CLEAN`。Revision 2 正面关闭了 revision 1 的原始 numeric-ref、runtime guard、live-buffer freshness、prompt/Journal、write-response-loss、Brief Calendar scope、exact UID Brief read 和 fixed-sleep counterexamples。依赖闭包仍有三个 P1：numeric task identity 的 CRLF 坐标规则互相冲突；正式 Calendar Sync/Resolve 没有明确继承 sealed calendar identity 与 unique-match 规则；Brief 可以在第一次 fresh eligibility validation 之前调用会启动应用的 `requireApp`。

审查全程使用冻结 recovery ref，工作副本摘要也在审查前后核验为同一 SHA-256。发现 P1 后继续完成了全部 scope。

## Prior-finding closure

| Prior finding | Disposition | Closure evidence |
|---|---|---|
| P1-1 numeric ref containing-line retarget | Original counterexample closed; dependency finding F1 remains | Lines 126–132 require exact current task ref/line start and R10 replays the moved-line case. Lines 172–175 introduce a contradictory CRLF coordinate rule. |
| P1-2 compile-time-only GuardedSourceHandle | Closed | Lines 126–129 require runtime validation of all three strings through the single `taskTarget` admission path; R11 covers missing receipts, wrong types, and stale presentation offsets. |
| P1-3 stale index outranks live Providers | Closed | Lines 134–143 split lexical/live work from generation-certified derived semantics; lines 191–193 require immediate lexical diagnostics; R7/R8 use the correct authority boundary. |
| P1-4 prompt revalidation not sealed into Journal write / dirty Journal | Closed as designed | Lines 221–231 revalidate after every prompt, include task/Person/Journal before-values in one existing `ChangeSet.expected`, and refuse dirty Journal without saving it. Dirty task/Person buffers are explicitly accepted as live read authority and never implicitly saved. R12/R13 cover the boundary. |
| P1-5 UNKNOWN write response loss invites duplicate retry | Closed | Lines 161–166 distinguish before, durable-after, partial rollback, and third/unknown states and prohibit unsafe retry advice; R14 covers before-throw, applied-then-throw, and third state. |
| P1-6 Calendar name/config and Brief conflict side effects | Brief counterexample closed; dependency finding F2 remains for formal Sync/Resolve | Lines 235–243 seal/revalidate `calendarName` and remove Brief conflict persistence. The new statement that formal Sync alone owns conflict persistence leaves its authority tuple unspecified. |
| P1-7 exact UID last-wins / invented cancellation | Brief counterexample closed; dependency finding F2 remains for mutation-bearing Calendar consumers | Lines 108–113 define `found/missing/ambiguous` and remove the cancellation claim; R16 covers Brief. Formal Sync, Resolve, and `updateSummary` are not explicitly included. |
| P2-1 fixed 400 ms sleep as correctness oracle | Closed | Lines 145–146 make debounce non-authoritative; lines 321 and 334–336 require controllable promise barriers and forbid fixed sleeps. |

## Remaining findings

### F1 — P1: numeric task identity has an impossible CRLF coordinate contract

- Evidence: lines 126–132 require a numeric handle both to equal the current indexed canonical task ref and to point at the live task line start. Lines 172–175 say CR-stripped parser offsets used for indexed task identity are compared in that coordinate system and reserve `originalSourceOffset` translation only for presentation-time Interaction source links. Existing indexing stores parser coordinates with CR removed, while `resolveRef` interprets numeric refs as live string offsets; current `taskNode` therefore translates an indexed task offset before creating an actionable handle (`views.ts:43–71`).
- Concrete counterexample: source is `head\r\n* [ ] task\r\n`. The parser/index coordinate for the second line is one byte lower than the live `TextDocument` line start because the preceding `\r` was removed. If the handle keeps the canonical indexed offset, `resolveRef` lands before the live task line and its receipt fails. If it carries the live line-start offset, it no longer equals the raw indexed canonical ref. The implementation cannot satisfy both revision-2 requirements, so a valid CRLF task action must either refuse or relax identity comparison.
- Violated invariant: numeric `ref` must remain exact identity, while CRLF translation must occur exactly once and must not make valid tasks unactionable or permit containing-line retargeting.
- Minimal correct fix: define task-command handles in live-source coordinates, as existing mutation resolution already expects. Compare a numeric handle with the current indexed task ref only after normalizing that indexed ref exactly once through the indexed/live source text, and still require the handle offset to equal the live task line start. Amend the “only presentation-time source links” sentence to include this task-handle normalization. Do not add a second ref field or a new identity store.
- Affected surfaces/tests: `taskNode`, cursor/code-action handle construction, `taskTarget`, `resolveHandle`, every task mutation, Log Interaction, Brief, and CRLF navigation. Extend R10/R11 with: an unchanged numeric task after an earlier CRLF is actionable; moving it so the old live offset lands inside the same line refuses; a unique anchored task after CRLF may move and still resolves; no offset is double-translated.
- Resolution mode: reuse plus clarification. The existing `originalSourceOffset` and one normalized equality are sufficient; a dual-coordinate handle is unnecessary.

### F2 — P1: formal Calendar Sync/Resolve is named the sole conflict owner without inheriting sealed calendar identity or unique-match semantics

- Evidence: lines 108–113 define a narrow exact reader for Brief, and lines 235–243 remove Brief conflict writes in favor of formal Calendar Sync. The design never states that mutation-bearing `syncCalendar`, conflict resolution, and `updateSummary` must consume the same per-UID `found/missing/ambiguous` result or preserve `calendarName` in conflict identity. Existing `syncCalendar` bulk-reads into a `Map` and then may write Markdown or Calendar (`calendar-sync.ts:25–103`); `resolveCalendarConflict` reads again and can update Calendar (`calendar-sync.ts:106–139`). Existing persisted conflicts are keyed only by `calendar:${uid}` and resolution supplies the current configured calendar (`apple.ts:119–125`, `apple.ts:418–427`). The AppleScript update path selects `item 1` when multiple UID matches exist (`calendar.ts:70–83`).
- Concrete counterexamples:
  1. Formal Sync in Calendar A records a conflict for UID U. Before resolution the user changes configuration to Calendar B, which also contains UID U with the same expected summary. Because the conflict does not seal A, “Use Markdown” can update B even though the observation/conflict came from A.
  2. Two records with UID U exist in one configured calendar. Bulk read collapses them last-wins, while `updateSummary` selects the first match. Sync can compare one event and mutate another; even a unique Brief reader does not protect this path.
- Violated invariant: every external Calendar effect must retain one sealed authority tuple `(calendarName, uid)` and prove exactly one matching event immediately before the write. Ambiguous or changed authority must refuse closed, and a read-only Brief must not merely redirect the user to an unsafe conflict workflow.
- Minimal correct fix: propagate the existing exact-read tri-state to every Calendar consumer that can mutate Markdown or Calendar. Batch reading may remain one script, but records must be grouped per requested UID and ambiguity retained. Persist `calendarName` in each Calendar conflict, key it with UID, and resolve only against the stored calendar; a configuration mismatch refuses. `updateSummary` must return an ambiguous/conflict result unless the UID match count is exactly one immediately before update. Brief remains conflict-free.
- Affected surfaces/tests: Calendar bridge read/update result types, `syncCalendar`, `resolveCalendarConflict`, workspace conflict persistence/keying, observation scoping, and related fakes. Add deterministic tests for duplicate UID causing no Markdown pull and no Calendar push, config switch between conflict creation/resolution causing no effect, and a unique event preserving current behavior. Extend R16 or add an adjacent formal-Sync gate; the current Brief-only assertion is insufficient.
- Resolution mode: reuse. Extend the new exact-reader result and existing conflict record; do not add a new synchronization subsystem, journal, or Calendar model.

### F3 — P1: Brief can cross the first external capability boundary before fresh eligibility is established

- Evidence: level three says authority-sensitive commands explicitly refresh (`lines 134–143`), but the Brief sequence says the command seals inputs, calls `requireApp`, and only then refreshes/validates (`lines 235–239`). The general boundary rule lists prompts and Calendar reads, not `requireApp` (`lines 145–154`). Production `requireApp` calls external process state and may launch Calendar (`apple.ts:100–110`). A previously rendered action can be stale when invoked; `taskTarget` can validate the task line, but without a fresh semantic snapshot it cannot prove a separately edited Person page still has Person identity.
- Concrete counterexample: a Brief code action is exposed while task T directly links Person P. Before click, P's dirty live buffer removes `tags: person`; T's guarded line and event binding remain byte-identical. The stale action passes task-line receipts, then `requireApp` can launch Calendar. Only the post-`requireApp` refresh discovers that P is no longer a Person and refuses. An ineligible operation has already crossed the external capability boundary.
- Violated invariant: eligibility and authority must be proven before the first external effect/access, and then revalidated after any blocking external call. A stale action must not launch or access Calendar merely to discover that it is no longer eligible.
- Minimal correct fix: perform level-three refresh plus full handle/binding/direct-People/Person/calendar validation before `requireApp`; repeat it after `requireApp`, because that call can block or prompt/launch; then exact-read, followed by the existing post-read validation. This is only a reorder/reuse of the existing validation function.
- Affected surfaces/tests: Brief command orchestration, capability fake, stale code actions, and R15. Add a case where Person identity or binding is removed before command invocation and assert `appAvailable`/launch and Calendar reader are never called; keep the existing mutation-after-app-check and mutation-during-read cases.
- Resolution mode: simplification/reuse. No lock, generation layer, or new state is needed; call the same validator before and after the boundary.

## Dependency-closure checks that remain satisfied

- Dirty task/Person buffers are explicitly live read authority; because the final ChangeSet guards their exact contents and never writes/saves them, no hidden save side effect is introduced. Dirty Journal remains a hard write conflict.
- Whole-file reconciliation is bounded, has one existing serial rollback at most, preserves third/unknown evidence, and does not introduce takeover, automatic retry, or recovery-of-recovery machinery.
- Brief computes all Person contexts only after final validation and opens exactly one fully rendered untitled document; missing/ambiguous/read failure opens nothing and writes no Brief conflict state.
- Fixed lexical Provider work stays on supplied `TextDocument`; index-dependent results fail closed until a generation-matched snapshot settles. The 400 ms value is not a correctness wait.
- Runtime guard validation is centralized in `taskTarget`; stale presentation page/offset cannot bypass `ref` resolution. Anchor uniqueness remains separate from numeric exact-position semantics.
- Provider architecture remains thin and reuses core parsing/validation/metadata; no LSP, generic LanguageService, operation journal, or external ownership expansion is introduced.
