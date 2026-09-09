# LifeLoop design contract

> **2026-09-08 scope revision — current VS Code contract:**
> [Foam / LifeLoop ownership](docs/plans/2026-09-08-foam-boundary.md) supersedes the
> general PKM implementation assignments below. Foam owns ordinary note navigation,
> links, tags, graph, templates, daily notes and embeds. LifeLoop owns task semantics,
> source-verified mutations, Linked Tasks, Review and Apple interoperability.
> No complete SilverBullet UI/runtime compatibility is promised. The original phase
> descriptions below are historical where they conflict with this revision.


What this file is for: the questions that would otherwise get re-argued every time someone
proposes a feature. Scope moves; this should still be true when it has.

It answers three things — who owns which fact, what the code may and may not do to your Markdown,
and what has to be true before anything new enters the core.

## Principles

* **Compose a native primitive before writing one.** SilverBullet's index, links, tags and
  templates already answer most of this. Space Lua *enhances* SilverBullet; it does not take it
  over — no global tag hooks, no key bindings claimed, nothing of yours overwritten. What it does
  add on load, the two action buttons, appends rather than replaces and switches off with one key.
* **Markdown is the canonical state.** Everything else is a view of it.
* **Context is metadata.** LifeLoop must not ask for explicit metadata when the surrounding
  structure already gives an unambiguous answer. A task on a project page belongs to that
  project; writing `[[This Project]]` on it again is a tax, not information.
* **Historical facts are recorded, never reconstructed.** They may come only from an authoritative
  event or an explicit user action.
* **Derived state is not persisted.** If it can be computed, compute it.

## Information ownership

One fact, one owner. When a fact could plausibly live in three places, this table decides.

| | owns |
|---|---|
| **Journal** | what happened — observations, chronology, meeting and log context |
| **Project** | current durable state — intended outcome, current understanding, decisions that stick |
| **Task** | an actionable commitment, and its own lifecycle facts (`deadline`, `scheduled`, `completed`) |
| **Inbox** | pending captured input, and nothing else |
| **Projection** | nothing. Today, Projects, Upcoming and signals derive; they never store |
| **Review** | human judgement, plus — once frozen — a historical snapshot |
| **Apple Reminders** | action execution: reminding, repeating, location, the notification itself |
| **Calendar** | time execution: an actual interval, its length, who is in it |
| **External systems** | execution generally: alarms, notifications, recurrence scheduling, calendar events |
| **AI** | no canonical fact. It interprets and suggests; anything it writes goes through a constrained, named mutation |

So "the recovery matrix assumption turned out to be wrong" is a journal entry; the project page's
account of where things stand gets updated; a new verification becomes a task. The same sentence
is not copied into all three.

Note that a task owns its own completion date. "What happened" belonging to the Journal does not
make the Journal the place to record that a checkbox was ticked.

Two lines in that table are easy to blur, and blurring them is how a notes app grows a scheduler.
**A deadline is not a time allocation.** `[deadline: "2026-09-10"]` says when something matters; it
says nothing about which hours are spent on it. LifeLoop owns the first and never infers the second,
which is why projecting a task outward always asks for the time rather than assuming one.

**And a LifeLoop task is a one-shot commitment.** A recurring commitment — pay the rent, file the
return — is durable context belonging to a project or area page, and its occurrences belong to
whatever is actually reminding you. One checkbox cannot be both: tick it and it claims a recurring
obligation is finished, leave it open and every view carries a permanently inaccurate outstanding
task. So there is no `[repeat:]`, nothing here generates a next occurrence, and the corollary is
stated rather than left to be discovered — **occurrences completed in an external executor are not
part of LifeLoop's completion history.** Completed means what LifeLoop recorded.

Ownership is not the same as physical location. A processed item stays on the Inbox page under
`## Processed`, but the Inbox no longer owns it — what is kept there is capture history, and the
item's meaning now lives wherever processing sent it. What the Inbox owns is exactly what is
still pending.

