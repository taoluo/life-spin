import { expect, test, describe } from "vitest";
import { MemoryVault } from "../vault.ts";
import { setTaskState, stampCompletion, toggleParked, setTaskAttribute, cycleTaskState } from "./tasks.ts";
import { capture, captureHere, ensureInbox, pending, processItem, linkToProject, makeTask } from "./inbox.ts";
import { setProjectStatus, attachPageToTask, patchFrontmatter } from "./pages.ts";

/**
 * The suite spends as much effort on what must *not* happen as on what must.
 * Every refusal here asserts the vault is byte-identical afterwards, because
 * "returned an error" and "wrote nothing" are different claims and only the
 * second one is the contract.
 */
const unchanged = (vault: MemoryVault, before: Record<string, string>) =>
  expect(vault.snapshot()).toEqual(before);

const refOf = (text: string, needle: string, page: string) =>
  `${page}@${text.indexOf(needle)}`;

describe("ticking a task", () => {
  const text = "* [ ] Write design\n* [x] Already done\n";
  const make = () => MemoryVault.of({ "Notes.md": text });

  test("stamps today's date when ticked", async () => {
    const vault = make();
    const result = await setTaskState(vault, { ref: refOf(text, "* [ ] Write", "Notes") }, true,
      new Date("2026-09-08T10:00:00Z"));
    expect(result.ok).toBe(true);
    expect(vault.read("Notes.md")).toContain('* [x] Write design [completed: "2026-09-08"]');
  });

  test("removes the stamp when reopened", async () => {
    const vault = MemoryVault.of({ "Notes.md": '* [x] Done [completed: "2026-09-01"]\n' });
    const result = await setTaskState(vault, { ref: "Notes@0" }, false);
    expect(result.ok).toBe(true);
    expect(vault.read("Notes.md")).toBe("* [ ] Done\n");
  });

  test("a task already done is refused, not re-stamped with today", async () => {
    // The guard that stops a checkbox ticked before any of this existed from
    // acquiring today's date as if it had just happened.
    const vault = make();
    const before = vault.snapshot();
    const result = await setTaskState(vault, { ref: refOf(text, "* [x] Already", "Notes") }, true);
    expect(result).toMatchObject({ ok: false, reason: "stale" });
    unchanged(vault, before);
  });

  test("a handle whose text has changed writes nothing", async () => {
    const vault = make();
    const before = vault.snapshot();
    const result = await setTaskState(
      vault,
      { ref: "Notes@0", expectedText: "* [ ] Something else entirely" },
      true,
    );
    expect(result).toMatchObject({ ok: false, reason: "stale" });
    unchanged(vault, before);
  });

  test("a handle whose state has changed writes nothing", async () => {
    const vault = make();
    const before = vault.snapshot();
    const result = await setTaskState(vault, { ref: "Notes@0", expectedState: "x" }, false);
    expect(result).toMatchObject({ ok: false, reason: "stale" });
    unchanged(vault, before);
  });

  test("a ref past the end of a shrunken page writes nothing", async () => {
    const vault = make();
    const before = vault.snapshot();
    expect(await setTaskState(vault, { ref: "Notes@99999" }, true)).toMatchObject({
      ok: false, reason: "stale",
    });
    unchanged(vault, before);
  });

  test("a ref to a page that does not exist writes nothing", async () => {
    const vault = make();
    const before = vault.snapshot();
    expect(await setTaskState(vault, { ref: "Nowhere@0" }, true)).toMatchObject({
      ok: false, reason: "missing",
    });
    unchanged(vault, before);
  });

  test("an anchor ref resolves by name, not position", async () => {
    const vault = MemoryVault.of({ "Notes.md": "intro\n\n* [ ] Anchored $mytask\n" });
    const result = await setTaskState(vault, { ref: "Notes@mytask" }, true);
    expect(result.ok).toBe(true);
    expect(vault.read("Notes.md")).toContain("* [x] Anchored $mytask [completed:");
  });

  test("an anchor that has been removed writes nothing", async () => {
    const vault = MemoryVault.of({ "Notes.md": "* [ ] no anchor here\n" });
    const before = vault.snapshot();
    expect(await setTaskState(vault, { ref: "Notes@gone" }, true)).toMatchObject({
      ok: false, reason: "stale",
    });
    unchanged(vault, before);
  });
});

