import * as vscode from "vscode";
import type { LifeloopObject } from "@lifeloop/semantic-core";
import type { LifeLoop } from "./workspace.ts";

/**
 * X-Ray — show what the indexer actually extracted.
 *
 * Every text range the index turned into an object is underlined, and hovering one
 * shows its attributes. It answers the question a query raises when it returns
 * nothing: *what does this object actually look like?*
 *
 * For a port it earns its place twice over. It is the consistency mirror — the
 * fastest way to see whether we and SilverBullet read the same structure out of
 * the same bytes — and every future gap becomes self-diagnosing rather than
 * something to be found by reading code.
 *
 * Two host primitives, no webview: a decoration for the underline and a hover
 * provider for the card.
 */

/** Objects the index gave a range on this page, innermost last. */
export function ranged(lifeloop: LifeLoop, page: string): LifeloopObject[] {
  return lifeloop.store
    .select("page = ?", [page])
    .filter((object) => {
      const range = object.range as unknown;
      return Array.isArray(range) && range.length === 2 && typeof range[0] === "number";
    })
    // Widest first, so a task's own card wins over the page's when both cover a
    // point — the innermost object is the one you pointed at.
    .sort((a, b) => {
      const [af, at] = a.range as [number, number];
      const [bf, bt] = b.range as [number, number];
      return (bt - bf) - (at - af);
    });
}

/** The objects covering `offset`, innermost first. */
export function at(objects: LifeloopObject[], offset: number): LifeloopObject[] {
  return objects
    .filter((object) => {
      const [from, to] = object.range as [number, number];
      return offset >= from && offset < to;
    })
    .reverse();
}

/** Native serialization keeps the index values visible without another YAML dialect. */
export function card(object: LifeloopObject): string {
  const { range, ...rest } = object as Record<string, unknown>;
  return `\`\`\`json\n${JSON.stringify(rest, null, 2)}\n\`\`\``;
}

/**
 * The card, shown on hover.
 *
 * Silent when the lens is off: this is a debugging tool, and it should not compete
 * with the hovers that answer questions about content.
 */
export function hovers(
  lifeloop: () => LifeLoop | undefined,
  isOn: () => boolean,
): vscode.HoverProvider {
  return {
    provideHover(document, position) {
      const instance = lifeloop();
      if (!isOn() || !instance) return undefined;

      const page = instance.pageNameOfUri(document.uri);
      const found = at(ranged(instance, page), document.offsetAt(position));
      if (found.length === 0) return undefined;

      const markdown = new vscode.MarkdownString(
        found.slice(0, 3).map((object) => `**${object.tag}**\n\n${card(object)}`).join("\n\n---\n\n"),
      );
      const [from, to] = found[0].range as [number, number];
      return new vscode.Hover(
        markdown,
        new vscode.Range(document.positionAt(from), document.positionAt(to)),
      );
    },
  };
}

const KEY = "lifeloop.xray";

export function register(
  lifeloop: () => LifeLoop | undefined,
  context: vscode.ExtensionContext,
): void {
  // Sticky across reloads, as upstream's is: a lens you have to switch on again
  // every time you open a file is a lens you stop using.
  let on = context.workspaceState.get<boolean>(KEY, false);

  const underline = vscode.window.createTextEditorDecorationType({
    textDecoration: "underline dotted var(--vscode-editorInfo-foreground)",
  });
  context.subscriptions.push(underline);

  const paint = (editor: vscode.TextEditor | undefined) => {
    const instance = lifeloop();
    if (!editor || editor.document.languageId !== "markdown") return;
    if (!on || !instance) {
      editor.setDecorations(underline, []);
      return;
    }
    const page = instance.pageNameOfUri(editor.document.uri);
    editor.setDecorations(
      underline,
      ranged(instance, page).map((object) => {
        const [from, to] = object.range as [number, number];
        return new vscode.Range(editor.document.positionAt(from), editor.document.positionAt(to));
      }),
    );
  };

  const repaint = () => {
    for (const editor of vscode.window.visibleTextEditors) paint(editor);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("lifeloop.toggleXray", async () => {
      on = !on;
      await context.workspaceState.update(KEY, on);
      repaint();
      vscode.window.setStatusBarMessage(`LifeLoop: X-Ray ${on ? "on" : "off"}`, 3000);
    }),
    vscode.window.onDidChangeActiveTextEditor(paint),
    vscode.window.onDidChangeVisibleTextEditors(repaint),

    vscode.languages.registerHoverProvider({ language: "markdown" }, hovers(lifeloop, () => on)),
  );

  const instance = lifeloop();
  if (instance) instance.onDidChange(repaint);
  repaint();
}
