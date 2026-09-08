import { expect, test } from "vitest";
import { parseExpressionString } from "../../../vendor/silverbullet/client/space_lua/parse.ts";
import { evalExpression } from "../../../vendor/silverbullet/client/space_lua/eval.ts";
import {
  LuaEnv, LuaStackFrame, jsToLuaValue, LuaBuiltinFunction,
} from "../../../vendor/silverbullet/client/space_lua/runtime.ts";
import { ArrayQueryCollection } from "../../../vendor/silverbullet/client/space_lua/query_collection.ts";
import { Store, indexVault, tasks } from "./index.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Evidence that Space Lua and SLIQ are reachable, not aspirational.
 *
 * The whole runtime came along with the parser — `markdown_parser/parser.ts`
 * imports `luaLanguage` — so 468K of evaluator, stdlib and query engine is
 * already in the bundle, tested by upstream's own suite. These two tests exist
 * because "we ship it" and "it runs" are different claims, and the difference
 * decides whether in-page queries are a port or a rewrite.
 */
test("the vendored Space Lua runtime actually executes", async () => {
  const env = new LuaEnv();
  const sf = new LuaStackFrame(env, null);

  expect(await evalExpression(parseExpressionString("1 + 2 * 3"), env, sf)).toBe(7);

  env.set("tasks", jsToLuaValue([
    { name: "write paper", done: false },
    { name: "ship", done: true },
  ]));
  expect(await evalExpression(parseExpressionString("tasks[1].name"), env, sf))
    .toBe("write paper");

  env.set("upper", new LuaBuiltinFunction((_sf: any, s: any) => String(s).toUpperCase()));
  expect(await evalExpression(parseExpressionString("upper('hi')"), env, sf)).toBe("HI");
});

test("SLIQ queries run against our own store", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sliq-"));
  writeFileSync(join(dir, "W.md"), [
    '* [ ] write the paper [deadline: "2026-09-15"]',
    '* [ ] ship it [deadline: "2026-09-09"]',
    "* [x] done already",
    "",
  ].join("\n"));
  const store = new Store(":memory:");
  await indexVault(dir, store);

  // Our own projection, handed to SilverBullet's query engine.
  const collection = new ArrayQueryCollection(tasks.open(store));
  const env = new LuaEnv();
  const sf = new LuaStackFrame(env, null);

  const rows = await collection.query(
    {
      objectVariable: "_",
      where: parseExpressionString('_.deadline < "2026-09-10"'),
      orderBy: [{ expr: parseExpressionString("_.name"), desc: false }],
    } as any,
    env,
    sf,
  );

  expect(rows.map((r: any) => r.name)).toEqual(["ship it"]);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
