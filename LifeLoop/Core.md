---
description: LifeLoop core — configuration, entity contracts, accessors and setup commands.
tags: meta
---

The foundation every other LifeLoop page builds on: configuration, the data contract for
Projects/Areas/People, and the accessors that read them back out of the object index.

# Entities
LifeLoop recognises three structured entities. They are identified by a **tag in frontmatter**,
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
LifeLoop defines a contract but does **not** enforce it globally: no `tag.define`, no schema
registered against `#project`, no validation hook that other libraries have to share. The
contract lives here as data, and `LifeLoop: Audit` reports violations.

| Entity | Attributes |
|---|---|
| Project | `tags` contains `project` (required) · `status` one of active/paused/completed/archived (default active) · `area` page link · `deadline` YYYY-MM-DD · `description` |
| Area | `tags` contains `area` · `status` |
| Person | `tags` contains `person` · `company` · `email` |
| Task | `deadline` / `scheduled` / `completed` as YYYY-MM-DD · `priority` high/normal/low |

If you *want* editor autocompletion and inline linting for these, paste the optional
`tag.define` snippet from [[Library/LifeLoop]] into your own `CONFIG` page — that is the place
SilverBullet wants tag definitions to live.

# Implementation

## Namespace and configuration
```space-lua
-- priority: 10
lifeloop = lifeloop or {}

config.defineCategory {
  name = "LifeLoop",
  description = "Markdown-first life management: capture, projects, tasks, weekly review.",
  priority = 20,
}

config.define("lifeloop", {
  description = "LifeLoop configuration",
  type = "object",
  properties = {
    inboxPage = {
      type = "string",
      default = "Inbox",
      description = "Page captured items are appended to.",
      ui = { category = "LifeLoop", label = "Inbox page", priority = 10 },
    },
    captureMode = {
      type = "string",
      default = "inbox-page",
      enum = { "inbox-page", "quick-note" },
      description = "Where 'LifeLoop: Capture' puts things: a bullet on the Inbox page, or a native Quick Note under Inbox/.",
      ui = { category = "LifeLoop", label = "Capture mode", priority = 9 },
    },
    reviewPrefix = {
      type = "string",
      default = "Reviews/",
      description = "Page-name prefix for weekly review pages (e.g. 'Reviews/2026-W36').",
      ui = { category = "LifeLoop", label = "Weekly review prefix", priority = 8 },
    },
    upcomingDays = {
      type = "number",
      default = 14,
      description = "How many days ahead the Upcoming page looks.",
      ui = { category = "LifeLoop", label = "Upcoming horizon (days)", priority = 7 },
    },
    stampCompletion = {
      type = "boolean",
      default = true,
      description = "Record a [completed: date] attribute when a task is ticked in the editor.",
      ui = { category = "LifeLoop", label = "Record completion dates", priority = 6 },
    },
    remindersList = {
      type = "string",
      default = "Reminders",
      description = "Apple Reminders list that 'LifeLoop: Add Reminder' adds to.",
      ui = { category = "LifeLoop", label = "Reminders list", priority = 3 },
    },
    projectLists = {
      type = "boolean",
      default = true,
      description = "Send a reminder to a list named after the task's project or area, creating that list the first time it is needed. Off sends everything to the configured Reminders list.",
      ui = { category = "LifeLoop", label = "One Reminders list per project", priority = 2.9 },
    },
    flagTags = {
      type = "array",
      items = { type = "string" },
      -- No `default = {}`: an empty Lua table serialises as a JSON object, which fails an "array"
      -- schema and takes the whole config.define -- and everything defined after it in this block,
      -- lifeloop.contract included -- down with it.
      description = "Tags that mark a projected reminder as flagged. Reminders has no tags of its own; this is the nearest thing it can sort by.",
      ui = { category = "LifeLoop", label = "Tags that flag a reminder", priority = 2.8 },
    },
    autoSync = {
      type = "boolean",
      default = false,
      description = "Periodically push edits to already-projected tasks. Only pushes when the note is newer than the reminder; a calendar event is pushed only while Calendar is already running.",
      ui = { category = "LifeLoop", label = "Sync projected tasks in the background", priority = 2.6 },
    },
    syncMinutes = {
      type = "number",
      default = 5,
      minimum = 1,
      description = "Minutes between background sync passes. Only runs while a SilverBullet client is open.",
      ui = { category = "LifeLoop", label = "Sync interval (minutes)", priority = 2.5 },
    },
    priorityTags = {
      type = "object",
      default = {},
      description = "Tag to Reminders priority (1-4 high, 5 medium, 6-9 low). The first tag on the task that appears here wins.",
      ui = { category = "LifeLoop", label = "Tag priorities", priority = 2.7 },
    },
    calendarName = {
      type = "string",
      default = "Calendar",
      description = "Calendar that 'LifeLoop: Add to Calendar' adds to. Point it at a Google calendar you have added to Apple Calendar and events land in Google.",
      ui = { category = "LifeLoop", label = "Calendar", priority = 2 },
    },
    eventMinutes = {
      type = "number",
      default = 60,
      description = "Default length of a timed event, in minutes. All-day events have no duration and never use this.",
      ui = { category = "LifeLoop", label = "Default event length (minutes)", priority = 1 },
    },
    journalMentions = {
      type = "number",
      default = 5,
      description = "How many journal entries mentioning a project to show on its page. 0 hides the section.",
      ui = { category = "LifeLoop", label = "Journal mentions shown", priority = 4 },
    },
    actionButtons = {
      type = "boolean",
      default = true,
      description = "Add Capture and Today buttons to the action bar. Turn off to leave the bar exactly as SilverBullet left it.",
      ui = { category = "LifeLoop", label = "Show action buttons", priority = 5 },
    },
  },
  additionalProperties = false,
})

-- The canonical vocabulary. Audit reports values outside these; nothing rejects them.
lifeloop.contract = {
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
lifeloop = lifeloop or {}
lifeloop.date = lifeloop.date or {}

local DAY_SECONDS = 60 * 60 * 24

function lifeloop.date.today()
  return os.date("%Y-%m-%d")
end

-- Normalises a value to "YYYY-MM-DD", or nil if it is not a valid calendar day
function lifeloop.date.day(value)
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
function lifeloop.date.shift(dayStr, days)
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
lifeloop = lifeloop or {}

-- "[[Some Page|alias]]" -> "Some Page". Returns nil for anything that isn't a string.
function lifeloop.linkTarget(value)
  if type(value) != "string" then
    return nil
  end
  local inner = string.match(value, "^%s*%[%[(.-)%]%]%s*$")
  if not inner then
    inner = value
  end
  return string.trim(string.split(inner, "|")[1])
end

-- Whether a page is really there.
--
-- `space.pageExists` consults a page listing that lags a just-written page: asked immediately
-- after writing thirty pages it answered "no" for eleven of them. Every guard in LifeLoop that
-- decides whether to create, overwrite or refuse rests on this question, and a wrong "no" means
-- appending to a page by replacing it, or promoting onto one that already has content.
--
-- Reading is authoritative -- the store either returns the page or throws -- so that is what the
-- guards ask. It costs a read of a page we were about to touch anyway.
function lifeloop.pageExists(pageName)
  return (pcall(function() return space.readPage(pageName) end))
end

-- Reads and writes go through the editor when the page in question is the one on screen:
-- writing behind an open buffer loses whatever the buffer holds. This is the same split
-- SilverBullet's own task and share code makes.
function lifeloop.readPageText(pageName)
  if editor.getCurrentPage() == pageName then
    return editor.getText()
  end
  return space.readPage(pageName)
end

function lifeloop.writePageText(pageName, text)
  if editor.getCurrentPage() == pageName then
    editor.setText(text)
  else
    space.writePage(pageName, text)
  end
end

-- Appends a line to a page, creating it when missing. Used by capture and inbox processing.
function lifeloop.appendToPage(pageName, line)
  local text = ""
  if lifeloop.pageExists(pageName) then
    text = lifeloop.readPageText(pageName)
  end
  if text != "" and not text:endsWith("\n") then
    text = text .. "\n"
  end
  lifeloop.writePageText(pageName, text .. line .. "\n")
end
```

