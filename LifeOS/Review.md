---
description: Weekly review — ISO weeks, the four live sections, and freezing them into a snapshot.
tags: meta
---

`LifeOS: Weekly Review` creates one page per ISO week (`Reviews/2026-W36`) with four sections
queried live and the reflection written by you. Query the facts, write the judgement.

# Live now, snapshot later
The four sections answer questions about *now*, and that is what you want while reviewing. It is
not what you want six months later: "Still Open" would show what is open today, "Active Projects"
would have quietly dropped everything since archived. Even "Completed" only holds while the
source tasks survive — `Task: Remove Completed` erases that history.

So when the review is done, run `LifeOS: Freeze Review`. It replaces all four sections with what
they say at that moment and stamps `frozen:` in the frontmatter.

Frozen sections are rendered as plain text, `- ✓` and `- ○`, never as checkboxes. A snapshot
records what was true; it must not hand you a checkbox that still edits a task somewhere else,
and it must not turn a historical page into a pile of freshly indexed task objects.

Freezing is all-or-nothing: it verifies the page is not already frozen, that its week frontmatter
is intact, and that it has at least one live section; then renders every section it found and
writes once. A failure at any point leaves the page untouched rather than half-frozen. Running it
twice is a no-op, because the markers it looks for are the live expressions themselves — once
replaced, there is nothing left to match.

It freezes the sections a page *has*, not a fixed list. The set of sections grows as the template
does, and demanding today's exact list would make every review written against an older template
permanently unfreezable. What identifies a review page is its `weekStart` / `weekEnd`
frontmatter.

# Implementation

## ISO weeks
```space-lua
-- priority: 10
lifeos = lifeos or {}
lifeos.review = lifeos.review or {}

local DAY_SECONDS = 60 * 60 * 24

-- { key = "2026-W36", start = "2026-08-31", finish = "2026-09-06" } for the ISO week
-- containing the given day (default today). Weeks start on Monday.
function lifeos.week(dayStr)
  dayStr = lifeos.date.day(dayStr or lifeos.date.today())
  if not dayStr then
    return nil
  end
  local year, month, day = string.match(dayStr, "^(%d%d%d%d)%-(%d%d)%-(%d%d)$")
  local timestamp = os.time { year = tonumber(year), month = tonumber(month), day = tonumber(day) }
  -- os.date's wday is 1 = Sunday; ISO counts Monday as 1
  local weekday = os.date("*t", timestamp).wday
  local isoWeekday = (weekday == 1) and 7 or (weekday - 1)
  local weekStart = timestamp - (isoWeekday - 1) * DAY_SECONDS
  return {
    key = os.date("%G-W%V", timestamp),
    start = os.date("%Y-%m-%d", weekStart),
    finish = os.date("%Y-%m-%d", weekStart + 6 * DAY_SECONDS),
  }
end

function lifeos.review.pageName(dayStr)
  return config.get("lifeos.reviewPrefix", "Reviews/") .. lifeos.week(dayStr).key
end

-- The week a section should report on: the current page's frontmatter when it has any,
-- otherwise this week. Passing explicit dates (as freezing does) short-circuits both.
function lifeos.review.range(from, to)
  if from and to then
    return from, to
  end
  local page = _CTX.currentPage
  local start = page and lifeos.date.day(page.weekStart)
  local finish = page and lifeos.date.day(page.weekEnd)
  if start and finish then
    return start, finish
  end
  local week = lifeos.week()
  return week.start, week.finish
end
```

## The four sections
```space-lua
-- priority: 10
lifeos = lifeos or {}
lifeos.review = lifeos.review or {}

function lifeos.review.completed(from, to)
  from, to = lifeos.review.range(from, to)
  local tasks = lifeos.tasks.completedBetween(from, to)
  return lifeos.tasks.render(lifeos.tasks.sort(tasks))
    or "_No tasks with a recorded completion date in this week._\n"
end

function lifeos.review.stillOpen(from, to)
  from, to = lifeos.review.range(from, to)
  local universe = lifeos.tasks.universe()
  local out = {}
  for _, t in ipairs(lifeos.tasks.open(universe)) do
    local deadline = lifeos.tasks.deadline(t)
    local plan = lifeos.tasks.scheduled(t)
    if (deadline and deadline <= to) or (plan and plan <= to) then
      table.insert(out, t)
    end
  end
  return lifeos.tasks.render(lifeos.tasks.sort(out))
    or "_Nothing open that was due or planned by " .. to .. "._\n"
end

function lifeos.review.activeProjects()
  local projectSet = lifeos.projectSet()
  local universe = lifeos.tasks.universe()
  local context = { projectSet = projectSet, universe = universe }
  local out = {}
  for _, p in ipairs(lifeos.projects("active")) do
    local open = #lifeos.tasks.forProject(p.name, projectSet, universe)
    local signals = lifeos.signals.render(p, context)
    table.insert(out, "* [[" .. p.name .. "]] — " .. open .. " open"
      .. (signals != "" and (" · " .. signals) or "") .. "\n")
  end
  if #out == 0 then
    return "_No active projects._\n"
  end
  return table.concat(out)
end

-- The banner is a section too, so that a frozen review does not keep telling you to freeze it.
function lifeos.review.status()
  return "> **note** These four sections read the space as it is *right now*.\n"
    .. "> When you have finished the review, run `LifeOS: Freeze Review` to snapshot them.\n"
end

function lifeos.review.waiting()
  local waiting = lifeos.tasks.waiting()
  return lifeos.tasks.render(waiting) or "_Not waiting on anyone._\n"
end

function lifeos.review.inbox()
  local entries = lifeos.inbox.pending()
  if #entries == 0 then
    return "_Inbox is empty._\n"
  end
  local out = {}
  for _, entry in ipairs(entries) do
    if entry.kind == "page" then
      table.insert(out, "* [[" .. entry.page .. "]]\n")
    else
      table.insert(out, "* " .. (entry.name or "(empty)") .. "\n")
    end
  end
  return table.concat(out)
end
```

