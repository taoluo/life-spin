# Relationship language implementation R1 — independent scope/evidence review

Status: **NOT CLEAN**. One P1 qualification finding and five P2 findings below. All assigned
requirements and R1–R20 gates were reviewed; the review did not stop at the qualification blocker.
This is an independent scope/evidence/YAGNI review, not an authority/race certification.

Reviewer: **gpt-6-astra, high reasoning**, as confirmed by the assigning primary agent.
Reviewed on 2026-09-09. Frozen implementation commit:
`c0c2d9164b8ae34641f1848f2dcd12d846da8041`; tree:
`755b79722b05fd4d598765b954a33326a58f4b74`; ref:
`refs/codex/recovery/relationship-language-implementation-r1-20260909`.

## Freeze and inventory verification

- Read `docs/plans/2026-09-09-relationship-language-implementation.review.json` before source review.
  This manifest is intentionally outside the frozen source commit; it names that earlier commit.
- Verified the ref resolves to the stated commit and tree. Read every inventoried file through
  `git show <commit>:<path>` and independently checked SHA-256, byte count, and newline count.
  **All 40 entries match.** The changed-file inventory against `baseDesignRevision` is complete.
- Independently hashed `git diff --binary dbd6fd56fffa225d108b76b57ea4f68d23a06b41 c0c2d916...`:
  `e2b25694432a5c75bed8a711336b98b2d7699abb470ed890430a291e58e3737a`, matching the manifest.
- The reviewed-design ref resolves to `c58d1298a18caca24e28f379f7dc1da9911ac3d8`.
  Its design document and the implementation's document both hash to
  `8e08bcefd171dace55c2fc545bf7abe57f9c88040d398fa4b6c3523597fafd21`.
- Reviewed the entire implementation diff and the requirement dependency closure: core contracts,
  relationship extraction/mutations, shared `apply`, CLI/Lua adapters, workspace freshness,
  task-target callers in commands/bindings/views/Apple, query parsing/rendering/providers,
  extension registration, temporary navigation, unit/conformance tests, host harness, package
  exclusions, schema pin, recipes, and existing package evidence. No frozen source was edited.

## Independent executable results and qualification limits

The worktree initially lacked dependencies. After the primary restored its temporary `node_modules`
symlink to `/Users/tao/silverbullet-lifeloop/node_modules`, I independently ran:

