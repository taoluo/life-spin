/**
 * The smallest VS Code surface the extension actually touches.
 *
 * Enough to exercise view construction, provider logic and command wiring in
 * plain vitest. What genuinely needs a real host — activation, the tree widget,
 * the editor — is not faked here, because a fake that deep tests the fake.
 */
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
  file: (fsPath: string) => ({ fsPath, toString: () => `file://${fsPath}` }),
  parse: (value: string) => ({ scheme: value.split(":")[0], toString: () => value }),
};
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
  onDidDeleteFiles: () => ({ dispose: () => {} }),
  onDidCreateFiles: () => ({ dispose: () => {} }),
  onDidRenameFiles: () => ({ dispose: () => {} }),
  applyEdit: async () => true,
  openTextDocument: async () => ({}),
};
export const window = {
  registerFileDecorationProvider: () => ({ dispose: () => {} }),
  createTextEditorDecorationType: () => ({ dispose: () => {} }),
  onDidChangeVisibleTextEditors: () => ({ dispose: () => {} }),
  visibleTextEditors: [] as any[],
  activeTextEditor: undefined as any,
  onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
  showQuickPick: async () => undefined,
  showInputBox: async () => undefined,
  showWarningMessage: async (m: string) => { (window as any).lastWarning = m; },
  showErrorMessage: async (m: string) => { (window as any).lastError = m; },
  setStatusBarMessage: () => ({ dispose: () => {} }),
  showTextDocument: async () => ({}),
  createStatusBarItem: () => ({ show() {}, dispose() {}, text: "", command: "", tooltip: "" }),
  registerTreeDataProvider: () => ({ dispose: () => {} }),
};
export const languages = {
  registerDocumentSymbolProvider: () => ({ dispose: () => {} }),
  registerCodeLensProvider: () => ({ dispose: () => {} }),
  registerHoverProvider: () => ({ dispose: () => {} }),
  registerDocumentLinkProvider: () => ({ dispose: () => {} }),
  registerCompletionItemProvider: () => ({ dispose: () => {} }),
  registerReferenceProvider: () => ({ dispose: () => {} }),
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
