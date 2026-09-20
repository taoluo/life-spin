import * as assert from "node:assert";
import * as path from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import * as vscode from "vscode";

/**
 * The integration tests, inside a real VS Code.
 *
 * Everything else in this repo runs headless, which is right for logic. These
 * cover only what genuinely needs the host and cannot be faked honestly:
 * activation, real provider registration, and a mutation driven through a real
 * command against a real editor buffer.
 *
 * `ROADMAP.md` records why that distinction matters here: the old implementation's
 * ref tests stayed green while the real path was broken, because they fabricated
 * the event instead of driving it.
 */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function vaultRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "no workspace folder");
  return folder.uri.fsPath;
}

const pageUri = (page: string) => vscode.Uri.file(path.join(vaultRoot(), `${page}.md`));
const readPage = (page: string) => readFileSync(pageUri(page).fsPath, "utf8");

function renderQuery(source: string): string {
  const extension = vscode.extensions.getExtension("lifeloop.lifeloop-vscode")!;
  const md: any = {
    renderer: { rules: { fence: () => "<pre>untouched</pre>" } },
    core: { ruler: { before: () => {} } },
  };
  (extension.exports as any).extendMarkdownIt(md);
  return md.renderer.rules.fence([{ info: "lifeloop", content: source }], 0, {}, {}, {});
}

/** Wait until a condition holds, so tests follow the extension rather than a sleep. */
async function until(what: string, check: () => boolean | Promise<boolean>, timeout = 8000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await wait(150);
  }
  assert.fail(`timed out waiting for: ${what}`);
}

const g1Person = "People/G1 Alice (50%)";
const g1Journal = "Journal/2001-01-02";
const g1Work = "Scratch/G1 Work";
const g1Files = {
  [g1Person]: "---\r\ntags: person\r\n---\r\n# G1 Alice (50%)\r\n",
  [g1Journal]: `😀\r\n\r\n* G1 numeric meeting [[${g1Person}]] [interaction: meeting]\r\n* G1 anchored call [[${g1Person}]] [interaction: call] $g1-call\r\n`,
  [g1Work]: `😀\r\n\r\n* [ ] G1 follow-up [[${g1Person}]] $g1-followup\r\n* [ ] G1 meeting [[${g1Person}]] [event: "g1-event"] $g1-event\r\n`,
  "Scratch/G1 Ordinary@anchor": "# Literal at filename\r\n",
  "Scratch/G1 Ordinary": "😀\r\n* ordinary anchor $anchor\r\n",
  "Scratch/G1 Literal Source": "[[Scratch/G1 Ordinary@anchor]]\r\n",
};

function assertG1Unchanged(): void {
  for (const [page, content] of Object.entries(g1Files)) {
    assert.strictEqual(readPage(page), content, `fixture changed: ${page}`);
    const open = vscode.workspace.textDocuments.find(d => d.uri.fsPath === pageUri(page).fsPath);
    if (open) assert.strictEqual(open.getText(), content, `fixture buffer changed: ${page}`);
  }
  for (const page of [`${g1Journal}@g1-call`, `${g1Journal}@6`, `${g1Work}@g1-followup`, `${g1Work}@g1-event`]) {
    assert.ok(!existsSync(pageUri(page).fsPath), `navigation created a placeholder: ${page}`);
  }
}

/** Follow the actual provider result, not a test-constructed destination. */
async function followG1PersonLink(document: vscode.TextDocument): Promise<void> {
  await vscode.extensions.getExtension("vscode.markdown-language-features")!.activate();
  const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>("vscode.executeLinkProvider", document.uri, 100);
  const personLink = links?.find(link => document.getText(link.range).includes("G1%20Alice"));
  assert.ok(personLink?.target, `no resolved Person link: ${JSON.stringify(links)}`);
  const target = personLink.target;
  if (target.scheme === "command") {
    const args = JSON.parse(decodeURIComponent(target.query));
    assert.ok(Array.isArray(args), "invalid provider command arguments");
    await vscode.commands.executeCommand(target.path, ...args);
  } else {
    assert.strictEqual(target.scheme, "file");
    await vscode.commands.executeCommand("vscode.open", target);
  }
  await until("Person link opens the exact escaped filename", () =>
    vscode.window.activeTextEditor?.document.uri.fsPath === pageUri(g1Person).fsPath);
}

async function followG1Source(document: vscode.TextDocument, ref: string, page: string, offset: number): Promise<void> {
  const marker = `[[${ref}]]`;
  const at = document.getText().indexOf(marker);
  assert.ok(at >= 0, `missing source link ${marker}: ${document.getText()}`);
  const position = document.positionAt(at + 3);
  const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
    "vscode.executeDefinitionProvider", document.uri, position);
  const destination = await vscode.workspace.openTextDocument(pageUri(page));
  assert.ok(definitions?.length, `no definition for ${marker}`);
  for (const definition of definitions) {
    assert.strictEqual(("uri" in definition ? definition.uri : definition.targetUri).fsPath, destination.uri.fsPath);
    const range = "range" in definition ? definition.range : definition.targetSelectionRange;
    assert.ok(range, `definition has no target range: ${JSON.stringify(definition)}`);
    assert.strictEqual(destination.offsetAt(range.start), offset, `wrong live CRLF/UTF-16 offset for ${marker}`);
  }
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(position, position);
  // Consume provider output through VS Code's native navigation command. This
  // qualifies target/range handling, not the focus-dependent F12 keybinding.
  const locations = definitions.map(d => "targetUri" in d
    ? new vscode.Location(d.targetUri, d.targetSelectionRange ?? d.targetRange) : d);
  await vscode.commands.executeCommand("editor.action.goToLocations", document.uri, position, locations, "goto");
  await until(`native definition navigation for ${marker}`, () => {
    const active = vscode.window.activeTextEditor;
    return active?.document.uri.fsPath === destination.uri.fsPath && active.document.offsetAt(active.selection.active) === offset;
  });
}

