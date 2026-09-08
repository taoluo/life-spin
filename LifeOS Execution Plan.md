# LifeOS execution plan — Phases 0 to 3, and the conditions for 4

`LifeOS for VS Code.md` says what the system is and what it refuses to become. It does not say
what to build on Monday. This file is that: the assessment of that design, the decisions it left
open taken here, and the phases with a definition of done and a gate.

**Phases 0 to 3 are work. Phase 4 is not scheduled** — it records the conditions a rich view would
have to meet, because the design doc files those under Future Work and says plainly that Future Work
may never be built. It is included for the guard rails it defines, not as a plan to build anything.

`DESIGN.md` holds the rules that outlive scope, and now carries **Projection identity** (I4), which
came out of this plan and belongs there rather than here.

**§1 below is a record, not a to-do list.** The design doc has since been revised against these
findings — `lifeos_id` is gone, projection identity is an invariant rather than a
UI coin flip, the mutation API is Phase 0 work, and the two derived stores are one. Its §41 records
what each of those said before and why it changed. The findings are kept here in their original
form because a plan that erases the argument it came from is harder to overturn later, which is the
opposite of what it should be.

---

## 1. Assessment

### What the design doc gets right

The principle layer is not speculative — most of it is `DESIGN.md` restated for a larger scope,
and `DESIGN.md` has an implementation and 91 assertions behind it. One fact one owner (§3.2),
derived state never persisted (§3.5), external systems own execution (§3.7), the mutation contract
(§27), and the rich-view admission rule (§34) are all already load-bearing in shipped code. They
transfer.

Three things in the doc are genuinely new and genuinely good:

* **Retrieval as a first-class V1 capability** (§3.3, §16). This is the strongest new idea in the
  document. "Write now, still find it in five years, without having filed it correctly" is a
  different promise from anything LifeLoop currently makes, and it is the promise a text editor is
  unusually well placed to keep.
* **Knowledge/operations split** (§7). It names the failure mode — the PKM getting database-ified
  because the LifeOS half needed structure — and puts a wall between them.
* **Query != View** (§19, §29–§34). The rule that a view may consume facts but never justify
  creating them is the thing that stops this becoming Notion with extra steps.

### What it leaves unresolved

Nine findings. Each one is folded into the plan below rather than left as commentary.

**1. The doc never says why the port is happening.** It designs a replacement for a working system
without citing the friction that justifies replacing it. That inverts this project's own rule —
`ROADMAP.md` gates every phase on real use rather than an imagined need, and records that daily use
has not happened yet. A rebuild is the largest possible feature; it should meet the highest bar.

The justification does exist in the repo, it is just not in the design doc. `ROADMAP.md` Phase 4
records a ceiling LifeLoop cannot work around from inside: the host strips the event payload
crossing from a plug into Space Lua, so ticking a task in a query view leaves it unstamped, and
*"nothing here can work around a ref it is never told."* That is a structural limit of being a
guest in someone else's runtime, and it is the honest reason to own the semantic layer.

→ **Phase 0 opens by writing that down** (deliverable 0.1). A port whose motivation lives only in
someone's head gets re-litigated every time it is inconvenient.

**2. Phase 0 hides the project's biggest risk: semantic drift.** "Markdown parser, links, tasks,
object index" reads like a fortnight and is a year if written from scratch, because SilverBullet's
semantics are defined *by its implementation* — `inComment`, inherited `itags`, the two ref forms,
attribute parsing, what counts as an item. A clean-room rewrite reproduces the shape and loses the
corners, silently, and every LifeLoop contract that depends on a corner breaks in a way no test
catches.

It does not have to be written from scratch. I checked, and the reuse story is far better than the
doc assumes:

* SilverBullet's markdown parser and its index extractors **already run headless in Node.** 36
  tests across `client/markdown_parser/parser.test.ts` and `plugs/index/task.test.ts` pass under
  vitest in under a second, with no DOM and no client.
* The extractors are **already pure**: `IndexerFunction = (pageMeta, frontmatter, tree, text) =>
  ObjectValue[]`. `item.ts`, `link.ts`, `frontmatter.ts`, `tags.ts`, `attribute.ts`, `anchor.ts`,
  `header.ts`, `paragraph.ts`, `data.ts` and `snippet.ts` contain no syscalls at all; `relation.ts`
  has two, and both are in a link-*resolution* helper that asks the store whether a path exists —
  which is precisely the seam Phase 0 replaces. The runtime coupling is in the orchestration and
  the persistence call, which is the part we are replacing anyway.
* The split falls in a useful place: tasks come out of `item.ts` as items tagged `task`, so the
  whole extraction side is reusable, while `task.ts` — toggling, cycling, `cycleTaskStateByRef` —
  is the *mutation* side, and that is CodeMirror dispatch we would replace regardless. It is also
  exactly where LifeLoop's ref route died. Small, and ours.
* SilverBullet is MIT (Zef Hemel), and `silverbullet/` here is already a local reference checkout.

→ **Phase 0 vendors rather than reimplements**, and adds a differential conformance test against a
live SilverBullet index (deliverable 0.6). The harness for that already exists — `test/verify.sh`
drives the Runtime API against a real client today.

**3. The mutation API is scheduled too late.** §27 states the mutation contract as a core
invariant, but no phase builds it; §19's query layer arrives at Phase 3 and Apple sync at Phase 2
writes before it. Every writer — the UI, the Apple bridge, and eventually AI — is supposed to go
through one named, validated path. If that path does not exist in Phase 0, Phase 1 grows a second
one and Phase 2 a third.

→ **Mutation API moves into Phase 0** (deliverable 0.5). It is small: the contracts are already
written and tested in `LifeLoop/{Inbox,Attach,Completion,Review}.md` and only need porting.

**4. The query layer is both earlier and later than the doc says.** Phase 1 cannot build Today,
Upcoming or the Weekly Review without querying, so a query engine ships in Phase 1 whether it is
planned or not. What Phase 3 actually adds is not the engine but the *contract*: a frozen public
shape, saved definitions, more than one consumer.

→ **Phase 0 ships the engine as an internal API; Phase 3 is renamed to what it really does** —
freezing that API as a public contract and proving it with a second client. The doc's ordering is
kept; only its description was wrong.

**5. Apple Notes bidirectional sync breaks §3.2 and should not be in V1.** §22 allows "limited
bidirectional updates" while an item is pending. During that window, two systems own the same
text, which is the exact thing §3.2 exists to forbid, and it is the hardest engineering in the
whole document — conflict, ordering, deletion, identity — spent on the least valuable direction.

→ **Phase 2 splits into four gated slices**, and the Notes scope is settled in 2d.

That entry moved three times — one-way, then bidirectional with a conflict stop, then one way again
with the Inbox reframed as the superset of every capture source. Worth naming rather than smoothing
over: a decision that flips every round is one with no usage behind it, which is exactly what this
project's own gates exist to catch. But the third position is not a coin toss between equals. It
satisfies §3.2 with no conflict path at all, and is simpler than both — so this is convergence, not
churn. The original §22 proposal, "limited bidirectional updates" with no boundary and no conflict
policy, is refused in all three.

