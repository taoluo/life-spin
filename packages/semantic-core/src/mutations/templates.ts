import { changeSet, refuse, applied, validPageName, type MutationResult } from "../mutation.ts";
import type { Vault } from "../vault.ts";
import { pathOf } from "../vault.ts";
import { day, week, shift } from "../projections.ts";
import { frontmatterOf } from "./pages.ts";

/** Review creation only; ordinary note templates belong to Foam. */
export type PageTemplate = {
  page: string;
  openIfExists: boolean;
  body: string;
};

/**
 * Substitutions a template may use without any scripting.
 *
 * Deliberately a fixed, small set. Review creation has to work
 * in a vault that has never switched Space Lua on, so these are evaluated here
 * rather than by the Lua host. With execution enabled, full `${...}` expressions
 * work too, through the same interpolation the preview uses.
 */
export function substitutions(now = new Date()): Record<string, string> {
  const today = day(now);
  const thisWeek = week(today);
  return {
    "date.today()": today,
    "date.tomorrow()": shift(today, 1),
    "date.yesterday()": shift(today, -1),
    "week.start()": thisWeek.start,
    "week.end()": thisWeek.end,
  };
}

export function substitute(text: string, now = new Date()): string {
  const table = substitutions(now);
  return text.replace(/\$\{([^}]+)\}/g, (whole, expression: string) => {
    const answer = table[expression.trim()];
    // An expression we do not recognise is left alone rather than blanked: a
    // template using Space Lua still reads as itself when scripting is off, and
    // the preview will answer it if scripting is on.
    return answer ?? whole;
  });
}

/** Read one template page. */
export function readTemplate(vault: Vault, page: string): PageTemplate | null {
  const path = pathOf(page);
  if (!vault.exists(path)) return null;
  const text = vault.read(path);
  const front = frontmatterOf(text);

  const value = (key: string): string | undefined => {
    const line = front?.lines.find((l) => l.startsWith(`${key}:`));
    return line?.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
  };

  return {
    page,
    openIfExists: value("openIfExists") === "true",
    body: front ? front.rest : text,
  };
}

/**
 * Where the cursor should land in the new page.
 *
 * `|^|` is SilverBullet's marker. It is removed from the text and its offset
 * returned, so a client can put the caret there — the difference between a
 * template that saves typing and one that saves typing *and* a click.
 */
export function cursorMarker(body: string): { body: string; offset: number | null } {
  const at = body.indexOf("|^|");
  if (at === -1) return { body, offset: null };
  return { body: body.slice(0, at) + body.slice(at + 3), offset: at };
}

export type Created = { page: string; cursor: number | null; existed: boolean };

/**
 * Create a page from a template.
 *
 * A name already taken is a refusal unless the template said `openIfExists` —
 * because overwriting a page someone already has is the one outcome a
 * convenience feature must never produce.
 */
export async function createFromTemplate(
  vault: Vault,
  template: PageTemplate,
  name: string,
  now = new Date(),
): Promise<MutationResult<Created>> {
  const page = substitute(name, now).trim();
  if (!page) return refuse("cancelled", "no name given");
  if (!validPageName(page)) return refuse("invalid", `not a page name: ${page}`);

  const path = pathOf(page);
  if (vault.exists(path)) {
    if (template.openIfExists) {
      return { ok: true, changed: [], value: { page, cursor: null, existed: true } };
    }
    return refuse("collision", `${page} already exists`);
  }

  const { body, offset } = cursorMarker(substitute(template.body, now));
  const cs = changeSet(`create ${page} from ${template.page}`);
  cs.expected.set(path, null);
  cs.writes.set(path, body);
  return applied(vault, cs, { page, cursor: offset, existed: false });
}

/** The fallback Weekly Review preserves live expressions until the user freezes it. */
export function builtinReviewTemplate(): PageTemplate {
  return {
    page: "builtin:review",
    openIfExists: true,
    body: [
      "---", "week: ${week.start()}", "---", "",
      "# Week of ${week.start()}", "",
      "## Completed", "", "${lifeloop.review.completed()}", "",
      "## Open", "", "${lifeloop.review.stillOpen()}", "",
      "## Active Projects", "", "${lifeloop.review.activeProjects()}", "",
      "## Waiting", "", "${lifeloop.review.waiting()}", "",
      "## Inbox", "", "${lifeloop.review.inbox()}", "",
      "## Reflection", "", "|^|", "",
    ].join("\n"),
  };
}
