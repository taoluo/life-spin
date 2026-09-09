# Relationship language design revision 2 — data/API/editor correctness closure review

Status: completed independent closure review; durability capture only.

- Frozen artifact: `docs/plans/2026-09-09-relationship-language-features.md`
- Frozen SHA-256: `9d9d168b84cdf9d948e76bd6dee8c1b67ee2a5af1cd1601f64e32b7243068c9c`
- Recovery ref: `refs/codex/recovery/relationship-language-design-r2-20260909`
- Recovery commit: `70b0ba6e0a05b8833b1028b4d37736d22c36fe0a`
- Model: inherited parent model; exact runtime model identifier was not exposed to the reviewer
- Reasoning effort: high
- Result: **NOT CLEAN — 0 P0, 3 P1, 0 P2 findings**

The working copy and recovery-ref copy were independently read and matched the frozen digest before
review. The frozen design was not edited. Review continued through all prior F1–F7 findings and the
dependency closure after the first remaining P1.

## Prior finding closure

| Prior finding | Disposition | Evidence / remaining dependency |
|---|---|---|
| F1 — relationship arguments and consumer parity | **CLOSED** | Lines 63–89 make only the four relationship projections strict, keep `fields`/`limit` in adapters, require non-negative integer limits, and stop CLI/Lua default injection. Lines 276–280 and R1–R2 bind parity and CLI limit behavior. |
| F2 — public schemas and internal `offset` leak | **PARTIALLY CLOSED** | Lines 73–83 freeze the four shapes, omit optionals, and remove public offsets; R3 covers both interaction locations. The `reconnect` null sort position remains ambiguous (R2-F1). |
| F3 — shared classification and custom-kind semantics | **PARTIALLY CLOSED** | Lines 63–70 put validation/classification in core, preserve all non-empty custom kinds, and R4 covers cadence overflow. The diagnostic severity contradicts the authoritative post-r1 correction (R2-F2). |
| F4 — one located query parser and fence parity | **PARTIALLY CLOSED** | Lines 168–176 specify one located parser, both aliases, long backtick/tilde fences, CRLF, and UTF-16 coordinates. They do not seal the closing marker character, and R6 omits the mixed-marker counterexample (R2-F3). |
| F5 — indexed Interaction ref coordinates | **CLOSED** | Lines 172–176 restrict the one-time `originalSourceOffset` conversion to presentation links and retain raw numeric-ref semantics; R19 tests the boundary. |
| F6 — unsupported Calendar cancellation claim | **CLOSED** | Lines 108–113 remove the cancellation claim and define exact `found | missing | ambiguous` reads; R16 covers duplicate, missing, failure, single-UID success, and no Brief conflict write. |
| F7 — temporary Person-link ownership | **CLOSED** | Lines 302–307 condition wikilinks on the pinned Foam host result and otherwise require standard file-URI links; R20 binds both host profiles to the final VSIX. |

## Remaining findings

### R2-F1 — P1: the frozen `reconnect` ordering does not define where `due: null` sorts

- **Concrete counterexample:** with `People/Alice` never contacted (`due: null`) and
  `People/Bob` overdue (`due: "2026-09-01"`), a null-first implementation and a null-last
  implementation both satisfy lines 78–79's “sorted by `due` then `person`.” The current core uses
  `(due ?? "")` and therefore emits Alice first, while a conventional nullable database sort or the
  existing generic query comparator may emit Alice last. A refactor or another adapter can thus
  change public row order without appearing to violate the frozen text.
- **Violated invariant:** contract `1.1.0` exposes stable normalized relationship rows, including
  their declared ordering; core, preview, bake, Lua, and CLI must agree on row values and order.
- **Minimal correct fix:** state explicitly that `due: null` sorts first, preserving the baseline,
  then sort equal due values by canonical `person`. Add that assertion to the static projection
  metadata or existing comparator rather than inventing a schema engine.
- **Affected surfaces/tests:** `packages/semantic-core/src/relationships.ts` reconnect comparator and
  exact-order projection tests; CLI JSON, Lua, preview/query, hover, CodeLens, and baked Markdown
  parity fixtures; R2 should contain both a never-contacted and a dated-overdue row and assert their
  complete order.
