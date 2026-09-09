# Relationship language features for VS Code

Status: design revision 3, consolidated after two independent closure rounds and xhigh
adjudication; pending revision-3 closure review.

This document narrows the relationship data-surface plan into editor behavior. It is an
implementation design, not a new product contract. The durable authority remains Markdown, the
query contract remains `@lifeloop/semantic-core`, Calendar remains external authority for event
facts, and Foam remains the owner of ordinary wikilinks and page navigation.

## Baseline and recovery point

The implementation starts from the current detached worktree at `452b4cd`, including all tracked
and untracked changes present before this design was written. That baseline already contains:

- `CONTRACT_VERSION = 1.1.0` and the `people`, `interactions`, `reconnect`, and `person-context`
  projections;
- strict birthday/cadence derivation, explicit Journal interactions, direct Person-link selection,
  multi-person `logInteraction`, birthday Today rows, and Person Context;
- task actions for Interaction logging and an initial read-only Pre-meeting Brief;
- a live-buffer-aware `WorkspaceVault`, guarded task mutations, SB anchor/position navigation,
  query preview/hover/CodeLens/baking, and Apple Calendar reads.

The pre-design baseline is preserved as `NON_NORMATIVE_UNREVIEWED` at:

- recovery ref: `refs/codex/recovery/relationship-language-baseline-20260909`
- recovery commit: `036e13c8e909edd103ea212e2a084c7bcd99704d`
- tree digest: `be0cfd43aec91d0180d7f0269297d128ff8c1347`
- base revision: `452b4cd`

The captured tree was read back through the ref and its commit/tree digests were verified. The
material inventory is the `git diff-tree` from the base revision to that recovery commit; it
includes every then-untracked material file listed by `git ls-files --others --exclude-standard`.

The remaining gaps are editor-specific: task-originated logging retains candidates across prompts;
the brief does not revalidate after Calendar I/O; the query-block parser accepts globally known
arguments on projections that do not own them; relationship completion, precise live diagnostics,
special definitions, semantic hover, command-backed code actions, Interaction symbols, and
temporary-result navigation are absent.

## Decision and alternatives

Implement these features only in the VS Code extension. Do not add an LSP server.

The selected design adds small Provider functions beside the current retrieval/query code and
feeds them from the existing semantic contract. It changes shared core code only where the same
rule must be authoritative for every consumer, such as relationship projection arguments/fields or
strict relationship value validation. It changes the Apple bridge only if an injectable exact-UID
read seam is needed for a fake; editor orchestration stays in the VS Code package.

Two broader alternatives are rejected:

1. A language server would duplicate the in-process index, document synchronization, command
   dispatch, and Calendar capability boundary for one editor.
2. A generic schema/DSL/LanguageService would make all projections configurable to serve four
   fixed relationship projections. Static contract metadata and direct Provider functions are
   smaller and keep compatibility decisions visible.

## Ownership and component boundaries

### Semantic core

Core owns canonical projection names, each relationship projection's allowed/required arguments and
known result fields, strict ISO dates, birthday/cadence interpretation, trustworthy Journal dates,
Interaction inclusion, direct exact Person identities, and normalized rows. The four relationship
projections alone reject unknown arguments; legacy projections retain their existing permissive
argument behavior. `INTERACTION_KINDS` is completion and mutation vocabulary, not a closed Markdown
schema: every non-empty custom Interaction kind still counts and is filterable; only an empty kind
is excluded. This is static discovery metadata plus small pure validators/classifiers, not a runtime
schema engine. Query execution, CLI, Lua/SLIQ, preview, hover, CodeLens, and baking continue to call
the same `runProjection` path.

The public relationship rows are frozen for contract `1.1.0`:

- `people`: `{ person, groups, birthday?, contactEveryDays?, lastInteractionDate?, reconnectOn?,
  openFollowups }`, sorted by `person`;
- `interactions`: `{ ref, page, date, kind, text, people }`, sorted by descending `date` then `ref`;
- `reconnect`: `{ person, kind, due, lastInteractionDate? }`, sorted with `due: null` first, then ISO
  due date ascending, then canonical `person` ascending;
- `person-context`: the one matching people row plus `{ openFollowupRefs, recentInteractions }`,
  where `recentInteractions` contains at most ten public interaction rows.

