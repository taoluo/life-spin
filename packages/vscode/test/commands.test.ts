import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { day, pending, shift, week } from "@lifeloop/semantic-core";
import { recordInteraction } from "../src/commands.ts";
import { register as registerCommands } from "../src/commands.ts";
import { InboxView } from "../src/views.ts";
import { taskTarget, type TaskTarget } from "../src/task-target.ts";
import { LifeLoop } from "../src/workspace.ts";
import * as vscode from "./vscode-mock.ts";

async function workspaceWith(files: Record<string, string>): Promise<{ lifeloop: LifeLoop; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-commands-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  (vscode.workspace as any).root = dir;
  return { lifeloop: await LifeLoop.open(dir), dir };
}

const task = (lifeloop: LifeLoop, line: string): TaskTarget => taskTarget(lifeloop, {
  handle: { ref: "Work@0", expectedText: line, expectedState: " " },
})!;

afterEach(() => {
  vi.restoreAllMocks();
  vscode.workspace.textDocuments = [];
  vscode.window.activeTextEditor = undefined;
  vscode.env.clipboard.text = "";
  delete (vscode.commands as any).executeCommand;
});

function registered(lifeloop: LifeLoop): Map<string, Function> {
  const handlers = new Map<string, Function>();
  vi.spyOn(vscode.commands, "registerCommand").mockImplementation(((id: string, fn: Function) => {
    handlers.set(id, fn);
    return { dispose() {} };
  }) as any);
  (vscode.commands as any).executeCommand = vi.fn(async (id: string, ...args: any[]) =>
    handlers.get(id)?.(...args));
  registerCommands(lifeloop, { subscriptions: [] } as any);
  return handlers;
}

function findPicker(
  check: (picker: any) => any,
): any {
  const accepted: Function[] = [];
  const hidden: Function[] = [];
  const active: Function[] = [];
  const buttons: Function[] = [];
  const picker: any = {
    items: [], value: "", activeItems: [], selectedItems: [], buttons: [], title: "",
    placeholder: "", matchOnDescription: false, matchOnDetail: false,
    onDidAccept: (handler: Function) => {
      accepted.push(handler);
      return { dispose: () => accepted.splice(accepted.indexOf(handler), 1) };
    },
    onDidHide: (handler: Function) => {
      hidden.push(handler);
      return { dispose: () => hidden.splice(hidden.indexOf(handler), 1) };
    },
    onDidChangeActive: (handler: Function) => {
      active.push(handler);
      return { dispose: () => active.splice(active.indexOf(handler), 1) };
    },
    onDidTriggerButton: (handler: Function) => {
      buttons.push(handler);
      return { dispose: () => buttons.splice(buttons.indexOf(handler), 1) };
    },
    show: () => {
      const item = check(picker);
      if (item) picker.selectedItems = picker.activeItems = [item];
      for (const handler of [...accepted]) handler();
    },
    dispose: vi.fn(),
  };
  return picker;
}