## Entity accessors
```space-lua
-- priority: 10
lifeloop = lifeloop or {}

function lifeloop.projectStatus(p)
  return p.status or "active"
end

function lifeloop.projects(status)
  local all = query[[from p = index.pages("project") order by p.name]]
  if not status then
    return all
  end
  local out = {}
  for _, p in ipairs(all) do
    if lifeloop.projectStatus(p) == status then
      table.insert(out, p)
    end
  end
  return out
end

function lifeloop.areas()
  return query[[from a = index.pages("area") order by a.name]]
end

function lifeloop.people()
  return query[[from p = index.pages("person") order by p.name]]
end

-- name -> project object. Built once per view and passed down, so task attribution
-- never costs a query per task.
function lifeloop.projectSet()
  local set = {}
  for _, p in ipairs(lifeloop.projects()) do
    set[p.name] = p
  end
  return set
end

function lifeloop.areaSet()
  local set = {}
  for _, a in ipairs(lifeloop.areas()) do
    set[a.name] = a
  end
  return set
end
```

## Contract validation
`lifeloop.projectIssues` / `lifeloop.areaIssues` (and `lifeloop.tasks.issues` over in
[[Library/LifeLoop/Tasks]]) are the *only* places LifeLoop decides what is malformed. The Audit page
renders their output; it does not run checks of its own.
```space-lua
-- priority: 10
lifeloop = lifeloop or {}

-- Shared lookup tables, so a whole-space audit stays a handful of queries
function lifeloop.auditContext()
  local pageSet = {}
  for _, p in ipairs(query[[from p = index.pages() select p.name]]) do
    pageSet[p] = true
  end
  return {
    projectSet = lifeloop.projectSet(),
    areaSet = lifeloop.areaSet(),
    pageSet = pageSet,
  }
end

function lifeloop.projectIssues(p, ctx)
  ctx = ctx or lifeloop.auditContext()
  local issues = {}
  if p.status and not table.includes(lifeloop.contract.projectStatus, p.status) then
    table.insert(issues, {
      level = "review",
      message = "unknown status '" .. tostring(p.status) .. "'",
    })
  end
  if p.deadline != nil and not lifeloop.date.day(p.deadline) then
    table.insert(issues, {
      level = "safe",
      message = "deadline is not a YYYY-MM-DD date: " .. tostring(p.deadline),
    })
  end
  if p.area != nil then
    local target = lifeloop.linkTarget(p.area)
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

function lifeloop.areaIssues(a, ctx)
  local issues = {}
  if a.status and not table.includes(lifeloop.contract.projectStatus, a.status) then
    table.insert(issues, {
      level = "review",
      message = "unknown status '" .. tostring(a.status) .. "'",
    })
  end
  return issues
end
```