Optional fields are omitted rather than set to `undefined`. Internal parser offsets are not public
row fields. Core validates relationship arguments before execution: `people` accepts none;
`interactions` accepts `person/from/to/kind`; `reconnect` accepts `date`; `person-context` requires
one exact canonical `person`. Dates are strict ISO, reversed ranges are invalid, Person identities
must exist and be Person pages, and `kind` need only be non-empty. `fields` and `limit` remain
presentation arguments; adapters validate `limit` as a non-negative integer and actually apply it.
CLI and Lua pass only explicitly supplied legal arguments and leave projection defaults in core.

Core mutations remain the only Markdown write path. `logInteraction` continues to validate every
selected Person and the Journal expected contents immediately before its one atomic ChangeSet.

### VS Code Provider and command layer

Providers read the supplied `TextDocument`; they do not read a cached copy of that document to
derive tokens or ranges. JavaScript string offsets and VS Code `positionAt` are used together so
UTF-16 positions remain native, while core parser offsets are translated back through
`originalSourceOffset` for CRLF sources.

Providers return presentation objects and registered command IDs. Task and diagnostic code actions
do not carry writable `WorkspaceEdit`s. Existing task commands perform mutations; the one
deterministic diagnostic-fix command rechecks document version and expected source text before
applying its edit.

### Apple bridge and Calendar

The bridge owns an additive exact UID read for Brief. That narrow read returns `found`, `missing`, or `ambiguous`; duplicate
UID records in one named calendar are never collapsed by last-wins selection. The current bridge
cannot authoritatively observe cancellation, so this feature makes no cancellation claim. The
editor requests exactly the task's one bound UID in the sealed configured calendar. It never
searches by title, infers attendees, or copies event state to Markdown. The brief orchestration
accepts an injectable reader for tests but uses the production Calendar bridge. It does not call,
recommend, or persist state for formal Sync/Resolve. Existing mutation-bearing Calendar Sync and
Resolve are unchanged and are not certified by this plan; sealing their `(calendarName, uid)`
identity, retaining duplicate ambiguity in batch reads, and verifying exactly one match before an
update remain explicit follow-up debt. If implementation changes their shared read/update API or
behavior, that debt enters this scope and must be fixed before merge.

### Foam

Foam keeps ordinary `[[Page]]` definition, references, rename, backlinks, hover, graph, and page
creation. Before treating `[[X@Y]]` as special, LifeLoop checks whether the literal page
`X@Y.md` exists; if so it returns no definition and leaves the link to Foam. Otherwise its
DefinitionProvider returns only SB `[[Page@anchor]]` / `[[Page@position]]` targets and the exact
value of `person:` inside a recognized relationship query. Relationship hover returns nothing when
the cursor is merely inside an ordinary wikilink.

## Source identity, ranges, and freshness

A task action starts with a runtime-validated `GuardedSourceHandle`. `ref`, `expectedText`, and
`expectedState` must all be valid strings; `ref` is identity while the other two are receipts,
never lookup keys. `taskTarget` is the only command admission path and must resolve every supplied
handle again, including inputs that also carry an old presentation page/offset. Task-command handles
use live-source coordinates, matching `resolveRef` and `TextDocument.offsetAt`. For a numeric task,
the fresh indexed/parser ref is translated once through `originalSourceOffset` and must then exactly
equal the handle; the handle offset must also be the live task line start. Cursor-created handles
are already live and are never translated. Thus an old offset that merely lands inside a moved,
unchanged line refuses. An anchor may relocate only when its identity remains unique; its line and
marker receipts must still match.

Freshness has three deliberately small levels:

1. Pure lexical work reads the supplied `TextDocument` directly: fences, tokens, ranges, fixed
   projection/argument/field/kind suggestions, and local birthday/cadence/Interaction syntax.
2. Index-dependent derived semantics require an already settled snapshot whose generation equals
   the source revision. If freshness cannot be established, fixed completion remains available but
   identity diagnostics are postponed and derived hover/action eligibility returns nothing. A
   stale index never outranks a live buffer. Exact definition reads the exact target through the
   live-buffer-aware vault and revalidates its Person tag without needing a global reindex.
3. Authority-sensitive task commands explicitly refresh and serialize behind current index work.

After every actual prompt result and Calendar read, before an effect or output, the command repeats
the level-three refresh. The 400 ms debounce is only an indexing optimization. The action resolves
the original handle and verifies all of the following against the refreshed snapshot and live
source:

