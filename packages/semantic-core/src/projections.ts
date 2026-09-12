import type { LifeloopObject } from "./extract.ts";
import type { Store } from "./store.ts";
import { tasks } from "./query.ts";

/**
 * Named projections — the only things a client calls (Phase 3, 3.2).
 *
 * A client that filters for itself is a bug: changing what Today *means* has to be
 * a one-file change, or the TreeView and the CLI drift apart and neither is wrong.
 * Everything here derives and stores nothing.
 */

/**
 * Today, on the calendar the person is actually looking at.
 *
 * `toISOString()` is UTC, so every evening west of Greenwich it returned
 * tomorrow — a task completed at 20:00 in New York was stamped with the next
 * day's date, and Today changed over at 19:00 or 20:00 rather than midnight.
 * A date here is a human fact, not an instant.
 */
export const day = (date = new Date()): string => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

export function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type TodayBuckets = {
  date: string;
  overdue: LifeloopObject[];
  due: LifeloopObject[];
  scheduled: LifeloopObject[];
  waiting: LifeloopObject[];
};

export type TaskViewExplanation = {
  included: boolean;
  reasons: string[];
};

/**
 * Today: overdue / due today / scheduled today, **disjoint**, plus what you are
 * waiting on.
 *
 * Disjoint matters — a task with both a deadline and a schedule appears once, in
 * the most urgent bucket it qualifies for, or the same work is counted twice in a
 * view whose whole job is telling you how much there is.
 */
