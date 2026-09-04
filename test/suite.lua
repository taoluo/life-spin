-- LifeLoop acceptance suite. Runs inside a real SilverBullet client (see test/verify.sh).
-- One round trip for the whole suite: each test is pcall'ed, so a Lua error is a failure rather
-- than the end of the run.
local results = {}
local section = ""

local function group(name)
  section = name
end

local function test(name, fn)
  local ok, value = pcall(fn)
  if not ok then
    table.insert(results, { section = section, name = name, ok = false, detail = tostring(value) })
    return
  end
  table.insert(results, {
    section = section,
    name = name,
    ok = value ~= nil and value.ok == true,
    detail = (value ~= nil and value.ok == true) and nil or (value and value.detail or "no result"),
  })
end



group("module loading")

-- Space Lua orders same-priority blocks by their "page@offset" *string*, so "@11161" sorts before
-- "@2398". A block that assumed an earlier block had already created its namespace silently
-- stopped loading the day its file grew past 10000 bytes. Every block guards its own namespace
-- now; this asserts the whole public surface actually made it in.
test("every module loaded", function()
  local expected = {
    ["lifeloop.date.day"] = lifeloop.date and lifeloop.date.day,
    ["lifeloop.projects"] = lifeloop.projects,
    ["lifeloop.projectIssues"] = lifeloop.projectIssues,
    ["lifeloop.auditContext"] = lifeloop.auditContext,
    ["lifeloop.readPageText"] = lifeloop.readPageText,
    ["lifeloop.tasks.universe"] = lifeloop.tasks and lifeloop.tasks.universe,
    ["lifeloop.tasks.actionable"] = lifeloop.tasks and lifeloop.tasks.actionable,
    ["lifeloop.tasks.buckets"] = lifeloop.tasks and lifeloop.tasks.buckets,
    ["lifeloop.tasks.upcoming"] = lifeloop.tasks and lifeloop.tasks.upcoming,
    ["lifeloop.tasks.issues"] = lifeloop.tasks and lifeloop.tasks.issues,
    ["lifeloop.tasks.toggleTag"] = lifeloop.tasks and lifeloop.tasks.toggleTag,
    ["lifeloop.tasks.render"] = lifeloop.tasks and lifeloop.tasks.render,
    ["lifeloop.inbox.pending"] = lifeloop.inbox and lifeloop.inbox.pending,
    ["lifeloop.inbox.applyToItem"] = lifeloop.inbox and lifeloop.inbox.applyToItem,
    ["lifeloop.inbox.makeTask"] = lifeloop.inbox and lifeloop.inbox.makeTask,
    ["lifeloop.inbox.actionsFor"] = lifeloop.inbox and lifeloop.inbox.actionsFor,
    ["lifeloop.review.freeze"] = lifeloop.review and lifeloop.review.freeze,
    ["lifeloop.views.today"] = lifeloop.views and lifeloop.views.today,
    ["lifeloop.views.upcoming"] = lifeloop.views and lifeloop.views.upcoming,
    ["lifeloop.signals.forProject"] = lifeloop.signals and lifeloop.signals.forProject,
    ["lifeloop.lifecycle.setStatus"] = lifeloop.lifecycle and lifeloop.lifecycle.setStatus,
    ["lifeloop.audit.run"] = lifeloop.audit and lifeloop.audit.run,
    ["lifeloop.week"] = lifeloop.week,
  }
  local missing = {}
  for name, value in pairs(expected) do
    if type(value) ~= "function" then table.insert(missing, name) end
  end
  return { ok = #missing == 0, detail = missing }
end)

test("every LifeLoop command is registered", function()
  local found = {}
  for name, _ in pairs(system.listCommands()) do
    if name:startsWith("LifeLoop") then found[name] = true end
  end
  local expected = {
    "LifeLoop: Capture", "LifeLoop: Open Inbox", "LifeLoop: Process Inbox", "LifeLoop: Setup",
    "LifeLoop: Today", "LifeLoop: Upcoming", "LifeLoop: Projects", "LifeLoop: Audit",
    "LifeLoop: Weekly Review", "LifeLoop: Freeze Review",
    "LifeLoop: New Project", "LifeLoop: New Area", "LifeLoop: New Person",
    "LifeLoop: Toggle Waiting", "LifeLoop: Toggle Someday",
    "LifeLoop: Pause Project", "LifeLoop: Complete Project",
    "LifeLoop: Archive Project", "LifeLoop: Reactivate Project",
  }
  local missing = {}
  for _, name in ipairs(expected) do
    if not found[name] then table.insert(missing, name) end
  end
  return { ok = #missing == 0, detail = missing }
end)

group("dates and weeks")

test("date.day normalises and rejects", function()
local a = lifeloop.date.day("2026-09-08")
local b = lifeloop.date.day("2026-09-08 14:00")
local c = lifeloop.date.day("2026-13-45")
local d = lifeloop.date.day(nil)
return { ok = a == "2026-09-08" and b == "2026-09-08" and c == nil and d == nil,
         detail = { a, b, tostring(c) } }
end)

test("ISO week of 2026-09-03", function()
local w = lifeloop.week("2026-09-03")
return { ok = w.key == "2026-W36" and w.start == "2026-08-31" and w.finish == "2026-09-06", detail = w }
end)

test("ISO week across the year boundary", function()
local w = lifeloop.week("2027-01-01")
return { ok = w.key == "2026-W53" and w.start == "2026-12-28" and w.finish == "2027-01-03", detail = w }
end)


group("entities")

test("projects by status", function()
local all = lifeloop.projects()
local active = lifeloop.projects("active")
local paused = lifeloop.projects("paused")
return { ok = #all == 2 and #active == 1 and #paused == 1,
         detail = { all = #all, active = #active, paused = #paused } }
end)

test("areas and people", function()
return { ok = #lifeloop.areas() == 1 and #lifeloop.people() == 1,
         detail = { areas = #lifeloop.areas(), people = #lifeloop.people() } }
end)


group("task universe and attribution")

test("universe excludes commented tasks", function()
local universe = lifeloop.tasks.universe()
for _, t in ipairs(universe) do
  if t.inComment then return { ok = false, detail = "commented task leaked: " .. t.name } end
end
return { ok = #universe > 0, detail = #universe }
end)

test("contextProject: task on its project page", function()
local set = lifeloop.projectSet()
for _, t in ipairs(lifeloop.tasks.universe()) do
  if t.name:startsWith("Benchmark decoder") then
    return { ok = lifeloop.tasks.contextProject(t, set) == "Projects/RS Recovery",
             detail = tostring(lifeloop.tasks.contextProject(t, set)) }
  end
end
return { ok = false, detail = "task not found" }
end)

test("contextProject: single link from elsewhere", function()
local set = lifeloop.projectSet()
for _, t in ipairs(lifeloop.tasks.universe()) do
  if t.name:startsWith("Send the updated draft") then
    return { ok = lifeloop.tasks.contextProject(t, set) == "Projects/RS Recovery",
             detail = tostring(lifeloop.tasks.contextProject(t, set)) }
  end
end
return { ok = false, detail = "task not found" }
end)

test("contextProject: page wins over a link to another project", function()
local set = lifeloop.projectSet()
for _, t in ipairs(lifeloop.tasks.universe()) do
  if t.name:startsWith("Compare with") then
    local ctx = lifeloop.tasks.contextProject(t, set)
    local rel = lifeloop.tasks.relatedProjects(t, set)
    return { ok = ctx == "Projects/RS Recovery" and #rel == 1 and rel[1] == "Projects/Reed Solomon",
             detail = { ctx = tostring(ctx), related = rel } }
  end
end
return { ok = false, detail = "task not found" }
end)

test("contextProject: no project at all", function()
local set = lifeloop.projectSet()
for _, t in ipairs(lifeloop.tasks.universe()) do
  if t.name:startsWith("Book a room") then
    return { ok = lifeloop.tasks.contextProject(t, set) == nil,
             detail = tostring(lifeloop.tasks.contextProject(t, set)) }
  end
end
return { ok = false, detail = "task not found" }
end)

test("contextProject: two links means no owner", function()
local set = lifeloop.projectSet()
for _, t in ipairs(lifeloop.tasks.universe()) do
  if t.name:startsWith("Weigh") then
    local rel = lifeloop.tasks.relatedProjects(t, set)
    return { ok = lifeloop.tasks.contextProject(t, set) == nil and #rel == 2,
             detail = { ctx = tostring(lifeloop.tasks.contextProject(t, set)), related = rel } }
  end
end
return { ok = false, detail = "task not found" }
end)


group("buckets")

test("buckets are disjoint and correctly sorted", function()
local b = lifeloop.tasks.buckets("2020-01-05")
local names = {}
local function collect(list, bucket)
  for _, t in ipairs(list) do names[t.ref] = bucket end
end
local overdue, due, sched = 0, 0, 0
for _, t in ipairs(b.overdue) do overdue = overdue + 1 end
for _, t in ipairs(b.dueToday) do due = due + 1 end
for _, t in ipairs(b.scheduled) do sched = sched + 1 end
local hasBenchmark, hasWriteup = false, false
for _, t in ipairs(b.overdue) do if t.name:startsWith("Benchmark decoder") then hasBenchmark = true end end
for _, t in ipairs(b.scheduled) do if t.name:startsWith("Write up findings") then hasWriteup = true end end
return { ok = hasBenchmark and hasWriteup and due == 0,
         detail = { overdue = overdue, dueToday = due, scheduled = sched } }
end)

test("completedBetween only sees recorded dates", function()
local inWeek = lifeloop.tasks.completedBetween("2020-01-01", "2020-01-07")
local outside = lifeloop.tasks.completedBetween("2021-01-01", "2021-01-07")
return { ok = #inWeek == 1 and #outside == 0, detail = { inWeek = #inWeek, outside = #outside } }
end)


group("rendering")

test("render produces a togglable ref, renderStatic does not", function()
local set = lifeloop.projectSet()
local b = lifeloop.tasks.buckets("2020-01-05")
local live = lifeloop.tasks.render(b.overdue, set)
local frozen = lifeloop.tasks.renderStatic(b.overdue, set)
return { ok = live:startsWith("* [ ] [[") and live:find("↳") ~= nil
             and string.find(live, "— 2020-01-01", 1, true) ~= nil
             and frozen:startsWith("- ○") and frozen:find("%[ %]") == nil,
         detail = { live = live, frozen = frozen } }
end)


group("inbox")

test("pending lists bullets and quick notes, one entry per subtree", function()
local entries = lifeloop.inbox.pending()
local items, pages = 0, 0
for _, e in ipairs(entries) do
  if e.kind == "item" then items = items + 1 else pages = pages + 1 end
end
return { ok = items == 2, detail = { items = items, pages = pages, entries = entries } }
end)

test("capture inserts above the Processed section", function()
lifeloop.inbox.add("a captured thought")
local text = space.readPage(lifeloop.inbox.page())
local capturedAt = string.find(text, "a captured thought", 1, true)
local processedAt = string.find(text, "## Processed", 1, true)
return { ok = capturedAt ~= nil and (processedAt == nil or capturedAt < processedAt),
         detail = { capturedAt = capturedAt, processedAt = processedAt } }
end)

test("processing moves an entire nested subtree", function()
mq.awaitEmptyQueue("indexQueue")
local entry
for _, e in ipairs(lifeloop.inbox.pending()) do
  if e.kind == "item" and e.name:startsWith("ask Jiulong") then entry = e end
end
if not entry then return { ok = false, detail = "entry not found" } end
local ok, err = lifeloop.inbox.applyToItem(entry)
local text = space.readPage(lifeloop.inbox.page())
local processedAt = string.find(text, "## Processed", 1, true)
local askAt = string.find(text, "ask Jiulong", 1, true)
local childAt = string.find(text, "specifically the survivor case", 1, true)
return { ok = ok == true and processedAt ~= nil and askAt > processedAt and childAt > askAt,
         detail = { ok = ok, err = tostring(err), processedAt = processedAt, askAt = askAt, childAt = childAt } }
end)

test("processed items drop out of pending", function()
mq.awaitEmptyQueue("indexQueue")
for _, e in ipairs(lifeloop.inbox.pending()) do
  if e.kind == "item" and e.name:startsWith("ask Jiulong") then
    return { ok = false, detail = "still pending" }
  end
end
return { ok = true }
end)

test("a stale item is left completely alone", function()
mq.awaitEmptyQueue("indexQueue")
local entry
for _, e in ipairs(lifeloop.inbox.pending()) do
  if e.kind == "item" then entry = e end
end
if not entry then return { ok = false, detail = "no pending entry" } end
entry.raw = "* something that is not what is on the page"
local before = space.readPage(lifeloop.inbox.page())
local ok, err = lifeloop.inbox.applyToItem(entry)
local after = space.readPage(lifeloop.inbox.page())
return { ok = ok == false and before == after, detail = { ok = ok, err = tostring(err), unchanged = before == after } }
end)

test("promoting a quick note needs a destination, and refuses to collide", function()
local page = "Inbox/2020-01-01/09-00-00"
space.writePage(page, "# A captured thought\n\nSomething half-formed.\n")
space.writePage("Notes/Taken", "occupied\n")
mq.awaitEmptyQueue("indexQueue")
local entry = { kind = "page", page = page, name = page }

local blank, blankErr = lifeloop.inbox.promotePage(entry, "   ")
local collide, collideErr = lifeloop.inbox.promotePage(entry, "Notes/Taken")
local inside, insideErr = lifeloop.inbox.promotePage(entry, "Inbox/still here")

local stillPending = false
for _, e in ipairs(lifeloop.inbox.pending()) do
  if e.kind == "page" and e.page == page then stillPending = true end
end
return {
  ok = blank == false and collide == false and inside == false
       and space.pageExists(page) and stillPending,
  detail = { blank = tostring(blankErr), collide = tostring(collideErr),
             inside = tostring(insideErr), stillPending = stillPending } }
end)

test("a promoted quick note leaves the inbox", function()
local page = "Inbox/2020-01-01/09-00-00"
local ok = lifeloop.inbox.promotePage({ kind = "page", page = page, name = page }, "Notes/Promoted")
mq.awaitEmptyQueue("indexQueue")
for _, e in ipairs(lifeloop.inbox.pending()) do
  if e.kind == "page" and e.page == page then
    return { ok = false, detail = "still pending" }
  end
end
return { ok = ok == true and space.pageExists("Notes/Promoted") and not space.pageExists(page),
         detail = { promoted = space.pageExists("Notes/Promoted") } }
end)


group("contract validation")

test("issues() flags malformed LifeLoop attributes and ignores others", function()
space.writePage("Scratch/Bad", "* [ ] broken [deadline: \"not-a-date\"] [priority: superurgent] [whatever: fine]\n")
mq.awaitEmptyQueue("indexQueue")
local found
for _, t in ipairs(lifeloop.tasks.universe()) do
  if t.page == "Scratch/Bad" then found = t end
end
if not found then return { ok = false, detail = "task not indexed" } end
local issues = lifeloop.tasks.issues(found)
local messages = {}
for _, i in ipairs(issues) do table.insert(messages, i.message) end
local hasDeadline, hasPriority, hasWhatever = false, false, false
for _, m in ipairs(messages) do
  if m:find("deadline") then hasDeadline = true end
  if m:find("priority") then hasPriority = true end
  if m:find("whatever") then hasWhatever = true end
end
return { ok = hasDeadline and hasPriority and not hasWhatever and #issues == 2, detail = messages }
end)


group("waiting and someday (P2)")

test("parked tasks drop out of actionable but stay in open", function()
local universe = lifeloop.tasks.universe()
local open = #lifeloop.tasks.open(universe)
local actionable = #lifeloop.tasks.actionable(universe)
local parked = 0
for _, t in ipairs(lifeloop.tasks.open(universe)) do
  if lifeloop.tasks.parked(t) then parked = parked + 1 end
end
return { ok = parked == 3 and actionable == open - parked,
         detail = { open = open, actionable = actionable, parked = parked } }
end)

test("a parent tag parks the tasks nested under it", function()
for _, t in ipairs(lifeloop.tasks.universe()) do
  if t.name:startsWith("Chase the invoice") then
    return { ok = lifeloop.tasks.parked(t) == true and table.includes(t.tags or {}, "waiting") == false,
             detail = { itags = t.itags, tags = t.tags } }
  end
end
return { ok = false, detail = "task not found" }
end)

test("waiting lists only #waiting, never #someday", function()
local names = {}
for _, t in ipairs(lifeloop.tasks.waiting()) do table.insert(names, t.name) end
local hasSomeday = false
for _, n in ipairs(names) do if n:find("Rust") then hasSomeday = true end end
return { ok = #names == 2 and not hasSomeday, detail = names }
end)

test("Today excludes parked tasks and lists them separately", function()
local text = lifeloop.views.today("2020-01-05")
local buckets = lifeloop.tasks.buckets("2020-01-05")
for _, bucket in ipairs({ buckets.overdue, buckets.dueToday, buckets.scheduled }) do
  for _, t in ipairs(bucket) do
    if lifeloop.tasks.parked(t) then return { ok = false, detail = "parked task in a bucket: " .. t.name } end
  end
end
return { ok = text:find("# Waiting on") ~= nil and text:find("countersign") ~= nil,
         detail = text:sub(1, 600) }
end)


group("upcoming (P2)")

test("upcoming groups by day and never lists a task twice", function()
local groups = lifeloop.tasks.upcoming(14, "2020-01-05")
local seen, duplicate = {}, nil
local days = {}
for _, g in ipairs(groups) do
  table.insert(days, g.day)
  for _, t in ipairs(g.tasks) do
    if seen[t.ref] then duplicate = t.name end
    seen[t.ref] = true
  end
end
return { ok = duplicate == nil and #days > 0, detail = { days = days, duplicate = tostring(duplicate) } }
end)

test("a task with both dates is grouped by scheduled, not deadline", function()
local groups = lifeloop.tasks.upcoming(14, "2020-01-05")
for _, g in ipairs(groups) do
  for _, t in ipairs(g.tasks) do
    if t.name:startsWith("Ship the paper") then
      return { ok = g.day == "2020-01-08", detail = { groupedUnder = g.day } }
    end
  end
end
return { ok = false, detail = "task not found in range" }
end)

test("upcoming excludes parked tasks and today itself", function()
local groups = lifeloop.tasks.upcoming(14, "2020-01-05")
for _, g in ipairs(groups) do
  if g.day <= "2020-01-05" then return { ok = false, detail = "included today or earlier: " .. g.day } end
  for _, t in ipairs(g.tasks) do
    if lifeloop.tasks.parked(t) then return { ok = false, detail = "parked: " .. t.name } end
  end
end
return { ok = true }
end)


group("project deadline is the project's own (P2 fix)")

test("Projects shows the project deadline and the next task deadline separately", function()
local table_ = lifeloop.views.projectTable("active")
return { ok = table_:find("| Deadline | Next task |") ~= nil
             and string.find(table_, "2020-02-01", 1, true) ~= nil
             and string.find(table_, "2020-01-01", 1, true) ~= nil,
         detail = table_ }
end)


group("views render")

test("Today renders through the view function, page is only a shell", function()
local direct = lifeloop.views.today()
local page = spacelua.interpolate(space.readPage("Library/LifeLoop/Pages/Today"))
return { ok = page:find("%${") == nil
             and direct:find("# Overdue") ~= nil
             and direct:find("Benchmark decoder") ~= nil
             and string.find(page, direct, 1, true) ~= nil,
         detail = direct:sub(1, 400) }
end)

test("Projects renders through the view function too", function()
local direct = lifeloop.views.projects()
local page = spacelua.interpolate(space.readPage("Library/LifeLoop/Pages/Projects"))
return { ok = direct:find("| Project | Area | Open") ~= nil
             and direct:find("RS Recovery") ~= nil
             and string.find(page, direct, 1, true) ~= nil,
         detail = direct:sub(1, 400) }
end)


group("weekly review")

test("Weekly Review creates a page whose sections stay live", function()
editor.invokeCommand("LifeLoop: Weekly Review")
editor.save()
local name = lifeloop.review.pageName()
local text = space.readPage(name)
local live = string.find(text, "${lifeloop.review.completed()}", 1, true) ~= nil
       and string.find(text, "${lifeloop.review.stillOpen()}", 1, true) ~= nil
       and string.find(text, "${lifeloop.review.activeProjects()}", 1, true) ~= nil
       and string.find(text, "${lifeloop.review.inbox()}", 1, true) ~= nil
local week = lifeloop.week()
return { ok = live and string.find(text, week.key, 1, true) ~= nil,
         detail = { page = name, live = live } }
end)

test("Freeze refuses a page with no live sections at all", function()
local name = "Scratch/Half Review"
space.writePage(name, "---\nweekStart: 2020-01-01\nweekEnd: 2020-01-07\n---\njust prose\n")
local before = space.readPage(name)
local ok, message = lifeloop.review.freeze(name)
local after = space.readPage(name)
return { ok = ok == false and before == after, detail = { ok = ok, message = tostring(message) } }
end)

test("Freeze refuses a page without week frontmatter", function()
local name = "Scratch/Not A Review"
space.writePage(name, "${lifeloop.review.completed()}\n")
local before = space.readPage(name)
local ok, message = lifeloop.review.freeze(name)
return { ok = ok == false and space.readPage(name) == before, detail = { ok = ok, message = tostring(message) } }
end)

test("Freeze handles a page written against an older template", function()
local name = "Scratch/Old Review"
local week = lifeloop.week("2020-01-02")
space.writePage(name, "---\nweekStart: " .. week.start .. "\nweekEnd: " .. week.finish ..
  "\n---\n## Completed\n${lifeloop.review.completed()}\n\n## Inbox\n${lifeloop.review.inbox()}\n")
local ok, message = lifeloop.review.freeze(name)
local text = space.readPage(name)
return { ok = ok == true and string.find(text, "${lifeloop.review.", 1, true) == nil
             and (index.extractFrontmatter(text).frontmatter or {}).frozen ~= nil,
         detail = { ok = ok, message = tostring(message), text = text } }
end)

test("Freeze snapshots every section as plain text", function()
local name = lifeloop.review.pageName()
local ok, message = lifeloop.review.freeze(name)
editor.save()
local text = space.readPage(name)
local frontmatter = index.extractFrontmatter(text).frontmatter or {}
return {
  ok = ok == true and string.find(text, "${lifeloop.review.", 1, true) == nil
       and frontmatter.frozen ~= nil
       and string.find(text, "* [ ]", 1, true) == nil
       and string.find(text, "* [x]", 1, true) == nil,
  detail = { ok = ok, message = tostring(message), frozen = tostring(frontmatter.frozen), body = text:sub(1, 300) } }
end)

test("Freezing twice changes nothing", function()
local name = lifeloop.review.pageName()
local before = space.readPage(name)
local ok, message = lifeloop.review.freeze(name)
local after = space.readPage(name)
return { ok = ok == false and before == after,
         detail = { ok = ok, message = tostring(message), identical = before == after } }
end)


group("completion stamping")

test("an in-editor tick records the date and touches nothing else", function()
local page = "Scratch/Ticking"
space.writePage(page, "* [x] finished long ago\n* [ ] tick me\n")
mq.awaitEmptyQueue("indexQueue")
editor.navigate(page)
local text = editor.getText()
-- Stand in for the click: the same event the editor dispatches, with the same payload shape
local from = string.find(text, "%[ %] tick me") - 1
local to = from + #"[ ] tick me"
editor.dispatch { changes = { from = from + 1, to = from + 2, insert = "x" } }
event.dispatch("task:stateChange", {
  from = from, to = to, newState = "x", text = "[x] tick me",
})
editor.save()
local after = space.readPage(page)
return {
  ok = string.find(after, "tick me [completed: \"" .. lifeloop.date.today() .. "\"]", 1, true) ~= nil
       and string.find(after, "finished long ago [completed", 1, true) == nil,
  detail = after }
end)

test("a tick from a query view records nothing", function()
local page = "Scratch/Ticking Remote"
space.writePage(page, "* [ ] ticked from elsewhere\n")
mq.awaitEmptyQueue("indexQueue")
local before = space.readPage(page)
-- The ref-based path dispatches the state and nothing else
event.dispatch("task:stateChange", { newState = "x" })
local after = space.readPage(page)
return { ok = before == after, detail = after }
end)

test("reopening a task removes the claim that it was done", function()
local page = "Scratch/Reopening"
space.writePage(page, "* [x] done for now [completed: \"2020-01-01\"]\n")
mq.awaitEmptyQueue("indexQueue")
editor.navigate(page)
local text = editor.getText()
local taskText = "[x] done for now [completed: \"2020-01-01\"]"
local from = string.find(text, taskText, 1, true) - 1
event.dispatch("task:stateChange", {
  from = from, to = from + #taskText, newState = " ", text = taskText,
})
editor.save()
local after = space.readPage(page)
return { ok = after:find("completed") == nil and after:find("done for now") ~= nil, detail = after }
end)


group("process inbox (P3)")

test("make task converts the first line only and leaves pending", function()
space.writePage("Inbox", "intro\n\n* buy milk\n* plan the offsite\n  * book a room\n")
mq.awaitEmptyQueue("indexQueue")
local entry
for _, e in ipairs(lifeloop.inbox.pending()) do
  if e.kind == "item" and e.name:startsWith("plan the offsite") then entry = e end
end
if not entry then return { ok = false, detail = "entry not found" } end
local ok = lifeloop.inbox.makeTask(entry)
mq.awaitEmptyQueue("indexQueue")
local text = space.readPage("Inbox")
local stillPending = false
for _, e in ipairs(lifeloop.inbox.pending()) do
  if e.kind == "item" and (e.name or ""):find("offsite") then stillPending = true end
end
return { ok = ok == true
             and string.find(text, "* [ ] plan the offsite", 1, true) ~= nil
             and string.find(text, "* [ ] book a room", 1, true) == nil
             and string.find(text, "  * book a room", 1, true) ~= nil
             and not stillPending,
         detail = text }
end)

test("link project annotates in place and stops being pending", function()
local entry
for _, e in ipairs(lifeloop.inbox.pending()) do
  if e.kind == "item" and e.name:startsWith("buy milk") then entry = e end
end
if not entry then return { ok = false, detail = "entry not found" } end
local ok = lifeloop.inbox.linkProject(entry, "Projects/RS Recovery")
mq.awaitEmptyQueue("indexQueue")
local text = space.readPage("Inbox")
local processedAt = string.find(text, "## Processed", 1, true)
local itemAt = string.find(text, "buy milk", 1, true)
return { ok = ok == true
             and string.find(text, "buy milk [[Projects/RS Recovery]]", 1, true) ~= nil
             and processedAt ~= nil and itemAt > processedAt,
         detail = text }
end)

test("move to project writes the destination and clears the source", function()
space.writePage("Inbox", "intro\n\n* draft the agenda\n")
space.writePage("Scratch/Destination", "---\ntags: project\nstatus: active\n---\n# Tasks\n")
mq.awaitEmptyQueue("indexQueue")
local entry = lifeloop.inbox.pending()[1]
local ok = lifeloop.inbox.moveToProject(entry, "Scratch/Destination")
mq.awaitEmptyQueue("indexQueue")
local dest = space.readPage("Scratch/Destination")
local inbox = space.readPage("Inbox")
return { ok = ok == true
             and string.find(dest, "draft the agenda", 1, true) ~= nil
             and string.find(inbox, "draft the agenda", 1, true) == nil,
         detail = { dest = dest, inbox = inbox } }
end)

test("moving to a project that does not exist writes nothing", function()
space.writePage("Inbox", "intro\n\n* something to keep\n")
mq.awaitEmptyQueue("indexQueue")
local entry = lifeloop.inbox.pending()[1]
local before = space.readPage("Inbox")
local ok, message = lifeloop.inbox.moveToProject(entry, "Projects/Does Not Exist")
local after = space.readPage("Inbox")
return { ok = ok == false and before == after, detail = { message = tostring(message) } }
end)

test("creating an entity that already exists writes nothing", function()
space.writePage("Scratch/Occupied", "taken\n")
mq.awaitEmptyQueue("indexQueue")
local entry = lifeloop.inbox.pending()[1]
local before = space.readPage("Inbox")
local occupiedBefore = space.readPage("Scratch/Occupied")
local ok, message = lifeloop.inbox.createEntity(entry, "project", "Scratch/Occupied")
return { ok = ok == false
             and space.readPage("Inbox") == before
             and space.readPage("Scratch/Occupied") == occupiedBefore,
         detail = { message = tostring(message) } }
end)


group("project lifecycle (P3)")

test("transitions follow the table", function()
space.writePage("Scratch/Lifecycle", "---\ntags: project\nstatus: active\n---\nbody\n")
mq.awaitEmptyQueue("indexQueue")
local function status()
  return (index.extractFrontmatter(space.readPage("Scratch/Lifecycle")).frontmatter or {}).status
end
local paused = lifeloop.lifecycle.setStatus("Scratch/Lifecycle", "paused", { "active" })
local afterPause = status()
local completed = lifeloop.lifecycle.setStatus("Scratch/Lifecycle", "completed", { "active", "paused" })
local afterComplete = status()
local reactivated = lifeloop.lifecycle.setStatus("Scratch/Lifecycle", "active", { "paused", "completed", "archived" })
return { ok = paused and afterPause == "paused" and completed and afterComplete == "completed"
             and reactivated and status() == "active",
         detail = { afterPause = afterPause, afterComplete = afterComplete, final = status() } }
end)

test("an illegal transition changes nothing", function()
lifeloop.lifecycle.setStatus("Scratch/Lifecycle", "archived", { "active", "paused", "completed" })
local before = space.readPage("Scratch/Lifecycle")
local ok, message = lifeloop.lifecycle.setStatus("Scratch/Lifecycle", "completed", { "active", "paused" })
return { ok = ok == false and space.readPage("Scratch/Lifecycle") == before,
         detail = { message = tostring(message) } }
end)

test("archiving does not move or rename the page", function()
return { ok = space.pageExists("Scratch/Lifecycle")
             and (index.extractFrontmatter(space.readPage("Scratch/Lifecycle")).frontmatter or {}).status == "archived",
         detail = space.readPage("Scratch/Lifecycle") }
end)

test("lifecycle refuses a page that is not a project", function()
space.writePage("Scratch/Plain", "just a note\n")
local before = space.readPage("Scratch/Plain")
local ok, message = lifeloop.lifecycle.setStatus("Scratch/Plain", "paused", { "active" })
return { ok = ok == false and space.readPage("Scratch/Plain") == before,
         detail = { message = tostring(message) } }
end)


group("signals (P3)")

test("waiting only wins over no actionable task", function()
space.writePage("Scratch/AllWaiting", "---\ntags: project\nstatus: active\n---\n* [ ] chase legal #waiting\n* [ ] chase vendor #waiting\n")
mq.awaitEmptyQueue("indexQueue")
local project
for _, p in ipairs(lifeloop.projects()) do if p.name == "Scratch/AllWaiting" then project = p end end
if not project then return { ok = false, detail = "project not indexed" } end
local messages = {}
for _, s in ipairs(lifeloop.signals.forProject(project)) do table.insert(messages, s.message) end
return { ok = table.includes(messages, "Waiting only")
             and not table.includes(messages, "No actionable task"),
         detail = messages }
end)

test("waiting plus someday is not actionable but is not waiting only", function()
space.writePage("Scratch/Mixed", "---\ntags: project\nstatus: active\n---\n* [ ] chase legal #waiting\n* [ ] rewrite it all #someday\n")
mq.awaitEmptyQueue("indexQueue")
local project
for _, p in ipairs(lifeloop.projects()) do if p.name == "Scratch/Mixed" then project = p end end
if not project then return { ok = false, detail = "project not indexed" } end
local messages = {}
for _, s in ipairs(lifeloop.signals.forProject(project)) do table.insert(messages, s.message) end
return { ok = table.includes(messages, "No actionable task")
             and not table.includes(messages, "Waiting only"),
         detail = messages }
end)

test("a paused project produces no signals at all", function()
space.writePage("Scratch/Paused", "---\ntags: project\nstatus: paused\n---\n* [ ] chase legal #waiting\n")
mq.awaitEmptyQueue("indexQueue")
local project
for _, p in ipairs(lifeloop.projects()) do if p.name == "Scratch/Paused" then project = p end end
if not project then return { ok = false, detail = "project not indexed" } end
return { ok = #lifeloop.signals.forProject(project) == 0,
         detail = lifeloop.signals.forProject(project) }
end)

test("deadline signal uses the projects own deadline, not a tasks", function()
local soon = lifeloop.date.shift(lifeloop.date.today(), 3)
space.writePage("Scratch/DeadlineSoon",
  "---\ntags: project\nstatus: active\ndeadline: " .. soon .. "\n---\n* [ ] something [deadline: \"2035-01-01\"]\n")
mq.awaitEmptyQueue("indexQueue")
local project
for _, p in ipairs(lifeloop.projects()) do if p.name == "Scratch/DeadlineSoon" then project = p end end
if not project then return { ok = false, detail = "project not indexed" } end
local messages = {}
for _, s in ipairs(lifeloop.signals.forProject(project)) do table.insert(messages, s.message) end
return { ok = table.includes(messages, "Deadline " .. soon), detail = messages }
end)


group("audit (P3)")

test("audit reports LifeLoop violations and ignores arbitrary attributes", function()
space.writePage("Scratch/Bad", "* [ ] broken [deadline: \"not-a-date\"] [priority: superurgent] [cost: 3]\n")
space.writePage("Scratch/BadProject", "---\ntags: project\nstatus: dithering\narea: \"[[Nowhere]]\"\n---\n")
mq.awaitEmptyQueue("indexQueue")
local result = lifeloop.audit.run()
local all = {}
for _, e in ipairs(result.safe) do table.insert(all, e.message) end
for _, e in ipairs(result.review) do table.insert(all, e.message) end
local joined = table.concat(all, " | ")
return { ok = joined:find("deadline") ~= nil
             and joined:find("priority") ~= nil
             and joined:find("dithering") ~= nil
             and joined:find("Nowhere") ~= nil
             and joined:find("cost") == nil,
         detail = all }
end)


return results