describe("stamping a completion from elsewhere", () => {
  test("uses the date it was given, never today", async () => {
    const vault = MemoryVault.of({ "Notes.md": "* [ ] Ticked on a watch\n" });
    expect((await stampCompletion(vault, { ref: "Notes@0" }, "2026-09-03")).ok).toBe(true);
    expect(vault.read("Notes.md")).toContain('[completed: "2026-09-03"]');
  });

  test("refuses a task that already carries a stamp", async () => {
    const vault = MemoryVault.of({ "Notes.md": '* [x] Done [completed: "2026-09-01"]\n' });
    const before = vault.snapshot();
    expect(await stampCompletion(vault, { ref: "Notes@0" }, "2026-09-03")).toMatchObject({ ok: false });
    unchanged(vault, before);
  });

  test("refuses a malformed date rather than writing it", async () => {
    const vault = MemoryVault.of({ "Notes.md": "* [ ] Task\n" });
    const before = vault.snapshot();
    expect(await stampCompletion(vault, { ref: "Notes@0" }, "yesterday")).toMatchObject({
      ok: false, reason: "invalid",
    });
    unchanged(vault, before);
  });
});

describe("parking a task", () => {
  test("adds and removes the tag on the task's own line", async () => {
    const vault = MemoryVault.of({ "Notes.md": "* [ ] Chase invoice\n" });
    const added = await toggleParked(vault, { ref: "Notes@0" }, "waiting");
    expect(added.ok && added.value.added).toBe(true);
    expect(vault.read("Notes.md")).toBe("* [ ] Chase invoice #waiting\n");
    const removed = await toggleParked(vault, { ref: "Notes@0" }, "waiting");
    expect(removed.ok && removed.value.added).toBe(false);
    expect(vault.read("Notes.md")).toBe("* [ ] Chase invoice\n");
  });
});

describe("task attributes", () => {
  test("set, replace and clear", async () => {
    const vault = MemoryVault.of({ "Notes.md": "* [ ] Task\n" });
    await setTaskAttribute(vault, { ref: "Notes@0" }, "deadline", "2026-09-15");
    expect(vault.read("Notes.md")).toBe('* [ ] Task [deadline: "2026-09-15"]\n');
    await setTaskAttribute(vault, { ref: "Notes@0" }, "deadline", "2026-09-20");
    expect(vault.read("Notes.md")).toBe('* [ ] Task [deadline: "2026-09-20"]\n');
    await setTaskAttribute(vault, { ref: "Notes@0" }, "deadline", null);
    expect(vault.read("Notes.md")).toBe("* [ ] Task\n");
  });

  test("duplicate attributes are ambiguous and remain untouched", async () => {
    const text = '* [ ] Task [reminder: "A"] [reminder: "B"]\n';
    const vault = MemoryVault.of({ "Notes.md": text });
    expect(await setTaskAttribute(vault, { ref: "Notes@0" }, "reminder", null))
      .toMatchObject({ ok: false, reason: "ambiguous" });
    expect(vault.read("Notes.md")).toBe(text);
  });
});

