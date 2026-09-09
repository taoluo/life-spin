# Relationship language implementation R1 — independent adjudication

Verdict: **CHANGES REQUIRED; FINAL PACKAGE NOT QUALIFIED**. R1 is not approved.
All 20 submitted finding records were adjudicated after the first P1. Three duplicate
pairs merge, leaving 14 implementation defects (three P1, eleven P2) and three evidence
findings (one P1 qualification blocker, two P2 coverage gaps). There is no P0 finding.
Missing evidence is not represented as an implementation failure or as PASS.

Adjudicator: **gpt-6-astra, xhigh reasoning**, the actual assigned model and effort.
Date: 2026-09-09. This is independent adjudication, not a vote among reviewers.
The frozen production/test source was not edited. No commit, package, installation,
Apple operation, or additional source baseline was created by this adjudication.
Only this report was written; the primary must include it in the next verified durable
review receipt. Its conclusions do not make any subsequent patch reviewed or CLEAN.

## Verified frozen inputs

| Input | Verified identity |
|---|---|
| Source ref | `refs/codex/recovery/relationship-language-implementation-r1-20260909` |
| Source commit | `c0c2d9164b8ae34641f1848f2dcd12d846da8041` |
| Source tree | `755b79722b05fd4d598765b954a33326a58f4b74` |
| Manifest base | `dbd6fd56fffa225d108b76b57ea4f68d23a06b41` |
| Binary source-diff SHA-256 | `e2b25694432a5c75bed8a711336b98b2d7699abb470ed890430a291e58e3737a` |
| Reviewed-design ref | `refs/codex/recovery/relationship-language-design-reviewed-20260909` |
| Reviewed-design commit | `c58d1298a18caca24e28f379f7dc1da9911ac3d8` |
| Design document SHA-256 | `8e08bcefd171dace55c2fc545bf7abe57f9c88040d398fa4b6c3523597fafd21` |
| Reports ref | `refs/codex/recovery/relationship-language-implementation-r1-reviews-20260909` |
| Reports commit | `7ff13fb65b61c600ef60f10d15f3396e58f0bb5a` |

The manifest `docs/plans/2026-09-09-relationship-language-implementation.review.json`
is a receipt outside the source commit. I verified each of its 40 source artifacts
against the named Git blob: SHA-256, bytes, and newline count all match. Its inventory
also equals the complete changed-file list against its declared base. The binary diff
hash matches. The design blob is 30,113 bytes/436 lines and matches the source/worktree
copy. The source directories, scripts, vendor tree, README, and schema on disk have no
diff from the frozen source. The temporary `node_modules` symlink is test infrastructure.

All three complete reports were read from verified worktree copies matching the report
ref, with the following independently calculated identities:

| Report in `docs/plans/reviews/` | SHA-256 | Bytes / lines |
|---|---|---|
| `relationship-language-implementation-r1-authority-race.md` | `7ec9d80e09b609146865387045c953ee5df8f2c74c7257d2573193b410030a94` | 14,418 / 255 |
| `relationship-language-implementation-r1-data-api.md` | `e1ce8c997368e84a8385199c2fd046954395046927bbaa0dcbe614839fb9955e` | 20,127 / 323 |
| `relationship-language-implementation-r1-scope-evidence.md` | `ccd550ab010b51a46981c34fd8654a665815ccccede9e0262e8e8e3f580fbf1c` | 25,185 / 305 |

Source references below identify this frozen source; design references identify
`docs/plans/2026-09-09-relationship-language-features.md` at the reviewed-design digest.
Report line-number imprecision does not change the conclusions: for example D8's
rendering call is `preview.ts:225-227`, and the actual reconnect shift is
`relationships.ts:165`.

## Independent verification and method

I traced the reported counterexamples through core extraction/validation and rows,
task identity producers/consumers, editor live reads/saves, shared mutation recovery,
binding/Sync consumers, query parsing/providers/rendering, temporary outputs, freshness
and event publication, existing unit/conformance tests, and the packaged test harness.
I compared each finding with the committed behavior and rejected expansions that would
change legacy semantics or add speculative coordination. Ponytail guides minimal fixes;
brainstorming supplies the recovery alternatives below. The user's autonomous selection
and no-commit instructions supersede those skills' generic confirmation/commit workflow.

Independent existing tests: **213 passed in 16 files**, Vitest 3.2.7, using
`./node_modules/.bin/vitest run --configLoader runner`:

- 134 passed: `packages/semantic-core/src/mutation.test.ts`,
  `mutations/mutations.test.ts`, `mutations/relationships.test.ts`, `relationships.test.ts`;
  `packages/apple-bridge/src/calendar.test.ts`, `calendar-sync.test.ts`;
  `packages/vscode/test/commands.test.ts`, `apple.test.ts`, `bindings.test.ts`,
  `language-features.test.ts`, `relationship-parity.test.ts`, `preview.test.ts`;
  `packages/cli/src/main.test.ts`.
- 79 passed: `packages/apple-bridge/src/sync.test.ts`,
  `test/conformance/review-findings.test.ts`, `packages/vscode/test/views.test.ts`.

The first invocation also supplied two nonexistent test-name filters (`bind.test.ts`,
`reminder-sync.test.ts`); neither was counted. The second invocation covers the actual
binding/conformance and Reminder sync test locations. These tests are baseline evidence,
not regressions proving the proposed fixes.

