---
description: Derived signals about active projects — computed on read, never written down.
tags: meta
---

A signal is an observation a query can make. It is never stored, and it never claims more than
the thing it measured.

| signal | condition |
|---|---|
| `No actionable task` | the project has open tasks, none of them actionable |
| `Waiting only` | it has open tasks **and every one of them is `#waiting`** |
| `Project page unchanged for N days` | the page's own `lastModified` is older than the threshold |
| `Deadline in N days` | the **project's own** `deadline`, not any task's |
| `N overdue tasks` | tasks belonging to the project whose deadline has passed |

Three deliberate restraints:

**Only active projects.** A completed project has no actionable tasks by construction; warning
about it would be noise that trains you to ignore the column.

**`Waiting only` is narrower than `No actionable task`**, and wins when both apply. A project
holding waiting *and* someday tasks has nothing actionable, but it is not waiting on anybody — and
the two call for different responses.

**Names match evidence.** `Project page unchanged` rather than "inactive": the only thing measured
is one page's timestamp, while the actual work may be happening in a meeting note or the journal.
Likewise `No actionable task` does not say the project is stuck. And a project's deadline is
something you set — it is never synthesised from the earliest task deadline.

# Implementation
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.signals = lifeloop.signals or {}

config.define("lifeloop.signals", {
  description = "Thresholds for LifeLoop project signals",
  type = "object",
  properties = {
    staleDays = {
      type = "number",
      default = 21,
      description = "Days without an edit to the project page before it is flagged.",
      ui = { category = "LifeLoop", label = "Stale after (days)", priority = 1 },
    },
    deadlineSoonDays = {
      type = "number",
      default = 7,
      description = "How close a project deadline has to be before it is flagged.",
      ui = { category = "LifeLoop", label = "Deadline soon (days)", priority = 1 },
    },
  },
  additionalProperties = false,
})

-- Returns a list of { level, message }. Empty for anything that is not an active project.
function lifeloop.signals.forProject(p, ctx)
  if lifeloop.projectStatus(p) != "active" then
    return {}
  end
  ctx = ctx or {}
  local projectSet = ctx.projectSet or lifeloop.projectSet()
  local universe = ctx.universe or lifeloop.tasks.universe()
  local today = ctx.today or lifeloop.date.today()
  local thresholds = config.get("lifeloop.signals", {})
  local staleDays = thresholds.staleDays or 21
  local deadlineSoonDays = thresholds.deadlineSoonDays or 7

  local open = lifeloop.tasks.forProject(p.name, projectSet, universe)
  local actionable, waiting, overdue = 0, 0, 0
  for _, t in ipairs(open) do
    if not lifeloop.tasks.parked(t) then
      actionable = actionable + 1
    end
    if table.includes(t.itags or {}, "waiting") then
      waiting = waiting + 1
    end
    local deadline = lifeloop.tasks.deadline(t)
    if deadline and deadline < today then
      overdue = overdue + 1
    end
  end

  local signals = {}
  if #open > 0 and actionable == 0 then
    -- The more specific reading wins: "waiting only" and "nothing actionable" call for
    -- different responses, and showing both says the same thing twice.
    if waiting == #open then
      table.insert(signals, { level = "review", message = "Waiting only" })
    else
      table.insert(signals, { level = "review", message = "No actionable task" })
    end
  end

  local touched = lifeloop.date.day(p.lastModified)
  local staleBefore = lifeloop.date.shift(today, -staleDays)
  if touched and staleBefore and touched < staleBefore then
    table.insert(signals, {
      level = "info",
      message = "Project page unchanged for " .. staleDays .. "+ days",
    })
  end

  -- The project's own deadline. A task's deadline is a fact about that task.
  local deadline = lifeloop.date.day(p.deadline)
  if deadline and deadline >= today and deadline <= lifeloop.date.shift(today, deadlineSoonDays) then
    table.insert(signals, { level = "review", message = "Deadline " .. deadline })
  end

  if overdue > 0 then
    table.insert(signals, {
      level = "review",
      message = overdue .. (overdue == 1 and " overdue task" or " overdue tasks"),
    })
  end

  return signals
end

function lifeloop.signals.render(p, ctx)
  local signals = lifeloop.signals.forProject(p, ctx)
  if #signals == 0 then
    return ""
  end
  local out = {}
  for _, s in ipairs(signals) do
    table.insert(out, s.message)
  end
  return table.concat(out, " · ")
end
```
