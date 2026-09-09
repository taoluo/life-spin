import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Where mutations read and write.
 *
 * An interface rather than direct `fs` calls because of I4's three-versions
 * problem: at any moment a page can differ between the index, the disk and an
 * unsaved editor buffer. The VS Code client supplies a Vault that reads the live
 * buffer when a document is open, so verification tests what the user is actually
 * looking at. The index is only ever a locator.
 */
export interface Vault {
  readonly root: string;
  exists(path: string): boolean;
  read(path: string): string;
  /** Confirm persisted contents after a write response is lost. */
  durableEquals?(path: string, content: string | null): boolean | undefined;
  /**
   * Async, because one implementation cannot be otherwise.
   *
   * VS Code applies an edit to an open document through `applyEdit`, which
   * resolves later and can be *rejected*. A synchronous signature forced that
   * promise to be discarded, so a command reported success — and reindexed —
   * before the write had landed, and a refused edit reached nobody. Reads stay
   * synchronous; only the writes had a real answer to wait for.
   */
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  list(): string[];
}

export class NodeVault implements Vault {
  constructor(readonly root: string, private readonly paths: () => string[]) {}

  private abs(path: string): string {
    const full = resolve(this.root, path);
    // A page name arriving from a ref or a user prompt must not escape the vault.
    if (full !== this.root && !full.startsWith(this.root + "/")) {
      throw new Error(`path escapes the vault: ${path}`);
    }
    return full;
  }

  exists(path: string): boolean {
    return existsSync(this.abs(path));
  }

  read(path: string): string {
    return readFileSync(this.abs(path), "utf8");
  }

  durableEquals(path: string, content: string | null): boolean {
    const exists = this.exists(path);
    return content === null ? !exists : exists && this.read(path) === content;
  }

  /**
   * Write via a temporary file in the same directory, then rename.
   *
   * A partially written page is the one outcome no mutation may produce, and a
   * crash midway through `writeFileSync` produces exactly that. Rename within a
   * filesystem is atomic, so a reader sees the old page or the new one.
   */
  async write(path: string, content: string): Promise<void> {
    const full = this.abs(path);
    mkdirSync(dirname(full), { recursive: true });
    const temp = `${full}.${process.pid}.tmp`;
    writeFileSync(temp, content, "utf8");
    renameSync(temp, full);
  }

  async remove(path: string): Promise<void> {
    rmSync(this.abs(path), { force: true });
  }

  list(): string[] {
    return this.paths();
  }
}

/** An in-memory vault, for tests that assert what was and was not written. */
export class MemoryVault implements Vault {
  readonly root = "/memory";
  constructor(private readonly files = new Map<string, string>()) {}

  static of(files: Record<string, string>): MemoryVault {
    return new MemoryVault(new Map(Object.entries(files)));
  }

  exists(path: string): boolean { return this.files.has(path); }
  read(path: string): string {
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`no such page: ${path}`);
    return text;
  }
  durableEquals(path: string, content: string | null): boolean {
    const exists = this.exists(path);
    return content === null ? !exists : exists && this.read(path) === content;
  }
  async write(path: string, content: string): Promise<void> { this.files.set(path, content); }
  async remove(path: string): Promise<void> { this.files.delete(path); }
  list(): string[] { return [...this.files.keys()].sort(); }

  /** A snapshot, for asserting that a failed mutation changed nothing at all. */
  snapshot(): Record<string, string> { return Object.fromEntries(this.files); }
}

export const pathOf = (page: string) => `${page}.md`;
export const joinPath = join;
