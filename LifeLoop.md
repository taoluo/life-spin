---
name: Library/LifeLoop
tags: meta/library
description: Capture what matters, act with context, and get the big picture back every week.
files:
- LifeLoop/Core.md
- LifeLoop/Tasks.md
- LifeLoop/Capture.md
- LifeLoop/Completion.md
- LifeLoop/Review.md
- LifeLoop/Inbox.md
- LifeLoop/Lifecycle.md
- LifeLoop/Signals.md
- LifeLoop/Audit.md
- LifeLoop/Views.md
- LifeLoop/External.md
- LifeLoop/Journal.md
- LifeLoop/Promote.md
- LifeLoop/Pages/Today.md
- LifeLoop/Pages/Upcoming.md
- LifeLoop/Pages/Projects.md
- LifeLoop/Pages/Audit.md
- LifeLoop/Page Templates/Project.md
- LifeLoop/Page Templates/Area.md
- LifeLoop/Page Templates/Person.md
- LifeLoop/Page Templates/Daily.md
- LifeLoop/Page Templates/Weekly Review.md
---

**Capture without stopping what you are doing. Keep every task with the work it belongs to. See
what actually matters today. Get the whole picture back every week.**

Closing that loop is the whole point:

    capture → context → act → today → done → review ↺

LifeLoop is a small layer over the SilverBullet you already have. It adds no database, no task
engine, and no page format of its own: your notes stay ordinary Markdown, tasks stay ordinary
checkboxes, and every view is a query you could have written yourself.

```markdown
# RS Recovery

Need to validate arbitrary survivor recovery.

* [ ] Benchmark recovery [deadline: "2026-09-08"]

Discuss with [[Jiulong]].
```

That is the whole data model on screen. Everything below is the loop around it.

# What it gives you

| | |
|---|---|
| `LifeLoop: Capture` | One line, into the Inbox, without leaving what you were doing |
| `LifeLoop: Today` | Overdue, due today, scheduled — as a projection, never as copies |
| `LifeLoop: Upcoming` | The next two weeks, day by day |
| `LifeLoop: Projects` | Active projects and how much is actually open on each |
| `LifeLoop: Weekly Review` | This week's page: facts queried, judgement written by you |
| `LifeLoop: Freeze Review` | Turns a finished review into a snapshot that stays true |
| `LifeLoop: Process Inbox` | Work through what you captured, one entry at a time |
| `LifeLoop: Toggle Waiting` · `LifeLoop: Toggle Someday` | Park the task under the cursor, or bring it back |
| `LifeLoop: New Project` · `LifeLoop: New Area` · `LifeLoop: New Person` | Create an entity from a template |
| `LifeLoop: Pause / Complete / Archive / Reactivate Project` | Move a project between its four states |
| `LifeLoop: Add Reminder` · `LifeLoop: Add to Calendar` | Project the selected tasks into Apple Reminders or your calendar |
| `LifeLoop: Add Reminder and Calendar` (`/project`) | Both at once, asking the date and time once |
| `LifeLoop: Sync Projected` | Push later edits to what you already projected |
| `LifeLoop: Promote Task` | Give one task a page of its own; it stays an ordinary checkbox |
| `LifeLoop: Audit` | Everything violating the LifeLoop contract, reported never fixed |
| `LifeLoop: Open Inbox` · `LifeLoop: Setup` | |

Plus `/deadline` and `/scheduled` slash commands, and a completion date recorded when you tick a
task — in the page, or in Today and any other query view.

# Getting started
1. Run `LifeLoop: Setup` — it creates the `Inbox` page and nothing else.
2. Make a project with `LifeLoop: New Project`, and write tasks on it.
3. Bind `LifeLoop: Capture` to a key (see below) and start capturing.
4. On Friday, run `LifeLoop: Weekly Review`.

# Concepts
Three entities, identified by a tag in frontmatter — **never by folder**. `Work/Q3 Launch` and
`Projects/Q3 Launch` are equally valid projects; the paths are navigation, the tag is meaning.

```yaml
---
tags: project
status: active
area: "[[Research]]"
---
```

Tasks are plain checkboxes. Two optional attributes carry all the scheduling LifeLoop knows about,
spelled the way SilverBullet's own task guide spells them:

```markdown
* [ ] Submit the paper [deadline: "2026-09-08"]
* [ ] Run the benchmark [scheduled: "2026-09-06"]
```

A task belongs to the project whose page it is written on, or to the single project it links to.
A task that names two projects belongs to neither — LifeLoop says "no owner" rather than picking
the one you happened to type first. See [[Library/LifeLoop/Tasks]].

# Configuration
Everything is optional and lives under `lifeloop` in the Configuration UI:

| key | default | |
|---|---|---|
| `lifeloop.inboxPage` | `Inbox` | where captured lines land |
| `lifeloop.captureMode` | `inbox-page` | or `quick-note`, to use SilverBullet's own Quick Note instead |
| `lifeloop.upcomingDays` | `14` | how far ahead Upcoming looks |
| `lifeloop.reviewPrefix` | `Reviews/` | page prefix for weekly reviews |
| `lifeloop.stampCompletion` | `true` | record `[completed: date]` when you tick a task |
| `lifeloop.actionButtons` | `true` | Capture and Today buttons in the action bar |
| `lifeloop.remindersList` | `Reminders` | list `Add Reminder` adds to |
| `lifeloop.calendarName` | `Calendar` | calendar `Add to Calendar` adds to |
| `lifeloop.eventMinutes` | `60` | default length of a timed event |
| `lifeloop.projectLists` | `true` | send a reminder to a list named after the task's project or area |
| `lifeloop.flagTags` | none | tags that flag a projected reminder |
| `lifeloop.priorityTags` | none | tag → Reminders priority (1–4 high, 5 medium, 6–9 low) |
| `lifeloop.autoSync` | `false` | push edits to projected tasks on a timer |
| `lifeloop.syncMinutes` | `5` | minutes between those passes |
| `lifeloop.journalMentions` | `5` | journal entries shown on a project page; `0` hides them |

