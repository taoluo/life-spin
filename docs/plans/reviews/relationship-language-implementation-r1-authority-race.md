# Relationship language implementation R1 — authority, race, and recovery review

Verdict: **CHANGES REQUIRED** — three P1 findings and one P2 finding. The full assigned
scope was completed after the first P1; this is not a sampled review or a CLEAN result.

Reviewer: independent `gpt-6-astra`, `xhigh` reasoning, as confirmed by the dispatching
agent. Review date: 2026-09-09. No frozen production or test source was edited, and no
commit was created. Ponytail review principles were applied: preserve the committed
contract, reuse existing checks, and prefer removing unsafe continuation over adding
coordination or recovery machinery.

## Frozen evidence

- Implementation ref: `refs/codex/recovery/relationship-language-implementation-r1-20260909`.
- Implementation commit: `c0c2d9164b8ae34641f1848f2dcd12d846da8041`.
- Implementation tree: `755b79722b05fd4d598765b954a33326a58f4b74`.
- Binary diff SHA-256, from manifest base `dbd6fd56fffa225d108b76b57ea4f68d23a06b41`:
  `e2b25694432a5c75bed8a711336b98b2d7699abb470ed890430a291e58e3737a`.
- Reviewed design ref: `refs/codex/recovery/relationship-language-design-reviewed-20260909`,
  commit `c58d1298a18caca24e28f379f7dc1da9911ac3d8`.
- Reviewed design file: `docs/plans/2026-09-09-relationship-language-features.md`, SHA-256
  `8e08bcefd171dace55c2fc545bf7abe57f9c88040d398fa4b6c3523597fafd21`.

The implementation manifest at
`docs/plans/2026-09-09-relationship-language-implementation.review.json` is a separate
review receipt, not a member of the implementation commit. Its ref, commit, tree,
binary-diff digest, and every one of its 40 artifact SHA-256/line-count/byte-count
entries were independently checked against Git blobs; all match. Production, tests,
scripts, and vendor files on disk were compared with the frozen implementation before
running the focused suite and again before writing this report; no differences existed.
The parent's temporary `node_modules` symlink is test infrastructure, not frozen source.

## Completed scope and verification

Inspected the changed production paths for task handles and callers, Log Interaction,
Brief and Calendar exact reads, external binding compensation, mutation application
and reconciliation, live-buffer vault access, index freshness, diagnostics and their
fix command, code actions, definitions, hover, symbols, query fences/completion/results,
temporary links, tree receipts, core relationship validation, CLI and Lua adapter changes,
and extension registration/events. Relevant unchanged dependency closure was followed
through `resolveHandle`/`resolveRef`, task mutations, `NodeVault`/`MemoryVault`, Calendar
and Reminder binding/Sync/Resolve callers, and the AppleScript runner/record parser.

The review checked malformed and stale receipts, CRLF/numeric/anchor identity,
prompt and capability/read boundaries, direct versus inherited People, dirty read
authority versus write targets, final expected sources, response loss, partial writes,
rollback interference, external cleanup, and output trust/navigation boundaries.
The associated focused tests and their missing boundary cases were inspected.

Independent execution: 11 existing test files, **141 tests passed**, using
`vitest run --configLoader runner` for core mutation/relationship mutation tests,
Calendar exact-read/binding/sync and Reminder sync tests, and VS Code command, Brief,
binding, language-feature, and view tests. These passing checks do not cover the four
counterexamples below. The counterexamples were additionally executed directly from
the frozen Git blobs, transpiled in memory with the installed esbuild. Only unrelated
dependencies were stubbed; the implicated implementations and existing VS Code mock
were used unchanged. Reproductions wrote no source files and contacted no Apple apps.

Packaged VS Code/Foam runs and a real Apple smoke were not independently rerun in this
review. The manifest's recorded packaged results were not promoted into new evidence.

## Findings

### AR-1 — P1: live-buffer equality is reported as durable write success

Location: `packages/semantic-core/src/mutation.ts:146-155`, with
`packages/vscode/src/workspace.ts:37-39,54-73`.

Concrete counterexample: an open, initially clean Journal contains `before` on disk
and in the buffer. `WorkspaceVault.write` applies the intended `after` text to the
buffer, then `TextDocument.save()` returns false or throws. `apply` catches that
failure, calls the live-buffer-aware `vault.read`, sees `after`, and returns `ok: true`.
The buffer is still dirty and the durable Journal still contains `before`. Closing
without saving loses an interaction that the command reported as logged. The same
false success can establish an external binding or advance a Sync observation while
its Markdown binding/title was never saved.

