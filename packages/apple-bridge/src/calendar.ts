import { osascriptRunner, parseRecords, type ScriptRunner } from "./osascript.ts";

/**
 * Calendar: binding only (2c).
 *
 * Calendar owns the interval — start, end, recurrence, attendees, location. We own
 * the commitment. The reverse flow may update event state and never task state:
 * `DESIGN.md` rejects elapsed-event-means-done as a category error, not a
 * deferral. A 9–11 block for "Deep Work: Paper" ending at 11 says nothing about
 * the paper.
 *
 * **The weaker push rule, and why it is not permanent.** Calendar's *scripting
 * dictionary* exposes no modification date — checked, not assumed — so the
 * freshness comparison Reminders gets is impossible over this route, and an event
 * is pushed when the page is newer than our last successful push. That is a
 * limitation of the interface, not a property of calendars: EventKit's
 * `EKCalendarItem` carries `lastModifiedDate` for events and reminders alike, so a
 * bridge built on that gets the same comparison. Recorded so the next
 * implementation does not inherit a constraint that was never true.
 */

export type CalendarEvent = {
  uid: string;
  summary: string;
  start: string;
  end: string;
  location: string;
  cancelled: boolean;
};

const READ_SCRIPT = `
on run argv
  set calName to item 1 of argv
  set out to ""
  tell application "Calendar"
    set c to calendar calName
    repeat with i from 2 to (count of argv)
      set theUid to item i of argv
      -- Scoped to one named calendar on purpose. Searching *every* calendar for a
      -- uid takes longer than the scripting bridge will wait — measured, against a
      -- real Calendar with six of them. LifeLoop creates its events in one place,
      -- so the binding knows where to look.
      repeat with e in (every event of c whose uid is (theUid as string))
        set eloc to ""
        try
          set eloc to (location of e as string)
        end try
        set out to out & (uid of e as string) & FS & (summary of e as string) & FS & ((start date of e) as string) & FS & ((end date of e) as string) & FS & eloc & RS
      end repeat
    end repeat
  end tell
  return out
end run
`;

const CREATE_SCRIPT = `
on run argv
  set theSummary to item 1 of argv
  set theStart to date (item 2 of argv)
  set theEnd to date (item 3 of argv)
  set calName to item 4 of argv
  tell application "Calendar"
    set target to calendar calName
    set e to make new event at end of events of target with properties {summary:theSummary, start date:theStart, end date:theEnd}
    return uid of e as string
  end tell
end run
`;

const UPDATE_SUMMARY_SCRIPT = `
on run argv
  set calName to item 1 of argv
  set theUid to item 2 of argv
  set expectedSummary to item 3 of argv
  set newSummary to item 4 of argv
  tell application "Calendar"
    set matches to (every event of calendar calName whose uid is theUid)
    if (count of matches) is 0 then return "gone"
    set e to item 1 of matches
    if (summary of e as string) is not expectedSummary then return "conflict"
    set summary of e to newSummary
    return "ok"
  end tell
end run
`;

const DELETE_SCRIPT = `
on run argv
  set calName to item 1 of argv
  set theUid to item 2 of argv
  tell application "Calendar"
    set matches to (every event of calendar calName whose uid is theUid)
    if (count of matches) is 0 then return "gone"
    delete item 1 of matches
    return "ok"
  end tell
end run
`;

const withSeparators = (script: string) =>
  script.replace(/\bRS\b/g, "(ASCII character 29)").replace(/\bFS\b/g, "(ASCII character 31)");

export class Calendar {
  constructor(private readonly run: ScriptRunner = osascriptRunner) {}

  /**
   * Read bound events from one named calendar.
   *
   * An event we cannot find is reported absent, never assumed present — the same
   * rule as a reminder's mark: a binding is a claim that can go stale.
   */
  async read(uids: string[], calendar: string): Promise<Map<string, CalendarEvent>> {
    if (uids.length === 0) return new Map();
    const out = await this.run(withSeparators(READ_SCRIPT), [calendar, ...uids], {
      timeoutMs: 60_000,
    });
    const records = parseRecords(out, ["uid", "summary", "start", "end", "location"]);
    return new Map(
      records.map((r) => [
        r.uid,
        { uid: r.uid, summary: r.summary, start: r.start, end: r.end,
          location: r.location, cancelled: false },
      ]),
    );
  }

  /**
   * Create an event for a task.
   *
   * The time is asked for, never inferred. A deadline says when something matters
   * and nothing about which hours are spent on it — `DESIGN.md` keeps those apart,
   * and inferring one from the other is how a notes app grows a scheduler.
   */
  async create(summary: string, start: string, end: string, calendar: string): Promise<string> {
    return this.run(CREATE_SCRIPT, [summary, start, end, calendar]);
  }

  async updateSummary(
    uid: string,
    calendar: string,
    expectedSummary: string,
    summary: string,
  ): Promise<"ok" | "gone" | "conflict"> {
    const result = await this.run(UPDATE_SUMMARY_SCRIPT, [calendar, uid, expectedSummary, summary]);
    return result === "ok" || result === "gone" ? result : "conflict";
  }

  async remove(uid: string, calendar: string): Promise<boolean> {
    return (await this.run(DELETE_SCRIPT, [calendar, uid])) === "ok";
  }
}

/** Which bindings have gone stale. Never trusted on sight, exactly like a reminder. */
export function staleBindings(
  bound: { ref: string; eventUid: string }[],
  live: Map<string, CalendarEvent>,
): { ref: string; eventUid: string }[] {
  return bound.filter((b) => !live.has(b.eventUid));
}
