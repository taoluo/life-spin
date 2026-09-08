import * as vscode from "vscode";
import { setTaskAttribute, day, type SourceHandle } from "@lifeloop/semantic-core";
import {
  Reminders, Calendar, Notes, appAvailable, syncReminders, boundTasks, bindReminder,
  planImport, applyImport, type ObservationStore, type Observation, type ImportState,
} from "@lifeloop/apple-bridge";
import type { LifeLoop } from "./workspace.ts";

/**
 * Phase 2 in the editor.
 *
 * The extension is a *client* of the bridge, never its owner: `@lifeloop/apple-bridge`
 * imports nothing from `vscode`, so an extension host that is remote, SSH or web
 * simply reports the capability unavailable instead of failing obscurely.
 */

/** Observations live in workspace state — derived, and safe to lose. */
class WorkspaceObservations implements ObservationStore {
  private static readonly KEY = "lifeloop.reminderObservations";
  constructor(private readonly memento: vscode.Memento) {}

  private all(): Record<string, Observation> {
    return this.memento.get<Record<string, Observation>>(WorkspaceObservations.KEY, {});
  }
  get(id: string) { return this.all()[id]; }
  set(id: string, observation: Observation) {
    void this.memento.update(WorkspaceObservations.KEY, { ...this.all(), [id]: observation });
  }
  delete(id: string) {
    const { [id]: _drop, ...rest } = this.all();
    void this.memento.update(WorkspaceObservations.KEY, rest);
  }
}

async function requireApp(
  app: "Reminders" | "Calendar" | "Notes",
  launch = true,
): Promise<boolean> {
  if (await appAvailable(app, { launch })) return true;
  vscode.window.showWarningMessage(
    `LifeLoop: ${app} is not reachable from this window. ` +
      `The Apple bridge needs a local macOS host — it is unavailable over SSH, ` +
      `in a container or on the web.`,
  );
  return false;
}

const isTask = (line: string) => /^\s*(?:[-*+]|\d+[.)])\s+\[/.test(line);

function taskAtCursor(lifeloop: LifeLoop): { handle: SourceHandle; text: string } | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "markdown") return null;
  const line = editor.document.lineAt(editor.selection.active.line);
  if (!isTask(line.text)) return null;
  const page = lifeloop.pageNameOfUri(editor.document.uri);
  return {
    handle: {
      ref: `${page}@${editor.document.offsetAt(line.range.start)}`,
      expectedText: line.text,
      expectedState: /\[([^\]])\]/.exec(line.text)?.[1],
      capturedAt: new Date().toISOString(),
    },
    text: line.text.replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[^\]]\]\s*/, "").replace(/\s*\[[a-z-]+:.*$/, "").trim(),
  };
}

