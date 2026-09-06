---
description: LifeLoop task semantics — the operational task universe, date buckets and project attribution.
tags: meta
---

A LifeLoop task is an ordinary SilverBullet checkbox. Nothing else is required:

```markdown
* [ ] Benchmark survivor recovery
```

Two optional attributes carry the only scheduling semantics LifeLoop knows about, both spelled the
way SilverBullet's own task guide spells them:

```markdown
* [ ] Submit the paper [deadline: "2026-09-08"]
* [ ] Run the benchmark [scheduled: "2026-09-06"]
```

`deadline` is when it has to be done; `scheduled` is when you intend to look at it. A task with
neither is perfectly valid — it simply never shows up in Today on its own.

# The operational task universe
Every LifeLoop view — Today, Projects, Weekly Review, and later Upcoming, Signals and Audit —
derives from one collection:

```lua
lifeloop.tasks.universe()   -- index.tasks() minus everything inside a comment
```

SilverBullet does not skip indexing HTML comments; it indexes them and marks them
`inComment = true` ([[Library/Std/Docs/SLIQ Reference]], `docs/Markdown/Comment.md`). A commented-out
task is still a task object, so LifeLoop has to exclude it deliberately — and it does so in exactly
one place, rather than in each view.

# Waiting and someday
Two tags mark a task as not-right-now. They are tags rather than attributes or custom task states:
a custom state would make these tasks cycle between custom states when clicked and never reach
done, while a tag leaves the checkbox exactly as it was.

```markdown
* [ ] Jen to come back on the offer #waiting
* [ ] Learn macro hygiene #someday
```

Classification reads *inherited* tags, so marking a parent item covers everything nested under it:

```markdown
* Blocked on legal #waiting
  * [ ] Countersign
  * [ ] File the addendum
```

Today and Upcoming leave these out — they are not actionable, and listing them there is noise.
Today shows them in their own section at the bottom, because you do need to know who you are
waiting on.

# Which project a task belongs to
Attribution and association are two different things, so LifeLoop answers them with two functions.

```
contextProject(task)          -- ownership, at most one
  the page it lives on, if that page is a #project
  otherwise the single #project it links to
  otherwise nothing

relatedProjects(task)         -- association, any number
  every #project among the task's inherited links
```

Both of these are native writing styles and neither asks for extra metadata:

```markdown
# Projects/RS Recovery   (tags: project)
* [ ] Benchmark decoder                              -- context: RS Recovery

# Meeting Notes/2026-09-03
* [ ] Benchmark decoder [[RS Recovery]]              -- context: RS Recovery
* [ ] Compare [[RS Recovery]] with [[Reed Solomon]]  -- context: none, related: both
```

The last line is why "first link wins" is not a rule: link order is just writing order. When a
task names two projects, LifeLoop says it has no single owner rather than guessing one. The project
page still surfaces it through SilverBullet's built-in Linked Tasks widget.

# Implementation

## The universe and its derivations
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.tasks = lifeloop.tasks or {}

-- The one filtered collection every LifeLoop view derives from. Callers that want a subset narrow
-- through here rather than reaching for index.tasks() and repeating the rule.
function lifeloop.tasks.universe(pageName)
  if pageName then
    return query[[from t = index.tasks() where not t.inComment and t.page == pageName]]
  end
  return query[[from t = index.tasks() where not t.inComment]]
end

-- Splits a task's first line at its checkbox. Returns the state character and the position of the
-- closing bracket, or nil when the line is not a task at all.
--
-- The list marker is not reliably two characters -- "* ", "- " and "1. " all occur -- so anything
-- that reads or writes around the checkbox has to find it rather than count to it.
function lifeloop.tasks.marker(line)
  local _, stop, state = string.find(line, "^%s*[-*+]%s+%[(.)%]")
  if not state then
    _, stop, state = string.find(line, "^%s*%d+[%.%)]%s+%[(.)%]")
  end
  if not state then
    return nil
  end
  return state, stop
end