**6. `lifeos_id` (§25) contradicts §10.1 and is not needed.** §10.1 says identity tax is paid only
by entities that need identity outside Markdown. §25 then gives everything a LifeOS UUID that
external ids merely bind to. §26 adds that binding identity may not live only in the sync DB — so
the id has to reach the Markdown anyway.

LifeLoop already solved this and shipped it: the external id goes **on the task line**
(`[reminder: "…"]`, `[event: "…"]`), rendered as 🔔 / 📅, and there is no LifeOS id at all.
`DESIGN.md` records that decision, including the constraint it overruled and why the alternative —
a side table keyed by task — is the database this project exists to avoid.

→ **No `lifeos_id`.** Bindings are inline attributes. Revisit only when something needs identity
that cannot be expressed on a line.

**7. Two derived stores with two rebuild rules should be one store.** §26 gives `sync.sqlite` a
deletion guarantee; the object index has its own. Two stores means two invalidation paths, two
schema versions and two ways to be half-rebuilt.

→ **One file, `.lifeos/index.sqlite`, separate tables, one rebuild path.** Finding 6 is what makes
this safe: with bindings inline, nothing in that file is a user fact.

**8. Nothing is measurable.** §18.2 says rewrite in Rust only if profiling proves a bottleneck, but
names no budget to profile against, and §38's success criteria are stated as prose rather than as
checks. A criterion nobody can run is a preference.

→ **Budgets are numbers in §3 below**, and §38's criteria are sorted in §4 into the four that can
be tests and the four that can only be gates — because pretending the second kind is a test is how
the criterion stops meaning anything.

**9. Missing entirely: migration, coexistence, and the name.** Nothing says what happens to the
existing space, to the SilverBullet library, or to the fact that this repo renamed itself to
LifeLoop three commits ago and the design doc calls the system LifeOS.

→ Answered in §7. Short version: the vault *is* the migration, the library is frozen not deleted,
and the product stays **LifeLoop** — the loop is the product; "LifeOS" is a category.

### One thing the doc is right about that will be tempting to get wrong

§20 maps Today to "TreeView / virtual document" with a slash, as if the choice were cosmetic. It is
the central client decision of Phase 1, and finding 1 is exactly why: LifeLoop's Today is valuable
because a checkbox in the projection writes back to its source, and the thing that broke was
identity — a ref that arrived without enough information to verify what it pointed at.

A TreeView node holds the real page, range and text. Ticking it is an exact mutation against a
source it can re-verify. A rendered virtual document has to reconstruct that from a position in
generated text, which is the failure LifeLoop already had.

The conclusion to draw is not "Today must be a TreeView" — that is one implementation. It is the
invariant underneath, I4, which binds a Kanban card in Phase 4 exactly as it binds Today in Phase 1:
the card displays a title and operates on a handle.

**Identity alone is not enough, and the distinction matters.** A ref survives an edit that changes
what sits at it — insert a paragraph above `Project@1820` and the ref still resolves, to something
else. So the handle a projection carries is:

```ts
SourceHandle { ref, expectedState, expectedTextHash, capturedAt }
```

and a mutation re-resolves the ref, verifies the guard, and writes only if it holds. Otherwise it
re-resolves the semantic object or writes nothing.

**The two fields do different jobs, and conflating them is a documented error.** The ref is
identity. The hash is *only* a staleness guard — it may never be used to find a task. `DESIGN.md`
warns that matching on text "the index may already have replaced would only look like more
certainty", and that is correct for the case it describes: reacting to a host event, where the only
text available came from the index. The projection case is different in kind — we read the source
ourselves when we rendered the row, so comparing it back detects that the source moved under us. It
is not a second opinion about identity; it is a receipt for what we showed the user.

In VS Code this needs one more distinction, because there are three versions of a page at any
moment — the index's, the disk's, and an unsaved buffer's. Resolve against the **live buffer** when
the document is open (`TextDocument.version`) and against the file otherwise. The index locates; it
is never the thing verified against.

---

## 2. Decisions taken now

Split deliberately. This project's whole method is that structure is earned from real friction, so
a table of ten upfront decisions is in tension with it unless the two kinds are kept apart:
**invariants** are expensive or impossible to retrofit and are decided now; **choices** are
implementations of an invariant, decided now only so Phase 0 does not stall, and expected to be
re-opened by use.

Confusing the two is how a plan quietly freezes a product.

### Invariants — decided now, and they outlive the phases

| # | Invariant | Why |
|---|---|---|
| I1 | **Compatibility with SilverBullet's semantics is a declared contract, not a vibe** — see 0.2a for what is inside it. Vendor rather than reimplement; MIT notice and provenance intact | The semantics *are* the implementation (finding 2); an undeclared contract makes "conformance clean" undefined |
| I2 | **`ObjectValue<T>` is the object model** — `ref`, `tag`, `itags`, `range` | Makes the conformance test possible at all, and keeps a return path open |
| I3 | **One derived store, one rebuild path.** Nothing a user could not lose lives in it | Finding 7. Two stores means two invalidation paths and two ways to be half-rebuilt |
| I4 | **A projection carries an opaque source handle — identity *and* enough state to detect staleness. A mutation re-resolves it and verifies before writing; stale or ambiguous means no write** | This is what actually broke in LifeLoop, and it binds every future surface — Table, Kanban, Cards, a webview — not just Today. Now in `DESIGN.md` |
| I5 | **Every write goes through the named mutation API**, and it exists before any workflow uses it | Finding 3. One validated path, or three unvalidated ones |
| I6 | **No universal internal ID. Identity is earned** | Finding 6, as amended below |
| I7 | **Compose the VS Code primitive where one exists** | `DESIGN.md` admission rule 6, restated for a new host. A second grep is a worse grep |
| I8 | **The Inbox is the superset of all pending captures.** Native captures are canonical in Markdown at once; external ones are source-backed mirrors while pending; content never flows back to a source; processing — or a local edit — transfers ownership to LifeLoop | Finding 5, and §3.2 satisfied without a conflict path at all |

I6 is narrower than this plan's first draft, which said "no `lifeos_id`" flatly. The correct rule is
**no *universal* ID** — every ordinary task paying identity tax for a feature it will never use is
the thing to refuse. Earned identity is fine and already has a native mechanism: SilverBullet's
`$anchor` turns a positional `page@pos` ref into a stable named one, which is exactly "identity paid
for by the entity that needs it" (§10.1). External bindings stay inline attributes.

Two triggers would earn it, and neither has fired: one task bound to Reminders *and* Calendar *and*
an agent history at once, or an external system deleting and recreating its object such that the
external id stops being stable. Until then, refs and anchors.

### Choices — decided now to unblock, expected to be re-opened

