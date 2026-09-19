import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "examples/demo-vault");

const calendarDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
const shift = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);
const iso = (date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, "0"),
  String(date.getDate()).padStart(2, "0"),
].join("-");

const today = calendarDay(new Date());
const weekStart = shift(today, -((today.getDay() + 6) % 7));
const values = {
  __TODAY__: iso(today),
  __TODAY_MM_DD__: iso(today).slice(5),
  __YESTERDAY__: iso(shift(today, -1)),
  __TOMORROW__: iso(shift(today, 1)),
  __WEEK_START__: iso(weekStart),
  __WEEK_END__: iso(shift(weekStart, 6)),
  __NEXT_WEEK_START__: iso(shift(weekStart, 7)),
};
const render = (text) => Object.entries(values).reduce(
  (result, [token, value]) => result.replaceAll(token, value), text,
);

const files = [];
const collect = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else files.push({
      path: render(relative(source, path)),
      body: render(readFileSync(path, "utf8")),
    });
  }
};
collect(source);

const unresolved = files.filter(({ path, body }) => /__[A-Z0-9_]+__/.test(path + body));
if (unresolved.length) throw new Error(`unresolved demo tokens: ${unresolved.map((file) => file.path).join(", ")}`);

const target = resolve(root, process.argv[2] ?? `dist/lifeloop-demo-vault-${values.__TODAY__}`);
if (existsSync(target)) {
  console.error(`Demo vault already exists; nothing was overwritten: ${target}`);
  process.exit(1);
}

for (const file of files) {
  const path = join(target, file.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, file.body);
}

console.log(`Created LifeLoop demo vault: ${target}`);
console.log("Open that folder in VS Code, then start with START-HERE.md.");