-- Resolves a task ref to a live page and offset. A ref is an identity, not a location: most are
-- "Page@offset", but a task carrying an anchor is indexed under the bare anchor name instead, so
-- the two forms are told apart rather than one assumed. This is the same resolution SilverBullet
-- performs before it writes a task marker.
--
-- Deliberately index-free for the common form. Writing a page drops its objects and re-adds them
-- a moment later, and a caller reacting to that very write would land in the gap and conclude the
-- task no longer exists. Arithmetic on the ref cannot go stale that way.
function lifeloop.tasks.locate(ref)
  if type(ref) != "string" or ref == "" then
    return nil
  end
  local page, pos = string.match(ref, "^(.*)@(%d+)$")
  if page and page != "" then
    return { page = page, pos = tonumber(pos) }
  end
  local resolved = index.resolveAnchor(ref)
  if not resolved or not resolved.ok or not resolved.range then
    return nil
  end
  return { page = resolved.page, pos = resolved.range[1] }
end

function lifeloop.tasks.open(tasks)
  local out = {}
  for _, t in ipairs(tasks or lifeloop.tasks.universe()) do
    if not t.done then
      table.insert(out, t)
    end
  end
  return out
end

-- Not right now: waiting on someone, or filed under maybe-later. Read from inherited tags, so a
-- parent item marked #waiting covers the tasks nested under it.
function lifeloop.tasks.parked(t)
  local tags = t.itags or t.tags or {}
  return table.includes(tags, "waiting") or table.includes(tags, "someday")
end

-- What is open and not parked: the tasks you could actually pick up.
function lifeloop.tasks.actionable(tasks)
  local out = {}
  for _, t in ipairs(lifeloop.tasks.open(tasks)) do
    if not lifeloop.tasks.parked(t) then
      table.insert(out, t)
    end
  end
  return out
end

function lifeloop.tasks.waiting(tasks)
  local out = {}
  for _, t in ipairs(lifeloop.tasks.open(tasks)) do
    if table.includes(t.itags or t.tags or {}, "waiting") then
      table.insert(out, t)
    end
  end
  return lifeloop.tasks.sort(out)
end

function lifeloop.tasks.deadline(t)
  return lifeloop.date.day(t.deadline)
end

function lifeloop.tasks.scheduled(t)
  return lifeloop.date.day(t.scheduled)
end

function lifeloop.tasks.completed(t)
  return lifeloop.date.day(t.completed)
end
```

## Ordering
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.tasks = lifeloop.tasks or {}

-- Deadline first (undated last), then the page it lives on, then its text. Stable enough that
-- Today does not reshuffle itself between refreshes.
function lifeloop.tasks.sort(tasks)
  table.sort(tasks, function(a, b)
    local da = lifeloop.tasks.deadline(a) or "9999-12-31"
    local db = lifeloop.tasks.deadline(b) or "9999-12-31"
    if da != db then
      return da < db
    end
    if a.page != b.page then
      return a.page < b.page
    end
    return (a.name or "") < (b.name or "")
  end)
  return tasks
end
```

## Today's buckets
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.tasks = lifeloop.tasks or {}

-- Three disjoint buckets: a task appears at most once. Anything with a future deadline that is
-- scheduled for today lands in `scheduled` -- it is on today's plate, but it is not due.
function lifeloop.tasks.buckets(today, tasks)
  today = today or lifeloop.date.today()
  local overdue, dueToday, scheduled = {}, {}, {}
  for _, t in ipairs(lifeloop.tasks.actionable(tasks)) do
    local deadline = lifeloop.tasks.deadline(t)
    local plan = lifeloop.tasks.scheduled(t)
    if deadline and deadline < today then
      table.insert(overdue, t)
    elseif deadline == today then
      table.insert(dueToday, t)
    elseif plan and plan <= today then
      table.insert(scheduled, t)
    end
  end
  return {
    overdue = lifeloop.tasks.sort(overdue),
    dueToday = lifeloop.tasks.sort(dueToday),
    scheduled = lifeloop.tasks.sort(scheduled),
  }
end

