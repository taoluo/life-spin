---
description: Projecting a task outward to Apple Reminders or a calendar. LifeLoop keeps the meaning; they do the execution.
tags: meta
---

LifeLoop owns what an action means and when it matters. It does not own alarms, notifications,
recurrence or calendar blocking — those have better owners, and reimplementing them here would be
building a worse version of software that already ships with your operating system.

Two commands project one task outward, and they are deliberately two:

| you mean | command | owner |
|---|---|---|
| don't let me forget this · every month · when I get to the office | `LifeLoop: Add Reminder` | **Apple Reminders** |
| Tuesday 2–3pm · this long · with these people | `LifeLoop: Add to Calendar` | **your calendar** |
| both, and stop asking me twice | `LifeLoop: Add Reminder and Calendar` (`/project`) | both |
| bring what I already projected back in step | `LifeLoop: Sync Projected` | — |

A single `Schedule` command would have to guess which of those you meant, and the guess matters:
**a deadline is not a time allocation.** `[deadline: "2026-09-10"]` says when something matters, not
that two hours of the 10th are spent on it. So neither command ever invents a clock time — a
date-only deadline prefills the date and the time prompt offers **All day** first.

# What this writes
A projection leaves one mark on the task it came from:

    * [ ] renew the parking permit [deadline: "2026-09-20"] [reminder: "x-apple-reminder://6F9F…"]
    * [ ] quarterly review [event: "12E4D5DA-3391-444B-9BC9-0C23F7088ADE"]

and nothing else, anywhere.

The mark is the same shape as the `[completed:]` stamp [[Library/LifeLoop/Completion]] writes, for
the same reason: a fact about a task belongs on the task's line, not in a side table LifeLoop would
then have to keep in step with your notes.