| # | Choice | Implements | Re-open when |
|---|---|---|---|
| C1 | SQLite via **`node:sqlite`** (built in, FTS5 included — no native dependency to build or fail to install), `.lifeloop/index.sqlite` | I3 | a budget in §3 is missed and profiling blames the store |
| C2 | **Today, Inbox, Projects, Waiting are TreeViews** in Phase 1; no rendered-checkbox surface | I4 | daily use says a list is worse than a rendered page — and then the replacement must still satisfy I4 |
| C3 | FTS5 serves object and alias lookup; text search stays VS Code's | I7 | never, unless VS Code's search stops resolving what people actually look for |
| C4 | Mutation set ported from `LifeLoop/{Inbox,Attach,Completion,Review}.md` | I5 | a workflow needs a mutation the ported set has no shape for |
| C5 | Apple bridge is `osascript` first; EventKit on a written trigger (2b) | I8 | polling latency or completion detection proves unreliable in use |
| C6 | The audit becomes diagnostics, not a page | I7 | — |
| C7 | Name stays LifeLoop; packages are `@lifeloop/*` | — | before Phase 0 lands, or not at all |

Two things this table deliberately does *not* decide, because they are Phase 3 and 4's to earn: a
query DSL (0.7 ships typed predicates and no DSL) and whether Kanban is ever built at all.

Repo layout that follows:

```
packages/
  semantic-core/     @lifeloop/semantic-core   parse · index · query · mutate
  vscode/            @lifeloop/vscode          the extension
  cli/               @lifeloop/cli             lifeloop index|query|apply — tests and the MCP seam
  apple-bridge/      @lifeloop/apple-bridge    Phase 2
vendor/
  silverbullet/      vendored MIT sources + PROVENANCE.md pinned to a commit
LifeLoop/            the SilverBullet library — frozen at Phase 1's gate, not deleted
```

---

## 3. Budgets

Numbers exist so §18.2 has something to profile against. They are targets to validate in Phase 0,
not measurements.

| | budget | measured on |
|---|---|---|
| | budget | measured, 10k synthetic pages |
|---|---|---|
| Cold index, 10k pages | < 15 s | **8.2 s** ✅ |
| Incremental reindex, one page | < 50 ms | **4–6 ms** ✅ |
| Rescan, nothing changed | — | 1.1 s (hashing 10k files) |
| Today projection | < 30 ms | **0.0 ms** for a realistic result; 30 ms when it returns 3,336 rows |
| Backlinks for one page | < 20 ms | **0.0 ms** ✅ |
| Full-text search | < 30 ms | **0.3 ms** ✅ |
| Resident memory, 10k pages | < 300 MB | **163 MB** ✅ |

**State the projection budget per result size, not absolutely.** Row cost is ~3.7 µs, essentially
all `JSON.parse`, so any figure for "Today" is really a figure for how many rows Today returned.
The synthetic vault puts two tasks on every one of 10 000 pages, which no real vault does; asking it
for every open task costs 74 ms and that is the honest number for 20 000 rows, not a slow query.
What matters is that filtering happens in SQL, so a projection pays for what it returns.

Missing a budget is a trigger to profile, not a trigger to rewrite in Rust — and profiling earned
its place immediately. The first honest measurement was **48.5 s**, six times over. None of it was
inherent:

* the seam rebuilt a whole-vault basename index on every page — quadratic, and mine. Caching it
  against the lookup's identity took extraction from 3.45 ms to 0.23 ms a page.
* `DELETE FROM fts WHERE page = ?` scanned the entire FTS table, because `page` was `UNINDEXED`.
  Keying FTS rows by the page's rowid took the store from 22.3 s to 4.3 s.
* committing per page cost more than the writes; batching at 500 took it to 1.2 s.
* expression indexes were never used, because `ORDER BY` sent SQLite to a temp b-tree instead, and
  `IS NOT 1` cannot drive a seek at all. Sort columns in the index and five hot fields as real
  columns took backlinks from 103 ms to nothing measurable.

Worth recording because every one of them is invisible until measured, and three were introduced by
this implementation rather than inherited.

---

## Phase 0 — Semantic core

**Goal.** A UI-independent TypeScript package that turns a directory of Markdown into queryable
objects and applies validated changes back. No VS Code, no LifeOS commands.

**Deliverables.**

0.1 **`WHY.md`** ✅ *written* — the friction that justifies leaving SilverBullet. It rests on the
two candidates below that are already true — the ecosystem §35 already committed to reusing, and
the round-trip cost of being a guest — and explicitly declines to rest on the payload bug alone.
One page, written first, because everything below is expensive. It has to answer the counterfactual rather than only state
the grievance: the last host gap of this kind **was fixed upstream** — `ROADMAP.md` records the
host growing a `{ ref, oldState, newState }` event because LifeLoop needed one — so "the payload is
stripped crossing into Space Lua" is an argument for a patch unless something makes it an argument
for a port. Three candidates, and the doc must pick and defend at least one:

  * the ceiling is structural, not a bug — a guest runtime will keep producing these, and each one
    costs an upstream round trip before anything here can move;
  * retrieval (§3.3, §16) is the actual goal and cannot be built inside SilverBullet at all;
  * the semantic layer needs to outlive its client (§39), which no amount of upstream fixes gives;
  * background sync and an OS bridge need a runtime SilverBullet does not offer a guest.

  **Weigh those by what is already true, not by what is planned.** "Phase 4 will want a richer UI
  surface" is a real consideration and a weak argument, because it is imagined friction — the exact
  currency `ROADMAP.md` refuses everywhere else. An argument that rests on a feature nobody has
  asked for yet cannot justify the largest change in the project's history.

  **Abandonment criterion, written here rather than discovered later:** if upstream would take the
  host fixes *and* the native retrieval, runtime and UI gains do not cover the cost of maintaining
  semantic compatibility, stop. The answer is a patch and this plan ends at 0.1. That branch
  existing is the point — a rebuild that cannot lose its own justification was never assessed.

**Three things execution changed, recorded here rather than left as a surprise:**

* **The closure is 101 files, not the dozen 0.2 listed.** Following imports honestly pulls in
  `client/space_lua/` — `markdown_parser/parser.ts` imports `luaLanguage` so fenced Lua parses the
  way SilverBullet parses it — and the plugos types behind the syscall layer. All MIT, all inert
  until called. `scripts/vendor-sync.mjs` computes the closure rather than trusting a hand list.
* **`indexer.ts` is vendored after all, and that is better.** 0.4 planned to reimplement it over our
  store. Reading it says otherwise: `indexMarkdown(text, pageMeta)` already returns the object list
  and persists nothing — only `indexPage` calls the syscall. So indexer order, comment marking,
  anchor records and recipient stamping are *called*, not reproduced. Less of ours to drift.
* **The seam is smaller than expected.** `plug-api/syscall.ts` is a late-binding proxy over
  `globalThis.syscall`, so the adapter implements that global and nothing in `vendor/` had to change.
  Extraction asks for four things: path lookup, and three config keys that decide what gets indexed.

