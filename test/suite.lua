-- LifeLoop acceptance suite. Runs inside a real SilverBullet client (see test/verify.sh).
-- One round trip for the whole suite: each test is pcall'ed, so a Lua error is a failure rather
-- than the end of the run.
local results = {}
local section = ""

-- navigate is not reliably complete when it returns under load, and code that branches on
-- "is this the page on screen" needs that answer to have settled.
local function goTo(page)
  -- Navigating is not free: the browser rate-limits history entries, and a suite that moved before
  -- every test blew through the limit and died. Only actually move when we are not already there.
  if editor.getCurrentPage() == page then
    return
  end
  editor.navigate(page)
  for _ = 1, 50 do
    if editor.getCurrentPage() == page then
      return
    end
  end
end

-- Somewhere harmless for the editor to sit between groups.
--
-- readPageText and writePageText branch on whether a page is the one on screen, which is right:
-- writing behind an open buffer would lose whatever it holds. The consequence for a suite is that
-- a test leaving the editor parked on a page, and a later test writing that page with
-- space.writePage, makes every subsequent read return the stale buffer. That surfaced as a single
-- failure per run, in a different unrelated test each time.
space.writePage("Scratch/Neutral", "Somewhere for the editor to be between tests.\n")

-- Wait for the reset to have actually taken effect before asserting anything.
--
-- verify.sh deletes a couple of dozen scratch pages immediately before this runs, and a deletion
-- reaches the index no faster than a write does. Tests that count what is in the space -- how many
-- projects there are, what is pending -- were reading a space still holding the last run's
-- leftovers, which is why an early, simple test could fail while everything after it passed.
for _ = 1, 30 do
  mq.awaitEmptyQueue("indexQueue")
  if #lifeloop.projects() == 2 then
    break
  end
end

local function group(name)
  section = name
end

-- Every test starts from a settled client.
--
-- LifeLoop reads and writes through the editor when a page is the one on screen, which is correct
-- -- writing behind an open buffer would lose what it holds. For a suite it means the buffer and
-- the file can disagree: a mutation that went to the buffer via editor.setText is invisible to
-- space.readPage, and a test that wrote a file directly is invisible to code reading the buffer.
-- That showed up as one failure per run in a different unrelated test each time, including
-- `freeze()` reporting success against a page that still read as unfrozen.
--
-- Flushing and draining before each test removes the whole class, rather than adding an await
-- wherever it happens to have bitten.
-- Parking the editor elsewhere is what flushes the buffer -- navigating away saves it -- and it
-- also guarantees the page a test is about to write is not the page on screen, so LifeLoop takes
-- its space.* branch and the file is the single source of truth. editor.save() alone was not
-- enough: it schedules a save rather than completing one.
--
-- Tests that genuinely need the editor navigate for themselves, after this has run.
-- Waits for something written to become visible through the index. One drain of the queue is not
-- always enough: a page's frontmatter and tags surface a cycle later than its tasks do, so a test
-- that writes a project and immediately queries for it sees the file but not the project.
--
-- Only ever for preconditions. Waiting for the thing under test would make the test vacuous.
local function waitFor(check)
  -- Twice in a row, not once. Reindexing a page removes its objects before putting them back, so
  -- a single confirmation can be the moment before they disappear again -- which is how a fixture
  -- could be seen, and then be missing by the time the code under test queried for it.
  local confirmations = 0
  for _ = 1, 30 do
    mq.awaitEmptyQueue("indexQueue")
    if check() then
      confirmations = confirmations + 1
      if confirmations >= 2 then
        return true
      end
    else
      confirmations = 0
    end
  end
  return false
end

-- Saves the open page and does not return until the file actually says what the buffer says.
--
-- This is the one that mattered. editor.save() schedules a write; navigating away schedules
-- another. Either can land *after* the next test has written its own fixture to that page, which
-- silently restores the previous test's content underneath it. Measured at roughly one occurrence
-- in twenty-five, and the suite does it dozens of times a run -- which is why a different,
-- unrelated test failed on about one run in four while every test passed in isolation.
local function flush()
  local page = editor.getCurrentPage()
  if not page then
    return
  end
  for _ = 1, 30 do
    local want = editor.getText()
    editor.save()
    local ok, got = pcall(function() return space.readPage(page) end)
    if ok and got == want then
      return
    end
  end
end

