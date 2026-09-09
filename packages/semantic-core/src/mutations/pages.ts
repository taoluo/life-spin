import {
  applied, changeSet, refuse, resolveHandle, validPageName,
  type MutationResult, type SourceHandle,
} from "../mutation.ts";
import type { Vault } from "../vault.ts";
import { pathOf } from "../vault.ts";

export const PROJECT_STATES = ["active", "paused", "completed", "archived"] as const;
export type ProjectState = (typeof PROJECT_STATES)[number];

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

/** Read a page's frontmatter block as raw lines, or null when it has none. */
export function frontmatterOf(text: string): { body: string; lines: string[]; rest: string } | null {
  const match = FRONTMATTER.exec(text);
  if (!match) return null;
  return { body: match[1], lines: match[1].split("\n"), rest: text.slice(match[0].length) };
}

/**
 * Patch one frontmatter key, preserving everything else byte for byte.
 *
 * Deliberately a line edit rather than parse-and-reserialise: round-tripping YAML
 * reformats quoting, ordering and comments the user wrote, which is a large silent
 * change to their file in exchange for a one-key update.
 */
export async function patchFrontmatter(
  vault: Vault,
  page: string,
  key: string,
  value: string,
): Promise<MutationResult<{ created: boolean }>> {
  const path = pathOf(page);
  if (!vault.exists(path)) return refuse("missing", `no such page: ${page}`);
  const text = vault.read(path);
  const fm = frontmatterOf(text);

  let next: string;
  let created = false;
  if (!fm) {
    created = true;
    next = `---\n${key}: ${value}\n---\n${text}`;
  } else {
    const pattern = new RegExp(`^${key}:\\s*.*$`);
    const index = fm.lines.findIndex((line) => pattern.test(line));
    const lines = [...fm.lines];
    if (index === -1) lines.push(`${key}: ${value}`);
    else lines[index] = `${key}: ${value}`;
    next = `---\n${lines.join("\n")}\n---\n${fm.rest}`;
  }

  const cs = changeSet(`set ${key} on ${page}`);
  cs.expected.set(path, text);
  cs.writes.set(path, next);
  return applied(vault, cs, { created });
}

/**
 * Move a project through its lifecycle.
 *
 * Four states, and semantic only: `archived` sets a status and does **not** move
 * or rename the page, however much the word suggests otherwise. Coupling a status
 * to a location would quietly reintroduce the idea that identity lives in a path.
 */
export async function setProjectStatus(
  vault: Vault,
  page: string,
  status: ProjectState,
): Promise<MutationResult<{ created: boolean }>> {
  if (!PROJECT_STATES.includes(status)) return refuse("invalid", `not a project status: ${status}`);
  return patchFrontmatter(vault, page, "status", status);
}

/**
 * Give one task a page, and link the task to it.
 *
 * The composite case, and the ordering is the contract. Every precondition —
 * the task exists, the name is given, the name is free, the source still matches —
 * is checked before anything is written. Then the destination is created *first*,
 * because a failure after that leaves a page to delete rather than a task to lose;
 * and the compensating delete fires only if the page is still byte-identical to
 * what was just written. A page something else has touched is left alone and named.
 */
export async function attachPageToTask(
  vault: Vault,
  handle: SourceHandle,
  destination: string,
  template = "",
): Promise<MutationResult<{ page: string }>> {
  if (!destination.trim()) return refuse("cancelled", "no destination given");
  // Validated here rather than in one Vault implementation: a mutation is the
  // only thing that knows a name came from a person, and `../../etc/evil` is a
  // legal-looking answer to "what should this page be called?".
  if (!validPageName(destination)) return refuse("invalid", `not a page name: ${destination}`);
  const destPath = pathOf(destination);
  if (vault.exists(destPath)) return refuse("collision", `${destination} already exists`);

  const source = resolveHandle(vault, handle);
  if ("ok" in source) return source;
  if (!/^\s*(?:[-*+]|\d+[.)])\s+\[/.test(source.line)) {
    return refuse("stale", `${handle.ref} is not a task line`);
  }
  if (source.line.includes(`[[${destination}]]`)) {
    return refuse("stale", `${handle.ref} already links to ${destination}`);
  }

  const contents = template || `# ${destination.split("/").pop()}\n`;
  const line = `${source.line} [[${destination}]]`;
  const next = source.text.slice(0, source.lineStart) + line + source.text.slice(source.lineEnd);
  const cs = changeSet(`attach ${destination} to ${handle.ref}`);
  cs.expected.set(destPath, null);
  cs.expected.set(source.path, source.text);
  cs.writes.set(destPath, contents);
  cs.writes.set(source.path, next);
  return applied(vault, cs, { page: destination });
}
