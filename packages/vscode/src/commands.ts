import * as vscode from "vscode";
import {
  capture, captureItem, captureHere, ensureInbox, pending, processItem, linkToProject, makeTask,
  setTaskState, toggleParked, moveItem, appendTaskNote, appendTaskChild, setTaskName, addTaskLink,
  setTaskAttribute, setProjectStatus, attachPageToTask, freezeReview,
  PROJECT_STATES, review, dayReview, today, projectSignals, projectResumption, week, day,
  readTemplate, builtinReviewTemplate, builtinWeeklyFocusTemplate, createFromTemplate,
  bakeAt, unbakeAt, updateBaked,
  people, directPersonLinks, interactions, logInteraction, createReconnectTask, INTERACTION_KINDS, shift,
  tasks, explainTask, backlog,
  pageMetaFor, pageObject,
  TASK_DATE_FIELDS, type TaskDateField,
  type InboxItem, type Refusal, type LifeloopObject,
  type InteractionKind,
} from "@lifeloop/semantic-core";
import type { LifeLoop } from "./workspace.ts";
import type { Node } from "./views.ts";
import { openSbRef, scriptNamespaces } from "./retrieval.ts";
import { sourceLink } from "./temporary-navigation.ts";
import { evaluateToMarkdown } from "./lua.ts";
import {
  refreshTaskTarget, taskTarget, taskTargetFromIndexed,
  type TaskTarget, type TaskTargetInput,
} from "./task-target.ts";

type RecoveryTarget = Pick<TaskTarget, "page" | "offset">;
type ProjectTargetInput = Pick<Node, "page"> & { preserveFocus?: boolean };

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

