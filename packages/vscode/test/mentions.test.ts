import { expect, test, describe, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LifeLoop } from "../src/workspace.ts";
import { mentionSpans, mentionAt, typing, completion, documentLinks, references } from "../src/mentions.ts";
import { MentionsView } from "../src/views.ts";
import * as vscode from "./vscode-mock.ts";

async function workspaceWith(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-mentions-"));
  for (const [path, body] of Object.entries(files)) writeFileSync(join(dir, path), body);
  (vscode.workspace as any).root = dir;
  return { lifeloop: await LifeLoop.open(dir), dir };
}

afterEach(() => { (vscode.workspace as any).settings = {}; });

const documentOf = (text: string) => ({
  languageId: "markdown",
  lineCount: text.split("\n").length,
  lineAt: (line: number) => ({ text: text.split("\n")[line] }),
});

describe("finding a mention in a line", () => {
  test("a dotted name carries whole", () => {
    expect(mentionSpans("ping @pete.smith today").map((s) => s.name)).toEqual(["pete.smith"]);
  });

  test("an email address is not two mentions", () => {
    expect(mentionSpans("write to ada@example.com")).toEqual([]);
  });

  test("the cursor anywhere on the name finds it", () => {
    expect(mentionAt("hi @ada there", 5)?.name).toBe("ada");
    expect(mentionAt("hi @ada there", 11)).toBeNull();
  });

  test("an `@` only starts a mention after whitespace", () => {
    expect(typing("@ad", 3)).toMatchObject({ from: 0 });
    expect(typing("hi @ad", 6)).toMatchObject({ from: 3 });
    expect(typing("ada@ex", 6)).toBeNull();
  });
});

describe("completing a name", () => {
  test("names that were written down are offered, most-mentioned first", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "P.md": "@ada and @ada again, plus @zef\n",
    });
    const items = completion(() => lifeloop).provideCompletionItems(
      documentOf("hi @a") as any,
      new vscode.Position(0, 5) as any,
      {} as any, {} as any,
    ) as any[];

    expect(items.map((i) => i.label)).toEqual(["@ada", "@zef"]);
    // The typed `@a` is replaced, so accepting does not leave `@a@ada`.
    expect(items[0].range.start.character).toBe(3);
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("nothing is offered where an `@` is not starting a mention", async () => {
    const { lifeloop, dir } = await workspaceWith({ "P.md": "@ada\n" });
    expect(completion(() => lifeloop).provideCompletionItems(
      documentOf("mail ada@ex") as any,
      new vscode.Position(0, 11) as any, {} as any, {} as any,
    )).toBeUndefined();
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("clicking and finding", () => {
  test("every mention is a link to what is addressed to that name", async () => {
    const { lifeloop, dir } = await workspaceWith({ "P.md": "hi @ada\n" });
    const links = documentLinks(() => lifeloop).provideDocumentLinks(
      documentOf("hi @ada\n") as any, {} as any,
    ) as any[];
    expect(links).toHaveLength(1);
    expect(String(links[0].target)).toContain("lifeloop.showMentions");
    expect(String(links[0].target)).toContain("ada");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("references finds the same name on other pages", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "P.md": "hi @ada\n",
      "Q.md": "line one\nand @ada again\n",
    });
    const found = references(() => lifeloop).provideReferences(
      documentOf("hi @ada") as any,
      new vscode.Position(0, 4) as any, {} as any, {} as any,
    ) as any[];
    expect(found).toHaveLength(2);
    // The offset the index gave is turned into the line it is actually on.
    expect(found.map((f) => f.range.line).sort()).toEqual([0, 1]);
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("the Mention Inbox", () => {
  test("with no identity set it asks for one rather than guessing", async () => {
    const { lifeloop, dir } = await workspaceWith({ "P.md": "hi @ada\n" });
    const roots = new MentionsView(lifeloop).getChildren();
    expect(roots[0].label).toContain("lifeloop.identity");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("mentions are grouped by the page they were written on", async () => {
    (vscode.workspace as any).settings = { "lifeloop.identity": "@ada" };
    const { lifeloop, dir } = await workspaceWith({
      "P.md": "hi @ada\n\nand again @ada\n",
      "Q.md": "over here @ada\n",
      "R.md": "not for you @zef\n",
    });
    const view = new MentionsView(lifeloop);
    const roots = view.getChildren();
    expect(roots.map((r) => r.label)).toEqual(["P", "Q"]);
    expect(view.getChildren(roots[0])).toHaveLength(2);
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a mention on a finished task stops asking, and a signature never asked", async () => {
    (vscode.workspace as any).settings = { "lifeloop.identity": "@ada" };
    const { lifeloop, dir } = await workspaceWith({
      "P.md": "* [x] done thing for @ada\n\nwritten by someone. -- @ada\n",
    });
    const roots = new MentionsView(lifeloop).getChildren();
    expect(roots).toHaveLength(1);
    expect(roots[0].label).toContain("Nothing open");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});
