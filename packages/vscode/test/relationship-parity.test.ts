import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  bakeAt, findBakedSections, runLua, runProjection,
} from "@lifeloop/semantic-core";
import { evaluateToMarkdown } from "../src/lua.ts";
import { codeLenses, hovers } from "../src/query-lens.ts";
import { parseQueryBlock, renderQuery, runQueryBlock, toMarkdown } from "../src/preview.ts";
import { LifeLoop } from "../src/workspace.ts";
import * as vscode from "./vscode-mock.ts";

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

const interaction = (index: number, offset: number) => ({
  ref: `Journal/2026-08-01@${offset}`,
  page: "Journal/2026-08-01",
  date: "2026-08-01",
  kind: "coffee",
  text: `Coffee ${index} [[People/Alice]]`,
  people: ["People/Alice"],
});

const coffee = [
  [11, 551], [10, 500], [1, 50], [9, 450], [8, 400], [7, 350],
  [6, 300], [5, 250], [4, 200], [3, 150], [2, 100], [0, 0],
].map(([index, offset]) => interaction(index, offset));

const carol = {
  ref: "Journal/2026-08-01@602", page: "Journal/2026-08-01", date: "2026-08-01",
  kind: "call", text: "Call [[People/Carol]]", people: ["People/Carol"],
};

const eve = {
  ref: "Journal/2026-09-01@0", page: "Journal/2026-09-01", date: "2026-09-01",
  kind: "meeting", text: "Meet [[People/Eve]]", people: ["People/Eve"],
};

const expected = {
  people: [
    { person: "People/Alice", groups: ["friend"], birthday: "02-29", contactEveryDays: 30,
      lastInteractionDate: "2026-08-01", reconnectOn: "2026-08-31", openFollowups: 1 },
    { person: "People/Bob", groups: [], contactEveryDays: 30, openFollowups: 0 },
    { person: "People/Carol", groups: [], contactEveryDays: 30,
      lastInteractionDate: "2026-08-01", reconnectOn: "2026-08-31", openFollowups: 0 },
    { person: "People/Dave", groups: [], openFollowups: 0 },
    { person: "People/Eve", groups: [], lastInteractionDate: "2026-09-01", openFollowups: 0 },
  ],
  interactions: coffee,
  reconnect: [
    { person: "People/Bob", kind: "never-contacted", due: null },
    { person: "People/Alice", kind: "reconnect", due: "2026-08-31", lastInteractionDate: "2026-08-01" },
    { person: "People/Carol", kind: "reconnect", due: "2026-08-31", lastInteractionDate: "2026-08-01" },
  ],
  "person-context": [{
    person: "People/Alice", groups: ["friend"], birthday: "02-29", contactEveryDays: 30,
    lastInteractionDate: "2026-08-01", reconnectOn: "2026-08-31", openFollowups: 1,
    openFollowupRefs: ["Work@0"], recentInteractions: coffee.slice(0, 10),
  }],
};

const cases = [
  { name: "people", args: {}, options: [], luaArgs: "", cliArgs: [],
    fields: Object.keys(expected.people[0]), renderIdentity: "person", rows: expected.people,
    renderedCells: ["friend", "02-29", "30", "1"], bakedCells: ["02-29", "2026-08-31", "1"],
    excludedCells: [] },
  { name: "interactions", args: { person: "People/Alice", kind: "coffee" },
    options: ["person: People/Alice", "kind: coffee"],
    luaArgs: 'person = "People/Alice", kind = "coffee"',
    cliArgs: ["--person", "People/Alice", "--kind", "coffee"],
    fields: Object.keys(coffee[0]), renderIdentity: "text", rows: coffee,
    renderedCells: ["2026-08-01", "coffee", "People/Alice"],
    bakedCells: ["2026-08-01", "coffee"],
    excludedCells: ["People/Carol", "People/Eve"] },
  { name: "reconnect", args: { date: "2026-09-09" }, options: ["date: 2026-09-09"],
    luaArgs: 'date = "2026-09-09"', cliArgs: ["--date", "2026-09-09"],
    fields: ["person", "kind", "due", "lastInteractionDate"], renderIdentity: "person",
    rows: expected.reconnect, renderedCells: ["never-contacted", "2026-08-31"],
    bakedCells: ["never-contacted", "2026-08-01"],
    excludedCells: ["People/Dave", "People/Eve"] },
  { name: "person-context", args: { person: "People/Alice" }, options: ["person: People/Alice"],
    luaArgs: 'person = "People/Alice"', cliArgs: ["--person", "People/Alice"],
    fields: Object.keys(expected["person-context"][0]), renderIdentity: "person",
    rows: expected["person-context"], renderedCells: ["friend", "02-29", "30", "1", "Work@0"],
    bakedCells: ["02-29", "2026-08-31", "1"],
    excludedCells: ["People/Bob", "People/Carol", "People/Dave", "People/Eve"] },
] as const;

const assertRows = (actual: unknown, wanted: readonly unknown[]) => {
  expect(actual).toStrictEqual(wanted);
  const rows = actual as Record<string, unknown>[];
  expect(rows.map(Object.keys)).toEqual(wanted.map((row) => Object.keys(row as object)));
  for (let index = 0; index < rows.length; index++) {
    if (Array.isArray(rows[index].recentInteractions)) {
      expect((rows[index].recentInteractions as object[]).map(Object.keys))
        .toEqual(((wanted[index] as any).recentInteractions as object[]).map(Object.keys));
    }
  }
};