0.2 **Vendoring, with the adapter boundary enforced rather than intended.** ✅ 
`vendor/silverbullet/` gets `client/markdown_parser/*`, `plug-api/lib/{tree,ref,tags,json}.ts`, and
the pure extractors from `plugs/index/` (`item`, `link`, `frontmatter`, `tags`, `attribute`,
`anchor`, `header`, `paragraph`, `relation`, `data`, `snippet`). Note what is *not* on that list:
`indexer.ts`, which imports the `index` and `markdown` syscalls and is orchestration — 0.4 replaces
it. Their existing tests come along and must pass unmodified.

  ```
  vendor/silverbullet/   parser + extractors, upstream code, knows nothing of us
  packages/compat/       adapters: extractor output → our objects, our store → their lookups
  packages/semantic-core/ store · query · mutation
  ```

  "Local edits held at zero" is a rule that decays into fifteen patches unless something checks it,
  so two CI checks make it structural: **vendor code may not import from `packages/`**, and a
  checksum manifest of every vendored file must match the pinned upstream commit. Editing a
  vendored file fails the build. An unavoidable edit is a deliberate act — update the manifest, and
  record it in `PROVENANCE.md` with the upstream issue it ought to become.

0.2a **The compatibility contract** ✅ `COMPATIBILITY.md`, written before the conformance test, because
without it "conformance clean" has no definition and every diff becomes a judgement call. Three
tiers:

  * **Tier 1 — preserved semantics.** What we promise behaves identically to the pinned
    SilverBullet: task and item extraction, `links` / `ilinks`, `tags` / `itags`, `inComment`,
    frontmatter, anchors, `page@pos` refs, nested-item context, relations. A Tier 1 difference is a
    bug in us.
  * **Tier 2 — vendored implementation.** Code copied at a pinned commit. Local edits stay at
    **zero**: adapt at the seam instead, so a pin bump is a diff review rather than a merge. An
    unavoidable edit goes in `PROVENANCE.md` with the upstream issue it ought to become.
  * **Tier 3 — ours.** Projections, signals, the mutation set, retrieval. Not expected to track
    SilverBullet, and not compared against it.

  **Never follow upstream `main`.** Bump the pin deliberately, run the differential suite across the
  bump, and accept or reject each semantic change explicitly. This is not hypothetical: 2.4.0's
  indexer rework added `links`/`ilinks` inherited from parent nodes *and shifted `task` refs to the
  item's position*, with the changelog's own warning — "if you have code relying on this, you may
  have to adjust it." Vendoring trades implementation risk for upstream-merge burden, and only a
  pin plus this policy keeps that trade good.

0.3 **Store.** ✅  `.lifeos/index.sqlite`: `objects(page, tag, ref, json, from, to)`, `pages(name,
hash, mtime, size)`, `fts` (FTS5 over page text, for alias and object search only — C3),
`meta(schema_version)`. Every write to a page's objects is one transaction: delete then insert.
FTS5 serves object and alias lookup only (C3).

0.4 **Indexer.** ✅  `indexVault(dir)` and `indexPage(name, text)`, replacing `indexer.ts`'s syscall
persistence with the store. A file watcher hashes and reindexes changed pages. Deleting the file
and re-indexing must produce a byte-identical object dump (§38 rebuildability, as a test).

0.5 **Mutation API.** ✅ 33 contract tests, every refusal asserting the vault is byte-identical
afterwards.  The §27 contract as one code path: `resolve → verify preconditions →
construct ChangeSet → validate → apply`, with the invariant that any uncertainty writes nothing and
no composite action can half-complete. Ported from LifeLoop's tested contracts:

  `capture` · `tickTask` · `stampCompletion` · `processInboxItem` · `promotePage` ·
  `attachPageToTask` · `setProjectStatus` · `freezeReview`

  Each arrives with the negative test that already exists in `test/suite.lua` — a stale item writes
  nothing, a pre-LifeLoop completion is never stamped with today's date, a collision leaves the
  source exactly as pending as it was.

0.6 **Conformance harness** ✅ — and building it changed what the harness *is*. See
`COMPATIBILITY.md`.

  **Layer A stopped needing a differential test.** The plan assumed two implementations to compare.
  There is one: we vendor and call SilverBullet's extraction, and `indexMarkdown()` already returns
  objects without persisting. So extraction conformance is proved by construction instead —
  `vendor:check` hashes all 125 files against the pinned commit, and **28 of upstream's own test
  files are vendored alongside the code they test**, running **298 assertions** against our copy on
  every `npm test`. Same code plus its author's own tests is a stronger argument than sampling a
  corpus, which only covers the corners someone thought to include.

  **Layers B and C still need a live client** and are in `test/conformance/live.test.ts`, which
  **skips loudly** — naming what went unchecked — rather than passing silently when nothing ran.

  **The corpus is the deliverable, not the diff.** `test/fixtures/` is eleven files and would pass
  while every corner is broken. Use three tiers: SilverBullet's own `docs/` (241 pages, already
  wired up by `plugs/index/test_corpus.ts` and written by the people who defined these semantics),
  the real vault, and a hand-written adversarial set covering every Tier 1 item by name: task, item,
  `links` / `ilinks`, `tags` / `itags`, `inComment` (including the inversion — Space Lua and styles
  are inert in a comment while other objects are still indexed), frontmatter, anchors, `page@pos`
  refs, nested-item context, relations. A Tier 1 corner with no fixture is a corner nobody checked.

  **Three layers, because an identical object dump does not mean identical behaviour.**

  * **A — extraction.** Markdown → objects, both engines, normalised and diffed. What 0.6 started
    as.
  * **B — index primitives.** The same questions asked of both: tasks by tag, backlinks, inherited
    tags, nested-item context, what a comment hides. Tier 1 only — LifeLoop's own projections are
    Tier 3 and have nothing to compare against.
  * **C — mutation.** The layer that catches what A and B structurally cannot. Same starting vault,
    same operation, both implementations, compare **resulting bytes**: tick a task, process an inbox
    item, patch frontmatter, freeze a review. And the cases that matter more — stale source,
    collision, cancel — where the assertion is that the file is byte-identical to before.

  Layer C is nearly free, because `test/suite.lua` is already an executable specification of these
  semantics. Run it as golden files against the port. Without it, parser and index can agree
  perfectly while `processInboxItem` quietly moves a nested child it used to leave alone.

  This is the single most valuable test in the project, and cheap only because both harnesses exist.

0.7 **Internal query API.** ✅  `query({source, where, order, limit}) → QueryResult<T>`, typed
predicates, no DSL. Plus the task universe as one place rather than per view:
`universe() → open() → actionable()`.

0.8 **CLI.** ✅  `lifeloop index|query|apply --json`. Drives 0.6, drives Phase 1's tests, and is the
seam a second client and eventually MCP plug into.

**Definition of done.** All three conformance layers in 0.6 are clean across all three corpus
tiers — extraction, index primitives, and mutation bytes including every no-op case. Rebuild-from-empty is byte-identical. Every mutation has
a passing negative test. Budgets in §3 met on a synthetic 10k-page vault.

**Gate.** No Tier 1 difference survives unexplained: **for the semantics we promised, the two
engines are indistinguishable.** Anything deliberate is a `CONFORMANCE.md` entry with a reason. No
UI work starts before this.

**Not in this phase.** Any VS Code code. Any query DSL. Any Apple anything. Any rendering.

