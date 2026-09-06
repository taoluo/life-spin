# LifeLoop roadmap

Scope, in the order it gets built. `DESIGN.md` holds the rules that outlive this file; this one is
expected to change as phases land.

Each phase has a gate, and the gate is real use rather than a checklist: everything past the first
loop is an answer to friction, and inventing the friction is how you end up rebuilding Todoist.

Phases 1 to 3 are implemented and under test. What has *not* happened yet is the part that
matters — daily use. Until that produces counterexamples, nothing here should grow.

## Phase 1 — the minimal loop ✅ implemented

> think of something → capture → find the context → do it → get the overview back weekly

* **Capture** — `LifeLoop: Capture` writes one line to the Inbox without navigating away, or hands
  over to SilverBullet's own Quick Note. Capture must cost less than filing does.
* **Project / Area / Person** — identified by a `tags:` entry in frontmatter, never by folder.
  `Work/Q3 Launch` and `Projects/Q3 Launch` are equally valid projects.
* **Tasks** — ordinary checkboxes. Two optional attributes carry all the scheduling there is:
  `[deadline: "..."]` and `[scheduled: "..."]`.
* **Today** — overdue / due today / scheduled, disjoint, a projection that stores nothing.
* **Daily note** — a log and somewhere to think. No habits, goals, metrics or dashboards.
* **Weekly Review** — live sections for what you completed, what is still open, active projects,
  what you are waiting on and the inbox, plus the reflection you write; `LifeLoop: Freeze Review`
  turns a finished review into a snapshot that stays true.
* **Completion dates** — recorded when you tick a task, wherever you tick it. See `DESIGN.md` for
  what the ref-based route can and cannot verify.

## Phase 2 — progressive actions ✅ implemented

Two action semantics that come up often enough to earn permanent complexity, plus the view that
follows from them. All optional: write nothing and nothing changes.

**`#waiting` / `#someday`.** Tags, not a `[status: ...]` attribute and not a custom task state.
Custom states via `taskState.define` would make these tasks cycle between custom states on click
and never reach done; tags are what SilverBullet's own task guide uses, `index.tasks("waiting")`
queries them natively, and the task stays an ordinary checkbox.

Classification reads inherited tags, so a parent item marked `#waiting` covers the tasks nested
under it. Toggling is the other way round: `LifeLoop: Toggle Waiting` / `Toggle Someday` add or
remove the tag **on the task's own line**, and when the state is inherited from a parent they say
so rather than pretending to remove something the line never had.

Today and Upcoming *exclude* these tasks — they are not actionable, and listing them is noise.
Today grows a Waiting section at the bottom (you do need to know who you are waiting on) and so
does the Weekly Review.

This is the missing third layer of the task universe:

```
universe()      not inComment
  → open()      not done
  → actionable()  and not #waiting/#someday    ← nothing to filter on until now
```

**Upcoming.** `LifeLoop/Pages/Upcoming.md`, the next `upcomingDays` (14) grouped by day. A task with
both dates appears **once**: grouped by `scheduled` — the day you meant to work on it — with the
deadline shown alongside, falling back to the deadline when there is no scheduled date in range. A
projection like Today.

**Priority is deliberately not part of this phase.** `[priority: high]` is already validated if
you write it, but nothing consumes it: no slash command, no sorting. Its entire payoff is ordering
*within* actionable work, and with a handful of open tasks the deadline order already does that
job. Adding it now would mean every task acquires an optional field in exchange for a marginally
better sort — which is what admission rules 1 and 2 exist to stop. Wire it up when real use shows
Today comes out in the wrong order; that is a fifteen-minute change against machinery that is
already there.

*Explicitly not in this phase:* a status machine of backlog / ready / doing / blocked / review.
That is where a task list becomes a workflow engine.

## Phase 3 — maintenance ✅ implemented

Keeping the system from rotting, not adding project management.

Build in this order: **Process Inbox → project lifecycle → derived signals → Audit.** Audit comes
last on purpose — it should validate contracts that have settled, not freeze whatever conventions
the implementation happened to adopt along the way.

