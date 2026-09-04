---
description: LifeOS task semantics — the operational task universe, date buckets and project attribution.
tags: meta
---

A LifeOS task is an ordinary SilverBullet checkbox. Nothing else is required:

```markdown
* [ ] Benchmark survivor recovery
```

Two optional attributes carry the only scheduling semantics LifeOS knows about, both spelled the
way SilverBullet's own task guide spells them:

```markdown
* [ ] Submit the paper [deadline: "2026-09-08"]
* [ ] Run the benchmark [scheduled: "2026-09-06"]
```

`deadline` is when it has to be done; `scheduled` is when you intend to look at it. A task with
neither is perfectly valid — it simply never shows up in Today on its own.

# The operational task universe
Every LifeOS view — Today, Projects, Weekly Review, and later Upcoming, Signals and Audit —
derives from one collection:

```lua
lifeos.tasks.universe()   -- index.tasks() minus everything inside a comment
```

SilverBullet does not skip indexing HTML comments; it indexes them and marks them
`inComment = true` ([[Library/Std/Docs/SLIQ Reference]], `docs/Markdown/Comment.md`). A commented-out
task is still a task object, so LifeOS has to exclude it deliberately — and it does so in exactly
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
Attribution and association are two different things, so LifeOS answers them with two functions.

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
task names two projects, LifeOS says it has no single owner rather than guessing one. The project
page still surfaces it through SilverBullet's built-in Linked Tasks widget.

# Implementation

## The universe and its derivations
```space-lua
-- priority: 10
lifeos = lifeos or {}
lifeos.tasks = lifeos.tasks or {}

-- The one filtered collection every LifeOS view derives from. Callers that want a subset narrow
-- through here rather than reaching for index.tasks() and repeating the rule.
function lifeos.tasks.universe(pageName)
  if pageName then
    return query[[from t = index.tasks() where not t.inComment and t.page == pageName]]
  end
  return query[[from t = index.tasks() where not t.inComment]]
end

function lifeos.tasks.open(tasks)
  local out = {}
  for _, t in ipairs(tasks or lifeos.tasks.universe()) do
    if not t.done then
      table.insert(out, t)
    end
  end
  return out
end

-- Not right now: waiting on someone, or filed under maybe-later. Read from inherited tags, so a
-- parent item marked #waiting covers the tasks nested under it.
function lifeos.tasks.parked(t)
  local tags = t.itags or t.tags or {}
  return table.includes(tags, "waiting") or table.includes(tags, "someday")
end

-- What is open and not parked: the tasks you could actually pick up.
function lifeos.tasks.actionable(tasks)
  local out = {}
  for _, t in ipairs(lifeos.tasks.open(tasks)) do
    if not lifeos.tasks.parked(t) then
      table.insert(out, t)
    end
  end
  return out
end

function lifeos.tasks.waiting(tasks)
  local out = {}
  for _, t in ipairs(lifeos.tasks.open(tasks)) do
    if table.includes(t.itags or t.tags or {}, "waiting") then
      table.insert(out, t)
    end
  end
  return lifeos.tasks.sort(out)
end

function lifeos.tasks.deadline(t)
  return lifeos.date.day(t.deadline)
end

function lifeos.tasks.scheduled(t)
  return lifeos.date.day(t.scheduled)
end

function lifeos.tasks.completed(t)
  return lifeos.date.day(t.completed)
end
```

## Ordering
```space-lua
-- priority: 10
lifeos = lifeos or {}
lifeos.tasks = lifeos.tasks or {}

-- Deadline first (undated last), then the page it lives on, then its text. Stable enough that
-- Today does not reshuffle itself between refreshes.
function lifeos.tasks.sort(tasks)
  table.sort(tasks, function(a, b)
    local da = lifeos.tasks.deadline(a) or "9999-12-31"
    local db = lifeos.tasks.deadline(b) or "9999-12-31"
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
lifeos = lifeos or {}
lifeos.tasks = lifeos.tasks or {}

-- Three disjoint buckets: a task appears at most once. Anything with a future deadline that is
-- scheduled for today lands in `scheduled` -- it is on today's plate, but it is not due.
function lifeos.tasks.buckets(today, tasks)
  today = today or lifeos.date.today()
  local overdue, dueToday, scheduled = {}, {}, {}
  for _, t in ipairs(lifeos.tasks.actionable(tasks)) do
    local deadline = lifeos.tasks.deadline(t)
    local plan = lifeos.tasks.scheduled(t)
    if deadline and deadline < today then
      table.insert(overdue, t)
    elseif deadline == today then
      table.insert(dueToday, t)
    elseif plan and plan <= today then
      table.insert(scheduled, t)
    end
  end
  return {
    overdue = lifeos.tasks.sort(overdue),
    dueToday = lifeos.tasks.sort(dueToday),
    scheduled = lifeos.tasks.sort(scheduled),
  }
end

-- The next `days` days, grouped by the day the task belongs to. A task carrying both dates appears
-- exactly once: under `scheduled`, the day you meant to work on it, with the deadline alongside;
-- a task with no scheduled date in range falls back to its deadline.
function lifeos.tasks.upcoming(days, today, tasks)
  today = today or lifeos.date.today()
  local horizon = lifeos.date.shift(today, days or 14)
  local byDay = {}
  local order = {}
  for _, t in ipairs(lifeos.tasks.actionable(tasks)) do
    local deadline = lifeos.tasks.deadline(t)
    local plan = lifeos.tasks.scheduled(t)
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
    table.insert(groups, { day = day, tasks = lifeos.tasks.sort(byDay[day]) })
  end
  return groups
end

-- Tasks that recorded a completion date inside [from, to]. Tasks completed before LifeOS was
-- installed, or ticked from a query view, have no date and are invisible here by design.
function lifeos.tasks.completedBetween(from, to, tasks)
  local out = {}
  for _, t in ipairs(tasks or lifeos.tasks.universe()) do
    local completed = lifeos.tasks.completed(t)
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
lifeos = lifeos or {}
lifeos.tasks = lifeos.tasks or {}

function lifeos.tasks.relatedProjects(t, projectSet)
  projectSet = projectSet or lifeos.projectSet()
  local seen, out = {}, {}
  for _, link in ipairs(t.ilinks or {}) do
    if projectSet[link] and not seen[link] then
      seen[link] = true
      table.insert(out, link)
    end
  end
  return out
end

function lifeos.tasks.contextProject(t, projectSet)
  projectSet = projectSet or lifeos.projectSet()
  if projectSet[t.page] then
    return t.page
  end
  local related = lifeos.tasks.relatedProjects(t, projectSet)
  if #related == 1 then
    return related[1]
  end
  return nil
end

-- Open tasks owned by a project: the ones written on its page plus the ones elsewhere that
-- name it and name nothing else.
function lifeos.tasks.forProject(projectName, projectSet, tasks)
  projectSet = projectSet or lifeos.projectSet()
  local out = {}
  for _, t in ipairs(lifeos.tasks.open(tasks)) do
    if lifeos.tasks.contextProject(t, projectSet) == projectName then
      table.insert(out, t)
    end
  end
  return out
end
```