You will not normally read it. A `space-style` block collapses the id to 🔔 or 📅 — the id is still
there, and moving the cursor into the line shows it in full, because a mark you cannot inspect is
worse than no mark. See [[#Showing the mark without showing the id]].

## Why a mark is never trusted on sight
`[completed:]` can be kept true by construction: the fact it records lives in the note, so LifeLoop
owns it, and reopening a task removes the stamp because it would now be claiming something untrue.

A reminder is not like that. It lives in another application which can delete it without telling
anyone, so a stored id is a claim that can go stale behind your back. The answer is not to avoid
storing one — it is to **ask before believing it**. Every run starts by asking whether that id is
still there:

* **still there** → you are offered *Update it* or *Create another*, and dismissing cancels.
* **gone** → see below; the two commands answer this differently, on purpose.

So a mark is either true or absent; it is never quietly wrong. The cost is one extra `osascript`
round trip per run, which is the honest price of a fact you do not own.

## Calendar asks where Reminders decides
Reminders addresses a reminder by a globally unique id, so a lookup that comes back empty is
*proof*: that reminder is gone. The stale mark is erased on the spot and the projection proceeds as
a first one.

Calendar has no such handle through this interface. An event can only be searched for inside one
calendar at a time, and searching all of them takes around eighteen seconds on a set of
subscriptions of any size — measured, not guessed, and far too long for a command you are waiting
on. So the search is scoped to `lifeloop.calendarName`, and an empty result means *not in this
calendar*, which is not the same as gone: you may simply have dragged the event somewhere else.

Rather than guess — and a wrong guess here means silently creating the duplicate this whole feature
exists to prevent — the calendar command stops and asks, leaving the mark alone. That asymmetry is
not an oversight; it is the two applications offering different amounts of certainty, and LifeLoop
declining to invent the difference.

## What crosses over, and what cannot
Reminders' scripting interface exposes exactly three things — accounts, lists and reminders — and a
reminder has `name`, `body`, `due date`, `priority`, `flagged` and little else. **There is no subtask
and no tag anywhere in it.** So the structure you have here cannot be reproduced there; it can only
be mapped onto what exists:

| here | there | how |
|---|---|---|
| project / area | **list** | the task's project (or area) names the list, created the first time it is needed |
| tags | `flagged`, `priority` | via `lifeloop.flagTags` and `lifeloop.priorityTags`; inherited tags count |
| subtasks | a checklist in the note | `[ ]` / `[x]` lines, because nothing better exists |
| the page it came from | last line of the note | so a reminder read on a watch still says where it is from |

A reminder therefore looks like this — title clean, structure below it, provenance last:

    screen candidates
    ----------------------------
    Projects/Hiring
    #urgent
    [ ] read CVs
    [x] book rooms
    Notes/Recruiting

**The list is where the real gain is.** A list is the only grouping Reminders will show you on a
phone, so mapping projects onto lists is what makes a hundred projected tasks navigable instead of
one flat pile. Lists are created **lazily and never speculatively**: nothing enumerates your
projects, and a list appears the first time you actually project a task belonging to it. Turn the
whole thing off with `lifeloop.projectLists = false` and everything goes to one list as before.

A name you *configured* and got wrong is still refused — `lifeloop.remindersList` pointing at a list
that does not exist is a mistake, not an instruction to create one. Only derived names are created.

**Only the last path segment names the list**: `Projects/Hiring` becomes `Hiring`, because a sidebar
full of slashes is worse than one that matches what you already call these things. Two projects
whose leaf names collide share a list, which is visible the moment it happens.

### The title is cleaned, once
The indexed name of a task keeps its wiki links verbatim, so `screen candidates [[Projects/Hiring]]`
would arrive in Reminders exactly like that. The link that *establishes* the project is dropped —
it is already the list and the first line of the note — and every other link becomes its text, so
`ping [[People/Alice]]` stays `ping Alice` rather than losing who it is about.

### It is a snapshot
The note is written once and does not follow the page. Add a subtask here tomorrow and the reminder
still lists yesterday's; run the command again to bring it back in step. This is the same split the
rest of this page rests on — that application owns the reminder, this one owns the meaning — and not
a synchronisation that has been left unfinished.

## Calendar needs Calendar open — Reminders does not
Measured, not assumed. A LaunchAgent has no user session to launch a GUI application into, and the
two applications differ in whether that matters:

| | started on demand by the server | driven while already running |
|---|---|---|
| Reminders | **yes** | yes |
| Calendar | **no** (`-600`) | yes |

Reminders comes up by itself, so `LifeLoop: Add Reminder` works from your phone whether or not
anything is open on the Mac. Calendar does not, and it exits on its own after a while — so
`LifeLoop: Add to Calendar` works only while Calendar happens to be open over there. When it is not,
the command says *"open Calendar on the Mac first — it cannot be started from here"* rather than
passing along AppleScript's true but useless `Application isn't running`.

There is no fix for this from inside a space; it is a property of how the server is started. If you
rely on projecting to a calendar remotely, keep Calendar running on the Mac.

## Moving an event's date, and why the order matters
Calendar validates every assignment, and refuses any save where the start is not before the end
(`The start date must be before the end date.`, `-10025`). Assigning `start date` and `end date` one
after the other therefore passes through an illegal state whenever the event moves to a different
day — the new start is past the old end, or the new end is before the old start, depending on the
direction.

`set properties` with both dates in one record does not solve it: Calendar applies the end first,
which is exactly wrong for a move to an *earlier* date. So the update writes them in whichever order
keeps the pair legal at every step, chosen from the direction of the move. Verified across same-day
retimes, later and earlier moves within a month, later and earlier moves across months, and both
all-day conversions.

## Both at once
`LifeLoop: Add Reminder and Calendar` — or `/project` on the task line, which is the one that works
on a phone, where there is no key to bind — asks the date, time and length **once** and projects to
both. The reminder falls due at the moment the block starts, which is the only pairing that does not
require inventing a second answer you were never asked for. Both marks land on the line:

    * [ ] quarterly review [reminder: "x-apple-reminder://6F9F…"] [event: "12E4D5DA…"]

rendering as 🔔 📅.

Two differences from running the two commands yourself, both deliberate:

**It does not offer *Create another*.** A mark that still resolves is updated, silently. You asked
for both; "update what is already there" is the only reading of that which cannot quietly duplicate.
Reach for the individual commands when you actually want a second copy.

**It never reports one verdict for two applications.** Each half says what it did, side by side —
`Reminder added for 2026-09-20; Event failed: open Calendar on the Mac first`. This is not a corner
case being over-engineered: Calendar is unavailable whenever it is not already open on the Mac, so a
half-success is the *expected* outcome of running this remotely, and a single "done" would be a lie
about the half that did not happen. The reminder is attempted first for the same reason — if only
one half is going to land, the durable one is the better half to have.

## Selecting more than one task
Every projection command takes a **selection**: select a range and each open task in it is projected,
with the date and time asked once for all of them. With no selection it is the task at the cursor,
exactly as before.

A subtask whose parent is also selected is skipped — projecting both would put the same work in
Reminders twice, once as its own reminder and once inside the parent's checklist, and the parent is
the one carrying the context.

The loop runs **backwards through the document**, which is not an implementation detail you can
ignore: writing a mark lengthens its line and moves everything below it, so last-to-first is the
only order in which every task's recorded position is still valid when its turn comes.

## Keeping it in step afterwards
`LifeLoop: Sync Projected` pushes edits to everything already projected. Set `lifeloop.autoSync` and
it also runs by itself every `lifeloop.syncMinutes` minutes.

**It only ever pushes the title, the note and the flags — never the schedule.** The due date came
from an answer you gave once, and nothing in the note records it, so a background pass has no basis
for changing it and does not try.

### Which side wins, and how that is decided
A reminder carries a `modification date`, so the two sides can be compared and the newer one wins:

* **the note is newer** → the reminder is brought up to date.
* **the reminder is newer** → *nothing happens*. You edited it over there, and a background job that
  overwrites that is worse than no background job.

This needs no stored state, which is what makes it safe with two clients open at once: the second
one re-runs the same comparison and finds nothing to do.

### Calendar cannot be asked who edited last
Calendar's scripting dictionary has **no modification date on an event** — checked, not assumed. So
the comparison above is impossible there, and a calendar event is pushed whenever the page is newer
than this client's last successful push, remembered locally in the client's own datastore.

That is weaker in two ways worth stating plainly: an edit you make in Calendar **can** be overwritten
by a later edit here, and two clients each keep their own record, so both may push the same content
once. Neither loses anything you wrote in your notes; both are the price of an application that will
not say when it was last touched.

### There is no server-side background
`cron:secondPassed` is dispatched by the **client**, so a pass happens while a SilverBullet client is
open and not otherwise. The Mac serving your space is usually that client; a phone with the app
closed is not. This is a property of Space Lua running in the client, not something a setting fixes.

### Calendar is asked whether it is running, not tried
Calendar cannot be launched from the server's context at all, so each pass first asks
`application "Calendar" is running` — which is specified not to launch it, and was verified against a
closed Calendar. If it is not running, events are skipped for that pass. A failed push is never
reported and never recorded, so it is simply retried next time: a background job that interrupts you
every few minutes to report routine failures is worse than one that waits to be asked.

## Update, and what it does not do
*Update it* rewrites the title, the note, the date, and for an event its time and length. It does not
touch anything else you changed over there — a flag, a priority, a repeat rule, an invitee, an alarm
— because those are the reasons the other application is a better owner of them than LifeLoop.

*Create another* leaves the first one alone and makes a second. The mark then points at the newer
one, which is the only answer that keeps a single mark meaningful; the older item is yours to manage
where you chose to keep it.

## Failure, honestly
Cancel any prompt and nothing is sent anywhere — the application is not touched until every answer
is in hand. That much is certain.

Once the request reaches the other application, a failure reported back is not proof that nothing
happened. Everything checkable is checked before the create: the date and time are parsed here, and
the target list or calendar is resolved to exactly one inside the same script, immediately before the
item is made. Creating it is then the last fallible thing that happens.

Reading the id back does not weaken that. The id is taken from what `make new reminder`/`make new
event` already returned, not from a fresh read of the new item — so no new failure was introduced
between the create and the mark. If it ever cannot be parsed, the item still exists and the command
says so instead of writing a mark it cannot stand behind.

Nothing is ever retried automatically, since a retry after an ambiguous failure is how you end up
with two of something. A failed projection says the *notes* are unchanged, which is always true, and
asks you to look before retrying rather than claiming nothing was added.

# Recurrence lives there, not here
LifeLoop has no `[repeat: monthly]` and will not generate the next occurrence of anything.

A LifeLoop task is a **one-shot commitment**. A recurring commitment — pay the rent, file the
quarterly return — is durable context: it belongs on a project or area page, and its occurrences
belong to whatever is actually reminding you. A checkbox cannot be both. Tick it and you have
claimed the commitment is finished; leave it open and Today carries a task that is permanently,
inaccurately outstanding.

So set the repeat in Reminders, where the repeat UI already is. The corollary is worth being
explicit about: **occurrences you complete over there never appear in the Weekly Review's Completed
section.** That is the ownership split working, not a gap in it — LifeLoop's completion history
covers LifeLoop's own actions. See [[Library/LifeLoop/Completion]].

# Requirements
The bridge is `osascript`, which SilverBullet runs **on the server** — so this works when the
machine serving your space is the Mac you want the reminder on. That is the ordinary desktop-app
case. It is not the case for a space served from a container or another machine, and there the
commands say so rather than failing quietly.

The first run raises a macOS permission prompt for controlling Reminders or Calendar. Nothing works
until you allow it, which is as it should be.

SilverBullet kills a shell command at **60 seconds**, and that limit is a hard-coded constant on the
server, not something a space can raise. Every script here therefore sets its own AppleScript
timeout to 50 seconds: an AppleScript that gives up on its own says what it was doing, whereas one
killed from outside produces only `Command timed out after 60s and was killed`.

Fifty seconds is generous for everything except one case, which is worth knowing about because it is
reachable in normal use: moving a calendar event to a **different month** makes Apple Calendar
reschedule enough that it can exceed the limit. The projection then reports a failure, and — as
always — your notes are unchanged and the mark still points at an event that still exists. What is
*not* guaranteed in that case is that the event is untouched: the title may have been rewritten
before the dates were. That is the "look before retrying" case, stated rather than discovered.

Values are passed to `osascript` as **arguments**, never interpolated into the script. A task called
`Pay & file? #tax "now"` is a perfectly ordinary task, and text that would otherwise have to be
escaped into an AppleScript string literal is exactly where an injection bug lives.

# Configuration

| key | default | |
|---|---|---|
| `lifeloop.remindersList` | `Reminders` | list new reminders go to when nothing else applies |
| `lifeloop.projectLists` | `true` | send a reminder to a list named after the task's project or area |
| `lifeloop.flagTags` | none | tags that flag the reminder |
| `lifeloop.priorityTags` | none | tag → Reminders priority (1–4 high, 5 medium, 6–9 low) |
| `lifeloop.autoSync` | `false` | push edits to projected tasks periodically |
| `lifeloop.syncMinutes` | `5` | minutes between background passes |
| `lifeloop.calendarName` | `Calendar` | calendar new events go to |
| `lifeloop.eventMinutes` | `60` | default length of a timed event |

Point `lifeloop.calendarName` at whichever calendar you like. If that calendar is a Google one you
have added to Apple Calendar, the event lands in Google — LifeLoop neither knows nor needs to know
which account is behind the name. Apple Calendar already answers that question, and duplicating the
answer here would mean maintaining it.

**A name is only an identity if it is unique**, and two accounts can each expose a calendar called
"Work". So the name is resolved to exactly one target before anything is created: none by that name
refuses, more than one refuses and says so. Neither silently picks the first, because the first is
whichever account happened to sync earlier and the event would land somewhere plausible and wrong.

Reminders lists carry a stable id, so `lifeloop.remindersList` accepts one of those instead of a
name if you have duplicates you would rather not rename. Calendars expose no such handle through
this interface, so there the answer to a duplicate is to rename one.

# Implementation

## Talking to the applications
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.external = lifeloop.external or {}

-- On the namespace rather than a local: Space Lua gives each block its own scope, and the
-- commands live in a block of their own further down.
--
-- `on run argv` keeps every value out of the script's own text. The alternative -- building a
-- script by concatenation -- turns a task containing a quote into a syntax error, and a task
-- containing `" ) tell application "Finder"` into something worse.
lifeloop.external.reminderScript = [==[
on run argv
  set theList to item 1 of argv
  set theTitle to item 2 of argv
  set theNotes to item 3 of argv
  set theDay to item 4 of argv
  set theTime to item 5 of argv
  set d to current date
  set year of d to (text 1 thru 4 of theDay) as integer
  set month of d to (text 6 thru 7 of theDay) as integer
  set day of d to (text 9 thru 10 of theDay) as integer
  if theTime is "" then
    set time of d to 0
  else
    set time of d to ((text 1 thru 2 of theTime) as integer) * hours + ((text 4 thru 5 of theTime) as integer) * minutes
  end if
  with timeout of 50 seconds
    tell application "Reminders"
      if theList contains "-" and (count of theList) is 36 then
        set target to list id theList
      else
        set matches to (every list whose name is theList)
        if (count of matches) is 0 then
          error "no reminders list is named " & theList number -2700
        end if
        if (count of matches) > 1 then
          error "more than one reminders list is named " & theList & " -- rename one, or set the list to its id" number -2700
        end if
        set target to item 1 of matches
      end if
      set theReminder to make new reminder at end of target with properties {name:theTitle, body:theNotes, due date:d}
      -- Optional trailing arguments, so a five-argument call keeps working exactly as it did.
      if (count of argv) > 5 then
        set p to (item 6 of argv) as integer
        if p > 0 then set priority of theReminder to p
      end if
      if (count of argv) > 6 then
        if (item 7 of argv) is "1" then set flagged of theReminder to true
      end if
      return theReminder
    end tell
  end timeout
end run
]==]

-- Resolving a list that was *derived* from a project or area, as opposed to one you configured by
-- name. The difference decides what a missing list means: a name you typed and got wrong is a
-- mistake worth refusing (see `reminderScript`), while a project that has simply never been
-- projected before is not -- so this one creates it.
--
-- Creation is lazy in the strict sense: nothing enumerates your projects and builds lists for them.
-- A list appears the first time you actually project a task belonging to that project, and never
-- otherwise.
lifeloop.external.ensureListScript = [==[
on run argv
  set theName to item 1 of argv
  with timeout of 50 seconds
    tell application "Reminders"
      set matches to (every list whose name is theName)
      if (count of matches) > 1 then
        error "more than one reminders list is named " & theName & " -- rename one, or set the list to its id" number -2700
      end if
      if (count of matches) is 0 then
        make new list with properties {name:theName}
        return "created"
      end if
      return "found"
    end tell
  end timeout
end run
]==]

-- When a reminder was last touched, as a UTC epoch, so it can be compared with the note's own
-- modification time. This is what makes background sync safe: if the reminder is newer, you edited
-- it over there, and nothing here is entitled to overwrite that.
--
-- The epoch conversion is `(date - 1970) - (time to GMT)`, which lands on exactly the same number
-- Lua's `os.time` produces for the same instant -- verified, not assumed.
-- Whether an application is running, asked in the one way that does not start it. `is running` is
-- specified not to launch, and that was verified against a closed Calendar rather than taken on
-- faith. The background pass needs this: Calendar cannot be started from a LaunchAgent context at
-- all, so probing it by trying is a guaranteed failure every cycle.
lifeloop.external.runningScript = [==[
on run argv
  if (item 1 of argv) is "Calendar" then
    return ((application "Calendar" is running) as string)
  end if
  return ((application "Reminders" is running) as string)
end run
]==]

lifeloop.external.mtimeScript = [==[
on run argv
  set theId to item 1 of argv
  with timeout of 50 seconds
    tell application "Reminders"
      try
        set theReminder to reminder id theId
      on error number -1728
        return "missing"
      end try
      set m to modification date of theReminder
      return (((m - (date "Thursday, January 1, 1970 at 12:00:00 AM")) - (time to GMT)) as integer) as string
    end tell
  end timeout
end run
]==]

-- Bringing a reminder back in step with its note, without touching the schedule. The due date came
-- from an answer you gave once; nothing in the note records it, so a background pass has no basis
-- for changing it and does not try.
lifeloop.external.syncScript = [==[
on run argv
  set theId to item 1 of argv
  set theTitle to item 2 of argv
  set theNotes to item 3 of argv
  with timeout of 50 seconds
    tell application "Reminders"
      try
        set theReminder to reminder id theId
      on error number -1728
        return "missing"
      end try
      set name of theReminder to theTitle
      set body of theReminder to theNotes
      if (count of argv) > 3 then
        set priority of theReminder to ((item 4 of argv) as integer)
      end if
      if (count of argv) > 4 then
        set flagged of theReminder to ((item 5 of argv) is "1")
      end if
      return "synced"
    end tell
  end timeout
end run
]==]

-- The same for an event. Calendar exposes no modification date of any kind -- checked against its
-- scripting dictionary, where `event` has no such property -- so there is no way to ask whether you
-- changed it over there. See [[#Calendar cannot be asked who edited last]].
lifeloop.external.syncEventScript = [==[
on run argv
  set theCalendar to item 1 of argv
  set theUid to item 2 of argv
  set theTitle to item 3 of argv
  set theNotes to item 4 of argv
  with timeout of 50 seconds
    tell application "Calendar"
      set matches to (every calendar whose name is theCalendar)
      if (count of matches) is 0 then return "missing"
      tell (item 1 of matches)
        set hits to (every event whose uid = theUid)
        if (count of hits) is 0 then return "missing"
        tell (item 1 of hits)
          set summary to theTitle
          set description to theNotes
        end tell
        return "synced"
      end tell
    end tell
  end timeout
end run
]==]

-- Asking the owner whether a reminder is still there, rather than trusting a mark in the note to
-- still be true. Answers "found" or "missing" and nothing else: the -1728 test belongs in
-- AppleScript, where the error number is available, not in a regex over an error message.
lifeloop.external.lookupScript = [==[
on run argv
  set theId to item 1 of argv
  with timeout of 50 seconds
    tell application "Reminders"
      try
        get reminder id theId
        return "found"
      on error number -1728
        return "missing"
      end try
    end tell
  end timeout
end run
]==]

-- Rewriting the reminder a mark points at. Deliberately not a create: this is the branch that
-- exists so that projecting a task twice does not leave two of it lying around.
--
-- "missing" is still possible here even though the lookup just said "found" -- the reminder can be
-- deleted in between. That is reported as its own outcome rather than as a failure, because the
-- honest response is to clear the stale mark, not to claim the write broke.
lifeloop.external.updateScript = [==[
on run argv
  set theId to item 1 of argv
  set theTitle to item 2 of argv
  set theNotes to item 3 of argv
  set theDay to item 4 of argv
  set theTime to item 5 of argv
  set d to current date
  set year of d to (text 1 thru 4 of theDay) as integer
  set month of d to (text 6 thru 7 of theDay) as integer
  set day of d to (text 9 thru 10 of theDay) as integer
  if theTime is "" then
    set time of d to 0
  else
    set time of d to ((text 1 thru 2 of theTime) as integer) * hours + ((text 4 thru 5 of theTime) as integer) * minutes
  end if
  with timeout of 50 seconds
    tell application "Reminders"
      try
        set theReminder to reminder id theId
      on error number -1728
        return "missing"
      end try
      set name of theReminder to theTitle
      set body of theReminder to theNotes
      set due date of theReminder to d
      if (count of argv) > 5 then
        set p to (item 6 of argv) as integer
        set priority of theReminder to p
      end if
      if (count of argv) > 6 then
        set flagged of theReminder to ((item 7 of argv) is "1")
      end if
      return "updated"
    end tell
  end timeout
end run
]==]

lifeloop.external.eventScript = [==[
on run argv
  set theCalendar to item 1 of argv
  set theTitle to item 2 of argv
  set theNotes to item 3 of argv
  set theDay to item 4 of argv
  set theTime to item 5 of argv
  set theMinutes to (item 6 of argv) as integer
  set d to current date
  set year of d to (text 1 thru 4 of theDay) as integer
  set month of d to (text 6 thru 7 of theDay) as integer
  set day of d to (text 9 thru 10 of theDay) as integer
  with timeout of 50 seconds
    tell application "Calendar"
      set matches to (every calendar whose name is theCalendar)
      if (count of matches) is 0 then
        error "no calendar is named " & theCalendar number -2700
      end if
      if (count of matches) > 1 then
        error "more than one calendar is named " & theCalendar & " -- rename one so they can be told apart" number -2700
      end if
      tell (item 1 of matches)
        if theTime is "" then
          set time of d to 0
          set theEvent to make new event with properties {summary:theTitle, description:theNotes, start date:d, end date:d + 1 * days, allday event:true}
        else
          set time of d to ((text 1 thru 2 of theTime) as integer) * hours + ((text 4 thru 5 of theTime) as integer) * minutes
          set theEvent to make new event with properties {summary:theTitle, description:theNotes, start date:d, end date:d + theMinutes * minutes}
        end if
        return uid of theEvent
      end tell
    end tell
  end timeout
end run
]==]

-- Asking whether an event is still where the mark says it is. Scoped to one calendar on purpose:
-- searching every calendar takes ~18s on a tailnet-sized set of subscriptions, which is not a price
-- an interactive command can pay. The cost of the narrow search is that "missing" here means "not in
-- this calendar" rather than "gone", and the command treats it accordingly -- it asks instead of
-- assuming. See [[#Calendar asks where Reminders decides]].
lifeloop.external.lookupEventScript = [==[
on run argv
  set theCalendar to item 1 of argv
  set theUid to item 2 of argv
  with timeout of 50 seconds
    tell application "Calendar"
      set matches to (every calendar whose name is theCalendar)
      if (count of matches) is 0 then
        error "no calendar is named " & theCalendar number -2700
      end if
      tell (item 1 of matches)
        if (count of (every event whose uid = theUid)) is 0 then return "missing"
        return "found"
      end tell
    end tell
  end timeout
end run
]==]

-- Rewriting the event a mark points at. All-day and timed are separate branches for the same reason
-- the create is: an all-day event has no clock time to set, and giving it one would manufacture the
-- allocation this whole split exists to avoid.
lifeloop.external.updateEventScript = [==[
on run argv
  set theCalendar to item 1 of argv
  set theUid to item 2 of argv
  set theTitle to item 3 of argv
  set theNotes to item 4 of argv
  set theDay to item 5 of argv
  set theTime to item 6 of argv
  set theMinutes to (item 7 of argv) as integer
  set d to current date
  set year of d to (text 1 thru 4 of theDay) as integer
  set month of d to (text 6 thru 7 of theDay) as integer
  set day of d to (text 9 thru 10 of theDay) as integer
  if theTime is "" then
    set time of d to 0
    set newEnd to d + 1 * days
    set isAllDay to true
  else
    set time of d to ((text 1 thru 2 of theTime) as integer) * hours + ((text 4 thru 5 of theTime) as integer) * minutes
    set newEnd to d + theMinutes * minutes
    set isAllDay to false
  end if
  with timeout of 50 seconds
    tell application "Calendar"
      set matches to (every calendar whose name is theCalendar)
      if (count of matches) is 0 then
        error "no calendar is named " & theCalendar number -2700
      end if
      tell (item 1 of matches)
        set hits to (every event whose uid = theUid)
        if (count of hits) is 0 then return "missing"
        tell (item 1 of hits)
          set summary to theTitle
          set description to theNotes
          set allday event to isAllDay
          -- Calendar validates on every assignment and refuses a save where the start is not before
          -- the end ("The start date must be before the end date.", -10025), so the order has to
          -- follow the direction of the move. Setting both at once through `set properties` does not
          -- help: it applies the end first, which is exactly wrong for a move to an earlier date.
          if d > (end date of it) then
            set end date to newEnd
            set start date to d
          else
            set start date to d
            set end date to newEnd
          end if
        end tell
        return "updated"
      end tell
    end tell
  end timeout
end run
]==]

-- osascript reports failures as "123:456: execution error: the real message (-2700)". Only the
-- middle of that means anything to someone reading a notification.
local function readable(stderr)
  local message = string.trim(stderr or "")
  local inner = string.match(message, "execution error:%s*(.-)%s*%(%-?%d+%)%s*$")
  return inner or message
end

-- Returns ok, message. A bridge that is not there is a refusal with a reason, never a stack trace:
-- shell.run throws outright when the client has no server to run anything on.
function lifeloop.external.run(script, args)
  local call = { "-e", script, "--" }
  for _, a in ipairs(args) do
    table.insert(call, a)
  end
  local ok, result = pcall(function() return shell.run("osascript", call) end)
  if not ok then
    return false, "cannot reach a shell from here -- this needs a space served by the Mac you want the reminder on"
  end
  if result.code != 0 then
    -- Deliberately not "nothing happened". The application can fail *after* creating the item --
    -- a slow first launch times out on its way back with the id -- and claiming otherwise would
    -- send someone off to retry into a duplicate. What is certain is that nothing here changed.
    local why = readable(result.stderr)
    return false, why != "" and why or "the application refused"
  end
  -- Whatever the script printed. Nothing is *asked* for after the item is created -- the scripts
  -- no longer read the new item's id back, since that read could fail after the work was done and
  -- turn a success into a reported failure.
  return true, string.trim(result.stdout or "")
end
```

## What may be projected
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.external = lifeloop.external or {}

-- Reuses the task universe rather than inventing a second notion of actionable. `#waiting` and
-- `#someday` are kept out of Today because they are not actionable *now*; that is no reason to
-- refuse a projection you have explicitly asked for -- wanting a reminder about the thing you are
-- waiting on is the ordinary case.
function lifeloop.external.eligible()
  local task = lifeloop.tasks.atCursor()
  if not task then
    return nil, "put the cursor on a task first"
  end
  if task.done then
    return nil, "that task is already done"
  end
  return task
end

-- What the task is called, once it is out of Markdown. The indexed name keeps wiki links verbatim
-- ("screen candidates [[Projects/Hiring]]"), which reads as noise in a Reminders row -- especially
-- now that the project is carried by the list and the note. So links become their text: an alias if
-- it has one, otherwise the last path segment, so "[[People/Alice]]" reads as "Alice".
function lifeloop.external.title(task)
  local text = task.name or ""
  local context = lifeloop.external.contextName(task)

  -- An aliased link was already written for humans; keep the alias.
  text = string.gsub(text, "%[%[([^%]|]*)|([^%]]*)%]%]", "%2")

  text = string.gsub(text, "%[%[([^%]]*)%]%]", function(target)
    -- The link that establishes the project or area is dropped rather than flattened: it is
    -- already the list the reminder lives in and the first line of its note, and repeating it in
    -- the title is the noise this function exists to remove. Every other link is part of the
    -- sentence -- "discuss [[People/Alice]]" has to keep saying Alice -- so it becomes its text.
    if context and target == context then
      return ""
    end
    return string.match(target, "([^/]+)$") or target
  end)

  text = string.gsub(text, "%s+", " ")
  return string.trim(text)
end

-- What a projection applies to: the selection if there is one, otherwise the task at the cursor.
--
-- A subtask whose parent is also selected is left out. Projecting both would put the same work in
-- Reminders twice -- once as its own reminder and once inside the parent's checklist -- and the
-- parent is the one that carries the context, so it is the one that survives.
function lifeloop.external.eligibleAll()
  local selection = editor.getSelection()
  if not selection or selection.from == selection.to then
    local task, why = lifeloop.external.eligible()
    if not task then
      return nil, why
    end
    return { task }
  end

  local picked = {}
  for _, t in ipairs(lifeloop.tasks.universe(editor.getCurrentPage())) do
    -- The task's own line has to start inside the selection: a selection that merely runs through
    -- a parent's subtree has not selected the parent.
    if t.pos >= selection.from and t.pos < selection.to and not t.done then
      table.insert(picked, t)
    end
  end
  if #picked == 0 then
    return nil, "no open task in the selection"
  end

  local selected = {}
  for _, t in ipairs(picked) do
    selected[t.ref] = true
  end
  local out = {}
  for _, t in ipairs(picked) do
    if not (t.parent and selected[t.parent]) then
      table.insert(out, t)
    end
  end
  table.sort(out, function(a, b) return a.pos < b.pos end)
  return out
end

-- `pageLastModified` is local wall-clock text ("2026-09-06T11:33:32.801"), and `os.time` reads a
-- table as local time, so this lands on a UTC epoch -- the same number AppleScript produces for the
-- same instant. Calibrated against all three clocks rather than reasoned about.
function lifeloop.external.epochOf(stamp)
  local y, mo, d, h, mi, sec = string.match(stamp or "", "(%d+)-(%d+)-(%d+)T(%d+):(%d+):(%d+)")
  if not y then
    return nil
  end
  return os.time {
    year = tonumber(y), month = tonumber(mo), day = tonumber(d),
    hour = tonumber(h), min = tonumber(mi), sec = tonumber(sec),
  }
end

-- The project or area a task belongs to. Reminders has no notion of either, but it does have
-- **lists**, and a list is the only grouping it will actually show you on a phone -- so that is
-- where this maps, rather than into text nobody can sort by.
function lifeloop.external.contextName(task)
  local project = lifeloop.tasks.contextProject(task)
  if project then
    return project
  end
  -- Areas are reached the same way projects are: the page it lives on, or the one thing it links to
  -- that is an area. More than one and there is no answer, so there is no guess either.
  local areas = lifeloop.areaSet()
  if areas[task.page] then
    return task.page
  end
  local found
  for _, link in ipairs(task.ilinks or {}) do
    if areas[link] then
      if found then return nil end
      found = link
    end
  end
  return found
end

-- Only the last segment: "Projects/Hiring" becomes "Hiring". A Reminders sidebar full of slashes is
-- worse than one that matches what you already call these things -- at the price of two projects
-- with the same leaf name sharing a list, which is visible the moment it happens.
function lifeloop.external.listName(name)
  return string.match(name, "([^/]+)$") or name
end

-- Returns the list, and whether it was *derived*. That second value decides what a missing list
-- means: a name you configured and got wrong is a mistake worth refusing, while a project you have
-- simply never projected before is not.
function lifeloop.external.targetList(task)
  if config.get("lifeloop.projectLists", true) then
    local context = lifeloop.external.contextName(task)
    if context then
      return lifeloop.external.listName(context), true
    end
  end
  return config.get("lifeloop.remindersList", "Reminders"), false
end

-- Subtasks, which Reminders cannot represent: its dictionary has no subtask of any kind, so the
-- structure is written into the note as a checklist rather than pretended at.
function lifeloop.external.subtasks(task)
  local out = {}
  for _, t in ipairs(lifeloop.tasks.universe(task.page)) do
    if t.parent == task.ref then
      table.insert(out, t)
    end
  end
  table.sort(out, function(a, b) return a.pos < b.pos end)
  return out
end

-- What travels with the reminder. Provenance first, because a reminder read on a watch three days
-- later should still say where it came from.
--
-- This is a **snapshot**, and saying so is the point: the note it is copied from goes on changing
-- and this text does not. Reminders owns the reminder; re-run the command to bring it back in step.
function lifeloop.external.notes(task)
  local lines = {}
  local context = lifeloop.external.contextName(task)
  if context and context != task.page then
    lines[#lines + 1] = context
  end

  local tags = {}
  for _, tag in ipairs(task.tags or {}) do
    tags[#tags + 1] = "#" .. tag
  end
  if #tags > 0 then
    lines[#lines + 1] = table.concat(tags, " ")
  end

  for _, sub in ipairs(lifeloop.external.subtasks(task)) do
    lines[#lines + 1] = (sub.done and "[x] " or "[ ] ") .. sub.name
  end

  lines[#lines + 1] = task.page
  return table.concat(lines, "\n")
end

-- Reminders sorts and filters on priority and flag, and has no tags at all. So the tags you already
-- use to mean "this one matters" map onto the two fields it does understand, instead of being
-- dropped on the floor. Inherited tags count: a subtask under a #urgent parent is urgent.
function lifeloop.external.priorityFor(task)
  local map = config.get("lifeloop.priorityTags", {})
  for _, tag in ipairs(task.itags or {}) do
    if map[tag] then
      return map[tag]
    end
  end
  return 0
end

function lifeloop.external.flaggedFor(task)
  local flags = config.get("lifeloop.flagTags", {})
  for _, tag in ipairs(task.itags or {}) do
    for _, flag in ipairs(flags) do
      if tag == flag then
        return true
      end
    end
  end
  return false
end

-- The mark. A projected task carries `[reminder: "<id>"]` or `[event: "<uid>"]`, in the same shape
-- as the `[completed:]` stamp Completion writes, and for the same reason: the fact belongs on the
-- line it is about, not in a side table LifeLoop would then have to keep in step with your notes.
--
-- The one difference is where the truth lives. Completion's fact is *in* the note, so LifeLoop can
-- keep the stamp true by construction. A reminder or an event lives in another application, which
-- can delete it without telling anyone -- so a mark is never trusted on sight, only after asking.
function lifeloop.external.markPattern(attribute)
  return "%s*%[" .. attribute .. ':%s*"[^"]*"%]'
end

function lifeloop.external.storedMark(text, attribute)
  return string.match(text or "", "%[" .. attribute .. ':%s*"([^"]*)"%]')
end

-- A task's own text, addressed by position rather than by "wherever the cursor is": from its list
-- marker to the end of that line. The indexed range covers the whole subtree, so the end of the
-- range is not the end of the task; and `pos` starts at the marker, so a nested task's indent is
-- not included -- which is what keeps the indent untouched when a mark is written.
--
-- `pos` is an editor offset and Lua strings are 1-based, hence the +1 on the way in. The returned
-- `from`/`to` are editor offsets again, ready for `editor.dispatch`.
function lifeloop.external.lineOf(text, task)
  local from = task.pos
  local newline = string.find(text, "\n", from + 1, true)
  local last = newline and (newline - 1) or #text
  local line = string.sub(text, from + 1, last)
  return line, from, from + #line
end

-- Writing a mark at a position instead of at the cursor. This is what makes projecting a selection
-- possible: several tasks on several lines, none of them where the cursor happens to be.
function lifeloop.external.setMarkAt(task, attribute, id)
  if not task then
    return false
  end
  local line, from, to = lifeloop.external.lineOf(editor.getText(), task)
  local text = string.gsub(line, lifeloop.external.markPattern(attribute), "")
  text = string.gsub(text, "%s+$", "")
  editor.dispatch {
    changes = { from = from, to = to,
                insert = text .. " [" .. attribute .. ': "' .. id .. '"]' },
  }
  return true
end

function lifeloop.external.clearMarkAt(task, attribute)
  if not task then
    return false
  end
  local line, from, to = lifeloop.external.lineOf(editor.getText(), task)
  editor.dispatch {
    changes = { from = from, to = to,
                insert = string.gsub(line, lifeloop.external.markPattern(attribute), "") },
  }
  return true
end

-- The mark a task already carries, read from its line rather than from the cursor's.
function lifeloop.external.markOf(task, attribute)
  if not task then
    return nil
  end
  local line = lifeloop.external.lineOf(editor.getText(), task)
  return lifeloop.external.storedMark(line, attribute)
end

-- Both writers act on the *current line*, which is sound here and nowhere else: every caller has
-- already been through `eligible()`, and that resolves the task at the cursor.
function lifeloop.external.setMark(attribute, id)
  local line = editor.getCurrentLine()
  if not line then
    return false
  end
  local text = string.gsub(line.text, lifeloop.external.markPattern(attribute), "")
  text = string.gsub(text, "%s+$", "")
  editor.dispatch {
    changes = { from = line.from, to = line.to,
                insert = text .. " [" .. attribute .. ': "' .. id .. '"]' },
  }
  return true
end

function lifeloop.external.clearMark(attribute)
  local line = editor.getCurrentLine()
  if not line then
    return false
  end
  editor.dispatch {
    changes = {
      from = line.from,
      to = line.to,
      insert = string.gsub(line.text, lifeloop.external.markPattern(attribute), ""),
    },
  }
  return true
end

-- The date LifeLoop already knows, if it knows one: when you meant to do it beats when it is due,
-- and neither is invented.
function lifeloop.external.suggestedDay(task)
  return lifeloop.tasks.scheduled(task) or lifeloop.tasks.deadline(task) or lifeloop.date.today()
end

-- A blank answer means all day. Anything else has to be a real HH:MM, because a time we cannot
-- parse would otherwise be silently dropped and the event would quietly become all-day.
function lifeloop.external.parseTime(value)
  value = string.trim(value or "")
  if value == "" then
    return "", true
  end
  local hours, minutes = string.match(value, "^(%d%d?):(%d%d)$")
  if not hours or tonumber(hours) > 23 or tonumber(minutes) > 59 then
    return nil, false
  end
  return string.format("%02d", tonumber(hours)) .. ":" .. minutes, true
end
```

## The commands
```space-lua
-- priority: 10
lifeloop = lifeloop or {}
lifeloop.external = lifeloop.external or {}

-- Every prompt is a chance to cancel, and cancelling before the last one means nothing has
-- happened anywhere: the application is not touched until every answer is in hand.
local function ask(task, askDuration)
  -- Backing out is not a mistake, so it is not reported as one: only an answer that was actually
  -- given and cannot be used earns a complaint.
  local rawDay = some(editor.prompt("Date (YYYY-MM-DD)", lifeloop.external.suggestedDay(task)))
  if rawDay == nil or string.trim(rawDay) == "" then
    return nil, "cancelled"
  end
  local day = lifeloop.date.day(string.trim(rawDay))
  if not day then
    return nil, "needs a date as YYYY-MM-DD"
  end

  local raw = some(editor.prompt("Time as HH:MM, or leave empty for all day", ""))
  if raw == nil then
    return nil, "cancelled"
  end
  local time, ok = lifeloop.external.parseTime(raw)
  if not ok then
    return nil, "needs a time as HH:MM, or nothing at all"
  end

  local minutes = config.get("lifeloop.eventMinutes", 60)
  -- An all-day event has no duration to ask about. Offering one, or quietly applying the default,
  -- would manufacture the time allocation this whole split exists to avoid.
  if askDuration and time != "" then
    local answer = some(editor.prompt("Minutes", tostring(minutes)))
    if answer == nil then
      return nil, "cancelled"
    end
    minutes = tonumber(string.trim(answer))
    if not minutes or minutes <= 0 then
      return nil, "needs a length in minutes"
    end
  end

  return { day = day, time = time, minutes = minutes }
end

-- A GUI application that is not running cannot be started from the server's context: a LaunchAgent
-- has no session to launch one into, and AppleScript reports that as -600. Reminders is unaffected
-- in practice -- it comes up on demand -- but Calendar does not, and the raw message ("Application
-- isn't running") is true and useless. What you can act on is that opening it fixes this.
local function explain(app, message)
  if string.find(message, "isn.t running") or string.find(message, "Connection is invalid") then
    return "open " .. app .. " on the Mac first -- it cannot be started from here"
  end
  return message
end

-- Bringing what has already been projected back in step with the notes.
--
-- Direction is decided per reminder, by comparing when the note was last written with when the
-- reminder was last touched. The note being newer is the only case that justifies a write; a
-- reminder that is newer was edited over there, and overwriting it would quietly destroy the edit
-- this whole feature exists to respect.
--
-- Calendar gets no such test, because it offers none: its scripting dictionary has no modification
-- date on an event. So a calendar event is pushed only when the page is newer than the last push
-- this client made, remembered locally. That is weaker -- an edit made in Calendar can still be
-- overwritten by a later edit here -- and the asymmetry is stated rather than smoothed over.
local function pushSummary(task)
  return lifeloop.external.title(task), lifeloop.external.notes(task)
end

function lifeloop.external.syncTask(task, calendarRunning)
  local pageAt = lifeloop.external.epochOf(task.pageLastModified)
  if not pageAt then
    return 0
  end
  local title, notes = pushSummary(task)
  local pushed = 0

  local reminderId = task.reminder
  if reminderId then
    local ok, answer = lifeloop.external.run(lifeloop.external.mtimeScript, { reminderId })
    if ok then
      local remoteAt = tonumber(string.trim(answer))
      -- "missing" parses as nil and is simply left alone: a background pass does not edit your
      -- pages, so a stale mark is cleared the next time you run the command yourself.
      if remoteAt and pageAt > remoteAt then
        local synced = lifeloop.external.run(lifeloop.external.syncScript, {
          reminderId, title, notes,
          tostring(lifeloop.external.priorityFor(task)),
          lifeloop.external.flaggedFor(task) and "1" or "0",
        })
        if synced then
          pushed = pushed + 1
        end
      end
    end
  end

  local eventId = task.event
  if eventId and calendarRunning then
    local key = { "lifeloop", "sync", "event", task.ref }
    local last = datastore.get(key)
    if not last or pageAt > last then
      local ok = lifeloop.external.run(lifeloop.external.syncEventScript, {
        config.get("lifeloop.calendarName", "Calendar"), eventId, title, notes,
      })
      -- A failure is dropped on purpose: Calendar is unreliable by nature here, and a background
      -- pass that reports its own failures every few minutes is worse than one that stays quiet.
      -- Only a success is recorded, so a failed push is retried on the next pass.
      if ok then
        datastore.set(key, pageAt)
        pushed = pushed + 1
      end
    end
  end

  return pushed
end

-- Every task that has been projected, anywhere in the space. The marks are indexed as ordinary
-- attributes, so this is a query rather than a scan of page text.
function lifeloop.external.projected()
  local out = {}
  for _, t in ipairs(lifeloop.tasks.universe()) do
    if t.reminder or t.event then
      table.insert(out, t)
    end
  end
  return out
end

function lifeloop.external.syncAll()
  local tasks = lifeloop.external.projected()
  if #tasks == 0 then
    return 0, 0
  end
  -- Asked once for the whole pass, and only if something actually needs it.
  local calendarRunning = false
  for _, t in ipairs(tasks) do
    if t.event then
      local ok, answer = lifeloop.external.run(lifeloop.external.runningScript, { "Calendar" })
      calendarRunning = ok and string.trim(answer) == "true"
      break
    end
  end
  local pushed = 0
  for _, t in ipairs(tasks) do
    pushed = pushed + lifeloop.external.syncTask(t, calendarRunning)
  end
  return pushed, #tasks
end

-- What an existing mark means, established by asking the other application rather than by reading
-- the note. Returns "none" | "gone" | "cancelled" | "update" | "create", plus the stored id.
--
-- `certain` is the difference between the two commands. Reminders addresses a reminder by a globally
-- unique id, so "missing" there is proof the thing is gone and the stale mark is erased on the spot
-- -- exactly what Completion does to a `[completed:]` stamp when a task is reopened. Calendar can
-- only be searched one calendar at a time, so "missing" there might just mean you moved the event;
-- that is not proof of anything, so nothing is erased and the choice goes to you.
local function resolveMark(task, attribute, lookup, certain, assumeUpdate)
  local id = lifeloop.external.markOf(task, attribute)
  if not id then
    return "none"
  end

  local ok, answer = lifeloop.external.run(lookup, id)
  if not ok then
    return nil, answer
  end

  if string.trim(answer) == "missing" then
    if certain then
      lifeloop.external.clearMarkAt(task, attribute)
      return "gone"
    end
    local confirm = editor.filterBox("That event is not in this calendar", {
      { name = "Create a new one", value = "create",
        description = "It may have been deleted, or moved to another calendar" },
    }, "Dismiss to cancel -- check the calendar first if you are not sure")
    if not confirm then
      return "cancelled"
    end
    return "create", nil, id
  end

  -- `Add Reminder and Calendar` does not stop to ask: you asked for both, and "update what is already
  -- there" is the only reading of that which cannot silently duplicate.
  if assumeUpdate then
    return "update", nil, id
  end

  local choice = editor.filterBox("This task has already been projected", {
    { name = "Update it", value = "update",
      description = "Rewrite what is over there to match the task and the answers below" },
    { name = "Create another", value = "create",
      description = "Leave that one alone and make a second" },
  }, "Dismiss to cancel -- nothing is sent either way")

  if not choice then
    return "cancelled"
  end
  return choice.value, nil, id
end

-- The tail every projection shares: interpret the result, record the id on a create, and hand back
-- a sentence. Returning the sentence rather than flashing it is what lets the combined command say
-- "one worked, the other did not" -- the case that matters most, because Calendar is the half that
-- is routinely unavailable.
local function apply(task, mode, attribute, pattern, label, ok, message, day, existingId)
  if not ok then
    return false, label .. " failed: " .. message
  end
  message = string.trim(message)

  if mode == "update" then
    -- Deleted between the lookup and the write. Nothing was created, so the mark is the only thing
    -- left that is untrue.
    if message == "missing" then
      lifeloop.external.clearMarkAt(task, attribute)
      return false, label .. " is gone -- its mark is cleared, run this again to make a new one"
    end
    return true, label .. " updated for " .. day
  end

  -- The id comes out of what `make new ...` already returned, not from a fresh read of the new item
  -- -- that distinction is why the create is still the last fallible thing that happens. If no id
  -- can be found the item still exists, and saying so beats inventing a mark.
  local id = string.match(message, pattern)
  if not id then
    return false, label .. " added for " .. day .. ", but its id could not be read -- no mark written"
  end
  lifeloop.external.setMarkAt(task, attribute, id)
  return true, (existingId and (label .. " added again for ") or (label .. " added for ")) .. day
end

-- The two projections as reusable steps, so the combined command runs exactly the same code the
-- individual ones do rather than a second implementation that can drift away from them.
local function projectReminder(task, when, assumeUpdate)
  local mode, lookupError, existingId = resolveMark(
    task, "reminder",
    function(id) return lifeloop.external.run(lifeloop.external.lookupScript, { id }) end,
    true, assumeUpdate)
  if not mode then
    return false, explain("Reminders", lookupError)
  end
  if mode == "cancelled" then
    return nil, nil
  end

  local notes = lifeloop.external.notes(task)
  local priority = tostring(lifeloop.external.priorityFor(task))
  local flagged = lifeloop.external.flaggedFor(task) and "1" or "0"

  local ok, message
  if mode == "update" then
    ok, message = lifeloop.external.run(lifeloop.external.updateScript, {
      existingId, lifeloop.external.title(task), notes, when.day, when.time, priority, flagged })
  else
    -- A derived list is created on demand; a configured one is not. Getting this the wrong way
    -- round would either refuse a project that has simply never been projected before, or quietly
    -- manufacture a list out of a name you mistyped.
    local list, derived = lifeloop.external.targetList(task)
    if derived then
      local listOk, listSaid = lifeloop.external.run(lifeloop.external.ensureListScript, { list })
      if not listOk then
        return false, explain("Reminders", listSaid)
      end
    end
    ok, message = lifeloop.external.run(lifeloop.external.reminderScript, {
      list, lifeloop.external.title(task), notes, when.day, when.time, priority, flagged })
  end
  return apply(task, mode, "reminder", "(x%-apple%-reminder://[%w%-]+)", "Reminder",
               ok, ok and message or explain("Reminders", message), when.day, existingId)
end

local function projectEvent(task, when, assumeUpdate)
  local calendar = config.get("lifeloop.calendarName", "Calendar")
  local mode, lookupError, existingId = resolveMark(
    task, "event",
    function(id)
      return lifeloop.external.run(lifeloop.external.lookupEventScript, { calendar, id })
    end,
    false, assumeUpdate)
  if not mode then
    return false, explain("Calendar", lookupError)
  end
  if mode == "cancelled" then
    return nil, nil
  end

  local ok, message
  if mode == "update" then
    ok, message = lifeloop.external.run(lifeloop.external.updateEventScript, {
      calendar, existingId, lifeloop.external.title(task), lifeloop.external.notes(task),
      when.day, when.time, tostring(when.minutes) })
  else
    ok, message = lifeloop.external.run(lifeloop.external.eventScript, {
      calendar, lifeloop.external.title(task), lifeloop.external.notes(task),
      when.day, when.time, tostring(when.minutes) })
  end
  return apply(task, mode, "event", "([%x]+%-[%x%-]+)", "Event",
               ok, ok and message or explain("Calendar", message), when.day, existingId)
end

-- Running one projection over a batch. The loop goes **backwards** through the tasks, and that is
-- the whole trick: writing a mark lengthens its line, which moves everything below it, so the only
-- order in which every task's recorded position stays valid is last to first. Results are collected
-- in reverse and read back out in document order.
--
-- More than one task means the prompts are answered once, for all of them, and an existing mark is
-- updated rather than queried -- stopping to ask per task would defeat the point of selecting a
-- range.
local function projectAll(tasks, when, project)
  local said, failures = {}, 0
  for i = #tasks, 1, -1 do
    local ok, message = project(tasks[i], when, #tasks > 1)
    if ok == nil then
      return nil, nil
    end
    if not ok then
      failures = failures + 1
    end
    table.insert(said, 1, message)
  end
  return said, failures
end

-- One line for one task, a tally for many: twenty tasks would otherwise produce twenty sentences in
-- a notification nobody can read. A failure is always named, however many succeeded around it.
local function report(said, failures, noun)
  if #said == 1 then
    editor.flashNotification(said[1], failures == 0 and "info" or "error")
    return
  end
  if failures == 0 then
    editor.flashNotification(#said .. " " .. noun .. " done")
    return
  end
  local first
  for _, line in ipairs(said) do
    if string.find(line, "failed") or string.find(line, "gone") or string.find(line, "could not") then
      first = line
      break
    end
  end
  editor.flashNotification(
    (#said - failures) .. " of " .. #said .. " done; " .. (first or "one failed"), "error")
end

command.define {
  name = "LifeLoop: Add Reminder",
  run = function()
    local tasks, why = lifeloop.external.eligibleAll()
    if not tasks then
      editor.flashNotification(why, "error")
      return
    end
    local when, problem = ask(tasks[1], false)
    if not when then
      editor.flashNotification("Nothing added: " .. problem, "error")
      return
    end
    local said, failures = projectAll(tasks, when, projectReminder)
    if not said then
      editor.flashNotification("Nothing added: cancelled")
      return
    end
    report(said, failures, "reminders")
  end
}

command.define {
  name = "LifeLoop: Add to Calendar",
  run = function()
    local tasks, why = lifeloop.external.eligibleAll()
    if not tasks then
      editor.flashNotification(why, "error")
      return
    end
    local when, problem = ask(tasks[1], true)
    if not when then
      editor.flashNotification("Nothing added: " .. problem, "error")
      return
    end
    local said, failures = projectAll(tasks, when, projectEvent)
    if not said then
      editor.flashNotification("Nothing added: cancelled")
      return
    end
    report(said, failures, "events")
  end
}

-- Both at once, asked once. The date, time and length are shared: a reminder due at the moment the
-- block starts is the only pairing that does not require inventing a second answer you were never
-- asked for.
--
-- Two applications means two independent outcomes, and the failure that actually happens is one of
-- them working -- Calendar is unavailable whenever it is not already open on the Mac. So this never
-- reports a single verdict for both.
command.define {
  name = "LifeLoop: Add Reminder and Calendar",
  run = function()
    local tasks, why = lifeloop.external.eligibleAll()
    if not tasks then
      editor.flashNotification(why, "error")
      return
    end
    local when, problem = ask(tasks[1], true)
    if not when then
      editor.flashNotification("Nothing added: " .. problem, "error")
      return
    end

    -- Reminders first because it is the half that can be relied on: if the run half-succeeds, the
    -- durable reminder is the better half to have.
    local remSaid, remFailures = projectAll(tasks, when, projectReminder)
    if not remSaid then
      editor.flashNotification("Nothing added: cancelled")
      return
    end
    local evSaid, evFailures = projectAll(tasks, when, projectEvent)
    if not evSaid then
      report(remSaid, remFailures, "reminders")
      return
    end

    if #tasks == 1 then
      editor.flashNotification(remSaid[1] .. "; " .. evSaid[1],
        (remFailures + evFailures == 0) and "info" or "error")
      return
    end
    local total = #tasks * 2
    local bad = remFailures + evFailures
    editor.flashNotification(
      bad == 0 and (#tasks .. " tasks projected to both")
               or ((total - bad) .. " of " .. total .. " projections done"),
      bad == 0 and "info" or "error")
  end
}

command.define {
  name = "LifeLoop: Sync Projected",
  run = function()
    local pushed, seen = lifeloop.external.syncAll()
    editor.flashNotification(
      seen == 0 and "Nothing has been projected yet"
                 or (pushed .. " of " .. seen .. " projected tasks brought up to date"))
  end
}

-- The background pass. `cron:secondPassed` is dispatched by the client every second, which makes
-- this the only timer a space can have -- and locates the whole feature honestly: there is no
-- server-side background here, because Space Lua runs in the client. A pass happens while a
-- SilverBullet client is open, and not otherwise.
--
-- Two clients open at once each run their own timer. That is safe rather than merely tolerable: the
-- reminder test is a comparison of two timestamps, so a second client re-running it finds nothing
-- to do.
local secondsSinceSync = 0
local syncing = false

event.listen {
  name = "cron:secondPassed",
  run = function()
    if not config.get("lifeloop.autoSync", false) then
      return
    end
    secondsSinceSync = secondsSinceSync + 1
    local every = math.max(60, config.get("lifeloop.syncMinutes", 5) * 60)
    if secondsSinceSync < every then
      return
    end
    secondsSinceSync = 0
    -- A pass can outlast its own interval: osascript is slow, and a second pass starting on top of
    -- the first would push the same tasks twice.
    if syncing then
      return
    end
    syncing = true
    local ok = pcall(function() lifeloop.external.syncAll() end)
    syncing = false
    -- Silent either way. A background job that interrupts you to report its own routine failures is
    -- worse than one that waits to be asked -- run `LifeLoop: Sync Projected` to see what happens.
    local _ = ok
  end
}

slashCommand.define {
  name = "project",
  description = "Add a reminder and a calendar event for this task",
  run = function()
    editor.invokeCommand("LifeLoop: Add Reminder and Calendar")
  end
}
```

## Showing the mark without showing the id
An id is forty characters of nothing you will ever read. It has to be *in* the line — that is what
makes it a fact about the task rather than an entry in a side table — but it does not have to be
*legible*.

SilverBullet already wraps every attribute as `<span class="sb-attribute" data-reminder="…">`, so a
few lines of CSS collapse the text to nothing and put an icon in its place — 🔔 for a reminder, 📅
for a calendar event, so a glance tells you which. No renderer changes, no widget, no plug.

The reason this is honest rather than a lie by stylesheet: the decoration is skipped while the
cursor is inside the range, so moving into the line shows the id exactly as it is written, ready to
edit or delete. Quiet by default, never hidden.

```space-style
/* priority: 10 */
.sb-attribute[data-reminder],
.sb-attribute[data-event] {
  font-size: 0;
}
.sb-attribute[data-reminder]::after {
  content: "🔔";
  font-size: 0.85rem;
}
.sb-attribute[data-event]::after {
  content: "📅";
  font-size: 0.85rem;
}
```
