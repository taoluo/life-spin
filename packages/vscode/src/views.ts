import * as vscode from "vscode";
import {
  today, upcoming, projectSignals, day, tasks,
  pending, openMentions, mentions, byPage,
  birthdaySignals, reconnectSignals, personContext, people,
  type LifeloopObject,
} from "@lifeloop/semantic-core";
import type { LifeLoop } from "./workspace.ts";
import { taskTargetFromIndexed, type TaskCommandHandle } from "./task-target.ts";

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
    readonly handle?: TaskCommandHandle,
    readonly page?: string,
    readonly offset?: number,
  ) {
    super(label, collapsible);
  }
}



/** Build a node from a task object, capturing the receipt I4 requires. */
function taskNode(
  lifeloop: LifeLoop,
  task: LifeloopObject,
  showPage = true,
  reason?: string,
): Node {
  const target = taskTargetFromIndexed(lifeloop, task);
  const page = String(task.page ?? "");
  const indexedRef = String(task.ref);
  const node = new Node(
    String(task.name ?? "").trim() || "(empty task)",
    vscode.TreeItemCollapsibleState.None,
    undefined,
    target?.handle,
    page,
    target?.offset,
  );
  node.id = indexedRef;
  if (node.handle) node.contextValue = "lifeloopTask";
  node.iconPath = new vscode.ThemeIcon(task.done ? "check" : "circle-large-outline");
  const bits: string[] = [];
  if (showPage) bits.push(page);
  if (typeof task.deadline === "string") bits.push(`due ${task.deadline}`);
  if (typeof task.scheduled === "string") bits.push(`for ${task.scheduled}`);
  if (!node.handle) bits.push("source action unavailable; use source commands");
  node.description = bits.join("  ·  ");
  node.tooltip = new vscode.MarkdownString(node.handle
    ? `\`${target!.line.trim()}\`\n\n_${page}_${reason ? `\n\nWhy: ${reason}` : ""}`
    : "Source action unavailable; open the source file and use cursor commands.");
  if (node.handle) node.command = {
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

function personNode(person: string, lifeloop: LifeLoop, detail?: string): Node {
  const node = new Node(person.split("/").at(-1) ?? person, vscode.TreeItemCollapsibleState.None, undefined, undefined, person);
  node.contextValue = "lifeloopPerson";
  node.iconPath = new vscode.ThemeIcon("person");
  node.description = detail;
  node.command = { command: "vscode.open", title: "Open Person", arguments: [lifeloop.pageUri(person)] };
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
      section("Overdue", t.overdue.map((x) => taskNode(this.lifeloop, x, true, `deadline ${x.deadline} is before today`)), "flame"),
      section("Due today", t.due.map((x) => taskNode(this.lifeloop, x, true, "deadline is today")), "calendar"),
      section("Scheduled", t.scheduled.map((x) => taskNode(this.lifeloop, x, true, "scheduled for today")), "clock"),
      section("Waiting", t.waiting.map((x) => taskNode(this.lifeloop, x, true, "task or inherited context is tagged #waiting")), "watch"),
    ].filter((n): n is Node => n !== null);

    const days = upcoming(this.lifeloop.store, day(), this.lifeloop.config("upcomingDays", 14));
    const later = days.map((d) =>
      section(d.date, d.tasks.map((x) => taskNode(
        this.lifeloop,
        x,
        true,
        `${x.deadline === d.date ? "deadline" : "scheduled date"} is ${d.date}`,
      ))),
    ).filter((n): n is Node => n !== null);
    if (later.length) {
      nodes.push(new Node("Upcoming", vscode.TreeItemCollapsibleState.Collapsed, later));
    }
    const relationshipFacts = new Map<string, string[]>();
    for (const signal of birthdaySignals(
      this.lifeloop.store, day(), this.lifeloop.config("upcomingDays", 14),
    )) {
      const detail = signal.daysUntil === 0 ? "birthday today"
        : signal.daysUntil === 1 ? "birthday tomorrow" : `birthday ${signal.nextBirthday}`;
      relationshipFacts.set(signal.person, [detail]);
    }
    for (const signal of reconnectSignals(this.lifeloop.store, day())) {
      const detail = signal.kind === "never-contacted"
        ? "never contacted"
        : `last ${signal.lastInteraction?.date} · due ${signal.due}`;
      relationshipFacts.set(signal.person, [...(relationshipFacts.get(signal.person) ?? []), detail]);
    }
    const relationship = [...relationshipFacts].map(([person, details]) =>
      personNode(person, this.lifeloop, details.join(" · ")));
    const peopleSection = section("People", relationship, "person");
    if (peopleSection) {
      peopleSection.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      nodes.push(peopleSection);
    }
    if (nodes.length === 0) {
      const empty = new Node("Nothing due today", vscode.TreeItemCollapsibleState.None);
      empty.iconPath = new vscode.ThemeIcon("check-all");
      return [empty];
    }

    return nodes;
  }
}

