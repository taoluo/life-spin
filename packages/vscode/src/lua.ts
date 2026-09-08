import * as vscode from "vscode";
import {
  runLua, collectDeclarations, cycleTaskState, DEFAULT_CYCLE,
  type HostOptions, type CycleStates,
} from "@lifeloop/semantic-core";
import {
  LuaTable, LuaBuiltinFunction, jsToLuaValue, luaValueToJS,
} from "../../../vendor/silverbullet/client/space_lua/runtime.ts";
import type { LifeLoop } from "./workspace.ts";
import {
  renderWidgetValue, valueToMarkdown, interpolations, safeSpaceStyle,
} from "./preview.ts";

/**
 * Space Lua in the editor.
 *
 * **Off by default, and that is not timidity.** Executing code that arrives inside
 * a note is a real capability: a vault can be shared, synced from a phone, or
 * cloned from a repository, and none of those imply consent to run what is in it.
 * `lifeloop.executeSpaceLua` turns it on per workspace.
 *
 * What a script can reach is in `semantic-core`'s host: the object index, page
 * text, our projections, and Lua's own library. It cannot write — every mutation
 * in this project goes through the named, verified API, and a script in a note is
 * content rather than a privileged writer. `editor.*` is added here because only
 * the extension has an editor, and only the portable half of it exists.
 */

export function isEnabled(): boolean {
  return vscode.workspace.getConfiguration("lifeloop").get("executeSpaceLua", false);
}

const budgetMs = (): number =>
  vscode.workspace.getConfiguration("lifeloop").get("spaceLuaBudgetMs", 2000);

/**
 * The `editor.*` methods that have a VS Code equivalent.
 *
 * Not the whole of SilverBullet's editor API — `showPanel`, `dispatch` and the
 * CodeMirror-shaped rest have nothing to map onto, and `COMPATIBILITY.md` says so.
 * The ones here are each a single VS Code call, which is why classifying by
 * namespace rather than by method got this so wrong the first time.
 */
function editorApi(lifeloop: LifeLoop): (env: any) => void {
  return (env) => {
    const fn = (impl: (...args: any[]) => unknown) =>
      new LuaBuiltinFunction((sf: any, ...args: any[]) =>
        jsToLuaValue(impl(...args.map((a: any) => luaValueToJS(a, sf)))),
      );

    const table = new LuaTable();
    // Reading and telling the user things — safe, and what scripts actually use.
    table.set("flashNotification", fn((message: string) => {
      vscode.window.setStatusBarMessage(`LifeLoop: ${String(message)}`, 4000);
      return null;
    }));
    table.set("navigate", fn((page: string) => {
      void vscode.window.showTextDocument(lifeloop.pageUri(String(page)));
      return null;
    }));
    table.set("open", table.get("navigate"));
    table.set("getCurrentPage", fn(() => {
      const editor = vscode.window.activeTextEditor;
      return editor ? lifeloop.pageNameOfUri(editor.document.uri) : null;
    }));
    table.set("getText", fn(() => vscode.window.activeTextEditor?.document.getText() ?? null));
    table.set("copyToClipboard", fn((text: string) => {
      void vscode.env.clipboard.writeText(String(text));
      return null;
    }));
    table.set("openUrl", fn((url: string) => {
      void vscode.env.openExternal(vscode.Uri.parse(String(url)));
      return null;
    }));
    env.set("editor", table);
  };
}

function hostFor(lifeloop: LifeLoop): HostOptions {
  return {
    store: lifeloop.store,
    vault: lifeloop.vault,
    budgetMs: budgetMs(),
    extend: editorApi(lifeloop) as any,
  };
}

/** Every `space-lua` block in the vault, in a stable order. */
function scripts(lifeloop: LifeLoop): { page: string; script: string }[] {
  return lifeloop.store
    .objects("space-lua")
    .map((block) => {
      const ref = String(block.ref ?? "");
      return { page: ref.slice(0, ref.lastIndexOf("@")), script: String(block.script ?? "") };
    })
    .sort((a, b) => a.page.localeCompare(b.page));
}

/**
 * The task states this vault declares, if any.
 *
 * Two sources, in order: `lifeloop.taskStates` in settings, and `taskState.define`
 * in the vault's own Space Lua — which only counts when execution is enabled,
 * because reading a declaration means running the block that declares it.
 */
