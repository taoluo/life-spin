import type { Reminder } from "./reminders.ts";

/**
 * What a sync pass should do, decided as data before anything is written.
 *
 * Keeping the decision separate from the doing is what makes 2b testable without
 * a Mac, and it is where every rule the plan argued for actually lives.
 */

export type BoundTask = {
  /** The task's source handle ref, so any write goes through the mutation API. */
  ref: string;
  name: string;
  /** The stored `[reminder: "..."]` mark. */
  reminderId: string;
  done: boolean;
  /** `[completed: "..."]`, when the task carries one. */
  completed: string | null;
  /** The note's own modification time, for the deference rule. */
  pageModified: string | null;
};

export type Decision =
  | { action: "push"; ref: string; reminderId: string; name: string; body: string }
  | { action: "complete"; ref: string; reminderId: string; date: string; dateWasReported: boolean }
  | { action: "reopen"; ref: string; reminderId: string }
  | { action: "clear-mark"; ref: string; reminderId: string; why: string }
  | { action: "flag-recurring"; ref: string; reminderId: string }
  | { action: "conflict"; ref: string; reminderId: string; local: string; remote: string; why: string }
  | { action: "pull-name"; ref: string; reminderId: string; name: string }
  | { action: "none"; ref: string; why: string };

/** What we saw last time, so a *transition* can be told from a *state*. */
export type Observation = {
  completed: boolean;
  modificationDate: string | null;
  name?: string;
  /**
   * Set once a binding has been seen to un-complete itself. Over AppleScript that
   * is the *only* evidence of recurrence available, and it is one-way: a binding
   * never becomes trustworthy again on its own.
   */
  suspectedRecurring?: boolean;
};

export type ReconcileInput = {
  tasks: BoundTask[];
  reminders: Map<string, Reminder>;
  lastSeen: Map<string, Observation>;
  /** The date this pass ran, used only when Reminders reports no completion date. */
  observedOn: string;
};

const asTime = (value: string | null): number | null => {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
};

