import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./store.ts";
import { runView, projectionNames, type ViewDefinition, type ProjectionArgs } from "./contract.ts";

/**
 * Saved view definitions (3.3): `.lifeloop/views/*.yaml`.
 *
 * A definition describes a view and **may never hold results**. That is the whole
 * point of §33 — a dashboard stores query, renderer and layout, and computes the
 * rest, so a stale file cannot start lying about your work.
 *
 * A tiny parser rather than a YAML dependency: the shape is fixed and shallow, and
 * accepting arbitrary YAML here would invite definitions the contract cannot run.
 */

export type SavedView = ViewDefinition & { name: string; title?: string };

const RESULT_KEYS = ["results", "rows", "data", "items", "cache"];

export function parseView(name: string, text: string): SavedView {
  const view: any = { name };
  let section: string | null = null;

  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;

    const top = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (top && !raw.startsWith(" ")) {
      const [, key, value] = top;
      if (RESULT_KEYS.includes(key)) {
        // Refused rather than ignored: a definition carrying results is a
        // misunderstanding of what these files are, and silently dropping it
        // would leave someone believing their dashboard was cached.
        throw new Error(
          `${name}: '${key}' is not allowed in a view definition — ` +
            `a view describes a query, it never stores its answer`,
        );
      }
      section = value === "" ? key : null;
      if (value !== "") view[key] = value.replace(/^["']|["']$/g, "");
      else view[key] = key === "filter" || key === "sort" ? [] : {};
      continue;
    }

    const nested = /^\s+-?\s*([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (nested && section) {
      const [, key, value] = nested;
      const clean = value.replace(/^["']|["']$/g, "");
      if (section === "filter") {
        view.filter.push({ field: key, op: "eq", value: clean });
      } else if (section === "sort") {
        view.sort.push({ field: key, direction: clean === "desc" ? "desc" : "asc" });
      } else {
        view[section][key] = clean;
      }
      continue;
    }

    const listItem = /^\s+-\s+(.+)$/.exec(line);
    if (listItem && section === "sort") {
      view.sort.push({ field: listItem[1].replace(/^["']|["']$/g, ""), direction: "asc" });
    }
  }

  if (typeof view.source === "string" && !projectionNames.includes(view.source as any)) {
    view.source = { tag: view.source };
  }
  return view as SavedView;
}

export function loadViews(root: string): SavedView[] {
  const dir = join(root, ".lifeloop", "views");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort()
    .map((f) => parseView(f.replace(/\.ya?ml$/, ""), readFileSync(join(dir, f), "utf8")));
}

export function runSavedView(store: Store, view: SavedView, args: ProjectionArgs = {}): unknown {
  return runView(store, view, args);
}
