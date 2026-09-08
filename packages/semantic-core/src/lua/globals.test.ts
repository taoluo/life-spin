import { expect, test, describe } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, indexVault, NodeVault, markdownFiles } from "../index.ts";
import { runLua, collectDeclarations } from "./host.ts";

/**
 * Lua's global functions.
 *
 * The namespaced tables — `string.*`, `table.*` — were there from the start, and
 * the bare globals were not. Almost no real script survives without them, and the
 * first query on SilverBullet's own front page died on `tostring`.
 */
async function host(files: Record<string, string> = { "W.md": "x\n" }) {
  const root = mkdtempSync(join(tmpdir(), "globals-"));
  for (const [p, body] of Object.entries(files)) writeFileSync(join(root, p), body);
  const store = new Store(":memory:");
  await indexVault(root, store);
  const paths = await markdownFiles(root);
  return {
    store, vault: new NodeVault(root, () => paths),
    cleanup: () => { store.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

describe("the globals a script assumes", () => {
  test("tostring, tonumber and type", async () => {
    const h = await host();
    expect(await runLua("tostring(42)", h)).toMatchObject({ ok: true, value: "42" });
    expect(await runLua("tonumber('7') + 1", h)).toMatchObject({ ok: true, value: 8 });
    // Unreadable input answers nil rather than raising, as Lua's does.
    expect(await runLua("tonumber('not a number')", h)).toMatchObject({ ok: true, value: null });
    expect(await runLua("type('a')", h)).toMatchObject({ ok: true, value: "string" });
    h.cleanup();
  });

  test("ipairs and pairs drive a for loop", async () => {
    const h = await host();
    expect(await runLua(
      "local sum = 0\nfor _, v in ipairs({10, 20, 30}) do sum = sum + v end\nreturn sum",
      h, "block",
    )).toMatchObject({ ok: true, value: 60 });

    expect(await runLua(
      "local n = 0\nfor k, v in pairs({a = 1, b = 2}) do n = n + v end\nreturn n",
      h, "block",
    )).toMatchObject({ ok: true, value: 3 });
    h.cleanup();
  });

  test("pcall catches what error throws", async () => {
    const h = await host();
    const caught = await runLua(
      "local ok, err = pcall(function() error('boom') end)\nreturn ok",
      h, "block",
    );
    expect(caught).toMatchObject({ ok: true, value: false });

    const fine = await runLua(
      "local ok, value = pcall(function() return 5 end)\nreturn value",
      h, "block",
    );
    expect(fine).toMatchObject({ ok: true, value: 5 });
    h.cleanup();
  });

  test("assert passes a truth through and stops on a falsehood", async () => {
    const h = await host();
    expect(await runLua("assert(1 == 1, 'never seen')", h)).toMatchObject({ ok: true });
    const failed = await runLua("assert(false, 'stopped here')", h);
    expect(failed.ok).toBe(false);
    expect((failed as any).error).toContain("stopped here");
    h.cleanup();
  });

  test("print is accepted and goes nowhere, so a logging script still runs", async () => {
    const h = await host();
    expect(await runLua("print('hello')\nreturn 'ran'", h, "block"))
      .toMatchObject({ ok: true, value: "ran" });
    h.cleanup();
  });

  test("the globals that would defeat the boundary are still absent", async () => {
    const h = await host();
    // Upstream's stdlib defines these alongside the rest; building the list by
    // hand is what keeps them out by construction.
    for (const attempt of ["js.import('x')", "net.fetch('http://x')", "dofile('x')", "load('x')"]) {
      expect((await runLua(attempt, h)).ok, attempt).toBe(false);
    }
    h.cleanup();
  });
});

describe("SilverBullet's own front page, verbatim", () => {
  test("all three of its queries, with their templates", async () => {
    const h = await host({
      "Big.md": "---\ntags: feature\nawesomeness: 9\n---\n# Big\n\n* [ ] undone\n",
      "Small.md": "---\ntags: feature\nawesomeness: 2\n---\n# Small\n",
    });
    const { space } = await collectDeclarations(
      [`templates = {}
        templates.featureItem = function(f)
          return "* " .. f.name .. " (" .. tostring(f.awesomeness) .. ")"
        end
        templates.pageItem = function(p) return "* " .. p.name end
        templates.taskItem = function(t) return "* " .. t.name end`],
      h,
    );

    const featureList = await runLua(
      `query[[ from f = tags.feature where f.tag == "page" order by f.awesomeness desc select templates.featureItem(f) ]]`,
      h, "expression", space,
    );
    expect(featureList).toMatchObject({ ok: true, value: ["* Big (9)", "* Small (2)"] });

    const activePages = await runLua(
      `query[[ from p = tags.page order by p.lastModified desc limit 5 select templates.pageItem(p) ]]`,
      h, "expression", space,
    );
    expect((activePages as any).value).toHaveLength(2);

    const todo = await runLua(
      `query[[ from t = tags.task where not t.done limit 3 select templates.taskItem(t) ]]`,
      h, "expression", space,
    );
    expect(todo).toMatchObject({ ok: true, value: ["* undone"] });
    h.cleanup();
  });
});