- the same task identity still exists at the resolved handle;
- task marker state and shown source line still match the guard;
- selected People remain direct, canonical links on that task and remain Person pages;
- for a brief, exactly one unchanged event binding still equals the UID that was read and the
  configured calendar still equals the sealed `calendarName`.

Admission failures happen before an effect and refuse closed. Dirty task/Person buffers may be live
read authority and are never implicitly saved; a dirty Journal is a write-target conflict and is
refused without changing its buffer or save state. A refusal writes no Journal line and opens no
partial brief. Reindex/read failures are not retried speculatively.

Write failure is not reported as "nothing written; retry" until bounded authoritative whole-file
reconciliation proves it. All affected files equal their before values means not applied; all
equal the intended after values and durable save is confirmed means success. A provable partial
before/after state may use the existing one serial rollback and then revalidate. Any unreadable,
third, or rollback-uncertain state remains `UNKNOWN`, preserves the evidence, and gives no automatic
retry advice. No operation journal, takeover, or recovery-of-recovery layer is added.

Provider ranges are computed from the current document text. One located query parser preserves
projection/key/value/field offsets and is shared by preview, hover, CodeLens, completion,
diagnostics, and definition. Its fence finder accepts both existing `lifeloop` and `query` aliases,
backtick runs of at least three, and tilde runs of at least three. It records the opening marker
character and run length; only the same marker with at least that length and trailing whitespace
closes the block. Shorter same-marker and all opposite-marker runs remain body text. Token columns
are JavaScript UTF-16 indices, matching VS Code. CR-stripped parser offsets used for indexed task
identity become live task-handle coordinates through the one normalization above. Interaction rows
retain parser refs; only their full-result/Brief presentation links receive their separate one-time
`originalSourceOffset` conversion. Handwritten raw numeric SB refs retain their existing live-source
coordinate meaning. CRLF terminators are never included in a diagnostic or replacement range.

## P0 behavior

### Relationship query completion

Inside recognized `lifeloop` or `query` fence bodies, completion offers projection names. Once one of the four
relationship projections is selected, it offers only that projection's legal arguments plus the
common presentation keys `fields` and `limit`. It offers canonical Person paths after `person:`,
the fixed `INTERACTION_KINDS` after `kind:`, and only fields known for the selected projection after
`fields:`. It appears only in a query body and the appropriate value position. Completion does not
invent dates, Person aliases, arbitrary fields, or a second query grammar.

### Diagnostics

Relationship lexical diagnostics recompute immediately for the changed URI; the 400 ms index
debounce is never a diagnostic correctness boundary. Index-dependent identity diagnostics are
added only after the matching snapshot settles. Diagnostics point at the smallest live token and
cover:

- invalid `birthday` and `contact-every` values on a live Person page;
- an empty explicit Interaction kind;
- explicit Interactions excluded because the page has no trustworthy Journal date or because the
  item has no direct exact Person link;
- unknown relationship-query arguments and fields;
- malformed `date`, `from`, or `to`, and `from > to`;
- a `person:` value that is not an existing exact canonical Person page.

Any non-empty custom Interaction kind counts and has no unsupported-kind diagnostic. Severity is
deterministic: invalid projection/argument/field/date/range/limit or required Person identity is an
Error; ignored birthday/cadence, empty kind, untrusted Journal date, or missing direct exact Person
is Information; existing compatibility notices remain Information where appropriate. Messages explain
why excluded Interactions do not count. They never suggest inferred attendees, dates, paths, or
kinds.

### Definitions

The DefinitionProvider resolves SB special refs only after literal `@` filename precedence, using
the existing live `resolveRef` rules, anchor uniqueness, CRLF translation, and exact position
bounds. It resolves `person:` only when the value exactly equals a canonical Person page. It is
registered for file and untitled Markdown but returns nothing for an ordinary wikilink, missing
Person, ambiguous page, unrelated query result text, or unrelated Markdown.

### Log Interaction stale boundary

Person-page logging remains a direct Person command and revalidates live Person identity after every
prompt. Task-originated logging retains the original task handle, task source, event binding, and
initially eligible direct People. After every Quick Pick/InputBox completes, the command refreshes,
resolves the original handle, requires the same indexed task identity, recomputes direct exact
People, revalidates Person pages, and rechecks any event binding that supplies a default kind. The
final selected set must be a non-empty subset of the recomputed direct set.