export function registerApple(lifeloop: LifeLoop, context: vscode.ExtensionContext): void {
  const on = (name: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(name, handler));
  const observations = new WorkspaceObservations(context.workspaceState);
  const importState: ImportState = { lastImported: new Map() };

  // 2a — project a task outward. The id lands on the task line, so the binding is
  // rediscoverable from Markdown alone and no side table has to be kept in step.
  on("lifeloop.addReminder", async () => {
    const at = taskAtCursor(lifeloop);
    if (!at) { vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
    if (!(await requireApp("Reminders"))) return;

    const list = lifeloop.config("reminderList", "");
    try {
      const result = await bindReminder(
        lifeloop.vault, at.handle, at.text, "", list, new Reminders(),
      );
      if (!result.ok) {
        vscode.window.showWarningMessage(`LifeLoop: ${result.message}`);
        return;
      }
      await lifeloop.reindex();
      vscode.window.setStatusBarMessage("LifeLoop: reminder added", 3000);
    } catch (error) {
      vscode.window.showErrorMessage(`LifeLoop: ${(error as Error).message}`);
    }
  });

  // 2c — the time is asked for, never inferred. A deadline says when something
  // matters and nothing about which hours are spent on it.
  on("lifeloop.addToCalendar", async () => {
    const at = taskAtCursor(lifeloop);
    if (!at) { vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
    if (!(await requireApp("Calendar"))) return;

    const when = await vscode.window.showInputBox({
      prompt: "When? (YYYY-MM-DD HH:MM)",
      value: `${day()} 09:00`,
      validateInput: (v) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v) ? null : "YYYY-MM-DD HH:MM"),
    });
    if (!when) return;
    const minutes = lifeloop.config("eventMinutes", 60);
    const start = new Date(when.replace(" ", "T"));
    const end = new Date(start.getTime() + minutes * 60_000);
    const fmt = (d: Date) => d.toLocaleString("en-US");

    try {
      const uid = await new Calendar().create(
        at.text, fmt(start), fmt(end), lifeloop.config("calendarName", "Calendar"),
      );
      const result = await setTaskAttribute(lifeloop.vault, at.handle, "event", uid);
      if (!result.ok) { vscode.window.showWarningMessage(`LifeLoop: ${result.message}`); return; }
      await lifeloop.reindex();
      vscode.window.setStatusBarMessage("LifeLoop: added to calendar", 3000);
    } catch (error) {
      vscode.window.showErrorMessage(`LifeLoop: ${(error as Error).message}`);
    }
  });

  // 2b — the direction the phase exists for.
  on("lifeloop.syncProjected", async () => {
    if (!(await requireApp("Reminders"))) return;
    if (boundTasks(lifeloop.store).length === 0) {
      vscode.window.setStatusBarMessage("LifeLoop: nothing projected yet", 3000);
      return;
    }

    const recurring: string[] = [];
    try {
      const report = await syncReminders({
        store: lifeloop.store,
        vault: lifeloop.vault,
        observations,
        reminders: new Reminders(),
        onRecurring: (task) => recurring.push(task.name),
      });
      await lifeloop.reindex();

      const parts: string[] = [];
      if (report.completed.length) parts.push(`${report.completed.length} completed`);
      if (report.reopened.length) parts.push(`${report.reopened.length} reopened`);
      if (report.pushed.length) parts.push(`${report.pushed.length} pushed`);
      if (report.marksCleared.length) parts.push(`${report.marksCleared.length} stale marks cleared`);
      vscode.window.setStatusBarMessage(
        `LifeLoop: ${parts.length ? parts.join(", ") : "nothing to do"}`, 5000,
      );

      // Visible and harmless beats invisible and harmless: otherwise someone waits
      // for a completion that will never arrive.
      if (recurring.length) {
        vscode.window.showWarningMessage(
          `LifeLoop: ${recurring.length} reminder(s) repeat, so completing them does not affect ` +
            `the task — a recurring commitment is not one checkbox. (${recurring.slice(0, 3).join(", ")})`,
        );
      }
      for (const refusal of report.refused) {
        vscode.window.showWarningMessage(`LifeLoop: ${refusal.ref} — ${refusal.message}`);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`LifeLoop: sync failed — ${(error as Error).message}`);
    }
  });

  // 2d — Notes into the Inbox, one way. The Inbox is the superset of all captures.
  on("lifeloop.importNotes", async () => {
    if (!(await requireApp("Notes"))) return;
    const folder = lifeloop.config("notesFolder", "LifeLoop Inbox");
    const inbox = lifeloop.config("inboxPage", "Inbox");

    try {
      const notes = await new Notes().list(folder);
      if (notes.length === 0) {
        vscode.window.setStatusBarMessage(
          `LifeLoop: nothing in the "${folder}" folder`, 4000,
        );
        return;
      }
      const text = lifeloop.vault.exists(`${inbox}.md`) ? lifeloop.vault.read(`${inbox}.md`) : "";
      const plan = planImport(notes, text, importState);
      const result = await applyImport(lifeloop.vault, inbox, plan, importState);
      await lifeloop.reindex();

      const bits = [`${result.created} new`];
      if (result.updated) bits.push(`${result.updated} updated`);
      if (result.detached) bits.push(`${result.detached} now yours (edited here)`);
      vscode.window.setStatusBarMessage(`LifeLoop: imported ${bits.join(", ")}`, 5000);
    } catch (error) {
      vscode.window.showErrorMessage(`LifeLoop: import failed — ${(error as Error).message}`);
    }
  });

  // A timer, off by default. Nothing surprising happens to someone's calendar or
  // reminders because they installed an extension.
  let timer: NodeJS.Timeout | undefined;
  const schedule = () => {
    clearInterval(timer);
    if (!lifeloop.config("autoSync", false)) return;
    const minutes = Math.max(1, lifeloop.config("syncMinutes", 5));
    timer = setInterval(
      () => void vscode.commands.executeCommand("lifeloop.syncProjected"),
      minutes * 60_000,
    );
  };
  schedule();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("lifeloop")) schedule();
    }),
    { dispose: () => clearInterval(timer) },
  );
}
