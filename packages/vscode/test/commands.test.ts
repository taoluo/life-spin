import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { day } from "@lifeloop/semantic-core";
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
  vscode.workspace.textDocuments = [{
    uri: vscode.Uri.file(join(dir, journal)), languageId: "markdown",
    isDirty: true, isClosed: false, getText: () => before, save,
  }];
  try {
    vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: any) => items[0]) as any);
    vi.spyOn(vscode.window, "showInputBox").mockResolvedValue("notes" as any);
    await recordInteraction(lifeloop, ["People/Alice"]);
    expect(save).not.toHaveBeenCalled();
    expect(readFileSync(join(dir, journal), "utf8")).toBe(before);
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("a date command re-admits its task after the prompt", async () => {
  const initial = "prefixxxxx\n* [ ] unchanged\n";
  const moved = "prefix\n* [ ] unchanged\n";
  const { lifeloop, dir } = await workspaceWith({ "Work.md": initial });
  const handlers = new Map<string, Function>();
  const registration = vi.spyOn(vscode.commands, "registerCommand").mockImplementation(((id: string, fn: Function) => {
    handlers.set(id, fn); return { dispose() {} };
  }) as any);
  const context = { subscriptions: [] as any[] };
  try {
    registerCommands(lifeloop, context as any);
    vi.spyOn(vscode.window, "showInputBox").mockImplementation((async () => {
      writeFileSync(join(dir, "Work.md"), moved);
      return "2026-09-10";
    }) as any);
    await handlers.get("lifeloop.setDeadline")!({
      handle: { ref: "Work@11", expectedText: "* [ ] unchanged", expectedState: " " },
    });
    expect(readFileSync(join(dir, "Work.md"), "utf8")).toBe(moved);
  } finally {
    registration.mockRestore();
    lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});
