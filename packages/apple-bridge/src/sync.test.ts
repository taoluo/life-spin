import { expect, test, describe } from "vitest";
import { Store, indexVault, MemoryVault } from "@lifeloop/semantic-core";
import { syncReminders, MemoryObservations, boundTasks, resolveReminderConflict } from "./sync.ts";
import type { Reminder } from "./reminders.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A Reminders that answers from a script, so 2b is testable without a Mac. */
class FakeReminders {
  updates: { id: string; name: string }[] = [];
  constructor(private readonly items: Reminder[]) {}
  async read(ids: string[]) {
    return new Map(this.items.filter((r) => ids.includes(r.id)).map((r) => [r.id, r]));
  }
  async create() { return "NEW"; }
  async update(id: string, name: string) {
    this.updates.push({ id, name });
    return this.items.some((r) => r.id === id);
  }
}

const reminder = (over: Partial<Reminder> = {}): Reminder => ({
  id: "R1", name: "Submit paper", body: "", completed: false,
  completionDate: null, modificationDate: "2026-09-08T09:00:00Z", recurring: false, ...over,
});

async function setup(markdown: string) {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-sync-"));
  writeFileSync(join(dir, "Work.md"), markdown);
  const store = new Store(":memory:");
  await indexVault(dir, store);
  const vault = MemoryVault.of({ "Work.md": markdown });
  return { store, vault, cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("the reverse flow, end to end", () => {
  test("the LifeLoop resolver refuses a Reminder changed after it was shown", async () => {
    const { vault, cleanup } = await setup('* [ ] Local [reminder: "R1"]\n');
    const result = await resolveReminderConflict({
      vault, page: "Work", reminderId: "R1", choice: "markdown",
      expectedLocal: "Local", expectedRemote: "Shown", observations: new MemoryObservations(),
      reminders: new FakeReminders([reminder({ name: "Changed again" })]) as any,
    });
    expect(result).toMatchObject({ ok: false, reason: "stale" });
    cleanup();
  });

  test("ticking on a watch completes the task in Markdown", async () => {
    const { store, vault, cleanup } = await setup(
      '* [ ] Submit paper [reminder: "R1"]\n',
    );
    expect(boundTasks(store)).toHaveLength(1);

    const observations = new MemoryObservations();
    observations.set("R1", { completed: false, modificationDate: "2026-09-08T09:00:00Z" });

    const report = await syncReminders({
      store, vault, observations,
      reminders: new FakeReminders([
        reminder({ completed: true, completionDate: "2026-09-09T18:30:00Z" }),
      ]) as any,
      observedOn: "2026-09-10",
    });

    expect(report.completed).toHaveLength(1);
    const text = vault.read("Work.md");
    expect(text).toContain("* [x] Submit paper");
    // The date Reminders reported, not the date we happened to look.
    expect(text).toContain('[completed: "2026-09-09"]');
    cleanup();
  });

  test("the bridge uses the same declared multi-character states as the index", async () => {
    const markdown = '* [TO DO] Submit paper [reminder: "R1"]\n';
    const { store, vault, cleanup } = await setup(markdown);
    const observations = new MemoryObservations();
    observations.set("R1", { completed: false, modificationDate: "2026-09-08T09:00:00Z" });
    const report = await syncReminders({
      store, vault, observations,
      taskStates: [{ state: "TO DO" }, { state: "DONE", done: true }],
      reminders: new FakeReminders([
        reminder({ completed: true, completionDate: "2026-09-09T18:30:00Z" }),
      ]) as any,
    });
    expect(report.completed).toHaveLength(1);
    expect(vault.read("Work.md")).toContain("* [x] Submit paper");
    cleanup();
  });

  test("the bridge refuses a state write when its policy changed during the external read", async () => {
    const markdown = '* [TO DO] Submit paper [reminder: "R1"]\n';
    const { store, vault, cleanup } = await setup(markdown);
    const observations = new MemoryObservations();
    observations.set("R1", { completed: false, modificationDate: "2026-09-08T09:00:00Z" });
    const report = await syncReminders({
      store, vault, observations,
      taskStates: [{ state: "TO DO" }, { state: "DONE", done: true }],
      isTaskPolicyCurrent: async () => false,
      reminders: new FakeReminders([
        reminder({ completed: true, completionDate: "2026-09-09T18:30:00Z" }),
      ]) as any,
    });
    expect(report.completed).toHaveLength(0);
    expect(report.refused[0].message).toContain("policy changed");
    expect(vault.read("Work.md")).toBe(markdown);
    expect(observations.get("R1")?.modificationDate).toBe("2026-09-08T09:00:00Z");
    cleanup();
  });

  test("the bridge re-locates a binding after its asynchronous policy check", async () => {
    const markdown = '* [TO DO] Submit paper [reminder: "R1"]\n';
    const { store, vault, cleanup } = await setup(markdown);
    const observations = new MemoryObservations();
    observations.set("R1", { completed: false, modificationDate: "2026-09-08T09:00:00Z" });
    const report = await syncReminders({
      store, vault, observations,
      taskStates: [{ state: "TO DO" }, { state: "DONE", done: true }],
      isTaskPolicyCurrent: async () => {
        await vault.write("Work.md", markdown + '* [TO DO] duplicate [reminder: "R1"]\n');
        return true;
      },
      reminders: new FakeReminders([
        reminder({ completed: true, completionDate: "2026-09-09T18:30:00Z" }),
      ]) as any,
    });
    expect(report.completed).toHaveLength(0);
    expect(report.refused[0].message).toContain("refusing to guess");
    expect(vault.read("Work.md")).not.toContain("[completed:");
    cleanup();
  });

  test("a reminder deleted over there has its mark erased, and the task is untouched", async () => {
    const { store, vault, cleanup } = await setup('* [ ] Submit paper [reminder: "R1"]\n');
    const report = await syncReminders({
      store, vault,
      observations: new MemoryObservations(),
      reminders: new FakeReminders([]) as any,
    });
    expect(report.marksCleared).toHaveLength(1);
    expect(vault.read("Work.md")).toBe("* [ ] Submit paper\n");
    cleanup();
  });

  test("a recurring reminder is reported and changes nothing at all", async () => {
    const { store, vault, cleanup } = await setup('* [ ] Pay rent [reminder: "R1"]\n');
    const before = vault.snapshot();
    const flagged: string[] = [];

    const observations = new MemoryObservations();
    observations.set("R1", { completed: false, modificationDate: "2026-09-01T00:00:00Z" });

    const report = await syncReminders({
      store, vault, observations,
      reminders: new FakeReminders([
        reminder({ name: "Pay rent", recurring: true, completed: true,
                   completionDate: "2026-09-09T10:00:00Z" }),
      ]) as any,
      onRecurring: (task) => flagged.push(task.ref),
    });

    expect(report.recurring).toHaveLength(1);
    expect(report.completed).toHaveLength(0);
    expect(flagged).toHaveLength(1);
    expect(vault.snapshot()).toEqual(before);
    cleanup();
  });

  test("an edit made in Reminders is never overwritten", async () => {
    const { store, vault, cleanup } = await setup('* [ ] Submit paper [reminder: "R1"]\n');
    const bridge = new FakeReminders([
      reminder({ name: "Finish paper draft", modificationDate: "2030-01-01T00:00:00Z" }),
    ]);
    const report = await syncReminders({
      store, vault, observations: new MemoryObservations(), reminders: bridge as any,
    });
    expect(bridge.updates).toHaveLength(0);
    expect(report.pushed).toHaveLength(0);
    cleanup();
  });

  test("a second pass with nothing new does nothing", async () => {
    const { store, vault, cleanup } = await setup('* [ ] Submit paper [reminder: "R1"]\n');
    const observations = new MemoryObservations();
    const bridge = new FakeReminders([reminder()]) as any;

    await syncReminders({ store, vault, observations, reminders: bridge });
    const after = vault.snapshot();
    const second = await syncReminders({ store, vault, observations, reminders: bridge });

    expect(second.completed).toHaveLength(0);
    expect(second.reopened).toHaveLength(0);
    expect(vault.snapshot()).toEqual(after);
    cleanup();
  });

  test("a task whose source no longer matches is refused, not forced", async () => {
    const { store, vault, cleanup } = await setup('* [ ] Submit paper [reminder: "R1"]\n');
    const observations = new MemoryObservations();
    observations.set("R1", { completed: false, modificationDate: "2026-09-08T09:00:00Z" });

    // The task is already complete in Markdown; the stamp mutation must refuse
    // rather than write a second completion date.
    vault.write("Work.md", '* [x] Submit paper [reminder: "R1"] [completed: "2026-09-01"]\n');
    const before = vault.snapshot();

    const report = await syncReminders({
      store, vault, observations,
      reminders: new FakeReminders([
        reminder({ completed: true, completionDate: "2026-09-09T18:00:00Z" }),
      ]) as any,
    });

    expect(report.refused).toHaveLength(1);
    expect(vault.snapshot()).toEqual(before);
    cleanup();
  });

  test("a refused pull retains its baseline and cannot authorize a reverse push", async () => {
    const markdown = '* [ ] Old [reminder: "R1"]\n';
    const { store, cleanup } = await setup(markdown);
    class RefusingVault extends MemoryVault {
      override async write(): Promise<void> { throw new Error("save failed"); }
      override async writeIfUnchanged(): Promise<boolean> { throw new Error("save failed"); }
    }
    const vault = new RefusingVault(new Map([["Work.md", markdown]]));
    const observations = new MemoryObservations();
    observations.set("R1", {
      completed: false, modificationDate: "2026-09-08T09:00:00Z", name: "Old",
    });
    const bridge = new FakeReminders([reminder({ name: "Remote" })]);

    const first = await syncReminders({ store, vault, observations, reminders: bridge as any });
    const second = await syncReminders({ store, vault, observations, reminders: bridge as any });

    expect(first.refused).toHaveLength(1);
    expect(second.pushed).toHaveLength(0);
    expect(bridge.updates).toEqual([]);
    expect(observations.get("R1")?.name).toBe("Old");
    cleanup();
  });
});
