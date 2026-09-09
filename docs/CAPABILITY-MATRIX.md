# Foam / LifeLoop capability matrix

Current as of 2026-09-09. “Verified” means the named behavior has executable or
source-level evidence; accepting an SB declaration is not counted as runtime parity.

## General notes

| Capability | Owner | Evidence and boundary |
|---|---|---|
| Wiki links, completion, definitions | Foam | Real VS Code + Foam 0.44.6 resolves and completes ordinary links. LifeLoop registers no competing provider. |
| Backlinks / outgoing links | Foam | Foam 0.44.6 contributes the Connections views. LifeLoop's separate Linked Tasks view aggregates task-level inherited links. |
| Tags and page graph | Foam | Foam manifest and bundle contribute Tag Explorer/search and graph commands. These are browsing features; LifeLoop keeps object-level inherited tags for task queries. |
| Page queries | Foam | Real-host list and table queries return the expected page and compose with LifeLoop preview hooks in both extension orders. Bundle inspection confirms tag/link/path/property filters plus list/table/count output. |
| Smart Folders | Foam | Foam contributes `.foam/queries/*.yaml` discovery and Smart Folder commands. Saved-query UI behavior is owned by Foam; LifeLoop has no parallel folder engine. |
| Daily notes and ordinary templates | Foam | The converted LifeLoop daily template is exercised through `foam-vscode.open-daily-note`; Foam expands its date variables. All four converted templates have parsed YAML frontmatter and no SB cursor marker. |
| Page / heading embeds | Foam | Real host renders a Foam embed beside a LifeLoop query in either plugin order. Inner LifeLoop execution inside an embed is not promised. |
| File rename | Foam / VS Code | Ordinary file rename, reference update, heading suffix and dirty source preservation pass in Foam 0.44.6. |
| Folder rename | Foam limitation | Released Foam rewrites links but then loses definition targets for moved descendants. The failure is reproducible; a copied diagnostic patch proves the likely missing refresh. LifeLoop does not add a rename engine. |
| Search, Explorer, Outline, Git | VS Code | Native host features; no LifeLoop duplicate. |

## LifeLoop task contract

| Capability | Status | Evidence and boundary |
|---|---|---|
| Task extraction and context | Verified | Headless tests cover nested context, inherited tags/links, comments and SB-compatible objects. Three live-SB checks explicitly skip when no RuntimeAPI client is available. |
| SourceHandle and mutation validation | Verified | Exact task line/state receipt, duplicate-anchor refusal, same-version body/JSON reads, dirty-buffer writes and CRLF source offsets have regression coverage. Delayed tree/prompt/bridge actions require a guarded handle; page creation records expected absence. |
| Multi-character states | Verified on core, VS Code, CLI and bridge | Full names are retained; explicit `done` policy controls extraction and mutation. Unknown states refuse. Configuration changes, Lua declaration deletion and dirty declarations pass real-host tests. CLI uses explicit `--task-states`; it does not implicitly read VS Code/Lua configuration. Failed or changing policy transitions cannot certify or publish a mixed index. |
| Capture / Process / Today / Waiting / Projects | Verified | Filesystem integration composes capture → process → schedule → complete → review. Capture Here is a named guarded mutation; global Inbox processing advances only after a successful action. |
| Task Actions / source peek | Verified in real VS Code | One Quick Pick dispatches existing named commands. Peek Source uses `editor.action.peekLocations`; no Webview or second editor is maintained. |
| Linked Tasks | Verified | Uses task-level inherited links, carries a guarded SourceHandle, and explains direct versus inherited relations without replacing Foam backlinks. |
| Personal relationship loop | Verified headless and in real VS Code/Foam | `tags: person` pages stay ordinary Foam pages. Explicit dated Journal interactions derive last contact and reconnect signals; follow-ups are ordinary guarded tasks. Mentions never count as contact, and no CRM database, score or dashboard is maintained. |
| Completion history / reopen | Verified | Completion dates are written or removed by named mutations; externally reported completion dates are preserved by the bridge. |
| Review / freeze | Verified | Review interpolation is retained and a frozen snapshot remains unchanged after later vault edits. |
| Baking | Verified core | Bake/update/unbake tests cover dynamic results becoming Markdown. This is not a general publishing framework. |
| Apple Notes full-body import | Verified with fakes; real Notes pending | A whole plain-text body is one pending Inbox item: first line plus indented continuation lines. Rich content is read without claiming a lossless Markdown round trip. |
| Apple Notes pending sync | Verified with fakes; real Notes pending | Durable three-way baselines propagate one-sided plain-text edits. Concurrent edits pause with the binding intact and enter Resolve; rich Notes cannot be overwritten. Processing still hands ownership to Markdown. |
| Reminders / Calendar | Verified with fakes; real apps pending | Reminders retain completion reconciliation. Calendar shares only the task/event title; Calendar owns time, recurrence, attendees and location. Calendar writes use external compare-and-set and creation compensation. Divergence keeps the binding and pauses for Resolve. |
| External binding display/actions | Verified in real VS Code before latest UX pass | Exact task attributes receive lightweight 🔔/📅 decorations and hover Sync/Open/Detach/Copy actions. A native Output Channel records failures and conflicts. External systems only surface divergence; LifeLoop's VS Code Resolve command is the sole resolution control plane. It offers Use Markdown, Use Apple, or explicit Detach and refuses a choice if either side changed after it was shown. |
| X-Ray | Verified | Uses JSON to explain LifeLoop objects; it is not a general inspector. |