I also independently executed in-memory esbuild probes against the unchanged source
and existing VS Code mock. They reproduced AR-1 through AR-4 and D1 through D10:
dirty-buffer success despite unchanged disk; concurrent edit destroyed by serial
rollback; the registered date command writing after prefix shrink; anchored hover
Detach refusing its own handle; all D1 context/type cases and its multiline positive;
quoted YAML missing hover; missing Person completion range; illegal projection/value
ownership; dot-path acceptance/traversal throw; missing/CRLF diagnostic failures;
`+010240-05` overdue output; bare-anchor navigation loss; task symbol on the preceding
CRLF line; and a nested code-example fence recognized as a query. For AR-1 the real
`WorkspaceVault` read an existing fixture while mocked edit/save affected only its open
buffer; the fixture's disk bytes stayed unchanged. Probes wrote no source or bundles and
contacted no Apple apps. D3's returned item was executed, but actual completion acceptance
in VS Code remains a host qualification task. AR-2's deterministic injected edit at B's
rollback establishes the race without relying on a sleep.

I did not rerun the full suite, build, task-only/Foam hosts, or real Apple smoke. The scope
reviewer's 703+3+2 fixture-missing run and the primary's reported 705+3 run are compatible
with different external fixture availability; neither upgrades this report's evidence.
No contemporaneous per-gate RED receipt was found in the provided relationship evidence.

## Exhaustive finding disposition

| Finding | Disposition | Severity / class | Correction below |
|---|---|---|---|
| AR-1 | Accept | P1 implementation | A1 |
| AR-2 | Accept | P1 implementation | A2 |
| AR-3 | Accept, include retained-handle callers | P1 implementation | B1 |
| AR-4 | Accept | P2 implementation | B2 |
| D1 | Accept; merge S4 | P2 implementation | C1 |
| D2 | Accept; merge S5 | P2 implementation | C2 |
| D3 | Accept | P2 implementation | D1 |
| D4 | Accept; merge S6 | P2 implementation | D2 |
| D5 | Accept | P2 implementation | D3 |
| D6 | Accept | P2 implementation | D4 |
| D7 | Accept | P2 implementation | E |
| D8 | Accept | P2 implementation | F |
| D9 | Accept as changed-provider dependency closure | P2 implementation | C3 |
| D10 | Accept, distinct from Interaction parsing | P2 implementation | D5 |
| S1 | Accept qualification blocker | P1 evidence | G1 |
| S2 | Accept with honest retrospective RED handling | P2 evidence | G2 |
| S3 | Accept coverage gaps, not assumed bugs | P2 evidence | G3 |
| S4 | Merge into D1 | P2, no duplicate fix | C1 |
| S5 | Merge into D2 | P2, no duplicate fix | C2 |
| S6 | Merge into D4 | P2, no duplicate fix | D2 |

The reports do not have a substantive accept/reject disagreement about the reproduced
bugs. Agreement is not the basis for acceptance: source behavior and explicit design
requirements are. The corrections below resolve their different proposed breadths.

## A — durable outcomes and serial compensation

### A1: AR-1 — accept P1

**Evidence and counterexample.** `mutation.ts:146-155` promotes all-after live reads to
success after any write exception. `workspace.ts:37-39` reads the open buffer, while
`:68-73` can apply an edit and then fail its save. The independent probe returns
`ok: true`, `isDirty: true`, buffer=after, disk=before. Closing without saving loses
the reportedly logged interaction. `commands.ts:117-120` reports logging success;
`bind.ts:39,82` establishes successful bindings; `apple.ts:277` and Calendar/Reminder
resolution paths can advance success-dependent observations. Design `169-174` requires
durable save confirmation, not only after-text equality.

**Selected minimal correction.** Remove unconditional success promotion. Reuse the
concrete adapters' existing persisted state to provide a narrow, explicit durability
confirmation when reconciling a lost write response. Missing, throwing, dirty, or
contradictory confirmation stays UNKNOWN; it must not default to durable because a
method is absent or a live read equals after. NodeVault can inspect its disk authority;
WorkspaceVault must distinguish live contents from saved bytes/save state; MemoryVault
can explicitly model committed in-memory state. Only all-after **and** confirmed durable
state may succeed. Similarly, do not describe all-before or rollback as authoritatively
restored if only live-buffer equality is known. Preserve the conservative refusal result
and factual uncertainty when persistence cannot be confirmed.

This is the smallest contract distinction necessary to retain the committed R14
confirmed-applied response-loss case. Making every thrown write UNKNOWN is a safe local
fallback when confirmation is unavailable, but cannot be used to claim that R14's
confirmed-success case is implemented. Retrying save/write to obtain certainty and
adding a durable operation journal/takeover protocol are rejected.

