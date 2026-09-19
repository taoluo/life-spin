import * as vscode from "vscode";
import {
  INTERACTION_KINDS, people, projectionNames, projections, relationshipProjectionNames,
  type ProjectionArgs, type RelationshipProjectionName,
} from "@lifeloop/semantic-core";
import { runQueryBlock, toMarkdown, toNavigableMarkdown, parseQueryBlock } from "./preview.ts";
import type { LifeLoop } from "./workspace.ts";
import { findLocatedQueryFences, queryBodyContains } from "./query-language.ts";
import { definitions } from "./retrieval.ts";

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
export const QUERY_RESULT_SCHEME = "lifeloop-result";
export const QUERY_RESULT_LANGUAGE = "lifeloop-result";

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
      if (!text.includes("```") && !text.includes("~~~")) return [];
      const offset = document.offsetAt(position);
      const fence = findLocatedQueryFences(text).find((candidate) =>
        queryBodyContains(candidate, offset));
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

      const option = fence.query.options.find((candidate) =>
        candidate.key.from >= lineStart && candidate.key.from <= offset);
      const key = option?.key.text as keyof ProjectionArgs | "fields" | "limit" | undefined;
      if (!key) return [];
      const allowed = projections[name].allowedArgs ?? [];
      if (key === "kind" && allowed.includes("kind")) {
        return INTERACTION_KINDS.map((kind) => completion(kind, vscode.CompletionItemKind.Keyword));
      }
      if (key === "fields") {
        return (projections[name].fields ?? [])
          .map((field) => completion(field, vscode.CompletionItemKind.Keyword));
      }
      if (key === "person" && allowed.includes("person") && instance.indexIsSettled()) {
        const range = option && new vscode.Range(
          document.positionAt(option.value.from), document.positionAt(option.value.to),
        );
        return people(instance.store)
          .map((person) => String(person.ref)).sort()
          .map((person) => {
            const item = completion(person, vscode.CompletionItemKind.User);
            if (range) item.range = range;
            return item;
          });
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
      const review = /\$\{lifeloop\.review\.\w+\(\)\}/.exec(document.getText());
      const reviewLens = review ? [new vscode.CodeLens(new vscode.Range(
        document.positionAt(review.index), document.positionAt(review.index + review[0].length),
      ), {
        command: "lifeloop.reviewActions",
        title: "$(checklist) Review in place",
      })] : [];
      // This switch controls query counts only; the Review workflow remains
      // reachable from its own live marker.
      if (!vscode.workspace.getConfiguration("lifeloop").get("queryCodeLens", true)) return reviewLens;
      return [...reviewLens, ...findQueryFences(document).flatMap((fence) => [
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
      ])];
    },
  };
}

export function hovers(lifeloop: () => LifeLoop | undefined): vscode.HoverProvider {
  return {
    provideHover(document, position) {
      const instance = lifeloop();
      if (!instance) return undefined;
      const text = document.getText();
      const offset = document.offsetAt(position);
      const located = findLocatedQueryFences(text).find((fence) => queryBodyContains(fence, offset));
      const fence = located && {
        range: new vscode.Range(located.openLine, 0, located.closeLine, located.closeLength),
        source: located.source,
      };
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
  const contents = new Map<string, string>();
  const changingLanguage = new Set<string>();
  let sequence = 0;
  const selector: vscode.DocumentSelector = {
    scheme: QUERY_RESULT_SCHEME,
    language: QUERY_RESULT_LANGUAGE,
  };
  const openResult = async (
    content: string,
    name = "result",
    options?: { preserveFocus?: boolean },
  ) => {
    const uri = vscode.Uri.parse(
      `${QUERY_RESULT_SCHEME}:/${name}-${Date.now()}-${++sequence}.lifeloop-result`,
    );
    const key = uri.toString();
    contents.set(key, content);
    let document = await vscode.workspace.openTextDocument(uri);
    if (document.languageId !== QUERY_RESULT_LANGUAGE) {
      changingLanguage.add(key);
      try {
        document = await vscode.languages.setTextDocumentLanguage(document, QUERY_RESULT_LANGUAGE);
      } finally {
        changingLanguage.delete(key);
      }
    }
    await vscode.window.showTextDocument(
      document,
      options?.preserveFocus ? { preview: true, preserveFocus: true } : { preview: true },
    );
  };
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(QUERY_RESULT_SCHEME, {
      provideTextDocumentContent: (uri) => contents.get(uri.toString()) ??
        "# Query result expired\n\nRun the query again from its source block.\n",
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();
      if (document.uri.scheme === QUERY_RESULT_SCHEME && !changingLanguage.has(key)) {
        contents.delete(key);
      }
    }),
    vscode.languages.registerDocumentLinkProvider(selector, {
      provideDocumentLinks(document) {
        return [...document.getText().matchAll(/\[[^\]\r\n]*\]\(<(file:[^>\r\n]+)>\)/g)]
          .map((match) => new vscode.DocumentLink(
            new vscode.Range(
              document.positionAt(match.index!),
              document.positionAt(match.index! + match[0].length),
            ),
            vscode.Uri.parse(match[1]),
          ));
      },
    }),
    vscode.languages.registerDefinitionProvider(selector, {
      provideDefinition(document, position, token) {
        const instance = lifeloop();
        return instance
          ? definitions(instance).provideDefinition(document, position, token)
          : undefined;
      },
    }),
    vscode.commands.registerCommand("lifeloop.openQueryResult", async (source: string) => {
      const instance = lifeloop();
      if (!instance) return;
      const outcome = runQueryBlock(instance, source);
      const parsed = parseQueryBlock(source);
      const heading = "error" in parsed ? "Query" : parsed.projection;

      await openResult(`# ${heading}\n\n${"error" in parsed
        ? toMarkdown(outcome)
        : toNavigableMarkdown(instance, outcome, parsed.projection)}\n`, "query");
    }),
    vscode.commands.registerCommand("lifeloop.openReadonlyResult", openResult),
  );
}
