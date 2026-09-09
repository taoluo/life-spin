import { originalSourceOffset, pathOf, resolveRef } from "@lifeloop/semantic-core";
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

/** SB refs stay SB refs; bare anchors use known page context. */
export function sourceLink(lifeloop: LifeLoop, ref: string, knownPage?: string): string {
  const qualified = ref.includes("@") ? ref : knownPage ? `${knownPage}@${ref}` : ref;
  const numeric = /^(.*)@(\d+)$/.exec(qualified);
  const page = numeric?.[1] ?? qualified.slice(0, qualified.lastIndexOf("@"));
  if (!page || !lifeloop.vault.exists(pathOf(page))) return label(ref);
  if (!numeric) return "ok" in resolveRef(lifeloop.vault, qualified) ? label(ref) : `[[${qualified}]]`;
  try {
    const offset = originalSourceOffset(lifeloop.vault.read(pathOf(page)), Number(numeric[2]));
    return `[[${page}@${offset}]]`;
  } catch { return label(ref); }
}