local function settle()
  -- Flush before moving, then move. Saving alone schedules a write rather than completing one,
  -- and parking alone leaves whatever the last test typed sitting in a buffer the next test reads
  -- around. Both, in that order.
  flush()
  goTo("Scratch/Neutral")
  -- Twice: the first drain can let through work that enqueues more, and a test that reads what
  -- the previous test wrote needs the whole cascade to have finished.
  mq.awaitEmptyQueue("indexQueue")
  mq.awaitEmptyQueue("indexQueue")
end

local function test(name, fn)
  settle()
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
    ["lifeloop.tasks.locate"] = lifeloop.tasks and lifeloop.tasks.locate,
    ["lifeloop.tasks.atCursor"] = lifeloop.tasks and lifeloop.tasks.atCursor,
    ["lifeloop.external.run"] = lifeloop.external and lifeloop.external.run,
    ["lifeloop.external.eligible"] = lifeloop.external and lifeloop.external.eligible,
    ["lifeloop.journal.mentions"] = lifeloop.journal and lifeloop.journal.mentions,
    ["lifeloop.views.journalMentions"] = lifeloop.views and lifeloop.views.journalMentions,
    ["lifeloop.attach.task"] = lifeloop.attach and lifeloop.attach.task,
    ["lifeloop.tasks.marker"] = lifeloop.tasks and lifeloop.tasks.marker,
    ["lifeloop.pageExists"] = lifeloop.pageExists,
    ["lifeloop.completion.stampByRef"] = lifeloop.completion and lifeloop.completion.stampByRef,
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
    "LifeLoop: Add Reminder", "LifeLoop: Add to Calendar", "LifeLoop: Attach Page to Task",
  }
  local missing = {}
  for _, name in ipairs(expected) do
    if not found[name] then table.insert(missing, name) end
  end
  return { ok = #missing == 0, detail = missing }
end)

-- The buttons go in with actionButton.define, which appends. Whatever else is in the bar --
-- SilverBullet's own defaults, anything configured by hand -- has to survive, because replacing
-- the list would quietly take away Home and the page picker.
test("action buttons are added without displacing what was there", function()
  local mine, others = {}, {}
  for _, button in ipairs(config.get("actionButtons", {})) do
    if button.command and button.command:startsWith("LifeLoop") then
      table.insert(mine, button.command)
    else
      table.insert(others, button.command or button.icon or "?")
    end
  end
  return {
    ok = #mine == 2 and table.includes(mine, "LifeLoop: Capture")
         and table.includes(mine, "LifeLoop: Today") and #others > 0,
    detail = { lifeloop = mine, others = others },
  }
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
-- applyToItem refuses when the range the index gave does not still hold the text the index said
-- was there -- which is the right rule, and means the precondition here is not "the entry exists"
-- but "the index and the page agree about it". Those are different moments: the entry can be
-- listed from an index that is one write behind the file.
local entry
waitFor(function()
  entry = nil
  for _, e in ipairs(lifeloop.inbox.pending()) do
    if e.kind == "item" and e.name:startsWith("ask Jiulong") then entry = e end
  end
  if not entry or not entry.range then
    return false
  end
  local text = space.readPage(entry.page)
  return text:sub(entry.range[1] + 1, entry.range[2]) == entry.raw
end)
if not entry then return { ok = false, detail = "entry not found" } end
local ok, err = lifeloop.inbox.applyToItem(entry)
-- The move is written, then read back. Waiting for the write to be readable is a precondition;
-- what is asserted below is where the item and its child ended up relative to the heading.
waitFor(function()
  return string.find(space.readPage(lifeloop.inbox.page()), "## Processed", 1, true) ~= nil
end)
local text = space.readPage(lifeloop.inbox.page())
local processedAt = string.find(text, "## Processed", 1, true)
local askAt = string.find(text, "ask Jiulong", 1, true)
local childAt = string.find(text, "specifically the survivor case", 1, true)
return { ok = ok == true and processedAt ~= nil and askAt > processedAt and childAt > askAt,
         detail = { ok = ok, err = tostring(err), processedAt = processedAt, askAt = askAt, childAt = childAt } }
end)

