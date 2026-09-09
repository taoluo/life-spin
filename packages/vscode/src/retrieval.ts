import * as vscode from "vscode";
import {
  birthday, cadence, day, directPersonLinks, extractLiveItems, nextBirthday, originalSourceOffset,
  pageDate, pageMetaFor, pageObject, pathOf, people, personContext, projectionNames, projections, relationshipDate,
  relationshipProjectionNames, resolveRef, TASK_MARKER, validPageName,
  type RelationshipProjectionName,
} from "@lifeloop/semantic-core";
import type { LifeLoop } from "./workspace.ts";
import { findLocatedQueryFences, queryBodyContains, type QueryToken } from "./query-language.ts";
import { taskTargetAt } from "./task-target.ts";
import { parseMarkdown } from "../../../vendor/silverbullet/client/markdown_parser/parser.ts";
import { collectNodesOfType, findNodeOfType, type ParseTree } from "../../../vendor/silverbullet/plug-api/lib/tree.ts";

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

const exactPageExists = (lifeloop: LifeLoop, page: string): boolean => {
  try {
    if (!validPageName(page)) return false;
    return lifeloop.vault.exists(pathOf(page));
  } catch { return false; }
};

const exactPerson = (lifeloop: LifeLoop, person: string): boolean => {
  try {
    if (!exactPageExists(lifeloop, person)) return false;
    const path = pathOf(person);
    const page = pageObject(lifeloop.vault.read(path), pageMetaFor(person));
    return (page.itags as string[] | undefined)?.includes("person") === true;
  } catch { return false; }
};

type LocatedInteraction = {
  attribute: QueryToken;
  value: QueryToken;
  kind: string;
  lineFrom: number;
  lineTo: number;
  reasons: string[];
};

const deepNodesOfType = (tree: ParseTree, type: string): ParseTree[] => [
  ...(tree.type === type ? [tree] : []),
  ...(tree.children?.flatMap((child) => deepNodesOfType(child, type)) ?? []),
];

/** One live classifier shared by diagnostics, hover, and symbols. */
function locatedInteractions(lifeloop: LifeLoop, text: string, page?: string): LocatedInteraction[] {
  let date: string | null = null;
  if (page) {
    try { date = pageDate(pageObject(text, pageMetaFor(page))); } catch { /* invalid page metadata */ }
  }
  const found: LocatedInteraction[] = [];
  const items = extractLiveItems(text, pageMetaFor(page ?? ""), lifeloop.taskStates);
  const itemNodes = deepNodesOfType(parseMarkdown(text), "ListItem");
  for (const item of items) {
    const interaction = item.interaction;
    if (item.tag !== "item" || item.inComment === true || typeof interaction !== "string") continue;
    const [parsedFrom, parsedTo] = (item.range as [number, number] | undefined) ?? [0, 0];
    const node = itemNodes.find((candidate) => candidate.from === parsedFrom && candidate.to === parsedTo);
    const owner = node?.children?.find((child) => child.type === "Paragraph" || child.type === "Task");
    const attribute = owner && collectNodesOfType(owner, "Attribute").filter((candidate) =>
      findNodeOfType(candidate, "AttributeName")?.children?.[0].text === "interaction").at(-1);
    const value = attribute && findNodeOfType(attribute, "AttributeValue");
    if (attribute?.from === undefined || attribute.to === undefined || value?.from === undefined || value.to === undefined) continue;
    const attributeFrom = originalSourceOffset(text, attribute.from);
    const attributeTo = originalSourceOffset(text, attribute.to - 1) + 1;
    const valueFrom = originalSourceOffset(text, value.from);
    const valueTo = value.to === value.from ? valueFrom : originalSourceOffset(text, value.to - 1) + 1;
    const lineFrom = text.lastIndexOf("\n", Math.max(0, attributeFrom - 1)) + 1;
    const newline = text.indexOf("\n", attributeFrom);
    const lineTo = newline < 0 ? text.length : newline - (text[newline - 1] === "\r" ? 1 : 0);
    const linked = ((item.links as string[] | undefined) ?? []).filter((person) => exactPerson(lifeloop, person));
    const reasons = [
      ...(!interaction.trim() ? ["empty Interaction kind is excluded"] : []),
      ...(!date ? ["Interaction is excluded because the page has no trustworthy Journal date"] : []),
      ...(!linked.length ? ["Interaction is excluded because it has no direct Person link"] : []),
    ];
    found.push({
      attribute: { text: text.slice(attributeFrom, attributeTo), from: attributeFrom, to: attributeTo },
      value: { text: interaction, from: valueFrom, to: valueTo },
      kind: interaction.trim(), lineFrom, lineTo, reasons,
    });
  }
  return found;
}

