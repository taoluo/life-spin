import { expect, test, describe } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LifeLoop } from "../src/workspace.ts";
import { badgeOf, provider } from "../src/decoration.ts";
import { decorationOf, decorations, labelFor, visible, ordered } from "@lifeloop/semantic-core";
import { completion } from "../src/retrieval.ts";
import * as vscode from "./vscode-mock.ts";

async function workspaceWith(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-deco-"));
  for (const [path, body] of Object.entries(files)) writeFileSync(join(dir, path), body);
  (vscode.workspace as any).root = dir;
  return { lifeloop: await LifeLoop.open(dir), dir };
}

const decorated = (body: string) => `---\npageDecoration:\n${body}---\ntext\n`;

describe("reading the decoration", () => {
  test("frontmatter comes through whole", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "P.md": decorated('  prefix: "🎄 "\n  hide: true\n  tree:\n    priority: -1\n'),
    });
    const found = decorations(lifeloop.store).get("P")!;
    expect(found.prefix).toBe("🎄 ");
    expect(found.hide).toBe(true);
    expect(found.tree?.priority).toBe(-1);
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a decoration that is not an object is ignored rather than throwing", () => {
    expect(decorationOf("nonsense")).toBeUndefined();
    expect(decorationOf(["a"])).toBeUndefined();
    expect(decorationOf(undefined)).toBeUndefined();
  });
});

describe("where it applies", () => {
  test("the prefix goes in front and the name stays behind it", () => {
    expect(labelFor("Journal/Today", { prefix: "📓 " })).toBe("📓 Journal/Today");
    expect(labelFor("Plain", undefined)).toBe("Plain");
  });

  test("`hide` keeps a page out of everything, `tree.hide` only out of trees", () => {
    expect(visible({ hide: true }, "picker")).toBe(false);
    expect(visible({ tree: { hide: true } }, "picker")).toBe(true);
    expect(visible({ tree: { hide: true } }, "tree")).toBe(false);
    expect(visible(undefined, "tree")).toBe(true);
  });

  test("priority sorts against siblings only, never across folders", () => {
    const found = new Map([["Journal/Today", { tree: { priority: 10 } }]]);
    // Inside `Journal`, Today floats above Archive.
    expect(ordered(["Journal/Archive", "Journal/Today", "Alpha"], found as any))
      .toEqual(["Alpha", "Journal/Today", "Journal/Archive"]);
    // And `Alpha` keeps its place: a number on one page must not reorder a folder
    // it is not in.
  });
});

describe("the Explorer badge", () => {
  test("an emoji prefix becomes a badge; no prefix becomes nothing", () => {
    expect(badgeOf({ prefix: "🎄 " })).toBe("🎄");
    expect(badgeOf({ icon: "zap" })).toBeUndefined();
    expect(badgeOf(undefined)).toBeUndefined();
  });

  test("a long prefix is cut to what VS Code will show", () => {
    // Two characters is the host's limit; more is silently dropped, so cut here.
    expect([...badgeOf({ prefix: "ABCDEF" })!]).toHaveLength(2);
  });

  test("a decorated page gets a badge and an undecorated one does not", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "P.md": decorated('  prefix: "🎄 "\n'),
      "Q.md": "plain\n",
    });
    const decorator = provider(() => lifeloop);
    expect(decorator.provideFileDecoration(lifeloop.pageUri("P") as any, {} as any))
      .toMatchObject({ badge: "🎄" });
    expect(decorator.provideFileDecoration(lifeloop.pageUri("Q") as any, {} as any))
      .toBeUndefined();
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("completions honour it", () => {
  test("a hidden page is not offered, and a prefixed one still inserts its real name", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "Secret.md": decorated("  hide: true\n"),
      "Shown.md": decorated('  prefix: "⭐ "\n'),
    });
    const items = completion(lifeloop).provideCompletionItems(
      { lineAt: () => ({ text: "see [[" }) } as any,
      new vscode.Position(0, 6) as any, {} as any, {} as any,
    ) as any[];

    expect(items.map((i) => i.label)).toEqual(["⭐ Shown"]);
    // What is written is the page name, not the decorated label.
    expect(items[0].insertText).toBe("Shown");
    expect(items[0].filterText).toBe("Shown");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});