**Process Inbox.** `LifeLoop: Process Inbox` walks the pending entries. Items and pages get
**different action menus** — "turn this quick note into a task" has no natural answer (create a
task pointing at it? convert its first line? move the whole note into a project?), and forcing one
generic mutation model would invent the wrong abstraction.

For a bullet on the Inbox page:

| action | behaviour |
|---|---|
| Keep | stays pending — a first-class choice, not everything belongs in PARA |
| Make task | becomes `* [ ]`, moves under `## Processed`, still a normal indexed task |
| **Link project** (default) | appends `[[Project]]` to the item, **content stays put**, moves under Processed |
| Move to project | appends to the project page and removes the original |
| Create project / person | creates the entity page and links it |
| Archive / Delete | moves to `Archive/Inbox` / removes |

For a quick note under `Inbox/`: Keep, Promote (rename out of `Inbox/`), Link project + Promote,
Create project from note, Archive, Delete.

Link is the default rather than Move: the captured wording stays where it happened — the meeting
note, the journal — and the project page aggregates it through SilverBullet's built-in Linked
Tasks and Linked Mentions. That plays to the link architecture instead of against it.

The three primitives underneath are already built and tested (whole-subtree moves, stale item
means zero writes, cancelled or colliding promotion is a no-op). What this phase adds is the flow
on top.

**Project lifecycle.** `LifeLoop: Complete / Archive / Pause / Reactivate Project`, patching
`status:` through the native `index.patchFrontmatter`. Four states only: `active | paused |
completed | archived`. No at-risk / stale / healthy / blocked — those are signals, not states.

Lifecycle is semantic and nothing else: `Archive Project` sets `status: archived` and does **not**
move or rename the page, however much the word suggests otherwise. Relocating a file is a separate
decision, and coupling it to a status would quietly reintroduce the idea that a project's identity
lives in its path.

**Derived signals.**

| signal | condition |
|---|---|
| `no actionable task` | open tasks exist, none of them actionable |
| `waiting only` | open tasks exist **and every one of them is `#waiting`** |
| `project page unchanged for 21 days` | the page's `lastModified` is older than the threshold |
| `deadline in N days` / `N overdue tasks` | |

Each signal says exactly what it measured and nothing more. `no actionable task` does not say the
project is stuck — it says nothing is actionable, which is also true of a project waiting on
someone else. `waiting only` is deliberately narrower than "not actionable": a project holding
both waiting and someday tasks has nothing actionable but is not waiting on anybody. And the third
is not called "no activity", because the only evidence is one page's timestamp while the real work
may be happening in meeting notes or the journal.

All of them are computed at query time and never written back.

**Audit.** `LifeLoop/Pages/Audit.md`, a live report that reports and never fixes. The rule: check
what LifeLoop itself promised, not whether the user is using SilverBullet the LifeLoop way.

Checks unknown project status, broken area links (missing page, or a page without an `area` tag),
and malformed `deadline` / `scheduled` / `completed` / `priority`. Deliberately does **not** check:

* unknown task attributes — `[foo: bar]` is exactly SilverBullet's hackability, and the built-in
  task schema is `additionalProperties: true`
* duplicate project names — native `index.ambiguousLinks()` answers the sharper question of which
  link actually fails to resolve
* pages under `Projects/` without a `#project` tag — demoted to an off-by-default convention hint,
  since it contradicts "path is not identity"

Validation lives in `lifeloop.*.issues()` (already implemented); the page only renders it.

## Phase 4 — execution surfaces

Answers to friction at the edges of the loop, where LifeLoop hands work to something else and gets
nothing back. Each carries a graduation and an abandonment criterion written before its code.

* **Action buttons** ✅ Capture and Today in the action bar, appended rather than substituted, one
  key to switch off. On a phone a keyboard shortcut is no help and a menu costs more than the
  thought was worth.
