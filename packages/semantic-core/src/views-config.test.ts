import { expect, test, describe } from "vitest";
import { parseView, runSavedView } from "./views-config.ts";
import { Store, indexVault } from "./index.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("saved view definitions", () => {
  test("a named projection resolves through the contract", async () => {
    const view = parseView("home", "source: today\nrenderer: list\n");
    expect(view.source).toBe("today");

    const dir = mkdtempSync(join(tmpdir(), "lifeloop-views-"));
    writeFileSync(join(dir, "W.md"), '* [ ] a thing [deadline: "2020-01-01"]\n');
    const store = new Store(":memory:");
    await indexVault(dir, store);

    const result = runSavedView(store, view, { date: "2026-09-08" }) as any;
    expect(result.overdue).toHaveLength(1);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("an object tag becomes a raw query", async () => {
    const view = parseView("projects", "source: page\nfilter:\n  status: active\n");
    expect(view.source).toEqual({ tag: "page" });
    expect(view.filter).toEqual([{ field: "status", op: "eq", value: "active" }]);
  });

  test("a definition carrying results is refused, not quietly ignored", async () => {
    // §33: a view stores query, renderer and layout — never its answer. Dropping
    // the key silently would leave someone believing the file was a cache.
    expect(() => parseView("bad", "source: today\nresults:\n  - x\n"))
      .toThrow(/never stores its answer/);
  });

  test("sort and renderer survive the round trip", async () => {
    const view = parseView("t", "source: task\nsort:\n  deadline: asc\nrenderer: table\n");
    expect(view.sort).toEqual([{ field: "deadline", direction: "asc" }]);
    expect(view.renderer).toBe("table");
  });
});