The final core mutation includes the task source contents when task-originated, every selected
Person page's contents, and the Journal before-value in one optimistic `ChangeSet.expected`. Only
then may it append one multi-person Journal item. A dirty Journal or any final race refuses; a
write-response loss follows the reconciliation rule above rather than inviting an unsafe retry.

### Restricted Pre-meeting Brief

Eligibility requires a guarded task, exactly one exact `[event: "UID"]` binding, and at least one
direct exact Person link. One validator performs the level-three refresh and verifies the handle,
task identity, binding, direct People, live Person identities, and configured calendar. It runs
before the first capability call; only then does the command seal `{handle, uid, calendarName,
directPeople}`. After `requireApp` it reruns the validator and requires exact equality with that
tuple, calls the additive exact reader for only that UID/calendar, then validates exact equality a
third time. Only a unique `found` result proceeds; `missing`, `ambiguous`, read failure, or any
changed receipt refuses. The rendered contexts are computed only after the final validation and all
contexts must succeed before one untitled Markdown document is opened. Brief writes neither
Markdown nor Calendar nor conflict/observation state, and it never invokes or recommends Resolve.
No partial brief is cached or shown.

### Contract version

The committed baseline exposes `CONTRACT_VERSION = 1.0.0`; the relationship projections are an
additive public contract change. The current worktree's existing `1.1.0` bump is therefore retained.
The VS Code extension package remains `0.1.0`; editor Provider additions do not change the semantic
contract version again.

## P1 behavior

### Command-backed task code actions

On a task line, the Provider returns existing commands for Complete/Reopen, toggle Waiting,
toggle Someday, Set Deadline, and Set Scheduled. It adds Log Interaction only when refreshed task
state has at least one direct exact Person. It adds Open Pre-meeting Brief only when the same task
also has exactly one exact event binding. Every command receives a guarded handle. No task action
contains an edit.

### Relationship semantic hover

Hover is restricted to LifeLoop-owned task or relationship syntax:

- a task marker/attribute area may show direct People separately from inherited-only People;
- an Interaction attribute says whether the item counts and, when it does not, the exact reason;
- `birthday` shows the next strict occurrence, including leap-day behavior;
- `contact-every` shows cadence, last explicit interaction, reconnect date, and whether it is due.

Hover performs no Calendar I/O and returns nothing for ordinary wikilink text. Query-block hover
continues to use the existing query result surface.

### Projection parity and recipes

Tests exercise one snapshot through direct core projection calls, preview/query execution,
query hover, CodeLens count, baked Markdown evaluation, Lua, and CLI JSON, including `limit`.
Adapters pass only legal explicit arguments. These surfaces may render differently, but their row
values and filtering must agree. Documentation adds recipes for People, Interaction timeline, due
reconnect, and Person Context without adding a renderer or DSL.

## P2 behavior

### Interaction document symbols

The existing task symbol provider also emits one `Event` symbol for each explicit Interaction in
the current Journal document, including custom non-empty kinds and excluded/empty ones. Symbols use
live document ranges and include whether the item is counted; invalid/excluded entries remain
diagnostics rather than guessed events. Markdown/Foam continues to supply headings.

### Deterministic diagnostic actions

A quick fix is offered only when the source has one case-insensitive canonical spelling: for
example a relationship projection, argument, or known field with incorrect case. Every task and
diagnostic CodeAction has an empty `edit` and invokes a registered LifeLoop command. The diagnostic
command receives URI, range, expected text, document version, located-token identity, and canonical
replacement; it revalidates every receipt before creating its edit. Invalid dates, unknown People,
empty kinds, and excluded Interactions have no fix because choosing a replacement would infer intent.

### Temporary-result navigation

Only the full query-result document and successful brief add presentation navigation. Canonical
Person identities always use escaped standard Markdown file-URI links, so navigation works without
Foam and needs no runtime capability branch. Source refs use SB special
refs, with the one-time CRLF conversion described above. Raw projection rows, preview rows, CLI JSON,
and hover content remain unchanged and untrusted. This is not a page, cache, Webview, detail screen,
or second renderer.

## Test matrix

