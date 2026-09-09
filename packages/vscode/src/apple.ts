import * as vscode from "vscode";
import {
  day, directPersonLinks, personContext, tasks,
  type PersonContext,
} from "@lifeloop/semantic-core";
import {
  Reminders, Calendar, Notes, appAvailable, syncReminders, boundTasks, bindReminder, bindCalendar,
  planImport, applyImport, syncCalendar, type ObservationStore, type Observation, type ImportState,
  type CalendarObservationStore, type CalendarObservation,
  resolveCalendarConflict, resolveNoteConflict, resolveReminderConflict,
  type CalendarEvent,
  type CalendarExactRead,
} from "@lifeloop/apple-bridge";
import type { LifeLoop } from "./workspace.ts";
import { refreshTaskTarget, taskTarget, type TaskCommandHandle, type TaskTargetInput } from "./task-target.ts";
import { personLink, sourceLink } from "./temporary-navigation.ts";

type SyncConflict =
  | { kind: "calendar"; id: string; ref: string; local: string; remote: string; reason: string }
  | { kind: "reminder"; id: string; ref: string; local: string; remote: string; reason: string }
  | { kind: "notes"; id: string; local: string; remote: string; reason: string };

const markdownText = (value: unknown): string => String(value ?? "")
  .replace(/[\r\n]+/g, " ")
  .replace(/([\\`*_[\]<>#])/g, "\\$1")
  .trim();

/** A temporary, read-only projection of authoritative Calendar and Markdown facts. */
type BriefLinks = {
  person: (person: string, label: string) => string;
  source: (ref: string) => string;
};

export function renderPreMeetingBrief(
  event: CalendarEvent,
  contexts: PersonContext[],
  links?: BriefLinks,
): string {
  const when = [event.start && markdownText(event.start), event.end && markdownText(event.end)]
    .filter(Boolean).join("–");
  const where = markdownText(event.location);
  const lines = [
    "# Pre-meeting Brief",
    "",
    `**${markdownText(event.summary)}**`,
    [when, where].filter(Boolean).join(" · "),
  ];
  for (const context of contexts) {
    const person = String(context.person.ref);
    const name = person.split("/").at(-1) ?? person;
    const last = context.lastInteraction;
    const followups = links && context.openFollowups.length
      ? ` · ${context.openFollowups.map((task) => links.source(String(task.ref))).join(", ")}`
      : "";
    lines.push(
      "",
      `## ${links ? links.person(person, name) : markdownText(name)}`,
      "",
      `- Last interaction: ${last ? `${last.date} · ${markdownText(last.kind)}` : "none recorded"}`,
      `- Open follow-ups: ${context.openFollowups.length}${followups}`,
    );
    if (context.interactions.length) {
      lines.push("- Recent context:");
      for (const entry of context.interactions.slice(0, 5)) {
        lines.push(`  - ${entry.date} · ${markdownText(entry.kind)} · ${markdownText(entry.text)}` +
          (links ? ` · ${links.source(entry.ref)}` : ""));
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

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

class WorkspaceCalendarObservations implements CalendarObservationStore {
  private static readonly KEY = "lifeloop.calendarObservations";
  private readonly cache: Record<string, CalendarObservation>;
  constructor(private readonly memento: vscode.Memento) {
    this.cache = memento.get(WorkspaceCalendarObservations.KEY, {});
  }
  get(id: string) { return this.cache[id]; }
  set(id: string, value: CalendarObservation) {
    this.cache[id] = value;
    void this.memento.update(WorkspaceCalendarObservations.KEY, this.cache);
  }
  delete(id: string) {
    delete this.cache[id];
    void this.memento.update(WorkspaceCalendarObservations.KEY, this.cache);
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

type BriefTarget = {
  handle: TaskCommandHandle;
  uid: string;
  calendarName: string;
  directPeople: string[];
};

type BriefOptions = {
  available?: () => Promise<boolean>;
  readExact?: (uid: string, calendarName: string) => Promise<CalendarExactRead>;
  open?: (markdown: string) => Promise<unknown> | unknown;
};

async function validateBrief(
  lifeloop: LifeLoop,
  input: TaskTargetInput | undefined,
  sealed?: BriefTarget,
): Promise<BriefTarget | string> {
  await lifeloop.currentTaskStates();
  const target = taskTarget(lifeloop, input);
  if (!target?.task) return "put the cursor on an indexed task";
  const matches = [...target.line.matchAll(/\[event:\s*"([^"\r\n]+)"\]/g)];
  if (matches.length !== 1) return "this task needs exactly one Calendar binding";
  const directPeople = directPersonLinks(lifeloop.store, target.task);
  if (!directPeople.length) return "add a direct Person link to this task first";
  const current: BriefTarget = {
    handle: target.handle,
    uid: matches[0][1],
    calendarName: lifeloop.config("calendarName", "Calendar"),
    directPeople,
  };
  if (sealed && (
    current.handle.ref !== sealed.handle.ref ||
    current.handle.expectedText !== sealed.handle.expectedText ||
    current.handle.expectedState !== sealed.handle.expectedState ||
    current.uid !== sealed.uid ||
    current.calendarName !== sealed.calendarName ||
    JSON.stringify(current.directPeople) !== JSON.stringify(sealed.directPeople)
  )) return "the task, linked People, event, or configured calendar changed while preparing the brief";
  return current;
}

export async function openPreMeetingBrief(
  lifeloop: LifeLoop,
  input?: TaskTargetInput,
  options: BriefOptions = {},
): Promise<void> {
  const warn = (message: string) => void vscode.window.showWarningMessage(`LifeLoop: ${message}`);
  const initial = await validateBrief(lifeloop, input);
  if (typeof initial === "string") { warn(initial); return; }

  const available = options.available ?? (() => requireApp("Calendar"));
  if (!(await available())) return;
  const ready = await validateBrief(lifeloop, { handle: initial.handle }, initial);
  if (typeof ready === "string") { warn(ready); return; }

  const readExact = options.readExact ?? ((uid: string, calendarName: string) =>
    new Calendar().readExact(uid, calendarName));
  const result = await readExact(initial.uid, initial.calendarName);
  const final = await validateBrief(lifeloop, { handle: initial.handle }, initial);
  if (typeof final === "string") { warn(final); return; }
  if (result.kind !== "found") {
    warn(result.kind === "missing" ? "event is missing" : "event binding is ambiguous in Calendar");
    return;
  }

  const contexts = final.directPeople.map((person) => personContext(lifeloop.store, person));
  if (contexts.some((context) => context === null)) {
    warn("a linked Person changed while preparing the brief");
    return;
  }
  const markdown = renderPreMeetingBrief(result.event, contexts as PersonContext[], {
    person: (person, label) => personLink(lifeloop, person, label),
    source: (ref) => sourceLink(lifeloop, ref),
  });
  const open = options.open ?? (async (content: string) => {
    const document = await vscode.workspace.openTextDocument({ content, language: "markdown" });
    await vscode.window.showTextDocument(document, { preview: true });
  });
  await open(markdown);
}

export function registerApple(lifeloop: LifeLoop, context: vscode.ExtensionContext): void {
  const on = (name: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(name, handler));
  const observations = new WorkspaceObservations(context.workspaceState);
  const calendarObservations = new WorkspaceCalendarObservations(context.workspaceState);
  const notesKey = "lifeloop.noteObservations";
  const conflictsKey = "lifeloop.syncConflicts";
  const conflicts = new Map(
    context.workspaceState.get<SyncConflict[]>(conflictsKey, []).map((item) => [`${item.kind}:${item.id}`, item]),
  );
  const audit = vscode.window.createOutputChannel("LifeLoop Sync");
  context.subscriptions.push(audit);
  const persistConflicts = () => context.workspaceState.update(conflictsKey, [...conflicts.values()]);
  const auditLine = (message: string) => audit.appendLine(`${new Date().toISOString()}  ${message}`);
  const importState: ImportState = {
    lastImported: new Map(Object.entries(context.workspaceState.get<Record<string, { text: string; modified: string }>>(notesKey, {}))),
  };

  // 2a — project a task outward. The id lands on the task line, so the binding is
  // rediscoverable from Markdown alone and no side table has to be kept in step.
  on("lifeloop.addReminder", async (input?: TaskTargetInput) => {
    const at = taskTarget(lifeloop, input);
    if (!at) { vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
    if (!(await requireApp("Reminders"))) return;

    const list = lifeloop.config("reminderList", "");
    try {
      const current = await refreshTaskTarget(lifeloop, at);
      if (!current) { vscode.window.showWarningMessage("LifeLoop: that task changed; no reminder was added"); return; }
      const result = await bindReminder(
        lifeloop.vault, current.handle, current.name, "", list, new Reminders(),
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
  on("lifeloop.addToCalendar", async (input?: TaskTargetInput) => {
    const at = taskTarget(lifeloop, input);
    if (!at) { vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
    if (!(await requireApp("Calendar"))) return;

    const when = await vscode.window.showInputBox({
      prompt: "When? (YYYY-MM-DD HH:MM)",
      value: `${day()} 09:00`,
      validateInput: (v) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v) ? null : "YYYY-MM-DD HH:MM"),
    });
    if (!when) return;

    try {
      const current = await refreshTaskTarget(lifeloop, at);
      if (!current) { vscode.window.showWarningMessage("LifeLoop: that task changed; no event was added"); return; }
      const minutes = lifeloop.config("eventMinutes", 60);
      const start = new Date(when.replace(" ", "T"));
      const end = new Date(start.getTime() + minutes * 60_000);
      const fmt = (d: Date) => d.toLocaleString("en-US");
      const calendarName = lifeloop.config("calendarName", "Calendar");
      const result = await bindCalendar(
        lifeloop.vault, current.handle, current.name, fmt(start), fmt(end), calendarName, new Calendar(),
      );
      if (!result.ok) { vscode.window.showWarningMessage(`LifeLoop: ${result.message}`); return; }
      const uid = result.value.id;
      calendarObservations.set(uid, { localName: current.name, remoteSummary: current.name });
      await lifeloop.reindex();
      vscode.window.setStatusBarMessage("LifeLoop: added to calendar", 3000);
    } catch (error) {
      vscode.window.showErrorMessage(`LifeLoop: ${(error as Error).message}`);
    }
  });

  on("lifeloop.preMeetingBrief", async (input?: TaskTargetInput) => {
    try {
      await openPreMeetingBrief(lifeloop, input);
    } catch (error) {
      auditLine(`Pre-meeting Brief failed: ${(error as Error).message}`);
      vscode.window.showErrorMessage(`LifeLoop: Pre-meeting Brief failed — ${(error as Error).message}`);
    }
  });

  // External task projections. Each bridge keeps its own ownership rules.
  on("lifeloop.syncProjected", async () => {
    const reminderTasks = boundTasks(lifeloop.store);
    const calendarTasks = tasks.universe(lifeloop.store)
      .filter((task) => typeof task.event === "string" && task.event)
      .map((task) => ({ ref: String(task.ref), id: String(task.event) }));
    const active = new Set([
      ...reminderTasks.map((task) => `reminder:${task.reminderId}`),
      ...calendarTasks.map((task) => `calendar:${task.id}`),
    ]);
    for (const key of conflicts.keys()) {
      if ((key.startsWith("reminder:") || key.startsWith("calendar:")) && !active.has(key)) conflicts.delete(key);
    }
    if (!reminderTasks.length && !calendarTasks.length) {
      await persistConflicts();
      vscode.window.setStatusBarMessage("LifeLoop: nothing projected yet", 3000);
      return;
    }

    const recurring: string[] = [];
    try {
      const parts: string[] = [];
      const refusals: { ref: string; message: string }[] = [];
      if (reminderTasks.length && await requireApp("Reminders")) {
        const taskStates = await lifeloop.currentTaskStates();
        const report = await syncReminders({
          store: lifeloop.store, vault: lifeloop.vault, observations,
          reminders: new Reminders(), taskStates,
          isTaskPolicyCurrent: async () =>
            JSON.stringify(await lifeloop.currentTaskStates()) === JSON.stringify(taskStates),
          onRecurring: (task) => recurring.push(task.name),
        });
        if (report.completed.length) parts.push(`${report.completed.length} completed`);
        if (report.reopened.length) parts.push(`${report.reopened.length} reopened`);
        if (report.pushed.length) parts.push(`${report.pushed.length} reminders pushed`);
        if (report.pulled.length) parts.push(`${report.pulled.length} reminder titles pulled`);
        if (report.marksCleared.length) parts.push(`${report.marksCleared.length} stale marks cleared`);
        for (const conflict of report.conflicts) {
          conflicts.set(`reminder:${conflict.reminderId}`, {
            kind: "reminder", id: conflict.reminderId, ref: conflict.ref,
            local: conflict.local, remote: conflict.remote, reason: conflict.reason,
          });
          auditLine(`Reminder conflict ${conflict.ref}: ${conflict.reason}`);
        }
        const unresolved = new Set([
          ...report.conflicts.map((item) => item.ref),
          ...report.refused.map((item) => item.ref),
        ]);
        for (const task of reminderTasks) {
          if (!unresolved.has(task.ref)) conflicts.delete(`reminder:${task.reminderId}`);
        }
        if (report.conflicts.length) parts.push(`${report.conflicts.length} reminder conflicts`);
        refusals.push(...report.refused);
        await lifeloop.reindex();
      }
      if (calendarTasks.length && await requireApp("Calendar")) {
        const report = await syncCalendar({
          store: lifeloop.store, vault: lifeloop.vault,
          calendarName: lifeloop.config("calendarName", "Calendar"),
          observations: calendarObservations,
        });
        for (const uid of report.settled) conflicts.delete(`calendar:${uid}`);
        if (report.pulled.length) parts.push(`${report.pulled.length} calendar titles pulled`);
        if (report.pushed.length) parts.push(`${report.pushed.length} calendar titles pushed`);
        for (const conflict of report.conflicts) {
          conflicts.set(`calendar:${conflict.uid}`, {
            kind: "calendar", id: conflict.uid, ref: conflict.ref,
            local: conflict.local, remote: conflict.remote, reason: conflict.reason,
          });
          auditLine(`Calendar conflict ${conflict.ref}: ${conflict.reason}; Markdown="${conflict.local}", Calendar="${conflict.remote}"`);
        }
        if (report.conflicts.length) parts.push(`${report.conflicts.length} calendar conflicts`);
        refusals.push(...report.refused);
        await lifeloop.reindex();
      }
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
      for (const refusal of refusals) {
        auditLine(`${refusal.ref}: ${refusal.message}`);
        vscode.window.showWarningMessage(`LifeLoop: ${refusal.ref} — ${refusal.message}`);
      }
      await persistConflicts();
      if (conflicts.size) {
        const action = await vscode.window.showWarningMessage(
          `LifeLoop: ${conflicts.size} external sync conflict(s) need attention; both versions were kept.`,
          "Resolve", "Show Log",
        );
        if (action === "Resolve") await vscode.commands.executeCommand("lifeloop.resolveSyncConflict");
        if (action === "Show Log") audit.show(true);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`LifeLoop: sync failed — ${(error as Error).message}`);
    }
  });

  // Notes and pending Inbox lines sync their shared plain-text first line.
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
      const result = await applyImport(lifeloop.vault, inbox, plan, importState, new Notes());
      for (const id of result.settled) conflicts.delete(`notes:${id}`);
      await context.workspaceState.update(notesKey, Object.fromEntries(importState.lastImported));
      await lifeloop.reindex();

      const bits = [`${result.created} new`];
      if (result.updated) bits.push(`${result.updated} updated`);
      if (result.pushed) bits.push(`${result.pushed} pushed to Notes`);
      for (const conflict of result.conflicts) {
        conflicts.set(`notes:${conflict.id}`, { kind: "notes", ...conflict });
        auditLine(`Notes conflict ${conflict.id}: ${conflict.reason}`);
      }
      if (result.conflicts.length) bits.push(`${result.conflicts.length} conflicts`);
      vscode.window.setStatusBarMessage(`LifeLoop: Notes ${bits.join(", ")}`, 5000);
      for (const refusal of result.refused) {
        void vscode.window.showWarningMessage(
          `LifeLoop: Apple Note ${refusal.id} ${refusal.action} failed — ${refusal.message}`,
        );
      }
      await persistConflicts();
      if (result.conflicts.length) {
        const action = await vscode.window.showWarningMessage(
          `LifeLoop: ${result.conflicts.length} Notes conflict(s); both versions were kept.`,
          "Resolve", "Show Log",
        );
        if (action === "Resolve") await vscode.commands.executeCommand("lifeloop.resolveSyncConflict");
        if (action === "Show Log") audit.show(true);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`LifeLoop: import failed — ${(error as Error).message}`);
    }
  });

  on("lifeloop.resolveSyncConflict", async () => {
    if (!conflicts.size) {
      vscode.window.setStatusBarMessage("LifeLoop: no sync conflicts", 3000);
      return;
    }
    const picked = await vscode.window.showQuickPick(
      [...conflicts.values()].map((item) => ({
        label: `${item.kind === "calendar" ? "$(calendar)" : item.kind === "reminder" ? "$(bell)" : "$(note)"} ${item.local || item.id}`,
        description: item.reason,
        detail: item.remote ? `Apple: ${item.remote.slice(0, 160)}` : "Apple item missing",
        item,
      })),
      { placeHolder: "Resolve which external sync conflict?" },
    );
    if (!picked) return;
    const item = picked.item;
    const choice = await vscode.window.showQuickPick([
      { label: "$(cloud-upload) Use Markdown", detail: "overwrite the current Apple value after a fresh comparison", id: "markdown" },
      { label: "$(cloud-download) Use Apple", detail: "replace the LifeLoop value with the current Apple value", id: item.kind === "calendar" ? "calendar" : item.kind === "reminder" ? "reminders" : "notes" },
      { label: "$(debug-disconnect) Detach", detail: "keep both values and stop syncing this item", id: "detach" },
    ], { placeHolder: `${item.local || item.id} — both versions remain until one succeeds` });
    if (!choice) return;

    let result;
    if (item.kind === "calendar") {
      if (!(await requireApp("Calendar"))) return;
      const at = item.ref.lastIndexOf("@");
      result = await resolveCalendarConflict({
        vault: lifeloop.vault, page: at === -1 ? item.ref : item.ref.slice(0, at), uid: item.id,
        calendarName: lifeloop.config("calendarName", "Calendar"),
        choice: choice.id as "calendar" | "markdown" | "detach",
        expectedLocal: item.local, expectedRemote: item.remote,
        observations: calendarObservations,
      });
    } else if (item.kind === "reminder") {
      if (!(await requireApp("Reminders"))) return;
      const at = item.ref.lastIndexOf("@");
      result = await resolveReminderConflict({
        vault: lifeloop.vault, page: at === -1 ? item.ref : item.ref.slice(0, at),
        reminderId: item.id, choice: choice.id as "reminders" | "markdown" | "detach",
        expectedLocal: item.local, expectedRemote: item.remote,
        observations,
      });
    } else {
      if (!(await requireApp("Notes"))) return;
      const folder = lifeloop.config("notesFolder", "LifeLoop Inbox");
      const note = (await new Notes().list(folder)).find((candidate) => candidate.id === item.id);
      if (!note) {
        void vscode.window.showWarningMessage("LifeLoop: the Apple Note is missing; edit or detach its source-id manually");
        return;
      }
      result = await resolveNoteConflict(
        lifeloop.vault, lifeloop.config("inboxPage", "Inbox"), note,
        choice.id as "notes" | "markdown" | "detach", importState, new Notes(),
        { local: item.local, remote: item.remote },
      );
      await context.workspaceState.update(notesKey, Object.fromEntries(importState.lastImported));
    }
    if (!result.ok) {
      auditLine(`resolution failed for ${item.kind}:${item.id}: ${result.message}`);
      audit.show(true);
      void vscode.window.showWarningMessage(`LifeLoop: ${result.message}`);
      return;
    }
    conflicts.delete(`${item.kind}:${item.id}`);
    await persistConflicts();
    await lifeloop.reindex();
    auditLine(`resolved ${item.kind}:${item.id} using ${choice.id}`);
    vscode.window.setStatusBarMessage(`LifeLoop: sync conflict resolved using ${choice.label.replace(/^\$\([^)]*\)\s*/, "")}`, 4000);
  });

  on("lifeloop.openExternalBinding", async (input?: { kind?: "reminder" | "event" }) => {
    if (input?.kind === "reminder") await requireApp("Reminders");
    else if (input?.kind === "event") await requireApp("Calendar");
  });

  on("lifeloop.syncExternal", async () => {
    await vscode.commands.executeCommand("lifeloop.syncProjected");
    await vscode.commands.executeCommand("lifeloop.importNotes");
  });
  on("lifeloop.showSyncReport", () => audit.show(true));

  // A timer, off by default. Nothing surprising happens to someone's calendar or
  // reminders because they installed an extension.
  let timer: NodeJS.Timeout | undefined;
  const schedule = () => {
    clearInterval(timer);
    if (!lifeloop.config("autoSync", false)) return;
    const minutes = Math.max(1, lifeloop.config("syncMinutes", 5));
    timer = setInterval(
      () => void vscode.commands.executeCommand("lifeloop.syncExternal"),
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