**Exact closure.** In `mutation.test.ts` and editor tests, distinguish before-write
failure, committed-after response loss, edit-success/save-false, save-throw, unreadable
state, and third state. Assert result, dirty state, saved bytes, and retained evidence.
Use the existing `WorkspaceVault` mock seam in `commands.test.ts` or `views.test.ts`;
assert no Log success/reindex-as-success on failed save. In existing bridge/conformance
tests assert unknown binding retains the created ID, performs no destructive cleanup,
and cannot advance a successful-binding/settled observation. Follow all `apply`/`applied`
callers, including task/page/inbox/template/bake/review/outline/sign mutations and Notes
import, plus Markdown-side Calendar/Reminder Sync/Resolve. This is return-semantics closure,
not authorization to redesign their deferred external identity protocols.

**Disposition:** remove unsafe optimism; reuse adapter evidence; add only the minimal
explicit capability needed to distinguish durability. Do not add operation state or retry.

### A2: AR-2 — accept P1

**Evidence and counterexample.** `mutation.ts:160-169` takes one `observed` snapshot,
then serially undoes each after-value without rereading that path. Fail C after A/B;
while B's rollback awaits, change A to THIRD. A's old observation authorizes writing
A-before over THIRD; the terminal reread then says rollback was verified. This violates
design `172-174` and the user's requirement to revalidate before each serial recovery
effect. The existing two-file concurrent-edit test at
`test/conformance/review-findings.test.ts:464-482` changes A before the first observation
and therefore cannot expose this later race.

**Selected minimal correction.** Keep the existing one bounded serial recovery, but
freshly read/compare each path immediately before its compensation. Already-before is
a no-op; unreadable or third state preserves that path and stops affected compensation
with UNKNOWN. Recheck terminal contents and durability after rollback, including an
exception from rollback itself. A fresh check closes the demonstrated inter-step race;
it is not a claim that an arbitrary asynchronous adapter provides atomic compare/write.
Where the adapter cannot safely maintain the checked precondition through its effect,
omit that compensation and report the partial/unknown outcome. Do not invent a lock,
CAS service, retry cascade, or takeover mechanism to restore an all-or-nothing slogan.

**Exact closure.** Add the three-file deterministic barrier case to `mutation.test.ts`
or the existing conformance recovery tests: suspend B rollback, edit A, resume, prove
THIRD survives and result is UNKNOWN. Also exercise a third value discovered immediately
before compensation, unreadable pre-compensation read, rollback throw/response loss,
create/remove restoration, and final failed-save/third-state verification. Preserve
the existing successful two-file rollback regression. A1's shared caller closure applies.

**Disposition:** restore the per-effect ownership check; otherwise remove unsafe
compensation. No recovery-of-recovery machinery.

## B — strict task admission and common handle production

### B1: AR-3 — accept P1

**Evidence and counterexample.** The registered date loop at `commands.ts:425-437`
captures `Work@11`, awaits the InputBox, then passes the old handle directly into the
core mutation. Shrinking `prefixxxxx` to `prefix` moves the unchanged task to offset 7;
11 now lands inside it. `resolveHandle` checks line/state receipts at
`mutation.ts:271-291`, so it accepts; `taskTarget.ts:98-99` would reject the exact ref
mismatch but is bypassed. The independent registered-command probe writes a deadline.
Design `131-140,151-167` makes `taskTarget` the command admission path and explicitly
forbids this interior-offset relocation.

**Selected minimal correction.** Retain the original guarded identity, refresh through
`currentTaskStates`, then call `taskTarget` with that original handle after each actual
prompt/capability boundary and immediately before the requested effect. Fix the date
registration loop once. Apply the same retained-handle rule to Complete/Reopen after
their existing awaited refresh (`commands.ts:310-330`), Attach Page after its prompt
(`:440-449`), and Add Reminder/Calendar before creation after their capability/prompt
boundaries (`apple.ts:231-274`). The Task Actions picker must dispatch the original
handle into the same admission; retain Log/Brief's existing refresh behavior. Do not
reconstruct identity from display text or presentation offsets, and do not globally
tighten handwritten numeric SB navigation to repair a command orchestration bug.

**Exact closure.** Drive the actual registered Deadline/Scheduled commands with the
prefix-shrink prompt barrier, asserting byte-identical post-prompt source and no success
message. Exercise the same barrier in the retained-handle siblings, including zero
external create calls when the target is already stale after capability/prompt return.
Cover unchanged LF/CRLF numeric targets, unique moved anchors, duplicate/missing anchors,
wrong runtime fields, and stale handle plus apparently current page/offset. Extend
`commands.test.ts`, `apple.test.ts`, and existing target tests in `views.test.ts`.

**Disposition:** reuse refresh plus strict admission at the existing boundaries; no
second identity layer. Formal Calendar Sync/Resolve identity debt stays excluded.

### B2: AR-4 — accept P2

**Evidence and counterexample.** `bindings.ts:32-45` always emits numeric line-start
identity, but `taskSourceRef` gives an anchored task `Work@task` (`task-target.ts:30-36`).
Its own Detach consumer now rejects `Work@0` at `:98-99`. The registered hover-to-Detach
probe leaves an unchanged `* [ ] task $task [event: "E1"]` bound. This is a producer
missed in the strict-admission migration, not justification to restore the old bypass.

**Selected minimal correction.** Reuse `taskTargetAt`/common normalization to capture
the hover's guarded action. Do not fabricate an actionable identity when the indexed
task is unavailable or ambiguous; preserve strict consumer validation.