## Freezing
```space-lua
-- priority: 10
lifeos = lifeos or {}
lifeos.review = lifeos.review or {}

-- Each section is found by the exact live expression the template wrote into the page.
lifeos.review.sections = {
  {
    expression = "${lifeos.review.completed()}",
    freeze = function(from, to)
      local tasks = lifeos.tasks.completedBetween(from, to)
      return lifeos.tasks.renderStatic(lifeos.tasks.sort(tasks))
        or "_No tasks with a recorded completion date in this week._\n"
    end,
  },
  {
    expression = "${lifeos.review.stillOpen()}",
    freeze = function(from, to)
      local universe = lifeos.tasks.universe()
      local out = {}
      for _, t in ipairs(lifeos.tasks.open(universe)) do
        local deadline = lifeos.tasks.deadline(t)
        local plan = lifeos.tasks.scheduled(t)
        if (deadline and deadline <= to) or (plan and plan <= to) then
          table.insert(out, t)
        end
      end
      return lifeos.tasks.renderStatic(lifeos.tasks.sort(out))
        or "_Nothing open that was due or planned by " .. to .. "._\n"
    end,
  },
  {
    expression = "${lifeos.review.activeProjects()}",
    freeze = function() return lifeos.review.activeProjects() end,
  },
  {
    expression = "${lifeos.review.waiting()}",
    freeze = function()
      return lifeos.tasks.renderStatic(lifeos.tasks.waiting()) or "_Not waiting on anyone._\n"
    end,
  },
  {
    expression = "${lifeos.review.inbox()}",
    freeze = function() return lifeos.review.inbox() end,
  },
  {
    expression = "${lifeos.review.status()}",
    freeze = function()
      return "> **note** Snapshot taken on " .. lifeos.date.today() .. ".\n"
    end,
  },
}

-- Plain (non-pattern) replacement of the first occurrence
local function replacePlain(text, needle, replacement)
  local from, to = string.find(text, needle, 1, true)
  if not from then
    return text
  end
  return text:sub(1, from - 1) .. replacement .. text:sub(to + 1)
end

-- Replaces every live section with what it says right now, in one write, or changes nothing at
-- all. Returns ok, message. Takes the page explicitly so that it never depends on what the editor
-- happens to be showing.
function lifeos.review.freeze(pageName)
  local text = lifeos.readPageText(pageName)
  local frontmatter = index.extractFrontmatter(text).frontmatter or {}

  if frontmatter.frozen then
    return false, "already frozen on " .. tostring(frontmatter.frozen)
  end
  -- The week frontmatter is what makes this a review page; the set of sections is a template
  -- detail that grows over time, so demanding today's exact list would make every review written
  -- against an older template permanently unfreezable.
  local from = lifeos.date.day(frontmatter.weekStart)
  local to = lifeos.date.day(frontmatter.weekEnd)
  if not from or not to then
    return false, "weekStart/weekEnd are missing or malformed"
  end
  local present = {}
  for _, section in ipairs(lifeos.review.sections) do
    if string.find(text, section.expression, 1, true) then
      table.insert(present, section)
    end
  end
  if #present == 0 then
    return false, "this page has no live review sections to freeze"
  end

  -- Render everything before touching the page, so a failure halfway leaves nothing behind
  local rendered = {}
  for i, section in ipairs(present) do
    rendered[i] = section.freeze(from, to)
  end

  local newText = text
  for i, section in ipairs(present) do
    newText = replacePlain(newText, section.expression, rendered[i])
  end
  newText = index.patchFrontmatter(newText, {
    { op = "set-key", path = "frozen", value = lifeos.date.today() },
  })

  lifeos.writePageText(pageName, newText)
  return true, "review frozen"
end

command.define {
  name = "LifeOS: Freeze Review",
  run = function()
    local ok, message = lifeos.review.freeze(editor.getCurrentPage())
    editor.flashNotification(
      ok and "Review frozen" or ("Not freezing: " .. message),
      ok and "info" or "error"
    )
  end
}
```
