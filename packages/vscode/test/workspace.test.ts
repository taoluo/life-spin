import { afterEach, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, changeSet } from "@lifeloop/semantic-core";
import { WorkspaceVault } from "../src/workspace.ts";
import * as vscode from "./vscode-mock.ts";

afterEach(() => {
  vscode.workspace.textDocuments = [];
  vi.restoreAllMocks();
});

test("conditional deletion is refused before the file is touched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-workspace-"));
  writeFileSync(join(dir, "A.md"), "before");
  const vault = new WorkspaceVault(dir, () => ["A.md"]);
  try {
    await expect(vault.writeIfUnchanged("A.md", "before", null))
      .rejects.toThrow("conditional deletion");
    expect(vault.read("A.md")).toBe("before");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a loaded document version change rejects replacement without touching disk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-workspace-"));
  const path = join(dir, "A.md");
  writeFileSync(path, "before");
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path)) as any;
  const apply = vscode.workspace.applyEdit;
  vi.spyOn(vscode.workspace, "applyEdit").mockImplementation(async (edit) => {
    const pending = apply(edit);
    document.version++;
    return pending;
  });
  const vault = new WorkspaceVault(dir, () => ["A.md"]);
  try {
    await expect(vault.writeIfUnchanged("A.md", "before", "after")).resolves.toBe(false);
    expect(vault.read("A.md")).toBe("before");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("unsupported checked deletion refuses a composite change before creating anything", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-workspace-"));
  writeFileSync(join(dir, "A.md"), "before");
  const vault = new WorkspaceVault(dir, () => ["A.md"]);
  const editor = vi.spyOn(vscode.workspace, "applyEdit");
  const cs = changeSet("create and delete");
  cs.expected.set("New.md", null);
  cs.expected.set("A.md", "before");
  cs.writes.set("New.md", "new");
  cs.removes.push("A.md");
  try {
    await expect(apply(vault, cs)).resolves.toMatchObject({ ok: false, reason: "unknown" });
    expect(editor).not.toHaveBeenCalled();
    expect(vault.exists("New.md")).toBe(false);
    expect(vault.read("A.md")).toBe("before");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("workspace inventory includes newly created and open Markdown pages", () => {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-workspace-"));
  writeFileSync(join(dir, "A.md"), "a");
  const vault = new WorkspaceVault(dir, () => ["A.md"]);
  writeFileSync(join(dir, "B.md"), "b");
  const openPath = join(dir, "Open.md");
  vscode.workspace.textDocuments.push({
    uri: vscode.Uri.file(openPath), languageId: "markdown", isClosed: false, isDirty: true,
    getText: () => "open",
  });
  try {
    expect(vault.list()).toEqual(["A.md", "B.md", "Open.md"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("create-if-absent uses one checked editor resource edit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-workspace-"));
  const vault = new WorkspaceVault(dir, () => []);
  const apply = vi.spyOn(vscode.workspace, "applyEdit");
  try {
    await expect(vault.writeIfUnchanged("New.md", null, "created")).resolves.toBe(true);
    expect(vault.read("New.md")).toBe("created");
    expect(apply.mock.calls[0][0].edits).toMatchObject([{ create: true, content: "created" }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
