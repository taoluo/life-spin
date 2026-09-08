import * as vscode from "vscode";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import {
  Store, indexVault, markdownFiles, pageNameOf, extractObjects, pageMetaFor,
  type Vault, NodeVault, pathOf,
} from "@lifeloop/semantic-core";

/**
 * The vault, the store, and the one thing that keeps them honest.
 *
 * I4 says a mutation verifies against what the user is looking at. In VS Code a
 * page exists in three versions at once — the index's, the disk's, and an unsaved
 * buffer's — so this Vault reads the open document when there is one. The index
 * locates; it is never the thing verified against.
 */
export class WorkspaceVault implements Vault {
  private readonly disk: NodeVault;

  constructor(readonly root: string, private readonly paths: () => string[]) {
    this.disk = new NodeVault(root, paths);
  }

  private openDocument(path: string): vscode.TextDocument | undefined {
    const full = vscode.Uri.file(join(this.root, path)).fsPath;
    return vscode.workspace.textDocuments.find(
      (d) => d.uri.fsPath === full && !d.isClosed,
    );
  }

  exists(path: string): boolean {
    return this.openDocument(path) !== undefined || this.disk.exists(path);
  }

  read(path: string): string {
    const open = this.openDocument(path);
    return open ? open.getText() : this.disk.read(path);
  }

  /**
   * Write through the editor when the document is open, so an unsaved buffer is
   * not silently replaced by a file write the user never sees.
   *
   * Both the edit and the save are **awaited**, and a refusal throws. Discarding
   * those promises let a command report success — and reindex — before the write
   * had landed, and a rejected edit reached nobody at all.
   */
  async write(path: string, content: string): Promise<void> {
    const open = this.openDocument(path);
    if (!open) {
      await this.disk.write(path, content);
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      open.uri,
      new vscode.Range(open.positionAt(0), open.positionAt(open.getText().length)),
      content,
    );

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new Error(`the editor refused the edit to ${path} (it may have changed underneath)`);
    }
    const saved = await open.save();
    if (!saved) throw new Error(`could not save ${path}`);
  }

  async remove(path: string): Promise<void> {
    await this.disk.remove(path);
  }

  list(): string[] {
    return this.paths();
  }
}

export class LifeLoop {
  readonly store: Store;
  readonly vault: WorkspaceVault;
  private paths: string[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  private constructor(readonly root: string, dbPath: string) {
    this.store = new Store(dbPath);
    this.vault = new WorkspaceVault(root, () => this.paths);
  }

  static async open(root: string): Promise<LifeLoop> {
    const dbDir = join(root, ".lifeloop");
    mkdirSync(dbDir, { recursive: true });
    const instance = new LifeLoop(root, join(dbDir, "index.sqlite"));
    await instance.reindex();
    return instance;
  }

  /** Pages an open editor holds unsaved changes for. */
  private dirtyPaths(): Set<string> {
    const dirty = new Set<string>();
    for (const document of vscode.workspace.textDocuments) {
      if (!document.isDirty || document.isClosed) continue;
      const path = vscode.workspace.asRelativePath(document.uri, false);
      if (path.endsWith(".md")) dirty.add(path);
    }
    return dirty;
  }

  async reindex(force = false): Promise<void> {
    this.paths = await markdownFiles(this.root);
    // A rescan reads the disk. Pages with unsaved edits are newer in the buffer,
    // and letting the disk win made views show work that had already been ticked.
    const dirty = this.dirtyPaths();
    await indexVault(this.root, this.store, { force, skip: (path) => dirty.has(path) });

    // Index those from their buffers instead, so nothing is simply missing.
    for (const document of vscode.workspace.textDocuments) {
      const path = vscode.workspace.asRelativePath(document.uri, false);
      if (dirty.has(path)) await this.touch(document.uri, document.getText());
    }
    this.changed.fire();
  }

  /** Reindex a single page from its live text, so views follow the buffer. */
  async touch(uri: vscode.Uri, text: string): Promise<void> {
    const path = vscode.workspace.asRelativePath(uri, false);
    if (!path.endsWith(".md")) return;
    const name = pageNameOf(path);
    if (!this.paths.includes(path)) this.paths = [...this.paths, path].sort();
    const vault = new Set(this.paths);
    const objects = await extractObjects(text, pageMetaFor(name, new Date().toISOString()), {
      has: (p) => vault.has(p),
      all: () => vault,
    });
    this.store.replacePage(
      { path, name, hash: `live:${Date.now()}`, lastModified: new Date().toISOString(), size: text.length },
      objects,
      text,
    );
    this.changed.fire();
  }

  forget(uri: vscode.Uri): void {
    const path = vscode.workspace.asRelativePath(uri, false);
    if (!path.endsWith(".md")) return;
    this.paths = this.paths.filter((p) => p !== path);
    this.store.forgetPage(pageNameOf(path));
    this.changed.fire();
  }

  pageUri(page: string): vscode.Uri {
    return vscode.Uri.file(join(this.root, pathOf(page)));
  }

  pageNameOfUri(uri: vscode.Uri): string {
    return pageNameOf(vscode.workspace.asRelativePath(uri, false));
  }

  config<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration("lifeloop").get<T>(key, fallback);
  }

  notifyChanged(): void {
    this.changed.fire();
  }

  dispose(): void {
    this.store.close();
    this.changed.dispose();
  }
}
