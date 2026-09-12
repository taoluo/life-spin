import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { day, pending, shift, week } from "@lifeloop/semantic-core";
import { recordInteraction } from "../src/commands.ts";
import { register as registerCommands } from "../src/commands.ts";
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
      vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any[], options: any) => {
        if (options?.canPickMany) {
          if (boundary === "task text" || boundary === "direct People") await mutate();
          return items;
        }
        if (options?.placeHolder === "Interaction type") {
          if (boundary === "Person tag") await mutate();
          return items.find((item) => item.id === "meeting");
        }
        if (boundary === "task identity") await mutate();
        return items.find((item) => item.id === "interaction");
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
