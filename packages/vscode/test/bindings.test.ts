import { expect, test, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindingsIn, registerBindings } from "../src/bindings.ts";
import { LifeLoop } from "../src/workspace.ts";
import * as vscode from "./vscode-mock.ts";

test("external binding decorations only recognize exact task attributes", () => {
  const text = [
    '* [ ] call [reminder: "r-1"]',
    '* [ ] meet [event: "e-1"]',
    'prose [reminder: "not-a-task"]',
    '* [ ] malformed [event: e-2]',
  ].join("\r\n");
  expect(bindingsIn(text).map(({ kind, id, line }) => ({ kind, id, line }))).toEqual([
    { kind: "reminder", id: "r-1", line: '* [ ] call [reminder: "r-1"]' },
    { kind: "event", id: "e-1", line: '* [ ] meet [event: "e-1"]' },
  ]);
});

test("an anchored binding hover emits the canonical task handle", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-bindings-"));
  const text = '* [ ] task $task [event: "E1"]\n';
  writeFileSync(join(dir, "Work.md"), text);
  (vscode.workspace as any).root = dir;
  const lifeloop = await LifeLoop.open(dir);
  const positionAt = (offset: number) => {
    const before = text.slice(0, offset).split("\n");
    return new vscode.Position(before.length - 1, before.at(-1)!.length);
  };
  const document: any = {
    uri: vscode.Uri.file(join(dir, "Work.md")), languageId: "markdown",
    getText: () => text, positionAt,
    offsetAt: (position: any) => position.character,
    lineAt: () => ({
      text: text.trimEnd(),
      range: new vscode.Range(positionAt(0), positionAt(text.length - 1)),
    }),
  };
  let hoverProvider: any;
  const handlers = new Map<string, Function>();
  vi.spyOn(vscode.languages, "registerHoverProvider").mockImplementation(((_selector: any, provider: any) => {
    hoverProvider = provider; return { dispose() {} };
  }) as any);
  vi.spyOn(vscode.commands, "registerCommand").mockImplementation(((id: string, fn: Function) => {
    handlers.set(id, fn); return { dispose() {} };
  }) as any);
  const context = { subscriptions: [] as any[] };
  try {
    registerBindings(lifeloop, context as any);
    const hover = hoverProvider.provideHover(document, positionAt(text.indexOf("E1")));
    const encoded = /command:lifeloop\.detachBinding\?([^)]*)/.exec(hover.contents.value)![1];
    const [argument] = JSON.parse(decodeURIComponent(encoded));
    expect(argument.handle.ref).toBe("Work@task");
    await handlers.get("lifeloop.detachBinding")!(argument);
    expect(readFileSync(join(dir, "Work.md"), "utf8")).not.toContain("[event:");
  } finally {
    vi.restoreAllMocks();
    lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});
