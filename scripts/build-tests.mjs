// Compiles the VS Code integration tests to CommonJS, which is what the test
// harness loads. Same alias table as everything else.
import { build } from "esbuild";
import { resolveAlias } from "./vendor-alias.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const aliasPlugin = {
  name: "lifeloop-vendor-alias",
  setup(b) {
    b.onResolve({ filter: /^@(silverbulletmd|lifeloop)\// }, (args) => {
      const aliased = resolveAlias(args.path);
      return aliased ? { path: aliased } : null;
    });
  },
};

await build({
  entryPoints: [
    path.join(root, "packages/vscode/test/runTest.ts"),
    path.join(root, "packages/vscode/test/suite/index.ts"),
    path.join(root, "packages/vscode/test/suite/extension.test.ts"),
  ],
  outdir: path.join(root, "packages/vscode/out"),
  outbase: path.join(root, "packages/vscode/test"),
  bundle: true,
  external: ["vscode", "node:sqlite", "mocha", "@vscode/test-electron"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
  plugins: [aliasPlugin],
});
