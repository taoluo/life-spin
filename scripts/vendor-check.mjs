// Two structural guards from the execution plan, 0.2:
//   1. every vendored file still matches the pinned upstream commit
//   2. vendored code imports nothing from packages/
// Editing a vendored file fails the build. That is the point: adapt at the seam.
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

const OUT = resolve(process.cwd(), "vendor/silverbullet");
const manifestPath = join(OUT, "MANIFEST.json");
if (!existsSync(manifestPath)) {
  console.error("vendor/silverbullet/MANIFEST.json missing — run npm run vendor:sync");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
let failures = 0;

for (const [rel, expected] of Object.entries(manifest.files)) {
  const abs = join(OUT, rel);
  if (!existsSync(abs)) { console.error(`MISSING   ${rel}`); failures++; continue; }
  const src = readFileSync(abs);
  const actual = createHash("sha256").update(src).digest("hex");
  if (actual !== expected) { console.error(`EDITED    ${rel}`); failures++; continue; }
  if (/from\s+["'](?:@lifeloop\/|.*\/packages\/)/.test(src.toString())) {
    console.error(`IMPORTS PACKAGES  ${rel}`); failures++;
  }
}

if (failures) {
  console.error(`\n${failures} vendored file(s) diverge from ${manifest.version} (${manifest.commit.slice(0, 8)}).`);
  console.error("Vendored code is not edited. Adapt in packages/semantic-core/src/compat/ instead.");
  console.error("If an edit is genuinely unavoidable: make it deliberate, re-run vendor:sync,");
  console.error("and record it in vendor/silverbullet/PROVENANCE.md with the upstream issue it should become.");
  process.exit(1);
}
console.log(`vendor clean: ${Object.keys(manifest.files).length} files match ${manifest.version} (${manifest.commit.slice(0, 8)})`);
