import * as vscode from "vscode";
import { decorations, type PageDecoration } from "@lifeloop/semantic-core";
import type { LifeLoop } from "./workspace.ts";

/**
 * `pageDecoration` in the Explorer.
 *
 * VS Code's file decorations are a badge of at most two characters, a colour and a
 * tooltip — which is exactly enough for the emoji prefix people actually use, and
 * nothing at all for `icon` or `cssClasses`. Those two have no host equivalent:
 * Explorer icons come from the user's icon theme, and there is no stylesheet for an
 * extension to hook into.
 *
 * Quick Open cannot be decorated by an extension either. So a page marked `hide`
 * stays out of *our* pickers and completions and remains reachable through the
 * host's — which makes `hide` a tidying tool and never a privacy one, and that is
 * worth saying plainly rather than discovering.
 */

/** The badge for a decoration: emoji are usually one grapheme, the cap is two. */
export function badgeOf(decoration: PageDecoration | undefined): string | undefined {
  const prefix = decoration?.prefix?.trim();
  if (!prefix) return undefined;
  return [...prefix].slice(0, 2).join("");
}

export function provider(lifeloop: () => LifeLoop | undefined): vscode.FileDecorationProvider & {
  refresh(): void;
} {
  const emitter = new vscode.EventEmitter<undefined>();
  return {
    onDidChangeFileDecorations: emitter.event,
    refresh: () => emitter.fire(undefined),
    provideFileDecoration(uri) {
      const instance = lifeloop();
      if (!instance || !uri.fsPath.endsWith(".md")) return undefined;

      const page = instance.pageNameOfUri(uri);
      const decoration = decorations(instance.store).get(page);
      const badge = badgeOf(decoration);
      if (!badge) return undefined;

      return {
        badge,
        tooltip: `LifeLoop: ${decoration!.prefix!.trim()}`,
      };
    },
  };
}

export function register(
  lifeloop: () => LifeLoop | undefined,
  context: vscode.ExtensionContext,
): void {
  const decorator = provider(lifeloop);
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(decorator));
  const instance = lifeloop();
  if (instance) instance.onDidChange(() => decorator.refresh());
}
