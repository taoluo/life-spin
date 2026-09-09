import { expect, test, describe } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Store, indexVault, NodeVault, markdownFiles, pageNameOf,
  capture, pending, linkToProject, makeTask, setTaskState, setTaskAttribute,
  setProjectStatus, attachPageToTask, freezeReview, toggleParked,
  runProjection, today, review, week, day,
} from "@lifeloop/semantic-core";

/**
 * The loop, end to end, against a real vault on a real filesystem.
 *
 * capture → context → act → today → done → review ↺
 *
 * Unit tests prove each mutation refuses correctly; this proves they compose into
 * the thing the README promises, with the index following along. No mocks: real
 * files, real SQLite, real reindexing between steps.
 */

class Workspace {
  readonly store: Store;
  readonly vault: CheckedNodeVault;
  private paths: string[] = [];

  private constructor(readonly root: string) {
    this.store = new Store(join(root, "index.sqlite"));
    this.vault = new CheckedNodeVault(root, () => this.paths);
  }

  static async create(files: Record<string, string> = {}): Promise<Workspace> {
    const root = mkdtempSync(join(tmpdir(), "lifeloop-loop-"));
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), body);
    }
    const workspace = new Workspace(root);
    await workspace.reindex();
    return workspace;
  }

  async reindex(): Promise<void> {
    this.paths = await markdownFiles(this.root);
    await indexVault(this.root, this.store);
  }

  read(page: string): string {
    return readFileSync(join(this.root, `${page}.md`), "utf8");
  }

  taskRef(page: string, contains: string): string {
    const text = this.read(page);
    const index = text.indexOf(contains);
    if (index === -1) throw new Error(`no line containing ${contains} in ${page}`);
    const start = text.lastIndexOf("\n", index) + 1;
    return `${page}@${start}`;
  }

  handle(page: string, contains: string) {
    const text = this.read(page);
    const index = text.indexOf(contains);
    const start = text.lastIndexOf("\n", index) + 1;
    const end = text.indexOf("\n", index);
    const line = text.slice(start, end === -1 ? text.length : end);
    return {
      ref: `${page}@${start}`,
      expectedText: line,
      expectedState: /\[([^\]])\]/.exec(line)?.[1],
    };
  }

  dispose(): void {
    this.store.close();
    rmSync(this.root, { recursive: true, force: true });
  }
}

/** Test-only checked adapter; production disk mutations go through VS Code's versioned edits. */
class CheckedNodeVault extends NodeVault {
  async writeIfUnchanged(path: string, before: string | null, after: string | null): Promise<boolean> {
    const current = this.exists(path) ? this.read(path) : null;
    if (current !== before) return false;
    if (after === null) await this.remove(path);
    else await this.write(path, after);
    return true;
  }
}

