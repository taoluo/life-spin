# Foam / LifeLoop ownership boundary

> Historical implementation plan. Later decisions retain official SB example features by
> default and require multi-character task states. Current decisions and evidence are in
> `../CAPABILITY-MATRIX.md` and `../RETAINED-SB-SCOPE.md`; old counts below are archival.

Status: accepted direction; implementation and integration evidence recorded below.
This decision supersedes conflicting VS Code PKM scope in the original design and execution plan.
The SilverBullet Lua library remains unchanged.

## Decision

Foam is the recommended companion, not a hard extension dependency. LifeLoop remains usable
for tasks without Foam; generic note features require Foam or another user-chosen extension.
There is no standalone PKM fallback mode, no Foam internal API dependency and no second index
used as mutation authority. The shared interface is Markdown on disk and editor buffers.

Alternatives considered: retaining two switchable PKM implementations keeps the maintenance
cost we are removing; requiring Foam prevents task-only use and couples activation to its
availability. Recommend Foam and remove duplicate providers instead.

## Compatibility scope (latest user correction)

Complete LifeLoop task workflows and safety validation; define the necessary SB semantic
compatibility list and retire platform compatibility with no actual retained dependency.
Full SB parity is not a goal. Preserve exact semantics for committed task formats and
LifeLoop's own mutation/ownership contracts. Do not build event/queue/service/syntax platforms
to fill an API checklist. Inventory actual nonstandard task states and retained scripts before
retiring configuration or converting content; never silently change their meaning.

This supersedes the earlier parity-first direction and the active goal’s older parity wording.

## Feature ownership

| Reuse Foam | Port / retain LifeLoop | Give up in this extension |
|---|---|---|
| Page graph, Connections/backlinks, tags | Task/item extraction, inherited tags/links, comment exclusion | Object graph, complete live-preview editor |
| Ordinary wikilinks, completion, diagnostics, rename rewriting | Verified task handles and explicit SB-ref command | A second editor/mobile/sync platform |
| Daily notes, general templates and date snippets | Capture/process, Today/upcoming, projects, Linked Tasks | Generic template/slash/navigator platform |
| Note/section/media embeds | Review creation/freeze, minimal baking, object queries | Mobile PWA, sync engine, multiplayer merge protocol |
| Page queries and Smart Folders | Lua API compatibility, X-Ray, subtree moves | Share providers, library/package manager |
| Ordinary note metadata and navigation | Apple bridge, named mutation API and CLI | Generic Kanban/database/dashboard builder |

Native VS Code owns full-text search, Quick Open, Explorer, Git/Timeline, Markdown editing,
math/diagram rendering where supported. No new implementation is required for those features.

## Compatibility and migration

Foam browsing is not SB semantic conformance. Ambiguous links, block anchors and directory links
can resolve differently. Prefer explicit full page paths for task/project relationships.
Foam uses ^block and page#^block; SB uses $anchor and page@anchor/position. Existing task refs
remain interpreted by LifeLoop. Use `lifeloop.openSbRef` for SB navigation; ordinary Foam clicks
can interpret these refs as new page names. Do not register a competing link provider. Do not automatically rewrite an existing vault or convert anchors.
Foam file rename support is qualified only for ordinary page links; folder rename remains
unqualified (rewritten links did not resolve in the pinned host test). Rename of pages targeted by SB
special refs requires explicit inspection/repair. No successful task mutation may use Foam's index.

Retire the generic LifeLoop open-page, daily-note, new-template and tag/meta/anything picker
commands, Backlinks view, wiki/tag completion, generic link diagnostics and transclusion hook.
Use Foam's commands directly. Retire generic slash completion and page-decoration client UI.
Keep review template support because it is part of the operational workflow, not a second general
note-creation interface. Core template creation is limited to the Review workflow; Lua template APIs remain unchanged.
Keep object-level CLI/projection reads even when their generic editor UI is removed.
Add a current-page Linked Tasks view with source handles, reusing the existing task query/view path.

