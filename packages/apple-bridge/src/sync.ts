import {
  setTaskState, stampCompletion, setTaskAttribute, tasks as taskQueries,
  type Vault, type Store, type LifeloopObject, type Refusal,
} from "@lifeloop/semantic-core";
import { Reminders, type Reminder } from "./reminders.ts";
import { reconcile, type BoundTask, type Decision, type Observation } from "./reconcile.ts";
import { locateByBinding, pageOfRef } from "./locate.ts";

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
  marksCleared: string[];
  recurring: string[];
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
    completed: [], reopened: [], pushed: [], marksCleared: [],
    recurring: [], refused: [], skipped: 0,
  };
  if (bound.length === 0) return report;

  const current: Map<string, Reminder> = await bridge.read(bound.map((t) => t.reminderId));
  const lastSeen = new Map<string, Observation>();
  for (const task of bound) {
    const seen = options.observations.get(task.reminderId);
    if (seen) lastSeen.set(task.reminderId, seen);
  }

  const decisions = reconcile({
    tasks: bound,
    reminders: current,
    lastSeen,
    observedOn: options.observedOn ?? new Date().toISOString().slice(0, 10),
  });

  const note = (result: { ok: true } | Refusal, ref: string, onOk: () => void) => {
    if (result.ok) onOk();
    else report.refused.push({ ref, message: result.message });
  };

  for (const decision of decisions) {
    const task = bound.find((t) => t.ref === decision.ref)!;

    /**
     * Re-locate by the binding, immediately before writing.
     *
     * The ref in a decision came from the index, which is a *stale offset*: the
     * page may have changed since, and an earlier write in this same pass shifts
     * every later offset on that page. Carrying only the position let reminder R1's
     * completion check off the task bound to R2 — reproduced, then fixed here.
     *
     * Only the three actions that write need this; `push` talks to Reminders and
     * `flag-recurring` writes nothing.
     */
    const writes = decision.action === "complete" || decision.action === "reopen" ||
      decision.action === "clear-mark";
    let handle: { ref: string; expectedText?: string; expectedState?: string; capturedAt: string } | null = null;

    if (writes) {
      const found = locateByBinding(
        options.vault, pageOfRef(decision.ref), "reminder", task.reminderId,
      );
      if (!found.ok) {
        report.refused.push({ ref: decision.ref, message: found.message });
        continue;
      }
      handle = found.handle as any;
    }

    switch (decision.action) {
      case "complete":
        note(await stampCompletion(options.vault, handle!, decision.date), decision.ref,
             () => report.completed.push(decision.ref));
        break;

      case "reopen":
        note(await setTaskState(options.vault, handle!, false), decision.ref,
             () => report.reopened.push(decision.ref));
        break;

      case "clear-mark":
        note(await setTaskAttribute(options.vault, handle!, "reminder", null), decision.ref,
             () => report.marksCleared.push(decision.ref));
        options.observations.delete(decision.reminderId);
        break;

      case "push": {
        const ok = await bridge.update(decision.reminderId, decision.name, decision.body);
        if (ok) report.pushed.push(decision.ref);
        // A push that finds nothing is the deleted case; the next pass clears it.
        break;
      }

      case "flag-recurring":
        report.recurring.push(decision.ref);
        options.onRecurring?.(task);
        break;

      case "none":
        report.skipped++;
        break;
    }
  }

  // Record what we saw *after* acting, so the next pass compares against the state
  // this one reasoned about rather than one it never observed.
  const flagged = new Set(
    decisions.filter((d) => d.action === "flag-recurring").map((d) => (d as any).reminderId),
  );
  for (const [id, reminder] of current) {
    const previous = options.observations.get(id);
    options.observations.set(id, {
      completed: reminder.completed,
      modificationDate: reminder.modificationDate,
      // One-way: a binding never becomes trustworthy again on its own.
      suspectedRecurring: previous?.suspectedRecurring || flagged.has(id),
    });
  }

  return report;
}
