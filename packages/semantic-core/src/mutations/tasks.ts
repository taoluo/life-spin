import {
  applied, changeSet, refuse, resolveHandle, type MutationResult, type SourceHandle,
} from "../mutation.ts";
import type { Vault } from "../vault.ts";
import { parseMarkdown } from "../../../../vendor/silverbullet/client/markdown_parser/parser.ts";
import { collectNodesOfType } from "../../../../vendor/silverbullet/plug-api/lib/tree.ts";

const MARKER = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([^\[\]\r\n]+)(\].*)$/;

/** `[completed: "2026-09-08"]`, the shape LifeLoop already writes. */
const COMPLETED = /\s*\[completed:\s*"[^"]*"\]/;

/** Named `isoDate` rather than `today` — `today()` is the projection, and one of
 * them meaning "a date string" while the other means "what is due" is a collision
 * waiting to be imported wrongly. */
export const isoDate = (now = new Date()) => {
  // The local calendar date, not UTC's — see `day()` in projections.ts. Stamping
  // a completion with a date the user has not reached is a recorded fact that is
  // simply wrong.
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

const replaceLine = (text: string, start: number, end: number, line: string) =>
  text.slice(0, start) + line + text.slice(end);

/**
 * Tick or untick a task, and stamp or unstamp its completion date.
 *
 * `DESIGN.md`: a task owns its own completion date, and historical facts are
 * recorded rather than reconstructed. Ticking stamps today; unticking removes the
 * stamp. A task that is *already* done is refused rather than re-stamped — the
 * case `test/suite.lua` guards, where a checkbox ticked before any of this existed
 * would otherwise acquire today's date as if it had just happened.
 */
export async function setTaskState(
  vault: Vault,
  handle: SourceHandle,
  done: boolean,
  now = new Date(),
  states: CycleStates = DEFAULT_CYCLE,
): Promise<MutationResult<{ line: string }>> {
  const source = resolveHandle(vault, handle);
  if ("ok" in source) return source;

  const marker = MARKER.exec(source.line);
  if (!marker) return refuse("stale", `${handle.ref} is not a task line`);

  const [, open, state, rest] = marker;
  validateTaskStates(states);
  if (state.length > 1 && !states.some(s => s.state === state)) {
    return refuse("invalid", `undeclared task state: ${state}`);
  }
  if (isTaskDone(state, states) === done) {
    return refuse("stale", `${handle.ref} is already ${done ? "done" : "open"}`);
  }

  let tail = rest.replace(COMPLETED, "");
  if (done) tail = `${tail} [completed: "${isoDate(now)}"]`;
  const line = `${open}${done ? "x" : " "}${tail}`;

  const cs = changeSet(`${done ? "complete" : "reopen"} ${handle.ref}`);
  cs.expected.set(source.path, source.text);
  cs.writes.set(source.path, replaceLine(source.text, source.lineStart, source.lineEnd, line));
  return applied(vault, cs, { line });
}

/**
 * Stamp a completion that happened elsewhere.
 *
 * Used by the Reminders reverse flow (2b), where the date is the one Reminders
 * reported or — when it reports none — the date we observed it, never a value in
 * between. A task already carrying a stamp is refused rather than overwritten.
 */
export async function stampCompletion(
  vault: Vault,
  handle: SourceHandle,
  date: string,
  states: CycleStates = DEFAULT_CYCLE,
): Promise<MutationResult<{ line: string }>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return refuse("invalid", `not a date: ${date}`);
  const source = resolveHandle(vault, handle);
  if ("ok" in source) return source;

  const marker = MARKER.exec(source.line);
  if (!marker) return refuse("stale", `${handle.ref} is not a task line`);
  validateTaskStates(states);
  if (marker[2].length > 1 && !states.some(s => s.state === marker[2])) {
    return refuse("invalid", `undeclared task state: ${marker[2]}`);
  }
  if (COMPLETED.test(marker[3])) {
    return refuse("stale", `${handle.ref} already carries a completion date`);
  }

  const line = `${marker[1]}x${marker[3]} [completed: "${date}"]`;
  const cs = changeSet(`stamp ${handle.ref} completed ${date}`);
  cs.expected.set(source.path, source.text);
  cs.writes.set(source.path, replaceLine(source.text, source.lineStart, source.lineEnd, line));
  return applied(vault, cs, { line });
}

