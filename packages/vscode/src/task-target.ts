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
  offset: number;
  line: string;
  name: string;
  task?: LifeloopObject;
};

type IndexedTask = { task: LifeloopObject; ref: string };

export function taskSourceRef(text: string, page: string, task: LifeloopObject): string {
  const ref = String(task.ref);
  const numeric = /^(.*)@(\d+)$/.exec(ref);
  return numeric
    ? `${numeric[1]}@${originalSourceOffset(text, Number(numeric[2]))}`
    : `${page}@${ref}`;
}

function indexedTask(lifeloop: LifeLoop, page: string, offset: number): IndexedTask | undefined {
  let text = "";
  try { text = lifeloop.vault.read(`${page}.md`); } catch { return undefined; }
  const task = tasks.universe(lifeloop.store).find((candidate) => {
    if (candidate.page !== page) return false;
    const from = (candidate.range as [number, number] | undefined)?.[0];
    return from !== undefined && originalSourceOffset(text, from) === offset;
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

/** Resolve an actionable task from a signed tree row or the active cursor. */
export function taskTarget(lifeloop: LifeLoop, input?: TaskTargetInput): TaskTarget | null {
  if (input?.handle !== undefined) {
    const handle = taskHandle(input.handle);
    if (!handle) return null;
    const source = resolveHandle(lifeloop.vault, handle);
    if ("ok" in source) return null;
    const indexed = indexedTask(lifeloop, source.page, source.lineStart);
    if (!indexed || indexed.ref !== handle.ref) return null;
    return {
      handle,
      page: source.page,
      offset: source.lineStart,
      line: source.line,
      name: taskNameFromLine(source.line) ?? "",
      task: indexed.task,
    };
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "markdown") return null;
  const sourceLine = editor.document.lineAt(editor.selection.active.line);
  const state = TASK_MARKER.exec(sourceLine.text)?.[2];
  if (state === undefined) return null;
  const page = lifeloop.pageNameOfUri(editor.document.uri);
  const offset = editor.document.offsetAt(sourceLine.range.start);
  const indexed = indexedTask(lifeloop, page, offset);
  return {
    handle: {
      ref: indexed?.ref ?? `${page}@${offset}`,
      expectedText: sourceLine.text,
      expectedState: state,
      capturedAt: new Date().toISOString(),
    },
    page,
    offset,
    line: sourceLine.text,
    name: taskNameFromLine(sourceLine.text) ?? "",
    task: indexed?.task,
  };
}
