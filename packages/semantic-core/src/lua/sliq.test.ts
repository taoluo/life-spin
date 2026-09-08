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

describe("the query forms SilverBullet's own front page uses", () => {
  /**
   * Every query on silverbullet.md reads `from x = tags.something`, not
   * `index.tasks()`. Ours worked and theirs did not, which is the difference
   * between "SLIQ runs" and "a SilverBullet vault's queries run".
   */
  const VAULT_WITH_TAGS = {
    "Feature.md": "---\ntags: feature\nawesomeness: 9\n---\n# Big feature\n\n* [ ] build it\n",
    "Lesser.md": "---\ntags: feature\nawesomeness: 2\n---\n# Small feature\n",
    "Notes.md": "* [x] finished\n* [ ] outstanding\n",
  };

  test("tags.task, the way their to-do example is written", async () => {
    const h = await host(VAULT_WITH_TAGS);
    const result = await runLua(`query[[ from t = tags.task where not t.done ]]`, h);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const names = ((result as any).value as any[]).map((t) => t.name).sort();
    expect(names).toEqual(["build it", "outstanding"]);
    h.cleanup();
  });

  test("tags.page ordered by lastModified, the way their active-pages example is", async () => {
    const h = await host(VAULT_WITH_TAGS);
    const result = await runLua(
      `query[[ from p = tags.page order by p.lastModified desc limit 5 select p.name ]]`,
      h,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((result as any).value).toHaveLength(3);
    h.cleanup();
  });

  test("a frontmatter tag becomes a queryable collection", async () => {
    // `tags: feature` indexes the page as a `page` whose itags include `feature`,
    // so `tags.feature` has to match on itags rather than on tag — which is
    // exactly what their example relies on when it then narrows to `tag == "page"`.
    const h = await host(VAULT_WITH_TAGS);
    const result = await runLua(
      `query[[ from f = tags.feature where f.tag == "page" order by f.awesomeness desc select f.name ]]`,
      h,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((result as any).value).toEqual(["Feature", "Lesser"]);
    h.cleanup();
  });

  test("an unknown tag is an empty collection, not an error", async () => {
    const h = await host(VAULT_WITH_TAGS);
    const result = await runLua(`query[[ from x = tags.nothingLikeThis ]]`, h);
    // An empty Lua table converts to `{}` rather than `[]` — nothing distinguishes
    // an empty list from an empty map on the way back. What matters is that an
    // unrecognised tag answers with emptiness instead of failing the page.
    expect(result.ok).toBe(true);
    expect(Object.keys((result as any).value ?? {})).toHaveLength(0);
    h.cleanup();
  });
});

describe("definitions reach across blocks", () => {
  test("a template defined in one block is callable from a query in another", async () => {
    // This is `select templates.featureItem(f)` on SilverBullet's front page: the
    // template lives in a library page and the query lives somewhere else. In a
    // fresh environment per snippet it could never have resolved.
    const h = await host({
      "Feature.md": "---\ntags: feature\nawesomeness: 9\n---\n# Big\n",
    });

    const { collectDeclarations } = await import("./host.ts");
    const { space } = await collectDeclarations(
      [`templates = {}
        templates.featureItem = function(f) return "* " .. f.name end`],
      h,
    );

    const result = await runLua(
      `query[[ from f = tags.feature where f.tag == "page" select templates.featureItem(f) ]]`,
      h,
      "expression",
      space,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    // `name` on a page object is the page's name, which is its path without the
    // extension — not the first heading inside it.
    expect((result as any).value).toEqual(["* Feature"]);
    h.cleanup();
  });

  test("without the shared space, the same query cannot see the template", async () => {
    const h = await host({ "Feature.md": "---\ntags: feature\n---\n# Big\n" });
    const result = await runLua(
      `query[[ from f = tags.feature select templates.featureItem(f) ]]`,
      h,
    );
    // Reported, not silently empty — a query that quietly returns nothing looks
    // exactly like a vault with nothing in it.
    expect(result.ok).toBe(false);
    h.cleanup();
  });
});
