---
description: Working through the inbox — one entry at a time, with nothing half-done.
tags: meta
---

`LifeLoop: Process Inbox` walks what is still pending and asks what to do with each entry. Every
action either completes and takes the entry out of pending, or changes nothing at all.

# Items and pages are not the same thing
A bullet on the Inbox page and a quick note under `Inbox/` get **different menus**, because "turn
this note into a task" has no natural answer — create a task pointing at it? convert its first
line? move the whole thing into a project? — and one generic action model would have to invent an
answer that is wrong half the time.

| a bullet | a quick note |
|---|---|
| Keep · Make task · **Link project** · Move to project · Create project · Create person · Archive · Delete | Keep · **Promote** · Link project and promote · Make it a project · Make it a person · Archive · Delete |

Link is the default rather than Move. The wording you captured stays where it happened — the
meeting, the journal — and the project page picks it up through SilverBullet's own Linked Tasks
and Linked Mentions. Moving text into the project is the exception, not the rule.

# Nothing half-done
Composite actions — create a project, link to it, mark the source processed — check every
precondition before performing any of them. A cancelled prompt, a name collision or an item that
moved since it was listed leaves the entry exactly as pending as it was.

One honest limit: moving text between two pages is two writes, and no library-level code can make
those atomic. The order is chosen so the failure mode is a duplicate rather than a loss — the
destination is written first, and only then is the source removed.

# Implementation

## Choosing a project
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.inbox = lifeloop.inbox or {}

-- Returns a project page name, or nil when the user backs out
function lifeloop.inbox.pickProject()
  local options = {}
  for _, p in ipairs(lifeloop.projects("active")) do
    table.insert(options, { name = p.name })
  end
  if #options == 0 then
    editor.flashNotification("No active projects to link to", "error")
    return nil
  end
  local selected = editor.filterBox("Project", options, "Which project?")
  if not selected then
    return nil
  end
  return selected.name
end

