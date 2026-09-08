import { expect, test, describe } from "vitest";
import { reconcile, type BoundTask, type Observation } from "./reconcile.ts";
import type { Reminder } from "./reminders.ts";

const task = (over: Partial<BoundTask> = {}): BoundTask => ({
  ref: "Work@10",
  name: "Submit paper",
  reminderId: "R1",
  done: false,
  completed: null,
  pageModified: "2026-09-08T10:00:00Z",
  ...over,
});

const reminder = (over: Partial<Reminder> = {}): Reminder => ({
  id: "R1",
  name: "Submit paper",
  body: "",
  completed: false,
  completionDate: null,
  modificationDate: "2026-09-08T09:00:00Z",
  recurring: false,
  ...over,
});

/** What AppleScript actually returns: it cannot see recurrence at all. */
const viaAppleScript = (over: Partial<Reminder> = {}) =>
  reminder({ recurring: "unknown", ...over });

const run = (
  tasks: BoundTask[],
  reminders: Reminder[],
  lastSeen: Record<string, Observation> = {},
  observedOn = "2026-09-10",
) =>
  reconcile({
    tasks,
    reminders: new Map(reminders.map((r) => [r.id, r])),
    lastSeen: new Map(Object.entries(lastSeen)),
    observedOn,
  });

describe("completion flowing back", () => {
  test("a reminder that became complete completes the task, using its own date", async () => {
    const [decision] = run(
      [task()],
      [reminder({ completed: true, completionDate: "2026-09-09T18:30:00Z" })],
      { R1: { completed: false, modificationDate: "2026-09-08T09:00:00Z" } },
    );
    expect(decision).toMatchObject({
      action: "complete", date: "2026-09-09", dateWasReported: true,
    });
  });

  test("no completion date reported falls back to the observation date, never a guess", async () => {
    // Apple documents completionDate as nullable while isCompleted is true, when
    // the reminder was finished in a different client.
    const [decision] = run(
      [task()],
      [reminder({ completed: true, completionDate: null })],
      { R1: { completed: false, modificationDate: "2026-09-08T09:00:00Z" } },
      "2026-09-10",
    );
    expect(decision).toMatchObject({
      action: "complete", date: "2026-09-10", dateWasReported: false,
    });
  });

  test("a reminder that was already complete when first seen does nothing", async () => {
    // No observed transition means no event to translate — completion is not a
    // value to keep equal, so a state on its own is not a reason to write.
    const decisions = run([task()], [reminder({ completed: true })], {});
    expect(decisions[0].action).toBe("none");
  });
});

describe("recurring reminders", () => {
  test("never complete a task, however they look", async () => {
    const decisions = run(
      [task()],
      [reminder({ recurring: true, completed: true, completionDate: "2026-09-09T18:00:00Z" })],
      { R1: { completed: false, modificationDate: "2026-09-01T00:00:00Z" } },
    );
    expect(decisions[0].action).toBe("flag-recurring");
  });

  test("never reopen a task when the next occurrence appears", async () => {
    // The bug this rule exists for: completing a recurring reminder rolls it to
    // its next occurrence, which reads incomplete — reopening the task forever.
    const decisions = run(
      [task({ done: true, completed: "2026-09-09" })],
      [reminder({ recurring: true, completed: false, modificationDate: "2026-09-10T08:00:00Z" })],
      { R1: { completed: true, modificationDate: "2026-09-09T18:00:00Z" } },
    );
    expect(decisions[0].action).toBe("flag-recurring");
    expect(decisions.map((d) => d.action)).not.toContain("reopen");
  });

  test("the mismatch is surfaced rather than silently skipped", async () => {
    const [decision] = run([task()], [reminder({ recurring: true })], {});
    expect(decision.action).toBe("flag-recurring");
  });
});

describe("reopening", () => {
  test("an observed complete-to-open transition reopens the task", async () => {
    const [decision] = run(
      [task({ done: true, completed: "2026-09-09" })],
      [reminder({ completed: false, modificationDate: "2026-09-10T08:00:00Z" })],
      { R1: { completed: true, modificationDate: "2026-09-09T18:00:00Z" } },
    );
    expect(decision).toMatchObject({ action: "reopen" });
  });

  test("an open reminder with no observed transition does nothing", async () => {
    const decisions = run([task({ done: true, completed: "2026-09-09" })], [reminder()], {});
    expect(decisions[0].action).toBe("none");
  });

  test("a transition with no movement since the last pass does nothing", async () => {
    const [decision] = run(
      [task({ done: true, completed: "2026-09-09" })],
      [reminder({ completed: false, modificationDate: "2026-09-09T18:00:00Z" })],
      { R1: { completed: true, modificationDate: "2026-09-09T18:00:00Z" } },
    );
    expect(decision).toMatchObject({ action: "none" });
  });
});

