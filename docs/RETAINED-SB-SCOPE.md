# Retained SilverBullet compatibility

Current decision rule, 2026-09-08: functionality demonstrated by official SB examples is
retained by default. It may be replaced when LifeLoop's task contract or a verified Foam/VS Code
feature covers the behavior, or deferred when a concrete implementation-cost assessment shows
that it would create another editor/runtime platform. Absence from the trial vault is never a
deletion reason. Declaration acceptance is not reported as runtime compatibility.

## Retained and implemented

- SB task/list extraction, inherited tags and links, nested context and comment exclusion.
- Full task-state names and explicit completion semantics, including `TO DO`, `IN PROGRESS`
  and `DONE`; configuration and `taskState.define` feed indexing and safe mutations.
- SourceHandle validation, exact `$anchor` and `page@…` navigation, CRLF offset conversion,
  guarded delayed actions and refusal of ambiguous or stale sources.
- Space Lua language execution within a bounded host, SLIQ/object queries, Review interpolation,
  baked sections, widget content, `command.define`, `actionButton.define` and `space-style`.
- Capture/Capture Here/continuous Process, operational task views, completion history, one Task
  Actions picker, native source peek and named external-bridge mutations.

## Replaced by Foam or VS Code

| SB/general capability | Replacement | Qualification |
|---|---|---|
| Ordinary wiki links, completion and definitions | Foam | Real-host navigation/completion pass. |
| Backlinks/outgoing links, tags, graph | Foam Connections, Tag Explorer and graph | Foam contributions/source confirmed; task-level Linked Tasks remains LifeLoop-owned. |
| Daily notes and general page templates | Foam | Converted daily template passes real-host creation; four templates pass frontmatter validation. Review templates remain LifeLoop-owned. |
| Ordinary embeds | Foam preview | Embed and LifeLoop query composition passes in both plugin orders. |
| Page queries and saved page organization | Foam Queries / Smart Folders | Query list/table runtime passes; saved-query contributions and format confirmed. |
| Search, Quick Open, Explorer, Outline, Git/diff | VS Code | Host-native. |
| Ordinary file rename | Foam / VS Code | Dirty-reference update passes. Released Foam folder rename remains a documented failure. |

## Retained compatibility surfaces with limited runtime behavior

| API | What remains | Why broader behavior is deferred |
|---|---|---|
| `widget.*`, `dom.*` | Safe tagged content rendered in Markdown preview | Arbitrary DOM, docks and refresh orchestration require a custom editor UI layer that VS Code does not expose. |
| `event.listen`, `event.dispatch` | Listener declarations and explicit capability reporting | LifeLoop uses native events for its workflows. A generic callback bus needs lifecycle, ordering, error and reentrancy contracts and would become a second runtime. No listener is currently claimed to fire. |
| `mq.*` | In-memory send/batch/depth plus subscription declarations | Persistent queues and generic consumers need delivery/retry/ownership semantics. `mq.awaitEmptyQueue("indexQueue")` is replaced by awaited native indexing. |
| `service.define` | Declaration preserved for inspection | A service supervisor needs start/stop/restart, ownership and crash recovery beyond the task contract. |
| `syntax.define` | Declaration and safe span matcher | VS Code/native extensions own syntax UI. Driving Lua render callbacks through semantic tokens/preview would create a custom syntax platform. |
| `js.import`, network, shell, arbitrary page writes | Explicitly refused or unavailable | These expand note code beyond the bounded host and bypass named mutation and ownership checks. They require a separate trust/capability model before consideration. |

These are retained API records or primitives, not deleted features. The limitation is explicit so
future work can target a real workflow without treating an API checklist as proof of need.

## Sample evidence

- Trial isolated copy: 29 content pages, 11 tasks and 38 Space Lua blocks. It exercises
  `command.define`, `event.listen`, `actionButton.define`, `mq.awaitEmptyQueue`, `widget.new`
  and `space-style`; hidden/authentication files were not copied.
- Official isolated samples: 241 documentation pages with 36 tasks and 21 Lua blocks, plus
  55 library pages with 47 Lua blocks. They include multi-character task states and broader
  service, queue, syntax and widget examples.
- `docs/TRIAL-INVENTORY.json` and `docs/SAMPLE-COMPARISON.json` record source counts and durable
  copy locations. Inventory is static evidence, not a claim that every callback executed.

## Known limits

- Ordinary Foam clicks do not understand SB `page@anchor`; use `lifeloop.openSbRef`.
- Special SB refs are not transactionally rewritten on page/folder rename.
- Foam 0.44.6 folder rename loses definition targets after moving descendants. LifeLoop does not
  mask this with a private rename implementation.
- Three live SilverBullet conformance checks require a running SB client and remain skipped when
  it is absent. Headless extraction and mutation comparisons still run.
