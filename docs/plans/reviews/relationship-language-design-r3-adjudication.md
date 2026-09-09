# Relationship language design revision 3 — independent adjudication

Status: completed independent final adjudication; durability capture only.

- Frozen artifact: `docs/plans/2026-09-09-relationship-language-features.md`
- Frozen SHA-256: `8e08bcefd171dace55c2fc545bf7abe57f9c88040d398fa4b6c3523597fafd21`
- Recovery ref: `refs/codex/recovery/relationship-language-design-r3-20260909`
- Recovery commit: `bb48f3abae76cb78a79dfb2956eeb9b7078a0555`
- Reviewed reports: revision-3 authority/race, data/API/editor, and scope/evidence closure reports
- Model: GPT-5 (Codex; the exact deployment identifier is not exposed at runtime)
- Reasoning effort: xhigh
- Result: **CLEAN — 0 P0; 0 in-scope P1; 0 P2; 1 accepted P1 Calendar debt remains explicitly outside this design**

The working artifact and the recovery-ref copy were independently read and matched the frozen
digest before adjudication. The source files cited below also match the preserved pre-design
baseline recovery tree. The frozen design and the three reviewer reports were not edited.

This disposition is not derived from reviewer agreement. Each prior counterexample was replayed
against the frozen text and the cited source behavior, the full P0–P2 delivery was checked for
falsifiable evidence, and the patch-induced dependency closure was reviewed separately. `CLEAN`
means the design is ready for implementation under its RED/GREEN and packaged gates. It is not an
implementation PASS, and it does not certify the deferred formal Calendar Sync/Resolve subsystem.

## Executive adjudication

Revision 3 closes every in-scope defect accepted in the revision-1 and revision-2 adjudications.
The corrections are internally consistent and retain the smallest correct architecture:

- task mutation handles have one live-coordinate contract and one admission path;
- lexical Providers use the supplied document while derived identity waits for matching indexed
  authority;
- prompt and I/O boundaries revalidate before effects, and final Markdown writes bind every input
  receipt in the existing `ChangeSet`;
- relationship query rows, arguments, diagnostics, ordering, fences, limits, consumers, and recipes
  have one core contract and executable evidence;
- Brief validates before Calendar capability access, uses an additive ambiguity-preserving exact
  reader, validates again after each boundary, and has no partial or persistent failure effect;
- temporary navigation uses one host-independent file-link representation and preserves Foam's
  ordinary-link ownership;
- P2 remains part of the delivery and keeps mandatory packaged proof.

No correction requires an LSP, generic `LanguageService`, schema/DSL engine, alternate renderer,
provider-wide lexical reindex, runtime Foam branch, retry/takeover protocol, new recovery system,
or Calendar mutation expansion.

The existing Calendar mutation defect is real: current batch reads collapse duplicate UIDs,
updates select the first match, and conflict resolution can use a newly configured calendar. The
design neither declares that safe nor routes Brief through it. It keeps the exact Brief reader
additive and makes any change to shared Sync/Resolve read or update behavior a blocking scope
re-entry. That is a valid explicit deferral, not a weakened safety claim.

## Independent source verification

The relevant worktree source matched
`refs/codex/recovery/relationship-language-baseline-20260909`; no intervening source edit was used
to make a counterexample disappear.

- `packages/semantic-core/src/contract.ts:37–46,113–150` confirms one broad current
  `ProjectionArgs`, permissive projection dispatch, and the four relationship projections that need
  relationship-only validation.
- `packages/semantic-core/src/relationships.ts:6–14,125–145,185–230` confirms custom non-empty
  kinds currently count, public Interaction rows currently retain internal `offset`, reconnect uses
  null-first comparison, and nested recent Interactions currently reuse the internal row.
- `packages/semantic-core/src/mutation.ts:193–243,255–275` confirms parser-to-source CRLF
  conversion, live numeric resolution, unique anchor resolution, and line/state receipt checks.
- `packages/vscode/src/task-target.ts:26–59` confirms the current presentation `page/offset`
  bypass and the existing indexed-to-live offset seam the new single admission rule must replace.
- `packages/vscode/src/workspace.ts:17–69,122–175` confirms dirty buffers are live vault reads and
  current indexing is serialized, while an open-buffer write is applied and saved and therefore
  cannot implement dirty-Journal refusal by accident.
- `packages/vscode/src/commands.ts:83–110` confirms current Interaction prompts retain candidates
  and call a Journal-only mutation without the required task/Person receipts.
- `packages/vscode/src/apple.ts:187–238` confirms the current Brief reads through the shared batch
  map, trusts the pre-read task snapshot, checks invented `cancelled`, and persists a formal conflict.