Executed outcome using the actual frozen `WorkspaceVault` and `apply`:

```text
save() => false
apply() => { ok: true, changed: ["W.md"] }
buffer => "after"; isDirty => true
```

Violated invariant: the reviewed design permits all-after success only when durable
save is confirmed. Live buffers are read authority, not proof of persisted effects;
unconfirmed write outcomes must remain UNKNOWN and must not drive success-dependent
effects.

Minimal correct fix: remove the unconditional all-after success promotion. Return
UNKNOWN whenever save/durable state cannot be established; where success is retained,
require authoritative after-contents and confirmed durable save. Reuse the existing
live-versus-disk distinction rather than adding a journal or retry mechanism. Do not
retry the write merely to make the result certain.

Affected surfaces/tests: all `apply`/`applied` callers using `WorkspaceVault`, especially
Log Interaction, Calendar/Reminder binding, and Sync observation updates. Add one
open-document regression with successful edit plus failed save that checks result,
dirty state, durable bytes, no success message, and no success-dependent observation.
Keep the existing MemoryVault applied-then-response-loss case, but do not generalize
its durability semantics to the editor adapter.

Resolution class: **remove unsafe optimism; reuse authoritative adapter evidence**.

### AR-2 — P1: serial rollback overwrites an intervening third-state edit

Location: `packages/semantic-core/src/mutation.ts:153-169`.

Concrete counterexample: a three-file ChangeSet writes A and B, then C's write fails
before changing C. The single `observed` read records A=after, B=after, C=before. During
the awaited rollback of B, another writer changes A to a third value. The loop then
uses the old `observed` entry for A, writes A's before-value over the concurrent edit,
and the final reread reports a verified rollback. The previous implementation reread
each step before compensation; this patch removed that check.

Executed outcome from the frozen `apply`:

```text
writes: A-after, B-after, C-after(fails), B-before(await)
concurrent writer: A = A-CONCURRENT-USER-EDIT
next rollback write: A-before
result: unknown; "verified rollback restored the prior contents"
terminal A: A-before; concurrent user edit lost
```

Violated invariant: rollback may undo only an effect whose current ownership is still
proved. Third-state or uncertain resources must be preserved, and every serial recovery
step must recheck its authority before overwriting. A terminal equality check cannot
recover a concurrent edit already destroyed by compensation.

Minimal correct fix: reuse a fresh whole-file comparison immediately before each
rollback effect and stop compensating the affected path if it has become a third or
unreadable state. Preserve it and return UNKNOWN. If safe conditional compensation
cannot be provided by the adapter, omit that compensation and report the partial
outcome rather than overwrite. No takeover, retry loop, or recovery-of-recovery is
needed.

Affected surfaces/tests: every multi-file ChangeSet and any async Vault implementation;
page attachment/capture composites and other existing mutation callers are in the
dependency closure. Add one deterministic promise-barrier test: fail C, suspend B's
rollback, edit A, resume, and assert A's third value survives with UNKNOWN. Also check
the final reread after a failed rollback. The existing response-loss tests use one file
and cannot expose this serial race.

Resolution class: **reuse the removed per-step check; otherwise remove compensation**.

### AR-3 — P1: date commands bypass strict task admission after their prompt

Location: `packages/vscode/src/commands.ts:425-437`, with
`packages/vscode/src/task-target.ts:92-109` and
`packages/semantic-core/src/mutation.ts:215-259,271-291`.

Concrete counterexample: Set Deadline initially admits the task at `Work@11` in
`prefixxxxx\n* [ ] unchanged\n`. While the InputBox is open, remove four characters
from the preceding line. The task now starts at `Work@7`, while the old offset 11
lands inside its unchanged line. The actual registered command passes the old handle
directly to `setTaskAttribute` after the prompt. Core `resolveHandle` accepts the line
receipt at an interior numeric position, so the deadline is written. The new
`taskTarget` would refuse the exact same handle, but is never called at that boundary.

Executed outcome using the actual frozen command registration, task target, and core
mutation, with the prompt controlling the source edit:

```text
old handle: Work@11; new task line start: Work@7
lifeloop.setDeadline => writes [deadline: "2026-09-10"]
taskTarget(lifeloop, originalHandle) => null
reindex calls: one, after the write
```

Violated invariant: the original task identity must be re-resolved after every actual
prompt result, and an old numeric ref merely landing inside the moved line must refuse.
Receipts cannot substitute for exact indexed/live identity. This is directly reachable
from the newly added command-backed task code actions.

Minimal correct fix: after each asynchronous command boundary, refresh using the
existing authority-sensitive refresh and rerun `taskTarget` on the original handle
before the effect. Reuse this admission path; do not weaken its strict comparison or
globally change handwritten numeric SB-ref semantics. Both date commands share the
same registration loop, so fix that boundary once. Check the same retained-target
pattern in Complete/Reopen after their awaited refresh, Attach Page after its prompt,
and Add Reminder/Calendar after capability/prompt boundaries. Formal Calendar
Sync/Resolve identity debt remains excluded.

Affected surfaces/tests: Set Deadline and Set Scheduled from code actions, task menus,
and cursor commands; the listed retained-handle siblings form the dependency closure.
Add a command-level prompt-barrier test with the prefix shrink and assert byte-identical
post-prompt source, plus the existing unique-anchor/CRLF success cases. Testing only
`taskTarget` before dispatch, as the current admission tests do, misses this bypass.

Resolution class: **reuse existing refresh and strict admission; no new identity layer**.

### AR-4 — P2: binding hovers emit a handle the new resolver rejects on anchored tasks

Location: `packages/vscode/src/bindings.ts:32-45,111-113`, with
`packages/vscode/src/task-target.ts:30-36,98-99`.

Concrete counterexample: the task `* [ ] task $task [event: "E1"]` has canonical
task-command identity `Work@task`. The binding hover's `actionFor` always emits
`Work@0`. Clicking its Detach action now reaches the stricter `taskTarget`, which
requires the indexed ref to equal the supplied ref and returns null. The handler
silently returns without detaching an unchanged, valid binding. Before this patch,
the supplied page/offset bypass accepted the hover action; fixing that bypass exposed
this unconverted caller.

Executed through the frozen registered hover and Detach handler:

```text
hover handle: Work@0
indexed task-command handle: Work@task
admission: null
terminal: * [ ] task $task [event: "E1"]
```

Violated invariant: unique anchored tasks remain actionable and all command producers
must use the same task identity normalization. Authority must not be restored by
reintroducing the old presentation-coordinate bypass.

Minimal correct fix: have binding actions reuse the existing task-handle capture path
(`taskTargetAt`/the common ref normalization) so they emit the anchor identity with
the same line and state receipts. Refuse unavailable identity instead of fabricating
one. Keep the strict consumer check intact.

Affected surfaces/tests: Calendar and Reminder binding hover Detach on anchored tasks.
Extend `bindings.test.ts`, which currently checks only lexical attribute extraction,
with one registered-hover-to-command case; cover unique anchored CRLF success and
duplicate/moved-stale refusal.

Resolution class: **reuse the common handle producer**.

## Preserved boundaries and explicit debt

The new Brief path performs eligibility checks before the Calendar capability probe,
seals UID/calendar/direct People, revalidates after the probe and the exact read, and
opens one complete document only for a unique found result. Missing, ambiguous, and
throwing reads do not open a partial result. It invokes no Calendar write or formal
Sync/Resolve command, and persists no conflict/observation state. The additive
`readExact` preserves duplicate UID records; the existing batch `read` and Calendar
summary-update implementation are unchanged.

The formal Calendar Sync/Resolve duplicate-UID/calendar-switch P1 remains the reviewed
out-of-scope debt. This review does not require its redesign or claim it is fixed.
AR-1 identifies a new shared mutation-result regression that can affect its Markdown
side, not a demand to expand the deferred Calendar identity work.

Task-originated Interaction refreshes the original handle and selected direct People
after its prompts, and adds task/Person/Journal before-values to the final ChangeSet.
Dirty Journals are refused before append. Dirty task/Person buffers remain read
authority. These paths retain useful checks, but their write-success claim remains
blocked by AR-1. Diagnostic fixes recheck version, expected text, range, token role,
and canonical replacement before editing; no speculative retry is introduced there.

Consolidate the four fixes, then rerun their concrete counterexamples and affected
caller closure on a new frozen digest. This R1 digest is not approved.