**Exact closure.** Extend `bindings.test.ts` beyond attribute extraction with actual
hover argument → registered Detach for both Calendar and Reminder. Assert unique-anchor
CRLF success and external retention; duplicate/missing/moved-stale targets refuse.
Include producer/consumer parity with code actions and tree handles in `views.test.ts`.

**Disposition:** reuse the common producer; no consumer relaxation.

## C — live parsed semantics and document symbols

### C1: D1 + S4 — accept one P2

**Evidence and counterexamples.** `retrieval.ts:52-83` classifies raw lines with two
regexes. Core uses upstream item extraction and `relationships.ts:135-145`, including
comment marking, string attribute types, and item-wide direct links. Comments, tilde
code, inline backticks, escaped brackets, and numeric `[interaction: 42]` all produce
zero core rows while current hover/Outline claim counted. A continuation-line direct
Person link produces a real core Interaction while the provider says excluded.
Design `63-71,96-99,206-218,278-280,296-301` commits semantic parity.

**Selected minimal correction.** Remove the line classifier's independent semantics.
Reuse the existing live Markdown parser/item extraction (the synchronous exported
`extractItemFromNode` seam is available in upstream `plugs/index/item.ts:107-205`)
and share the minimal pure inclusion/reason decision with core where needed. Preserve
upstream comment/context marking, parsed attribute type, and direct rather than
inherited links. Retain source tokens solely for ranges and empty/excluded actual
attributes. Code/escaped examples must remain inert; commented content must never be
advertised as counted. Do not run a global reindex or create a temporary second Store
to answer lexical provider requests. If asynchronous extraction is chosen instead,
prove immediate changed-document publication/version ordering; it is not free of R7/R8.

**Exact closure.** Add a small provider/core correspondence table to
`language-features.test.ts` and core relationship tests: all five negative cases above,
multiline positive, custom/empty kinds, parent/child direct versus inherited links,
untrusted Journal date, LF/CRLF/astral token ranges. Check counted/excluded reason,
Information severity, and Event symbol selection. Trace diagnostics, hover, symbols,
page metadata, exact Person lookup, and stale-index gating together.

**Disposition:** remove duplicate rules and reuse upstream extraction/core authority.
S4 is fully resolved by this correction, not another classifier or regex exclusion list.

### C2: D2 + S5 — accept one P2

**Evidence.** `retrieval.ts:264,273` passes raw frontmatter token spellings to validators
even though `livePage` is already parsed at `:260`. `birthday: "02-29"` and
`contact-every: "30d"` are valid core facts but return no hover. Source quoting/comments
are presentation, not alternative semantic values (design `63-65,274-283`).

**Selected minimal correction.** Validate `livePage.birthday` and
`livePage["contact-every"]`; keep located raw tokens for hover ranges. Consolidate the
line locator correction with D6 instead of creating another YAML parser.

**Exact closure.** Quoted, unquoted, and inline-comment equivalents must yield the same
facts with their correct source ranges in `language-features.test.ts`. Freeze time for
next leap birthday and exact due/not-due assertions. Recheck D7's out-of-range derived
date behavior and stale derived-hover refusal.

**Disposition:** reuse parsed values; S5 adds no separate patch.

### C3: D9 — accept P2 dependency closure

**Evidence.** The task half of the now-extended symbol provider still reads cached
task names/ranges and passes normalized offsets directly to the live document
(`retrieval.ts:705-723`). With `intro\r\n\r\n* [ ] task ...`, the symbol lands on the
blank line. Dirty insertion can also leave the cached name/range stale. This older code
is in scope because the design explicitly extends this provider and requires live
tokens/ranges (`96-99,176-186,296-301`); it is not claimed as a newly introduced extractor bug.

**Selected minimal correction.** Reuse C1's live parser seam for task symbols where
practical. Alternatively, postpone the index-derived portion while stale and translate
its verified normalized range exactly once through `originalSourceOffset`. Neither
option may return an old task label at a new document location. Prefer live extraction
if C1 already makes it available; do not trigger a reindex just for Outline.

**Exact closure.** In `language-features.test.ts`/`views.test.ts`, assert task and
Interaction symbols together under CRLF blank/astral prefixes, dirty insertion and
label edits, comment exclusion, and custom task states. Assert exact live selection,
not just symbol presence. Keep global heading/WorkspaceSymbol work excluded.

**Disposition:** reuse the live seam, or safe postponement plus one conversion.

## D — query ownership, paths, and located edits

### D1: submitted D3 — accept P2

**Evidence.** `query-lens.ts:38-41,80-83` supplies full canonical Person `insertText`
without a replacement range. The independently obtained Alice item has no range after
`person: People/A`. VS Code's ordinary word replacement does not cover slash/space
prefixes, so the item cannot guarantee a canonical resulting value. The data reviewer
also checked the installed Markdown word pattern. Design `192-197` requires legal,
canonical value completion; a correct label alone is insufficient.

**Minimal correction and tests.** Use the located option value/current prefix for an
explicit replacement range. Test accepting into `People/A`, a path containing spaces,
and a cursor before an existing suffix; validate the resulting query and ensure no
duplicated prefix, suffix, colon, or EOL. Extend existing completion tests and include
real-host acceptance in G1. **Reuse** token offsets; no completion framework.

### D2: submitted D4 + S6 — accept one P2