-- Pending is derived from the index, so dropping out of it is eventual rather than immediate.
-- The wait is bounded: an item that never leaves fails here just as loudly, it simply is not
-- required to have left by the very next instruction.
test("processed items drop out of pending", function()
local function stillListed()
  for _, e in ipairs(lifeloop.inbox.pending()) do
    if e.kind == "item" and e.name:startsWith("ask Jiulong") then
      return true
    end
  end
  return false
end
waitFor(function() return not stillListed() end)
return { ok = not stillListed(), detail = "still pending" }
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
-- promotePage refuses on space.pageExists, so an occupant that has not landed yet is no occupant
-- and the rename succeeds -- which is the opposite of what this test is checking.
waitFor(function() return lifeloop.pageExists(page) and lifeloop.pageExists("Notes/Taken") end)
local entry = { kind = "page", page = page, name = page }

local blank, blankErr = lifeloop.inbox.promotePage(entry, "   ")
local collide, collideErr = lifeloop.inbox.promotePage(entry, "Notes/Taken")
local inside, insideErr = lifeloop.inbox.promotePage(entry, "Inbox/still here")

local stillPending = false
for _, e in ipairs(lifeloop.inbox.pending()) do
  if e.kind == "page" and e.page == page then stillPending = true end
end
local sourceSurvived = lifeloop.pageExists(page)
return {
  ok = blank == false and collide == false and inside == false
       and sourceSurvived and stillPending,
  detail = { blank = tostring(blank) .. "/" .. tostring(blankErr),
             collide = tostring(collide) .. "/" .. tostring(collideErr),
             inside = tostring(inside) .. "/" .. tostring(insideErr),
             sourceSurvived = sourceSurvived, stillPending = stillPending,
             occupantExists = lifeloop.pageExists("Notes/Taken") } }
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
return { ok = ok == true and lifeloop.pageExists("Notes/Promoted") and not lifeloop.pageExists(page),
         detail = { promoted = lifeloop.pageExists("Notes/Promoted") } }
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
goTo(page)
local text = editor.getText()
-- The payload shape matters and is easy to get wrong: SilverBullet renders `text` from the parse
-- tree it captured *before* applying the edit, so it carries the OLD state character. Asserting
-- against the new one is what let a real bug through -- the handler never matched on a real tick
-- and quietly did nothing, while this test passed.
local from = string.find(text, "%[ %] tick me") - 1
local to = from + #"[ ] tick me"
editor.dispatch { changes = { from = from + 1, to = from + 2, insert = "x" } }
event.dispatch("task:stateChange", {
  from = from, to = to, newState = "x", text = "[ ] tick me",
})
-- The stamp went into the buffer, which is where it is true immediately; the file catches up.
local after = editor.getText()
return {
  ok = string.find(after, "tick me [completed: \"" .. lifeloop.date.today() .. "\"]", 1, true) ~= nil
       and string.find(after, "finished long ago [completed", 1, true) == nil,
  detail = after }
end)

