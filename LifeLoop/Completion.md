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

# What this deliberately does not do
The event arrives in two shapes. Ticking a checkbox **in the page** carries the task's exact
position. Ticking one **in a query result** — Today, a dashboard, the Linked Tasks widget — goes
through `index.cycleTaskStateByRef`, and that path dispatches only the new state: there is no way
to tell which of your tasks it was.

So LifeLoop stamps the first case and stays out of the second. It does **not** scan pages for
"done but unstamped" tasks to fill the gap: a completion date is a historical fact, and every
task you finished before installing LifeLoop is done-but-unstamped. Reconstructing it from current
state would mean inventing history and writing it into your notes.

The consequence is stated plainly wherever it shows: **Completed means "tasks with a recorded
completion date"**, not "everything you finished".

> **note** The known gap
> Covering query-view ticks would mean LifeLoop rendering Today's checkboxes itself and, on click,
> resolving `task.ref` to a live position, verifying the state text still matches, and writing the
> new state and the timestamp in one go — never parsing `ref` as a location, since a page with an
> anchor replaces `page@pos` with the anchor name. That is recorded in the project's `DESIGN.md`
> as a backlog item, not scheduled. This version is the shipped behaviour, not a placeholder.

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

event.listen {
  name = "task:stateChange",
  run = function(e)
    if not config.get("lifeloop.stampCompletion", true) then
      return
    end
    local change = e.data
    -- No position means the tick came from a query result: we cannot know which task it was.
    if not change or change.from == nil or change.to == nil or not change.text then
      return
    end

    -- The event fires straight after the state edit, so the range should still hold the text we
    -- were handed. If it does not, something else moved underneath us: leave it alone.
    local text = editor.getText()
    if text:sub(change.from + 1, change.to) != change.text then
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
