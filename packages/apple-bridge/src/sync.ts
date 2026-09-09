import {
  setTaskState, stampCompletion, setTaskAttribute, setTaskName, tasks as taskQueries,
  type Vault, type Store, type LifeloopObject, type CycleStates,
  type GuardedSourceHandle, type MutationResult,
} from "@lifeloop/semantic-core";
import { Reminders, type Reminder } from "./reminders.ts";
import { reconcile, type BoundTask, type Decision, type Observation } from "./reconcile.ts";
import { locateReminderByBinding, pageOfRef } from "./locate.ts";

/**
 * The sync pass: decide, then act — and act only through named mutations.
 *
 * Nothing here writes a file. Every change to the vault goes through the same
 * mutation API the UI and (eventually) an assistant use, which is what makes the
 * external path no more privileged than any other writer.
 */

export type SyncReport = {
  completed: string[];
  reopened: string[];
  pushed: string[];
  pulled: string[];
  marksCleared: string[];
  recurring: string[];
  conflicts: { ref: string; reminderId: string; local: string; remote: string; reason: string }[];
  refused: { ref: string; message: string }[];
  skipped: number;
};

/** Where "what did we see last time" lives — derived, and safe to lose. */
export interface ObservationStore {
  get(reminderId: string): Observation | undefined;
  set(reminderId: string, observation: Observation): void;
  delete(reminderId: string): void;
}

export class MemoryObservations implements ObservationStore {
  private readonly map = new Map<string, Observation>();
  get(id: string) { return this.map.get(id); }
  set(id: string, o: Observation) { this.map.set(id, o); }
  delete(id: string) { this.map.delete(id); }
  entries() { return [...this.map.entries()]; }
}

/** Tasks carrying a `[reminder: "..."]` mark, with what the reconciler needs. */
export function boundTasks(store: Store): BoundTask[] {
  return taskQueries
    .universe(store)
    .filter((t: LifeloopObject) => typeof t.reminder === "string" && t.reminder)
    .map((t: LifeloopObject) => ({
      ref: String(t.ref),
      name: String(t.name ?? "").trim(),
      reminderId: String(t.reminder),
      done: t.done === true,
      completed: typeof t.completed === "string" ? t.completed : null,
      pageModified: typeof t.pageLastModified === "string" ? t.pageLastModified : null,
    }));
}

export type SyncOptions = {
  store: Store;
  vault: Vault;
  reminders?: Reminders;
  observations: ObservationStore;
  observedOn?: string;
  taskStates?: CycleStates;
  /** Rechecked after external reads, immediately before a state-changing write. */
  isTaskPolicyCurrent?: () => boolean | Promise<boolean>;
  /** Told about a recurring binding, so the mismatch is visible rather than silent. */
  onRecurring?: (task: BoundTask) => void;
};

/**
 * One pass at a time.
 *
 * A pass can outlast its own interval — AppleScript is slow, and a vault with
 * many bindings makes it slower — so a timer tick landing on top of a manual sync
 * ran both against the same stale reads and acted twice. The Lua implementation
 * guarded this; the port dropped it.
 *
 * The second caller is told, rather than silently doing nothing: a command that
 * appears to have been ignored is worse than one that says it is already running.
 */
let inFlight: Promise<SyncReport> | null = null;

export function syncInProgress(): boolean {
  return inFlight !== null;
}

export async function syncReminders(options: SyncOptions): Promise<SyncReport> {
  if (inFlight) return inFlight;
  inFlight = runSync(options).finally(() => { inFlight = null; });
  return inFlight;
}

