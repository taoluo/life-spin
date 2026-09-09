import * as vscode from "vscode";
import { setTaskAttribute, TASK_MARKER } from "@lifeloop/semantic-core";
import type { LifeLoop } from "./workspace.ts";
import { taskTarget, taskTargetAt, type TaskTargetInput } from "./task-target.ts";

export type BindingKind = "reminder" | "event";
export type Binding = {
  kind: BindingKind;
  id: string;
  from: number;
  to: number;
  lineStart: number;
  line: string;
};

const ATTRIBUTE = /\[(reminder|event):\s*"([^"\r\n]+)"\]/g;

export function bindingsIn(text: string): Binding[] {
  return [...text.matchAll(ATTRIBUTE)].flatMap((match) => {
    const from = match.index!;
    const lineStart = text.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
    const next = text.indexOf("\n", from);
    const line = text.slice(lineStart, next === -1 ? text.length : next).replace(/\r$/, "");
    return TASK_MARKER.test(line)
      ? [{ kind: match[1] as BindingKind, id: match[2], from, to: from + match[0].length, lineStart, line }]
      : [];
  });
}

type BindingAction = TaskTargetInput & { kind: BindingKind; id: string };

const actionFor = (lifeloop: LifeLoop, document: vscode.TextDocument, binding: Binding): BindingAction | null => {
  const target = taskTargetAt(lifeloop, document, document.positionAt(binding.lineStart).line);
  return target ? {
    kind: binding.kind,
    id: binding.id,
    handle: target.handle,
    page: target.page,
    offset: target.offset,
  } : null;
};

const command = (id: string, label: string, argument?: unknown) =>
  `[${label}](command:${id}${argument === undefined ? "" : `?${encodeURIComponent(JSON.stringify([argument]))}`})`;

/** Native editor decorations and hovers for the two external binding attributes. */
export function registerBindings(lifeloop: LifeLoop, context: vscode.ExtensionContext): void {
  const reminder = vscode.window.createTextEditorDecorationType({
    before: { contentText: "🔔 " }, opacity: "0.55",
  });
  const event = vscode.window.createTextEditorDecorationType({
    before: { contentText: "📅 " }, opacity: "0.55",
  });

  const decorate = (editor: vscode.TextEditor) => {
    if (editor.document.languageId !== "markdown") return;
    const found = bindingsIn(editor.document.getText());
    for (const [kind, style] of [["reminder", reminder], ["event", event]] as const) {
      editor.setDecorations(style, found
        .filter((binding) => binding.kind === kind)
        .map((binding) => new vscode.Range(
          editor.document.positionAt(binding.from), editor.document.positionAt(binding.to),
        )));
    }
  };
  const refresh = () => vscode.window.visibleTextEditors.forEach(decorate);
  refresh();

  context.subscriptions.push(
    reminder,
    event,
    vscode.window.onDidChangeVisibleTextEditors(refresh),
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document === document);
      if (editor) decorate(editor);
    }),
    vscode.languages.registerHoverProvider(
      { language: "markdown", scheme: "file" },
      {
        provideHover(document, position) {
          const offset = document.offsetAt(position);
          const binding = bindingsIn(document.getText())
            .find((candidate) => offset >= candidate.from && offset < candidate.to);
          if (!binding) return undefined;
          const argument = actionFor(lifeloop, document, binding);
          if (!argument) return undefined;
          const actions = [
            command("lifeloop.syncExternal", "Sync"),
            command("lifeloop.openExternalBinding", binding.kind === "reminder" ? "Open Reminders" : "Open Calendar", argument),
            command("lifeloop.detachBinding", "Detach (keep external item)", argument),
            command("lifeloop.copyBindingId", "Copy ID", argument),
          ];
          const value = new vscode.MarkdownString(
            `${binding.kind === "reminder" ? "🔔 Reminder" : "📅 Calendar event"}\n\n` +
            `\`${binding.id}\`\n\n${actions.join(" · ")}`,
          );
          value.isTrusted = {
            enabledCommands: ["lifeloop.syncExternal", "lifeloop.openExternalBinding", "lifeloop.detachBinding", "lifeloop.copyBindingId"],
          };
          return new vscode.Hover(value, new vscode.Range(
            document.positionAt(binding.from), document.positionAt(binding.to),
          ));
        },
      },
    ),
    vscode.commands.registerCommand("lifeloop.detachBinding", async (input: BindingAction) => {
      const target = taskTarget(lifeloop, input);
      if (!target || (input.kind !== "reminder" && input.kind !== "event")) return;
      const matching = bindingsIn(target.line).filter((binding) => binding.kind === input.kind);
      if (matching.length !== 1 || matching[0].id !== input.id) {
        void vscode.window.showWarningMessage("LifeLoop: that external binding changed; nothing was detached");
        return;
      }
      const result = await setTaskAttribute(lifeloop.vault, target.handle, input.kind, null);
      if (!result.ok) {
        void vscode.window.showWarningMessage(`LifeLoop: ${result.message}`);
        return;
      }
      await lifeloop.reindex();
      vscode.window.setStatusBarMessage(
        `LifeLoop: ${input.kind} binding detached; external item retained`, 4000,
      );
    }),
    vscode.commands.registerCommand("lifeloop.copyBindingId", async (input: BindingAction) => {
      if (input?.id) await vscode.env.clipboard.writeText(input.id);
    }),
  );
}
