import * as vscode from "vscode";
import {
  birthday, cadence, pageDate, pageMetaFor, pageObject, pathOf, people,
  projectionNames, projections, relationshipDate, relationshipProjectionNames, resolveRef,
  type RelationshipProjectionName,
} from "@lifeloop/semantic-core";
import type { LifeLoop } from "./workspace.ts";
import { findLocatedQueryFences, type QueryToken } from "./query-language.ts";

// Only LifeLoop semantic diagnostics and SB special refs live here. Foam owns generic PKM.

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

const positionAt = (text: string, offset: number): vscode.Position => {
  const before = text.slice(0, offset).split("\n");
  return new vscode.Position(before.length - 1, before.at(-1)!.length);
};

const exactPerson = (lifeloop: LifeLoop, person: string): boolean => {
  const path = pathOf(person);
  if (!lifeloop.vault.exists(path)) return false;
  try {
    const page = pageObject(lifeloop.vault.read(path), pageMetaFor(person));
    return (page.itags as string[] | undefined)?.includes("person") === true;
  } catch { return false; }
};

/** LifeLoop-owned definitions only: query Person values and explicit SB refs. */
export function definitions(lifeloop: LifeLoop): vscode.DefinitionProvider {
  return {
    provideDefinition(document, position) {
      const text = document.getText();
      const offset = document.offsetAt(position);
      const fence = findLocatedQueryFences(text).find((candidate) =>
        offset >= candidate.bodyFrom && offset <= candidate.bodyTo);
      const person = fence?.query.options.find((option) =>
        option.key.text === "person" && offset >= option.value.from && offset <= option.value.to);
      if (person && exactPerson(lifeloop, person.value.text)) {
        return new vscode.Location(
          lifeloop.pageUri(person.value.text),
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
        );
      }

      const link = [...text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)]
        .find((match) => offset >= match.index! && offset < match.index! + match[0].length);
      const ref = link?.[1].trim() ?? "";
      const at = ref.lastIndexOf("@");
      if (at < 0 || lifeloop.vault.exists(pathOf(ref))) return undefined;
      const page = resolveTarget(lifeloop, ref.slice(0, at));
      if (!page) return undefined;
      const source = resolveRef(lifeloop.vault, `${page}${ref.slice(at)}`);
      if ("ok" in source) return undefined;
      const target = positionAt(source.text, source.offset);
      return new vscode.Location(lifeloop.pageUri(page), new vscode.Range(target, target));
    },
  };
}

const diagnostic = (
  text: string,
  token: Pick<QueryToken, "from" | "to">,
  message: string,
  severity: vscode.DiagnosticSeverity,
) => new vscode.Diagnostic(
  new vscode.Range(positionAt(text, token.from), positionAt(text, Math.max(token.from + 1, token.to))),
  message,
  severity,
);

