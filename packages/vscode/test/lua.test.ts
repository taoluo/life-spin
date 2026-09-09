import { test, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "./vscode-mock.ts";
import { LifeLoop } from "../src/workspace.ts";
import { registerLua, cycleFor } from "../src/lua.ts";

test("declared-command picker invokes the selected Lua closure and cancellation does not", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-command-"));
  writeFileSync(join(dir, "Commands.md"), '```space-lua\ncommand.define {name="Example", run=function() error("CALLED_SENTINEL") end}\n```\n');
  (vscode.workspace as any).root = dir;
  const life = await LifeLoop.open(dir);
  const handlers = new Map<string, Function>();
  const context = { subscriptions: [] as any[] };
  const registration = vi.spyOn(vscode.commands, "registerCommand").mockImplementation(((id: string, fn: Function) => {
    handlers.set(id, fn); return { dispose() {} };
  }) as any);
  const warning = vi.spyOn(vscode.window, "showWarningMessage");
  const picker = vi.spyOn(vscode.window, "showQuickPick");
  try {
    registerLua(() => life, context as any);
    vscode.workspace.settings["lifeloop.executeSpaceLua"] = true;
    picker.mockImplementationOnce((async (items: any[]) => items[0]) as any);
    await handlers.get("lifeloop.runDeclaredCommand")!();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("CALLED_SENTINEL"));
    warning.mockClear();
    picker.mockResolvedValueOnce(undefined);
    await handlers.get("lifeloop.runDeclaredCommand")!();
    expect(warning).not.toHaveBeenCalled();
  } finally {
    delete vscode.workspace.settings["lifeloop.executeSpaceLua"];
    for (const disposable of context.subscriptions) disposable.dispose();
    registration.mockRestore(); picker.mockRestore(); warning.mockRestore();
    life.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});


test("configured multi-character states are preserved and ambiguous configurations are rejected", async () => {
  const states = [{ state: "TO DO" }, { state: "IN PROGRESS" }, { state: "DONE", done: true }];
  try {
    vscode.workspace.settings["lifeloop.taskStates"] = states;
    expect(await cycleFor(undefined as any)).toEqual(states);
    vscode.workspace.settings["lifeloop.taskStates"] = [...states, { state: "DONE", done: false }];
    await expect(cycleFor(undefined as any)).rejects.toThrow("duplicate task state");
  } finally { delete vscode.workspace.settings["lifeloop.taskStates"]; }
});
