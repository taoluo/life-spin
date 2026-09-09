# Foam boundary review

> Historical review log. Counts and open items below describe earlier frozen revisions.
> Current scope and evidence are in `CAPABILITY-MATRIX.md` and `RETAINED-SB-SCOPE.md`.

Status: consolidated corrections implemented and tested; final Upcoming correction read-back completed without additional findings.

Scope: uncommitted changes from `452b4cdf79b3c86e861ca51b15d2f6c2fc196ef9`.
Foam and VS Code own general notes/editing; LifeLoop owns task semantics and the execution loop.

## Findings and disposition

- **P1, task receipt mismatch:** old indexed A plus live B produced an actionable B receipt on an A row.
  Fixed in shared `taskNode`, covering Today/Upcoming/Waiting, Projects and Linked Tasks. Reuse FTS body
  and require exact task JSON in the same SQL query; missing/mismatched body has no handle. Existing
  live mutation checks remain authoritative. Five added headless tests cover pre-render source changes
  across three views, missing body and another database connection replacing the object.
- **P2, conflicting SB click:** Foam treats `page@anchor` as a placeholder and publishes create-note
  links overlapping LifeLoop's old DocumentLink. Removed LifeLoop's provider; keep only the explicit
  `lifeloop.openSbRef` command. Real host checks cover anchor/position, alias, existing @ filename,
  missing anchor, ambiguous basename and no file creation.
- **P1, anchor identity prefix:** dependency review reproduced `@anchor` matching `$anchor-long`
  and false ambiguity when both existed. Shared `resolveRef` now reuses the vendored Markdown
  parser's complete NamedAnchor nodes; code/escaped literals are not identities. Two new regression
  tests failed before the fix and pass afterwards, covering suffix characters, literals and coexistence.
  The existing exact-duplicate refusal remains. Real host checks also include prefix names.
- **P3, stale ownership prose:** updated WHY and receipt wording in design/plan; ordinary navigation,
  templates and embeddings remain Foam-owned. Review templates and object queries stay bounded.
- **Qualification failure, upstream folder rename:** Foam 0.44.6 moved the file and shortened refs,
  but definitions did not resolve the moved target. No custom rename engine added. The failing test
  is retained behind `LIFELOOP_TEST_FOLDER_RENAME=1`, visibly skipped by default, and migration docs
  explicitly withhold folder-rename qualification. SB-special-ref rename remains manual/unqualified.

- **P1, CRLF positions:** SB parsing removes CR. Map anchor offsets back to live text; for task
  tree rows using normalized index positions, refuse handles and positional navigation when body
  contains CR. Cursor actions remain available. Added wrong-preceding-task, raw-offset and
  line-ending preservation regressions. This is an explicit indexed-action parity limitation.

## Later cleanup and user corrections

User explicitly prioritized SB functionality/parity over simplification. The proposed script-usage
based Lua API pruning was rejected. Space Style, action buttons, task states, Mentions, general Lua,
widgets and event/queue/service/syntax APIs remain. No original LifeLoop Lua library or vendored
parser file is changed. Non-Lua, unconsumed UI remnants and duplicate Today rendering are removed;
Review retains creation and interpolation; the FTS body retained for receipts is not removed.
The hand-written Lua-output Markdown renderer is replaced with the existing host renderer, with
raw-HTML and recursive-fence protections retained. Final cleanup validation passed: 587 headless + 3 live-SB skips, 9 task-only + 7 Foam skips,
15 Foam coexistence + 1 explicit folder qualification skip. Final review found an Upcoming empty-state regression, now corrected and read back without additional findings.

## Review process and evidence limits

Two independent source analyses found the receipt counterexample. An independent adjudicator,
explicitly requested at xhigh effort, verified source evidence, ran the counterexample, and identified
that the CLI shares the database: path-only FTS reads would still allow a mixed-version receipt.
The exact JSON condition resolves this using existing tables. Forced reindexing, new locks and new
state were rejected as unnecessary. Repository consumer inventory found 38 LifeLoop space-lua blocks, including actual actionButton
consumers in Core.md and Space Style in External.md. This inventory is evidence, not a criterion
for deleting APIs or proof that every host operation runs. The first two agents inherited effort without a separately
exposed effort value; those reports are not claimed as certified high-effort protocol reviews.

This is an implementation review, not a whole-platform CLEAN or whole-vault compatibility claim.
Full check results and explicit skipped gates are in `plans/2026-09-08-foam-boundary.md`.

## Final Upcoming correction

The final reviewers found that focusing Today hid future-only tasks because the empty-state return
preceded Upcoming construction. Moved that check after construction; the regression test failed
before the fix and passes afterwards. The final reviewer read back this correction and its dependency
scope without additional findings; it did not rerun tests. Full headless verification passed after
the fix (587 passed, 3 skipped). The real-host runs above preceded this final view-ordering change.

## CRLF follow-up qualification

The temporary task-tree refusal is superseded: shared originalSourceOffset maps parsed anchors,
tree ranges and numeric receipt refs into the exact indexed original body. Index objects and cursor
numeric semantics are unchanged. Three view regressions now verify completion of the intended task,
navigation offset and preserved CRLF. Full verify: 587 passed, 3 live-SB skipped; typecheck/vendor/schema
passed. Final reviewer read back the change and dependency paths without findings (did not rerun tests).
This does not certify every consumer of normalized index positions.