## SilverBullet script compatibility

Official examples are retained by default. Trial absence is not a deletion criterion.
The host remains bounded: arbitrary JavaScript import, shell, network and unnamed page writes
are not enabled merely for parity because they bypass LifeLoop's mutation and ownership contract.

| API | Current support | Disposition |
|---|---|---|
| Lua language, SLIQ, `index.*`, `tags.*`, read-only `space.*` | Implemented | Retain. Official docs execute through the host; supported query and rendering paths have focused tests. |
| `command.define` | Adapted | Retain via VS Code Quick Pick. Callback and cancellation are tested; SB keybinding metadata is not reproduced. |
| `taskState.define` | Implemented | Retain. Full state names, ordering, done policy and live invalidation are wired through production paths. |
| `actionButton.define` | Adapted | Retain as VS Code status-bar commands. It has repository consumers. |
| `space-style` | Adapted | Retain as filtered, scoped Markdown-preview CSS. Unrestricted editor CSS is intentionally unavailable. |
| `widget.*` / `dom.*` | Partial adaptation | Inline Markdown/allowlisted widget content renders in preview. Arbitrary DOM access, docks and refresh orchestration are deferred because VS Code has no equivalent editor DOM and implementing one creates a second UI platform. |
| `event.listen` / `event.dispatch` | Declaration compatibility only | Listener intent is preserved and unsupported names are reportable. A general SB event bus is deferred: LifeLoop workflows use native events directly, and callback ordering/lifecycle would be a separate runtime. Do not describe listeners as fired. |
| `mq.*` | In-memory primitives only | Send, batch send, depth and subscription declarations exist. Persistent delivery and a generic consumer loop are deferred; Inbox freshness uses awaited native indexing. |
| `service.define` | Declaration compatibility only | Definitions remain available to parsing/inspection. A background service supervisor is deferred because it requires lifecycle, restart, ownership and failure semantics outside the task contract. |
| `syntax.define` | Declaration and matcher only | Definitions and safe matching remain. Editor rendering/highlighting is deferred to VS Code extensions; wiring arbitrary Lua renderers into editor tokens would create a custom syntax platform. |
| SB `$anchor` / `page@…` refs | Explicit navigation | `lifeloop.openSbRef` resolves exact anchors/positions and refuses ambiguous/missing targets without creating files. Foam ordinary clicks may still offer a `Page@anchor` note; special-ref rename is not transactional. |

## Current verification

- `npm run verify`: typecheck, vendor guard and schema guard pass; 856 tests pass and 3 live-SB checks skip because no RuntimeAPI client answered.
- Live SilverBullet 2.10.0: current result is SKIP. The isolated fixture and checks remain available, but no live RuntimeAPI client answered this run.
- Task-only VS Code 1.136.1: 22 tests pass, 8 Foam-only tests skip.
- VS Code 1.136.1 + Foam 0.44.6: 29 tests pass, 1 known folder-rename qualification test skips.
- Real Apple Notes and Calendar: SKIP because AppleEvent calls timed out on this host. Fake bridges verify Notes full-body import, pending two-way sync, Calendar compensation, all three conflict paths and stale-resolution refusal. Reminders uses the same fake-backed verification; no personal external data was changed.
- Original trial and official sample sources remain unchanged; inventories use durable isolated copies.
