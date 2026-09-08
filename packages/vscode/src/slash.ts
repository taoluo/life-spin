import * as vscode from "vscode";
import { allSlashTemplates, substitute, SLASH_TAG, type SlashTemplate } from "@lifeloop/semantic-core";
import type { LifeLoop } from "./workspace.ts";
import { interpolate } from "./preview.ts";
import { renderExpression } from "./lua.ts";

/**
 * Slash commands — `/` in the text, then a name.
 *
 * Upstream implements these with its own completion hook. VS Code already has the
 * primitive: a `CompletionItemProvider` with `/` as a trigger character, returning
 * snippets. So there is no menu here, no key handling and no widget — the host's
 * completion list *is* the menu (I7), which also means it gets fuzzy matching,
 * keyboard navigation and the user's own settings for free.
 *
 * A template's `|^|` becomes the snippet's `$0`, so the cursor lands where the
 * author said it should. That is the difference between a template that saves
 * typing and one that saves typing *and* a click.
 */

/** Pages the index says are slash templates. */
export function slashPages(lifeloop: LifeLoop): string[] {
  return lifeloop.store
    .objects("page")
    .filter((p) => (p.itags as string[] | undefined)?.includes(SLASH_TAG))
    .map((p) => String(p.ref));
}

/**
 * A template body as a VS Code snippet.
 *
 * Everything that is not the cursor marker is escaped: a body can legitimately
 * contain `$`, `}` and `\` — a `${...}` that had no answer, for one — and the
 * snippet engine would otherwise read them as instructions and eat them.
 */
export function toSnippet(body: string): string {
  const escape = (text: string) =>
    text.replace(/\\/g, "\\\\").replace(/\$/g, "\\$").replace(/\}/g, "\\}");
  const at = body.indexOf("|^|");
  if (at === -1) return escape(body);
  return escape(body.slice(0, at)) + "$0" + escape(body.slice(at + 3));
}

/** Substitute dates and any `${...}` the evaluator has an answer for. */
export function fill(body: string, now = new Date()): string {
  return interpolate(substitute(body, now), renderExpression);
}

/**
 * Commands that rewrite the current line rather than insert at it.
 *
 * `/h2` on a line of text means *that line becomes a heading*, which is not an
 * insertion — treating it as one would leave the original line sitting above the
 * new one. So these are a separate kind, applied after the completion is accepted.
 */
export const LINE_COMMANDS: { name: string; description: string; prefix: string }[] = [
  { name: "h1", description: "Make this line a heading", prefix: "# " },
  { name: "h2", description: "Make this line a heading", prefix: "## " },
  { name: "h3", description: "Make this line a heading", prefix: "### " },
  { name: "h4", description: "Make this line a heading", prefix: "#### " },
  { name: "task", description: "Make this line a task", prefix: "* [ ] " },
];

const EXISTING_PREFIX = /^\s*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+(?:\[[^\]]\]\s+)?)?/;

/** Reshape a line, replacing whatever prefix it already had. */
export function reprefix(line: string, prefix: string): string {
  const indent = /^\s*/.exec(line)![0];
  const rest = line.slice(EXISTING_PREFIX.exec(line)![0].length);
  return `${indent}${prefix}${rest}`;
}

/**
 * Where a `/` starts a slash command.
 *
 * After whitespace or at the start of a line, as upstream has it — otherwise every
 * path, URL and fraction in a note would open a menu.
 */
export function slashRange(line: string, character: number): { from: number; typed: string } | null {
  const before = line.slice(0, character);
  const match = /(?:^|\s)\/([\w-]*)$/.exec(before);
  if (!match) return null;
  return { from: character - match[1].length - 1, typed: match[1] };
}

export function completion(lifeloop: () => LifeLoop | undefined): vscode.CompletionItemProvider {
  return {
    provideCompletionItems(document, position) {
      const instance = lifeloop();
      if (!instance) return undefined;
      const line = document.lineAt(position.line).text;
      const at = slashRange(line, position.character);
      if (!at) return undefined;

      const replacing = new vscode.Range(
        new vscode.Position(position.line, at.from),
        position,
      );

      const items: vscode.CompletionItem[] = [];

      for (const template of allSlashTemplates(instance.vault, slashPages(instance))) {
        const item = new vscode.CompletionItem(
          `/${template.name}`,
          vscode.CompletionItemKind.Snippet,
        );
        item.detail = template.description;
        item.documentation = new vscode.MarkdownString(
          `${template.page === "builtin" ? "Built in" : `From [[${template.page}]]`}\n\n\`\`\`markdown\n${template.body}\n\`\`\``,
        );
        item.range = replacing;
        item.insertText = new vscode.SnippetString(toSnippet(fill(template.body)));
        // A vault's own template sorts above the built-in it replaced.
        item.sortText = `${template.page === "builtin" ? "1" : "0"}${template.name}`;
        items.push(item);
      }

      for (const command of LINE_COMMANDS) {
        const item = new vscode.CompletionItem(
          `/${command.name}`,
          vscode.CompletionItemKind.Keyword,
        );
        item.detail = command.description;
        item.range = replacing;
        // The typed `/h2` is removed by the range; the line is reshaped afterwards.
        item.insertText = "";
        item.command = {
          command: "lifeloop.reprefixLine",
          title: command.description,
          arguments: [command.prefix],
        };
        item.sortText = `2${command.name}`;
        items.push(item);
      }

      return items;
    },
  };
}

export function register(lifeloop: () => LifeLoop | undefined, context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: "markdown" },
      completion(lifeloop),
      "/",
    ),
    vscode.commands.registerCommand("lifeloop.reprefixLine", async (prefix: string) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const at = editor.selection.active;
      const line = editor.document.lineAt(at.line);
      const next = reprefix(line.text, prefix);
      await editor.edit((edit) => edit.replace(line.range, next));
      const end = new vscode.Position(at.line, next.length);
      editor.selection = new vscode.Selection(end, end);
    }),
  );
}
