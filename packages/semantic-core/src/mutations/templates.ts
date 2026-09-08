import { apply, changeSet, refuse, applied, validPageName, type MutationResult } from "../mutation.ts";
import type { Vault } from "../vault.ts";
import { pathOf } from "../vault.ts";
import { day, week, shift } from "../projections.ts";
import { frontmatterOf } from "./pages.ts";

/**
 * Page templates.
 *
 * LifeLoop already had templates — the daily note, the weekly review, the page an
 * attached task gets — but they were written into the commands that create them.
 * That means the one thing a person most wants to change about a weekly review,
 * its shape, could only be changed by editing the extension.
 *
 * So a template is a page. `Templates/Daily` describes what a daily note looks
 * like, and editing it is how you change yours. The built-in shapes stay as
 * fallbacks, so a vault with no templates behaves exactly as before.
 *
 * SilverBullet's frontmatter keys are used as-is, because a vault arriving from
 * there should not need its templates rewritten:
 *
 *   suggestedName   what to call the new page, substitutions allowed
 *   confirmName     ask before creating (default true)
 *   openIfExists    open rather than refusing when the name is taken
 *   command         the name this template is offered under
 */

export type PageTemplate = {
  /** The template page's own name. */
  page: string;
  /** The name it proposes for a new page, before substitution. */
  suggestedName?: string;
  confirmName: boolean;
  openIfExists: boolean;
  command?: string;
  /** Shown beside the name wherever the template is offered. */
  description?: string;
  /** Higher sorts earlier. Upstream's key, same meaning. */
  priority: number;
  /** The body, with frontmatter removed. */
  body: string;
};

export const TEMPLATE_FOLDER = "Templates";

/** The tag a page carries to become a slash command. Upstream's, unchanged. */
export const SLASH_TAG = "meta/template/slash";

export type SlashTemplate = {
  /** What you type after the `/`. */
  name: string;
  description?: string;
  priority: number;
  /** The body to insert, `|^|` still in it. */
  body: string;
  /** The page it came from, or `builtin` for the ones we ship. */
  page: string;
};

/**
 * Slash templates a vault defines.
 *
 * A page tagged `meta/template/slash` becomes a slash command named after the last
 * component of its page name — `Library/Slash Template/action-items` is
 * `/action-items`. That naming rule is upstream's and is kept, so a vault arriving
 * from SilverBullet gets its slash commands without being edited.
 *
 * Candidate pages are passed in rather than discovered here: the caller has an
 * index that already knows which pages carry the tag, and re-reading every page in
 * the vault to find four of them would be the wrong way round.
 */
export function slashTemplates(vault: Vault, pages: string[]): SlashTemplate[] {
  const found: SlashTemplate[] = [];
  for (const page of pages) {
    const template = readTemplate(vault, page);
    if (!template) continue;
    const name = page.split("/").pop()!.trim();
    if (!name) continue;
    found.push({
      name,
      description: template.description,
      priority: template.priority,
      body: template.body.trim(),
      page,
    });
  }
  // Higher priority first, then alphabetical, so the list is stable between runs.
  return found.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

/**
 * The slash templates LifeLoop ships.
 *
 * These are upstream's standard-library set, as text rather than as a library page,
 * so a vault that has never installed anything still gets them. A vault template of
 * the same name wins — what someone wrote down beats what we assumed.
 *
 * The ones that *convert the current line* rather than insert at it (`/h1`, `/task`)
 * are not here: they are a different operation, and pretending they are insertions
 * would leave the old line behind.
 */
export function builtinSlashTemplates(): SlashTemplate[] {
  const make = (name: string, description: string, body: string, priority = 0): SlashTemplate =>
    ({ name, description, body, priority, page: "builtin" });
  return [
    make("today", "Today's date", "${date.today()}"),
    make("tomorrow", "Tomorrow's date", "${date.tomorrow()}"),
    make("yesterday", "Yesterday's date", "${date.yesterday()}"),
    make("query", "A LifeLoop query block", "```query\n|^|\n```"),
    make("lua-query", "A Space Lua query expression", "${query[[\n  from |^|\n]]}"),
    make("space-lua", "A Space Lua block", "```space-lua\n|^|\n```"),
    make("code", "A fenced code block", "```|^|\n\n```"),
    make("table", "A Markdown table", "| |^| | |\n| --- | --- |\n|  |  |"),
    make("hr", "A horizontal rule", "---\n\n|^|"),
    make("frontmatter", "A frontmatter block", "---\n|^|\n---\n"),
    make("note-admonition", "A note callout", "> **note** |^|"),
    make("warning-admonition", "A warning callout", "> **warning** |^|"),
    make("danger-admonition", "A danger callout", "> **danger** |^|"),
  ];
}

/** Vault templates, then the built-ins that a vault has not replaced. */
export function allSlashTemplates(vault: Vault, pages: string[]): SlashTemplate[] {
  const mine = slashTemplates(vault, pages);
  const taken = new Set(mine.map((t) => t.name));
  return [...mine, ...builtinSlashTemplates().filter((t) => !taken.has(t.name))];
}

/**
 * Substitutions a template may use without any scripting.
 *
 * Deliberately a fixed, small set. Templates are core — the daily note has to work
 * in a vault that has never switched Space Lua on — so these are evaluated here
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
    suggestedName: value("suggestedName"),
    confirmName: value("confirmName") !== "false",
    openIfExists: value("openIfExists") === "true",
    command: value("command"),
    description: value("description"),
    priority: Number(value("priority") ?? 0) || 0,
    body: front ? front.rest : text,
  };
}

/** Every template in the vault's template folder. */
export function templates(vault: Vault, folder = TEMPLATE_FOLDER): PageTemplate[] {
  return vault
    .list()
    .filter((path) => path.startsWith(`${folder}/`) && path.endsWith(".md"))
    .map((path) => readTemplate(vault, path.slice(0, -3)))
    .filter((t): t is PageTemplate => t !== null)
    .sort((a, b) => a.page.localeCompare(b.page));
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
  cs.writes.set(path, body);
  return applied(vault, cs, { page, cursor: offset, existed: false });
}

/**
 * The shapes LifeLoop creates when a vault has no template of its own.
 *
 * These are the strings that used to live inside the commands. Keeping them means
 * a fresh vault still gets a sensible daily note; moving them here means a vault
 * can replace one by writing a page.
 */
export function builtinTemplate(kind: "daily" | "review" | "project" | "page"): PageTemplate {
  const shared = { page: `builtin:${kind}`, confirmName: false, openIfExists: true, priority: 0 };
  switch (kind) {
    case "daily":
      return {
        ...shared,
        suggestedName: "Journal/${date.today()}",
        body: "# ${date.today()}\n\n## Log\n\n|^|\n",
      };
    case "review":
      return {
        ...shared,
        suggestedName: "Reviews/${week.start()}",
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
    case "project":
      return {
        ...shared,
        confirmName: true,
        body: "---\ntags: project\nstatus: active\n---\n\n# Outcome\n\n|^|\n\n# Tasks\n\n",
      };
    case "page":
      return { ...shared, confirmName: true, body: "# |^|\n\n" };
  }
}
