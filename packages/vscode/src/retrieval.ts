import * as vscode from "vscode";
import { brokenLinks, backlinks } from "@lifeloop/semantic-core";
import type { LifeLoop } from "./workspace.ts";

/**
 * Retrieval (1.1–1.6), and the rule that shapes all of it: compose the VS Code
 * primitive where one exists (I7).
 *
 * Full-text search is ripgrep's and fuzzy file open is quick open's — neither is
 * rebuilt here. What the index adds is the part VS Code cannot know: that
 * `[[Reed Solomon]]` means a page, that a page has aliases, and which links
 * resolve to nothing.
 */

const WIKILINK = /\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/g;

/** Resolve a link target the way the index does — by basename, not by literal path. */
export function resolveTarget(lifeloop: LifeLoop, target: string): string | null {
  const paths = lifeloop.vault.list();
  const exact = `${target}.md`;
  if (paths.includes(exact)) return target;
  const base = target.toLowerCase();
  const matches = paths.filter((p) => {
    const name = p.replace(/\.md$/, "");
    return name.toLowerCase().endsWith(`/${base}`) || name.toLowerCase() === base;
  });
  // More than one match is ambiguous, and guessing is how the wrong page opens.
  return matches.length === 1 ? matches[0].replace(/\.md$/, "") : null;
}

/** 1.1 — ctrl-click a wikilink. */
export function documentLinks(lifeloop: LifeLoop): vscode.DocumentLinkProvider {
  return {
    provideDocumentLinks(document) {
      const text = document.getText();
      const links: vscode.DocumentLink[] = [];
      for (const match of text.matchAll(WIKILINK)) {
        const target = match[1].trim();
        const page = resolveTarget(lifeloop, target);
        const start = document.positionAt(match.index! + 2);
        const end = document.positionAt(match.index! + 2 + match[1].length);
        const link = new vscode.DocumentLink(new vscode.Range(start, end));
        link.target = lifeloop.pageUri(page ?? target);
        link.tooltip = page ? `Open ${page}` : `Create ${target}`;
        links.push(link);
      }
      return links;
    },
  };
}

