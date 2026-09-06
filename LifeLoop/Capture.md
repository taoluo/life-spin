---
description: LifeLoop capture and the Inbox lifecycle.
tags: meta
---

Capture has to cost less than filing does, so `LifeLoop: Capture` asks one question and writes one
line. No project, no area, no priority, no due date.

# Two capture modes
`lifeloop.captureMode` picks the backend, and the two deliberately behave differently, because they
are different primitives:

* **`inbox-page`** (default) — a prompt, one bullet appended to the `Inbox` page, no navigation.
  For an atomic thought you do not want to stop for.
* **`quick-note`** — hands straight over to SilverBullet's own `Quick Note`, which opens a fresh
  page under `Inbox/`. No prompt: the point of a quick note is that you write in the page. For a
  meeting fragment, a half-formed idea, something with structure.

Both land in the same inbox as far as processing is concerned.

# The Inbox has two shapes, and each has its own idea of "done"

| kind | still pending while… | processed by… |
|---|---|---|
| `item` — a bullet on the `Inbox` page | it sits above the `## Processed` heading | moving it under `## Processed` |
| `page` — a quick note under `Inbox/` | its name still starts with `Inbox/` | renaming it out of `Inbox/` |

That is the whole state machine, and both states are visible in the Markdown — there is no
hidden "processed" flag anywhere.

# Implementation

## Inbox reading
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.inbox = lifeloop.inbox or {}

-- On the table rather than a block-local: the mutation block below is a separate script and
-- would not see a local declared here.
lifeloop.inbox.processedHeading = "## Processed"

function lifeloop.inbox.page()
  return config.get("lifeloop.inboxPage", "Inbox")
end

-- 0-based offset where the "## Processed" line starts, or nil when the page has no such section
function lifeloop.inbox.processedOffset(content)
  if content:startsWith(lifeloop.inbox.processedHeading) then
    return 0
  end
  local newlinePos = string.find(content, "\n## Processed")
  if newlinePos then
    return newlinePos
  end
  return nil
end

-- Everything still waiting to be dealt with, from both sources.
-- Item entries carry `raw`: the exact source text of the whole list item, read from the page
-- rather than from the index, so that processing can verify nothing moved underneath it.
function lifeloop.inbox.pending()
  local pageName = lifeloop.inbox.page()
  local entries = {}

  if lifeloop.pageExists(pageName) then
    local content = lifeloop.readPageText(pageName)
    local cut = lifeloop.inbox.processedOffset(content)
    -- Tasks come through the operational universe so the "not inComment" rule lives in one
    -- place; plain items are not tasks, so they apply the same rule directly.
    local items = query[[
      from i = index.items()
      where i.page == pageName and not i.parent and not i.inComment
    ]]
    for _, collection in ipairs({ items, lifeloop.tasks.universe(pageName) }) do
      for _, item in ipairs(collection) do
        if (not item.parent) and (not cut or item.pos < cut) then
          table.insert(entries, {
            kind = "item",
            page = pageName,
            range = item.range,
            raw = content:sub(item.range[1] + 1, item.range[2]),
            name = item.name,
            isTask = item.tag == "task",
          })
        end
      end
    end
    table.sort(entries, function(a, b) return a.range[1] < b.range[1] end)
  end

  for _, page in ipairs(query[[from p = index.subPages(lifeloop.inbox.page()) order by p.name]]) do
    table.insert(entries, {
      kind = "page",
      page = page.name,
      name = page.name,
    })
  end

  return entries
end

function lifeloop.inbox.count()
  return #lifeloop.inbox.pending()