export function today(store: Store, date = day()): TodayBuckets {
  const actionable = tasks.actionable(store);
  const seen = new Set<string>();
  const take = (list: LifeloopObject[]) =>
    list.filter((t) => {
      const key = String(t.ref);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const overdue = take(actionable.filter((t) => typeof t.deadline === "string" && t.deadline < date));
  const due = take(actionable.filter((t) => t.deadline === date));
  const scheduled = take(actionable.filter((t) => t.scheduled === date));
  return { date, overdue, due, scheduled, waiting: tasks.parked(store) };
}

/** Explain only the two task predicates LifeLoop currently promises to users. */
export function explainTask(
  store: Store,
  task: LifeloopObject,
  view: "actionable" | "today",
  date = day(),
): TaskViewExplanation {
  const same = (candidate: LifeloopObject) => candidate.ref === task.ref;
  const parked = (["waiting", "someday"] as const).filter((tag) =>
    (task.itags as string[] | undefined)?.includes(tag));
  const direct = new Set((task.tags as string[] | undefined) ?? []);
  const parkedReason = parked.map((tag) =>
    `${direct.has(tag) ? "tagged" : "inherits"} #${tag}`);

  if (view === "actionable") {
    const included = tasks.actionable(store).some(same);
    if (included) return { included, reasons: ["open and not parked"] };
    if (task.inComment === true) return { included, reasons: ["inside a comment"] };
    if (task.done === true) return { included, reasons: ["completed"] };
    if (parkedReason.length) return { included, reasons: parkedReason };
    return { included, reasons: ["not matched by the current actionable predicate"] };
  }

  const buckets = today(store, date);
  if (buckets.overdue.some(same)) {
    return { included: true, reasons: [`deadline ${String(task.deadline)} is before ${date}`] };
  }
  if (buckets.due.some(same)) {
    return { included: true, reasons: [`deadline is ${date}`] };
  }
  if (buckets.scheduled.some(same)) {
    return { included: true, reasons: [`scheduled for ${date}`] };
  }
  if (buckets.waiting.some(same)) {
    return { included: true, reasons: parkedReason.length ? parkedReason : ["parked"] };
  }
  if (task.inComment === true) return { included: false, reasons: ["inside a comment"] };
  if (task.done === true) return { included: false, reasons: ["completed"] };
  if (parkedReason.length) return { included: false, reasons: parkedReason };

  const reasons: string[] = [];
  if (typeof task.deadline === "string") {
    if (task.deadline > date) reasons.push(`deadline ${task.deadline} is after ${date}`);
  } else {
    reasons.push("no deadline on or before today");
  }
  if (typeof task.scheduled === "string") {
    if (task.scheduled !== date) reasons.push(`scheduled for ${task.scheduled}, not ${date}`);
  } else {
    reasons.push(`not scheduled for ${date}`);
  }
  return { included: false, reasons };
}

export type UpcomingDay = { date: string; tasks: LifeloopObject[] };

/**
 * The next `days` days, grouped by day.
 *
 * A task with both dates appears **once**, grouped by `scheduled` — the day you
 * meant to work on it — and falls back to its deadline when nothing is scheduled
 * in range.
 */
export function upcoming(store: Store, from = day(), days = 14): UpcomingDay[] {
  const horizon = shift(from, days);
  const buckets = new Map<string, LifeloopObject[]>();
  for (const task of tasks.actionable(store)) {
    const scheduled = typeof task.scheduled === "string" ? task.scheduled : null;
    const deadline = typeof task.deadline === "string" ? task.deadline : null;
    const on = scheduled && scheduled > from && scheduled < horizon ? scheduled
      : deadline && deadline > from && deadline < horizon ? deadline
      : null;
    if (!on) continue;
    const bucket = buckets.get(on);
    if (bucket) bucket.push(task);
    else buckets.set(on, [task]);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({ date, tasks: list }));
}

export type Week = { start: string; end: string };

/** Monday to Sunday containing `date`. */
export function week(date = day()): Week {
  const d = new Date(`${date}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  const start = shift(date, -offset);
  return { start, end: shift(start, 6) };
}

export type ReviewSections = {
  week: Week;
  completed: LifeloopObject[];
  stillOpen: LifeloopObject[];
  activeProjects: LifeloopObject[];
  waiting: LifeloopObject[];
  inbox: LifeloopObject[];
};

/** The Weekly Review's live sections. Only the active operational surface (§3.6). */
export function review(store: Store, date = day()): ReviewSections {
  const range = week(date);
  const universe = tasks.universe(store);
  const completed = universe.filter(
    (t) =>
      typeof t.completed === "string" && t.completed >= range.start && t.completed <= range.end,
  );
  const projects = store
    .objects("page")
    .filter((p) => (p.itags as string[] | undefined)?.includes("project"));
  return {
    week: range,
    completed,
    stillOpen: tasks.actionable(store),
    activeProjects: projects.filter((p) => (p.status ?? "active") === "active"),
    waiting: tasks.parked(store),
    inbox: store.objects("item").filter((i) => i.page === "Inbox"),
  };
}

/** Signals a project emits. Each says exactly what it measured and nothing more. */
export type Signal = { kind: string; detail: string };

export function projectSignals(
  store: Store,
  project: string,
  date = day(),
  staleDays = 21,
): Signal[] {
  const mine = tasks.universe(store).filter((t) => t.page === project);
  const open = mine.filter((t) => !t.done);
  const parked = (t: LifeloopObject) =>
    ["waiting", "someday"].some((tag) => (t.itags as string[] | undefined)?.includes(tag));
  const signals: Signal[] = [];

  if (open.length > 0 && open.every(parked)) {
    // Narrower than "not actionable" on purpose: a project holding both waiting
    // and someday tasks has nothing actionable but is not waiting on anybody.
    if (open.every((t) => (t.itags as string[] | undefined)?.includes("waiting"))) {
      signals.push({ kind: "waiting only", detail: `${open.length} open, all #waiting` });
    } else {
      signals.push({ kind: "no actionable task", detail: `${open.length} open, none actionable` });
    }
  }

  const overdue = open.filter((t) => typeof t.deadline === "string" && t.deadline < date);
  if (overdue.length) {
    signals.push({ kind: "overdue tasks", detail: `${overdue.length} past their deadline` });
  }

  const page = store.objects("page").find((p) => p.ref === project);
  const modified = typeof page?.lastModified === "string" ? page.lastModified.slice(0, 10) : null;
  if (modified && modified < shift(date, -staleDays)) {
    // Not called "no activity": the only evidence is one page's timestamp, while
    // the real work may be happening in meeting notes or the journal.
    signals.push({
      kind: "project page unchanged",
      detail: `last modified ${modified}, over ${staleDays} days ago`,
    });
  }
  return signals;
}