test("Quick Reschedule uses the explicit task, preserves deadline and Calendar, and reports after refresh", async () => {
  const a = '* [ ] A [deadline: "2026-09-20"] [event: "E1"]';
  const b = "* [ ] B";
  const { lifeloop, dir } = await workspaceWith({ "A.md": `${a}\n`, "B.md": `${b}\n` });
  const handlers = registered(lifeloop);
  const picked = vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any[]) => {
    expect(items.map((item) => item.label)).toEqual([
      `$(calendar) Today — ${day()}`,
      `$(calendar) Tomorrow — ${shift(day(), 1)}`,
      `$(calendar) Next week — ${week(shift(day(), 7)).start}`,
      "$(calendar) Pick date…",
      "$(close) Clear scheduled",
    ]);
    return items[1];
  }) as any);
  const bDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(join(dir, "B.md")) as any);
  vscode.window.activeTextEditor = { document: bDocument, selection: { active: new vscode.Position(0, 0) } } as any;
  const status = vi.spyOn(vscode.window, "setStatusBarMessage");
  const errors = vi.spyOn(vscode.window, "showErrorMessage");
  const reindex = lifeloop.reindex.bind(lifeloop);
  let calls = 0;
  vi.spyOn(lifeloop, "reindex").mockImplementation(async (...args: any[]) => {
    if (++calls === 2) throw new Error("refresh failed");
    return reindex(...args);
  });
  try {
    await handlers.get("lifeloop.quickReschedule")!({
      handle: { ref: "A@0", expectedText: a, expectedState: " " },
    });
    expect(lifeloop.vault.read("A.md")).toBe(
      `* [ ] A [deadline: "2026-09-20"] [event: "E1"] [scheduled: "${shift(day(), 1)}"]\n`,
    );
    expect(lifeloop.vault.read("B.md")).toBe(`${b}\n`);
    expect(status).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("saved locally, but views did not refresh"));
    expect(picked).toHaveBeenCalledTimes(1);
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Find Task searches status, source and context, then opens actions for the exact result", async () => {
  const same = "* [ ] same";
  const { lifeloop, dir } = await workspaceWith({
    "A.md": `${same}\n`,
    "B.md": `${same} [[People/Bob]] #waiting\n`,
    "People/Bob.md": "---\ntags: person\n---\n",
  });
  const handlers = registered(lifeloop);
  const shown = vi.spyOn(vscode.window, "showTextDocument")
    .mockResolvedValue({ revealRange: vi.fn() } as any);
  let opens = 0;
  vi.spyOn(vscode.window, "createQuickPick").mockImplementation((() => findPicker((picker) => {
    expect(picker.placeholder).toMatch(/^Find task/);
    expect(picker).toMatchObject({ matchOnDescription: true, matchOnDetail: true });
    expect(picker.items.map((item: any) => item.description)).toEqual([
      "change task scope", "actionable · A", "waiting · B",
    ]);
    expect(picker.items[2].detail).toContain("People/Bob");
    if (opens++ === 0) picker.value = "waiting";
    else {
      expect(picker.value).toBe("waiting");
      expect(picker.activeItems[0]?.description).toBe("waiting · B");
    }
    return picker.items[2];
  })) as any);
  vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any) =>
    (await items).find((item: any) => item.id === "source")) as any);
  try {
    await handlers.get("lifeloop.findTask")!();
    await handlers.get("lifeloop.returnToLastFind")!();
    expect(shown).toHaveBeenCalledTimes(2);
    expect((shown.mock.calls as any)[0][0].uri.fsPath).toBe(join(dir, "B.md"));
    expect(opens).toBe(2);
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Find Task changes scope in place without losing the typed query", async () => {
  const { lifeloop, dir } = await workspaceWith({
    "Work.md": "* [ ] open\n* [x] finished [completed: \"2026-09-12\"]\n",
  });
  const handlers = registered(lifeloop);
  const accepted: Function[] = [];
  const picker: any = {
    items: [], value: "finish", activeItems: [], selectedItems: [],
    onDidAccept: (handler: Function) => { accepted.push(handler); return { dispose() {} }; },
    onDidHide: () => ({ dispose() {} }), dispose: vi.fn(),
    show() {
      this.selectedItems = [this.items[0]];
      accepted[0]();
      expect(this.value).toBe("finish");
      expect(this.items[0].label).toContain("Completed");
      expect(this.items.slice(1).map((item: any) => item.label)).toEqual(["finished"]);
      this.selectedItems = [this.items[1]];
      accepted[0]();
    },
  };
  vi.spyOn(vscode.window, "createQuickPick").mockImplementation((() => picker) as any);
  vi.spyOn(vscode.window, "showQuickPick").mockResolvedValue(undefined);
  try {
    await handlers.get("lifeloop.findTask")!();
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Find Task previews the latest active result without turning preview into authority", async () => {
  const { lifeloop, dir } = await workspaceWith({
    "A.md": "* [ ] A\n", "B.md": "* [ ] B\n",
  });
  const handlers = registered(lifeloop);
  const accepted: Function[] = [];
  const hidden: Function[] = [];
  const active: Function[] = [];
  const buttons: Function[] = [];
  let opens = 0;
  const picker: any = {
    items: [], value: "", activeItems: [], selectedItems: [], buttons: [], title: "",
    placeholder: "", matchOnDescription: false, matchOnDetail: false,
    onDidAccept(handler: Function) { accepted.push(handler); return { dispose() {} }; },
    onDidHide(handler: Function) { hidden.push(handler); return { dispose() {} }; },
    onDidChangeActive(handler: Function) { active.push(handler); return { dispose() {} }; },
    onDidTriggerButton(handler: Function) { buttons.push(handler); return { dispose() {} }; },
    dispose: vi.fn(),
    show() {
      const a = this.items.find((item: any) => item.description === "actionable · A");
      const b = this.items.find((item: any) => item.description === "actionable · B");
      if (opens++ > 0) {
        expect(this.value).toBe("needle");
        expect(this.activeItems[0]).toMatchObject({ description: "actionable · B" });
        setTimeout(() => hidden.at(-1)!(), 0);
        return;
      }
      this.value = "needle";
      this.activeItems = [a];
      buttons[0]();
      this.activeItems = [b];
      active[0]([b]);
      setTimeout(() => hidden.at(-1)!(), 0);
    },
  };
  vi.spyOn(vscode.window, "createQuickPick").mockImplementation((() => picker) as any);
  const shown = vi.spyOn(vscode.window, "showTextDocument")
    .mockResolvedValue({ revealRange: vi.fn() } as any);
  try {
    await handlers.get("lifeloop.findTask")!();
    expect(picker.title).toBe("Find Task · Previewing selection");
    await handlers.get("lifeloop.returnToLastFind")!();
    expect(opens).toBe(2);
    expect(shown).toHaveBeenCalledTimes(1);
    expect((shown.mock.calls as any)[0][0].uri.fsPath).toBe(join(dir, "B.md"));
    expect((shown.mock.calls as any)[0][1]).toEqual({ preview: true, preserveFocus: true });
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Waiting creates one independent guarded next action", async () => {
  const line = "* [ ] waiting for reply #waiting";
  const { lifeloop, dir } = await workspaceWith({ "Work.md": `${line}\n* [ ] sibling\n` });
  const handlers = registered(lifeloop);
  vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any[]) =>
    items.find((item) => item.id === "create")) as any);
  vi.spyOn(vscode.window, "showInputBox").mockResolvedValue("Send revised form");
  try {
    await handlers.get("lifeloop.waitingNextAction")!(task(lifeloop, line));
    expect(lifeloop.vault.read("Work.md")).toBe(
      `${line}\n  * [ ] Send revised form\n* [ ] sibling\n`,
    );
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Add from Backlog keeps Set Now separate from scheduling", async () => {
  const line = "* [ ] available";
  const { lifeloop, dir } = await workspaceWith({ "Work.md": `${line}\n` });
  const handlers = registered(lifeloop);
  vi.spyOn(vscode.window, "showQuickPick")
    .mockImplementationOnce((async (items: any[]) => items[0]) as any)
    .mockImplementationOnce((async (items: any[]) => items.find((item) => item.id === "now")) as any);
  try {
    await handlers.get("lifeloop.addFromBacklog")!();
    expect(lifeloop.nowTarget()?.name).toBe("available");
    expect(lifeloop.vault.read("Work.md")).toBe(`${line}\n`);
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Capture keeps refused input for edit/retry and uncertain recovery", async () => {
  const { lifeloop, dir } = await workspaceWith({ "Inbox.md": "" });
  const handlers = registered(lifeloop);
  const input = vi.spyOn(vscode.window, "showInputBox")
    .mockImplementationOnce(async () => "   ")
    .mockImplementationOnce(async (options: any) => {
      expect(options.value).toBe("   ");
      return "kept after refusal";
    });
  vi.spyOn(lifeloop, "reindex").mockRejectedValueOnce(new Error("index failed"));
  vi.spyOn(vscode.window, "showWarningMessage")
    .mockResolvedValueOnce("Edit and Retry" as any);
  try {
    await handlers.get("lifeloop.capture")!();
    expect(input).toHaveBeenCalledTimes(2);
    expect(lifeloop.vault.read("Inbox.md")).toBe("* kept after refusal\n");
    const info = vi.spyOn(vscode.window, "showInformationMessage");
    await handlers.get("lifeloop.recoverLastCapture")!();
    expect(info).toHaveBeenCalledWith("LifeLoop: no failed capture in this session");

    const original = lifeloop.vault.writeIfUnchanged.bind(lifeloop.vault);
    vi.spyOn(lifeloop.vault, "writeIfUnchanged").mockRejectedValueOnce(new Error("lost response"))
      .mockImplementation(original);
    vi.mocked(vscode.window.showInputBox).mockReset().mockResolvedValueOnce("uncertain text");
    vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValueOnce("Copy Text" as any);
    await handlers.get("lifeloop.capture")!();
    expect(vscode.env.clipboard.text).toBe("uncertain text");
    expect(lifeloop.vault.read("Inbox.md")).not.toContain("uncertain text");
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Explain Task reports bounded Today reasons from the refreshed task", async () => {
  const line = `* [ ] due [deadline: "${day()}"]`;
  const { lifeloop, dir } = await workspaceWith({ "Work.md": `${line}\n` });
  const handlers = registered(lifeloop);
  vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any[]) =>
    items.find((item) => item.id === "today")) as any);
  const info = vi.spyOn(vscode.window, "showInformationMessage");
  try {
    await handlers.get("lifeloop.explainTask")!(task(lifeloop, line));
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining(`due is in Today: deadline is ${day()}`),
      "Open Source",
    );
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Capture Selection keeps focus and writes a source snapshot into the Inbox", async () => {
  const text = "before\nselected\ntext\nafter\n";
  const { lifeloop, dir } = await workspaceWith({ "Work.md": text });
  const handlers = registered(lifeloop);
  const selection = {
    isEmpty: false,
    start: new vscode.Position(1, 0),
    end: new vscode.Position(3, 0),
  };
  const document = {
    uri: vscode.Uri.file(join(dir, "Work.md")), languageId: "markdown", fileName: join(dir, "Work.md"),
    isDirty: true, isClosed: false,
    getText: (range?: unknown) => range ? "selected\ntext\n" : text,
  };
  vscode.workspace.textDocuments = [document as any];
  vscode.window.activeTextEditor = { document, selection } as any;
  const shown = vi.spyOn(vscode.window, "showTextDocument");
  try {
    await handlers.get("lifeloop.captureSelection")!();
    expect(lifeloop.vault.read("Inbox.md")).toContain(
      "* Captured selection\n  > selected\n  > text\n  Source: [[Work]] · lines 2-3 · unsaved snapshot",
    );
    expect(vscode.window.activeTextEditor?.document).toBe(document);
    expect(shown).not.toHaveBeenCalled();
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Add Progress records one guarded child without completing the task", async () => {
  const line = "* [ ] parent";
  const { lifeloop, dir } = await workspaceWith({
    "Work.md": `${line}\n  * [ ] child\n`,
  });
  const handlers = registered(lifeloop);
  vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any[]) =>
    items.find((item) => item.id === "progress")) as any);
  vi.spyOn(vscode.window, "showInputBox").mockResolvedValue("tested the parser" as any);
  try {
    await handlers.get("lifeloop.addTaskNote")!(task(lifeloop, line));
    expect(lifeloop.vault.read("Work.md")).toBe(
      `${line}\n  * [ ] child\n  * Progress: tested the parser\n`,
    );
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Now uses the explicit task, returns while valid, and refuses source drift", async () => {
  const a = "* [ ] task A";
  const b = "* [ ] task B";
  const { lifeloop, dir } = await workspaceWith({ "A.md": `${a}\n`, "B.md": `${b}\n` });
  const handlers = registered(lifeloop);
  const bDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(join(dir, "B.md")) as any);
  vscode.window.activeTextEditor = { document: bDocument, selection: { active: new vscode.Position(0, 0) } } as any;
  const shown = vi.spyOn(vscode.window, "showTextDocument").mockResolvedValue({ revealRange: vi.fn() } as any);
  const warning = vi.spyOn(vscode.window, "showWarningMessage");
  try {
    await handlers.get("lifeloop.setNow")!({
      handle: { ref: "A@0", expectedText: a, expectedState: " " },
    });
    expect(lifeloop.nowTarget()).toMatchObject({ page: "A", name: "task A" });
    await handlers.get("lifeloop.returnToNow")!();
    expect((shown.mock.calls as any)[0][0].uri.fsPath).toBe(join(dir, "A.md"));

    await lifeloop.vault.write("A.md", "* [ ] changed\n");
    await handlers.get("lifeloop.returnToNow")!();
    expect(shown).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      "LifeLoop: the Now task changed or moved; choose it again", "Find Task", "Clear Now",
    );

    await handlers.get("lifeloop.clearNow")!();
    expect(lifeloop.nowTarget()).toBeUndefined();
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Inbox processing skips within one pass, edits the next item, and resumes from pending content", async () => {
  const { lifeloop, dir } = await workspaceWith({
    "Inbox.md": "* first\n* second\n* third\n",
  });
  const handlers = registered(lifeloop);
  const revealRange = vi.fn();
  const shown = vi.spyOn(vscode.window, "showTextDocument")
    .mockResolvedValue({ revealRange } as any);
  const choices = ["skip", "archive", "edit"];
  vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any[]) => {
    const id = choices.shift();
    return items.find((item) => item.id === id);
  }) as any);
  try {
    await handlers.get("lifeloop.processInbox")!();
    expect(pending(lifeloop.vault.read("Inbox.md")).map((item) => item.text)).toEqual([
      "* first", "* third",
    ]);
    expect(lifeloop.vault.read("Inbox.md")).toContain("## Processed\n\n* second");
    expect(shown).toHaveBeenCalledTimes(1);
    expect(revealRange).toHaveBeenCalledTimes(1);

    vi.mocked(vscode.window.showQuickPick).mockImplementation((async (items: any[]) =>
      items.find((item) => item.id === "archive")) as any);
    await handlers.get("lifeloop.processInbox")!();
    expect(pending(lifeloop.vault.read("Inbox.md"))).toEqual([]);
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Inbox right-click (a view Node, not a plain InboxItem) resolves and processes the chosen item", async () => {
  const { lifeloop, dir } = await workspaceWith({
    "Inbox.md": "* first\n* second\n* third\n",
  });
  const handlers = registered(lifeloop);
  vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any[]) =>
    items.find((item) => item.id === "archive")) as any);
  try {
    const nodes = new InboxView(lifeloop).getChildren();
    const second = nodes.find((n) => n.label === "second")!;
    await handlers.get("lifeloop.processInbox")!(second);
    expect(pending(lifeloop.vault.read("Inbox.md")).map((item) => item.text)).toEqual([
      "* first", "* third",
    ]);
    expect(lifeloop.vault.read("Inbox.md")).toContain("## Processed\n\n* second");
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

describe("task-originated Log Interaction", () => {
  const line = '* [ ] Meet [[People/Alice]] and [[People/Bob]] [event: "E1"]';
  const files = () => ({
    "People/Alice.md": "---\ntags: person\n---\n",
    "People/Bob.md": "---\ntags: person\n---\n",
    "Work.md": `${line}\n`,
  });

  for (const boundary of ["action", "people", "kind", "note"] as const) {
    test(`revalidates after the ${boundary} prompt boundary`, async () => {
      const { lifeloop, dir } = await workspaceWith(files());
      try {
        const source = task(lifeloop, line);
        const mutate = async () => {
          if (boundary === "kind") {
            await lifeloop.vault.write("People/Alice.md", "# no longer a Person\n");
          } else {
            const changed = boundary === "people"
              ? line.replace(" and [[People/Bob]]", "")
              : boundary === "note"
                ? line.replace('event: "E1"', 'event: "E2"')
                : line.replace("Meet", "Changed");
            await lifeloop.vault.write("Work.md", `${changed}\n`);
          }
        };
        if (boundary === "action") await mutate();
        vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any, options: any) => {
          if (options.placeHolder === "Who was involved?") {
            if (boundary === "people") await mutate();
            return items;
          }
          if (boundary === "kind") await mutate();
          return items.find((item: any) => item.id === "meeting");
        }) as any);
        vi.spyOn(vscode.window, "showInputBox").mockImplementation((async () => {
          if (boundary === "note") await mutate();
          return "notes";
        }) as any);

        await recordInteraction(
          lifeloop, ["People/Alice", "People/Bob"], "meeting", source, "E1",
        );
        expect(lifeloop.vault.exists(`Journal/${day()}.md`)).toBe(false);
      } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
    });
  }

  test("guards the task and every selected Person in the Journal append", async () => {
    const { lifeloop, dir } = await workspaceWith(files());
    try {
      const source = task(lifeloop, line);
      vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any, options: any) =>
        options.placeHolder === "Who was involved?"
          ? items
          : items.find((item: any) => item.id === "meeting")) as any);
      vi.spyOn(vscode.window, "showInputBox").mockResolvedValue("notes" as any);

      await recordInteraction(
        lifeloop, ["People/Alice", "People/Bob"], "meeting", source, "E1",
      );
      expect(lifeloop.vault.read(`Journal/${day()}.md`)).toContain(
        "* notes [[People/Alice]] and [[People/Bob]] [interaction: meeting]",
      );
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("keeps the exact source admitted by the final Log check", async () => {
    const { lifeloop, dir } = await workspaceWith(files());
    try {
      const source = task(lifeloop, line);
      vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any, options: any) =>
        options.placeHolder === "Who was involved?"
          ? items
          : items.find((item: any) => item.id === "meeting")) as any);
      let afterNote = false;
      vi.spyOn(vscode.window, "showInputBox").mockImplementation((async () => {
        afterNote = true;
        return "notes";
      }) as any);
      const read = lifeloop.vault.read.bind(lifeloop.vault);
      let finalReads = 0;
      let changed = false;
      vi.spyOn(lifeloop.vault, "read").mockImplementation((path) => {
        const text = read(path);
        if (afterNote && path === "Work.md" && ++finalReads === 4) {
          writeFileSync(join(dir, path), `${line.replace("Meet", "Changed without a Person").replace(" [[People/Alice]] and [[People/Bob]]", "")}\n`);
          changed = true;
        }
        return text;
      });

      await recordInteraction(lifeloop, ["People/Alice", "People/Bob"], "meeting", source, "E1");
      expect(changed).toBe(true);
      expect(readFileSync(join(dir, "Work.md"), "utf8")).toContain("Changed without a Person");
      expect(lifeloop.vault.exists(`Journal/${day()}.md`)).toBe(false);
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  for (const boundary of ["task identity", "task text", "direct People", "Person tag", "default event"] as const) {
    test(`registered Log commands preserve an existing Journal after ${boundary} drift`, async () => {
      const date = day();
      const journal = `Journal/${date}.md`;
      const journalBefore = "# existing journal\n\nkept\n";
      const prefix = "prefixxxxx\n";
      const { lifeloop, dir } = await workspaceWith({ ...files(), "Work.md": `${prefix}${line}\n`, [journal]: journalBefore });
      const handlers = registered(lifeloop);
      const save = vi.fn(async () => true);
      const journalDocument = {
        uri: vscode.Uri.file(join(dir, journal)), languageId: "markdown",
        isDirty: false, isClosed: false, getText: () => journalBefore, save,
      };
      vscode.workspace.textDocuments = [journalDocument];
      const status = vi.spyOn(vscode.window, "setStatusBarMessage");
      const edit = vi.spyOn(vscode.workspace, "applyEdit");
      let changed = false;
      const mutate = async () => {
        if (changed) return;
        changed = true;
        if (boundary === "task identity") await lifeloop.vault.write("Work.md", `prefix\n${line}\n`);
        if (boundary === "task text") await lifeloop.vault.write("Work.md", `${prefix}${line.replace("Meet", "Changed")}\n`);
        if (boundary === "direct People") await lifeloop.vault.write("Work.md", `${prefix}${line.replace(" and [[People/Bob]]", "")}\n`);
        if (boundary === "Person tag") await lifeloop.vault.write("People/Alice.md", "# no longer a Person\n");
        if (boundary === "default event") await lifeloop.vault.write("Work.md", `${prefix}${line.replace('event: "E1"', 'event: "E2"')}\n`);
      };
      vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any, options: any) => {
        const resolved: any[] = await items;
        if (options?.canPickMany) {
          if (boundary === "task text" || boundary === "direct People") await mutate();
          return resolved;
        }
        if (options?.placeHolder === "Interaction type") {
          if (boundary === "Person tag") await mutate();
          return resolved.find((item) => item.id === "meeting");
        }
        if (boundary === "task identity") await mutate();
        return resolved.find((item) => item.id === "interaction");
      }) as any);
      vi.spyOn(vscode.window, "showInputBox").mockImplementation((async () => {
        if (boundary === "default event") await mutate();
        return "notes";
      }) as any);

      try {
        const input = { handle: { ref: `Work@${prefix.length}`, expectedText: line, expectedState: " " } };
        await handlers.get(boundary === "task identity" ? "lifeloop.taskActions" : "lifeloop.logInteraction")!(input);
        expect(readFileSync(join(dir, journal), "utf8")).toBe(journalBefore);
        expect(journalDocument.getText()).toBe(journalBefore);
        expect(journalDocument.isDirty).toBe(false);
        expect(save).not.toHaveBeenCalled();
        expect(edit).not.toHaveBeenCalled();
        expect(status).not.toHaveBeenCalled();
      } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
    });
  }

  test("registered Person-page logging preserves the Journal when Person identity changes", async () => {
    const date = day();
    const journal = `Journal/${date}.md`;
    const journalBefore = "# existing journal\n";
    const { lifeloop, dir } = await workspaceWith({
      "People/Alice.md": "---\ntags: person\n---\n",
      [journal]: journalBefore,
    });
    const handlers = registered(lifeloop);
    const save = vi.fn(async () => true);
    const journalDocument = {
      uri: vscode.Uri.file(join(dir, journal)), languageId: "markdown",
      isDirty: false, isClosed: false, getText: () => journalBefore, save,
    };
    vscode.workspace.textDocuments = [journalDocument];
    vscode.window.activeTextEditor = { document: {
      uri: vscode.Uri.file(join(dir, "People/Alice.md")), languageId: "markdown",
    } } as any;
    const status = vi.spyOn(vscode.window, "setStatusBarMessage");
    const edit = vi.spyOn(vscode.workspace, "applyEdit");
    vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any[]) => {
      await lifeloop.vault.write("People/Alice.md", "# no longer a Person\n");
      return items.find((item) => item.id === "call");
    }) as any);

    try {
      await handlers.get("lifeloop.logInteraction")!();
      expect(readFileSync(join(dir, journal), "utf8")).toBe(journalBefore);
      expect(journalDocument.getText()).toBe(journalBefore);
      expect(journalDocument.isDirty).toBe(false);
      expect(save).not.toHaveBeenCalled();
      expect(edit).not.toHaveBeenCalled();
      expect(status).not.toHaveBeenCalled();
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });
});

