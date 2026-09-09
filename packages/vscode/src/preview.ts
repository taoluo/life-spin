import {
  runProjection, projectionNames, projections, relationshipDate, relationshipProjectionNames,
  day, type ProjectionName, type ProjectionArgs,
} from "@lifeloop/semantic-core";
import type { LifeLoop } from "./workspace.ts";
import { parseLocatedQuery } from "./query-language.ts";

/**
 * Queries that render in the Markdown preview.
 *
 * VS Code cannot render Markdown *inside* the editor the way SilverBullet's live
 * preview does — that is a real loss and `WHY.md` records it. What it does offer
 * is the same split the built-in Mermaid and KaTeX extensions use: the editor
 * shows the fenced block as code, and the preview shows what it means.
 *
 * The mechanism is `markdown.markdownItPlugins`, and the reason it works without
 * a webview, a message channel or a cache is that `extendMarkdownIt` runs in the
 * **extension host** and `node:sqlite` is **synchronous**. A markdown-it rule can
 * therefore query the store during rendering and emit the answer directly.
 *
 * Nothing is written to the vault: a query block renders and stores nothing, which
 * is §3.5 holding at the one place a view is most tempted to break it.
 */

const escape = (text: string): string =>
  text.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type QueryBlock = {
  projection: ProjectionName;
  args: ProjectionArgs;
  fields?: string[];
  limit?: number;
};

/**
 * The block's own little syntax: a projection name, then optional `key: value`
 * lines. Deliberately not a query language — Phase 3 ships typed predicates and
 * §30's shape, and inventing a DSL here would be a second one to keep in step.
 */
export function parseQueryBlock(source: string): QueryBlock | { error: string } {
  const located = parseLocatedQuery(source);
  if (!located.projection) return { error: "empty query" };
  const projection = located.projection.text as ProjectionName;
  if (!projectionNames.includes(projection)) {
    return {
      error: `unknown projection "${escape(projection)}" — try one of: ${projectionNames.join(", ")}`,
    };
  }

  const args: ProjectionArgs = {};
  let fields: string[] | undefined;
  let limit: number | undefined;
  const relationship = (relationshipProjectionNames as readonly string[]).includes(projection);
  const allowed = projections[projection].allowedArgs ?? [];

  if (located.malformed.length) {
    return { error: `cannot read "${escape(located.malformed[0].text)}" — expected key: value` };
  }
  for (const option of located.options) {
    const key = option.key.text;
    const value = option.value.text;
    if (!value) return { error: `cannot read "${escape(key)}:" — expected key: value` };
    if (relationship && key !== "fields" && key !== "limit" && !allowed.includes(key as keyof ProjectionArgs)) {
      return { error: `unknown option "${escape(key)}" for ${projection}` };
    }
    switch (key) {
      case "date": args.date = value === "today" ? day() : value; break;
      case "days": args.days = Number(value); break;
      case "project": args.project = value; break;
      case "page": args.page = value; break;
      case "person": args.person = value; break;
      case "from": args.from = value; break;
      case "to": args.to = value; break;
      case "kind": args.kind = value; break;
      case "fields": {
        fields = option.fields.map((field) => field.text);
        if (relationship) {
          const known = projections[projection].fields ?? [];
          const unknown = fields.find((field) => !known.includes(field));
          if (unknown) return { error: `unknown field "${escape(unknown)}" for ${projection}` };
        }
        break;
      }
      case "limit": {
        limit = Number(value);
        if (!Number.isInteger(limit) || limit < 0) {
          return { error: `limit must be a non-negative integer, got ${escape(value)}` };
        }
        break;
      }
      default: return { error: `unknown option "${escape(key)}"` };
    }
  }

  if (relationship) {
    for (const key of ["date", "from", "to"] as const) {
      const value = args[key];
      if (value !== undefined && !relationshipDate(value)) {
        return { error: `${key}: ${escape(String(value))} is not an ISO date` };
      }
    }
    if (args.from && args.to && args.from > args.to) return { error: "from is after to" };
  }

  return { projection, args, fields, limit };
}

/** Flatten a projection's result into rows a table can show. */
function toRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === "object") {
    // Today and Review return named sections; show them with the section as a column.
    const out: Record<string, unknown>[] = [];
    for (const [section, value] of Object.entries(result as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      for (const row of value) out.push({ section, ...(row as object) });
    }
    return out;
  }
  return [];
}

