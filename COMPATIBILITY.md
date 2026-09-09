# Compatibility with SilverBullet

Deliverable 0.2a. Without this, "conformance clean" has no definition and every
difference is a judgement call.

Three tiers. The tier decides what a difference *means*.

## Tier 1 — preserved semantics

Promised to behave identically to the pinned SilverBullet. A Tier 1 difference is a bug in us.

```
task and item extraction        links / ilinks
tags / itags (inherited)        inComment
frontmatter                     anchors
page@pos and page@anchor refs   nested-item context
relations                       aspiring pages and link resolution
```

## Tier 2 — vendored implementation

Code copied at a pinned commit, local edits held at **zero** and enforced by
`npm run vendor:check`. See `vendor/silverbullet/PROVENANCE.md`.

## Tier 3 — ours

Projections, signals, the mutation set, retrieval, the store. Not expected to track
SilverBullet and never compared against it. `today()`, `upcoming()`, `review()` and
`projectSignals()` are LifeLoop's, and asking SilverBullet what it thinks Today means is asking a
question it has no answer to.

---

## How Tier 1 is actually proved, and why it is not a differential test

The plan assumed a differential harness: index a corpus with both engines, diff the object dumps.
Building it revealed that **the premise had changed** — because we vendor and *call* SilverBullet's
extraction rather than reimplementing it, and `indexMarkdown()` already returns objects without
persisting. There is no second implementation to differ from.

That makes the proof stronger and cheaper than sampling a corpus, and it stands on two legs:

1. **The code is upstream's, byte for byte.** `vendor:check` hashes all 137 vendored files against
   `MANIFEST.json` and fails the build on any edit, and on any import from `packages/`.
2. **Upstream's own assertions run here.** 28 of SilverBullet's test files are vendored alongside
   the code they test — parser, frontmatter, anchors, snippets, tree, refs, conflict detection,
   the Lua parser and runtime — and `npm test` runs all **298** of them against our copy.

Same code plus its author's own tests passing is a conformance argument by construction. A corpus
diff samples inputs and hopes they cover the corners; this covers whatever upstream thought worth
asserting, which is the better-informed list.

### The one Tier 1 thing that *is* reimplemented

`indexMarkdown` omits the page object, because upstream's `pageIndexPage` also prunes
aspiring-page records through syscalls — index maintenance our store does natively, and not
something worth dragging the Lua query layer in for.

So `pageObject()` in `extract.ts` reproduces the assembly: combine page metadata with frontmatter,
normalise `tags`, guard `aliases`, set `tag: "page"`. It is eight lines, it is deterministic, and
the subtle half is *not* reproduced — inherited tags still go through upstream's `updateITags`.

The spread order is upstream's and load-bearing: page metadata appears at both ends, so frontmatter
claiming to set `name` or `lastModified` cannot override the real file facts. Anyone editing that
line should know it is not stylistic.

This is the single exception to "we call rather than reimplement", and it is written here so a
future divergence has somewhere obvious to be found.

**What that does not cover, and what still needs a live client.** Two risks survive, and they are
the ones that were always the real ones:

* **The seam.** We supply `globalThis.syscall`, so extraction could be fed different config or a
  different path lookup than a real client would. Config is semantically load-bearing —
  `index.item.all`, `index.task.all`, `index.paragraph.all` and `taskStates` change what gets
  indexed at all — which is why they are explicit in `compat/syscalls.ts` rather than stubbed.
* **Tier 3 against the Lua implementation.** Our projections and mutations are ports. Nothing
  upstream can check them; the LifeLoop Lua suite can.

So the live-client harness is still worth building, for **layers B and C only**:

```
A  extraction        proved by construction — vendored code + 298 upstream tests
B  index primitives  needs a live SilverBullet: tasks by tag, backlinks,
                     inherited tags, nested-item context, what a comment hides
C  mutation bytes    needs the Lua library: same vault, same operation,
                     compare resulting bytes — including every no-op case
```

`test/conformance/live.test.ts` holds B and C. It **skips loudly** when no client answers, naming
what it could not check, because a conformance suite that silently passes when it ran nothing is
worse than no suite. Layer C is nearly free: `test/suite.lua` is already an executable
specification of these semantics.

## Current VS Code boundary

[Foam / LifeLoop ownership](docs/plans/2026-09-08-foam-boundary.md) is the current scope. Exact committed task semantics and LifeLoop mutation correctness are required; full SB API
parity is not a goal. Retained Lua/UI adapters must be justified by concrete workflow dependencies.
Foam owns general note navigation, ordinary wiki links, page-level tags/queries, templates,
daily notes and embeds. Those surfaces are no longer LifeLoop implementations or SB conformance
claims. LifeLoop's object index, task predicates and mutation authority remain independent.

The existing Space Lua evaluator is retained as an opt-in, bounded subset. Host declarations
being accepted does not prove that a corresponding command, service or event is driven.
No complete SB standard library, arbitrary JavaScript import or script write API is promised.
Task states and action buttons have selected client support; other registry declarations may
remain inert. Compatibility inventories are advisory, not execution proofs.

Top-level query/Lua preview rendering and minimal baking remain. Foam controls embedded note
rendering; nested LifeLoop execution is not promised. Legacy SB source refs have a narrow
explicit `lifeloop.openSbRef` command, not a replacement ordinary wiki-link system. Foam's block anchors and
ambiguous-link resolution differ from SB. See [migration limits](docs/FOAM.md).

## Upgrading the pin

Never follow upstream main implicitly. Use the vendor-sync/check scripts, run the regression
suite, and explicitly accept semantic changes. Foam is independently versioned; its coexistence
smoke gate uses 0.44.6 and VS Code 1.136.1. Passing that gate is not full SB/Foam equivalence.