## Rendering
`templates.taskItem` renders a task as a checkbox that writes back to its source page. LifeOS
keeps that behaviour (including its anchor-ref handling) and only appends the owning project.
```space-lua
-- priority: 10
lifeos = lifeos or {}
lifeos.tasks = lifeos.tasks or {}
lifeos.templates = lifeos.templates or {}

lifeos.templates.task = template.new [==[
* [${state}] [[${ref}]] ${name}${context}
]==]

-- Anchor refs are bare names; a "$" prefix makes them resolve as links. Position and header
-- refs already carry "@" or "#" and pass through untouched.
function lifeos.tasks.linkRef(t)
  if string.find(t.ref, "[@#]") then
    return t.ref
  end
  return "$" .. t.ref
end

-- The indexer strips attributes out of `name`, so a rendered task would silently lose the date
-- that put it on the list. Deadline if it has one, otherwise the day it was planned for.
function lifeos.tasks.suffix(t, projectSet)
  local date = lifeos.tasks.deadline(t) or lifeos.tasks.scheduled(t)
  local project = lifeos.tasks.contextProject(t, projectSet)
  return (date and (" — " .. date) or "")
    .. (project and ("  ↳ [[" .. project .. "]]") or "")
end

function lifeos.tasks.render(tasks, projectSet)
  if #tasks == 0 then
    return nil
  end
  projectSet = projectSet or lifeos.projectSet()
  local out = {}
  for _, t in ipairs(tasks) do
    table.insert(out, lifeos.templates.task {
      state = t.state,
      ref = lifeos.tasks.linkRef(t),
      name = t.name,
      context = lifeos.tasks.suffix(t, projectSet),
    })
  end
  return table.concat(out)
end

-- Frozen review sections render tasks as plain text: a snapshot records what was true, it does
-- not hand you a checkbox that still edits a task somewhere else.
function lifeos.tasks.renderStatic(tasks, projectSet)
  if #tasks == 0 then
    return nil
  end
  projectSet = projectSet or lifeos.projectSet()
  local out = {}
  for _, t in ipairs(tasks) do
    table.insert(out, "- " .. (t.done and "✓" or "○") .. " " .. t.name
      .. lifeos.tasks.suffix(t, projectSet) .. "\n")
  end
  return table.concat(out)
end
```

## Contract validation
```space-lua
-- priority: 10
lifeos = lifeos or {}
lifeos.tasks = lifeos.tasks or {}

function lifeos.tasks.issues(t)
  local issues = {}
  for _, attribute in ipairs(lifeos.contract.taskDates) do
    local value = t[attribute]
    if value != nil and not lifeos.date.day(value) then
      table.insert(issues, {
        level = "review",
        message = attribute .. " is not a YYYY-MM-DD date: " .. tostring(value),
      })
    end
  end
  if t.priority != nil and not table.includes(lifeos.contract.taskPriority, t.priority) then
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
lifeos = lifeos or {}
lifeos.tasks = lifeos.tasks or {}

-- The indexed task whose source range contains the cursor, or nil
local function taskAtCursor()
  local page = editor.getCurrentPage()
  local pos = editor.getCursor()
  for _, t in ipairs(lifeos.tasks.universe(page)) do
    if t.range and t.range[1] <= pos and pos <= t.range[2] then
      return t
    end
  end
  return nil
end

function lifeos.tasks.toggleTag(tag)
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

  local task = taskAtCursor()
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
  name = "LifeOS: Toggle Waiting",
  run = function() lifeos.tasks.toggleTag("waiting") end
}

command.define {
  name = "LifeOS: Toggle Someday",
  run = function() lifeos.tasks.toggleTag("someday") end
}
```

## Slash commands
```space-lua
-- priority: 10
lifeos = lifeos or {}
slashCommand.define {
  name = "deadline",
  description = "Add a deadline attribute to this task",
  run = function()
    editor.insertAtCursor('[deadline: "' .. lifeos.date.today() .. '"]')
  end
}

slashCommand.define {
  name = "scheduled",
  description = "Add a scheduled attribute to this task",
  run = function()
    editor.insertAtCursor('[scheduled: "' .. lifeos.date.today() .. '"]')
  end
}
```
