import * as vscode from "vscode";
import { identities, mentions, signBlock, type Identity } from "@lifeloop/semantic-core";
import type { LifeLoop } from "./workspace.ts";

/**
 * `@name` in the editor.
 *
 * The index already held all of this — identity objects, at-mention relations,
 * `recipients` on the task that carries them — because extraction is upstream's.
 * What was missing was the half a person touches: nothing completed a name,
 * clicking one did nothing, and there was no way to find what had been addressed
 * to you.
 *
 * All three are host primitives rather than new UI: completion, document links and
 * references. Which means `@ada` gets Shift+F12 and the peek window for free, and
 * behaves like every other symbol in the editor.
 */

/** A name is one word; dots carry, so `@pete.smith` is a single mention. */
export const MENTION = /(?<![\w.@])@([\w][\w.]*)/g;

export type Span = { name: string; from: number; to: number };

export function mentionSpans(line: string): Span[] {
  return [...line.matchAll(MENTION)].map((m) => ({
    name: m[1],
    from: m.index!,
    to: m.index! + m[0].length,
  }));
}

/** The mention at `character`, if the cursor is on one. */
export function mentionAt(line: string, character: number): Span | null {
  return mentionSpans(line).find((s) => character >= s.from && character <= s.to) ?? null;
}

/** Where an `@` is being typed: after whitespace or at the start of a line. */
export function typing(line: string, character: number): { from: number } | null {
  const match = /(?:^|\s)@([\w.]*)$/.exec(line.slice(0, character));
  return match ? { from: character - match[1].length - 1 } : null;
}

/** Who this vault is, or nothing — never guessed. */
export function me(): string {
  return vscode.workspace.getConfiguration("lifeloop").get<string>("identity", "").trim();
}

/**
 * Every identity, including the ones a script declared.
 *
 * Declarations are read only when Space Lua execution is on, because reading one
 * means running the block that declares it. With it off you still get every name
 * anyone has actually written down, which is most of them.
 */
export function knownIdentities(lifeloop: LifeLoop, declared: { name: string; description?: string }[] = []): Identity[] {
  return identities(lifeloop.store, declared);
}

export function completion(lifeloop: () => LifeLoop | undefined): vscode.CompletionItemProvider {
  return {
    provideCompletionItems(document, position) {
      const instance = lifeloop();
      if (!instance) return undefined;
      const line = document.lineAt(position.line).text;
      const at = typing(line, position.character);
      if (!at) return undefined;

      const range = new vscode.Range(new vscode.Position(position.line, at.from), position);
      return knownIdentities(instance).map((identity, index) => {
        const item = new vscode.CompletionItem(identity.ref, vscode.CompletionItemKind.User);
        item.detail = identity.description
          ?? (identity.mentions ? `mentioned ${identity.mentions}×` : "not yet mentioned");
        item.range = range;
        item.insertText = identity.ref;
        // The order the index gave, preserved: most-mentioned first.
        item.sortText = String(index).padStart(4, "0");
        return item;
      });
    },
  };
}

/** Clicking a mention opens what is addressed to that name. */
export function documentLinks(lifeloop: () => LifeLoop | undefined): vscode.DocumentLinkProvider {
  return {
    provideDocumentLinks(document) {
      if (!lifeloop()) return [];
      const links: vscode.DocumentLink[] = [];
      for (let line = 0; line < document.lineCount; line++) {
        for (const span of mentionSpans(document.lineAt(line).text)) {
          const link = new vscode.DocumentLink(
            new vscode.Range(
              new vscode.Position(line, span.from),
              new vscode.Position(line, span.to),
            ),
            vscode.Uri.parse(
              `command:lifeloop.showMentions?${encodeURIComponent(JSON.stringify([span.name]))}`,
            ),
          );
          link.tooltip = `Everything addressed to @${span.name}`;
          links.push(link);
        }
      }
      return links;
    },
  };
}

/** Shift+F12 on a mention finds every other mention of the same name. */
export function references(lifeloop: () => LifeLoop | undefined): vscode.ReferenceProvider {
  return {
    provideReferences(document, position) {
      const instance = lifeloop();
      if (!instance) return [];
      const span = mentionAt(document.lineAt(position.line).text, position.character);
      if (!span) return [];

      return mentions(instance.store, span.name).map((mention) => {
        const uri = instance.pageUri(mention.page);
        // The index gives a page offset; a Location wants a position, and the
        // page is on disk whether or not it is open.
        let line = 0;
        try {
          const text = instance.vault.read(`${mention.page}.md`);
          line = text.slice(0, mention.pos ?? 0).split("\n").length - 1;
        } catch { /* the page may have gone since the index ran */ }
        return new vscode.Location(uri, new vscode.Position(line, 0));
      });
    },
  };
}

export function register(
  lifeloop: () => LifeLoop | undefined,
  context: vscode.ExtensionContext,
): void {
  const markdown = { language: "markdown" } as vscode.DocumentSelector;
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(markdown, completion(lifeloop), "@"),
    vscode.languages.registerDocumentLinkProvider(markdown, documentLinks(lifeloop)),
    vscode.languages.registerReferenceProvider(markdown, references(lifeloop)),

    /** Focus the Mention Inbox, optionally on a name other than your own. */
    vscode.commands.registerCommand("lifeloop.showMentions", async (name?: string) => {
      const instance = lifeloop();
      if (!instance) return;
      if (name && `@${name}` !== me() && me()) {
        // Someone else's name: show it as a list rather than silently opening
        // *your* inbox, which is not what was clicked.
        const found = mentions(instance.store, name);
        if (found.length === 0) {
          vscode.window.showInformationMessage(`LifeLoop: nothing addressed to @${name}`);
          return;
        }
        const picked = await vscode.window.showQuickPick(
          found.map((m) => ({ label: m.snippet.slice(0, 90), description: m.page, mention: m })),
          { placeHolder: `${found.length} addressed to @${name}` },
        );
        if (!picked) return;
        const document = await vscode.workspace.openTextDocument(
          instance.pageUri(picked.mention.page),
        );
        const editor = await vscode.window.showTextDocument(document);
        const at = document.positionAt(picked.mention.pos ?? 0);
        editor.selection = new vscode.Selection(at, at);
        editor.revealRange(new vscode.Range(at, at));
        return;
      }
      await vscode.commands.executeCommand("lifeloop.mentions.focus");
    }),

    /**
     * Sign the block at the cursor.
     *
     * This is what lets you answer a mention without addressing yourself: a
     * signature credits, it does not queue a fresh request into your own inbox.
     */
    vscode.commands.registerCommand("lifeloop.sign", async () => {
      const instance = lifeloop();
      const editor = vscode.window.activeTextEditor;
      if (!instance || !editor || editor.document.languageId !== "markdown") return;

      const identity = me();
      if (!identity) {
        vscode.window.showWarningMessage("LifeLoop: set `lifeloop.identity` to sign");
        return;
      }
      if (editor.document.isDirty) await editor.document.save();

      const page = instance.pageNameOfUri(editor.document.uri);
      const result = await signBlock(instance.vault, page, editor.selection.active.line, identity);
      if (!result.ok) {
        vscode.window.setStatusBarMessage(`LifeLoop: ${result.message}`, 3000);
        return;
      }
      await instance.reindex();
    }),
  );
}
