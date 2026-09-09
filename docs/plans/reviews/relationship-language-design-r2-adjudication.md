# Relationship language design revision 2 — independent adjudication

Status: completed independent closure adjudication; durability capture only.

- Frozen artifact: `docs/plans/2026-09-09-relationship-language-features.md`
- Frozen SHA-256: `9d9d168b84cdf9d948e76bd6dee8c1b67ee2a5af1cd1601f64e32b7243068c9c`
- Recovery ref: `refs/codex/recovery/relationship-language-design-r2-20260909`
- Recovery commit: `70b0ba6e0a05b8833b1028b4d37736d22c36fe0a`
- Reviewed reports: revision-2 authority/race, data/API/editor, and scope/evidence closure reports
- Model: GPT-5 (Codex; the exact deployment identifier is not exposed at runtime)
- Reasoning effort: xhigh
- Result: **NOT CLEAN — 0 P0; 6 in-scope P1; 2 in-scope P2; 1 accepted P1 Calendar debt explicitly deferred outside this design**

The working artifact and recovery-ref copy were verified against the frozen digest before
adjudication. The frozen design and the three reviewer reports were not edited. Every remaining
finding was checked against source, the revision-1 adjudication, the relationship data-surface
contract, explicit P0–P2 scope, concrete counterexamples, and falsifiable tests. The disposition is
not a vote: findings with the same conclusion were independently re-established, and conflicting
recommendations were resolved against authority and scope.

## Executive decision

Revision 2 correctly closes the main revision-1 defects: relationship-only strict arguments,
custom-kind compatibility, live-document precedence, guarded prompt boundaries, dirty-Journal
refusal, bounded write reconciliation, narrow exact Brief reads, literal `@` page precedence,
command-backed actions, and no LSP/LanguageService. It is nevertheless not ready for
implementation.

The smallest correct consolidated revision has six in-scope P1 corrections:

1. make task numeric refs use one explicit live-coordinate normalization under CRLF;
2. state `reconnect` null ordering exactly;
3. change ignored/excluded relationship diagnostics from Warning to Information;
4. make fence closing match Markdown's opening marker character and minimum run length;
5. prove exact public row shapes and every promised consumer/recipe in the evidence ledger;
6. establish fresh Brief eligibility before the first `requireApp` capability boundary.

Two P2 evidence/presentation corrections also remain required because revision 2 explicitly says
P2 is part of this delivery: always-working temporary Person navigation and negative/nonnumeric/
fractional `limit` rejection evidence.

The formal Calendar Sync/Resolve duplicate-UID and calendar-switch counterexamples are valid P1
defects in existing code, but broadening this relationship-language/Brief pass into a rewrite of
the mutation-bearing sync subsystem is not the smallest correct closure. This plan must remove its
implicit certification of that subsystem, make Brief independent of it, and record the Sync/Resolve
hardening as a separate blocked claim/debt. If implementation changes a shared Calendar API used by
Sync/Resolve rather than adding the narrow Brief reader alongside it, that dependency crosses back
into scope and must be resolved before merge.

## Conflicts resolved

### Diagnostic severity

The data/API finding is accepted and the revision-2 Warning policy is rejected. The newer
authoritative source correction distinguishes an invalid required query from optional content that
is simply ignored or excluded. The deterministic mapping is:

- **Error:** unknown relationship projection/argument/field; malformed or reversed query dates;
  invalid `limit`; missing or non-Person required `person`.
- **Information:** ignored birthday/cadence; empty Interaction kind; Interaction excluded for an
  untrustworthy Journal date or no direct exact Person.
- **No diagnostic:** any non-empty custom Interaction kind.
- Existing unrelated compatibility notices remain Information.

Choose Information, not Hint: it matches the existing visible informational diagnostic channel and
requires no new tags, configuration, or provider-specific override. Hover may explain the same
classification but does not choose severity. R4, R5, R7, and R18 must assert this one shared mapping.
The revision-1 adjudication's Warning choice is superseded only on this point by the later source
correction; its custom-kind and Error dispositions remain intact.

### Calendar scope

The authority reviewer proves two real defects in the existing formal Calendar subsystem:

1. a conflict observed in Calendar A can be resolved against the currently configured Calendar B;
2. bulk read can collapse duplicate UID records while `updateSummary` mutates `item 1`, so the
   compared event and mutated event need not be the same.

