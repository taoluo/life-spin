import * as path from "node:path";
import { cpSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from "node:fs";
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
  try {
    cpSync(path.join(root, "test/fixtures"), workspace, { recursive: true });

    const withFoam = process.argv.includes("--foam");
    const extensions = path.join(workspace, ".test-extensions");
    const profile = path.join(workspace, ".test-profile");
    mkdirSync(extensions);
    const env: Record<string, string> = {};
    if (withFoam) {
      const source = process.env.LIFELOOP_FOAM_PATH;
      if (!source) throw new Error("test:foam requires LIFELOOP_FOAM_PATH pointing to Foam 0.44.6");
      const pkg = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8"));
      if (pkg.publisher !== "foam" || pkg.name !== "foam-vscode" || pkg.version !== "0.44.6") {
        throw new Error("Foam integration gate is pinned to foam.foam-vscode 0.44.6");
      }
      cpSync(source, path.join(extensions, "foam.foam-vscode-0.44.6"), { recursive: true });
      env.LIFELOOP_TEST_FOAM = "1";
      if (process.env.LIFELOOP_TEST_FOLDER_RENAME) env.LIFELOOP_TEST_FOLDER_RENAME = "1";
    }
    mkdirSync(path.join(workspace, ".vscode"), { recursive: true });
    writeFileSync(path.join(workspace, ".vscode/settings.json"), JSON.stringify({
      "telemetry.telemetryLevel": "off",
      "foam.files.exclude": ["**/.test-*/**", "**/.lifeloop/**"],
      "foam.edit.linkReferenceDefinitions": "off",
      "foam.links.directory.mode": "disabled",
      "foam.links.sync.enable": true,
      "foam.openDailyNote.directory": "FoamJournal",
    }));
    mkdirSync(path.join(workspace, "Foam"), { recursive: true });
    writeFileSync(path.join(workspace, "Foam/Target.md"), "# Target\n\n## Detail\n\nFOAM_EMBED_SENTINEL\n");
    writeFileSync(path.join(workspace, "Foam/Source.md"), "[[Foam/Target]]\n[[Foam/Target#Detail]]\n");
    mkdirSync(path.join(workspace, ".foam/templates"), { recursive: true });
    cpSync(
      path.join(root, "docs/migration/foam-templates/daily-note.md"),
      path.join(workspace, ".foam/templates/daily-note.md"),
    );

    const developmentPath = process.env.LIFELOOP_TEST_EXTENSION_PATH ?? path.join(root, "packages/vscode");
    // VS Code scopes its API object by extension path. Keep harness and product in
    // the same scope so prompt stubs reach the packaged extension's API instance.
    if (process.env.LIFELOOP_TEST_EXTENSION_PATH) {
      const modules = path.join(developmentPath, "node_modules");
      if (!existsSync(modules)) symlinkSync(path.join(root, "node_modules"), modules, "dir"); // Test harness dependencies.
      cpSync(path.resolve(__dirname, "suite"), path.join(developmentPath, "out/suite"), { recursive: true });
    }
    await runTests({
      extensionDevelopmentPath: developmentPath,
      extensionTestsPath: path.join(developmentPath, "out/suite/index.js"),
      // A fixture folder and isolated extension/profile directories.
      version: "1.136.1",
      extensionTestsEnv: env,
      launchArgs: [workspace, "--extensions-dir", extensions, "--user-data-dir", profile, "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust"],
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("integration tests failed:", error);
  process.exit(1);
});
