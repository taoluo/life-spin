import { parseMarkdown } from "../../../../vendor/silverbullet/client/markdown_parser/parser.ts";

/**
 * The seam.
 *
 * Vendored SilverBullet code reaches its host through one late-binding global:
 * `plug-api/syscall.ts` reads `globalThis.syscall` at call time. So nothing in
 * vendor/ has to change for it to run here — we implement that global instead.
 *
 * Extraction barely uses it. `relation.ts` asks whether a page path exists, to
 * tell a resolving wikilink from an aspiring one; everything else is pure. An
 * unimplemented syscall throws by name rather than returning undefined, because
 * a silent wrong answer here becomes a wrong object in the index.
 */

/**
 * What the vault knows about its own paths. Deliberately the smallest thing an
 * indexer needs: the set of page paths that currently exist, with extensions.
 */
export type PathLookup = {
  has(path: string): boolean;
  /** Every path in the vault. Needed for basename resolution, not just existence. */
  all?(): Iterable<string>;
};

let lookup: PathLookup = { has: () => false };

/** Point the seam at a real index. Called by the indexer before extraction. */
export function setPathLookup(next: PathLookup): void {
  lookup = next;
}

/** Drop the derived basename index. Call when a vault's path set changes mid-run. */
export function invalidatePathLookup(): void {
  cachedFor = null;
}

/**
 * SilverBullet's `space.lookupPaths` answers two different questions at once, and
 * getting the second wrong is invisible: `exact` says whether that literal path
 * exists, while `candidates` carries every path sharing the basename — which is how
 * `[[Foo]]` resolves to `Projects/Foo.md`, and how an ambiguous link is detected.
 *
 * Returning only `exact` would make every link into a folder read as broken, so the
 * lookup takes the whole path set rather than a predicate.
 */
function basenameKey(path: string): string {
  const slash = path.lastIndexOf("/");
  return (slash === -1 ? path : path.slice(slash + 1)).toLowerCase();
}

/**
 * The basename index is derived from the whole vault, so building it per call made
 * indexing quadratic — every page paid for every other page. It is cached against
 * the identity of the lookup it came from, which is exactly the lifetime it is
 * valid for: `indexVault` hands the same object to every page of one run, and a
 * new run brings a new object.
 */
let cachedFor: PathLookup | null = null;
let cachedByBasename = new Map<string, string[]>();

function basenameIndex(): Map<string, string[]> {
  if (cachedFor === lookup) return cachedByBasename;
  const byBasename = new Map<string, string[]>();
  if (lookup.all) {
    for (const path of lookup.all()) {
      const key = basenameKey(path);
      const bucket = byBasename.get(key);
      if (bucket) bucket.push(path);
      else byBasename.set(key, [path]);
    }
  }
  cachedFor = lookup;
  cachedByBasename = byBasename;
  return byBasename;
}

function lookupPaths(paths: string[]): Record<string, { exact: boolean; candidates: string[] }> {
  const byBasename = basenameIndex();
  const out: Record<string, { exact: boolean; candidates: string[] }> = {};
  for (const path of paths) {
    out[path] = {
      exact: lookup.has(path),
      candidates: byBasename.get(basenameKey(path)) ?? (lookup.has(path) ? [path] : []),
    };
  }
  return out;
}

/**
 * Config is not decoration here — it decides what gets indexed at all.
 * `index.item.all`, `index.task.all` and `index.paragraph.all` change the object
 * set, and `taskStates` changes which markers count as done. So it is part of the
 * semantics under test: the conformance harness sets these to whatever the
 * reference space has, and a mismatch is a real difference rather than noise.
 *
 * Defaults are SilverBullet's own, taken from the call sites rather than guessed.
 */
const config = new Map<string, unknown>();

export function setConfig(values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) config.set(key, value);
}

export function resetConfig(): void {
  config.clear();
}

function configGet(key: string | string[], defaultValue: unknown): unknown {
  const flat = Array.isArray(key) ? key.join(".") : key;
  return config.has(flat) ? config.get(flat) : defaultValue;
}

const handlers: Record<string, (...args: any[]) => any> = {
  // The vendored indexer parses through a syscall. Point it at the vendored parser
  // so both sides of the conformance test run the identical grammar.
  "markdown.parseMarkdown": (text: string) => parseMarkdown(text),
  "space.lookupPaths": (paths: string[]) => lookupPaths(paths),
  "index.has": (path: string) => lookup.has(path),
  "system.getConfig": (key: string, defaultValue: unknown) => configGet(key, defaultValue),
  "config.get": (key: string | string[], defaultValue: unknown) => configGet(key, defaultValue),
};

let installed = false;

/** Install the syscall implementation the vendored code will find. Idempotent. */
export function installSyscalls(): void {
  if (installed) return;
  installed = true;
  (globalThis as any).syscall = async (name: string, ...args: any[]) => {
    const handler = handlers[name];
    if (!handler) {
      throw new Error(
        `syscall '${name}' is not implemented in semantic-core. ` +
          `Extraction should not need it — if it genuinely does, add it to compat/syscalls.ts ` +
          `rather than editing vendored code.`,
      );
    }
    return handler(...args);
  };
}
