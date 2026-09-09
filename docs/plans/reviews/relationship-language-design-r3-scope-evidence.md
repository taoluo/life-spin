# Relationship language design revision 3 — scope/evidence closure review

Status: completed independent final closure review; durability capture only.

- Frozen artifact: `docs/plans/2026-09-09-relationship-language-features.md`
- Frozen SHA-256: `8e08bcefd171dace55c2fc545bf7abe57f9c88040d398fa4b6c3523597fafd21`
- Recovery ref: `refs/codex/recovery/relationship-language-design-r3-20260909`
- Recovery commit: `bb48f3abae76cb78a79dfb2956eeb9b7078a0555`
- Reviewer scope: independent final scope/evidence/testability closure review
- Model: GPT-5 (Codex)
- Reasoning effort: high
- Result: **CLEAN — 0 P0, 0 P1, 0 P2 findings**

The working artifact and recovery-ref copy were independently read and verified against the frozen
digest before review. The frozen design was not edited. The review replayed every revision-1 and
revision-2 scope/evidence counterexample, R1–R20, adjudicated C5/C6, the full P0–P2 delivery, and the
patch-induced dependency closure. No review stopped at an early candidate finding.

`CLEAN` applies to this frozen design's scope and executable evidence contract. It does not claim
that the unimplemented baseline already passes the RED/GREEN ledger, nor does it certify the
explicitly deferred formal Calendar Sync/Resolve mutation debt.

## Revision-1 scope/evidence replay

| Prior finding | Revision-3 disposition | Closure evidence |
|---|---|---|
| F1 — ordinary `@` filename precedence | **CLOSED** | Lines 122–127 preserve literal `X@Y.md` ownership before special-ref parsing. R9 executes literal-page and CRLF special-ref cases in task-only and Foam hosts. |
| F2 — immediate live diagnostics lifecycle | **CLOSED** | Lines 142–151 and 201–203 separate current-document lexical work from settled index semantics. R7 requires immediate changed-URI updates and proves the lexical path does not trigger a full reindex. |
| F3 — existing `query` fence alias | **CLOSED** | Lines 176–181 and 192–197 put `lifeloop` and `query` through one located parser. R6 exercises both aliases rather than introducing a second grammar. |
| F4 — executable RED/GREEN and packaged evidence | **CLOSED** | Lines 344–384 provide a baseline-bound R1–R20 ledger, exact terminal assertions, named gates, no-fixed-sleep barriers, mandatory P2 disposition, optional-real-Apple `NOT COVERED`, and final tested-VSIX SHA-256 binding. R20 proves both packaged host profiles rather than development-host presence. |
| F5 — temporary-output presentation contract | **CLOSED** | Lines 314–319 isolate navigation to full result/Brief, use universal escaped file-URI Person links, retain SB refs for sources, and leave raw/preview/CLI/hover content unchanged. The DefinitionProvider includes file and untitled Markdown at lines 223–227. R19/R20 resolve actual targets. |
| F6 — `kind`/`limit` strictness | **CLOSED** | Lines 67–69 retain arbitrary non-empty custom kinds while excluding empty kinds. Lines 87–89 require non-negative-integer adapter limits. R2, R5, R6, and lines 377–384 bind custom-kind inclusion, malformed-limit refusal, exact Error token ranges, CLI nonzero exit, and no successful result rows. |
| F7 — freshness scope conflict | **CLOSED** | Lines 142–167 define lexical, settled-derived, and authority-sensitive levels; exact definition uses live-vault verification without global reindex. R7/R8 and R15 distinguish these levels with controlled barriers and pre-capability refusal. |

The revision-1 solution remains the smallest compatible one: narrow direct Providers, static
relationship metadata, existing command paths, and the current host/test infrastructure. No LSP,
generic LanguageService, schema engine, global lexical reindex, alternate renderer, or new recovery
layer is introduced.

## Revision-2 scope findings and C5/C6

### R2-S1 / C2 — exact public shapes, parity, and recipes: CLOSED

Lines 73–89 now state exact public keys, omission semantics, nested public Interaction rows, the
ten-row maximum, and deterministic null-first reconnect ordering. R2/R3 and lines 377–384 require a
single discriminating fixture with omitted optionals, explicit null, tied overdue People, more than
ten Interactions, custom kinds, and filtered-out rows. Exact keys, order, null, absence rather than
`undefined`, nesting, bounds, and filtering are asserted.

That fixture reaches direct core, preview/query, query hover, CodeLens count, bake, SLIQ/Lua, and CLI.
Raw consumers deep-equal exact rows; rendered consumers preserve selected values and order; CodeLens
uses the post-limit count. The four People, Interaction timeline, due reconnect, and Person Context
documentation recipes are each parsed and executed. A uniformly wrong core or an absent adapter or
recipe can no longer satisfy R2/R3.

