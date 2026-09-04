---
description: Projections — Markdown built from the index, owning no state of their own.
tags: meta
---

Every LifeOS view is a function that returns Markdown and knows nothing about where that Markdown
ends up. [[Library/LifeOS/Pages/Today]] and [[Library/LifeOS/Pages/Projects]] are thin shells
around them.

That split is deliberate. Physical library pages are the right backend today: they render as
real Markdown, so a projected task keeps its working checkbox, and they are trivial to inspect
and copy. But a projection has no business depending on being a page — the same functions should
serve a virtual page, a sidebar, or a nightly digest without changing what "today" means.

**Projection semantics must not depend on page persistence.** The one thing a backend does have
to provide is Markdown rendering, since that is what makes a projected checkbox tick through to
its source.

# Implementation
```space-lua
-- priority: 10
lifeos = lifeos or {}
lifeos.views = lifeos.views or {}

local function section(heading, body, empty)
  return "# " .. heading .. "\n" .. (body or ("_" .. empty .. "_\n")) .. "\n"
end

-- One bucket computation and one project lookup for the whole view, rather than one per section.
function lifeos.views.today(today)
  today = today or lifeos.date.today()
  local projectSet = lifeos.projectSet()
  local universe = lifeos.tasks.universe()
  local buckets = lifeos.tasks.buckets(today, universe)
  local journalPage = config.get("journal.prefix", "Journal/") .. today

  local out = section("Overdue", lifeos.tasks.render(buckets.overdue, projectSet), "Nothing overdue.")
    .. section("Due today", lifeos.tasks.render(buckets.dueToday, projectSet), "Nothing due today.")
    .. section("Scheduled", lifeos.tasks.render(buckets.scheduled, projectSet), "Nothing scheduled for today.")

  -- Not actionable, so kept out of the three buckets -- but you still need to know who you are
  -- waiting on, so it goes at the bottom rather than nowhere.
  local waiting = lifeos.tasks.render(lifeos.tasks.waiting(universe), projectSet)
  if waiting then
    out = out .. section("Waiting on", waiting, "")
  end

  return out
    .. "---\n\n"
    .. "**Inbox** — " .. lifeos.inbox.count() .. " waiting in [[" .. lifeos.inbox.page() .. "]]\n\n"
    .. "**Journal** — [[" .. journalPage .. "]]\n"
end

-- The next `days` days, one heading per day. Weekday names because "Thursday" reads faster than
-- a date when you are deciding what to pull forward.
function lifeos.views.upcoming(days)
  days = days or config.get("lifeos.upcomingDays", 14)
  local projectSet = lifeos.projectSet()
  local groups = lifeos.tasks.upcoming(days)
  if #groups == 0 then
    return "_Nothing scheduled or due in the next " .. days .. " days._\n"
  end
  local out = {}
  for _, group in ipairs(groups) do
    local label = os.date("%A", os.time {
      year = tonumber(group.day:sub(1, 4)),
      month = tonumber(group.day:sub(6, 7)),
      day = tonumber(group.day:sub(9, 10)),
    }) .. " " .. group.day
    table.insert(out, section(label, lifeos.tasks.render(group.tasks, projectSet), ""))
  end
  return table.concat(out)
end

function lifeos.views.projects()
  return section("Active", lifeos.views.projectTable("active"), "No active projects.")
    .. section("Paused", lifeos.views.projectTable("paused"), "No paused projects.")
end

-- Returns nil when there is nothing to show, so callers can supply their own empty line.
-- Two deadline columns on purpose: a project's own deadline is something you decided, while the
-- soonest task deadline is a fact about its tasks. Collapsing them would invent a project
-- deadline nobody set.
function lifeos.views.projectTable(status)
  status = status or "active"
  local projects = lifeos.projects(status)
  if #projects == 0 then
    return nil
  end
  -- One project query and one task query for the whole table, reused for every row
  local projectSet = lifeos.projectSet()
  local universe = lifeos.tasks.universe()
  local rows = {
    "| Project | Area | Open | Deadline | Next task | Signals |",
    "|---|---|---|---|---|---|",
  }
  local signalContext = { projectSet = projectSet, universe = universe }
  for _, p in ipairs(projects) do
    local open = lifeos.tasks.forProject(p.name, projectSet, universe)
    local soonest
    for _, t in ipairs(open) do
      local deadline = lifeos.tasks.deadline(t)
      if deadline and (not soonest or deadline < soonest) then
        soonest = deadline
      end
    end
    local area = lifeos.linkTarget(p.area)
    table.insert(rows, "| [[" .. p.name .. "]] | "
      .. (area and ("[[" .. area .. "]]") or "—") .. " | "
      .. #open .. " | "
      .. (lifeos.date.day(p.deadline) or "—") .. " | "
      .. (soonest or "—") .. " | "
      .. (lifeos.signals.render(p, signalContext) != "" and lifeos.signals.render(p, signalContext) or "—")
      .. " |")
  end
  return table.concat(rows, "\n") .. "\n"
end
```
