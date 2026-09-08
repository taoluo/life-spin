import { expect, test, describe } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, indexVault, NodeVault, markdownFiles } from "../index.ts";
import { runLua } from "./host.ts";

/**
 * SLIQ — SilverBullet's integrated query language.
 *
 * It needed no parser of ours: `query[[...]]` is an overload of Lua's
 * call-with-one-string syntax, so the vendored parser already produces a `Query`
 * expression and the vendored evaluator already runs it. What it needed was a
 * `from` that resolves to something of ours.
 */
async function host(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "sliq-"));
  for (const [p, body] of Object.entries(files)) writeFileSync(join(root, p), body);
  const store = new Store(":memory:");
  await indexVault(root, store);
  const paths = await markdownFiles(root);
  return {
    store, vault: new NodeVault(root, () => paths),
    cleanup: () => { store.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

const VAULT = {
  "W.md": [
    '* [ ] write the paper [deadline: "2026-09-15"]',
    '* [ ] ship it [deadline: "2026-09-09"]',
    '* [ ] chase legal [deadline: "2026-09-20"] #waiting',
    "* [x] already done",
    "",
  ].join("\n"),
};

describe("SLIQ against our own index", () => {
  test("from + where + order by + limit", async () => {
    const h = await host(VAULT);
    const result = await runLua(
      `query[[ from index.tasks() where _.deadline < "2026-09-16" order by _.deadline limit 5 ]]`,
      h,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const rows = (result as any).value as any[];
    expect(rows.map((r) => r.name)).toEqual(["ship it", "write the paper"]);
    h.cleanup();
  });

  test("select projects a shape", async () => {
    const h = await host(VAULT);
    const result = await runLua(
      `query[[ from index.tasks() where _.deadline select _.name ]]`,
      h,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((result as any).value).toContain("ship it");
    h.cleanup();
  });

  test("order by desc", async () => {
    const h = await host(VAULT);
    const result = await runLua(
      `query[[ from index.tasks() where _.deadline order by _.deadline desc select _.name ]]`,
      h,
    );
    expect(result.ok).toBe(true);
    expect((result as any).value[0]).toBe("chase legal");
    h.cleanup();
  });

  test("a query over pages, not only tasks", async () => {
    const h = await host({
      "P.md": "---\ntags: project\nstatus: active\n---\n# P\n",
      "Q.md": "---\ntags: project\nstatus: paused\n---\n# Q\n",
    });
    const result = await runLua(
      `query[[ from index.pages() where _.status == "active" select _.name ]]`,
      h,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((result as any).value).toEqual(["P"]);
    h.cleanup();
  });

  test("a broken query reports rather than throwing", async () => {
    const h = await host(VAULT);
    const result = await runLua(`query[[ from nothing.at.all ]]`, h);
    expect(result.ok).toBe(false);
    h.cleanup();
  });
});

describe("SLIQ where a page can use it", () => {
  test("as a ${...} expression, which is how a page embeds one", async () => {
    const h = await host(VAULT);
    const { interpolations } = await import("../../../vscode/src/preview.ts");

    // With `order by`, because a query that does not ask for an order does not get
    // one — asserting a particular sequence here would be testing an accident.
    const page =
      'Due soon:\n\n${query[[ from index.tasks() where _.deadline < "2026-09-16" ' +
      'order by _.deadline select _.name ]]}\n';
    const found = interpolations(page);
    expect(found).toHaveLength(1);

    const result = await runLua(found[0], h);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((result as any).value).toEqual(["ship it", "write the paper"]);
    h.cleanup();
  });

  test("as a returned value from a space-lua block", async () => {
    const h = await host(VAULT);
    const result = await runLua(
      `return query[[ from index.tasks() where _.deadline order by _.deadline ]]`,
      h,
      "block",
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((result as any).value).toHaveLength(3);
    h.cleanup();
  });

  test("its result renders as a table, not as escaped text", async () => {
    const h = await host(VAULT);
    const { valueToMarkdown } = await import("../../../vscode/src/preview.ts");
    const result = await runLua(
      `return query[[ from index.tasks() where _.deadline order by _.deadline limit 2 ]]`,
      h, "block",
    );
    const markdown = valueToMarkdown((result as any).value);
    expect(markdown).toContain("| name |");
    expect(markdown).toContain("ship it");
    h.cleanup();
  });
});