describe("capture", () => {
  test("lands above Processed, never in the pile already dealt with", async () => {
    const vault = MemoryVault.of({
      "Inbox.md": "* pending one\n\n## Processed\n\n* old thing\n",
    });
    expect((await capture(vault, "a new thought")).ok).toBe(true);
    const text = vault.read("Inbox.md");
    expect(text.indexOf("a new thought")).toBeLessThan(text.indexOf("## Processed"));
  });

  test("appends when there is no Processed heading", async () => {
    const vault = MemoryVault.of({ "Inbox.md": "* one\n" });
    await capture(vault, "two");
    expect(vault.read("Inbox.md")).toBe("* one\n* two\n");
  });

  test("creates the page when it does not exist, and refuses an empty line", async () => {
    const vault = MemoryVault.of({});
    expect(await capture(vault, "  ")).toMatchObject({ ok: false, reason: "invalid" });
    expect(vault.snapshot()).toEqual({});
    expect((await capture(vault, "first")).ok).toBe(true);
    expect(vault.read("Inbox.md")).toBe("* first\n");
  });

  test("does not overwrite an Inbox that appears during creation", async () => {
    class AppearingVault extends MemoryVault {
      private first = true;
      override exists(path: string): boolean {
        if (path === "Inbox.md" && this.first) { this.first = false; return false; }
        return super.exists(path);
      }
    }
    const vault = new AppearingVault(new Map([["Inbox.md", "created elsewhere\n"]]));
    expect(await ensureInbox(vault)).toMatchObject({ ok: false, reason: "stale" });
    expect(vault.read("Inbox.md")).toBe("created elsewhere\n");
  });

  test("Capture Here preserves CRLF and refuses a changed page", async () => {
    const original = "# Work\r\ncontext\r\n";
    const vault = MemoryVault.of({ "Work.md": original });
    expect((await captureHere(vault, "Work", original.indexOf("context") + "context\r\n".length, "do it", original)).ok).toBe(true);
    expect(vault.read("Work.md")).toBe("# Work\r\ncontext\r\n* [ ] do it\r\n");
    const before = vault.read("Work.md");
    expect(await captureHere(vault, "Work", 0, "stale", original)).toMatchObject({ ok: false, reason: "stale" });
    expect(vault.read("Work.md")).toBe(before);
  });
});

describe("processing an inbox item", () => {
  const text = "* parent item\n  * nested child\n* second item\n\n## Processed\n\n* done before\n";
  const make = () => MemoryVault.of({ "Inbox.md": text, "Projects/Foo.md": "# Foo\n" });

  test("pending items are whole subtrees", async () => {
    const items = pending(text);
    expect(items).toHaveLength(2);
    expect(items[0].text).toBe("* parent item\n  * nested child");
  });

  test("a subtree moves entirely", async () => {
    const vault = make();
    const [item] = pending(text);
    expect((await processItem(vault, item, null)).ok).toBe(true);
    const after = vault.read("Inbox.md");
    expect(after).toContain("* parent item\n  * nested child");
    expect(after.indexOf("parent item")).toBeGreaterThan(after.indexOf("## Processed"));
    expect(after).toContain("* second item");
  });

  test("an item that no longer matches what was listed writes nothing", async () => {
    const vault = make();
    const [item] = pending(text);
    vault.write("Inbox.md", text.replace("parent item", "edited since"));
    const before = vault.snapshot();
    expect(await processItem(vault, item, null)).toMatchObject({ ok: false, reason: "stale" });
    unchanged(vault, before);
  });

  test("link to project appends the link and keeps the wording in place", async () => {
    const vault = make();
    const [item] = pending(text);
    expect((await linkToProject(vault, item, "Projects/Foo")).ok).toBe(true);
    expect(vault.read("Inbox.md")).toContain("* parent item [[Projects/Foo]]");
  });

  test("linking to a project that does not exist writes nothing", async () => {
    const vault = make();
    const [item] = pending(text);
    const before = vault.snapshot();
    expect(await linkToProject(vault, item, "Projects/Nope")).toMatchObject({
      ok: false, reason: "missing",
    });
    unchanged(vault, before);
  });

  test("make task converts the bullet and keeps it an ordinary checkbox", async () => {
    const vault = make();
    const [item] = pending(text);
    expect((await makeTask(vault, item)).ok).toBe(true);
    expect(vault.read("Inbox.md")).toContain("* [ ] parent item");
  });
});