## Persisted or derived

| persisted | derived |
|---|---|
| `status: paused` — an explicit human decision | Today membership |
| `deadline`, `scheduled` — stated intent | overdue, due-today, staleness |
| `completed: 2026-09-03` — a historical event, and a frozen review's snapshot | project task counts |
| `frozen: 2026-09-06` — a historical event | project health signals (P3) |
| `reminder:`, `event:` — the identity of something projected outward | whether that thing still exists |
| the text you wrote | every dashboard on every page |

`stale: true`, `today: true` and `health: warning` are all category errors: each is a view's
opinion, and writing it down means maintaining it forever.

## The operational task universe

SilverBullet does not skip indexing HTML comments — it indexes them and marks them
`inComment`. A commented-out task is still a task object, so LifeLoop has to exclude it
deliberately. That is source semantics, not a query optimisation, and it happens in exactly one
place rather than in each view:

```
all indexed tasks
    ↓ not inComment          lifeloop.tasks.universe()   -- what LifeLoop can see
    ↓ not done               lifeloop.tasks.open()       -- what is outstanding
    ↓ not #waiting/#someday  (P2)                      -- what you could act on now
```

Today, project counts and the Weekly Review derive from these today; Upcoming, signals and the
audit must do the same when they arrive. No view invents its own filter.

**Links need the same exclusion, and cannot get it the same way.** A commented-out link is not a
mention — parking a thought in `<!-- -->` has to mean the project stops hearing about it, or the
comment is not a park. But an indexed *link* carries no `inComment` flag the way a task does, so
`lifeloop.journal.mentions` finds the comment spans in the page text and tests each link's position
against them. Same semantics, second implementation, because the index offers no first one. If a
future SilverBullet marks links the way it marks tasks, that code collapses into a `where` clause.

## Mutation contracts

Six things in LifeLoop write to your notes. Each has a rule, and each rule has a test asserting
that the failure case does nothing at all. (A sixth is trivial: `LifeLoop: Setup` and
`LifeLoop: Open Inbox` create the Inbox page when it does not exist, and never touch it when it
does.)

**Capturing.** A captured line is inserted above the `## Processed` heading, or appended when
there is none. New input never lands in the pile that has already been dealt with — the boundary
between pending and processed is a position in the file, so writing to the wrong side of it would
silently mark something done.

**Ticking a task.** `task.ref` is an identity, not a location — a page with an anchor replaces
`page@pos` with the anchor name, so it must never be assumed to be a position. Tell the two forms
apart, resolve to a live page and offset, verify the marker there holds the state the event
announced, then write. A source that cannot be confirmed is left alone; it never fuzzy-matches its
way to a guess.

That verification has a stated ceiling. The event names a ref and two states and does not carry
the task's text, so nothing can distinguish the task that was ticked from a different task now
sitting at the same ref in the same state. The guarantee is exactly as strong as the write being
reacted to — which the host made after checking the old state at that same position — and no
stronger. Matching on text the index may already have replaced would only look like more
certainty.

**Processing an inbox item.** The unit is the whole top-level list item, nested children
included. It moves entirely or not at all, and an item that no longer matches what was listed is
left alone.

**Promoting a quick note.** The destination is the user's, never inferred from a folder
convention. Cancel or collide and nothing is written — a failed processing step is a no-op, never
a half-processed state.

**Attaching a page to a task.** The destination is the user's, never inferred from a folder. Every
precondition — a task, a name, a name not taken, a source line that still matches — is checked
before anything is written. Past that the destination is created first, since a failure then leaves
a page to delete rather than a task to lose; and the compensating delete fires **only** if that page
is still byte-identical to what was just written. A page something else has touched is left alone
and named. The task itself stays an ordinary checkbox and gains a link — attaching adds a page, it
does not convert a task into another kind of thing.

