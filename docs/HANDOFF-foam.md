# Foam boundary implementation status

Updated 2026-09-08. Workspace `/Users/tao/silverbullet-lifeloop`, branch `vscode-implementation`,
base `452b4cdf79b3c86e861ca51b15d2f6c2fc196ef9`. All implementation changes remain uncommitted.
No personal vault/profile was changed and no extension was installed.

## Current boundary

Foam and VS Code own general notes and editing. LifeLoop retains task semantics, SourceHandle
validation, capture/process, operational views, Review/freeze, SB-compatible Lua/object queries and Apple
bridge. No standalone PKM fallback, Foam private API dependency or new rename/navigation platform.
Official SB example features are retained by default unless LifeLoop's task contract or a
verified Foam/VS Code replacement covers them, or a concrete cost assessment justifies deferral.
Trial absence does not justify deletion. Full platform parity is not a goal, but multi-character
task states are explicitly in scope. Preserve exact task semantics and mutation/ownership safety.
`RETAINED-SB-SCOPE.md` records this latest scope; older goal wording does not override it.
Read `plans/2026-09-08-foam-boundary.md`, `FOAM.md`, and `REVIEW-foam.md` for current decisions.

## Implemented

- Removed generic link/completion/reference providers, ordinary link diagnostics, Backlinks UI,
  slash/template/picker/page-decoration entry points and duplicate embed expansion.
- Added current-page Linked Tasks using inherited task links and the existing completion command.
- Added guarded Capture Here, continuous Inbox processing, a unified Task Actions picker and native Peek Source.
- Added factual Today/Linked Tasks reasons plus lightweight reminder/event decorations and safe hover actions.
- Removed the remaining direct Inbox/Notes writes; delayed UI and bridge writes now carry guarded source receipts.
- Corrected shared task receipt generation: label and receipt match the indexed object, then mutation
  verifies live source. Exact JSON SQL guard handles another connection updating the shared index.
- Fixed shared anchor identity resolution by reusing SB parsed NamedAnchor nodes, avoiding prefix
  matches and code/escaped examples.
- Replaced conflicting SB DocumentLink with explicit `lifeloop.openSbRef`; ordinary clicks belong to
  Foam and may create a page named `page@anchor`, so users must use the explicit command for SB refs.
- Added Foam recommendation, migration instructions and isolated real-host coexistence tests.
- Kept Review template helpers; no automatic template/anchor conversion or script API expansion.
- Covered test fixture setup with cleanup even when Foam path validation fails.

## Later cleanup

Removed unused saved views, core page-decoration/slash helpers, non-Review template branches,
TypeScript page promotion and CLI search (FTS body retained). Today focuses its tree; X-Ray uses
JSON; default Alt-arrow subtree bindings are removed. Replaced Lua output's manual Markdown parser
with the host renderer without deleting Lua APIs. CRLF anchor and task-tree offsets now map to unchanged source positions. Indexed refs remain
SB-normalized; tree mutation receipts use original-text numeric refs. Cursor commands are unchanged.
Latest cleanup checks below passed; final Upcoming correction read-back found no additional issues.

## Current checks

- `npm run verify` with SilverBullet Desktop connected: typecheck/vendor/schema pass; 634 tests pass with no skips.
- Live SilverBullet 2.10.0: 3/3 conformance checks pass against isolated `tmp/test_space`.
- Task-only VS Code 1.136.1: 16 passed, 8 Foam tests skipped; Foam absence explicitly asserted.
- VS Code 1.136.1 + Foam 0.44.6: 23 passed, 1 known folder-rename gate skipped.
- Folder rename was tested and failed navigation after rewrite. Reproduce using
  `LIFELOOP_TEST_FOLDER_RENAME=1` with `npm run test:foam`; do not claim folder rename compatibility.
- Sandbox initially prevented Electron and tsx IPC startup; isolated host runs passed supported gates.
- Final Upcoming correction read-back completed; do not call the whole migration CLEAN.

## Explicit limitations

SB refs rename and folder rename are unqualified; inspect/repair with host tools. Graph interaction,
saved Smart Folder UI and advanced Foam query combinations were not exercised end to end. The fixture gate does
not certify full SB/Foam equivalence. Foam owns nested embed rendering and its own JS permissions.
No packaging/install/commit is required automatically. Preserve all tracked and untracked work.

## Recovery

The original handoff snapshot `/Users/tao/.codex/recovery/lifeloop/20260908T161050Z/manifest.json`
was read back and all 295 file digests verified before this continuation. Updated consolidated
snapshots and validation logs are stored in the same durable recovery parent; inspect the newest
manifest for the exact file inventory, deletion list and hashes. They are NON_NORMATIVE_UNREVIEWED
recovery copies, not a normative reviewed baseline or substitute for a user-authorized commit.

The P0–P3 source/package snapshot is
`/Users/tao/.codex/recovery/lifeloop/20260908T215349Z/manifest.json`; its manifest SHA256 is
`09d54a5dce8db899950e5a709006f06808d778537441875f4b2f65325d7a5563`.

## State-policy review resolution

Both independent review rounds completed; all reported policy and event-race counterexamples were fixed together.
Policy transitions invalidate certification before batched writes, publish a candidate only after
the full rebuild and source recheck succeed, serialize workspace indexing, and require every deferred
dirty document to be accounted for. Uncertified single-page touches force a full rebuild. File deletion
uses the same serial index path. Configuration changes, declaration deletion and dirty declarations have
real-host regressions. CLI indexing and the Apple bridge accept
the same ordered policy. Converted Foam templates are now validated, and the daily template passes
through Foam itself. The final VSIX was rebuilt from the qualified source and passed packaged
task-only and Foam 0.44.6 host tests; exact artifact evidence is in `PACKAGE-EVIDENCE.json`.