-- The one test that fabricates nothing: SilverBullet cycles the state and dispatches its own
-- event, so a change to either side of that contract fails here rather than passing quietly.
test("a real Task: Cycle State stamps the source", function()
local page = "Scratch/Cycling"
space.writePage(page, "* [ ] cycle me for real\n")
waitFor(function() return #lifeloop.tasks.universe(page) > 0 end)
goTo(page)
-- Being *on* the page is not the same as the buffer having its text: goTo waits for the former,
-- and moving the cursor into content that has not arrived puts it somewhere meaningless.
waitFor(function() return string.find(editor.getText(), "cycle me for real", 1, true) ~= nil end)
editor.moveCursor(8)
editor.invokeCommand("Task: Cycle State")
local after = editor.getText()
return {
  ok = after == '* [x] cycle me for real [completed: "' .. lifeloop.date.today() .. '"]\n',
  detail = after }
end)

test("a tick from a query view records nothing", function()
local page = "Scratch/Ref Stateless"
space.writePage(page, "* [ ] ticked from elsewhere\n")
waitFor(function() return space.readPage(page) == "* [ ] ticked from elsewhere\n" end)
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
goTo(page)
local text = editor.getText()
local taskText = "[x] done for now [completed: \"2020-01-01\"]"
local from = string.find(text, taskText, 1, true) - 1
-- Same again: the edit lands first, and the event describes what was there before it.
editor.dispatch { changes = { from = from + 1, to = from + 2, insert = " " } }
event.dispatch("task:stateChange", {
  from = from, to = from + #taskText, newState = " ", text = taskText,
})
local after = editor.getText()
return { ok = after:find("completed") == nil and after:find("done for now") ~= nil, detail = after }
end)


-- The ref route: what a tick in Today or any other query result goes through. These dispatch the
-- event the way the client does -- write the new state, then announce it -- so they exercise
-- LifeLoop's half against any client, patched or not.
--
-- Each test owns its own page. They used to share one, which meant every fixture was whatever
-- the previous test had left there.
--
-- Refs are built by hand rather than read back from the index. A task at the top of a page is
-- "Page@0", and depending on the index here would only re-test the resolver the code under test
-- deliberately does not use.
-- The page is written in its post-tick state and then announced, because that is the only state
-- the handler ever sees: SilverBullet writes the new marker first and dispatches afterwards.
local function tick(page, after, oldState, newState)
  space.writePage(page, after)
  -- The client finishes writing before it dispatches. Announcing a write that has not landed
  -- tests a situation that cannot happen, and fails intermittently for that reason.
  mq.awaitEmptyQueue("indexQueue")
  event.dispatch("task:stateChange",
    { ref = page .. "@0", oldState = oldState, newState = newState })
  local result = space.readPage(page)
  -- Leave the index settled. These tests rewrite one page repeatedly and the code under test
  -- deliberately never waits for the indexer, so without this the reindexing runs on into
  -- whatever group comes next and shows up there as a mystery failure.
  mq.awaitEmptyQueue("indexQueue")
  return result
end

test("a ref tick stamps the source page it names", function()
local after = tick("Scratch/Ref Stamp", "* [x] ticked from elsewhere\n", " ", "x")
return {
  ok = after == '* [x] ticked from elsewhere [completed: "' .. lifeloop.date.today() .. '"]\n',
  detail = after }
end)

test("a ref naming a page that does not exist writes nothing", function()
local page = "Scratch/Ref Missing"
space.writePage(page, "* [x] nobody ticked this\n")
waitFor(function() return space.readPage(page) == "* [x] nobody ticked this\n" end)
local before = space.readPage(page)
event.dispatch("task:stateChange",
  { ref = "Scratch/No Such Page@42", oldState = " ", newState = "x" })
return { ok = space.readPage(page) == before, detail = space.readPage(page) }
end)

-- The marker check is what proves the write being reacted to landed where the ref says it did.
test("a ref whose source no longer holds the new state writes nothing", function()
local page = "Scratch/Ref State"
space.writePage(page, "* [ ] still open\n")
waitFor(function() return space.readPage(page) == "* [ ] still open\n" end)
local before = space.readPage(page)
event.dispatch("task:stateChange", { ref = page .. "@0", oldState = " ", newState = "x" })
local after = space.readPage(page)
mq.awaitEmptyQueue("indexQueue")
return { ok = after == before, detail = after }
end)

test("a ref pointing at something that is not a task writes nothing", function()
local page = "Scratch/Ref NotATask"
space.writePage(page, "just a paragraph, no checkbox in sight\n")
waitFor(function() return space.readPage(page) == "just a paragraph, no checkbox in sight\n" end)
local before = space.readPage(page)
event.dispatch("task:stateChange", { ref = page .. "@0", oldState = " ", newState = "x" })
local after = space.readPage(page)
mq.awaitEmptyQueue("indexQueue")
return { ok = after == before, detail = after }
end)

test("a ref tick on an already stamped task is byte-identical", function()
local page = "Scratch/Ref Stamped"
local stamped = '* [x] done a while ago [completed: "2020-01-01"]\n'
space.writePage(page, stamped)
waitFor(function() return space.readPage(page) == stamped end)
event.dispatch("task:stateChange", { ref = page .. "@0", oldState = " ", newState = "x" })
local after = space.readPage(page)
mq.awaitEmptyQueue("indexQueue")
return { ok = after == stamped, detail = after }
end)

test("a ref reopen removes the claim that it was done", function()
local after = tick("Scratch/Ref Reopen",
  '* [ ] done for now [completed: "2020-01-01"]\n', "x", " ")
return { ok = after == "* [ ] done for now\n", detail = after }
end)

-- A task's indexed range runs to the end of its subtree, so writing at "the end of the task"
-- would put the stamp below the child rather than on the task's own line.
test("stamping a parent task does not write below its children", function()
local after = tick("Scratch/Ref Parent",
  "* [x] parent task\n  * [ ] child task\n", " ", "x")
return {
  ok = after == '* [x] parent task [completed: "' .. lifeloop.date.today()
       .. '"]\n  * [ ] child task\n',
  detail = after }
end)

-- The list marker is not always two characters, so the state cannot be read at a fixed offset.
test("an ordered-list task is stamped like any other", function()
local after = tick("Scratch/Ref Ordered", "1. [x] numbered task\n", " ", "x")
return {
  ok = after == '1. [x] numbered task [completed: "' .. lifeloop.date.today() .. '"]\n',
  detail = after }
end)


group("attaching a page to a task")

local function attachable(page, body)
  space.writePage(page, body)
  waitFor(function() return #lifeloop.tasks.universe(page) > 0 end)
  goTo(page)
  local text = editor.getText()
  editor.moveCursor(string.find(text, "%[ %]") + 4)
  return lifeloop.tasks.atCursor()
end

test("a task with an attached page stays an ordinary checkbox and gains a link", function()
local task = attachable("Scratch/Promoting Ok",
  '* [ ] benchmark recovery [deadline: "2026-09-08"]\n')
if not task then return { ok = false, detail = "no task at cursor" } end
local ok, message = lifeloop.attach.task(task, "Scratch/Promoted Note")
editor.save()
mq.awaitEmptyQueue("indexQueue")
-- Read the buffer, which is what attaching actually wrote to: reading the file races the save.
local source = editor.getText()
local stillATask = false
for _, t in ipairs(lifeloop.tasks.universe("Scratch/Promoting Ok")) do
  if t.name:find("benchmark recovery") and not t.done then stillATask = true end
end
return {
  ok = ok == true
       and source == '* [ ] [[Scratch/Promoted Note]] benchmark recovery [deadline: "2026-09-08"]\n'
       and space.readPage("Scratch/Promoted Note") == lifeloop.attach.body
       and stillATask,
  detail = { message = message, source = source, stillATask = stillATask } }
end)

test("the destination carries no back-link, because the source already links here", function()
local body = space.readPage("Scratch/Promoted Note")
return { ok = string.find(body, "Scratch/Promoting Ok", 1, true) == nil
             and string.find(body, "From ", 1, true) == nil,
         detail = body }
end)

test("a blank destination writes nothing", function()
local task = attachable("Scratch/Promoting Blank", "* [ ] leave me alone\n")
local before = space.readPage("Scratch/Promoting Blank")
local ok, message = lifeloop.attach.task(task, "   ")
return { ok = ok == false and space.readPage("Scratch/Promoting Blank") == before,
         detail = { message = message, after = space.readPage("Scratch/Promoting Blank") } }
end)

-- Refusing a collision has to leave the occupant untouched as well as the source: the failure
-- mode worth guarding is overwriting a page that already had something in it.
test("a colliding destination writes nothing and does not touch the occupant", function()
space.writePage("Scratch/Occupied", "someone else's page\n")
local task = attachable("Scratch/Promoting Collide", "* [ ] find a home\n")
local before = space.readPage("Scratch/Promoting Collide")
local ok, message = lifeloop.attach.task(task, "Scratch/Occupied")
return { ok = ok == false
             and space.readPage("Scratch/Promoting Collide") == before
             and space.readPage("Scratch/Occupied") == "someone else's page\n",
         detail = { message = message, occupant = space.readPage("Scratch/Occupied") } }
end)

-- Navigating away first is the point, not incidental: readPageText prefers the open buffer, so a
-- write behind it would leave the stale text on screen and the check would pass against it.
test("a source that changed since it was read writes nothing", function()
local task = attachable("Scratch/Promoting Stale", "* [ ] the original wording\n")
-- Edit through the buffer, the way a person would. Writing the file behind the open page instead
-- would race the flush that navigating away triggers, and lose whichever landed first.
editor.setText("* [ ] something else entirely\n")
goTo("Scratch/Neutral")
-- Navigating away flushes the buffer, but not before the next statement runs. Attaching reads the
-- file, so the edit has to have reached it or the stale text is what gets checked.
waitFor(function()
  return space.readPage("Scratch/Promoting Stale") == "* [ ] something else entirely\n"
end)
local before = space.readPage("Scratch/Promoting Stale")
local ok, message = lifeloop.attach.task(task, "Scratch/Never Created")
return { ok = ok == false
             and space.readPage("Scratch/Promoting Stale") == before
             and not lifeloop.pageExists("Scratch/Never Created"),
         detail = { message = message, created = lifeloop.pageExists("Scratch/Never Created") } }
end)

test("a line that stopped being a task writes nothing", function()
local task = attachable("Scratch/Promoting NotATask", "* [ ] was a task\n")
editor.setText("just a paragraph now\n")
goTo("Scratch/Neutral")
waitFor(function() return space.readPage("Scratch/Promoting NotATask") == "just a paragraph now\n" end)
local before = space.readPage("Scratch/Promoting NotATask")
local ok, message = lifeloop.attach.task(task, "Scratch/Also Never Created")
return { ok = ok == false
             and space.readPage("Scratch/Promoting NotATask") == before
             and not lifeloop.pageExists("Scratch/Also Never Created"),
         detail = { message = message, created = lifeloop.pageExists("Scratch/Also Never Created") } }
end)

test("attaching to a subtask links the subtask, not its parent", function()
space.writePage("Scratch/Promoting Sub", "* [ ] parent work\n  * [ ] the actual subtask\n")
waitFor(function() return #lifeloop.tasks.universe("Scratch/Promoting Sub") == 2 end)
goTo("Scratch/Promoting Sub")
local text = editor.getText()
editor.moveCursor(string.find(text, "actual subtask", 1, true))
local task = lifeloop.tasks.atCursor()
local ok = lifeloop.attach.task(task, "Scratch/Promoted Sub")
editor.save()
local source = editor.getText()
return {
  ok = ok == true
       and source == "* [ ] parent work\n  * [ ] [[Scratch/Promoted Sub]] the actual subtask\n",
  detail = source }
end)


group("journal mentions")

test("mentions are journal pages only, newest first, undated last", function()
local rows = lifeloop.journal.mentions("Projects/RS Recovery")
local days, pages = {}, {}
for _, m in ipairs(rows) do
  table.insert(days, m.day or "undated")
  table.insert(pages, m.page)
end
-- Meeting Notes/2020-01-01 links the project too, but it is not a journal page.
local leaked = false
for _, p in ipairs(pages) do
  if not p:startsWith("Journal/") then leaked = true end
end
return {
  ok = #rows == 4 and not leaked
       and days[1] == "2020-01-04" and days[2] == "2020-01-03"
       and days[3] == "2020-01-02" and days[4] == "undated",
  detail = { days = days, pages = pages } }
end)

-- The name is the fallback, not the primary: an entry that states its date in frontmatter is
-- believed even if its name says nothing.
test("the date comes from frontmatter, then the page name, then nowhere", function()
local rows = lifeloop.journal.mentions("Projects/RS Recovery")
local byPage = {}
for _, m in ipairs(rows) do byPage[m.page] = m.day end
return {
  ok = byPage["Journal/2020-01-02"] == "2020-01-02"
       and byPage["Journal/2020-01-04"] == "2020-01-04"
       and byPage["Journal/no-date-in-name"] == nil,
  detail = byPage }
end)

-- Not LifeLoop's doing: SilverBullet does not index a link inside an HTML comment at all, unlike a
-- commented task, which is indexed and flagged. Asserted so the difference stops being folklore.
test("a commented-out link is not a mention", function()
local rows = lifeloop.journal.mentions("Projects/Reed Solomon")
local fromJournal = {}
for _, m in ipairs(rows) do
  if m.page:startsWith("Journal/") then table.insert(fromJournal, m.page) end
end
return { ok = #fromJournal == 0, detail = fromJournal }
end)

test("mentions carry the surrounding line, flattened to one", function()
local rows = lifeloop.journal.mentions("Projects/RS Recovery", 1)
local snippet = rows[1] and rows[1].snippet or ""
return { ok = #rows == 1 and snippet != "" and string.find(snippet, "\n", 1, true) == nil,
         detail = snippet }
end)

test("the view returns nil rather than an empty section", function()
local empty = lifeloop.views.journalMentions("Projects/Reed Solomon")
local full = lifeloop.views.journalMentions("Projects/RS Recovery", 2)
local lines = 0
for _ in string.gmatch(full or "", "\n") do lines = lines + 1 end
return { ok = empty == nil and full ~= nil and lines == 2, detail = { empty = tostring(empty), full = full } }
end)

test("the widget stays off pages that are not projects, and off when set to 0", function()
local shown = lifeloop.views.journalMentions("Projects/RS Recovery", 5)
local notAProject = lifeloop.projectSet()["Journal/2020-01-02"]
return { ok = shown ~= nil and notAProject == nil,
         detail = { hasMentions = shown ~= nil, journalIsAProject = notAProject ~= nil } }
end)


group("external execution")

test("parseTime accepts a time, empty means all day, junk is refused", function()
local allDay, ok1 = lifeloop.external.parseTime("")
local padded, ok2 = lifeloop.external.parseTime("9:05")
local exact, ok3 = lifeloop.external.parseTime("14:00")
local junk, ok4 = lifeloop.external.parseTime("2pm")
local silly, ok5 = lifeloop.external.parseTime("25:00")
return {
  ok = allDay == "" and ok1
       and padded == "09:05" and ok2
       and exact == "14:00" and ok3
       and junk == nil and not ok4
       and silly == nil and not ok5,
  detail = { allDay, padded, exact, tostring(junk), tostring(silly) } }
end)

test("the suggested day prefers when you meant to do it over when it is due", function()
local both = { scheduled = "2026-09-06", deadline = "2026-09-08" }
local dueOnly = { deadline = "2026-09-08" }
local neither = {}
return {
  ok = lifeloop.external.suggestedDay(both) == "2026-09-06"
       and lifeloop.external.suggestedDay(dueOnly) == "2026-09-08"
       and lifeloop.external.suggestedDay(neither) == lifeloop.date.today(),
  detail = { lifeloop.external.suggestedDay(both), lifeloop.external.suggestedDay(dueOnly) } }
end)

-- One line, and only the page you would open. These values cross a process boundary as arguments,
-- so the test is as much about what is *not* sent as what is.
-- The note carries the structure Reminders cannot represent -- it has no projects, no tags and no
-- subtasks -- and ends with the page, so provenance is the last thing you read on a watch. A task
-- with none of that is still just its page.
test("the note ends with the source page, and carries structure above it", function()
local task
for _, t in ipairs(lifeloop.tasks.universe()) do
  if t.name:startsWith("Send the updated draft") then task = t end
end
if not task then return { ok = false, detail = "task not found" } end
local notes = lifeloop.external.notes(task)
local lines = {}
for line in string.gmatch(notes, "[^\n]+") do table.insert(lines, line) end
return { ok = lines[#lines] == task.page, detail = notes }
end)

test("a task with no project, tags or subtasks projects only its page", function()
space.writePage("Scratch/BareNote", "* [ ] nothing attached\n")
mq.awaitEmptyQueue("indexQueue")
local task
for _, t in ipairs(lifeloop.tasks.universe("Scratch/BareNote")) do task = t end
if not task then return { ok = false, detail = "task not indexed" } end
local notes = lifeloop.external.notes(task)
space.deletePage("Scratch/BareNote")
return { ok = notes == "Scratch/BareNote", detail = notes }
end)

-- Values reach osascript as arguments, never as text inside the script. This sends a title that
-- closes a string and opens a new AppleScript statement: it has to come back as data.
test("hostile text survives the bridge as data, or the bridge refuses cleanly", function()
local hostile = 'Pay & file? #tax "now" ) tell application "Finder" -- 报税 🧾'
local ok, message = lifeloop.external.run(
  'on run argv\nreturn item 1 of argv\nend run', { hostile })
return {
  ok = (ok and message == hostile) or (not ok and message ~= nil and message ~= ""),
  detail = { ok = ok, message = message } }
end)

-- A name is an identity only if it is unique, and two accounts can each expose a calendar called
-- "Work". These assert the refusals; the >1 case was verified by hand against two calendars
-- deliberately given the same name, and refused without creating anything in either.
test("a target that does not exist is refused, and nothing is created", function()
local ok, message = lifeloop.external.run(lifeloop.external.eventScript,
  { "LifeLoop No Such Calendar", "should never exist", "n", "2026-09-10", "", "60" })
return { ok = ok == false and string.find(message or "", "no calendar is named", 1, true) ~= nil,
         detail = message }
end)

test("a reminders list that does not exist is refused too", function()
local ok, message = lifeloop.external.run(lifeloop.external.reminderScript,
  { "LifeLoop No Such List", "should never exist", "n", "2026-09-10", "" })
return { ok = ok == false and string.find(message or "", "no reminders list is named", 1, true) ~= nil,
         detail = message }
end)

-- The raw text is "123:456: execution error: the real thing (-2700)", which is not something to
-- put in front of anyone.
test("a failure reads as a sentence, not as osascript output", function()
local _, message = lifeloop.external.run(lifeloop.external.eventScript,
  { "LifeLoop No Such Calendar", "t", "n", "2026-09-10", "", "60" })
return { ok = message == "no calendar is named LifeLoop No Such Calendar", detail = message }
end)

test("a task that is done is refused before anything is asked", function()
local page = "Scratch/Projecting"
space.writePage(page, "* [x] already finished\n")
mq.awaitEmptyQueue("indexQueue")
goTo(page)
editor.moveCursor(8)
local task, why = lifeloop.external.eligible()
return { ok = task == nil and why ~= nil, detail = tostring(why) }
end)

test("a commented task is invisible to projection", function()
local page = "Scratch/Projecting"
space.writePage(page, "<!--\n* [ ] commented out\n-->\n")
mq.awaitEmptyQueue("indexQueue")
goTo(page)
editor.moveCursor(10)
local task, why = lifeloop.external.eligible()
return { ok = task == nil and why ~= nil, detail = tostring(why) }
end)

-- Parked is not the same as ineligible: wanting a reminder about the thing you are waiting on is
-- the ordinary case, and the command was asked for explicitly.
test("a waiting task may still be projected", function()
local page = "Scratch/Projecting"
space.writePage(page, "* [ ] chase the reviewer #waiting\n")
mq.awaitEmptyQueue("indexQueue")
goTo(page)
mq.awaitEmptyQueue("indexQueue")
editor.moveCursor(10)
local task, why = lifeloop.external.eligible()
return { ok = task ~= nil and task.name:startsWith("chase the reviewer"),
         detail = task and task.name or tostring(why) }
end)

test("the cursor picks the subtask it is on, not the parent above it", function()
local page = "Scratch/Projecting"
space.writePage(page, "* [ ] parent work\n  * [ ] the actual subtask\n")
mq.awaitEmptyQueue("indexQueue")
goTo(page)
local text = editor.getText()
editor.moveCursor(string.find(text, "actual subtask", 1, true))
local task = lifeloop.external.eligible()
return { ok = task ~= nil and task.name:startsWith("the actual subtask"),
         detail = task and task.name or "nothing at cursor" }
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
-- Both sides have to be visible: the item through the index, and the destination as a page the
-- move is allowed to write to.
local entry
waitFor(function()
  entry = nil
  for _, e in ipairs(lifeloop.inbox.pending()) do
    if e.kind == "item" and e.name:startsWith("draft the agenda") then entry = e end
  end
  return entry ~= nil and lifeloop.pageExists("Scratch/Destination")
end)
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
waitFor(function()
  return lifeloop.pageExists("Scratch/Lifecycle")
    and string.find(space.readPage("Scratch/Lifecycle"), "status: active", 1, true) ~= nil
end)
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
return { ok = lifeloop.pageExists("Scratch/Lifecycle")
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

-- Retry the observation rather than the fixture. Draining the queue is not a guarantee that
-- nothing else will re-index these pages a moment later, and reindexing removes a page's objects
-- before putting them back -- so a single audit can land in that gap and see a project without
-- its frontmatter. audit.run() reads and writes nothing, so asking again is free and asserting
-- "eventually reports this" is the true contract under an index that is eventually consistent.
--
-- Not vacuous: every condition below still has to hold, and a violation that is never reported
-- fails here after the bound is spent.
local all = {}
waitFor(function()
  local result = lifeloop.audit.run()
  all = {}
  for _, e in ipairs(result.safe) do table.insert(all, e.message) end
  for _, e in ipairs(result.review) do table.insert(all, e.message) end
  local joined = table.concat(all, " | ")
  return joined:find("deadline") ~= nil and joined:find("priority") ~= nil
     and joined:find("dithering") ~= nil and joined:find("Nowhere") ~= nil
end)

local joined = table.concat(all, " | ")
return { ok = joined:find("deadline") ~= nil
             and joined:find("priority") ~= nil
             and joined:find("dithering") ~= nil
             and joined:find("Nowhere") ~= nil
             and joined:find("cost") == nil,
         detail = all }
end)


return results