/** 1.2 — wikilink and tag completion from the index. */
export function completion(lifeloop: LifeLoop): vscode.CompletionItemProvider {
  return {
    provideCompletionItems(document, position) {
      const line = document.lineAt(position).text.slice(0, position.character);

      const wiki = /\[\[([^\]]*)$/.exec(line);
      if (wiki) {
        return lifeloop.vault.list().map((path) => {
          const page = path.replace(/\.md$/, "");
          const item = new vscode.CompletionItem(page, vscode.CompletionItemKind.File);
          item.insertText = page;
          item.detail = "page";
          return item;
        });
      }

      const tag = /#([\w/-]*)$/.exec(line);
      if (tag) {
        const seen = new Set(lifeloop.store.objects("tag").map((t) => String(t.name ?? t.ref)));
        return [...seen].sort().map((name) => {
          const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
          item.detail = "tag";
          return item;
        });
      }
      return undefined;
    },
  };
}

/** 1.3 — Shift+F12 on a page gives its backlinks, in the editor's own UI. */
export function references(lifeloop: LifeLoop): vscode.ReferenceProvider {
  return {
    provideReferences(document) {
      const page = lifeloop.pageNameOfUri(document.uri);
      return backlinks(lifeloop.store, page).map((relation) => {
        const uri = lifeloop.pageUri(String(relation.page));
        const [from] = (relation.range as [number, number] | undefined) ?? [0, 0];
        return new vscode.Location(uri, new vscode.Position(lineOf(lifeloop, relation.page, from), 0));
      });
    },
  };
}

function lineOf(lifeloop: LifeLoop, page: unknown, offset: number): number {
  try {
    const text = lifeloop.vault.read(`${String(page)}.md`);
    return text.slice(0, offset).split("\n").length - 1;
  } catch {
    return 0;
  }
}

/**
 * 1.6 — broken-link diagnostics.
 *
 * Reports and never fixes. A link to a page that does not exist yet is not
 * necessarily a mistake — it is how a page gets created here — so this is an
 * Information, not a Warning, and it says only what it measured.
 */
export function publishDiagnostics(
  lifeloop: LifeLoop,
  collection: vscode.DiagnosticCollection,
): void {
  const byPage = new Map<string, vscode.Diagnostic[]>();

  const add = (page: string, offset: number, length: number, message: string,
               severity: vscode.DiagnosticSeverity) => {
    let text: string;
    try { text = lifeloop.vault.read(`${page}.md`); } catch { return; }
    const before = text.slice(0, offset).split("\n");
    const line = before.length - 1;
    const character = before[before.length - 1].length;
    const range = new vscode.Range(line, character, line, character + length);
    const list = byPage.get(page) ?? [];
    list.push(new vscode.Diagnostic(range, message, severity));
    byPage.set(page, list);
  };

  for (const link of brokenLinks(lifeloop.store)) {
    const [from, to] = (link.range as [number, number] | undefined) ?? [0, 0];
    add(String(link.page), from, Math.max(1, to - from),
        `[[${link.name ?? link.ref}]] does not resolve to a page`,
        vscode.DiagnosticSeverity.Information);
  }

  // 1.14's checks: what LifeLoop itself promised, not whether the vault is tidy.
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  for (const task of lifeloop.store.objects("task")) {
    const [from] = (task.range as [number, number] | undefined) ?? [0, 0];
    for (const field of ["deadline", "scheduled", "completed"]) {
      const value = task[field];
      if (typeof value === "string" && !DATE.test(value)) {
        add(String(task.page), from, 1, `[${field}: "${value}"] is not a YYYY-MM-DD date`,
            vscode.DiagnosticSeverity.Warning);
      }
    }
  }
  const STATES = new Set(["active", "paused", "completed", "archived"]);
  for (const page of lifeloop.store.objects("page")) {
    if (!(page.itags as string[] | undefined)?.includes("project")) continue;
    const status = page.status;
    if (status !== undefined && (typeof status !== "string" || !STATES.has(status))) {
      add(String(page.ref), 0, 1,
          `status: ${String(status)} is not one of active, paused, completed, archived`,
          vscode.DiagnosticSeverity.Warning);
    }
  }

  /**
   * Blocks SilverBullet would run, and we do not.
   *
   * We index `space-lua` and `space-style` — the vendored indexers produce them —
   * and then ignore them. A vault that came from SilverBullet therefore arrives
   * with working code in it that silently stops working, which makes the README's
   * "the vault *is* the migration" true of notes and not quite true of scripts.
   *
   * Information, not a warning: nothing is wrong with the block. What is wrong is
   * expecting it to run. Saying so is also how the decision about *whether* to
   * execute Space Lua gets made on evidence — the message names which host APIs
   * the script actually uses, and `LifeLoop: Report Unsupported Blocks` counts
   * them across the vault.
   */
  for (const block of [...lifeloop.store.objects("space-lua"), ...lifeloop.store.objects("space-style")]) {
    const ref = String(block.ref ?? "");
    const page = ref.slice(0, ref.lastIndexOf("@"));
    const [from, to] = (block.range as [number, number] | undefined) ?? [0, 1];
    const kind = block.tag === "space-lua" ? "Space Lua" : "Space Style";
    const detail = block.tag === "space-lua"
      ? describeScript(String(block.script ?? ""))
      : "custom CSS for SilverBullet's editor";
    add(
      page, from, Math.max(1, Math.min(to - from, 80)),
      `${kind}: SilverBullet runs this block; LifeLoop indexes it but does not execute it. ${detail}`,
      vscode.DiagnosticSeverity.Information,
    );
  }

  collection.clear();
  for (const [page, diagnostics] of byPage) {
    collection.set(lifeloop.pageUri(page), diagnostics);
  }
}

/**
 * What a Space Lua script would need from a host, classified **per method**.
 *
 * The first version of this classified by *namespace*, and it was wrong in a way
 * worth recording: it put all of `editor.*` in "no equivalent", which made
 * SilverBullet's own docs look 11-blocks-unportable. Inspecting the actual calls
 * says otherwise — the only editor methods used anywhere are `flashNotification`
 * and `navigate`, and both are one line of VS Code. A coarse measurement produced
 * a confident conclusion in the wrong direction.
 *
 * Four buckets, because "portable or not" is not enough:
 *
 *   stdlib     `string.*`, `table.*`, `math.*` — plain Lua, already vendored
 *   portable   a VS Code host can provide this
 *   editorBound  needs SilverBullet's editor model; no VS Code equivalent
 *   unknown    not classified — reported as unknown rather than silently "none"
 */
const STDLIB = new Set(["string", "table", "math", "os", "io", "coroutine", "utf8", "debug"]);

const PORTABLE_METHODS = new Set([
  // Notifications and navigation map to one VS Code call each.
  "editor.flashNotification", "editor.navigate", "editor.open", "editor.prompt",
  "editor.confirm", "editor.alert", "editor.filterBox", "editor.getText",
  "editor.getCurrentPage", "editor.invokeCommand", "editor.copyToClipboard",
  "editor.showProgress", "editor.hideProgress", "editor.save", "editor.openUrl",
  // Data and content.
  "space.readPage", "space.writePage", "space.listPages", "space.writeFile",
  "space.readFile", "space.deletePage",
  "index.tasks", "index.links", "index.queryLuaObjects", "index.has",
  "config.set", "config.get",
  "template.each", "template.new",
  "tag.define", "schema.array", "schema.null", "schema.object", "schema.string",
  "net.proxyFetch",
  "system.invokeFunction", "system.getConfig",
]);

const EDITOR_BOUND_METHODS = new Set([
  // Panel slots, CodeMirror transactions and in-editor widget placement.
  "editor.showPanel", "editor.hidePanel", "editor.getFocusedPanelSlot",
  "editor.dispatch", "editor.rebuildEditorState", "editor.reloadUI",
  "editor.vimEx", "editor.configureVimMode", "editor.isMobile", "editor.fold",
  "editor.unfold", "editor.toggleFold", "editor.forceLint",
  // Custom task states are refused by DESIGN.md regardless of host support.
  "taskState.define",
  // Extension points that only mean something inside SilverBullet's runtime.
  "service.define", "syntax.define", "js.import", "mq.subscribe",
]);

/**
 * `widget.*` and `dom.*` are the interesting middle.
 *
 * They build a rendered block, which SilverBullet places *inside the editor* and
 * VS Code cannot. But the content itself is exactly what our query blocks already
 * render — in the Markdown preview, a hover and a CodeLens. So the capability
 * exists and the *placement* does not, which is a different answer from "no".
 */
const REPLACED_METHODS = new Set(["widget.html", "widget.new", "widget.refreshAll", "dom"]);

export type ScriptNeeds = {
  stdlib: string[];
  portable: string[];
  editorBound: string[];
  replaced: string[];
  unknown: string[];
};

export function scriptNamespaces(script: string): ScriptNeeds {
  const needs: ScriptNeeds = {
    stdlib: [], portable: [], editorBound: [], replaced: [], unknown: [],
  };
  const seen = new Set<string>();

  for (const m of script.matchAll(/\b([a-zA-Z][a-zA-Z0-9_]*)\.([a-zA-Z][a-zA-Z0-9_]*)\s*[({]/g)) {
    const [, namespace, method] = m;
    const call = `${namespace}.${method}`;
    if (seen.has(call)) continue;
    seen.add(call);

    if (STDLIB.has(namespace)) needs.stdlib.push(call);
    else if (REPLACED_METHODS.has(call) || REPLACED_METHODS.has(namespace)) needs.replaced.push(call);
    else if (PORTABLE_METHODS.has(call)) needs.portable.push(call);
    else if (EDITOR_BOUND_METHODS.has(call)) needs.editorBound.push(call);
    else needs.unknown.push(call);
  }
  return needs;
}

function describeScript(script: string): string {
  const needs = scriptNamespaces(script);
  const parts: string[] = [];
  if (needs.portable.length) parts.push(`${needs.portable.length} call(s) a VS Code host could provide`);
  if (needs.replaced.length) {
    parts.push(`${needs.replaced.length} building a widget — LifeLoop renders query blocks in the preview instead`);
  }
  if (needs.editorBound.length) {
    parts.push(`${needs.editorBound.length} tied to SilverBullet's editor (${needs.editorBound.join(", ")})`);
  }
  if (needs.unknown.length) parts.push(`${needs.unknown.length} unclassified (${needs.unknown.slice(0, 3).join(", ")})`);
  if (!parts.length) {
    return needs.stdlib.length
      ? "It is plain Lua and calls no host API."
      : "It calls no host API.";
  }
  return `It has ${parts.join("; ")}.`;
}

/**
 * Tasks in the Outline view.
 *
 * VS Code already outlines Markdown headings — the built-in extension provides
 * that — so this adds the one thing it cannot know about: which lines are tasks,
 * nested under the heading they live beneath. Symbol providers compose, so both
 * appear rather than one replacing the other.
 */
export function documentSymbols(lifeloop: LifeLoop): vscode.DocumentSymbolProvider {
  return {
    provideDocumentSymbols(document) {
      const page = lifeloop.pageNameOfUri(document.uri);
      const tasks = lifeloop.store
        .objects("task")
        .filter((t) => t.page === page && t.inComment !== true);

      return tasks.map((task) => {
        const [from] = (task.range as [number, number] | undefined) ?? [0, 0];
        const start = document.positionAt(Math.min(from, document.getText().length));
        const range = document.lineAt(start.line).range;
        const symbol = new vscode.DocumentSymbol(
          String(task.name ?? "").trim() || "(empty task)",
          [
            task.done ? "done" : "open",
            typeof task.deadline === "string" ? `due ${task.deadline}` : "",
          ].filter(Boolean).join("  ·  "),
          task.done ? vscode.SymbolKind.Event : vscode.SymbolKind.Field,
          range,
          range,
        );
        return symbol;
      });
    },
  };
}

/** 1.5 — alias-aware open, over page names and headings. */
export async function openPage(lifeloop: LifeLoop): Promise<void> {
  type Item = vscode.QuickPickItem & { page: string; offset?: number };
  const items: Item[] = lifeloop.vault.list().map((path) => ({
    label: path.replace(/\.md$/, ""),
    description: "page",
    page: path.replace(/\.md$/, ""),
  }));
  for (const header of lifeloop.store.objects("header")) {
    const [from] = (header.range as [number, number] | undefined) ?? [0, 0];
    items.push({
      label: String(header.name ?? ""),
      description: `# in ${header.page}`,
      page: String(header.page),
      offset: from,
    });
  }

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Open a page or heading",
    matchOnDescription: true,
  });
  if (!picked) return;

  const document = await vscode.workspace.openTextDocument(lifeloop.pageUri(picked.page));
  const editor = await vscode.window.showTextDocument(document);
  if (picked.offset !== undefined) {
    const position = document.positionAt(picked.offset);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }
}
