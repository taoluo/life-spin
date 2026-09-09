import { originalSourceOffset, pathOf } from "@lifeloop/semantic-core";
import type { LifeLoop } from "./workspace.ts";

const label = (value: string): string => value
  .replace(/[\r\n]+/g, " ")
  .replace(/([\\`*_[\]<>#])/g, "\\$1");

/** Standard Markdown navigation that does not depend on Foam. */
export function personLink(lifeloop: LifeLoop, person: string, text = person): string {
  return lifeloop.vault.exists(pathOf(person))
    ? `[${label(text)}](<${lifeloop.pageUri(person).toString()}>)`
    : label(text);
}

/** SB refs stay SB refs; only indexed numeric offsets need CRLF translation. */
export function sourceLink(lifeloop: LifeLoop, ref: string): string {
  const numeric = /^(.*)@(\d+)$/.exec(ref);
  const page = numeric?.[1] ?? ref.slice(0, ref.lastIndexOf("@"));
  if (!page || !lifeloop.vault.exists(pathOf(page))) return label(ref);
  if (!numeric) return `[[${ref}]]`;
  try {
    const offset = originalSourceOffset(lifeloop.vault.read(pathOf(page)), Number(numeric[2]));
    return `[[${page}@${offset}]]`;
  } catch { return label(ref); }
}
