# Relationship language design revision 3 — data/API/editor correctness closure review

Status: completed independent final closure review; durability capture only.

- Frozen artifact: `docs/plans/2026-09-09-relationship-language-features.md`
- Frozen SHA-256: `8e08bcefd171dace55c2fc545bf7abe57f9c88040d398fa4b6c3523597fafd21`
- Recovery ref: `refs/codex/recovery/relationship-language-design-r3-20260909`
- Recovery commit: `bb48f3abae76cb78a79dfb2956eeb9b7078a0555`
- Reviewer scope: final data/API/editor closure over every r1/r2 counterexample and dependency closure
- Model: GPT-5 (Codex; exact deployment identifier is not exposed at runtime)
- Reasoning effort: high
- Result: **CLEAN — 0 P0, 0 P1, 0 P2 findings**

The working artifact and the recovery-ref copy were read and independently matched the frozen
digest before review. The frozen design was not edited. Review continued through every prior
counterexample and the patch-induced dependency closure; this CLEAN result is a design disposition,
not implementation or test PASS evidence.

## Revision-1 data/API finding replay

| Prior finding | Disposition | Revision-3 closure evidence |
|---|---|---|
| F1 — strict projection arguments conflict with CLI/Lua defaults and limit parity | **CLOSED** | Lines 63–71 restrict strict unknown-argument rejection to the four relationship projections. Lines 84–89 define each allowed/required argument, retain defaults in core, keep `fields`/`limit` presentation-owned, and make adapters validate and apply only explicit legal inputs. R1–R3 distinguish invalid semantic inputs from valid empty results and exercise the complete consumer set, including limit 0/1 and malformed limits. |
| F2 — incomplete public schemas and leaked parser offsets | **CLOSED** | Lines 73–83 freeze all four exact public shapes, omit optional keys rather than emitting `undefined`, exclude internal offsets, give `due` an explicit null representation, bound recent interactions at ten public rows, and declare ordering. R3 requires exact `Object.keys`, nesting, omission, null, bounds, filters, and order; its discriminating fixture includes absent optionals, null, ties, more than ten interactions, and filtered rows. |
| F3 — duplicated classifiers, cadence overflow, and custom-kind contradiction | **CLOSED** | Lines 63–70 give core the small pure validators/classifiers. Every non-empty custom kind remains valid, counted, and filterable; only empty kind is excluded. Lines 214–218 select the accepted Error/Information/no-diagnostic mapping. R4/R5/R7/R18 cover overflow, every ignored/excluded reason, custom-kind compatibility, live diagnostics, hover, and symbols. |
| F4 — no shared located parser or Markdown fence parity | **CLOSED** | Lines 176–186 define one located parser shared by preview, execution, hover, CodeLens, completion, diagnostics, and definition. It stores opening marker character and length; only the same marker at least that long with trailing whitespace closes. R6 covers both aliases, matching longer closes, shorter and opposite-marker body runs, CRLF, astral UTF-16 prefixes, exact ranges, and body/value-only completion. |
| F5 — indexed Interaction refs use the wrong CRLF coordinate when presented | **CLOSED** | Lines 182–186 retain parser-coordinate Interaction refs and perform exactly one `originalSourceOffset` conversion only for full-result/Brief source links. Handwritten numeric SB refs remain live-coordinate. R19 resolves the exact CRLF source target while proving raw, CLI, and hover output unchanged. |
| F6 — unsupported Calendar cancellation claim | **CLOSED** | Lines 108–118 make the Brief reader additive and exact, return `found | missing | ambiguous`, reject duplicate collapse, and make no cancellation claim. R16 covers missing, duplicate, throw, and one-UID success with no Brief conflict write. |
| F7 — temporary Person wikilinks have no proven owner | **CLOSED** | Lines 314–319 use one escaped standard Markdown file-URI form in every runtime and add no Foam branch or ordinary-wikilink provider. R19/R20 require actual Person and source-link resolution from both temporary documents in task-only and pinned Foam hosts. |

## Revision-2 correction replay

### C2 — exact public contract, consumer parity, and executable recipes: CLOSED

- `people`, `interactions`, `reconnect`, and `person-context` have frozen top-level keys; nested
  `recentInteractions` uses the same public Interaction row and never exposes `offset`.
- Optional fields are absent rather than present with `undefined`; never-contacted `due` is
  explicitly `null` and sorts first. Dated reconnect rows sort ascending by ISO date, then canonical
  Person, preserving the baseline comparator. The other projection orderings and the ten-row recent
  bound are asserted exactly.
