import { expect, test, describe } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, indexVault, NodeVault, markdownFiles } from "../index.ts";
import { runLua } from "./host.ts";

/**
 * The render path, end to end: a block or expression in a page, evaluated, in a
 * shape the preview can show. This is the goal — a Lua block that produces
 * nothing visible is a Lua block nobody can tell ran.
 */
async function host(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "lua-render-"));
  for (const [p, body] of Object.entries(files)) writeFileSync(join(root, p), body);
  const store = new Store(":memory:");
  await indexVault(root, store);
  const paths = await markdownFiles(root);
  return {
    store, vault: new NodeVault(root, () => paths),
    cleanup: () => { store.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

describe("what a block can show", () => {
  test("a returned value survives the block's return signal", async () => {
    // Regression: `evalStatement` answers with `{ctrl:"return", values:[…]}`, so a
    // block returning a widget produced an object whose `__widget` was one level
    // down and nothing ever rendered.
    const h = await host({ "W.md": "* [ ] a task\n" });
    expect(await runLua("return 42", h, "block")).toMatchObject({ ok: true, value: 42 });
    expect(await runLua("return {1,2,3}", h, "block")).toMatchObject({ ok: true, value: [1, 2, 3] });
    expect(await runLua("return widget.html('hi')", h, "block")).toMatchObject({
      ok: true, value: { __widget: "html", children: ["hi"] },
    });
    h.cleanup();
  });

  test("a block with nothing to return shows nothing, and that is correct", async () => {
    // Configuration and definition blocks are most of a real vault. Inventing
    // output for them would put noise under every one.
    const h = await host({ "W.md": "x\n" });
    const result = await runLua('config.set("k", 1)', h, "block");
    expect(result).toMatchObject({ ok: true, value: undefined });
    h.cleanup();
  });

  test("a block can query the vault and return something to display", async () => {
    const h = await host({
      "W.md": '* [ ] write the paper [deadline: "2020-01-01"]\n* [x] shipped\n',
    });
    const result = await runLua("return index.tasks()", h, "block");
    expect(result.ok).toBe(true);
    const rows = (result as any).value as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("write the paper");
    h.cleanup();
  });

  test("an expression is what a ${...} in a page evaluates", async () => {
    const h = await host({ "W.md": '* [ ] overdue [deadline: "2020-01-01"]\n' });
    const result = await runLua("lifeloop.today({date = '2026-09-08'})", h);
    expect(result.ok).toBe(true);
    expect((result as any).value.overdue).toHaveLength(1);
    h.cleanup();
  });

  test("Lua's own library is available to shape the output", async () => {
    const h = await host({ "W.md": "x\n" });
    expect(await runLua("return string.upper('ok')", h, "block"))
      .toMatchObject({ ok: true, value: "OK" });
    h.cleanup();
  });
});
