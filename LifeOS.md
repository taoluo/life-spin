---
name: Library/LifeOS
tags: meta/library
description: A Markdown-first life OS — capture, projects, contextual tasks, today, weekly review.
files:
- LifeOS/Core.md
- LifeOS/Tasks.md
- LifeOS/Capture.md
- LifeOS/Completion.md
- LifeOS/Review.md
- LifeOS/Inbox.md
- LifeOS/Lifecycle.md
- LifeOS/Signals.md
- LifeOS/Audit.md
- LifeOS/Views.md
- LifeOS/Pages/Today.md
- LifeOS/Pages/Upcoming.md
- LifeOS/Pages/Projects.md
- LifeOS/Pages/Audit.md
- LifeOS/Page Templates/Project.md
- LifeOS/Page Templates/Area.md
- LifeOS/Page Templates/Person.md
- LifeOS/Page Templates/Daily.md
- LifeOS/Page Templates/Weekly Review.md
---

LifeOS is a small layer over the SilverBullet you already have. It adds no database, no task
engine, and no page format of its own: your notes stay ordinary Markdown, tasks stay ordinary
checkboxes, and every view is a query you could have written yourself.

```markdown
# RS Recovery

Need to validate arbitrary survivor recovery.

* [ ] Benchmark recovery [deadline: "2026-09-08"]

Discuss with [[Jiulong]].
```

That is the whole data model on screen. What LifeOS adds is the loop around it:

    capture → context → task → today → done → weekly review

# What it gives you

| | |
|---|---|
| `LifeOS: Capture` | One line, into the Inbox, without leaving what you were doing |
| `LifeOS: Today` | Overdue, due today, scheduled — as a projection, never as copies |
| `LifeOS: Upcoming` | The next two weeks, day by day |
| `LifeOS: Projects` | Active projects and how much is actually open on each |
| `LifeOS: Weekly Review` | This week's page: facts queried, judgement written by you |
| `LifeOS: Freeze Review` | Turns a finished review into a snapshot that stays true |
| `LifeOS: Process Inbox` | Work through what you captured, one entry at a time |
| `LifeOS: Toggle Waiting` · `LifeOS: Toggle Someday` | Park the task under the cursor, or bring it back |
| `LifeOS: New Project` · `LifeOS: New Area` · `LifeOS: New Person` | Create an entity from a template |
| `LifeOS: Pause / Complete / Archive / Reactivate Project` | Move a project between its four states |
| `LifeOS: Audit` | Everything violating the LifeOS contract, reported never fixed |
| `LifeOS: Open Inbox` · `LifeOS: Setup` | |

Plus `/deadline` and `/scheduled` slash commands, and a completion date recorded when you tick a
task in the page.

# Getting started
1. Run `LifeOS: Setup` — it creates the `Inbox` page and nothing else.
2. Make a project with `LifeOS: New Project`, and write tasks on it.
3. Bind `LifeOS: Capture` to a key (see below) and start capturing.
4. On Friday, run `LifeOS: Weekly Review`.

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

Tasks are plain checkboxes. Two optional attributes carry all the scheduling LifeOS knows about,
spelled the way SilverBullet's own task guide spells them:

```markdown
* [ ] Submit the paper [deadline: "2026-09-08"]
* [ ] Run the benchmark [scheduled: "2026-09-06"]
```

A task belongs to the project whose page it is written on, or to the single project it links to.
A task that names two projects belongs to neither — LifeOS says "no owner" rather than picking
the one you happened to type first. See [[Library/LifeOS/Tasks]].

# Configuration
Everything is optional and lives under `lifeos` in the Configuration UI:

| key | default | |
|---|---|---|
| `lifeos.inboxPage` | `Inbox` | where captured lines land |
| `lifeos.captureMode` | `inbox-page` | or `quick-note`, to use SilverBullet's own Quick Note instead |
| `lifeos.upcomingDays` | `14` | how far ahead Upcoming looks |
| `lifeos.reviewPrefix` | `Reviews/` | page prefix for weekly reviews |
| `lifeos.stampCompletion` | `true` | record `[completed: date]` when you tick a task |

## Key bindings
LifeOS binds no keys, because a library should not claim your keyboard. Add what you want to
your own `CONFIG` page:

```lua
command.update { name = "LifeOS: Capture", key = "Ctrl-q c" }
command.update { name = "LifeOS: Today", key = "Ctrl-q d" }
```

On mobile, an action button is usually better than a key:

```lua
config.set("actionButtons", {
  { icon = "inbox", command = "LifeOS: Capture", description = "Capture" },
  { icon = "calendar", command = "LifeOS: Today", description = "Today" },
})
```

## Daily notes
LifeOS ships a daily template — a log and somewhere to think, nothing more. To use it, point
SilverBullet's journal at it, either in the Configuration UI under Journal, or in `CONFIG`:

```lua
config.set("journal.template", "Library/LifeOS/Page Templates/Daily")
```

Installing LifeOS does not do this for you. Libraries should not quietly change how your journal
works.

## Optional: schema validation
LifeOS defines a contract for its entities but does not register it globally, because
`tag.define` is a single space-wide hook and a library has no business occupying it. If you want
frontmatter autocompletion and inline linting for LifeOS entities, put this in your own `CONFIG`
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

`LifeOS: Audit` reports the same violations without any of this.

# What LifeOS will not do
* Copy tasks anywhere. Today and the review are projections; the task stays where you wrote it.
* Write derived state into your Markdown. Two exceptions, both of them records of something that
  happened rather than something recomputable: the completion date when you tick a task, and a
  frozen review — where you explicitly ask for the current projection to become a fixed snapshot.
* Guess. When a task names two projects, or a completion happened somewhere LifeOS cannot see,
  it says so instead of inventing an answer.
* Take over SilverBullet. No global tag hooks, no key bindings, no configuration changed behind
  your back.

One fact has one owner: the Journal records what happened, a project page records where things
stand, a task carries the commitment and its own dates, and every view derives rather than
stores. The reasoning behind that split, and the rules for what may enter the core at all, are in
the project's `DESIGN.md`.

# Pages
* [[Library/LifeOS/Core]] — configuration, entity contract, accessors
* [[Library/LifeOS/Tasks]] — the task universe, buckets, project attribution
* [[Library/LifeOS/Capture]] — capture and the inbox lifecycle
* [[Library/LifeOS/Completion]] — completion dates, and what they honestly cover
* [[Library/LifeOS/Review]] — ISO weeks, review sections, freezing
* [[Library/LifeOS/Inbox]] — processing what you captured
* [[Library/LifeOS/Lifecycle]] — the four project states
* [[Library/LifeOS/Signals]] — derived observations about active projects
* [[Library/LifeOS/Audit]] — contract checks
* [[Library/LifeOS/Views]] — the projections behind Today and Projects
* [[Library/LifeOS/Pages/Today]] · [[Library/LifeOS/Pages/Upcoming]] · [[Library/LifeOS/Pages/Projects]] · [[Library/LifeOS/Pages/Audit]]
