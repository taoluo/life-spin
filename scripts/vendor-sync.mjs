// Copies the pinned SilverBullet semantic subset into vendor/silverbullet/ and
// writes MANIFEST.json. Vendored files are never edited: see PROVENANCE.md.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync } from "node:fs";
import { dirname, resolve, relative, join } from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

const SB = process.env.SB_SRC ?? resolve(process.cwd(), "silverbullet");
const OUT = resolve(process.cwd(), "vendor/silverbullet");

// Seeds: the parser and the whole indexer, including its orchestration.
//
// The plan expected to reimplement indexer.ts over our own store. Reading it says
// otherwise: `indexMarkdown(text, pageMeta)` already returns the object list and
// persists nothing — only `indexPage` calls `index.indexObjects`. So the orchestration
// (indexer order, comment marking, anchor records, recipient stamping) is vendored
// rather than reproduced, and the only thing we supply is `markdown.parseMarkdown`.
// Less of ours to drift.
const SEEDS = [
  "client/markdown_parser/parser.ts",
  "plugs/index/indexer.ts",
  "plugs/index/tags.ts",   // updateITags: inherited-tag semantics stay upstream's
  // Lua's own standard library, module by module rather than through
  // `stdlib.ts`. That file also imports `stdlib/net.ts` and `stdlib/js.ts`, which
  // reach into SilverBullet's client and drag in CodeMirror and preact — and
  // which are arbitrary fetch and arbitrary JS import, the two things a script in
  // a note should least be handed. Excluding them is a feature, not a shortcut.
  "client/space_lua/stdlib/string.ts",
  "client/space_lua/stdlib/table.ts",
  "client/space_lua/stdlib/math.ts",
  "client/space_lua/stdlib/os.ts",
  "client/space_lua/stdlib/encoding.ts",
  "client/space_lua/stdlib/pattern.ts",
  // Transclusion syntax — `![[page]]`, `![[image.png|300]]`, `![[page#header]]`.
  // It is *file* syntax, so a vault arriving from SilverBullet already contains
  // it, and parsing it our own way would be inventing a second reading of
  // something already written down.
  "plug-api/lib/transclusion.ts",
  // Baked sections — `<!--#lua EXPR -->` body `<!--/lua-->`. Also *file* syntax,
  // and the one place where getting the delimiters subtly wrong would corrupt a
  // page on the next update rather than merely render it oddly.
  "client/baked_sections/regions.ts",
];

const aliasToPath = (spec) => {
  const m = spec.match(/^@silverbulletmd\/silverbullet\/(.*)$/);
  if (!m) return null;
  const p = m[1];
  if (p.startsWith("lib/")) return `plug-api/${p}.ts`;
  if (p.startsWith("type/")) return `plug-api/types/${p.slice(5)}.ts`;
  if (["syscall", "syscalls", "constants"].includes(p)) return `plug-api/${p}.ts`;
  if (p === "ui") return "plug-api/ui/index.ts";
  return `plug-api/${p}.ts`;
};

const seen = new Set(), external = new Set();
const visit = (rel) => {
  if (seen.has(rel)) return;
  const abs = resolve(SB, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) return;
  seen.add(rel);
  const src = readFileSync(abs, "utf8");
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g)) {
    const spec = m[1];
    if (spec.startsWith(".")) { visit(relative(SB, resolve(dirname(abs), spec))); continue; }
    const a = aliasToPath(spec);
    if (a) { visit(a); continue; }
    external.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
  }
};
SEEDS.forEach(visit);

// Upstream's own tests for what we vendored — but as *leaves*, never as new seeds.
//
// This is the conformance argument, and it is stronger than sampling a corpus:
// we do not reimplement extraction, we call it. Behaviour can only diverge if the
// code differs (vendor:check hashes it) or upstream's assertions stop holding
// (these run them). Proof by construction rather than by comparison.
//
// A test is taken only when everything it imports is already vendored. Following
// test imports transitively pulls in CodeMirror, preact and the whole client,
// which is a UI dependency tree we have no reason to carry.
const production = new Set(seen);
const testFiles = [];
for (const rel of production) {
  if (!rel.endsWith(".ts") || rel.endsWith(".test.ts")) continue;
  const test = rel.replace(/\.ts$/, ".test.ts");
  const abs = resolve(SB, test);
  if (!existsSync(abs)) continue;
  const src = readFileSync(abs, "utf8");
  // Dynamic imports count too: a test that lazily pulls in a UI module is just as
  // unsatisfiable as one that imports it at the top, and misses the static scan.
  const needs = [
    ...[...src.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
  ];
  const satisfied = needs.every((spec) => {
    if (spec === "vitest" || spec.startsWith("node:")) return true;
    if (spec.startsWith(".")) return production.has(relative(SB, resolve(dirname(abs), spec)));
    const a = aliasToPath(spec);
    if (a) return production.has(a);
    return external.has(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
  });
  if (satisfied) testFiles.push(test);
}
for (const test of testFiles) seen.add(test);

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
const files = [...seen].sort();
const manifest = { files: {} };
for (const rel of files) {
  const src = readFileSync(resolve(SB, rel));
  const dest = join(OUT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, src);
  manifest.files[rel] = createHash("sha256").update(src).digest("hex");
}
let commit = "unknown";
try { commit = execSync("git rev-parse HEAD", { cwd: SB }).toString().trim(); } catch {}
let version = "unknown";
try { version = JSON.parse(readFileSync(resolve(SB, "version.json"), "utf8")).version; } catch {}
const out = {
  upstream: "https://github.com/silverbulletmd/silverbullet",
  licence: "MIT (Copyright 2022, Zef Hemel)",
  commit, version,
  seeds: SEEDS,
  upstreamTests: testFiles.sort(),
  externalDependencies: [...external].sort(),
  fileCount: files.length,
  ...manifest,
};
writeFileSync(join(OUT, "MANIFEST.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`vendored ${files.length} files from ${version} (${commit.slice(0, 8)})`);
console.log(`external deps: ${[...external].sort().join(", ")}`);