### R2-S2 / C5 — navigation without Foam: CLOSED

Lines 314–319 select one escaped standard Markdown file-URI representation for canonical People in
every runtime. There is no build-time or runtime Foam branch. R19 verifies presentation isolation and
exact Person/SB targets; R20 opens both temporary documents and resolves those links in the packaged
task-only host with Foam proved absent and the pinned Foam `0.44.6` host with Foam proved present.
The results are bound to the tested VSIX digest by lines 346–348. This closes both the emitted-link
and actual-navigation counterexamples without taking over ordinary wikilinks.

### R2-S3 / C6 — malformed-limit evidence: CLOSED

R2 requires positive `0`/`1` behavior plus negative, nonnumeric, and fractional editor/CLI refusal.
R6 binds editor Error severity to the exact live value token. Lines 377–384 additionally require no
editor result execution, CLI nonzero exit, an actionable CLI error, and no successful JSON rows.
`limit` remains presentation-owned; the correction reuses one validator and existing adapter/CLI
harnesses instead of moving it into semantic-core projection arguments or adding schema machinery.

## R1–R20 final closure map

| Row | Disposition | Required falsifiable result |
|---|---|---|
| R1 | **CLOSED** | Relationship-only unknown arguments, malformed/reversed dates, and missing Person refuse rather than returning misleading rows. |
| R2 | **CLOSED** | One discriminating fixture reaches every promised consumer; `limit` 0/1 applies and malformed editor/CLI values refuse with no result. |
| R3 | **CLOSED** | Exact public keys/order/null/omission/nesting/filtering/ten-row bound and four executable recipes are asserted. |
| R4 | **CLOSED** | Overflow cadence is excluded before date shifting and has the shared Information severity. |
| R5 | **CLOSED** | Custom `coffee` counts without a diagnostic; empty kind is excluded with Information. |
| R6 | **CLOSED** | Both aliases, same-marker/minimum-length fence closes, mixed/short body runs, CRLF/astral ranges, exact invalid-limit tokens, and positive completion position are exercised. |
| R7 | **CLOSED** | Birthday/cadence/Interaction lexical diagnostics update immediately without full reindex or fixed sleeps. |
| R8 | **CLOSED** | A stale snapshot cannot preserve Person identity removed from the live buffer for definition, action, or derived hover. |
| R9 | **CLOSED** | Literal `Ordinary@anchor.md` stays Foam-owned; otherwise special anchor navigation is exact under CRLF in both hosts. |
| R10 | **CLOSED** | Valid unchanged CRLF task and moved unique CRLF anchor succeed; moved numeric retarget and every double-translation path refuse. |
| R11 | **CLOSED** | Indexed ref is normalized once to equal the live handle; stale/missing/wrongly typed receipts refuse with no write. |
| R12 | **CLOSED** | Mutation after each Log prompt of task/link/Person/default event leaves the Journal byte-identical. |
| R13 | **CLOSED** | Task/Person final races and dirty Journal neither write nor save the Journal. |
| R14 | **CLOSED** | Before-throw, applied-then-throw, and third-state writes terminate as not-applied, success, or `UNKNOWN` without unsafe retry. |
| R15 | **CLOSED** | Pre-invocation ineligibility causes zero app/reader calls; post-app and during-read authority changes open nothing. |
| R16 | **CLOSED** | Exact-UID duplicate/missing/failure opens nothing and writes no Brief conflict state; success requests one UID. |
| R17 | **CLOSED** | Every task/diagnostic action is command-backed with empty `edit`; stale diagnostic receipts refuse. |
| R18 | **CLOSED** | Custom/empty Interaction hover and symbols share core classification; ordinary wikilinks receive no LifeLoop hover. |
| R19 | **CLOSED** | Navigation appears only in full result/Brief; standard Person and CRLF source targets resolve exactly while raw/CLI/hover stays unchanged. |
| R20 | **CLOSED** | The exact final VSIX opens both documents and resolves both link classes in task-only and Foam `0.44.6`, proving Foam absence/presence and recording the VSIX SHA-256. |

R1–R20 collectively cover positive behavior and the decisive negative counterexamples; the adjacent
P0–P2 prose supplies the exact feature contract rather than allowing vacuous provider tests. The
existing semantic-core Vitest, VS Code mock/provider, Calendar fake, CLI process, bake, Lua/SLIQ,
task-only extension-host, Foam extension-host, and package-evidence mechanisms are sufficient.

## Full P0–P2 scope check

