import { expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store, indexVault } from "@lifeloop/semantic-core";

const VAULT = resolve(import.meta.dirname, "../fixtures");

const indexInto = async (path: string) => {
  const store = new Store(path);
  const result = await indexVault(VAULT, store);
  return { store, result };
};

test("§38 rebuildability — delete the index, rebuild from Markdown, byte-identical", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-rebuild-"));
  try {
    const first = await indexInto(join(dir, "a.sqlite"));
    const before = first.store.dump();
    first.store.close();

    // Not "reindex over the top" — a genuinely empty store, the way a user who
    // deleted .lifeloop/ would experience it.
    const second = await indexInto(join(dir, "b.sqlite"));
    const after = second.store.dump();
    second.store.close();

    expect(after).toBe(before);
    expect(before.length).toBeGreaterThan(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unchanged page is skipped on reindex, and its objects survive", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-skip-"));
  try {
    const path = join(dir, "c.sqlite");
    const { store, result } = await indexInto(path);
    expect(result.indexed).toBeGreaterThan(0);
    const before = store.dump();

    const again = await indexVault(VAULT, store);
    expect(again.indexed).toBe(0);
    expect(again.skipped).toBe(result.indexed);
    expect(store.dump()).toBe(before);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a commented-out task is indexed but excluded from the universe", async () => {
  // Source semantics, not a query optimisation: SilverBullet flags commented
  // objects rather than skipping them, so LifeLoop has to exclude deliberately.
  const store = new Store(":memory:");
  await indexVault(VAULT, store);
  const all = store.objects("task");
  const { tasks } = await import("@lifeloop/semantic-core");
  const universe = tasks.universe(store);
  expect(all.length).toBeGreaterThan(universe.length);
  expect(all.some((t) => t.inComment === true)).toBe(true);
  expect(universe.every((t) => !t.inComment)).toBe(true);
  store.close();
});
