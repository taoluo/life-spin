---
description: LifeOS core — configuration, entity contracts, accessors and setup commands.
tags: meta
---

The foundation every other LifeOS page builds on: configuration, the data contract for
Projects/Areas/People, and the accessors that read them back out of the object index.

# Entities
LifeOS recognises three structured entities. They are identified by a **tag in frontmatter**,
never by their folder — `Work/Q3 Launch` and `Projects/Q3 Launch` are equally valid Projects.

```yaml
---
tags: project
status: active
area: "[[Research]]"
deadline: 2026-09-30
---
```

Everything else in your space stays an ordinary Markdown page.

# Contract
LifeOS defines a contract but does **not** enforce it globally: no `tag.define`, no schema
registered against `#project`, no validation hook that other libraries have to share. The
contract lives here as data, and `LifeOS: Audit` reports violations.

| Entity | Attributes |
|---|---|
| Project | `tags` contains `project` (required) · `status` one of active/paused/completed/archived (default active) · `area` page link · `deadline` YYYY-MM-DD · `description` |
| Area | `tags` contains `area` · `status` |
| Person | `tags` contains `person` · `company` · `email` |
| Task | `deadline` / `scheduled` / `completed` as YYYY-MM-DD · `priority` high/normal/low |

If you *want* editor autocompletion and inline linting for these, paste the optional
`tag.define` snippet from [[Library/LifeOS]] into your own `CONFIG` page — that is the place
SilverBullet wants tag definitions to live.

# Implementation

## Namespace and configuration
```space-lua
-- priority: 10
lifeos = lifeos or {}

config.defineCategory {
  name = "LifeOS",
  description = "Markdown-first life management: capture, projects, tasks, weekly review.",
  priority = 20,
}

config.define("lifeos", {
  description = "LifeOS configuration",
  type = "object",
  properties = {
    inboxPage = {
      type = "string",
      default = "Inbox",
      description = "Page captured items are appended to.",
      ui = { category = "LifeOS", label = "Inbox page", priority = 5 },
    },
    captureMode = {
      type = "string",
      default = "inbox-page",
      enum = { "inbox-page", "quick-note" },
      description = "Where 'LifeOS: Capture' puts things: a bullet on the Inbox page, or a native Quick Note under Inbox/.",
      ui = { category = "LifeOS", label = "Capture mode", priority = 4 },
    },
    reviewPrefix = {
      type = "string",
      default = "Reviews/",
      description = "Page-name prefix for weekly review pages (e.g. 'Reviews/2026-W36').",
      ui = { category = "LifeOS", label = "Weekly review prefix", priority = 3 },
    },
    upcomingDays = {
      type = "number",
      default = 14,
      description = "How many days ahead the Upcoming page looks.",
      ui = { category = "LifeOS", label = "Upcoming horizon (days)", priority = 2 },
    },
    stampCompletion = {
      type = "boolean",
      default = true,
      description = "Record a [completed: date] attribute when a task is ticked in the editor.",
      ui = { category = "LifeOS", label = "Record completion dates", priority = 2 },
    },
  },
  additionalProperties = false,
})

-- The canonical vocabulary. Audit reports values outside these; nothing rejects them.
lifeos.contract = {
  projectStatus = { "active", "paused", "completed", "archived" },
  taskPriority = { "high", "normal", "low" },
  taskDates = { "deadline", "scheduled", "completed" },
}
```

## Dates
Attribute values arrive from the indexer already YAML-parsed, so a plain `[deadline: 2026-09-08]`
is handed to us as `"2026-09-08"` while `[deadline: "2026-09-08 14:00"]` keeps its time. Both
normalise to a bare day here; anything that is not a real calendar day normalises to `nil`,
which is how `issues()` spots it.
```space-lua
-- priority: 10
lifeos = lifeos or {}
lifeos.date = lifeos.date or {}

local DAY_SECONDS = 60 * 60 * 24

function lifeos.date.today()
  return os.date("%Y-%m-%d")
end

-- Normalises a value to "YYYY-MM-DD", or nil if it is not a valid calendar day
function lifeos.date.day(value)
  if value == nil then
    return nil
  end
  if type(value) != "string" then
    value = tostring(value)
  end
  local year, month, day = string.match(value, "^(%d%d%d%d)%-(%d%d)%-(%d%d)")
  if not year then
    return nil
  end
  month = tonumber(month)
  day = tonumber(day)
  if month < 1 or month > 12 or day < 1 or day > 31 then
    return nil
  end
  return year .. "-" .. string.format("%02d", month) .. "-" .. string.format("%02d", day)
end

-- Shifts a "YYYY-MM-DD" day by a number of days (may be negative)
function lifeos.date.shift(dayStr, days)
  local year, month, day = string.match(dayStr, "^(%d%d%d%d)%-(%d%d)%-(%d%d)$")
  if not year then
    return nil
  end
  local t = os.time { year = tonumber(year), month = tonumber(month), day = tonumber(day) }
  return os.date("%Y-%m-%d", t + days * DAY_SECONDS)
end
```