async function runSync(options: SyncOptions): Promise<SyncReport> {
  const bridge = options.reminders ?? new Reminders();
  const bound = boundTasks(options.store);
  const report: SyncReport = {
    completed: [], reopened: [], pushed: [], pulled: [], marksCleared: [],
    recurring: [], conflicts: [], refused: [], skipped: 0,
  };
  if (bound.length === 0) return report;

  const byReminder = new Map<string, BoundTask[]>();
  for (const task of bound) {
    const tasks = byReminder.get(task.reminderId) ?? [];
    tasks.push(task);
    byReminder.set(task.reminderId, tasks);
  }
  const duplicateIds = new Set(
    [...byReminder].filter(([, tasks]) => tasks.length > 1).map(([id]) => id),
  );
  for (const id of duplicateIds) {
    for (const task of byReminder.get(id)!) {
      report.refused.push({ ref: task.ref, message: `Reminder ${id} is bound to multiple tasks` });
    }
  }
  const eligible = bound.filter((task) => !duplicateIds.has(task.reminderId));
  if (eligible.length === 0) return report;

  const current: Map<string, Reminder> = await bridge.read(eligible.map((t) => t.reminderId));
  const lastSeen = new Map<string, Observation>();
  for (const task of eligible) {
    const seen = options.observations.get(task.reminderId);
    if (seen) lastSeen.set(task.reminderId, seen);
  }

  const decisions = reconcile({
    tasks: eligible,
    reminders: current,
    lastSeen,
    observedOn: options.observedOn ?? new Date().toISOString().slice(0, 10),
  });
  const synchronizedNames = new Map<string, string>();
  const confirmedLines = new Map<string, { page: string; ref: string; line: string }>();
  const unsettled = new Set<string>(duplicateIds);

  const refuseDecision = (ref: string, reminderId: string, message: string) => {
    unsettled.add(reminderId);
    report.refused.push({ ref, message });
  };
  const note = (result: MutationResult<{ line: string }>, ref: string, reminderId: string, onOk: () => void) => {
    if (!result.ok) {
      refuseDecision(ref, reminderId, result.message);
      return;
    }
    const page = pageOfRef(ref);
    const current = locateReminderByBinding(options.vault, page, reminderId);
    if (!current.ok || current.line !== result.value.line) {
      refuseDecision(ref, reminderId, current.ok ? "Markdown changed during sync" : current.message);
      return;
    }
    confirmedLines.set(reminderId, { page, ref, line: current.line });
    onOk();
  };

  for (const decision of decisions) {
    const task = eligible.find((t) => t.ref === decision.ref)!;

    /**
     * Re-locate by the binding, immediately before writing.
     *
     * The ref in a decision came from the index, which is a *stale offset*: the
     * page may have changed since, and an earlier write in this same pass shifts
     * every later offset on that page. Carrying only the position let reminder R1's
     * completion check off the task bound to R2 — reproduced, then fixed here.
     *
     * Every decision needs the same unique live binding before effects or
     * observation advancement.
     */
    const writes = decision.action === "complete" || decision.action === "reopen" || decision.action === "pull-name" ||
      decision.action === "clear-mark";
    let handle: GuardedSourceHandle | null = null;

    if ((decision.action === "complete" || decision.action === "reopen") &&
        options.isTaskPolicyCurrent && !(await options.isTaskPolicyCurrent())) {
      refuseDecision(decision.ref, decision.reminderId, "task-state policy changed during sync");
      continue;
    }
    const found = locateReminderByBinding(options.vault, pageOfRef(decision.ref), task.reminderId);
    if (!found.ok) {
      refuseDecision(decision.ref, task.reminderId, found.message);
      continue;
    }
    if (writes) handle = found.handle;

    switch (decision.action) {
      case "complete":
        note(await stampCompletion(options.vault, handle!, decision.date, options.taskStates), decision.ref, decision.reminderId,
             () => report.completed.push(decision.ref));
        break;

      case "reopen":
        note(await setTaskState(options.vault, handle!, false, new Date(), options.taskStates), decision.ref, decision.reminderId,
             () => report.reopened.push(decision.ref));
        break;

      case "clear-mark":
      {
        const result = await setTaskAttribute(options.vault, handle!, "reminder", null);
        if (result.ok) {
          report.marksCleared.push(decision.ref);
          options.observations.delete(decision.reminderId);
        } else refuseDecision(decision.ref, decision.reminderId, result.message);
        break;
      }

      case "push": {
        if (found.name !== decision.name) {
          refuseDecision(
            decision.ref,
            decision.reminderId,
            "Markdown changed during sync",
          );
          break;
        }
        const outcome = await bridge.update(
          decision.reminderId, decision.expectedName, decision.name,
        );
        if (outcome === "ok") {
          const current = locateReminderByBinding(options.vault, pageOfRef(decision.ref), decision.reminderId);
          if (current.ok && current.line === found.line) {
            report.pushed.push(decision.ref);
            synchronizedNames.set(decision.reminderId, decision.name);
            confirmedLines.set(decision.reminderId, {
              page: pageOfRef(decision.ref), ref: decision.ref, line: current.line,
            });
          } else {
            refuseDecision(decision.ref, decision.reminderId,
              current.ok ? "Markdown changed during sync" : current.message);
          }
        } else {
          refuseDecision(
            decision.ref,
            decision.reminderId,
            outcome === "gone" ? "Reminder disappeared during sync" : "Reminder changed during sync",
          );
        }
        break;
      }

      case "flag-recurring":
        report.recurring.push(decision.ref);
        options.onRecurring?.(task);
        confirmedLines.set(decision.reminderId, {
          page: pageOfRef(decision.ref), ref: decision.ref, line: found.line,
        });
        break;

      case "conflict":
        unsettled.add(decision.reminderId);
        report.conflicts.push({ ref: decision.ref, reminderId: decision.reminderId,
          local: decision.local, remote: decision.remote, reason: decision.why });
        break;

      case "pull-name":
        if (found.name !== task.name) {
          refuseDecision(decision.ref, decision.reminderId, "Markdown changed during sync");
        } else {
          note(await setTaskName(options.vault, handle!, decision.name), decision.ref, decision.reminderId,
            () => { report.pulled.push(decision.ref); synchronizedNames.set(decision.reminderId, decision.name); });
        }
        break;

      case "none":
        report.skipped++;
        confirmedLines.set(task.reminderId, {
          page: pageOfRef(decision.ref), ref: decision.ref, line: found.line,
        });
        break;
    }
  }

  // Record what we saw *after* acting, so the next pass compares against the state
  // this one reasoned about rather than one it never observed.
  const flagged = new Set(
    decisions.filter((d) => d.action === "flag-recurring").map((d) => (d as any).reminderId),
  );
  for (const [id, reminder] of current) {
    if (unsettled.has(id)) continue;
    const receipt = confirmedLines.get(id);
    if (!receipt) {
      refuseDecision(eligible.find((task) => task.reminderId === id)?.ref ?? id, id,
        "Markdown was not confirmed during sync");
      continue;
    }
    const confirmed = locateReminderByBinding(options.vault, receipt.page, id);
    if (!confirmed.ok || confirmed.line !== receipt.line) {
      refuseDecision(receipt.ref, id, confirmed.ok ? "Markdown changed during sync" : confirmed.message);
      continue;
    }
    const previous = options.observations.get(id);
    options.observations.set(id, {
      completed: reminder.completed,
      modificationDate: reminder.modificationDate,
      name: synchronizedNames.get(id) ?? reminder.name,
      // One-way: a binding never becomes trustworthy again on its own.
      suspectedRecurring: previous?.suspectedRecurring || flagged.has(id),
    });
  }

  return report;
}