The counterexamples are accepted, but the proposed expansion of this plan is modified and deferred.
The explicit feature is a read-only Brief with one exact UID. It neither invokes Sync/Resolve nor
needs to persist a conflict. The consolidated design correction is therefore:

- replace “formal Calendar sync alone owns conflict persistence” with a non-certification boundary:
  Brief writes no conflict/observation state, does not invoke or recommend Resolve, and reports its
  own `missing | ambiguous | failure` locally;
- state that existing Sync/Resolve behavior is unchanged and not certified by this plan;
- record separately that formal Calendar mutations require a sealed `(calendarName, uid)` conflict
  identity, ambiguity-preserving batch reads, and exactly-one-match verification immediately before
  update;
- keep the Brief reader additive and narrow. If shared `read`/`updateSummary` signatures or behavior
  are changed, the formal Sync/Resolve dependency becomes in scope and the authority finding must be
  fixed rather than deferred.

This is deferral, not a claim that the existing defect is safe. No new Brief path may lead the user
into the unresolved mutation path as its recovery action.

## Consolidated design corrections by root cause

### C1 — one coordinate contract for numeric task identity

**Accepted:** authority/race F1.

The frozen text simultaneously requires equality with a raw indexed ref and a live task line-start
offset, which is impossible after an earlier CRLF. Define task-command handles in live-source
coordinates, matching `resolveRef` and `TextDocument.offsetAt`. When comparing a fresh indexed task
with a numeric handle, translate the indexed/parser offset through `originalSourceOffset` exactly
once, then require both normalized-ref equality and exact live line-start equality. Cursor-created
handles are already live and are not translated. Handwritten numeric SB refs retain live-source
meaning. Interaction rows retain raw internal refs; only their full-result/Brief presentation links
receive their separate one-time conversion. Anchor identity remains unique-name based and may move.

No dual ref fields, coordinate wrapper type, or identity store is needed. Amend the sentence that
currently reserves conversion “only” for Interaction presentation links. Extend R10/R11 with a
valid unchanged CRLF task, containing-line retarget refusal, moved unique anchor after CRLF, and an
assertion that no path double-translates.

### C2 — exact public contract and parity evidence

**Accepted and clustered:** data/API F1 plus scope/evidence S1.

- State that `reconnect` sorts `due: null` first, then ISO due date ascending, then canonical Person
  ascending. This preserves the baseline `(due ?? "")` behavior.
- Strengthen R2/R3 to assert exact `Object.keys`, omitted optional fields rather than present
  `undefined`, explicit `due: null`, public nested Interaction keys, at-most-ten
  `recentInteractions`, filtering, and full declared order.
- Use one discriminating fixture containing omitted optionals, a never-contacted row, dated overdue
  rows with a tie, more than ten interactions, custom kinds, and filtered-out rows.
- Drive that fixture through direct core, preview/query execution, query hover, CodeLens count,
  baked Markdown, `lifeloop.*` through SLIQ/Lua, and CLI JSON. Raw-row consumers must deep-equal;
  rendered surfaces must contain the same selected values/order; CodeLens must equal the row count.
- Parse and execute the four promised People, Interaction timeline, due reconnect, and Person Context
  recipes. Checked prose alone is not evidence.

Reuse existing Vitest, preview, bake, Lua/SLIQ, and CLI harnesses. Do not add a schema engine,
golden-file framework, or adapter-specific sorting.

### C3 — one located Markdown fence contract

**Accepted:** data/API F3.

The located scanner must retain the opening marker character and run length. A close is recognized
only when it uses the same character, has a run at least as long as the opener, and has only allowed
trailing whitespace. A shorter same-character run or any opposite-marker run remains body text.
Apply that one boundary to preview/query execution, completion, diagnostics, definition, hover,
CodeLens, and baking. Add to R6 both directions of mixed backtick/tilde body runs, shorter
same-marker runs, longer valid closes, CRLF, and astral-prefix range assertions.

This is two receipts in the existing located parser, not a second parser or LanguageService.

### C4 — fresh eligibility before every Brief capability boundary

**Accepted:** authority/race F3.

The current ordering seals potentially stale inputs and can launch Calendar before proving that the
operation is still eligible. Use one validator returning the sealed tuple and call it in this order:

1. level-three refresh; resolve/validate handle, exact binding, direct People, live Person identity,
   and configured calendar; only then seal `{handle, uid, calendarName, directPeople}`;
