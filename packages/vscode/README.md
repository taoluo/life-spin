# LifeLoop for VS Code

Capture → context → act → today → done → review.

LifeLoop owns task workflows. Pair it with **Foam** (`foam.foam-vscode`) for ordinary
wiki links, backlinks, tags, page graph, daily notes, templates and embeds. Foam is a
recommended companion, not a hard dependency; LifeLoop task commands work without it.

## What LifeLoop adds

- Capture to Inbox or beside the current context; global Inbox processing advances after each successful action.
- Today, Projects and current-page Linked Tasks, with factual `Why` tooltips backed by SilverBullet's object semantics.
- A small relationship loop: explicit Journal interactions, derived reconnect signals in Today, Person context and ordinary follow-up tasks. Person pages and browsing remain Foam-owned.
- One state-aware Task Actions picker for completion/reopen, deadline/scheduling, parking, external bindings and native source peek/open.
- Source-verified task actions and recorded completion dates.
- Weekly Review creation and freezing, full-body Apple Notes Inbox capture, guarded Reminders/Calendar/Notes synchronization, conflict resolution, and lightweight 🔔/📅 binding hovers.
- Task outline/subtree movement, mentions and X-Ray for inspecting the task index.
- Named queries in CodeLens/hover/preview, a bounded opt-in Space Lua subset and minimal baking.

Ordinary note features are upstream-owned: there is no second LifeLoop link completer,
Backlinks panel, general template picker or transclusion renderer to keep in step with Foam.
Search, file navigation and revision history use VS Code itself.

## Existing users

Generic note commands have been retired. Use Foam's daily-note/template commands and
Connections/Tag Explorer instead. Existing notes are never converted on activation.
`Templates/Review` still customizes LifeLoop's Weekly Review.
For SB `[[Page@anchor]]` / `[[Page@position]]`, use **LifeLoop: Open SB Reference at Cursor**.
Ordinary Foam clicks can offer to create a page with that name; they do not follow SB refs.
Foam file renames are qualified for ordinary links only; folder rename is not qualified.
Inspect and repair SB refs explicitly.

See [migration and compatibility](https://github.com/tao/silverbullet-lifeloop/blob/main/docs/FOAM.md)
for command replacements, SB special refs and the limits of preview composition.

LifeLoop requires VS Code 1.102+. The tested Foam 0.44.6 companion requires VS Code 1.110+.
General Lua, widget, declaration, Space Style and action-button compatibility is retained; unused
APIs are not pruned by script usage. Today focuses the existing tree and normal Alt-arrow editing
belongs to VS Code. CRLF source offsets and Capture Here line endings are preserved and verified.
The Apple bridge requires a local macOS host. Space Lua and automatic Apple sync remain off
by default. Foam's JS execution model is separate from LifeLoop's read-only Lua contract.

MIT. Includes pinned SilverBullet parser/indexers, MIT © 2022 Zef Hemel.
