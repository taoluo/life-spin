import { expect, test } from "vitest";
import { Store, indexVault, MemoryVault } from "@lifeloop/semantic-core";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCalendarConflict, syncCalendar, type CalendarObservation } from "./calendar-sync.ts";
import { bindCalendar, bindReminder } from "./bind.ts";
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

test.each([
  ["one", '* [ ] Old [reminder: "R1"]\n', "invalid"],
  ["multiple", '* [ ] Old [reminder: "R1"] [reminder: "R2"]\n', "ambiguous"],
] as const)("a Reminder is not created when the task already has %s binding", async (_name, text, reason) => {
  const vault = MemoryVault.of({ "Work.md": text });
  let created = 0;
  const result = await bindReminder(
    vault, { ref: "Work@0", expectedText: text.trimEnd(), expectedState: " " },
    "Old", "", "", {
      create: async () => { created++; return "R3"; },
      remove: async () => true,
    },
  );
  expect(result).toMatchObject({ ok: false, reason });
  expect(created).toBe(0);
});

test("a Calendar event is removed when its numeric task moves during creation", async () => {
  const line = "* [ ] Old";
  const vault = MemoryVault.of({ "Work.md": `prefixxxxx\n${line}\n` });
  let removed = "";
  const result = await bindCalendar(
    vault, { ref: "Work@11", expectedText: line, expectedState: " " },
    "Old", "start", "end", "Calendar",
    {
      create: async () => { await vault.write("Work.md", `prefix\n${line}\n`); return "E2"; },
      remove: async (id) => { removed = id; return true; },
    },
  );
  expect(result.ok).toBe(false);
  expect(removed).toBe("E2");
  expect(vault.read("Work.md")).toBe(`prefix\n${line}\n`);
});

test("an uncertain Calendar binding retains the event for reconciliation", async () => {
  class RefusingVault extends MemoryVault {
    override async write(): Promise<void> { throw new Error("editor refused write"); }
    override async writeIfUnchanged(): Promise<boolean> { throw new Error("editor refused write"); }
  }
  const vault = new RefusingVault(new Map([["Work.md", "* [ ] Old\n"]]));
  let removed = false;
  const result = await bindCalendar(
    vault, { ref: "Work@0", expectedText: "* [ ] Old", expectedState: " " },
    "Old", "start", "end", "Calendar",
    {
      create: async () => "E2",
      remove: async () => { removed = true; return true; },
    },
  );
  expect(result).toMatchObject({ ok: false, reason: "unknown", orphaned: "E2" });
  expect(removed).toBe(false);
});

test.each(["before", "after"] as const)("Reminder creation response loss %s its effect is UNKNOWN", async (when) => {
  const vault = MemoryVault.of({ "Work.md": "* [ ] Old\n" });
  const created: string[] = [];
  let removed = 0;
  const result = await bindReminder(
    vault, { ref: "Work@0", expectedText: "* [ ] Old", expectedState: " " },
    "Old", "", "", {
      create: async () => {
        if (when === "after") created.push("R2");
        throw new Error("response lost");
      },
      remove: async () => { removed++; return true; },
    },
  );
  expect(result).toMatchObject({ ok: false, reason: "unknown" });
  expect(result.ok ? "" : result.message).toMatch(/check.*before retry/i);
  expect(created).toEqual(when === "after" ? ["R2"] : []);
  expect(removed).toBe(0);
  expect(vault.read("Work.md")).toBe("* [ ] Old\n");
});

test.each(["before", "after"] as const)("Calendar creation response loss %s its effect is UNKNOWN", async (when) => {
  const vault = MemoryVault.of({ "Work.md": "* [ ] Old\n" });
  const created: string[] = [];
  let removed = 0;
  const result = await bindCalendar(
    vault, { ref: "Work@0", expectedText: "* [ ] Old", expectedState: " " },
    "Old", "start", "end", "Calendar", {
      create: async () => {
        if (when === "after") created.push("E2");
        throw new Error("response lost");
      },
      remove: async () => { removed++; return true; },
    },
  );
  expect(result).toMatchObject({ ok: false, reason: "unknown" });
  expect(result.ok ? "" : result.message).toMatch(/check.*before retry/i);
  expect(created).toEqual(when === "after" ? ["E2"] : []);
  expect(removed).toBe(0);
  expect(vault.read("Work.md")).toBe("* [ ] Old\n");
});
