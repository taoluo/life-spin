import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  bakeAt, runLua, runProjection,
} from "@lifeloop/semantic-core";
import { evaluateToMarkdown } from "../src/lua.ts";
import { codeLenses, hovers } from "../src/query-lens.ts";
import { parseQueryBlock, renderQuery, runQueryBlock, toMarkdown } from "../src/preview.ts";
import { LifeLoop } from "../src/workspace.ts";
import * as vscode from "./vscode-mock.ts";

const query = [
  "interactions",
  "person: People/Alice",
  "kind: coffee",
  "fields: ref, date, kind, text, people",
  "limit: 1",
].join("\n");

const queryDocument = (source: string) => {
  const text = `\`\`\`lifeloop\n${source}\n\`\`\`\n`;
  const lines = text.split("\n");
  return {
    uri: vscode.Uri.file("/vault/Query.md"), languageId: "markdown", version: 1,
    getText: () => text,
    lineAt: (line: number) => ({ text: lines[line], length: lines[line].length }),
    offsetAt: (position: { line: number; character: number }) =>
      lines.slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) + position.character,
  } as any;
};

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-parity-"));
  const coffee = Array.from({ length: 12 }, (_, index) =>
    `* Coffee ${index} [[People/Alice]] [interaction: coffee]`).join("\r\n");
  const files: Record<string, string> = {
    "People/Alice.md": "---\ntags: person\ngroups: friend\nbirthday: 02-29\ncontact-every: 30d\n---\n",
    "People/Bob.md": "---\ntags: person\ncontact-every: 30d\n---\n",
    "People/Carol.md": "---\ntags: person\ncontact-every: 30d\n---\n",
    "People/Dave.md": "---\ntags: person\n---\n",
    "People/Eve.md": "---\ntags: person\n---\n",
    "Journal/2026-08-01.md": `${coffee}\r\n* Call [[People/Carol]] [interaction: call]\r\n`,
    "Journal/2026-09-01.md": "* Meet [[People/Eve]] [interaction: meeting]\n",
    "Work.md": "* [ ] Follow up [[People/Alice]]\n",
    "Recipe.md": '${lifeloop.interactions({person = "People/Alice", kind = "coffee", limit = 1})}\n',
  };
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  (vscode.workspace as any).root = dir;
  return { dir, lifeloop: await LifeLoop.open(dir) };
}

afterEach(() => {
  delete vscode.workspace.settings["lifeloop.executeSpaceLua"];
  vscode.workspace.textDocuments = [];
});

describe("relationship projection parity", () => {
  test("one discriminating snapshot agrees through every adapter", async () => {
    const { dir, lifeloop } = await fixture();
    try {
      const people = runProjection(lifeloop.store, "people") as any[];
      expect(Object.keys(people.find((row) => row.person === "People/Dave"))).toEqual([
        "person", "groups", "openFollowups",
      ]);
      const reconnect = runProjection(lifeloop.store, "reconnect", { date: "2026-09-09" }) as any[];
      expect(reconnect.map((row) => [row.person, row.due])).toEqual([
        ["People/Bob", null],
        ["People/Alice", "2026-08-31"],
        ["People/Carol", "2026-08-31"],
      ]);
      expect(reconnect.map(Object.keys)).toEqual([
        ["person", "kind", "due"],
        ["person", "kind", "due", "lastInteractionDate"],
        ["person", "kind", "due", "lastInteractionDate"],
      ]);
      expect(reconnect).toMatchObject([
        { person: "People/Bob", due: null },
        { person: "People/Alice", due: "2026-08-31" },
        { person: "People/Carol", due: "2026-08-31" },
      ]);
      const context = (runProjection(lifeloop.store, "person-context", {
        person: "People/Alice",
      }) as any[])[0];
      expect(Object.keys(context)).toEqual([
        "person", "groups", "birthday", "contactEveryDays", "lastInteractionDate", "reconnectOn",
        "openFollowups", "openFollowupRefs", "recentInteractions",
      ]);
      expect(context.recentInteractions).toHaveLength(10);
      expect(context.recentInteractions.every((row: any) =>
        Object.keys(row).join(",") === "ref,page,date,kind,text,people")).toBe(true);

      const direct = runProjection(lifeloop.store, "interactions", {
        person: "People/Alice", kind: "coffee",
      }) as Record<string, unknown>[];
      expect(direct).toHaveLength(12);
      expect(Object.keys(direct[0])).toEqual(["ref", "page", "date", "kind", "text", "people"]);
      const expected = direct.slice(0, 1);

      const outcome = runQueryBlock(lifeloop, query);
      expect(outcome.ok && outcome.rows).toEqual(expected);
      expect(outcome.ok && outcome.columns).toEqual(["ref", "date", "kind", "text", "people"]);
      expect(renderQuery(lifeloop, query)).toContain(String(expected[0].text));
      expect(runQueryBlock(lifeloop, query.replace("limit: 1", "limit: 0")))
        .toMatchObject({ ok: true, rows: [] });
      const document = queryDocument(query);
      const hover = (hovers(() => lifeloop) as any).provideHover(document, { line: 2 });
      expect(hover.contents.value).toBe(toMarkdown(outcome));
      const lenses = (codeLenses(() => lifeloop) as any).provideCodeLenses(document);
      expect(lenses[0].command.title).toContain("1 result");

      vscode.workspace.settings["lifeloop.executeSpaceLua"] = true;
      const baked = await bakeAt(
        lifeloop.vault, "Recipe", 3, (expression) => evaluateToMarkdown(lifeloop, expression),
      );
      expect(baked.ok).toBe(true);
      expect(lifeloop.vault.read("Recipe.md")).toContain(String(expected[0].text));

      const lua = await runLua(
        'lifeloop.interactions({person = "People/Alice", kind = "coffee", limit = 1})',
        { store: lifeloop.store, vault: lifeloop.vault },
      );
      expect(lua).toMatchObject({ ok: true, value: expected });
      const sliq = await runLua(
        'query[[ from i = lifeloop.interactions({person = "People/Alice", kind = "coffee"}) limit 1 ]]',
        { store: lifeloop.store, vault: lifeloop.vault },
      );
      expect(sliq).toMatchObject({ ok: true, value: expected });

      const cli = join(import.meta.dirname, "../../cli/src/main.ts");
      const db = join(dir, ".cli.sqlite");
      const runCli = (...args: string[]) => spawnSync(
        process.execPath, ["--import", "tsx", cli, ...args], { encoding: "utf8" },
      );
      expect(runCli("index", dir, "--db", db).status).toBe(0);
      const result = runCli(
        "query", dir, "interactions", "--person", "People/Alice", "--kind", "coffee",
        "--limit", "1", "--json", "--db", db,
      );
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual(expected);
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("all four documented recipes parse and execute", async () => {
    const { dir, lifeloop } = await fixture();
    try {
      const readme = readFileSync(join(import.meta.dirname, "../../../README.md"), "utf8");
      const section = /<!-- relationship-recipes:start -->([\s\S]*?)<!-- relationship-recipes:end -->/.exec(readme)?.[1] ?? "";
      const recipes = [...section.matchAll(/```(?:lifeloop|query)\n([\s\S]*?)\n```/g)].map((match) => match[1]);
      expect(recipes).toHaveLength(4);
      for (const recipe of recipes) {
        expect(parseQueryBlock(recipe)).not.toHaveProperty("error");
        expect(runQueryBlock(lifeloop, recipe).ok).toBe(true);
      }
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });
});
