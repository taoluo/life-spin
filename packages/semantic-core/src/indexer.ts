import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { extractObjects, pageMetaFor, type LifeloopObject } from "./extract.ts";
import { Store } from "./store.ts";
import { validateTaskStates, type CycleStates } from "./mutations/tasks.ts";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** A vault path (`Projects/Foo.md`) to a page name (`Projects/Foo`). */
export const pageNameOf = (path: string) => path.replace(/\.md$/, "");

const SKIP = new Set([".git", "node_modules", ".lifeloop", "tmp", ".obsidian", "silverbullet", "vendor", "packages"]);

/** Whether a relative path belongs to the same Markdown domain as markdownFiles. */
export function isVaultMarkdownPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return false;
  return normalized.endsWith(".md") && parts.every((part) =>
    part !== "" && part !== ".." && !part.startsWith(".") && !SKIP.has(part));
}

export async function markdownFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".md")) out.push(relative(root, full).split(sep).join("/"));
    }
  };
  await walk(root);
  return out.sort();
}

/** Current on-disk Markdown inventory for synchronous authority checks. */
export function markdownFilesSync(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md")) out.push(relative(root, full).split(sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

export type IndexResult = { indexed: number; skipped: number; removed: number; ms: number };

/**
 * Index a vault into a store.
 *
 * Two passes, and the reason is semantic rather than an optimisation: link
 * resolution asks whether a target path exists, so the full path set has to be
 * known before any page is extracted. Indexing page-by-page as they are
 * discovered would make every forward link to a not-yet-seen page read as broken.
 */
export async function indexVault(
  root: string,
  store: Store,
  options: {
    force?: boolean;
    taskStates?: CycleStates;
    /**
     * Pages the caller holds a newer version of than the disk does.
     *
     * An editor indexes the *buffer* as you type and the *disk* on a rescan. With
     * no way to say so, the disk pass overwrote the newer buffer version and views
     * showed work that had already been ticked. The caller knows which documents
     * are dirty; this is how it says.
     */
    skip?: (path: string) => boolean;
  } = {},
): Promise<IndexResult> {
  const started = Date.now();
  if (options.taskStates) validateTaskStates(options.taskStates);
  const policy = JSON.stringify(options.taskStates ?? null);
  const previous = store.db.prepare("SELECT value FROM meta WHERE key = 'task_states'").get() as { value: string } | undefined;
  const policyChanged = previous?.value !== policy;
  // The page batches below commit independently. Remove the certificate before
  // the first batch so a later failure cannot leave a mixed index certified as
  // the old policy. A missing certificate forces the next run to rebuild.
  if (policyChanged) store.db.prepare("DELETE FROM meta WHERE key = 'task_states'").run();
  let deferred = false;
  const paths = await markdownFiles(root);
  const vault = new Set(paths);
  const lookup = { has: (p: string) => vault.has(p), all: () => vault };

  // Pages are committed in batches rather than one transaction each. A cold build
  // is thousands of writes, and paying a commit per page costs more than the work.
  // The batch is bounded rather than "the whole vault" so a crash loses a chunk of
  // a derived store instead of all of it, and so one lock is not held for a minute.
  const BATCH = 500;
  let indexed = 0, skipped = 0, pending = 0;
  const commit = () => { if (pending) { store.db.exec("COMMIT"); pending = 0; } };

  try {
  for (const path of paths) {
    if (options.skip?.(path)) { skipped++; deferred = true; continue; }
    const abs = join(root, path);
    const text = readFileSync(abs, "utf8");
    const digest = hash(text);
    if (!options.force && !policyChanged && store.hashOf(path) === digest) { skipped++; continue; }
    const stat = statSync(abs);
    const name = pageNameOf(path);
    const meta = pageMetaFor(name, stat.mtime.toISOString(), stat.birthtime.toISOString());
    const objects = await extractObjects(text, meta, lookup, options.taskStates);
    if (!pending) store.db.exec("BEGIN");
    try {
      store.writePage(
        { path, name, hash: digest, lastModified: meta.lastModified as string, size: stat.size },
        objects,
        text,
      );
    } catch (error) {
      store.db.exec("ROLLBACK");
      pending = 0;
      throw error;
    }
    indexed++;
    if (++pending >= BATCH) commit();
  }
  commit();
  } finally {
    // Extraction runs *outside* the write transaction and can throw. Without this,
    // a failure mid-batch left the connection inside an open transaction and every
    // later write on that store failed for a reason nothing named.
    if (pending) {
      try { store.db.exec("ROLLBACK"); } catch { /* already closed */ }
      pending = 0;
    }
  }

  let removed = 0;
  for (const known of store.pagePaths()) {
    if (!vault.has(known)) { store.forgetPage(pageNameOf(known)); removed++; }
  }

  // Do not certify a policy transition while any page was deferred to a dirty buffer.
  if (!deferred) store.db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('task_states', ?)").run(policy);
  return { indexed, skipped, removed, ms: Date.now() - started };
}

export type { LifeloopObject };
