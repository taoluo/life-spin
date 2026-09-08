import { expect, test, describe } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { LifeLoop } from "../src/workspace.ts";
import { toSnippet, reprefix, slashRange, slashPages, completion, LINE_COMMANDS } from "../src/slash.ts";
import { allSlashTemplates, slashTemplates } from "@lifeloop/semantic-core";
import * as vscode from "./vscode-mock.ts";

async function workspaceWith(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-slash-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  (vscode.workspace as any).root = dir;
  return { lifeloop: await LifeLoop.open(dir), dir };
}

describe("where a slash starts a command", () => {
  test("at the start of a line and after whitespace, but not inside a path", () => {
    expect(slashRange("/tod", 4)).toMatchObject({ typed: "tod", from: 0 });
    expect(slashRange("some text /ta", 13)).toMatchObject({ typed: "ta" });
    // Otherwise every URL and fraction in a note would open a menu.
    expect(slashRange("see docs/Concepts", 17)).toBeNull();
    expect(slashRange("https://x.com/y", 15)).toBeNull();
  });
});

describe("a template body as a snippet", () => {
  test("the cursor marker becomes the snippet's stop", () => {
    expect(toSnippet("# Action items\n* [ ] |^|")).toBe("# Action items\n* [ ] $0");
  });

  test("a body containing snippet syntax is escaped rather than eaten", () => {
    // An unanswered `${...}` is a real thing to find in a template body.
    const snippet = toSnippet("total: ${x} |^|");
    expect(snippet).toContain("\\${x\\}");
    expect(snippet).toContain("$0");
  });

  test("a body with no marker is inserted whole", () => {
    expect(toSnippet("---")).toBe("---");
  });
});

describe("templates a vault defines", () => {
  test("the command is named after the last component of the page name", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "Library/Slash Template/action-items.md":
        "---\ntags: meta/template/slash\ndescription: Standard action items\n---\n# Action items\n* [ ] |^|\n",
    });
    const found = slashTemplates(lifeloop.vault, slashPages(lifeloop));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: "action-items", description: "Standard action items" });
    expect(found[0].body).toContain("* [ ] |^|");
    // Frontmatter is configuration, not content.
    expect(found[0].body).not.toContain("tags:");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a vault template replaces the built-in of the same name", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "Slash/table.md": "---\ntags: meta/template/slash\n---\nmy own table\n",
    });
    const all = allSlashTemplates(lifeloop.vault, slashPages(lifeloop));
    const tables = all.filter((t) => t.name === "table");
    expect(tables).toHaveLength(1);
    expect(tables[0].page).toBe("Slash/table");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a vault with no templates still gets the built-in set", async () => {
    const { lifeloop, dir } = await workspaceWith({ "W.md": "x\n" });
    const names = allSlashTemplates(lifeloop.vault, slashPages(lifeloop)).map((t) => t.name);
    expect(names).toContain("today");
    expect(names).toContain("query");
    expect(names).toContain("hr");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("priority orders the list", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "S/a.md": "---\ntags: meta/template/slash\npriority: 1\n---\nA\n",
      "S/z.md": "---\ntags: meta/template/slash\npriority: 9\n---\nZ\n",
    });
    expect(slashTemplates(lifeloop.vault, slashPages(lifeloop)).map((t) => t.name))
      .toEqual(["z", "a"]);
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("commands that reshape the line", () => {
  test("a plain line becomes a heading, keeping its indent", () => {
    expect(reprefix("  some text", "## ")).toBe("  ## some text");
  });

  test("an existing prefix is replaced, not stacked", () => {
    // `/h2` on a line that is already a heading should give one heading, not `## # x`.
    expect(reprefix("# already", "## ")).toBe("## already");
    expect(reprefix("* [ ] a task", "### ")).toBe("### a task");
    expect(reprefix("- a bullet", "* [ ] ")).toBe("* [ ] a bullet");
  });

  test("every line command has a prefix that reshapes rather than inserts", () => {
    for (const command of LINE_COMMANDS) {
      expect(reprefix("text", command.prefix)).toBe(`${command.prefix}text`);
    }
  });
});

describe("the completion list itself", () => {
  const documentOf = (text: string) => ({
    languageId: "markdown",
    lineAt: (line: number) => ({ text: text.split("\n")[line] }),
  });

  test("typing a slash offers templates and line commands, replacing what was typed", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "Slash/greet.md": "---\ntags: meta/template/slash\n---\nHello |^|\n",
    });
    const items = completion(() => lifeloop).provideCompletionItems(
      documentOf("/gr") as any,
      new vscode.Position(0, 3) as any,
      {} as any,
      {} as any,
    ) as any[];

    const greet = items.find((i) => i.label === "/greet");
    expect(greet).toBeDefined();
    expect(greet.insertText.value).toBe("Hello $0");
    // The typed `/gr` is inside the replaced range, so nothing is left behind.
    expect(greet.range.start.character).toBe(0);
    expect(items.some((i) => i.label === "/h2")).toBe(true);
    expect(items.find((i) => i.label === "/h2").command.command).toBe("lifeloop.reprefixLine");

    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a slash that is part of a path offers nothing", async () => {
    const { lifeloop, dir } = await workspaceWith({ "W.md": "x\n" });
    const items = completion(() => lifeloop).provideCompletionItems(
      documentOf("see docs/Con") as any,
      new vscode.Position(0, 12) as any,
      {} as any,
      {} as any,
    );
    expect(items).toBeUndefined();
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a date template arrives already substituted", async () => {
    const { lifeloop, dir } = await workspaceWith({ "W.md": "x\n" });
    const items = completion(() => lifeloop).provideCompletionItems(
      documentOf("/today") as any,
      new vscode.Position(0, 6) as any,
      {} as any,
      {} as any,
    ) as any[];
    const today = items.find((i) => i.label === "/today");
    expect(today.insertText.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});