const DEFAULT_FIELDS = [
  "section", "name", "person", "page", "date", "deadline", "scheduled", "birthday",
  "lastInteractionDate", "reconnectOn", "openFollowups", "kind", "text", "detail",
];

function renderTable(rows: Record<string, unknown>[], columns: string[]): string {
  if (rows.length === 0) return `<p class="lifeloop-empty">Nothing to show.</p>`;

  const head = columns.map((c) => `<th>${escape(c)}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = columns.map((c) => `<td>${escape(cell(row, c))}</td>`).join("");
      const done = row.done === true ? ' class="lifeloop-done"' : "";
      return `<tr${done}>${cells}</tr>`;
    })
    .join("");

  return `<table class="lifeloop-query"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export type QueryOutcome =
  | { ok: true; rows: Record<string, unknown>[]; columns: string[] }
  | { ok: false; error: string };

/**
 * Run a query block. Never throws — a query in a note is *content*, and content
 * must not take down the surface rendering it.
 *
 * Separated from rendering because the same answer is shown three ways: a table
 * in the preview, a table in a hover, and a one-line count in a CodeLens. Each is
 * a presentation; none of them decides what the query means.
 */
export function runQueryBlock(lifeloop: LifeLoop, source: string): QueryOutcome {
  const parsed = parseQueryBlock(source);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  try {
    const result = runProjection(lifeloop.store, parsed.projection, parsed.args);
    let rows = toRows(result);
    if (parsed.limit !== undefined) rows = rows.slice(0, parsed.limit);
    return { ok: true, rows, columns: columnsFor(rows, parsed.fields) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

function columnsFor(rows: Record<string, unknown>[], fields?: string[]): string[] {
  if (fields) return fields;
  const present = DEFAULT_FIELDS.filter(
    (f) => rows.some((r) => r[f] !== undefined && r[f] !== ""),
  );
  return present.length ? present : Object.keys(rows[0] ?? {}).slice(0, 5);
}

const cell = (row: Record<string, unknown>, column: string): string => {
  const value = row[column];
  return value === undefined || value === null ? "" : String(value);
};

/**
 * The same rows as a Markdown table, for a hover.
 *
 * CodeLens titles are plain single-line strings — no Markdown, no wrapping — so a
 * table cannot go there. A hover takes a full `MarkdownString`, which is why the
 * two surfaces show different things rather than the same thing twice.
 */
export function toMarkdown(outcome: QueryOutcome, heading?: string): string {
  if (!outcome.ok) return `**LifeLoop query**: ${outcome.error}`;
  if (outcome.rows.length === 0) return `_Nothing to show._`;

  const pipe = (s: string) => s.replace(/\|/g, "\\|");
  const head = `| ${outcome.columns.map(pipe).join(" | ")} |`;
  const rule = `| ${outcome.columns.map(() => "---").join(" | ")} |`;
  const body = outcome.rows
    .map((row) => `| ${outcome.columns.map((c) => pipe(cell(row, c))).join(" | ")} |`)
    .join("\n");

  return [heading ? `**${heading}**\n` : "", head, rule, body].filter(Boolean).join("\n");
}

/**
 * A widget value, as HTML.
 *
 * `widget.html(dom.i { body })` builds a tree of tagged values rather than
 * touching a DOM, because there is none — the script runs in the extension host.
 * Rendering happens here, where the output is escaped and the tag set is closed.
 *
 * Only a small, known set of tags is allowed through. A script could otherwise
 * name any tag it liked, and this output goes into a webview.
 */
const SAFE_TAGS = new Set([
  "b", "i", "em", "strong", "code", "pre", "span", "div", "p", "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "td", "th", "br", "hr", "small", "blockquote",
]);

export function renderWidgetValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return escape(value);
  if (typeof value === "number" || typeof value === "boolean") return escape(String(value));
  if (Array.isArray(value)) return value.map(renderWidgetValue).join("");

  const tagged = value as { __widget?: string; children?: unknown[] };
  if (typeof tagged.__widget !== "string") return escape(JSON.stringify(value));

  const children = (tagged.children ?? []).map(renderWidgetValue).join("");
  const kind = tagged.__widget;

  if (kind === "html" || kind === "htmlBlock" || kind === "widget") {
    return `<div class="lifeloop-widget">${children}</div>`;
  }
  if (kind === "markdown") return `<div class="lifeloop-widget">${children}</div>`;
  if (kind === "embed.youtube") {
    // The id is matched from the URL and escaped, so a note cannot point the
    // frame anywhere it likes.
    const id = escape((tagged.children?.[0] ?? "") as string);
    return `<div class="lifeloop-widget"><a href="https://www.youtube.com/watch?v=${id}">` +
      `▶ youtube.com/watch?v=${id}</a></div>`;
  }

  const tag = kind.startsWith("dom.") ? kind.slice(4).toLowerCase() : "";
  if (SAFE_TAGS.has(tag)) return `<${tag}>${children}</${tag}>`;
  // An unknown tag is shown as text rather than emitted, so a note cannot invent
  // markup for the preview to run.
  return `<span class="lifeloop-widget">${children}</span>`;
}

/**
 * Any value a script returned, as Markdown.
 *
 * The goal is that a block *shows something* wherever showing something is
 * meaningful. SilverBullet renders whatever an expression evaluates to, so
 * restricting this to widget values would leave most real blocks blank — a list
 * of tasks, a string, a number and a table are all things a page wants to display.
 *
 * Markdown rather than HTML, because the result is substituted back into the page
 * and then parsed: a returned list becomes a real list, and a returned table
 * becomes a real table.
 */
export function valueToMarkdown(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "_nothing_";
    // An array of objects is a table; an array of scalars is a list.
    const objects = value.filter((v) => v && typeof v === "object" && !Array.isArray(v));
    if (objects.length === value.length && depth === 0) {
      const rows = value as Record<string, unknown>[];
      const columns = columnsFor(rows);
      const pipe = (t: string) => t.replace(/\|/g, "\\|");
      return [
        `| ${columns.map(pipe).join(" | ")} |`,
        `| ${columns.map(() => "---").join(" | ")} |`,
        ...rows.map((r) => `| ${columns.map((c) => pipe(cell(r, c))).join(" | ")} |`),
      ].join("\n");
    }
    return value.map((v) => `* ${valueToMarkdown(v, depth + 1).replace(/\n/g, " ")}`).join("\n");
  }

  const tagged = value as { __widget?: string };
  if (typeof tagged.__widget === "string") return renderWidgetValue(value);

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "_nothing_";
  // A named-section object — Today, Review — becomes a section per key.
  if (depth === 0 && entries.some(([, v]) => Array.isArray(v))) {
    return entries
      .filter(([, v]) => !Array.isArray(v) || v.length > 0)
      .map(([key, v]) => `**${key}**\n\n${valueToMarkdown(v, depth + 1)}`)
      .join("\n\n");
  }
  return entries.map(([k, v]) => `* **${k}**: ${valueToMarkdown(v, depth + 1)}`).join("\n");
}

/** Render one query block to HTML, for the Markdown preview. */
export function renderQuery(lifeloop: LifeLoop, source: string): string {
  const outcome = runQueryBlock(lifeloop, source);
  if (!outcome.ok) {
    return `<div class="lifeloop-error"><strong>LifeLoop query</strong>: ${
      escape(outcome.error)
    }</div>`;
  }
  return renderTable(outcome.rows, outcome.columns);
}

/**
 * `space-style` blocks, applied to the preview.
 *
 * SilverBullet applies these to its editor; VS Code exposes no such hook, but the
 * Markdown preview is a webview we already style. So a vault's CSS reaches the
 * one surface where it can, which is more than indexing it and ignoring it.
 *
 * Scoped and filtered rather than injected whole: the preview is a real webview,
 * and a note should not be able to reposition the window, load a remote font or
 * escape its own container.
 */
const CSS_FORBIDDEN = /@import|url\s*\(|expression\s*\(|javascript:|<\/?\w/i;

export function safeSpaceStyle(css: string): { css: string; refused: string[] } {
  const refused: string[] = [];
  const rules = css.split("}").map((r) => r.trim()).filter(Boolean);
  const kept: string[] = [];

  for (const rule of rules) {
    if (CSS_FORBIDDEN.test(rule)) {
      refused.push(rule.split("{")[0].trim().slice(0, 40));
      continue;
    }
    const [selector, body] = rule.split("{");
    if (!body) continue;
    // Scoped to the preview body so a rule cannot reach the surrounding chrome.
    const scoped = selector
      .split(",")
      .map((sel) => `.lifeloop-space-style ${sel.trim()}`)
      .join(", ");
    kept.push(`${scoped} { ${body.trim()} }`);
  }
  return { css: kept.join("\n"), refused };
}

/**
 * `${expression}` in a page.
 *
 * This is how SilverBullet pages actually show dynamic content — more than fenced
 * blocks do. Our own weekly review template is written with it
 * (`${lifeloop.review.completed()}`), so supporting it is not a nicety; without it
 * that template renders as its own source code.
 *
 * Substitution happens **before** markdown-it parses, so a returned list becomes a
 * real list and a returned table becomes a real table rather than escaped text.
 * An expression with no cached answer is left exactly as written: an unevaluated
 * `${...}` that still reads as what the author typed is much better than a blank.
 */
const INTERPOLATION = /\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;

export function interpolate(
  source: string,
  evaluate: (expression: string) => string | undefined,
): string {
  return source.replace(INTERPOLATION, (whole, expression: string) => {
    const rendered = evaluate(String(expression).trim());
    return rendered === undefined ? whole : rendered;
  });
}

/** Every `${...}` a page contains, in the order they appear. */
export function interpolations(source: string): string[] {
  return [...source.matchAll(INTERPOLATION)].map((m) => m[1].trim());
}

/**
 * The markdown-it hook, returned from `activate()`.
 *
 * Fenced blocks tagged `lifeloop` or `query` render; everything else falls
 * through to the default fence renderer untouched.
 */
export type LuaPreviewOutput = string | { markdown: string };

export function extendMarkdownIt(
  lifeloop: () => LifeLoop | undefined,
  /**
   * Renders a `space-lua` block, or returns undefined to leave it as code.
   *
   * Supplied by the client rather than called directly, because whether a script
   * may run at all is a setting the extension owns — and markdown-it rendering is
   * synchronous, so the result has to be ready before the preview asks.
   */
  renderSpaceLua?: (script: string) => LuaPreviewOutput | undefined,
  /** Answers a `${...}`, or undefined to leave it as written. */
  renderExpression?: (expression: string) => string | undefined,
  /** The vault's own CSS, already scoped and filtered. */
  renderSpaceStyle?: () => string,
) {
  return (md: any) => {
    // Foam owns ordinary note/media embeds; leave their source untouched.

    // `core.ruler` is always there in markdown-it proper, but a host that hands us
    // a narrower object should lose interpolation rather than the whole preview.
    if (renderExpression && md.core?.ruler?.before) {
      // Before anything is parsed, so the substituted Markdown is parsed too.
      md.core.ruler.before("normalize", "lifeloop-interpolate", (state: any) => {
        if (typeof state.src === "string" && state.src.includes("${")) {
          state.src = interpolate(state.src, renderExpression);
        }
      });
    }

    const fallback = md.renderer.rules.fence;
    let renderingLuaOutput = false;
    md.renderer.rules.fence = (tokens: any[], index: number, options: any, env: any, self: any) => {
      const token = tokens[index];
      const language = (token.info ?? "").trim().split(/\s+/)[0];
      const instance = lifeloop();

      if (language === "space-style") {
        const css = renderSpaceStyle?.();
        // Shown as code as well: a style block is content someone wrote, and
        // hiding it would make a page look like it had lost a section.
        return css
          ? `<style>${css}</style>${fallback(tokens, index, options, env, self)}`
          : fallback(tokens, index, options, env, self);
      }

      if (language === "space-lua") {
        // Only when execution is switched on, and only what the block *returns* —
        // a widget it built, rendered where SilverBullet would have put it inline.
        if (renderingLuaOutput) return fallback(tokens, index, options, env, self);
        const rendered = renderSpaceLua?.(token.content);
        if (rendered === undefined) return fallback(tokens, index, options, env, self);
        if (typeof rendered === "string") return rendered;
        // Reuse the host renderer; a returned Lua fence stays inert instead of recursing.
        renderingLuaOutput = true;
        const allowHtml = md.options.html;
        md.options.html = false; // Plain Lua strings never bypass the widget tag allowlist.
        try { return `<div class="lifeloop-widget">${md.render(rendered.markdown, env)}</div>`; }
        finally { md.options.html = allowHtml; renderingLuaOutput = false; }
      }

      if (language !== "lifeloop" && language !== "query") {
        return fallback(tokens, index, options, env, self);
      }
      if (!instance) {
        return `<div class="lifeloop-error">LifeLoop is still indexing this workspace.</div>`;
      }
      return renderQuery(instance, token.content);
    };
    return md;
  };
}