Provide installation recommendation and migration instructions. Do not install into the user's
profile, modify their settings, move templates, or change note bytes as a side effect of activation.
A missing Foam installation does not cause LifeLoop to impersonate its missing features.

## Validation gate

Run the core checks plus real VS Code integration with a fixed Foam release in an isolated
extensions directory and fixture vault. Cover ordinary link completion/navigation, rename and
reference updates, embeds/preview composition, template creation, LifeLoop capture/completion
against dirty buffers, and removal of duplicate LifeLoop command/provider surfaces.
Record actual Foam and VS Code versions. Do not count headless mocks as Foam interoperability.
Keep special-ref navigation and inherited Linked Tasks checks separate from Foam's page graph.
Unqualified advanced Foam features (e.g. JS queries, graph UX) remain upstream-owned, not proven
by a basic integration smoke test. No new whole-vault conformance claim is made.

## Review correction

Task tree labels and receipts must come from the same indexed object. Reuse existing FTS body
with an exact object-JSON check in the same SQL statement, then verify against the live vault
when modifying. Missing/mismatched indexed source gives no action handle. A path-only body read
is insufficient because the CLI may update the same database between queries. No new schema,
lock, queue or forced reindex is needed. Tests cover stale source before/after rendering and a
second database connection replacing the indexed object before receipt capture.

Dependency review also found prefix-based anchor matching in `resolveRef`. Reuse the vendored
NamedAnchor parser for exact identities, including code/escape exclusion and duplicate refusal.
Two added regressions were observed failing before this correction and passing afterwards.

CRLF anchors and task-tree positions are mapped back to the original source after parsing.
Tree receipts use the exact indexed body to convert numeric refs; upstream index refs and cursor
numeric positions retain their original semantics. Three view regressions verify correct targeting
and CRLF preservation; final read-back review found no additional issues. Other index consumers
remain separately qualified.

The later cleanup removes saved-view definitions, unused page-decoration/slash/template UI remnants,
unused TypeScript page promotion and CLI full-text search. FTS body storage remains for receipts.
Today focuses the existing tree, X-Ray uses native JSON, and ordinary Alt-arrow bindings are removed.
Lua block Markdown output uses the host's Markdown renderer; widget HTML retains its allowlist,
plain returned Markdown does not enable raw HTML, and nested Lua fences do not recursively render.

## Implementation evidence

2026-09-08, VS Code 1.136.1 / Foam 0.44.6, isolated fixture vault and extension/profile directories:

- `npm run verify`: typecheck, vendor (137 files), schema guard passed; 587 headless tests passed,
  3 live SilverBullet checks skipped. The initial sandbox run could not start tsx IPC; the host
  run passed. The lower count than the old 625 baseline primarily reflects retired-feature tests; Lua host
  compatibility tests remain intact. Final view/template targets and typecheck were rerun after
  minor display/test cleanup.
- `npm run test:integration`: 9 passed, 7 Foam cases skipped; the test asserts Foam is absent.
- `npm run test:foam`: 15 passed, 1 explicitly unqualified folder-rename case skipped.
- The folder qualification was actually run and failed: target file existed after rename,
  rewritten `[[Child]]` / `[[Child#Detail]]` had no definition target. It remains reproducible
  via `LIFELOOP_TEST_FOLDER_RENAME=1`; this is not full rename compatibility.
- SB ordinary-click conflict is confirmed through the combined host link provider. LifeLoop
  now uses its explicit command; anchors, positions, aliases and no-write refusal paths pass.
- Final Upcoming correction read-back completed without additional findings. See `docs/REVIEW-foam.md` for findings and disposition.

No personal vault migration, installed-profile changes, Git commit or full SB/Foam equivalence
is claimed. Real-vault templates/embeds and upstream graph/query UX remain unqualified.
