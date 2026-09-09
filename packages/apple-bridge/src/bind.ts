import { resolveHandle, setTaskAttribute, type Vault, type GuardedSourceHandle, type MutationResult } from "@lifeloop/semantic-core";
import type { Reminders } from "./reminders.ts";
import type { Calendar } from "./calendar.ts";

const strictTaskSource = (vault: Vault, handle: GuardedSourceHandle) => {
  const source = resolveHandle(vault, handle);
  if ("ok" in source) return source;
  const numeric = /@(\d+)$/.exec(handle.ref);
  return numeric && source.lineStart !== Number(numeric[1])
    ? { ok: false as const, reason: "stale" as const, message: `${handle.ref} no longer starts at that position` }
    : source;
};

/**
 * Create a reminder and bind it to a task, or leave nothing behind.
 *
 * Creating the reminder and writing `[reminder: "id"]` are two steps, and the
 * second can refuse — the task may have moved or already carry a binding. Without
 * compensation that leaves a reminder over there with nothing pointing at it:
 * invisible from here, and duplicated the next time you try.
 *
 * So this follows the ordering `DESIGN.md` states for attaching a page to a task,
 * generalised: do the fallible external thing, and undo it if what follows fails.
 * A failed undo is reported rather than swallowed — an orphan you know about is
 * recoverable, one you do not is not.
 */
export async function bindReminder(
  vault: Vault,
  handle: GuardedSourceHandle,
  title: string,
  body: string,
  list: string,
  bridge: Pick<Reminders, "create" | "remove">,
): Promise<MutationResult<{ id: string }> & { orphaned?: string }> {
  const admitted = strictTaskSource(vault, handle);
  if ("ok" in admitted) return admitted;
  const id = await bridge.create(title, body, list);

  let bound: Awaited<ReturnType<typeof setTaskAttribute>>;
  try {
    const current = strictTaskSource(vault, handle);
    if ("ok" in current) bound = current;
    else bound = await setTaskAttribute(vault, handle, "reminder", id);
  } catch (error) {
    return {
      ok: false,
      reason: "unknown",
      message: `${(error as Error).message}. Reminder ${id} was created; its binding outcome is unknown, so it was retained.`,
      orphaned: id,
    };
  }
  if (bound.ok) return { ...bound, value: { id } };
  if (bound.reason === "unknown") {
    return { ...bound, message: `${bound.message}. Reminder ${id} was retained because binding outcome is unknown.`, orphaned: id };
  }

  let removed = false;
  try {
    removed = await bridge.remove(id);
  } catch {
    removed = false;
  }

  return removed
    ? bound
    : {
        ...bound,
        message:
          `${bound.message}. A reminder was created and could not be removed — ` +
          `delete "${title}" in Reminders by hand.`,
        orphaned: id,
      };
}

export async function bindCalendar(
  vault: Vault,
  handle: GuardedSourceHandle,
  title: string,
  start: string,
  end: string,
  calendarName: string,
  bridge: Pick<Calendar, "create" | "remove">,
): Promise<MutationResult<{ id: string }> & { orphaned?: string }> {
  const source = strictTaskSource(vault, handle);
  if ("ok" in source) return source;
  const bindings = source.line.match(/\[event:\s*"[^"]*"\]/g) ?? [];
  if (bindings.length) return { ok: false, reason: bindings.length > 1 ? "ambiguous" : "invalid", message: "task already has a Calendar binding" };
  const id = await bridge.create(title, start, end, calendarName);
  let bound: Awaited<ReturnType<typeof setTaskAttribute>>;
  try {
    const current = strictTaskSource(vault, handle);
    if ("ok" in current) bound = current;
    else bound = await setTaskAttribute(vault, handle, "event", id);
  } catch (error) {
    return { ok: false, reason: "unknown", message: `${(error as Error).message}. Calendar event ${id} was retained because binding outcome is unknown.`, orphaned: id };
  }
  if (bound.ok) return { ...bound, value: { id } };
  if (bound.reason === "unknown") {
    return { ...bound, message: `${bound.message}. Calendar event ${id} was retained because binding outcome is unknown.`, orphaned: id };
  }
  let removed = false;
  try { removed = await bridge.remove(id, calendarName); } catch { /* report orphan below */ }
  return removed ? bound : { ...bound, message: `${bound.message}. Calendar event ${id} could not be removed.`, orphaned: id };
}