**Evidence.** `retrieval.ts:92-100` checks only `person` and a fence, so legacy, `people`,
and unknown projections resolve it. `query-lens.ts:73-74` suggests kinds for `people`.
Core metadata at `contract.ts:116-148` gives `person` only to interactions/person-context
and `kind` only to interactions. Design `123-127,192-197,223-227` establishes ownership.

**Minimal correction and tests.** Require a recognized relationship projection and
its `allowedArgs` for these branches, reusing the Person completion gate. Add the
positive legal cases and every disallowed relationship/legacy/unknown projection-key
combination, plus body/closing-fence boundaries, in `language-features.test.ts` and
existing completion tests. **Reuse** metadata; S6 adds no separate parser or patch.

### D3: submitted D5 — accept P2

**Evidence.** `retrieval.ts:33-39` tests filesystem existence before its catch and never
checks canonical identity. The actual NodeVault fixture accepts `./People/Jiulong`
while core requires exact `People/Jiulong`; `../../../outside` throws from
`vault.ts:34-38`. A malformed linked value can also interrupt diagnostic publication.
Design `84-87,149-150,212,225-227` requires exact identities and fail-closed absence.

**Minimal correction and tests.** Reuse `validPageName` (`mutation.ts:63-66`) and exact
canonical path inventory/identity checks, then put both existence and read inside the
fail-closed boundary. Do not silently normalize dot/case/alias spellings into a Person.
Keep live target-tag revalidation without a global reindex. Include the new special-ref
branch's unguarded `exists`/read calls (`retrieval.ts:107-110`) in the malformed-input
closure rather than fixing only one entry point. Test dot segments, empty/duplicate
separators, absolute/traversal and platform-normalized spellings, thrown exists/read,
and a valid dirty Person whose tag is then removed. Assert no provider throw and no
publication abort. **Reuse validation and safe refusal**, not a new identity service.

### D4: submitted D6 — accept P2

**Evidence.** Query execution rejects empty option values (`preview.ts:64`), but
diagnostics accept `Number("")` and no field tokens (`retrieval.ts:155-167`). For an
empty Person value, `:124` forces a one-character range into CRLF. The frontmatter
regex at `:201,220` lets `\s*` consume a newline, selecting the following cadence line
for an empty birthday. All three outcomes were independently reproduced. This violates
design `176-186,201-218` and R6's exact tokens.

**Minimal correction and tests.** Diagnose an empty option before field-specific
handling, choosing an actual key/colon token rather than manufacturing an EOL range.
Use horizontal whitespace in the shared frontmatter locator; retain parsed scalar
semantics from C2. Ensure the generic diagnostic helper never extends an empty token
into CR/LF. Test empty/whitespace-only limit, fields, person, birthday, cadence;
negative/fractional/nonnumeric limits; LF/CRLF and exact selected substrings/severity.
Also run parser execution and deterministic-fix range tests. **Small shared guards and
locator reuse** suffice; do not broaden empty-value acceptance or add a schema engine.

### D5: submitted D10 — accept P2

**Evidence.** `query-language.ts:83-91` searches only query openings and arbitrary
leading whitespace, ignoring surrounding nonquery fences. It finds `~~~query` inside
a `~~~~markdown` example, which Markdown-it preview keeps literal. This affects query
hover, CodeLens, completion, diagnostics, definitions, and fixes independently of D1's
Interaction parser. Design `176-186,192-197` requires shared actual-body ownership.

**Minimal correction and tests.** Reuse the existing Markdown parser's fence/context
information, or a small scanner that tracks **all** fence languages and Markdown
indentation before selecting the two query aliases. Select the smallest seam that
agrees with preview; do not keep a query-only search patched with one nested example.
Preserve incomplete real final query bodies for completion and same-marker/minimum-length
closure. Test nested examples, both markers, different run lengths, nonquery enclosing
blocks, indented code, and relevant container contexts against actual Markdown-it
preview parsing. Re-run every consumer of `findLocatedQueryFences` and existing
long/short/opposite-marker/CRLF cases. **Parser/context reuse**, no second query grammar.

## E — strict derived date representation

### Submitted D7 — accept P2

`cadence` (`relationships.ts:79-86`) proves only finite ECMAScript Date range using
9999-12-31. `personContext` then calls legacy `shift` at `:165`, whose ten-character
ISO slice truncates extended years (`projections.ts:26`). With 3000000d and last contact
2026-09-09, the independently executed people/reconnect rows expose `+010240-05` and
classify it already due because `+` sorts before digits. This violates the strict
four-digit relationship date/public-row contract and design R4 (`63-65,73-88,355`).

**Selected minimal correction.** Validate the actual relationship addition/result
against `relationshipDate` before exposing or comparing it. Out-of-range derivation
is ignored with Information on its cadence source and no false due row; no public
malformed date and no RangeError. Keep valid cadence syntax distinct from whether its
particular last-contact addition is representable. Rejecting every cadence because
adding it to 9999-12-31 crosses year 9999 would reject even 1d and is expressly rejected.
Do not change shared legacy shift semantics or add extended-year support/date libraries.

