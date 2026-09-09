import { expect, test, describe, beforeEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LifeLoop } from "../src/workspace.ts";
import { TodayView, ProjectsView, InboxView, LinkedTasksView, PersonContextView } from "../src/views.ts";
import { publishDiagnostics, resolveTarget } from "../src/retrieval.ts";
import { apply, changeSet, setTaskState, day, shift, Store, extractObjects, pageMetaFor } from "@lifeloop/semantic-core";
import * as vscode from "./vscode-mock.ts";
import { renderPreMeetingBrief } from "../src/apple.ts";
import { taskTarget } from "../src/task-target.ts";

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
    expect(task.tooltip.value).toContain("Why: deadline 2020-01-01 is before today");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("shows Upcoming when no tasks are due today", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "Work.md": `* [ ] tomorrow only [scheduled: "${shift(day(), 1)}"]\n`,
    });
    try {
      const nodes = new TodayView(lifeloop).getChildren();
      expect(nodes.map(n => n.label)).toEqual(["Upcoming"]);
      expect(flatten(nodes).some(n => n.label === "tomorrow only" && n.handle)).toBe(true);
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("says so when nothing is due, rather than showing empty sections", async () => {
    const { lifeloop, dir } = await workspaceWith({ "Work.md": "* [ ] someday thing\n" });
    const nodes = new TodayView(lifeloop).getChildren();
    expect(nodes.map((n) => n.label)).toEqual(["Nothing due today"]);
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("shows due reconnect facts in one collapsed People section", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "People/Alice.md": "---\ntags: person\ncontact-every: 7d\n---\n",
      "Journal/2020-01-01.md": "* Called [[People/Alice]] [interaction: call]\n",
    });
    try {
      const nodes = new TodayView(lifeloop).getChildren();
      const people = nodes.find((node) => String(node.label).startsWith("People"));
      expect(people?.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
      expect(people?.children?.[0]).toMatchObject({ label: "Alice", page: "People/Alice", contextValue: "lifeloopPerson" });
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("combines birthday and reconnect facts for one Person", async () => {
    const today = day();
    const { lifeloop, dir } = await workspaceWith({
      "People/Alice.md": `---\ntags: person\nbirthday: ${today.slice(5)}\ncontact-every: 7d\n---\n`,
      "Journal/2020-01-01.md": "* Called [[People/Alice]] [interaction: call]\n",
    });
    try {
      const people = new TodayView(lifeloop).getChildren()
        .find((node) => String(node.label).startsWith("People"));
      expect(people?.children).toHaveLength(1);
      expect(people?.children?.[0]).toMatchObject({ label: "Alice", page: "People/Alice" });
      expect(people?.children?.[0].description).toContain("birthday today");
      expect(people?.children?.[0].description).toContain("due 2020-01-08");
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("Person Context view", () => {
  test("shows explicit history and linked follow-ups only on a Person page", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "People/Alice.md": "---\ntags: person\n---\n",
      "Journal/2026-09-09.md": "* Called [[People/Alice]] [interaction: call]\n* merely mentioned [[People/Alice]]\n",
      "Work.md": "* [ ] Send notes [[People/Alice]]\n",
    });
    try {
      vscode.window.activeTextEditor = { document: { languageId: "markdown", uri: vscode.Uri.file(join(dir, "People/Alice.md")) } };
      const nodes = new PersonContextView(lifeloop).getChildren();
      expect(nodes[0]).toMatchObject({ label: "call · 2026-09-09", page: "Journal/2026-09-09" });
      expect(flatten(nodes).filter((node) => node.handle).map((node) => node.label)).toEqual(["Send notes [[People/Alice]]"]);

      vscode.window.activeTextEditor = { document: { languageId: "markdown", uri: vscode.Uri.file(join(dir, "Work.md")) } };
      expect(new PersonContextView(lifeloop).getChildren()).toEqual([]);
    } finally {
      vscode.window.activeTextEditor = undefined;
      lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("Pre-meeting Brief renders bounded, escaped Calendar and Person context", () => {
  const markdown = renderPreMeetingBrief({
    uid: "E1", summary: "Weekly <sync>", start: "Sep 10 2:00 PM", end: "Sep 10 3:00 PM",
    location: "Room *A*", cancelled: false,
  }, [{
    person: { ref: "People/Alice #1", tag: "page" },
    interactions: [{
      ref: "Journal/2026-09-01@0", page: "Journal/2026-09-01", date: "2026-09-01",
      kind: "call", text: "Discussed <script> and [links]", people: ["People/Alice #1"], offset: 0,
    }],
    lastInteraction: {
      ref: "Journal/2026-09-01@0", page: "Journal/2026-09-01", date: "2026-09-01",
      kind: "call", text: "Discussed", people: ["People/Alice #1"], offset: 0,
    },
    openFollowups: [{ ref: "Work@0", tag: "task" }],
  }]);
  expect(markdown).toContain("**Weekly \\<sync\\>**");
  expect(markdown).toContain("## Alice \\#1");
  expect(markdown).toContain("Room \\*A\\*");
  expect(markdown).toContain("Discussed \\<script\\> and \\[links\\]");
  expect(markdown).toContain("Open follow-ups: 1");
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

describe("task command admission", () => {
  test("re-resolves a guarded handle and ignores stale presentation coordinates", async () => {
    const line = "* [ ] source task";
    const { lifeloop, dir } = await workspaceWith({ "Work.md": `${line}\n` });
    try {
      expect(taskTarget(lifeloop, {
        handle: { ref: "Work@0", expectedText: line, expectedState: " " },
        page: "Stale/Projection",
        offset: 99,
      })).toMatchObject({ page: "Work", offset: 0, line, name: "source task" });
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("requires all three handle receipts at runtime", async () => {
    const line = "* [ ] guarded";
    const { lifeloop, dir } = await workspaceWith({ "Work.md": `${line}\n` });
    try {
      for (const handle of [
        { ref: "Work@0", expectedText: line },
        { ref: "Work@0", expectedState: " " },
        { ref: "Work@0", expectedText: 7, expectedState: " " },
      ]) expect(() => taskTarget(lifeloop, { handle } as any)).not.toThrow();
      for (const handle of [
        { ref: "Work@0", expectedText: line },
        { ref: "Work@0", expectedState: " " },
        { ref: "Work@0", expectedText: 7, expectedState: " " },
      ]) expect(taskTarget(lifeloop, { handle } as any)).toBeNull();
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("refuses a numeric ref that now lands inside the same unchanged task", async () => {
    const line = "* [ ] unchanged";
    const original = `prefixxxxx\n${line}\n`;
    const { lifeloop, dir } = await workspaceWith({ "Work.md": original });
    try {
      const handle = {
        ref: `Work@${original.indexOf(line)}`,
        expectedText: line,
        expectedState: " ",
      };
      await lifeloop.vault.write("Work.md", `prefix\n${line}\n`);
      await lifeloop.reindex();
      expect(taskTarget(lifeloop, { handle })).toBeNull();
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("accepts live CRLF numeric refs without translating them twice", async () => {
    const text = "intro\r\n* [ ] crlf task\r\n";
    const line = "* [ ] crlf task";
    const offset = text.indexOf(line);
    const { lifeloop, dir } = await workspaceWith({ "Work.md": text });
    try {
      expect(taskTarget(lifeloop, { handle: {
        ref: `Work@${offset}`, expectedText: line, expectedState: " ",
      } })).toMatchObject({ page: "Work", offset, line });
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("uses the live line start for an indented numeric task", async () => {
    const line = "  * [ ] nested task";
    const text = `* context\n${line}\n`;
    const offset = text.indexOf(line);
    const { lifeloop, dir } = await workspaceWith({ "Work.md": text });
    try {
      expect(taskTarget(lifeloop, { handle: {
        ref: `Work@${offset}`, expectedText: line, expectedState: " ",
      } })).toMatchObject({ page: "Work", offset, line });
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("allows a unique anchored task to relocate in CRLF text", async () => {
    const line = '* [ ] anchored $task [deadline: "2020-01-01"]';
    const { lifeloop, dir } = await workspaceWith({ "Work.md": `${line}\r\n` });
    try {
      const handle = flatten(new TodayView(lifeloop).getChildren()).find((node) => node.handle).handle;
      expect(handle.ref).toBe("Work@task");
      await lifeloop.vault.write("Work.md", `intro\r\n${line}\r\n`);
      await lifeloop.reindex();
      expect(taskTarget(lifeloop, { handle })).toMatchObject({
        page: "Work", offset: "intro\r\n".length, line,
      });
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
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

  test("diagnostics leave ordinary links to Foam and validate task fields", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "Notes.md": '* [ ] task [deadline: "next tuesday"]\n\nSee [[Nowhere]]\n',
    });
    const collection = vscode.languages.createDiagnosticCollection() as any;
    publishDiagnostics(lifeloop, collection);

    const messages = collection.entries.flatMap(([, list]: [string, any[]]) =>
      list.map((d) => d.message),
    );
    expect(messages.some((m: string) => m.includes("does not resolve"))).toBe(false);
    expect(messages.some((m: string) => m.includes("not a YYYY-MM-DD date"))).toBe(true);
    expect(lifeloop.vault.read("Notes.md")).toContain('[deadline: "next tuesday"]');
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});


test("Linked Tasks includes inherited links, excludes completed/local tasks, and refuses a stale row", async () => {
  const { lifeloop, dir } = await workspaceWith({
    "Person.md": "# Person\n* [ ] local [[Person]]\n",
    "Meeting.md": "* Discuss [[Person]]\n  * [ ] follow up\n  * [x] done\n",
  });
  try {
    vscode.window.activeTextEditor = { document: { languageId: "markdown", uri: vscode.Uri.file(join(dir, "Person.md")) } };
    const rows = new LinkedTasksView(lifeloop).getChildren();
    expect(rows.map(r => r.label)).toEqual(["follow up"]);
    expect(rows[0].handle?.expectedText).toContain("follow up");
    expect(String((rows[0].tooltip as any)?.value)).toContain("inherits a link to [[Person]]");
    await lifeloop.vault.write("Meeting.md", "* Discuss [[Person]]\n  * [ ] replacement\n  * [x] done\n");
    const result = await setTaskState(lifeloop.vault, rows[0].handle!, true);
    expect(result).toMatchObject({ ok: false, reason: "stale" });
    expect(lifeloop.vault.read("Meeting.md")).toContain("[ ] replacement");
  } finally {
    vscode.window.activeTextEditor = undefined;
    lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});


test.each([TodayView, ProjectsView, LinkedTasksView])("%s signs the indexed task, even when source changed before rendering", async (View) => {
  const original = '---\ntags: project\n---\n* [ ] original [[Person]] [deadline: "2020-01-01"]\n';
  const replacement = original.replace("original", "replacement");
  const { lifeloop, dir } = await workspaceWith({ "Work.md": original, "Person.md": "# Person\n" });
  try {
    vscode.window.activeTextEditor = { document: { languageId: "markdown", uri: vscode.Uri.file(join(dir, "Person.md")) } };
    await lifeloop.vault.write("Work.md", replacement);
    const row = flatten(new View(lifeloop).getChildren()).find(n => n.handle);
    expect(row.label).toContain("original");
    expect(row.handle.expectedText).toContain("original");
    expect(await setTaskState(lifeloop.vault, row.handle, true)).toMatchObject({ ok: false, reason: "stale" });
    expect(lifeloop.vault.read("Work.md")).toBe(replacement);
    await lifeloop.reindex(true);
    expect(await setTaskState(lifeloop.vault, row.handle, true)).toMatchObject({ ok: false, reason: "stale" });
    const fresh = flatten(new View(lifeloop).getChildren()).find(n => n.handle);
    expect(fresh.label).toContain("replacement");
    expect((await setTaskState(lifeloop.vault, fresh.handle, true)).ok).toBe(true);
  } finally {
    vscode.window.activeTextEditor = undefined;
    lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});

test("missing indexed body cannot issue an actionable task handle", async () => {
  const { lifeloop, dir } = await workspaceWith({ "Work.md": '* [ ] original [deadline: "2020-01-01"]\n' });
  try {
    lifeloop.store.db.exec("DELETE FROM fts");
    const row = flatten(new TodayView(lifeloop).getChildren()).find(n => n.label === "original");
    expect(row).toBeDefined();
    expect(row.handle).toBeUndefined();
    expect(row.contextValue).toBeUndefined();
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("an index replacement on another connection cannot sign an old task row", async () => {
  const original = '* [ ] original [deadline: "2020-01-01"]\n';
  const replacement = original.replace("original", "replacement");
  const { lifeloop, dir } = await workspaceWith({ "Work.md": original });
  const writer = new Store(join(dir, ".lifeloop/index.sqlite"));
  try {
    const objects = await extractObjects(replacement, pageMetaFor("Work"));
    const select = lifeloop.store.select.bind(lifeloop.store);
    vi.spyOn(lifeloop.store, "select").mockImplementationOnce((where, params) => {
      const old = select(where, params);
      writer.replacePage({ path: "Work.md", name: "Work", hash: "replacement", lastModified: "", size: replacement.length }, objects, replacement);
      return old;
    });
    const row = flatten(new TodayView(lifeloop).getChildren()).find(n => n.label === "original");
    expect(row).toBeDefined();
    expect(row.handle).toBeUndefined();
    expect(row.contextValue).toBeUndefined();
    expect(lifeloop.vault.read("Work.md")).toBe(original);
  } finally { writer.close(); lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});


test.each([TodayView, ProjectsView, LinkedTasksView])("%s converts indexed CRLF positions and completes only the intended task", async (View) => {
  const text = '---\r\ntags: project\r\n---\r\n' + "\r\n".repeat(20) +
    '* [ ] WRONG\r\n* [ ] correct [[Person]] [deadline: "2020-01-01"]\r\n';
  const { lifeloop, dir } = await workspaceWith({ "Work.md": text, "Person.md": "# Person\n" });
  try {
    vscode.window.activeTextEditor = { document: { languageId: "markdown", uri: vscode.Uri.file(join(dir, "Person.md")) } };
    const row = flatten(new View(lifeloop).getChildren()).find(n => String(n.label).includes("correct"));
    expect(row).toBeDefined();
    expect(row.handle.ref).toBe(`Work@${text.indexOf("* [ ] correct")}`);
    expect(row.offset).toBe(text.indexOf("* [ ] correct"));
    expect(row.contextValue).toBe("lifeloopTask");
    expect((await setTaskState(lifeloop.vault, row.handle, true)).ok).toBe(true);
    const changed = lifeloop.vault.read("Work.md");
    expect(changed).toContain("* [ ] WRONG\r\n* [x] correct");
    expect(changed.replaceAll("\r\n", "")).not.toContain("\n");
  } finally {
    vscode.window.activeTextEditor = undefined;
    lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});

test("configured multi-character task states flow through workspace indexing and task receipts", async () => {
  const states = [{ state: "TO DO" }, { state: "IN PROGRESS" }, { state: "DONE", done: true }];
  vscode.workspace.settings["lifeloop.taskStates"] = states;
  const text = '* [IN PROGRESS] active [deadline: "2020-01-01"]\r\n* [DONE] finished\r\n';
  const { lifeloop, dir } = await workspaceWith({ "W.md": text });
  try {
    expect(lifeloop.store.objects("task").map(t => t.done)).toEqual([false, true]);
    const row = flatten(new TodayView(lifeloop).getChildren()).find(n => n.label === "active");
    expect(row.handle.expectedState).toBe("IN PROGRESS");
    expect((await setTaskState(lifeloop.vault, row.handle, true, new Date(), lifeloop.taskStates)).ok).toBe(true);
    await lifeloop.reindex();
    expect(lifeloop.store.objects("task").every(t => t.done)).toBe(true);
    expect(lifeloop.vault.read("W.md")).toContain("\r\n* [DONE] finished\r\n");
    vscode.workspace.settings["lifeloop.taskStates"] = [{ state: "DONE", done: false }];
    await lifeloop.reindex();
    expect(lifeloop.store.objects("task").find(t => t.state === "DONE")?.done).toBe(false);
  } finally {
    delete vscode.workspace.settings["lifeloop.taskStates"];
    lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed policy rebuild does not publish its candidate task states", async () => {
  const { lifeloop, dir } = await workspaceWith({ "W.md": "* [DONE] task\n" });
  const original = lifeloop.store.writePage.bind(lifeloop.store);
  try {
    vscode.workspace.settings["lifeloop.taskStates"] = [{ state: "DONE", done: true }];
    lifeloop.store.writePage = (() => { throw new Error("injected policy rebuild failure"); }) as any;
    await expect(lifeloop.reindex()).rejects.toThrow("injected");
    expect(lifeloop.taskStates).toEqual([{ state: " " }, { state: "x", done: true }]);
  } finally {
    lifeloop.store.writePage = original;
    delete vscode.workspace.settings["lifeloop.taskStates"];
    lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});

test("an uncertified partial policy rebuild is repaired before a single-page touch publishes", async () => {
  const files = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`${i}.md`, "* [DONE] task\n"]));
  const { lifeloop, dir } = await workspaceWith(files);
  const original = lifeloop.store.writePage.bind(lifeloop.store);
  try {
    vscode.workspace.settings["lifeloop.taskStates"] = [{ state: "DONE", done: true }];
    let writes = 0;
    lifeloop.store.writePage = ((...args: Parameters<typeof original>) => {
      if (++writes === 501) throw new Error("injected partial policy rebuild");
      return original(...args);
    }) as any;
    await expect(lifeloop.reindex()).rejects.toThrow("injected");
    lifeloop.store.writePage = original;
    vscode.workspace.settings["lifeloop.taskStates"] = [{ state: "DONE", done: false }];
    await lifeloop.touch(vscode.Uri.file(join(dir, "500.md")) as any, "* [DONE] task\n");
    expect(lifeloop.store.objects("task").every((task) => task.done === false)).toBe(true);
  } finally {
    lifeloop.store.writePage = original;
    delete vscode.workspace.settings["lifeloop.taskStates"];
    lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});

test("a policy rebuild refuses to certify a dirty document that closes mid-pass", async () => {
  const { lifeloop, dir } = await workspaceWith({ "A.md": "* [DONE] a\n", "B.md": "* [DONE] b\n" });
  const original = lifeloop.store.writePage.bind(lifeloop.store);
  const document: any = {
    uri: vscode.Uri.file(join(dir, "A.md")), languageId: "markdown",
    isDirty: true, isClosed: false, getText: () => "* [DONE] dirty a\n",
  };
  vscode.workspace.textDocuments = [document];
  try {
    vscode.workspace.settings["lifeloop.taskStates"] = [{ state: "DONE", done: true }];
    lifeloop.store.writePage = ((...args: Parameters<typeof original>) => {
      if (args[0].path === "B.md") { document.isClosed = true; document.isDirty = false; }
      return original(...args);
    }) as any;
    await expect(lifeloop.reindex()).rejects.toThrow("dirty document disappeared");
    const certificate = lifeloop.store.db.prepare("SELECT value FROM meta WHERE key = 'task_states'").get();
    expect(certificate).toBeUndefined();
  } finally {
    lifeloop.store.writePage = original;
    vscode.workspace.textDocuments = [];
    delete vscode.workspace.settings["lifeloop.taskStates"];
    lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});

test("a dirty Foam template stays outside the task index", async () => {
  const template = "# Daily note, unsaved\n";
  const { lifeloop, dir } = await workspaceWith({
    "Work.md": "* [ ] task\n",
    ".foam/templates/daily-note.md": "# Daily note\n",
  });
  const document: any = {
    uri: vscode.Uri.file(join(dir, ".foam/templates/daily-note.md")), languageId: "markdown",
    isDirty: true, isClosed: false, getText: () => template,
  };
  vscode.workspace.textDocuments = [document];
  try {
    await expect(lifeloop.currentTaskStates()).resolves.toEqual(lifeloop.taskStates);
    const task = lifeloop.store.objects("task")[0];
    expect((await setTaskState(lifeloop.vault, {
      ref: String(task.ref), expectedText: "* [ ] task", expectedState: String(task.state),
      capturedAt: new Date().toISOString(),
    }, true, new Date(), lifeloop.taskStates)).ok).toBe(true);
    expect(document.getText()).toBe(template);
    expect(readFileSync(join(dir, ".foam/templates/daily-note.md"), "utf8")).toBe("# Daily note\n");
  } finally {
    vscode.workspace.textDocuments = [];
    lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});

test("a dirty Markdown document outside the vault stays outside the task index", async () => {
  const { lifeloop, dir } = await workspaceWith({ "Work.md": "* [ ] task\n" });
  const outside = join(dir, "..", `outside-${Date.now()}.md`);
  const document: any = {
    uri: vscode.Uri.file(outside), languageId: "markdown",
    isDirty: true, isClosed: false, getText: () => "* [ ] unrelated\n",
  };
  vscode.workspace.textDocuments = [document];
  try {
    await expect(lifeloop.currentTaskStates()).resolves.toEqual(lifeloop.taskStates);
    expect(lifeloop.store.objects("task")).toHaveLength(1);
    expect(() => lifeloop.pageNameOfUri(document.uri)).toThrow("outside the LifeLoop vault");
    await expect(lifeloop.vault.write(`../${outside.split("/").pop()}`, "changed\n"))
      .rejects.toThrow("path escapes the vault");
  } finally {
    vscode.workspace.textDocuments = [];
    lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});

test("a dirty excluded page inside the vault still uses the editor buffer", async () => {
  const { lifeloop, dir } = await workspaceWith({ "Work.md": "* [ ] task\n", "tmp/Inbox.md": "disk\n" });
  const document: any = {
    uri: vscode.Uri.file(join(dir, "tmp/Inbox.md")), languageId: "markdown",
    isDirty: true, isClosed: false, getText: () => "visible buffer\n", save: async () => true,
    positionAt: (offset: number) => ({ line: 0, character: offset }),
  };
  vscode.workspace.textDocuments = [document];
  const edit = vi.spyOn(vscode.workspace, "applyEdit").mockResolvedValue(true);
  try {
    expect(lifeloop.vault.read("tmp/Inbox.md")).toBe("visible buffer\n");
    await lifeloop.vault.write("tmp/Inbox.md", "changed\n");
    expect(edit).toHaveBeenCalledOnce();
    expect(readFileSync(join(dir, "tmp/Inbox.md"), "utf8")).toBe("disk\n");
  } finally {
    edit.mockRestore();
    vscode.workspace.textDocuments = [];
    lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed editor save cannot be reconciled from the dirty buffer", async () => {
  const { lifeloop, dir } = await workspaceWith({ "Work.md": "before" });
  let text = "before";
  const document: any = {
    uri: vscode.Uri.file(join(dir, "Work.md")), languageId: "markdown",
    isDirty: false, isClosed: false, getText: () => text,
    positionAt: (offset: number) => ({ line: 0, character: offset }),
    save: async () => false,
  };
  vscode.workspace.textDocuments = [document];
  const edit = vi.spyOn(vscode.workspace, "applyEdit").mockImplementation(async (change: any) => {
    text = change.edits[0].content;
    document.isDirty = true;
    return true;
  });
  try {
    const cs = changeSet("failed editor save");
    cs.expected.set("Work.md", "before");
    cs.writes.set("Work.md", "after");
    expect(await apply(lifeloop.vault, cs)).toMatchObject({ ok: false, reason: "unknown" });
    expect(document.isDirty).toBe(true);
    expect(readFileSync(join(dir, "Work.md"), "utf8")).toBe("before");
  } finally {
    edit.mockRestore();
    vscode.workspace.textDocuments = [];
    lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});

test("a declaration changed during the second pass is not published", async () => {
  vscode.workspace.settings["lifeloop.executeSpaceLua"] = true;
  const initial = '```space-lua\ntaskState.define {name="DONE", done=false}\n```\n';
  const { lifeloop, dir } = await workspaceWith({ "States.md": initial, "W.md": "* [DONE] task\n" });
  const original = lifeloop.store.writePage.bind(lifeloop.store);
  let text = initial.replace("done=false", "done=true");
  const document: any = {
    uri: vscode.Uri.file(join(dir, "States.md")), languageId: "markdown",
    isDirty: true, isClosed: false, getText: () => text,
  };
  vscode.workspace.textDocuments = [document];
  try {
    const published = structuredClone(lifeloop.taskStates);
    lifeloop.store.writePage = ((...args: Parameters<typeof original>) => {
      if (args[0].path === "W.md") text = initial;
      return original(...args);
    }) as any;
    await expect(lifeloop.currentTaskStates()).rejects.toThrow("policy source changed while rebuilding");
    expect(lifeloop.taskStates).toEqual(published);
    expect(lifeloop.store.db.prepare("SELECT value FROM meta WHERE key = 'task_states'").get()).toBeUndefined();
  } finally {
    lifeloop.store.writePage = original;
    vscode.workspace.textDocuments = [];
    delete vscode.workspace.settings["lifeloop.executeSpaceLua"];
    lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});

test("a source event during task-state evaluation invalidates its result", async () => {
  const script = '```space-lua\ntaskState.define {name="DONE", done=true}\n```\n';
  const { lifeloop, dir } = await workspaceWith({ "States.md": script, "W.md": "* [DONE] task\n" });
  const original = lifeloop.store.objects.bind(lifeloop.store);
  let reads = 0;
  try {
    vscode.workspace.settings["lifeloop.executeSpaceLua"] = true;
    lifeloop.store.objects = ((tag: string) => {
      const result = original(tag);
      if (tag === "space-lua" && ++reads === 2) lifeloop.noteSourceChange();
      return result;
    }) as typeof lifeloop.store.objects;
    await expect(lifeloop.currentTaskStates()).rejects.toThrow("policy source changed while evaluating");
  } finally {
    lifeloop.store.objects = original;
    delete vscode.workspace.settings["lifeloop.executeSpaceLua"];
    lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});

test("an external declaration write during evaluation invalidates its result", async () => {
  const script = '```space-lua\ntaskState.define {name="DONE", done=false}\n```\n';
  const { lifeloop, dir } = await workspaceWith({ "States.md": script, "W.md": "* [DONE] task\n" });
  const original = lifeloop.store.objects.bind(lifeloop.store);
  let reads = 0;
  try {
    vscode.workspace.settings["lifeloop.executeSpaceLua"] = true;
    lifeloop.store.objects = ((tag: string) => {
      const result = original(tag);
      if (tag === "space-lua" && ++reads === 2) {
        writeFileSync(join(dir, "States.md"), script.replace("done=false", "done=true"));
      }
      return result;
    }) as typeof lifeloop.store.objects;
    await expect(lifeloop.currentTaskStates()).rejects.toThrow("source changed while evaluating task-state policy");
  } finally {
    lifeloop.store.objects = original;
    delete vscode.workspace.settings["lifeloop.executeSpaceLua"];
    lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});

test("an external declaration file created during evaluation invalidates its result", async () => {
  const script = '```space-lua\ntaskState.define {name="DONE", done=false}\n```\n';
  const { lifeloop, dir } = await workspaceWith({ "States.md": script, "W.md": "* [DONE] task\n" });
  const original = lifeloop.store.objects.bind(lifeloop.store);
  let reads = 0;
  try {
    vscode.workspace.settings["lifeloop.executeSpaceLua"] = true;
    lifeloop.store.objects = ((tag: string) => {
      const result = original(tag);
      if (tag === "space-lua" && ++reads === 2) {
        writeFileSync(join(dir, "NewStates.md"), script.replace("DONE", "NEW"));
      }
      return result;
    }) as typeof lifeloop.store.objects;
    await expect(lifeloop.currentTaskStates()).rejects.toThrow("vault contents changed while evaluating task-state policy");
  } finally {
    lifeloop.store.objects = original;
    delete vscode.workspace.settings["lifeloop.executeSpaceLua"];
    lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});

test("configuration changed during the second pass is not published", async () => {
  const { lifeloop, dir } = await workspaceWith({ "W.md": "* [DONE] task\n" });
  const original = lifeloop.store.writePage.bind(lifeloop.store);
  try {
    vscode.workspace.settings["lifeloop.taskStates"] = [{ state: "DONE", done: true }];
    lifeloop.store.writePage = ((...args: Parameters<typeof original>) => {
      vscode.workspace.settings["lifeloop.taskStates"] = [{ state: "DONE", done: false }];
      return original(...args);
    }) as any;
    await expect(lifeloop.reindex()).rejects.toThrow("policy source changed while rebuilding");
    expect(lifeloop.taskStates).toEqual([{ state: " " }, { state: "x", done: true }]);
    expect(lifeloop.store.db.prepare("SELECT value FROM meta WHERE key = 'task_states'").get()).toBeUndefined();
  } finally {
    lifeloop.store.writePage = original;
    delete vscode.workspace.settings["lifeloop.taskStates"];
    lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});

test("a saved declaration changed after it was indexed is not published", async () => {
  vscode.workspace.settings["lifeloop.executeSpaceLua"] = true;
  const open = '```space-lua\ntaskState.define {name="DONE", done=false}\n```\n';
  const done = open.replace("done=false", "done=true");
  const { lifeloop, dir } = await workspaceWith({ "States.md": open, "W.md": "* [DONE] task\n" });
  const original = lifeloop.store.writePage.bind(lifeloop.store);
  try {
    writeFileSync(join(dir, "States.md"), done);
    lifeloop.store.writePage = ((...args: Parameters<typeof original>) => {
      const result = original(...args);
      if (args[0].path === "W.md") writeFileSync(join(dir, "States.md"), open);
      return result;
    }) as any;
    await expect(lifeloop.reindex()).rejects.toThrow("source changed while indexing States.md");
    expect(lifeloop.store.db.prepare("SELECT value FROM meta WHERE key = 'task_states'").get()).toBeUndefined();
  } finally {
    lifeloop.store.writePage = original;
    delete vscode.workspace.settings["lifeloop.executeSpaceLua"];
    lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});

test("Lua state declarations reclassify existing pages when changed or removed", async () => {
  vscode.workspace.settings["lifeloop.executeSpaceLua"] = true;
  const declaration = '```space-lua\ntaskState.define {name="DONE", done=true}\n```\n';
  const { lifeloop, dir } = await workspaceWith({ "States.md": declaration, "W.md": '* [DONE] finished\n' });
  try {
    expect(lifeloop.store.objects("task")[0].done).toBe(true);
    writeFileSync(join(dir, "States.md"), declaration.replace("done=true", "done=false"));
    await lifeloop.reindex();
    expect(lifeloop.store.objects("task")[0].done).toBe(false);
    writeFileSync(join(dir, "States.md"), "# No declarations\n");
    await lifeloop.reindex();
    expect(lifeloop.taskStates).toEqual([{ state: " " }, { state: "x", done: true }]);
    expect(lifeloop.vault.read("W.md")).toBe('* [DONE] finished\n');
  } finally {
    delete vscode.workspace.settings["lifeloop.executeSpaceLua"];
    lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});
