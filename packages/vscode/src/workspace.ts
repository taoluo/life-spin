import * as vscode from "vscode";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";
import {
  Store, indexVault, markdownFiles, isVaultMarkdownPath, pageNameOf, extractObjects, pageMetaFor,
  type Vault, NodeVault, pathOf, DEFAULT_CYCLE, type CycleStates,
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
    const root = resolve(this.root);
    const full = resolve(root, path);
    if (full !== root && !full.startsWith(root + sep)) return undefined;
    return vscode.workspace.textDocuments.find(
      (d) => resolve(d.uri.fsPath) === full && !d.isClosed,
    );
  }

  exists(path: string): boolean {
    return this.openDocument(path) !== undefined || this.disk.exists(path);
  }

  read(path: string): string {
    const open = this.openDocument(path);
    return open ? open.getText() : this.disk.read(path);
  }

  isDirty(path: string): boolean {
    return this.openDocument(path)?.isDirty === true;
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

import { cycleFor } from "./lua.ts";

export class LifeLoop {
  taskStates: CycleStates = DEFAULT_CYCLE;
  readonly store: Store;
  readonly vault: WorkspaceVault;
  private paths: string[] = [];
  private indexing: Promise<void> = Promise.resolve();
  private readonly indexedBuffers = new Map<string, string>();
  private sourceRevision = 0;
  private indexedRevision = -1;
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

  private relativePath(uri: vscode.Uri): string {
    return relative(this.root, uri.fsPath).split(sep).join("/");
  }

  /** Pages an open editor holds unsaved changes for. */
  private dirtyPaths(): Set<string> {
    const dirty = new Set<string>();
    for (const document of vscode.workspace.textDocuments) {
      if (!document.isDirty || document.isClosed) continue;
      const path = this.relativePath(document.uri);
      if (isVaultMarkdownPath(path)) dirty.add(path);
    }
    return dirty;
  }

  async reindex(force = false): Promise<void> {
    return this.serial(() => this.reindexNow(force));
  }

  private async reindexNow(force = false): Promise<void> {
    await this.indexPass(force, this.taskStates);
    const states = await this.resolvedTaskStates();
    if (JSON.stringify(states) !== JSON.stringify(this.taskStates)) {
      await this.indexPass(true, states);
      const confirmed = await this.resolvedTaskStates();
      if (JSON.stringify(confirmed) !== JSON.stringify(states)) {
        this.invalidateTaskStateCertificate();
        throw new Error("task-state policy source changed while rebuilding; retry the operation");
      }
      this.taskStates = states;
    }
    this.indexedRevision = this.sourceRevision;
    this.changed.fire();
  }

  private async indexPass(force: boolean, states: CycleStates): Promise<void> {
    const sourceRevision = this.sourceRevision;
    this.paths = await markdownFiles(this.root);
    // A rescan reads the disk. Pages with unsaved edits are newer in the buffer,
    // and letting the disk win made views show work that had already been ticked.
    const dirty = this.dirtyPaths();
    await indexVault(this.root, this.store, { force, taskStates: states, skip: (path) => dirty.has(path) });

    // Index those from their buffers instead, so nothing is simply missing.
    for (const path of dirty) {
      const document = vscode.workspace.textDocuments.find((candidate) =>
        !candidate.isClosed && candidate.isDirty &&
        this.relativePath(candidate.uri) === path);
      if (!document) throw new Error(`dirty document disappeared while indexing ${path}`);
      const text = document.getText();
      await this.indexDocument(document.uri, text, states);
      if (document.isClosed || !document.isDirty || document.getText() !== text) {
        throw new Error(`document changed while indexing ${path}`);
      }
    }
    if (dirty.size) {
      this.store.db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('task_states', ?)")
        .run(JSON.stringify(states));
    }
    const currentPaths = await markdownFiles(this.root);
    if (JSON.stringify(currentPaths) !== JSON.stringify(this.paths)) {
      this.invalidateTaskStateCertificate();
      throw new Error("vault contents changed while indexing; retry the operation");
    }
    this.assertIndexedSourcesCurrent("while indexing ");
    if (sourceRevision !== this.sourceRevision) {
      this.invalidateTaskStateCertificate();
      throw new Error("vault contents changed while indexing; retry the operation");
    }
  }

  /** Reindex a single page from its live text, so views follow the buffer. */
  async touch(uri: vscode.Uri, text: string): Promise<void> {
    return this.serial(() => this.touchNow(uri, text));
  }

  private async touchNow(uri: vscode.Uri, text: string): Promise<void> {
    if (!this.taskStatePolicyIsCertified(this.taskStates)) {
      await this.reindexNow(true);
      return;
    }
    await this.indexDocument(uri, text, this.taskStates);
    const states = await this.resolvedTaskStates();
    if (JSON.stringify(states) !== JSON.stringify(this.taskStates)) {
      await this.indexPass(true, states);
      const confirmed = await this.resolvedTaskStates();
      if (JSON.stringify(confirmed) !== JSON.stringify(states)) {
        this.invalidateTaskStateCertificate();
        throw new Error("task-state policy source changed while rebuilding; retry the operation");
      }
      this.taskStates = states;
    }
    this.indexedRevision = this.sourceRevision;
    this.changed.fire();
  }

  private async indexDocument(uri: vscode.Uri, text: string, states: CycleStates): Promise<void> {
    const path = this.relativePath(uri);
    if (!isVaultMarkdownPath(path)) return;
    const name = pageNameOf(path);
    if (!this.paths.includes(path)) this.paths = [...this.paths, path].sort();
    const vault = new Set(this.paths);
    const objects = await extractObjects(text, pageMetaFor(name, new Date().toISOString()), {
      has: (p) => vault.has(p),
      all: () => vault,
    }, states);
    this.store.replacePage(
      { path, name, hash: `live:${Date.now()}`, lastModified: new Date().toISOString(), size: text.length },
      objects,
      text,
    );
    this.indexedBuffers.set(path, text);
  }

  /** Refresh declarations and fail closed if one changed during evaluation. */
  async currentTaskStates(): Promise<CycleStates> {
    await this.reindex();
    for (const document of vscode.workspace.textDocuments) {
      if (!document.isDirty || document.isClosed) continue;
      const path = this.relativePath(document.uri);
      if (isVaultMarkdownPath(path) && this.indexedBuffers.get(path) !== document.getText()) {
        throw new Error(`task-state source changed while indexing ${path}; retry the command`);
      }
    }
    return this.taskStates;
  }

  private async resolvedTaskStates(): Promise<CycleStates> {
    const source = this.taskStateSource();
    const states = await cycleFor(this);
    const currentPaths = await markdownFiles(this.root);
    if (JSON.stringify(currentPaths) !== JSON.stringify(this.paths)) {
      this.invalidateTaskStateCertificate();
      throw new Error("vault contents changed while evaluating task-state policy; retry the operation");
    }
    this.assertIndexedSourcesCurrent("while evaluating task-state policy: ");
    if (source !== this.taskStateSource()) {
      this.invalidateTaskStateCertificate();
      throw new Error("task-state policy source changed while evaluating; retry the operation");
    }
    return states;
  }

  private assertIndexedSourcesCurrent(context: string): void {
    for (const path of this.paths) {
      const row = this.store.db.prepare(
        "SELECT body FROM pages JOIN fts ON fts.rowid = pages.id WHERE pages.path = ?",
      ).get(path) as { body: string } | undefined;
      if (!row || !this.vault.exists(path) || row.body !== this.vault.read(path)) {
        this.invalidateTaskStateCertificate();
        throw new Error(`source changed ${context}${path}; retry the operation`);
      }
    }
  }

  private taskStateSource(): string {
    const configuration = vscode.workspace.getConfiguration("lifeloop");
    const dirty = vscode.workspace.textDocuments
      .filter((document) => !document.isClosed && document.isDirty && document.languageId === "markdown")
      .map((document) => [this.relativePath(document.uri), document.getText()])
      .filter(([path]) => isVaultMarkdownPath(path))
      .sort(([a], [b]) => a.localeCompare(b));
    const scripts = this.store.objects("space-lua")
      .map((block) => [String(block.ref ?? ""), String(block.script ?? "")]);
    return JSON.stringify({
      revision: this.sourceRevision,
      configured: configuration.get("taskStates", []),
      execute: configuration.get("executeSpaceLua", false),
      dirty,
      scripts,
    });
  }

  private taskStatePolicyIsCertified(states: CycleStates): boolean {
    const row = this.store.db.prepare("SELECT value FROM meta WHERE key = 'task_states'").get() as
      { value: string } | undefined;
    return row?.value === JSON.stringify(states);
  }

  private invalidateTaskStateCertificate(): void {
    this.store.db.prepare("DELETE FROM meta WHERE key = 'task_states'").run();
  }

  noteSourceChange(): void {
    this.sourceRevision++;
  }

  indexIsSettled(): boolean {
    return this.indexedRevision === this.sourceRevision;
  }

  private serial(work: () => Promise<void>): Promise<void> {
    const next = this.indexing.then(work, work);
    this.indexing = next.catch(() => {});
    return next;
  }

  pageUri(page: string): vscode.Uri {
    return vscode.Uri.file(join(this.root, pathOf(page)));
  }

  pageNameOfUri(uri: vscode.Uri): string {
    const path = this.relativePath(uri);
    if (!isVaultMarkdownPath(path)) throw new Error("document is outside the LifeLoop vault");
    return pageNameOf(path);
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
