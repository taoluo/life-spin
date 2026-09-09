import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { definitions, relationshipDiagnostics } from "../src/retrieval.ts";
import { LifeLoop } from "../src/workspace.ts";
import * as vscode from "./vscode-mock.ts";

function documentOf(text: string, path = "/vault/Query.md") {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  const positionAt = (offset: number) => {
    let line = starts.length - 1;
    while (line > 0 && starts[line] > offset) line--;
    return new vscode.Position(line, offset - starts[line]);
  };
  return {
    uri: vscode.Uri.file(path), languageId: "markdown", version: 1,
    getText: () => text,
    positionAt,
    offsetAt: (position: { line: number; character: number }) => starts[position.line] + position.character,
    lineAt: (line: number) => {
      const from = starts[line];
      const newline = text.indexOf("\n", from);
      const raw = text.slice(from, newline < 0 ? text.length : newline).replace(/\r$/, "");
      return { text: raw, length: raw.length, range: new vscode.Range(positionAt(from), positionAt(from + raw.length)) };
    },
    lineCount: starts.length,
  } as any;
}

async function workspaceWith(files: Record<string, string>): Promise<{ lifeloop: LifeLoop; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-language-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  (vscode.workspace as any).root = dir;
  return { lifeloop: await LifeLoop.open(dir), dir };
}

afterEach(() => { vscode.workspace.textDocuments = []; });

describe("relationship diagnostics", () => {
  test("uses the smallest live query tokens and postpones stale identity checks", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "People/Alice.md": "---\ntags: person\n---\n",
      "Query.md": "",
    });
    const text = [
      "😀",
      "```query",
      "interactions",
      "colour: red",
      "fields: date, bogus",
      "from: bad",
      "to: 2026-01-01",
      "person: People/Missing",
      "limit: -1",
      "```",
    ].join("\r\n");
    const document = documentOf(text, join(dir, "Query.md"));
    const selected = (diagnostic: any) => text.slice(
      document.offsetAt(diagnostic.range.start), document.offsetAt(diagnostic.range.end),
    );
    try {
      const diagnostics = relationshipDiagnostics(lifeloop, text, "Query", true);
      expect(diagnostics.map(selected)).toEqual(expect.arrayContaining([
        "colour", "bogus", "bad", "People/Missing", "-1",
      ]));
      expect(diagnostics.every((diagnostic: any) => diagnostic.severity === vscode.DiagnosticSeverity.Error)).toBe(true);

      lifeloop.noteSourceChange();
      const stale = relationshipDiagnostics(lifeloop, text, "Query", lifeloop.indexIsSettled());
      expect(stale.some((diagnostic: any) => diagnostic.message.includes("People/Missing"))).toBe(false);
      expect(stale.some((diagnostic: any) => diagnostic.message.includes("non-negative integer"))).toBe(true);
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("reports live Person and excluded Interaction reasons without rejecting custom kinds", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "People/Alice.md": "---\ntags: person\n---\n",
      "Journal/2026-09-09.md": "",
    });
    try {
      const person = "---\ntags: person\nbirthday: never\ncontact-every: forever\n---\n";
      const personMessages = relationshipDiagnostics(lifeloop, person, "People/Alice", true)
        .map((diagnostic: any) => diagnostic.message);
      expect(personMessages).toEqual(expect.arrayContaining([
        expect.stringContaining("birthday"), expect.stringContaining("contact-every"),
      ]));

      const valid = "* Coffee [[People/Alice]] [interaction: coffee]\n";
      expect(relationshipDiagnostics(lifeloop, valid, "Journal/2026-09-09", true)
        .some((diagnostic: any) => diagnostic.message.includes("unsupported"))).toBe(false);
      expect(relationshipDiagnostics(lifeloop, valid, "Notes", true)
        .some((diagnostic: any) => diagnostic.message.includes("Journal date"))).toBe(true);
      expect(relationshipDiagnostics(lifeloop, '* Empty [interaction: ""]\n', "Journal/2026-09-09", true)
        .some((diagnostic: any) => diagnostic.message.includes("empty"))).toBe(true);
      expect(relationshipDiagnostics(lifeloop, "* Call [interaction: call]\n", "Journal/2026-09-09", true)
        .some((diagnostic: any) => diagnostic.message.includes("direct Person"))).toBe(true);
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("narrow definitions", () => {
  test("leaves literal @ filenames to Foam and resolves only SB refs otherwise", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "Ordinary@anchor.md": "literal\n",
      "Ordinary.md": "* [ ] anchor $anchor\n",
      "Target.md": "intro\r\n* [ ] anchored $task\r\n",
      "Source.md": "[[Ordinary@anchor]]\n[[Target@task]]\n",
    });
    const text = "[[Ordinary@anchor]]\n[[Target@task]]\n";
    const document = documentOf(text, join(dir, "Source.md"));
    const provider = definitions(lifeloop) as any;
    try {
      expect(await provider.provideDefinition(document, { line: 0, character: 5 })).toBeUndefined();
      const target = await provider.provideDefinition(document, { line: 1, character: 5 });
      expect(target.uri.fsPath).toBe(join(dir, "Target.md"));
      expect(target.range.start).toEqual(new vscode.Position(1, 15));
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("resolves only exact canonical Person values inside query bodies", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "People/Alice.md": "---\ntags: person\n---\n",
      "Query.md": "",
    });
    const text = "```lifeloop\nperson-context\nperson: People/Alice\n```\nPeople/Alice\n";
    const document = documentOf(text, join(dir, "Query.md"));
    const provider = definitions(lifeloop) as any;
    try {
      const target = await provider.provideDefinition(document, { line: 2, character: 15 });
      expect(target.uri.fsPath).toBe(join(dir, "People/Alice.md"));
      expect(await provider.provideDefinition(document, { line: 4, character: 3 })).toBeUndefined();
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });
});