**Exact closure.** `relationships.test.ts`: 3000000d, large finite versus nonfinite
arithmetic, exactly representable final date, ordinary cadence at/near 9999-12-31,
and never-contacted people. `language-features.test.ts`: precise Information and no
false due hover; assert `not due` distinctly from `due`. Recheck people/person-context,
reconnect/Today and birthday-derived consumers, with the all-adapter fixture in G2.

**Disposition:** local strict-result guard/shared relationship derivation; no global
date policy expansion. A valid positive cadence must not disappear universally.

## F — anchored temporary source navigation

### Submitted D8 — accept P2

Upstream deliberately uses bare anchor refs (`plugs/index/item.ts:166-169`). Public
Interaction rows have `page` (`relationships.ts:143-146`), and Brief's task/Interaction
objects also retain page. `temporary-navigation.ts:16-24` assumes a page-qualified ref,
while `preview.ts:225-227` and `apple.ts:52-66` pass only the bare value. `met`/`followup`
therefore render plain text in required full results/Brief, violating design
`183-185,312-319` and R19. B2 is related identity plumbing but a distinct mutation caller.

**Selected minimal correction.** Carry known page context into presentation and build
`Page@anchor` using the existing normalization seam. For public `openFollowupRefs`,
resolve through the existing Person context/index; only a uniquely established source
can become a link. Missing/ambiguous sources stay plain text. Do not guess the page by
cutting the last character from a bare ref (the current `slice(0, -1)` behavior), and
do not choose an arbitrary matching anchor. Keep raw public refs unchanged and convert
numeric parser refs through `originalSourceOffset` once, only for these presentation
surfaces. The same helper should cover Brief/full results without altering hover/CLI.

**Exact closure.** In `preview.test.ts` and `apple.test.ts`, assert anchored Interaction
and anchored follow-up links, numeric CRLF targets, duplicate/missing anchors, repeated
anchor names on different pages, and an unrelated page whose name happens to equal
the bare ref minus its last character. Verify raw rows/rendered hover remain unchanged.
G1 must then resolve the actual resulting links in both packaged hosts.

**Disposition:** reuse object page/context and the small link seam; no public schema,
retained result cache, capability branch, or renderer change.

## G — evidence and final qualification

### G1: S1 — accept P1 qualification blocker

The inspected host suite contains no call opening a full query result or successful
Brief and no navigation from those temporary documents. It tests old explicit SB
commands and some Foam ordinary definitions, which do not prove the new untitled
DefinitionProvider or task-only R9/R20. Removing that registration would still leave
the reported 18/25 counts attainable. `runTest.ts:64-74` defaults to development source
unless an extraction is explicitly supplied. `docs/PACKAGE-EVIDENCE.json` identifies
the older SHA `26a74fd966661831ad3b93906451df87f14a9bb14a6b6a0b36551747180015b0`
and 647/17/24 results; the implementation manifest has no current artifact binding.
These are evidence limitations, not proof the old runs were dishonest or the package
actually omitted code. Design `339-375` explicitly retains R20 and all P2 delivery.

**Minimal closure.** Extend the existing host suite to open the actual full-result
command and successful Brief path with read-only fake Calendar input, following the
existing injection/test seam. Assert one complete untitled document, Person file-link
navigation and numeric/anchored source definition/navigation at exact CRLF positions;
include standard URI escaping and completion acceptance. Test literal `@` precedence
and special definition in task-only and Foam 0.44.6 profiles, proving Foam absent/present.
Do not certify a separately bundled test copy of Brief in place of packaged code.

After final code review and builds, package once; inspect the original VSIX inventory
and entrypoint before harness additions. Hash the VSIX and extracted entrypoint, run
both profiles with `LIFELOOP_TEST_EXTENSION_PATH` pointing to that extraction, and
verify tested entrypoint bytes did not change. Record SHA, byte count, frozen source
tree, extraction path, VS Code/Foam versions, exact commands/results/skips, dependency
and external fixture provenance. Keep old package evidence historical. R20 cannot be
deferred under the accepted delivery; optional real Apple read remains NOT COVERED if
unavailable and requires no real write. **Reuse the existing harness**, no new service.

### G2: S2 — accept P2 evidence gap

`relationship-parity.test.ts:98-146` drives only one filtered Interaction query through
all adapters and derives its expected row from the same core result. The other three
projections have useful core assertions; recipe execution at `:150-160` is real but
does not compare their adapter rows. Reversing core Interaction tie ordering or dropping
nested context data in an unexercised adapter can remain green. Design `288-292,352-354,
377-384` requires independent shape/order/filter/nesting and rendered-value evidence.

**Minimal closure.** Extend the existing fixture with a four-projection table and
independently enumerated expected identities/order/public shapes. Raw consumers must
deep-equal the explicit expectation, including omission versus undefined, null,
nested public keys and ten-row bound. Preview/hover/bake must preserve chosen values
and order and omit filtered rows; CodeLens must match the post-limit count. Cover 0/1
limits across applicable adapters and retain all four executable recipes. Do not
invent another parity framework or require identical rendered markup across surfaces.

Record measured RED/GREEN per gate against named snapshots. If original RED evidence
cannot be recovered, replay against frozen baseline `036e13c8e909edd103ea212e2a084c7bcd99704d`
and label it **retrospective**, recording exact command, failure, baseline and test
digests. Never claim it occurred before the implementation commit. New regressions
should separately record R1 RED and corrected-revision GREEN. **Reuse fixtures and
honest receipts**, not invented historical evidence.

