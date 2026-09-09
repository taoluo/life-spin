# Relationship language design revision 2 — scope/evidence closure review

Status: completed independent closure review; durability capture only.

- Frozen artifact: `docs/plans/2026-09-09-relationship-language-features.md`
- Frozen SHA-256: `9d9d168b84cdf9d948e76bd6dee8c1b67ee2a5af1cd1601f64e32b7243068c9c`
- Recovery ref: `refs/codex/recovery/relationship-language-design-r2-20260909`
- Recovery commit: `70b0ba6e0a05b8833b1028b4d37736d22c36fe0a`
- Reviewer scope: independent scope/evidence/testability closure review
- Model: GPT-5 (Codex)
- Reasoning effort: high
- Result: **NOT CLEAN — 0 P0, 1 P1, 2 P2 findings**

The working copy and recovery-ref copy were independently verified against the frozen digest before
review. The frozen design was not edited. Revision 2 closes the main semantics of the seven prior
scope/evidence findings, but its executable evidence ledger still permits the counterexamples below.
Review continued through all prior findings and R1–R20 after the remaining P1 was identified.

## Findings

### R2-S1 — P1: the projection contract and parity evidence are not complete enough to prove the promised public surface

- **Concrete counterexample:** an implementation can pass R2 and R3 while returning a `people` row
  whose optional keys exist with `undefined` values, because R3 asserts only that `offset` is absent.
  The same implementation can expose a nested recent Interaction with another extra key, return more
  than ten `recentInteractions`, or drift from a declared sort order while every named R2 consumer
  agrees on the same wrong rows. Separately, R2 exercises only core, preview, Lua, and CLI, although
  lines 276–280 promise query hover, CodeLens, baked Markdown, and documentation recipes as well, and
  the upstream data-surfaces contract requires SLIQ/Lua and bake parity. All R1–R20 can therefore pass
  even if those adapters drift or the four promised recipes are absent or invalid.
- **Violated invariant:** contract `1.1.0` freezes exact normalized row shapes, optional-field omission,
  nesting, bounds, filtering, and ordering; every named consumer must derive the same rows, and each
  promised recipe must be executable evidence rather than unchecked prose.
- **Evidence:** design lines 70–89 define the shared path and frozen public shapes; lines 276–280 name
  the full parity and recipe commitment; test-matrix line 324 names several of those consumers, but R2
  narrows the executable gate to core/preview/Lua/CLI and R3 checks only `offset`. Upstream
  `relationship-data-surfaces.md` lines 436–438 require direct core, preview, SLIQ/Lua, and baked
  Markdown parity. The current baseline illustrates the missed shape failure: `personRows` constructs
  optional properties with `undefined`, and `personContextRows` nests the internal Interaction type.
- **Minimal correct fix:** strengthen R2/R3 rather than adding architecture. Assert exact
  `Object.keys`, omitted optionals, `null`, complete nested public rows, ten-row maximum, filtering,
  and declared order. Drive one deliberately discriminating fixture through direct core, preview,
  query hover, CodeLens count, baked Markdown, `lifeloop.*` through SLIQ/Lua, and CLI JSON. Add a
  parse-and-execute assertion for each of the People, Interaction timeline, due reconnect, and Person
  Context documentation recipes.
- **Affected surfaces/tests:** semantic-core projection tests; preview/query, hover, CodeLens, bake,
  Lua/SLIQ, and CLI harnesses; relationship documentation examples; R2 and R3.
- **Disposition:** **reuse + simplification** — reuse the existing Vitest, preview, bake, Lua/SLIQ,
  and CLI fixtures. Do not add a schema engine, golden-file framework, or second execution path.

### R2-S2 — P2: temporary Person navigation is selected at qualification time instead of guaranteed in the task-only runtime