| Boundary | Core | VS Code mock/unit | Calendar fake / real host |
|---|---|---|---|
| direct vs inherited exact Person links | projection and mutation fixtures | completion, hover, eligibility | brief eligibility |
| multi-person Interaction | one atomic Journal item | task command selection | n/a |
| prompt-time source/link/task change | guarded ref fixtures | command refuses; Journal unchanged | n/a |
| Calendar-read-time source/binding/Person change | n/a | orchestration refuses output | exact-UID fake mutates source during read |
| dirty/concurrent Journal and response loss | whole-file reconciliation | dirty buffer/save state preserved | n/a |
| missing Person/event; Calendar unavailable | exact identity refusal | no temporary document | fake missing/throwing read |
| anchored task and duplicate/missing anchor | `resolveHandle` | command and code action target | brief target |
| CRLF and UTF-16 before task/token | offset translation | exact diagnostic/definition/action ranges | n/a |
| 400 ms stale-index window | live source remains authority | promise barriers; never fixed sleeps | post-read refresh |
| query projection/argument/field/date/person | contract metadata | completion, diagnostics, definitions | n/a |
| Interaction/birthday/cadence hover and symbols | strict semantics | live ranges and no wikilink takeover | no hover I/O |
| preview/hover/CodeLens/baking/CLI parity | normalized rows | render/count/bake | CLI process |
| Foam coexistence | n/a | ordinary links/hover/rename remain Foam-owned | packaged profile |

The smallest sufficient checks are semantic-core Vitest tests, VS Code mock/provider tests, Apple
Calendar fake tests, and focused real VS Code integration cases. Run package tests, root typecheck,
extension build, and the task-only integration profile. Run Foam coexistence when its pinned test
extension is available; report a skipped external Apple or Foam check as not covered, never PASS.

## Red/green evidence ledger

Every row is recorded RED against frozen baseline `036e13c8` before its implementation commit and
GREEN afterward. Stale-index tests use controllable promise barriers, never fixed sleeps. The final
packaged gates bind results to the tested VSIX SHA-256.

| ID | Baseline counterexample and required terminal assertion | Gate |
|---|---|---|
| R1 | Reject `people({person})`, invalid/reversed interaction dates, and missing Person instead of silently returning rows/empty | semantic-core |
| R2 | One discriminating fixture matches through core, preview/query, query hover, CodeLens count, bake, SLIQ/Lua, and CLI; `limit` 0/1 works, while negative/nonnumeric/fractional editor and CLI limits refuse with no result JSON | core + adapters + CLI |
| R3 | Exact public keys/order/null/omission/nesting/filtering are stable; recent interactions have only public keys and at most ten rows; all four documentation recipes parse and execute | semantic-core + adapters + docs |
| R4 | Overflow cadence never reaches date shift; it is ignored with Information | core + VS Code |
| R5 | custom `coffee` counts with no diagnostic; empty kind is excluded with Information | core + VS Code |
| R6 | both aliases, matching long backtick/tilde closes, mixed-marker and shorter runs, CRLF, and astral prefixes preserve ranges; invalid limit Errors select exact value tokens; completion stays inside body/value | VS Code unit |
| R7 | changed birthday/cadence/Interaction text updates lexical diagnostics immediately and never triggers a full reindex | VS Code unit |
| R8 | a stale index cannot preserve Person identity removed in a live buffer for definition/action/derived hover | VS Code mock |
| R9 | an existing literal `Ordinary@anchor.md` is left to Foam; otherwise special anchor navigation is exact under CRLF | task-only + Foam host |
| R10 | unchanged task after CRLF works; moved numeric ref landing inside the same task refuses; a unique moved CRLF anchor succeeds; no ref is double-translated | core + VS Code |
| R11 | normalized indexed ref equals live handle exactly; stale handle plus page/offset, missing either receipt, and wrong runtime types all refuse with no write | VS Code unit |
| R12 | mutation after each Log prompt of task/link/Person/default event leaves Journal byte-identical | VS Code command |
| R13 | task/Person race before apply and dirty Journal neither write nor save the Journal | core + VS Code |
| R14 | before-throw, applied-then-throw, and third-state write failures classify not-applied/success/UNKNOWN without unsafe retry | semantic-core |
| R15 | pre-invocation ineligibility calls neither app nor reader; mutation after app check or during read of binding/People/tag/calendarName opens nothing | Calendar fake |
| R16 | duplicate/missing/throwing exact UID reads open nothing and never write Brief conflict state; success requests one UID | bridge + VS Code |
| R17 | every task/diagnostic action has empty edit; stale diagnostic receipts make its command refuse | VS Code unit |
| R18 | custom/empty Interaction hover and symbols match core; ordinary wikilinks get no LifeLoop hover | VS Code unit |
| R19 | only full result/Brief add navigation; standard Person file link and CRLF source target resolve exactly; raw/CLI/hover output is unchanged | VS Code unit |
| R20 | final VSIX opens both temporary documents and resolves Person/source links in task-only and Foam `0.44.6` hosts, proves Foam absent/present respectively, and binds results to artifact SHA | packaged integration |

