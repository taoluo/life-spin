import { applied, changeSet, refuse, type MutationResult } from "../mutation.ts";
import type { Vault } from "../vault.ts";
import { pathOf } from "../vault.ts";

/**
 * Freezing a review.
 *
 * The live sections are markers that erase themselves: rendering replaces the
 * marker with its own output, so freezing twice is byte-for-byte identical. That
 * property is the test, not a nicety — a second freeze that differed would mean
 * the snapshot was never stable.
 *
 * It freezes **what the page has** rather than a fixed list, because the template's
 * sections grow over time and requiring today's exact set would strand every review
 * written against an older one.
 */

const MARKER = /\$\{lifeloop\.review\.(\w+)\(\)\}/g;
const FROZEN = /^frozen:\s*\S+/m;

export type SectionRenderer = (name: string) => string | null;

export async function freezeReview(
  vault: Vault,
  page: string,
  render: SectionRenderer,
  date: string,
): Promise<MutationResult<{ sections: string[] }>> {
  const path = pathOf(page);
  if (!vault.exists(path)) return refuse("missing", `no such review page: ${page}`);
  const text = vault.read(path);

  // Validate everything before building anything.
  if (FROZEN.test(text)) return refuse("stale", `${page} is already frozen`);
  if (!/^---\n[\s\S]*?\bweek:\s*\S+[\s\S]*?\n---/m.test(text)) {
    return refuse("invalid", `${page} has no week in its frontmatter`);
  }

  const names = [...text.matchAll(MARKER)].map((m) => m[1]);
  if (names.length === 0) return refuse("stale", `${page} has no live sections to freeze`);

  const rendered = new Map<string, string>();
  for (const name of names) {
    const output = render(name);
    if (output === null) {
      // One unrenderable section aborts the whole thing rather than freezing a
      // page with a hole in it.
      return refuse("invalid", `cannot render section '${name}' of ${page}`);
    }
    rendered.set(name, output);
  }

  let body = text.replace(MARKER, (_, name: string) => rendered.get(name)!);
  body = body.replace(/^(---\n)/, `$1frozen: ${date}\n`);

  const cs = changeSet(`freeze ${page}`);
  cs.expected.set(path, text);
  cs.writes.set(path, body);
  return applied(vault, cs, { sections: names });
}