const markdownText = (value: unknown): string =>
  String(value ?? "").replace(/([\\`*_[\]<>#])/g, "\\$1");

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

function projectSnapshot(lifeloop: LifeLoop, page: string): { text: string; status: string; inheritedParked: string[] } | null {
  let text: string;
  try { text = lifeloop.vault.read(`${page}.md`); } catch { return null; }
  const object = pageObject(text, pageMetaFor(page));
  if (!(object.itags as string[] | undefined)?.includes("project")) return null;
  return {
    text,
    status: typeof object.status === "string" ? object.status : "active",
    inheritedParked: ["waiting", "someday"].filter((tag) =>
      (object.itags as string[] | undefined)?.includes(tag)),
  };
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

function directRelatedPages(lifeloop: LifeLoop, target: TaskTarget): Array<{
  label: string;
  description: string;
  detail: string;
  page: string;
}> {
  const direct = new Set((target.task?.links as string[] | undefined) ?? []);
  return lifeloop.store.objects("page")
    .map((page) => {
      const path = String(page.ref ?? "");
      const tags = (page.itags as string[] | undefined) ?? [];
      const pageType = tags.includes("project") ? "Project" : tags.includes("person") ? "Person" : "Note";
      return { label: path.split("/").at(-1) ?? path, description: pageType, detail: path, page: path };
    })
    .filter((page) => direct.has(page.page) && page.description !== "Project")
    .sort((a, b) => a.description.localeCompare(b.description) || a.page.localeCompare(b.page));
}

async function openTaskRelatedPage(lifeloop: LifeLoop, target: TaskTarget): Promise<void> {
  const pages = directRelatedPages(lifeloop, target);
  if (!pages.length) {
    void vscode.window.showInformationMessage("LifeLoop: this task has no directly related Person or Note page");
    return;
  }
  const selected = pages.length === 1
    ? pages[0]
    : await vscode.window.showQuickPick(pages, {
      placeHolder: "Open a directly related page",
      matchOnDescription: true,
      matchOnDetail: true,
    });
  if (!selected) return;
  try {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(lifeloop.pageUri(selected.page)));
  } catch {
    void vscode.window.showWarningMessage(`LifeLoop: ${selected.page} is no longer available`);
  }
}

function activePerson(lifeloop: LifeLoop, input?: { page?: string }): string | null {
  const page = input?.page ?? (vscode.window.activeTextEditor?.document.languageId === "markdown"
    ? lifeloop.pageNameOfUri(vscode.window.activeTextEditor.document.uri) : undefined);
  return page && people(lifeloop.store).some((candidate) => candidate.ref === page) ? page : null;
}

export function register(lifeloop: LifeLoop, context: vscode.ExtensionContext): void {
  const on = (name: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(name, handler));
  let failedCapture: { text: string; uncertain: boolean } | undefined;
  type FindScope = "open" | "completed" | "waiting" | "someday" | "all";
  let lastFind: { value: string; handle: TaskTarget["handle"]; scope: FindScope } | undefined;

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

  const copyCapture = async (text: string) => {
    await vscode.env.clipboard.writeText(text);
    vscode.window.setStatusBarMessage("LifeLoop: capture text copied", 3000);
  };

  const captureToInbox = async (retry?: string): Promise<void> => {
    let value = retry;
    for (;;) {
      const line = await vscode.window.showInputBox({
        prompt: value === undefined ? "Capture to Inbox" : "Retry capture to Inbox",
        placeHolder: "a thought, a task, anything",
        value,
      });
      if (line === undefined) return;
      const page = lifeloop.config("inboxPage", "Inbox");
      const result = await capture(lifeloop.vault, line, page);
      if (result.ok) {
        failedCapture = undefined;
        await refreshAndReport(result, "captured");
        return;
      }
      failedCapture = { text: line, uncertain: result.reason === "unknown" };
      if (result.reason === "unknown") {
        const choice = await vscode.window.showErrorMessage(
          `LifeLoop: capture outcome is unknown — ${result.message}`,
          "Open Inbox", "Copy Text",
        );
        if (choice === "Open Inbox") await vscode.commands.executeCommand("lifeloop.openInbox");
        if (choice === "Copy Text") await copyCapture(line);
        return;
      }
      const choice = await vscode.window.showWarningMessage(
        `LifeLoop: capture was not saved — ${result.message}`,
        "Edit and Retry", "Copy Text",
      );
      if (choice === "Copy Text") {
        await copyCapture(line);
        return;
      }
      if (choice !== "Edit and Retry") return;
      value = line;
    }
  };

  const setTaskDate = async (
    at: TaskTarget,
    field: TaskDateField,
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

  const addNextAction = async (input: TaskTargetInput, prompt = "First / next action"): Promise<void> => {
    const initial = taskTarget(lifeloop, input);
    if (!initial) {
      void vscode.window.showWarningMessage("LifeLoop: choose a task before adding a next action");
      return;
    }
    const name = await vscode.window.showInputBox({ prompt });
    if (!name) return;
    const current = await refreshTaskTarget(lifeloop, initial);
    if (!current) {
      void vscode.window.showWarningMessage("LifeLoop: that task changed; no action was created");
      return;
    }
    await refreshAndReport(
      await appendTaskChild(lifeloop.vault, current.handle, name), "created next action", current,
    );
  };

  // 1.7 — Capture. Costs less than filing does: one box, no navigation.
  on("lifeloop.capture", () => captureToInbox());

  on("lifeloop.recoverLastCapture", async () => {
    if (!failedCapture) {
      void vscode.window.showInformationMessage("LifeLoop: no failed capture in this session");
      return;
    }
    if (failedCapture.uncertain) {
      const choice = await vscode.window.showWarningMessage(
        "LifeLoop: the previous capture outcome is unknown. Check the Inbox before retrying.",
        "Open Inbox", "Retry After Checking", "Copy Text",
      );
      if (choice === "Open Inbox") {
        await vscode.commands.executeCommand("lifeloop.openInbox");
        return;
      }
      if (choice === "Copy Text") {
        await copyCapture(failedCapture.text);
        return;
      }
      if (choice !== "Retry After Checking") return;
    }
    await captureToInbox(failedCapture.text);
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

  on("lifeloop.captureSelection", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      await vscode.commands.executeCommand("lifeloop.capture");
      return;
    }
    const document = editor.document;
    const selected = document.getText(editor.selection).replaceAll("\r\n", "\n");
    if (!selected.trim()) {
      await vscode.commands.executeCommand("lifeloop.capture");
      return;
    }
    let source: string;
    try {
      source = `[[${lifeloop.pageNameOfUri(document.uri)}]]`;
    } catch {
      source = document.uri.scheme === "untitled"
        ? document.fileName
        : vscode.workspace.asRelativePath(document.uri, false);
    }
    const first = editor.selection.start.line + 1;
    const last = editor.selection.end.character === 0 && editor.selection.end.line > editor.selection.start.line
      ? editor.selection.end.line
      : editor.selection.end.line + 1;
    const range = first === last ? `line ${first}` : `lines ${first}-${last}`;
    const quote = selected.replace(/\n$/, "").split("\n").map((line) => `  > ${line}`).join("\n");
    const item = `* Captured selection\n${quote}\n  Source: ${source} · ${range}${document.isDirty ? " · unsaved snapshot" : ""}`;
    const page = lifeloop.config("inboxPage", "Inbox");
    await refreshAndReport(await captureItem(lifeloop.vault, item, page), `captured selection to ${page}`);
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

  on("lifeloop.meetingWrapUp", async (input?: TaskTargetInput) => {
    const initial = taskTarget(lifeloop, input);
    let target: TaskTarget | null = null;
    try { target = initial ? await refreshTaskTarget(lifeloop, initial) : null; }
    catch (error) {
      void vscode.window.showErrorMessage(`LifeLoop: ${(error as Error).message}`);
      return;
    }
    const linkedPeople = target?.task ? directPersonLinks(lifeloop.store, target.task) : [];
    const event = target ? exactEventBinding(target.line) : undefined;
    if (!target?.task || !event || !linkedPeople.length) {
      void vscode.window.showWarningMessage(
        "LifeLoop: Meeting Wrap-up needs an exact Calendar-bound task with direct Person links",
      );
      return;
    }
    const steps = await vscode.window.showQuickPick([
      { label: "$(comment-discussion) Log interaction", id: "interaction" },
      { label: "$(add) Add follow-up as next action", id: "follow-up" },
      ...(!target.task.done ? [{ label: "$(check) Complete related task", id: "complete" }] : []),
    ], {
      canPickMany: true,
      placeHolder: "Choose independent wrap-up steps; each is revalidated before writing",
    });
    if (!steps?.length) return;
    const selected = new Set(steps.map((step) => step.id));
    if (selected.has("interaction")) {
      await recordInteraction(lifeloop, linkedPeople, "meeting", target, event);
    }
    if (selected.has("follow-up")) {
      await vscode.commands.executeCommand("lifeloop.addNextAction", target);
    }
    if (selected.has("complete")) {
      await vscode.commands.executeCommand("lifeloop.completeTask", target);
    }
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
  on("lifeloop.processInbox", async (preselected?: InboxItem | Node) => {
    const page = lifeloop.config("inboxPage", "Inbox");
    // A right-click ("view/item/context") passes the tree Node, not the InboxItem
    // that a click's own `command.arguments` carries — normalize both to InboxItem.
    const asInboxItem = preselected === undefined
      ? undefined
      : "text" in preselected
        ? preselected
        : preselected.itemText !== undefined && preselected.offset !== undefined && preselected.itemEnd !== undefined
          ? { offset: preselected.offset, text: preselected.itemText, end: preselected.itemEnd }
          : undefined;
    const continuous = asInboxItem === undefined;
    let selected = asInboxItem;
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
    const target = taskTarget(lifeloop, input);
    if (!target) { void vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
    const reminder = /\[reminder:\s*"([^"]+)"\]/.exec(target.line)?.[1];
    const event = exactEventBinding(target.line);
    const done = target.task?.done === true;
    const directWaiting = (target.task?.tags as string[] | undefined)?.includes("waiting") ?? false;
    const effectiveWaiting = (target.task?.itags as string[] | undefined)?.includes("waiting") ?? directWaiting;
    const linkedPeople = target.task ? directPersonLinks(lifeloop.store, target.task) : [];
    const relatedPages = directRelatedPages(lifeloop, target);
    const now = lifeloop.nowTarget();
    const isNow = now?.handle.ref === target.handle.ref &&
      now.handle.expectedText === target.handle.expectedText;
    const action = await vscode.window.showQuickPick([
      { label: done ? "$(circle-outline) Reopen" : "$(check) Complete", id: done ? "reopen" : "complete" },
      { label: isNow ? "$(close) Clear Now" : "$(target) Set as Now", id: isNow ? "clear-now" : "set-now" },
      ...(linkedPeople.length ? [{ label: "$(comment-discussion) Log Interaction", id: "interaction" }] : []),
      ...(reminder
        ? [{ label: "$(sync) Sync Reminder", id: "sync" }, { label: "$(link-external) Open Reminders", id: "open-reminder" }, { label: "$(debug-disconnect) Detach Reminder", id: "detach-reminder" }]
        : [{ label: "$(bell) Add Reminder", id: "reminder" }]),
      ...(event
        ? [
          ...(linkedPeople.length ? [{ label: "$(preview) Pre-meeting Brief", id: "brief" }] : []),
          ...(linkedPeople.length ? [{ label: "$(checklist) Meeting Wrap-up", id: "meeting-wrap-up" }] : []),
          { label: "$(sync) Sync Calendar", id: "sync" },
          { label: "$(link-external) Open Calendar", id: "open-event" },
          { label: "$(debug-disconnect) Detach Calendar", id: "detach-event" },
        ]
        : [{ label: "$(calendar) Add to Calendar", id: "calendar" }]),
      { label: "$(calendar) Set Deadline", id: "deadline" },
      { label: "$(calendar) Quick Reschedule", id: "reschedule" },
      { label: "$(add) Add Next Action", id: "next-action" },
      { label: "$(note) Add Progress / Resume Cue", id: "note" },
      { label: "$(link) Add Related Link", id: "related" },
      ...(relatedPages.length ? [{
        label: "$(link-external) Open Related Page",
        description: relatedPages.length === 1 ? relatedPages[0].detail : `${relatedPages.length} pages`,
        id: "open-related",
      }] : []),
      { label: "$(tools) Make Actionable", id: "make-actionable" },
      { label: "$(question) Why here?", id: "why" },
      ...(effectiveWaiting ? [{ label: "$(debug-step-over) Waiting → Next Action", id: "waiting-next" }] : []),
      ...(directWaiting
        ? [{ label: "$(close) Clear Waiting", id: "waiting" }]
        : effectiveWaiting ? [] : [{ label: "$(watch) Mark Waiting", id: "waiting" }]),
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
    if (action.id === "meeting-wrap-up") return vscode.commands.executeCommand("lifeloop.meetingWrapUp", target);
    if (action.id === "project") return openTaskProject(lifeloop, target);
    if (action.id === "set-now") return vscode.commands.executeCommand("lifeloop.setNow", target);
    if (action.id === "clear-now") return vscode.commands.executeCommand("lifeloop.clearNow");
    if (action.id === "note") return vscode.commands.executeCommand("lifeloop.addTaskNote", target);
    if (action.id === "next-action") return vscode.commands.executeCommand("lifeloop.addNextAction", target);
    if (action.id === "related") return vscode.commands.executeCommand("lifeloop.addRelatedLink", target);
    if (action.id === "open-related") return openTaskRelatedPage(lifeloop, target);
    if (action.id === "make-actionable") return vscode.commands.executeCommand("lifeloop.makeActionable", target);
    if (action.id === "waiting-next") return vscode.commands.executeCommand("lifeloop.waitingNextAction", target);
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

  const openFindTask = async (restore: boolean) => {
    try {
      await lifeloop.currentTaskStates();
      let scope: FindScope = restore && lastFind ? lastFind.scope : "open";
      const all = tasks.universe(lifeloop.store);
      const inScope = () => all.filter((task) => {
        const tags = (task.itags as string[] | undefined) ?? [];
        if (scope === "all") return true;
        if (scope === "completed") return task.done === true;
        if (scope === "waiting" || scope === "someday") return task.done !== true && tags.includes(scope);
        return task.done !== true;
      });
      const taskItems = () => inScope().map((task) => {
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
      type FindItem = ReturnType<typeof taskItems>[number] & { scope?: FindScope };
      const picked = await new Promise<FindItem | undefined>((resolve) => {
        const picker = vscode.window.createQuickPick<FindItem>();
        let previewing = false;
        let previewGeneration = 0;
        const previewButton = () => ({
          iconPath: new vscode.ThemeIcon("preview"),
          tooltip: previewing ? "Stop previewing selection" : "Preview selection while moving",
        });
        const preview = async (item?: FindItem) => {
          const generation = ++previewGeneration;
          if (!previewing || !item?.target) return;
          const current = taskTarget(lifeloop, item.target);
          if (!current) return;
          const document = await vscode.workspace.openTextDocument(lifeloop.pageUri(current.page));
          if (generation !== previewGeneration) return;
          const editor = await vscode.window.showTextDocument(document, { preview: true, preserveFocus: true });
          if (generation !== previewGeneration) return;
          const at = document.positionAt(current.offset);
          editor.revealRange?.(new vscode.Range(at, at), vscode.TextEditorRevealType.InCenter);
        };
        const refresh = () => {
          picker.items = [
            { label: `$(filter) Scope: ${scope[0].toUpperCase()}${scope.slice(1)}`, description: "change task scope", detail: "Open · Completed · Waiting · Someday · All", target: null, scope },
            ...taskItems(),
          ];
        };
        refresh();
        picker.placeholder = "Find task by text, status, source or context";
        picker.title = "Find Task";
        picker.buttons = [previewButton()];
        picker.matchOnDescription = true;
        picker.matchOnDetail = true;
        if (restore && lastFind) {
          picker.value = lastFind.value;
          const remembered = taskItems().find((item) =>
            item.target!.handle.ref === lastFind!.handle.ref &&
            item.target!.handle.expectedText === lastFind!.handle.expectedText &&
            item.target!.handle.expectedState === lastFind!.handle.expectedState);
          if (remembered) {
            picker.activeItems = [remembered];
            picker.selectedItems = [remembered];
          }
        }
        let settled = false;
        const remember = () => {
          const item = picker.selectedItems[0] ?? picker.activeItems[0];
          if (item?.target) lastFind = { value: picker.value, handle: item.target.handle, scope };
        };
        const finish = (item?: FindItem) => {
          if (settled) return;
          settled = true;
          accepted.dispose();
          hidden.dispose();
          active.dispose();
          button.dispose();
          previewGeneration++;
          picker.dispose();
          resolve(item);
        };
        const accepted = picker.onDidAccept(() => {
          const item = picker.selectedItems[0] ?? picker.activeItems[0];
          if (item?.scope) {
            const scopes: FindScope[] = ["open", "completed", "waiting", "someday", "all"];
            scope = scopes[(scopes.indexOf(scope) + 1) % scopes.length];
            refresh();
            return;
          }
          remember();
          finish(item);
        });
        const hidden = picker.onDidHide(() => {
          remember();
          finish();
        });
        const active = picker.onDidChangeActive((items) => { void preview(items[0]); });
        const button = picker.onDidTriggerButton(() => {
          previewing = !previewing;
          picker.title = previewing ? "Find Task · Previewing selection" : "Find Task";
          picker.buttons = [previewButton()];
          void preview(picker.activeItems[0]);
        });
        picker.show();
      });
      if (picked?.target) await vscode.commands.executeCommand("lifeloop.taskActions", picked.target);
    } catch (error) {
      void vscode.window.showErrorMessage(`LifeLoop: ${(error as Error).message}`);
    }
  };

  on("lifeloop.findTask", () => openFindTask(false));

  on("lifeloop.returnToLastFind", async () => {
    if (lastFind) {
      await openFindTask(true);
      return;
    }
    const choice = await vscode.window.showInformationMessage(
      "LifeLoop: no recent Find Task in this session", "Find Task",
    );
    if (choice === "Find Task") await openFindTask(false);
  });

  on("lifeloop.addFromBacklog", async () => {
    await lifeloop.currentTaskStates();
    const candidates = backlog(lifeloop.store, day()).map((task) => ({
      label: String(task.name ?? "").trim() || "(empty task)",
      description: String(task.page ?? ""),
      target: taskTargetFromIndexed(lifeloop, task),
    })).filter((item) => item.target !== null);
    const picked = await vscode.window.showQuickPick(candidates, { placeHolder: "Add from backlog" });
    if (!picked?.target) return;
    const action = await vscode.window.showQuickPick([
      { label: "$(target) Set Now", id: "now" },
      { label: "$(calendar) Schedule Today", id: "today" },
      { label: "$(preview) Peek Source", id: "peek" },
      { label: "$(go-to-file) Open Source", id: "open" },
    ], { placeHolder: picked.label });
    if (action?.id === "now") await vscode.commands.executeCommand("lifeloop.setNow", picked.target);
    if (action?.id === "today") await setTaskDate(picked.target, "scheduled", day());
    if (action?.id === "peek") await vscode.commands.executeCommand("lifeloop.peekSource", picked.target);
    if (action?.id === "open") await vscode.commands.executeCommand("lifeloop.revealTask", picked.target);
  });

  on("lifeloop.waitingNextAction", async (input?: TaskTargetInput) => {
    const initial = taskTarget(lifeloop, input);
    const at = initial && await refreshTaskTarget(lifeloop, initial);
    if (!at?.task || !(at.task.itags as string[] | undefined)?.includes("waiting")) {
      void vscode.window.showWarningMessage("LifeLoop: choose a Waiting task");
      return;
    }
    const direct = (at.task.tags as string[] | undefined)?.includes("waiting") ?? false;
    const choice = await vscode.window.showQuickPick([
      { label: "$(check) Complete waiting item", id: "complete" },
      { label: "$(add) Create next action", id: "create" },
      { label: "$(calendar) Schedule", id: "schedule" },
      ...(direct ? [{ label: "$(close) Clear Waiting only", id: "clear" }] : []),
    ], { placeHolder: at.name || "Waiting → Next Action" });
    if (choice?.id === "complete") return vscode.commands.executeCommand("lifeloop.completeTask", at);
    if (choice?.id === "schedule") return vscode.commands.executeCommand("lifeloop.quickReschedule", at);
    if (choice?.id === "clear") return vscode.commands.executeCommand("lifeloop.toggleWaiting", at);
    if (choice?.id === "create") await addNextAction(at, "Next action");
  });

  on("lifeloop.addNextAction", (input?: TaskTargetInput) => addNextAction(input ?? {}));

  on("lifeloop.makeActionable", async (input?: TaskTargetInput) => {
    const at = taskTarget(lifeloop, input);
    if (!at) { void vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
    const choice = await vscode.window.showQuickPick([
      { label: "$(edit) Edit wording", id: "edit" },
      { label: "$(add) Add first / next action", id: "child" },
      { label: "$(new-file) Attach new context page", id: "context" },
      { label: "$(watch) Waiting", id: "waiting" },
      { label: "$(archive) Someday", id: "someday" },
    ], { placeHolder: at.name || "Make actionable" });
    if (choice?.id === "context") return vscode.commands.executeCommand("lifeloop.attachPage", at);
    if (choice?.id === "waiting") return vscode.commands.executeCommand("lifeloop.toggleWaiting", at);
    if (choice?.id === "someday") return vscode.commands.executeCommand("lifeloop.toggleSomeday", at);
    if (choice?.id === "child") return addNextAction(at);
    if (choice?.id === "edit") {
      const value = await vscode.window.showInputBox({
        prompt: "Task wording",
        value: at.name,
      });
      if (!value) return;
      const current = await refreshTaskTarget(lifeloop, at);
      if (!current) { void vscode.window.showWarningMessage("LifeLoop: that task changed; nothing was changed"); return; }
      await refreshAndReport(
        await setTaskName(lifeloop.vault, current.handle, value), "updated task wording", current,
      );
    }
  });

  on("lifeloop.setNow", async (input?: TaskTargetInput) => {
    const at = taskTarget(lifeloop, input);
    if (!at) { void vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
    try {
      const current = await refreshTaskTarget(lifeloop, at);
      if (!current?.task) {
        void vscode.window.showWarningMessage("LifeLoop: that task changed; Now was not set");
        return;
      }
      lifeloop.setNowTarget({
        handle: current.handle, page: current.page, offset: current.offset, name: current.name,
      });
      vscode.window.setStatusBarMessage(`LifeLoop: Now — ${current.name}`, 3000);
    } catch (error) {
      void vscode.window.showErrorMessage(`LifeLoop: ${(error as Error).message}`);
    }
  });

  on("lifeloop.returnToNow", async () => {
    const now = lifeloop.nowTarget();
    if (!now) {
      const choice = await vscode.window.showInformationMessage("LifeLoop: no Now task in this session", "Find Task");
      if (choice === "Find Task") await vscode.commands.executeCommand("lifeloop.findTask");
      return;
    }
    try {
      const current = await refreshTaskTarget(lifeloop, now);
      if (current) {
        await vscode.commands.executeCommand("lifeloop.revealTask", current);
        return;
      }
      const choice = await vscode.window.showWarningMessage(
        "LifeLoop: the Now task changed or moved; choose it again",
        "Find Task", "Clear Now",
      );
      if (choice === "Find Task") await vscode.commands.executeCommand("lifeloop.findTask");
      if (choice === "Clear Now") lifeloop.setNowTarget();
    } catch (error) {
      void vscode.window.showErrorMessage(`LifeLoop: ${(error as Error).message}`);
    }
  });

  on("lifeloop.clearNow", () => {
    if (!lifeloop.nowTarget()) return;
    lifeloop.setNowTarget();
    vscode.window.setStatusBarMessage("LifeLoop: Now cleared", 3000);
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

  on("lifeloop.addTaskNote", async (input?: TaskTargetInput) => {
    const at = taskTarget(lifeloop, input);
    if (!at) { void vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
    const kind = await vscode.window.showQuickPick([
      { label: "$(history) Progress", id: "progress" as const },
      { label: "$(debug-step-over) Resume Cue", id: "next" as const },
    ], { placeHolder: at.name || "Record on task" });
    if (!kind) return;
    const note = await vscode.window.showInputBox({
      prompt: kind.id === "progress" ? "Progress made" : "Next step when you return",
    });
    if (!note) return;
    try {
      const current = await refreshTaskTarget(lifeloop, at);
      if (!current) {
        void vscode.window.showWarningMessage("LifeLoop: that task changed; nothing was recorded");
        return;
      }
      await refreshAndReport(
        await appendTaskNote(lifeloop.vault, current.handle, kind.id, note),
        kind.id === "progress" ? "recorded progress" : "saved resume cue",
        current,
      );
    } catch (error) {
      void vscode.window.showErrorMessage(`LifeLoop: ${(error as Error).message}`);
    }
  });

  for (const tag of ["waiting", "someday"] as const) {
    on(`lifeloop.toggle${tag[0].toUpperCase()}${tag.slice(1)}`, async (input?: TaskTargetInput) => {
      const at = taskTarget(lifeloop, input);
      if (!at) { vscode.window.showWarningMessage("LifeLoop: put the cursor on a task"); return; }
      const result = await toggleParked(lifeloop.vault, at.handle, tag);
      const success = result.ok
        ? result.value.added ? `marked #${tag}` : `removed direct #${tag}`
        : `toggled #${tag}`;
      if (!await refreshAndReport(result, success, at) || !result.ok || result.value.added) return;
      const current = taskTarget(lifeloop, {
        handle: { ...at.handle, expectedText: result.value.line },
      });
      if ((current?.task?.itags as string[] | undefined)?.includes(tag)) {
        void vscode.window.showWarningMessage(
          `LifeLoop: removed direct #${tag}, but this task still inherits #${tag}`,
        );
      }
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

  for (const field of TASK_DATE_FIELDS) {
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

  on("lifeloop.attachPage", async (input?: TaskTargetInput) => {
    const at = taskTarget(lifeloop, input);
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

  on("lifeloop.addRelatedLink", async (input?: TaskTargetInput) => {
    const initial = taskTarget(lifeloop, input);
    if (!initial) {
      void vscode.window.showWarningMessage("LifeLoop: choose a task before adding a related link");
      return;
    }
    const direct = new Set((initial.task?.links as string[] | undefined) ?? []);
    const candidates = lifeloop.store.objects("page")
      .map((page) => {
        const path = String(page.ref ?? "");
        const tags = (page.itags as string[] | undefined) ?? [];
        const pageType = tags.includes("project") ? "Project" : tags.includes("person") ? "Person" : "Note";
        return {
          label: path.split("/").at(-1) ?? path,
          description: pageType,
          detail: path,
          path,
          pageType,
        };
      })
      .filter((page) => page.path && !direct.has(page.path))
      .sort((a, b) => a.pageType.localeCompare(b.pageType) || a.path.localeCompare(b.path));
    if (!candidates.length) {
      void vscode.window.showInformationMessage("LifeLoop: no unlinked Project, Person or Note page is available");
      return;
    }
    const selected = await vscode.window.showQuickPick(candidates, {
      placeHolder: "Add a related link (this does not change project ownership)",
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!selected) return;

    let targetText: string;
    try { targetText = lifeloop.vault.read(`${selected.path}.md`); }
    catch {
      void vscode.window.showWarningMessage(`LifeLoop: ${selected.path} no longer exists`);
      return;
    }
    const current = await refreshTaskTarget(lifeloop, initial);
    if (!current) {
      void vscode.window.showWarningMessage("LifeLoop: that task changed; no related link was added");
      return;
    }
    const result = await addTaskLink(lifeloop.vault, current.handle, selected.path, targetText);
    if (!await refreshAndReport(result, `added related link to ${selected.path}`, current)) return;
    if (selected.pageType === "Project") {
      void vscode.window.showInformationMessage(
        "LifeLoop: related link added. Project gap still counts only tasks written on the project page.",
      );
    }
  });

  const showProject = async (project: string, preserveFocus: boolean): Promise<void> => {
    const document = await vscode.workspace.openTextDocument(lifeloop.pageUri(project));
    await vscode.window.showTextDocument(document, preserveFocus
      ? { preview: true, preserveFocus: true } : undefined);
  };

  const pauseProject = async (project: string): Promise<void> => {
    const snapshot = projectSnapshot(lifeloop, project);
    if (!snapshot) {
      void vscode.window.showWarningMessage(`LifeLoop: ${project} is missing or no longer a project`);
      return;
    }
    if (report(
      await setProjectStatus(lifeloop.vault, project, "paused", snapshot.text),
      `${project} is paused`, { page: project, offset: 0 },
    )) await after();
  };

  const addProjectNextAction = async (project: string): Promise<void> => {
    const snapshot = projectSnapshot(lifeloop, project);
    if (!snapshot || snapshot.status !== "active") {
      void vscode.window.showWarningMessage(`LifeLoop: ${project} is missing, no longer active, or no longer a project`);
      return;
    }
    const name = await vscode.window.showInputBox({
      prompt: `Add next action to the end of ${project}`,
      placeHolder: "next action",
    });
    if (!name) return;
    const result = await captureHere(lifeloop.vault, project, snapshot.text.length, name, snapshot.text);
    if (!await refreshAndReport(
      result, `added next action to ${project}`, { page: project, offset: snapshot.text.length },
    )) return;
    if (snapshot.inheritedParked.length) {
      void vscode.window.showWarningMessage(
        `LifeLoop: added the task, but it still inherits ${snapshot.inheritedParked.map((tag) => `#${tag}`).join(" and ")} from ${project}`,
      );
    }
  };

  // 1.9 — lifecycle is semantic only: archiving does not move the page.
  on("lifeloop.setProjectStatus", async (input?: ProjectTargetInput) => {
    const project = input?.page ?? await pickProject(lifeloop);
    if (!project) return;
    if (!projectSnapshot(lifeloop, project)) {
      void vscode.window.showWarningMessage(`LifeLoop: ${project} is missing or no longer a project`);
      return;
    }
    const status = await vscode.window.showQuickPick([...PROJECT_STATES], {
      placeHolder: `status for ${project}`,
    });
    if (!status) return;
    try { await lifeloop.currentTaskStates(); }
    catch (error) {
      void vscode.window.showErrorMessage(`LifeLoop: ${(error as Error).message}`);
      return;
    }
    let snapshot = projectSnapshot(lifeloop, project);
    if (!snapshot) {
      void vscode.window.showWarningMessage(`LifeLoop: ${project} is missing or no longer a project`);
      return;
    }
    if (status === "completed" || status === "archived") {
      const facts = projectResumption(lifeloop.store, project);
      if (!facts) {
        void vscode.window.showWarningMessage(`LifeLoop: ${project} is missing or no longer a project`);
        return;
      }
      const open = [...facts.onPageOpen, ...facts.relatedOpen];
      const waiting = open.filter((task) =>
        ((task.itags as string[] | undefined) ?? []).includes("waiting")).length;
      const bindings = facts.knownBindings.length;
      const decision = await vscode.window.showQuickPick([
        {
          label: `$(check) Set project ${status}`,
          description: "leave tasks and external objects unchanged",
          detail: `${facts.onPageOpen.length} open on this page · ${facts.relatedOpen.length} related elsewhere · ${waiting} waiting · ${bindings} with known bindings`,
          id: "confirm",
        },
        { label: "$(preview) Open known closure facts", id: "facts" },
      ], { placeHolder: `Review known facts before setting ${project} ${status}` });
      if (!decision) return;
      if (decision.id === "facts") {
        await vscode.commands.executeCommand("lifeloop.projectResumptionBrief", { page: project });
        return;
      }
      try { await lifeloop.currentTaskStates(); }
      catch (error) {
        void vscode.window.showErrorMessage(`LifeLoop: ${(error as Error).message}`);
        return;
      }
      snapshot = projectSnapshot(lifeloop, project);
      if (!snapshot) {
        void vscode.window.showWarningMessage(`LifeLoop: ${project} is missing or no longer a project`);
        return;
      }
    }
    if (report(
      await setProjectStatus(lifeloop.vault, project, status as any, snapshot.text),
      `${project} is ${status}`, { page: project, offset: 0 },
    )) {
      await after();
    }
  });

  on("lifeloop.projectActions", async (input?: ProjectTargetInput) => {
    const project = input?.page ?? await pickProject(lifeloop);
    if (!project) return;
    const snapshot = projectSnapshot(lifeloop, project);
    if (!snapshot) {
      void vscode.window.showWarningMessage(`LifeLoop: ${project} is missing or no longer a project`);
      return;
    }
    const choice = await vscode.window.showQuickPick([
      { label: "$(preview) Preview project context", detail: "read-only tasks on this page and related work elsewhere", id: "preview" },
      { label: "$(go-to-file) Open project", id: "open" },
      ...(snapshot.status === "active" ? [
        { label: "$(add) Add next action", detail: "append one task to the end of this project page", id: "add" },
        { label: "$(debug-pause) Pause project", detail: "leave tasks and external bindings unchanged", id: "pause" },
      ] : []),
      { label: "$(arrow-right) Leave unchanged", id: "skip" },
    ], { placeHolder: project });
    if (!choice || choice.id === "skip") return;
    if (choice.id === "preview") {
      return vscode.commands.executeCommand("lifeloop.projectResumptionBrief", { page: project });
    }
    if (choice.id === "open") return showProject(project, false);
    if (choice.id === "pause") return pauseProject(project);
    await addProjectNextAction(project);
  });

  on("lifeloop.projectResumptionBrief", async (input?: ProjectTargetInput) => {
    const project = input?.page ?? await pickProject(lifeloop);
    if (!project) return;
    try {
      await lifeloop.currentTaskStates();
      const context = projectResumption(lifeloop.store, project);
      if (!context) {
        void vscode.window.showWarningMessage(`LifeLoop: ${project} is missing or no longer a project`);
        return;
      }
      const rows = (list: LifeloopObject[]) => list.length ? list.map((task) => {
        const tags = (task.itags as string[] | undefined) ?? [];
        const state = task.done === true ? "completed"
          : tags.includes("waiting") ? "waiting" : tags.includes("someday") ? "someday" : "open";
        const completed = typeof task.completed === "string" ? ` · completed ${task.completed}` : "";
        return `* ${sourceLink(lifeloop, String(task.ref), String(task.page ?? ""))} — ${markdownText(task.name)} · ${state}${completed}`;
      }).join("\n") : "_Nothing._";
      const bindingRows = context.knownBindings.length ? context.knownBindings.map((task) => {
        const bindings = [
          typeof task.reminder === "string" ? `Reminder ${markdownText(task.reminder)}` : "",
          typeof task.event === "string" ? `Calendar ${markdownText(task.event)}` : "",
        ].filter(Boolean).join(" · ");
        return `* ${sourceLink(lifeloop, String(task.ref), String(task.page ?? ""))} — ${markdownText(task.name)} · ${bindings}`;
      }).join("\n") : "_Nothing._";
      const uri = lifeloop.pageUri(project).toString();
      const markdown = [
        `# Resume ${markdownText(project.split("/").at(-1) ?? project)}`,
        "",
        `Project: [${markdownText(project)}](<${uri}>)`,
        `Status: ${markdownText(context.project.status ?? "active")}`,
        `Project page last modified: ${markdownText(context.project.lastModified || "unknown")}`,
        "",
        "## Open tasks on this project page",
        "",
        rows(context.onPageOpen),
        "",
        "## Related open tasks from other pages",
        "",
        rows(context.relatedOpen),
        "",
        "_Related links provide context and do not change project-page membership._",
        "",
        "## Recent factual completions",
        "",
        rows(context.recentCompleted),
        "",
        "## Known Reminder / Calendar bindings",
        "",
        bindingRows,
        "",
      ].join("\n");
      if (input?.preserveFocus) {
        await vscode.commands.executeCommand(
          "lifeloop.openReadonlyResult", markdown, "project-resumption", { preserveFocus: true },
        );
      } else {
        await vscode.commands.executeCommand("lifeloop.openReadonlyResult", markdown, "project-resumption");
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`LifeLoop: Project Resumption Brief failed — ${(error as Error).message}`);
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

  const openWeeklyFocus = async (start: string, preserveFocus = false): Promise<void> => {
    const template = readTemplate(lifeloop.vault, "Templates/Weekly Focus") ??
      builtinWeeklyFocusTemplate();
    const result = await createFromTemplate(
      lifeloop.vault,
      template,
      `Weekly/${start}`,
      new Date(`${start}T12:00:00`),
    );
    if (!result.ok) {
      void vscode.window.showWarningMessage(`LifeLoop: ${result.message}`);
      return;
    }
    if (!result.value.existed) await after();
    const document = await vscode.workspace.openTextDocument(lifeloop.pageUri(result.value.page));
    const editor = await vscode.window.showTextDocument(
      document,
      preserveFocus ? { preview: true, preserveFocus: true } : undefined,
    );
    if (result.value.cursor !== null) {
      const at = document.positionAt(result.value.cursor);
      editor.selection = new vscode.Selection(at, at);
    }
  };

  on("lifeloop.openNextWeekFocus", () => {
    return openWeeklyFocus(week(shift(day(), 7)).start);
  });

  on("lifeloop.reviewPeriodFacts", async () => {
    try {
      await lifeloop.currentTaskStates();
      const sections = review(lifeloop.store, day());
      const activity = interactions(lifeloop.store).filter((entry) =>
        entry.date >= sections.week.start && entry.date <= sections.week.end);
      const completed = sections.completed.length ? sections.completed.map((task) =>
        `* ${sourceLink(lifeloop, String(task.ref), String(task.page ?? ""))} — ${markdownText(task.name)} · completed ${markdownText(task.completed)}`,
      ).join("\n") : "_Nothing with a reliable completion date._";
      const interactionsMarkdown = activity.length ? activity.map((entry) =>
        `* ${sourceLink(lifeloop, entry.ref, entry.page)} — ${markdownText(entry.date)} · ${markdownText(entry.kind)} · ${markdownText(entry.people.join(", "))} · ${markdownText(entry.text)}`,
      ).join("\n") : "_No explicitly dated interactions._";
      const markdown = [
        `# Facts for ${sections.week.start} to ${sections.week.end}`,
        "",
        "## Completed tasks",
        "",
        completed,
        "",
        "## Interactions",
        "",
        interactionsMarkdown,
        "",
        "_This report omits task creation and Inbox processing because those facts do not have reliable dates._",
        "",
      ].join("\n");
      await vscode.commands.executeCommand("lifeloop.openReadonlyResult", markdown, "review-period-facts");
    } catch (error) {
      void vscode.window.showErrorMessage(`LifeLoop: Review Period Facts failed — ${(error as Error).message}`);
    }
  });

  on("lifeloop.planToday", () =>
    vscode.commands.executeCommand("lifeloop.reviewActions", { mode: "plan" }));

  on("lifeloop.closeTodayPlanTomorrow", () =>
    vscode.commands.executeCommand("lifeloop.reviewActions", { mode: "close" }));

  on("lifeloop.reviewActions", async (input?: { mode?: "review" | "plan" | "close" }) => {
    type ReviewScope = "open" | "projects" | "waiting" | "someday" | "completed" | "unscheduled" | "paused" |
      "plan-today" | "backlog-today" | "day-review" | "plan-tomorrow" | "backlog-tomorrow";
    type ReviewItem = vscode.QuickPickItem & {
      key?: string;
      target?: TaskTarget;
      project?: string;
      chooseScope?: true;
      openWeekFocus?: string;
      openNextWeekFocus?: true;
      openPeriodFacts?: true;
    };
    const reviewScopes: { label: string; description: string; scope: ReviewScope }[] = [
      { label: "Open tasks", description: "open and actionable", scope: "open" },
      { label: "Active projects", description: "page-scoped project facts", scope: "projects" },
      { label: "Waiting", description: "effective #waiting only", scope: "waiting" },
      { label: "Someday", description: "effective #someday, excluding Waiting", scope: "someday" },
      { label: "Completed this week", description: "factual completion dates", scope: "completed" },
      { label: "Unscheduled backlog", description: "not planned, parked or under a paused project", scope: "unscheduled" },
      { label: "Paused projects", description: "user-selected backlog scope", scope: "paused" },
    ];
    const todayDate = day();
    const tomorrowDate = shift(todayDate, 1);
    const mode = input?.mode ?? "review";
    const scopes = mode === "plan" ? [
      { label: `Plan today — ${todayDate}`, description: "deadlines, plans and unfinished earlier plans", scope: "plan-today" as const },
      { label: "Backlog candidates", description: "open, actionable and not already planned", scope: "backlog-today" as const },
    ] : mode === "close" ? [
      { label: `Review today — ${todayDate}`, description: "factual completions and remaining plans", scope: "day-review" as const },
      { label: `Plan tomorrow — ${tomorrowDate}`, description: "tomorrow's constraints and existing plans", scope: "plan-tomorrow" as const },
      { label: "Tomorrow backlog candidates", description: "open, actionable and not already planned", scope: "backlog-tomorrow" as const },
    ] : reviewScopes;
    let scope: ReviewScope = scopes[0].scope;
    let results: ReviewItem[] = [];
    let lastResultKey: string | undefined;
    let lastResultIndex = 0;
    const picker = vscode.window.createQuickPick<ReviewItem>();
    picker.title = mode === "plan" ? "Plan Today"
      : mode === "close" ? "Close Today and Plan Tomorrow" : "Review in Place";
    picker.placeholder = mode === "plan" ? "Review constraints, choose freely, and adjust when needed"
      : mode === "close" ? "Review today, then plan tomorrow without task check-ins" : "Review in place";
    picker.matchOnDescription = true;
    picker.matchOnDetail = true;

    const taskItem = (task: LifeloopObject, reason?: string): ReviewItem | null => {
      const target = taskTargetFromIndexed(lifeloop, task);
      if (!target) return null;
      const tags = (task.itags as string[] | undefined) ?? [];
      const facts = [
        task.done ? "completed" : tags.includes("waiting") ? "waiting" : tags.includes("someday") ? "someday" : "actionable",
        typeof task.deadline === "string" ? `due ${task.deadline}` : "",
        typeof task.scheduled === "string" ? `scheduled ${task.scheduled}` : "",
        reason ?? "",
      ].filter(Boolean);
      return {
        label: String(task.name ?? "").trim() || "(empty task)",
        description: String(task.page ?? ""),
        detail: facts.join(" · "),
        key: `task:${target.handle.ref}`,
        target,
      };
    };
    const planItems = (date: string): ReviewItem[] => {
      const buckets = today(lifeloop.store, date);
      const rows: [LifeloopObject, string][] = [
        ...buckets.overdue.map((task): [LifeloopObject, string] => [task, `deadline before ${date}`]),
        ...buckets.due.map((task): [LifeloopObject, string] => [task, `deadline ${date}`]),
        ...buckets.scheduled.map((task): [LifeloopObject, string] => [task, `planned for ${date}`]),
        ...buckets.pastScheduled.map((task): [LifeloopObject, string] => [task, `earlier plan ${String(task.scheduled)} still open`]),
      ];
      return rows.map(([task, reason]) => taskItem(task, reason))
        .filter((item): item is ReviewItem => item !== null);
    };
    const projectItem = (project: LifeloopObject, paused = false): ReviewItem => {
      const page = String(project.ref ?? "");
      const signals = paused ? [] : projectSignals(
        lifeloop.store, page, day(), lifeloop.config("staleDays", 21),
      );
      const actionable = tasks.actionable(lifeloop.store).filter((task) => task.page === page).length;
      return {
        label: page.split("/").at(-1) ?? page,
        description: page,
        detail: paused ? "paused project" : signals.length
          ? signals.map((signal) => `this page: ${signal.kind}`).join(" · ")
          : `${actionable} actionable on this project page`,
        key: `project:${page}`,
        project: page,
      };
    };
    const currentResults = (): ReviewItem[] => {
      if (scope === "plan-today") return planItems(todayDate);
      if (scope === "plan-tomorrow") return planItems(tomorrowDate);
      if (scope === "backlog-today" || scope === "backlog-tomorrow") {
        return backlog(lifeloop.store, scope === "backlog-today" ? todayDate : tomorrowDate)
          .map((task) => taskItem(task, "backlog candidate"))
          .filter((item): item is ReviewItem => item !== null);
      }
      if (scope === "day-review") {
        const summary = dayReview(lifeloop.store, todayDate);
        return [
          ...summary.completed.map((task) => taskItem(task, "completed today")),
          ...summary.remaining.map((task) => taskItem(task, "still open at close of day")),
        ].filter((item): item is ReviewItem => item !== null);
      }
      const sections = review(lifeloop.store, todayDate);
      const taskRows = scope === "open" ? sections.stillOpen
        : scope === "waiting" ? sections.waiting
          : scope === "someday" ? sections.someday
            : scope === "completed" ? sections.completed
              : scope === "unscheduled" ? backlog(lifeloop.store, day()) : [];
      if (taskRows.length) return taskRows.map((task) => taskItem(task))
        .filter((item): item is ReviewItem => item !== null);
      if (scope === "projects") return sections.activeProjects.map((project) => projectItem(project));
      if (scope === "paused") {
        return lifeloop.store.objects("page")
          .filter((page) => (page.itags as string[] | undefined)?.includes("project") && page.status === "paused")
          .map((project) => projectItem(project, true));
      }
      return [];
    };
    const render = (preferred?: string, fallback = 0) => {
      results = currentResults();
      const title = scopes.find((candidate) => candidate.scope === scope)!.label;
      const scopeItem: ReviewItem = {
        label: `$(filter) Scope: ${title}`,
        description: "change review scope",
        detail: scopes.map((candidate) => candidate.label).join(" · "),
        chooseScope: true,
      };
      const focusItem: ReviewItem[] = mode === "review" ? [{
        label: "$(calendar) Open next week's focus",
        description: "ordinary Markdown intent note; exits Review",
        openNextWeekFocus: true,
      }, {
        label: "$(history) Open this week's dated facts",
        description: "completed tasks and explicit interactions only; exits Review",
        openPeriodFacts: true,
      }] : [{
        label: `$(calendar) Open focus for week ${week(mode === "close" ? tomorrowDate : todayDate).start}`,
        description: "ordinary Markdown focus note; keeps this planning list",
        openWeekFocus: week(mode === "close" ? tomorrowDate : todayDate).start,
      }];
      picker.items = results.length ? [scopeItem, ...focusItem, ...results] : [scopeItem, ...focusItem, {
        label: "$(info) Nothing in this scope",
        description: title,
      }];
      const next = results.find((item) => item.key === preferred) ??
        results[Math.min(fallback, Math.max(0, results.length - 1))];
      if (next?.key) {
        lastResultKey = next.key;
        lastResultIndex = Math.max(0, results.findIndex((item) => item.key === next.key));
      }
      picker.activeItems = next ? [next] : [scopeItem];
      picker.selectedItems = [];
    };

    try {
      await lifeloop.currentTaskStates();
    } catch (error) {
      picker.dispose();
      void vscode.window.showErrorMessage(`LifeLoop: ${(error as Error).message}`);
      return;
    }

    await new Promise<void>((resolve) => {
      let running = false;
      let ended = false;
      let activeChanged: vscode.Disposable | undefined;
      const finish = () => {
        if (ended) return;
        ended = true;
        accepted.dispose();
        hidden.dispose();
        activeChanged?.dispose();
        picker.dispose();
        resolve();
      };
      const resume = async (preferred?: string, fallback = 0) => {
        if (ended) return;
        if (!lifeloop.indexIsSettled()) await lifeloop.currentTaskStates();
        render(preferred, fallback);
        picker.busy = false;
        running = false;
        picker.show();
      };
      const accept = async () => {
        if (running || ended) return;
        const item = picker.selectedItems[0] ?? picker.activeItems[0];
        if (!item) return;
        running = true;
        picker.busy = true;
        const value = picker.value;
        const index = Math.max(0, results.findIndex((candidate) => candidate.key === item.key));
        if (item.key) {
          lastResultKey = item.key;
          lastResultIndex = index;
        }
        try {
          if (item.chooseScope) {
            const picked = await vscode.window.showQuickPick(scopes, {
              placeHolder: mode === "review" ? "Review scope" : "Planning scope",
            });
            // VS Code can deliver the parent picker's hide event just after a
            // nested picker resolves. Settle it while `running` still guards
            // the Review session from ending.
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (picked) scope = picked.scope;
            picker.value = value;
            await resume(undefined, 0);
            return;
          }
          if (item.openNextWeekFocus) {
            finish();
            await vscode.commands.executeCommand("lifeloop.openNextWeekFocus");
            return;
          }
          if (item.openWeekFocus) {
            await openWeeklyFocus(item.openWeekFocus, true);
            picker.value = value;
            await resume(lastResultKey, lastResultIndex);
            return;
          }
          if (item.openPeriodFacts) {
            finish();
            await vscode.commands.executeCommand("lifeloop.reviewPeriodFacts");
            return;
          }
          if (!item.target && !item.project) {
            await resume(undefined, 0);
            return;
          }

          if (item.target) {
            const tags = (item.target.task?.itags as string[] | undefined) ?? [];
            const planningDate = scope === "plan-today" || scope === "backlog-today" ? todayDate
              : scope === "plan-tomorrow" || scope === "backlog-tomorrow" ? tomorrowDate : undefined;
            const action = await vscode.window.showQuickPick([
              { label: "$(preview) Preview source", id: "preview" },
              { label: "$(go-to-file) Open source and exit this list", id: "open" },
              { label: item.target.task?.done ? "$(discard) Reopen" : "$(check) Complete", id: item.target.task?.done ? "reopen" : "complete" },
              ...(planningDate && !item.target.task?.done && item.target.task?.scheduled !== planningDate
                ? [{ label: `$(calendar) Schedule for ${planningDate}`, id: "schedule-day" }] : []),
              ...(!item.target.task?.done ? [{ label: "$(calendar) Quick Reschedule", id: "reschedule" }] : []),
              ...(!item.target.task?.done ? [{ label: "$(target) Set as Now (optional)", id: "set-now" }] : []),
              ...(!item.target.task?.done ? [{ label: "$(note) Add Progress / Resume Cue", id: "note" }] : []),
              { label: tags.includes("waiting") ? "$(debug-step-over) Waiting → Next Action" : "$(watch) Mark Waiting", id: tags.includes("waiting") ? "waiting-next" : "waiting" },
              { label: "$(add) Add next action", id: "next" },
              { label: "$(link) Add Related Link", id: "related" },
              { label: "$(ellipsis) All Task Actions", id: "all" },
              { label: "$(arrow-right) Keep unchanged and continue", id: "continue" },
            ], { placeHolder: item.label });
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (!action || action.id === "continue") {
              picker.value = value;
              await resume(item.key, index);
              return;
            }
            if (action.id === "open") {
              finish();
              await vscode.commands.executeCommand("lifeloop.revealTask", item.target);
              return;
            }
            if (action.id === "preview") {
              const current = taskTarget(lifeloop, item.target);
              if (!current) {
                void vscode.window.showWarningMessage("LifeLoop: that task changed; refresh Review before previewing it");
              } else {
                const document = await vscode.workspace.openTextDocument(lifeloop.pageUri(current.page));
                const editor = await vscode.window.showTextDocument(document, { preview: true, preserveFocus: true });
                const at = document.positionAt(current.offset);
                editor.revealRange?.(new vscode.Range(at, at), vscode.TextEditorRevealType.InCenter);
              }
            } else if (action.id === "schedule-day") {
              await setTaskDate(item.target, "scheduled", planningDate!);
            } else {
              const commands: Record<string, string> = {
                complete: "lifeloop.completeTask", reopen: "lifeloop.reopenTask",
                reschedule: "lifeloop.quickReschedule", waiting: "lifeloop.toggleWaiting",
                "waiting-next": "lifeloop.waitingNextAction", next: "lifeloop.addNextAction",
                related: "lifeloop.addRelatedLink", all: "lifeloop.taskActions",
                "set-now": "lifeloop.setNow", note: "lifeloop.addTaskNote",
              };
              await vscode.commands.executeCommand(commands[action.id], item.target);
            }
          } else {
            const snapshot = projectSnapshot(lifeloop, item.project!);
            const action = await vscode.window.showQuickPick([
              { label: "$(preview) Preview project", id: "preview" },
              { label: "$(go-to-file) Open project and exit Review", id: "open" },
              ...(snapshot?.status === "active" ? [
                { label: "$(add) Add next action", id: "add" },
                { label: "$(debug-pause) Pause project", id: "pause" },
              ] : []),
              { label: "$(ellipsis) All Project Actions", id: "all" },
              { label: "$(arrow-right) Keep unchanged and continue", id: "continue" },
            ], { placeHolder: item.description });
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (!action || action.id === "continue") {
              picker.value = value;
              await resume(item.key, index);
              return;
            }
            if (action.id === "open") {
              finish();
              await showProject(item.project!, false);
              return;
            }
            if (action.id === "preview") {
              await vscode.commands.executeCommand("lifeloop.projectResumptionBrief", {
                page: item.project!, preserveFocus: true,
              });
            }
            if (action.id === "add") await addProjectNextAction(item.project!);
            if (action.id === "pause") await pauseProject(item.project!);
            if (action.id === "all") await vscode.commands.executeCommand("lifeloop.projectActions", item);
          }
          picker.value = value;
          await resume(item.key, index);
        } catch (error) {
          void vscode.window.showErrorMessage(`LifeLoop: ${(error as Error).message}`);
          picker.value = value;
          try { await resume(item.key, index); } catch { finish(); }
        }
      };
      const accepted = picker.onDidAccept(() => { void accept(); });
      const hidden = picker.onDidHide(() => { if (!running) finish(); });
      activeChanged = picker.onDidChangeActive?.((items) => {
        const item = items[0];
        if (!item?.key) return;
        lastResultKey = item.key;
        lastResultIndex = Math.max(0, results.findIndex((candidate) => candidate.key === item.key));
      });
      render();
      picker.show();
    });
  });

  on("lifeloop.freezeReview", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const page = lifeloop.pageNameOfUri(editor.document.uri);
    const sections = review(lifeloop.store, day());
    const render = (name: string): string | null => {
      const lists: Record<string, unknown[]> = {
        completed: sections.completed, stillOpen: sections.stillOpen,
        activeProjects: sections.activeProjects, waiting: sections.waiting,
        someday: sections.someday, inbox: sections.inbox,
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