**Freezing a review.** Validate that nothing is frozen yet, that the week frontmatter is intact,
and that at least one live section exists; render every section found, build the whole new page,
write once. Any failure leaves the page untouched rather than half-frozen. It freezes what the
page has rather than a fixed list — the template's sections grow over time, and requiring today's
exact set would strand every review written against an older one. The markers are the live
`${lifeloop.review.*()}` expressions themselves — self-erasing, so a second freeze is byte-for-byte
identical. (HTML comments would not work as markers: SilverBullet renders them as visible
content.)

**Anything composite.** An action that is several of the above — create a project, link to it, and
mark the source processed — checks every precondition before performing any of them. A cancel, a
collision or a stale source at step three must leave the entry exactly as pending as it was at
step one. Partial completion is the one outcome no mutation may produce.

## Load order

Space Lua sorts same-priority blocks by their `page@offset` **string**, so `@11161` sorts before
`@2398`. A block that assumes an earlier block on the same page already ran works fine until that
page grows past ten thousand bytes, and then stops loading with no error anyone will see.

So **every block declares the namespaces it writes to** — `lifeloop = lifeloop or {}` and
`lifeloop.tasks = lifeloop.tasks or {}` at the top, in each block, not once per file. The suite
asserts the whole public surface exists, because a block that quietly failed to load looks
exactly like a feature nobody wrote.

## Admission rules

A capability enters the core only if all of these hold:

1. It is needed often enough to justify permanent complexity.
2. Its ongoing user-facing maintenance cost is low. A one-off 500 lines of Lua is cheap; three
   extra fields on every task forever is not.
3. It does not persist what canonical state can cheaply yield. Being derivable is not a
   disqualification — Today is core precisely because it is derived. Storing the answer is.
4. It preserves plain-Markdown portability.
5. Its semantics are deterministic.
6. It composes an existing SilverBullet primitive where one exists.
7. No external system is the structurally better owner.

Three outcomes, not one: **core** for high-frequency, low-tax, deterministic, native-fitting
capabilities; **experiment** where the value could be high but the evidence, interaction or API
is uncertain — with an abandonment criterion written before any code; **external or opt-in** for
low frequency, high metadata tax, or a clearly better owner elsewhere.

When something outside the core turns out to be needed, escalate in this order and stop at the
first that works: an existing SilverBullet primitive → a small Space Lua extension → projecting
into an external system that already owns the execution → a custom implementation here → a plug.
"Later" does not mean "we will build it here eventually".

## Reserved, not built

These constraints cost nothing today and are expensive to retrofit. They exist so the questions
below can be answered later without unpicking the core.

**Projection independence.** Physical library pages are the current host for Today and Projects,
not part of what those views mean. Projection logic lives in `lifeloop.views.*`, returns Markdown,
and knows nothing about where it is displayed. The one thing a host must provide is Markdown
rendering, since that is what keeps a projected checkbox writing back to its source.

**Projection identity.** Every actionable row a projection renders carries an opaque handle to its
canonical source. Presentation is never identity: display text, sort order, grouping and position
in the view may not be used to work out what a row points at. Before a write, the source is
re-resolved from that handle and checked against the state the projection recorded when it rendered
the row; a stale, moved or ambiguous source produces no write.

This is stated here rather than in a view, because it binds every surface that could exist later —
Today and Upcoming now, and a table, a card, a board or a tool result if any of those is ever built.
A view that has to reconstruct which task a click meant has already lost.

Note how this sits against the ceiling above, because the two look contradictory and are not. There,
reacting to a host event, the only text available came from the index and may already have been
replaced — matching on it buys false confidence, so the guarantee stops at what the event asserts.
Here the projection takes its row and receipt from the same indexed source version; comparing
that receipt against the live source detects that the source moved underneath. Identity comes
from the ref in both cases. The recorded state is only ever a staleness check, never a way to find
a task.