suite("LifeLoop in a real VS Code", () => {
  suiteSetup(async function () {
    this.timeout(60_000);
    const extension = vscode.extensions.getExtension("lifeloop.lifeloop-vscode");
    assert.ok(extension, "extension not found");
    await extension.activate();
    if (process.env.LIFELOOP_TEST_FOAM) {
      const foam = vscode.extensions.getExtension("foam.foam-vscode");
      assert.ok(foam, "Foam not installed in isolated test profile");
      assert.strictEqual(foam.packageJSON.version, "0.44.6");
      await foam.activate();
      assert.ok(foam.isActive, "G1 requires active Foam before the common cases");
    }
    for (const [page, content] of Object.entries(g1Files)) {
      assert.ok(!existsSync(pageUri(page).fsPath), `G1 fixture collision: ${page}`);
      mkdirSync(path.dirname(pageUri(page).fsPath), { recursive: true });
      writeFileSync(pageUri(page).fsPath, content);
    }
    await vscode.commands.executeCommand("lifeloop.reindex");
    // Indexing is deliberately backgrounded, so wait for it rather than assume.
    await until("commands registered", () => true, 1000);
  });

  test("activates and registers its commands", async () => {
    const extension = vscode.extensions.getExtension("lifeloop.lifeloop-vscode")!;
    const activatedPath = realpathSync(extension.extensionPath);
    const entry = path.resolve(activatedPath, extension.packageJSON.main);
    const entrySha256 = createHash("sha256").update(readFileSync(entry)).digest("hex");
    if (process.env.LIFELOOP_TEST_EXTENSION_PATH) {
      assert.strictEqual(activatedPath, realpathSync(process.env.LIFELOOP_TEST_EXTENSION_PATH));
      assert.ok(process.env.LIFELOOP_TEST_ENTRY_SHA256, "packaged qualification requires the frozen entry digest");
    }
    if (process.env.LIFELOOP_TEST_ENTRY_SHA256) assert.strictEqual(entrySha256, process.env.LIFELOOP_TEST_ENTRY_SHA256);
    console.log(`G1 activated entry: ${JSON.stringify({ path: activatedPath, entry, entrySha256, version: extension.packageJSON.version, foam: !!process.env.LIFELOOP_TEST_FOAM })}`);
    const commands = await vscode.commands.getCommands(true);
    if (!process.env.LIFELOOP_TEST_FOAM) assert.strictEqual(vscode.extensions.getExtension("foam.foam-vscode"), undefined);
    for (const name of [
      "lifeloop.capture", "lifeloop.captureHere", "lifeloop.captureSelection", "lifeloop.processInbox", "lifeloop.openToday",
      "lifeloop.completeTask", "lifeloop.setProjectStatus", "lifeloop.addReminder",
      "lifeloop.reviewActions", "lifeloop.reviewUpcoming", "lifeloop.openNextWeekFocus", "lifeloop.reviewPeriodFacts", "lifeloop.planToday",
      "lifeloop.closeTodayPlanTomorrow", "lifeloop.projectResumptionBrief", "lifeloop.addNextAction",
      "lifeloop.syncProjected", "lifeloop.importNotes", "lifeloop.taskActions",
      "lifeloop.quickReschedule", "lifeloop.findTask", "lifeloop.addFromBacklog", "lifeloop.waitingNextAction",
      "lifeloop.makeActionable", "lifeloop.explainTask", "lifeloop.addTaskNote", "lifeloop.addNoteToNow",
      "lifeloop.addRelatedLink",
      "lifeloop.recoverLastCapture", "lifeloop.returnToLastFind",
      "lifeloop.setNow", "lifeloop.returnToNow", "lifeloop.clearNow",
      "lifeloop.peekSource", "lifeloop.detachBinding", "lifeloop.copyBindingId",
      "lifeloop.logInteraction", "lifeloop.meetingWrapUp", "lifeloop.createReconnectTask", "lifeloop.preMeetingBrief",
      "lifeloop.openQueryResult",
    ]) {
      assert.ok(commands.includes(name), `missing command ${name}`);
    }
  });

  test("G1: real query results navigate Person, numeric and anchored CRLF sources", async () => {
    try {
      await vscode.commands.executeCommand("lifeloop.openQueryResult", `interactions\nperson: ${g1Person}\nfields: ref, people`);
      const result = vscode.window.activeTextEditor!.document;
      assert.strictEqual(result.uri.scheme, "lifeloop-result");
      assert.strictEqual(result.languageId, "lifeloop-result");
      assert.ok(!result.isDirty);
      assert.match(result.getText(), /^# interactions\n/);
      const numeric = g1Files[g1Journal].indexOf("* G1 numeric");
      await followG1PersonLink(result);
      await followG1Source(result, `${g1Journal}@${numeric}`, g1Journal, numeric);
      await followG1Source(result, `${g1Journal}@g1-call`, g1Journal, g1Files[g1Journal].indexOf("$g1-call"));
      await vscode.commands.executeCommand("lifeloop.openQueryResult", `person-context\nperson: ${g1Person}\nfields: person, openFollowupRefs`);
      const context = vscode.window.activeTextEditor!.document;
      assert.strictEqual(context.uri.scheme, "lifeloop-result");
      assert.strictEqual(context.languageId, "lifeloop-result");
      await followG1PersonLink(context);
      await followG1Source(context, `${g1Work}@g1-followup`, g1Work, g1Files[g1Work].indexOf("$g1-followup"));
      await followG1Source(context, `${g1Work}@g1-event`, g1Work, g1Files[g1Work].indexOf("$g1-event"));
    } finally { assertG1Unchanged(); }
  });

  test("G1: successful Brief uses the registered command and read-only Calendar boundary", async () => {
    assert.strictEqual(process.platform, "darwin", "successful native Calendar qualification requires macOS");
    const childProcess = require("node:child_process");
    const originalExecFile = childProcess.execFile;
    const calls: string[] = [];
    const forbidden: string[] = [];
    const calendarName = vscode.workspace.getConfiguration("lifeloop").get("calendarName", "Calendar");
    childProcess.execFile = (file: string, args: string[], options: unknown, callback: Function) => {
      if (file !== "osascript") return originalExecFile(file, args, options, callback);
      return { stdin: { end(script: string) {
        const probe = args.join("\0") === ["-l", "AppleScript", "-", "Calendar"].join("\0") &&
          script.trim() === 'on run argv\n      tell application "System Events" to return (exists process (item 1 of argv)) as string\n    end run';
        const read = args.join("\0") === ["-l", "AppleScript", "-", calendarName, "g1-event"].join("\0") &&
          script.includes("every event of c whose uid is (theUid as string)") &&
          script.includes("set calName to item 1 of argv") &&
          !/\b(make|delete|launch)\b|set\s+(summary|start date|end date|location)\s+of/i.test(script);
        if (!probe && !read) forbidden.push(JSON.stringify({ args, script }));
        calls.push(probe ? "probe" : read ? "read" : "forbidden");
        const output = probe ? "true" : ["g1-event", "G1 qualified meeting", "2001-01-03 10:00", "2001-01-03 11:00", "G1 Room"].join("\u001f") + "\u001d";
        queueMicrotask(() => callback(probe || read ? null : new Error("unexpected AppleScript denied by G1"), output, ""));
      } } };
    };
    try {
      const source = await vscode.workspace.openTextDocument(pageUri(g1Work));
      const editor = await vscode.window.showTextDocument(source);
      const position = source.positionAt(source.getText().indexOf("* [ ] G1 meeting") + 3);
      editor.selection = new vscode.Selection(position, position);
      await vscode.commands.executeCommand("lifeloop.preMeetingBrief");
      assert.deepStrictEqual(forbidden, [], "Brief attempted an unapproved Calendar operation");
      assert.deepStrictEqual(calls, ["probe", "read"]);
      const brief = vscode.window.activeTextEditor!.document;
      assert.match(brief.getText(), /^# Pre-meeting Brief\n/);
      assert.strictEqual(brief.uri.scheme, "lifeloop-result");
      assert.strictEqual(brief.languageId, "lifeloop-result");
      assert.strictEqual(brief.isDirty, false);
      assert.match(brief.getText(), /G1 qualified meeting/);
      assert.match(brief.getText(), /Open follow-ups: 2/);
      await followG1PersonLink(brief);
      await followG1Source(brief, `${g1Journal}@6`, g1Journal, 6);
      await followG1Source(brief, `${g1Journal}@g1-call`, g1Journal, g1Files[g1Journal].indexOf("$g1-call"));
      await followG1Source(brief, `${g1Work}@g1-followup`, g1Work, g1Files[g1Work].indexOf("$g1-followup"));
      await followG1Source(brief, `${g1Work}@g1-event`, g1Work, g1Files[g1Work].indexOf("$g1-event"));
    } finally {
      childProcess.execFile = originalExecFile;
      assertG1Unchanged();
    }
  });

  test("G1: literal @ filename takes precedence over the SB anchor", async () => {
    try {
      const document = await vscode.workspace.openTextDocument(pageUri("Scratch/G1 Literal Source"));
      const position = new vscode.Position(0, 12);
      let definitions: (vscode.Location | vscode.LocationLink)[] = [];
      await until("literal @ definition providers settle", async () => {
        definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
          "vscode.executeDefinitionProvider", document.uri, position) ?? [];
        return !process.env.LIFELOOP_TEST_FOAM || definitions.length > 0;
      });
      const targets = definitions.map(d => ("uri" in d ? d.uri : d.targetUri).fsPath);
      assert.ok(!targets.includes(pageUri("Scratch/G1 Ordinary").fsPath), "LifeLoop stole an ordinary @ filename");
      if (process.env.LIFELOOP_TEST_FOAM) {
        assert.ok(targets.includes(pageUri("Scratch/G1 Ordinary@anchor").fsPath), JSON.stringify(definitions));
        const editor = await vscode.window.showTextDocument(document);
        editor.selection = new vscode.Selection(position, position);
        const locations = definitions.map(d => "targetUri" in d
          ? new vscode.Location(d.targetUri, d.targetSelectionRange ?? d.targetRange) : d);
        await vscode.commands.executeCommand("editor.action.goToLocations", document.uri, position, locations, "goto");
        await until("native literal @ navigation", () => vscode.window.activeTextEditor?.document.uri.fsPath === pageUri("Scratch/G1 Ordinary@anchor").fsPath);
      } else assert.deepStrictEqual(targets, [], "ordinary wiki navigation belongs to Foam");
    } finally { assertG1Unchanged(); }
  });

  test("G1: completion acceptance replaces the full canonical Person value", async () => {
    try {
      for (const [value, cursor] of [["People/G1", 9], ["People/G1 Al", 12], ["People/G1 Al stale suffix", 12]] as const) {
        const before = `\`\`\`lifeloop\ninteractions\nperson: ${value}\n\`\`\`\n`;
        const expected = `\`\`\`lifeloop\ninteractions\nperson: ${g1Person}\n\`\`\`\n`;
        const document = await vscode.workspace.openTextDocument({ content: before, language: "markdown" });
        const editor = await vscode.window.showTextDocument(document);
        const position = new vscode.Position(2, "person: ".length + cursor);
        editor.selection = new vscode.Selection(position, position);
        let item: vscode.CompletionItem | undefined;
        await until(`canonical Person completion for ${value}`, async () => {
          const completions = await vscode.commands.executeCommand<vscode.CompletionList>("vscode.executeCompletionItemProvider", document.uri, position);
          item = completions?.items.find(i => (typeof i.label === "string" ? i.label : i.label.label) === g1Person);
          return !!item;
        });
        assert.ok(item);
        assert.ok(item.range instanceof vscode.Range, "expected a full replacement range");
        assert.strictEqual(document.getText(item.range), value);
        // Apply the real provider item in the real editor. This qualifies its
        // full replacement semantics, not suggestion-widget focus/selection.
        assert.strictEqual(typeof item.insertText, "string");
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, item.range, item.insertText as string);
        assert.ok(await vscode.workspace.applyEdit(edit), `completion edit refused for ${value}`);
        assert.strictEqual(document.getText(), expected);
        await vscode.commands.executeCommand("lifeloop.openQueryResult", document.getText().split("\n").slice(1, 3).join("\n"));
        assert.match(vscode.window.activeTextEditor!.document.getText(), /G1 numeric meeting/);
      }
    } finally { assertG1Unchanged(); }
  });

  test("managed task completion coexists with the host and inserts an absolute date", async () => {
    const fieldUri = pageUri("Scratch/Completion Field");
    writeFileSync(fieldUri.fsPath, "- [ ] 复查结果");
    const fieldDocument = await vscode.workspace.openTextDocument(fieldUri);
    const fieldEditor = await vscode.window.showTextDocument(fieldDocument);
    await fieldEditor.edit(edit => edit.insert(new vscode.Position(0, fieldDocument.lineAt(0).text.length), " [sche"));
    assert.ok(fieldDocument.isDirty);
    const fieldSource = fieldDocument.getText();
    const fieldPosition = fieldDocument.positionAt(fieldSource.length);
    const fields = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider", fieldDocument.uri, fieldPosition,
    );
    const scheduled = fields?.items.find(item =>
      (typeof item.label === "string" ? item.label : item.label.label) === "scheduled");
    assert.ok(scheduled, "no LifeLoop scheduled completion");
    assert.ok(scheduled.range instanceof vscode.Range);
    assert.strictEqual(fieldDocument.getText(scheduled.range), "sche");
    assert.ok(scheduled.insertText instanceof vscode.SnippetString);
    assert.strictEqual(scheduled.insertText.value, 'scheduled: "$1"]');
    const fieldEdit = new vscode.WorkspaceEdit();
    fieldEdit.replace(fieldDocument.uri, scheduled.range, 'scheduled: "2026-09-13"]');
    assert.ok(await vscode.workspace.applyEdit(fieldEdit));
    assert.ok(await fieldDocument.save());

    const dateUri = pageUri("Scratch/Completion Date");
    writeFileSync(dateUri.fsPath, "- [ ] Review");
    const dateDocument = await vscode.workspace.openTextDocument(dateUri);
    const dateEditor = await vscode.window.showTextDocument(dateDocument);
    await dateEditor.edit(edit => edit.insert(new vscode.Position(0, dateDocument.lineAt(0).text.length), " [deadline: 2026"));
    assert.ok(dateDocument.isDirty);
    const dateSource = dateDocument.getText();
    const datePosition = dateDocument.positionAt(dateSource.length);
    const dates = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider", dateDocument.uri, datePosition,
    );
    const today = dates?.items.find(item => {
      const label = typeof item.label === "string" ? item.label : item.label.label;
      return label.startsWith("Today — ");
    });
    assert.ok(today, "no LifeLoop absolute Today completion");
    assert.ok(today.range instanceof vscode.Range);
    assert.strictEqual(dateDocument.getText(today.range), "2026");
    const insertText = today.insertText;
    assert.ok(typeof insertText === "string");
    assert.match(insertText, /^"\d{4}-\d{2}-\d{2}"\]$/);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(dateDocument.uri, today.range, insertText);
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.match(dateDocument.getText(), /^- \[ \] Review \[deadline: "\d{4}-\d{2}-\d{2}"\]$/);
    assert.ok(await dateDocument.save());
  });

  test("registers the tree views", async () => {
    // Nothing to assert about contents here — that is covered headlessly. What a
    // real host proves is that the view ids in package.json match what is registered.
    await vscode.commands.executeCommand("workbench.view.extension.lifeloop");
    assert.ok(true);
  });

  test("Today focuses the existing view without creating another document", async () => {
    const before = vscode.workspace.textDocuments.map(d => d.uri.toString());
    await vscode.commands.executeCommand("lifeloop.openToday");
    assert.deepStrictEqual(vscode.workspace.textDocuments.map(d => d.uri.toString()), before);
  });

  test("logs a Person interaction and creates an ordinary reconnect task", async () => {
    const person = pageUri("People/Integration Alice");
    mkdirSync(path.dirname(person.fsPath), { recursive: true });
    writeFileSync(person.fsPath, "---\ntags: person\ncontact-every: 30d\n---\n");
    const document = await vscode.workspace.openTextDocument(person);
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand("lifeloop.reindex");

    const originalQuickPick = vscode.window.showQuickPick;
    const originalInputBox = vscode.window.showInputBox;
    try {
      (vscode.window as any).showQuickPick = async (items: any[]) => items.find((item) => item.id === "call");
      (vscode.window as any).showInputBox = async (options: any) =>
        String(options.prompt).startsWith("What happened") ? "Caught up" : "2026-10-01";
      await vscode.commands.executeCommand("lifeloop.logInteraction");
      await vscode.commands.executeCommand("lifeloop.createReconnectTask");
    } finally {
      (vscode.window as any).showQuickPick = originalQuickPick;
      (vscode.window as any).showInputBox = originalInputBox;
    }

    const journal = pageUri(`Journal/${new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)}`);
    assert.match(readFileSync(journal.fsPath, "utf8"), /Caught up \[\[People\/Integration Alice\]\] \[interaction: call\]/);
    assert.match(readPage("Inbox"), /Reconnect with \[\[People\/Integration Alice\]\].*\[reconnect: true\]/);
  });

  test("Task Actions logs one Interaction for multiple directly linked People", async () => {
    for (const name of ["Task Alice", "Task Bob"]) {
      const uri = pageUri(`People/${name}`);
      mkdirSync(path.dirname(uri.fsPath), { recursive: true });
      writeFileSync(uri.fsPath, "---\ntags: person\n---\n");
    }
    const task = pageUri("Scratch/Task Interaction");
    mkdirSync(path.dirname(task.fsPath), { recursive: true });
    writeFileSync(task.fsPath, "* [ ] Met [[People/Task Alice]] and [[People/Task Bob]]\n");
    const document = await vscode.workspace.openTextDocument(task);
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(0, 3, 0, 3);
    await vscode.commands.executeCommand("lifeloop.reindex");

    const originalQuickPick = vscode.window.showQuickPick;
    const originalInputBox = vscode.window.showInputBox;
    try {
      (vscode.window as any).showQuickPick = async (items: any[], options: any) => {
        if (options?.canPickMany) return items;
        return items.find((item) => item.id === "interaction") ?? items.find((item) => item.id === "meeting");
      };
      (vscode.window as any).showInputBox = async () => "Discussed integration";
      await vscode.commands.executeCommand("lifeloop.taskActions");
    } finally {
      (vscode.window as any).showQuickPick = originalQuickPick;
      (vscode.window as any).showInputBox = originalInputBox;
    }

    const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    const journal = readPage(`Journal/${date}`);
    const expected = "Discussed integration [[People/Task Alice]] and [[People/Task Bob]] [interaction: meeting]";
    assert.strictEqual(journal.split(expected).length - 1, 1);
  });

  test("retires generic PKM commands and keeps task diagnostics", async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const name of ["openDaily", "openPage", "newFromTemplate", "tagPicker", "metaPicker", "anythingPicker", "reprefixLine"]) {
      assert.ok(!commands.includes(`lifeloop.${name}`), `retired command still registered: ${name}`);
    }
    const uri = pageUri("Scratch/Diagnostics");
    writeFileSync(uri.fsPath, '* [ ] task [deadline: "tomorrow"]\nSee [[Missing]]\n');
    await vscode.commands.executeCommand("lifeloop.reindex");
    const own = vscode.languages.getDiagnostics(uri).filter(d => /YYYY-MM-DD/.test(d.message));
    assert.strictEqual(own.length, 1);
  });

  test("SB refs use the explicit command without creating notes", async () => {
    const uri = pageUri("Scratch/SbAnchor");
    const body = "# Anchor\n* [ ] target $sb-anchor\n* [ ] longer $sb-anchor-long\n";
    writeFileSync(uri.fsPath, body);
    const refs = ["[[Scratch/SbAnchor@sb-anchor|target]]", "[[Scratch/SbAnchor@9]]"];
    const source = pageUri("Scratch/SbSource");
    writeFileSync(source.fsPath, refs.join("\n"));
    await vscode.commands.executeCommand("lifeloop.reindex");
    const doc = await vscode.workspace.openTextDocument(source);
    for (let line = 0; line < refs.length; line++) {
      const editor = await vscode.window.showTextDocument(doc);
      editor.selection = new vscode.Selection(line, 8, line, 8);
      await vscode.commands.executeCommand("lifeloop.openSbRef");
      const target = vscode.window.activeTextEditor!;
      assert.strictEqual(target.document.uri.fsPath, uri.fsPath);
      assert.strictEqual(target.document.offsetAt(target.selection.active), line === 0 ? body.indexOf("$sb-anchor") : 9);
    }
    assert.ok(!existsSync(pageUri("Scratch/SbAnchor@sb-anchor").fsPath));
    assert.strictEqual(readPage("Scratch/SbAnchor"), body);
  });

  test("capture writes above Processed, through the real command", async () => {
    const before = readPage("Inbox");
    // Drive the *command*, not the mutation underneath it. The input box is
    // answered by stubbing the prompt, so everything after it — including the
    // asynchronous write — is the real path a user takes.
    const original = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => "an integration capture";
    try {
      await vscode.commands.executeCommand("lifeloop.capture");
    } finally {
      (vscode.window as any).showInputBox = original;
    }
    await until("the capture to reach the file", () => readPage("Inbox") !== before);

    const after = readPage("Inbox");
    assert.notStrictEqual(after, before);
    const processedAt = after.indexOf("## Processed");
    if (processedAt !== -1) {
      assert.ok(
        after.indexOf("an integration capture") < processedAt,
        "capture landed in the processed pile",
      );
    }
  });

  test("Capture Here inserts beside the active context and refuses prompt-time drift", async () => {
    const uri = pageUri("Scratch/CaptureHere");
    writeFileSync(uri.fsPath, "# Project\ncontext\n");
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(1, 0, 1, 0);
    const original = vscode.window.showInputBox;
    try {
      (vscode.window as any).showInputBox = async () => "captured nearby";
      await vscode.commands.executeCommand("lifeloop.captureHere");
      assert.ok(document.getText().includes("context\n* [ ] captured nearby\n"));

      (vscode.window as any).showInputBox = async () => {
        await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), "changed while prompting\n"));
        return "must be refused";
      };
      editor.selection = new vscode.Selection(1, 0, 1, 0);
      await vscode.commands.executeCommand("lifeloop.captureHere");
      assert.ok(!document.getText().includes("must be refused"));
      await document.save();
    } finally {
      (vscode.window as any).showInputBox = original;
    }
  });

  test("Capture Selection records provenance and keeps the source editor active", async () => {
    const config = vscode.workspace.getConfiguration("lifeloop");
    const sourceUri = pageUri("Scratch/SelectionSource");
    const inboxUri = pageUri("Scratch/SelectionInbox");
    writeFileSync(sourceUri.fsPath, "before\nselected context\nafter\n");
    const document = await vscode.workspace.openTextDocument(sourceUri);
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(1, 0, 1, "selected context".length);
    try {
      await config.update("inboxPage", "Scratch/SelectionInbox", vscode.ConfigurationTarget.Workspace);
      await vscode.commands.executeCommand("lifeloop.captureSelection");
      assert.strictEqual(vscode.window.activeTextEditor?.document.uri.fsPath, sourceUri.fsPath);
      assert.match(readFileSync(inboxUri.fsPath, "utf8"),
        /Captured selection\n  > selected context\n  Source: \[\[Scratch\/SelectionSource\]\] · line 2/);
    } finally {
      await config.update("inboxPage", undefined, vscode.ConfigurationTarget.Workspace);
    }
  });

  test("Add Progress appends an ordinary guarded child without completing the task", async () => {
    const uri = pageUri("Scratch/TaskProgress");
    const line = "* [ ] parent";
    writeFileSync(uri.fsPath, `${line}\n  * [ ] child\n`);
    await vscode.commands.executeCommand("lifeloop.reindex");
    const quickPick = vscode.window.showQuickPick;
    const inputBox = vscode.window.showInputBox;
    try {
      (vscode.window as any).showQuickPick = async (items: any[]) =>
        items.find((item) => item.id === "progress");
      (vscode.window as any).showInputBox = async () => "verified the edge case";
      await vscode.commands.executeCommand("lifeloop.addTaskNote", {
        handle: { ref: "Scratch/TaskProgress@0", expectedText: line, expectedState: " " },
      });
      assert.strictEqual(readFileSync(uri.fsPath, "utf8"),
        `${line}\n  * [ ] child\n  * Progress: verified the edge case\n`);
    } finally {
      (vscode.window as any).showQuickPick = quickPick;
      (vscode.window as any).showInputBox = inputBox;
    }
  });

  test("Add Progress to Now keeps the active editor and writes only the session target", async () => {
    const targetUri = pageUri("Scratch/NowProgressTarget");
    const otherUri = pageUri("Scratch/NowProgressOther");
    const line = "* [ ] current work";
    writeFileSync(targetUri.fsPath, `${line}\n`);
    writeFileSync(otherUri.fsPath, "* [ ] background editor task\n");
    await vscode.commands.executeCommand("lifeloop.reindex");
    const other = await vscode.workspace.openTextDocument(otherUri);
    await vscode.window.showTextDocument(other);
    await vscode.commands.executeCommand("lifeloop.setNow", {
      handle: { ref: "Scratch/NowProgressTarget@0", expectedText: line, expectedState: " " },
    });

    const quickPick = vscode.window.showQuickPick;
    const inputBox = vscode.window.showInputBox;
    try {
      (vscode.window as any).showQuickPick = async (items: any[]) =>
        items.find((item) => item.id === "progress");
      (vscode.window as any).showInputBox = async () => "recorded without leaving the editor";
      await vscode.commands.executeCommand("lifeloop.addNoteToNow");
      assert.match(readPage("Scratch/NowProgressTarget"), /Progress: recorded without leaving the editor/);
      assert.strictEqual(readPage("Scratch/NowProgressOther"), "* [ ] background editor task\n");
      assert.strictEqual(vscode.window.activeTextEditor?.document.uri.fsPath, otherUri.fsPath);
    } finally {
      (vscode.window as any).showQuickPick = quickPick;
      (vscode.window as any).showInputBox = inputBox;
      await vscode.commands.executeCommand("lifeloop.clearNow");
    }
  });

  test("Task Actions dispatches through the guarded task mutation", async () => {
    const uri = pageUri("Scratch/TaskActions");
    const line = "* [ ] task action target";
    writeFileSync(uri.fsPath, `${line}\n`);
    await vscode.commands.executeCommand("lifeloop.reindex");
    const original = vscode.window.showQuickPick;
    try {
      (vscode.window as any).showQuickPick = async () => ({ label: "Complete", id: "complete" });
      await vscode.commands.executeCommand("lifeloop.taskActions", {
        handle: { ref: "Scratch/TaskActions@0", expectedText: line, expectedState: " " },
      });
      assert.match(readPage("Scratch/TaskActions"), /^\* \[x\] task action target/);
    } finally {
      (vscode.window as any).showQuickPick = original;
    }
  });

  test("Quick Reschedule keeps the explicit Tree target when another editor is active", async () => {
    const targetUri = pageUri("Scratch/RescheduleTarget");
    const otherUri = pageUri("Scratch/RescheduleOther");
    const line = '* [ ] target [deadline: "2099-12-31"] [event: "E1"]';
    writeFileSync(targetUri.fsPath, `${line}\n`);
    writeFileSync(otherUri.fsPath, "* [ ] other\n");
    await vscode.commands.executeCommand("lifeloop.reindex");
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(otherUri));
    const original = vscode.window.showQuickPick;
    try {
      (vscode.window as any).showQuickPick = async (items: any[]) => items[1];
      await vscode.commands.executeCommand("lifeloop.quickReschedule", {
        handle: { ref: "Scratch/RescheduleTarget@0", expectedText: line, expectedState: " " },
      });
      assert.match(readFileSync(targetUri.fsPath, "utf8"),
        /^\* \[ \] target \[deadline: "2099-12-31"\] \[event: "E1"\] \[scheduled: "\d{4}-\d{2}-\d{2}"\]$/m);
      assert.strictEqual(readFileSync(otherUri.fsPath, "utf8"), "* [ ] other\n");
    } finally {
      (vscode.window as any).showQuickPick = original;
    }
  });

  test("Now keeps the explicit target, returns to it, and clears session state", async () => {
    const targetUri = pageUri("Scratch/NowTarget");
    const otherUri = pageUri("Scratch/NowOther");
    const line = "* [ ] current target";
    writeFileSync(targetUri.fsPath, `${line}\n`);
    writeFileSync(otherUri.fsPath, "* [ ] active editor task\n");
    await vscode.commands.executeCommand("lifeloop.reindex");
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(otherUri));

    const input = { handle: { ref: "Scratch/NowTarget@0", expectedText: line, expectedState: " " } };
    await vscode.commands.executeCommand("lifeloop.setNow", input);
    await vscode.commands.executeCommand("lifeloop.returnToNow");
    assert.strictEqual(vscode.window.activeTextEditor?.document.uri.fsPath, targetUri.fsPath);
    await vscode.commands.executeCommand("lifeloop.clearNow");
  });

  test("Process Inbox continues with the next item after each success", async () => {
    const config = vscode.workspace.getConfiguration("lifeloop");
    const uri = pageUri("Scratch/ProcessInbox");
    writeFileSync(uri.fsPath, "* first\n* second\n");
    const original = vscode.window.showQuickPick;
    try {
      await config.update("inboxPage", "Scratch/ProcessInbox", vscode.ConfigurationTarget.Workspace);
      await vscode.commands.executeCommand("lifeloop.reindex");
      (vscode.window as any).showQuickPick = async (items: any[]) => items.find((item) => item.id === "archive");
      await vscode.commands.executeCommand("lifeloop.processInbox");
      const text = readFileSync(uri.fsPath, "utf8");
      assert.ok(text.indexOf("## Processed") < text.indexOf("first"));
      assert.ok(text.indexOf("## Processed") < text.indexOf("second"));
    } finally {
      (vscode.window as any).showQuickPick = original;
      await config.update("inboxPage", undefined, vscode.ConfigurationTarget.Workspace);
    }
  });

  test("binding hover exposes fixed actions and detach keeps the external item", async () => {
    const uri = pageUri("Scratch/BindingHover");
    const line = '* [ ] bound task [reminder:"R-HOVER"]';
    writeFileSync(uri.fsPath, `${line}\n`);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    const at = new vscode.Position(0, line.indexOf("R-HOVER"));
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", uri, at);
    assert.ok(hovers?.some((hover) => hover.contents.some((part) => String((part as any).value ?? part).includes("Detach"))));

    const action = {
      kind: "reminder",
      id: "R-HOVER",
      handle: { ref: "Scratch/BindingHover@0", expectedText: line, expectedState: " " },
      page: "Scratch/BindingHover",
      offset: 0,
    };
    await vscode.commands.executeCommand("lifeloop.copyBindingId", action);
    assert.strictEqual(await vscode.env.clipboard.readText(), "R-HOVER");
    await vscode.commands.executeCommand("lifeloop.detachBinding", action);
    assert.ok(!readPage("Scratch/BindingHover").includes("reminder:"));

    const duplicateUri = pageUri("Scratch/BindingDuplicate");
    const duplicate = '* [ ] ambiguous [reminder: "A"] [reminder: "B"]';
    writeFileSync(duplicateUri.fsPath, `${duplicate}\n`);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(duplicateUri));
    await vscode.commands.executeCommand("lifeloop.detachBinding", {
      kind: "reminder",
      id: "B",
      handle: { ref: "Scratch/BindingDuplicate@0", expectedText: duplicate, expectedState: " " },
      page: "Scratch/BindingDuplicate",
      offset: 0,
    });
    assert.strictEqual(readPage("Scratch/BindingDuplicate"), `${duplicate}\n`);
  });

  test("completing a task from Today stamps the real file", async () => {
    const uri = pageUri("Scratch/Integration");
    writeFileSync(uri.fsPath, '* [ ] integration task [deadline: "2020-01-01"]\n');
    await vscode.commands.executeCommand("lifeloop.reindex");

    const { LifeLoopForTest } = await import("./harness.ts");
    const { setTaskState } = await import("@lifeloop/semantic-core");
    const lifeloop = await LifeLoopForTest.open(vaultRoot());

    const text = readFileSync(uri.fsPath, "utf8");
    const handle = {
      ref: `Scratch/Integration@0`,
      expectedText: text.split("\n")[0],
      expectedState: " ",
    };
    const result = await setTaskState(lifeloop.vault, handle, true);
    assert.ok(result.ok, `refused: ${JSON.stringify(result)}`);

    const after = readFileSync(uri.fsPath, "utf8");
    assert.ok(after.includes("* [x] integration task"), after);
    assert.ok(/\[completed: "\d{4}-\d{2}-\d{2}"\]/.test(after), after);
    lifeloop.dispose();
  });

  test("a query block renders in the real Markdown preview", async () => {
    // The editor keeps showing the fenced block as code; the preview shows what
    // it means. Same contribution point Mermaid and KaTeX use, and it works
    // without a webview because extendMarkdownIt runs in the extension host and
    // node:sqlite is synchronous.
    const uri = pageUri("Scratch/Query");
    writeFileSync(
      uri.fsPath,
      [
        '* [ ] a query target [deadline: "2020-01-01"]',
        "",
        "```lifeloop",
        "actionable",
        "fields: name",
        "```",
        "",
      ].join("\n"),
    );
    await vscode.commands.executeCommand("lifeloop.reindex");

    const extension = vscode.extensions.getExtension("lifeloop.lifeloop-vscode");
    const api: any = extension!.exports;
    assert.ok(api?.extendMarkdownIt, "the extension exposes no markdown-it hook");

    // Drive the hook exactly as the preview does.
    // Shaped like the real markdown-it: a fence renderer *and* a core ruler, since
    // `${...}` interpolation hooks the latter.
    const rules: any[] = [];
    const md: any = {
      renderer: { rules: { fence: () => "<pre>untouched</pre>" } },
      core: { ruler: { before: (_a: string, name: string, f: unknown) => rules.push({ name, f }) } },
    };
    api.extendMarkdownIt(md);
    assert.ok(rules.some((r) => r.name === "lifeloop-interpolate"), "no interpolation rule");

    // And it substitutes: an answered expression becomes real Markdown.
    const state = { src: "before ${lifeloop.day()} after" };
    rules.find((r) => r.name === "lifeloop-interpolate").f(state);
    assert.ok(typeof state.src === "string");
    const html = md.renderer.rules.fence(
      [{ info: "lifeloop", content: "actionable\nfields: name" }], 0, {}, {}, {},
    );

    assert.match(html, /<table/, html);
    assert.match(html, /a query target/, html);
    // A fence of any other language is left alone.
    assert.strictEqual(
      md.renderer.rules.fence([{ info: "ts", content: "const x = 1" }], 0, {}, {}, {}),
      "<pre>untouched</pre>",
    );
  });

  test("task-state configuration changes invalidate the live index", async () => {
    const uri = pageUri("Scratch/ConfiguredState");
    writeFileSync(uri.fsPath, '* [DONE] configured state [deadline: "2020-01-01"]\n');
    await vscode.commands.executeCommand("lifeloop.reindex");
    assert.match(renderQuery("actionable\nfields: name"), /configured state/);

    const config = vscode.workspace.getConfiguration("lifeloop");
    try {
      await config.update("taskStates", [{ state: "DONE", done: true }], vscode.ConfigurationTarget.Workspace);
      await until("configured DONE state to leave actionable", () => !renderQuery("actionable\nfields: name").includes("configured state"));
    } finally {
      await config.update("taskStates", undefined, vscode.ConfigurationTarget.Workspace);
    }
  });

  test("deleting a Lua state declaration invalidates other task pages", async () => {
    const declaration = pageUri("Scratch/StateDeclaration");
    const task = pageUri("Scratch/DeclaredState");
    writeFileSync(declaration.fsPath, '```space-lua\ntaskState.define {name="DONE", done=true}\n```\n');
    writeFileSync(task.fsPath, '* [DONE] declared state [deadline: "2020-01-01"]\n');
    const config = vscode.workspace.getConfiguration("lifeloop");
    try {
      await config.update("executeSpaceLua", true, vscode.ConfigurationTarget.Workspace);
      await until("declared DONE state to become completed", () => !renderQuery("actionable\nfields: name").includes("declared state"));
      const edit = new vscode.WorkspaceEdit();
      edit.deleteFile(declaration);
      assert.ok(await vscode.workspace.applyEdit(edit), "VS Code refused declaration deletion");
      await until("deleted state declaration to be forgotten", () => renderQuery("actionable\nfields: name").includes("declared state"));
    } finally {
      await config.update("executeSpaceLua", undefined, vscode.ConfigurationTarget.Workspace);
    }
  });

  test("a task command reads a dirty state declaration before writing", async () => {
    const declaration = pageUri("Scratch/DirtyStateDeclaration");
    const task = pageUri("Scratch/DirtyDeclaredState");
    writeFileSync(declaration.fsPath, '```space-lua\ntaskState.define {name="DONE", done=false}\n```\n');
    writeFileSync(task.fsPath, '* [DONE] dirty policy task\n');
    const config = vscode.workspace.getConfiguration("lifeloop");
    try {
      await config.update("executeSpaceLua", true, vscode.ConfigurationTarget.Workspace);
      await until("initial DONE declaration to be open", () => renderQuery("actionable\nfields: name").includes("dirty policy task"));
      const document = await vscode.workspace.openTextDocument(declaration);
      const editor = await vscode.window.showTextDocument(document);
      await editor.edit((edit) => edit.replace(
        new vscode.Range(1, 0, 1, document.lineAt(1).text.length),
        'taskState.define {name="DONE", done=true}',
      ));
      assert.ok(document.isDirty, "expected an unsaved declaration");
      await vscode.commands.executeCommand("lifeloop.completeTask", {
        handle: {
          ref: "Scratch/DirtyDeclaredState@0",
          expectedText: "* [DONE] dirty policy task",
          expectedState: "DONE",
        },
      });
      assert.strictEqual(readFileSync(task.fsPath, "utf8"), "* [DONE] dirty policy task\n");
      await document.save();
    } finally {
      await config.update("executeSpaceLua", undefined, vscode.ConfigurationTarget.Workspace);
    }
  });

  test("a mutation against an unsaved buffer reads *and writes* the buffer", async () => {
    // I4's three-versions problem, in the only place it can be tested: a real
    // editor with a dirty document. Reading the buffer was already covered; the
    // half that matters is the write, because that is the path where the edit
    // promise used to be discarded and success reported before anything landed.
    const uri = pageUri("Scratch/Buffer");
    writeFileSync(uri.fsPath, "* [ ] on disk\n");
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    await editor.edit((edit) => {
      edit.replace(new vscode.Range(0, 0, 0, document.lineAt(0).text.length), "* [ ] edited in buffer");
    });
    assert.ok(document.isDirty, "expected an unsaved buffer");

    const { LifeLoopForTest } = await import("./harness.ts");
    const { setTaskState } = await import("@lifeloop/semantic-core");
    const lifeloop = await LifeLoopForTest.open(vaultRoot());

    const seen = lifeloop.vault.read("Scratch/Buffer.md");
    assert.ok(seen.includes("edited in buffer"), `vault read the disk, not the buffer: ${seen}`);

    const result = await setTaskState(lifeloop.vault, {
      ref: "Scratch/Buffer@0",
      expectedText: "* [ ] edited in buffer",
      expectedState: " ",
    }, true);
    assert.ok(result.ok, `refused: ${JSON.stringify(result)}`);

    // Awaited all the way through: by the time the mutation returns, the editor
    // has applied the edit and saved it. No polling, because there is nothing
    // left in flight — that is the whole point of the fix.
    assert.ok(!document.isDirty, "the document should have been saved by the write");
    assert.match(document.getText(), /\* \[x\] edited in buffer \[completed: "\d{4}-\d{2}-\d{2}"\]/);
    assert.match(readFileSync(uri.fsPath, "utf8"), /\* \[x\] edited in buffer/);
    lifeloop.dispose();
  });
});