## Setup command
One command, and it only ever creates a page. Installing LifeLoop changes no configuration of
yours; switching the journal over to the LifeLoop daily template is a one-line edit you make
yourself (see [[Library/LifeLoop]]), because a runtime `config.set` would not survive a reload
and the only path that does persist rewrites the whole configuration-manager block.
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
command.define {
  name = "LifeLoop: Today",
  run = function()
    editor.navigate("Library/LifeLoop/Pages/Today")
  end
}

command.define {
  name = "LifeLoop: Upcoming",
  run = function()
    editor.navigate("Library/LifeLoop/Pages/Upcoming")
  end
}

command.define {
  name = "LifeLoop: Projects",
  run = function()
    editor.navigate("Library/LifeLoop/Pages/Projects")
  end
}

command.define {
  name = "LifeLoop: Setup",
  run = function()
    local changes = {}
    local inboxPage = config.get("lifeloop.inboxPage", "Inbox")
    if not lifeloop.pageExists(inboxPage) then
      space.writePage(
        inboxPage,
        "Captured items land here. Work through them with the `LifeLoop: Process Inbox` command.\n\n"
      )
      table.insert(changes, "created page " .. inboxPage)
    end
    if #changes == 0 then
      editor.flashNotification("LifeLoop is already set up")
    else
      editor.flashNotification("LifeLoop setup: " .. table.concat(changes, ", "))
    end
  end
}
```

## Action buttons
On a phone a keyboard shortcut is not an option, and hunting for a command through a menu costs more
than the capture was worth. Two buttons fix that, so LifeLoop adds them on load.

`actionButton.define` *appends* to your action bar rather than replacing it, so nothing you have
configured yourself moves or disappears — Capture and Today arrive after whatever is already there.
That is what makes adding them on load acceptable: it costs you two slots, never a button you
placed yourself, and `lifeloop.actionButtons = false` takes both back.

`dropdown = false` on Capture keeps it out of the mobile overflow menu. That is the whole point —
`open → capture → leave` cannot afford the extra tap, while Today is a place you are going anyway
and can live in the menu.
```space-lua
-- priority: 10
lifeloop = lifeloop or {}

if config.get("lifeloop.actionButtons", true) then
  actionButton.define {
    icon = "inbox",
    command = "LifeLoop: Capture",
    description = "Capture",
    dropdown = false,
  }

  actionButton.define {
    icon = "calendar",
    command = "LifeLoop: Today",
    description = "Today",
  }
end
```
