import * as vscode from "vscode";
import type { LifeloopObject } from "@lifeloop/semantic-core";
import type { LifeLoop } from "./workspace.ts";

/**
 * Pickers — tags, meta pages, and anything the index holds.
 *
 * Upstream builds its own navigator view for these. VS Code has `QuickPick`, which
 * already does fuzzy matching, keyboard navigation and the user's own settings, so
 * each picker here is a list and a jump (I7).
 *
 * What makes them worth having is not the widget but the *index*: quick open finds
 * files, and none of this is a file — a tag, a heading, a task, an object carrying
 * an inline attribute. That is the part VS Code cannot know.
 */

export type Target = { page: string; offset?: number };

/** Open a page, optionally at an offset the index recorded. */
export async function reveal(lifeloop: LifeLoop, target: Target): Promise<void> {
  const document = await vscode.workspace.openTextDocument(lifeloop.pageUri(target.page));
  const editor = await vscode.window.showTextDocument(document);
  if (target.offset === undefined) return;
  const position = document.positionAt(target.offset);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

/**
 * Every tag in the space, with how much carries it.
 *
 * `itags` rather than `tags`, so an inherited tag counts — a task inside a page
 * tagged `project` is part of that project whether or not anyone typed the tag on
 * the task, and a picker that disagreed with the queries would be worse than none.
 */
export function tagCounts(lifeloop: LifeLoop): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const object of lifeloop.store.objects()) {
    for (const tag of (object.itags as string[] | undefined) ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Everything carrying `tag`, in page order. */
export function taggedWith(lifeloop: LifeLoop, tag: string): LifeloopObject[] {
  return lifeloop.store
    .objects()
    .filter((object) => ((object.itags as string[] | undefined) ?? []).includes(tag));
}

/** A one-line label for any object, whatever kind it turned out to be. */
export function labelOf(object: LifeloopObject): string {
  const text = String(object.name ?? object.text ?? object.ref ?? "").trim();
  return text.split("\n")[0].slice(0, 100) || String(object.tag ?? "object");
}

const META = /^meta(\/|$)/;

/** Pages carrying a `meta` tag, the ones that configure the space rather than fill it. */
export function metaPages(lifeloop: LifeLoop): string[] {
  return lifeloop.store
    .objects("page")
    .filter((page) => ((page.itags as string[] | undefined) ?? []).some((t) => META.test(t)))
    .map((page) => String(page.ref))
    .sort();
}

export function register(
  lifeloop: () => LifeLoop | undefined,
  context: vscode.ExtensionContext,
): void {
  const on = (name: string, handler: (instance: LifeLoop) => Promise<void>) =>
    context.subscriptions.push(vscode.commands.registerCommand(name, async () => {
      const instance = lifeloop();
      if (!instance) return;
      await handler(instance);
    }));

  /** Pick a tag, then pick what carries it. */
  on("lifeloop.tagPicker", async (instance) => {
    const tags = tagCounts(instance);
    if (tags.length === 0) {
      vscode.window.showInformationMessage("LifeLoop: nothing is tagged yet");
      return;
    }
    const tag = await vscode.window.showQuickPick(
      tags.map((t) => ({ label: `#${t.tag}`, description: `${t.count}`, tag: t.tag })),
      { placeHolder: "Which tag?" },
    );
    if (!tag) return;

    const objects = taggedWith(instance, tag.tag);
    // A page of the same name is where a tag "lives", so it goes first.
    const picked = await vscode.window.showQuickPick(
      objects.map((object) => ({
        label: labelOf(object),
        description: `${object.tag} · ${object.page ?? ""}`,
        object,
      })),
      { placeHolder: `${objects.length} tagged #${tag.tag}`, matchOnDescription: true },
    );
    if (!picked) return;
    const range = picked.object.range as [number, number] | undefined;
    await reveal(instance, { page: String(picked.object.page ?? picked.object.ref), offset: range?.[0] });
  });

  /** Meta pages only — the ones that configure the space rather than fill it. */
  on("lifeloop.metaPicker", async (instance) => {
    const pages = metaPages(instance);
    if (pages.length === 0) {
      vscode.window.showInformationMessage("LifeLoop: no pages carry a `meta` tag");
      return;
    }
    const picked = await vscode.window.showQuickPick(pages, { placeHolder: "Open a meta page" });
    if (picked) await reveal(instance, { page: picked });
  });

  /**
   * Anything the index holds.
   *
   * Not a page picker with more rows: quick open already finds files, so a second
   * list of the same names would be noise. This is every *object* — tasks, items,
   * headers, tags, identities — which is the half quick open cannot see.
   */
  on("lifeloop.anythingPicker", async (instance) => {
    const items = instance.store.objects().map((object) => {
      const range = object.range as [number, number] | undefined;
      return {
        label: labelOf(object),
        description: `${object.tag}${object.page ? ` · ${object.page}` : ""}`,
        object,
        offset: range?.[0],
      };
    });
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `${items.length} objects`,
      matchOnDescription: true,
    });
    if (!picked) return;
    await reveal(instance, {
      page: String(picked.object.page ?? picked.object.ref),
      offset: picked.offset,
    });
  });
}