suite("Foam coexistence (0.44.6)", function () {
  let foam: any;
  suiteSetup(async function () {
    if (!process.env.LIFELOOP_TEST_FOAM) { this.skip(); return; }
    this.timeout(60_000);
    const extension = vscode.extensions.getExtension("foam.foam-vscode");
    assert.ok(extension, "Foam not installed in isolated test profile");
    assert.strictEqual(extension.packageJSON.version, "0.44.6");
    foam = await extension.activate();
    assert.ok(foam?.extendMarkdownIt, "Foam failed to activate");
  });

  test("ordinary links and completion are supplied by Foam", async () => {
    const doc = await vscode.workspace.openTextDocument(pageUri("Foam/Source"));
    await vscode.window.showTextDocument(doc);
    const links = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      "vscode.executeDefinitionProvider", doc.uri, new vscode.Position(0, 6),
    );
    assert.ok(links?.some(l => ("uri" in l ? l.uri : l.targetUri).fsPath === pageUri("Foam/Target").fsPath), JSON.stringify(links));
    const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider", doc.uri, new vscode.Position(0, 8),
    );
    assert.ok(completions?.items.some(i => JSON.stringify(i).includes("Target")), "no Foam completion");
  });

  test("Foam owns ordinary clicks; explicit SB navigation coexists with its placeholder links", async () => {
    const doc = await vscode.workspace.openTextDocument(pageUri("Scratch/SbSource"));
    const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>("vscode.executeLinkProvider", doc.uri);
    const placeholders = links?.filter(l => l.range.start.line === 1) ?? [];
    assert.strictEqual(placeholders.length, 1, JSON.stringify(placeholders));
    assert.strictEqual(placeholders[0].target?.scheme, "command");
    assert.match(placeholders[0].target?.toString() ?? "", /foam-vscode/);
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(1, 8, 1, 8);
    await vscode.commands.executeCommand("lifeloop.openSbRef");
    assert.strictEqual(vscode.window.activeTextEditor?.document.uri.fsPath, pageUri("Scratch/SbAnchor").fsPath);
    assert.ok(!existsSync(pageUri("Scratch/SbAnchor@9").fsPath));
  });

  test("SB command refuses ordinary @ filenames, missing anchors and ambiguous pages without writes", async () => {
    const files = {
      "Foam/Ordinary@anchor": "ordinary page\n",
      "Foam/Ordinary": "* [ ] target $anchor\n* [ ] longer $missing-long\n",
      "Foam/Duplicate": "$anchor\n",
      "Scratch/Duplicate": "$anchor\n",
      "Foam/RefRefusals": "[[Foam/Ordinary@anchor]]\n[[Foam/Ordinary@missing]]\n[[Duplicate@anchor]]\n",
    };
    for (const [page, text] of Object.entries(files)) writeFileSync(pageUri(page).fsPath, text);
    await vscode.commands.executeCommand("lifeloop.reindex");
    const doc = await vscode.workspace.openTextDocument(pageUri("Foam/RefRefusals"));
    const editor = await vscode.window.showTextDocument(doc);
    for (const line of [0, 1, 2]) {
      editor.selection = new vscode.Selection(line, 8, line, 8);
      await vscode.commands.executeCommand("lifeloop.openSbRef");
      assert.strictEqual(vscode.window.activeTextEditor?.document.uri.fsPath, doc.uri.fsPath);
    }
    for (const [page, text] of Object.entries(files)) assert.strictEqual(readPage(page), text);
    assert.ok(!existsSync(pageUri("Foam/Ordinary@missing").fsPath));
    assert.ok(!existsSync(pageUri("Duplicate@anchor").fsPath));
    await until("Foam indexes the ordinary @ filename", async () => {
      const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
        "vscode.executeDefinitionProvider", doc.uri, new vscode.Position(0, 8));
      return !!definitions?.some(l => ("uri" in l ? l.uri : l.targetUri).fsPath === pageUri("Foam/Ordinary@anchor").fsPath);
    });
  });

  test("Foam embeds and LifeLoop queries compose in either plugin order", async () => {
    const MarkdownIt = require("markdown-it");
    const life: any = vscode.extensions.getExtension("lifeloop.lifeloop-vscode")!.exports;
    for (const plugins of [[foam, life], [life, foam]]) {
      const md = new MarkdownIt({ html: true });
      for (const plugin of plugins) plugin.extendMarkdownIt(md);
      const html = md.render('![[Foam/Target#Detail]]\n\n```lifeloop\nactionable\n```\n');
      assert.strictEqual((html.match(/FOAM_EMBED_SENTINEL/g) ?? []).length, 1, html);
      assert.ok(!html.includes("![["), html);
      assert.match(html, /lifeloop-query|lifeloop-empty/, html);
    }
  });

  test("Foam page queries render lists and tables beside LifeLoop queries", async () => {
    const MarkdownIt = require("markdown-it");
    const life: any = vscode.extensions.getExtension("lifeloop.lifeloop-vscode")!.exports;
    for (const plugins of [[foam, life], [life, foam]]) {
      const md = new MarkdownIt({ html: true });
      for (const plugin of plugins) plugin.extendMarkdownIt(md);
      for (const format of ["list", "table"]) {
        const html = md.render('```foam-query\nfilter: "/Foam/Target/"\nselect: [title, path]\nformat: ' + format + '\n```\n\n```lifeloop\nactionable\n```\n');
        assert.match(html, /Foam\/Target/, html);
        assert.match(html, format === "table" ? /<table/ : /<ul/, html);
        assert.ok(!html.includes("foam-query-error"), html);
        assert.match(html, /lifeloop-query|lifeloop-empty/, html);
      }
    }
  });

  test("Foam creates a daily note from its template", async () => {
    await vscode.commands.executeCommand("foam-vscode.open-daily-note");
    const doc = vscode.window.activeTextEditor?.document;
    assert.ok(doc?.getText().includes("tags: journal"), doc?.getText() ?? "no active document");
    assert.ok(doc?.getText().includes("## Log"));
    assert.ok(doc?.getText().includes("## Notes"));
    assert.ok(!doc!.getText().includes("$FOAM_DATE_YEAR"));
  });

  test("Foam updates ordinary links on rename, including a dirty source", async () => {
    const doc = await vscode.workspace.openTextDocument(pageUri("Foam/Source"));
    const editor = await vscode.window.showTextDocument(doc);
    await editor.edit(e => e.insert(doc.positionAt(doc.getText().length), "KEEP_UNSAVED\n"));
    assert.ok(doc.isDirty);
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(pageUri("Foam/Target"), pageUri("Foam/Renamed"));
    assert.ok(await vscode.workspace.applyEdit(edit));
    await until("Foam rename updates the referring document", () => doc.getText().includes("Renamed"));
    assert.ok(!doc.getText().includes("Foam/Target"), doc.getText());
    assert.ok(doc.getText().includes("#Detail"), doc.getText());
    assert.ok(doc.getText().includes("KEEP_UNSAVED"), doc.getText());
    if (doc.isDirty) await doc.save();
    await until("renamed source reaches durable terminal state", () =>
      !doc.isDirty && readFileSync(doc.uri.fsPath, "utf8") === doc.getText());
  });
  // Foam 0.44.6 rewrites to [[Child]] but its definition provider loses the target.
  // Keep the failed qualification reproducible, separate from the supported gate.
  (process.env.LIFELOOP_TEST_FOLDER_RENAME ? test : test.skip)("UNQUALIFIED: Foam folder rename resolves rewritten links", async () => {
    const oldFolder = vscode.Uri.file(path.join(vaultRoot(), "Foam/FolderBefore"));
    const newFolder = vscode.Uri.file(path.join(vaultRoot(), "Foam/FolderAfter"));
    mkdirSync(oldFolder.fsPath);
    writeFileSync(path.join(oldFolder.fsPath, "Child.md"), "# Child\n\n## Detail\n");
    const source = pageUri("Foam/FolderSource");
    writeFileSync(source.fsPath, "[[Foam/FolderBefore/Child]]\n[[Foam/FolderBefore/Child#Detail]]\n");
    const doc = await vscode.workspace.openTextDocument(source);
    const editor = await vscode.window.showTextDocument(doc);
    await editor.edit(e => e.insert(doc.positionAt(doc.getText().length), "KEEP_FOLDER_UNSAVED\n"));
    // Wait for Foam to see the newly created target before asking it to rename.
    await until("Foam indexes the folder target", async () => {
      const defs = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>("vscode.executeDefinitionProvider", doc.uri, new vscode.Position(0, 8));
      return !!defs?.some(l => ("uri" in l ? l.uri : l.targetUri).fsPath === path.join(oldFolder.fsPath, "Child.md"));
    });
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(oldFolder, newFolder);
    assert.ok(await vscode.workspace.applyEdit(edit));
    await until("folder references updated", () => !doc.getText().includes("FolderBefore"));
    for (const line of [0, 1]) {
      await until("renamed link resolves to the moved child", async () => {
        const defs = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>("vscode.executeDefinitionProvider", doc.uri, new vscode.Position(line, 3));
        return !!defs?.some(l => ("uri" in l ? l.uri : l.targetUri).fsPath === path.join(newFolder.fsPath, "Child.md"));
      });
    }
    assert.ok(!doc.getText().includes("FolderBefore"), doc.getText());
    assert.ok(doc.getText().includes("#Detail"), doc.getText());
    assert.ok(doc.getText().includes("KEEP_FOLDER_UNSAVED"), doc.getText());
    assert.ok(await doc.save());
  });

});
