import { expect, test, describe } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Store, indexVault, projectionNames, runProjection, projections, CONTRACT_VERSION,
} from "@lifeloop/semantic-core";
import { LifeLoop } from "../../packages/vscode/src/workspace.ts";
import { TodayView } from "../../packages/vscode/src/views.ts";
import * as vscode from "../../packages/vscode/test/vscode-mock.ts";

/**
 * Phase 3's gate, as a test.
 *
 * Two clients — the TreeViews and the CLI — must produce identical rows for every
 * named projection. If they can drift, then one of them is filtering for itself,
 * and changing what Today means stops being a one-file change.
 */

const FIXTURES = resolve(import.meta.dirname, "../fixtures");
const CLI = resolve(import.meta.dirname, "../../packages/cli/src/main.ts");
const DATE = "2020-01-05";

const cli = (args: string[]): unknown => {
  const out = execFileSync("npx", ["tsx", CLI, ...args], {
    encoding: "utf8",
    cwd: resolve(import.meta.dirname, "../.."),
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(out);
};

describe("the contract", () => {
  test("is versioned, and every projection describes itself", async () => {
    expect(CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    for (const name of projectionNames) {
      expect(projections[name].describes.length).toBeGreaterThan(10);
    }
  });

  test("every named projection runs against a real vault without arguments", async () => {
    const store = new Store(":memory:");
    await indexVault(FIXTURES, store);
    for (const name of projectionNames) {
      expect(() => runProjection(store, name, {
        date: DATE, project: "Projects/RS Recovery", page: "Projects/Reed Solomon",
        person: "People/Jiulong",
      }))
        .not.toThrow();
    }
    store.close();
  });
});

describe("two clients, one answer", () => {
  test("the CLI indexes with the same multi-character state policy", () => {
    const dir = mkdtempSync(join(tmpdir(), "lifeloop-cli-states-"));
    const db = join(dir, "index.sqlite");
    try {
      writeFileSync(join(dir, "W.md"), "* [DONE] cli task\n");
      execFileSync("npx", ["tsx", CLI, "index", dir, "--db", db,
        "--task-states", '[{"state":"DONE","done":true}]'], {
        cwd: resolve(import.meta.dirname, "../.."), stdio: "ignore",
      });
      const rows = cli(["query", dir, "task", "--db", db]) as any[];
      expect(rows[0]).toMatchObject({ state: "DONE", done: true });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("the CLI and the core agree on Today", async () => {
    const db = join(mkdtempSync(join(tmpdir(), "lifeloop-cli-")), "index.sqlite");
    // Index through the CLI, query through the CLI: the whole path a second
    // consumer actually takes, not a shortcut that shares our process.
    execFileSync("npx", ["tsx", CLI, "index", "test/fixtures", "--db", db], {
      cwd: resolve(import.meta.dirname, "../.."), stdio: "ignore",
    });

    const store = new Store(":memory:");
    await indexVault(FIXTURES, store);
    const direct = runProjection(store, "today", { date: DATE }) as any;
    const viaCli = cli(["query", "test/fixtures", "today", "--date", DATE, "--db", db]) as any;

    for (const bucket of ["overdue", "due", "scheduled", "waiting"]) {
      expect(viaCli[bucket].map((t: any) => t.ref).sort())
        .toEqual(direct[bucket].map((t: any) => t.ref).sort());
    }
    store.close();
  });

  test("the TreeView shows exactly what the projection returns, and adds no filter", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lifeloop-parity-"));
    try {
      (vscode.workspace as any).root = FIXTURES;
      const lifeloop = await LifeLoop.open(FIXTURES);

      const projection = runProjection(lifeloop.store, "today", { date: undefined }) as any;
      const expected = new Set<string>([
        ...projection.overdue, ...projection.due, ...projection.scheduled, ...projection.waiting,
      ].map((t: any) => String(t.ref)));

      const flatten = (nodes: any[]): any[] =>
        nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
      const shown = new Set(
        flatten(new TodayView(lifeloop).getChildren())
          .filter((n) => n.handle)
          .map((n) => n.handle.ref),
      );

      // Equality, not containment. The earlier version asserted only that every
      // row shown came from the projection — which a view showing *nothing* also
      // satisfies. Grouping is presentation and may differ; membership may not.
      expect([...shown].sort()).toEqual([...expected].sort());

      lifeloop.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(join(FIXTURES, ".lifeloop"), { recursive: true, force: true });
    }
  });
});
