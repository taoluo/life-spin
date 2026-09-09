import { expect, test } from "vitest";
import { Store, indexVault, MemoryVault } from "@lifeloop/semantic-core";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCalendarConflict, syncCalendar, type CalendarObservation } from "./calendar-sync.ts";
import { bindCalendar } from "./bind.ts";
import type { CalendarEvent } from "./calendar.ts";

const event = (summary: string): CalendarEvent => ({
  uid: "E1", summary, start: "Tuesday", end: "Tuesday", location: "", cancelled: false,
});

async function setup(name: string) {
  const markdown = `* [ ] ${name} [event: "E1"]\n`;
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-calendar-"));
  writeFileSync(join(dir, "Work.md"), markdown);
  const store = new Store(":memory:");
  await indexVault(dir, store);
  return {
    store, vault: MemoryVault.of({ "Work.md": markdown }),
    cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

const observations = (value: CalendarObservation) => {
  const map = new Map([["E1", value]]);
  return { get: (id: string) => map.get(id), set: (id: string, v: CalendarObservation) => map.set(id, v), delete: (id: string) => map.delete(id) };
};

test("Calendar-only title edits are pulled into the task", async () => {
  const x = await setup("Old");
  const report = await syncCalendar({
    store: x.store, vault: x.vault, calendarName: "Calendar",
    observations: observations({ localName: "Old", remoteSummary: "Old" }),
    calendar: { read: async () => new Map([["E1", event("Remote")]]), updateSummary: async () => "ok" },
  });
  expect(report.pulled).toHaveLength(1);
  expect(x.vault.read("Work.md")).toContain("[ ] Remote [event:");
  x.cleanup();
});

test("Markdown-only title edits are compare-and-set into Calendar", async () => {
  const x = await setup("Local");
  let update: string[] = [];
  const report = await syncCalendar({
    store: x.store, vault: x.vault, calendarName: "Calendar",
    observations: observations({ localName: "Old", remoteSummary: "Old" }),
    calendar: {
      read: async () => new Map([["E1", event("Old")]]),
      updateSummary: async (_id, _calendar, expected, value) => { update = [expected, value]; return "ok"; },
    },
  });
  expect(report.pushed).toHaveLength(1);
  expect(update).toEqual(["Old", "Local"]);
  x.cleanup();
});

test("concurrent Calendar and Markdown edits pause and preserve both values", async () => {
  const x = await setup("Local");
  const report = await syncCalendar({
    store: x.store, vault: x.vault, calendarName: "Calendar",
    observations: observations({ localName: "Old", remoteSummary: "Old" }),
    calendar: { read: async () => new Map([["E1", event("Remote")]]), updateSummary: async () => "ok" },
  });
  expect(report.conflicts).toHaveLength(1);
  expect(x.vault.read("Work.md")).toContain("[ ] Local");
  expect(x.vault.read("Work.md")).toContain("[event:");
  x.cleanup();
});

test("the LifeLoop resolver refuses a Calendar event changed after it was shown", async () => {
  const x = await setup("Local");
  const result = await resolveCalendarConflict({
    vault: x.vault, page: "Work", uid: "E1", calendarName: "Calendar", choice: "markdown",
    expectedLocal: "Local", expectedRemote: "Shown",
    observations: observations({ localName: "Old", remoteSummary: "Old" }),
    calendar: { read: async () => new Map([["E1", event("Changed again")]]), updateSummary: async () => "ok" },
  });
  expect(result).toMatchObject({ ok: false, reason: "stale" });
  x.cleanup();
});

test("a Calendar event is removed when its Markdown binding loses a race", async () => {
  const vault = MemoryVault.of({ "Work.md": "* [ ] Old\n" });
  let removed = "";
  const result = await bindCalendar(
    vault, { ref: "Work@0", expectedText: "* [ ] Old", expectedState: " " },
    "Old", "start", "end", "Calendar",
    {
      create: async () => { await vault.write("Work.md", "* [ ] Edited\n"); return "E2"; },
      remove: async (id) => { removed = id; return true; },
    },
  );
  expect(result.ok).toBe(false);
  expect(removed).toBe("E2");
  expect(vault.read("Work.md")).toContain("Edited");
});