## Page helpers
```space-lua
-- priority: 10
lifeos = lifeos or {}

-- "[[Some Page|alias]]" -> "Some Page". Returns nil for anything that isn't a string.
function lifeos.linkTarget(value)
  if type(value) != "string" then
    return nil
  end
  local inner = string.match(value, "^%s*%[%[(.-)%]%]%s*$")
  if not inner then
    inner = value
  end
  return string.trim(string.split(inner, "|")[1])
end

-- Reads and writes go through the editor when the page in question is the one on screen:
-- writing behind an open buffer loses whatever the buffer holds. This is the same split
-- SilverBullet's own task and share code makes.
function lifeos.readPageText(pageName)
  if editor.getCurrentPage() == pageName then
    return editor.getText()
  end
  return space.readPage(pageName)
end

function lifeos.writePageText(pageName, text)
  if editor.getCurrentPage() == pageName then
    editor.setText(text)
  else
    space.writePage(pageName, text)
  end
end

-- Appends a line to a page, creating it when missing. Used by capture and inbox processing.
function lifeos.appendToPage(pageName, line)
  local text = ""
  if space.pageExists(pageName) then
    text = lifeos.readPageText(pageName)
  end
  if text != "" and not text:endsWith("\n") then
    text = text .. "\n"
  end
  lifeos.writePageText(pageName, text .. line .. "\n")
end
```

## Entity accessors
```space-lua
-- priority: 10
lifeos = lifeos or {}

function lifeos.projectStatus(p)
  return p.status or "active"
end

function lifeos.projects(status)
  local all = query[[from p = index.pages("project") order by p.name]]
  if not status then
    return all
  end
  local out = {}
  for _, p in ipairs(all) do
    if lifeos.projectStatus(p) == status then
      table.insert(out, p)
    end
  end
  return out
end

function lifeos.areas()
  return query[[from a = index.pages("area") order by a.name]]
end

function lifeos.people()
  return query[[from p = index.pages("person") order by p.name]]
end

-- name -> project object. Built once per view and passed down, so task attribution
-- never costs a query per task.
function lifeos.projectSet()
  local set = {}
  for _, p in ipairs(lifeos.projects()) do
    set[p.name] = p
  end
  return set
end

function lifeos.areaSet()
  local set = {}
  for _, a in ipairs(lifeos.areas()) do
    set[a.name] = a
  end
  return set
end
```

## Contract validation
`lifeos.projectIssues` / `lifeos.areaIssues` (and `lifeos.tasks.issues` over in
[[Library/LifeOS/Tasks]]) are the *only* places LifeOS decides what is malformed. The Audit page
renders their output; it does not run checks of its own.
```space-lua
-- priority: 10
lifeos = lifeos or {}

-- Shared lookup tables, so a whole-space audit stays a handful of queries
function lifeos.auditContext()
  local pageSet = {}
  for _, p in ipairs(query[[from p = index.pages() select p.name]]) do
    pageSet[p] = true
  end
  return {
    projectSet = lifeos.projectSet(),
    areaSet = lifeos.areaSet(),
    pageSet = pageSet,
  }
end

function lifeos.projectIssues(p, ctx)
  ctx = ctx or lifeos.auditContext()
  local issues = {}
  if p.status and not table.includes(lifeos.contract.projectStatus, p.status) then
    table.insert(issues, {
      level = "review",
      message = "unknown status '" .. tostring(p.status) .. "'",
    })
  end
  if p.deadline != nil and not lifeos.date.day(p.deadline) then
    table.insert(issues, {
      level = "safe",
      message = "deadline is not a YYYY-MM-DD date: " .. tostring(p.deadline),
    })
  end
  if p.area != nil then
    local target = lifeos.linkTarget(p.area)
    if not target then
      table.insert(issues, { level = "review", message = "area is not a page link" })
    elseif not ctx.pageSet[target] then
      table.insert(issues, { level = "review", message = "area links to a missing page: " .. target })
    elseif not ctx.areaSet[target] then
      table.insert(issues, { level = "review", message = "area links to a page that is not tagged #area: " .. target })
    end
  end
  return issues
end

function lifeos.areaIssues(a, ctx)
  local issues = {}
  if a.status and not table.includes(lifeos.contract.projectStatus, a.status) then
    table.insert(issues, {
      level = "review",
      message = "unknown status '" .. tostring(a.status) .. "'",
    })
  end
  return issues
end
```

## Setup command
One command, and it only ever creates a page. Installing LifeOS changes no configuration of
yours; switching the journal over to the LifeOS daily template is a one-line edit you make
yourself (see [[Library/LifeOS]]), because a runtime `config.set` would not survive a reload
and the only path that does persist rewrites the whole configuration-manager block.
```space-lua
-- priority: 10
lifeos = lifeos or {}
command.define {
  name = "LifeOS: Today",
  run = function()
    editor.navigate("Library/LifeOS/Pages/Today")
  end
}

command.define {
  name = "LifeOS: Upcoming",
  run = function()
    editor.navigate("Library/LifeOS/Pages/Upcoming")
  end
}

command.define {
  name = "LifeOS: Projects",
  run = function()
    editor.navigate("Library/LifeOS/Pages/Projects")
  end
}

command.define {
  name = "LifeOS: Setup",
  run = function()
    local changes = {}
    local inboxPage = config.get("lifeos.inboxPage", "Inbox")
    if not space.pageExists(inboxPage) then
      space.writePage(
        inboxPage,
        "Captured items land here. Work through them with the `LifeOS: Process Inbox` command.\n\n"
      )
      table.insert(changes, "created page " .. inboxPage)
    end
    if #changes == 0 then
      editor.flashNotification("LifeOS is already set up")
    else
      editor.flashNotification("LifeOS setup: " .. table.concat(changes, ", "))
    end
  end
}
```
