import type { Vault } from "./vault.ts";
import { pathOf } from "./vault.ts";
import { parseMarkdown } from "../../../vendor/silverbullet/client/markdown_parser/parser.ts";
import { collectNodesOfType, renderToText } from "../../../vendor/silverbullet/plug-api/lib/tree.ts";

/**
 * Every write goes through here (I5), and the contract is §27's, in one place:
 *
 *     resolve source → verify preconditions → construct ChangeSet → validate → apply
 *
 * Two invariants the rest of the system leans on:
 *
 *   - **Any uncertainty writes nothing.** A stale source, a collision, an
 *     ambiguous identity, a missing target — all of them return a refusal, not a
 *     best guess. Nothing here fuzzy-matches its way to a target.
 *   - **No composite action half-completes.** Every precondition for every step is
 *     checked before the first byte is written, so a failure at step three leaves
 *     the vault exactly as it was at step one.
 */

export type SourceHandle = {
  /** Identity. `Page@1820` or `Page@anchor-name` — never reconstructed from text. */
  ref: string;
  /** The marker state when the projection rendered this row, if it had one. */
  expectedState?: string;
  /** The line as rendered. A staleness guard only — never a way to find a task. */
  expectedText?: string;
  capturedAt?: string;
};

/** A handle safe to retain across UI, prompt, timer, or bridge boundaries. */
export type GuardedSourceHandle = SourceHandle & (
  { expectedText: string } | { expectedState: string }
);

export type Refusal = {
  ok: false;
  /** Machine-readable, so a caller can distinguish "try again" from "tell the user". */
  reason: "stale" | "missing" | "ambiguous" | "collision" | "invalid" | "cancelled" | "unknown";
  message: string;
};

export type Success<T = void> = { ok: true; changed: string[]; value: T };

/**
 * Apply a change set and attach the mutation's own result to it.
 *
 * `apply` can now refuse — the page may have moved since the mutation read it —
 * so spreading its result and adding a `value` would quietly produce a refusal
 * carrying a success payload. This keeps the two apart.
 */
export async function applied<T>(
  vault: Vault,
  cs: ChangeSet,
  value: T,
): Promise<MutationResult<T>> {
  const result = await apply(vault, cs);
  if (!result.ok) return result;
  return { ok: true, changed: result.changed, value };
}