- R2/R3 use one deliberately discriminating fixture through direct core, preview/query, query hover,
  CodeLens count, baked Markdown, SLIQ/Lua, and CLI JSON. Raw consumers deep-equal; rendered consumers
  preserve selected values and order; CodeLens uses the post-limit count.
- The People, Interaction timeline, due reconnect, and Person Context documentation recipes are
  parsed and executed rather than accepted by prose inspection.

The tests extend existing Vitest, adapter, bake, Lua, and CLI harnesses. No schema engine,
adapter-specific sort, or golden-file framework is introduced.

### C3 — one located Markdown fence contract: CLOSED

The opening marker character and run length are the only additional receipts. Same-character,
minimum-length, trailing-whitespace closure is explicit; shorter same-marker and every
opposite-marker run remain body text. One parser supplies offsets and body boundaries to all named
editor/query surfaces. R6 includes both mixed-marker directions, valid longer closes, CRLF, astral
prefixes, exact value-token ranges, and completion containment, so the old triple-backtick scanner
or a second provider grammar cannot satisfy the gate.

### C6 — presentation-owned strict `limit`: CLOSED

`limit` remains outside semantic `ProjectionArgs`; adapters validate it as a non-negative integer
and apply it after normalized projection ordering. R2 covers 0 and 1 plus negative, nonnumeric, and
fractional editor/CLI values. R6 binds editor failures to an Error over the exact live value token
and forbids result execution; equivalent CLI cases exit nonzero with an actionable error and no
successful result JSON. This preserves core ownership of semantic filtering without moving a
presentation operation into the public projection API.

## Related editor/data dependency closure

- **CRLF and UTF-16 identity:** task-command handles are live-coordinate. A fresh indexed numeric
  ref is converted once before exact equality and live line-start checks; cursor handles are never
  converted. Interaction presentation conversion is separate. R10/R11 cover valid CRLF tasks,
  containing-line retarget refusal, moved unique anchors, normalized equality, and no double
  translation.
- **Live/index authority:** lexical ranges and diagnostics use the supplied `TextDocument` without
  full reindex. Derived identity semantics require a settled generation-matched snapshot and return
  nothing when stale. Authority-bearing commands refresh serially. R7/R8 use barriers rather than
  fixed sleeps.
- **Guarded mutations:** task and Person identities are revalidated after each prompt and protected
  with the Journal before-value in one existing `ChangeSet.expected`; a dirty Journal refuses.
  Response loss uses bounded whole-file reconciliation, at most one existing serial rollback, and
  preserves `UNKNOWN` without automatic retry. R11–R14 retain these terminal assertions.
- **Brief boundaries:** one validator establishes fresh eligibility before `requireApp`, again after
  it, and again after the exact read, requiring the same sealed handle, UID, calendar, and direct
  People. R15 proves pre-invocation ineligibility makes zero capability/reader calls and that later
  mutations open nothing.
- **Calendar scope:** Brief does not call, recommend, or persist formal Sync/Resolve state. The
  existing mutation-bearing Calendar subsystem remains explicitly uncertified debt. Its sealed
  `(calendarName, uid)` and duplicate-safe update work enters this delivery only if implementation
  changes the shared read/update API or behavior; that condition fails closed before merge.
- **Provider ownership and actions:** literal `X@Y.md` wins before special-ref parsing; ordinary
  Foam links remain untouched. Task and deterministic diagnostic actions are command-backed with
  empty edits and revalidate their receipts. Temporary navigation is presentation-only and works
  without Foam.

## Full evidence-ledger disposition

R1–R20 retain pre-fix RED counterexamples and terminal GREEN assertions against frozen baseline
`036e13c8`. R1–R6 close strict args, exact public data, classifier/severity, fence/range, and limit
behavior. R7–R18 close live freshness, navigation ownership, guarded identity, prompt/I/O races,
dirty writes, response loss, Calendar exact reads, command actions, hover, and symbols. R19/R20
close presentation isolation and actual packaged navigation in both required host profiles. The
packaged gates bind results to the tested VSIX SHA-256; skipped real Apple or Foam checks are
`NOT COVERED`, never PASS.

No reviewed correction adds an LSP, generic LanguageService, schema/DSL engine, provider-wide
reindex, closed kind enum, alternate renderer, runtime Foam branch, Calendar mutation, retry or
takeover system, or recovery-of-recovery layer. The smallest existing metadata, parser receipts,
validators, adapters, and test harnesses remain the selected implementation path.

## Conclusion

All prior data/API/editor counterexamples, C2, C3, C6, and their dependency closure are resolved in
the frozen revision-3 design. No in-scope finding remains; the artifact is **CLEAN for
implementation**, subject to executing the stated RED/GREEN and packaged evidence gates.