const renderedCell = (value: string, html: boolean) => html ? `<td>${value}</td>` : `| ${value} |`;

const assertRendered = (
  rendered: string,
  html: boolean,
  entry: typeof cases[number],
  wanted: readonly Record<string, unknown>[],
  cells: readonly string[] = entry.renderedCells,
) => {
  const rows = html
    ? (/<tbody>([\s\S]*?)<\/tbody>/.exec(rendered)?.[1].match(/<tr(?:\s|>)/g) ?? []).length
    : Math.max(0, rendered.split("\n").filter((line) => line.startsWith("| ")).length - 2);
  expect(rows).toBe(wanted.length);
  for (const value of cells) {
    if (wanted.some((row) => Object.values(row).some((cell) => String(cell) === value))) {
      expect(rendered).toContain(renderedCell(value, html));
    }
  }
  const dropped = entry.rows.slice(wanted.length)
    .map((row) => String((row as any)[entry.renderIdentity]));
  for (const value of [...entry.excludedCells, ...dropped]) {
    expect(rendered).not.toContain(renderedCell(value, html));
  }
};

const luaCall = (entry: typeof cases[number], limit?: number) => {
  const fn = entry.name === "person-context" ? 'lifeloop["person-context"]' : `lifeloop.${entry.name}`;
  const args = [entry.luaArgs, limit === undefined ? "" : `limit = ${limit}`].filter(Boolean).join(", ");
  return `${fn}({${args}})`;
};

afterEach(() => {
  delete vscode.workspace.settings["lifeloop.executeSpaceLua"];
  vscode.workspace.textDocuments = [];
});

describe("relationship projection parity", () => {
  test("all four projections agree through every adapter", async () => {
    const { dir, lifeloop } = await fixture();
    try {
      vscode.workspace.settings["lifeloop.executeSpaceLua"] = true;
      const cli = join(import.meta.dirname, "../../cli/src/main.ts");
      const db = join(dir, ".cli.sqlite");
      const runCli = (...args: string[]) => spawnSync(
        process.execPath, ["--import", "tsx", cli, ...args], { encoding: "utf8" },
      );
      expect(runCli("index", dir, "--db", db).status).toBe(0);

      for (const entry of cases) {
        assertRows(runProjection(lifeloop.store, entry.name, entry.args), entry.rows);
        for (const limit of [undefined, 0, 1] as const) {
          const wanted = limit === undefined ? entry.rows : entry.rows.slice(0, limit);
          const source = [entry.name, ...entry.options, `fields: ${entry.fields.join(", ")}`,
            limit === undefined ? "" : `limit: ${limit}`].filter(Boolean).join("\n");
          const outcome = runQueryBlock(lifeloop, source);
          expect(outcome.ok).toBe(true);
          assertRows(outcome.ok ? outcome.rows : [], wanted);

          const markdown = toMarkdown(outcome);
          const hover = (hovers(() => lifeloop) as any)
            .provideHover(queryDocument(source), { line: 2, character: 0 }).contents.value;
          expect(hover).toBe(markdown);
          assertRendered(hover, false, entry, wanted);
          expect((codeLenses(() => lifeloop) as any).provideCodeLenses(queryDocument(source))[0].command.title)
            .toBe(`$(list-flat) ${entry.name}: ${wanted.length} ${wanted.length === 1 ? "result" : "results"}`);
          const preview = renderQuery(lifeloop, source);
          assertRendered(preview, true, entry, wanted);
          if (limit === 0) {
            expect(markdown).toBe("_Nothing to show._");
            expect(preview).toContain("Nothing to show.");
          }

          const expression = luaCall(entry, limit);
          await lifeloop.vault.write("Recipe.md", "${" + expression + "}\n");
          expect((await bakeAt(
            lifeloop.vault, "Recipe", 3, (value) => evaluateToMarkdown(lifeloop, value),
          )).ok).toBe(true);
          const baked = lifeloop.vault.read("Recipe.md");
          const section = findBakedSections(baked)[0];
          assertRendered(
            baked.slice(section.bodyFrom, section.bodyTo).trim(), false, entry, wanted, entry.bakedCells,
          );
          if (limit === 0) expect(baked).toContain("_nothing_");

          const lua = await runLua(expression, { store: lifeloop.store, vault: lifeloop.vault });
          expect(lua.ok).toBe(true);
          assertRows(lua.ok ? lua.value : [], wanted);
          const sliq = await runLua(
            `query[[ from row = ${luaCall(entry)}${limit === undefined ? "" : ` limit ${limit}`} ]]`,
            { store: lifeloop.store, vault: lifeloop.vault },
          );
          expect(sliq.ok).toBe(true);
          assertRows(sliq.ok ? sliq.value : [], wanted);

          const result = runCli("query", dir, entry.name, ...entry.cliArgs,
            ...(limit === undefined ? [] : ["--limit", String(limit)]), "--json", "--db", db);
          expect(result.stderr).toBe("");
          assertRows(JSON.parse(result.stdout), wanted);
        }
      }
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test("Interaction filters are independently discriminating", async () => {
    const { dir, lifeloop } = await fixture();
    try {
      assertRows(runProjection(lifeloop.store, "interactions", { person: "People/Alice" }), coffee);
      assertRows(runProjection(lifeloop.store, "interactions", { kind: "call" }), [carol]);
      assertRows(runProjection(lifeloop.store, "interactions", { from: "2026-08-02" }), [eve]);
      assertRows(runProjection(lifeloop.store, "interactions", { to: "2026-08-01" }), [carol, ...coffee]);
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
