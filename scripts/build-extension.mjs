// Bundles the extension. The vendored SilverBullet sources and the semantic core
// are bundled in, so the published extension carries no path aliases at runtime.
import { build, context } from "esbuild";
import { resolveAlias } from "./vendor-alias.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Resolves the same alias table vitest and the Node loader use. */
const aliasPlugin = {
  name: "lifeloop-vendor-alias",
  setup(build) {
    build.onResolve({ filter: /^@(silverbulletmd|lifeloop)\// }, (args) => {
      const aliased = resolveAlias(args.path);
      return aliased ? { path: aliased } : null;
    });
  },
};

const options = {
  entryPoints: [path.join(root, "packages/vscode/src/extension.ts")],
  bundle: true,
  outfile: path.join(root, "packages/vscode/dist/extension.js"),
  external: ["vscode", "node:sqlite"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
  plugins: [aliasPlugin],
};

if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("watching…");
} else {
  await build(options);
}
