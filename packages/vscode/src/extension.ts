import * as vscode from "vscode";
import { assertRuntime } from "@lifeloop/semantic-core";
import { LifeLoop } from "./workspace.ts";
import { TodayView, ProjectsView, InboxView, BacklinksView, MentionsView } from "./views.ts";
import {
  documentLinks, completion, references, publishDiagnostics, documentSymbols,
} from "./retrieval.ts";
import { register } from "./commands.ts";
import { registerApple } from "./apple.ts";
import { extendMarkdownIt } from "./preview.ts";
import { codeLenses, hovers, registerQueryCommands } from "./query-lens.ts";
import { registerLua, renderSpaceLua, renderExpression, renderSpaceStyle } from "./lua.ts";
import { register as registerSlash } from "./slash.ts";
import { register as registerMentions } from "./mentions.ts";
import { register as registerXray } from "./xray.ts";
import { register as registerPickers } from "./pickers.ts";
import { register as registerDecorations } from "./decoration.ts";

let lifeloop: LifeLoop | undefined;

/**
 * The extension's public surface.
 *
 * `extendMarkdownIt` is what lets a fenced query render in the built-in Markdown
 * preview — the same contribution point Mermaid and KaTeX use. It runs in the
 * extension host, so it can query the store directly.
 */
export type LifeLoopApi = { extendMarkdownIt: (md: unknown) => unknown };

export async function activate(context: vscode.ExtensionContext): Promise<LifeLoopApi> {
  // Returned even when there is no workspace: the preview hook must exist, and it
  // reports "still indexing" rather than being absent.
  const api: LifeLoopApi = { extendMarkdownIt: extendMarkdownIt(() => lifeloop, renderSpaceLua, renderExpression, renderSpaceStyle) as any };

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return api;

  // Fail with a sentence someone can act on, rather than deep inside an indexer.
  try {
    assertRuntime();
  } catch (error) {
    void vscode.window.showErrorMessage(`LifeLoop: ${(error as Error).message}`);
    return api;
  }

  // Indexing happens in the background: the window must be usable before the
  // vault is understood, not after.
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = "$(sync~spin) LifeLoop: indexing";
  status.show();

  lifeloop = await LifeLoop.open(folder.uri.fsPath);
  context.subscriptions.push(lifeloop);

  status.text = "$(check) LifeLoop";
  status.command = "lifeloop.capture";
  status.tooltip = "LifeLoop: Capture";
  context.subscriptions.push(status);

  const markdown: vscode.DocumentSelector = { language: "markdown", scheme: "file" };
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(markdown, documentLinks(lifeloop)),
    vscode.languages.registerCompletionItemProvider(markdown, completion(lifeloop), "[", "#"),
    vscode.languages.registerReferenceProvider(markdown, references(lifeloop)),
    vscode.languages.registerDocumentSymbolProvider(markdown, documentSymbols(lifeloop)),
    // A query block gets a count and an action above it, and its table on hover.
    // The preview shows the same answer rendered in place; all three call the
    // same projection.
    vscode.languages.registerCodeLensProvider(markdown, codeLenses(() => lifeloop)),
    vscode.languages.registerHoverProvider(markdown, hovers(() => lifeloop)),
  );
  registerQueryCommands(() => lifeloop, context);
  registerLua(() => lifeloop, context);
  registerSlash(() => lifeloop, context);
  registerMentions(() => lifeloop, context);
  registerXray(() => lifeloop, context);
  registerPickers(() => lifeloop, context);
  registerDecorations(() => lifeloop, context);

  const diagnostics = vscode.languages.createDiagnosticCollection("lifeloop");
  context.subscriptions.push(diagnostics);
  const refreshDiagnostics = () => publishDiagnostics(lifeloop!, diagnostics);

  const views = {
    "lifeloop.today": new TodayView(lifeloop),
    "lifeloop.projects": new ProjectsView(lifeloop),
    "lifeloop.inbox": new InboxView(lifeloop),
    "lifeloop.backlinks": new BacklinksView(lifeloop),
    "lifeloop.mentions": new MentionsView(lifeloop),
  };
  for (const [id, provider] of Object.entries(views)) {
    context.subscriptions.push(vscode.window.registerTreeDataProvider(id, provider));
  }

  register(lifeloop, context);
  registerApple(lifeloop, context);
  lifeloop.onDidChange(refreshDiagnostics);
  refreshDiagnostics();

  // Follow the buffer rather than the file: a view that only updates on save is
  // wrong for as long as the editor is dirty, which is most of the time.
  let pendingReindex: NodeJS.Timeout | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId !== "markdown") return;
      clearTimeout(pendingReindex);
      pendingReindex = setTimeout(() => {
        void lifeloop!.touch(event.document.uri, event.document.getText());
      }, 400);
    }),
    vscode.workspace.onDidDeleteFiles((event) => {
      for (const uri of event.files) lifeloop!.forget(uri);
    }),
    vscode.workspace.onDidCreateFiles(() => void lifeloop!.reindex()),
    vscode.workspace.onDidRenameFiles(() => void lifeloop!.reindex()),
  );

  return api;
}

export function deactivate(): void {
  lifeloop?.dispose();
  lifeloop = undefined;
}