-- The next `days` days, grouped by the day the task belongs to. A task carrying both dates appears
-- exactly once: under `scheduled`, the day you meant to work on it, with the deadline alongside;
-- a task with no scheduled date in range falls back to its deadline.
function lifeloop.tasks.upcoming(days, today, tasks)
  today = today or lifeloop.date.today()
  local horizon = lifeloop.date.shift(today, days or 14)
  local byDay = {}
  local order = {}
  for _, t in ipairs(lifeloop.tasks.actionable(tasks)) do
    local deadline = lifeloop.tasks.deadline(t)
    local plan = lifeloop.tasks.scheduled(t)
    local day
    if plan and plan > today and plan <= horizon then
      day = plan
    elseif deadline and deadline > today and deadline <= horizon then
      day = deadline
    end
    if day then
      if not byDay[day] then
        byDay[day] = {}
        table.insert(order, day)
      end
      table.insert(byDay[day], t)
    end
  end
  table.sort(order)
  local groups = {}
  for _, day in ipairs(order) do
    table.insert(groups, { day = day, tasks = lifeloop.tasks.sort(byDay[day]) })
  end
  return groups
end

-- Tasks that recorded a completion date inside [from, to]. Tasks completed before LifeLoop was
-- installed, or ticked from a query view, have no date and are invisible here by design.
function lifeloop.tasks.completedBetween(from, to, tasks)
  local out = {}
  for _, t in ipairs(tasks or lifeloop.tasks.universe()) do
    local completed = lifeloop.tasks.completed(t)
    if t.done and completed and completed >= from and completed <= to then
      table.insert(out, t)
    end
  end
  return out
end
```

## Project attribution
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.tasks = lifeloop.tasks or {}

function lifeloop.tasks.relatedProjects(t, projectSet)
  projectSet = projectSet or lifeloop.projectSet()
  local seen, out = {}, {}
  for _, link in ipairs(t.ilinks or {}) do
    if projectSet[link] and not seen[link] then
      seen[link] = true
      table.insert(out, link)
    end
  end
  return out
end

function lifeloop.tasks.contextProject(t, projectSet)
  projectSet = projectSet or lifeloop.projectSet()
  if projectSet[t.page] then
    return t.page
  end
  local related = lifeloop.tasks.relatedProjects(t, projectSet)
  if #related == 1 then
    return related[1]
  end
  return nil
end

-- Open tasks owned by a project: the ones written on its page plus the ones elsewhere that
-- name it and name nothing else.
function lifeloop.tasks.forProject(projectName, projectSet, tasks)
  projectSet = projectSet or lifeloop.projectSet()
  local out = {}
  for _, t in ipairs(lifeloop.tasks.open(tasks)) do
    if lifeloop.tasks.contextProject(t, projectSet) == projectName then
      table.insert(out, t)
    end
  end
  return out
end
```

## Rendering
`templates.taskItem` renders a task as a checkbox that writes back to its source page. LifeLoop
keeps that behaviour (including its anchor-ref handling) and only appends the owning project.
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.tasks = lifeloop.tasks or {}
lifeloop.templates = lifeloop.templates or {}

lifeloop.templates.task = template.new [==[
* [${state}] [[${ref}]] ${name}${context}
]==]

-- Anchor refs are bare names; a "$" prefix makes them resolve as links. Position and header
-- refs already carry "@" or "#" and pass through untouched.
function lifeloop.tasks.linkRef(t)
  if string.find(t.ref, "[@#]") then
    return t.ref
  end
  return "$" .. t.ref
end

-- The indexer strips attributes out of `name`, so a rendered task would silently lose the date
-- that put it on the list. Deadline if it has one, otherwise the day it was planned for.
function lifeloop.tasks.suffix(t, projectSet)
  local date = lifeloop.tasks.deadline(t) or lifeloop.tasks.scheduled(t)
  local project = lifeloop.tasks.contextProject(t, projectSet)
  return (date and (" — " .. date) or "")
    .. (project and ("  ↳ [[" .. project .. "]]") or "")
end

function lifeloop.tasks.render(tasks, projectSet)
  if #tasks == 0 then
    return nil
  end
  projectSet = projectSet or lifeloop.projectSet()
  local out = {}
  for _, t in ipairs(tasks) do
    table.insert(out, lifeloop.templates.task {
      state = t.state,
      ref = lifeloop.tasks.linkRef(t),
      name = t.name,
      context = lifeloop.tasks.suffix(t, projectSet),
    })
  end
  return table.concat(out)