* **Source-aware completion** ✅ in the page, ⏳ *integration verification pending* for the ref
  route. Ticking in Today now stamps the source. The gap turned out to be
  in the host rather than here: an ordinary checkbox in a query result calls `index.updateTaskState`
  directly, and that function dispatched no event at all, so there was nothing for Space Lua to
  hear. Fixed upstream by having it announce `{ ref, oldState, newState }`; LifeLoop's existing
  listener grew a branch and no rendering changed, which is what the abandonment criterion —
  *abandon if it reads or behaves worse than `templates.taskItem`* — was there to protect.
  Driving the real path also turned up that the in-page route had never worked: the event describes
  the task as it read *before* the edit, so an equality check against the buffer never matched and
  the feature silently did nothing. Fixed, and covered now by a test that invokes SilverBullet's
  own command instead of fabricating the event.

  **The ref route was finally driven for real on 2026-09-06, and it does not work.** The host change
  had shipped long ago — `plugs/index/task.ts` emits `task:stateChange` on both paths and both
  commits are ancestors of 2.10.0 — so what this entry was waiting for had already arrived; nobody
  had come back to run it. Running it says:

  * Ticking through the real path leaves the task `[x]` but **unstamped**: the write lands, the
    stamp does not.
  * That path is not a simulation. `client/codemirror/widget_util.ts` handles a click on a task in a
    query result by calling `system.invokeFunction("index.cycleTaskStateByRef", ref, oldState)`,
    which is exactly what the check invokes.
  * LifeLoop is not the broken half. `lifeloop.completion.stampByRef` called directly stamps the
    source page correctly, and `lifeloop.tasks.locate` resolves the ref.
  * The event arrives, but **stripped**. The host dispatches `{ ref, oldState, newState }`; a
    listener in Space Lua receives a table whose only surviving field is `newState`. With no ref
    there is nothing to stamp, so the ref branch is never entered and the tick falls through.

  The gap is in the host again, one layer below last time: not a missing event, but an event that
  loses its payload crossing from a plug into Space Lua. Nothing here can work around a ref it is
  never told. **Still ⏳ — now for a reason that is written down and reproducible** rather than for
  an unrun check. Note that the suite's ref tests, which fabricate the event, stay green throughout:
  exactly the failure mode this entry existed to catch.
* **External execution** ✅ `LifeLoop: Add Reminder`, `LifeLoop: Add to Calendar`, and
  `LifeLoop: Add Reminder and Calendar` (`/project`), split by what you mean rather than by vendor:
  reminding, repeating and location belong to Apple Reminders, an actual interval belongs to a
  calendar, and the commitment stays here. The bridge is `osascript` with values passed as arguments
  rather than interpolated into the script.
  **Recurrence left the roadmap entirely** rather than being deferred: it has an owner now, and
  `DESIGN.md` records what that costs — occurrences completed over there are not in the Weekly
  Review. Still unanswered, and needing a phone rather than an argument: whether a `shortcuts://`
  URL can carry the same payload from iOS, which is what would extend this past the desktop.

  **This entry used to argue "it writes nothing, so there is no reconciliation to get wrong."** That
  argument is gone, deliberately. Projecting the same task twice produced two reminders often enough
  to meet the bar `DESIGN.md` set for spending an identifier, so a projection now leaves
  `[reminder: …]` / `[event: …]` on the task line — rendered as 🔔 / 📅 — and there *is* a
  reconciliation. It is kept narrow rather than pretended away:

  * A mark is never trusted on sight. Every run asks the other application whether that id still
    exists, and a reminder deleted over there has its mark erased instead of resurrected.
  * Direction is decided by comparing timestamps, so **an edit made in Reminders is never
    overwritten** — the note has to be the newer side for anything to be pushed.
  * Calendar exposes no modification date, so that test is impossible there and the weaker rule
    applies. Stated in `DESIGN.md` rather than smoothed over.
  * `LifeLoop: Sync Projected` does this on demand; `lifeloop.autoSync` does it on a timer, pushing
    only title, note and flags — **never the schedule**, which came from an answer you gave once and
    which nothing in the note records.