---

## Phase 1 — Sustainable PKM and the minimal loop

**Goal.** The first version worth living in: the loop from `README.md` — capture → context → act →
today → done → review — plus retrieval good enough that filing stops mattering.

**Deliverables.**

*Retrieval first (§3.3, §16), because it is what makes the vault survive its owner's habits.*

1.1 ✅ `DocumentLinkProvider` for `[[wikilinks]]` — ctrl-click resolves, including aliases.
1.2 ✅ `CompletionItemProvider` — wikilink and tag completion from the index.
1.3 ✅ `ReferenceProvider` — Shift+F12 on a page gives backlinks, in the editor's own UI.
1.4 ✅ Backlinks TreeView, forward links, recently modified.
1.5 ✅ Alias-aware quick open (`LifeLoop: Open`) over page names, aliases and headings.
1.6 ✅ Broken-link diagnostics, live per file.

*Then the loop.*

1.7 `LifeLoop: Capture` — InputBox to the Inbox, above `## Processed`. Port the exact contract:
new input never lands in the pile already dealt with.
1.8 `LifeLoop: Process Inbox` — QuickPick with LifeLoop's action set and its default:
**Link before Move**. Items and pages keep their separate menus.
1.9 ✅ Project lifecycle — `active | paused | completed | archived`, patched into frontmatter.
Semantic only: archiving does not move a file.
1.10 ✅ **Today TreeView** — overdue / due today / scheduled / waiting, disjoint, storing nothing.
Ticking a node runs `tickTask` against the real source range and stamps `[completed:]`.
1.11 ✅ Journal — open or create today's note; journal mentions shown on a project as a view.
1.12 ✅ Weekly Review — a generated document with the six sections, and `Freeze Review` writing the
snapshot. Ported freeze contract: validate everything, render everything, write once, and a second
freeze is byte-for-byte identical.
1.13 ✅ **Pin the schema.** Record the exact set of frontmatter keys and task attributes the system
reads, and assert it in CI. This is §34's admission rule made executable, and it is listed here
rather than under Phase 4 because it does not depend on a view ever existing: its first job is
catching Phase 1 and Phase 2 code quietly widening the schema, which is the same failure a rich view
would cause and far likelier to happen first.

1.14 ✅ Diagnostics for what the audit checked — unknown project status, broken area links, malformed
`deadline` / `scheduled` / `completed` / `priority` (C6). It reports and never fixes.

**Definition of done.** Every command has a test through the CLI or `@vscode/test-electron`, and
every mutation has its negative test. Activation budget met on the real vault.

**Gate — real use, not a checklist.** Three consecutive weeks running the whole loop in VS Code
with no fallback to SilverBullet for anything in scope. Friction goes in `FRICTION.md` as it
happens; that log is the only admissible input to phases 2 through 4.

**Not in this phase.** Webviews. Tables. Saved queries. Apple. Priority. Any task attribute beyond
`deadline`, `scheduled`, `completed` and the `#waiting` / `#someday` tags.

---

## Phase 2 — Selective Apple interoperability

**Goal.** Give execution to the systems that already do it, and get back the one direction that
matters. Four slices, each independently gated; a slice that does not earn its gate stops there.

**Write capability is not ownership, and the reconciler is field-level.** "One fact, one owner"
constrains which system *decides* a fact; it was never meant to decide which app the user may type
in. Those got conflated, and separating them is both better UX and better engineering:

| | may edit | owns |
|---|---|---|
| Notes | a capture that is still pending | pending capture text |
| Reminders | completion, alarm, recurrence, location | reminding, repeating, the notification |
| Calendar | start, end, location, recurrence | the interval |
| VS Code | everything, directly or through the bridge | the durable semantics |

The payoff is that most apparent conflicts are not conflicts. Change a deadline here while changing
an alarm on the phone and a whole-object reconciler sees both sides dirty and must pick a loser;
field ownership sees two disjoint writes and merges them.

**This is not new machinery. It formalises what already ships.** `External.md` records that the
background pass "only ever pushes the title, the note and the flags — never the schedule", which is
a field partition arrived at case by case. Naming it makes it a rule instead of a habit.

**Four kinds of field, not two.** "Owned by us" and "owned by them" does not cover the two cases
that actually cause trouble:

| kind | example | sync semantics |
|---|---|---|
| **Canonical** | task text, `deadline`, project `status` | one owner, written here |
| **External-owned** | alarm, recurrence, location, event interval | one owner, written there |
| **Projection** | a reminder's title and note | copied outward; an edit over there is *divergence*, not ownership |
| **Semantic event** | reminder completed, reopened | not a value to keep equal — a transition to translate into a named mutation |

**The timestamp is a freshness guard, not a tie-breaker, and the difference is the whole point.**
It would be easy to say "ownership decides direction, the timestamp decides whether to push" — but
if a timestamp is ever allowed to decide the *value* of a field we own, that field has quietly
become last-write-wins, which is the thing field ownership existed to remove. So:

```
ownership          → where the canonical fact lives
version/timestamp  → has the projection diverged; do not overwrite an explicit edit
```

Retitle a reminder over there and we stop pushing. That is not Reminders acquiring the title. It is
divergence detected on a projection, and the honest resolutions are *keep theirs*, *restore ours*,
or *adopt theirs into the note* — a choice, surfaced, not a silent winner.

**The fourth row is the one that prevents bugs.** Completion is not a property to hold equal on both
sides; it is an event to translate. Read that way, the recurrence hazard below stops being subtle:
a fresh occurrence reading `incomplete` is a *new object's state*, never a reopen event.

**The bridge is a macOS capability, not a fact about the extension.** A VS Code extension host can
be local, remote, SSH or web, so "EventKit is reachable from here" is an assumption the extension
must never bake in — and §39 already says VS Code is not the architecture boundary. That does not
mean building a daemon now. It means keeping the *boundary* honest while the implementation stays
cheap: `@lifeloop/apple-bridge` imports nothing from `vscode`, is spoken to over a defined interface
across a child process, and reports "unavailable here" rather than failing obscurely when the host
is not a Mac. Promoting it to a long-running service later is then a deployment change, not a
rewrite, and MCP gets the same bridge for free.

**2a — Task → Reminder.** ✅  Port `LifeLoop/External.md`: projection writes `[reminder: "id"]` on the
task line, the id comes from what `make new` returned, and reconciliation never trusts a mark on
sight — every run asks Reminders whether the id still exists, and one deleted over there has its
mark erased rather than resurrected. Direction is decided by comparing modification timestamps, so
an edit made in Reminders is never overwritten.
*Gate:* a week of projecting without a duplicate and without a resurrection.

**2b — Reminder completion → `completeTask`.** The reverse direction the whole phase exists for,
and by `ROADMAP.md`'s own account the cheapest remaining item: the stored identity exists, the
polling path exists, and what is missing is a named mutation that verifies the LifeLoop source
before writing — which Phase 0 now supplies. Never a bulk reconcile.
**Three defects found by review after the phase was called done, and worth recording as such.**
The suite was green when they were reported; being green is not the same as being right.

