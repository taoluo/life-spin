# Relationship language design revision 3 — authority/race closure review

- Artifact: `docs/plans/2026-09-09-relationship-language-features.md`
- Artifact SHA-256: `8e08bcefd171dace55c2fc545bf7abe57f9c88040d398fa4b6c3523597fafd21`
- Recovery ref: `refs/codex/recovery/relationship-language-design-r3-20260909`
- Recovery commit: `bb48f3abae76cb78a79dfb2956eeb9b7078a0555`
- Reviewer scope: final revision-3 authority/race closure review of every prior counterexample and its dependency closure
- Model: GPT-5 (Codex)
- Reasoning effort: xhigh
- Result: `CLEAN` — no P0; no in-scope P1; no P2; one accepted P1 Calendar debt remains explicitly outside this design
- Capture status: full persisted closure report; the frozen artifact was not edited

## Conclusion

`CLEAN`. Revision 3 closes every in-scope authority/race finding from revisions 1 and 2. Numeric task identity now has one satisfiable live-coordinate contract; runtime receipts and live-buffer authority remain fail-closed; prompt-time facts are protected by the final optimistic write; write-response loss cannot invite an unsafe retry; and Brief proves eligibility before `requireApp`, revalidates after that capability call and after its exact Calendar read, and produces no partial or persistent side effect on refusal.

The accepted formal Calendar Sync/Resolve defect is not declared safe. It remains a P1 debt in existing mutation-bearing behavior. Revision 3 cleanly excludes it by requiring a new additive exact reader used only by Brief, forbidding Brief from invoking or recommending Sync/Resolve or writing conflict/observation state, and making any change to the shared Sync/Resolve read/update behavior a blocking scope re-entry. `CLEAN` therefore applies to this frozen design and its stated Brief/language scope, not to the existing formal Calendar mutation subsystem or to the current pre-implementation source.

The working copy and the recovery-ref copy were both read and verified as SHA-256 `8e08bcefd171dace55c2fc545bf7abe57f9c88040d398fa4b6c3523597fafd21` before review and again immediately before this report was written. The artifact was not changed during the review.

## Revision-1 finding replay

| Prior finding | Disposition | Counterexample replay and closure evidence |
|---|---|---|
| P1-1 — numeric ref containing-line retarget | Closed | Lines 131–140 define task-command handles in live-source coordinates, normalize a fresh indexed/parser numeric ref exactly once through `originalSourceOffset`, require exact handle equality and exact live line-start equality, and keep unique anchors as the only movable identity. Deleting a prefix so the old offset lands inside the unchanged task line therefore fails normalized identity/line-start admission. R10/R11 exercise the valid CRLF, containing-line retarget, moved-anchor, and no-double-conversion cases. |
| P1-2 — compile-time-only `GuardedSourceHandle` | Closed | Lines 131–134 require `ref`, `expectedText`, and `expectedState` to be valid runtime strings and make `taskTarget` the single admission path for every supplied handle, including an input carrying stale page/offset hints. R11 rejects missing receipts, wrong runtime types, and stale presentation hints with no write. |
| P1-3 — stale index outranks live Providers | Closed | Lines 142–151 separate live lexical reads from generation-matched derived semantics. Fixed lexical work reads the supplied `TextDocument`; stale index-dependent identity results are postponed or omitted; exact Person definition revalidates through the live-buffer-aware vault. R7/R8 use controlled freshness boundaries and preserve live-buffer authority. |
| P1-4 — prompt checks not sealed into the Journal write / dirty Journal | Closed | Lines 153–167 require level-three refresh after every actual prompt result before an effect. Lines 229–241 apply that rule to every task-originated Quick Pick/InputBox, recompute binding/direct People/Person identities, require the selected People to remain a non-empty subset, and include task source, every selected Person page, and Journal before-values in one `ChangeSet.expected`. Dirty task/Person buffers are read authority and are not saved; a dirty Journal refuses without write or save. R12/R13 cover every prompt boundary, the final task/Person race, and byte-identical dirty-Journal refusal. |
| P1-5 — response loss reported as safe retry | Closed | Lines 169–174 require bounded authoritative whole-file reconciliation: all-before is not applied, all-after plus durable save is success, one provable partial state may use the existing single serial rollback, and unreadable/third/rollback-uncertain state stays `UNKNOWN` with evidence preserved and no automatic retry advice. R14 covers before-throw, applied-then-throw, and third-state failures. |
| P1-6 — Brief lacks sealed calendar identity and can create cross-calendar conflict state | Closed in Brief scope | Lines 153–162 and 243–255 seal and compare `calendarName` with handle, UID, and direct People before/after each Brief capability boundary. Brief writes no Markdown, Calendar, conflict, or observation state. Formal Sync/Resolve debt is separately retained below. R15/R16 require changed configuration to open nothing and all Brief failures to persist no conflict state. |
| P1-7 — exact UID read collapses duplicates and invents cancellation | Closed in Brief scope | Lines 106–118 require an additive Brief-only `found | missing | ambiguous` exact reader, forbid duplicate last-wins selection, and make no cancellation claim. Lines 250–255 accept only a unique `found`; missing, ambiguous, and reader failure open nothing. R16 proves duplicate/missing/throwing behavior and the one-UID request. Formal mutation consumers remain uncertified debt. |
| P2-1 — fixed 400 ms sleep as correctness oracle | Closed | Lines 153–154 call the debounce an optimization only; lines 333 and 346–348 require controllable promise barriers and explicitly forbid fixed sleeps. R7/R8/R15 cover the relevant freshness boundaries. |

