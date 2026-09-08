// Node ESM resolve hook: the same alias table vitest uses, for plain `node`.
import { pathToFileURL } from "node:url";
import { resolveAlias } from "./vendor-alias.mjs";

export function resolve(specifier, context, nextResolve) {
  const aliased = resolveAlias(specifier);
  if (aliased) return { url: pathToFileURL(aliased).href, shortCircuit: true };
  return nextResolve(specifier, context);
}
