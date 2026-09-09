import * as vscode from "vscode";
import {
  INTERACTION_KINDS, people, projectionNames, projections, relationshipProjectionNames,
  type ProjectionArgs, type RelationshipProjectionName,
} from "@lifeloop/semantic-core";
import { runQueryBlock, toMarkdown, parseQueryBlock } from "./preview.ts";
import type { LifeLoop } from "./workspace.ts";
import { findLocatedQueryFences } from "./query-language.ts";

/**
 * The same query, in the editor, on two surfaces that are good at different things.
 *
 *   CodeLens  a single line of plain text. No Markdown, no wrapping, no table —
 *             `Command.title` is a `string`. So it shows a *count* and an action.
 *   Hover     a full `MarkdownString`, which renders tables, lists and links in a
 *             floating panel with its own scrollbar. So it shows the *table*.
 *
 * Choosing one would have meant either a table nobody can read or a count nobody
 * can act on. They are not redundant: the count is visible without doing anything,
 * and the table costs a hover.
 *
 * All three surfaces — these two and the preview — call `runQueryBlock`. None of
 * them decides what a query means, which is Phase 3's rule about clients not
 * inventing their own filters, applied inside a single client.
 */

export type QueryFence = { range: vscode.Range; source: string; open: number };

/** Every LifeLoop query block in a document, with the lines it spans. */
export function findQueryFences(document: vscode.TextDocument): QueryFence[] {
  return findLocatedQueryFences(document.getText()).map((fence) => ({
    range: new vscode.Range(fence.openLine, 0, fence.closeLine, fence.closeLength),
    source: fence.source,
    open: fence.openLine,
  }));
}

const completion = (label: string, kind: vscode.CompletionItemKind, insertText = label) => {
  const item = new vscode.CompletionItem(label, kind);
  item.insertText = insertText;
  return item;
};

export function queryCompletions(lifeloop: () => LifeLoop | undefined): vscode.CompletionItemProvider {
  return {
    provideCompletionItems(document, position) {
      const instance = lifeloop();
      if (!instance) return [];
      const text = document.getText();
      const offset = document.offsetAt(position);
      const fence = findLocatedQueryFences(text).find((candidate) =>
        offset >= candidate.bodyFrom && offset <= candidate.bodyTo);
      if (!fence) return [];

      const lineStart = text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
      const lineEnd = text.indexOf("\n", offset);
      const projection = fence.query.projection;
      if (!projection || (projection.from >= lineStart && projection.from <= (lineEnd < 0 ? text.length : lineEnd))) {
        return projectionNames.map((name) => completion(name, vscode.CompletionItemKind.Keyword));
      }
      if (!(relationshipProjectionNames as readonly string[]).includes(projection.text)) return [];

      const before = text.slice(lineStart, offset);
      const colon = before.indexOf(":");
      const name = projection.text as RelationshipProjectionName;
      if (colon < 0) {
        return [...(projections[name].allowedArgs ?? []), "fields", "limit"]
          .map((key) => completion(String(key), vscode.CompletionItemKind.Keyword, `${String(key)}: `));
      }

      const key = /^\s*([A-Za-z]+)\s*:/.exec(before)?.[1] as keyof ProjectionArgs | "fields" | "limit" | undefined;
      if (!key) return [];
      if (key === "kind") {
        return INTERACTION_KINDS.map((kind) => completion(kind, vscode.CompletionItemKind.Keyword));
      }
      if (key === "fields") {
        return (projections[name].fields ?? [])
          .map((field) => completion(field, vscode.CompletionItemKind.Keyword));
      }
      if (key === "person" && (projections[name].allowedArgs ?? []).includes("person") && instance.indexIsSettled()) {
        return people(instance.store)
          .map((person) => String(person.ref)).sort()
          .map((person) => completion(person, vscode.CompletionItemKind.User));
      }
      return [];
    },
  };
}

const summarise = (lifeloop: LifeLoop, source: string): string => {
  const outcome = runQueryBlock(lifeloop, source);
  if (!outcome.ok) return `$(warning) ${outcome.error.split("—")[0].trim()}`;
  const parsed = parseQueryBlock(source);
  const name = "error" in parsed ? "query" : parsed.projection;
  const n = outcome.rows.length;
  return `$(list-flat) ${name}: ${n} ${n === 1 ? "result" : "results"}`;
};

export function codeLenses(lifeloop: () => LifeLoop | undefined): vscode.CodeLensProvider {
  const changed = new vscode.EventEmitter<void>();
  return {
    onDidChangeCodeLenses: changed.event,
    provideCodeLenses(document) {
      const instance = lifeloop();
      if (!instance) return [];
      // Off-switch, because a count above every block is exactly the kind of
      // decoration some people find noisy — and the hover still works without it.
      if (!vscode.workspace.getConfiguration("lifeloop").get("queryCodeLens", true)) return [];
      return findQueryFences(document).flatMap((fence) => [
        // A count, visible without any interaction.
        new vscode.CodeLens(fence.range, {
          command: "lifeloop.openQueryResult",
          title: summarise(instance, fence.source),
          arguments: [fence.source],
        }),
        // And the way out for anything too big to hover over.
        new vscode.CodeLens(fence.range, {
          command: "lifeloop.openQueryResult",
          title: "$(open-preview) Open",
          arguments: [fence.source],
        }),
      ]);
    },
  };
}

export function hovers(lifeloop: () => LifeLoop | undefined): vscode.HoverProvider {
  return {
    provideHover(document, position) {
      const instance = lifeloop();
      if (!instance) return undefined;
      const fence = findQueryFences(document).find((f) =>
        position.line >= f.range.start.line && position.line <= f.range.end.line,
      );
      if (!fence) return undefined;

      const outcome = runQueryBlock(instance, fence.source);
      const markdown = new vscode.MarkdownString(toMarkdown(outcome));
      // The table is built from vault text, so it must not be able to inject
      // commands or HTML into the hover.
      markdown.isTrusted = false;
      markdown.supportHtml = false;
      return new vscode.Hover(markdown, fence.range);
    },
  };
}

/** Open a query's full result as a throwaway Markdown document. */
export function registerQueryCommands(
  lifeloop: () => LifeLoop | undefined,
  context: vscode.ExtensionContext,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("lifeloop.openQueryResult", async (source: string) => {
      const instance = lifeloop();
      if (!instance) return;
      const outcome = runQueryBlock(instance, source);
      const parsed = parseQueryBlock(source);
      const heading = "error" in parsed ? "Query" : parsed.projection;

      // A virtual document, not a webview: it is Markdown, so the preview, search
      // and copy all work, and nothing is written to the vault.
      const document = await vscode.workspace.openTextDocument({
        content: `# ${heading}\n\n${toMarkdown(outcome)}\n`,
        language: "markdown",
      });
      await vscode.window.showTextDocument(document, { preview: true });
    }),
  );
}
