import * as vscode from "vscode";
import {
  today, upcoming, projectSignals, day, tasks, backlinks,
  pending, type LifeloopObject, type SourceHandle,
} from "@lifeloop/semantic-core";
import type { LifeLoop } from "./workspace.ts";

/**
 * The views, and the invariant they exist to keep (I4).
 *
 * A node carries an opaque `SourceHandle` — ref, the marker state and the line as
 * it was rendered. Acting on a node re-resolves that handle and verifies it before
 * writing; nothing here reconstructs identity from the label on screen. That is
 * exactly the failure that made ticking a task in a query view leave it unstamped
 * in the old implementation, and it is structural here rather than remembered.
 */

export class Node extends vscode.TreeItem {
  constructor(
    label: string,
    collapsible: vscode.TreeItemCollapsibleState,
    readonly children?: Node[],
    readonly handle?: SourceHandle,
    readonly page?: string,
    readonly offset?: number,
  ) {
    super(label, collapsible);
  }
}

const TASK_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+\[([^\]])\]/;

/** Build a node from a task object, capturing the receipt I4 requires. */
function taskNode(lifeloop: LifeLoop, task: LifeloopObject, showPage = true): Node {
  const page = String(task.page ?? "");
  const [from] = (task.range as [number, number] | undefined) ?? [0, 0];

  let line = "";
  try {
    const text = lifeloop.vault.read(`${page}.md`);
    const start = text.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
    const end = text.indexOf("\n", from);
    line = text.slice(start, end === -1 ? text.length : end);
  } catch { /* the page may have gone; the handle will refuse */ }

  const state = TASK_MARKER.exec(line)?.[1];
  const node = new Node(
    String(task.name ?? "").trim() || "(empty task)",
    vscode.TreeItemCollapsibleState.None,
    undefined,
    { ref: String(task.ref), expectedState: state, expectedText: line, capturedAt: new Date().toISOString() },
    page,
    from,
  );

  node.contextValue = "lifeloopTask";
  node.iconPath = new vscode.ThemeIcon(task.done ? "check" : "circle-large-outline");
  const bits: string[] = [];
  if (showPage) bits.push(page);
  if (typeof task.deadline === "string") bits.push(`due ${task.deadline}`);
  if (typeof task.scheduled === "string") bits.push(`for ${task.scheduled}`);
  node.description = bits.join("  ·  ");
  node.tooltip = new vscode.MarkdownString(`\`${line.trim()}\`\n\n_${page}_`);
  node.command = {
    command: "lifeloop.revealTask",
    title: "Go to source",
    arguments: [node],
  };
  return node;
}

function section(label: string, children: Node[], icon?: string): Node | null {
  if (children.length === 0) return null;
  const node = new Node(
    `${label}  (${children.length})`,
    vscode.TreeItemCollapsibleState.Expanded,
    children,
  );
  if (icon) node.iconPath = new vscode.ThemeIcon(icon);
  return node;
}

abstract class BaseProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(protected readonly lifeloop: LifeLoop) {
    lifeloop.onDidChange(() => this.emitter.fire(undefined));
  }

  refresh(): void { this.emitter.fire(undefined); }
  getTreeItem(node: Node): vscode.TreeItem { return node; }
  getChildren(node?: Node): Node[] {
    return node ? (node.children ?? []) : this.roots();
  }
  protected abstract roots(): Node[];
}

/** 1.10 — Today: overdue / due / scheduled, disjoint, plus what you are waiting on. */
export class TodayView extends BaseProvider {
  protected roots(): Node[] {
    const t = today(this.lifeloop.store, day());
    const nodes = [
      section("Overdue", t.overdue.map((x) => taskNode(this.lifeloop, x)), "flame"),
      section("Due today", t.due.map((x) => taskNode(this.lifeloop, x)), "calendar"),
      section("Scheduled", t.scheduled.map((x) => taskNode(this.lifeloop, x)), "clock"),
      section("Waiting", t.waiting.map((x) => taskNode(this.lifeloop, x)), "watch"),
    ].filter((n): n is Node => n !== null);

    if (nodes.length === 0) {
      const empty = new Node("Nothing due today", vscode.TreeItemCollapsibleState.None);
      empty.iconPath = new vscode.ThemeIcon("check-all");
      return [empty];
    }

    const days = upcoming(this.lifeloop.store, day(), this.lifeloop.config("upcomingDays", 14));
    const later = days.map((d) =>
      section(d.date, d.tasks.map((x) => taskNode(this.lifeloop, x))),
    ).filter((n): n is Node => n !== null);
    if (later.length) {
      nodes.push(new Node("Upcoming", vscode.TreeItemCollapsibleState.Collapsed, later));
    }
    return nodes;
  }
}

