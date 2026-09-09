import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, expect, test } from "vitest";

const root = mkdtempSync(join(tmpdir(), "lifeloop-cli-relationships-"));
const cli = join(import.meta.dirname, "main.ts");

beforeAll(() => {
  mkdirSync(join(root, "People"), { recursive: true });
  writeFileSync(join(root, "People/Alice.md"), "---\ntags: person\n---\n");
  writeFileSync(join(root, "People/Bob.md"), "---\ntags: person\n---\n");
  const indexed = run("index", root);
  expect(indexed.status).toBe(0);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function run(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", cli, ...args], {
    encoding: "utf8",
  });
}

test("named projection limit is applied", () => {
  const result = run("query", root, "people", "--limit", "1", "--json");
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toHaveLength(1);

  const none = run("query", root, "people", "--limit", "0", "--json");
  expect(none.status).toBe(0);
  expect(JSON.parse(none.stdout)).toEqual([]);
});

test.each(["-1", "nope", "1.5"])("invalid --limit %s fails without row JSON", (limit) => {
  const result = run("query", root, "people", "--limit", limit, "--json");
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("--limit must be a non-negative integer");
  expect(result.stdout).toBe("");
});
