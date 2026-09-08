# LifeLoop

**Capture without stopping what you are doing. Keep every task with the work it belongs to. See
what actually matters today. Get the whole picture back every week.**

Closing that loop is the whole point:

    capture → context → act → today → done → review ↺

Your notes stay ordinary Markdown, tasks stay ordinary checkboxes, and every view is derived —
delete the index and rebuild it, and you have lost nothing.

There are two implementations of the same idea. Both read the same vault.

| | |
|---|---|
| [`LifeLoop/`](LifeLoop) | the original [SilverBullet](https://silverbullet.md) library — no plug, no database, no page format of its own |
| [`packages/`](packages) | the VS Code implementation, on a standalone semantic core |

The vault *is* the migration between them. Same frontmatter, same `[deadline:]`, same
`## Processed`, same `#waiting`. That was not luck — it is what "Markdown owns durable knowledge"
was for, and it is the first real test of it.

With one honest exception: **`space-lua` and `space-style` blocks are indexed and never executed.**
A vault from SilverBullet keeps its notes and loses its scripts. Each block says so as a diagnostic,
and `LifeLoop: Report Unsupported Blocks` counts them — see [`COMPATIBILITY.md`](COMPATIBILITY.md).

## The documents, and which answers what

| | |
|---|---|
| [`LifeOS for VS Code.md`](LifeOS%20for%20VS%20Code.md) | what the system is, and what it refuses to become |
| [`LifeOS Execution Plan.md`](LifeOS%20Execution%20Plan.md) | phases, decisions, gates, and what building it changed |
| [`DESIGN.md`](DESIGN.md) | who owns which fact, and what the code may do to your Markdown |
| [`WHY.md`](WHY.md) | why leave SilverBullet at all — including the case for not bothering |
| [`COMPATIBILITY.md`](COMPATIBILITY.md) | which semantics are promised identical, and how that is proved |
| [`ROADMAP.md`](ROADMAP.md) | the SilverBullet library's own scope |

Phases 0 to 3 are implemented. Phase 4 (rich views) and Phase 5 (AI) are **future roadmap, not
scheduled** — the expected outcome is that most of them never ship, and that is a success.

## The VS Code implementation

```
packages/semantic-core   parse · index · query · mutate — no UI, no editor
packages/vscode          the extension
packages/cli             lifeloop index | query | dump | search
packages/apple-bridge    Reminders, Calendar, Notes — imports nothing from vscode
vendor/silverbullet      SilverBullet's parser and indexers, pinned and unmodified
```

### Why the parser is vendored rather than rewritten

SilverBullet's semantics *are* its implementation — `inComment`, inherited `itags`,
`links`/`ilinks`, the two ref forms, what counts as an item. A clean-room rewrite keeps the shape
and loses the corners, silently. So the parser and extraction functions are **copied at a pinned
commit and called**, not reproduced, and `npm run vendor:check` fails the build on any local edit.

That makes conformance a proof rather than a sample: it is the same code, and **285 of upstream's
own assertions run against our copy** on every `npm test`.

### Getting started

```bash
npm install
npm run verify                      # typecheck, vendor integrity, schema pin, 492 tests
npx tsx packages/cli/src/main.ts index  ~/vault
npx tsx packages/cli/src/main.ts query  ~/vault today
```

To install the extension into your own VS Code:

```bash
npm run install-extension     # build → package → install
```

See [`RELEASING.md`](RELEASING.md) for handing the `.vsix` to someone else, or publishing. For
development, open `packages/vscode` in VS Code and press F5.

### Testing

```bash
npm test                  # 492 headless tests, ~15s
npm run test:integration  # 9 tests inside a real VS Code (downloads it once)
npm run verify            # everything above, plus typecheck and the two guards
```

Four tiers, cheapest first: unit tests on pure functions; upstream's own tests against the vendored
copy; contract tests where **every refusal asserts the vault is byte-identical afterwards**; and
end-to-end runs of the whole loop on a real filesystem.

The suite spends as much effort on what must *not* happen as on what must — a stale inbox item is
left completely alone, a task already done is never re-stamped with today's date, a collision
leaves the source exactly as pending as it was, and a projection acting on a row that no longer
describes its source refuses rather than guessing.

Two guards are structural rather than aspirational:

* **`npm run vendor:check`** — hashes all 125 vendored files against the pinned commit, and fails
  if any imports from `packages/`.
* **`npm run schema:check`** — records every frontmatter key and task attribute the system reads,
  and fails when the set grows. If a feature added a field to everyone's Markdown, that is a design
  conversation, not a merge. [`schema.json`](schema.json) records why each one was admitted.

### Apple integration

Reminders, Calendar and Notes, split by what you mean rather than by vendor: reminding and
repeating belong to Reminders, an actual interval belongs to Calendar, capture on a phone belongs
to Notes, and the commitment stays here. Write capability is not ownership — you can edit in any of
them; each fact still has exactly one owner.

Driven against the real applications, which found four things no fake could:

* `whose id is in argv` does not work — AppleScript will not coerce a list into a type specifier.
* `every event of every calendar whose uid is …` returns a list *per calendar*, so reads are scoped
  to one named calendar; scanning six outlasts the scripting bridge's patience.
* `missing value` stringifies to the literal text `"missing value"`, so every reminder in a real
  list reported a completion date it did not have.
* **Reminders' scripting dictionary has no recurrence property at all** — checked against
  `properties of` a real reminder. Excluding recurring reminders is a precondition for the reverse
  flow being correct, so over AppleScript a task may be completed from a reminder but **never
  reopened**, and a binding seen to un-complete itself stops driving anything from then on.
  EventKit answers this directly; that is the trigger for moving to it.

## Licence

MIT. Vendored SilverBullet sources are MIT, Copyright 2022 Zef Hemel — see
[`vendor/silverbullet/PROVENANCE.md`](vendor/silverbullet/PROVENANCE.md).
