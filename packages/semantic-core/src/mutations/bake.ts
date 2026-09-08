import { changeSet, refuse, applied, type MutationResult } from "../mutation.ts";
import type { Vault } from "../vault.ts";
import { pathOf } from "../vault.ts";
import {
  findBakedSections, escapeBakedBody, type BakedSection,
} from "../../../../vendor/silverbullet/client/baked_sections/regions.ts";

/**
 * Baked sections — a live expression and its rendered output, side by side.
 *
 *     <!--#lua query[[ from t = tags.task where not t.done select t.name ]] -->
 *     | name |
 *     | ---- |
 *     | write the paper |
 *     <!--/lua-->
 *
 * The markers are ordinary HTML comments, so *every* other renderer — GitHub, a
 * static site generator, another editor — ignores them and shows the table. That
 * is the whole point: the page reads correctly outside LifeLoop while staying
 * re-runnable inside it.
 *
 * Both the marker syntax and the escaping rule come from upstream, vendored,
 * because this is the one place where getting the delimiters subtly wrong
 * corrupts a page on the *next* update rather than merely rendering it oddly.
 *
 * Baking is static and manual, as it is upstream. A section shows what it showed
 * when it was baked; `update` brings it current. Refreshing on its own would mean
 * rewriting the user's files behind their back, which is not a thing a note-taking
 * tool gets to do.
 */

export type { BakedSection };
export { findBakedSections };

/** Renders one expression to Markdown, or reports why it could not. */
export type Evaluate = (expression: string) => Promise<
  { ok: true; markdown: string } | { ok: false; error: string }
>;

const INTERPOLATION = /\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;

export type Span = { expression: string; from: number; to: number };

/** Every `${...}` in a page, with the span it occupies. */
export function expressionSpans(source: string): Span[] {
  return [...source.matchAll(INTERPOLATION)].map((m) => ({
    expression: m[1].trim(),
    from: m.index!,
    to: m.index! + m[0].length,
  }));
}

/** The `${...}` containing `offset`, if the cursor is in one. */
export function expressionAt(source: string, offset: number): Span | null {
  return expressionSpans(source).find((s) => offset >= s.from && offset <= s.to) ?? null;
}

/** The baked section containing `offset`, if the cursor is in one. */
export function sectionAt(source: string, offset: number): BakedSection | null {
  return findBakedSections(source).find((s) => offset >= s.start && offset <= s.end) ?? null;
}

/**
 * Whether a span stands alone on its line.
 *
 * Baking is block-level. An expression in the middle of a sentence has no block to
 * wrap, and wrapping it anyway would break the sentence into three paragraphs —
 * so it is refused rather than mangled.
 */
export function standsAlone(source: string, span: Span): boolean {
  const lineStart = source.lastIndexOf("\n", span.from - 1) + 1;
  const lineEnd = source.indexOf("\n", span.to);
  const before = source.slice(lineStart, span.from);
  const after = source.slice(span.to, lineEnd === -1 ? source.length : lineEnd);
  return before.trim() === "" && after.trim() === "";
}

function marker(expression: string, body: string): string {
  return `<!--#lua ${expression} -->\n${escapeBakedBody(body).trim()}\n<!--/lua-->`;
}

/**
 * Bake the expression at the cursor.
 *
 * The expression is evaluated *before* anything is written, and a failure writes
 * nothing at all: replacing a working directive with an error message is a strictly
 * worse page than the one the author had.
 */
export async function bakeAt(
  vault: Vault,
  page: string,
  offset: number,
  evaluate: Evaluate,
): Promise<MutationResult<{ expression: string }>> {
  const path = pathOf(page);
  if (!vault.exists(path)) return refuse("missing", `no such page: ${page}`);
  const text = vault.read(path);

  const span = expressionAt(text, offset);
  if (!span) return refuse("invalid", "the cursor is not in a ${...} expression");
  if (!standsAlone(text, span)) {
    return refuse("invalid", "only an expression on its own line can be baked");
  }

  const result = await evaluate(span.expression);
  if (!result.ok) return refuse("invalid", `nothing baked: ${result.error}`);

  const cs = changeSet(`bake ${span.expression} in ${page}`);
  cs.expected.set(path, text);
  cs.writes.set(
    path,
    text.slice(0, span.from) + marker(span.expression, result.markdown) + text.slice(span.to),
  );
  return applied(vault, cs, { expression: span.expression });
}

/**
 * Turn a baked section back into the live expression it came from.
 *
 * The opening marker is the source of truth, so this is lossless in the direction
 * that matters: the rendered body was derived from the expression and can be
 * derived again.
 */
export async function unbakeAt(
  vault: Vault,
  page: string,
  offset: number,
): Promise<MutationResult<{ expression: string }>> {
  const path = pathOf(page);
  if (!vault.exists(path)) return refuse("missing", `no such page: ${page}`);
  const text = vault.read(path);

  const section = sectionAt(text, offset);
  if (!section) return refuse("invalid", "the cursor is not in a baked section");

  const cs = changeSet(`unbake ${section.expr} in ${page}`);
  cs.expected.set(path, text);
  cs.writes.set(
    path,
    text.slice(0, section.start) + "${" + section.expr + "}" + text.slice(section.end),
  );
  return applied(vault, cs, { expression: section.expr });
}

export type Updated = { updated: number; failed: { expression: string; error: string }[] };

/**
 * Re-evaluate every baked section on a page.
 *
 * Sections that fail keep their existing body and are reported, rather than
 * failing the whole page: one broken query should not cost you the four beside it
 * that still work. If nothing changed, nothing is written.
 */
export async function updateBaked(
  vault: Vault,
  page: string,
  evaluate: Evaluate,
): Promise<MutationResult<Updated>> {
  const path = pathOf(page);
  if (!vault.exists(path)) return refuse("missing", `no such page: ${page}`);
  const text = vault.read(path);

  const sections = findBakedSections(text);
  if (sections.length === 0) return refuse("invalid", "no baked sections on this page");

  const failed: Updated["failed"] = [];
  let out = "";
  let cursor = 0;
  let updated = 0;

  for (const section of sections) {
    out += text.slice(cursor, section.start);
    cursor = section.end;
    const result = await evaluate(section.expr);
    if (!result.ok) {
      failed.push({ expression: section.expr, error: result.error });
      out += text.slice(section.start, section.end);
      continue;
    }
    const replacement = marker(section.expr, result.markdown);
    if (replacement !== text.slice(section.start, section.end)) updated++;
    out += replacement;
  }
  out += text.slice(cursor);

  if (out === text) return { ok: true, changed: [], value: { updated: 0, failed } };

  const cs = changeSet(`update ${updated} baked section(s) in ${page}`);
  cs.expected.set(path, text);
  cs.writes.set(path, out);
  return applied(vault, cs, { updated, failed });
}