/**
 * Cycle a task through a declared set of states.
 *
 * The interaction argument for custom states is simply right: one click beats a
 * command, and `[ ] → [w] → [x]` is how people think about a task moving. LifeLoop
 * originally refused them because in SilverBullet clicking cycles among the custom
 * states and *never reaches done* — but that is a property of its click handler,
 * and this one is ours.
 *
 * So the cycle is defined here, and `done` is always in it. The one real cost
 * stands and is not hidden: `* [w] thing` is not a checkbox to any other Markdown
 * tool — GitHub, Obsidian and the rest render it as literal text. That is the
 * portability trade, made deliberately rather than discovered.
 */
export type CycleStates = { state: string; done?: boolean }[];

export const DEFAULT_CYCLE: CycleStates = [{ state: " " }, { state: "x", done: true }];

/** Ambiguous duplicate definitions must not produce different index/mutation semantics. */
export function validateTaskStates(states: CycleStates): void {
  const seen = new Set<string>();
  for (const spec of states) {
    if (typeof spec.state !== "string" || !spec.state.length || /[\[\]\r\n]/.test(spec.state)) {
      throw new Error("invalid task state marker");
    }
    if (seen.has(spec.state)) throw new Error(`duplicate task state: ${spec.state}`);
    seen.add(spec.state);
  }
}

/** Same completion predicate as LifeLoop/Completion.md and SB indexing. */
export function isTaskDone(state: string, states: CycleStates = DEFAULT_CYCLE): boolean {
  validateTaskStates(states);
  return state === "x" || state === "X" || states.some(s => s.state === state && s.done === true);
}


export async function cycleTaskState(
  vault: Vault,
  handle: SourceHandle,
  states: CycleStates = DEFAULT_CYCLE,
  now = new Date(),
): Promise<MutationResult<{ line: string; state: string }>> {
  const cycle = states.length ? states : DEFAULT_CYCLE;
  // Whatever a vault declares, finishing must always be reachable.
  const full = cycle.some((s) => isTaskDone(s.state, cycle)) ? cycle : [...cycle, { state: "x", done: true }];

  const source = resolveHandle(vault, handle);
  if ("ok" in source) return source;

  const marker = MARKER.exec(source.line);
  if (!marker) return refuse("stale", `${handle.ref} is not a task line`);
  const [, open, current, rest] = marker;

  if (current.length > 1 && !full.some(s => s.state === current)) {
    return refuse("invalid", `undeclared task state: ${current}`);
  }
  const at = full.findIndex((s) => s.state === current);
  const next = full[(at + 1) % full.length];

  let tail = rest.replace(COMPLETED, "");
  if (isTaskDone(next.state, full)) tail = `${tail} [completed: "${isoDate(now)}"]`;
  const line = `${open}${next.state}${tail}`;

  const cs = changeSet(`cycle ${handle.ref} to '${next.state}'`);
  cs.expected.set(source.path, source.text);
  cs.writes.set(source.path, replaceLine(source.text, source.lineStart, source.lineEnd, line));
  return applied(vault, cs, { line, state: next.state });
}

export const PARK_TAGS = ["waiting", "someday"] as const;
export type ParkTag = (typeof PARK_TAGS)[number];

/**
 * Add or remove `#waiting` / `#someday` **on the task's own line**.
 *
 * Parked state is *read* with inheritance — a marked parent covers its children —
 * but toggling is not. Removing a tag the line never had would silently do
 * nothing, so this reports what it did rather than pretending.
 */
