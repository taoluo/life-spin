# LifeLoop for VS Code

**Capture without stopping what you are doing. Keep every task with the work it belongs to. See
what actually matters today. Get the whole picture back every week.**

    capture → context → act → today → done → review ↺

Your notes stay ordinary Markdown and your tasks stay ordinary checkboxes. Everything this
extension shows is derived — delete its index and rebuild it, and you have lost nothing.

## What it does

**Retrieval first**, because filing is what people stop doing. `[[wikilinks]]` resolve by basename
and are ctrl-clickable, Shift+F12 gives you backlinks in the editor's own UI, links that resolve to
nothing show up as diagnostics, and completion offers pages and tags from the index.

**Queries, on three surfaces.** A fenced `lifeloop` block stays code in the editor and answers in
whichever way suits where you are looking:

| | |
|---|---|
| above the block | a result count and an **Open** action |
| on hover | the table itself |
| in the Markdown preview | the table, rendered in place |

`today`, `upcoming`, `actionable`, `parked`, `signals`, `backlinks`, `broken` and the rest, narrowed
with `date:`, `days:`, `fields:` and `limit:`. Nothing is written to your notes — a query renders
and stores nothing. Turn the counts off with `lifeloop.queryCodeLens` if they are noise; the hover
and preview are unaffected.

**Space Lua, if you want it.** Blocks from your notes can run — **off by default**, because a vault
can be shared, synced or cloned and none of that means you meant to run the code inside it. Scripts
are read-only and time-limited. SilverBullet's integrated query language works as written:

    ${query[[ from index.tasks() where _.deadline < "2026-09-16" order by _.deadline ]]}

**Outlining that knows what an item owns.** VS Code already moves lines, folds and indents, and
already outlines Markdown headings. What it cannot know is that a list item owns the lines nested
under it — so its own `Alt+Down` on a parent leaves the children behind. `Alt+↑/↓/←/→` here take
the whole subtree, and tasks appear in the Outline view alongside headings.

**Templates are pages.** The daily note and the weekly review were shapes written into the
extension; now they are pages you can edit. Put a `Templates/Daily` in your vault and it wins over
the built-in one — because the thing people most want to change about a daily note is what is in
it, and that should not need a code change. `suggestedName`, `confirmName` and `openIfExists` in
frontmatter, `${date.today()}` in names and bodies, and `|^|` for where the cursor lands.

**The loop.** `LifeLoop: Capture` writes one line to your Inbox without navigating away.
`Process Inbox` links it to a project — keeping the wording where it happened — or turns it into a
task. Today shows overdue, due and scheduled work in disjoint sections, and ticking a row stamps
the source file. Weekly Review renders live and freezes into a snapshot that stays true.

**Apple, split by what you mean.** Reminding and repeating belong to Reminders; an actual interval
belongs to Calendar; capture on a phone belongs to Notes. Completing a reminder on a watch
completes the task here.

## What it deliberately does not do

No habit tracker, no recurring-task engine, no priority scoring, no dependency graph, no dashboard
you have to maintain. An ordinary note is a legal note; an ordinary checkbox is a legal task. If a
feature would add a field to everyone's Markdown, it does not go in.

## Requirements

VS Code 1.102 or newer — LifeLoop uses Node's built-in SQLite, so there is nothing to compile and
nothing that can fail to install. The Apple bridge needs a local macOS host; over SSH or on the web
it reports itself unavailable rather than failing obscurely.

## Settings

| | |
|---|---|
| `lifeloop.inboxPage` | page captures land on (default `Inbox`) |
| `lifeloop.journalFolder` | folder for daily notes (default `Journal`) |
| `lifeloop.reviewFolder` | folder for weekly reviews (default `Reviews`) |
| `lifeloop.notesFolder` | Apple Notes folder imported into the Inbox — never the whole library |
| `lifeloop.calendarName` | the calendar events are created in, and the only one bindings are looked up in |
| `lifeloop.autoSync` | sync projected reminders on a timer. **Off by default** — nothing should touch your Reminders because an extension was installed |

MIT. Includes SilverBullet's Markdown parser and indexers, MIT © 2022 Zef Hemel.