- **Concrete counterexample:** the Foam `0.44.6` qualification host proves that ordinary wikilinks in
  an untitled result are owned there, so the shipped renderer chooses `[[People/Alice]]`. The same
  packaged VSIX then runs in the required task-only profile where Foam is absent. Nothing in lines
  302–305 or R20 changes the representation at runtime, so the Person link can be dead even though P2
  claims temporary-result navigation. R19 is unit-only, while R20's task-only assertion names
  ownership rather than opening both temporary documents and resolving their Person and source links.
- **Violated invariant:** the full query result and successful Brief must provide working navigation
  in each supported packaged host profile; optional Foam installation cannot be a hidden runtime
  precondition for a LifeLoop-owned P2 result.
- **Minimal correct fix:** use standard escaped Markdown file-URI links for temporary Person
  navigation in all profiles. If Foam-specific wikilinks are retained, gate them on actual runtime
  Foam presence and test both branches. In either case, extend the packaged task-only and Foam gates
  to open both the full result and Brief, then resolve a Person link and an SB source link to the exact
  target.
- **Affected surfaces/tests:** full-result and Brief presentation formatter, runtime Foam capability
  check if retained, R19, R20, task-only packaged integration, and Foam packaged integration.
- **Disposition:** **simplification preferred** — one standard Markdown link form avoids runtime
  ownership branching. No Webview, cache, saved result page, or alternate renderer is needed.

### R2-S3 — P2: strict `limit` behavior has no RED rejection case or token-diagnostic assertion

- **Concrete counterexample:** a query adapter can accept `limit: -1` and apply `slice(0, -1)`, accept
  `limit: nope` as `NaN`, or truncate a fractional value, while R2 still passes because it checks only
  that `--limit 1` is applied. The CLI can likewise accept negative, nonnumeric, or fractional
  `--limit` values. No R row requires rejection or proves that an editor diagnostic selects the exact
  invalid value token.
- **Violated invariant:** lines 87–89 require every adapter to validate `limit` as a non-negative
  integer, and lines 204–207 classify invalid `limit` as an Error. Completion, parsing, diagnostics,
  execution, and CLI behavior must share that contract so malformed input cannot silently change row
  selection.
- **Minimal correct fix:** extend R2 or R6 with query-adapter cases for `limit: -1`, `limit: nope`, and
  a fractional limit, requiring refusal plus the exact value-token Error range. Add equivalent CLI
  cases that require a nonzero result and an actionable diagnostic. Reuse the located parser and
  static projection metadata; do not add a schema engine.
- **Affected surfaces/tests:** query parser/adapter, diagnostics, CLI argument handling, completion
  contract snapshots, and R2 or R6.
- **Disposition:** **reuse** — a small shared integer validator and existing parser/CLI test harnesses
  are sufficient.

## Prior F1–F7 closure

| Prior finding | Disposition | Revision-2 evidence / remaining gap |
|---|---|---|
| F1 — ordinary `@` filename precedence | **CLOSED** | Lines 118–120 and 213–217 define literal-page precedence and narrow ownership; R9 supplies task-only/Foam evidence. |
| F2 — immediate live diagnostics lifecycle | **CLOSED** | Lines 191–193 separate immediate lexical recomputation from settled identity semantics; R7 makes the no-debounce/no-reindex case executable. |
| F3 — existing `query` fence alias | **CLOSED** | Lines 168–182 require one located parser and both aliases; R6 exercises both. |
| F4 — executable red/green and packaged evidence ledger | **PARTIALLY CLOSED** | R1–R20 provide baseline, terminal assertions, gates, VSIX hash binding, and explicit skip disposition. R2-S1 remains because exact public shapes, all promised consumers, and executable documentation recipes are not completely bound. |
| F5 — temporary-output presentation contract | **PARTIALLY CLOSED** | Lines 302–307 isolate navigation to full result/Brief and preserve raw/hover rows; file/untitled selectors are explicit. R2-S2 remains because a Foam qualification result can select dead links for the task-only runtime. |
| F6 — `kind`/`limit` strictness | **PARTIALLY CLOSED** | Lines 67–69 and R5 correctly preserve custom non-empty kinds and exclude empty kinds. Lines 87–89 accept strict non-negative-integer `limit`, but R2-S3 shows that no RED row proves its rejection/diagnostic behavior. |
| F7 — freshness scope conflict | **CLOSED** | Lines 134–159 define three freshness levels; R7 and R8 distinguish live lexical work, settled derived semantics, and authority-sensitive refresh without fixed sleeps. |