/** 1.9 — projects by status, with derived signals shown and never written. */
export class ProjectsView extends BaseProvider {
  protected roots(): Node[] {
    const projects = this.lifeloop.store
      .objects("page")
      .filter((p) => (p.itags as string[] | undefined)?.includes("project"));

    const byStatus = new Map<string, Node[]>();
    for (const project of projects.sort((a, b) => String(a.ref).localeCompare(String(b.ref)))) {
      const name = String(project.ref);
      const status = typeof project.status === "string" ? project.status : "active";
      const open = tasks.actionable(this.lifeloop.store).filter((t) => t.page === name);
      const signals = projectSignals(
        this.lifeloop.store, name, day(), this.lifeloop.config("staleDays", 21),
      );

      const node = new Node(
        name,
        open.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
        open.map((t) => taskNode(this.lifeloop, t, false)),
        undefined,
        name,
      );
      node.contextValue = "lifeloopProject";
      node.iconPath = new vscode.ThemeIcon(signals.length ? "warning" : "project");
      node.description = signals.map((s) => s.kind).join(", ") || `${open.length} actionable`;
      node.tooltip = new vscode.MarkdownString(
        signals.length ? signals.map((s) => `- **${s.kind}** — ${s.detail}`).join("\n") : "no signals",
      );
      node.command = { command: "vscode.open", title: "Open", arguments: [this.lifeloop.pageUri(name)] };

      const list = byStatus.get(status) ?? [];
      list.push(node);
      byStatus.set(status, list);
    }

    return ["active", "paused", "completed", "archived"]
      .map((status) => section(status[0].toUpperCase() + status.slice(1), byStatus.get(status) ?? []))
      .filter((n): n is Node => n !== null);
  }
}

/** 1.8 — pending captures, in the order they were written. */
export class InboxView extends BaseProvider {
  protected roots(): Node[] {
    const page = this.lifeloop.config("inboxPage", "Inbox");
    let text: string;
    try { text = this.lifeloop.vault.read(`${page}.md`); } catch {
      const empty = new Node("No Inbox page yet", vscode.TreeItemCollapsibleState.None);
      empty.command = { command: "lifeloop.openInbox", title: "Create" };
      return [empty];
    }

    const items = pending(text);
    if (items.length === 0) {
      const empty = new Node("Inbox is empty", vscode.TreeItemCollapsibleState.None);
      empty.iconPath = new vscode.ThemeIcon("inbox");
      return [empty];
    }

    return items.map((item) => {
      const [first] = item.text.split("\n");
      const node = new Node(
        first.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""),
        vscode.TreeItemCollapsibleState.None,
        undefined,
        undefined,
        page,
        item.offset,
      );
      node.contextValue = "lifeloopInboxItem";
      node.iconPath = new vscode.ThemeIcon("circle-outline");
      const nested = item.text.split("\n").length - 1;
      if (nested) node.description = `${nested} nested`;
      node.command = { command: "lifeloop.processInbox", title: "Process", arguments: [item] };
      return node;
    });
  }
}

/** 1.4 — backlinks for whatever is open. */
export class BacklinksView extends BaseProvider {
  constructor(lifeloop: LifeLoop) {
    super(lifeloop);
    vscode.window.onDidChangeActiveTextEditor(() => this.refresh());
  }

  protected roots(): Node[] {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") {
      return [new Node("Open a Markdown page", vscode.TreeItemCollapsibleState.None)];
    }
    const page = this.lifeloop.pageNameOfUri(editor.document.uri);
    const links = backlinks(this.lifeloop.store, page);
    if (links.length === 0) {
      return [new Node(`Nothing links to ${page}`, vscode.TreeItemCollapsibleState.None)];
    }

    return links
      .sort((a, b) => String(b.page).localeCompare(String(a.page)))
      .map((relation) => {
        const from = String(relation.page);
        const [offset] = (relation.range as [number, number] | undefined) ?? [0, 0];
        const node = new Node(from, vscode.TreeItemCollapsibleState.None, undefined, undefined, from, offset);
        node.description = String(relation.snippet ?? "").slice(0, 80).replace(/\n/g, " ");
        node.iconPath = new vscode.ThemeIcon("references");
        node.command = {
          command: "lifeloop.revealTask",
          title: "Open",
          arguments: [node],
        };
        return node;
      });
  }
}