export async function resolveReminderConflict(options: {
  vault: Vault;
  page: string;
  reminderId: string;
  choice: "reminders" | "markdown" | "detach";
  expectedLocal: string;
  expectedRemote: string;
  observations: ObservationStore;
  reminders?: Pick<Reminders, "read" | "update">;
}): Promise<MutationResult<unknown>> {
  const located = locateReminderByBinding(options.vault, options.page, options.reminderId);
  if (!located.ok) return { ok: false, reason: located.reason, message: located.message };
  const local = located.name;
  if (local !== options.expectedLocal) return { ok: false, reason: "stale", message: "Markdown changed after the conflict was shown" };
  if (options.choice === "detach") {
    const result = await setTaskAttribute(options.vault, located.handle, "reminder", null);
    if (result.ok) options.observations.delete(options.reminderId);
    return result;
  }
  const bridge = options.reminders ?? new Reminders();
  const remote = (await bridge.read([options.reminderId])).get(options.reminderId);
  if (!remote) return { ok: false, reason: "missing", message: "Reminder is missing; Detach keeps the Markdown task" };
  if (remote.name !== options.expectedRemote) return { ok: false, reason: "stale", message: "Reminder changed after the conflict was shown" };
  const currentLocal = locateReminderByBinding(options.vault, options.page, options.reminderId);
  if (!currentLocal.ok) return { ok: false, reason: currentLocal.reason, message: currentLocal.message };
  if (currentLocal.line !== located.line) {
    return { ok: false, reason: "stale", message: "Markdown changed during conflict resolution" };
  }
  if (options.choice === "reminders") {
    const result = await setTaskName(options.vault, currentLocal.handle, remote.name);
    if (result.ok) {
      const current = locateReminderByBinding(options.vault, options.page, options.reminderId);
      if (!current.ok) return { ok: false, reason: current.reason, message: current.message };
      if (current.line !== result.value.line) {
        return { ok: false, reason: "stale", message: "Markdown changed during conflict resolution" };
      }
      options.observations.set(options.reminderId, { completed: remote.completed, modificationDate: remote.modificationDate, name: remote.name });
    }
    return result;
  }
  const outcome = await bridge.update(options.reminderId, options.expectedRemote, local);
  if (outcome === "gone") return { ok: false, reason: "missing", message: "Reminder disappeared during resolution" };
  if (outcome === "conflict") return { ok: false, reason: "stale", message: "Reminder changed during conflict resolution" };
  const confirmed = locateReminderByBinding(options.vault, options.page, options.reminderId);
  if (!confirmed.ok) return { ok: false, reason: confirmed.reason, message: confirmed.message };
  if (confirmed.line !== currentLocal.line) {
    return { ok: false, reason: "stale", message: "Markdown changed during conflict resolution" };
  }
  options.observations.set(options.reminderId, { completed: remote.completed, modificationDate: null, name: local });
  return { ok: true, changed: [], value: undefined };
}
