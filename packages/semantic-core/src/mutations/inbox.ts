import { applied, changeSet, refuse, validPageName, type MutationResult } from "../mutation.ts";
import type { Vault } from "../vault.ts";
import { pathOf } from "../vault.ts";

export const INBOX_PAGE = "Inbox";
const PROCESSED = /^##\s+Processed\s*$/m;

/**
 * Where new input may land.
 *
 * The boundary between pending and processed is a *position in the file*, so
 * writing to the wrong side of it silently marks something done. A captured line
 * goes above `## Processed`, or at the end when there is no such heading.
 */
export function processedOffset(text: string): number | null {
  const match = PROCESSED.exec(text);
  return match ? match.index : null;
}

/** Capture one line into the Inbox, creating the page if it does not exist. */
export async function capture(
  vault: Vault,
  line: string,
  page = INBOX_PAGE,
  expected?: string | null,
): Promise<MutationResult<{ line: string }>> {
  // A capture is one line, and newlines are flattened rather than rejected: text
  // pasted from elsewhere usually carries them, and refusing would lose the
  // thought. Left in, a captured line containing `## Processed` would introduce a
  // second heading and split the Inbox in two — reproduced.
  const trimmed = line.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!trimmed) return refuse("invalid", "nothing to capture");

  const path = pathOf(page);
  const before = vault.exists(path) ? vault.read(path) : null;
  if (expected !== undefined && before !== expected) {
    return refuse("stale", `${path} changed while this capture was being prepared`);
  }
  const text = before ?? "";
  const entry = trimmed.startsWith("* ") || trimmed.startsWith("- ") ? trimmed : `* ${trimmed}`;

  const boundary = processedOffset(text);
  let next: string;
  if (boundary === null) {
    const body = text.length && !text.endsWith("\n") ? `${text}\n` : text;
    next = `${body}${entry}\n`;
  } else {
    const before = text.slice(0, boundary).replace(/\n+$/, "\n");
    next = `${before}${entry}\n\n${text.slice(boundary)}`;
  }

  const cs = changeSet(`capture into ${page}`);
  cs.expected.set(path, before);
  cs.writes.set(path, next);
  return applied(vault, cs, { line: entry });
}

/** Capture one validated top-level item with indented continuation lines. */
export async function captureItem(
  vault: Vault,
  item: string,
  page = INBOX_PAGE,
  expected?: string | null,
): Promise<MutationResult<{ line: string }>> {
  const normalized = item.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  if (!/^[-*+]\s+\S/.test(lines[0]) || lines.slice(1).some((line) => !/^ {2}/.test(line))) {
    return refuse("invalid", "captured item must be one top-level bullet with indented continuation lines");
  }
  const path = pathOf(page);
  const before = vault.exists(path) ? vault.read(path) : null;
  if (expected !== undefined && before !== expected) return refuse("stale", `${path} changed while this capture was being prepared`);
  const text = before ?? "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const entry = normalized.replaceAll("\n", eol);
  const boundary = processedOffset(text);
  const next = boundary === null
    ? `${text.length && !text.endsWith("\n") ? `${text}${eol}` : text}${entry}${eol}`
    : `${text.slice(0, boundary).replace(/(?:\r?\n)+$/, eol)}${entry}${eol}${eol}${text.slice(boundary)}`;
  const cs = changeSet(`capture item into ${page}`);
  cs.expected.set(path, before);
  cs.writes.set(path, next);
  return applied(vault, cs, { line: normalized });
}

/** Create the configured Inbox without allowing a concurrent page to be overwritten. */
export async function ensureInbox(
  vault: Vault,
  page = INBOX_PAGE,
): Promise<MutationResult<{ page: string; existed: boolean }>> {
  if (!validPageName(page)) return refuse("invalid", `not a page name: ${page}`);
  const path = pathOf(page);
  if (vault.exists(path)) {
    return { ok: true, changed: [], value: { page, existed: true } };
  }
  const cs = changeSet(`create ${page}`);
  cs.expected.set(path, null);
  cs.writes.set(path, "Captured items land here.\n\n");
  return applied(vault, cs, { page, existed: false });
}

/** Insert a task after the captured source line, refusing if the page has moved. */
export async function captureHere(
  vault: Vault,
  page: string,
  offset: number,
  line: string,
  expected: string,
): Promise<MutationResult<{ line: string }>> {
  const trimmed = line.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!trimmed) return refuse("invalid", "nothing to capture");
  const path = pathOf(page);
  if (!vault.exists(path)) return refuse("missing", `no such page: ${page}`);
  const text = vault.read(path);
  if (text !== expected || offset < 0 || offset > text.length) {
    return refuse("stale", `${path} changed while this capture was being prepared`);
  }

  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const entry = `* [ ] ${trimmed}`;
  const prefix = offset > 0 && text[offset - 1] !== "\n" ? eol : "";
  const next = `${text.slice(0, offset)}${prefix}${entry}${eol}${text.slice(offset)}`;
  const cs = changeSet(`capture task in ${page}`);
  cs.expected.set(path, text);
  cs.writes.set(path, next);
  return applied(vault, cs, { line: entry });
}

