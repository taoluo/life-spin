// Syntax-checks Lua using SilverBullet's own parser: every space-lua block in the library, plus
// any .lua files passed as arguments.
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";

// parse-lua.js imports "@lezer/lr" by bare specifier, so stage a copy whose import resolves.
const require = createRequire(import.meta.url);
const SB_SRC = process.env.SB_SRC || "silverbullet";
const STAGE = join(process.env.TMPDIR || "/tmp", "lifeloop-luacheck");
let parser;
try {
  const lezer = require.resolve("@lezer/lr", { paths: [join(process.cwd(), "test"), process.cwd()] });
  mkdirSync(STAGE, { recursive: true });
  for (const f of ["parse-lua.js", "parse-lua.terms.js", "lua_comment.js"]) {
    const src = readFileSync(join(SB_SRC, "client/space_lua", f), "utf8");
    writeFileSync(join(STAGE, f), src.replaceAll('from "@lezer/lr"', `from ${JSON.stringify(lezer)}`));
  }
  ({ parser } = await import(join(STAGE, "parse-lua.js")));
} catch (e) {
  console.log(`skipped: needs the SilverBullet source at ${SB_SRC} and @lezer/lr (${e.message})`);
  process.exit(0);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".md")) out.push(p);
  }
  return out;
}

function check(label, code, lineOffset) {
  const errors = [];
  parser.parse(code).iterate({ enter(node) { if (node.type.isError) errors.push(node.from); } });
  for (const pos of errors.slice(0, 3).filter((v, i, a) => a.indexOf(v) === i)) {
    const line = code.slice(0, pos).split("\n").length;
    console.log(`${label}:${lineOffset + line}  ${code.split("\n")[line - 1].trim().slice(0, 90)}`);
  }
  return errors.length;
}

let problems = 0;
for (const file of ["LifeLoop.md", ...walk("LifeLoop")]) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/```space-lua\n([\s\S]*?)```/g)) {
    problems += check(file, m[1], text.slice(0, m.index).split("\n").length);
  }
}
for (const file of process.argv.slice(2)) {
  if (existsSync(file)) problems += check(file, readFileSync(file, "utf8"), 0);
}
console.log(problems === 0 ? "OK: every Lua block parses" : `${problems} parse error(s)`);
process.exit(problems === 0 ? 0 : 1);