export async function cycleFor(lifeloop: LifeLoop): Promise<CycleStates> {
  const configured = vscode.workspace
    .getConfiguration("lifeloop")
    .get<{ state: string; done?: boolean }[]>("taskStates", []);
  if (configured.length) return configured;

  if (!isEnabled()) return DEFAULT_CYCLE;
  const blocks = lifeloop.store.objects("space-lua").map((b) => String(b.script ?? ""));
  if (blocks.length === 0) return DEFAULT_CYCLE;

  const { declared } = await collectDeclarations(blocks, hostFor(lifeloop));
  if (declared.taskStates.length === 0) return DEFAULT_CYCLE;

  const ordered = [...declared.taskStates].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return [{ state: " " }, ...ordered.map((s) => ({ state: s.state, done: s.done }))];
}

/**
 * What each `space-lua` block last produced.
 *
 * Markdown-it renders synchronously and Lua evaluates asynchronously, so the
 * answer has to exist before the preview asks for it. Blocks are evaluated when
 * the index changes and the rendered HTML is kept here; the preview then reads a
 * plain map. A block that has not been evaluated yet renders as code, which is
 * also what it does when execution is off.
 */
const rendered = new Map<string, string>();

/** Answers for `${...}` expressions, keyed by the expression as written. */
const expressions = new Map<string, string>();

/**
 * The space every block and expression evaluates in.
 *
 * One environment per vault, not per snippet: a library page defines
 * `templates.featureItem` and a query on another page calls it. Rebuilt whenever
 * the index settles, so a definition that was edited takes effect.
 */
let space: unknown;

export function renderSpaceLua(script: string): string | undefined {
  return rendered.get(script.trim());
}

export function renderExpression(expression: string): string | undefined {
  return expressions.get(expression);
}

/**
 * Evaluate one expression to Markdown, on demand.
 *
 * Baking needs this and the preview does not: the preview reads a map filled in
 * when the index settles, because markdown-it renders synchronously. Baking is a
 * command, so it can wait for the real answer — and it must, because it writes the
 * result into the user's file.
 */
export async function evaluateToMarkdown(
  instance: LifeLoop,
  expression: string,
): Promise<{ ok: true; markdown: string } | { ok: false; error: string }> {
  if (!isEnabled()) {
    return { ok: false, error: "Space Lua execution is off (lifeloop.lua.enabled)" };
  }
  const result = await runLua(expression, hostFor(instance), "expression", space as any);
  if (!result.ok) return { ok: false, error: result.error };
  const markdown = valueToMarkdown(result.value).trim();
  if (!markdown) return { ok: false, error: `${expression} produced nothing to write` };
  return { ok: true, markdown };
}

/** A vault's own CSS, scoped and filtered, for the preview to wear. */
let spaceStyle = "";

export function renderSpaceStyle(): string {
  return spaceStyle;
}

/**
 * Evaluate the vault's blocks and remember what they drew.
 *
 * Only values that *are* widgets are kept. A block that defines functions or
 * declares tags has no visual output, and inventing one for it would put noise
 * under every configuration block in the vault.
 */
async function refreshWidgets(instance: LifeLoop): Promise<void> {
  rendered.clear();
  expressions.clear();
  spaceStyle = "";
  space = undefined;
  if (!isEnabled()) return;

  /**
   * `${...}` expressions from every open Markdown document.
   *
   * Open documents rather than the whole vault: these are what a preview can be
   * showing, and evaluating every expression in a large vault on each index change
   * would cost far more than it could ever display. A page opened later is
   * evaluated when the index next settles.
   */
  const seen = new Set<string>();
  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId !== "markdown") continue;
    for (const expression of interpolations(document.getText())) {
      if (seen.has(expression)) continue;
      seen.add(expression);
      const result = await runLua(expression, hostFor(instance), "expression", space as any);
      // An expression that fails is left as written rather than replaced with an
      // error: the page still reads as what its author typed.
      if (result.ok) expressions.set(expression, valueToMarkdown(result.value));
    }
  }

  // A vault's own CSS, gathered whether or not scripts run: styling is data, and
  // applying it needs no evaluator.
  /**
   * Definitions first, then everything that uses them.
   *
   * Blocks are loaded into one shared environment before any query runs, because
   * a query calling a template has to find it — and the block defining it may
   * live on a page the reader never opens.
   */
  const loaded = await collectDeclarations(
    scripts(instance).map((b) => b.script),
    hostFor(instance),
  );
  space = loaded.space;

  const styles = instance.store.objects("space-style").map((b) => String(b.style ?? b.script ?? ""));
  const filtered = styles.map((css) => safeSpaceStyle(css));
  spaceStyle = filtered.map((f) => f.css).filter(Boolean).join("\n");
  const refused = filtered.flatMap((f) => f.refused);
  if (refused.length) {
    void vscode.window.showWarningMessage(
      `LifeLoop: ${refused.length} style rule(s) were not applied — a note may not load ` +
        `remote resources into the preview (${refused.slice(0, 2).join(", ")})`,
    );
  }

  for (const { script } of scripts(instance)) {
    const result = await runLua(script, hostFor(instance), "block", space as any);
    if (!result.ok) {
      rendered.set(
        script.trim(),
        `<div class="lifeloop-error"><strong>Space Lua</strong>: ${
          String(result.error).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)
        }</div>`,
      );
      continue;
    }
    /**
     * Anything a block returns is shown, not only widgets.
     *
     * A block that defines functions or sets config returns nothing, and gets no
     * output — inventing one would put noise under every configuration block in
     * the vault. A block that returns a list of tasks shows the list.
     */
    if (result.value === undefined || result.value === null) continue;
    const value = result.value as { __widget?: string };
    rendered.set(
      script.trim(),
      typeof value === "object" && typeof value.__widget === "string"
        ? renderWidgetValue(value)
        : `<div class="lifeloop-widget">${markdownToHtmlish(valueToMarkdown(result.value))}</div>`,
    );
  }
}