| Delivery surface | Evidence closure |
|---|---|
| P0 completion | Static relationship projection/argument/field/kind metadata is bounded by lines 192–197; R1–R3/R6 cover strict metadata, aliases, value position, ranges, and positive/negative limit behavior. |
| P0 diagnostics | Lines 201–219 define source, freshness, complete relationship reasons, exact token targeting, and the Error/Information/no-diagnostic map; R1 and R4–R8/R17 make it observable. |
| P0 definitions | Lines 122–127 and 223–227 bind literal-page precedence, exact Person identity, special refs, selectors, and negative ownership; R8/R9/R19/R20 exercise live and packaged cases. |
| P0 Log Interaction | Lines 229–241 retain and revalidate identity after every prompt and include task/People/Journal receipts in the final atomic ChangeSet; R10–R14 cover races, dirty targets, and response loss. |
| P0 restricted Brief | Lines 243–255 validate before app access and after each boundary, use one exact reader, refuse all non-unique/failure/change cases, and open no partial output; R15/R16/R20 cover those terminals. |
| P0 version | Lines 257–262 retain the already-present additive `1.1.0` semantic contract and unchanged extension package version; no second version change is introduced by editor Providers. |
| P1 task actions | Lines 266–272 enumerate commands, eligibility, guarded handles, and empty edits; R8/R11–R13/R17 cover freshness, receipts, action form, and refusal. |
| P1 semantic hover | Lines 274–284 restrict hover to LifeLoop syntax and forbid Calendar/ordinary-wikilink ownership; R2/R4/R5/R7/R8/R18 cover parity, classification, freshness, and non-takeover. |
| P1 parity/recipes | Lines 286–292 and R2/R3 plus their detailed fixture contract prove every named consumer and all four recipes without a new DSL/renderer. |
| P2 Interaction symbols | Lines 296–301 require every explicit Interaction, live ranges, counted state, and no heading takeover; R5/R7/R18 cover custom, invalid, live, and core-parity cases. |
| P2 diagnostic actions | Lines 303–310 restrict fixes to unique case-only spellings, use commands with complete receipts, and forbid inferred fixes; R6/R17 exercise exact ranges and stale refusal. |
| P2 temporary navigation | Lines 312–319 plus R19/R20 prove presentation-only Person/source navigation in both final packaged profiles. |

No requested P0–P2 item is silently deferred. R17–R20 remain mandatory because the design explicitly
retains P2. Optional live Apple and Foam availability can be reported `NOT COVERED`, but a skipped
required packaged R20 profile cannot be represented as GREEN or PASS.

## Patch-induced dependency closure and scope discipline

- The live-coordinate task-ref correction is bounded to task-command handle comparison. Parser refs
  remain internal, Interaction presentation performs its own single conversion, cursor handles are
  already live, and handwritten numeric SB refs retain existing meaning. R10/R11 catch omission and
  double conversion.
- The public-row correction preserves the existing shared `runProjection` route and adds exact
  assertions rather than adapter sorting, new state, or a schema engine.
- Fence correction adds only opener character/run-length receipts to the one located parser and
  feeds every consumer. R6 catches opposite markers, shorter same markers, valid closes, and
  CRLF/UTF-16 drift.
- Information severity remains one shared classifier mapping. It does not create provider-specific
  policies or reinterpret arbitrary custom kinds.
- Brief validation is reused before each capability/output boundary. It performs no Calendar or
  Markdown mutation, never recommends Resolve, and cannot reach formal Sync/Resolve. The additive
  exact reader keeps the accepted sealed-calendar/duplicate-safe mutation defect explicitly outside
  this design. Lines 114–118 make that debt blocking if implementation instead changes a shared
  Sync/Resolve read/update API or behavior.
- Universal file-URI Person links eliminate both qualification-time and runtime Foam branching;
  ordinary Foam navigation remains host-owned.
- Strict `limit` remains presentation-owned and uses existing parser/CLI gates. It does not broaden
  strict argument behavior to legacy projections.

The explicit out-of-scope list remains coherent with the delivery and evidence ledger. No patch
correction adds an LSP, reusable LanguageService, generic schema/DSL, ordinary wikilink provider,
provider-wide reindex, Calendar cancellation inference, Brief conflict persistence, runtime Foam
branch, saved brief, cache, Webview, analytics surface, retry/takeover, or recovery subsystem.

## Final disposition

Revision 3 closes every prior scope/evidence counterexample with specific reuse of existing code and
test surfaces. The stronger ledger is precise enough to fail a uniformly wrong public projection,
missing documentation recipe, malformed limit, dead task-only Person link, wrong fence grammar,
stale authority result, or unbound development-only package test. No additional scope/evidence
finding remains for this frozen artifact.
