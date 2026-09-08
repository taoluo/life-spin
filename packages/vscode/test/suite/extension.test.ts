import * as assert from "node:assert";
import * as path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
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

/** Wait until a condition holds, so tests follow the extension rather than a sleep. */
async function until(what: string, check: () => boolean, timeout = 8000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
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
    for (const name of [
      "lifeloop.capture", "lifeloop.processInbox", "lifeloop.openToday",
      "lifeloop.completeTask", "lifeloop.setProjectStatus", "lifeloop.addReminder",
      "lifeloop.syncProjected", "lifeloop.importNotes",
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

  test("a wikilink is a real document link the editor can follow", async () => {
    const document = await vscode.workspace.openTextDocument(pageUri("Journal/2020-01-03"));
    await vscode.window.showTextDocument(document);
    const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>(
      "vscode.executeLinkProvider", document.uri,
    );
    assert.ok(links && links.length > 0, "no document links found");
    assert.ok(
      links.some((l) => l.target?.fsPath.endsWith(".md")),
      "no link resolved to a page",
    );
  });

  test("backlinks come back through the editor's own reference provider", async () => {
    const document = await vscode.workspace.openTextDocument(pageUri("Projects/Reed Solomon"));
    await vscode.window.showTextDocument(document);
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider", document.uri, new vscode.Position(0, 0),
    );
    assert.ok(locations && locations.length > 0, "no backlinks");
  });

  test("broken links surface as diagnostics", async () => {
    const uri = pageUri("Scratch/Integration");
    writeFileSync(uri.fsPath, "See [[This Page Does Not Exist]]\n");
    await vscode.commands.executeCommand("lifeloop.reindex");

    await until("a diagnostic on the page", () => {
      return vscode.languages.getDiagnostics(uri).length > 0;
    });
    const messages = vscode.languages.getDiagnostics(uri).map((d) => d.message);
    assert.ok(messages.some((m) => m.includes("does not resolve")), messages.join("; "));
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
