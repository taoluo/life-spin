---
description: Journal entries that mentioned this project, newest first.
tags: meta
---

The Journal records what happened; a project page records where things stand. The bridge between
them is ordinary linking: write `[[Projects/RS Recovery]]` in today's entry and the project has
gained a dated piece of evidence.

SilverBullet's own Linked Mentions already shows that, and this does not replace it. The delta is
three things and only three:

* **journal pages only** — meeting notes and other projects linking here are someone else's answer
* **ordered by when it happened**, not when the file was last touched
* **the surrounding line**, so you can tell what you said without opening it

# What a row claims
A journal entry **mentioned** this project on a date. That is all the evidence supports, and the
heading says exactly that.

It is not "project activity" — you might have written the project's name while deciding *not* to
work on it. It is not a health signal, and nothing here is written back to the project page. The
project's own account of where things stand is yours to keep current; this only tells you when you
last said anything and what it was.

# Where the date comes from
The journal entry's own date, in this order:

1. the `date` in its frontmatter — what the LifeLoop daily template writes
2. a `YYYY-MM-DD` in the page name — the shape `journal.prefix` produces

An entry with neither has no event date, and sorts last rather than borrowing the file's
`lastModified`. That timestamp is a fact about the file — it moves when you fix a typo — and using
it would quietly turn "when this happened" into "when I last touched this", which is the kind of
substitution the ownership rules exist to prevent.

# Commented-out links
A link inside an HTML comment never appears here, and LifeLoop does nothing to arrange that:
SilverBullet does not index it at all. That is worth knowing because it differs from tasks — a
commented *task* **is** indexed and carries `inComment`, which is why the task universe has to
exclude it deliberately. Links need no such filter.

# Configuration
`lifeloop.journalMentions` — how many entries to show, default 5. Set it to `0` and the section
does not appear at all.

# Implementation

## Finding the mentions
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.journal = lifeloop.journal or {}

-- The entry's own date, never the file's timestamp. nil when the entry does not say.
function lifeloop.journal.day(page)
  local stated = lifeloop.date.day(page.date)
  if stated then
    return stated
  end
  local inName = string.match(page.name or "", "(%d%d%d%d%-%d%d%-%d%d)")
  return inName and lifeloop.date.day(inName) or nil
end

-- index.pages() hands back a lazy collection rather than a list, so it goes through a query to be
-- iterated. The tag is whatever `journal.tag` says, since the journal is SilverBullet's feature
-- and its configuration is the authority on what counts as one.
function lifeloop.journal.pageSet()
  local tag = config.get("journal.tag", "journal")
  local set = {}
  for _, p in ipairs(query[[from p = index.pages(tag)]]) do
    set[p.name] = p
  end
  return set
end

-- A snippet is a slice of someone's prose: it can run to several lines and carry the link markup
-- itself. Flattened to one line here, because a row that wraps to five defeats the point of
-- being able to scan the list.
local function oneLine(text, width)
  local flat = string.gsub(text or "", "%s+", " ")
  flat = string.trim(flat)
  if #flat > width then
    flat = string.sub(flat, 1, width - 1) .. "…"
  end
  return flat
end

-- A commented-out link is not a mention. Parking a thought by wrapping it in `<!-- -->` has to mean
-- the project stops hearing about it, or the comment is not a park at all.
--
-- Tasks get this for free: they carry `inComment`, and `lifeloop.tasks.universe` filters on it. An
-- indexed *link* carries no such flag, so the comment spans have to be found in the page text and
-- the link's position tested against them. Positions are editor offsets (0-based) while Lua string
-- indices are 1-based, hence the shifts.
--
-- An unterminated `<!--` swallows the rest of the page, which is what the parser does too: text
-- after an unclosed comment is inside it.
local function commentSpans(text)
  local spans = {}
  local from = 1
  while true do
    local openStart = string.find(text, "<!%-%-", from)
    if not openStart then
      break
    end
    local _, closeEnd = string.find(text, "%-%->", openStart + 4)
    local stop = closeEnd or #text
    table.insert(spans, { openStart - 1, stop })
    from = stop + 1
  end
  return spans
end

local function insideComment(spans, pos)
  for _, span in ipairs(spans) do
    if pos >= span[1] and pos < span[2] then
      return true
    end
  end
  return false
end

-- Journal pages linking to `pageName`, most recent first, undated last.
function lifeloop.journal.mentions(pageName, limit)
  local journals = lifeloop.journal.pageSet()
  local out = {}
  -- One read per journal page that actually links here, not one per link.
  local spansByPage = {}
  for _, link in ipairs(query[[from l = index.links() where l.toPage == pageName]]) do
    local journal = journals[link.page]
    if journal then
      if spansByPage[link.page] == nil then
        spansByPage[link.page] = commentSpans(lifeloop.readPageText(link.page) or "")
      end
      if not insideComment(spansByPage[link.page], link.pos) then
        table.insert(out, {
          page = link.page,
          day = lifeloop.journal.day(journal),
          snippet = oneLine(link.snippet, 120),
        })
      end
    end
  end
  table.sort(out, function(a, b)
    if a.day == b.day then
      return a.page < b.page
    end
    -- Undated entries have no place on a timeline, so they go to the end rather than to 1970.
    if not a.day then return false end
    if not b.day then return true end
    return a.day > b.day
  end)
  if limit and #out > limit then
    local trimmed = {}
    for i = 1, limit do
      trimmed[i] = out[i]
    end
    return trimmed
  end
  return out
end
```

## Rendering it
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.views = lifeloop.views or {}

-- Returns nil when there is nothing to show, so a caller supplies its own empty line -- the same
-- contract as the other projections. Knows nothing about where it is displayed.
function lifeloop.views.journalMentions(pageName, limit)
  local mentions = lifeloop.journal.mentions(pageName, limit)
  if #mentions == 0 then
    return nil
  end
  local rows = {}
  for _, m in ipairs(mentions) do
    table.insert(rows, "* " .. (m.day or "_undated_") .. " · [[" .. m.page .. "]]"
      .. (m.snippet != "" and (" — " .. m.snippet) or ""))
  end
  return table.concat(rows, "\n") .. "\n"
end
```

## Showing it on a project page
```space-lua
-- priority: 10
lifeloop = lifeloop or {}

-- A bottom widget rather than a line in the project template: this is a view of the index, and
-- writing it into every project's Markdown would make a projection into permanent structure.
-- Nothing is returned for any page that is not an active-contract project, so it appears where it
-- means something and nowhere else.
event.listen {
  name = "hooks:renderBottomWidgets",
  run = function()
    local limit = config.get("lifeloop.journalMentions", 5)
    if limit == 0 then
      return
    end
    local page = editor.getCurrentPage()
    if not lifeloop.projectSet()[page] then
      return
    end
    local body = lifeloop.views.journalMentions(page, limit)
    if not body then
      return
    end
    return widget.new {
      markdown = "# Journal mentions\n" .. body,
    }
  end
}
```