## On a phone
A keyboard shortcut is no help on a phone, and finding a command through a menu costs more than the
thought you were trying to capture. So LifeLoop puts two buttons in your action bar — Capture and
Today, and nothing else. They are *appended*, so anything you have configured yourself stays
exactly where it was, and Capture stays out of the mobile overflow menu so the whole loop is one
tap:

    open → capture → leave
    open → Today → act

If you would rather have the bar untouched, turn off **Show action buttons** in the Configuration
UI, or:

```lua
config.set("lifeloop.actionButtons", false)
```

## Key bindings
LifeLoop binds no keys, because a library should not claim your keyboard. Add what you want to
your own `CONFIG` page:

```lua
command.update { name = "LifeLoop: Capture", key = "Ctrl-q c" }
command.update { name = "LifeLoop: Today", key = "Ctrl-q d" }
```

To choose your own icons or add buttons for other commands, turn `lifeloop.actionButtons` off and
write them yourself — this replaces the whole list rather than adding to it, so anything you leave
out (Home, the page picker, the command palette) is gone:

```lua
config.set("actionButtons", {
  { icon = "inbox", command = "LifeLoop: Capture", description = "Capture" },
  { icon = "calendar", command = "LifeLoop: Today", description = "Today" },
})
```

## Daily notes
LifeLoop ships a daily template — a log and somewhere to think, nothing more. To use it, point
SilverBullet's journal at it, either in the Configuration UI under Journal, or in `CONFIG`:

```lua
config.set("journal.template", "Library/LifeLoop/Page Templates/Daily")
```

Installing LifeLoop does not do this for you. Libraries should not quietly change how your journal
works.

## Optional: schema validation
LifeLoop defines a contract for its entities but does not register it globally, because
`tag.define` is a single space-wide hook and a library has no business occupying it. If you want
frontmatter autocompletion and inline linting for LifeLoop entities, put this in your own `CONFIG`
page — which is where SilverBullet wants tag definitions anyway:

```lua
tag.define {
  name = "project",
  schema = {
    type = "object",
    additionalProperties = true,
    properties = {
      status = { type = "string", enum = { "active", "paused", "completed", "archived" } },
      area = { type = "string" },
      deadline = { type = "string" },
      description = { type = "string" },
    },
  },
}

tag.define {
  name = "area",
  schema = {
    type = "object",
    additionalProperties = true,
    properties = {
      status = { type = "string", enum = { "active", "paused", "completed", "archived" } },
    },
  },
}

tag.define {
  name = "person",
  schema = {
    type = "object",
    additionalProperties = true,
    properties = {
      company = { type = "string" },
      email = { type = "string" },
    },
  },
}
```

`LifeLoop: Audit` reports the same violations without any of this.

# What LifeLoop will not do
* Copy tasks anywhere. Today and the review are projections; the task stays where you wrote it.
* Write derived state into your Markdown. Two exceptions, both of them records of something that
  happened rather than something recomputable: the completion date when you tick a task, and a
  frozen review — where you explicitly ask for the current projection to become a fixed snapshot.
* Guess. When a task names two projects, or a completion happened somewhere LifeLoop cannot see,
  it says so instead of inventing an answer.
* Take over SilverBullet. No global tag hooks, no key bindings, nothing of yours overwritten. The
  two action buttons are appended to your bar, and one config key takes them back.

One fact has one owner: the Journal records what happened, a project page records where things
stand, a task carries the commitment and its own dates, and every view derives rather than
stores. The reasoning behind that split, and the rules for what may enter the core at all, are in
the project's `DESIGN.md`.

# Pages
* [[Library/LifeLoop/Core]] — configuration, entity contract, accessors
* [[Library/LifeLoop/Tasks]] — the task universe, buckets, project attribution
* [[Library/LifeLoop/Capture]] — capture and the inbox lifecycle
* [[Library/LifeLoop/Completion]] — completion dates, and what they honestly cover
* [[Library/LifeLoop/Review]] — ISO weeks, review sections, freezing
* [[Library/LifeLoop/Inbox]] — processing what you captured
* [[Library/LifeLoop/Lifecycle]] — the four project states
* [[Library/LifeLoop/Signals]] — derived observations about active projects
* [[Library/LifeLoop/Audit]] — contract checks
* [[Library/LifeLoop/Views]] — the projections behind Today and Projects
* [[Library/LifeLoop/External]] — projecting tasks into Reminders or a calendar, and keeping them in step
* [[Library/LifeLoop/Journal]] — journal entries that mentioned a project
* [[Library/LifeLoop/Promote]] — giving one task a page of its own
* [[Library/LifeLoop/Pages/Today]] · [[Library/LifeLoop/Pages/Upcoming]] · [[Library/LifeLoop/Pages/Projects]] · [[Library/LifeLoop/Pages/Audit]]
