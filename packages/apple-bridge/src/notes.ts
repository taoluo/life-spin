import {
  applied, captureItem, changeSet, pending, processedOffset, refuse,
  type MutationResult, type Refusal, type Vault,
} from "@lifeloop/semantic-core";
import { osascriptRunner, parseRecords, type ScriptRunner } from "./osascript.ts";

/**
 * Apple Notes and the Inbox share one plain-text first line.
 *
 * The Inbox is the superset of every capture source; Notes is a mobile frontend,
 * not a second home for knowledge. While an item is pending the note is canonical
 * and the Inbox line is its projection, so there is never a moment with two
 * writers — §3.2 is satisfied by not producing a conflict rather than by resolving
 * one. Processing hands ownership to Markdown, permanently.
 */

export type AppleNote = {
  id: string;
  name: string;
  body: string;
  modified: string;
  /** Whether the note holds something a Markdown round trip would destroy. */
  rich: boolean;
};

const LIST_SCRIPT = `
on run argv
  set folderName to item 1 of argv
  set out to ""
  tell application "Notes"
    if not (exists folder folderName) then return ""
    repeat with n in notes of folder folderName
      set nid to id of n as string
      set nname to name of n as string
      set nbody to body of n as string
      set nmod to (modification date of n) as string
      set nrich to "false"
      if (count of attachments of n) > 0 then set nrich to "true"
      set out to out & nid & FS & nname & FS & nbody & FS & nmod & FS & nrich & RS
    end repeat
  end tell
  return out
end run
`;

const MOVE_SCRIPT = `
on run argv
  set theId to item 1 of argv
  set destination to item 2 of argv
  tell application "Notes"
    if not (exists folder destination) then make new folder with properties {name:destination}
    set matches to (every note whose id is theId)
    if (count of matches) is 0 then return "gone"
    move item 1 of matches to folder destination
    return "ok"
  end tell
end run
`;

const UPDATE_SCRIPT = `
on run argv
  set theId to item 1 of argv
  set expectedModified to item 2 of argv
  set newBody to item 3 of argv
  tell application "Notes"
    set matches to (every note whose id is theId)
    if (count of matches) is 0 then return "gone"
    set n to item 1 of matches
    if (modification date of n as string) is not expectedModified then return "conflict"
    set body of n to newBody
    return "ok"
  end tell
end run
`;

const withSeparators = (script: string) =>
  script.replace(/\bRS\b/g, "(ASCII character 29)").replace(/\bFS\b/g, "(ASCII character 31)");

/**
 * Notes' body is HTML. This is a *reader*, not a converter: it recovers the text
 * and the list structure and nothing else, because anything richer would imply we
 * could write it back — and we never write back.
 */
export function bodyToMarkdown(html: string): string {
  return html
    .replace(/<div><br><\/div>/gi, "\n")
    .replace(/<\/(div|p|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "* ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Anything a round trip would destroy makes a note pull-only, forever. */
export function isRich(note: { body: string; rich: boolean }): boolean {
  return note.rich || /<(table|img|object|embed)\b/i.test(note.body);
}

export class Notes {
  constructor(private readonly run: ScriptRunner = osascriptRunner) {}

  async list(folder: string): Promise<AppleNote[]> {
    const out = await this.run(withSeparators(LIST_SCRIPT), [folder]);
    return parseRecords(out, ["id", "name", "body", "modified", "rich"]).map((r) => ({
      id: r.id,
      name: r.name,
      body: r.body,
      modified: r.modified,
      rich: r.rich === "true",
    }));
  }

  /**
   * Move a processed note into a "done" folder.
   *
   * Tidiness in Notes, and **best effort**: it drops the note out of the scanned
   * folder, but the authoritative processed signal is the item sitting under
   * `## Processed` locally. A failed AppleScript must never block or half-complete
   * a LifeLoop mutation.
   */
  async markProcessed(id: string, folder: string): Promise<boolean> {
    try {
      return (await this.run(MOVE_SCRIPT, [id, folder])) === "ok";
    } catch {
      return false;
    }
  }

  async update(id: string, expectedModified: string, text: string): Promise<"ok" | "gone" | "conflict"> {
    const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const html = text.split("\n").map((line) => `<div>${escape(line) || "<br>"}</div>`).join("");
    const result = await this.run(UPDATE_SCRIPT, [id, expectedModified, html]);
    return result === "ok" || result === "gone" ? result : "conflict";
  }
}

export type ImportState = {
  /** What we last wrote for this note, so a local edit can be told from a remote one. */
  lastImported: Map<string, { text: string; modified: string }>;
};

export type ImportDecision =
  | { action: "create"; note: AppleNote; line: string }
  | { action: "update"; note: AppleNote; line: string; expected: string }
  | { action: "push"; note: AppleNote; line: string; expected: string; text: string }
  | { action: "conflict"; note: AppleNote; why: string; expected: string }
  | { action: "baseline"; note: AppleNote; line: string }
  | { action: "none"; note: AppleNote; why: string };

const MARKER = (id: string) => `[source-id: "${id}"]`;
const DETACHED_MARKER = (id: string) => `[source-id: "detached:${id}"]`;
const lineText = (line: string) => line.endsWith("\r") ? line.slice(0, -1) : line;

export function importedText(line: string): string {
  const [first, ...rest] = line.replaceAll("\r\n", "\n").split("\n");
  const title = first
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[^\]]+\]\s+)?/, "")
    .replace(/\s+\[source:\s*apple-notes\]\s+\[source-id:\s*"[^"]+"\]\s*$/, "")
    .trim();
  return [title, ...rest.map((part) => part.replace(/^ {0,2}/, ""))].join("\n").trimEnd();
}