- `packages/apple-bridge/src/calendar.ts:31–54,70–84,112–145` confirms raw reads can emit duplicate
  UID records, `read` collapses them into a `Map`, `cancelled` is hard-coded false, and
  `updateSummary` mutates `item 1` without proving uniqueness.
- `packages/apple-bridge/src/calendar-sync.ts:25–41,94–100,106–139` and
  `packages/vscode/src/apple.ts:295–310,394–459` confirm formal Sync/Resolve consume the shared
  methods and the current conflict path does not seal calendar identity.
- `packages/vscode/src/preview.ts`, `query-lens.ts`, and `extension.ts:97–112` retain the baseline
  parser/range and debounced-diagnostic counterexamples that R6/R7 must first record RED.

These facts support the design's required changes and, importantly, the Calendar debt boundary.
They do not supply premature GREEN evidence.

## Revision-1 counterexample replay

| Prior finding | Independent disposition | Closure in frozen revision 3 |
|---|---|---|
| Authority P1-1 — numeric ref can retarget a containing line | **CLOSED** | Lines 131–140 make numeric handles live-coordinate identities, normalize a fresh indexed numeric ref exactly once, and require the handle at the exact live task line start. R10/R11 cover valid CRLF and the moved-line counterexample. |
| Authority P1-2 — compile-time-only guarded handle | **CLOSED** | Lines 131–134 require runtime strings for `ref`, `expectedText`, and `expectedState`, and route every supplied handle through `taskTarget`; R11 rejects missing/wrong receipts and stale presentation hints. |
| Authority P1-3 — stale index outranks live Providers | **CLOSED** | Lines 142–151 split supplied-document lexical work, matching-generation derived semantics, and serialized authority-sensitive work. Exact Person definition rechecks the live-buffer-aware target. R7/R8 exercise the boundary without global lexical reindex. |
| Authority P1-4 — prompt checks not sealed into final Journal write | **CLOSED** | Lines 153–167 and 229–241 revalidate after every prompt, recompute task/People/event facts, and bind task, selected Person pages, and Journal before-value into one existing `ChangeSet.expected`. Dirty Journal refuses unchanged. |
| Authority P1-5 — response loss invites unsafe retry | **CLOSED** | Lines 169–174 classify authoritative all-before, durable all-after, provable partial rollback, and third/unreadable `UNKNOWN` states, with no automatic retry. R14 requires all three decisive outcomes. |
| Authority P1-6 — Brief omits calendar identity and persists cross-calendar conflict state | **CLOSED in Brief scope** | Lines 243–255 seal and compare calendar name with handle, UID, and People around every capability boundary. Brief persists no conflict/observation state. Formal mutation debt remains explicit and separate. |
| Authority P1-7 — exact read collapses duplicates and invents cancellation | **CLOSED in Brief scope** | Lines 108–118 require an additive `found | missing | ambiguous` reader that does not collapse duplicates and makes no cancellation claim. R16 covers duplicate, missing, throwing, and one-UID success. |
| Authority P2-1 — fixed 400 ms correctness sleep | **CLOSED** | Lines 153–154 and 344–348 make debounce an optimization and require controllable promise barriers, never fixed sleeps. |
| Data F1 — strict args conflict with adapters and legacy compatibility | **CLOSED** | Lines 63–71 and 84–89 restrict strict validation to four relationship projections, preserve core defaults, and keep `fields`/`limit` presentation-owned. R1–R3 cover direct and adapter behavior. |
| Data F2 — incomplete public schemas and leaked offsets | **CLOSED** | Lines 73–83 freeze all four public shapes, optional omission, explicit null, nested public rows, bounds, and ordering. R2/R3 require exact keys and discriminating rows. |
| Data F3 — duplicated classifiers/custom-kind contradiction | **CLOSED** | Lines 63–70 keep every non-empty custom kind valid and select shared pure classification; lines 214–218 define one Error/Information/no-diagnostic map. R4/R5/R7/R18 bind it. |
| Data F4 — no located parser/fence parity | **CLOSED** | Lines 176–186 require one located parser for every named consumer, both aliases, opener marker/run receipts, same-marker minimum-length closes, live UTF-16 ranges, and separate CRLF conversions. R6 is concrete. |
| Data F5 — indexed Interaction CRLF ref drifts in presentation | **CLOSED** | Lines 182–186 preserve raw parser refs and convert exactly once only for full-result/Brief source links. R19 resolves the exact target while raw rows remain unchanged. |
| Data F6 — unsupported cancellation claim | **CLOSED** | Lines 108–118 remove the claim and keep the exact reader's state limited to found, missing, or ambiguous. |
| Data F7 — temporary Person link has no proven owner | **CLOSED** | Lines 314–319 select escaped standard Markdown file-URI links for every runtime and add no Foam-dependent branch. R19/R20 require actual resolution. |
| Scope F1 — literal `@` filename precedence | **CLOSED** | Lines 122–127 keep full literal-page lookup ahead of LifeLoop special-ref parsing; R9 covers task-only and Foam hosts. |
| Scope F2 — no immediate live diagnostic lifecycle | **CLOSED** | Lines 142–151 and 201–203 require immediate lexical recomputation for the changed URI and settled augmentation only for identity semantics. R7 forbids full reindex on this path. |
| Scope F3 — existing `query` alias omitted | **CLOSED** | Lines 176–181 and 192–197 place `query` and `lifeloop` in the same located grammar; R6 covers both. |
| Scope F4 — non-executable evidence matrix/weak package binding | **CLOSED** | Lines 344–384 provide baseline-bound RED/GREEN rows, terminal assertions, named gates, no-sleep barriers, mandatory P2, `NOT COVERED` semantics, and final VSIX digest binding. |
| Scope F5 — temporary presentation mutation leaks or cannot navigate | **CLOSED** | Lines 312–319 restrict navigation to full output/Brief, preserve raw/CLI/hover results, and use independently owned Person/source link forms. R19/R20 resolve targets. |
| Scope F6 — `kind`/`limit` strictness mismatch | **CLOSED** | Lines 67–69 preserve custom Markdown kinds; lines 87–89 require non-negative integer adapter limits. R2/R5/R6 cover inclusion, positive limits, malformed refusal, exact Error range, and no result. |
| Scope F7 — freshness rule conflicts with debounce matrix | **CLOSED** | Lines 142–167 define all three levels and R7/R8/R15 assign the correct barrier to each. |

