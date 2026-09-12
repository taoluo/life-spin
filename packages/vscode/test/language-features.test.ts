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
import { taskTarget, taskTargetAt } from "../src/task-target.ts";
import { activate, deactivate } from "../src/extension.ts";
import * as apple from "../src/apple.ts";
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

afterEach(() => {
  vscode.workspace.textDocuments = [];
  vi.restoreAllMocks();
  vi.useRealTimers();
});

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

  test("fractional and nonnumeric limits select exact Error tokens", async () => {
    const { lifeloop, dir } = await workspaceWith({ "Query.md": "" });
    try {
      for (const limit of ["1.5", "many"]) {
        const text = `😀\r\n\`\`\`query\r\ninteractions\r\nlimit: ${limit}\r\n\`\`\`\r\n`;
        const document = documentOf(text, join(dir, "Query.md"));
        const diagnostics = relationshipDiagnostics(lifeloop, text, "Query", true);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].severity).toBe(vscode.DiagnosticSeverity.Error);
        expect(diagnostics[0].message).toBe("limit must be a non-negative integer");
        expect(text.slice(document.offsetAt(diagnostics[0].range.start),
          document.offsetAt(diagnostics[0].range.end))).toBe(limit);
      }
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("ignored cadence and Interaction diagnostics are Information", async () => {
    const { lifeloop, dir } = await workspaceWith({ "People/Alice.md": "---\ntags: person\n---\n" });
    try {
      for (const [text, page, message] of [
        ["---\ntags: person\ncontact-every: forever\n---\n", "People/Alice", "contact-every is ignored"],
        ["* Call [[People/Alice]] [interaction: call]\n", "Notes", "Journal date"],
        ['* Empty [interaction: ""]\n', "Journal/2026-09-09", "empty Interaction kind"],
        ["* Call [interaction: call]\n", "Journal/2026-09-09", "direct Person"],
      ]) {
        const diagnostics = relationshipDiagnostics(lifeloop, text, page, true);
        expect(diagnostics.length).toBeGreaterThan(0);
        expect(diagnostics.some((entry: any) => entry.message.includes(message))).toBe(true);
        expect(diagnostics.every((entry: any) => entry.severity === vscode.DiagnosticSeverity.Information)).toBe(true);
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

  test("gives a newly created literal @ filename precedence before the index refreshes", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "Ordinary.md": "* anchor $anchor\n",
      "Source.md": "[[Ordinary@anchor]]\n",
    });
    const document = documentOf("[[Ordinary@anchor]]\n", join(dir, "Source.md"));
    const provider = definitions(lifeloop) as any;
    try {
      writeFileSync(join(dir, "Ordinary@anchor.md"), "literal\n");
      expect(await provider.provideDefinition(document, { line: 0, character: 5 })).toBeUndefined();
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("does not reinterpret a literal @ filename when its existence is unknown", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "Target.md": "* anchored $task\n",
      "Source.md": "[[Target@task]]\n",
    });
    const document = documentOf("[[Target@task]]\n", join(dir, "Source.md"));
    const provider = definitions(lifeloop) as any;
    const exists = vi.spyOn(lifeloop.vault, "exists").mockImplementation((path: string) => {
      if (path === "Target@task.md") throw new Error("existence unknown");
      return path === "Target.md";
    });
    try {
      expect(provider.provideDefinition(document, { line: 0, character: 5 })).toBeUndefined();
    } finally {
      exists.mockRestore();
      lifeloop.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("special-ref definitions fail closed when the target cannot be inspected", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "Target.md": "* anchored $task\n",
      "Source.md": "[[Target@task]]\n",
    });
    const document = documentOf("[[Target@task]]\n", join(dir, "Source.md"));
    const provider = definitions(lifeloop) as any;
    try {
      for (const method of ["exists", "read"] as const) {
        const original = lifeloop.vault[method].bind(lifeloop.vault);
        const inspected = vi.spyOn(lifeloop.vault, method).mockImplementation(((path: string) => {
          if (path === "Target.md") throw new Error("unreadable");
          return original(path);
        }) as any);
        expect(() => provider.provideDefinition(document, { line: 0, character: 5 })).not.toThrow();
        expect(provider.provideDefinition(document, { line: 0, character: 5 })).toBeUndefined();
        inspected.mockRestore();
      }
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
      const quoted = documentOf(
        "> ```query\n> person-context\n> person: People/Alice\n> ```\n",
        join(dir, "Query.md"),
      );
      expect((await provider.provideDefinition(quoted, { line: 2, character: 17 })).uri.fsPath)
        .toBe(join(dir, "People/Alice.md"));
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

  test("definitions reject a dirty Person tag removal", async () => {
    const { lifeloop, dir } = await workspaceWith({ "People/Alice.md": "---\ntags: person\n---\n" });
    const query = documentOf("```query\nperson-context\nperson: People/Alice\n```\n", join(dir, "Query.md"));
    const provider = definitions(lifeloop) as any;
    try {
      expect(provider.provideDefinition(query, { line: 2, character: 15 }).uri.fsPath)
        .toBe(join(dir, "People/Alice.md"));
      vscode.workspace.textDocuments = [{
        ...documentOf("---\ntags: project\n---\n", join(dir, "People/Alice.md")),
        isDirty: true, isClosed: false,
      }];
      // No refresh is needed: admission must inspect the current Person source.
      expect(lifeloop.indexIsSettled()).toBe(true);
      expect(provider.provideDefinition(query, { line: 2, character: 15 })).toBeUndefined();
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("command-only code actions", () => {
  test("offers guarded task commands without reindexing in the provider hot path", async () => {
    const line = '* [ ] Meet [[People/Alice]] [event: "E1"]';
    const { lifeloop, dir } = await workspaceWith({
      "People/Alice.md": "---\ntags: person\n---\n",
      "Work.md": `${line}\n`,
    });
    const document = documentOf(`${line}\n`, join(dir, "Work.md"));
    const provider = codeActions(lifeloop) as any;
    const currentTaskStates = vi.spyOn(lifeloop, "currentTaskStates");
    const reindex = vi.spyOn(lifeloop, "reindex");
    try {
      const actions = await provider.provideCodeActions(
        document, new vscode.Range(0, 0, 0, line.length), { diagnostics: [] },
      );
      expect(actions.map((action: any) => action.title)).toEqual(expect.arrayContaining([
        "Complete", "Toggle Waiting", "Toggle Someday", "Set Deadline", "Quick Reschedule",
        "Set as Now", "Add Progress / Resume Cue",
        "Log Interaction", "Open Pre-meeting Brief",
      ]));
      expect(actions.every((action: any) =>
        action.edit instanceof vscode.WorkspaceEdit && action.edit.edits.length === 0 &&
        action.command?.arguments?.[0]?.handle?.expectedText === line)).toBe(true);
      expect(currentTaskStates).not.toHaveBeenCalled();
      expect(reindex).not.toHaveBeenCalled();

      const changedPerson = {
        ...documentOf("# no longer a Person\n", join(dir, "People/Alice.md")),
        isDirty: true, isClosed: false,
      };
      vscode.workspace.textDocuments = [changedPerson as any];
      lifeloop.noteSourceChange();
      const refreshed = await provider.provideCodeActions(
        document, new vscode.Range(0, 0, 0, line.length), { diagnostics: [] },
      );
      expect(refreshed.map((action: any) => action.title)).toEqual(["Task Actions"]);
      expect(currentTaskStates).not.toHaveBeenCalled();
      expect(reindex).not.toHaveBeenCalled();
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("offers canonical case fixes and rejects independently corrupted diagnostic receipts", async () => {
    const { lifeloop, dir } = await workspaceWith({ "Query.md": "" });
    const text = "```lifeloop\ninteractions\nPerson: People/Alice\nfields: DATE\n```\n";
    const document = documentOf(text, join(dir, "Query.md"));
    const diagnostics = relationshipDiagnostics(lifeloop, text, "Query", true);
    const provider = codeActions(lifeloop) as any;
    const actions = await provider.provideCodeActions(
      document, new vscode.Range(0, 0, 4, 3), { diagnostics },
    );
    const replace = vi.spyOn(vscode.workspace, "applyEdit");
    const other = documentOf(text.replace("Person:", "person:"), join(dir, "Other.md"));
    const opened = vi.spyOn(vscode.workspace, "openTextDocument").mockImplementation(async (...args: any[]) => {
      if (args[0].toString() === document.uri.toString()) return document;
      if (args[0].toString() === other.uri.toString()) return other;
      throw new Error("unexpected document URI");
    });
    try {
      expect(actions.map((action: any) => action.title)).toEqual([
        "Change to person", "Change to date",
      ]);
      expect(actions.every((action: any) =>
        action.kind === vscode.CodeActionKind.QuickFix &&
        action.edit instanceof vscode.WorkspaceEdit && action.edit.edits.length === 0 &&
        action.command?.command === "lifeloop.applyDiagnosticFix")).toBe(true);

      const receipt = actions[0].command.arguments[0];
      for (const [field, corrupted] of [
        ["version", { ...receipt, version: 0 }],
        ["URI", { ...receipt, uri: other.uri }],
        ["range", { ...receipt, range: new vscode.Range(
          receipt.range.start.line, receipt.range.start.character + 1,
          receipt.range.end.line, receipt.range.end.character,
        ) }],
        ["token role", { ...receipt, token: { ...receipt.token, role: "field" } }],
        ["expected text", { ...receipt, expectedText: "person" }],
        ["replacement", { ...receipt, replacement: "people" }],
      ] as const) {
        expect(await applyDiagnosticFix(corrupted), field).toBe(false);
        expect(replace, field).not.toHaveBeenCalled();
      }
      expect(opened.mock.calls.some((args: any[]) => args[0].toString() === other.uri.toString())).toBe(true);
      expect(await applyDiagnosticFix(receipt)).toBe(true);
      expect(replace).toHaveBeenCalledTimes(1);
      expect((replace.mock.calls[0][0] as any).edits[0].uri).toBe(document.uri);
      expect((replace.mock.calls[0][0] as any).edits[0].content).toBe("person");
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("offers query fixes inside blockquote containers", async () => {
    const { lifeloop, dir } = await workspaceWith({ "Query.md": "" });
    const text = "> ```query\n> interactions\n> Person: People/Alice\n> ```\n";
    const document = documentOf(text, join(dir, "Query.md"));
    const diagnostics = relationshipDiagnostics(lifeloop, text, "Query", true);
    try {
      const actions = await (codeActions(lifeloop) as any).provideCodeActions(
        document, new vscode.Range(2, 0, 2, 24), { diagnostics },
      );
      expect(actions.map((action: any) => action.title)).toEqual(["Change to person"]);
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("rejects malformed runtime task handles without falling back to a current editor", async () => {
    const text = "* [ ] Meet Alice\n";
    const { lifeloop, dir } = await workspaceWith({ "Work.md": text });
    const document = documentOf(text, join(dir, "Work.md"));
    const editor = vscode.window.activeTextEditor;
    vscode.window.activeTextEditor = { document, selection: { active: { line: 0 } } };
    try {
      const target = taskTargetAt(lifeloop, document, 0)!;
      expect(taskTarget(lifeloop, { handle: target.handle })?.line).toBe(target.line);
      for (const field of ["ref", "expectedText", "expectedState"]) {
        for (const value of [undefined, null, 7, {}, [], "not-the-captured-value"]) {
          const handle: any = { ...target.handle, [field]: value };
          if (value === undefined) delete handle[field];
          expect(taskTarget(lifeloop, { handle, page: "Work", offset: 0 }),
            `${field}: ${JSON.stringify(value)}`).toBeNull();
        }
      }
      expect(lifeloop.vault.read("Work.md")).toBe(text);
    } finally {
      vscode.window.activeTextEditor = editor;
      lifeloop.dispose(); rmSync(dir, { recursive: true, force: true });
    }
  });

  test("does not rescue a stale handle with current presentation coordinates", async () => {
    const line = "* [ ] Meet Alice";
    const before = `prefixxx\n${line}\n`;
    const { lifeloop, dir } = await workspaceWith({ "Work.md": before });
    try {
      const stale = taskTargetAt(lifeloop, documentOf(before, join(dir, "Work.md")), 1)!;
      const document = { ...documentOf(`${line}\n`, join(dir, "Work.md")), isDirty: true, isClosed: false };
      vscode.workspace.textDocuments = [document];
      lifeloop.noteSourceChange();
      await lifeloop.reindex();
      const current = taskTargetAt(lifeloop, document, 0)!;
      expect(current.offset).toBe(0);
      expect(current.handle.ref).not.toBe(stale.handle.ref);
      expect(taskTarget(lifeloop, { handle: current.handle })?.line).toBe(line);
      expect(taskTarget(lifeloop, { handle: stale.handle, page: current.page, offset: current.offset })).toBeNull();
      expect(lifeloop.vault.read("Work.md")).toBe(`${line}\n`);
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
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-09T12:00:00Z"));
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
        .toBe("**Birthday:** 02-29 · next 2028-02-29");

      const aliceText = lifeloop.vault.read("People/Alice.md");
      const alice = documentOf(aliceText, join(dir, "People/Alice.md"));
      const cadence = (await provider.provideHover(alice, { line: 2, character: 18 })).contents.value;
      expect(cadence).toContain("30 days");
      expect(cadence).toContain("2026-09-09");
      expect(cadence.split("\n").at(-1)).toBe("Reconnect: 2026-10-09 · not due");
      vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
      expect((await provider.provideHover(alice, { line: 2, character: 18 })).contents.value.split("\n").at(-1))
        .toBe("Reconnect: 2026-10-09 · due");
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("uses parsed frontmatter values while retaining their source ranges", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-09T12:00:00Z"));
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

  test("reports an unrepresentable reconnect date without claiming it is due", async () => {
    const person = "---\ntags: person\ncontact-every: 3000000d\n---\n";
    const { lifeloop, dir } = await workspaceWith({
      "People/Alice.md": person,
      "Journal/2026-09-09.md": "* Call [[People/Alice]] [interaction: call]\n",
    });
    const document = documentOf(person, join(dir, "People/Alice.md"));
    const provider = relationshipHovers(lifeloop) as any;
    try {
      const diagnostics = relationshipDiagnostics(lifeloop, person, "People/Alice", true);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].severity).toBe(vscode.DiagnosticSeverity.Information);
      expect(diagnostics[0].message).toContain("cannot be represented");
      expect(person.slice(
        document.offsetAt(diagnostics[0].range.start), document.offsetAt(diagnostics[0].range.end),
      )).toBe("3000000d");

      const hover = await provider.provideHover(document, document.positionAt(person.indexOf("3000000d")));
      expect(hover.contents.value).toContain("Reconnect: none yet · not due");
      expect(hover.contents.value).not.toContain("+010240-05");
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

test("live Interaction ranges come from direct non-task parsed attributes", async () => {
  const text = [
    "* [[People/Alice]] [interaction: coffee] `[interaction: coffee]`",
    "* [[People/Alice]] [interaction: call]",
    "  * [[People/Alice]] [interaction: call]",
    "* [ ] task [[People/Alice]] [interaction: task]",
    "* [[People/Alice]] [interaction: 'single']",
    "",
  ].join("\n");
  const { lifeloop, dir } = await workspaceWith({
    "People/Alice.md": "---\ntags: person\n---\n",
    "Journal/2026-09-09.md": text,
  });
  const document = documentOf(text, join(dir, "Journal/2026-09-09.md"));
  const provider = relationshipHovers(lifeloop) as any;
  const attributes = [...text.matchAll(/\[interaction:/g)].map((match) => match.index!);
  try {
    const symbols = (await (documentSymbols(lifeloop) as any).provideDocumentSymbols(document))
      .filter((symbol: any) => symbol.detail.includes("Interaction"));
    expect(symbols.map((symbol: any) => symbol.name)).toEqual(["coffee", "call", "call", "single"]);
    expect(symbols.map((symbol: any) => document.offsetAt(symbol.selectionRange.start)))
      .toEqual([attributes[0], attributes[2], attributes[3], attributes[5]]);
    for (const index of [attributes[0], attributes[2], attributes[3], attributes[5]]) {
      expect((await provider.provideHover(document, document.positionAt(index + 2))).contents.value)
        .toContain("counts as an Interaction");
    }
    expect(await provider.provideHover(document, document.positionAt(attributes[1] + 2))).toBeUndefined();
    const task = await provider.provideHover(document, document.positionAt(attributes[4] + 2));
    expect(task.contents.value).toContain("Task relationships");
    expect(task.contents.value).not.toContain("counts as an Interaction");
  } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

const interactionRangeCases = ["\n", "\r\n"].flatMap((newline) => [
  ["later paragraph", newline,
    ["* [[People/Alice]] first", "", "  continued [interaction: later]", ""].join(newline),
    "later", "[interaction: later]"],
  ["later duplicate", newline,
    ["* [[People/Alice]] [interaction: early]", "", "  continued [interaction: later]", ""].join(newline),
    "later", "[interaction: later]"],
  ["malformed trailing duplicate", newline,
    `* [[People/Alice]] [interaction: kept] [interaction: {broken]${newline}`,
    "kept", "[interaction: kept]"],
] as const);

test.each(interactionRangeCases)("live Interaction range follows the %s with %j", async (_name, _newline, text, kind, selected) => {
  const parseError = text.includes("{broken")
    ? vi.spyOn(console, "error").mockImplementation(() => {})
    : undefined;
  const { lifeloop, dir } = await workspaceWith({
    "People/Alice.md": "---\ntags: person\n---\n",
    "Journal/2026-09-09.md": text,
  });
  const document = documentOf(text, join(dir, "Journal/2026-09-09.md"));
  try {
    expect(interactions(lifeloop.store).map((row) => row.kind)).toEqual([kind]);
    const symbols = await (documentSymbols(lifeloop) as any).provideDocumentSymbols(document);
    expect(symbols).toHaveLength(1);
    expect(text.slice(
      document.offsetAt(symbols[0].selectionRange.start),
      document.offsetAt(symbols[0].selectionRange.end),
    )).toBe(selected);
    const hover = await (relationshipHovers(lifeloop) as any).provideHover(
      document,
      document.positionAt(text.indexOf(selected) + 2),
    );
    expect(hover.contents.value).toContain("counts as an Interaction");
  } finally {
    parseError?.mockRestore();
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
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

test("registered document-change callback suppresses derived reads across held indexing", async () => {
  const source = (person: string, limit: string) =>
    `* [ ] Meet [[People/${person}]]\n\`\`\`query\ninteractions\nperson: People/Missing\nlimit: ${limit}\n\`\`\`\n`;
  const { lifeloop, dir } = await workspaceWith({
    "People/Alice.md": "---\ntags: person\n---\n",
    "People/Bob.md": "---\ntags: person\n---\n",
    "Work.md": source("Alice", "1"),
  });
  const document = { ...documentOf(source("Alice", "1"), join(dir, "Work.md")), isDirty: true, isClosed: false };
  vscode.workspace.textDocuments = [document];
  const folders = (vscode.workspace as any).workspaceFolders;
  (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file(dir) }];
  vi.spyOn(LifeLoop, "open").mockResolvedValue(lifeloop);
  // Native Apple registration is unrelated to language publication and starts external integration setup.
  vi.spyOn(apple, "registerApple").mockImplementation(() => {});
  const registeredChange = vi.spyOn(vscode.workspace, "onDidChangeTextDocument");
  const registeredHover = vi.spyOn(vscode.languages, "registerHoverProvider");
  const collections = vi.spyOn(vscode.languages, "createDiagnosticCollection");
  const errors = vi.spyOn(vscode.window, "showErrorMessage");
  const touched = vi.spyOn(lifeloop, "touch");
  const reindexed = vi.spyOn(lifeloop, "reindex");
  const listed = vi.spyOn(lifeloop.vault, "list");
  const published = vi.fn();
  lifeloop.onDidChange(published);
  let release = () => {};
  try {
    await activate({ subscriptions: [], workspaceState: { get: (_key: string, fallback: unknown) => fallback } } as any);
    const change = (registeredChange.mock.calls.at(-1) as any)[0];
    const hover = (registeredHover.mock.calls[1] as any)[1];
    const collection = collections.mock.results[0].value;
    const cleared = vi.spyOn(collection, "clear");
    listed.mockClear();
    const diagnostics = () => collection.entries.find(([path]: [string, any[]]) =>
      path === document.uri.fsPath)?.[1] ?? [];
    const tokens = () => diagnostics().map((entry: any) => document.getText().slice(
      document.offsetAt(entry.range.start), document.offsetAt(entry.range.end),
    ));
    expect(tokens()).toEqual(["People/Missing"]);
    expect(hover.provideHover(document, { line: 0, character: 3 }).contents.value)
      .toContain("Direct People: People/Alice");

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let entered = () => {};
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const indexDocument = (lifeloop as any).indexDocument.bind(lifeloop);
    vi.spyOn(lifeloop as any, "indexDocument").mockImplementationOnce(async (...args: any[]) => {
      entered();
      await held;
      await indexDocument(...args);
    });
    Object.assign(document, documentOf(source("Alice", "1.5"), document.uri.fsPath), { version: 2 });
    change({ document });
    expect(lifeloop.indexIsSettled()).toBe(false);
    expect(tokens()).toEqual(["1.5"]);
    expect(diagnostics()[0].severity).toBe(vscode.DiagnosticSeverity.Error);
    expect(touched).not.toHaveBeenCalled();
    expect(reindexed).not.toHaveBeenCalled();
    expect(listed).not.toHaveBeenCalled();
    expect(cleared).not.toHaveBeenCalled();
    expect(hover.provideHover(document, { line: 0, character: 3 })).toBeUndefined();

    await vi.advanceTimersByTimeAsync(400);
    await started;
    expect(touched).toHaveBeenCalledTimes(1);
    expect(hover.provideHover(document, { line: 0, character: 3 })).toBeUndefined();
    Object.assign(document, documentOf(source("Bob", "many"), document.uri.fsPath), { version: 3 });
    change({ document });
    expect(tokens()).toEqual(["many"]);
    release();
    await expect(touched.mock.results[0].value).rejects.toThrow("source changed");
    expect(lifeloop.indexIsSettled()).toBe(false);
    expect(published).not.toHaveBeenCalled();
    expect(tokens()).toEqual(["many"]);
    expect(hover.provideHover(document, { line: 0, character: 3 })).toBeUndefined();
    expect(errors).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(400);
    expect(touched).toHaveBeenCalledTimes(2);
    await touched.mock.results[1].value;
    expect(lifeloop.indexIsSettled()).toBe(true);
    expect(published).toHaveBeenCalledTimes(1);
    expect(tokens()).toEqual(["People/Missing", "many"]);
    expect(hover.provideHover(document, { line: 0, character: 3 }).contents.value)
      .toContain("Direct People: People/Bob");
  } finally {
    release();
    vi.clearAllTimers();
    await Promise.allSettled(touched.mock.results.map((result) => result.value));
    deactivate();
    if (folders === undefined) delete (vscode.workspace as any).workspaceFolders;
    else (vscode.workspace as any).workspaceFolders = folders;
    rmSync(dir, { recursive: true, force: true });
  }
});
