import { apply, changeSet, refuse, applied, type MutationResult } from "../mutation.ts";
import type { Vault } from "../vault.ts";
import { pathOf } from "../vault.ts";

/**
 * Outlining, on whole items.
 *
 * VS Code already moves lines, folds, indents and outdents, and its Outline view
 * already lists Markdown headings. What it has no idea about is that a list item
 * *owns* the lines nested under it — so `Alt+Down` on a parent leaves its children
 * behind, which is the one operation an outliner exists to get right.
 *
 * The unit is the whole subtree, which is the same rule `DESIGN.md` states for
 * processing an inbox item: it moves entirely or not at all.
 */

const ITEM = /^(\s*)([-*+]|\d+[.)])\s+/;

export type Item = {
  /** Line index of the item's own line. */
  line: number;
  /** Line index one past its last nested child. */
  end: number;
  indent: number;
  marker: string;
};

/** The item at `line`, with everything nested under it. */
export function itemAt(lines: string[], line: number): Item | null {
  const match = ITEM.exec(lines[line] ?? "");
  if (!match) return null;
  const indent = match[1].length;

  let end = line + 1;
  for (; end < lines.length; end++) {
    const text = lines[end];
    if (text.trim() === "") {
      // A blank line belongs to the subtree only if something indented follows.
      const next = lines.slice(end + 1).find((l) => l.trim() !== "");
      const nextMatch = next ? ITEM.exec(next) : null;
      if (next && (!nextMatch || nextMatch[1].length > indent) && /^\s/.test(next)) continue;
      break;
    }
    const child = ITEM.exec(text);
    if (child) {
      if (child[1].length <= indent) break;
      continue;
    }
    // A continuation line is part of the item when it is indented past it.
    if (/^\s/.test(text) && text.length - text.trimStart().length > indent) continue;
    break;
  }
  return { line, end, indent, marker: match[2] };
}

/** The next sibling at the same indent, or null at the end of a list. */
function siblingAfter(lines: string[], item: Item): Item | null {
  const next = itemAt(lines, item.end);
  return next && next.indent === item.indent ? next : null;
}

function siblingBefore(lines: string[], item: Item): Item | null {
  for (let line = item.line - 1; line >= 0; line--) {
    const candidate = itemAt(lines, line);
    if (!candidate) continue;
    if (candidate.indent < item.indent) return null;
    if (candidate.indent === item.indent && candidate.end === item.line) return candidate;
  }
  return null;
}

export type OutlineMove = "up" | "down" | "indent" | "outdent";

/**
 * Move the item under the cursor, children included.
 *
 * Refuses rather than approximating: no sibling to swap with, or nothing to
 * indent under, means no write. An outliner that silently does something else
 * when it cannot do what was asked is worse than one that says so.
 */
export async function moveItem(
  vault: Vault,
  page: string,
  line: number,
  move: OutlineMove,
): Promise<MutationResult<{ line: number }>> {
  const path = pathOf(page);
  if (!vault.exists(path)) return refuse("missing", `no such page: ${page}`);

  const text = vault.read(path);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);

  const item = itemAt(lines, line);
  if (!item) return refuse("invalid", "the cursor is not on a list item");

  const block = lines.slice(item.line, item.end);
  let next: string[];
  let landsAt: number;

  if (move === "up" || move === "down") {
    const sibling = move === "up" ? siblingBefore(lines, item) : siblingAfter(lines, item);
    if (!sibling) {
      return refuse("invalid", `nothing to move ${move === "up" ? "above" : "below"}`);
    }
    const other = lines.slice(sibling.line, sibling.end);
    const [first, second] = move === "up" ? [item, sibling] : [sibling, item];
    const head = lines.slice(0, Math.min(first.line, second.line));
    const tail = lines.slice(Math.max(first.end, second.end));
    next = move === "up" ? [...head, ...block, ...other, ...tail] : [...head, ...other, ...block, ...tail];
    landsAt = move === "up" ? sibling.line : sibling.line + other.length - block.length + block.length;
  } else {
    const previous = siblingBefore(lines, item);
    if (move === "indent" && !previous) {
      // Indenting the first item of a list would orphan it under nothing.
      return refuse("invalid", "nothing above this item to nest it under");
    }
    if (move === "outdent" && item.indent === 0) {
      return refuse("invalid", "this item is already at the outer level");
    }
    const by = move === "indent" ? 2 : -2;
    const shifted = block.map((l) =>
      l.trim() === "" ? l : by > 0 ? `${" ".repeat(by)}${l}` : l.slice(Math.min(-by, l.length - l.trimStart().length)),
    );
    next = [...lines.slice(0, item.line), ...shifted, ...lines.slice(item.end)];
    landsAt = item.line;
  }

  const cs = changeSet(`${move} item at ${page}:${line}`);
  cs.expected.set(path, text);
  cs.writes.set(path, next.join(eol));
  return applied(vault, cs, { line: landsAt });
}