2. call `requireApp`;
3. refresh and require exact equality with the sealed tuple;
4. call the exact single-UID reader;
5. refresh and require exact equality again before computing all contexts and opening one document.

Add an R15 case that removes Person identity or the event binding before command invocation and
asserts that app availability/launch and the Calendar reader are never called. Retain the existing
post-app and during-read mutations. No lock or new generation layer is needed.

### C5 — temporary navigation must work without Foam

**Accepted with simplification:** scope/evidence S2.

Use one escaped standard Markdown file-URI link for canonical Person navigation in both task-only
and Foam profiles. A build/qualification-time Foam result cannot safely choose a representation for
a runtime where Foam may be absent, and a runtime Foam branch is needless. Continue using the
narrow LifeLoop SB special-ref path for source refs. Only full query results and successful Briefs
receive these presentation links; raw rows, CLI, preview, and untrusted hover remain unchanged.

Extend R19/R20 so the final packaged VSIX opens both temporary documents in both host profiles and
actually resolves one Person link and one SB source link to the exact files/positions. Merely
checking provider ownership or emitted text is insufficient. No Webview, cache, saved page, ordinary
wikilink provider, or Foam capability branch is added.

### C6 — strict invalid-limit evidence

**Accepted:** scope/evidence S3.

Keep `limit` presentation-owned. Extend the existing ledger rather than inventing a new abstraction:

- R6/editor: `limit: -1`, `limit: nope`, and a fractional limit each produce an Error on the exact
  live value-token range and execute no projection result;
- R2/CLI: equivalent `--limit` values exit nonzero, emit an actionable error, and emit no successful
  row JSON;
- retain positive `0` and `1` cases to prove the boundary and application of the limit.

One shared non-negative-integer validator is sufficient; `limit` must not move into semantic-core
projection arguments.

## Per-finding adjudication

| Report finding | Disposition | Reason |
|---|---|---|
| Authority F1 — CRLF numeric task contract | **ACCEPTED, P1** | Frozen requirements are mutually unsatisfiable; normalize indexed task refs once into live coordinates. |
| Authority F2 — formal Sync/Resolve Calendar identity | **COUNTEREXAMPLE ACCEPTED; FIX MODIFIED AND DEFERRED, P1 debt** | Real existing mutation bug, but outside the read-only Brief/language pass if the new reader is additive and Brief does not rely on Sync/Resolve. |
| Authority F3 — first Brief validation after `requireApp` | **ACCEPTED, P1** | An ineligible stale action can launch/access Calendar before validation. |
| Data F1 — `reconnect` null order | **ACCEPTED, P1** | Public 1.1 ordering is ambiguous; baseline null-first behavior is the least disruptive contract. |
| Data F2 — informational exclusions locked to Warning | **ACCEPTED WITH INFORMATION SELECTED, P1** | Later source authority supersedes the earlier Warning choice; one visible Information level is simplest. |
| Data F3 — mixed fence marker closure | **ACCEPTED, P1** | Without same-character/minimum-length closure, editor surfaces can parse a different body from Markdown preview. |
| Scope S1 — incomplete public shape/parity/recipe evidence | **ACCEPTED, P1** | Current R2/R3 can pass a uniformly wrong public contract and omit named consumers/recipes. |
| Scope S2 — temporary Person navigation chosen at qualification | **ACCEPTED WITH FILE-URI SIMPLIFICATION, P2** | P2 must work in task-only runtime; one standard link removes the hidden Foam dependency. |
| Scope S3 — no invalid-`limit` RED/token evidence | **ACCEPTED, P2** | Positive limit coverage cannot prove rejection or exact diagnostics for malformed values. |

## Prior decisions that remain closed

These corrections do not reopen the accepted revision-1 boundaries:

- only relationship projections gain strict argument validation; legacy projections stay permissive;
- `INTERACTION_KINDS` remains suggestion/mutation vocabulary, not a closed Markdown enum;
- pure lexical providers read the supplied `TextDocument` and do not trigger full-vault reindex;
- stale index-dependent semantics return nothing until a matching generation settles;
- every task/diagnostic CodeAction remains command-backed with empty `edit`;
- task-originated Log revalidates after each prompt and protects task/Person/Journal receipts in the
  final ChangeSet;
- dirty task/Person buffers remain live read authority; dirty Journal remains a hard write conflict;
- write response loss uses bounded whole-file reconciliation, at most one existing serial rollback,
  no automatic retry, and no recovery subsystem;
