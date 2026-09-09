import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { interactions } from "@lifeloop/semantic-core";
import {
  applyDiagnosticFix, codeActions, definitions, documentSymbols, relationshipDiagnostics,
  relationshipHovers,
} from "../src/retrieval.ts";
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

  test("empty query and frontmatter values are Errors on real tokens", async () => {
    const { lifeloop, dir } = await workspaceWith({ "People/Alice.md": "---\ntags: person\n---\n" });
    const query = "```query\r\ninteractions\r\nperson:\r\nfields:\r\nlimit:\r\n```\r\n";
    const person = "---\r\ntags: person\r\nbirthday:\r\ncontact-every:\r\n---\r\n";
    try {
      for (const [text, page, expected] of [
        [query, "Query", ["person", "fields", "limit"]],
        [person, "People/Alice", ["birthday", "contact-every"]],
      ] as const) {
        const document = documentOf(text);
        const diagnostics = relationshipDiagnostics(lifeloop, text, page, true);
        expect(diagnostics.map((entry: any) => text.slice(
          document.offsetAt(entry.range.start), document.offsetAt(entry.range.end),
        ))).toEqual(expected);
        expect(diagnostics.every((entry: any) => entry.severity === vscode.DiagnosticSeverity.Error)).toBe(true);
      }
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

  test("definitions enforce projection ownership and fail closed on unsafe Person paths", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "People/Alice.md": "---\ntags: person\n---\n",
      "Query.md": "",
    });
    const provider = definitions(lifeloop) as any;
    try {
      for (const projection of ["people", "reconnect", "actionable", "nonsense"]) {
        const text = `\`\`\`query\n${projection}\nperson: People/Alice\n\`\`\`\n`;
        expect(await provider.provideDefinition(documentOf(text, join(dir, "Query.md")), { line: 2, character: 15 }))
          .toBeUndefined();
      }
      for (const person of ["./People/Alice", "People//Alice", "/People/Alice", "../../../outside"]) {
        const text = `\`\`\`query\nperson-context\nperson: ${person}\n\`\`\`\n`;
        expect(() => provider.provideDefinition(
          documentOf(text, join(dir, "Query.md")), { line: 2, character: 10 },
        )).not.toThrow();
        expect(provider.provideDefinition(
          documentOf(text, join(dir, "Query.md")), { line: 2, character: 10 },
        )).toBeUndefined();
      }
      const text = "```query\nperson-context\nperson: People/Alice\n```\n";
      const document = documentOf(text, join(dir, "Query.md"));
      const exists = vi.spyOn(lifeloop.vault, "exists").mockImplementation(() => { throw new Error("unreadable"); });
      expect(provider.provideDefinition(document, { line: 2, character: 15 })).toBeUndefined();
      exists.mockRestore();
      vi.spyOn(lifeloop.vault, "read").mockImplementation(() => { throw new Error("unreadable"); });
      expect(provider.provideDefinition(document, { line: 2, character: 15 })).toBeUndefined();
    } finally { vi.restoreAllMocks(); lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("command-only code actions", () => {
  test("offers guarded task commands and refreshes Person eligibility", async () => {
    const line = '* [ ] Meet [[People/Alice]] [event: "E1"]';
    const { lifeloop, dir } = await workspaceWith({
      "People/Alice.md": "---\ntags: person\n---\n",
      "Work.md": `${line}\n`,
    });
    const document = documentOf(`${line}\n`, join(dir, "Work.md"));
    const provider = codeActions(lifeloop) as any;
    try {
      const actions = await provider.provideCodeActions(
        document, new vscode.Range(0, 0, 0, line.length), { diagnostics: [] },
      );
      expect(actions.map((action: any) => action.title)).toEqual(expect.arrayContaining([
        "Complete", "Toggle Waiting", "Toggle Someday", "Set Deadline", "Set Scheduled",
        "Log Interaction", "Open Pre-meeting Brief",
      ]));
      expect(actions.every((action: any) =>
        action.edit instanceof vscode.WorkspaceEdit && action.edit.edits.length === 0 &&
        action.command?.arguments?.[0]?.handle?.expectedText === line)).toBe(true);

      const changedPerson = {
        ...documentOf("# no longer a Person\n", join(dir, "People/Alice.md")),
        isDirty: true, isClosed: false,
      };
      vscode.workspace.textDocuments = [changedPerson as any];
      lifeloop.noteSourceChange();
      const refreshed = await provider.provideCodeActions(
        document, new vscode.Range(0, 0, 0, line.length), { diagnostics: [] },
      );
      expect(refreshed.map((action: any) => action.title)).not.toContain("Log Interaction");
      expect(refreshed.map((action: any) => action.title)).not.toContain("Open Pre-meeting Brief");
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("offers only canonical case fixes and rejects stale receipts", async () => {
    const { lifeloop, dir } = await workspaceWith({ "Query.md": "" });
    const text = "```lifeloop\ninteractions\nPerson: People/Alice\nfields: DATE\n```\n";
    const document = documentOf(text, join(dir, "Query.md"));
    const diagnostics = relationshipDiagnostics(lifeloop, text, "Query", true);
    const provider = codeActions(lifeloop) as any;
    const actions = await provider.provideCodeActions(
      document, new vscode.Range(0, 0, 4, 3), { diagnostics },
    );
    const replace = vi.spyOn(vscode.workspace, "applyEdit");
    vi.spyOn(vscode.workspace, "openTextDocument").mockResolvedValue(document as any);
    try {
      expect(actions.map((action: any) => action.title)).toEqual([
        "Change to person", "Change to date",
      ]);
      expect(actions.every((action: any) =>
        action.kind === vscode.CodeActionKind.QuickFix &&
        action.edit instanceof vscode.WorkspaceEdit && action.edit.edits.length === 0 &&
        action.command?.command === "lifeloop.applyDiagnosticFix")).toBe(true);

      const receipt = actions[0].command.arguments[0];
      expect(await applyDiagnosticFix({ ...receipt, version: 0 })).toBe(false);
      expect(replace).not.toHaveBeenCalled();
      expect(await applyDiagnosticFix(receipt)).toBe(true);
      expect((replace.mock.calls[0][0] as any).edits[0].content).toBe("person");
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("relationship hover", () => {
  test("shows direct and inherited People only on task syntax and fails closed when stale", async () => {
    const line = "  * [ ] Follow up [[People/Bob]] [deadline: \"2026-09-10\"]";
    const text = `* Context [[People/Alice]]\n${line}\n`;
    const { lifeloop, dir } = await workspaceWith({
      "People/Alice.md": "---\ntags: person\n---\n",
      "People/Bob.md": "---\ntags: person\n---\n",
      "Work.md": text,
    });
    const document = documentOf(text, join(dir, "Work.md"));
    const provider = relationshipHovers(lifeloop) as any;
    try {
      const task = await provider.provideHover(document, { line: 1, character: 5 });
      expect(task.contents.value).toContain("Direct People: People/Bob");
      expect(task.contents.value).toContain("Inherited-only People: People/Alice");
      expect(await provider.provideHover(document, { line: 1, character: 28 })).toBeUndefined();

      vscode.workspace.textDocuments = [{
        ...documentOf("# no longer a Person\n", join(dir, "People/Bob.md")),
        isDirty: true, isClosed: false,
      } as any];
      lifeloop.noteSourceChange();
      expect(await provider.provideHover(document, { line: 1, character: 5 })).toBeUndefined();
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("explains live Interaction, birthday, and cadence semantics", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "People/Alice.md": "---\ntags: person\ncontact-every: 30d\n---\n",
      "People/Leap.md": "---\ntags: person\nbirthday: 02-29\n---\n",
      "Journal/2026-08-01.md": "* Call [[People/Alice]] [interaction: call]\n",
      "Journal/2026-09-09.md": "* Coffee [[People/Alice]] [interaction: coffee]\n* Empty [interaction: \"\"]\n",
    });
    const provider = relationshipHovers(lifeloop) as any;
    try {
      const journalText = lifeloop.vault.read("Journal/2026-09-09.md");
      const journal = documentOf(journalText, join(dir, "Journal/2026-09-09.md"));
      expect((await provider.provideHover(journal, { line: 0, character: 42 })).contents.value)
        .toContain("counts as an Interaction");
      expect((await provider.provideHover(journal, { line: 1, character: 24 })).contents.value)
        .toContain("empty Interaction kind");

      const leapText = lifeloop.vault.read("People/Leap.md");
      const leap = documentOf(leapText, join(dir, "People/Leap.md"));
      expect((await provider.provideHover(leap, { line: 2, character: 12 })).contents.value)
        .toContain("2028-02-29");

      const aliceText = lifeloop.vault.read("People/Alice.md");
      const alice = documentOf(aliceText, join(dir, "People/Alice.md"));
      const cadence = (await provider.provideHover(alice, { line: 2, character: 18 })).contents.value;
      expect(cadence).toContain("30 days");
      expect(cadence).toContain("2026-09-09");
      expect(cadence).toContain("due");
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("uses parsed frontmatter values while retaining their source ranges", async () => {
    const person = [
      "---",
      "tags: person",
      'birthday: "02-29" # leap day',
      'contact-every: "30d" # monthly',
      "---",
      "",
    ].join("\n");
    const { lifeloop, dir } = await workspaceWith({
      "People/Alice.md": person,
      "Journal/2026-08-01.md": "* Call [[People/Alice]] [interaction: call]\n",
    });
    const document = documentOf(person, join(dir, "People/Alice.md"));
    const provider = relationshipHovers(lifeloop) as any;
    const selected = (hover: any) => person.slice(
      document.offsetAt(hover.range.start), document.offsetAt(hover.range.end),
    );
    try {
      const birthday = await provider.provideHover(document, document.positionAt(person.indexOf("02-29")));
      expect(birthday.contents.value).toContain("2028-02-29");
      expect(selected(birthday)).toBe('"02-29"');
      const cadence = await provider.provideHover(document, document.positionAt(person.indexOf("30d")));
      expect(cadence.contents.value).toContain("30 days");
      expect(selected(cadence)).toBe('"30d"');
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });
});

test("live Interaction features follow parser and core item semantics", async () => {
  const text = [
    "* [interaction: coffee]",
    "  [[People/Alice]]",
    "* `example [interaction: code]`",
    "* \\[interaction: escaped]",
    "* [interaction: 42]",
    "<!--",
    "* [[People/Alice]] [interaction: hidden]",
    "-->",
    "~~~text",
    "* [[People/Alice]] [interaction: fenced]",
    "~~~",
    '* [[People/Alice]] [interaction: ""]',
    "",
  ].join("\r\n");
  const { lifeloop, dir } = await workspaceWith({
    "People/Alice.md": "---\ntags: person\n---\n",
    "Journal/2026-09-09.md": text,
  });
  const document = documentOf(text, join(dir, "Journal/2026-09-09.md"));
  const provider = relationshipHovers(lifeloop) as any;
  try {
    expect(interactions(lifeloop.store).map((entry) => entry.kind)).toEqual(["coffee"]);
    const symbols = await (documentSymbols(lifeloop) as any).provideDocumentSymbols(document);
    expect(symbols.map((symbol: any) => symbol.name)).toEqual(["coffee", "(empty Interaction)"]);
    expect((await provider.provideHover(document, document.positionAt(text.indexOf("interaction: coffee"))))
      .contents.value).toContain("counts as an Interaction");
    for (const value of ["code", "escaped", "42", "hidden", "fenced"]) {
      expect(await provider.provideHover(document, document.positionAt(text.indexOf(`interaction: ${value}`))))
        .toBeUndefined();
    }
    expect(relationshipDiagnostics(lifeloop, text, "Journal/2026-09-09", true)
      .map((entry: any) => entry.message)).toEqual(["empty Interaction kind is excluded"]);
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("Journal symbols include counted and excluded Interactions at live ranges", async () => {
  const text = "😀\r\n* Coffee [[People/Alice]] [interaction: coffee]\r\n* Empty [interaction: \"\"]\r\n";
  const { lifeloop, dir } = await workspaceWith({
    "People/Alice.md": "---\ntags: person\n---\n",
    "Journal/2026-09-09.md": text,
  });
  const document = documentOf(text, join(dir, "Journal/2026-09-09.md"));
  try {
    const symbols = await (documentSymbols(lifeloop) as any).provideDocumentSymbols(document);
    expect(symbols.map((symbol: any) => [symbol.name, symbol.detail])).toEqual([
      ["coffee", "counted Interaction"],
      ["(empty Interaction)", expect.stringContaining("empty Interaction kind")],
    ]);
    expect(symbols.map((symbol: any) => text.slice(
      document.offsetAt(symbol.selectionRange.start), document.offsetAt(symbol.selectionRange.end),
    ))).toEqual(["[interaction: coffee]", '[interaction: ""]']);
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("task symbols use live names and CRLF ranges", async () => {
  const indexed = "* [ ] old name\r\n";
  const live = "😀\r\n\r\n* [ ] live name\r\n";
  const { lifeloop, dir } = await workspaceWith({ "Work.md": indexed });
  const document = documentOf(live, join(dir, "Work.md"));
  try {
    const symbols = await (documentSymbols(lifeloop) as any).provideDocumentSymbols(document);
    expect(symbols.map((symbol: any) => symbol.name)).toEqual(["live name"]);
    expect(live.slice(
      document.offsetAt(symbols[0].selectionRange.start),
      document.offsetAt(symbols[0].selectionRange.end),
    )).toBe("* [ ] live name");
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});
