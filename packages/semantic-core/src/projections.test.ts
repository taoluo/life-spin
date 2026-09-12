import { expect, test, describe } from "vitest";
import { Store, indexVault } from "./index.ts";
import { today, upcoming, week, review, projectSignals, shift, explainTask } from "./projections.ts";
import { MemoryVault } from "./vault.ts";
import { freezeReview } from "./mutations/review.ts";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function vaultWith(files: Record<string, string>): Promise<Store> {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-proj-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  const store = new Store(":memory:");
  await indexVault(dir, store);
  rmSync(dir, { recursive: true, force: true });
  return store;
}

describe("Today", () => {
  test("buckets are disjoint — a task with both dates appears once", async () => {
    const store = await vaultWith({
      "Notes.md": [
        '* [ ] overdue [deadline: "2026-09-01"]',
        '* [ ] due now [deadline: "2026-09-08"]',
        '* [ ] both [deadline: "2026-09-08"] [scheduled: "2026-09-08"]',
        '* [ ] later [deadline: "2026-12-01"]',
        "* [ ] blocked #waiting",
        "",
      ].join("\n"),
    });
    const t = today(store, "2026-09-08");
    expect(t.overdue.map((x) => x.name)).toEqual(["overdue"]);
    expect(t.due.map((x) => x.name).sort()).toEqual(["both", "due now"]);
    expect(t.scheduled).toHaveLength(0); // "both" was already taken by `due`
    expect(t.waiting.map((x) => x.name)).toEqual(["blocked"]);

    const all = [...t.overdue, ...t.due, ...t.scheduled].map((x) => x.ref);
    expect(new Set(all).size).toBe(all.length);
    store.close();
  });

  test("parked tasks never appear in the actionable buckets", async () => {
    const store = await vaultWith({
      "Notes.md": '* [ ] parked [deadline: "2026-09-01"] #someday\n',
    });
    const t = today(store, "2026-09-08");
    expect(t.overdue).toHaveLength(0);
    expect(t.waiting.map((x) => x.name)).toEqual(["parked"]);
    store.close();
  });

  test("explains bounded Today and actionable membership from the shared predicates", async () => {
    const store = await vaultWith({
      "Notes.md": [
        '* [ ] due [deadline: "2026-09-08"]',
        "* [ ] parent #waiting",
        "  * [ ] inherited",
        '* [ ] later [deadline: "2026-09-20"]',
        "* [x] done",
        "",
      ].join("\n"),
    });
    const byName = (name: string) => store.objects("task").find((task) => task.name === name)!;

    expect(explainTask(store, byName("due"), "today", "2026-09-08")).toEqual({
      included: true, reasons: ["deadline is 2026-09-08"],
    });
    expect(explainTask(store, byName("inherited"), "actionable", "2026-09-08")).toEqual({
      included: false, reasons: ["inherits #waiting"],
    });
    expect(explainTask(store, byName("later"), "today", "2026-09-08")).toEqual({
      included: false,
      reasons: ["deadline 2026-09-20 is after 2026-09-08", "not scheduled for 2026-09-08"],
    });
    expect(explainTask(store, byName("done"), "actionable", "2026-09-08")).toEqual({
      included: false, reasons: ["completed"],
    });
    store.close();
  });
});

describe("Upcoming", () => {
  test("groups by scheduled when there is one, deadline otherwise, once each", async () => {
    const store = await vaultWith({
      "Notes.md": [
        '* [ ] both [deadline: "2026-09-20"] [scheduled: "2026-09-12"]',
        '* [ ] deadline only [deadline: "2026-09-14"]',
        '* [ ] far away [deadline: "2027-01-01"]',
        "",
      ].join("\n"),
    });
    const days = upcoming(store, "2026-09-08", 14);
    expect(days.map((d) => d.date)).toEqual(["2026-09-12", "2026-09-14"]);
    expect(days[0].tasks.map((t) => t.name)).toEqual(["both"]);
    expect(days.flatMap((d) => d.tasks.map((t) => t.name))).not.toContain("far away");
    store.close();
  });
});

