// Build, package and install the extension into your local VS Code, in one step.
//
//   node scripts/install-extension.mjs [--no-install]
//
// The .vsix lands in dist/ either way, so it can be handed to someone else or
// attached to a release without a marketplace account.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extension = join(root, "packages/vscode");
const out = join(root, "dist");

const run = (cmd, args, cwd = root) =>
  execFileSync(cmd, args, {
    cwd,
    stdio: "inherit",
    // VS Code must start as Electron. An Electron-based parent — an editor, or a
    // terminal inside one — exports this, and it is inherited: with it set, the
    // `code` CLI runs as plain Node and rejects its own flags as "bad option".
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });

const version = JSON.parse(readFileSync(join(extension, "package.json"), "utf8")).version;

console.log("→ building");
run("node", [join(root, "scripts/build-extension.mjs")]);

console.log("→ packaging");
mkdirSync(out, { recursive: true });
for (const file of readdirSync(out)) {
  if (file.endsWith(".vsix")) rmSync(join(out, file));
}
run("npx", ["vsce", "package", "--no-dependencies", "--out", out], extension);

const vsix = join(out, `lifeloop-vscode-${version}.vsix`);
console.log(`→ packaged ${vsix}`);

if (process.argv.includes("--no-install")) {
  console.log("\nInstall it yourself with:");
  console.log(`  code --install-extension ${vsix}`);
  console.log("or in VS Code: Extensions → ⋯ → Install from VSIX…");
  process.exit(0);
}

console.log("→ installing");
try {
  run("code", ["--install-extension", vsix, "--force"]);
  console.log("\nInstalled. Reload VS Code, open a folder of Markdown, and the LifeLoop");
  console.log("view appears in the activity bar. Remove it with:");
  console.log("  code --uninstall-extension lifeloop.lifeloop-vscode");
} catch {
  console.error("\nCould not run the `code` CLI.");
  console.error("In VS Code: Command Palette → 'Shell Command: Install code command in PATH',");
  console.error(`or install by hand: Extensions → ⋯ → Install from VSIX… → ${vsix}`);
  process.exit(1);
}