test("Meeting Wrap-up runs only the selected guarded steps for an exact event task", async () => {
  const line = '* [ ] Meet [[People/Alice]] [event: "E1"]';
  const { lifeloop, dir } = await workspaceWith({
    "People/Alice.md": "---\ntags: person\n---\n",
    "Work.md": `${line}\n`,
  });
  const handlers = registered(lifeloop);
  vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any[], options: any) => {
    if (options?.canPickMany) return items;
    if (options?.placeHolder === "Interaction type") return items.find((item) => item.id === "meeting");
    return undefined;
  }) as any);
  vi.spyOn(vscode.window, "showInputBox").mockImplementation((async (options: any) =>
    options.prompt.startsWith("What happened") ? "Discussed" : "Send notes") as any);
  try {
    await handlers.get("lifeloop.meetingWrapUp")!({
      handle: { ref: "Work@0", expectedText: line, expectedState: " " },
    });
    expect(lifeloop.vault.read(`Journal/${day()}.md`)).toContain(
      "* Discussed [[People/Alice]] [interaction: meeting]",
    );
    expect(lifeloop.vault.read("Work.md")).toContain("* [x] Meet [[People/Alice]]");
    expect(lifeloop.vault.read("Work.md")).toContain("  * [ ] Send notes");
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Log Interaction refuses a dirty Journal without saving it", async () => {
  const date = day();
  const journal = `Journal/${date}.md`;
  const before = "# unsaved journal\n";
  const { lifeloop, dir } = await workspaceWith({
    "People/Alice.md": "---\ntags: person\n---\n",
    [journal]: before,
  });
  const save = vi.fn(async () => true);
  const document = {
    uri: vscode.Uri.file(join(dir, journal)), languageId: "markdown",
    isDirty: true, isClosed: false, getText: () => before, save,
  };
  vscode.workspace.textDocuments = [document];
  try {
    const status = vi.spyOn(vscode.window, "setStatusBarMessage");
    vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any) => items[0]) as any);
    vi.spyOn(vscode.window, "showInputBox").mockResolvedValue("notes" as any);
    await recordInteraction(lifeloop, ["People/Alice"]);
    expect(save).not.toHaveBeenCalled();
    expect(document.getText()).toBe(before);
    expect(document.isDirty).toBe(true);
    expect(readFileSync(join(dir, journal), "utf8")).toBe(before);
    expect(status).not.toHaveBeenCalled();
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