describe("weeks", () => {
  test("runs Monday to Sunday", async () => {
    expect(week("2026-09-08")).toEqual({ start: "2026-09-07", end: "2026-09-13" });
    expect(week("2026-09-13")).toEqual({ start: "2026-09-07", end: "2026-09-13" });
  });
  test("shift crosses month boundaries", async () => {
    expect(shift("2026-09-30", 1)).toBe("2026-10-01");
    expect(shift("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("Weekly Review", () => {
  test("completed covers the week and excludes what fell outside it", async () => {
    const store = await vaultWith({
      "Notes.md": [
        '* [x] in the week [completed: "2026-09-09"]',
        '* [x] last month [completed: "2026-08-01"]',
        "* [ ] still open",
        "",
      ].join("\n"),
    });
    const r = review(store, "2026-09-08");
    expect(r.completed.map((t) => t.name)).toEqual(["in the week"]);
    expect(r.stillOpen.map((t) => t.name)).toEqual(["still open"]);
    store.close();
  });
});

describe("project signals", () => {
  test("waiting only is narrower than no actionable task", async () => {
    const waiting = await vaultWith({
      "P.md": "---\ntags: project\n---\n* [ ] a #waiting\n* [ ] b #waiting\n",
    });
    expect(projectSignals(waiting, "P", "2026-09-08").map((s) => s.kind))
      .toContain("waiting only");
    waiting.close();

    const mixed = await vaultWith({
      "P.md": "---\ntags: project\n---\n* [ ] a #waiting\n* [ ] b #someday\n",
    });
    const kinds = projectSignals(mixed, "P", "2026-09-08").map((s) => s.kind);
    expect(kinds).toContain("no actionable task");
    expect(kinds).not.toContain("waiting only");
    mixed.close();
  });

  test("a healthy project emits nothing", async () => {
    const store = await vaultWith({ "P.md": "---\ntags: project\n---\n* [ ] do the thing\n" });
    expect(projectSignals(store, "P", "2026-09-08")).toEqual([]);
    store.close();
  });
});

describe("freezing a review", () => {
  const live = "---\nweek: 2026-09-07\n---\n\n## Completed\n\n${lifeloop.review.completed()}\n\n## Open\n\n${lifeloop.review.stillOpen()}\n";
  const render = (name: string) => `- rendered ${name}`;

  test("replaces every marker and stamps frozen", async () => {
    const vault = MemoryVault.of({ "Review.md": live });
    const result = await freezeReview(vault, "Review", render, "2026-09-13");
    expect(result.ok).toBe(true);
    const text = vault.read("Review.md");
    expect(text).toContain("frozen: 2026-09-13");
    expect(text).toContain("- rendered completed");
    expect(text).not.toContain("${lifeloop");
  });

  test("freezing twice is refused, and the second attempt writes nothing", async () => {
    const vault = MemoryVault.of({ "Review.md": live });
    await freezeReview(vault, "Review", render, "2026-09-13");
    const before = vault.snapshot();
    expect(await freezeReview(vault, "Review", render, "2026-09-13")).toMatchObject({
      ok: false, reason: "stale",
    });
    expect(vault.snapshot()).toEqual(before);
  });

  test("a section that cannot render aborts the whole freeze", async () => {
    const vault = MemoryVault.of({ "Review.md": live });
    const before = vault.snapshot();
    const result = await freezeReview(vault, "Review", (n) => (n === "stillOpen" ? null : "x"), "2026-09-13");
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(vault.snapshot()).toEqual(before);
  });

  test("a page with no week in frontmatter is refused", async () => {
    const vault = MemoryVault.of({ "Review.md": "---\ntags: review\n---\n${lifeloop.review.completed()}\n" });
    const before = vault.snapshot();
    expect(await freezeReview(vault, "Review", render, "2026-09-13")).toMatchObject({
      ok: false, reason: "invalid",
    });
    expect(vault.snapshot()).toEqual(before);
  });
});