## Revision-2 counterexample replay

| Revision-2 finding | Independent disposition | Closure in frozen revision 3 |
|---|---|---|
| Authority F1 / C1 — impossible CRLF task coordinate contract | **CLOSED** | Indexed numeric task refs alone are translated into live coordinates before exact comparison. Cursor handles and handwritten numeric SB refs are already live; indexed Interaction presentation has its own one-time conversion. R10/R11 reject omission and double conversion. |
| Authority F2 — formal Sync/Resolve calendar identity and duplicates | **VALID DEFERRED P1 DEBT; OUTSIDE THIS DESIGN** | Lines 108–118 and 243–255 keep Brief additive, read-only, and unable to invoke or recommend Resolve. Existing Sync/Resolve remains unchanged and uncertified. A shared read/update change makes the debt blocking before merge. |
| Authority F3 / C4 — first Brief validation after `requireApp` | **CLOSED** | Lines 245–251 run one complete validator before the first capability call, compare its sealed tuple after `requireApp`, and compare again after the exact read. R15 requires zero app/reader calls for stale initial eligibility. |
| Data F1 / C2 — `reconnect` null ordering ambiguous | **CLOSED** | Lines 77–79 state null first, then ISO due date, then canonical Person. R2/R3 use never-contacted and tied overdue rows. |
| Data F2 — informational exclusions locked to Warning | **CLOSED** | Lines 214–218 choose Information for ignored birthday/cadence, empty kinds, untrusted Journal dates, and missing direct exact People; custom non-empty kinds have no diagnostic. |
| Data F3 / C3 — opposite fence marker can close a block | **CLOSED** | Lines 176–183 require the same marker character and at least the opener length; shorter same-marker and all opposite-marker runs stay body text. R6 exercises both directions and valid longer closes. |
| Scope S1 — parity can pass a uniformly wrong public contract | **CLOSED** | R2/R3 use one discriminating fixture through core, preview/query, query hover, CodeLens, bake, SLIQ/Lua, and CLI; exact keys, omitted optionals, null, nesting, filtering, order, limits, and all four recipes are asserted. |
| Scope S2 / C5 — Person navigation selected at qualification rather than runtime-safe | **CLOSED** | Lines 314–319 always use an escaped standard file URI. R20 opens both temporary outputs and resolves Person and SB source links in the task-only and Foam `0.44.6` packaged profiles. |
| Scope S3 / C6 — malformed `limit` lacks RED/token evidence | **CLOSED** | R2/R6 and lines 377–384 require negative, nonnumeric, and fractional editor/CLI refusal, exact live value-token Error, no editor result, nonzero CLI exit, and no successful row JSON; 0/1 prove the positive boundary. |

## Questions resolved during adjudication