/** LifeLoop-owned definitions only: query Person values and explicit SB refs. */
export function definitions(lifeloop: LifeLoop): vscode.DefinitionProvider {
  return {
    provideDefinition(document, position) {
      const text = document.getText();
      const offset = document.offsetAt(position);
      const fence = findLocatedQueryFences(text).find((candidate) =>
        queryBodyContains(candidate, offset));
      const projection = fence?.query.projection?.text;
      const ownsPerson = relationshipProjectionNames.includes(projection as any) &&
        (projections[projection as RelationshipProjectionName].allowedArgs ?? []).includes("person");
      const person = ownsPerson && fence?.query.options.find((option) =>
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
      try {
        const at = ref.lastIndexOf("@");
        if (at < 0 || exactPageExists(lifeloop, ref)) return undefined;
        const page = resolveTarget(lifeloop, ref.slice(0, at));
        if (!page) return undefined;
        const source = resolveRef(lifeloop.vault, `${page}${ref.slice(at)}`);
        if ("ok" in source) return undefined;
        const target = positionAt(source.text, source.offset);
        return new vscode.Location(lifeloop.pageUri(page), new vscode.Range(target, target));
      } catch { return undefined; }
    },
  };
}

const diagnostic = (
  text: string,
  token: Pick<QueryToken, "from" | "to">,
  message: string,
  severity: vscode.DiagnosticSeverity,
) => new vscode.Diagnostic(
  new vscode.Range(positionAt(text, token.from), positionAt(text, token.to)),
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
        if (!option.value.text.trim()) {
          error(option.key, "limit must be non-empty");
          continue;
        }
        const limit = Number(option.value.text);
        if (!Number.isInteger(limit) || limit < 0) {
          error(option.value, "limit must be a non-negative integer");
        }
        continue;
      }
      if (key === "fields") {
        if (!option.value.text.trim()) {
          error(option.key, "fields must be non-empty");
          continue;
        }
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
      if (!option.value.text.trim()) {
        error(option.key, `${key} must be non-empty`);
        continue;
      }
      if ((key === "date" || key === "from" || key === "to") &&
          !(key === "date" && option.value.text === "today") &&
          !relationshipDate(option.value.text)) {
        error(option.value, `${key} must be an ISO date`);
      }
      if (key === "person" && includeIdentity && !people(lifeloop.store)
        .some((person) => person.ref === option.value.text)) {
        error(option.value, `no such Person page: ${option.value.text}`);
      }
    }
    const values = new Map(query.options.map((option) => [option.key.text, option]));
    if (name === "person-context" && !values.has("person")) {
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
      for (const [field, valid] of [["birthday", birthday], ["contact-every", cadence]] as const) {
        if (pageObjectValue[field] === undefined || valid(pageObjectValue[field]) !== undefined) continue;
        const located = frontmatterField(text, field);
        if (!located) continue;
        const message = `${field} is ignored because its value is invalid`;
        if (located.value.text.trim()) info(located.value, message);
        else error(located.key, message);
      }
      const days = cadence(pageObjectValue["contact-every"]);
      const context = days && includeIdentity ? personContext(lifeloop.store, page) : null;
      const located = frontmatterField(text, "contact-every");
      if (located && context && context.cadenceDays === days && context.lastInteraction && !context.reconnectOn) {
        info(located.value, "reconnect date cannot be represented and is ignored");
      }
    }

    for (const interaction of locatedInteractions(lifeloop, text, page)) {
      for (const reason of interaction.reasons) info(interaction.value, reason);
    }
  }
  return found;
}

