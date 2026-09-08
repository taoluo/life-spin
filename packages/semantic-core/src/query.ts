import type { LifeloopObject } from "./extract.ts";
import type { Store } from "./store.ts";

/**
 * Typed predicates, not a DSL. Phase 3 freezes this shape as a public contract
 * and adds saved definitions; until then it stays deliberately small — a query
 * language is the kind of thing that is easy to add and impossible to remove.
 */
export type Comparison = "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in" | "contains" | "exists";
export type Where = { field: string; op: Comparison; value?: unknown };

export type QueryRequest = {
  source: string;
  where?: Where[];
  order?: { field: string; direction?: "asc" | "desc" }[];
  limit?: number;
};

export type QueryResult<T = LifeloopObject> = { rows: T[]; total: number };

const valueAt = (o: LifeloopObject, field: string): unknown =>
  field.split(".").reduce<any>((v, part) => (v == null ? v : v[part]), o);

function matches(o: LifeloopObject, w: Where): boolean {
  const actual = valueAt(o, w.field);
  switch (w.op) {
    case "exists": return (actual !== undefined && actual !== null) === (w.value ?? true);
    case "eq": return actual === w.value;
    case "ne": return actual !== w.value;
    case "lt": return (actual as any) < (w.value as any);
    case "lte": return (actual as any) <= (w.value as any);
    case "gt": return (actual as any) > (w.value as any);
    case "gte": return (actual as any) >= (w.value as any);
    case "in": return Array.isArray(w.value) && w.value.includes(actual as never);
    case "contains": return Array.isArray(actual) && actual.includes(w.value as never);
  }
}

export function query(store: Store, request: QueryRequest): QueryResult {
  let rows = store.objects(request.source);
  for (const w of request.where ?? []) rows = rows.filter((o) => matches(o, w));
  const total = rows.length;
  for (const { field, direction } of [...(request.order ?? [])].reverse()) {
    const sign = direction === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const x = valueAt(a, field) as any, y = valueAt(b, field) as any;
      if (x === y) return 0;
      if (x === undefined || x === null) return 1;   // absent sorts last either way
      if (y === undefined || y === null) return -1;
      return (x < y ? -1 : 1) * sign;
    });
  }
  if (request.limit !== undefined) rows = rows.slice(0, request.limit);
  return { rows, total };
}

/**
 * The task universe, in one place rather than in each view.
 *
 * `DESIGN.md` is explicit that this is source semantics, not a query
 * optimisation: SilverBullet indexes commented-out tasks and flags them, so
 * excluding them is a decision LifeLoop makes once. Today, project counts and
 * the Weekly Review all narrow from here; no view invents its own filter.
 *
 *   all indexed tasks
 *     ↓ not inComment    universe()   what LifeLoop can see
 *     ↓ not done         open()       what is outstanding
 *     ↓ not parked       actionable() what you could act on now
 */
export const PARKED_TAGS = ["waiting", "someday"] as const;

export const tasks = {
  universe: (store: Store): LifeloopObject[] =>
    store.select("tag = 'task' AND in_comment = 0"),

  open: (store: Store): LifeloopObject[] =>
    store.select("tag = 'task' AND in_comment = 0 AND done = 0"),

  /** Overdue or due on `date`, plus anything scheduled for it. The Today projection. */
  due: (store: Store, date: string): LifeloopObject[] =>
    store.select(
      "tag = 'task' AND in_comment = 0 AND done = 0 AND (deadline <= ? OR scheduled = ?)",
      [date, date],
    ),

  /** Parked state is inherited: a `#waiting` parent covers the tasks nested under it. */
  parked: (store: Store): LifeloopObject[] =>
    tasks.open(store).filter((t) =>
      PARKED_TAGS.some((tag) => (t.itags as string[] | undefined)?.includes(tag)),
    ),

  actionable: (store: Store): LifeloopObject[] =>
    tasks.open(store).filter(
      (t) => !PARKED_TAGS.some((tag) => (t.itags as string[] | undefined)?.includes(tag)),
    ),
};

/** Pages linking to `name`, newest first. A projection over the relation index. */
export function backlinks(store: Store, name: string): LifeloopObject[] {
  return store.select("tag = 'relation' AND rel_to = ?", [name]);
}

/** Links that resolve to nothing — the broken-link diagnostic's source. */
export function brokenLinks(store: Store): LifeloopObject[] {
  return store.objects("aspiring-page");
}
