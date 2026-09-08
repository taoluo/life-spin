import type { Store } from "./store.ts";
import type { LifeloopObject } from "./extract.ts";
import { query, tasks, backlinks, brokenLinks, type QueryRequest, type QueryResult } from "./query.ts";
import { today, upcoming, review, projectSignals, day } from "./projections.ts";

/**
 * The public query contract (Phase 3).
 *
 * Phase 0 built the engine; this freezes its shape and names the projections, so
 * that **no client invents its own filter**. A TreeView and the CLI asking the same
 * question must get the same answer, and changing what Today means has to be a
 * one-file change — otherwise two clients drift and neither is wrong.
 *
 * Versioned deliberately. A consumer can ask what it is talking to, and a breaking
 * change has to say so rather than being discovered.
 */

export const CONTRACT_VERSION = "1.0.0";

/**
 * Compatibility rule, stated rather than assumed:
 *
 *   - adding a projection, or a field to a returned object, is a minor bump
 *   - removing either, or changing what a projection *means*, is a major bump
 *   - a projection may never start requiring a field ordinary Markdown lacks
 *
 * The last one is §34 reaching back into the query layer: a view that needs new
 * canonical state is not a view we add, whatever it would look like.
 */
export type ProjectionName =
  | "today" | "upcoming" | "review" | "signals"
  | "open" | "actionable" | "parked" | "universe"
  | "backlinks" | "broken";

export type ProjectionArgs = {
  date?: string;
  days?: number;
  project?: string;
  page?: string;
};

export type Projection = {
  name: ProjectionName;
  /** What this projection answers, in one line, for a client to show. */
  describes: string;
  run(store: Store, args: ProjectionArgs): unknown;
};

/**
 * Every projection, in one table.
 *
 * This is the enumeration the CLI walks and the extension calls. A client that
 * reaches past it into `store.objects()` and filters by hand is the bug this
 * table exists to make obvious.
 */
export const projections: Record<ProjectionName, Projection> = {
  today: {
    name: "today",
    describes: "overdue, due today and scheduled today — disjoint — plus what you are waiting on",
    run: (store, a) => today(store, a.date ?? day()),
  },
  upcoming: {
    name: "upcoming",
    describes: "the next N days, grouped, each task appearing once",
    run: (store, a) => upcoming(store, a.date ?? day(), a.days ?? 14),
  },
  review: {
    name: "review",
    describes: "the weekly review's live sections for the week containing a date",
    run: (store, a) => review(store, a.date ?? day()),
  },
  signals: {
    name: "signals",
    describes: "what a project's state actually says, each signal naming only what it measured",
    run: (store, a) => projectSignals(store, a.project ?? "", a.date ?? day()),
  },
  open: {
    name: "open",
    describes: "every outstanding task LifeLoop can see",
    run: (store) => tasks.open(store),
  },
  actionable: {
    name: "actionable",
    describes: "open tasks that are not parked",
    run: (store) => tasks.actionable(store),
  },
  parked: {
    name: "parked",
    describes: "open tasks marked #waiting or #someday, inheritance included",
    run: (store) => tasks.parked(store),
  },
  universe: {
    name: "universe",
    describes: "every indexed task except those commented out",
    run: (store) => tasks.universe(store),
  },
  backlinks: {
    name: "backlinks",
    describes: "pages mentioning a page",
    run: (store, a) => backlinks(store, a.page ?? ""),
  },
  broken: {
    name: "broken",
    describes: "links that resolve to nothing",
    run: (store) => brokenLinks(store),
  },
};

export const projectionNames = Object.keys(projections) as ProjectionName[];

export function runProjection(
  store: Store,
  name: ProjectionName,
  args: ProjectionArgs = {},
): unknown {
  const projection = projections[name];
  if (!projection) throw new Error(`no such projection: ${name}`);
  return projection.run(store, args);
}

/** The raw query escape hatch, for a source with no named projection yet. */
export function runQuery(store: Store, request: QueryRequest): QueryResult<LifeloopObject> {
  return query(store, request);
}

/** A saved definition, in §30's shape. Describes a view; may never hold results. */
export type ViewDefinition = {
  source: ProjectionName | { tag: string };
  filter?: QueryRequest["where"];
  sort?: QueryRequest["order"];
  group?: string;
  fields?: string[];
  renderer?: string;
};

export function runView(store: Store, view: ViewDefinition, args: ProjectionArgs = {}): unknown {
  if (typeof view.source === "string") return runProjection(store, view.source, args);
  return runQuery(store, {
    source: view.source.tag,
    where: view.filter,
    order: view.sort,
  });
}
