import { expect, test, describe, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LifeLoop } from "../src/workspace.ts";
import { TodayView, ProjectsView, InboxView } from "../src/views.ts";
import { publishDiagnostics, resolveTarget } from "../src/retrieval.ts";
import { setTaskState, day } from "@lifeloop/semantic-core";
import * as vscode from "./vscode-mock.ts";

async function workspaceWith(files: Record<string, string>): Promise<{ lifeloop: LifeLoop; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-vscode-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  (vscode.workspace as any).root = dir;
  return { lifeloop: await LifeLoop.open(dir), dir };
}

const flatten = (nodes: any[]): any[] =>
  nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);

describe("Today view", () => {
  test("groups into disjoint sections and carries a handle on each task", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "Work.md": [
        '* [ ] overdue thing [deadline: "2020-01-01"]',
        "* [ ] blocked #waiting",
        "",
      ].join("\n"),
    });
    const nodes = new TodayView(lifeloop).getChildren();
    const labels = nodes.map((n) => n.label);
    expect(labels.some((l) => String(l).startsWith("Overdue"))).toBe(true);
    expect(labels.some((l) => String(l).startsWith("Waiting"))).toBe(true);

    const task = flatten(nodes).find((n) => n.label === "overdue thing");
    expect(task).toBeDefined();
    // I4: the node carries identity *and* the receipt for what was shown.
    expect(task.handle.ref).toMatch(/^Work@\d+$/);
    expect(task.handle.expectedState).toBe(" ");
    expect(task.handle.expectedText).toContain("overdue thing");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("says so when nothing is due, rather than showing empty sections", async () => {
    const { lifeloop, dir } = await workspaceWith({ "Work.md": "* [ ] someday thing\n" });
    const nodes = new TodayView(lifeloop).getChildren();
    expect(nodes.map((n) => n.label)).toEqual(["Nothing due today"]);
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("acting on a view node", () => {
  test("completing through a node's handle stamps the source", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "Work.md": '* [ ] ship it [deadline: "2020-01-01"]\n',
    });
    const task = flatten(new TodayView(lifeloop).getChildren()).find((n) => n.handle);
    // The stamp is the *local* calendar date, so the expectation is computed
    // rather than pinned — a fixed string would only hold in one timezone.
    const at = new Date("2026-09-08T12:00:00Z");
    const result = await setTaskState(lifeloop.vault, task.handle, true, at);
    expect(result.ok).toBe(true);
    expect(lifeloop.vault.read("Work.md")).toContain(`[completed: "${day(at)}"]`);
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a node built before the source changed refuses and writes nothing", async () => {
    // The failure this whole design exists to prevent: a projection acting on a
    // row that no longer describes the source it was rendered from.
    const { lifeloop, dir } = await workspaceWith({
      "Work.md": '* [ ] ship it [deadline: "2020-01-01"]\n',
    });
    const task = flatten(new TodayView(lifeloop).getChildren()).find((n) => n.handle);

    lifeloop.vault.write("Work.md", '* [ ] something else entirely [deadline: "2020-01-01"]\n');
    const before = lifeloop.vault.read("Work.md");

    const result = await setTaskState(lifeloop.vault, task.handle, true);
    expect(result).toMatchObject({ ok: false, reason: "stale" });
    expect(lifeloop.vault.read("Work.md")).toBe(before);
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Projects view", () => {
  test("groups by status and shows signals without writing them", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "P.md": "---\ntags: project\nstatus: active\n---\n* [ ] a #waiting\n",
      "Q.md": "---\ntags: project\nstatus: paused\n---\n* [ ] b\n",
    });
    const nodes = new ProjectsView(lifeloop).getChildren();
    expect(nodes.map((n) => String(n.label).split("  ")[0])).toEqual(["Active", "Paused"]);

    const p = flatten(nodes).find((n) => n.label === "P");
    expect(p.description).toContain("waiting only");
    // The signal is shown and never persisted.
    expect(lifeloop.vault.read("P.md")).not.toContain("waiting only");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Inbox view", () => {
  test("lists pending items only, and counts nested children", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "Inbox.md": "* one\n  * nested\n* two\n\n## Processed\n\n* already handled\n",
    });
    const nodes = new InboxView(lifeloop).getChildren();
    expect(nodes.map((n) => n.label)).toEqual(["one", "two"]);
    expect(nodes[0].description).toBe("1 nested");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("retrieval", () => {
  test("a wikilink resolves by basename, and an ambiguous one resolves to nothing", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "Projects/Foo.md": "# Foo\n",
      "Areas/Bar.md": "# Bar\n",
      "Old/Bar.md": "# Bar again\n",
    });
    expect(resolveTarget(lifeloop, "Foo")).toBe("Projects/Foo");
    expect(resolveTarget(lifeloop, "Projects/Foo")).toBe("Projects/Foo");
    // Two pages share the basename, so guessing would open the wrong one.
    expect(resolveTarget(lifeloop, "Bar")).toBeNull();
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("diagnostics report broken links and malformed dates, and fix nothing", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "Notes.md": '* [ ] task [deadline: "next tuesday"]\n\nSee [[Nowhere]]\n',
    });
    const collection = vscode.languages.createDiagnosticCollection() as any;
    publishDiagnostics(lifeloop, collection);

    const messages = collection.entries.flatMap(([, list]: [string, any[]]) =>
      list.map((d) => d.message),
    );
    expect(messages.some((m: string) => m.includes("does not resolve"))).toBe(true);
    expect(messages.some((m: string) => m.includes("not a YYYY-MM-DD date"))).toBe(true);
    expect(lifeloop.vault.read("Notes.md")).toContain('[deadline: "next tuesday"]');
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});