## Revision-2 finding and adjudication replay

### F1 / C1 — CRLF coordinate contract

Closed. The revision-2 contradiction between raw parser coordinates and live task line offsets is gone. Lines 135–140 select live coordinates for actionable handles, translate only the fresh indexed/parser numeric ref once before comparison, and never translate a cursor-created handle. Lines 182–186 distinguish that task normalization from the separate one-time conversion used for indexed Interaction presentation links and retain live meaning for handwritten numeric SB refs. The valid `head\r\n* [ ] task` case is actionable, while a moved task whose old numeric offset merely falls inside its line refuses. R10/R11 explicitly prevent both omission and double application of the conversion.

### F2 — formal Calendar Sync/Resolve authority

The counterexamples remain valid but are explicitly deferred, exactly as the revision-2 adjudication required. Current source demonstrates the debt: `Calendar.read` collapses records into a UID-keyed `Map` (`packages/apple-bridge/src/calendar.ts:112–124`); `updateSummary` chooses `item 1` without a uniqueness check (`calendar.ts:70–83`); `syncCalendar` and `resolveCalendarConflict` consume those shared methods (`calendar-sync.ts:25–139`); and the VS Code conflict registry keys Calendar conflicts by UID while resolution supplies the current configured calendar (`packages/vscode/src/apple.ts:119–125, 295–310, 418–427`). Thus neither duplicate-safe mutation nor sealed conflict calendar identity is certified.

Revision 3 no longer implies otherwise. Lines 108–118 require the Brief reader to be additive and narrow, state that existing mutation-bearing Sync/Resolve remains unchanged and uncertified, record the exact follow-up debt, and make a shared read/update API or behavior change blocking before merge. Lines 243–255 make Brief independent: it neither calls nor recommends Sync/Resolve and persists neither conflict nor observation state. Existing standalone Sync/Resolve commands may remain independently reachable; “unreachable from Brief” does not mean removing those existing commands. There is no new recovery edge from a Brief failure into the unsafe mutation path.

### F3 / C4 — first Brief validation occurs after `requireApp`

Closed. One validator performs level-three refresh and verifies the complete authority tuple. Lines 245–251 order it before the first capability call, after `requireApp`, and after the exact Calendar read, with exact tuple equality at both later checks. The stale-action case where a dirty Person buffer removes `tags: person` or the task loses its binding before invocation now refuses before application availability/launch or reader access. R15 asserts zero app and reader calls for pre-invocation ineligibility and retains the post-app and during-read mutation cases.

