import * as vscode from "vscode";
import {
  capture, captureHere, ensureInbox, pending, processItem, linkToProject, makeTask, setTaskState, toggleParked, moveItem,
  setTaskAttribute, setProjectStatus, attachPageToTask, freezeReview,
  PROJECT_STATES, review, week, day,
  readTemplate, builtinReviewTemplate, createFromTemplate,
  bakeAt, unbakeAt, updateBaked,
  people, directPersonLinks, logInteraction, createReconnectTask, INTERACTION_KINDS, shift,
  tasks, explainTask,
  type InboxItem, type Refusal,
  type InteractionKind,
} from "@lifeloop/semantic-core";
import type { LifeLoop } from "./workspace.ts";
import type { Node } from "./views.ts";
import { openSbRef, scriptNamespaces } from "./retrieval.ts";
import { evaluateToMarkdown } from "./lua.ts";
import {
  refreshTaskTarget, taskTarget, taskTargetFromIndexed,
  type TaskTarget, type TaskTargetInput,
} from "./task-target.ts";

type RecoveryTarget = Pick<TaskTarget, "page" | "offset">;

/**
 * Every command goes through a named mutation (I5). None of them writes a file
 * directly, and a refusal is *shown*, never swallowed — a mutation that quietly
 * did nothing is indistinguishable from one that silently did the wrong thing.
 */
function report(result: { ok: true } | Refusal, success: string, recovery?: RecoveryTarget): boolean {
  if (result.ok) {
    vscode.window.setStatusBarMessage(`LifeLoop: ${success}`, 3000);
    return true;
  }
  const recoverable = (m: string) => {
    if (!recovery) {
      void vscode.window.showWarningMessage(`LifeLoop: ${m}`);
      return;
    }
    void vscode.window.showWarningMessage(`LifeLoop: ${m}`, "Open Source", "Refresh").then((choice) => {
      if (choice === "Open Source") void vscode.commands.executeCommand("lifeloop.revealTask", recovery);
      if (choice === "Refresh") void vscode.commands.executeCommand("lifeloop.reindex");
    });
  };
  const messages: Record<Refusal["reason"], (m: string) => void> = {
    cancelled: () => {},
    stale: recoverable,
    missing: recoverable,
    ambiguous: recoverable,
    collision: recoverable,
    invalid: (m) => void vscode.window.showErrorMessage(`LifeLoop: ${m}`),
    unknown: (m) => void vscode.window.showErrorMessage(`LifeLoop: ${m}`),
  };
  messages[result.reason](result.message);
  return false;
}