export async function toggleParked(
  vault: Vault,
  handle: SourceHandle,
  tag: ParkTag,
): Promise<MutationResult<{ line: string; added: boolean }>> {
  const source = resolveHandle(vault, handle);
  if ("ok" in source) return source;
  if (!MARKER.test(source.line)) return refuse("stale", `${handle.ref} is not a task line`);

  const pattern = new RegExp(`\\s*#${tag}\\b`);
  const present = pattern.test(source.line);
  const line = present ? source.line.replace(pattern, "") : `${source.line} #${tag}`;

  const cs = changeSet(`${present ? "un" : ""}mark ${handle.ref} #${tag}`);
  cs.expected.set(source.path, source.text);
  cs.writes.set(source.path, replaceLine(source.text, source.lineStart, source.lineEnd, line));
  return applied(vault, cs, { line, added: !present });
}

/** Set or clear a task attribute — `deadline`, `scheduled`, or an external binding. */
export async function setTaskAttribute(
  vault: Vault,
  handle: SourceHandle,
  name: string,
  value: string | null,
): Promise<MutationResult<{ line: string }>> {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return refuse("invalid", `not an attribute name: ${name}`);
  const source = resolveHandle(vault, handle);
  if ("ok" in source) return source;
  if (!MARKER.test(source.line)) return refuse("stale", `${handle.ref} is not a task line`);

  const existing = new RegExp(`\\s*\\[${name}:\\s*"[^"]*"\\]`, "g");
  if ([...source.line.matchAll(existing)].length > 1) {
    return refuse("ambiguous", `${handle.ref} carries more than one ${name} attribute`);
  }
  const stripped = source.line.replace(existing, "");
  const line = value === null ? stripped : `${stripped} [${name}: "${value}"]`;

  const cs = changeSet(`set ${name} on ${handle.ref}`);
  cs.expected.set(source.path, source.text);
  cs.writes.set(source.path, replaceLine(source.text, source.lineStart, source.lineEnd, line));
  return applied(vault, cs, { line });
}

/** Replace only the task's visible title, preserving its checkbox and trailing metadata. */
export async function setTaskName(
  vault: Vault,
  handle: SourceHandle,
  name: string,
): Promise<MutationResult<{ line: string }>> {
  const title = name.trim();
  if (!title || /[\r\n]/.test(title)) return refuse("invalid", "task name must be one line");
  const source = resolveHandle(vault, handle);
  if ("ok" in source) return source;
  const marker = MARKER.exec(source.line);
  if (!marker) return refuse("stale", `${handle.ref} is not a task line`);

  const bodyFrom = marker[1].length + marker[2].length + 1;
  const metadata = ["Hashtag", "Attribute", "NamedAnchor"].flatMap((type) =>
    collectNodesOfType(parseMarkdown(source.line), type)
      .filter((node) => node.from !== undefined && node.to !== undefined)
      .map((node) => [node.from!, node.to!] as const));
  const isMetadata = (offset: number) => metadata.some(([from, to]) => offset >= from && offset < to);
  const visible: number[] = [];
  for (let offset = bodyFrom; offset < source.line.length; offset++) {
    if (!/\s/u.test(source.line[offset]) && !isMetadata(offset)) visible.push(offset);
  }
  if (!visible.length) return refuse("invalid", `${handle.ref} has no visible task name`);
  const from = visible[0];
  const to = visible.at(-1)! + 1;
  if (metadata.some(([start, end]) => start < to && end > from)) {
    return refuse("ambiguous", `${handle.ref} has metadata inside its task name`);
  }
  const line = source.line.slice(0, from) + title + source.line.slice(to);
  const cs = changeSet(`rename ${handle.ref}`);
  cs.expected.set(source.path, source.text);
  cs.writes.set(source.path, replaceLine(source.text, source.lineStart, source.lineEnd, line));
  return applied(vault, cs, { line });
}

const taskMetadataSuffix = (rest: string) =>
  rest.match(/((?:\s+(?:#[\p{L}\p{N}_/-]+|\[[a-z][a-z0-9-]*:\s*"[^"]*"\]))+)\s*$/u)?.[1] ?? "";

/** Current visible title from a source line; used to close bridge read/write races. */
export function taskNameFromLine(line: string): string | null {
  const marker = MARKER.exec(line);
  if (!marker) return null;
  const rest = marker[3].replace(/^\]\s*/, "");
  const suffix = taskMetadataSuffix(rest);
  return rest.slice(0, rest.length - suffix.length).trim();
}