/** A page name a mutation may create. Rejects traversal and absolute paths. */
export function validPageName(name: string): boolean {
  if (!name.trim() || name.startsWith("/") || name.endsWith("/")) return false;
  if (/\0/.test(name)) return false;
  return name.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
export type MutationResult<T = void> = Success<T> | Refusal;

export const refuse = (reason: Refusal["reason"], message: string): Refusal =>
  ({ ok: false, reason, message });

/** A complete set of file contents to write. Applied all at once or not at all. */
export type ChangeSet = {
  description: string;
  writes: Map<string, string>;
  removes: string[];
  /**
   * What each page contained when the mutation read it.
   *
   * Mutations read a whole page, edit a line, and write the whole page back. Two
   * of them overlapping — a command and a sync pass, a timer and a keystroke —
   * therefore silently lost one: both read the same text, and the second write
   * erased the first edit. Reproduced with two completions on one page.
   *
   * So `apply` re-reads immediately before writing and refuses if the page moved
   * underneath. Optimistic rather than locked: conflicts are rare, and a refusal
   * that says so is better than a lock that can be held by a crashed pass.
   */
  expected: Map<string, string | null>;
};

export const changeSet = (description: string): ChangeSet =>
  ({ description, writes: new Map(), removes: [], expected: new Map() });

/**
 * Apply a change set.
 *
 * Ordering matters and is deliberate: creations happen before deletions, so a
 * failure leaves an extra page to remove rather than content to recover. That is
 * the same rule `DESIGN.md` states for attaching a page to a task, generalised.
 */
export async function apply(vault: Vault, cs: ChangeSet): Promise<Success | Refusal> {
  // Check every page before writing any of them, so a composite change set cannot
  // half-apply because its second page moved.
  for (const [path, before] of cs.expected) {
    const now = vault.exists(path) ? vault.read(path) : null;
    if (now !== before) {
      return refuse(
        "stale",
        `${path} changed while this was being prepared; nothing was written`,
      );
    }
  }
  if (cs.removes.length && vault.supportsCheckedDeletion !== true) {
    return refuse("unknown", `'${cs.description}' requires checked deletion before any writes`);
  }

  /**
   * All or nothing, and it now means it.
   *
   * These are written in sequence, so a failure on the second file used to leave
   * the first one changed — while the type above claimed "applied all at once or
   * not at all". Prior contents are remembered and restored on failure, which is
   * as close to atomic as a set of separate files gets. A restore that itself
   * fails is reported rather than swallowed, because a half-applied set someone
   * knows about is recoverable and a silent one is not.
   */
  const effects = [
    ...[...cs.writes].map(([path, after]) => ({
      path, before: vault.exists(path) ? vault.read(path) : null, after,
    })),
    ...cs.removes.map((path) => ({
      path, before: vault.exists(path) ? vault.read(path) : null, after: null,
    })),
  ];
  if (effects.length && !vault.writeIfUnchanged) {
    return refuse("unknown", `'${cs.description}' requires a vault with checked writes`);
  }
  const written: typeof effects = [];
  let attempted: typeof effects[number] | undefined;
  let explicitlyRefused = false;

  try {
    for (const effect of effects) {
      for (const [path, before] of cs.expected) {
        const own = effects.find((candidate) => candidate.path === path);
        const expected = written.some((step) => step.path === path) ? (own ? own.after : before) : before;
        const now = vault.exists(path) ? vault.read(path) : null;
        if (now !== expected) throw new Error(`${path} changed during '${cs.description}'`);
      }
      attempted = effect;
      if (!await vault.writeIfUnchanged!(effect.path, effect.before, effect.after)) {
        attempted = undefined;
        explicitlyRefused = true;
        throw new Error(`${effect.path} changed during '${cs.description}'`);
      }
      written.push(effect);
      attempted = undefined;
    }
  } catch (error) {
    const read = () => effects.map((step) => {
      try {
        return { ...step, current: vault.exists(step.path) ? vault.read(step.path) : null };
      } catch {
        return { ...step, current: undefined };
      }
    });
    const durablyEquals = (step: typeof effects[number], content: string | null) => {
      try { return vault.durableEquals?.(step.path, content) === true; } catch { return false; }
    };
    const observed = read();
    const allAttempted = !explicitlyRefused && written.length + (attempted ? 1 : 0) === effects.length;
    if (allAttempted && observed.every((step) => step.current === step.after) &&
        effects.every((step) => durablyEquals(step, step.after))) {
      return { ok: true, changed: effects.map((step) => step.path), value: undefined };
    }
    if (observed.every((step) => step.current === step.before) &&
        effects.every((step) => durablyEquals(step, step.before))) {
      return refuse("unknown", `${(error as Error).message}; authoritative reread found no applied changes`);
    }
    if (observed.every((step) => step.current === step.before || step.current === step.after)) {
      for (const owned of [...written].reverse()) {
        let current: string | null | undefined;
        try { current = vault.exists(owned.path) ? vault.read(owned.path) : null; } catch { continue; }
        if (current !== owned.after) continue;
        try { await vault.writeIfUnchanged?.(owned.path, owned.after, owned.before); }
        catch { /* reconciled below */ }
      }
      if (read().every((step) => step.current === step.before) &&
          effects.every((step) => durablyEquals(step, step.before))) {
        return refuse("unknown", `${(error as Error).message}; verified rollback restored the prior contents`);
      }
    }
    return refuse(
      "unknown",
      `${(error as Error).message}; '${cs.description}' has an unknown outcome and must be reconciled before retry`,
    );
  }

  return { ok: true, changed: written.map((step) => step.path), value: undefined };
}

// ---------------------------------------------------------------------------
// Source resolution
// ---------------------------------------------------------------------------

export type ResolvedSource = {
  page: string;
  path: string;
  text: string;
  /** Byte offset of the line the ref points at. */
  offset: number;
  /** The full line at that offset. */
  line: string;
  lineStart: number;
  lineEnd: number;
};

const ANCHOR = /^(.*)@([A-Za-z_][A-Za-z0-9_/:-]*)$/;
const POSITION = /^(.*)@(\d+)$/;

/**
 * Resolve a ref to a live position.
 *
 * `DESIGN.md`: a ref is an identity, not a location — a page with an anchor
 * replaces `page@pos` with the anchor name, so the two forms must be told apart
 * rather than one assumed. An anchor is searched for as `$name` in the text; a
 * position is used directly but still bounds-checked, because the page may have
 * shrunk since the index last saw it.
 */
/** Map an upstream Markdown position (CRs removed) into the unchanged source. */
export function originalSourceOffset(text: string, offset: number): number {
  for (let i = 0; i <= offset && i < text.length; i++) if (text[i] === "\r") offset++;
  return offset;
}

export function resolveRef(vault: Vault, ref: string): ResolvedSource | Refusal {
  const position = POSITION.exec(ref);
  const anchor = position ? null : ANCHOR.exec(ref);
  if (!position && !anchor) return refuse("invalid", `not a ref: ${ref}`);

  const page = (position ?? anchor)![1];
  const path = pathOf(page);
  if (!vault.exists(path)) return refuse("missing", `no such page: ${page}`);
  const text = vault.read(path);

  let offset: number;
  if (position) {
    offset = Number(position[2]);
    if (offset > text.length) {
      return refuse("stale", `${ref} is past the end of ${page} (${text.length} bytes)`);
    }
  } else {
    const name = anchor![2];
    // Use the same grammar as indexing: prefixes, code and escaped examples are
    // not identities. Reuse the parser instead of a second anchor recognizer.
    const matches = collectNodesOfType(parseMarkdown(text), "NamedAnchor")
      .filter(node => renderToText(node) === `$${name}`);
    if (matches.length === 0) return refuse("stale", `anchor $${name} is no longer in ${page}`);
    // Duplicating a line duplicates its anchor. Taking the first match is how the
    // wrong task gets written to, so two of them refuse rather than guess.
    if (matches.length > 1) {
      return refuse("ambiguous", `anchor $${name} appears more than once in ${page}`);
    }
    offset = matches[0].from!;
    // The upstream parser removes CRs. Translate its position back to live text.
    offset = originalSourceOffset(text, offset);
  }

  const lineStart = text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const nextNewline = text.indexOf("\n", offset);
  let lineEnd = nextNewline === -1 ? text.length : nextNewline;
  /**
   * A CRLF file's line ends `\r\n`, and JavaScript's `$` matches before a final
   * `\n` but **not** before a `\r`. Leaving the carriage return on the line made
   * every task pattern fail, so a CRLF vault silently refused every mutation with
   * "not a task line". Excluding it here also preserves the ending: the write
   * replaces up to the `\r`, so `\r\n` survives untouched.
   */
  if (lineEnd > lineStart && text[lineEnd - 1] === "\r") lineEnd -= 1;
  return { page, path, text, offset, line: text.slice(lineStart, lineEnd), lineStart, lineEnd };
}

export const TASK_MARKER = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([^\[\]\r\n]+)(\])/;

/**
 * Resolve a handle and check it still describes what the projection showed.
 *
 * The two guards do different jobs and conflating them is a documented error.
 * `ref` is identity. `expectedText` is a receipt for what the user was shown — it
 * detects the source moving underneath, and may never be used to *find* a task.
 */
export function resolveHandle(vault: Vault, handle: SourceHandle): ResolvedSource | Refusal {
  const source = resolveRef(vault, handle.ref);
  if ("ok" in source) return source;

  if (handle.expectedText !== undefined && source.line.trim() !== handle.expectedText.trim()) {
    return refuse(
      "stale",
      `${handle.ref} no longer reads as it did when shown\n  shown: ${handle.expectedText.trim()}\n  found: ${source.line.trim()}`,
    );
  }
  if (handle.expectedState !== undefined) {
    const marker = TASK_MARKER.exec(source.line);
    if (!marker) return refuse("stale", `${handle.ref} is no longer a task`);
    if (marker[2] !== handle.expectedState) {
      return refuse(
        "stale",
        `${handle.ref} is '${marker[2]}', not the '${handle.expectedState}' that was shown`,
      );
    }
  }
  return source;
}

export const isRefusal = (value: unknown): value is Refusal =>
  typeof value === "object" && value !== null && (value as any).ok === false;
