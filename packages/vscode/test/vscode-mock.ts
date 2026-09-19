/**
 * The smallest VS Code surface the extension actually touches.
 *
 * Enough to exercise view construction, provider logic and command wiring in
 * plain vitest. What genuinely needs a real host — activation, the tree widget,
 * the editor — is not faked here, because a fake that deep tests the fake.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export enum TreeItemCollapsibleState { None = 0, Collapsed = 1, Expanded = 2 }
export enum CompletionItemKind { File = 16, Keyword = 13, Snippet = 14, User = 25 }
export enum DiagnosticSeverity { Error = 0, Warning = 1, Information = 2, Hint = 3 }

export class ThemeIcon { constructor(public id: string) {} }
export class MarkdownString {
  isTrusted = false;
  supportHtml = false;
  constructor(public value = "") {}
}
export class Position { constructor(public line: number, public character: number) {} }
export class Range {
  constructor(public start: any, public end?: any, public c?: number, public d?: number) {
    if (typeof start === "number") {
      this.start = new Position(start, end as number);
      this.end = new Position(c as number, d as number);
    }
  }
}
export class Selection extends Range {}
export class WorkspaceEdit {
  edits: { uri: any; range?: any; content: string; create?: boolean }[] = [];
  replace(uri: any, range: any, content: string): void {
    this.edits.push({ uri, range, content });
  }
  createFile(uri: any, options?: { contents?: Uint8Array }): void {
    this.edits.push({
      uri,
      content: options?.contents ? new TextDecoder().decode(options.contents) : "",
      create: true,
    });
  }
}
export class Location { constructor(public uri: any, public range: any) {} }
export class DocumentSymbol {
  children: DocumentSymbol[] = [];
  constructor(
    public name: string, public detail: string, public kind: number,
    public range: any, public selectionRange: any,
  ) {}
}
export const SymbolKind = { Field: 7, Event: 23 };
export class CodeLens { constructor(public range: any, public command?: any) {} }
export class Hover { constructor(public contents: any, public range?: any) {} }
export class DocumentLink { constructor(public range: any, public target?: any) {} }
export class SnippetString { constructor(public value = "") {} }
export class CompletionItem {
  insertText?: string | SnippetString; detail?: string;
  documentation?: any; range?: any; sortText?: string; command?: any;
  constructor(public label: string, public kind?: CompletionItemKind) {}
}
export class Diagnostic {
  constructor(public range: any, public message: string, public severity?: DiagnosticSeverity) {}
}
export class CodeAction {
  edit?: WorkspaceEdit; command?: any; diagnostics?: Diagnostic[];
  constructor(public title: string, public kind?: any) {}
}
export const CodeActionKind = { QuickFix: "quickfix" };
export class TreeItem {
  description?: string; tooltip?: any; iconPath?: any; contextValue?: string; command?: any;
  constructor(public label: string, public collapsibleState?: TreeItemCollapsibleState) {}
}
export class EventEmitter<T> {
  private handlers: ((value: T) => void)[] = [];
  event = (handler: (value: T) => void) => {
    this.handlers.push(handler);
    return { dispose: () => {} };
  };
  fire(value: T) { for (const h of this.handlers) h(value); }
  dispose() { this.handlers = []; }
}
export const Uri = {
  file: (fsPath: string) => ({ scheme: "file", fsPath, toString: () => `file://${fsPath}` }),
  parse: (value: string) => ({
    scheme: value.split(":")[0],
    fsPath: value.startsWith("file://") ? decodeURIComponent(value.slice("file://".length)) : "",
    toString: () => value,
  }),
};
const contentProviders = new Map<string, any>();
const closeDocumentHandlers: ((document: any) => void)[] = [];
export const workspace = {
  textDocuments: [] as any[],
  /** Settings a test wants to pretend the user set: `workspace.settings["lifeloop.identity"]`. */
  settings: {} as Record<string, any>,
  getConfiguration: (section?: string) => ({
    get: (key: string, fallback: any) => {
      const settings = (workspace as any).settings ?? {};
      const full = section ? `${section}.${key}` : key;
      return full in settings ? settings[full] : fallback;
    },
  }),
  asRelativePath: (uri: any, _includeFolder?: boolean) => {
    const root = (workspace as any).root ?? "";
    return String(uri.fsPath ?? uri).replace(`${root}/`, "");
  },
  onDidChangeTextDocument: () => ({ dispose: () => {} }),
  onDidCloseTextDocument: (handler: (document: any) => void) => {
    closeDocumentHandlers.push(handler);
    return { dispose: () => closeDocumentHandlers.splice(closeDocumentHandlers.indexOf(handler), 1) };
  },
  onDidDeleteFiles: () => ({ dispose: () => {} }),
  onDidCreateFiles: () => ({ dispose: () => {} }),
  onDidRenameFiles: () => ({ dispose: () => {} }),
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
  registerTextDocumentContentProvider: (scheme: string, provider: any) => {
    contentProviders.set(scheme, provider);
    return { dispose: () => contentProviders.delete(scheme) };
  },
  __closeTextDocument: (document: any) => {
    document.isClosed = true;
    workspace.textDocuments = workspace.textDocuments.filter((candidate) => candidate !== document);
    for (const handler of [...closeDocumentHandlers]) handler(document);
  },
  applyEdit: async (edit: WorkspaceEdit) => {
    const versions = new Map(edit.edits.map((entry) => [entry,
      workspace.textDocuments.find((candidate) => candidate.uri?.fsPath === entry.uri.fsPath)?.version]));
    await Promise.resolve();
    for (const entry of edit.edits) {
      if (entry.create) {
        if (existsSync(entry.uri.fsPath)) return false;
        continue;
      }
      const document = workspace.textDocuments.find((candidate) => candidate.uri?.fsPath === entry.uri.fsPath);
      const version = versions.get(entry);
      if (document && version !== undefined && document.version !== version) return false;
    }
    for (const entry of edit.edits) {
      if (entry.create) {
        mkdirSync(dirname(entry.uri.fsPath), { recursive: true });
        writeFileSync(entry.uri.fsPath, entry.content);
        continue;
      }
      const document = workspace.textDocuments.find((candidate) => candidate.uri?.fsPath === entry.uri.fsPath);
      document?.__replace?.(entry.content);
    }
    return true;
  },
  openTextDocument: async (uri: any) => {
    const open = workspace.textDocuments.find((document) =>
      uri?.scheme === "file"
        ? document.uri?.fsPath === uri.fsPath
        : document.uri?.toString?.() === uri?.toString?.());
    if (open) return open;
    if (uri?.scheme && uri.scheme !== "file") {
      const provider = contentProviders.get(uri.scheme);
      if (!provider) throw new Error(`no content provider for ${uri.scheme}`);
      let text = await provider.provideTextDocumentContent(uri, {});
      const document: any = {
        uri, languageId: "plaintext", version: 1, isDirty: false, isClosed: false,
        getText: (range?: any) => range
          ? text.slice(document.offsetAt(range.start), document.offsetAt(range.end))
          : text,
        positionAt: (offset: number) => {
          const lines = text.slice(0, offset).split("\n");
          return new Position(lines.length - 1, lines.at(-1)!.length);
        },
        offsetAt: (position: Position) => {
          const lines = text.split("\n");
          return lines.slice(0, position.line).reduce((sum: number, line: string) => sum + line.length + 1, 0) +
            position.character;
        },
      };
      workspace.textDocuments.push(document);
      return document;
    }
    if (!uri?.fsPath) return {};
    let text = readFileSync(uri.fsPath, "utf8");
    const document: any = {
      uri, languageId: "markdown", version: 1, isDirty: false, isClosed: false,
      getText: () => text,
      positionAt: (offset: number) => {
        const lines = text.slice(0, offset).split("\n");
        return new Position(lines.length - 1, lines.at(-1)!.length);
      },
      __replace: (content: string) => {
        text = content;
        document.version++;
        document.isDirty = true;
      },
      save: async () => {
        writeFileSync(uri.fsPath, text);
        document.isDirty = false;
        return true;
      },
    };
    workspace.textDocuments.push(document);
    return document;
  },
};
export const window = {
  registerFileDecorationProvider: () => ({ dispose: () => {} }),
  createTextEditorDecorationType: () => ({ dispose: () => {} }),
  onDidChangeVisibleTextEditors: () => ({ dispose: () => {} }),
  visibleTextEditors: [] as any[],
  activeTextEditor: undefined as any,
  onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
  showQuickPick: async (items?: any, _options?: any): Promise<any> => { await items; return undefined; },
  createQuickPick: () => { throw new Error("test must provide a QuickPick"); },
  showInputBox: async (_options?: any): Promise<string | undefined> => undefined,
  showInformationMessage: async () => undefined,
  showWarningMessage: async (m: string) => { (window as any).lastWarning = m; },
  showErrorMessage: async (m: string) => { (window as any).lastError = m; },
  setStatusBarMessage: () => ({ dispose: () => {} }),
  showTextDocument: async (_document: any, _options?: any): Promise<any> => ({}),
  createStatusBarItem: () => ({ show() {}, dispose() {}, text: "", command: "", tooltip: "" }),
  registerTreeDataProvider: () => ({ dispose: () => {} }),
};
export const env = {
  clipboard: {
    text: "",
    writeText: async (value: string) => { env.clipboard.text = value; },
    readText: async () => env.clipboard.text,
  },
};
export const languages = {
  registerDocumentSymbolProvider: () => ({ dispose: () => {} }),
  registerCodeLensProvider: () => ({ dispose: () => {} }),
  registerHoverProvider: () => ({ dispose: () => {} }),
  registerDocumentLinkProvider: () => ({ dispose: () => {} }),
  registerCompletionItemProvider: () => ({ dispose: () => {} }),
  registerDefinitionProvider: () => ({ dispose: () => {} }),
  registerCodeActionsProvider: () => ({ dispose: () => {} }),
  registerReferenceProvider: () => ({ dispose: () => {} }),
  setTextDocumentLanguage: async (document: any, languageId: string) => {
    for (const handler of [...closeDocumentHandlers]) handler(document);
    document.languageId = languageId;
    return document;
  },
  createDiagnosticCollection: () => {
    const map = new Map<string, any[]>();
    return {
      set: (uri: any, list: any[]) => map.set(String(uri.fsPath), list),
      clear: () => map.clear(),
      dispose: () => {},
      get entries() { return [...map.entries()]; },
    };
  },
};
export const commands = { registerCommand: () => ({ dispose: () => {} }) };
export const StatusBarAlignment = { Left: 1, Right: 2 };
export const TextEditorRevealType = { InCenter: 2 };