| Check | Independent result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run vendor:check` | PASS, all 137 files at pinned `6331add1` |
| `npm run schema:check` | PASS, 9 task attributes and 9 frontmatter keys |
| `npm run build` | PASS |
| `vitest run --configLoader runner --reporter=dot` | 703 passed, 3 skipped, 2 failed; 62 test files passed, 2 failed |
| Missing-fixture failures | `packages/vscode/test/report.test.ts` and `packages/semantic-core/src/lua/real.test.ts`: `ENOENT silverbullet/docs` |
| Task-only host, 18 passed / 8 pending | Reported by primary; not independently rerun here; source suite inspected in full |
| Foam 0.44.6 host, 25 passed / 1 pending | Reported by primary; not independently rerun here; source suite inspected in full |
| Real Apple exact read | NOT COVERED; optional and not represented as PASS |

The primary reports its 705+3 run used a second temporary symlink to
`/Users/tao/silverbullet-lifeloop/silverbullet`. Thus the two local failures are explainable
environment prerequisites, not newly demonstrated product regressions. The manifest does not bind
that ignored external fixture's revision/content. Record that provenance when publishing the 705
claim. The independent run used installed Vitest 3.2.7 and the existing dependency tree; it was not
a clean dependency-install reproducibility claim.

I additionally bundled short probes in memory with the repository's existing esbuild alias seam,
ran the frozen provider/core functions against isolated generated vaults, and removed those vaults.
They demonstrated the concrete S4–S6 counterexamples below. These probes changed no product source.

## Findings

### S1 — P1: current host counts cannot certify the required final VSIX gate

**Evidence/surfaces:** `packages/vscode/test/suite/extension.test.ts`,
`packages/vscode/test/runTest.ts:72`, implementation manifest `verification`, and
`docs/PACKAGE-EVIDENCE.json`. The host suite is unchanged from the reviewed design baseline.
It never invokes `lifeloop.openQueryResult`, never opens a successful Brief, and never follows
Person/source links from either temporary document. The task-only suite does not test the new
DefinitionProvider's literal-`@`/CRLF case. The manifest gives no current VSIX SHA, bytes, extraction
path, or package-entrypoint binding. `PACKAGE-EVIDENCE.json` instead names the earlier artifact
`26a74fd9...`, with **647 / 17 / 24** results, not the claimed **705 / 18 / 25** results.

**Concrete counterexample:** remove registration of the new untitled DefinitionProvider, or fail to
include its implementation in the final VSIX. The inspected host tests can still produce 18/25
passing counts: none opens these temporary outputs or resolves their source links. A development
extension run is also permitted by default because the harness only uses an extracted package when
`LIFELOOP_TEST_EXTENSION_PATH` is supplied. Passing counts alone cannot distinguish those cases.

**Violated commitment:** R20 explicitly requires both temporary documents, actual Person/source
navigation in both profiles, proof of Foam absent/present, and the final tested VSIX SHA; R9 requires
the special-definition host case. P2 was explicitly retained in delivery. This blocks final
qualification even though ordinary integration tests may have passed honestly.

**Minimum fix/tests:** extend the existing host suite with the specified temporary-document cases,
using the existing injectable read-only Brief seam, and test literal-`@` precedence plus exact CRLF
target positions in the task-only profile. Package once, inspect inventory/entrypoint, run both
profiles against that extraction, and record SHA/bytes/source tree/commands/results, including the
external fixture revision and remaining skips. Keep old evidence clearly scoped to its old artifact.
**Reuse** the existing harness; no new service or renderer. **Deferral is not permitted** for R20
under the frozen delivery. No real Calendar writes are needed.

### S2 — P2: the promised R2/R3 parity and RED evidence is incomplete

**Evidence/surfaces:** `packages/vscode/test/relationship-parity.test.ts:64`, core relationship tests,
CLI tests, preview tests, and design's RED/GREEN ledger. The discriminating fixture is valuable,
but only `interactions(person, kind, limit: 1)` is driven through every adapter. `people`, `reconnect`,
and `person-context` are inspected directly in core; their recipes merely parse and return `ok`.
Rendered parity checks mostly assert one text substring. The interaction order is not independently
asserted: expected adapter rows are obtained by slicing the same core output under test. No durable
per-gate measured RED result/command is present; the design table is a requirement, not such a receipt.

**Concrete counterexamples:** reverse interaction tie ordering in core and every adapter follows
that same wrong output, leaving the parity test green; drop nested `recentInteractions` only from
the Lua or CLI `person-context` adapter and the all-adapter fixture does not inspect it. Remove
non-text cells from rendered interactions and the single-substring assertions can still pass.

**Violated commitment:** R2/R3 require one discriminating fixture through all named consumers,
exact row shape/omission/null/nesting/filter/order assertions, post-limit counts, and recipe
execution; the ledger requires baseline RED followed by GREEN, not only a final aggregate count.

**Minimum fix/tests:** extend the existing fixture with a small table of the four projections and
independently enumerated expected identities/order/shapes. Assert selected rendered values/order,
not just one substring; assert filtered-out identities stay absent. Carry 0/1 limits through the
relevant adapters. Record baseline replay evidence honestly as retrospective if contemporaneous
RED records cannot be recovered; do not assert historical pre-commit RED without evidence.
**Reuse** existing fixtures/adapters. No generic parity framework is necessary.

### S3 — P2: critical live-state and write-outcome assertions are not exercised as promised

**Evidence/surfaces:** `packages/vscode/test/language-features.test.ts`, `commands.test.ts`,
`apple.test.ts`, `packages/semantic-core/src/mutation.test.ts`, and registration in
`packages/vscode/src/extension.ts:110`.

**Concrete counterexamples and gaps:**

- Remove immediate `publishDiagnostics` from the text-change callback: current relationship
  diagnostics tests still pass because they directly call `relationshipDiagnostics`. R7's actual
  changed-URI event before debounce and “no full reindex” assertion is absent.
- Certify a snapshot while indexing is still in flight: new stale tests only manually increment
  `noteSourceChange`; none holds an index promise barrier across provider reads and settlement.
  Existing task-policy barrier tests do not exercise the new provider generation contract.
- Prompt refusal tests start without a Journal and assert nonexistence. They do not prove an
  existing Journal remains byte-identical, nor exercise the actual Task Actions picker dispatch;
  the “action” case mutates before calling `recordInteraction`. Person-page prompt revalidation
  has no corresponding drift tests. The final task/Person race test changes both together, so
  dropping either one expected-source guard can remain undetected.
- `FaultVault` has one in-memory value and no editor save state. “Applied then threw” therefore
  proves buffer equality only; it cannot establish the committed durable-save condition. It does
  not exercise unreadable outcomes, serial rollback response loss, or successful edit followed by
  failed save. This missing distinction is material to shared `apply` and all callers, not just Log.
- Brief tests assert no output but do not spy on forbidden conflict/observation/Calendar writes.
  Capability-time mutation is tested only by changing task text, not tag/binding/calendar identity.
- R17 only corrupts the diagnostic version, not URI/range/token role/replacement/expected text;
  R11 samples a wrong `expectedText` type but not wrong `ref`/`expectedState` types. R6 checks exact
  `-1` range, while fractional/nonnumeric values are tested only at parser/CLI execution level.

**Violated commitment:** the terminal assertions in R6–R8 and R11–R17, plus the explicit test-matrix
requirement to use controllable barriers for the 400 ms window. This is an evidence finding; it
does not claim every uncovered scenario is currently broken.

**Minimum fix/tests:** use the existing mock event/prompt and Vault seams for a compact table of
discriminating terminal cases. Drive the real change callback with a held indexing promise; seed
an existing Journal; race task and Person separately; simulate edit-success/save-failure; assert
no forbidden calls. Corrupt each diagnostic receipt independently. Freeze the date in the hover
test: its hardcoded next leap birthday of `2028-02-29` currently depends on the wall clock, and
`toContain("due")` also matches `not due` and is not a due-state assertion. **Reuse** and targeted
assertions resolve this; no new scheduler, journaling, recovery framework, or broad fixture layer.

### S4 — P2: the parallel regex classifier contradicts core Interaction semantics

**Evidence/surface:** `packages/vscode/src/retrieval.ts:49–83` (`locatedInteractions`), reused by
diagnostics, hover, and symbols, versus core `relationships.ts:139` (`interactions`).

**Executed counterexample:** create `People/Alice.md` tagged Person and a dated Journal containing:

```markdown
<!--
* Coffee [[People/Alice]] [interaction: coffee]
-->
```

Direct core `interactions` returns `[]`; the provider creates an Event symbol with detail
`counted Interaction`, and hover says `coffee counts as an Interaction`. The classifier scans
raw lines and skips only recognized relationship-query bodies. It does not use core's parser
comment exclusion. Other code fences/inline code and parser-defined direct-link rules are in the
same dependency closure and must be checked, not silently assumed equivalent.

**Violated commitment:** core owns Interaction inclusion; R5/R18 and P1 hover/P2 symbols must match
core, including excluded entries. This misstates whether contact work was recorded.

**Minimum fix/tests:** **remove** the duplicate semantic inference. Reuse the existing live parser
item extraction/classification, retaining offsets for provider ranges, and share the minimal pure
inclusion decision with core. Assert exact correspondence for comments, fenced examples, inline
code, custom/empty kinds, direct/inherited links and date exclusions. Do not introduce a generic
LanguageService or copy another parser into the extension. This is reuse/simplification, not a
request for new scope.

### S5 — P2: valid quoted YAML relationship facts lose semantic hover

**Evidence/surface:** `packages/vscode/src/retrieval.ts:260–274`. Birthday and cadence hover pass
raw token text to `birthday`/`cadence`, although `livePage` already contains the parsed YAML values.

**Executed counterexample:** valid Person frontmatter with `birthday: "02-29"` and
`contact-every: "30d"` yields no birthday or cadence hover. Core accepts both parsed strings and
derives relationship facts normally. Unquoted fixture values conceal the discrepancy.

**Violated commitment:** P1 hover explains strict birthday/cadence semantics, and core remains the
semantic authority. Quoting a YAML string must not remove a valid feature.

**Minimum fix/tests:** keep raw token offsets for ranges but pass `livePage.birthday` and
`livePage["contact-every"]` to the existing validators. Add quoted/unquoted equivalence cases,
including scalar comments. **Reuse** the already parsed values; two substitutions suffice for the
core defect, with no YAML scanner abstraction.

### S6 — P2: query providers overstep their allowed projection/value scope

**Evidence/surfaces:** `packages/vscode/src/retrieval.ts:91–103` and
`packages/vscode/src/query-lens.ts:72–84`.

**Executed counterexamples:** a `lifeloop` fence with projection `actionable` and
`person: People/Alice` returns a Person definition; a `query` fence with projection `people` and
`kind:` offers `call`, `meeting`, `message`, `other`, even though `people` accepts no semantic
arguments. `definitions` checks only the fence and key, while `kind` completion lacks the
projection-argument guard already present for `person` completion.

**Violated commitment:** P0 definitions own exact `person:` values only in recognized relationship
queries; completion offers only legal arguments/value positions for the selected projection.

**Minimum fix/tests:** **reuse** `relationshipProjectionNames`/`allowedArgs` before the existing
definition/kind branches. Add negative cases for legacy/unknown projections and illegal keys on
each relationship projection; test closing-fence/body boundaries too. No new grammar or capability
branch is needed.

## Exhaustive R1–R20 evidence mapping

“Partial” below is an explicit blocked claim, not a sampled PASS. Test paths are repository-relative.

| Gate | Implementation and executable evidence | Assessment |
|---|---|---|
| R1 | `contract.ts` static allowed/required args and `validateRelationshipProjectionArgs`; core `relationships.test.ts` invalid/legacy cases | Covered for enumerated rejects; independent unit run passed. No legacy contract tightening found in this validator. |
| R2 | `runQueryBlock`, query hover/CodeLens, Lua host, `bakeAt`, CLI; `relationship-parity.test.ts`, CLI limits, preview invalid limits | Partial, S2/S3: only interactions crosses every adapter, independent order/render value assertions and every requested exact invalid-limit diagnostic missing. |
| R3 | `personRows`, `interactionRows`, `reconnectRows`, `personContextRows`; exact-key core tests and four README recipes | Partial, S2: omitted optional keys, null-first reconnect/tie order and ten nested rows have direct coverage; full all-projection adapter/order evidence absent. |
| R4 | `cadence` finite/safe-integer/date probe; core overflow test; provider Information path | Core overflow check passes; no executable provider overflow Information assertion. Included in S3 closure. |
| R5 | custom strings retained in core; empty kind excluded; provider Information | Basic custom/empty tests pass, but provider/core inclusion equivalence is broken by S4 and severity assertions are incomplete. |
| R6 | `query-language.ts` shared located parser/finder, preview parser, query completions and diagnostics | Matching marker lengths, aliases, CRLF/UTF-16 tokens tested. Partial for exact fractional/nonnumeric diagnostic ranges, inert nested Markdown, and value scope (S3/S6). |
| R7 | immediate `publishDiagnostics` callback before delayed `touch` | No callback/debounce/barrier/no-reindex test. Direct diagnostics tests are not this event boundary (S3). The callback currently rescans the vault; it does not itself call full reindex. |
| R8 | `sourceRevision`/`indexedRevision`, `indexIsSettled`, live `exactPerson`, action refresh | Manual invalidation tests cover action/derived hover; definition test covers exact success only. In-flight matching-generation and live Person removal definition cases absent (S3). |
| R9 | literal file check before special refs in `definitions`; `resolveTarget`/`resolveRef` | Unit literal-at/CRLF cases pass. Host suite tests old explicit SB command and Foam ordinary literal page, not new definition in both profiles (S1). |
| R10 | `taskSourceRef`, `indexedTask`, `taskTarget` normalization; core handle guards | Focused tests cover moved numeric refusal, live CRLF, indentation, unique moved anchor. Source-ref temporary conversion tested as string output. Host exact temporary target outstanding. |
| R11 | runtime `taskHandle` requires all three strings; provided handle resolved regardless of presentation fields | Unit receipt omission/wrong-text type and current handle+stale coordinates pass. Stale-handle-plus-presentation and other runtime type cases not directly asserted (S3). |
| R12 | `recordInteraction.current/refresh` before/after pickers; selected direct Person subset/event check | Four prompt boundary samples pass; existing Journal bytes, actual Task Actions picker dispatch, Person-page drift and cross-boundary variants missing (S3). |
| R13 | `logInteraction` one expected map for task/People/Journal; editor dirty Journal guard | Dirty test checks no save/disk unchanged; combined task+Person race passes. Independent guard counterexamples and dirty buffer contents/save state not all discriminated (S3). |
| R14 | shared `apply` whole-file observations and serial rollback | Before/after/third single-memory-file outcomes pass. Durable editor save, unreadable and rollback-uncertain states remain unproved; full consumer dependency closure required (S3). |
| R15 | `validateBrief` before capability, after capability, after read; sealed handle/UID/calendar/People | Missing binding before capability and task-text change after capability, then four read-time mutations pass. Capability-time variants/no-output for every forbidden side-effect need closure (S3). |
| R16 | additive `Calendar.readExact`; missing/ambiguous/found union and Brief final validation | Bridge exact UID args/duplicate/missing and fake missing/ambiguous/throw/success pass. No external Apple smoke; forbidden state-write assertions not present. |
| R17 | empty edit + existing command actions; `applyDiagnosticFix` URI/version/range/token/text/replacement recheck | Basic action list/empty edits and stale version pass. Remaining independently corrupted receipts absent (S3). |
| R18 | shared `locatedInteractions`, task/direct/inherited hover and Journal Event symbols | Basic live CRLF symbols, ordinary-link no-hover and custom/empty examples pass. Comment semantic disagreement and quoted YAML hover failures (S4/S5). |
| R19 | `personLink` standard escaped file URI; `sourceLink` one numeric CRLF conversion; `toNavigableMarkdown` only full results, Brief optional links | Unit tests assert Person/source strings and unchanged raw/hover renderer. Actual URI/source navigation and anchored follow-up presentation not certified; R20 remains open. |
| R20 | registered untitled definitions, open-query command, default Brief untitled open, existing packaged-harness override | Missing required executable tests and artifact binding; NOT QUALIFIED (S1). |

## P0/P1/P2 requirement and scope disposition

- **P0 query completion/diagnostics/definitions:** implemented with static core metadata and native
  providers, but negative projection/value scope, parser-equivalent Interaction classification,
  immediate event freshness, and complete exact-token evidence require S3/S4/S6 closure.
- **P0 Log Interaction/Brief:** guard/refresh/expected-source and sealed exact-read implementation
  is present; fake tests cover meaningful refusals and one complete success. This review does not
  substitute those tests for the authority review, durable-save proof, or missing R12–R16 cases.
- **P0 versioning:** semantic contract stays `1.1.0`, extension stays `0.1.0`, consistent with design.
- **P1 task actions:** existing commands reused, guarded handles passed, empty edits asserted;
  mutation authority remains in commands/core. No provider-created writable task edit found.
- **P1 semantic hover:** ordinary wikilinks relinquished and no Calendar calls on hover. S4/S5
  block equivalence for Interaction and valid YAML facts. Task direct/inherited example is covered.
- **P1 parity/recipes:** all four recipes exist and execute; S2 qualifies the stronger parity claim.
- **P2 Interaction symbols:** native Event symbols added; current regex classification is wrong
  for commented examples (S4). No generic heading/WorkspaceSymbol feature added.
- **P2 deterministic fixes:** command-backed, runtime receipts validated, no intent-inventing
  date/Person/kind fixes. Negative receipt evidence requires S3 closure.
- **P2 temporary navigation:** small standard file-link/SB-ref helpers, no renderer/cache/UI subsystem;
  string evidence exists but final actual packaged navigation remains required (S1).

## Dependency closure and YAGNI disposition

The selected structure is mostly restrained: no LSP, generic schema engine, new dependency,
webview, detail screen, retained result cache, attendee inference, title matching, or Calendar
write from Brief was added. Metadata belongs at the existing contract seam; commands reuse the
existing mutation path; optional Brief I/O functions are justified test seams. The 25-line link
helper is shared by exactly the two requested temporary outputs and is not speculative machinery.

The six added `bind.ts` lines are justified dependency closure from `apply` returning `unknown`:
the old compensation branch must not delete an external item whose binding might have applied.
They do not by themselves justify redesigning binding or Calendar synchronization. The additive
exact reader leaves `Calendar.read` and `updateSummary` unchanged. Formal Calendar Sync/Resolve
duplicate-UID/calendar-switch **P1 debt remains explicitly out of scope**; this report does not
ask to expand the feature or certify that subsystem.

The main avoidable complexity is S4's second semantic parser: it adds divergent rules despite
the repository's stated reason for retaining the existing parser. Reuse that seam before adding
more regex exclusions. Immediate diagnostics currently scans every page on every Markdown change;
a changed-URI update using the existing collection is a smaller natural seam if corrected during
R7 work, but no new incremental indexing subsystem is warranted.

No new package dependencies, source fixtures, vendored modifications, normal branch commits,
or product source edits were introduced by this review. Product `.vscodeignore` excludes tests,
TypeScript sources, maps and node_modules. The host harness copies its tests/dependency link into
an extracted extension only when explicitly requested; that does not certify the original VSIX
inventory. The old packaged evidence remains historical. Final qualification must inspect the
new artifact rather than infer its contents from these exclusions.

All previous design closure subjects were examined: strict legacy-vs-relationship argument
boundary, custom kinds, null-first ordering/omission, matching fence markers, live CRLF handles,
Information severity, pre-capability Brief checks, exact UID ambiguity, file-URI Person links,
invalid limits, and explicit Calendar debt. No CLEAN claim is made for missing evidence or
unreviewed patches. Consolidate S1–S6 with the other independent reports, fix at existing seams,
freeze a new digest, and rerun the listed counterexamples plus the shared mutation/provider
dependency closure before qualification.