describe("project lifecycle", () => {
  test("patches status without reformatting the rest of the frontmatter", async () => {
    const vault = MemoryVault.of({
      "P.md": "---\ntags: project\nstatus: active\nnote: 'keep me'\n---\n# P\n",
    });
    expect((await setProjectStatus(vault, "P", "paused")).ok).toBe(true);
    expect(vault.read("P.md")).toBe("---\ntags: project\nstatus: paused\nnote: 'keep me'\n---\n# P\n");
  });

  test("archiving sets a status and does not move the page", async () => {
    const vault = MemoryVault.of({ "Work/P.md": "---\ntags: project\n---\n" });
    expect((await setProjectStatus(vault, "Work/P", "archived")).ok).toBe(true);
    expect(vault.exists("Work/P.md")).toBe(true);
    expect(vault.read("Work/P.md")).toContain("status: archived");
  });

  test("an unknown status is refused", async () => {
    const vault = MemoryVault.of({ "P.md": "---\ntags: project\n---\n" });
    const before = vault.snapshot();
    expect(await setProjectStatus(vault, "P", "blocked" as any)).toMatchObject({
      ok: false, reason: "invalid",
    });
    unchanged(vault, before);
  });

  test("a page with no frontmatter gains one", async () => {
    const vault = MemoryVault.of({ "P.md": "# P\n" });
    const patched = await patchFrontmatter(vault, "P", "status", "active");
    expect(patched.ok && patched.value.created).toBe(true);
    expect(vault.read("P.md")).toBe("---\nstatus: active\n---\n# P\n");
  });
});

describe("attaching a page to a task", () => {
  const text = "* [ ] Write the paper\n";

  test("creates the page and links the task, which stays a checkbox", async () => {
    const vault = MemoryVault.of({ "Notes.md": text });
    const result = await attachPageToTask(vault, { ref: "Notes@0" }, "Papers/Draft");
    expect(result.ok).toBe(true);
    expect(vault.read("Notes.md")).toBe("* [ ] Write the paper [[Papers/Draft]]\n");
    expect(vault.read("Papers/Draft.md")).toContain("# Draft");
  });

  test("a name already taken writes nothing at all", async () => {
    const vault = MemoryVault.of({ "Notes.md": text, "Papers/Draft.md": "mine\n" });
    const before = vault.snapshot();
    expect(await attachPageToTask(vault, { ref: "Notes@0" }, "Papers/Draft")).toMatchObject({
      ok: false, reason: "collision",
    });
    unchanged(vault, before);
  });

  test("a cancelled destination writes nothing", async () => {
    const vault = MemoryVault.of({ "Notes.md": text });
    const before = vault.snapshot();
    expect(await attachPageToTask(vault, { ref: "Notes@0" }, "")).toMatchObject({
      ok: false, reason: "cancelled",
    });
    unchanged(vault, before);
  });

  test("a stale source leaves no orphan page behind", async () => {
    // The precondition order that matters: the task is checked before the page is
    // made, so a refusal cannot leave a file nobody asked for.
    const vault = MemoryVault.of({ "Notes.md": text });
    const before = vault.snapshot();
    expect(
      await attachPageToTask(vault, { ref: "Notes@0", expectedText: "* [ ] something else" }, "Papers/X"),
    ).toMatchObject({ ok: false, reason: "stale" });
    unchanged(vault, before);
    expect(vault.exists("Papers/X.md")).toBe(false);
  });
});

