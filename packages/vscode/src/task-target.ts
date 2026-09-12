import * as vscode from "vscode";
import {
  TASK_MARKER, originalSourceOffset, resolveHandle, taskNameFromLine, tasks,
  type GuardedSourceHandle, type LifeloopObject,
} from "@lifeloop/semantic-core";
import type { LifeLoop } from "./workspace.ts";

export type TaskCommandHandle = GuardedSourceHandle & {
  expectedText: string;
  expectedState: string;
};

export type TaskTargetInput = {
  handle?: TaskCommandHandle;
  page?: string;
  offset?: number;
};

export type TaskTarget = {
  handle: TaskCommandHandle;
  page: string;
  sourceText: string;
  offset: number;
  line: string;
  name: string;
  task?: LifeloopObject;
};

export type SessionTaskHint = Pick<TaskTarget, "handle" | "page" | "offset" | "name">;

type IndexedTask = { task: LifeloopObject; ref: string };

export function taskSourceRef(text: string, page: string, task: LifeloopObject): string {
  const ref = String(task.ref);
  const numeric = /^(.*)@(\d+)$/.exec(ref);
  if (!numeric) return `${page}@${ref}`;
  const from = originalSourceOffset(text, Number(numeric[2]));
  const lineStart = text.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  return `${numeric[1]}@${lineStart}`;
}

function indexedTask(lifeloop: LifeLoop, page: string, offset: number): IndexedTask | undefined {
  let text = "";
  try { text = lifeloop.vault.read(`${page}.md`); } catch { return undefined; }
  const task = tasks.universe(lifeloop.store).find((candidate) => {
    if (candidate.page !== page) return false;
    const from = (candidate.range as [number, number] | undefined)?.[0];
    if (from === undefined) return false;
    const liveFrom = originalSourceOffset(text, from);
    return text.lastIndexOf("\n", Math.max(0, liveFrom - 1)) + 1 === offset;
  });
  if (!task) return undefined;
  return { task, ref: taskSourceRef(text, page, task) };
}

function taskHandle(value: unknown): TaskCommandHandle | null {
  if (!value || typeof value !== "object") return null;
  const handle = value as Record<string, unknown>;
  return typeof handle.ref === "string" &&
      typeof handle.expectedText === "string" &&
      typeof handle.expectedState === "string"
    ? value as TaskCommandHandle
    : null;
}

/** Sign one exact indexed row against the source snapshot stored with that index revision. */
export function taskTargetFromIndexed(lifeloop: LifeLoop, task: LifeloopObject): TaskTarget | null {
  const page = String(task.page ?? "");
  const [indexedFrom] = (task.range as [number, number] | undefined) ?? [0, 0];
  const row = lifeloop.store.db.prepare(`
    SELECT body FROM fts JOIN pages ON pages.id = fts.rowid
    WHERE pages.path = ? AND EXISTS (
      SELECT 1 FROM objects WHERE objects.page = pages.name
      AND objects.tag = 'task' AND objects.ref = ? AND objects.json = ?
    )
  `).get(`${page}.md`, task.ref, JSON.stringify(task)) as { body: string } | undefined;
  if (!row) return null;

  const sourceText = row.body;
  const from = originalSourceOffset(sourceText, indexedFrom);
  const offset = sourceText.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const end = sourceText.indexOf("\n", from);
  const line = sourceText.slice(offset, end === -1 ? sourceText.length : end);
  const state = TASK_MARKER.exec(line)?.[2];
  if (state === undefined) return null;
  return {
    handle: {
      ref: taskSourceRef(sourceText, page, task),
      expectedState: state,
      expectedText: line,
      capturedAt: new Date().toISOString(),
    },
    page,
    sourceText,
    offset,
    line,
    name: taskNameFromLine(line) ?? "",
    task,
  };
}

/** Capture one live task line as the guarded input every task command accepts. */
export function taskTargetAt(
  lifeloop: LifeLoop,
  document: vscode.TextDocument,
  line: number,
): TaskTarget | null {
  if (document.languageId !== "markdown") return null;
  const sourceLine = document.lineAt(line);
  const state = TASK_MARKER.exec(sourceLine.text)?.[2];
  if (state === undefined) return null;
  const page = lifeloop.pageNameOfUri(document.uri);
  const offset = document.offsetAt(sourceLine.range.start);
  const indexed = indexedTask(lifeloop, page, offset);
  return {
    handle: {
      ref: indexed?.ref ?? `${page}@${offset}`,
      expectedText: sourceLine.text,
      expectedState: state,
      capturedAt: new Date().toISOString(),
    },
    page,
    sourceText: document.getText(),
    offset,
    line: sourceLine.text,
    name: taskNameFromLine(sourceLine.text) ?? "",
    task: indexed?.task,
  };
}

/** Resolve an actionable task from a signed tree row or the active cursor. */
export function taskTarget(lifeloop: LifeLoop, input?: TaskTargetInput): TaskTarget | null {
  if (input?.handle !== undefined) {
    const handle = taskHandle(input.handle);
    if (!handle) return null;
    const source = resolveHandle(lifeloop.vault, handle);
    if ("ok" in source) return null;
    const numeric = /@(\d+)$/.exec(handle.ref);
    if (numeric && Number(numeric[1]) !== source.lineStart) return null;
    const indexed = indexedTask(lifeloop, source.page, source.lineStart);
    return {
      handle,
      page: source.page,
      sourceText: source.text,
      offset: source.lineStart,
      line: source.line,
      name: taskNameFromLine(source.line) ?? "",
      task: indexed?.ref === handle.ref ? indexed.task : undefined,
    };
  }

  const editor = vscode.window.activeTextEditor;
  return editor ? taskTargetAt(lifeloop, editor.document, editor.selection.active.line) : null;
}

/** Refresh the index, then re-admit the originally captured task identity. */
export async function refreshTaskTarget(
  lifeloop: LifeLoop,
  input: TaskTargetInput,
): Promise<TaskTarget | null> {
  await lifeloop.currentTaskStates();
  return taskTarget(lifeloop, input);
}