### G3: S3 — accept P2 evidence gaps with scope precision

The source includes meaningful guards: immediate callback publication at
`extension.ts:110-118`; generation comparison at `workspace.ts:299-305`; Log refreshes
at `commands.ts:53-106`; Brief checks at `apple.ts:142-208`; diagnostic receipt checks
at `retrieval.ts:419-454`. Existing tests do not discriminate all committed boundaries.
AR-1/AR-2 are demonstrated bugs inside S3's write-evidence gap; the rest must not be
called broken solely because coverage is missing.

There **is** an actual successful Task Actions multi-Person dispatch host test
(`suite/extension.test.ts:113-145`). What is missing is its prompt-time drift/terminal
refusal test. The command unit's `action` case mutates before calling `recordInteraction`
directly (`commands.test.ts:38-72`), so it does not exercise that dispatch boundary.

**Required discriminating checks, reusing existing seams:**

1. Drive the registered Markdown change callback, seed an existing diagnostic, and
   assert the changed URI's lexical result before the delayed index work. Hold an
   indexing promise across provider reads and generation settlement; prove no full
   reindex from lexical publication, no premature/stale derived result, and no late
   publication of an older document over a newer one. Existing task-policy barrier
   tests do not certify this new generation/provider behavior. Test live Person tag
   removal for definitions, actions, and derived hover independently.
2. Seed an existing Journal and use real prompt/Task Actions dispatch barriers. Change
   task text/identity, direct links, Person tag, and default event at each relevant
   Log prompt; also exercise Person-page logging drift. Assert Journal byte identity,
   buffer and save state, no success message. Race task and selected Person separately
   immediately before apply; the current test changes both, allowing one missing guard
   to be masked. Preserve the successful single atomic multi-Person item case.
3. Run A1/A2's editor persistence and serial recovery matrix. Single-value `FaultVault`
   is useful committed-memory evidence but cannot certify editor persistence, unreadable
   state, or inter-effect recovery authority.
4. In Brief fakes, vary binding/direct People/Person tag/calendar independently after
   capability as well as during exact read. Assert no output and no forbidden Markdown,
   Calendar create/update/delete, conflict/observation persistence, or Resolve call;
   pre-invocation ineligibility must call neither capability nor reader. Keep missing,
   ambiguous, throwing and single-sealed-UID success cases.
5. Independently corrupt diagnostic version, target URI, range, token role, expected
   text and replacement using discriminating target documents; assert no edit. Exercise
   wrong `ref`/`expectedText`/`expectedState` runtime types and absent receipts. This
   does not require cryptographic receipt signing or a registry that detects a wholly
   self-consistent forged receipt to an indistinguishable document.
6. Complete exact Error token tests for negative/fractional/nonnumeric/empty limits,
   Information tests for ignored cadence/Interaction facts, and clock-frozen birthday
   and due-state tests. `toContain("due")` also matches `not due`; replace it with an
   assertion that distinguishes the two outcomes.

These belong in existing `language-features.test.ts`, `commands.test.ts`, `apple.test.ts`,
`views.test.ts`, mutation/relationship/conformance tests, and the host suite. Do not
introduce a scheduler, operation journal, generic fixture layer, or full indexing
subsystem. A changed-URI diagnostics update may be a useful small implementation seam,
but a full-vault rescan is not itself proof of a forbidden full **reindex**, nor grounds
to demand an unsolicited indexing optimization. **Targeted evidence closure** is required.

## Rejected expansions and selected alternatives

| Choice | Selection and reason |
|---|---|
| Lost write response: retry, unconditional UNKNOWN, or confirmed reconciliation | Select bounded authoritative reconciliation with explicit adapter durability; UNKNOWN when unavailable. Retrying risks duplicate effects; live equality is insufficient; unconditional UNKNOWN cannot certify R14's confirmed-success case. |
| Partial writes: remove all recovery, reuse serial checks, or add transactions/locks/journals | Select existing single recovery with a fresh precondition before each effect and terminal verification; skip unsafe compensation. Preserve known working rollback without claiming atomicity or inventing recovery machinery. |
| Retained task handle: relax core refs, infer identity, or reuse strict admission | Reuse refresh + `taskTarget` on the original handle. Presentation coordinates/text are not lookup authority; handwritten SB semantics stay intact. |
| Provider semantics: add regex exclusions, full-vault extraction service, or reuse existing parsers | Reuse parser/item/YAML/metadata seams and retain located tokens for ranges. C1 and D10 remain separate context problems but share the no-second-semantics rule. |
| Date overflow: extend public years, globally change shift, or guard relationship result | Guard the actual relationship derivation locally. Preserve ordinary positive cadence and legacy date consumers. |
| Navigation: rewrite public refs, guess anchor page, or carry known presentation context | Carry page/context, refuse ambiguity, and leave public rows unchanged. |
| Package evidence: accept counts, defer P2, or test the final extraction | Test and bind the final VSIX. Counts cannot prove new temporary-document navigation; P2 deferral conflicts with this delivery. |

No new LSP, generic LanguageService/schema, renderer, dependency, attendee/title
inference, cache, cancellation claim, retry/takeover system, or Calendar identity
redesign is required. No proposed correction is chosen by majority vote.

