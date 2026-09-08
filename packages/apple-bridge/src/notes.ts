import { capture, processedOffset, type Vault } from "@lifeloop/semantic-core";
import { osascriptRunner, parseRecords, type ScriptRunner } from "./osascript.ts";

/**
 * Apple Notes into the Inbox — one way (2d).
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
}

export type ImportState = {
  /** What we last wrote for this note, so a local edit can be told from a remote one. */
  lastImported: Map<string, { text: string; modified: string }>;
};

export type ImportDecision =
  | { action: "create"; note: AppleNote; line: string }
  | { action: "update"; note: AppleNote; line: string }
  | { action: "went-native"; note: AppleNote; why: string }
  | { action: "none"; note: AppleNote; why: string };

const MARKER = (id: string) => `[source-id: "${id}"]`;

export function lineFor(note: AppleNote): string {
  const text = bodyToMarkdown(note.body) || note.name;
  const first = text.split("\n")[0].trim();
  return `* ${first} [source: apple-notes] ${MARKER(note.id)}`;
}

/**
 * Decide what to do with each note, given what the Inbox currently says.
 *
 * The one rule that needs stating: **editing a mirrored item is an ownership
 * claim, not an error.** "The imported body is read-only" is unenforceable — the
 * Inbox is a Markdown file and VS Code has no honest way to make part of one
 * read-only — so rather than pretend, or silently overwrite what someone typed,
 * a local edit detaches the item. You edited it here, so it is yours now.
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

    // Processed is a permanent handoff: Markdown owns it and syncing stops.
    if (processedRegion.includes(marker)) {
      return { action: "none", note, why: "processed — Markdown owns it now" };
    }

    const existing = pendingRegion
      .split("\n")
      .find((line) => line.includes(marker));

    if (!existing) return { action: "create", note, line: lineFor(note) };

    const remembered = state.lastImported.get(note.id);
    if (remembered && existing.trim() !== remembered.text.trim()) {
      return {
        action: "went-native",
        note,
        why: "edited here since it was imported, so this item is now ours",
      };
    }

    if (remembered && remembered.modified === note.modified) {
      return { action: "none", note, why: "unchanged" };
    }

    // Rich content is pull-only in principle and unwritable in practice; we still
    // refresh the text we can read, because nothing is ever written back.
    return { action: "update", note, line: lineFor(note) };
  });
}

/** Apply an import plan, through the capture mutation for anything new. */
export async function applyImport(
  vault: Vault,
  inboxPage: string,
  decisions: ImportDecision[],
  state: ImportState,
): Promise<{ created: number; updated: number; detached: number }> {
  let created = 0, updated = 0, detached = 0;

  for (const decision of decisions) {
    if (decision.action === "create") {
      const result = await capture(vault, decision.line, inboxPage);
      if (result.ok) {
        created++;
        state.lastImported.set(decision.note.id, {
          text: decision.line, modified: decision.note.modified,
        });
      }
    } else if (decision.action === "update") {
      const path = `${inboxPage}.md`;
      if (!vault.exists(path)) continue;
      const text = vault.read(path);

      /**
       * Find the mirrored line by its marker, not by what we remember writing.
       *
       * `lastImported` is in-memory and empty after a restart, so requiring it
       * meant a note edited on the phone never reached its mirror again — the
       * import looked healthy and quietly stopped working. The `[source-id: …]`
       * marker is in the file, which is the point of putting it there.
       */
      const remembered = state.lastImported.get(decision.note.id);
      const marker = `[source-id: "${decision.note.id}"]`;
      const lines = text.split("\n");
      const at = remembered
        ? lines.findIndex((l) => l.trim() === remembered.text.trim())
        : lines.findIndex((l) => l.includes(marker));
      if (at === -1) continue;

      lines[at] = decision.line;
      const next = lines.join("\n");
      if (next !== text) {
        await vault.write(path, next);
        updated++;
        state.lastImported.set(decision.note.id, {
          text: decision.line, modified: decision.note.modified,
        });
      }
    } else if (decision.action === "went-native") {
      // Drop the binding, keep `[source:]` as provenance. Later note edits stop
      // flowing in; the note itself is untouched.
      state.lastImported.delete(decision.note.id);
      detached++;
    }
  }

  return { created, updated, detached };
}
