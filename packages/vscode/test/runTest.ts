import * as path from "node:path";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { runTests } from "@vscode/test-electron";

/**
 * Boots a real VS Code against a copy of the fixture vault.
 *
 * A *copy*, because these tests write: capture appends, tasks get ticked, files
 * are created. Running them against the fixtures themselves would make the suite
 * order-dependent and would edit the repo.
 */
async function main() {
  /**
   * VS Code must start as Electron, not as Node.
   *
   * `ELECTRON_RUN_AS_NODE=1` is set by any Electron-based parent process — an
   * editor, or a terminal running inside one — and it is inherited. With it set,
   * the VS Code binary starts as plain Node: the workspace path is taken as a
   * script to execute and every real flag is rejected as a "bad option". The
   * symptoms point everywhere except the cause, so it is unset explicitly.
   */
  delete process.env.ELECTRON_RUN_AS_NODE;

  const root = path.resolve(__dirname, "../../..");
  const workspace = mkdtempSync(path.join(tmpdir(), "lifeloop-vscode-it-"));
  cpSync(path.join(root, "test/fixtures"), workspace, { recursive: true });

  try {
    await runTests({
      extensionDevelopmentPath: path.join(root, "packages/vscode"),
      extensionTestsPath: path.resolve(__dirname, "./suite/index.js"),
      // Just the folder. This VS Code build rejects the usual CI flags outright
      // ("bad option"), and a rejected flag stops the run before any test.
      // `--folder-uri`, not a bare path: this build resolves a positional argument
      // as a module to execute and dies before the extension host starts.
      launchArgs: [workspace],
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("integration tests failed:", error);
  process.exit(1);
});