* **Structure that Reminders cannot represent** ✅ Its scripting interface has no subtask and no tag
  — checked against the dictionary, not assumed. So a project or area names the **list** (created
  the first time it is actually needed, never speculatively), tags map onto `flagged` and `priority`
  which are the fields Reminders can really sort by, and subtasks go into the note as a checklist.
  A snapshot, not a live mirror: re-run the command to bring it back in step.
* **Journal mentions** ✅ Journal entries that mentioned a project, on the project page, newest
  first. A projection over the native link index, shown as a bottom widget so it never becomes
  structure in anyone's Markdown. Ordered by the entry's own date rather than the file's
  `lastModified`, which is a fact about the file. The row claims a mention and nothing more.
* **Attaching a page to a task** 🧪 *experiment, in trial use since 2026-09-06* — `LifeLoop: Attach Page to Task` gives
  one task a page. The task stays an ordinary checkbox and gains a link; ordinary tasks pay nothing.

  **Kept deliberately, and the reason is worth recording**: when the verdict came due there was no
  evidence either way — the command had never been run in the real space, so there was nothing to
  judge. Deleting an unused experiment and keeping an unused one are equally uninformed. It is being
  used instead, which is the only thing that produces an answer.

  **What to look at, once there is something to look at:** whether the pages it creates grow
  content, or stay one near-empty file per ordinary task. Answered by looking at the space, not by a
  date and not by this file. The 🧪 stays until someone says which it was; it is a flag asking for a
  decision, not a countdown to removal.

## Phase 5 — AI assistance

Not scheduled, and deliberately last. The order matters more than the content:

```
workflow → semantics → deterministic API → AI
```

not

```
AI → arbitrary Markdown edits → a workflow emerges from whatever it did
```

An assistant that arrives before the semantics are settled *becomes* the semantics, and its
mistakes become your data. Four levels, each of which has to earn the next:

**Level 1 — read only.** What deserves attention today? Which projects have no next action? What
did I finish this week? What has not moved in a month? Summarise this project. Which of these
tasks look like duplicates? No mutation at all — and by some distance the best value for the
effort.

**Level 2 — suggestions.** Given an inbox line, propose an attachment and a conversion, and show
them as a proposal with an Apply button. It still cannot act.

**Level 3 — constrained mutation.** A named semantic API — `lifeloop.capture`, `lifeloop.createTask`,
`lifeloop.setTaskDue`, `lifeloop.createProject`, `lifeloop.completeProject`, `lifeloop.processInbox` — and
the assistant may call *only* those. Never `write_file`, `eval_lua` or `replace_any_text`. This is
what `DESIGN.md`'s "AI owns no canonical fact" cashes out to. SilverBullet's AI plug already lets
a tool declare `readOnly` and `requiresApproval`, so the enforcement point exists.

**Level 4 — maintenance.** Where an assistant is genuinely better than a query: probable duplicate
tasks, possibly stale projects, inbox items that look like they belong to an existing project,
unclear classifications. Its output must stay sorted into three piles that are never mixed — safe
deterministic fixes, AI suggestions, and human decisions.

## Phase 6 — optional power features

None of these is core, and "phase 6" is not a queue we work through. Each one has to pass the
admission rules in `DESIGN.md` on its own, and the escalation order applies first: a native
SilverBullet primitive, then a small Space Lua extension, then projecting into a system that
already owns the execution, and only then something custom here.

**Dependencies.** "A blocks B". Only once a real project needs it — and specifically *not* by
pre-emptively adding `[id]`, `[depends-on]`, `[parent]`, `[children]` to the task model.

**Monthly / quarterly / yearly reviews.** Daily and weekly are core. The rest is opt-in, because
the failure mode is generating a pile of pages you were supposed to review and never did.

**A native plug.** Everything through P3 is zero-plug. A plug earns its place only for what Space
Lua genuinely cannot reach: a persistent sidebar, drag-and-drop scheduling, special editor
behaviour, a calendar or timeline UI, reliable low-level checkbox interception, a
performance-critical background processor. Even then it stays a UI and runtime layer over the
same semantic API over Markdown — it never gets a data store of its own.
