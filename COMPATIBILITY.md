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

1. **The code is upstream's, byte for byte.** `vendor:check` hashes all 125 vendored files against
   `MANIFEST.json` and fails the build on any edit, and on any import from `packages/`.
2. **Upstream's own assertions run here.** 28 of SilverBullet's test files are vendored alongside
   the code they test — parser, frontmatter, anchors, snippets, tree, refs, conflict detection,
   the Lua parser and runtime — and `npm test` runs all **285** of them against our copy.

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
A  extraction        proved by construction — vendored code + 285 upstream tests
B  index primitives  needs a live SilverBullet: tasks by tag, backlinks,
                     inherited tags, nested-item context, what a comment hides
C  mutation bytes    needs the Lua library: same vault, same operation,
                     compare resulting bytes — including every no-op case
```

`test/conformance/live.test.ts` holds B and C. It **skips loudly** when no client answers, naming
what it could not check, because a conformance suite that silently passes when it ran nothing is
worse than no suite. Layer C is nearly free: `test/suite.lua` is already an executable
specification of these semantics.

## Space Lua, executed

`space-lua` blocks run, **off by default** — `lifeloop.executeSpaceLua`. A vault can be shared,
synced or cloned, and none of that means someone meant to run the code inside it.

The runtime needed nothing built; the host API is what was missing, and it is added one method at a
time. **13 of the 21 blocks in SilverBullet's own documentation run through it unchanged.**

| provided | |
|---|---|
| `index.*` | tasks, pages, links, broken links, any object tag — read-only |
| `space.*` | `readPage`, `listPages`, `pageExists` — read-only |
| `lifeloop.*` | every named projection, the same ones the CLI and the views call |
| `config`, `tag`, `service`, `identity`, `taskState`, `actionButton` | declarations, collected rather than acted on |
| `schema.*` | pure constructors |
| `widget.*`, `dom.*` | build content; the preview renders it, since VS Code cannot place it inline |
| `editor.*` | the portable half: `flashNotification`, `navigate`, `getCurrentPage`, `getText`, `copyToClipboard`, `openUrl` |
| `string`, `table`, `math`, `os` | Lua's own library — used three times more than any host API |
| `event.listen`, `mq.*`, `syntax.define` | registries; a client drives them |
| `query[[...]]` | **SLIQ**, in full — see below |

**17 of the 21 blocks in SilverBullet's own documentation now run**, up from none. The four that do
not use `mermaid` and `esm` — libraries a vault brings with it, not host APIs.

**Two boundaries, and one of them was decorative until a test caught it.**

*Nothing can write.* There is no `space.writePage`, no `editor.setText`. Every mutation goes through
the named, verified API, and a script that arrives inside a note is content rather than a privileged
writer — the same rule `DESIGN.md` states for AI, for the same reason.

*Everything is time-limited.* The budget lives on `threadState`, the fifth constructor argument —
assigning `sf.budget` compiles, does nothing, and lets an infinite loop in a note run forever. It
did, until a runaway-loop test hung the suite. `budgetTick` also only *yields*; upstream escalates
to a person clicking Stop, and there is nobody to click here, so `onLimit` stops the budget itself.

*Registries are declared, not driven.* `event.listen` accepts a listener for an event we never
raise rather than dropping it — the listener exists, the event does not, and saying so beats either
silence or pretending. `mq` is an in-memory queue: everything a script can do is read-only, so a
message lost on restart cannot lose anyone's work.

*`space-style` reaches the preview.* SilverBullet applies it to its editor and VS Code exposes no
such hook, but the Markdown preview is a webview we already style. Rules are **scoped** to the
preview body and filtered: `@import`, `url()` and markup smuggled through `</style>` are refused by
name. A note may not make the preview fetch anything. The block still shows as code as well —
hiding it would make a page look like it had lost a section.

*Deliberately absent:* `net` (arbitrary fetch) and `js.import` (arbitrary JavaScript). Not vendored,
and `js.import` refuses **by name** rather than being undefined — "may not load arbitrary
JavaScript" is a far better answer than `attempt to index a nil value`, which points nowhere.

Widget output goes into a webview, so the tag set is closed and every value is escaped. A script
naming an unknown tag gets its text, not its markup.

### The queries a SilverBullet vault actually contains

Every query on silverbullet.md reads `from x = tags.something` — not `index.tasks()`. Ours worked
and theirs did not, which is the whole difference between "SLIQ runs" and "a SilverBullet vault's
queries run". Two things were missing, and both are now there:

**`tags.*` as a source.** A name matches on `itags`, not on `tag`, because a page with
`tags: feature` in its frontmatter is indexed as a `page` whose itags include `feature` — which is
exactly what their own example leans on when it selects from `tags.feature` and then narrows to
`f.tag == "page"`. An unknown tag answers empty rather than failing the page.

Getting there took two wrong turns worth recording, because both error messages pointed away from
the cause. A JavaScript `Proxy` cannot provide a computed key on a `LuaTable`: the runtime reads a
key by calling the table's own `get()`, which consults internal storage. Proxying it either shadowed
`get` itself — *"obj.get is not a function"* — or was bypassed entirely — *"Collection is nil"*.
Lua's own mechanism, a metatable with `__index`, is the answer and the only one.

**One environment per vault, not per snippet.** `select templates.featureItem(f)` on their front
page defines the template in a library page and calls it from a query somewhere else. Evaluating
each snippet freshly made that impossible however well the query itself ran. Blocks are loaded into
a shared space first, then queries run in it.

### SLIQ needed nothing built

The integrated query language works, and writing a parser for it would have been wasted effort:
`query[[...]]` is an *overload of Lua's call-with-one-string syntax*, so the vendored parser already
produces a `Query` expression and the vendored evaluator already runs it. All it wanted was a `from`
that resolves to something of ours, and `index.tasks()` already did.

```lua
query[[ from index.tasks() where _.deadline < "2026-09-16" order by _.deadline select _.name ]]
```

`from`, `where`, `order by … desc`, `select` and `limit` all work, over tasks and pages alike, in a
fenced block or inside `${...}`, and the result renders as a real table.

This was reported as missing one round earlier. It was not missing; it had never been tried.

### Getting a block to show something

The point of running a block is that a page can *display* it, so two things matter more than the
API list.

**Anything a block returns renders**, not only widgets: a string, a number, a list, an array of
objects (which becomes a table), or a sectioned object like `today()` (which becomes a section per
key). A block with nothing to return shows nothing, and that is right — configuration and
definition blocks are most of a real vault, and inventing output for them would put noise under
every one.

Getting there needed a real fix. `evalStatement` answers a `return` with a control signal —
`{ ctrl: "return", values: [...] }` — so handing that back left a widget's `__widget` buried one
level down and **nothing ever rendered**. The signal is unwrapped before conversion now.

**`${expression}` in a page is substituted before markdown-it parses it**, which is how
SilverBullet pages actually show dynamic content — more than fenced blocks do. It matters here
specifically: LifeLoop's own weekly review template is written with
`${lifeloop.review.completed()}`, so without this a review renders as its own source code.
Substituting early means a returned list becomes a real list rather than escaped text, and an
expression with no answer is left exactly as written — a page that still reads as what its author
typed beats a blank.

## Where VS Code already has the answer

Three things were listed as missing that were not, and the correction is worth keeping because it
is the same mistake twice: reading "SilverBullet has a feature" as "the host lacks it".

**Outlining.** VS Code folds, moves lines, indents and outdents, and its Outline view lists
Markdown headings through the built-in extension's symbol provider. The one thing it cannot know is
that a list item *owns* the lines nested under it, so `Alt+Down` on a parent orphans its children.
That gap is filled — the subtree moves as a unit, the same rule `DESIGN.md` states for processing an
inbox item — and tasks are added to the Outline rather than replacing what is there.

**Custom commands.** `command.define` is accepted so a block containing one still runs, and
deliberately **not** registered. VS Code registers commands at runtime without trouble, but the
Command Palette lists what an extension declared in its manifest at install time, and a manifest
cannot know what is in someone's notes. A contributed command that listed the others was built and
then removed: commands contributed at install time are enough, and a second way to reach them is
complexity nobody asked for.

**Syntax highlighting.** `syntax.define`'s markers are a runtime declaration, and VS Code's
equivalent — a TextMate grammar with `injectTo` — is an install-time contribution. Same capability,
different binding time. The renderer half of the same declaration works today, through the preview.

## Tier 4 — indexed and not executed

One category sits outside the three tiers because it is neither ours nor promised: blocks
SilverBullet *runs* and we do not.

```
space-lua      executed when switched on (above); indexed either way
space-style    indexed, never applied — CSS for SilverBullet's editor
```

The vendored indexers produce these objects, so a vault arriving from SilverBullet brings working
code that silently stops working. That makes the README's "the vault *is* the migration" true of
notes and **not quite true of scripts** — worth stating plainly rather than discovering.

So each such block gets an Information diagnostic naming what it calls, and
`LifeLoop: Report Unsupported Blocks` counts them across a vault. That is not an apology; it is the
instrument for deciding whether executing Space Lua is worth building, which the plan says must be
settled by evidence rather than argument.

**The first evidence, from SilverBullet's own documentation vault** — 21 Space Lua blocks:

| | |
|---|---|
| nothing standing in the way | **9** |
| builds a widget | **3** |
| tied to SilverBullet's editor | **6** |
| unclassified | **6** |

**This number was wrong the first time, and the mistake is the useful part.** The first classifier
worked per *namespace* and put all of `editor.*` in "no equivalent", giving 4 portable and 11
blocked — from which the obvious reading was that executing Space Lua is not worth building.

Inspecting the actual calls says the opposite. The only editor methods used anywhere in that vault
are `flashNotification` and `navigate`, and each is one line of VS Code. Meanwhile 30-odd of the
"host calls" were `string.*` and `table.*` — Lua's own standard library, already vendored, not a
host API at all. A coarse instrument produced a confident conclusion in the wrong direction, which
is worth more as a caution than the number is as a fact.

The six genuinely blocked blocks are blocked for a reason that has nothing to do with the editor's
*UI*: `mq.subscribe`, `service.define`, `syntax.define`, `taskState.define`, `js.import` — these are
SilverBullet **runtime extension points**. `taskState.define` would be refused here regardless,
since `DESIGN.md` rejects custom task states on their own merits.

Read it carefully all the same: SB's docs are documentation *about* its own extension points, so
they over-represent exactly those. A personal vault would skew differently, which is why the count
is a command anyone can run on their own vault rather than a number quoted from ours.

What it does establish is that the runtime is not the hard part. The whole Space Lua evaluator is
already vendored and **passes its own tests here** — `packages/semantic-core/src/lua.test.ts` shows
it evaluating expressions, taking host data, calling host functions, and SLIQ querying our own
store. The hard part is the host API surface, and this report says which parts of it would be used.

## Upgrading the pin

Never follow `main`. Point `SB_SRC` at the new checkout, run `npm run vendor:sync`, run the full
suite across the bump, and accept or reject each semantic change explicitly.

Upstream has moved these semantics before: **2.4.0's indexer rework** added `links`/`ilinks`
inherited from parent nodes and shifted `task` refs to the item's position, with its own changelog
warning that dependent code would need adjusting. Task refs are what completion stamping resolves
against, so that particular change would have been silent breakage here.