* **The sync driver carried a position and no receipt** — it built handles as
  `{ ref }` from the *index*, with no expected text or state. Reproduced: reminder R1 completing
  checked off the task bound to R2, because the vault had changed since indexing. Two causes, one
  fix: the index is a stale offset, *and* a write earlier in the same pass shifts every later
  offset on that page. Writes now re-locate by the **binding** (`locate.ts`) immediately before
  mutating — the reminder id is an identity we wrote ourselves, so reading it back is not
  reconstructing identity from rendered text. Ambiguity refuses.
* **Editor writes reported success before they finished.** `Vault.write` was synchronous, which
  forced the VS Code implementation to discard the promise from `applyEdit` — so a command reported
  success and reindexed before the write landed, and a *rejected* edit reached nobody. The write
  path is now async through the whole mutation API. Making it async turned the bug into 18 compile
  errors, which is the right place for it to live.
* **The recurrence quarantine was gated on the task's state.** It only fired inside
  `if (becameOpen && task.done)`, so a reminder rolling to its next occurrence while the task
  happened to be *open* fell through unflagged, still trusted, free to drive a completion on the
  next pass. The evidence is the transition, not the state of whatever is bound to it.

**Five more found by probing the same angles, none of them on the reviewer's list.** Written as
tests designed to fail against a green suite, which is the only way to find the cases nobody thought
of:

* **A duplicated anchor silently wrote to the first match.** `resolveRef` took `indexOf`, so copying
  a task copied its anchor and the wrong one got written. Ambiguity refuses now, exactly as the
  binding lookup does.
* **A capture containing a newline could split the Inbox.** `## Processed` inside captured text
  became a *second heading*, putting everything after it on the wrong side of the pending/processed
  boundary. Captures are flattened to one line — the text is kept, the structure cannot be.
* **Two overlapping mutations on one page silently lost one.** Both read the whole page, both wrote
  it back, last writer won. A change set now records what it read and `apply` re-checks before
  writing; the loser is refused as stale and can retry. Optimistic rather than locked, because a
  lock can be held by a pass that crashed.
* **A page name could escape the vault.** `attachPageToTask(…, "../../etc/evil")` was accepted —
  `NodeVault` guarded it, but the guard belonged in the mutation, which is the only layer that knows
  a name came from a person.
* **A reminder created but never bound was orphaned.** Creation succeeded, the binding write
  refused, and the reminder stayed over there with nothing pointing at it — invisible here and
  duplicated on the next attempt. `bindReminder` compensates, and reports the orphan by name when
  even the undo fails.

**Four more from a third pass, probing failure *scenarios* rather than components.** The two that
matter most were invisible from inside a component, which is why the angle changed:

* **Every completion date was UTC's, not the user's.** `toISOString()` west of Greenwich returns
  tomorrow all evening — a task ticked at 20:00 in New York was stamped with the next day, and Today
  changed over before midnight. A date is a human fact, not an instant; `day()` and the completion
  stamp both use the local calendar now.
* **A CRLF vault refused every task mutation.** JavaScript's `$` matches before a trailing `\n` but
  **not** before a `\r`, so every task pattern failed and the refusal said "not a task line" — a
  message that pointed nowhere near the cause. The line now excludes its carriage return, which also
  preserves the ending on write.
* **`apply` claimed all-or-nothing and wrote in sequence.** A failure on the second file left the
  first changed, contradicting the type's own comment. Prior contents are restored on failure, and a
  restore that itself fails is reported rather than swallowed.
* **Overlapping sync passes ran twice against the same stale reads.** A timer tick landing on a
  manual sync — AppleScript is slow enough that this is ordinary, not rare. The Lua implementation
  guarded it and the port had dropped the guard; the second caller now joins the first.

Also corrected: the parity test asserted the TreeView was a *subset* of the projection, which a view
showing nothing would satisfy. It asserts equality now, and still passes.

**Driven for real on 2026-09-08, and three more things only that could have found.** The unit tests
pass against a fake bridge; these were invisible until AppleScript answered:

  * `whose id is in argv` — the natural way to fetch a batch — **does not work**. AppleScript will
    not coerce a list into a type specifier. One lookup per id.
  * `every event of every calendar whose uid is …` returns a list *per calendar*, mostly empty, so
    the first item is a list rather than an event. Calendars are iterated explicitly, and reads are
    **scoped to one named calendar** because scanning six of them outlasts the scripting bridge's
    patience.
  * `missing value` stringifies to the literal text `"missing value"`, which is not empty — so every
    reminder in a real list reported a completion date it did not have.

**And one that changes what 2b can promise: Reminders cannot tell us what recurs.** Checked against
`properties of` a real reminder — fourteen properties, and recurrence is not among them. Excluding
recurring reminders is a *precondition* for the reverse flow being correct, so this route cannot
make the full promise. What it does instead:

  * a *known* recurring reminder is refused outright;
  * an unknown one may still **complete** a task — a reminder that rolls forward is never observed
    going incomplete-to-complete for our binding;
  * an unknown one may **never reopen**, because that is the destructive direction and the one
    recurrence actually corrupts;
  * a binding seen to un-complete itself is marked suspected-recurring from then on, permanently.

**This meets C5's trigger.** The plan said move off `osascript` if "completion detection proves
unreliable in use" — it has, for a reason the dictionary makes permanent rather than a bug someone
could fix. `EKReminder.hasRecurrenceRules` answers it directly, so EventKit is now required for the
full promise rather than a nicer way to keep it.

**A completed reminder may not say when.** Apple's own documentation warns that `completionDate`
can be nil while `isCompleted` is true — a reminder finished in a different client. That collides
with `DESIGN.md`'s "historical facts are recorded, never reconstructed", and it breaks the obvious
version of this gate, so the rule is fixed before the code:

  * a reported completion date is used as-is;
  * no date reported means the stamp is **the date the sync observed it**, which is a fact about
    LifeLoop rather than about the watch, and is honest about being the earliest defensible one;
  * nothing in between is ever guessed, and a laptop shut for four days produces a late stamp
    rather than an invented one.

  This project's rule is "checked against the dictionary, not assumed" — `External.md` records
  exactly that for Calendar's missing modification date. So 2b begins by checking what Reminders
  actually reports through the route we use, and the answer goes in `External.md` next to the other
  one.

