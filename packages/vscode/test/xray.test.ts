import { expect, test, describe } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LifeLoop } from "../src/workspace.ts";
import { ranged, at, toYaml, card, hovers } from "../src/xray.ts";
import * as vscode from "./vscode-mock.ts";

async function workspaceWith(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-xray-"));
  for (const [path, body] of Object.entries(files)) writeFileSync(join(dir, path), body);
  (vscode.workspace as any).root = dir;
  return { lifeloop: await LifeLoop.open(dir), dir };
}

const documentOf = (text: string, uri: any) => ({
  uri,
  languageId: "markdown",
  offsetAt: (position: any) => position.offset,
  positionAt: (offset: number) => ({ offset }),
});

describe("what the lens shows", () => {
  test("only objects the index gave a range", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "P.md": '* [ ] a task [deadline: "2026-01-01"]\n\n#atag\n',
    });
    const found = ranged(lifeloop, "P");
    expect(found.length).toBeGreaterThan(0);
    // The page object has no range and is not a span you can point at.
    expect(found.some((o) => o.tag === "page")).toBe(false);
    expect(found.some((o) => o.tag === "task")).toBe(true);
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("the innermost object at a point comes first", async () => {
    const { lifeloop, dir } = await workspaceWith({ "P.md": "* [ ] ping @ada\n" });
    const objects = ranged(lifeloop, "P");
    const offset = "* [ ] ping ".length + 1;
    const here = at(objects, offset);
    expect(here.length).toBeGreaterThan(1);
    // The mention is narrower than the task that contains it.
    expect(here[0].tag).toBe("relation");
    expect(here.map((o) => o.tag)).toContain("task");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a point outside every object shows nothing", async () => {
    const { lifeloop, dir } = await workspaceWith({ "P.md": "* [ ] a task\n" });
    expect(at(ranged(lifeloop, "P"), 10_000)).toEqual([]);
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("the card", () => {
  test("attributes come out as YAML, and the range itself is not one", () => {
    const yaml = card({ ref: "P@0", tag: "task", done: false, range: [0, 5] } as any);
    expect(yaml).toContain("tag: task");
    expect(yaml).toContain("done: false");
    expect(yaml).not.toContain("range:");
  });

  test("a list is a list and a nested object is indented", () => {
    expect(toYaml(["a", "b"])).toBe("\n  - a\n  - b");
    expect(toYaml({ a: 1, b: { c: 2 } })).toBe("\n  a: 1\n  b: \n    c: 2");
    expect(toYaml([])).toBe("[]");
  });

  test("a value YAML would misread is quoted", () => {
    expect(toYaml("2026-01-01")).toBe("2026-01-01");
    expect(toYaml("yes: no")).toBe('"yes: no"');
    expect(toYaml("  padded  ")).toBe('"  padded  "');
  });

  test("a very long value is cut rather than filling the screen", () => {
    const long = toYaml("x".repeat(500));
    expect(long.length).toBeLessThan(230);
    expect(long).toContain("…");
  });
});

describe("the hover", () => {
  test("says nothing while the lens is off", async () => {
    const { lifeloop, dir } = await workspaceWith({ "P.md": "* [ ] a task\n" });
    const document = documentOf("* [ ] a task\n", lifeloop.pageUri("P"));
    expect(hovers(() => lifeloop, () => false).provideHover(
      document as any, { offset: 2 } as any, {} as any,
    )).toBeUndefined();
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("with the lens on it shows the object under the cursor", async () => {
    const { lifeloop, dir } = await workspaceWith({ "P.md": "* [ ] a task\n" });
    const document = documentOf("* [ ] a task\n", lifeloop.pageUri("P"));
    const hover = hovers(() => lifeloop, () => true).provideHover(
      document as any, { offset: 8 } as any, {} as any,
    ) as any;
    expect(hover.contents.value).toContain("**task**");
    expect(hover.contents.value).toContain("state:");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});