## Ordered consolidated correction and re-review

Apply one consolidated revision after this frozen round; do not patch the source while
its reports are still being evaluated. The practical dependency order is:

1. **A:** shared durable outcome and serial rollback checks, with editor/bridge caller
   closure. Update success/UNKNOWN assertions before allowing downstream success claims.
2. **B:** strict command re-admission and the missed binding handle producer; inspect
   every `taskTarget` caller after awaits without broadening formal Sync/Resolve scope.
3. **C + D:** live parser/semantic and query ownership/range/path corrections together.
   Their closure includes diagnostics publication, fixes, completions, hover, definitions,
   and both symbol kinds, so avoid separate competing locators/parsers.
4. **E + F:** strict relationship derivation and page-aware source presentation; run
   their core/provider/raw-output parity before host qualification.
5. **G2 + G3:** complete explicit expectation/barrier/receipt tests and measured evidence,
   then run focused regressions and the full available checks.
6. Freeze the corrected source, complete inventory/digests, and a verified durable
   NON_NORMATIVE_UNREVIEWED recovery snapshot. Dispatch authority/race at **xhigh**,
   data/API and scope/evidence at **high** or higher, followed by independent **xhigh**
   adjudication. Review every accepted counterexample and the entire changed dependency
   closure; do not stop at a first P1 or label a sampled review CLEAN.
7. **G1:** after source closure, produce and qualify the final VSIX in both named host
   profiles; bind source, build, extraction, test-suite and artifact identities. If any
   product patch is needed during qualification, freeze/review its dependency closure,
   rebuild, and bind a new artifact rather than carrying over the previous SHA's PASS.

Minimum full verification remains root typecheck, vendor pin check, schema check, build,
full available Vitest/conformance suite, and the specified packaged task-only/Foam
checks. Bind ignored external SilverBullet fixture revision/content when using it to
support a 705-style claim; report unavailable live SilverBullet/Apple and known Foam
folder-rename checks explicitly. No GPU-generality review applies: this task has no
CPU-to-accelerator implementation or physical qualification path.

## R1–R20 closure map

| Gate | Required adjudicated closure |
|---|---|
| R1 | Preserve passing relationship-only validation/legacy boundary; D2/D3 must agree with it. |
| R2 | G2 all-adapter exact expectations/limits plus D5 actual query context and G3 invalid-value Errors. |
| R3 | G2 independent public keys/order/omission/null/nesting/filtering and four recipes; E/F keep raw contracts. |
| R4 | E actual strict-date bound and Information, not only the enormous-integer test. |
| R5 | C1 core/provider custom/empty/type/context equivalence and Information. |
| R6 | D1/D2/D4/D5 completion edits, legal body ownership, matching fences and exact LF/CRLF/UTF-16 ranges. |
| R7 | G3 registered callback/barrier/changed-URI lexical evidence; C1 must preserve this boundary. |
| R8 | G3 in-flight generation and dirty Person-definition/action/hover cases; C3 stale symbol safety. |
| R9 | D3 safe exact special definitions plus G1 real literal-@/CRLF checks in both profiles. |
| R10 | B common handle production/admission, F presentation conversion, unchanged raw numeric semantics. |
| R11 | B1 + G3 runtime receipts and stale handle/presentation combinations with no writes. |
| R12 | G3 every actual Log prompt and Task Actions dispatch drift, existing Journal preserved. |
| R13 | G3 independent task/Person expected-source races and dirty Journal buffer/save preservation. |
| R14 | A1/A2 all-before/confirmed durable-after/third/unreadable/serial rollback and caller closure. |
| R15 | G3 pre-capability and post-capability/read sealed Brief variations, no output/forbidden effects. |
| R16 | Keep additive exact UID missing/ambiguous/found behavior; G3 no conflict/observation writes. |
| R17 | G3 independently stale fix receipts and empty action edits; B verifies actual command mutation admission. |
| R18 | C1/C2/C3 live semantics/ranges, no ordinary-link takeover and no Calendar hover I/O. |
| R19 | F anchored/numeric source plus standard Person navigation only in full result/Brief; raw/hover/CLI unchanged. |
| R20 | G1 final tested VSIX SHA, both temporary documents and actual navigation, Foam absence/presence. |

## Preserved scope and terminal disposition

The reviewed design explicitly preserves **Calendar Sync/Resolve duplicate-UID and
calendar-switch P1 debt** (`106-118,417-419`). `Calendar.read` still collapses records
into a Map; `updateSummary`/formal resolution retain their existing external behavior.
The additive `readExact` at `calendar.ts:132-143` is the correct narrow Brief seam.
This report neither fixes nor certifies that deferred subsystem. A1's changed mutation
result semantics and B1's command preflight are in-scope consumer closure, not a reason
to widen the Calendar external identity contract. If a later patch changes those
shared Calendar read/update semantics, the design's explicit scope trigger applies.

The current source has real implementation blockers and incomplete qualification.
Preserve the frozen inputs and durable evidence; implement the consolidated corrections,
freeze a new digest, and complete its full closure review and final artifact gates.
R1 remains **CHANGES REQUIRED / NOT QUALIFIED** until that work is evidenced.