The reports had no conflicting final findings, but two interpretations were tested rather than
silently assumed.

### Anchor identity versus live numeric cursor receipts

The source distinguishes parser-produced anchor identity from numeric source position. Revision 3
does not globally reinterpret either. An anchor-bearing handle is re-resolved by unique anchor and
may move while its line/state receipts still match. A cursor-produced numeric handle is already a
live coordinate, is not translated, and remains stationary even when its line also contains an
anchor. Exact indexed-ref normalization applies to numeric indexed identity; it does not convert an
anchor into a numeric identity or grant movement to a cursor receipt. R10's unchanged numeric,
retarget refusal, and moved-anchor cases distinguish these paths. This is consistent with
`resolveRef` and does not require a second handle type.

### Non-vacuous CodeAction evidence

R17's stale diagnostic-command refusal necessarily obtains and invokes an actual deterministic
diagnostic action, while P1/P2 enumerate the task commands and the sole case-only diagnostic fix.
Together with R8/R11–R13 and the live range assertions in R6, an empty provider cannot satisfy the
gate. Implementation review must preserve that non-vacuous reading: it must exercise at least one
eligible task action and one case-only diagnostic action, assert their registered commands and
empty `edit`, then mutate the supplied receipts and prove refusal. This is a consequence of the
existing gate, not added feature scope.

## P0–P2 delivery adjudication

| Delivery | Disposition | Required evidence boundary |
|---|---|---|
| P0 relationship completion | **RETAINED / CLOSED AS DESIGN** | Static relationship metadata, both fence aliases, exact body/value placement, legal arguments/fields, canonical Person values, and suggested fixed kinds; R1–R3/R6. |
| P0 diagnostics | **RETAINED / CLOSED AS DESIGN** | Supplied-document lexical ranges, settled identity augmentation, exact Error/Information/no-diagnostic mapping, no debounce oracle; R1/R4–R8/R17. |
| P0 definitions | **RETAINED / CLOSED AS DESIGN** | Literal-page precedence, exact Person identity, special anchors/positions, file and untitled Markdown, no ordinary-wikilink takeover; R8/R9/R19/R20. |
| P0 Log Interaction | **RETAINED / CLOSED AS DESIGN** | Refresh after each prompt, direct People only, final task/Person/Journal receipts, dirty-Journal refusal, reconciled write states; R10–R14. |
| P0 restricted Brief | **RETAINED / CLOSED AS DESIGN** | Complete pre-app validation, sealed tuple equality after app and read, additive exact reader, all-or-nothing temporary output, no persistent failure effect; R15/R16/R20. |
| P0 contract version | **RETAINED / CLOSED AS DESIGN** | Existing worktree `1.1.0` is retained; Provider additions do not make another semantic-contract bump. |
| P1 task actions | **RETAINED / CLOSED AS DESIGN** | Enumerated registered commands, refreshed eligibility, guarded handles, empty edits, stale refusal; R8/R11–R13/R17. |
| P1 hover | **RETAINED / CLOSED AS DESIGN** | LifeLoop syntax only, shared classifiers, no Calendar I/O or ordinary-link takeover; R2/R4/R5/R7/R8/R18. |
| P1 parity and recipes | **RETAINED / CLOSED AS DESIGN** | Every named consumer, post-limit count, exact public values/order, and four executable recipes; R2/R3. |
| P2 Interaction symbols | **RETAINED / CLOSED AS DESIGN** | Every explicit Interaction, including custom and excluded entries, with live ranges and counted state; R5/R7/R18. |
| P2 diagnostic actions | **RETAINED / CLOSED AS DESIGN** | Unique case-only fixes, command-only actions, complete live receipts, no inferred repairs; R6/R17. |
| P2 temporary navigation | **RETAINED / CLOSED AS DESIGN** | Presentation-only mapping and actual packaged resolution in both required host profiles; R19/R20. |

No requested P0–P2 surface is silently deferred. Because P2 is retained, R17–R20 are mandatory; a
missing required packaged host profile is not GREEN or PASS. Optional real Apple qualification may
be recorded only as `NOT COVERED` when unavailable.

## Deferred Calendar boundary

The accepted Calendar counterexamples remain P1 defects in existing mutation-bearing behavior:

1. a conflict observed in Calendar A can be resolved against the currently configured Calendar B;
2. batch `read` can collapse duplicate UID events while `updateSummary` mutates the first match, so
   the compared event and mutated event need not be the same.

The deferral is admissible only under all of the frozen conditions:

- Brief uses a new additive exact-UID reader and never derives uniqueness from the current
  UID-keyed `Map`;
