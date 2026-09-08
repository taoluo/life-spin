import {
  parseTransclusion, type Transclusion,
} from "../../../vendor/silverbullet/plug-api/lib/transclusion.ts";
import type { LifeLoop } from "./workspace.ts";
import { resolveTarget } from "./retrieval.ts";

/**
 * Transclusion — `![[page]]`, `![[page#header]]`, `![[image.png|300]]`.
 *
 * This is *file* syntax, not a feature someone opts into: a vault arriving from
 * SilverBullet already contains it, and a page full of `![[...]]` that renders as
 * literal brackets is a page that has lost its content. So the parser is
 * upstream's, vendored, rather than a second reading of something already written
 * down.
 *
 * The preview embeds it. The editor keeps showing the source, as it does for
 * every other block — VS Code cannot render inside a document, which is the one
 * loss `WHY.md` records and this does not change.
 */

/**
 * The spans of fenced code blocks, which are quoted text rather than syntax.
 *
 * A `![[page]]` inside a fence is someone *showing* the syntax — expanding it
 * there would make it impossible to write about transclusion in a note about
 * transclusion.
 */
function fences(source: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const match of source.matchAll(/^(```|~~~).*$[\s\S]*?^\1\s*$/gm)) {
    spans.push([match.index!, match.index! + match[0].length]);
  }
  return spans;
}

/** Every transclusion in a page, with the span it occupies. */
export function transclusions(
  source: string,
): { whole: string; from: number; to: number; parsed: Transclusion }[] {
  const found: { whole: string; from: number; to: number; parsed: Transclusion }[] = [];
  const quoted = fences(source);
  // `![[...]]` and `![](...)`, matched loosely and then parsed properly.
  for (const match of source.matchAll(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g)) {
    if (quoted.some(([from, to]) => match.index! >= from && match.index! < to)) continue;
    const parsed = parseTransclusion(match[0]);
    if (!parsed) continue;
    found.push({
      whole: match[0],
      from: match.index!,
      to: match.index! + match[0].length,
      parsed,
    });
  }
  return found;
}

const MEDIA = /\.(png|jpe?g|gif|webp|svg|avif|bmp|mp4|webm|mov|m4a|mp3|wav|ogg|pdf)$/i;

/**
 * A section of a page, guarded by a heading.
 *
 * `![[Page#Some heading]]` embeds from that heading up to the next one *at the
 * same level or higher* — a deeper subheading is part of the section, a sibling
 * ends it. Taking everything to the next heading of any level would silently drop
 * a section's own subsections.
 */
export function sectionOf(text: string, heading: string): string | null {
  const lines = text.split(/\r?\n/);
  const wanted = heading.trim().toLowerCase();

  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (!match) continue;
    if (start === -1) {
      if (match[2].trim().toLowerCase() === wanted) {
        start = i + 1;
        level = match[1].length;
      }
      continue;
    }
    if (match[1].length <= level) return lines.slice(start, i).join("\n").trim();
  }
  return start === -1 ? null : lines.slice(start).join("\n").trim();
}

export type Embedded =
  | { kind: "markdown"; text: string; page: string }
  | { kind: "media"; url: string; alias: string; width?: number; height?: number }
  | { kind: "missing"; target: string };

/** What a transclusion should show, resolved against the vault. */
export function resolve(lifeloop: LifeLoop, parsed: Transclusion): Embedded {
  const url = parsed.url ?? "";
  const [target, heading] = url.split("#");

  if (MEDIA.test(target)) {
    return {
      kind: "media",
      url: target,
      alias: parsed.alias || target,
      width: parsed.dimension?.width,
      height: parsed.dimension?.height,
    };
  }

  const page = resolveTarget(lifeloop, target);
  if (!page) return { kind: "missing", target };

  let text: string;
  try {
    text = lifeloop.vault.read(`${page}.md`);
  } catch {
    return { kind: "missing", target };
  }

  // Frontmatter belongs to the page, not to what it says.
  text = text.replace(/^---\n[\s\S]*?\n---\n?/, "");

  if (heading) {
    const section = sectionOf(text, heading);
    if (section === null) return { kind: "missing", target: `${page}#${heading}` };
    return { kind: "markdown", text: section, page };
  }
  return { kind: "markdown", text: text.trim(), page };
}

/**
 * Substitute transclusions into a page before it is parsed.
 *
 * Before, so an embedded page's Markdown becomes real Markdown — headings,
 * lists and tables — rather than escaped text. That is the same reason `${...}`
 * is substituted early.
 *
 * Recursion is bounded and a cycle is named rather than followed: a page that
 * embeds itself is a mistake someone will make, and hanging the preview is a much
 * worse answer than saying so.
 */
export function expand(
  lifeloop: LifeLoop,
  source: string,
  depth = 0,
  seen: string[] = [],
): string {
  if (depth > 3) return source;

  const found = transclusions(source);
  if (found.length === 0) return source;

  let out = "";
  let cursor = 0;
  for (const item of found) {
    out += source.slice(cursor, item.from);
    cursor = item.to;

    const embedded = resolve(lifeloop, item.parsed);
    if (embedded.kind === "missing") {
      out += `_${embedded.target} — nothing to embed_`;
      continue;
    }
    if (embedded.kind === "media") {
      const size = [
        embedded.width ? `width="${embedded.width}"` : "",
        embedded.height ? `height="${embedded.height}"` : "",
      ].filter(Boolean).join(" ");
      out += size
        ? `<img src="${embedded.url}" alt="${embedded.alias}" ${size}>`
        : `![${embedded.alias}](${embedded.url})`;
      continue;
    }
    if (seen.includes(embedded.page)) {
      out += `_${embedded.page} — embedded in a loop_`;
      continue;
    }
    out += expand(lifeloop, embedded.text, depth + 1, [...seen, embedded.page]);
  }
  return out + source.slice(cursor);
}