**Action representation.** Inline tasks are the canonical default. Richer task entities may exist
one day for work that accumulates durable state — notes, artifacts, dependencies, participants,
execution history, results. Ordinary tasks must pay nothing for that possibility: no ids, no
parent pointers, no status fields added in advance.

**Execution ownership.** LifeLoop owns what an action means and when it matters. It does not
automatically own exact-time alarms, push notifications, recurrence scheduling, calendar blocking
or location reminders.

## Backlog — recorded, not scheduled

These are written down so the constraints above have something concrete to protect, and so that
picking one up later starts from a hypothesis rather than an argument. One has since graduated and
says so in place, including which of its own constraints was overruled and why — an entry that
quietly changed its mind would be worth less than no entry. Each needs a success criterion and an
abandonment criterion before any code, and graduating means demonstrating clear user value at no
more complexity than what it replaces.

An experiment that has neither graduated nor been abandoned is **flagged, not deleted**. The
standing state of every experiment is visible — in `ROADMAP.md` as 🧪, and where an experiment adds
a command, in the command itself — and an aging one is raised for a decision rather than removed by
one. A permanently half-supported feature is still worse than the gap it was meant to close, and
that is exactly why the judgement belongs to a person: the criterion says what to look at, not what
to do about it. Nothing here removes a feature you are using because a rule said its time was up.

**A virtual-page backend for the projections.** The `lifeloop.views.*` split already makes this a
swap rather than a rewrite. Worth doing only if the interaction turns out at least as good as a
physical page.

**A stored reference to a projected reminder or event. — GRADUATED 2026-09-06, and it did land on
the task line.** The trigger this entry asked for arrived as stated: real use produced "I projected
this twice, now there are two of them." So `Add Reminder` and `Add to Calendar` now write
`[reminder: "<id>"]` / `[event: "<uid>"]`, and the id comes out of what `make new …` already
returned rather than from a second read, so the create is still the last fallible thing that
happens.

The constraint this entry set — *it must not land on the task line* — was **overruled, not
forgotten**, and the reasoning is recorded here because the alternative was worse:

* The objection it protects against is noise on the line you read every day. That is answered at the
  rendering layer instead: a `space-style` block collapses the attribute to 🔔 / 📅, and the
  decoration is skipped while the cursor is inside it, so the id is one keystroke from visible.
  Quiet by default, never hidden — a mark you cannot inspect would be worse than no mark.
* The only place it could otherwise live is a side table keyed by task, which is the database this
  whole design exists to avoid: it would have to be kept in step with every rename, move and delete
  of a task that Markdown gives us for free.
* The shape was already precedented. `[completed:]` puts a fact about a task on the task's line, and
  removes it when it stops being true. This is the same move.

**What the mark costs, stated rather than discovered.** `[completed:]` can be kept true by
construction, because the fact it records lives in the note. A reminder does not: the other
application can delete it without telling anyone, so a stored id is a claim that can go stale. The
answer is never to trust it on sight — every run asks the owner first, and a reminder that has been
deleted over there has its mark erased rather than resurrected.

External applications may expose a divergence, but LifeLoop's VS Code command is the sole conflict
resolution control plane. A three-way title baseline distinguishes one-sided edits from concurrent
edits. Concurrent edits keep the binding, preserve both values and pause writes. Resolve offers the
current Markdown or Apple value (or an explicit detach), then rereads both sides and refuses if
either changed after the choice was shown. There is no second resolver in Notes, Reminders or
Calendar and no automatic merge engine.

**Reading a completed reminder back into LifeLoop.** This is implemented through the same guarded
task mutation API as editor actions. Recurring reminders remain quarantined from ordinary
complete/reopen reconciliation because one repeating commitment is not one LifeLoop checkbox.

**Calendar state flowing back into task state is rejected, not deferred.** An elapsed event is not a
completed task: a 9–11 block for "Deep Work: Paper" ending at 11 says nothing about the paper.
Reminder completion is an action-lifecycle event; a calendar block elapsing is not.