/** Derived relationship context for the active Person page. */
export class PersonContextView extends BaseProvider {
  protected roots(): Node[] {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") return [];
    const person = this.lifeloop.pageNameOfUri(editor.document.uri);
    if (!people(this.lifeloop.store).some((candidate) => candidate.ref === person)) return [];
    const context = personContext(this.lifeloop.store, person);
    if (!context) return [];

    const roots: Node[] = [];
    if (context.lastInteraction) {
      const last = context.lastInteraction;
      const node = new Node(`${last.kind} · ${last.date}`, vscode.TreeItemCollapsibleState.None, undefined, undefined, last.page, last.offset);
      node.iconPath = new vscode.ThemeIcon("history");
      node.description = last.text;
      node.command = { command: "lifeloop.revealTask", title: "Open interaction", arguments: [node] };
      roots.push(node);
    } else {
      roots.push(new Node("No recorded interactions", vscode.TreeItemCollapsibleState.None));
    }

    const followups = section("Open follow-ups", context.openFollowups.map((task) => taskNode(this.lifeloop, task, true)), "checklist");
    if (followups) roots.push(followups);
    const recent = context.interactions.slice(1, 11).map((entry) => {
      const node = new Node(`${entry.date} · ${entry.kind}`, vscode.TreeItemCollapsibleState.None, undefined, undefined, entry.page, entry.offset);
      node.description = entry.text;
      node.command = { command: "lifeloop.revealTask", title: "Open interaction", arguments: [node] };
      return node;
    });
    const history = section("Earlier interactions", recent, "history");
    if (history) roots.push(history);
    return roots;
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

/** Open tasks on other pages that inherit a link to the current page. */
export class LinkedTasksView extends BaseProvider {
  constructor(lifeloop: LifeLoop) {
    super(lifeloop);
  }

  protected roots(): Node[] {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") return [];
    const page = this.lifeloop.pageNameOfUri(editor.document.uri);
    return tasks.universe(this.lifeloop.store)
      .filter((task) => !task.done && task.page !== page &&
        (task.ilinks as string[] | undefined)?.includes(page))
      .map((task) => taskNode(
        this.lifeloop,
        task,
        true,
        (task.links as string[] | undefined)?.includes(page)
          ? `task directly links to [[${page}]]`
          : `task inherits a link to [[${page}]] from its containing context`,
      ));
  }
}

/**
 * The Mention Inbox — what has been addressed to you.
 *
 * Grouped by page, as upstream groups it, because a mention's context is the page
 * it was written on and answering three of them at once means opening one file.
 *
 * Whose inbox this is comes from `lifeloop.identity`. Unset, the view says so
 * rather than guessing from a git config or an email address: showing someone
 * else's mentions as yours is worse than showing none.
 */
export class MentionsView extends BaseProvider {
  protected roots(): Node[] {
    const me = vscode.workspace.getConfiguration("lifeloop").get<string>("identity", "").trim();
    if (!me) {
      const node = new Node("Set lifeloop.identity to see your mentions", vscode.TreeItemCollapsibleState.None);
      node.command = {
        command: "workbench.action.openSettings",
        title: "Open settings",
        arguments: ["lifeloop.identity"],
      };
      return [node];
    }

    const open = openMentions(this.lifeloop.store, me);
    if (open.length === 0) {
      const all = mentions(this.lifeloop.store, me).length;
      return [new Node(
        all ? `Nothing open for @${me.replace(/^@/, "")}` : `No one has mentioned @${me.replace(/^@/, "")}`,
        vscode.TreeItemCollapsibleState.None,
      )];
    }

    return byPage(open).map((group) => {
      const children = group.mentions.map((mention) => {
        const node = new Node(
          mention.snippet.slice(0, 100) || "(empty)",
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined,
          mention.page,
          mention.pos ?? 0,
        );
        node.iconPath = new vscode.ThemeIcon(mention.fromTag === "task" ? "circle-large-outline" : "mention");
        node.contextValue = "lifeloopMention";
        node.command = { command: "lifeloop.revealTask", title: "Open", arguments: [node] };
        return node;
      });
      const parent = new Node(
        group.page,
        vscode.TreeItemCollapsibleState.Expanded,
        children,
        undefined,
        group.page,
        children[0]?.offset,
      );
      parent.description = `${children.length}`;
      parent.iconPath = new vscode.ThemeIcon("file");
      return parent;
    });
  }
}
