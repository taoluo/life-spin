---
description: Deterministic checks on the contract LifeOS itself promised.
tags: meta
---

Audit answers one question: **is anything violating a rule LifeOS actually made?** Not whether
you are using SilverBullet the LifeOS way.

So it checks unknown project statuses, area links that point at a missing page or one that is not
an area, and malformed LifeOS dates and priorities. It deliberately does not check:

* **arbitrary task attributes** — `[cost: 3]` on a task is exactly the extensibility that makes
  SilverBullet worth using, and the built-in task schema is `additionalProperties: true`
* **duplicate project names** — the native `index.ambiguousLinks()` answers the sharper question
  of which link actually fails to resolve, and it is already on
  [[Library/Std/Pages/Maintenance]]
* **folder conventions** — a project under `Notes/` is not a mistake; path is not identity
* **signals** — `No actionable task` is an observation about a project, not a broken contract.
  Those live on [[Library/LifeOS/Pages/Projects]], and mixing them in here would turn a list of
  things that are *wrong* into a list of things that are merely *true*

It reports and never fixes. An automatic repair needs a rule confident enough to run unattended,
and none of these are.

# Implementation
```space-lua
-- priority: 10
lifeos = lifeos or {}
lifeos.audit = lifeos.audit or {}

-- Every violation, grouped by how much judgement the fix needs.
-- Returns { safe = {...}, review = {...} }, each entry { page, message }.
function lifeos.audit.run()
  local ctx = lifeos.auditContext()
  local safe, review = {}, {}

  local function collect(ref, label, issues)
    for _, issue in ipairs(issues) do
      local entry = { ref = ref, label = label, message = issue.message }
      if issue.level == "safe" then
        table.insert(safe, entry)
      else
        table.insert(review, entry)
      end
    end
  end

  for _, p in ipairs(lifeos.projects()) do
    collect(p.name, p.name, lifeos.projectIssues(p, ctx))
  end
  for _, a in ipairs(lifeos.areas()) do
    collect(a.name, a.name, lifeos.areaIssues(a, ctx))
  end
  for _, t in ipairs(lifeos.tasks.universe()) do
    -- A task's ref is "page@offset": the link has to be the ref to land on the right line, but
    -- what you read should be the task itself.
    collect(lifeos.tasks.linkRef(t), t.name, lifeos.tasks.issues(t))
  end

  return { safe = safe, review = review }
end

function lifeos.audit.render()
  local result = lifeos.audit.run()
  local total = #result.safe + #result.review
  if total == 0 then
    return "_Nothing violates the LifeOS contract._\n"
  end
  local out = {
    "**" .. total .. " issue" .. (total == 1 and "" or "s") .. "** — "
      .. #result.safe .. " safe to fix, " .. #result.review .. " need a decision\n",
  }
  for _, group in ipairs({ { "Need a decision", result.review }, { "Safe", result.safe } }) do
    if #group[2] > 0 then
      table.insert(out, "\n# " .. group[1] .. "\n")
      for _, entry in ipairs(group[2]) do
        table.insert(out, "* [[" .. entry.ref .. "|" .. entry.label .. "]] — " .. entry.message .. "\n")
      end
    end
  end
  return table.concat(out)
end

command.define {
  name = "LifeOS: Audit",
  run = function()
    editor.navigate("Library/LifeOS/Pages/Audit")
  end
}
```
