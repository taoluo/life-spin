import { expect, test, describe } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { LifeLoop } from "../src/workspace.ts";
import { expand, sectionOf, transclusions, resolve } from "../src/transclusion.ts";
import * as vscode from "./vscode-mock.ts";

async function workspaceWith(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-transclude-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  (vscode.workspace as any).root = dir;
  return { lifeloop: await LifeLoop.open(dir), dir };
}

describe("what counts as a transclusion", () => {
  test("`![[...]]` is found and a plain wikilink is not", () => {
    const found = transclusions("see [[Page]] and ![[Other]] here");
    expect(found.map((f) => f.parsed.url)).toEqual(["Other"]);
  });

  test("syntax quoted in a code fence stays quoted", () => {
    // A note *about* transclusion has to be able to show the syntax.
    const found = transclusions("```\n![[Page]]\n```\n\n![[Real]]\n");
    expect(found.map((f) => f.parsed.url)).toEqual(["Real"]);
  });

  test("an alias carrying a size is read as a dimension", () => {
    const [image] = transclusions("![[art/cover.png|300]]");
    expect(image.parsed.dimension).toMatchObject({ width: 300 });
  });
});

describe("sections", () => {
  const page = [
    "# Top", "intro", "",
    "## Wanted", "body", "",
    "### Deeper", "still wanted", "",
    "## Next", "not wanted", "",
  ].join("\n");

  test("a heading's section includes its subheadings and stops at its sibling", () => {
    const section = sectionOf(page, "Wanted");
    expect(section).toContain("still wanted");
    expect(section).not.toContain("not wanted");
  });

  test("a heading that is not there is null, not the whole page", () => {
    expect(sectionOf(page, "Nowhere")).toBeNull();
  });
});

describe("expanding a page", () => {
  test("a whole page is embedded as Markdown, not as escaped text", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "Notes/Shared.md": "## Shared heading\n\n- one\n- two\n",
      "Home.md": "Before\n\n![[Shared]]\n\nAfter\n",
    });
    const out = expand(lifeloop, "Before\n\n![[Shared]]\n\nAfter\n");
    expect(out).toContain("## Shared heading");
    expect(out).toContain("- one");
    expect(out).toContain("Before");
    expect(out).toContain("After");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("frontmatter belongs to the page and is not embedded with it", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "S.md": "---\ntags: project\n---\n\nthe body\n",
      "Home.md": "![[S]]\n",
    });
    const out = expand(lifeloop, "![[S]]\n");
    expect(out).toContain("the body");
    expect(out).not.toContain("tags: project");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a header transclusion embeds only that section", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "S.md": "## A\nalpha\n\n## B\nbeta\n",
      "Home.md": "x\n",
    });
    const out = expand(lifeloop, "![[S#B]]\n");
    expect(out).toContain("beta");
    expect(out).not.toContain("alpha");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a page that embeds itself is named rather than followed", async () => {
    const { lifeloop, dir } = await workspaceWith({ "Loop.md": "top\n\n![[Loop]]\n" });
    const out = expand(lifeloop, "top\n\n![[Loop]]\n");
    // The point is that this returns at all.
    expect(out).toContain("embedded in a loop");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a missing target says so instead of vanishing", async () => {
    const { lifeloop, dir } = await workspaceWith({ "Home.md": "x\n" });
    const out = expand(lifeloop, "![[Nowhere]]\n");
    expect(out).toContain("nothing to embed");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("media keeps its dimensions and is left to the preview to fetch", async () => {
    const { lifeloop, dir } = await workspaceWith({ "Home.md": "x\n" });
    const out = expand(lifeloop, "![[art/cover.png|300x200]]\n");
    expect(out).toContain('width="300"');
    expect(out).toContain('height="200"');
    expect(out).toContain("art/cover.png");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("nesting is bounded, so a chain of embeds cannot run away", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "A.md": "a\n\n![[B]]\n",
      "B.md": "b\n\n![[A]]\n",
    });
    const out = expand(lifeloop, "![[A]]\n");
    expect(out).toContain("a");
    expect(out).toContain("b");
    expect(out).toContain("embedded in a loop");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});