export function lineFor(note: AppleNote): string {
  const text = bodyToMarkdown(note.body) || note.name;
  const [first, ...rest] = text.split("\n");
  return `* ${first.trim()} [source: apple-notes] ${MARKER(note.id)}` +
    rest.map((line) => `\n  ${line}`).join("");
}

/**
 * Decide what to do with each note, given what the Inbox currently says.
 *
 * A three-way baseline distinguishes a one-sided edit from a conflict. Conflicts
 * detach: Markdown keeps its value and Notes keeps its value.
 */
export function planImport(
  notes: AppleNote[],
  inboxText: string,
  state: ImportState,
): ImportDecision[] {
  const pendingRegion = inboxText.slice(0, processedOffset(inboxText) ?? inboxText.length);
  const processedRegion = inboxText.slice(processedOffset(inboxText) ?? inboxText.length);

  return notes.map((note): ImportDecision => {
    const marker = MARKER(note.id);
    if (inboxText.includes(DETACHED_MARKER(note.id))) {
      return { action: "none", note, why: "detached — Markdown owns it now" };
    }

    // Processed is a permanent handoff: Markdown owns it and syncing stops.
    if (processedRegion.includes(marker)) {
      return { action: "none", note, why: "processed — Markdown owns it now" };
    }

    const matches = pending(pendingRegion).filter((item) => item.text.includes(marker));
    const existing = matches.length === 1 ? matches[0].text : undefined;

    if (!existing) return { action: "create", note, line: lineFor(note) };

    const remembered = state.lastImported.get(note.id);
    if (!remembered) {
      return existing === lineFor(note)
        ? { action: "baseline", note, line: existing }
        : { action: "conflict", note, expected: existing, why: "sync baseline is unavailable" };
    }
    const localChanged = lineText(existing) !== lineText(remembered.text);
    const remoteChanged = remembered.modified !== note.modified;
    if (localChanged && remoteChanged && existing === lineFor(note)) {
      return { action: "baseline", note, line: existing };
    }
    if (localChanged && remoteChanged) {
      return { action: "conflict", note, expected: existing, why: "both Notes and Markdown changed" };
    }
    if (localChanged) {
      if (isRich(note)) {
        return { action: "conflict", note, expected: existing, why: "rich Note cannot be safely overwritten" };
      }
      return { action: "push", note, line: existing, expected: existing, text: importedText(existing) };
    }
    if (!remoteChanged) {
      return { action: "none", note, why: "unchanged" };
    }

    // Rich content is pull-only in principle and unwritable in practice; we still
    // refresh the text we can read, because nothing is ever written back.
    return { action: "update", note, line: lineFor(note), expected: existing };
  });
}

function pendingMatch(text: string, id: string, expected: string): { start: number; end: number } | null {
  const marker = MARKER(id);
  const matches = pending(text)
    .filter((item) => item.text.includes(marker))
    .map((item) => ({ start: item.offset, end: item.end, item: item.text }));
  if (matches.length !== 1) return null;
  const match = matches[0];
  const same = (value: string) => value.replaceAll("\r\n", "\n");
  return same(match.item) === same(expected)
    ? { start: match.start, end: match.end }
    : null;
}

