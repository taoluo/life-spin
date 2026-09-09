import * as vscode from "vscode";
import {
  TASK_MARKER, originalSourceOffset, resolveHandle, tasks,
  type GuardedSourceHandle, type LifeloopObject,
} from "@lifeloop/semantic-core";
import type { LifeLoop } from "./workspace.ts";

export type TaskTargetInput = {
  handle?: GuardedSourceHandle;
  page?: string;
  offset?: number;
};

export type TaskTarget = {
  handle: GuardedSourceHandle;
  page: string;
  offset: number;
  line: string;
  name: string;
  task?: LifeloopObject;
};

const taskName = (line: string) =>
  line.replace(TASK_MARKER, "").replace(/\s*\[[a-z-]+:.*$/, "").trim();

function indexedTask(lifeloop: LifeLoop, page: string, offset: number): LifeloopObject | undefined {
  let text = "";
  try { text = lifeloop.vault.read(`${page}.md`); } catch { return undefined; }
  return tasks.universe(lifeloop.store).find((task) => {
    if (task.page !== page) return false;
    const from = (task.range as [number, number] | undefined)?.[0];
    return from !== undefined && originalSourceOffset(text, from) === offset;
  });
}

/** Resolve an actionable task from a signed tree row or the active cursor. */
export function taskTarget(lifeloop: LifeLoop, input?: TaskTargetInput): TaskTarget | null {
  if (input?.handle && input.page !== undefined && input.offset !== undefined) {
    const line = input.handle.expectedText ?? "";
    return {
      handle: input.handle,
      page: input.page,
      offset: input.offset,
      line,
      name: line ? taskName(line) : "",
      task: indexedTask(lifeloop, input.page, input.offset),
    };
  }
  if (input?.handle) {
    const source = resolveHandle(lifeloop.vault, input.handle);
    if ("ok" in source) return null;
    return {
      handle: input.handle,
      page: source.page,
      offset: source.lineStart,
      line: source.line,
      name: taskName(source.line),
      task: indexedTask(lifeloop, source.page, source.lineStart),
    };
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "markdown") return null;
  const sourceLine = editor.document.lineAt(editor.selection.active.line);
  const state = TASK_MARKER.exec(sourceLine.text)?.[2];
  if (state === undefined) return null;
  const page = lifeloop.pageNameOfUri(editor.document.uri);
  const offset = editor.document.offsetAt(sourceLine.range.start);
  return {
    handle: {
      ref: `${page}@${offset}`,
      expectedText: sourceLine.text,
      expectedState: state,
      capturedAt: new Date().toISOString(),
    },
    page,
    offset,
    line: sourceLine.text,
    name: taskName(sourceLine.text),
    task: indexedTask(lifeloop, page, offset),
  };
}
