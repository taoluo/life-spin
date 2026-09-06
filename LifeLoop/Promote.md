---
description: Giving one task a page of its own, without changing what a task is.
tags: meta
---

Almost every task is one line and should stay one line. A few are not: the ones that accumulate
notes, links to artifacts, who else is involved, what was tried, what came back. Those need
somewhere to put it.

`LifeLoop: Promote Task` gives the task under the cursor a page, and **the task stays an ordinary
checkbox**:

```markdown
* [ ] [[Notes/Benchmark survivor recovery]] Benchmark recovery [deadline: "2026-09-08"]
```

It is still indexed as a task, still appears in Today, still belongs to the same project, still
ticks and stamps like any other. It has simply gained a link. Nothing was migrated, and no second
kind of task now exists to keep working.

# What ordinary tasks pay
Nothing. No id, no parent pointer, no status field, no frontmatter — not on the promoted task and
not on the thousands that will never be promoted. That is the whole point of doing it this way, and
it is why there is no schema here to describe: the destination page is a page. Put on it whatever
the work turns out to need.

# Provenance is not written down
The destination gets a `## Context` heading and nothing else. In particular it gets **no
`From [[the source page]]` line**, because the source task already links to it — SilverBullet's own
Linked Mentions and Linked Tasks show where it came from and the live task itself.

Writing the reverse link would persist a second copy of a relationship the structure already
yields, which is the tax that "context is metadata" exists to refuse.

# When it half-fails
Creating a page and rewriting a line in another page cannot be one atomic act, so this says what
happens instead of hoping.

Every precondition is checked before anything is written: a task under the cursor, a destination you
supplied, a name not already taken, and a source line that still says what the index said it said.
Cancel or fail any of those and nothing has happened anywhere.

Past that point the destination is created first, because a failure then leaves a page you can
delete rather than a task you have lost. If the source rewrite does fail, the new page is removed —
but **only if it is still byte-identical to what LifeLoop just wrote.** If something else has
touched it in between, it stays, and the command names it. Either way the command reports failure.
Quietly reporting success while leaving an orphan behind is the outcome this rule exists to
prevent.

# Is this worth keeping?
An experiment, with the condition for deleting it written down first: **if the main thing it
produces is one nearly-empty Markdown file per ordinary task, it goes.** The evidence that it earns
its place is promoted pages that accumulate content which genuinely would not have fitted on a
line. Check at the next review, and be willing to lose it.

# Implementation
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.promote = lifeloop.promote or {}

lifeloop.promote.body = "## Context\n\n"

-- Returns ok, message. Every early return is a state in which nothing has been written anywhere.
function lifeloop.promote.task(task, destination)
  if not task or not task.range then
    return false, "no task to promote"
  end
  destination = string.trim(destination or "")
  if destination == "" then
    return false, "no name given"
  end
  if lifeloop.pageExists(destination) then
    return false, destination .. " already exists"
  end

  -- The line the index described has to still be there. A task's range covers its children, so
  -- only its own first line is read: that is where the checkbox and the text are.
  local text = lifeloop.readPageText(task.page)
  local from = task.range[1]
  local newline = string.find(text, "\n", from + 1, true)
  local line = text:sub(from + 1, (newline and (newline - 1)) or #text)
  local _, markerEnd = lifeloop.tasks.marker(line)
  if not markerEnd then
    return false, "that line is not a task any more -- reopen the page and retry"
  end
  if task.name and task.name != "" and not string.find(line, task.name, 1, true) then
    return false, "that task changed since it was read -- reopen the page and retry"
  end

  -- Destination first: a failure after this leaves a page to delete rather than a task to lose.
  space.writePage(destination, lifeloop.promote.body)

  local link = " [[" .. destination .. "]]"
  local ok = pcall(function()
    lifeloop.writePageText(task.page,
      text:sub(1, from + markerEnd) .. link .. text:sub(from + markerEnd + 1))
  end)
  if not ok then
    -- Only reclaim what is provably still ours. Something else may have written to that name in
    -- between, and deleting someone's content to tidy up after ourselves would be far worse than
    -- leaving a stray page behind.
    if space.readPage(destination) == lifeloop.promote.body then
      space.deletePage(destination)
      return false, "could not update the task; nothing was kept"
    end
    return false, "could not update the task, and " .. destination
      .. " has changed since it was created -- it has been left alone"
  end

  return true, destination
end

command.define {
  name = "LifeLoop: Promote Task",
  run = function()
    local task = lifeloop.tasks.atCursor()
    if not task then
      editor.flashNotification("Put the cursor on a task first", "error")
      return
    end
    -- No default and no folder convention: where this belongs is a judgement about the work, and
    -- guessing it from a path would be LifeLoop deciding what your folders mean.
    local destination = some(editor.prompt("Page for this task"))
    if destination == nil then
      return
    end
    local ok, message = lifeloop.promote.task(task, destination)
    if ok then
      editor.flashNotification("Promoted to " .. message)
      editor.navigate(message)
    else
      editor.flashNotification("Not promoted: " .. message, "error")
    end
  end
}
```
