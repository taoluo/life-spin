import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aliases } from "./scripts/vendor-alias.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// One alias table, shared with scripts/loader.mjs so `node` and `vitest` cannot drift.
export default defineConfig({
  resolve: {
    alias: [
      ...aliases.map(([find, replacement]) => ({ find, replacement })),
      // `vscode` only exists inside the host. Tests get the small surface the
      // extension actually uses; anything deeper needs a real host and is not faked.
      { find: /^vscode$/, replacement: path.join(here, "packages/vscode/test/vscode-mock.ts") },
    ],
  },
  test: {
    // Upstream's own tests run against the vendored copy. They are the conformance
    // proof for extraction: we call SilverBullet's code rather than reimplementing
    // it, so its assertions passing here means the copy behaves as upstream says.
    include: [
      "packages/**/*.test.ts",
      "test/conformance/**/*.test.ts",
      "test/integration/**/*.test.ts",
      "vendor/silverbullet/**/*.test.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "silverbullet/**",
      // Helper files that export fixtures and declare no tests. Upstream's own
      // vitest config excludes these by name for the same reason.
      "vendor/silverbullet/client/data/kv_primitives.test.ts",
      "vendor/silverbullet/client/spaces/space_primitives.test.ts",
      // The VS Code integration suite is mocha inside a real editor host.
      // `npm run test:integration` runs it; vitest cannot.
      "packages/vscode/test/suite/**",
      "packages/vscode/out/**",
    ],
    testTimeout: 30000,
  },
});
