# Using LifeLoop with Foam

Install `foam.foam-vscode` from the VS Code Extensions view. Foam is recommended,
not required to activate LifeLoop. Task-only use remains available without it.
Foam 0.44.6 requires VS Code 1.110 or newer; LifeLoop alone retains its 1.102 minimum.

## Who provides each feature

Foam provides ordinary wiki links/completion, Connections/backlinks, tags, page graph,
page queries/Smart Folders, embeds, daily notes and general templates. LifeLoop no longer
registers competing ordinary link/completion/reference providers or an embed parser.
VS Code supplies search, Quick Open, Explorer, Git/Timeline and basic Markdown editing.

LifeLoop provides Capture, Process Inbox, Today, Projects, Linked Tasks, mentions,
task outline/subtree moves, task/project diagnostics, Review/freeze, bounded Lua/object
queries, baking, X-Ray and the Apple bridge. Its semantic-core remains authoritative
for task queries and mutations; Foam's index is never used to select a mutation target.

## Command migration

| Removed LifeLoop command / setting | Replacement |
|---|---|
| `lifeloop.openPage` | VS Code Quick Open; Foam links and navigation |
| `lifeloop.openDaily` | `foam-vscode.open-daily-note` |
| `lifeloop.newFromTemplate` | `foam-vscode.create-note-from-template` |
| `lifeloop.tagPicker` | Foam Tag Explorer / `foam-vscode.search-tag` |
| `lifeloop.metaPicker`, `lifeloop.anythingPicker` | Foam Smart Folders for pages; LifeLoop CLI/object queries for indexed objects |
| LifeLoop Backlinks | Foam Connections |
| Generic slash snippets / `lifeloop.reprefixLine` | Foam date snippets, VS Code snippets/list editing |
| `lifeloop.journalFolder` | Foam daily-note configuration/template |
| SB page-decoration client UI | VS Code themes / Foam navigation |

Update your own keybindings to the new commands. No migration runs on activation.
For daily and general templates, copy only templates you actually use into `.foam/templates`
and adapt variables using Foam's template documentation. `$FOAM_DATE_YEAR`, `$FOAM_DATE_MONTH`
and `$FOAM_DATE_DATE` replace simple date substitutions; SB Lua and `|^|` are not automatically
converted. Do not point Foam at existing SB templates and assume identical interpretation.
`Templates/Review` remains supported by LifeLoop's Weekly Review command.

## Compatibility boundaries

Use explicit full page paths for operational relationships when basenames collide.
Foam's browsing, tag counts and page graph are not SilverBullet object-index conformance.
Foam anchors (`^id`, `[[Page#^id]]`) differ from SB (`$id`, `[[Page@id]]`). LifeLoop retains
its own task handles and **LifeLoop: Open SB Reference at Cursor** (`lifeloop.openSbRef`).
Put the cursor in `[[Page@anchor]]` or `[[Page@position]]` and run that command; aliases are allowed.
Ordinary clicks remain Foam-owned and may offer to **create a note named `Page@anchor`**.
Do not use that creation action to follow an SB ref. LifeLoop registers no competing link provider.
The command does not create notes and refuses ordinary filename links containing `@` when that
page exists, missing anchors and ambiguous page basenames.

Ordinary **file** rename passed the isolated gate. **Folder rename is not qualified** on
Foam 0.44.6: it rewrote `[[Foam/FolderBefore/Child]]` to `[[Child]]`, but its definition provider
returned no target after the move, even though the new file existed. Do not rely on folder rename
for reference integrity; inspect and repair links with the host tools. LifeLoop adds no rename engine.
Before renaming pages referenced
with SB special refs, inspect those references and repair them explicitly; this release does
not provide a special-ref rename transaction. No anchor conversion is automatic.

Foam owns note embedding. Top-level LifeLoop query fences continue to render alongside Foam
embeds. LifeLoop expressions/queries nested inside a Foam embed are not promised to execute:
Foam controls the inner renderer. Bake the source section first if portable output is required.

Keep task completion on LifeLoop commands/views when a completion date is required. A plain
checkbox edit by another extension is a text edit, not an authoritative LifeLoop completion event.

Foam JS templates/queries have Foam's permissions, not LifeLoop's bounded read-only Lua contract.
Installing the companion does not extend that contract to code run by other extensions.

## Reproduce coexistence checks

```sh
LIFELOOP_FOAM_PATH=/absolute/path/to/foam.foam-vscode-0.44.6 npm run test:foam
```

The runner checks the release identity, copies Foam into an isolated extensions directory and
uses a fixture vault and profile. It does not install into your personal VS Code profile or
modify your notes. `npm run test:integration` runs the task-only profile without Foam.
The Foam gate covers ordinary links/completion, dirty-source file rename, explicit SB navigation and refusal, daily templates and
preview composition in both plugin orders. It does not certify every Foam feature or SB script.

The known failing folder qualification is visibly skipped in the supported gate. Re-run it with:

```sh
LIFELOOP_TEST_FOLDER_RENAME=1 LIFELOOP_FOAM_PATH=/absolute/path/to/foam.foam-vscode-0.44.6 npm run test:foam
```

This is a compatibility gap, not a passing folder-rename claim. The converted trial templates
are qualified syntactically and the daily template runs in Foam; graph UX and advanced query
combinations remain owned by Foam and were not exhaustively automated here.

## Compatibility and implementation cleanup

Official SB example features are retained by default. A feature is replaced only when the
LifeLoop task contract or a verified Foam/VS Code feature covers it, or deferred with a concrete
cost and impact assessment. Trial absence is not a deletion reason. Current per-API decisions
are in `RETAINED-SB-SCOPE.md`.

`LifeLoop: Today` focuses the existing task tree. Task subtree commands remain available, but their
Alt-arrow defaults are removed so normal line editing stays with VS Code. X-Ray displays JSON.
CLI full-text search is retired; use `rg`. Saved Dashboard definitions and unused page decoration,
slash-template and page-promotion internals are retired; Review creation and Lua template APIs remain.

For CRLF pages, task-tree receipts and navigation translate SB's normalized index positions
back into the unchanged source using the exact indexed body. Cursor numeric refs retain original
editor coordinates; anchor navigation uses the same offset mapping. Source verification remains
required at mutation time. No line endings are converted automatically. Three task-view regression
cases cover correct targeting and CRLF preservation; other index consumers require separate qualification.

`LifeLoop: Run Declared Command` lists `command.define` declarations in VS Code Quick Pick.
It uses the existing Space Lua opt-in and callback time budget. Top-level scripts run first to collect declarations; cancelling the picker does not invoke
the selected command callback. Declaration errors stop the run. This restores a command execution entry point without granting additional
script write permissions or promising all SB command metadata/keyboard binding behavior.
