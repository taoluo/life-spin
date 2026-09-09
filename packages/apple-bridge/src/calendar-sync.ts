import {
  setTaskAttribute, setTaskName, taskNameFromLine, tasks as taskQueries,
  type LifeloopObject, type Store, type Vault,
} from "@lifeloop/semantic-core";
import { Calendar } from "./calendar.ts";
import { locateByBinding, pageOfRef } from "./locate.ts";

export type CalendarObservation = { localName: string; remoteSummary: string };
export interface CalendarObservationStore {
  get(uid: string): CalendarObservation | undefined;
  set(uid: string, value: CalendarObservation): void;
  delete(uid: string): void;
}

export type CalendarSyncReport = {
  pulled: string[];
  pushed: string[];
  detached: string[];
  conflicts: { ref: string; uid: string; local: string; remote: string; reason: string }[];
  settled: string[];
  refused: { ref: string; message: string }[];
  skipped: number;
};

export async function syncCalendar(options: {
  store: Store;
  vault: Vault;
  calendarName: string;
  observations: CalendarObservationStore;
  calendar?: Pick<Calendar, "read" | "updateSummary">;
}): Promise<CalendarSyncReport> {
  const tasks = taskQueries.universe(options.store)
    .filter((task: LifeloopObject) => typeof task.event === "string" && task.event)
    .map((task: LifeloopObject) => ({
      ref: String(task.ref), uid: String(task.event), name: String(task.name ?? "").trim(),
    }));
  const report: CalendarSyncReport = { pulled: [], pushed: [], detached: [], conflicts: [], settled: [], refused: [], skipped: 0 };
  if (!tasks.length) return report;

  const bridge = options.calendar ?? new Calendar();
  const live = await bridge.read(tasks.map((task) => task.uid), options.calendarName);
  for (const task of tasks) {
    const event = live.get(task.uid);
    const located = locateByBinding(options.vault, pageOfRef(task.ref), "event", task.uid);
    if (!located.ok) {
      report.refused.push({ ref: task.ref, message: located.message });
      continue;
    }
    const currentName = taskNameFromLine(located.line);
    if (currentName === null) {
      report.refused.push({ ref: task.ref, message: "bound source is no longer a task" });
      continue;
    }
    if (!event) {
      report.conflicts.push({ ref: task.ref, uid: task.uid, local: currentName, remote: "", reason: "event is missing" });
      continue;
    }

    const before = options.observations.get(task.uid);
    if (!before) {
      if (currentName === event.summary) {
        options.observations.set(task.uid, { localName: currentName, remoteSummary: event.summary });
        report.settled.push(task.uid);
        report.skipped++;
      } else {
        report.conflicts.push({ ref: task.ref, uid: task.uid, local: currentName, remote: event.summary, reason: "sync baseline is unavailable" });
      }
      continue;
    }
    const localChanged = currentName !== before.localName;
    const remoteChanged = event.summary !== before.remoteSummary;
    if (localChanged && remoteChanged && currentName === event.summary) {
      options.observations.set(task.uid, { localName: currentName, remoteSummary: event.summary });
      report.settled.push(task.uid);
      report.skipped++;
      continue;
    }
    if (!localChanged && !remoteChanged) { report.skipped++; report.settled.push(task.uid); continue; }

    if (localChanged && remoteChanged) {
      report.conflicts.push({ ref: task.ref, uid: task.uid, local: currentName, remote: event.summary, reason: "both Calendar and Markdown changed" });
      continue;
    }
    if (remoteChanged) {
      const result = await setTaskName(options.vault, located.handle, event.summary);
      if (result.ok) {
        report.pulled.push(task.ref);
        report.settled.push(task.uid);
        options.observations.set(task.uid, { localName: event.summary, remoteSummary: event.summary });
      } else report.refused.push({ ref: task.ref, message: result.message });
      continue;
    }

    const outcome = await bridge.updateSummary(task.uid, options.calendarName, event.summary, currentName);
    if (outcome === "ok") {
      report.pushed.push(task.ref);
      report.settled.push(task.uid);
      options.observations.set(task.uid, { localName: currentName, remoteSummary: currentName });
    } else {
      report.conflicts.push({ ref: task.ref, uid: task.uid, local: currentName, remote: event.summary, reason: outcome === "gone" ? "event is missing" : "event changed during sync" });
    }
  }
  return report;
}

export async function resolveCalendarConflict(options: {
  vault: Vault;
  page: string;
  uid: string;
  calendarName: string;
  choice: "calendar" | "markdown" | "detach";
  expectedLocal: string;
  expectedRemote: string;
  observations: CalendarObservationStore;
  calendar?: Pick<Calendar, "read" | "updateSummary">;
}) {
  const located = locateByBinding(options.vault, options.page, "event", options.uid);
  if (!located.ok) return { ok: false as const, reason: located.reason, message: located.message };
  const local = taskNameFromLine(located.line);
  if (local === null) return { ok: false as const, reason: "stale" as const, message: "bound source is no longer a task" };
  if (local !== options.expectedLocal) return { ok: false as const, reason: "stale" as const, message: "Markdown changed after the conflict was shown" };
  if (options.choice === "detach") {
    const result = await setTaskAttribute(options.vault, located.handle, "event", null);
    if (result.ok) options.observations.delete(options.uid);
    return result;
  }
  const bridge = options.calendar ?? new Calendar();
  const event = (await bridge.read([options.uid], options.calendarName)).get(options.uid);
  if (!event) return { ok: false as const, reason: "missing" as const, message: "Calendar event is missing; Detach keeps the Markdown task" };
  if (event.summary !== options.expectedRemote) return { ok: false as const, reason: "stale" as const, message: "Calendar changed after the conflict was shown" };
  if (options.choice === "calendar") {
    const result = await setTaskName(options.vault, located.handle, event.summary);
    if (result.ok) options.observations.set(options.uid, { localName: event.summary, remoteSummary: event.summary });
    return result;
  }
  const outcome = await bridge.updateSummary(options.uid, options.calendarName, event.summary, local);
  if (outcome !== "ok") return { ok: false as const, reason: outcome === "gone" ? "missing" as const : "stale" as const, message: `Calendar event ${outcome}` };
  options.observations.set(options.uid, { localName: local, remoteSummary: local });
  return { ok: true as const, changed: [], value: undefined };
}