for (const field of ["Deadline", "Scheduled"] as const) {
  test(`${field} re-admits its task after the prompt`, async () => {
    const initial = "prefixxxxx\n* [ ] unchanged\n";
    const moved = "prefix\n* [ ] unchanged\n";
    const { lifeloop, dir } = await workspaceWith({ "Work.md": initial });
    const handlers = registered(lifeloop);
    const status = vi.spyOn(vscode.window, "setStatusBarMessage");
    try {
      vi.spyOn(vscode.window, "showInputBox").mockImplementation((async () => {
        writeFileSync(join(dir, "Work.md"), moved);
        return "2026-09-10";
      }) as any);
      await handlers.get(`lifeloop.set${field}`)!({
        handle: { ref: "Work@11", expectedText: "* [ ] unchanged", expectedState: " " },
      });
      expect(readFileSync(join(dir, "Work.md"), "utf8")).toBe(moved);
      expect(status).not.toHaveBeenCalled();
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });
}

test("Deadline keeps exact numeric identity after refresh returns", async () => {
  const line = "* [ ] unchanged";
  const initial = `prefixxxxx\n${line}\n`;
  const moved = `prefix\n${line}\n`;
  const { lifeloop, dir } = await workspaceWith({ "Work.md": initial });
  const handlers = registered(lifeloop);
  vi.spyOn(vscode.window, "showInputBox").mockResolvedValue("2026-09-10" as any);
  const read = lifeloop.vault.read.bind(lifeloop.vault);
  let taskReads = 0;
  vi.spyOn(lifeloop.vault, "read").mockImplementation((path) => {
    const text = read(path);
    if (path === "Work.md" && ++taskReads === 4) {
      queueMicrotask(() => writeFileSync(join(dir, path), moved));
    }
    return text;
  });
  try {
    await handlers.get("lifeloop.setDeadline")!({
      handle: { ref: "Work@11", expectedText: line, expectedState: " " },
    });
    expect(readFileSync(join(dir, "Work.md"), "utf8")).toBe(moved);
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

for (const [command, state] of [["completeTask", " "], ["reopenTask", "x"]] as const) {
  test(`${command} awaits refresh and re-admits the retained task`, async () => {
    const line = `* [${state}] unchanged`;
    const initial = `prefixxxxx\n${line}\n`;
    const moved = `prefix\n${line}\n`;
    const { lifeloop, dir } = await workspaceWith({ "Work.md": initial });
    const handlers = registered(lifeloop);
    const currentTaskStates = lifeloop.currentTaskStates.bind(lifeloop);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(lifeloop, "currentTaskStates").mockImplementation(async () => {
      enter();
      await barrier;
      return currentTaskStates();
    });
    const status = vi.spyOn(vscode.window, "setStatusBarMessage");
    try {
      const run = handlers.get(`lifeloop.${command}`)!({
        handle: { ref: "Work@11", expectedText: line, expectedState: state },
      });
      await entered;
      expect(readFileSync(join(dir, "Work.md"), "utf8")).toBe(initial);
      writeFileSync(join(dir, "Work.md"), moved);
      release();
      await run;
      expect(readFileSync(join(dir, "Work.md"), "utf8")).toBe(moved);
      expect(status).not.toHaveBeenCalled();
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });
}

test("Attach Page re-admits its task after the prompt", async () => {
  const line = "* [ ] unchanged";
  const initial = `prefixxxxx\n${line}\n`;
  const moved = `prefix\n${line}\n`;
  const { lifeloop, dir } = await workspaceWith({ "Work.md": initial });
  const handlers = registered(lifeloop);
  vscode.window.activeTextEditor = {
    document: {
      uri: vscode.Uri.file(join(dir, "Work.md")), languageId: "markdown",
      getText: () => initial,
      lineAt: () => ({ text: line, range: { start: new vscode.Position(1, 0) } }),
      offsetAt: () => "prefixxxxx\n".length,
    },
    selection: { active: new vscode.Position(1, 0) },
  } as any;
  const status = vi.spyOn(vscode.window, "setStatusBarMessage");
  const show = vi.spyOn(vscode.window, "showTextDocument");
  try {
    vi.spyOn(vscode.window, "showInputBox").mockImplementation((async () => {
      writeFileSync(join(dir, "Work.md"), moved);
      return "Notes/Attached";
    }) as any);
    await handlers.get("lifeloop.attachPage")!();
    expect(readFileSync(join(dir, "Work.md"), "utf8")).toBe(moved);
    expect(lifeloop.vault.exists("Notes/Attached.md")).toBe(false);
    expect(status).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Project Actions acts on the explicit project, not the active editor", async () => {
  const project = "---\ntags: project\nstatus: active\n---\n# A\n";
  const { lifeloop, dir } = await workspaceWith({ "A.md": project, "B.md": "# B\n" });
  const handlers = registered(lifeloop);
  const b = await vscode.workspace.openTextDocument(vscode.Uri.file(join(dir, "B.md")) as any);
  vscode.window.activeTextEditor = { document: b, selection: { active: new vscode.Position(0, 0) } } as any;
  vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any[]) =>
    items.find((item) => item.id === "add")) as any);
  vi.spyOn(vscode.window, "showInputBox").mockResolvedValue("Ship A" as any);
  try {
    await handlers.get("lifeloop.projectActions")!({ page: "A" });
    expect(lifeloop.vault.read("A.md")).toBe(`${project}* [ ] Ship A\n`);
    expect(lifeloop.vault.read("B.md")).toBe("# B\n");
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Project Actions previews related context and refuses a stale add", async () => {
  const project = "---\ntags: project\n---\n# P\n";
  const { lifeloop, dir } = await workspaceWith({ "P.md": project });
  const handlers = registered(lifeloop);
  const document = await vscode.workspace.openTextDocument(lifeloop.pageUri("P") as any);
  const execute = (vscode.commands as any).executeCommand;
  vi.spyOn(vscode.window, "showQuickPick")
    .mockImplementationOnce((async (items: any[]) => items.find((item) => item.id === "preview")) as any)
    .mockImplementationOnce((async (items: any[]) => items.find((item) => item.id === "add")) as any);
  vi.spyOn(vscode.window, "showInputBox").mockImplementation((async () => {
    document.__replace(`${project}changed\n`);
    return "Too late";
  }) as any);
  const status = vi.spyOn(vscode.window, "setStatusBarMessage");
  try {
    await handlers.get("lifeloop.projectActions")!({ page: "P" });
    expect(execute).toHaveBeenCalledWith(
      "lifeloop.openReadonlyResult",
      expect.stringMatching(/Open tasks on this project page[\s\S]*Related open tasks from other pages/),
      "project-resumption",
    );
    await handlers.get("lifeloop.projectActions")!({ page: "P" });
    expect(lifeloop.vault.read("P.md")).toBe(`${project}changed\n`);
    expect(readFileSync(join(dir, "P.md"), "utf8")).toBe(project);
    expect(status).not.toHaveBeenCalled();
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Project Actions reports when a new task still inherits a parked state", async () => {
  const project = "---\ntags: [project, waiting]\n---\n# P\n";
  const { lifeloop, dir } = await workspaceWith({ "P.md": project });
  const handlers = registered(lifeloop);
  vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any[]) =>
    items.find((item) => item.id === "add")) as any);
  vi.spyOn(vscode.window, "showInputBox").mockResolvedValue("Follow up" as any);
  const warning = vi.spyOn(vscode.window, "showWarningMessage");
  try {
    await handlers.get("lifeloop.projectActions")!({ page: "P" });
    expect(lifeloop.vault.read("P.md")).toBe(`${project}* [ ] Follow up\n`);
    expect(warning).toHaveBeenCalledWith(
      "LifeLoop: added the task, but it still inherits #waiting from P",
    );
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("removing a direct parked tag explains when the task still inherits it", async () => {
  const line = "  * [ ] child #waiting";
  const source = `* Parent #waiting\n${line}\n`;
  const { lifeloop, dir } = await workspaceWith({ "Work.md": source });
  const handlers = registered(lifeloop);
  const warning = vi.spyOn(vscode.window, "showWarningMessage");
  const status = vi.spyOn(vscode.window, "setStatusBarMessage");
  try {
    await handlers.get("lifeloop.toggleWaiting")!({
      handle: {
        ref: `Work@${source.indexOf(line)}`,
        expectedText: line,
        expectedState: " ",
      },
    });
    expect(lifeloop.vault.read("Work.md")).toBe("* Parent #waiting\n  * [ ] child\n");
    expect(status).toHaveBeenCalledWith("LifeLoop: removed direct #waiting", 3000);
    expect(warning).toHaveBeenCalledWith(
      "LifeLoop: removed direct #waiting, but this task still inherits #waiting",
    );
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Project Resumption Brief is read-only and separates project-page membership from related context", async () => {
  const project = "---\ntags: project\nstatus: paused\n---\n* [ ] on page\n";
  const related = "* [ ] related [[Projects/P]]\n";
  const { lifeloop, dir } = await workspaceWith({
    "Projects/P.md": project,
    "Work.md": related,
  });
  const handlers = registered(lifeloop);
  const execute = (vscode.commands as any).executeCommand;
  try {
    await handlers.get("lifeloop.projectResumptionBrief")!({ page: "Projects/P" });
    expect(execute).toHaveBeenCalledWith(
      "lifeloop.openReadonlyResult",
      expect.stringMatching(/Open tasks on this project page[\s\S]*on page[\s\S]*Related open tasks from other pages[\s\S]*related/),
      "project-resumption",
    );
    expect(lifeloop.vault.read("Projects/P.md")).toBe(project);
    expect(lifeloop.vault.read("Work.md")).toBe(related);
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("closing a project shows narrow facts and leaves tasks and bindings unchanged", async () => {
  const project = "---\ntags: project\nstatus: active\n---\n* [ ] waiting #waiting [reminder: \"R1\"]\n";
  const related = "* [ ] related [[Projects/P]] [event: \"E1\"]\n";
  const { lifeloop, dir } = await workspaceWith({
    "Projects/P.md": project,
    "Work.md": related,
  });
  const handlers = registered(lifeloop);
  let picks = 0;
  vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any[]) => {
    if (picks++ === 0) return "completed";
    expect(items[0]).toMatchObject({
      id: "confirm",
      description: "leave tasks and external objects unchanged",
    });
    expect(items[0].detail).toBe("1 open on this page · 1 related elsewhere · 1 waiting · 2 with known bindings");
    return items[0];
  }) as any);
  try {
    await handlers.get("lifeloop.setProjectStatus")!({ page: "Projects/P" });
    expect(lifeloop.vault.read("Projects/P.md")).toContain("status: completed");
    expect(lifeloop.vault.read("Projects/P.md")).toContain('* [ ] waiting #waiting [reminder: "R1"]');
    expect(lifeloop.vault.read("Work.md")).toBe(related);
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Add Related Link shows typed full paths and links the explicit task only", async () => {
  const a = "* [ ] Task A [[People/Alice]]";
  const b = "* [ ] Task B";
  const { lifeloop, dir } = await workspaceWith({
    "A.md": `${a}\n`, "B.md": `${b}\n`,
    "People/Alice.md": "---\ntags: person\n---\n",
    "Projects/Launch.md": "---\ntags: project\n---\n",
    "Notes/Reference.md": "# Reference\n",
  });
  const handlers = registered(lifeloop);
  const bDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(join(dir, "B.md")) as any);
  vscode.window.activeTextEditor = { document: bDocument, selection: { active: new vscode.Position(0, 0) } } as any;
  vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any[], options: any) => {
    expect(options.placeHolder).toContain("does not change project ownership");
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Launch", description: "Project", detail: "Projects/Launch" }),
      expect.objectContaining({ label: "Reference", description: "Note", detail: "Notes/Reference" }),
    ]));
    expect(items.some((item) => item.detail === "People/Alice")).toBe(false);
    return items.find((item) => item.detail === "Projects/Launch");
  }) as any);
  const info = vi.spyOn(vscode.window, "showInformationMessage");
  try {
    await handlers.get("lifeloop.addRelatedLink")!({
      handle: { ref: "A@0", expectedText: a, expectedState: " " },
    });
    expect(lifeloop.vault.read("A.md")).toBe(`${a} [[Projects/Launch]]\n`);
    expect(lifeloop.vault.read("B.md")).toBe(`${b}\n`);
    expect(info).toHaveBeenCalledWith(
      "LifeLoop: related link added. Project gap still counts only tasks written on the project page.",
    );
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Task Actions opens a directly related page for the explicit task", async () => {
  const a = "* [ ] Prepare [[People/Alice]] [[Notes/Application Packet]] [[Projects/Search]]";
  const b = "* [ ] Background task [[Notes/Other]]";
  const { lifeloop, dir } = await workspaceWith({
    "A.md": `${a}\n`, "B.md": `${b}\n`,
    "People/Alice.md": "---\ntags: person\n---\n",
    "Notes/Application Packet.md": "# Application Packet\n",
    "Notes/Other.md": "# Other\n",
    "Projects/Search.md": "---\ntags: project\n---\n",
  });
  const handlers = registered(lifeloop);
  const bDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(join(dir, "B.md")) as any);
  vscode.window.activeTextEditor = {
    document: bDocument,
    selection: { active: new vscode.Position(0, 0) },
  } as any;
  vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any, options: any) => {
    const resolved: any[] = await items;
    if (options.placeHolder === "Open a directly related page") {
      expect(resolved).toEqual([
        expect.objectContaining({ description: "Note", detail: "Notes/Application Packet" }),
        expect.objectContaining({ description: "Person", detail: "People/Alice" }),
      ]);
      expect(resolved.some((item) => item.detail === "Projects/Search")).toBe(false);
      expect(resolved.some((item) => item.detail === "Notes/Other")).toBe(false);
      return resolved[0];
    }
    const action = resolved.find((item) => item.id === "open-related");
    expect(action).toMatchObject({
      label: "$(link-external) Open Related Page",
      description: "2 pages",
    });
    return action;
  }) as any);
  const shown = vi.spyOn(vscode.window, "showTextDocument").mockResolvedValue({} as any);
  try {
    await handlers.get("lifeloop.taskActions")!({
      handle: { ref: "A@0", expectedText: a, expectedState: " " },
    });
    expect((shown.mock.calls as any)[0][0].uri.fsPath).toBe(join(dir, "Notes/Application Packet.md"));
    expect(vscode.window.activeTextEditor?.document).toBe(bDocument);
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Task Actions opens before task-state refresh and leaves validation to the selected command", async () => {
  const line = "* [ ] Prepare [[Notes/Reference]]";
  const { lifeloop, dir } = await workspaceWith({
    "Work.md": `${line}\n`,
    "Notes/Reference.md": "# Reference\n",
  });
  const handlers = registered(lifeloop);
  const states = vi.spyOn(lifeloop, "currentTaskStates");
  const picker = vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any) => {
    expect(states).not.toHaveBeenCalled();
    expect((await items).some((item: any) => item.id === "open-related")).toBe(true);
    return undefined;
  }) as any);
  try {
    await handlers.get("lifeloop.taskActions")!({
      handle: { ref: "Work@0", expectedText: line, expectedState: " " },
    });
    expect(picker).toHaveBeenCalledOnce();
    expect(states).not.toHaveBeenCalled();
  } finally {
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Review in Place keeps one picker, scope, query and selection across a project action", async () => {
  const project = "---\ntags: project\n---\n# P\n";
  const { lifeloop, dir } = await workspaceWith({
    "P.md": project,
    "Q.md": "---\ntags: project\n---\n# Q\n",
    "Work.md": "* [ ] open\n* [ ] waiting #waiting\n* [ ] later #someday\n",
  });
  const handlers = registered(lifeloop);
  const accepted: Function[] = [];
  const hidden: Function[] = [];
  let shows = 0;
  const picker: any = {
    items: [], value: "", activeItems: [], selectedItems: [], busy: false,
    placeholder: "", matchOnDescription: false, matchOnDetail: false,
    onDidAccept(handler: Function) { accepted.push(handler); return { dispose() {} }; },
    onDidHide(handler: Function) { hidden.push(handler); return { dispose() {} }; },
    onDidChangeActive() { return { dispose() {} }; },
    onDidTriggerButton() { return { dispose() {} }; },
    dispose: vi.fn(),
    show() {
      shows++;
      if (shows === 1) {
        expect(this.items.filter((item: any) => item.key).map((item: any) => item.label)).toEqual(["open"]);
        this.selectedItems = [this.items[0]];
        accepted[0]();
      } else if (shows === 2) {
        expect(this.items.slice(1).map((item: any) => item.description)).toEqual(["P", "Q"]);
        this.value = "P";
        this.selectedItems = [this.items.find((item: any) => item.description === "P")];
        accepted[0]();
      } else {
        expect(this.value).toBe("P");
        expect(this.activeItems[0]).toMatchObject({ key: "project:P", description: "P" });
        expect(lifeloop.vault.read("P.md")).toBe(`${project}* [ ] Next\n`);
        hidden[0]();
      }
    },
  };
  vi.spyOn(vscode.window, "createQuickPick").mockImplementation((() => picker) as any);
  vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any[], options: any) => {
    if (options.placeHolder === "Review scope") {
      for (const hide of [...hidden]) hide();
      return items.find((item) => item.scope === "projects");
    }
    setTimeout(() => { for (const hide of [...hidden]) hide(); }, 0);
    return items.find((item) => item.id === "add");
  }) as any);
  vi.spyOn(vscode.window, "showInputBox").mockResolvedValue("Next" as any);
  try {
    await handlers.get("lifeloop.reviewActions")!();
    expect(shows).toBe(3);
    expect(picker.dispose).toHaveBeenCalledOnce();
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Review previews project-page and related work without losing its picker state", async () => {
  const { lifeloop, dir } = await workspaceWith({
    "Projects/P.md": "---\ntags: project\n---\n* [ ] on page\n",
    "Work.md": "* [ ] related [[Projects/P]]\n",
  });
  const handlers = registered(lifeloop);
  const accepted: Function[] = [];
  const hidden: Function[] = [];
  let shows = 0;
  const picker: any = {
    items: [], value: "", activeItems: [], selectedItems: [], busy: false,
    placeholder: "", matchOnDescription: false, matchOnDetail: false,
    onDidAccept(handler: Function) { accepted.push(handler); return { dispose() {} }; },
    onDidHide(handler: Function) { hidden.push(handler); return { dispose() {} }; },
    onDidChangeActive() { return { dispose() {} }; },
    dispose: vi.fn(),
    show() {
      shows++;
      if (shows === 1) {
        this.selectedItems = [this.items[0]];
        accepted[0]();
      } else if (shows === 2) {
        this.value = "P";
        this.selectedItems = [this.items.find((item: any) => item.project === "Projects/P")];
        accepted[0]();
      } else {
        expect(this.value).toBe("P");
        expect(this.activeItems[0]).toMatchObject({
          key: "project:Projects/P", description: "Projects/P",
        });
        hidden[0]();
      }
    },
  };
  vi.spyOn(vscode.window, "createQuickPick").mockImplementation((() => picker) as any);
  vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any[], options: any) => {
    if (options.placeHolder === "Review scope") {
      return items.find((item) => item.scope === "projects");
    }
    return items.find((item) => item.id === "preview");
  }) as any);
  const execute = (vscode.commands as any).executeCommand;
  try {
    await handlers.get("lifeloop.reviewActions")!();
    const call = execute.mock.calls.find((entry: any[]) => entry[0] === "lifeloop.openReadonlyResult");
    expect(call?.[1]).toMatch(/Open tasks on this project page[\s\S]*on page/);
    expect(call?.[1]).toMatch(/Related open tasks from other pages[\s\S]*related/);
    expect(call?.[3]).toEqual({ preserveFocus: true });
    expect(shows).toBe(3);
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Next Week Focus creates one ordinary note and preserves an existing one", async () => {
  const { lifeloop, dir } = await workspaceWith({});
  const handlers = registered(lifeloop);
  const nextStart = week(shift(day(), 7)).start;
  vi.spyOn(vscode.window, "showTextDocument").mockResolvedValue({} as any);
  try {
    await handlers.get("lifeloop.openNextWeekFocus")!();
    const path = join(dir, "Weekly", `${nextStart}.md`);
    expect(readFileSync(path, "utf8")).toContain("## Focus");
    expect(readFileSync(path, "utf8")).not.toMatch(/^\s*[-*]\s+\[[ x]\]/m);

    lifeloop.vault.write(`Weekly/${nextStart}.md`, "mine\n");
    await handlers.get("lifeloop.openNextWeekFocus")!();
    expect(readFileSync(path, "utf8")).toBe("mine\n");
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

for (const planning of [
  { command: "lifeloop.planToday", date: day(), title: "Plan Today" },
  { command: "lifeloop.closeTodayPlanTomorrow", date: shift(day(), 1), title: "Close Today and Plan Tomorrow" },
] as const) {
  test(`${planning.title} opens the correct weekly focus and returns to the planning position`, async () => {
    const today = day();
    const { lifeloop, dir } = await workspaceWith({
      "Work.md": `* [ ] planned [scheduled: "${today}"]\n`,
    });
    const handlers = registered(lifeloop);
    const accepted: Function[] = [];
    const hidden: Function[] = [];
    let shows = 0;
    const expectedWeek = week(planning.date).start;
    const picker: any = {
      items: [], value: "", activeItems: [], selectedItems: [], busy: false, title: "", placeholder: "",
      onDidAccept(handler: Function) { accepted.push(handler); return { dispose() {} }; },
      onDidHide(handler: Function) { hidden.push(handler); return { dispose() {} }; },
      onDidChangeActive() { return { dispose() {} }; },
      dispose: vi.fn(),
      show() {
        shows++;
        if (shows === 1) {
          expect(this.title).toBe(planning.title);
          const focus = this.items.find((item: any) => item.openWeekFocus);
          expect(focus).toMatchObject({ openWeekFocus: expectedWeek });
          this.value = "planned";
          this.selectedItems = [focus];
          accepted[0]();
        } else {
          expect(this.value).toBe("planned");
          expect(this.activeItems[0]).toMatchObject({ label: "planned" });
          hidden[0]();
        }
      },
    };
    vi.spyOn(vscode.window, "createQuickPick").mockImplementation((() => picker) as any);
    const shown = vi.spyOn(vscode.window, "showTextDocument").mockResolvedValue({} as any);
    try {
      await handlers.get(planning.command)!();
      expect(shows).toBe(2);
      expect(readFileSync(join(dir, "Weekly", `${expectedWeek}.md`), "utf8")).toContain("## Focus");
      expect(shown).toHaveBeenCalledWith(expect.anything(), { preview: true, preserveFocus: true });
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });
}

test("Plan Today shows unfinished earlier plans and schedules a backlog candidate without task check-ins", async () => {
  const today = day();
  const earlier = shift(today, -1);
  const { lifeloop, dir } = await workspaceWith({
    "Work.md": [
      `* [ ] missed [scheduled: "${earlier}"]`,
      "* [ ] candidate",
      "",
    ].join("\n"),
  });
  const handlers = registered(lifeloop);
  const accepted: Function[] = [];
  const hidden: Function[] = [];
  let shows = 0;
  const picker: any = {
    items: [], value: "", activeItems: [], selectedItems: [], busy: false, title: "", placeholder: "",
    onDidAccept(handler: Function) { accepted.push(handler); return { dispose() {} }; },
    onDidHide(handler: Function) { hidden.push(handler); return { dispose() {} }; },
    dispose: vi.fn(),
    show() {
      shows++;
      if (shows === 1) {
        expect(this.title).toBe("Plan Today");
        expect(this.items.map((item: any) => item.label)).toContain("missed");
        expect(this.items.find((item: any) => item.label === "missed")?.detail)
          .toContain(`earlier plan ${earlier} still open`);
        this.selectedItems = [this.items[0]];
        accepted[0]();
      } else if (shows === 2) {
        expect(this.items.map((item: any) => item.label)).toContain("candidate");
        this.selectedItems = [this.items.find((item: any) => item.label === "candidate")];
        accepted[0]();
      } else {
        expect(lifeloop.vault.read("Work.md")).toContain(`[scheduled: "${today}"]`);
        expect(this.items.some((item: any) => item.label === "$(info) Nothing in this scope")).toBe(true);
        hidden[0]();
      }
    },
  };
  vi.spyOn(vscode.window, "createQuickPick").mockImplementation((() => picker) as any);
  vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any[], options: any) => {
    if (options.placeHolder === "Planning scope") {
      return items.find((item) => item.scope === "backlog-today");
    }
    return items.find((item) => item.id === "schedule-day");
  }) as any);
  try {
    await handlers.get("lifeloop.planToday")!();
    expect(shows).toBe(3);
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Close Today and Plan Tomorrow combines factual review with tomorrow planning", async () => {
  const today = day();
  const tomorrow = shift(today, 1);
  const { lifeloop, dir } = await workspaceWith({
    "Work.md": [
      `* [x] finished [completed: "${today}"]`,
      `* [ ] still open [scheduled: "${today}"]`,
      `* [ ] tomorrow task [scheduled: "${tomorrow}"]`,
      "",
    ].join("\n"),
  });
  const handlers = registered(lifeloop);
  const accepted: Function[] = [];
  const hidden: Function[] = [];
  let shows = 0;
  const picker: any = {
    items: [], value: "", activeItems: [], selectedItems: [], busy: false, title: "", placeholder: "",
    onDidAccept(handler: Function) { accepted.push(handler); return { dispose() {} }; },
    onDidHide(handler: Function) { hidden.push(handler); return { dispose() {} }; },
    dispose: vi.fn(),
    show() {
      shows++;
      if (shows === 1) {
        expect(this.title).toBe("Close Today and Plan Tomorrow");
        expect(this.items.map((item: any) => item.label)).toEqual(expect.arrayContaining([
          "finished", "still open",
        ]));
        this.selectedItems = [this.items[0]];
        accepted[0]();
      } else if (shows === 2) {
        expect(this.items.map((item: any) => item.label)).toEqual(expect.arrayContaining([
          "still open", "tomorrow task",
        ]));
        expect(this.items.find((item: any) => item.label === "still open")?.detail)
          .toContain(`earlier plan ${today} still open`);
        this.selectedItems = [this.items.find((item: any) => item.label === "still open")];
        accepted[0]();
      } else {
        expect(lifeloop.vault.read("Work.md")).toContain(`still open [scheduled: "${tomorrow}"]`);
        hidden[0]();
      }
    },
  };
  vi.spyOn(vscode.window, "createQuickPick").mockImplementation((() => picker) as any);
  vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any[], options: any) => {
    if (options.placeHolder === "Planning scope") {
      return items.find((item) => item.scope === "plan-tomorrow");
    }
    return items.find((item) => item.id === "schedule-day");
  }) as any);
  try {
    await handlers.get("lifeloop.closeTodayPlanTomorrow")!();
    expect(shows).toBe(3);
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Review Period Facts reports only reliably dated completions and interactions", async () => {
  const range = week(day());
  const { lifeloop, dir } = await workspaceWith({
    "People/Alice.md": "---\ntags: person\n---\n",
    "Work.md": `* [x] shipped [completed: "${range.start}"]\n`,
    [`Journal/${range.start}.md`]: `* Discussed [[People/Alice]] [interaction: meeting]\n`,
    "Notes/Undated.md": "* Not a dated fact [[People/Alice]] [interaction: call]\n",
  });
  const handlers = registered(lifeloop);
  const execute = (vscode.commands as any).executeCommand;
  try {
    await handlers.get("lifeloop.reviewPeriodFacts")!();
    const call = execute.mock.calls.find((entry: any[]) => entry[0] === "lifeloop.openReadonlyResult");
    expect(call?.[1]).toContain(`Facts for ${range.start} to ${range.end}`);
    expect(call?.[1]).toContain("shipped");
    expect(call?.[1]).toContain("Discussed");
    expect(call?.[1]).not.toContain("Not a dated fact");
    expect(call?.[1]).toContain("omits task creation and Inbox processing");
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

for (const saveFailure of ["false", "throw"] as const) {
  test(`a task command does not report success after an editor save ${saveFailure}`, async () => {
    const line = "* [ ] guarded";
    const { lifeloop, dir } = await workspaceWith({ "Work.md": `${line}\n` });
    const handlers = registered(lifeloop);
    let buffer = `${line}\n`;
    const document: any = {
      uri: vscode.Uri.file(join(dir, "Work.md")), languageId: "markdown",
      isDirty: false, isClosed: false,
      getText: () => buffer,
      positionAt: (offset: number) => new vscode.Position(0, offset),
      save: vi.fn(async () => {
        if (saveFailure === "throw") throw new Error("save failed");
        return false;
      }),
    };
    vscode.workspace.textDocuments = [document];
    vi.spyOn(vscode.workspace, "applyEdit").mockImplementation(async (edit: any) => {
      buffer = edit.edits[0].content;
      document.isDirty = true;
      return true;
    });
    const reindex = vi.spyOn(lifeloop, "reindex");
    const status = vi.spyOn(vscode.window, "setStatusBarMessage");
    const error = vi.spyOn(vscode.window, "showErrorMessage");
    try {
      await handlers.get("lifeloop.completeTask")!({
        handle: { ref: "Work@0", expectedText: line, expectedState: " " },
      });
      expect(buffer).toContain("* [x] guarded");
      expect(document.isDirty).toBe(true);
      expect(readFileSync(join(dir, "Work.md"), "utf8")).toBe(`${line}\n`);
      expect(document.save).toHaveBeenCalledOnce();
      expect(reindex).toHaveBeenCalledTimes(1);
      expect(status).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledOnce();
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });
}