A real Apple exact-read smoke is read-only and optional; a skip is `NOT COVERED`, not PASS. P2 is
part of this requested delivery, so R17–R20 may not be dropped merely because adjudication permits a
future plan to defer P2 as a whole.

R2/R3 use one fixture with omitted optional values, a never-contacted Person, tied overdue People,
more than ten Interactions, custom kinds, and filtered-out rows. Raw consumers deep-equal exact rows;
rendered consumers preserve selected values and order; CodeLens equals the post-limit count. Exact
`Object.keys`, absent rather than `undefined` optionals, explicit null, nested public keys, the
ten-row bound, filters, and all declared ordering are asserted. The People, Interaction timeline,
due reconnect, and Person Context documentation recipes are each parsed and executed in tests.
Invalid editor limits select the exact live value token with Error severity and execute no result;
equivalent CLI values exit nonzero with an actionable error and no successful JSON rows.

## Delivery order

1. Freeze and independently review this design; consolidate findings before production edits.
2. Add the minimal shared contract/validation metadata and prove anchor, CRLF/UTF-16, and stale
   source behavior with focused tests.
3. Fix `taskTarget`, task-originated Interaction, and Pre-meeting Brief revalidation.
4. Add completion, live diagnostics, narrow definitions, and command-backed task/diagnostic actions.
5. Add restricted semantic hover, Interaction symbols, and temporary-output navigation.
6. Add projection parity tests and documentation recipes.
7. Run focused and full available verification, freeze the implementation revision, perform the
   required independent code-review round, consolidate valid fixes, and rerun dependency-closure
   checks.

## Revision-1 review disposition

Three independent reviewers checked the same frozen digest
`0dd077f3afb0ce49e4fc3186696bbf1f527c870db46bfc9a9ae97c6f3746e2fa`: authority/race at
`xhigh`, data/API at `high`, and scope/evidence at `high`. An independent `xhigh` adjudicator
accepted their concrete counterexamples but rejected broad fixes that would change legacy
projection semantics, turn kinds into a closed enum, globally reinterpret numeric refs, reindex
for lexical Provider work, invent cancelled status, or add a service/recovery subsystem. This
revision is the single consolidated correction selected from that adjudication. It must be frozen
and closure-reviewed against every R1 finding and the dependency closure before implementation.

## Revision-2 closure disposition

The same authority/race (`xhigh`), data/API (`high`), and scope/evidence (`high`) perspectives
reviewed frozen revision 2, followed by independent `xhigh` adjudication. Revision 3 consolidates
their accepted in-scope findings: live-coordinate task refs, null-first reconnect order,
Information severity for ignored/excluded relationship content, same-marker Markdown fence closure,
complete public-shape/parity/recipe evidence, pre-capability Brief validation, universal Person file
links, and malformed-limit gates. It deliberately does not certify or modify formal Calendar
Sync/Resolve; its accepted sealed-calendar/duplicate-UID defect remains separately recorded debt and
becomes blocking here only if implementation touches that shared behavior.

## Explicitly out of scope

- any LSP server or reusable generic LanguageService;
- Person/page RenameProvider, ordinary wikilink definition/references/backlinks/rename/hover, graph,
  WorkspaceSymbol, or general search;
- Calendar attendee inference, title matching, hover-time Calendar access, or Calendar writes from
  a brief;
- semantic tokens or inlay hints; the specified completion/diagnostic/definition/hover/actions and
  existing CodeLens cover the concrete cases;
- Interaction Outline beyond explicit Interaction document symbols;
- saved brief pages, result caches, Webviews, generic detail screens, or a second renderer;
- generic schema/DSL engines, CRM, editable grid, chart, scoring, AI classification, or analytics
  features.

An LSP is reconsidered only when there is a real second editor, a required extension-host process
isolation boundary, or a shared multi-editor semantic service. None is present in this scope.