const exactEventBinding = (line: string): string | undefined => {
  const matches = [...line.matchAll(/\[event:\s*"([^"\r\n]+)"\]/g)];
  return matches.length === 1 ? matches[0][1] : undefined;
};

export async function recordInteraction(
  lifeloop: LifeLoop,
  candidates: string[],
  defaultKind?: InteractionKind,
  source?: TaskTarget,
  expectedEvent?: string,
): Promise<void> {
  const refresh = async (selected: string[]): Promise<TaskTarget | true | null> => {
    await lifeloop.currentTaskStates();
    if (!source) {
      const current = new Set(people(lifeloop.store).map((person) => String(person.ref)));
      return selected.every((person) => current.has(person)) ? true : null;
    }
    const target = taskTarget(lifeloop, source);
    if (!target?.task) return null;
    const direct = directPersonLinks(lifeloop.store, target.task);
    if (!selected.every((person) => direct.includes(person))) return null;
    if (expectedEvent !== undefined && exactEventBinding(target.line) !== expectedEvent) return null;
    return target;
  };
  const current = async (selected: string[]) => {
    try { return await refresh(selected); }
    catch (error) {
      void vscode.window.showErrorMessage(`LifeLoop: ${(error as Error).message}`);
      return null;
    }
  };
  const stale = () => void vscode.window.showWarningMessage(
    "LifeLoop: the task or a selected Person changed; no interaction was logged",
  );

  if (!(await current(candidates))) { stale(); return; }
  const selected = candidates.length === 1
    ? candidates
    : (await vscode.window.showQuickPick(
      candidates.map((person) => ({
        label: person.split("/").at(-1) ?? person,
        description: person,
        id: person,
      })),
      { placeHolder: "Who was involved?", canPickMany: true },
    ))?.map((item) => item.id);
  if (!selected?.length) return;
  if (!(await current(selected))) { stale(); return; }

  const kinds = defaultKind
    ? [defaultKind, ...INTERACTION_KINDS.filter((kind) => kind !== defaultKind)]
    : [...INTERACTION_KINDS];
  const picked = await vscode.window.showQuickPick(
    kinds.map((id) => ({ label: id, id })), { placeHolder: "Interaction type" },
  );
  if (!picked) return;
  if (!(await current(selected))) { stale(); return; }

  const note = await vscode.window.showInputBox({
    prompt: `What happened with ${selected.map((person) => person.split("/").at(-1)).join(", ")}?`,
    placeHolder: "optional note",
  });
  if (note === undefined) return;
  const final = await current(selected);
  if (!final) { stale(); return; }

  const date = day();
  const journalFolder = "Journal";
  if (lifeloop.vault.isDirty(`${journalFolder}/${date}.md`)) {
    void vscode.window.showWarningMessage("LifeLoop: save the Journal page before logging an interaction");
    return;
  }
  const expectedSources = final === true
    ? new Map<string, string>()
    : new Map([[`${final.page}.md`, final.sourceText]]);
  if (report(await logInteraction(
    lifeloop.vault, selected, date, picked.id as InteractionKind, note,
    journalFolder, expectedSources,
  ), "interaction logged")) await lifeloop.reindex();
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

async function openTaskProject(lifeloop: LifeLoop, target: TaskTarget): Promise<void> {
  const linked = new Set((target.task?.ilinks as string[] | undefined) ?? []);
  const projects = lifeloop.store.objects("page")
    .filter((page) => (page.itags as string[] | undefined)?.includes("project"))
    .map((page) => String(page.ref))
    .filter((page) => page === target.page || linked.has(page))
    .sort();
  if (!projects.length) {
    void vscode.window.showWarningMessage("LifeLoop: this task has no linked project");
    return;
  }
  const page = projects.length === 1
    ? projects[0]
    : await vscode.window.showQuickPick(projects, { placeHolder: "Open which project?" });
  if (page) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(lifeloop.pageUri(page)));
}

function activePerson(lifeloop: LifeLoop, input?: { page?: string }): string | null {
  const page = input?.page ?? (vscode.window.activeTextEditor?.document.languageId === "markdown"
    ? lifeloop.pageNameOfUri(vscode.window.activeTextEditor.document.uri) : undefined);
  return page && people(lifeloop.store).some((candidate) => candidate.ref === page) ? page : null;
}

export function register(lifeloop: LifeLoop, context: vscode.ExtensionContext): void {
  const on = (name: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(name, handler));

  const after = async () => { await lifeloop.reindex(); };
  const refreshAndReport = async (
    result: { ok: true } | Refusal,
    success: string,
    recovery?: RecoveryTarget,
  ): Promise<boolean> => {
    if (!result.ok) return report(result, success, recovery);
    try {
      await after();
    } catch (error) {
      void vscode.window.showErrorMessage(
        `LifeLoop: saved locally, but views did not refresh: ${(error as Error).message}`,
      );
      return false;
    }
    vscode.window.setStatusBarMessage(`LifeLoop: ${success}`, 3000);
    return true;
  };

  const setTaskDate = async (
    at: TaskTarget,
    field: "deadline" | "scheduled",
    value: string | null,
  ): Promise<boolean> => {
    let refreshed;
    try {
      refreshed = await refreshTaskTarget(lifeloop, at);
    } catch (error) {
      void vscode.window.showErrorMessage(`LifeLoop: ${(error as Error).message}`);
      return false;
    }
    const current = refreshed && taskTarget(lifeloop, refreshed);
    if (!current) {
      void vscode.window.showWarningMessage(`LifeLoop: that task changed; ${field} was not set`);
      return false;
    }
    const deadline = typeof current.task?.deadline === "string" ? current.task.deadline : undefined;
    const result = await setTaskAttribute(lifeloop.vault, current.handle, field, value);
    const changed = value === null ? `cleared ${field}` : `set ${field} to ${value}`;
    const detail = field === "scheduled" && deadline ? `${changed}; deadline ${deadline} unchanged` : changed;
    return refreshAndReport(result, detail, current);
  };

  // 1.7 — Capture. Costs less than filing does: one box, no navigation.
  on("lifeloop.capture", async () => {
    const line = await vscode.window.showInputBox({
      prompt: "Capture to Inbox",
      placeHolder: "a thought, a task, anything",
    });
    if (line === undefined) return;
    const page = lifeloop.config("inboxPage", "Inbox");
    await refreshAndReport(await capture(lifeloop.vault, line, page), "captured");
  });

  on("lifeloop.captureHere", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") {
      void vscode.window.showWarningMessage("LifeLoop: open a Markdown page first");
      return;
    }
    const document = editor.document;
    const expected = document.getText();
    const currentLine = document.lineAt(editor.selection.active.line);
    const offset = document.offsetAt(currentLine.rangeIncludingLineBreak.end);
    const line = await vscode.window.showInputBox({
      prompt: `Capture task here in ${lifeloop.pageNameOfUri(document.uri)}`,
      placeHolder: "next action",
    });
    if (line === undefined) return;
    const page = lifeloop.pageNameOfUri(document.uri);
    await refreshAndReport(
      await captureHere(lifeloop.vault, page, offset, line, expected), "captured here", { page, offset },
    );
  });

  on("lifeloop.openInbox", async () => {
    const page = lifeloop.config("inboxPage", "Inbox");
    const result = await ensureInbox(lifeloop.vault, page);
    if (!report(result, result.ok && result.value.existed ? "inbox opened" : "inbox created")) return;
    if (result.ok && !result.value.existed) await after();
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(lifeloop.pageUri(page)));
  });

  on("lifeloop.logInteraction", async (input?: TaskTargetInput) => {
    if (input?.handle) {
      const target = taskTarget(lifeloop, input);
      if (!target?.task) {
        void vscode.window.showWarningMessage("LifeLoop: that task changed; no interaction was logged");
        return;
      }
      const linkedPeople = directPersonLinks(lifeloop.store, target.task);
      if (!linkedPeople.length) return;
      const event = exactEventBinding(target.line);
      await recordInteraction(lifeloop, linkedPeople, event ? "meeting" : undefined, target, event);
      return;
    }
    const person = activePerson(lifeloop, input);
    if (!person) { void vscode.window.showWarningMessage("LifeLoop: open a page tagged `person`"); return; }
    await recordInteraction(lifeloop, [person]);
  });

  on("lifeloop.createReconnectTask", async (input?: Pick<Node, "page">) => {
    const person = activePerson(lifeloop, input);
    if (!person) { void vscode.window.showWarningMessage("LifeLoop: open a page tagged `person`"); return; }
    const scheduled = await vscode.window.showInputBox({
      prompt: `Reconnect with ${person} on (YYYY-MM-DD)`, value: shift(day(), 7),
      validateInput: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : "YYYY-MM-DD",
    });
    if (!scheduled) return;
    const page = lifeloop.config("inboxPage", "Inbox");
    await refreshAndReport(await createReconnectTask(lifeloop.vault, person, scheduled, page), "follow-up created");
  });

  // 1.8 — Process Inbox. Link before Move: the captured wording stays where it happened.
  on("lifeloop.processInbox", async (preselected?: InboxItem) => {
    const page = lifeloop.config("inboxPage", "Inbox");
    const continuous = preselected === undefined;
    let selected = preselected;
    let cursor = 0;
    for (;;) {
      let text: string;
      try { text = lifeloop.vault.read(`${page}.md`); } catch {
        void vscode.window.showWarningMessage(`LifeLoop: no ${page} page`);
        return;
      }
      const items = pending(text);
      if (!items.length) {
        vscode.window.setStatusBarMessage("LifeLoop: inbox is empty", 3000);
        return;
      }
      const item = selected
        ? items.find((candidate) => candidate.offset === selected!.offset && candidate.text === selected!.text)
        : items[cursor];
      if (!selected && !item) {
        vscode.window.setStatusBarMessage(`LifeLoop: reached the end; ${items.length} skipped`, 3000);
        return;
      }
      if (!item) {
        void vscode.window.showWarningMessage("LifeLoop: that Inbox item changed; nothing was moved");
        return;
      }
      const action = await vscode.window.showQuickPick(
        [
          { label: "$(link) Link project", detail: "append [[Project]], leave the wording where it is", id: "link" },
          { label: "$(circle-outline) Make task", detail: "turn it into a checkbox", id: "task" },
          { label: "$(arrow-right) Skip", detail: "leave pending and continue with the next item", id: "skip" },
          { label: "$(edit) Edit source", detail: "open this item in the Inbox, then resume later", id: "edit" },
          { label: "$(archive) Archive", detail: "move it under Processed unchanged", id: "archive" },
        ],
        { placeHolder: item.text.split("\n")[0] },
      );
      if (!action) return;
      if (action.id === "skip") {
        if (!continuous) return;
        cursor++;
        selected = undefined;
        continue;
      }
      if (action.id === "edit") {
        const current = lifeloop.vault.read(`${page}.md`);
        if (current.slice(item.offset, item.end) !== item.text) {
          void vscode.window.showWarningMessage("LifeLoop: that Inbox item changed; open the Inbox and choose it again");
          return;
        }
        const document = await vscode.workspace.openTextDocument(lifeloop.pageUri(page));
        const editor = await vscode.window.showTextDocument(document);
        const position = document.positionAt(item.offset);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        return;
      }

      let ok = false;
      if (action.id === "task") {
        const projects = lifeloop.store.objects("page")
          .filter((p) => (p.itags as string[] | undefined)?.includes("project"))
          .map((p) => String(p.ref)).sort();
        const project = await vscode.window.showQuickPick(
          [{ label: "$(arrow-right) Skip project", id: "" }, ...projects.map((name) => ({ label: `$(project) ${name}`, id: name }))],
          { placeHolder: "Project?" },
        );
        if (!project) return;
        const when = await vscode.window.showQuickPick([
          { label: "$(arrow-right) Skip timing", id: "skip" },
          { label: "$(calendar) Today", id: "today" },
          { label: "$(calendar) Pick date…", id: "date" },
          { label: "$(watch) Waiting", id: "waiting" },
        ], { placeHolder: "When?" });
        if (!when) return;
        let scheduled: string | undefined;
        if (when.id === "today") scheduled = day();
        if (when.id === "date") {
          scheduled = await vscode.window.showInputBox({
            prompt: "Scheduled date (YYYY-MM-DD)", value: day(),
            validateInput: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : "YYYY-MM-DD",
          });
          if (!scheduled) return;
        }
        ok = await refreshAndReport(await makeTask(lifeloop.vault, item, page, {
          project: project.id || undefined, scheduled, waiting: when.id === "waiting",
        }), "made a task", { page, offset: item.offset });
      }
      else if (action.id === "archive") {
        ok = await refreshAndReport(
          await processItem(lifeloop.vault, item, null, page), "processed", { page, offset: item.offset },
        );
      }
      else {
        const project = await pickProject(lifeloop);
        if (!project) return;
        ok = await refreshAndReport(
          await linkToProject(lifeloop.vault, item, project, page),
          `linked to ${project}`, { page, offset: item.offset },
        );
      }
      if (!ok) return;
      if (!continuous) return;
      selected = undefined;
    }
  });

  // 1.10 — ticking from a view, against the node's own handle.
  on("lifeloop.completeTask", async (input?: TaskTargetInput) => {
    const target = taskTarget(lifeloop, input);
    if (!target) { void vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
    try {
      const states = await lifeloop.currentTaskStates();
      const current = taskTarget(lifeloop, target);
      if (!current) { void vscode.window.showWarningMessage("LifeLoop: that task changed; nothing was completed"); return; }
      await refreshAndReport(
        await setTaskState(lifeloop.vault, current.handle, true, new Date(), states), "completed", current,
      );
    } catch (error) {
      void vscode.window.showErrorMessage(`LifeLoop: ${(error as Error).message}`);
    }
  });

  on("lifeloop.reopenTask", async (input?: TaskTargetInput) => {
    const target = taskTarget(lifeloop, input);
    if (!target) { void vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
    try {
      const states = await lifeloop.currentTaskStates();
      const current = taskTarget(lifeloop, target);
      if (!current) { void vscode.window.showWarningMessage("LifeLoop: that task changed; nothing was reopened"); return; }
      await refreshAndReport(
        await setTaskState(lifeloop.vault, current.handle, false, new Date(), states), "reopened", current,
      );
    } catch (error) {
      void vscode.window.showErrorMessage(`LifeLoop: ${(error as Error).message}`);
    }
  });

  on("lifeloop.revealTask", async (node: Pick<Node, "page" | "offset">) => {
    if (!node?.page) return;
    const document = await vscode.workspace.openTextDocument(lifeloop.pageUri(node.page));
    const editor = await vscode.window.showTextDocument(document);
    const position = document.positionAt(node.offset ?? 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  });

  on("lifeloop.peekSource", async (input?: TaskTargetInput) => {
    const target = taskTarget(lifeloop, input);
    if (!target) { void vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
    const source = await vscode.workspace.openTextDocument(lifeloop.pageUri(target.page));
    const sourcePosition = source.positionAt(target.offset);
    const origin = vscode.window.activeTextEditor;
    await vscode.commands.executeCommand(
      "editor.action.peekLocations",
      origin?.document.uri ?? source.uri,
      origin?.selection.active ?? sourcePosition,
      [new vscode.Location(source.uri, source.lineAt(sourcePosition.line).range)],
      "peek",
    );
  });

  on("lifeloop.taskActions", async (input?: TaskTargetInput) => {
    let target = taskTarget(lifeloop, input);
    if (!target) { void vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
    try {
      await lifeloop.currentTaskStates();
      target = taskTarget(lifeloop, target);
    } catch (error) {
      void vscode.window.showErrorMessage(`LifeLoop: ${(error as Error).message}`);
      return;
    }
    if (!target) { void vscode.window.showWarningMessage("LifeLoop: that task changed; choose it again"); return; }
    const reminder = /\[reminder:\s*"([^"]+)"\]/.exec(target.line)?.[1];
    const event = exactEventBinding(target.line);
    const done = target.task?.done === true;
    const linkedPeople = target.task ? directPersonLinks(lifeloop.store, target.task) : [];
    const action = await vscode.window.showQuickPick([
      { label: done ? "$(circle-outline) Reopen" : "$(check) Complete", id: done ? "reopen" : "complete" },
      ...(linkedPeople.length ? [{ label: "$(comment-discussion) Log Interaction", id: "interaction" }] : []),
      ...(reminder
        ? [{ label: "$(sync) Sync Reminder", id: "sync" }, { label: "$(link-external) Open Reminders", id: "open-reminder" }, { label: "$(debug-disconnect) Detach Reminder", id: "detach-reminder" }]
        : [{ label: "$(bell) Add Reminder", id: "reminder" }]),
      ...(event
        ? [
          ...(linkedPeople.length ? [{ label: "$(preview) Pre-meeting Brief", id: "brief" }] : []),
          { label: "$(sync) Sync Calendar", id: "sync" },
          { label: "$(link-external) Open Calendar", id: "open-event" },
          { label: "$(debug-disconnect) Detach Calendar", id: "detach-event" },
        ]
        : [{ label: "$(calendar) Add to Calendar", id: "calendar" }]),
      { label: "$(calendar) Set Deadline", id: "deadline" },
      { label: "$(calendar) Quick Reschedule", id: "reschedule" },
      { label: "$(question) Why here?", id: "why" },
      { label: `${target.line.includes("#waiting") ? "$(close) Clear" : "$(watch) Mark"} Waiting`, id: "waiting" },
      { label: `${target.line.includes("#someday") ? "$(close) Clear" : "$(archive) Mark"} Someday`, id: "someday" },
      { label: "$(project) Open Project", id: "project" },
      { label: "$(preview) Peek Source", id: "peek" },
      { label: "$(go-to-file) Open Source", id: "source" },
    ], { placeHolder: target.name || "Task actions" });
    if (!action) return;
    if (action.id === "interaction") {
      return recordInteraction(lifeloop, linkedPeople, event ? "meeting" : undefined, target, event);
    }
    if (action.id === "brief") return vscode.commands.executeCommand("lifeloop.preMeetingBrief", target);
    if (action.id === "project") return openTaskProject(lifeloop, target);
    if (action.id === "why") return vscode.commands.executeCommand("lifeloop.explainTask", target);
    if (action.id === "sync") return vscode.commands.executeCommand("lifeloop.syncExternal");
    if (action.id === "open-reminder" || action.id === "open-event") {
      return vscode.commands.executeCommand("lifeloop.openExternalBinding", { kind: action.id === "open-reminder" ? "reminder" : "event" });
    }
    if (action.id === "detach-reminder" || action.id === "detach-event") {
      const kind = action.id === "detach-reminder" ? "reminder" : "event";
      return vscode.commands.executeCommand("lifeloop.detachBinding", {
        ...target, kind, id: kind === "reminder" ? reminder : event,
      });
    }
    const command: Record<string, string> = {
      complete: "lifeloop.completeTask",
      reopen: "lifeloop.reopenTask",
      reminder: "lifeloop.addReminder",
      calendar: "lifeloop.addToCalendar",
      deadline: "lifeloop.setDeadline",
      reschedule: "lifeloop.quickReschedule",
      waiting: "lifeloop.toggleWaiting",
      someday: "lifeloop.toggleSomeday",
      peek: "lifeloop.peekSource",
      source: "lifeloop.revealTask",
    };
    await vscode.commands.executeCommand(command[action.id], target);
  });

  on("lifeloop.findTask", async () => {
    try {
      await lifeloop.currentTaskStates();
      const items = tasks.universe(lifeloop.store).map((task) => {
        const target = taskTargetFromIndexed(lifeloop, task);
        const parked = (["waiting", "someday"] as const).find((tag) =>
          (task.itags as string[] | undefined)?.includes(tag));
        const status = task.done === true ? "completed" : parked ?? "actionable";
        const dates = [
          typeof task.deadline === "string" ? `deadline ${task.deadline}` : "",
          typeof task.scheduled === "string" ? `scheduled ${task.scheduled}` : "",
        ].filter(Boolean);
        const context = ((task.ilinks as string[] | undefined) ?? []).join(", ");
        return {
          label: String(task.name ?? "").trim() || "(empty task)",
          description: `${status} · ${String(task.page ?? "")}`,
          detail: [...dates, context].filter(Boolean).join(" · "),
          target,
        };
      }).filter((item) => item.target !== null)
        .sort((a, b) => a.label.localeCompare(b.label) || a.description.localeCompare(b.description));
      if (!items.length) {
        void vscode.window.showInformationMessage("LifeLoop: no indexed tasks with an available source");
        return;
      }
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: "Find task by text, status, source or context",
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (picked?.target) await vscode.commands.executeCommand("lifeloop.taskActions", picked.target);
    } catch (error) {
      void vscode.window.showErrorMessage(`LifeLoop: ${(error as Error).message}`);
    }
  });

  on("lifeloop.explainTask", async (input?: TaskTargetInput) => {
    const at = taskTarget(lifeloop, input);
    if (!at) { void vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
    const view = await vscode.window.showQuickPick([
      { label: "Today", id: "today" as const },
      { label: "Actionable", id: "actionable" as const },
    ], { placeHolder: "Explain membership in which view?" });
    if (!view) return;
    try {
      const current = await refreshTaskTarget(lifeloop, at);
      if (!current?.task) {
        void vscode.window.showWarningMessage("LifeLoop: that task changed; its current reason is unknown");
        return;
      }
      const explanation = explainTask(lifeloop.store, current.task, view.id, day());
      const relation = explanation.included ? "is in" : "is not in";
      const choice = await vscode.window.showInformationMessage(
        `LifeLoop: ${current.name || "this task"} ${relation} ${view.label}: ${explanation.reasons.join("; ")}`,
        "Open Source",
      );
      if (choice === "Open Source") await vscode.commands.executeCommand("lifeloop.revealTask", current);
    } catch (error) {
      void vscode.window.showErrorMessage(`LifeLoop: ${(error as Error).message}`);
    }
  });

  for (const tag of ["waiting", "someday"] as const) {
    on(`lifeloop.toggle${tag[0].toUpperCase()}${tag.slice(1)}`, async (input?: TaskTargetInput) => {
      const at = taskTarget(lifeloop, input);
      if (!at) { vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
      await refreshAndReport(await toggleParked(lifeloop.vault, at.handle, tag), `toggled #${tag}`, at);
    });
  }

  on("lifeloop.quickReschedule", async (input?: TaskTargetInput) => {
    const at = taskTarget(lifeloop, input);
    if (!at) { void vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
    const today = day();
    const tomorrow = shift(today, 1);
    const nextWeek = week(shift(today, 7)).start;
    const choice = await vscode.window.showQuickPick([
      { label: `$(calendar) Today — ${today}`, value: today },
      { label: `$(calendar) Tomorrow — ${tomorrow}`, value: tomorrow },
      { label: `$(calendar) Next week — ${nextWeek}`, value: nextWeek },
      { label: "$(calendar) Pick date…", value: "pick" },
      { label: "$(close) Clear scheduled", value: "clear" },
    ], { placeHolder: "Reschedule task" });
    if (!choice) return;
    let value: string | null = choice.value === "clear" ? null : choice.value;
    if (value === "pick") {
      value = await vscode.window.showInputBox({
        prompt: "scheduled (YYYY-MM-DD)", value: today,
        validateInput: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : "YYYY-MM-DD",
      }) ?? null;
      if (value === null) return;
    }
    await setTaskDate(at, "scheduled", value);
  });

  for (const field of ["deadline", "scheduled"] as const) {
    on(`lifeloop.set${field[0].toUpperCase()}${field.slice(1)}`, async (input?: TaskTargetInput) => {
      const at = taskTarget(lifeloop, input);
      if (!at) { vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
      const value = await vscode.window.showInputBox({
        prompt: `${field} (YYYY-MM-DD, empty to clear)`,
        value: day(),
        validateInput: (v) => (v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : "YYYY-MM-DD"),
      });
      if (value === undefined) return;
      await setTaskDate(at, field, value || null);
    });
  }

  on("lifeloop.attachPage", async () => {
    const at = taskTarget(lifeloop);
    if (!at) { vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
    // The destination is the user's, never inferred from a folder convention.
    const destination = await vscode.window.showInputBox({ prompt: "New page for this task" });
    if (!destination) return;
    const refreshed = await refreshTaskTarget(lifeloop, at);
    const current = refreshed && taskTarget(lifeloop, refreshed);
    if (!current) { vscode.window.showWarningMessage("LifeLoop: that task changed; no page was attached"); return; }
    if (await refreshAndReport(
      await attachPageToTask(lifeloop.vault, current.handle, destination), `attached ${destination}`, current,
    )) {
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

  on("lifeloop.openReview", async () => {
    const template = readTemplate(lifeloop.vault, "Templates/Review") ?? builtinReviewTemplate();
    const name = `${lifeloop.config("reviewFolder", "Reviews")}/${week(day()).start}`;

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
  });

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

  on("lifeloop.openToday", () => vscode.commands.executeCommand("lifeloop.today.focus"));

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
      "# Space Lua compatibility inventory",
      "",
      "LifeLoop supports a bounded subset of Space Lua when enabled. This inventory classifies",
      "calls for inspection; it does not prove that a script executes or its listeners run.",
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

  on("lifeloop.openSbRef", () => openSbRef(lifeloop));
  on("lifeloop.reindex", async () => {
    await lifeloop.reindex(true);
    vscode.window.setStatusBarMessage("LifeLoop: index rebuilt", 3000);
  });
  on("lifeloop.refreshViews", () => lifeloop.notifyChanged());
}