end

-- Frozen review sections render tasks as plain text: a snapshot records what was true, it does
-- not hand you a checkbox that still edits a task somewhere else.
function lifeloop.tasks.renderStatic(tasks, projectSet)
  if #tasks == 0 then
    return nil
  end
  projectSet = projectSet or lifeloop.projectSet()
  local out = {}
  for _, t in ipairs(tasks) do
    table.insert(out, "- " .. (t.done and "✓" or "○") .. " " .. t.name
      .. lifeloop.tasks.suffix(t, projectSet) .. "\n")
  end
  return table.concat(out)
end
```

## Contract validation
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.tasks = lifeloop.tasks or {}

function lifeloop.tasks.issues(t)
  local issues = {}
  for _, attribute in ipairs(lifeloop.contract.taskDates) do
    local value = t[attribute]
    if value != nil and not lifeloop.date.day(value) then
      table.insert(issues, {
        level = "review",
        message = attribute .. " is not a YYYY-MM-DD date: " .. tostring(value),
      })
    end
  end
  if t.priority != nil and not table.includes(lifeloop.contract.taskPriority, t.priority) then
    table.insert(issues, {
      level = "review",
      message = "unknown priority '" .. tostring(t.priority) .. "'",
    })
  end
  return issues
end
```

## Parking a task
Toggling adds or removes the tag **on the task's own line**. A task parked by a parent item is
reported rather than silently un-parked: removing a tag the line never had would be a lie, and
editing the parent from here would move something the cursor is not on.
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.tasks = lifeloop.tasks or {}

-- The indexed task whose source range contains the cursor, or nil
-- The task the cursor is inside, or nil. A parent task's range covers its children, so several
-- can match at once and the innermost is the one meant: with the cursor on a subtask, that
-- subtask is what you are pointing at.
function lifeloop.tasks.atCursor()
  local page = editor.getCurrentPage()
  local pos = editor.getCursor()
  local best
  for _, t in ipairs(lifeloop.tasks.universe(page)) do
    if t.range and t.range[1] <= pos and pos <= t.range[2] then
      if not best or (t.range[2] - t.range[1]) < (best.range[2] - best.range[1]) then
        best = t
      end
    end
  end
  return best
end

function lifeloop.tasks.toggleTag(tag)
  local line = editor.getCurrentLine()
  if not line or not string.find(line.text, "^%s*[-*+]%s+%[") then
    editor.flashNotification("Put the cursor on a task first", "error")
    return
  end

  -- %f is a frontier pattern: it matches the boundary, so "#waiting" does not match inside
  -- "#waitingroom"
  local pattern = "%s*#" .. tag .. "%f[%W]"
  if string.find(line.text, pattern) then
    local stripped = string.gsub(line.text, pattern, "")
    editor.dispatch { changes = { from = line.from, to = line.to, insert = stripped } }
    editor.flashNotification("#" .. tag .. " removed")
    return
  end

  local task = lifeloop.tasks.atCursor()
  if task and table.includes(task.itags or {}, tag) then
    editor.flashNotification(
      "This task is #" .. tag .. " through a parent item — change it there",
      "error"
    )
    return
  end

  editor.dispatch {
    changes = { from = line.to, to = line.to, insert = " #" .. tag },
  }
  editor.flashNotification("#" .. tag .. " added")
end

command.define {
  name = "LifeLoop: Toggle Waiting",
  run = function() lifeloop.tasks.toggleTag("waiting") end
}

command.define {
  name = "LifeLoop: Toggle Someday",
  run = function() lifeloop.tasks.toggleTag("someday") end
}
```

## Slash commands
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
slashCommand.define {
  name = "deadline",
  description = "Add a deadline attribute to this task",
  run = function()
    editor.insertAtCursor('[deadline: "' .. lifeloop.date.today() .. '"]')
  end
}

slashCommand.define {
  name = "scheduled",
  description = "Add a scheduled attribute to this task",
  run = function()
    editor.insertAtCursor('[scheduled: "' .. lifeloop.date.today() .. '"]')
  end
}
```