describe("a write that fails is not a success", () => {
  /**
   * Regression. `Vault.write` used to be synchronous, which forced the VS Code
   * implementation to discard the promise from `applyEdit` — so a command reported
   * success, and reindexed, before the write had landed, and a *rejected* edit
   * reached nobody at all. Writes are awaited now, and this is what proves it:
   * a vault that refuses must surface the refusal rather than swallow it.
   */
  class RefusingVault extends MemoryVault {
    constructor(files: Record<string, string>, private readonly failOn: string) {
      super(new Map(Object.entries(files)));
    }
    override async writeIfUnchanged(path: string, before: string | null, after: string | null): Promise<boolean> {
      if (path === this.failOn) {
        throw new Error(`the editor refused the edit to ${path}`);
      }
      return super.writeIfUnchanged(path, before, after);
    }
  }

  test("a refused write returns UNKNOWN after an authoritative reread", async () => {
    const vault = new RefusingVault({ "Notes.md": "* [ ] a task\n" }, "Notes.md");
    const result = await setTaskState(vault, { ref: "Notes@0" }, true);
    expect(result).toMatchObject({ ok: false, reason: "unknown" });
    expect(result.ok ? "" : result.message).toContain("authoritative reread found no applied changes");
    expect(vault.read("Notes.md")).toBe("* [ ] a task\n");
  });

  test("a composite mutation surfaces a failure on its second write", async () => {
    // attachPageToTask writes the destination first, then the task line. If the
    // second write fails, the caller must hear about it — silently succeeding here
    // would leave a page nobody asked for and a task that never gained its link.
    const vault = new RefusingVault({ "Notes.md": "* [ ] write the spec\n" }, "Notes.md");
    const result = await attachPageToTask(vault, { ref: "Notes@0" }, "Specs/Draft");
    expect(result).toMatchObject({ ok: false, reason: "unknown" });
    expect(result.ok ? "" : result.message).toMatch(/refused the edit/);
    expect(vault.read("Notes.md")).toBe("* [ ] write the spec\n");
    // The compensating delete removed the page it had just created.
    expect(vault.exists("Specs/Draft.md")).toBe(false);
  });
});

test("completion uses SB open/custom-done semantics rather than non-space markers", async () => {
  const waiting = MemoryVault.of({ "W.md": "* [w] waiting\n" });
  expect((await setTaskState(waiting, { ref: "W@0" }, true)).ok).toBe(true);
  expect(waiting.read("W.md")).toContain("* [x] waiting [completed:");
  const custom = MemoryVault.of({ "W.md": '* [d] finished [completed: "2020-01-01"]\n' });
  const states = [{ state: "d", done: true }];
  const original = custom.read("W.md");
  expect(await setTaskState(custom, { ref: "W@0" }, true, new Date(), states)).toMatchObject({ ok: false, reason: "stale" });
  expect(custom.read("W.md")).toBe(original);
  expect((await setTaskState(custom, { ref: "W@0" }, false, new Date(), states)).ok).toBe(true);
  expect(custom.read("W.md")).toBe("* [ ] finished\n");
});

test.each(["x", "X"])("built-in done state %s needs no explicit done flag and cycles back to open", async state => {
  const vault = MemoryVault.of({ "W.md": "* [ ] task\n" });
  const states = [{ state: " " }, { state }];
  await cycleTaskState(vault, { ref: "W@0" }, states);
  expect(vault.read("W.md")).toContain(`* [${state}] task [completed:`);
  await cycleTaskState(vault, { ref: "W@0" }, states);
  expect(vault.read("W.md")).toBe("* [ ] task\n");
});

describe("cycling a task through custom states", () => {
  const states = [
    { state: " " },
    { state: "w" },
    { state: "x", done: true },
  ];

  test("clicking moves through the cycle and always reaches done", async () => {
    const vault = MemoryVault.of({ "W.md": "* [ ] a task\n" });
    const at = { ref: "W@0" };

    const first = await cycleTaskState(vault, at, states);
    expect(first.ok && first.value.state).toBe("w");
    expect(vault.read("W.md")).toBe("* [w] a task\n");

    const second = await cycleTaskState(vault, at, states, new Date("2026-09-08T12:00:00Z"));
    expect(second.ok && second.value.state).toBe("x");
    expect(vault.read("W.md")).toContain("* [x] a task [completed:");

    // And round again, dropping the stamp on the way out.
    const third = await cycleTaskState(vault, at, states);
    expect(third.ok && third.value.state).toBe(" ");
    expect(vault.read("W.md")).toBe("* [ ] a task\n");
  });

  test("done is added even if a vault forgets to declare it", async () => {
    // The failure that made LifeLoop refuse custom states in the first place: a
    // cycle with no done state means a task can never be finished by clicking.
    const vault = MemoryVault.of({ "W.md": "* [ ] a task\n" });
    const noDone = [{ state: " " }, { state: "w" }];

    await cycleTaskState(vault, { ref: "W@0" }, noDone);
    await cycleTaskState(vault, { ref: "W@0" }, noDone);
    expect(vault.read("W.md")).toContain("* [x] a task");
  });

  test("an unknown current state re-enters the cycle at the start", async () => {
    const vault = MemoryVault.of({ "W.md": "* [z] from another tool\n" });
    const result = await cycleTaskState(vault, { ref: "W@0" }, states);
    expect(result.ok && result.value.state).toBe(" ");
  });

  test("with no declared states it behaves exactly as a plain checkbox", async () => {
    const vault = MemoryVault.of({ "W.md": "* [ ] a task\n" });
    await cycleTaskState(vault, { ref: "W@0" });
    expect(vault.read("W.md")).toContain("* [x] a task [completed:");
    await cycleTaskState(vault, { ref: "W@0" });
    expect(vault.read("W.md")).toBe("* [ ] a task\n");
  });

  test("a stale handle refuses and writes nothing", async () => {
    const vault = MemoryVault.of({ "W.md": "* [ ] a task\n" });
    const before = vault.snapshot();
    const result = await cycleTaskState(
      vault, { ref: "W@0", expectedText: "* [ ] something else" }, states,
    );
    expect(result).toMatchObject({ ok: false, reason: "stale" });
    expect(vault.snapshot()).toEqual(before);
  });
});