export type InboxItem = {
  /** Offset of the item's first line. */
  offset: number;
  /** The whole top-level item, nested children included. */
  text: string;
  end: number;
};

const ITEM = /^(\s*)([-*+]|\d+[.)])\s+/;

/**
 * The pending items: top-level list items above `## Processed`.
 *
 * The unit is the *whole* item — a nested child belongs to its parent and moves
 * with it or not at all. Splitting a subtree is how a half-processed state gets
 * created.
 */
export function pending(text: string): InboxItem[] {
  const boundary = processedOffset(text);
  const region = boundary === null ? text : text.slice(0, boundary);
  const lines = region.split("\n");

  const items: InboxItem[] = [];
  let offset = 0;
  let current: { offset: number; lines: string[] } | null = null;

  const close = (end: number) => {
    if (current) {
      items.push({ offset: current.offset, text: current.lines.join("\n"), end });
      current = null;
    }
  };

  for (const line of lines) {
    const match = ITEM.exec(line);
    const isTopLevel = match && match[1].length === 0;
    if (isTopLevel) {
      close(offset);
      current = { offset, lines: [line] };
    } else if (current && (line.trim() === "" || /^\s/.test(line))) {
      current.lines.push(line);
    } else {
      close(offset);
    }
    offset += line.length + 1;
  }
  close(region.length);

  // A trailing blank line belongs to the separation, not the item.
  return items.map((item) => {
    const text = item.text.replace(/\n+$/, "");
    return { ...item, text, end: item.offset + text.length };
  });
}

/**
 * Move one pending item under `## Processed`, optionally rewriting it first.
 *
 * Every precondition is checked before anything is written: the item must still be
 * exactly what was listed. An item that has changed since it was shown is left
 * completely alone — `test/suite.lua`'s "a stale inbox item is left completely
 * alone" is this rule.
 */
export async function processItem(
  vault: Vault,
  item: InboxItem,
  rewritten: string | null,
  page = INBOX_PAGE,
): Promise<MutationResult<{ moved: string }>> {
  const path = pathOf(page);
  if (!vault.exists(path)) return refuse("missing", `no ${page} page`);
  const text = vault.read(path);

  const actual = text.slice(item.offset, item.offset + item.text.length);
  if (actual !== item.text) {
    return refuse("stale", `the item at ${item.offset} is no longer what was listed`);
  }

  const moved = rewritten ?? item.text;
  let body = text.slice(0, item.offset) + text.slice(item.offset + item.text.length);
  body = body.replace(/\n{3,}/g, "\n\n");

  const boundary = processedOffset(body);
  let next: string;
  if (boundary === null) {
    next = `${body.replace(/\n*$/, "\n")}\n## Processed\n\n${moved}\n`;
  } else {
    const head = body.slice(0, boundary);
    const rest = body.slice(boundary);
    const afterHeading = rest.indexOf("\n");
    const heading = afterHeading === -1 ? rest : rest.slice(0, afterHeading + 1);
    const tail = afterHeading === -1 ? "" : rest.slice(afterHeading + 1);
    next = `${head}${heading}\n${moved}\n${tail.replace(/^\n+/, "")}`;
  }

  const cs = changeSet(`process inbox item at ${item.offset}`);
  cs.expected.set(path, text);
  cs.writes.set(path, next);
  return applied(vault, cs, { moved });
}

/** Link an item to a project and move it under Processed — the default action. */
export async function linkToProject(
  vault: Vault,
  item: InboxItem,
  project: string,
  page = INBOX_PAGE,
): Promise<MutationResult<{ moved: string }>> {
  if (!project.trim()) return refuse("invalid", "no project named");
  if (!vault.exists(pathOf(project))) return refuse("missing", `no such project: ${project}`);
  const [first, ...rest] = item.text.split("\n");
  return processItem(vault, item, [`${first} [[${project}]]`, ...rest].join("\n"), page);
}

/** Turn an item into a task and move it under Processed. */
export async function makeTask(
  vault: Vault,
  item: InboxItem,
  page = INBOX_PAGE,
  options: { project?: string; scheduled?: string; waiting?: boolean } = {},
): Promise<MutationResult<{ moved: string }>> {
  const [first, ...rest] = item.text.split("\n");
  if (/^\s*(?:[-*+]|\d+[.)])\s+\[/.test(first)) {
    return refuse("stale", "that item is already a task");
  }
  if (options.project && !vault.exists(pathOf(options.project))) return refuse("missing", `no such project: ${options.project}`);
  let task = first.replace(/^(\s*(?:[-*+]|\d+[.)]))\s+/, "$1 [ ] ");
  if (options.project) task += ` [[${options.project}]]`;
  if (options.scheduled) task += ` [scheduled: "${options.scheduled}"]`;
  if (options.waiting) task += " #waiting";
  return processItem(vault, item, [task, ...rest].join("\n"), page);
}