const frontmatterField = (text: string, field: string): { key: QueryToken; value: QueryToken } | undefined => {
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text)?.[0];
  if (!frontmatter) return undefined;
  const match = new RegExp(`^${field}:[ \\t]*(.*?)[ \\t]*$`, "m").exec(frontmatter);
  if (!match) return undefined;
  const value = /^(.*?)[ \\t]+#.*$/.exec(match[1])?.[1].trimEnd() ?? match[1];
  const from = match.index + match[0].indexOf(match[1]);
  return {
    key: { text: field, from: match.index, to: match.index + field.length },
    value: { text: value, from, to: from + value.length },
  };
};

const markdown = (value: string, range: vscode.Range): vscode.Hover => {
  const contents = new vscode.MarkdownString(value);
  contents.isTrusted = false;
  contents.supportHtml = false;
  return new vscode.Hover(contents, range);
};

const escaped = (value: string): string => value.replace(/([\\`*_[\]<>#])/g, "\\$1");

/** LifeLoop-owned relationship semantics only; query and ordinary link hover stay elsewhere. */
export function relationshipHovers(lifeloop: LifeLoop): vscode.HoverProvider {
  return {
    provideHover(document, position) {
      const text = document.getText();
      const offset = document.offsetAt(position);
      if (findLocatedQueryFences(text).some((fence) => queryBodyContains(fence, offset)) ||
          [...text.matchAll(/\[\[[^\]]+\]\]/g)].some((link) =>
            offset >= link.index! && offset < link.index! + link[0].length)) return undefined;

      let page: string | undefined;
      try { page = lifeloop.pageNameOfUri(document.uri); } catch { /* untitled */ }
      const interaction = locatedInteractions(lifeloop, text, page).find((entry) =>
        offset >= entry.attribute.from && offset < entry.attribute.to);
      if (interaction) {
        const range = new vscode.Range(
          positionAt(text, interaction.attribute.from), positionAt(text, interaction.attribute.to),
        );
        return markdown(interaction.reasons.length
          ? `**Interaction excluded:** ${interaction.reasons.map(escaped).join("; ")}.`
          : `**Interaction:** ${escaped(interaction.kind)} counts as an Interaction.`, range);
      }

      if (page) {
        let livePage;
        try { livePage = pageObject(text, pageMetaFor(page)); } catch { livePage = undefined; }
        if (livePage && (livePage.itags as string[] | undefined)?.includes("person")) {
          const born = frontmatterField(text, "birthday")?.value;
          if (born && offset >= born.from && offset <= born.to) {
            const value = birthday(livePage.birthday);
            const next = value ? nextBirthday(value, day()) : undefined;
            if (next) {
              return markdown(`**Birthday:** ${escaped(value!)} · next ${next}`,
                new vscode.Range(positionAt(text, born.from), positionAt(text, born.to)));
            }
          }
          const cadenceToken = frontmatterField(text, "contact-every")?.value;
          if (cadenceToken && offset >= cadenceToken.from && offset <= cadenceToken.to && lifeloop.indexIsSettled()) {
            const days = cadence(livePage["contact-every"]);
            const context = days ? personContext(lifeloop.store, page) : null;
            if (context && context.cadenceDays === days) {
              const last = context.lastInteraction?.date ?? "none recorded";
              const reconnect = context.reconnectOn ?? "none yet";
              const due = !context.lastInteraction || (context.reconnectOn !== undefined && context.reconnectOn <= day());
              return markdown(
                `**Contact cadence:** ${days} days  \nLast explicit interaction: ${last}  \nReconnect: ${reconnect} · ${due ? "due" : "not due"}`,
                new vscode.Range(positionAt(text, cadenceToken.from), positionAt(text, cadenceToken.to)),
              );
            }
          }
        }
      }

      if (!lifeloop.indexIsSettled() || document.uri.scheme !== "file") return undefined;
      const line = document.lineAt(position.line).text;
      const marker = TASK_MARKER.exec(line);
      const inMarker = marker && position.character >= marker[1].length - 1 &&
        position.character < marker[0].length;
      const inAttribute = [...line.matchAll(/\[[A-Za-z][\w-]*:\s*(?:"[^"\r\n]*"|[^\]\r\n]*)\]/g)]
        .some((attribute) => position.character >= attribute.index! &&
          position.character < attribute.index! + attribute[0].length);
      if (!inMarker && !inAttribute) return undefined;
      let target;
      try { target = taskTargetAt(lifeloop, document, position.line); } catch { return undefined; }
      if (!target?.task) return undefined;
      const direct = directPersonLinks(lifeloop.store, target.task);
      const personPages = new Set(people(lifeloop.store).map((person) => String(person.ref)));
      const inherited = [...new Set(((target.task.ilinks as string[] | undefined) ?? [])
        .filter((person) => personPages.has(person) && !direct.includes(person)))];
      const range = document.lineAt(position.line).range;
      return markdown(
        `**Task relationships**  \nDirect People: ${direct.map(escaped).join(", ") || "none"}  \nInherited-only People: ${inherited.map(escaped).join(", ") || "none"}`,
        range,
      );
    },
  };
}

type FixToken = QueryToken & { role: "projection" | "option" | "field"; replacement: string };

const canonicalSpelling = (values: readonly string[], value: string): string | undefined =>
  values.find((candidate) => candidate !== value && candidate.toLowerCase() === value.toLowerCase());

/** Tokens whose replacement is uniquely determined by the relationship contract. */
function fixTokens(text: string): FixToken[] {
  const found: FixToken[] = [];
  for (const fence of findLocatedQueryFences(text)) {
    const projection = fence.query.projection;
    if (!projection) continue;
    const projectionFix = canonicalSpelling(relationshipProjectionNames, projection.text);
    if (projectionFix) {
      found.push({ ...projection, role: "projection", replacement: projectionFix });
      continue;
    }
    if (!(relationshipProjectionNames as readonly string[]).includes(projection.text)) continue;
    const name = projection.text as RelationshipProjectionName;
    const keys = [...(projections[name].allowedArgs ?? []), "fields", "limit"].map(String);
    for (const option of fence.query.options) {
      const keyFix = canonicalSpelling(keys, option.key.text);
      if (keyFix) found.push({ ...option.key, role: "option", replacement: keyFix });
      if (option.key.text !== "fields") continue;
      const fields = (projections[name].fields ?? []).map(String);
      for (const field of option.fields) {
        const fieldFix = canonicalSpelling(fields, field.text);
        if (fieldFix) found.push({ ...field, role: "field", replacement: fieldFix });
      }
    }
  }
  return found;
}

type DiagnosticFix = {
  uri: vscode.Uri;
  range: vscode.Range;
  version: number;
  expectedText: string;
  token: Pick<FixToken, "role" | "from" | "to" | "text">;
  replacement: string;
};

const emptyCommandAction = (
  title: string,
  command: string,
  argument: unknown,
  kind?: vscode.CodeActionKind,
): vscode.CodeAction => {
  const action = new vscode.CodeAction(title, kind);
  action.edit = new vscode.WorkspaceEdit();
  action.command = { title, command, arguments: [argument] };
  return action;
};

/** Task commands plus deterministic relationship-spelling fixes; never an eager edit. */
export function codeActions(lifeloop: LifeLoop): vscode.CodeActionProvider {
  return {
    async provideCodeActions(document, range, context) {
      const text = document.getText();
      const actions: vscode.CodeAction[] = [];
      for (const token of fixTokens(text)) {
        const diagnostics = context.diagnostics.filter((item) =>
          document.offsetAt(item.range.start) === token.from && document.offsetAt(item.range.end) === token.to);
        if (!diagnostics.length || token.to < document.offsetAt(range.start) || token.from > document.offsetAt(range.end)) continue;
        const tokenRange = new vscode.Range(positionAt(text, token.from), positionAt(text, token.to));
        const receipt: DiagnosticFix = {
          uri: document.uri,
          range: tokenRange,
          version: document.version,
          expectedText: token.text,
          token: { role: token.role, from: token.from, to: token.to, text: token.text },
          replacement: token.replacement,
        };
        const action = emptyCommandAction(
          `Change to ${token.replacement}`, "lifeloop.applyDiagnosticFix", receipt, vscode.CodeActionKind.QuickFix,
        );
        action.diagnostics = diagnostics;
        actions.push(action);
      }

      if (document.uri.scheme !== "file") return actions;
      try { await lifeloop.currentTaskStates(); } catch { return actions; }
      let target;
      try { target = taskTargetAt(lifeloop, document, range.start.line); } catch { return actions; }
      if (!target?.task) return actions;
      const input = { handle: target.handle };
      const taskAction = (title: string, command: string) =>
        actions.push(emptyCommandAction(title, command, input));
      taskAction(target.task.done === true ? "Reopen" : "Complete",
        target.task.done === true ? "lifeloop.reopenTask" : "lifeloop.completeTask");
      taskAction("Toggle Waiting", "lifeloop.toggleWaiting");
      taskAction("Toggle Someday", "lifeloop.toggleSomeday");
      taskAction("Set Deadline", "lifeloop.setDeadline");
      taskAction("Set Scheduled", "lifeloop.setScheduled");
      const linkedPeople = directPersonLinks(lifeloop.store, target.task);
      if (linkedPeople.length) {
        taskAction("Log Interaction", "lifeloop.logInteraction");
        if ([...target.line.matchAll(/\[event:\s*"[^"\r\n]+"\]/g)].length === 1) {
          taskAction("Open Pre-meeting Brief", "lifeloop.preMeetingBrief");
        }
      }
      return actions;
    },
  };
}

const isFix = (value: unknown): value is DiagnosticFix => {
  if (!value || typeof value !== "object") return false;
  const fix = value as any;
  const token = fix.token;
  const start = fix.range?.start;
  const end = fix.range?.end;
  return typeof fix.uri?.toString === "function" && Number.isInteger(fix.version) && fix.version >= 0 &&
    typeof fix.expectedText === "string" && typeof fix.replacement === "string" &&
    token && ["projection", "option", "field"].includes(token.role) &&
    Number.isInteger(token.from) && Number.isInteger(token.to) && token.from >= 0 && token.to >= token.from &&
    typeof token.text === "string" && Number.isInteger(start?.line) && start.line >= 0 &&
    Number.isInteger(start?.character) && start.character >= 0 && Number.isInteger(end?.line) && end.line >= 0 &&
    Number.isInteger(end?.character) && end.character >= 0;
};

/** Revalidate every diagnostic receipt before applying its one deterministic replacement. */
export async function applyDiagnosticFix(input: unknown): Promise<boolean> {
  const stale = () => {
    void vscode.window.showWarningMessage("LifeLoop: that diagnostic changed; nothing was edited");
    return false;
  };
  if (!isFix(input)) return stale();
  const document = await vscode.workspace.openTextDocument(input.uri);
  if (document.languageId !== "markdown" || document.version !== input.version) return stale();
  const text = document.getText();
  if (document.offsetAt(input.range.start) !== input.token.from ||
      document.offsetAt(input.range.end) !== input.token.to ||
      text.slice(input.token.from, input.token.to) !== input.expectedText ||
      input.expectedText !== input.token.text) return stale();
  const current = fixTokens(text).find((token) =>
    token.role === input.token.role && token.from === input.token.from && token.to === input.token.to &&
    token.text === input.token.text && token.replacement === input.replacement);
  if (!current) return stale();
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, input.range, input.replacement);
  if (!(await vscode.workspace.applyEdit(edit))) return stale();
  return true;
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
      const text = document.getText();
      const items = extractLiveItems(text, pageMetaFor(page), lifeloop.taskStates);
      const tasks = items.filter((item) => item.tag === "task" && item.inComment !== true);

      const taskSymbols = tasks.map((task) => {
        const [from] = (task.range as [number, number] | undefined) ?? [0, 0];
        const start = document.positionAt(originalSourceOffset(text, from));
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

      let journal = page.startsWith("Journal/");
      try {
        journal ||= (pageObject(text, pageMetaFor(page)).itags as string[] | undefined)?.includes("journal") === true;
      } catch { /* malformed frontmatter is not a Journal declaration */ }
      const interactionSymbols = journal ? locatedInteractions(lifeloop, text, page).map((interaction) => {
        const range = new vscode.Range(
          positionAt(text, interaction.lineFrom), positionAt(text, interaction.lineTo),
        );
        const selection = new vscode.Range(
          positionAt(text, interaction.attribute.from), positionAt(text, interaction.attribute.to),
        );
        return new vscode.DocumentSymbol(
          interaction.kind || "(empty Interaction)",
          interaction.reasons.length ? `excluded · ${interaction.reasons.join("; ")}` : "counted Interaction",
          vscode.SymbolKind.Event,
          range,
          selection,
        );
      }) : [];
      return [...taskSymbols, ...interactionSymbols];
    },
  };
}
