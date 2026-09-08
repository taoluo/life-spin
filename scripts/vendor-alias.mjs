// The single alias table. Vendored SilverBullet code keeps its own import
// specifiers verbatim — that is what lets vendor:check assert zero local edits —
// so the mapping lives here, and both vitest and plain Node read it from here.
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(root, "vendor/silverbullet");

export const aliases = [
  [/^@silverbulletmd\/silverbullet\/lib\/(.*)$/, path.join(vendor, "plug-api/lib/$1.ts")],
  [/^@silverbulletmd\/silverbullet\/type\/(.*)$/, path.join(vendor, "plug-api/types/$1.ts")],
  [/^@silverbulletmd\/silverbullet\/syscalls$/, path.join(vendor, "plug-api/syscalls.ts")],
  [/^@silverbulletmd\/silverbullet\/syscall$/, path.join(vendor, "plug-api/syscall.ts")],
  [/^@silverbulletmd\/silverbullet\/constants$/, path.join(vendor, "plug-api/constants.ts")],
  [/^@silverbulletmd\/silverbullet\/ui$/, path.join(vendor, "plug-api/ui/index.ts")],
  [/^@lifeloop\/semantic-core$/, path.join(root, "packages/semantic-core/src/index.ts")],
  [/^@lifeloop\/apple-bridge$/, path.join(root, "packages/apple-bridge/src/index.ts")],
];

export function resolveAlias(specifier) {
  for (const [pattern, replacement] of aliases) {
    if (pattern.test(specifier)) return specifier.replace(pattern, replacement);
  }
  return null;
}

/** tsconfig `paths`, generated from the table above so nothing drifts. */
export function tsconfigPaths() {
  const out = {};
  for (const [pattern, replacement] of aliases) {
    const key = pattern.source
      .replace(/^\^/, "").replace(/\$$/, "")
      .replace(/\\\//g, "/").replace(/\\\./g, ".")
      .replace(/\(\.\*\)/, "*");
    out[key] = [path.relative(root, replacement).replace("$1", "*")];
  }
  return out;
}