export function reconcile(input: ReconcileInput): Decision[] {
  const decisions: Decision[] = [];

  for (const task of input.tasks) {
    const reminder = input.reminders.get(task.reminderId);

    // A mark is never trusted on sight. Deleted over there means the mark is
    // erased, not the reminder resurrected.
    if (!reminder) {
      decisions.push({
        action: "clear-mark",
        ref: task.ref,
        reminderId: task.reminderId,
        why: "no longer exists in Reminders",
      });
      continue;
    }

    const seen = input.lastSeen.get(task.reminderId);

    /**
     * A recurring reminder never drives a one-shot task, in either direction.
     *
     * Completing one rolls it to its next occurrence, where it reads incomplete
     * again — so a naive poll un-completes the task forever, once per cycle.
     * `DESIGN.md` settles the semantics: a recurring commitment is not one
     * checkbox, and occurrences completed in an external executor are not part of
     * LifeLoop's completion history.
     *
     * **AppleScript cannot tell us which reminders recur.** Checked against
     * `properties of` a real reminder: fourteen properties, no recurrence among
     * them. So `recurring` arrives as `"unknown"` over that route, and the rule
     * below is what correctness looks like without the answer:
     *
     *   - a *known* recurring reminder is refused outright;
     *   - an unknown one may still complete a task, because a reminder that rolls
     *     forward is not observed going incomplete-to-complete for our binding;
     *   - an unknown one may **never reopen**, because that is the destructive
     *     direction and the one recurrence actually corrupts;
     *   - and a binding seen to un-complete itself is marked suspected-recurring
     *     from then on, permanently, and stops driving anything.
     *
     * That is a smaller promise than EventKit would allow — `EKReminder` exposes
     * `hasRecurrenceRules` directly — and it is the trigger the plan wrote for C5,
     * now met by evidence rather than preference.
     */
    if (reminder.recurring === true || seen?.suspectedRecurring) {
      decisions.push({ action: "flag-recurring", ref: task.ref, reminderId: task.reminderId });
      continue;
    }

    // --- Semantic events: a transition, never a state comparison ---------------
    const becameComplete = reminder.completed && seen !== undefined && !seen.completed;
    const becameOpen = !reminder.completed && seen !== undefined && seen.completed;

    /**
     * A binding that un-completes itself is quarantined regardless of what the
     * Markdown task currently says.
     *
     * This used to sit inside `if (becameOpen && task.done)`, which meant a
     * reminder rolling to its next occurrence while the task happened to be *open*
     * fell straight through to the projection branch — unflagged, still trusted,
     * and free to drive a completion on the very next pass. The evidence is the
     * transition itself, not the state of the task that happens to be bound to it.
     */
    if (becameOpen && reminder.recurring === "unknown") {
      decisions.push({ action: "flag-recurring", ref: task.ref, reminderId: task.reminderId });
      continue;
    }

    if (becameComplete && !task.done) {
      /**
       * Apple documents `completionDate` as nullable while `isCompleted` is true —
       * a reminder finished in another client. `DESIGN.md` forbids reconstructing a
       * historical fact, so we use what was reported, or the date we observed it,
       * and never a guess in between. A laptop shut for four days produces a late
       * stamp rather than an invented one.
       */
      const reported = reminder.completionDate?.slice(0, 10) ?? null;
      const valid = reported && /^\d{4}-\d{2}-\d{2}$/.test(reported) ? reported : null;
      decisions.push({
        action: "complete",
        ref: task.ref,
        reminderId: task.reminderId,
        date: valid ?? input.observedOn,
        dateWasReported: valid !== null,
      });
      continue;
    }

    if (becameOpen && task.done) {
      /**
       * Reopen deletes a recorded historical fact, so it needs a causal guard
       * rather than a state comparison: an observed transition, a non-recurring
       * binding, a task that is currently complete, and a reminder that changed
       * after we last looked. Anything short of that does nothing.
       */
      const movedSince = asTime(reminder.modificationDate);
      const lastSeenAt = asTime(seen?.modificationDate ?? null);
      if (movedSince !== null && lastSeenAt !== null && movedSince <= lastSeenAt) {
        decisions.push({ action: "none", ref: task.ref, why: "no change since last pass" });
        continue;
      }
      decisions.push({ action: "reopen", ref: task.ref, reminderId: task.reminderId });
      continue;
    }

    // --- Projection: push, unless they edited it -------------------------------
    const nameDiverged = reminder.name !== task.name;
    if (!nameDiverged) {
      decisions.push({ action: "none", ref: task.ref, why: "in step" });
      continue;
    }

    /**
     * The timestamp is a freshness guard, not a tie-breaker. Ownership already
     * says the title is ours; this only asks whether they have edited the
     * projection since we wrote it. If they have, we stop rather than overwrite —
     * and if a timestamp were ever allowed to decide the *value*, the field would
     * quietly have become last-write-wins.
     */
    if (seen?.name === undefined) {
      decisions.push({ action: "conflict", ref: task.ref, reminderId: task.reminderId,
        local: task.name, remote: reminder.name, why: "sync baseline is unavailable" });
      continue;
    }
    const localChanged = task.name !== seen.name;
    const remoteChanged = reminder.name !== seen.name;
    if (localChanged && remoteChanged) {
      decisions.push({ action: "conflict", ref: task.ref, reminderId: task.reminderId,
        local: task.name, remote: reminder.name, why: "both Reminders and Markdown changed" });
    } else if (remoteChanged) {
      decisions.push({ action: "pull-name", ref: task.ref, reminderId: task.reminderId, name: reminder.name });
    } else {
      decisions.push({ action: "push", ref: task.ref, reminderId: task.reminderId, name: task.name, body: reminder.body });
    }
  }

  return decisions;
}