/** Replace exactly the pending source line that an import decision observed. */
export async function replacePendingImportedLine(
  vault: Vault,
  inboxPage: string,
  id: string,
  expected: string,
  replacement: string,
): Promise<MutationResult> {
  const path = `${inboxPage}.md`;
  if (!vault.exists(path)) return refuse("missing", `no ${inboxPage} page`);
  const text = vault.read(path);
  const match = pendingMatch(text, id, expected);
  if (!match) {
    return refuse("stale", `Apple Note ${id} no longer has the pending line that was planned`);
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const rendered = replacement.replaceAll("\r\n", "\n").replaceAll("\n", eol);
  const suffix = text.slice(match.end);
  const boundaryCr = eol === "\r\n" && suffix.startsWith("\n") ? "\r" : "";
  const next = text.slice(0, match.start) + rendered + boundaryCr + suffix;
  if (next === text) return { ok: true, changed: [], value: undefined };
  const cs = changeSet(`update imported Apple Note ${id}`);
  cs.expected.set(path, text);
  cs.writes.set(path, next);
  return applied(vault, cs, undefined);
}

export type ImportRefusal = Refusal & { id: string; action: ImportDecision["action"] };
export type ImportResult = {
  created: number;
  updated: number;
  pushed: number;
  detached: number;
  conflicts: { id: string; local: string; remote: string; reason: string }[];
  settled: string[];
  refused: ImportRefusal[];
};

/** Apply an import plan, through the capture mutation for anything new. */
export async function applyImport(
  vault: Vault,
  inboxPage: string,
  decisions: ImportDecision[],
  state: ImportState,
  notes: Pick<Notes, "update"> = new Notes(),
): Promise<ImportResult> {
  let created = 0, updated = 0, pushed = 0, detached = 0;
  const conflicts: ImportResult["conflicts"] = [];
  const settled: string[] = [];
  const refused: ImportRefusal[] = [];

  const record = (decision: ImportDecision, result: MutationResult<unknown>): boolean => {
    if (result.ok) return true;
    refused.push({ ...result, id: decision.note.id, action: decision.action });
    return false;
  };

  for (const decision of decisions) {
    if (decision.action === "create") {
      const path = `${inboxPage}.md`;
      const current = vault.exists(path) ? vault.read(path) : null;
      if (current?.includes(MARKER(decision.note.id)) || current?.includes(DETACHED_MARKER(decision.note.id))) {
        continue;
      }
      const result = await captureItem(vault, decision.line, inboxPage, current);
      if (record(decision, result)) {
        created++;
        settled.push(decision.note.id);
        state.lastImported.set(decision.note.id, {
          text: decision.line, modified: decision.note.modified,
        });
      }
    } else if (decision.action === "update") {
      const result = await replacePendingImportedLine(
        vault, inboxPage, decision.note.id, decision.expected, decision.line,
      );
      if (record(decision, result)) {
        if (result.ok && result.changed.length) updated++;
        settled.push(decision.note.id);
        state.lastImported.set(decision.note.id, {
          text: decision.line, modified: decision.note.modified,
        });
      }
    } else if (decision.action === "baseline") {
      settled.push(decision.note.id);
      state.lastImported.set(decision.note.id, {
        text: decision.line, modified: decision.note.modified,
      });
    } else if (decision.action === "push") {
      const current = vault.exists(`${inboxPage}.md`) ? vault.read(`${inboxPage}.md`) : "";
      if (!pendingMatch(current, decision.note.id, decision.expected)) {
        record(decision, refuse("stale", "Inbox changed before the Note update; nothing was pushed"));
        continue;
      }
      const outcome = await notes.update(decision.note.id, decision.note.modified, decision.text);
      if (outcome === "ok") {
        pushed++;
        settled.push(decision.note.id);
        state.lastImported.set(decision.note.id, { text: decision.line, modified: "" });
        continue;
      }
      conflicts.push({
        id: decision.note.id, local: decision.text,
        remote: bodyToMarkdown(decision.note.body),
        reason: outcome === "gone" ? "Note is missing" : "Note changed during sync",
      });
    } else if (decision.action === "conflict") {
      conflicts.push({
        id: decision.note.id, local: importedText(decision.expected),
        remote: bodyToMarkdown(decision.note.body), reason: decision.why,
      });
    } else if (decision.action === "none") {
      settled.push(decision.note.id);
    }
  }

  return { created, updated, pushed, detached, conflicts, settled, refused };
}

export async function resolveNoteConflict(
  vault: Vault,
  inboxPage: string,
  note: AppleNote,
  choice: "notes" | "markdown" | "detach",
  state: ImportState,
  notes: Pick<Notes, "update"> = new Notes(),
  expected?: { local: string; remote: string },
): Promise<MutationResult> {
  const path = `${inboxPage}.md`;
  const text = vault.exists(path) ? vault.read(path) : "";
  const matches = pending(text).filter((item) => item.text.includes(MARKER(note.id)));
  if (matches.length !== 1) return refuse(matches.length ? "ambiguous" : "missing", `cannot uniquely locate Apple Note ${note.id}`);
  const current = matches[0].text;
  if (expected && importedText(current) !== expected.local) return refuse("stale", "Inbox changed after the conflict was shown");
  if (expected && bodyToMarkdown(note.body) !== expected.remote) return refuse("stale", "Apple Note changed after the conflict was shown");
  if (choice === "notes") {
    const result = await replacePendingImportedLine(vault, inboxPage, note.id, current, lineFor(note));
    if (result.ok) state.lastImported.set(note.id, { text: lineFor(note), modified: note.modified });
    return result;
  }
  if (choice === "detach") {
    const result = await replacePendingImportedLine(
      vault, inboxPage, note.id, current,
      current.replace(MARKER(note.id), DETACHED_MARKER(note.id)),
    );
    if (result.ok) state.lastImported.delete(note.id);
    return result;
  }
  if (isRich(note)) return refuse("invalid", "a rich Note cannot be overwritten without losing content");
  if (!pendingMatch(vault.read(path), note.id, current)) return refuse("stale", "Inbox changed before conflict resolution");
  const outcome = await notes.update(note.id, note.modified, importedText(current));
  if (outcome !== "ok") return refuse(outcome === "gone" ? "missing" : "stale", `Apple Note ${outcome}`);
  state.lastImported.set(note.id, { text: current, modified: "" });
  return { ok: true, changed: [], value: undefined };
}