## Dependency-closure review

### Runtime admission, task identity, and live authority

- Every task command receives a guarded handle and all supplied handles go through one `taskTarget` admission path; presentation page/offset fields cannot bypass resolution (lines 101–104, 131–140, 266–272).
- Numeric identity is exact after one indexed-to-live conversion. Cursor handles and raw numeric SB refs are already live; anchors can relocate only while unique and while their receipts still match (lines 135–140, 182–186).
- Pure lexical Providers consume current document text. Derived identity never lets a stale index outrank a dirty buffer, and authority-sensitive commands serialize behind current index work (lines 142–151, 199–218).

### Prompt, Journal, and write terminal states

- The general post-prompt rule and the specific Log flow cover the action selection and every subsequent People/kind/note prompt. Cancellation has no effect; every actual result is followed by refresh before continuing to an effect (lines 153–167, 229–241).
- Task-originated Log keeps its original guarded source and event default, recomputes direct People, and binds task/Person/Journal exact contents into the final existing `ChangeSet.expected`. No new lock, journal, authority store, or takeover mechanism is introduced (lines 229–241).
- Dirty task and Person buffers are authoritative reads and remain unsaved. Dirty Journal is a write-target conflict whose content, dirty state, and save state remain untouched. Final source or Person races refuse before the Journal append (lines 164–167, 238–241; R12/R13).
- Write failures have deterministic reconciled terminal classes. `UNKNOWN` remains terminal and non-retriable absent later authoritative evidence; only the existing one serial rollback is allowed for a proven partial before/after state (lines 169–174; R14).

### Brief capability and output boundary

- The first validator establishes eligibility before `requireApp`; the same validator and sealed `{handle, uid, calendarName, directPeople}` tuple are reused after `requireApp` and after the exact read (lines 243–251).
- Exactly one event binding and one named calendar are requested. Duplicate, missing, throwing, or changed authority fails closed. The exact reader cannot be implemented by taking `.get(uid)` from the existing last-wins `Calendar.read` result because that would violate lines 108–110 and R16.
- Person contexts are computed only after final validation, and all must succeed before one untitled document is opened. There is no partial document, cache, Markdown/Calendar write, audit-backed recovery state, conflict entry, or observation update on any failure (lines 251–255; R15/R16).
- Hover performs no Calendar I/O, and Calendar access is not introduced into any other new language surface (lines 274–284, 421–433).

## Required implementation/code-review gates

These are consequences of the clean design boundary, not new findings:

1. Add the exact reader beside the existing Calendar bulk `read`/`updateSummary` behavior—for example as a separate method or function—and preserve duplicate count through its `found | missing | ambiguous` result. Do not implement it as a wrapper around the current UID-keyed `Map`.
2. Keep existing `Calendar.read`, `Calendar.updateSummary`, `syncCalendar`, `resolveCalendarConflict`, Calendar conflict keys/schema, and Calendar observation behavior semantically unchanged in this delivery. If implementation must change any of those shared behaviors or signatures, F2 re-enters scope and sealed `(calendarName, uid)`, ambiguity-preserving reads, and exactly-one-match pre-update verification become mandatory before merge.
3. Remove the current Brief path's use of the shared bulk reader and its conflict persistence/recovery message. Its replacement must use only the additive reader, the three validator calls, and all-or-nothing temporary output.
4. Preserve the exact terminal assertions in R10–R16 during implementation review: no capability call for stale initial eligibility; no write/save for dirty Journal or task/Person races; no partial Brief/conflict/observation state; and no retry advice for `UNKNOWN`.
5. Do not represent a passing Brief implementation as proof that formal Calendar Sync/Resolve is safe. That subsystem remains explicit P1 debt until separately fixed and tested.

## Findings

No P0, in-scope P1, or P2 authority/race findings remain in frozen revision 3. The design is ready to proceed to the other required revision-3 closure perspectives and independent adjudication. A digest change, a non-additive Calendar implementation, a Brief dependency on Sync/Resolve, or any shared Calendar read/update behavior change invalidates this disposition and requires a new frozen review round.
