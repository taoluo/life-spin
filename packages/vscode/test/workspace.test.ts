import { afterEach, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    document.version++;
    return apply(edit);
  });
  const vault = new WorkspaceVault(dir, () => ["A.md"]);
  try {
    await expect(vault.writeIfUnchanged("A.md", "before", "after")).resolves.toBe(false);
    expect(vault.read("A.md")).toBe("before");
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