*Gate:* tick it on the watch, and it is complete in the vault within one poll interval, carrying
the completion date Reminders reported — or the observation date when Reminders reports none.
✅ **Driven end to end against real Reminders**: create, read back, push a rename, complete it over
there, and the Markdown gained `[x]` and a `[completed:]` stamp. Cleaned up after itself.
**A recurring reminder must never touch a LifeLoop task, and reopen is why.** Reverse flow makes
`reopenTask` look like the free symmetric case. It is not. Completing a recurring reminder rolls it
to its next occurrence, where it reads incomplete again — so a naive poll would un-complete the
LifeLoop task, forever, on every cycle. `DESIGN.md` already settles the semantics: a recurring
commitment is not one checkbox, and occurrences completed in an external executor are not part of
LifeLoop's completion history. So the reverse channel **ignores any reminder carrying a recurrence
rule outright** — for reopen and for completion alike — rather than special-casing one direction.

  **Ignored, but not silently.** A recurring reminder bound to a one-shot task is a real mismatch,
  and hiding it means the user waits for a completion that will never arrive. The binding is marked
  external-recurring and says so where the task is shown — *"completion here does not affect this
  task"*. Visible and harmless beats invisible and harmless, and it costs one diagnostic.

  **Reopen needs a causal guard, not a state comparison.** It deletes a recorded historical fact, so
  `isCompleted == false → reopen` is not good enough — that is polling a state and inferring an
  event. It fires only on an observed *transition*, and only when all of it holds: the binding is
  non-recurring; the last observed state was completed and the current one is not; the reminder
  changed after our last reconciliation; the LifeLoop task is currently completed; and the source
  still matches the handle (I4). Anything else writes nothing.

*EventKit trigger (C5):* move off `osascript` only if polling latency is unacceptable or completion
detection proves unreliable in use — not because a native binary is nicer.

**2c — Task → Calendar event, and VS Code as a control surface.** ✅  Binding only, plus the direction
the plan had left out: from a project page you can reschedule the block, drop the reminder, or open
the event. That is not VS Code taking ownership of `start`/`end` — it is asking the owner to change
its own fact through the bridge, which is what makes "edit where natural" work in both directions
instead of only away from the editor. The reverse flow may update event state, start, end,
cancellation and location, and may never touch task completion or project status. `DESIGN.md`
rejects elapsed-event-means-done as a category error, not as a deferral. Calendar exposes no
modification date, so the weaker push rule applies and is stated in the UI, not smoothed over.

**2d — Notes into the Inbox, one way, ✅ with the Inbox as the superset of every capture.** The
reframing is the point: not "a Notes inbox and a LifeLoop inbox", but **one Inbox with several
sources**. Apple Notes is a mobile capture frontend; the Inbox is the only processing surface, and
the only thing anyone has to remember to open.

```
Apple Notes ──┐
VS Code ──────┼──► Inbox ──► process ──► Task / Project / Knowledge
future ───────┘
```

Two kinds of item, one processing flow:

  * **Native captures** carry nothing. `LifeLoop: Capture` writes a line; Markdown is canonical
    from the first keystroke and pays no tax at all — which matters, because this is the common
    case.
  * **Source-backed captures** carry provenance: `[source: apple-notes]` and `[source-id: "…"]`.
    While pending, the note is canonical and the Inbox line is its projection.

  `InboxItem { source, sourceRef, content, capturedAt }` is a shape in the *code*, derived by
  parsing. Nothing new is persisted, and processing never asks where an item came from.

**This is the version that satisfies §3.2 without a conflict dialog.** Pending: the note owns the
text. Processed: Markdown owns it. There is no moment with two writers, so there is nothing to
merge, no baseline hash to keep, no push to bump a modification date, no conflict UI. It is strictly
simpler than the bidirectional version it replaces *and* strictly more compliant.

**It also shrinks the representation hazard to a display concern.** A note holding a table, a scan
or a drawing still imports imperfectly — but nothing is ever written back, so the original survives
intact in Notes. Lossy import is a bad preview; lossy round trip was data loss. That is the
strongest argument for this direction and it is worth stating as the reason rather than the
side effect.

**And the mirror is not a convenience — retrieval requires it.** §3.3 promises that a thought is
findable later without having been filed correctly. A capture that exists only inside Apple Notes is
invisible to every retrieval surface Phase 1 builds. Mirroring it into Markdown is what puts phone
captures inside ripgrep, quick open and backlinks.

**Editing a mirrored item is an ownership claim, not an error.** The obvious rule — "the imported
body is read-only" — is unenforceable: the Inbox is a Markdown file, and VS Code has no honest way
to make part of one read-only. So rather than pretend, or silently overwrite what someone typed:

```
local edit detected (text ≠ last-synced text)
        → the item becomes native: drop the binding, keep [source:] as provenance
        → later note edits no longer flow in; the note itself is untouched
```

You edited it here, so it is yours now — the same move processing makes, arrived at by typing. This
costs one comparison against the text we last wrote, and it removes the only case where one-way sync
could lose someone's work.

**Processing is the ownership handoff, and the local side decides it.** An item under `## Processed`
is processed; that is already how the Inbox works and it needs no new state. Moving the Apple note
into a `LifeOS Processed` folder is *tidiness in Notes* — self-describing, and it drops the note out
of the scanned folder — but it is **best effort and never a precondition**. A failed AppleScript
must not block or half-complete a LifeLoop mutation.

**One line of the contract needs scoping.** "Sources synchronize into the Inbox, never back" is
right about *content* and wrong as stated, because moving a note is a write. That is the distinction
already settled for Reminders and Calendar: we never mirror content outward, and we may ask a source
to change its own lifecycle. Different category, same rule.

*Gate:* a fortnight where every phone capture arrives, nothing has to be checked in two places, and
no local edit is ever overwritten.
*Not built, and needing real friction first:* editing a pending capture at the Mac and having it
reach the phone. The local-edit rule makes that flow terminate sensibly rather than badly, which is
the cheapest possible answer until someone actually misses it.

**Definition of done per slice.** Reconciliation has tests for the failure cases specifically —
deleted over there, edited both sides, projected twice, id present but stale.

**Not in this phase.** Full Notes mirror. Recurrence — it has an owner, and `DESIGN.md` records
what that costs. Any Calendar → task-state flow.

---

## Phase 3 — The query layer as a public contract

**Goal.** Not to build the query engine — Phase 0 did that — but to freeze it, name its
projections, and prove with a second client that no view invents its own filter (finding 4).

**Deliverables.**

3.1 ✅ `QueryRequest` / `QueryResult<T>` frozen as a versioned public contract, with the compatibility
rule written down.
3.2 ✅ **Named projections as the only thing clients call** — `today()`, `upcoming(days)`,
`review.week(d)`, `project.signals(p)`, `inbox.pending()`. A client that filters for itself is a
bug; changing what Today means must be a one-file change.
3.3 ✅ Saved definitions in `.lifeos/views/*.yaml`, in §30's shape: `source`, `filter`, `sort`,
`group`, `fields`, `renderer`. Description only; the file may never hold results.
3.4 ✅ CLI parity — every projection reachable as `lifeloop query --json`, which is the second
consumer that proves 3.2.
3.5 ✅ Derived signals as projections: no actionable task, waiting only, page unchanged for N days,
deadline in N days, N overdue. Each says exactly what it measured and nothing more.

**Definition of done.** A test asserts the TreeViews and the CLI produce identical rows for every
named projection. Deleting a filter from a projection breaks both clients, in one place.

**Gate.** A saved view definition, written by hand, renders in a client without any TypeScript
change.

**Not in this phase.** Renderers beyond what Phase 1 already has. MCP — it becomes nearly free
here, and it belongs to Phase 5 Level 1.

---

## Phase 4 — Rich views · **not scheduled**

