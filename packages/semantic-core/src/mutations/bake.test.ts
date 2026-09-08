import { expect, test, describe } from "vitest";
import { MemoryVault } from "../vault.ts";
import {
  bakeAt, unbakeAt, updateBaked, expressionAt, sectionAt, standsAlone, expressionSpans,
} from "./bake.ts";

const answering = (markdown: string) => async () => ({ ok: true as const, markdown });
const failing = (error: string) => async () => ({ ok: false as const, error });

describe("finding what to bake", () => {
  test("an expression is located by cursor offset", () => {
    const text = "a\n${query[[from t = tags.task]]}\nb\n";
    const span = expressionAt(text, text.indexOf("query"));
    expect(span?.expression).toBe("query[[from t = tags.task]]");
  });

  test("an expression on its own line stands alone; one mid-sentence does not", () => {
    const alone = "before\n\n${x}\n\nafter";
    const inline = "the answer is ${x} today";
    expect(standsAlone(alone, expressionSpans(alone)[0])).toBe(true);
    expect(standsAlone(inline, expressionSpans(inline)[0])).toBe(false);
  });
});

describe("baking", () => {
  test("the expression and its output end up side by side", async () => {
    const vault = new MemoryVault(new Map([["P.md", "# Title\n\n${query[[x]]}\n\ntail\n"]]));
    const result = await bakeAt(vault, "P", 12, answering("| n |\n| - |\n| 1 |"));
    expect(result.ok).toBe(true);

    const text = vault.read("P.md");
    expect(text).toContain("<!--#lua query[[x]] -->");
    expect(text).toContain("| n |");
    expect(text).toContain("<!--/lua-->");
    // Everything around it survives untouched.
    expect(text).toContain("# Title");
    expect(text).toContain("tail");
  });

  test("an expression that fails writes nothing at all", async () => {
    const before = "${query[[boom]]}\n";
    const vault = new MemoryVault(new Map([["P.md", before]]));
    const result = await bakeAt(vault, "P", 2, failing("no such tag"));
    expect(result.ok).toBe(false);
    // A page with a working directive is strictly better than one with an error in it.
    expect(vault.read("P.md")).toBe(before);
  });

  test("an inline expression is refused rather than mangled", async () => {
    const vault = new MemoryVault(new Map([["P.md", "today is ${date} ok\n"]]));
    const result = await bakeAt(vault, "P", 12, answering("2026-09-08"));
    expect(result.ok).toBe(false);
    expect(vault.read("P.md")).toContain("today is ${date} ok");
  });

  test("a body containing the closing marker cannot break the section", async () => {
    const vault = new MemoryVault(new Map([["P.md", "${x}\n"]]));
    await bakeAt(vault, "P", 1, answering("text <!--/lua--> more"));
    const text = vault.read("P.md");
    // Exactly one real closing marker, so the next update still finds the end.
    expect(text.split("<!--/lua-->").length - 1).toBe(1);
  });
});

describe("updating", () => {
  const baked = (body: string) => `<!--#lua query[[x]] -->\n${body}\n<!--/lua-->\n`;

  test("a section is rewritten with the latest output", async () => {
    const vault = new MemoryVault(new Map([["P.md", `head\n\n${baked("old")}\ntail\n`]]));
    const result = await updateBaked(vault, "P", answering("new"));
    expect(result).toMatchObject({ ok: true, value: { updated: 1 } });
    const text = vault.read("P.md");
    expect(text).toContain("new");
    expect(text).not.toContain("old");
    expect(text).toContain("head");
  });

  test("one broken section keeps its body and does not cost the others theirs", async () => {
    const text = [
      `<!--#lua good -->\nA\n<!--/lua-->`,
      `<!--#lua bad -->\nB\n<!--/lua-->`,
    ].join("\n\n") + "\n";
    const vault = new MemoryVault(new Map([["P.md", text]]));

    const result = await updateBaked(vault, "P", async (expression) =>
      expression === "bad"
        ? { ok: false, error: "broke" }
        : { ok: true, markdown: "A refreshed" },
    );
    expect(result.ok).toBe(true);
    expect((result as any).value.failed).toMatchObject([{ expression: "bad" }]);

    const after = vault.read("P.md");
    expect(after).toContain("A refreshed");
    expect(after).toContain("\nB\n");
  });

  test("output that has not changed writes nothing", async () => {
    const before = baked("same");
    const vault = new MemoryVault(new Map([["P.md", before]]));
    const result = await updateBaked(vault, "P", answering("same"));
    expect(result).toMatchObject({ ok: true, changed: [], value: { updated: 0 } });
    expect(vault.read("P.md")).toBe(before);
  });

  test("an unclosed opening marker is left alone rather than swallowing the page", async () => {
    const before = "<!--#lua x -->\nbody with no close\n\nrest of page\n";
    const vault = new MemoryVault(new Map([["P.md", before]]));
    const result = await updateBaked(vault, "P", answering("new"));
    expect(result.ok).toBe(false);
    expect(vault.read("P.md")).toBe(before);
  });
});

describe("unbaking", () => {
  test("a section becomes the expression it came from", async () => {
    const vault = new MemoryVault(new Map([
      ["P.md", "head\n\n<!--#lua query[[x]] -->\n| n |\n<!--/lua-->\n\ntail\n"],
    ]));
    const at = vault.read("P.md").indexOf("| n |");
    const result = await unbakeAt(vault, "P", at);
    expect(result.ok).toBe(true);

    const text = vault.read("P.md");
    expect(text).toContain("${query[[x]]}");
    expect(text).not.toContain("<!--#lua");
    expect(text).not.toContain("| n |");
  });

  test("baking and unbaking returns the page to what it was", async () => {
    const before = "head\n\n${query[[x]]}\n\ntail\n";
    const vault = new MemoryVault(new Map([["P.md", before]]));
    await bakeAt(vault, "P", before.indexOf("query"), answering("| n |\n| - |"));
    const at = vault.read("P.md").indexOf("| n |");
    await unbakeAt(vault, "P", at);
    expect(vault.read("P.md")).toBe(before);
  });

  test("the cursor outside a section is a refusal, not a guess", async () => {
    const vault = new MemoryVault(new Map([["P.md", "plain page\n"]]));
    const result = await unbakeAt(vault, "P", 3);
    expect(result.ok).toBe(false);
    expect(sectionAt("plain page\n", 3)).toBeNull();
  });
});