## R1–R20 closure map

| Ledger row | Scope/evidence disposition | Notes |
|---|---|---|
| R1 | **ADEQUATE for its named cases** | Strict relationship arguments, dates/ranges, and Person identity are falsifiable; invalid `limit` remains a separate ledger omission in R2-S3. |
| R2 | **PARTIAL** | Positive `--limit 1` and four consumers are covered, but exact public shapes and the complete promised consumer set are not; see R2-S1 and R2-S3. |
| R3 | **PARTIAL** | Public `offset` removal is covered, but exact keys, optional omission, nesting, bounds, and order are not; see R2-S1. |
| R4 | **ADEQUATE for its named counterexample** | Overflow cadence has a terminal exclusion/diagnostic assertion. Diagnostic-policy correctness is evaluated separately by the data/API closure review. |
| R5 | **ADEQUATE for its named counterexamples** | Custom non-empty and empty-kind classification are both explicit. Diagnostic-policy correctness is evaluated separately by the data/API closure review. |
| R6 | **ADEQUATE for prior scope closure** | Both aliases and the principal fence/range cases are named. It is also the smallest existing gate to extend for R2-S3. Fence grammar correctness is evaluated separately by the data/API closure review. |
| R7 | **ADEQUATE** | Proves immediate lexical updates without using full reindex as the correctness boundary. |
| R8 | **ADEQUATE** | Proves stale index cannot outrank removed live Person identity. |
| R9 | **ADEQUATE** | Proves literal `@` ownership and special-ref CRLF exactness across required hosts. |
| R10 | **ADEQUATE** | Distinguishes strict numeric receipt from permitted unique-anchor relocation. |
| R11 | **ADEQUATE** | Covers missing, stale, and wrongly typed guarded-source receipts. |
| R12 | **ADEQUATE** | Uses prompt-boundary mutations and byte-identical Journal postconditions. |
| R13 | **ADEQUATE** | Covers final Person/task races and dirty-Journal no-write/no-save behavior. |
| R14 | **ADEQUATE** | Exercises not-applied, applied, and `UNKNOWN` reconciliation without unsafe retry. |
| R15 | **ADEQUATE** | Mutates every sealed Brief authority input at app/read boundaries and requires no output. |
| R16 | **ADEQUATE** | Covers exact-UID duplicate/missing/failure/success and forbids Brief conflict writes. |
| R17 | **ADEQUATE** | Binds command-only actions and stale diagnostic receipt refusal. |
| R18 | **ADEQUATE** | Covers custom/empty Interaction presentation and ordinary-wikilink non-ownership. |
| R19 | **PARTIAL** | Presentation isolation and CRLF target correctness are covered at unit level, but actual Person/source navigation in each packaged host is not; see R2-S2. |
| R20 | **PARTIAL** | VSIX SHA binding and host coexistence are explicit, but the task-only clause does not prove temporary Person/SB navigation; see R2-S2. |

## Closure conclusion

Revision 2 closes the previously missing ownership precedence, live diagnostic lifecycle, fence alias,
guarded freshness, custom-kind compatibility, and presentation-isolation semantics without adding an
LSP, generic schema engine, alternate renderer, or recovery subsystem. The remaining work is evidence
and one presentation choice: strengthen existing parity/shape fixtures, make temporary Person links
work in the task-only runtime, and add strict invalid-`limit` RED cases. Because the first gap permits
an incorrect public `1.1.0` contract to pass all named gates, revision 2 is not CLEAN.