- **Disposition:** **reuse/simplification** — retain the current comparator and document its null
  order. No new state, adapter-specific sort, or generic schema machinery is needed.

### R2-F2 — P1: the plan and evidence ledger lock informational exclusions to Warning

- **Concrete counterexample:** editing `contact-every: nope`, writing `[interaction: ]`, or adding a
  valid custom Interaction on a page without a trustworthy Journal date causes the value/item to be
  ignored or uncounted without invalidating a required operation. The authoritative post-r1 source
  correction requires ignored optional metadata and uncounted Interactions to use Information/Hint,
  but lines 204–207 require Warning and R4/R5 explicitly make Warning the GREEN assertion. An
  implementation that follows the correction would therefore fail the plan's acceptance ledger;
  one that follows the ledger would ship the rejected severity.
- **Violated invariant:** diagnostic severity is semantic and must match the accepted source
  evidence; optional ignored metadata and uncounted content must not be elevated to a warning, while
  malformed required query inputs remain errors.
- **Minimal correct fix:** change ignored birthday/cadence and excluded/uncounted Interaction cases
  (empty kind, untrusted Journal date, and no direct exact Person) to Information or Hint, choosing
  one deterministic level in the plan. Update R4 and R5 accordingly. Keep invalid
  projection/argument/field/date/range/limit and required Person identity as Error, and keep custom
  non-empty kinds diagnostic-free.
- **Affected surfaces/tests:** core classifier reason/severity mapping, VS Code diagnostics and
  semantic hover, diagnostic snapshots, R4, R5, R7, and R18. Tests need exact severity assertions for
  every ignored/uncounted reason plus the existing no-diagnostic custom-kind case.
- **Disposition:** **simplification** — correct one shared mapping and its tests; do not add provider
  overrides, new categories, or a second diagnostic policy.

### R2-F3 — P1: the located fence grammar does not require a closing fence to use the opening marker

- **Concrete counterexample:** in a block opened by a five-backtick `lifeloop` fence, a body line
  containing a three-tilde run must remain body text; similarly, a three-backtick run inside a
  `query` block opened with tildes is not its close. Lines 170–172
  require support for both marker families and reject shorter runs, but never say that the closing
  run must use the same character as the opener. A scanner that closes on either marker family can
  satisfy the written rule while disagreeing with Markdown preview, producing different body text,
  completion ranges, diagnostics, hover, and CodeLens results. R6 does not include a mixed-marker
  case, so it would not catch the drift.
- **Violated invariant:** the one located parser must preserve the existing Markdown preview fence
  semantics across every query surface; completion must remain inside the actual recognized body
  rather than a second grammar.
- **Minimal correct fix:** record the opening marker character and run length, and close only on a
  run of the same character whose length is at least the opening length. Add mixed backtick/tilde
  body runs to R6 alongside the existing short-run cases.
- **Affected surfaces/tests:** the shared located query/fence parser; preview, query execution,
  completion, diagnostics, definition, hover, CodeLens, and baking; VS Code parser/range tests and
  R6.
- **Disposition:** **reuse/simplification** — keep one scanner and two small opening-fence receipts
  (character and length), or reuse the existing Markdown parser's fence boundary. Do not add a
  second parser or LanguageService.

## Dependency-closure result

The exact Calendar result boundary, guarded-source freshness, response-loss reconciliation,
one-time CRLF ref conversion, public offset removal, custom-kind compatibility, deterministic
command actions, and Foam/file-URI fallback remain internally coherent after the r2 corrections.
No additional P0 or P2 data/API/editor finding was found. `limit` is coherently presentation-owned:
each consumer adapter validates and slices while `runProjection` retains only semantic arguments;
the parity fixture should compare the same post-limit rows rather than move `limit` into core.

Because R2-F1 through R2-F3 affect the public contract or P0 language/diagnostic acceptance gates,
revision 2 cannot be marked CLEAN before implementation.
