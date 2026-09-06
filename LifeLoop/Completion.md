---
description: Records when a task was completed, where that can be known reliably.
tags: meta
---

Weekly Review wants to answer "what did I finish this week?", and a task object records only
whether it is done, never when. LifeLoop fills that in by listening to SilverBullet's
`task:stateChange` event and writing the one fact that cannot be recomputed later:

```markdown
* [x] Benchmark survivor recovery [completed: "2026-09-03"]
```

# Two ways a task gets ticked
Ticking a checkbox **in the page** carries the task's exact position, and LifeLoop stamps at that
position. Ticking one **in a query result** -- Today, a dashboard, the Linked Tasks widget -- goes
through `index.updateTaskState`, which knows the task only by its `ref`.

Both are covered, by different routes. The ref route resolves the ref to a live page and range,
checks the source still says what it is expected to say, and only then writes. It never parses
`ref` as a position: a page carrying an anchor replaces `page@pos` with the anchor name, so a ref
is an identity and nothing else.

> **warning** The ref route needs a newer SilverBullet than 2.10.0, and its integration is not yet
> verified end to end
> It depends on `task:stateChange` carrying the ref, which 2.10.0 does not send — that release
> dispatches no event at all when a task is updated by reference. On a client without the change
> the branch never runs and completion behaves exactly as it always did: stamped when you tick in
> the page, silent when you tick in a query result. Nothing breaks and nothing is written wrongly;
> the dates are simply missing for those ticks, and that much *is* verified against 2.10.0.
>
> What has not been run is the whole chain in one patched client. Each half is tested on its own —
> the host change emits `{ref, oldState, newState}` after a successful write and nothing after a
> failed one, and the handler below does the right thing across every shape of that event — and
> the seam between them, an event reaching a Space Lua listener, is exercised for real by the
> in-page route. That is a strong argument rather than a demonstration, so treat the ref route as
> **implemented, integration verification pending** until someone ticks a box in Today on a client
> built with the change.

# What this deliberately does not do
LifeLoop does **not** scan pages for "done but unstamped" tasks to fill the remaining gap: a
completion date is a historical fact, and every task you finished before installing LifeLoop is
done-but-unstamped. Reconstructing it from current state would mean inventing history and writing
it into your notes.

The consequence is stated plainly wherever it shows: **Completed means "tasks with a recorded
completion date"**, not "everything you finished".

That boundary has a second edge. Where an external executor owns an action outright -- a recurring
reminder, say -- the occurrences it completes are its history, not LifeLoop's, and they do not
appear here. See [[Library/LifeLoop/External]].

# Implementation
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.completion = lifeloop.completion or {}

local COMPLETED_PATTERN = "%s*%[completed:[^%]]*%]"

function lifeloop.completion.isDone(state)
  if state == "x" or state == "X" then
    return true
  end
  local spec = config.get("taskStates", {})[state]
  return spec != nil and spec.done == true
end

-- A task's indexed range starts at its list marker and runs to the end of its *subtree*, so the
-- end of the range is not the end of the task -- for a task with children it is somewhere below
-- them. The task's own text is its first line, and that is what we edit.
local function taskLine(text, from)
  local newline = string.find(text, "\n", from + 1, true)
  local last = newline and (newline - 1) or #text
  return text:sub(from + 1, last)
end

-- Writing through the editor when the page is the one on screen: a whole-buffer setText would
-- throw away the cursor, and writing behind an open buffer would lose what it holds.
local function applyEdit(page, from, to, insert)
  if editor.getCurrentPage() == page then
    editor.dispatch { changes = { from = from, to = to, insert = insert } }
  else
    local text = space.readPage(page)
    space.writePage(page, text:sub(1, from) .. insert .. text:sub(to + 1))
  end
end

-- Stamps a task identified only by its ref. Every check below is an exit that writes nothing:
-- a source we cannot confirm is a source we leave alone.
function lifeloop.completion.stampByRef(ref, newState)
  local target = lifeloop.tasks.locate(ref)
  if not target then
    return false
  end

  if not lifeloop.pageExists(target.page) then
    return false
  end

  local from = target.pos
  local text = lifeloop.readPageText(target.page)
  local line = taskLine(text, from)

  -- The marker must now hold the state we were told about: that is the proof the write we are
  -- reacting to landed here, and not somewhere that has since shifted underneath us.
  --
  -- That is the whole verification, and it is worth being clear about its limit. The event names
  -- a ref and two states; it does not carry the task's text, so there is no way to tell "the task
  -- that was ticked" from "a different task that now sits at that ref in the same state". The
  -- guarantee is exactly as strong as the write being reacted to, which SilverBullet made after
  -- checking the old state at the same position -- no stronger, and nothing here pretends
  -- otherwise by matching on text the index may already have replaced.
  if lifeloop.tasks.marker(line) != newState then
    return false
  end

  local stampStart, stampEnd = string.find(line, COMPLETED_PATTERN)

  if lifeloop.completion.isDone(newState) then
    if stampStart then
      return false
    end
    local trimmed = line:gsub("%s+$", "")
    local insertAt = from + #trimmed
    applyEdit(target.page, insertAt, insertAt, ' [completed: "' .. lifeloop.date.today() .. '"]')
    return true
  elseif stampStart then
    -- Reopened: the stamp would now be claiming something untrue
    applyEdit(target.page, from + stampStart - 1, from + stampEnd, "")
    return true
  end
  return false
end

event.listen {
  name = "task:stateChange",
  run = function(e)
    if not config.get("lifeloop.stampCompletion", true) then
      return
    end
    local change = e.data
    if not change then
      return
    end

    -- A ref and no position: the tick came from a query result, and the ref is the only handle
    -- on which task it was.
    if change.ref then
      lifeloop.completion.stampByRef(change.ref, change.newState)
      return
    end

    -- No position either: an older client that cannot say which task it was.
    if change.from == nil or change.to == nil or not change.text then
      return
    end

    -- The event carries the task as it read *before* the edit: SilverBullet renders it from the
    -- parse tree it captured on the way in, so its state character is the old one while the buffer
    -- already holds the new one. Comparing the two as plain strings therefore never matches, and
    -- for a while this branch quietly did nothing on a real tick.
    --
    -- So compare the part that should not have changed -- everything after the checkbox -- and
    -- require the checkbox itself to now hold the state the event announced. That is a stricter
    -- check than the equality it replaces, not a looser one.
    local text = editor.getText()
    local wasState, wasRest = string.match(change.text, "^%[(.)%](.*)$")
    local nowState, nowRest = string.match(text:sub(change.from + 1, change.to), "^%[(.)%](.*)$")
    if not wasRest or not nowRest or wasRest != nowRest or nowState != change.newState then
      return
    end

    local stampStart, stampEnd = string.find(change.text, COMPLETED_PATTERN)

    if lifeloop.completion.isDone(change.newState) then
      if stampStart then
        return
      end
      editor.dispatch {
        changes = {
          from = change.to,
          to = change.to,
          insert = ' [completed: "' .. lifeloop.date.today() .. '"]',
        }
      }
    elseif stampStart then
      -- Reopened: the stamp would now be claiming something untrue
      editor.dispatch {
        changes = {
          from = change.from + stampStart - 1,
          to = change.from + stampEnd,
          insert = "",
        }
      }
    end
  end
}
```