describe("a stored mark is never trusted on sight", () => {
  test("a reminder deleted over there has its mark erased, not resurrected", async () => {
    const [decision] = run([task()], []);
    expect(decision).toMatchObject({ action: "clear-mark" });
  });
});

describe("the projection, and who wins", () => {
  test("a renamed task is pushed out", async () => {
    const [decision] = run([task({ name: "Submit the paper" })], [reminder()]);
    expect(decision).toMatchObject({ action: "push", name: "Submit the paper" });
  });

  test("a title edited in Reminders is not overwritten", async () => {
    // Not Reminders acquiring the title — divergence detected on a projection.
    const [decision] = run(
      [task({ name: "Submit paper", pageModified: "2026-09-08T10:00:00Z" })],
      [reminder({ name: "Finish paper draft", modificationDate: "2026-09-08T11:00:00Z" })],
    );
    expect(decision).toMatchObject({ action: "none" });
    expect((decision as any).why).toContain("not overwriting");
  });

  test("a note edited after their change is pushed", async () => {
    const [decision] = run(
      [task({ name: "Submit paper v2", pageModified: "2026-09-08T12:00:00Z" })],
      [reminder({ name: "Submit paper", modificationDate: "2026-09-08T11:00:00Z" })],
    );
    expect(decision).toMatchObject({ action: "push" });
  });

  test("nothing to do when both sides agree", async () => {
    const [decision] = run([task()], [reminder()]);
    expect(decision).toMatchObject({ action: "none", why: "in step" });
  });
});

describe("when recurrence cannot be known — the AppleScript route", () => {
  test("an unknown reminder may still complete a task", async () => {
    // A recurring reminder rolls forward rather than being observed going
    // incomplete-to-complete for our binding, so this direction stays safe.
    const [decision] = run(
      [task()],
      [viaAppleScript({ completed: true, completionDate: "2026-09-09T18:00:00Z" })],
      { R1: { completed: false, modificationDate: "2026-09-08T09:00:00Z" } },
    );
    expect(decision).toMatchObject({ action: "complete", date: "2026-09-09" });
  });

  test("an unknown reminder may never reopen — the destructive direction", async () => {
    // Un-completing is exactly what a recurrence roll looks like, and nothing in
    // this interface distinguishes it from a person reopening the reminder.
    const [decision] = run(
      [task({ done: true, completed: "2026-09-09" })],
      [viaAppleScript({ completed: false, modificationDate: "2026-09-10T08:00:00Z" })],
      { R1: { completed: true, modificationDate: "2026-09-09T18:00:00Z" } },
    );
    expect(decision).toMatchObject({ action: "flag-recurring" });
  });

  test("a binding once suspected of recurring stops driving anything, permanently", async () => {
    const [decision] = run(
      [task()],
      [viaAppleScript({ completed: true, completionDate: "2026-09-09T18:00:00Z" })],
      { R1: { completed: false, modificationDate: "2026-09-08T09:00:00Z", suspectedRecurring: true } },
    );
    expect(decision).toMatchObject({ action: "flag-recurring" });
  });

  test("a missing completion date falls back to the observation date, as on real data", async () => {
    // Reminders reports `missing value` here far more often than not — every
    // reminder in a real default list did.
    const [decision] = run(
      [task()],
      [viaAppleScript({ completed: true, completionDate: null })],
      { R1: { completed: false, modificationDate: "2026-09-08T09:00:00Z" } },
      "2026-09-11",
    );
    expect(decision).toMatchObject({ action: "complete", date: "2026-09-11", dateWasReported: false });
  });
});

describe("the quarantine is about the binding, not the task", () => {
  test("an un-completing reminder is flagged even when the task is still open", async () => {
    // Regression: this used to be gated on `task.done`, so a recurrence roll while
    // the task happened to be open fell through unflagged — still trusted, and free
    // to drive a completion on the next pass.
    const [decision] = run(
      [task({ done: false })],
      [viaAppleScript({ completed: false, modificationDate: "2026-09-10T08:00:00Z" })],
      { R1: { completed: true, modificationDate: "2026-09-09T18:00:00Z" } },
    );
    expect(decision).toMatchObject({ action: "flag-recurring" });
  });

  test("and the quarantine sticks, so the next completion is refused too", async () => {
    const [decision] = run(
      [task({ done: false })],
      [viaAppleScript({ completed: true, completionDate: "2026-09-11T10:00:00Z" })],
      { R1: { completed: false, modificationDate: "2026-09-10T08:00:00Z", suspectedRecurring: true } },
    );
    expect(decision).toMatchObject({ action: "flag-recurring" });
  });
});
