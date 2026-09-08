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
| `tostring`, `tonumber`, `type`, `pairs`, `ipairs`, `next`, `pcall`, `xpcall`, `error`, `assert`, `select`, `print`, `raw*`, `*metatable` | the bare globals, without which almost no script runs |
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

The globals are written by hand rather than vendored, and that is the point: upstream's
`stdlib.ts` defines `tostring` and `pairs` in the same file as `net` and `js`, so taking the file
would take those too. Building the list keeps them out by construction instead of by intention —
`js.import`, `net.fetch`, `dofile` and `load` all fail, and a test asserts it.

Multi-value returns needed Lua's own type. A JavaScript array is *one* value, so
`local ok, err = pcall(f)` bound `ok` to the whole array and left `err` nil, and `for _, v in
ipairs(t)` never received an iterator. `LuaMultiRes` is the answer; both failures pointed at the
calling script rather than at the builtin.

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

Several things were listed as missing that were not, and the correction is worth keeping because it
is the same mistake repeated: reading "SilverBullet has a feature" as "the host lacks it".

**Editing non-Markdown files.** SilverBullet needs a Document Editor because it *only* has a
Markdown editor; opening a CSV or an image there is a feature someone had to build. VS Code editing
every file type is its job. This is not a gap, and it is listed here so it stops being counted as
one.

**The slash-command menu.** `/` is a completion provider with `/` as a trigger character, returning
snippets — so fuzzy matching, keyboard navigation and the user's own completion settings come from
the host rather than from a menu of ours. The ported part is the *content*: pages tagged
`meta/template/slash`, named after the last component of their page name, exactly as upstream names
them. `|^|` becomes the snippet's `$0`.

`/h1`–`/h4` and `/task` are a different kind and are treated as one: they reshape the current line
rather than insert at it, replacing whatever prefix it had instead of stacking onto it.

**Mentions.** Completion, clicking and finding are a completion provider, a document link provider
and a reference provider, so `@ada` gets Shift+F12 and the peek window for nothing. The Mention
Inbox is a tree view beside Today and Backlinks. What was actually missing was never the widgets —
the index already held identity objects and at-mention relations — it was that nothing above the
index used them.

**X-Ray.** Upstream's consistency lens — every range the indexer extracted, underlined, with its
attributes on hover — is a text decoration and a hover provider. No webview. For a port it earns its
place twice: it is the fastest way to check that we and SilverBullet read the same structure out of
the same bytes, and it makes a gap self-diagnosing rather than something found by reading code.

**Pickers.** Tag, Meta and Anything are `QuickPick` over the index. The Anything Picker is
deliberately not a page picker with more rows: quick open already finds files, so this lists
*objects* — tasks, headings, identities, tags — which is the half quick open cannot see.

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

**Page templates.** A first version: a template is a page under `Templates/`, and SilverBullet's
own frontmatter keys are read as-is — `suggestedName`, `confirmName`, `openIfExists`, `command` —
so a vault arriving from there does not need its templates rewritten. `|^|` places the cursor.

The substitutions available without scripting are a fixed, small set (`${date.today()}`,
`${week.start()}` and their neighbours), because a daily note has to work in a vault that never
switched Space Lua on. Anything else is left as written, so a template using a full expression
still reads as itself and the preview answers it when scripting is enabled.

What this replaced matters as much as what it added: the daily note, the weekly review and the page
an attached task gets were all shapes hardcoded in the commands that created them. They remain as
fallbacks, so a vault with no templates behaves exactly as before — but the shape of your own
weekly review is now something you edit rather than something you fork.

**Syntax highlighting.** `syntax.define`'s markers are a runtime declaration, and VS Code's
equivalent — a TextMate grammar with `injectTo` — is an install-time contribution. Same capability,
different binding time. The renderer half of the same declaration works today, through the preview.

## Ported in part, and where the seam is

Three features cross the line between what the format says and what a host can show. Each is ported
as far as the host allows, and the remainder is written down here rather than left to be found.

**Transclusion.** `![[page]]`, `![[page#header]]` and `![[image.png|300]]` are *file* syntax — a
vault from SilverBullet already contains them, and a page full of literal brackets is a page that
has lost its content. The parser is upstream's, vendored with its own tests. Expansion happens
before markdown-it parses, so an embedded page's headings and lists are real ones and any `${...}`
it carries is answered as if written in place.

The seam: the **preview** embeds, the **editor** keeps showing the source. VS Code cannot render
inside a document, which is the loss `WHY.md` already records; transclusion does not change it.

**Baked sections.** `<!--#lua EXPR -->` … `<!--/lua-->` keeps a directive and its rendered output
side by side. The markers are HTML comments, so every other renderer ignores them and shows the
table — which is the whole point: the file reads correctly on GitHub while staying re-runnable
here. Marker syntax and the escaping rule are upstream's, vendored, because subtly wrong delimiters
corrupt a page on the *next* update rather than merely rendering it oddly.

The seam: baking is manual, as it is upstream. Nothing refreshes on its own, because that would
mean rewriting files behind the user's back.

**Page decoration.** `prefix`, `hide`, `tree.hide` and `tree.priority` are honoured in the pickers
and completions we own, and the emoji prefix becomes an Explorer badge through a file decoration
provider.

The seam: `icon` and `cssClasses` have no host equivalent — Explorer icons come from the user's icon
theme and there is no stylesheet to hook into — and **VS Code's own Quick Open cannot be decorated
by an extension at all**. So a page marked `hide` stays reachable there. `hide` is a tidying tool
here, never a privacy one.

## Not ported, deliberately

**Object Graph.** The only feature on the list that would require a webview, and with it message
passing, state synchronisation and a content security policy — none of which the preview path needs
today. It is also the feature every notes tool builds and few people use twice. Not a capability
gap so much as a decision.

**Virtual pages.** `TextDocumentContentProvider` would do it, and there is nothing to put in one
yet. Infrastructure without a consumer, deferred until something asks.

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