test("declared multi-character states preserve identity, children and completion history", async () => {
  const states = [{ state: "TO DO" }, { state: "IN PROGRESS" }, { state: "DONE", done: true }];
  const text = "* [TO DO] parent\r\n  * [ ] child\r\n";
  const vault = MemoryVault.of({ "W.md": text });
  expect((await cycleTaskState(vault, { ref: "W@0", expectedState: "TO DO", expectedText: "* [TO DO] parent" }, states)).ok).toBe(true);
  expect(vault.read("W.md")).toBe(text.replace("TO DO", "IN PROGRESS"));
  expect((await cycleTaskState(vault, { ref: "W@0", expectedState: "IN PROGRESS" }, states)).ok).toBe(true);
  const completed = vault.read("W.md");
  expect(completed).toContain("* [DONE] parent [completed:");
  expect(completed).toContain("\r\n  * [ ] child\r\n");
  expect(await setTaskState(vault, { ref: "W@0", expectedState: "DONE" }, true, new Date(), states)).toMatchObject({ ok: false });
  expect(vault.read("W.md")).toBe(completed);
  expect((await setTaskState(vault, { ref: "W@0", expectedState: "DONE" }, false, new Date(), states)).ok).toBe(true);
  expect(vault.read("W.md")).toBe(text.replace("TO DO", " "));
});

test("undeclared multi-character state and invalid configured marker never write", async () => {
  const text = "* [MYSTERY STATE] parent\n";
  const vault = MemoryVault.of({ "W.md": text });
  expect(await setTaskState(vault, { ref: "W@0" }, true)).toMatchObject({ ok: false, reason: "invalid" });
  expect(await cycleTaskState(vault, { ref: "W@0" })).toMatchObject({ ok: false, reason: "invalid" });
  await expect(cycleTaskState(vault, { ref: "W@0" }, [{ state: "BAD]\n* [x" }])).rejects.toThrow("invalid task state marker");
  expect(vault.read("W.md")).toBe(text);
});


test("wiki-link list items cannot be mistaken for multi-character tasks", async () => {
  const text = "* [[Page]]\n";
  const vault = MemoryVault.of({ "W.md": text });
  const handle = { ref: "W@0" };
  for (const result of [
    await stampCompletion(vault, handle, "2026-09-08"),
    await toggleParked(vault, handle, "waiting"),
    await setTaskAttribute(vault, handle, "deadline", "2026-09-08"),
  ]) expect(result).toMatchObject({ ok: false });
  expect(vault.read("W.md")).toBe(text);
  const unknown = MemoryVault.of({ "W.md": "* [UNKNOWN STATE] task\n" });
  expect(await stampCompletion(unknown, handle, "2026-09-08")).toMatchObject({ ok: false, reason: "invalid" });
  expect(unknown.read("W.md")).toBe("* [UNKNOWN STATE] task\n");
});