/**
 * Enough Markdown for a block's own output.
 *
 * A fenced block's result is rendered directly to HTML rather than substituted
 * back into the page — markdown-it has already tokenised by the time the fence
 * renderer runs, so there is nothing left to re-parse it. Tables and lists cover
 * what projections actually return; anything richer is a reason to use `${...}`,
 * which *is* substituted before parsing.
 */
function markdownToHtmlish(markdown: string): string {
  const escape = (t: string) =>
    t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inTable = false;
  let inList = false;

  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  const closeTable = () => { if (inTable) { out.push("</table>"); inTable = false; } };

  for (const line of lines) {
    if (/^\|\s*---/.test(line)) continue;
    if (line.startsWith("|")) {
      closeList();
      if (!inTable) { out.push('<table class="lifeloop-query">'); inTable = true; }
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      out.push(`<tr>${cells.map((c) => `<td>${escape(c)}</td>`).join("")}</tr>`);
      continue;
    }
    if (line.startsWith("* ")) {
      closeTable();
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${escape(line.slice(2))}</li>`);
      continue;
    }
    closeTable(); closeList();
    if (line.trim()) out.push(`<p>${escape(line)}</p>`);
  }
  closeTable(); closeList();
  return out.join("");
}

/**
 * Buttons a vault declares, as status bar items.
 *
 * `actionButton.define` is SilverBullet asking for a button in its action bar.
 * VS Code has no action bar, and the status bar is the honest equivalent: always
 * visible, out of the way, and something the user can ignore.
 */
function applyActionButtons(
  instance: LifeLoop,
  buttons: Record<string, unknown>[],
  call: (target: unknown, ...args: unknown[]) => Promise<{ ok: boolean; error?: string }>,
  context: vscode.ExtensionContext,
): void {
  for (const spec of buttons) {
    const label = String(spec.name ?? spec.icon ?? "LifeLoop");
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    item.text = spec.icon ? `$(${String(spec.icon)}) ${label}` : label;
    item.tooltip = String(spec.description ?? `Declared by this vault`);

    const id = `lifeloop.actionButton.${label.replace(/\W+/g, "-")}`;
    item.command = id;
    context.subscriptions.push(
      item,
      vscode.commands.registerCommand(id, async () => {
        const result = await call(spec.run);
        if (!result.ok) vscode.window.showWarningMessage(`LifeLoop: ${result.error}`);
        else await instance.reindex();
      }),
    );
    item.show();
  }
}

export function registerLua(lifeloop: () => LifeLoop | undefined, context: vscode.ExtensionContext): void {
  const on = (name: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(name, handler));

  const enabledOrAsk = async (): Promise<LifeLoop | undefined> => {
    const instance = lifeloop();
    if (!instance) return undefined;
    if (isEnabled()) return instance;

    const turnOn = "Enable for this workspace";
    const answer = await vscode.window.showWarningMessage(
      "LifeLoop does not run Space Lua unless you turn it on. A vault can be shared, " +
        "synced or cloned, and none of that means you meant to run the code inside it.",
      turnOn,
    );
    if (answer !== turnOn) return undefined;
    await vscode.workspace
      .getConfiguration("lifeloop")
      .update("executeSpaceLua", true, vscode.ConfigurationTarget.Workspace);
    return instance;
  };

  /**
   * Move the task under the cursor to its next state.
   *
   * One keystroke rather than a command per state, which is the whole argument for
   * custom states over tags — and `done` is always reachable, which is what made
   * the SilverBullet version unusable.
   */
  on("lifeloop.cycleTaskState", async () => {
    const instance = lifeloop();
    if (!instance) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") return;

    const line = editor.document.lineAt(editor.selection.active.line);
    if (!/^\s*(?:[-*+]|\d+[.)])\s+\[/.test(line.text)) {
      vscode.window.showWarningMessage("LifeLoop: put the cursor on a task");
      return;
    }

    const page = instance.pageNameOfUri(editor.document.uri);
    const result = await cycleTaskState(
      instance.vault,
      {
        ref: `${page}@${editor.document.offsetAt(line.range.start)}`,
        expectedText: line.text,
        expectedState: /\[([^\]])\]/.exec(line.text)?.[1],
        capturedAt: new Date().toISOString(),
      },
      await cycleFor(instance),
    );

    if (!result.ok) {
      vscode.window.showWarningMessage(`LifeLoop: ${result.message}`);
      return;
    }
    await instance.reindex();
  });

  /** Evaluate one expression and show what it produced. */
  on("lifeloop.evalLua", async () => {
    const instance = await enabledOrAsk();
    if (!instance) return;

    const source = await vscode.window.showInputBox({
      prompt: "Space Lua expression",
      placeHolder: "#index.tasks()",
    });
    if (!source) return;

    const result = await runLua(source, hostFor(instance), "expression", space as any);
    if (!result.ok) {
      vscode.window.showWarningMessage(`LifeLoop: ${result.error}`);
      return;
    }
    const document = await vscode.workspace.openTextDocument({
      content: `# ${source}\n\n\`\`\`json\n${JSON.stringify(result.value, null, 2)}\n\`\`\`\n`,
      language: "markdown",
    });
    await vscode.window.showTextDocument(document, { preview: true });
  });

  /**
   * Re-evaluate on every index change, so a preview never shows a stale answer.
   *
   * Debounced by the index rather than by a timer of its own: the index already
   * settles after typing, and running scripts on each keystroke is exactly the
   * cost the budget exists to bound.
   */
  const instance0 = lifeloop();
  if (instance0) {
    context.subscriptions.push(
      instance0.onDidChange(() => { void refreshWidgets(instance0); }),
    );
    void refreshWidgets(instance0);
  }

  on("lifeloop.applyActionButtons", async () => {
    const instance = await enabledOrAsk();
    if (!instance) return;
    const { declared, call } = await collectDeclarations(
      scripts(instance).map((b) => b.script),
      hostFor(instance),
    );
    if (declared.actionButtons.length === 0) {
      vscode.window.setStatusBarMessage("LifeLoop: this vault declares no action buttons", 4000);
      return;
    }
    applyActionButtons(instance, declared.actionButtons, call, context);
    vscode.window.setStatusBarMessage(
      `LifeLoop: added ${declared.actionButtons.length} button(s) to the status bar`, 4000,
    );
  });

  /** Run the vault's own blocks, and report what they declared. */
  on("lifeloop.runSpaceLua", async () => {
    const instance = await enabledOrAsk();
    if (!instance) return;

    const blocks = scripts(instance);
    if (blocks.length === 0) {
      vscode.window.setStatusBarMessage("LifeLoop: no Space Lua blocks in this vault", 4000);
      return;
    }

    const { declared, errors } = await collectDeclarations(
      blocks.map((b) => b.script),
      hostFor(instance),
    );

    const lines = [
      `# Space Lua — ${blocks.length} block${blocks.length === 1 ? "" : "s"}`,
      "",
      "Run read-only, with a time limit. Nothing here can write to the vault:",
      "every mutation goes through the named API, and a script in a note is content.",
      "",
      `* tags declared: **${declared.tags.length}**`,
      `* services declared: **${declared.services.length}**`,
      `* identities declared: **${declared.identities.length}**`,
      `* config keys set: **${Object.keys(declared.config).length}**`,
      "",
    ];

    if (Object.keys(declared.config).length) {
      lines.push("## Config", "", "```json", JSON.stringify(declared.config, null, 2), "```", "");
    }
    if (declared.tags.length) {
      lines.push("## Tags", "", "```json", JSON.stringify(declared.tags, null, 2), "```", "");
    }
    if (errors.length) {
      lines.push(
        "## Did not run",
        "",
        "Reported rather than swallowed — a block that fails silently looks exactly",
        "like one nobody wrote.",
        "",
        ...errors.map((e) => `* \`${e.script.replace(/\n/g, " ")}…\` — ${e.error}`),
        "",
      );
    }

    const document = await vscode.workspace.openTextDocument({
      content: lines.join("\n"),
      language: "markdown",
    });
    await vscode.window.showTextDocument(document, { preview: true });
  });
}
