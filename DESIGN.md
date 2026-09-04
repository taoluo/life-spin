# LifeOS design contract

What this file is for: the questions that would otherwise get re-argued every time someone
proposes a feature. Scope moves; this should still be true when it has.

It answers three things — who owns which fact, what the code may and may not do to your Markdown,
and what has to be true before anything new enters the core.

## Principles

* **Compose a native primitive before writing one.** SilverBullet's index, links, tags and
  templates already answer most of this. Space Lua *enhances* SilverBullet; it does not take it
  over — no global tag hooks, no key bindings claimed, no configuration changed on load.
* **Markdown is the canonical state.** Everything else is a view of it.
* **Context is metadata.** LifeOS must not ask for explicit metadata when the surrounding
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
| **External systems** | execution: alarms, notifications, recurrence scheduling, calendar events |
| **AI** | no canonical fact. It interprets and suggests; anything it writes goes through a constrained, named mutation |

So "the recovery matrix assumption turned out to be wrong" is a journal entry; the project page's
account of where things stand gets updated; a new verification becomes a task. The same sentence
is not copied into all three.

Note that a task owns its own completion date. "What happened" belonging to the Journal does not
make the Journal the place to record that a checkbox was ticked.

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
| the text you wrote | every dashboard on every page |

`stale: true`, `today: true` and `health: warning` are all category errors: each is a view's
opinion, and writing it down means maintaining it forever.

## The operational task universe

SilverBullet does not skip indexing HTML comments — it indexes them and marks them
`inComment`. A commented-out task is still a task object, so LifeOS has to exclude it
deliberately. That is source semantics, not a query optimisation, and it happens in exactly one
place rather than in each view:

```
all indexed tasks
    ↓ not inComment          lifeos.tasks.universe()   -- what LifeOS can see
    ↓ not done               lifeos.tasks.open()       -- what is outstanding
    ↓ not #waiting/#someday  (P2)                      -- what you could act on now
```

Today, project counts and the Weekly Review derive from these today; Upcoming, signals and the
audit must do the same when they arrive. No view invents its own filter.

## Mutation contracts

Five things in LifeOS write to your notes. Each has a rule, and each rule has a test asserting
that the failure case does nothing at all. (A sixth is trivial: `LifeOS: Setup` and
`LifeOS: Open Inbox` create the Inbox page when it does not exist, and never touch it when it
does.)

**Capturing.** A captured line is inserted above the `## Processed` heading, or appended when
there is none. New input never lands in the pile that has already been dealt with — the boundary
between pending and processed is a position in the file, so writing to the wrong side of it would
silently mark something done.

**Ticking a task.** `task.ref` is an identity, not a location — a page with an anchor replaces
`page@pos` with the anchor name, so it must never be parsed as a position. Resolve to a live
`page` + range, verify the state text is still what was expected, then write. A stale source
fails and refreshes; it never fuzzy-matches its way to a guess.

**Processing an inbox item.** The unit is the whole top-level list item, nested children
included. It moves entirely or not at all, and an item that no longer matches what was listed is
left alone.

**Promoting a quick note.** The destination is the user's, never inferred from a folder
convention. Cancel or collide and nothing is written — a failed processing step is a no-op, never
a half-processed state.

**Freezing a review.** Validate that nothing is frozen yet, that the week frontmatter is intact,
and that at least one live section exists; render every section found, build the whole new page,
write once. Any failure leaves the page untouched rather than half-frozen. It freezes what the
page has rather than a fixed list — the template's sections grow over time, and requiring today's
exact set would strand every review written against an older one. The markers are the live
`${lifeos.review.*()}` expressions themselves — self-erasing, so a second freeze is byte-for-byte
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

So **every block declares the namespaces it writes to** — `lifeos = lifeos or {}` and
`lifeos.tasks = lifeos.tasks or {}` at the top, in each block, not once per file. The suite
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
not part of what those views mean. Projection logic lives in `lifeos.views.*`, returns Markdown,
and knows nothing about where it is displayed. The one thing a host must provide is Markdown
rendering, since that is what keeps a projected checkbox writing back to its source.

**Action representation.** Inline tasks are the canonical default. Richer task entities may exist
one day for work that accumulates durable state — notes, artifacts, dependencies, participants,
execution history, results. Ordinary tasks must pay nothing for that possibility: no ids, no
parent pointers, no status fields added in advance.

**Execution ownership.** LifeOS owns what an action means and when it matters. It does not
automatically own exact-time alarms, push notifications, recurrence scheduling, calendar blocking
or location reminders.

## Backlog — recorded, not scheduled

None of these is being built. They are written down so the constraints above have something
concrete to protect, and so that picking one up later starts from a hypothesis rather than an
argument. Each needs a success criterion and an abandonment criterion before any code, and
graduating means demonstrating clear user value at no more complexity than what it replaces. An
experiment that neither graduates nor is abandoned gets deleted — a permanently half-supported
feature is worse than the gap it was meant to close.

**Source-aware completion from Today.** Today is the primary execution surface, and ticking a
task there records no date, which weakens the link to the review's Completed section. The idea:
render the projection ourselves and, on click, resolve the source, verify, and write state and
timestamp together. Abandon if it reads or behaves worse than `templates.taskItem`. Until then
completion is best-effort and says so.

**Recent journal mentions on a project page.** The chronological bridge from the Journal's events
to a project's current state. Note first that SilverBullet's built-in Linked Mentions view
already shows every page linking here, with snippets, docked and on by default — the
LifeOS-specific delta is only filtering to journal pages and ordering by date. Name it for what
the evidence supports: a journal page mentioned this project, not "project activity".

**A virtual-page backend for the projections.** The `lifeos.views.*` split already makes this a
swap rather than a rewrite. Worth doing only if the interaction turns out at least as good as a
physical page.

**Task-to-entity promotion.** Wait for real cases to say what an entity would need.

**An adapter into whatever owns reminders.** Project LifeOS dates outward rather than growing a
scheduler here.
