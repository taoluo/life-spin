import * as vscode from "vscode";
import {
  capture, pending, processItem, linkToProject, makeTask, setTaskState, toggleParked, moveItem,
  setTaskAttribute, setProjectStatus, attachPageToTask, promotePage, freezeReview,
  PROJECT_STATES, review, week, day, today, upcoming,
  templates, readTemplate, builtinTemplate, createFromTemplate,
  bakeAt, unbakeAt, updateBaked,
  type InboxItem, type Refusal, type PageTemplate,
} from "@lifeloop/semantic-core";
import type { LifeLoop } from "./workspace.ts";
import type { Node } from "./views.ts";
import { openPage, scriptNamespaces } from "./retrieval.ts";
import { evaluateToMarkdown } from "./lua.ts";

/**
 * Every command goes through a named mutation (I5). None of them writes a file
 * directly, and a refusal is *shown*, never swallowed — a mutation that quietly
 * did nothing is indistinguishable from one that silently did the wrong thing.
 */
function report(result: { ok: true } | Refusal, success: string): boolean {
  if (result.ok) {
    vscode.window.setStatusBarMessage(`LifeLoop: ${success}`, 3000);
    return true;
  }
  const messages: Record<Refusal["reason"], (m: string) => void> = {
    cancelled: () => {},
    stale: (m) => void vscode.window.showWarningMessage(`LifeLoop: ${m}`),
    missing: (m) => void vscode.window.showWarningMessage(`LifeLoop: ${m}`),
    ambiguous: (m) => void vscode.window.showWarningMessage(`LifeLoop: ${m}`),
    collision: (m) => void vscode.window.showWarningMessage(`LifeLoop: ${m}`),
    invalid: (m) => void vscode.window.showErrorMessage(`LifeLoop: ${m}`),
  };
  messages[result.reason](result.message);
  return false;
}

const isTask = (line: string) => /^\s*(?:[-*+]|\d+[.)])\s+\[/.test(line);

/** The task under the cursor, as a handle carrying its own receipt. */
function taskAtCursor(lifeloop: LifeLoop) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "markdown") return null;
  const line = editor.document.lineAt(editor.selection.active.line);
  if (!isTask(line.text)) return null;
  const page = lifeloop.pageNameOfUri(editor.document.uri);
  const offset = editor.document.offsetAt(line.range.start);
  return {
    handle: {
      ref: `${page}@${offset}`,
      expectedText: line.text,
      expectedState: /\[([^\]])\]/.exec(line.text)?.[1],
      capturedAt: new Date().toISOString(),
    },
    editor,
  };
}

async function pickProject(lifeloop: LifeLoop): Promise<string | undefined> {
  const projects = lifeloop.store
    .objects("page")
    .filter((p) => (p.itags as string[] | undefined)?.includes("project"))
    .map((p) => String(p.ref))
    .sort();
  if (projects.length === 0) {
    vscode.window.showWarningMessage("LifeLoop: no pages tagged `project` yet");
    return undefined;
  }
  return vscode.window.showQuickPick(projects, { placeHolder: "Which project?" });
}