describe("the whole loop", () => {
  test("capture → process → act → today → done → review", async () => {
    const workspace = await Workspace.create({
      "Projects/Paper.md": "---\ntags: project\nstatus: active\n---\n\n# Paper\n\n",
      "Inbox.md": "Captured items land here.\n\n",
    });

    try {
      // 1. Capture — no navigation, no filing.
      expect((await capture(workspace.vault, "chase the reviewer feedback")).ok).toBe(true);
      expect((await capture(workspace.vault, "book the room")).ok).toBe(true);
      await workspace.reindex();
      expect(pending(workspace.read("Inbox"))).toHaveLength(2);

      // 2. Process — link, keeping the wording where it happened.
      const [first] = pending(workspace.read("Inbox"));
      expect((await linkToProject(workspace.vault, first, "Projects/Paper")).ok).toBe(true);
      await workspace.reindex();

      const inbox = workspace.read("Inbox");
      expect(inbox).toContain("chase the reviewer feedback [[Projects/Paper]]");
      expect(inbox.indexOf("chase the reviewer")).toBeGreaterThan(inbox.indexOf("## Processed"));
      expect(pending(workspace.read("Inbox"))).toHaveLength(1);

      // 3. Give the project work, and put one of them on today.
      writeFileSync(
        join(workspace.root, "Projects/Paper.md"),
        "---\ntags: project\nstatus: active\n---\n\n# Paper\n\n" +
          "* [ ] draft the introduction\n* [ ] chase the reviewer\n* [ ] wait on legal\n",
      );
      await workspace.reindex();

      expect(
        (await setTaskAttribute(workspace.vault, workspace.handle("Projects/Paper", "draft the introduction"),
          "deadline", "2026-09-08")).ok,
      ).toBe(true);
      expect(
        (await toggleParked(workspace.vault, workspace.handle("Projects/Paper", "wait on legal"), "waiting")).ok,
      ).toBe(true);
      await workspace.reindex();

      // 4. Today shows it, disjoint, and parked work is not actionable.
      const t = today(workspace.store, "2026-09-08");
      expect(t.due.map((x) => x.name)).toEqual(["draft the introduction"]);
      expect(t.waiting.map((x) => x.name)).toEqual(["wait on legal"]);

      // 5. Do it. The completion date is recorded, not reconstructed.
      expect(
        (await setTaskState(workspace.vault, workspace.handle("Projects/Paper", "draft the introduction"),
          true, new Date("2026-09-08T09:00:00Z"))).ok,
      ).toBe(true);
      await workspace.reindex();
      expect(workspace.read("Projects/Paper")).toContain(
        '* [x] draft the introduction [deadline: "2026-09-08"] [completed: "2026-09-08"]',
      );

      // It leaves Today the moment the source changes — membership is derived.
      expect(today(workspace.store, "2026-09-08").due).toHaveLength(0);

      // 6. Review covers the week it happened in.
      const sections = review(workspace.store, "2026-09-08");
      expect(sections.week).toEqual(week("2026-09-08"));
      expect(sections.completed.map((x) => x.name)).toEqual(["draft the introduction"]);
      expect(sections.waiting.map((x) => x.name)).toEqual(["wait on legal"]);
      expect(sections.activeProjects.map((x) => x.ref)).toContain("Projects/Paper");
    } finally {
      workspace.dispose();
    }
  });

  test("freezing a review makes a snapshot that stays true", async () => {
    const workspace = await Workspace.create({
      "Work.md": '* [x] shipped it [completed: "2026-09-08"]\n',
      "Reviews/2026-09-07.md": [
        "---", "week: 2026-09-07", "---", "",
        "## Completed", "", "${lifeloop.review.completed()}", "",
        "## Reflection", "", "went fine", "",
      ].join("\n"),
    });

    try {
      const sections = review(workspace.store, "2026-09-08");
      const render = (name: string) =>
        name === "completed"
          ? sections.completed.map((t: any) => `* ${t.name}`).join("\n") || "_nothing_"
          : null;

      expect((await freezeReview(workspace.vault, "Reviews/2026-09-07", render, "2026-09-13")).ok).toBe(true);
      const frozen = workspace.read("Reviews/2026-09-07");
      expect(frozen).toContain("frozen: 2026-09-13");
      expect(frozen).toContain("* shipped it");
      expect(frozen).toContain("went fine");

      // The vault changing afterwards does not change the snapshot.
      writeFileSync(join(workspace.root, "Work.md"),
        '* [x] shipped it [completed: "2026-09-08"]\n* [x] and another [completed: "2026-09-09"]\n');
      await workspace.reindex();
      expect(workspace.read("Reviews/2026-09-07")).toBe(frozen);

      // And a second freeze refuses rather than doubling it.
      expect(await freezeReview(workspace.vault, "Reviews/2026-09-07", render, "2026-09-13"))
        .toMatchObject({ ok: false });
      expect(workspace.read("Reviews/2026-09-07")).toBe(frozen);
    } finally {
      workspace.dispose();
    }
  });

  test("attaching a page gives a task a home without changing what it is", async () => {
    const workspace = await Workspace.create({ "Work.md": "* [ ] write the spec\n" });
    try {
      expect(
        (await attachPageToTask(workspace.vault, workspace.handle("Work", "write the spec"), "Specs/Draft")).ok,
      ).toBe(true);
      await workspace.reindex();

      // Still an ordinary checkbox; it gained a link, it did not become a new kind of thing.
      expect(workspace.read("Work")).toBe("* [ ] write the spec [[Specs/Draft]]\n");
      expect(workspace.read("Specs/Draft")).toContain("# Draft");
      expect(runProjection(workspace.store, "actionable", {}) as any[]).toHaveLength(1);
    } finally {
      workspace.dispose();
    }
  });

  test("a project moves through its lifecycle without moving its file", async () => {
    const workspace = await Workspace.create({
      "Work/Q3.md": "---\ntags: project\nstatus: active\n---\n# Q3\n",
    });
    try {
      expect((await setProjectStatus(workspace.vault, "Work/Q3", "archived")).ok).toBe(true);
      await workspace.reindex();
      expect(workspace.read("Work/Q3")).toContain("status: archived");
      // Archiving is semantic. The path is not identity, so nothing moved.
      expect(workspace.vault.exists("Work/Q3.md")).toBe(true);
    } finally {
      workspace.dispose();
    }
  });

  test("deleting the index and rebuilding recovers everything", async () => {
    const workspace = await Workspace.create({
      "Projects/P.md": "---\ntags: project\n---\n* [ ] a [deadline: \"2026-09-08\"]\n",
      "Journal/2026-09-08.md": "Talked to [[Projects/P]] about the decoder.\n",
    });
    try {
      const before = workspace.store.dump();
      expect(before.length).toBeGreaterThan(0);

      const rebuilt = new Store(":memory:");
      await indexVault(workspace.root, rebuilt);
      expect(rebuilt.dump()).toBe(before);
      rebuilt.close();
    } finally {
      workspace.dispose();
    }
  });
});