- Brief does not call or recommend Sync/Resolve and writes no conflict or observation state;
- current `Calendar.read`, `Calendar.updateSummary`, `syncCalendar`, `resolveCalendarConflict`,
  conflict keys, and observation behavior remain semantically unchanged in this delivery;
- a change to any shared read/update API or behavior invalidates the deferral and blocks merge until
  formal mutation seals `(calendarName, uid)`, preserves ambiguity, and proves exactly one match
  immediately before update;
- passing Brief tests must never be represented as evidence that formal Calendar mutation is safe.

This boundary avoids both unsafe certification and an unrelated rewrite of the existing mutation
subsystem.

## Dependency-closure and patch-induced-defect review

- **Coordinates:** task numeric normalization, anchor resolution, Interaction presentation
  conversion, and handwritten SB refs remain separate. No path requires or permits double
  translation.
- **Freshness:** immediate lexical work does not broaden to a full-vault index; derived identity
  cannot use a stale generation; authority-sensitive commands reuse the existing serial refresh.
- **Mutation authority:** prompt selections become only tentative inputs. The final existing
  optimistic `ChangeSet` binds every task/Person/Journal source receipt, and dirty write targets
  refuse before `WorkspaceVault.write` can save them.
- **Terminal errors:** admission failure has no effect. Post-write uncertainty is reconciled once
  from whole-file authority; third or unreadable states remain `UNKNOWN` without retry advice.
- **Public data:** exact row mapping removes internal offsets at both top-level and nested surfaces;
  adapter presentation cannot change filtering or order; post-limit CodeLens count and recipes use
  the same projection result.
- **Parser/editor parity:** one located parser supplies every named consumer. Same-marker closing,
  CRLF mapping, JavaScript UTF-16 positions, and smallest-token diagnostics have explicit negative
  cases.
- **Brief:** no capability is reached from stale initial eligibility, and no output is opened from
  stale post-app/post-read authority, missing/duplicate/failing Calendar reads, or incomplete
  Person contexts.
- **Foam:** literal pages win before special-ref parsing; standard Person file links remove runtime
  Foam dependence; SB source links remain the only narrow LifeLoop navigation takeover.
- **Evidence:** every r1/r2 counterexample remains in R1–R20, fixed sleeps are prohibited, required
  package profiles bind to the final VSIX digest, and skipped optional external checks are never
  promoted to PASS.

No patch-induced requirement introduces new state, authority, recovery, renderer, or service
machinery. The existing metadata, parser receipts, validators, `ChangeSet`, exact reader, and test
harnesses are sufficient.

## Implementation and code-review gates

These are enforcement consequences of the clean design, not new findings:

1. Keep the exact Brief reader additive and ambiguity-preserving. Do not wrap the current last-wins
   `Calendar.read(...).get(uid)` or propagate its hard-coded `cancelled: false` as an authoritative
   Brief fact.
2. Treat any shared Calendar read/update semantic or signature change as scope re-entry before
   merge; do not repair only the carrier-sized Brief path while changing Sync/Resolve underneath.
3. Preserve all three runtime handle strings and distinguish numeric indexed normalization from
   cursor-live and anchor paths. R10/R11 must exercise the implementation, not only helper output.
4. Make R1–R3 and R17 non-vacuous: use actual invalid relationship inputs, exact public rows, every
   named adapter/recipe, an eligible task action, and an eligible case-only diagnostic action.
5. Refuse dirty Journal before any edit/save request, and keep task/Person live buffers read-only.
   R13 must assert contents, dirty state, and save call count.
6. Preserve `UNKNOWN` evidence and no-retry messaging after response loss; a throw alone is not an
   adequate terminal assertion.
7. Bind R20 to the SHA-256 of the exact tested VSIX and prove both Foam absence and pinned Foam
   `0.44.6` presence while actually resolving both Person and source links.
8. After implementation fixes, rerun the complete R1–R20 closure and review the grep dependency
   set for `originalSourceOffset`, diagnostic severity, fence closure, `limit`, Person links,
   `requireApp`, exact Calendar reads, shared Calendar mutation, and conflict persistence. A sampled
   run cannot be reported CLEAN.

## Final disposition

The three closure reports' CLEAN conclusions are independently supported. Frozen revision 3 closes
all in-scope P0, P1, and P2 design defects from the prior rounds and supplies an executable closure
contract without broadening architecture or authority. The sole surviving P1 is the explicitly
deferred formal Calendar Sync/Resolve mutation debt, whose non-dependency and scope re-entry trigger
are precise.

**Final result: CLEAN for implementation under R1–R20 and the deferred-Calendar boundary.**
