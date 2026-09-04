---
description: Moving a project between its four states, and nothing else.
tags: meta
---

A project is `active`, `paused`, `completed` or `archived`. Four commands move between them:

```
Pause       active                        → paused
Complete    active | paused               → completed
Archive     anything not archived         → archived
Reactivate  paused | completed | archived → active
```

Each is an explicit decision you make, so there is no machinery beyond this table — no automatic
transitions, no derived states. `at-risk`, `stale` and `blocked` are not states; they are
[[Library/LifeLoop/Signals]], computed and never stored.

**Archiving is semantic only.** It sets `status: archived` and does not move or rename the page,
however much the word suggests otherwise. Where a file lives is a separate decision, and tying it
to a status would quietly put a project's identity back into its path.

# Implementation
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.lifecycle = lifeloop.lifecycle or {}

lifeloop.lifecycle.transitions = {
  { command = "LifeLoop: Pause Project", to = "paused",
    from = { "active" } },
  { command = "LifeLoop: Complete Project", to = "completed",
    from = { "active", "paused" } },
  { command = "LifeLoop: Archive Project", to = "archived",
    from = { "active", "paused", "completed" } },
  { command = "LifeLoop: Reactivate Project", to = "active",
    from = { "paused", "completed", "archived" } },
}

local function isProject(frontmatter)
  local tags = frontmatter.tags
  if type(tags) == "string" then
    return tags == "project" or string.find(tags, "project", 1, true) != nil
  end
  return table.includes(tags or {}, "project")
end

-- Patches `status` and nothing else. Returns ok, message.
function lifeloop.lifecycle.setStatus(pageName, target, allowedFrom)
  local text = lifeloop.readPageText(pageName)
  local frontmatter = index.extractFrontmatter(text).frontmatter or {}
  if not isProject(frontmatter) then
    return false, "this page is not a project"
  end
  local current = frontmatter.status or "active"
  if current == target then
    return false, "already " .. target
  end
  if allowedFrom and not table.includes(allowedFrom, current) then
    return false, "cannot go from " .. current .. " to " .. target
  end
  lifeloop.writePageText(pageName, index.patchFrontmatter(text, {
    { op = "set-key", path = "status", value = target },
  }))
  return true, target
end

for _, transition in ipairs(lifeloop.lifecycle.transitions) do
  command.define {
    name = transition.command,
    run = function()
      local ok, message = lifeloop.lifecycle.setStatus(
        editor.getCurrentPage(), transition.to, transition.from
      )
      editor.flashNotification(
        ok and ("Project " .. message) or ("Not changed: " .. message),
        ok and "info" or "error"
      )
    end
  }
end
```
