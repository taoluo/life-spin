import { applied, changeSet, refuse, validPageName, type MutationResult } from "../mutation.ts";
import type { Vault } from "../vault.ts";
import { pathOf } from "../vault.ts";
import { capture } from "./inbox.ts";
import { pageMetaFor, pageObject } from "../extract.ts";

export const INTERACTION_KINDS = ["call", "meeting", "message", "other"] as const;
export type InteractionKind = typeof INTERACTION_KINDS[number];

const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function personPath(vault: Vault, person: string): string | null {
  if (!validPageName(person) || person.includes("[[") || person.includes("]]")) return null;
  const path = pathOf(person);
  if (!vault.exists(path)) return null;
  const page = pageObject(vault.read(path), pageMetaFor(person));
  return (page.itags as string[] | undefined)?.includes("person") ? path : null;
}

/** Append one explicit interaction to its dated Journal page. */
export async function logInteraction(
  vault: Vault,
  person: string | readonly string[],
  date: string,
  kind: InteractionKind,
  note = "",
  journalFolder = "Journal",
): Promise<MutationResult<{ page: string; line: string; people: string[] }>> {
  const people = [...new Set(Array.isArray(person) ? person : [person])];
  if (!people.length) return refuse("invalid", "an interaction needs at least one Person");
  for (const name of people) {
    if (!personPath(vault, name)) return refuse("missing", `no such Person page: ${name}`);
  }
  if (!validDate(date)) return refuse("invalid", `not a date: ${date}`);
  if (!INTERACTION_KINDS.includes(kind)) return refuse("invalid", `unsupported interaction: ${kind}`);
  if (!validPageName(journalFolder)) return refuse("invalid", `not a journal folder: ${journalFolder}`);

  const page = `${journalFolder}/${date}`;
  const path = pathOf(page);
  const before = vault.exists(path) ? vault.read(path) : null;
  const eol = before?.includes("\r\n") ? "\r\n" : "\n";
  const detail = oneLine(note);
  const links = people.map((name) => `[[${name}]]`).join(" and ");
  const line = `* ${detail ? `${detail} ` : ""}${links} [interaction: ${kind}]`;
  const initial = `---${eol}tags: journal${eol}date: ${date}${eol}---${eol}${eol}`;
  const body = before ?? initial;
  const next = `${body}${body.length && !body.endsWith("\n") ? eol : ""}${line}${eol}`;
  const cs = changeSet(`log ${kind} with ${people.join(", ")}`);
  cs.expected.set(path, before);
  cs.writes.set(path, next);
  return applied(vault, cs, { page, line, people });
}

/** Create ordinary scheduled work; task projections and Reminders handle it from here. */
export async function createReconnectTask(
  vault: Vault,
  person: string,
  scheduled: string,
  page = "Inbox",
): Promise<MutationResult<{ page: string; line: string }>> {
  if (!personPath(vault, person)) return refuse("missing", `no such Person page: ${person}`);
  if (!validDate(scheduled)) return refuse("invalid", `not a date: ${scheduled}`);
  if (!validPageName(page)) return refuse("invalid", `not a page name: ${page}`);
  const line = `* [ ] Reconnect with [[${person}]] [scheduled: "${scheduled}"] [reconnect: true]`;
  const result = await capture(vault, line, page);
  return result.ok ? { ...result, value: { page, line } } : result;
}