- Brief makes no cancellation claim, performs no Calendar/Markdown/conflict mutation, and opens no
  partial output;
- literal `X@Y.md` continues to take precedence over LifeLoop special-ref interpretation;
- no LSP, generic LanguageService, schema/DSL engine, second renderer, or ordinary wikilink takeover
  enters scope.

## Exact dependency-closure recheck after revision

After applying one consolidated design revision, do not patch findings piecemeal. Then:

1. **Freeze and verify one new digest.** Create/read back a non-normative recovery snapshot with the
   updated design, all r1/r2 reports, explicit inventory, SHA-256, lines, bytes, base revision, and
   worktree identity. All closure reviewers use that one digest.
2. **Replay every previous counterexample, not only the nine r2 findings.** Recheck r1 R1–R20 plus:
   - task CRLF valid/retarget/anchor/no-double-conversion cases;
   - null-first reconnect ordering and exact nested/optional public shapes;
   - Information severity for every ignored/excluded reason;
   - mixed-marker/shorter-run fence bodies;
   - pre-invocation Brief ineligibility with zero capability calls;
   - malformed editor and CLI limits;
   - actual temporary Person/source navigation in task-only and Foam hosts;
   - all four executable documentation recipes and the full consumer parity set.
3. **Authority/race closure at xhigh.** Review C1 and C4 plus the dependency closure of runtime
   guards, prompt/Calendar boundaries, dirty Journal, final ChangeSet receipts, write reconciliation,
   and no partial output. Confirm the formal Calendar debt is truly unreachable from Brief and that
   no shared Sync/Resolve API was changed. If it was changed, bring authority F2 fully in scope and
   test sealed `(calendarName, uid)`, duplicate refusal, and exactly-one-match update.
4. **Data/API/editor closure at high or higher.** Review C2, C3, and diagnostic severity against exact
   public keys/null/omission/order/bounds, relationship-only strictness, custom-kind behavior,
   parser/preview fence parity, CRLF/UTF-16 ranges, and limit ownership.
5. **Scope/evidence closure at high or higher.** Review C5/C6 and the strengthened R1–R20 ledger.
   Require pre-fix RED descriptions, exact terminal assertions, final VSIX SHA binding, task-only
   proof that Foam is absent, pinned Foam `0.44.6`, and `NOT COVERED` for skipped real Apple checks.
6. **Independent adjudication at xhigh.** Deduplicate by root cause, resolve any disagreements against
   the frozen source and executable counterexamples, and verify that fixes did not add an LSP,
   LanguageService, schema engine, provider-wide reindex, runtime Foam branch, alternate renderer,
   retry/takeover, or new Calendar mutation scope.
7. **Patch-induced dependency check.** Grep and inspect every statement/test involving
   `originalSourceOffset`, diagnostic severity, fence closure, `limit`, temporary Person links,
   `requireApp`, exact Calendar reads, and conflict persistence. A sampled review cannot be reported
   CLEAN.

If the artifact digest changes after any reviewer begins, invalidate that closure round, create a
new verified snapshot, and rerun the full dependency closure. The design is CLEAN only when all
in-scope P1/P2 findings above are closed and the accepted formal Calendar debt is explicitly
separated without a new or implied dependency from Brief.

## Final scope disposition

- **Delivery P0/P1:** retain the requested relationship completion, live diagnostics, narrow
  definitions, guarded Log/Brief, command-backed actions, hover, parity, and recipes with C1–C4 and
  C2's complete evidence corrections.
- **Delivery P2:** retain symbols, deterministic diagnostic actions, and temporary navigation;
  revision 2 says this delivery includes P2, so C5/C6 and packaged navigation tests are mandatory.
- **Explicitly deferred:** formal Calendar Sync/Resolve sealing and duplicate-safe mutation. Its
  counterexamples remain P1 debt and block any claim that conflict identity/update is safe; they do
  not authorize expanding this Brief pass.
- **Still rejected:** LSP/LanguageService, generic schema/DSL, global legacy projection strictness,
  closed Interaction kinds, provider-wide lexical reindex, cancellation inference, Brief conflict
  persistence, ordinary wikilink takeover, runtime Foam branching, saved briefs, caches, Webviews,
  analytics, or a recovery subsystem.

The brainstorming/YAGNI comparison selected clarification and stronger existing fixtures over new
architecture: one coordinate normalization, one severity map, two fence receipts, one reused Brief
validator, one universal Person link form, and additive evidence in existing gates.
