import type { Vault, SourceHandle } from "@lifeloop/semantic-core";

/**
 * Find the task a binding actually names, right now.
 *
 * The index locates; it is never the thing verified against (I4). A ref taken from
 * the index is a *stale offset*, and two things make it dangerous here:
 *
 *   - the vault may have changed since indexing, so a different task can sit at
 *     that offset — reproduced: completing reminder R1 checked off the task bound
 *     to R2, because only the position was carried;
 *   - a write earlier in the same pass shifts every later offset on that page.
 *
 * So the binding is the identity, not the position. `[reminder: "id"]` is an id we
 * wrote ourselves and Markdown carries for us; searching for it is not
 * reconstructing identity from rendered text, it is reading the identity back.
 *
 * Ambiguity refuses. Two tasks carrying the same binding is a state we cannot
 * resolve, and picking one is how the wrong task gets completed.
 */
export type Located =
  | { ok: true; handle: SourceHandle; line: string }
  | { ok: false; reason: "missing" | "ambiguous"; message: string };

const TASK_LINE = /^\s*(?:[-*+]|\d+[.)])\s+\[([^\]])\]/;

export function locateByBinding(
  vault: Vault,
  page: string,
  attribute: "reminder" | "event",
  id: string,
): Located {
  const path = `${page}.md`;
  if (!vault.exists(path)) {
    return { ok: false, reason: "missing", message: `page ${page} no longer exists` };
  }

  const text = vault.read(path);
  // Match the attribute as written, with the id compared literally rather than
  // through a regex the id itself could influence.
  const marker = `[${attribute}: "${id}"]`;

  const matches: { offset: number; line: string }[] = [];
  let searchFrom = 0;
  for (;;) {
    const found = text.indexOf(marker, searchFrom);
    if (found === -1) break;
    searchFrom = found + marker.length;
    const start = text.lastIndexOf("\n", Math.max(0, found - 1)) + 1;
    const newline = text.indexOf("\n", found);
    const line = text.slice(start, newline === -1 ? text.length : newline);
    if (TASK_LINE.test(line)) matches.push({ offset: start, line });
  }

  if (matches.length === 0) {
    return {
      ok: false,
      reason: "missing",
      message: `no task on ${page} carries ${attribute} ${id} any more`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      message: `${matches.length} tasks on ${page} carry ${attribute} ${id}; refusing to guess`,
    };
  }

  const [only] = matches;
  return {
    ok: true,
    line: only.line,
    handle: {
      ref: `${page}@${only.offset}`,
      // The receipt I4 requires, taken from the vault a moment before the write —
      // not from an index that may be minutes old.
      expectedText: only.line,
      expectedState: TASK_LINE.exec(only.line)?.[1],
      capturedAt: new Date().toISOString(),
    },
  };
}

/** The page half of a `Page@pos` ref. */
export function pageOfRef(ref: string): string {
  const at = ref.lastIndexOf("@");
  return at === -1 ? ref : ref.slice(0, at);
}
