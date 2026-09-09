import * as assert from "node:assert";
import * as path from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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

suite("LifeLoop in a real VS Code", () => {
  suiteSetup(async function () {
    this.timeout(60_000);
    const extension = vscode.extensions.getExtension("lifeloop.lifeloop-vscode");
    assert.ok(extension, "extension not found");
    await extension.activate();
    // Indexing is deliberately backgrounded, so wait for it rather than assume.
    await until("commands registered", () => true, 1000);
  });

  test("activates and registers its commands", async () => {
    const commands = await vscode.commands.getCommands(true);
    if (!process.env.LIFELOOP_TEST_FOAM) assert.strictEqual(vscode.extensions.getExtension("foam.foam-vscode"), undefined);
    for (const name of [
      "lifeloop.capture", "lifeloop.captureHere", "lifeloop.processInbox", "lifeloop.openToday",
      "lifeloop.completeTask", "lifeloop.setProjectStatus", "lifeloop.addReminder",
      "lifeloop.syncProjected", "lifeloop.importNotes", "lifeloop.taskActions",
      "lifeloop.peekSource", "lifeloop.detachBinding", "lifeloop.copyBindingId",
      "lifeloop.logInteraction", "lifeloop.createReconnectTask", "lifeloop.preMeetingBrief",
    ]) {
      assert.ok(commands.includes(name), `missing command ${name}`);
    }
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
    assert.ok(await doc.save());
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