/** Immediate lexical relationship diagnostics plus optional settled-index identity checks. */
export function relationshipDiagnostics(
  lifeloop: LifeLoop,
  text: string,
  page: string | undefined,
  includeIdentity: boolean,
): vscode.Diagnostic[] {
  const found: vscode.Diagnostic[] = [];
  const error = (token: QueryToken, message: string) =>
    found.push(diagnostic(text, token, message, vscode.DiagnosticSeverity.Error));
  const info = (token: QueryToken, message: string) =>
    found.push(diagnostic(text, token, message, vscode.DiagnosticSeverity.Information));

  for (const fence of findLocatedQueryFences(text)) {
    const query = fence.query;
    if (!query.projection) continue;
    if (!projectionNames.includes(query.projection.text as any)) {
      error(query.projection, `unknown relationship projection: ${query.projection.text}`);
      continue;
    }
    if (!(relationshipProjectionNames as readonly string[]).includes(query.projection.text)) continue;
    const name = query.projection.text as RelationshipProjectionName;
    const allowed = projections[name].allowedArgs ?? [];
    for (const malformed of query.malformed) error(malformed, "expected key: value");
    for (const option of query.options) {
      const key = option.key.text;
      if (key === "limit") {
        const limit = Number(option.value.text);
        if (!Number.isInteger(limit) || limit < 0) {
          error(option.value, "limit must be a non-negative integer");
        }
        continue;
      }
      if (key === "fields") {
        const known = projections[name].fields ?? [];
        for (const field of option.fields) {
          if (!known.includes(field.text)) error(field, `unknown field for ${name}: ${field.text}`);
        }
        continue;
      }
      if (!allowed.includes(key as any)) {
        error(option.key, `unknown option for ${name}: ${key}`);
        continue;
      }
      if ((key === "date" || key === "from" || key === "to") &&
          !(key === "date" && option.value.text === "today") &&
          !relationshipDate(option.value.text)) {
        error(option.value, `${key} must be an ISO date`);
      }
      if (key === "kind" && !option.value.text.trim()) error(option.key, "kind must be non-empty");
      if (key === "person" && includeIdentity && !people(lifeloop.store)
        .some((person) => person.ref === option.value.text)) {
        error(option.value, `no such Person page: ${option.value.text}`);
      }
    }
    const values = new Map(query.options.map((option) => [option.key.text, option]));
    if (name === "person-context" && !values.get("person")?.value.text) {
      error(query.projection, "person-context requires person");
    }
    const from = values.get("from");
    const to = values.get("to");
    if (from && to && relationshipDate(from.value.text) && relationshipDate(to.value.text) &&
        from.value.text > to.value.text) error(to.value, "to is before from");
  }

  if (page) {
    let pageObjectValue;
    try { pageObjectValue = pageObject(text, pageMetaFor(page)); } catch { pageObjectValue = undefined; }
    if (pageObjectValue && (pageObjectValue.itags as string[] | undefined)?.includes("person")) {
      const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text)?.[0] ?? "";
      for (const [field, valid] of [["birthday", birthday], ["contact-every", cadence]] as const) {
        if (pageObjectValue[field] === undefined || valid(pageObjectValue[field]) !== undefined) continue;
        const match = new RegExp(`^${field}:\\s*(.*?)\\s*$`, "m").exec(frontmatter);
        if (match) {
          const from = match.index + match[0].indexOf(match[1]);
          info({ text: match[1], from, to: from + match[1].length },
            `${field} is ignored because its value is invalid`);
        }
      }
    }

    const date = pageObjectValue ? pageDate(pageObjectValue) : null;
    for (const match of text.matchAll(/\[interaction:\s*(?:"([^"\r\n]*)"|([^\]\r\n]*))\]/g)) {
      const lineStart = text.lastIndexOf("\n", Math.max(0, match.index! - 1)) + 1;
      const lineEnd = text.indexOf("\n", match.index!);
      const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd).replace(/\r$/, "");
      if (!/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) continue;
      const raw = match[1] ?? match[2] ?? "";
      const valueFrom = match.index! + (match[1] !== undefined
        ? match[0].indexOf('"') + 1
        : match[0].indexOf(":") + 1 + (match[0].slice(match[0].indexOf(":") + 1).match(/^\s*/)?.[0].length ?? 0));
      const value = { text: raw, from: valueFrom, to: valueFrom + raw.length };
      if (!raw.trim()) { info(value, "empty Interaction kind is excluded"); continue; }
      if (!date) info(value, "Interaction is excluded because the page has no trustworthy Journal date");
      const linked = [...line.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)]
        .map((link) => link[1].trim()).some((person) => exactPerson(lifeloop, person));
      if (!linked) info(value, "Interaction is excluded because it has no direct Person link");
    }
  }
  return found;
}

/** Explicit SB navigation: Foam's ordinary click can offer to create page@anchor. */
export async function openSbRef(lifeloop: LifeLoop): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "markdown") return;
  const line = editor.document.lineAt(editor.selection.active.line).text;
  const column = editor.selection.active.character;
  const match = [...line.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)]
    .find(m => column >= m.index! && column < m.index! + m[0].length);
  const ref = match?.[1].trim() ?? "";
  const at = ref.lastIndexOf("@");
  const page = at < 0 || resolveTarget(lifeloop, ref) ? null : resolveTarget(lifeloop, ref.slice(0, at));
  if (!page) {
    void vscode.window.showWarningMessage("LifeLoop: put the cursor in an unambiguous SB [[page@anchor]] or [[page@position]] reference.");
    return;
  }
  const source = resolveRef(lifeloop.vault, `${page}${ref.slice(at)}`);
  if ("ok" in source) {
    void vscode.window.showWarningMessage(`LifeLoop: ${source.message}`);
    return;
  }
  const document = await vscode.workspace.openTextDocument(lifeloop.pageUri(page));
  const target = await vscode.window.showTextDocument(document);
  const position = document.positionAt(source.offset);
  target.selection = new vscode.Selection(position, position);
  target.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

/** Task/project validation. Ordinary link diagnostics belong to Foam. */
export function publishDiagnostics(
  lifeloop: LifeLoop,
  collection: vscode.DiagnosticCollection,
  live?: vscode.TextDocument,
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
      `${kind}: compatibility is limited; execution depends on settings and supported APIs. ${detail}`,
      vscode.DiagnosticSeverity.Information,
    );
  }

  const sources = new Map<string, string>();
  for (const path of lifeloop.vault.list()) {
    if (!path.endsWith(".md")) continue;
    try { sources.set(path.slice(0, -3), lifeloop.vault.read(path)); } catch { /* disappeared */ }
  }
  if (live) {
    try { sources.set(lifeloop.pageNameOfUri(live.uri), live.getText()); } catch { /* untitled */ }
  }
  for (const [page, text] of sources) {
    const list = byPage.get(page) ?? [];
    list.push(...relationshipDiagnostics(lifeloop, text, page, lifeloop.indexIsSettled()));
    if (list.length) byPage.set(page, list);
  }

  collection.clear();
  for (const [page, diagnostics] of byPage) {
    collection.set(lifeloop.pageUri(page), diagnostics);
  }
  if (live) {
    try { lifeloop.pageNameOfUri(live.uri); }
    catch {
      collection.set(live.uri, relationshipDiagnostics(
        lifeloop, live.getText(), undefined, lifeloop.indexIsSettled(),
      ));
    }
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
