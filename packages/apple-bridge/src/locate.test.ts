import { expect, test, describe } from "vitest";
import { MemoryVault, Store, indexVault } from "@lifeloop/semantic-core";
import { locateByBinding, pageOfRef } from "./locate.ts";
import { syncReminders, MemoryObservations } from "./sync.ts";
import type { Reminder } from "./reminders.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const reminder = (over: Partial<Reminder> = {}): Reminder => ({
  id: "R1", name: "task one", body: "", completed: false, completionDate: null,
  modificationDate: "2026-09-08T09:00:00Z", recurring: "unknown", ...over,
});

class Fake {
  constructor(private readonly items: Reminder[]) {}
  async read(ids: string[]) {
    return new Map(this.items.filter((r) => ids.includes(r.id)).map((r) => [r.id, r]));
  }
  async create() { return "NEW"; }
  async update() { return true; }
}

describe("locating a task by its binding", () => {
  test("finds the task and captures a receipt from the vault, not the index", () => {
    const vault = MemoryVault.of({
      "W.md": '* [ ] one\n* [ ] two [reminder: "R1"]\n* [ ] three\n',
    });
    const found = locateByBinding(vault, "W", "reminder", "R1");
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.line).toContain("two");
    expect(found.handle.expectedState).toBe(" ");
    expect(found.handle.expectedText).toBe(found.line);
  });

  test("refuses when the binding is gone", () => {
    const vault = MemoryVault.of({ "W.md": "* [ ] two\n" });
    expect(locateByBinding(vault, "W", "reminder", "R1")).toMatchObject({
      ok: false, reason: "missing",
    });
  });

  test("refuses when two tasks carry the same binding", () => {
    // Duplicating a task line duplicates its binding. Picking one is how the
    // wrong task gets completed, so this refuses instead.
    const vault = MemoryVault.of({
      "W.md": '* [ ] a [reminder: "R1"]\n* [ ] b [reminder: "R1"]\n',
    });
    expect(locateByBinding(vault, "W", "reminder", "R1")).toMatchObject({
      ok: false, reason: "ambiguous",
    });
  });

  test("ignores a binding that is not on a task line", () => {
    const vault = MemoryVault.of({ "W.md": 'a note mentioning [reminder: "R1"]\n' });
    expect(locateByBinding(vault, "W", "reminder", "R1")).toMatchObject({ ok: false });
  });

  test("pageOfRef keeps folders and an @ in a page name apart", () => {
    expect(pageOfRef("Projects/Q3@1820")).toBe("Projects/Q3");
    expect(pageOfRef("Notes@anchor-name")).toBe("Notes");
  });
});

describe("regression — completing the wrong task", () => {
  async function bound(indexedAs: string, vaultNow: string) {
    const dir = mkdtempSync(join(tmpdir(), "locate-"));
    writeFileSync(join(dir, "W.md"), indexedAs);
    const store = new Store(":memory:");
    await indexVault(dir, store);
    rmSync(dir, { recursive: true, force: true });
    return { store, vault: MemoryVault.of({ "W.md": vaultNow }) };
  }

  test("a stale index offset never completes whatever now sits there", async () => {
    // Reproduced before the fix: reminder R1 completing checked off the task bound
    // to R2, because the decision carried a position and no receipt.
    const { store, vault } = await bound(
      '* [ ] task one [reminder: "R1"]\n',
      '* [ ] a completely different task [reminder: "R2"]\n',
    );
    const before = vault.snapshot();
    const observations = new MemoryObservations();
    observations.set("R1", { completed: false, modificationDate: "2026-09-08T09:00:00Z" });

    const report = await syncReminders({
      store, vault, observations,
      reminders: new Fake([reminder({ completed: true, completionDate: "2026-09-09T10:00:00Z" })]) as any,
    });

    expect(report.completed).toHaveLength(0);
    expect(report.refused).toHaveLength(1);
    expect(vault.snapshot()).toEqual(before);
    store.close();
  });

  test("an earlier write in the same pass does not misplace a later one", async () => {
    // Completing the first task lengthens its line, shifting every offset after it.
    // Locating by binding is what makes the second write land correctly anyway.
    const text = '* [ ] first [reminder: "R1"]\n* [ ] second [reminder: "R2"]\n';
    const { store, vault } = await bound(text, text);
    const observations = new MemoryObservations();
    for (const id of ["R1", "R2"]) {
      observations.set(id, { completed: false, modificationDate: "2026-09-08T09:00:00Z" });
    }

    const report = await syncReminders({
      store, vault, observations,
      reminders: new Fake([
        reminder({ id: "R1", name: "first", completed: true, completionDate: "2026-09-09T10:00:00Z" }),
        reminder({ id: "R2", name: "second", completed: true, completionDate: "2026-09-09T11:00:00Z" }),
      ]) as any,
    });

    expect(report.completed).toHaveLength(2);
    const after = vault.read("W.md");
    expect(after).toContain('* [x] first [reminder: "R1"] [completed: "2026-09-09"]');
    expect(after).toContain('* [x] second [reminder: "R2"] [completed: "2026-09-09"]');
    store.close();
  });
});