end
```

## Inbox writing
Every mutation below reads the page, decides on the complete new text, and writes once. An item
that no longer matches what was listed is left strictly alone.
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.inbox = lifeloop.inbox or {}

-- Adds a captured line above the Processed section (or at the end when there is none), so that
-- new captures never land in the pile that has already been dealt with.
function lifeloop.inbox.add(text)
  local pageName = lifeloop.inbox.page()
  local content = ""
  if lifeloop.pageExists(pageName) then
    content = lifeloop.readPageText(pageName)
  end
  local line = "* " .. string.trim(text)
  local offset = lifeloop.inbox.processedOffset(content)
  if not offset then
    lifeloop.appendToPage(pageName, line)
    return
  end
  local before = content:sub(1, offset)
  local after = content:sub(offset + 1)
  if before != "" and not before:endsWith("\n") then
    before = before .. "\n"
  end
  lifeloop.writePageText(pageName, before .. line .. "\n\n" .. after)
end

-- The single item mutation primitive.
--   opts.transform    function(rawChunk) -> rawChunk, applied before the move
--   opts.destination  "processed" (default) or "remove"
-- Operates on the item's whole source range, which for a Lezer ListItem includes its nested
-- sub-items -- a captured thought with three children moves as one thing or not at all.
function lifeloop.inbox.applyToItem(entry, opts)
  opts = opts or {}
  if entry.kind != "item" then
    return false, "not an inbox item"
  end
  local content = lifeloop.readPageText(entry.page)
  local chunk = content:sub(entry.range[1] + 1, entry.range[2])
  if chunk != entry.raw then
    return false, "this item changed since it was listed -- reopen the inbox and retry"
  end
  if opts.transform then
    chunk = opts.transform(chunk)
  end

  local before = content:sub(1, entry.range[1])
  local after = content:sub(entry.range[2] + 1)
  if after:startsWith("\n") then
    after = after:sub(2)
  end
  local remaining = before .. after

  if opts.destination == "remove" then
    lifeloop.writePageText(entry.page, remaining)
    return true
  end

  if not chunk:endsWith("\n") then
    chunk = chunk .. "\n"
  end
  local offset = lifeloop.inbox.processedOffset(remaining)
  local newText
  if offset then
    -- Insert directly below the heading line: most recently processed first
    local headingEnd = string.find(remaining, "\n", offset + 2)
    if not headingEnd then
      newText = remaining .. "\n" .. chunk
    else
      newText = remaining:sub(1, headingEnd) .. chunk .. remaining:sub(headingEnd + 1)
    end
  else
    if remaining != "" and not remaining:endsWith("\n") then
      remaining = remaining .. "\n"
    end
    newText = remaining .. "\n" .. lifeloop.inbox.processedHeading .. "\n" .. chunk
  end
  lifeloop.writePageText(entry.page, newText)
  return true
end

-- Renames a quick note out of Inbox/, which is what "processed" means for a page. Uses the
-- built-in rename so that links pointing at it follow along.
function lifeloop.inbox.promotePage(entry, newName)
  newName = string.trim(newName or "")
  if newName == "" then
    return false, "no name given"
  end
  if newName:startsWith(lifeloop.inbox.page() .. "/") then
    return false, "that name is still inside the inbox"
  end
  if lifeloop.pageExists(newName) then
    return false, "a page called '" .. newName .. "' already exists"
  end
  -- The guard above is the real one, now that it asks the store rather than a listing that lags.
  -- The native rename was relied on for that once, on the reasoning that it would throw on a
  -- collision -- but it can also decline to move anything and return quietly, which promotion
  -- then reported as success. Its exception is still turned into a clean refusal here; it is no
  -- longer what stands between you and an occupied page.
  local ok, err = pcall(function()
    system.invokeFunction("index.renamePageCommand", { oldPage = entry.page, page = newName })
  end)
  if not ok then
    return false, tostring(err)
  end
  return true
end
```

## Commands
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
command.define {
  name = "LifeLoop: Capture",
  run = function()
    if config.get("lifeloop.captureMode", "inbox-page") == "quick-note" then
      editor.invokeCommand("Quick Note")
      return
    end
    local text = string.trim(some(editor.prompt("Capture")) or "")
    if text == "" then
      return
    end
    lifeloop.inbox.add(text)
    editor.flashNotification("Captured to " .. lifeloop.inbox.page())
  end
}

command.define {
  name = "LifeLoop: Open Inbox",
  run = function()
    local pageName = lifeloop.inbox.page()
    if not lifeloop.pageExists(pageName) then
      space.writePage(pageName, "Captured items land here.\n\n")
    end
    editor.navigate(pageName)
  end
}
```
