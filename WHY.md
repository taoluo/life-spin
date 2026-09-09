# Why leave SilverBullet

Deliverable 0.1 of `LifeOS Execution Plan.md`, written before the expensive parts.

This is not a complaint about SilverBullet. It is a small, well-made project doing something
genuinely hard, and this port begins by vendoring 101 files of its MIT source *because* its
semantics are worth keeping exactly. The question is not whether it is good. It is whether it is
the right host for what LifeLoop is trying to become — and the answer turns on two things that are
already true today, not on anything anyone hopes to build later.

## The argument that does not work on its own

`ROADMAP.md` records a real ceiling: the host dispatches `{ ref, oldState, newState }` when a task
is ticked, but a Space Lua listener receives only `newState`. With no ref there is nothing to
stamp, so ticking a task in a query view leaves it `[x]` and unstamped, and *"nothing here can work
around a ref it is never told."*

That is a genuine defect and it is **not** sufficient justification. The last gap of exactly this
kind was fixed upstream — the host grew that event in the first place because LifeLoop needed it.
One more patch is the obvious answer to one more bug, and a rebuild justified by a fixable bug is a
rebuild that loses its justification the moment someone fixes it.

So the case has to rest on things a patch cannot reach.

## 1. The ecosystem is the product, and it is not there

`LifeOS for VS Code.md` §35 already committed to this without noticing it was an argument for
moving: **no plugin marketplace, no plugin runtime, no plugin SDK, reuse the host's ecosystem
instead.** That is the right instinct — plugin compatibility, dependency and abandonment debt is a
tax nobody should pay twice. But it only pays off if the host *has* an ecosystem, and this is where
the two hosts are not comparable.

The current [ownership decision](docs/plans/2026-09-08-foam-boundary.md) reuses the host and
Foam rather than building a second general note platform:

| Need | Owner |
|---|---|
| Full-text search, fuzzy open, files and Git history | VS Code |
| Backlinks, ordinary link navigation/diagnostics, graph and tags | Foam |
| Task-level context, queries and source-verified actions | LifeLoop |

LifeLoop's maintenance budget goes to task semantics and the execution loop. General note
navigation uses the existing ecosystem.

The same holds for everything downstream: LSP, the extension API, MCP, editor-native AI tooling,
and the enormous supply of extensions a user already has. LifeLoop does not want to build any of
that, and §35 says so.

## 2. Being a guest costs a round trip per gap, and the gaps are not finished

The payload bug is one instance of a shape. A plug and Space Lua are sandboxes inside someone
else's client, so every boundary defect is discovered here and fixed there — on their schedule,
in their release, with a version bump before anything here can move. `ROADMAP.md` has already paid
this twice, and the second time the fix had shipped long before anyone re-ran the check.

The semantics are also still moving underneath, which is a fact rather than a criticism of a young
project. Verified in the pinned checkout: **2.4.0's indexer rework** added `links`/`ilinks`
inherited from parent nodes and **shifted `task` refs to the item's position**, with its own
changelog warning that code relying on the old behaviour would need adjusting. Task refs are what
LifeLoop's completion stamping resolves against.

Owning the semantic layer does not make that churn disappear — it converts it from *breakage on
upgrade* into *a pinned commit and a differential test*, which is precisely what
`vendor/silverbullet/PROVENANCE.md` and the conformance suite now do. Same upstream, same
semantics, on our own clock.

## What this costs, stated rather than discovered

* **Semantic compatibility is now a maintained obligation**, not a free inheritance. That is the
  three-tier contract in `COMPATIBILITY.md` and the differential suite, forever.
* **SilverBullet is better at some things and keeps them.** Rendered Markdown with live-preview
  editing, a real mobile web client, and zero-install sync are all things VS Code does badly or not
  at all. Losing the phone is why Phase 2's Apple Notes capture exists.
* **The library does not get deleted.** It stays as the fallback until Phase 1's gate, and as the
  conformance oracle after it.

## Abandonment criterion

If the retrieval, runtime and ecosystem gains above turn out not to cover the cost of maintaining
semantic compatibility — or if the boundary defects stop appearing and upstream absorbs the host
fixes cheaply — then the answer was a patch, and this plan ends here at 0.1.

Concretely, abandon if **Phase 1 does not reach its gate**: three consecutive weeks running the
whole loop in VS Code with no fallback. Retrieval is the thing being bought; if it does not change
how the vault gets used within a month of daily use, it was not worth a port.

Nothing built to that point is wasted either way. `@lifeloop/semantic-core` reads a Markdown vault
and answers queries with SilverBullet's own semantics, in any host or none.