export function register(lifeloop: LifeLoop, context: vscode.ExtensionContext): void {
  const on = (name: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(name, handler));

  const after = async () => { await lifeloop.reindex(); };

  // 1.7 — Capture. Costs less than filing does: one box, no navigation.
  on("lifeloop.capture", async () => {
    const line = await vscode.window.showInputBox({
      prompt: "Capture to Inbox",
      placeHolder: "a thought, a task, anything",
    });
    if (line === undefined) return;
    const page = lifeloop.config("inboxPage", "Inbox");
    if (report(await capture(lifeloop.vault, line, page), "captured")) await after();
  });

  on("lifeloop.openInbox", async () => {
    const page = lifeloop.config("inboxPage", "Inbox");
    if (!lifeloop.vault.exists(`${page}.md`)) {
      lifeloop.vault.write(`${page}.md`, "Captured items land here.\n\n");
      await after();
    }
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(lifeloop.pageUri(page)));
  });

  // 1.8 — Process Inbox. Link before Move: the captured wording stays where it happened.
  on("lifeloop.processInbox", async (preselected?: InboxItem) => {
    const page = lifeloop.config("inboxPage", "Inbox");
    let text: string;
    try { text = lifeloop.vault.read(`${page}.md`); } catch {
      vscode.window.showWarningMessage(`LifeLoop: no ${page} page`);
      return;
    }

    const items = pending(text);
    if (items.length === 0) {
      vscode.window.setStatusBarMessage("LifeLoop: inbox is empty", 3000);
      return;
    }

    let item = preselected
      ? items.find((i) => i.offset === preselected.offset) ?? items[0]
      : undefined;
    if (!item) {
      const picked = await vscode.window.showQuickPick(
        items.map((i) => ({ label: i.text.split("\n")[0], item: i })),
        { placeHolder: `${items.length} pending` },
      );
      if (!picked) return;
      item = picked.item;
    }

    const action = await vscode.window.showQuickPick(
      [
        { label: "$(link) Link project", detail: "append [[Project]], leave the wording where it is", id: "link" },
        { label: "$(circle-outline) Make task", detail: "turn it into a checkbox", id: "task" },
        { label: "$(check) Keep", detail: "stays pending — a first-class choice", id: "keep" },
        { label: "$(archive) Archive", detail: "move it under Processed unchanged", id: "archive" },
      ],
      { placeHolder: item.text.split("\n")[0] },
    );
    if (!action) return;

    switch (action.id) {
      case "keep": return;
      case "task":
        if (report(await makeTask(lifeloop.vault, item, page), "made a task")) await after();
        return;
      case "archive":
        if (report(await processItem(lifeloop.vault, item, null, page), "processed")) await after();
        return;
      case "link": {
        const project = await pickProject(lifeloop);
        if (!project) return;
        if (report(await linkToProject(lifeloop.vault, item, project, page), `linked to ${project}`)) await after();
        return;
      }
    }
  });

  // 1.10 — ticking from a view, against the node's own handle.
  on("lifeloop.completeTask", async (node: Node) => {
    if (!node?.handle) return;
    if (report(await setTaskState(lifeloop.vault, node.handle, true), "completed")) await after();
  });

  on("lifeloop.revealTask", async (node: Node) => {
    if (!node?.page) return;
    const document = await vscode.workspace.openTextDocument(lifeloop.pageUri(node.page));
    const editor = await vscode.window.showTextDocument(document);
    const position = document.positionAt(node.offset ?? 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  });

  for (const tag of ["waiting", "someday"] as const) {
    on(`lifeloop.toggle${tag[0].toUpperCase()}${tag.slice(1)}`, async () => {
      const at = taskAtCursor(lifeloop);
      if (!at) { vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
      if (report(await toggleParked(lifeloop.vault, at.handle, tag), `toggled #${tag}`)) await after();
    });
  }

  for (const field of ["deadline", "scheduled"] as const) {
    on(`lifeloop.set${field[0].toUpperCase()}${field.slice(1)}`, async () => {
      const at = taskAtCursor(lifeloop);
      if (!at) { vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
      const value = await vscode.window.showInputBox({
        prompt: `${field} (YYYY-MM-DD, empty to clear)`,
        value: day(),
        validateInput: (v) => (v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : "YYYY-MM-DD"),
      });
      if (value === undefined) return;
      const result = await setTaskAttribute(lifeloop.vault, at.handle, field, value || null);
      if (report(result, `set ${field}`)) await after();
    });
  }

  on("lifeloop.attachPage", async () => {
    const at = taskAtCursor(lifeloop);
    if (!at) { vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
    // The destination is the user's, never inferred from a folder convention.
    const destination = await vscode.window.showInputBox({ prompt: "New page for this task" });
    if (!destination) return;
    if (report(await attachPageToTask(lifeloop.vault, at.handle, destination), `attached ${destination}`)) {
      await after();
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(lifeloop.pageUri(destination)));
    }
  });

  // 1.9 — lifecycle is semantic only: archiving does not move the page.
  on("lifeloop.setProjectStatus", async () => {
    const project = await pickProject(lifeloop);
    if (!project) return;
    const status = await vscode.window.showQuickPick([...PROJECT_STATES], {
      placeHolder: `status for ${project}`,
    });
    if (!status) return;
    if (report(await setProjectStatus(lifeloop.vault, project, status as any), `${project} is ${status}`)) {
      await after();
    }
  });

  /**
   * Open a page a template describes, creating it if it is not there.
   *
   * A vault's own `Templates/Daily` wins over the built-in shape, which is the
   * point: the thing people most want to change about a daily note is what is in
   * it, and that should not require editing an extension.
   */
  const fromTemplate = async (
    kind: "daily" | "review" | "project" | "page",
    named: string,
    suggested?: string,
  ) => {
    const vaultTemplate = readTemplate(lifeloop.vault, `Templates/${named}`);
    const template = vaultTemplate ?? builtinTemplate(kind);
    const name = suggested ?? template.suggestedName;
    if (!name) return;

    const result = await createFromTemplate(lifeloop.vault, template, name);
    if (!result.ok) {
      vscode.window.showWarningMessage(`LifeLoop: ${result.message}`);
      return;
    }
    if (!result.value.existed) await after();

    const document = await vscode.workspace.openTextDocument(lifeloop.pageUri(result.value.page));
    const editor = await vscode.window.showTextDocument(document);
    // Land the caret where the template asked, which is the difference between
    // saving typing and saving typing *and* a click.
    if (result.value.cursor !== null) {
      const at = document.positionAt(result.value.cursor);
      editor.selection = new vscode.Selection(at, at);
    }
  };

  // 1.11 — the daily note: a log and somewhere to think.
  on("lifeloop.openDaily", () =>
    fromTemplate("daily", "Daily", `${lifeloop.config("journalFolder", "Journal")}/${day()}`),
  );

  /**
   * Any template the vault defines, offered by name — or named directly.
   *
   * A template's `command:` key is what it wants to be called, and VS Code cannot
   * add a name it has never heard of to the Command Palette: the palette lists
   * what a manifest declared at install time. So the *contributed* command takes
   * an argument instead, which makes `command:` reachable from a keybinding the
   * user writes once:
   *
   *     { "key": "cmd+k m", "command": "lifeloop.newFromTemplate", "args": "New meeting" }
   *
   * Install-time contribution plus an argument, rather than a second registry —
   * the same conclusion `command.define` reached, arrived at from the other side.
   */
  on("lifeloop.newFromTemplate", async (wanted?: string) => {
    const available: PageTemplate[] = [
      ...templates(lifeloop.vault),
      ...(["page", "project", "daily", "review"] as const).map(builtinTemplate),
    ];
    const nameOf = (t: PageTemplate) =>
      t.command ?? t.page.replace(/^Templates\//, "").replace(/^builtin:/, "");

    let template: PageTemplate | undefined;
    if (typeof wanted === "string" && wanted.trim()) {
      const target = wanted.trim().toLowerCase();
      template = available.find(
        (t) => nameOf(t).toLowerCase() === target || t.page.toLowerCase() === target,
      );
      if (!template) {
        // Named and not found: say which names exist rather than silently
        // opening a picker the keybinding did not ask for.
        vscode.window.showWarningMessage(
          `LifeLoop: no template called "${wanted}" — try ${available.map(nameOf).join(", ")}`,
        );
        return;
      }
    }

    if (!template) {
      const picked = await vscode.window.showQuickPick(
        available.map((t) => ({
          label: nameOf(t),
          detail: t.page.startsWith("builtin:") ? "built in" : t.page,
          template: t,
        })),
        { placeHolder: "Which template?" },
      );
      if (!picked) return;
      template = picked.template;
    }
    let name = template.suggestedName ?? "";
    if (template.confirmName || !name) {
      const answer = await vscode.window.showInputBox({
        prompt: "Name for the new page",
        value: name,
      });
      if (answer === undefined) return;
      name = answer;
    }
    const result = await createFromTemplate(lifeloop.vault, template, name);
    if (!result.ok) {
      vscode.window.showWarningMessage(`LifeLoop: ${result.message}`);
      return;
    }
    if (!result.value.existed) await after();
    const document = await vscode.workspace.openTextDocument(lifeloop.pageUri(result.value.page));
    const editor = await vscode.window.showTextDocument(document);
    if (result.value.cursor !== null) {
      const at = document.positionAt(result.value.cursor);
      editor.selection = new vscode.Selection(at, at);
    }
  });

  // 1.12 — the Weekly Review, live until frozen.
  on("lifeloop.openReview", () =>
    fromTemplate(
      "review", "Review",
      `${lifeloop.config("reviewFolder", "Reviews")}/${week(day()).start}`,
    ),
  );

  on("lifeloop.freezeReview", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const page = lifeloop.pageNameOfUri(editor.document.uri);
    const sections = review(lifeloop.store, day());
    const render = (name: string): string | null => {
      const lists: Record<string, unknown[]> = {
        completed: sections.completed, stillOpen: sections.stillOpen,
        activeProjects: sections.activeProjects, waiting: sections.waiting, inbox: sections.inbox,
      };
      const list = lists[name];
      if (!list) return null;
      if (list.length === 0) return "_nothing_";
      return list.map((o: any) => `* ${o.name ?? o.ref}`).join("\n");
    };
    if (report(await freezeReview(lifeloop.vault, page, render, day()), "review frozen")) await after();
  });

  on("lifeloop.openToday", async () => {
    const t = today(lifeloop.store, day());
    const lines = [`# Today — ${t.date}`, ""];
    const add = (title: string, list: any[]) => {
      if (!list.length) return;
      lines.push(`## ${title}`, "");
      for (const task of list) lines.push(`* [ ] ${task.name}  _(${task.page})_`);
      lines.push("");
    };
    add("Overdue", t.overdue); add("Due today", t.due);
    add("Scheduled", t.scheduled); add("Waiting", t.waiting);
    for (const d of upcoming(lifeloop.store, day(), lifeloop.config("upcomingDays", 14))) {
      add(d.date, d.tasks);
    }
    const document = await vscode.workspace.openTextDocument({
      content: lines.join("\n"), language: "markdown",
    });
    await vscode.window.showTextDocument(document, { preview: true });
  });

  /**
   * What a vault actually loses by arriving here.
   *
   * The plan says whether to execute Space Lua is decided by real friction, not by
   * argument. This is the instrument: it counts the blocks, sorts them by whether
   * a VS Code host could ever run them, and names the pages. A vault whose scripts
   * are all `editor.*` panel code answers the question one way; one full of
   * `index.*` queries answers it the other.
   */
  on("lifeloop.reportUnsupported", async () => {
    const lua = lifeloop.store.objects("space-lua");
    const style = lifeloop.store.objects("space-style");
    if (lua.length === 0 && style.length === 0) {
      vscode.window.setStatusBarMessage(
        "LifeLoop: no Space Lua or Space Style blocks in this vault", 4000,
      );
      return;
    }

    const rows = lua.map((block) => {
      const ref = String(block.ref ?? "");
      return { page: ref.slice(0, ref.lastIndexOf("@")), ...scriptNamespaces(String(block.script ?? "")) };
    });

    const runnable = rows.filter((r) => !r.editorBound.length && !r.unknown.length);
    const widgets = rows.filter((r) => r.replaced.length && !r.editorBound.length);
    const blocked = rows.filter((r) => r.editorBound.length);
    const unclear = rows.filter((r) => r.unknown.length && !r.editorBound.length);

    const list = (rs: typeof rows, pick: (r: (typeof rows)[number]) => string[]) =>
      rs.length
        ? rs.map((r) => `* \`${r.page}\` — ${pick(r).join(", ") || "plain Lua"}`).join("\n")
        : "_None._";

    const lines = [
      "# Blocks LifeLoop does not execute",
      "",
      "SilverBullet runs these. LifeLoop indexes them and stops there, so a vault that came",
      "from SilverBullet keeps its notes and loses its scripts.",
      "",
      `* **${lua.length}** Space Lua block${lua.length === 1 ? "" : "s"}`,
      `* **${style.length}** Space Style block${style.length === 1 ? "" : "s"} — CSS for SilverBullet's editor, which VS Code does not expose`,
      "",
      "Classified by the *methods* each one calls, not by namespace. That distinction matters:",
      "`editor.flashNotification` is one line of VS Code, `editor.showPanel` has no equivalent at",
      "all, and counting them together makes a vault look far less portable than it is.",
      "",
      "## Nothing standing in the way",
      "",
      "Plain Lua, or host calls a VS Code host could provide.",
      "",
      list(runnable, (r) => r.portable),
      "",
      "## Builds a widget",
      "",
      "SilverBullet places these inside the editor, which VS Code cannot do. The *content* is what",
      "LifeLoop already renders for query blocks — in the Markdown preview, a hover and a CodeLens.",
      "So the capability exists and the placement does not.",
      "",
      list(widgets, (r) => r.replaced),
      "",
      "## Tied to SilverBullet's editor",
      "",
      "Panel slots, CodeMirror transactions, custom task states, runtime extension points.",
      "",
      list(blocked, (r) => r.editorBound),
      "",
      ...(unclear.length
        ? ["## Unclassified", "", "Not recognised by this report — worth a look rather than an assumption.", "", list(unclear, (r) => r.unknown), ""]
        : []),
    ];

    const document = await vscode.workspace.openTextDocument({
      content: lines.join("\n") + "\n",
      language: "markdown",
    });
    await vscode.window.showTextDocument(document, { preview: true });
  });

  /**
   * Outlining, on whole items.
   *
   * VS Code already moves lines, folds and indents; what it cannot know is that a
   * list item owns the lines nested under it, so its own `Alt+Down` leaves a
   * parent's children behind. These take the subtree.
   */
  for (const move of ["up", "down", "indent", "outdent"] as const) {
    on(`lifeloop.move${move[0].toUpperCase()}${move.slice(1)}`, async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "markdown") return;
      const line = editor.selection.active.line;
      const page = lifeloop.pageNameOfUri(editor.document.uri);

      const result = await moveItem(lifeloop.vault, page, line, move);
      if (!result.ok) {
        vscode.window.setStatusBarMessage(`LifeLoop: ${result.message}`, 3000);
        return;
      }
      // Follow the item rather than leaving the cursor where the text used to be.
      const target = new vscode.Position(result.value.line, editor.selection.active.character);
      editor.selection = new vscode.Selection(target, target);
      await after();
    });
  }

  /**
   * Baked sections — write the rendered output into the page, wrapped in HTML
   * comments, so the Markdown reads correctly *outside* LifeLoop too.
   *
   * The cursor's page has to be saved to disk before any of this: the mutation
   * layer reads the file, and baking a stale copy would write yesterday's output
   * over today's edits.
   */
  const bakeTarget = async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") return null;
    if (editor.document.isDirty) await editor.document.save();
    return {
      editor,
      page: lifeloop.pageNameOfUri(editor.document.uri),
      offset: editor.document.offsetAt(editor.selection.active),
    };
  };

  const evaluate = (expression: string) => evaluateToMarkdown(lifeloop, expression);

  on("lifeloop.bakeSection", async () => {
    const target = await bakeTarget();
    if (!target) return;
    const result = await bakeAt(lifeloop.vault, target.page, target.offset, evaluate);
    if (report(result, "baked")) await after();
  });

  on("lifeloop.unbakeSection", async () => {
    const target = await bakeTarget();
    if (!target) return;
    if (report(await unbakeAt(lifeloop.vault, target.page, target.offset), "unbaked")) await after();
  });

  on("lifeloop.updateBakedSections", async () => {
    const target = await bakeTarget();
    if (!target) return;
    const result = await updateBaked(lifeloop.vault, target.page, evaluate);
    if (!result.ok) {
      report(result, "");
      return;
    }
    const { updated, failed } = result.value;
    // What failed is named. A silent partial refresh is how someone comes to trust
    // a table that has been wrong for a month.
    if (failed.length) {
      vscode.window.showWarningMessage(
        `LifeLoop: ${updated} updated, ${failed.length} left as they were — ${failed
          .map((f) => `${f.expression}: ${f.error}`)
          .join("; ")}`,
      );
    } else {
      vscode.window.setStatusBarMessage(
        updated ? `LifeLoop: ${updated} baked section(s) updated` : "LifeLoop: already current",
        3000,
      );
    }
    if (updated) await after();
  });

  on("lifeloop.openPage", () => openPage(lifeloop));
  on("lifeloop.reindex", async () => {
    await lifeloop.reindex(true);
    vscode.window.setStatusBarMessage("LifeLoop: index rebuilt", 3000);
  });
  on("lifeloop.refreshViews", () => lifeloop.notifyChanged());
}