-- The first ATX heading in a page, falling back to its last path segment. Used as the suggested
-- name when promoting a quick note -- a suggestion, never an inferred destination.
function lifeloop.inbox.suggestedName(pageName)
  local text = space.readPage(pageName)
  local heading = string.match(text, "\n#+%s+([^\n]+)") or string.match(text, "^#+%s+([^\n]+)")
  if heading then
    return string.trim(heading)
  end
  local parts = string.split(pageName, "/")
  return parts[#parts]
end
```

## Actions on a bullet
Each one is a named function so it can be driven without the picker.
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.inbox = lifeloop.inbox or {}

function lifeloop.inbox.makeTask(entry)
  return lifeloop.inbox.applyToItem(entry, {
    transform = function(chunk)
      -- Only the first line becomes a checkbox; nested children stay as they are
      return (string.gsub(chunk, "^(%s*[-*+])%s+", "%1 [ ] ", 1))
    end
  })
end

function lifeloop.inbox.linkProject(entry, projectName)
  if not projectName then
    return false, "no project chosen"
  end
  local link = "[[" .. projectName .. "]]"
  return lifeloop.inbox.applyToItem(entry, {
    transform = function(chunk)
      if string.find(chunk, link, 1, true) then
        return chunk
      end
      local firstLineEnd = string.find(chunk, "\n")
      if not firstLineEnd then
        return chunk .. " " .. link
      end
      return chunk:sub(1, firstLineEnd - 1) .. " " .. link .. chunk:sub(firstLineEnd)
    end
  })
end

-- Two pages, so two writes. Everything is validated first, and the destination is written before
-- the source is cleared: a failure in between leaves a duplicate, never a hole.
function lifeloop.inbox.moveToProject(entry, projectName)
  if not projectName then
    return false, "no project chosen"
  end
  if not space.pageExists(projectName) then
    return false, "no such page: " .. projectName
  end
  local content = lifeloop.readPageText(entry.page)
  if content:sub(entry.range[1] + 1, entry.range[2]) != entry.raw then
    return false, "this item changed since it was listed -- reopen the inbox and retry"
  end
  lifeloop.appendToPage(projectName, string.trim(entry.raw))
  return lifeloop.inbox.applyToItem(entry, { destination = "remove" })
end

function lifeloop.inbox.archiveItem(entry)
  local content = lifeloop.readPageText(entry.page)
  if content:sub(entry.range[1] + 1, entry.range[2]) != entry.raw then
    return false, "this item changed since it was listed -- reopen the inbox and retry"
  end
  lifeloop.appendToPage("Archive/Inbox", string.trim(entry.raw))
  return lifeloop.inbox.applyToItem(entry, { destination = "remove" })
end

function lifeloop.inbox.deleteItem(entry)
  return lifeloop.inbox.applyToItem(entry, { destination = "remove" })
end

-- Creates the entity page, then links the item to it. The page is checked for existence before
-- anything is written, so a collision costs nothing.
function lifeloop.inbox.createEntity(entry, tag, pageName)
  pageName = string.trim(pageName or "")
  if pageName == "" then
    return false, "no name given"
  end
  if space.pageExists(pageName) then
    return false, "a page called '" .. pageName .. "' already exists"
  end
  local frontmatter = "---\ntags: " .. tag .. "\n"
  if tag == "project" then
    frontmatter = frontmatter .. "status: active\n"
  end
  frontmatter = frontmatter .. "---\n"
  space.writePage(pageName, frontmatter)
  if entry.kind == "item" then
    return lifeloop.inbox.linkProject(entry, pageName)
  end
  return true, "created " .. pageName
end
```

## Actions on a quick note
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.inbox = lifeloop.inbox or {}

function lifeloop.inbox.linkAndPromote(entry, projectName, newName)
  if not projectName or not newName or string.trim(newName) == "" then
    return false, "cancelled"
  end
  if space.pageExists(newName) then
    return false, "a page called '" .. newName .. "' already exists"
  end
  -- Promote first: a rename that fails must leave the note exactly as it was, and adding the
  -- link beforehand would leave an annotated note still sitting in the inbox.
  local ok, message = lifeloop.inbox.promotePage(entry, newName)
  if not ok then
    return false, message
  end
  local text = space.readPage(newName)
  local link = "[[" .. projectName .. "]]"
  if not string.find(text, link, 1, true) then
    space.writePage(newName, text .. "\n" .. link .. "\n")
  end
  return true, "promoted and linked"
end

-- Turns the note itself into an entity page: adds the tag, then moves it out of Inbox/.
function lifeloop.inbox.promoteToEntity(entry, tag, newName)
  newName = string.trim(newName or "")
  if newName == "" then
    return false, "no name given"
  end
  if space.pageExists(newName) then
    return false, "a page called '" .. newName .. "' already exists"
  end
  -- Same ordering as above: rename first, tag the page afterwards.
  local ok, message = lifeloop.inbox.promotePage(entry, newName)
  if not ok then
    return false, message
  end
  local patches = { { op = "set-key", path = "tags", value = tag } }
  if tag == "project" then
    table.insert(patches, { op = "set-key", path = "status", value = "active" })
  end
  space.writePage(newName, index.patchFrontmatter(space.readPage(newName), patches))
  return true, "promoted to " .. tag
end

function lifeloop.inbox.archivePage(entry)
  local parts = string.split(entry.page, "/")
  return lifeloop.inbox.promotePage(entry, "Archive/Inbox/" .. parts[#parts])
end

function lifeloop.inbox.deletePage(entry)
  space.deletePage(entry.page)
  return true, "deleted"
end
```

## The menus
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.inbox = lifeloop.inbox or {}

function lifeloop.inbox.actionsFor(entry)
  if entry.kind == "page" then
    return {
      { name = "Keep", keep = true },
      { name = "Promote", run = function(e)
        return lifeloop.inbox.promotePage(e, some(editor.prompt("Promote page as", lifeloop.inbox.suggestedName(e.page))))
      end },
      { name = "Link project and promote", run = function(e)
        local project = lifeloop.inbox.pickProject()
        if not project then return false, "cancelled" end
        return lifeloop.inbox.linkAndPromote(e, project,
          some(editor.prompt("Promote page as", lifeloop.inbox.suggestedName(e.page))))
      end },
      { name = "Make it a project", run = function(e)
        return lifeloop.inbox.promoteToEntity(e, "project",
          some(editor.prompt("Project page name", "Projects/" .. lifeloop.inbox.suggestedName(e.page))))
      end },
      { name = "Make it a person", run = function(e)
        return lifeloop.inbox.promoteToEntity(e, "person",
          some(editor.prompt("Person page name", "People/" .. lifeloop.inbox.suggestedName(e.page))))
      end },
      { name = "Archive", run = lifeloop.inbox.archivePage },
      { name = "Delete", run = lifeloop.inbox.deletePage },
    }
  end
  return {
    { name = "Keep", keep = true },
    { name = "Link project", run = function(e)
      return lifeloop.inbox.linkProject(e, lifeloop.inbox.pickProject())
    end },
    { name = "Make task", run = lifeloop.inbox.makeTask },
    { name = "Move to project", run = function(e)
      return lifeloop.inbox.moveToProject(e, lifeloop.inbox.pickProject())
    end },
    { name = "Create project", run = function(e)
      return lifeloop.inbox.createEntity(e, "project", some(editor.prompt("Project page name", "Projects/")))
    end },
    { name = "Create person", run = function(e)
      return lifeloop.inbox.createEntity(e, "person", some(editor.prompt("Person page name", "People/")))
    end },
    { name = "Archive", run = lifeloop.inbox.archiveItem },
    { name = "Delete", run = lifeloop.inbox.deleteItem },
  }
end
```

## The walk
Ranges shift as soon as an item moves, so the loop re-reads what is pending after every action
rather than working from a list captured at the start.
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
command.define {
  name = "LifeLoop: Process Inbox",
  run = function()
    local kept = {}
    while true do
      mq.awaitEmptyQueue("indexQueue")
      local entry
      for _, candidate in ipairs(lifeloop.inbox.pending()) do
        local id = candidate.kind == "page" and candidate.page or (candidate.page .. "\0" .. candidate.raw)
        if not kept[id] then
          entry = candidate
          entry.id = id
          break
        end
      end
      if not entry then
        editor.flashNotification("Inbox processed")
        return
      end

      local label = entry.kind == "page" and ("note: " .. entry.page) or (entry.name or "(empty)")
      local choice = editor.filterBox("Action", lifeloop.inbox.actionsFor(entry), label)
      if not choice then
        return
      end
      if choice.keep then
        kept[entry.id] = true
      else
        local ok, message = choice.run(entry)
        if not ok then
          editor.flashNotification(message or "nothing changed", "error")
          kept[entry.id] = true
        end
      end
    end
  end
}
```