**This is not a queue, and it is a different kind of section from the four above.** Phases 0 to 3
are work. This one is a set of conditions under which a view could be considered, written now
because the conditions are cheap to state and expensive to argue about later — with a hostile
reviewer in the room and a half-built board on screen.

The design doc files these under §29 *Future Work*, and §37 is explicit that Future Work does not
mean they get built. **The expected outcome is that most of these never ship**, and that is a
success, not a shortfall. Nothing below is committed to, nothing is estimated, and there is no
ordering obligation — Table before Cards before Kanban is what the sequence would be *if* the
sequence ever started, not a plan for it to.

**The one piece of real work here has moved to Phase 1.** §34 asks: if someone never opens this
view, does their Markdown need any new field? Deliverable 1.13 makes that executable by pinning the
key set — and it belongs there because it earns its place whether or not a single view is ever
written. A view that needed a new key would fail that check and become a design conversation rather
than a merge, but that is a side benefit of a guard built for Phase 1's own code.

**Conditions, if any of this is ever considered.** These are constraints on a hypothetical, not
deliverables:

* **Table** — a renderer over a Phase 3 projection, in a webview using VS Code theme variables.
  Editing a cell calls a named mutation; it may never write a file.
* **Cards** — must be the same query and the same mutations with a different renderer. If it needs
  anything else, the Phase 3 contract was wrong and *that* is the finding.
* **Kanban** — group-by over a query, a drag is `setProjectStatus`, and it stores nothing of its
  own. Column order comes from the status enum, never from the board.
* **Dashboard** — `.lifeos/views/home.yaml` holds query, renderer and layout, and never results.
* **Calendar UI, timeline, graph** — not even conditionally described. Each would be its own
  argument from scratch, and none is owed one.

**What would have to happen first**, for any of them: Phase 3 shipped and stable, and an entry in
`FRICTION.md` from real use naming what the view fixes. "It would look good" is not an entry, and
neither is "the query layer makes it easy now" — cheapness is not a reason.

**The standing risk is this section being read as a roadmap.** See the admission-rule row in §6: a
view that ships without a friction entry behind it is the failure mode this whole plan is arranged
against, and it would arrive here first.

---

## 4. The §38 success criteria, sorted

Four of them are checks a machine can run. Four are only answerable by a person who used the thing
for a month. Mixing the two produces a suite that looks like it proves the product works.

| §38 criterion | kind | where |
|---|---|---|
| Rebuildability — delete the index, rebuild from Markdown | test | 0.4, byte-identical object dump |
| Deterministic mutation — every writer goes through the named API | test | 0.5 + tier 3; plus a check that nothing outside `semantic-core` imports `fs.write` |
| Data durability — remove the extension, the Markdown still reads | test | Phase 1: assert the vault contains no key the extension invented — same check Phase 4 reuses |
| Metadata tax — an ordinary note and an ordinary checkbox stay legal | test | the frontmatter/attribute key set is pinned from Phase 1 and asserted unchanged in Phase 4 |
| Retrieval — findable without having filed it correctly | **gate** | Phase 1: a fortnight of "find that thing from March" with no fallback to grep-by-hand |
| Capture — a thought reaches the Inbox in seconds | **gate** | Phase 1 use; instrumented only if it feels slow |
| Operational loop — weeks of the loop without maintaining LifeLoop itself | **gate** | Phase 1's three-week gate |
| External interoperability — tick on the watch, done in the vault | **gate** | Phase 2b's gate |

The four gates have no test and are not owed one. What they get instead is `FRICTION.md`.

## 5. Test strategy

Four tiers, cheapest first:

1. **Unit, on pure functions.** Vendored extractor tests come across unmodified and must stay
   green — they are the tripwire for a local modification that changed a corner.
2. **Conformance, against SilverBullet.** Phase 0.6, run in CI while the reference checkout still
   exists. The only defence against silent semantic drift.
3. **Contract, per mutation.** Every mutation has a positive test and — the one that matters — a
   negative test asserting that the failure case writes *nothing*. `test/suite.lua` already spends
   as much effort here as on the happy path; the ported suite must too.
4. **End to end, through the CLI**, over `test/fixtures/`. VS Code integration tests only for what
   genuinely needs the host: activation, providers, TreeView interaction.

The failure this strategy exists to prevent is the one `ROADMAP.md` already recorded: the ref tests
that fabricate an event stay green while the real path is broken. So every mutation with a host
path is driven through the host at least once, and a test that fabricates its input says so.

---

## 6. Risks

| risk | trigger to watch | response |
|---|---|---|
| Semantic drift from the vendored fork | conformance diff grows between phases | freeze the vendor pin; every divergence is a `CONFORMANCE.md` entry with a reason |
| The fork strands us on old upstream semantics | an upstream release changes parsing and the pin cannot take it | 0.2a: pinned commit, zero local edits, deliberate bumps run through the differential suite. Never follow `main` |
| Two systems to maintain during the transition | a fix has to land twice | freeze `LifeLoop/` at Phase 1's gate (§7) |
| Phase 0 becomes a platform project | Phase 1 has not started when Phase 0 is "nearly done" | 0.1 through 0.8 is the whole list; anything else waits for a friction entry |
| Today TreeView is worse than a rendered page daily | logged repeatedly in `FRICTION.md` | revisit C2 — but the replacement still has to satisfy I4 |
| Apple bridge fragility across macOS releases | a slice breaks on an OS update | slices are independent; a broken one degrades to manual, never to a wrong write |
| Rebuilding what VS Code gives free | a custom search or file explorer appears | I7 — compose the native primitive or do not ship the feature |
| **The admission rule goes nominal** — the long-run failure that ends Obsidian and Notion setups, where the system becomes the work | something ships with no `FRICTION.md` entry behind it, or an entry written *after* the code | a friction entry is a precondition for the work, not a justification attached to it. "Future work" has to be able to mean never, or none of the rules above are load-bearing |

---

## 7. Migration, coexistence, and the name

**The vault is the migration.** The new system reads the conventions LifeLoop already writes —
`tags:` frontmatter for project, area and person, `[deadline:]` and `[scheduled:]` on tasks,
`[completed:]` stamps, `## Processed` in the Inbox, `#waiting` / `#someday`. Nothing is converted,
nothing is rewritten, and both systems can read the same space during Phase 1. That is not a
coincidence — it is what "Markdown owns durable knowledge" was for, and Phase 1 is its first real
test.

**The SilverBullet library is frozen, not deleted, at Phase 1's gate.** Until then it is the
fallback, and a fallback that has stopped working is not one. After the gate it takes fixes and no
features. Deleting it would also delete the conformance reference in tier 2.

`LifeLoop/Pages/*` — Today, Upcoming, Audit, Review — have no successor files, by design. They
become views, and the pages themselves can be deleted once nothing reads them.

**The name stays LifeLoop** (C7). The loop is the product and the repo renamed to it deliberately;
"LifeOS" names a category, and this plan is not the place to spend a naming decision. If it is to
change, change it before Phase 0 lands — package names are cheap now and everywhere later.
