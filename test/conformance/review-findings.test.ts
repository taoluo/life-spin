import { expect, test, describe } from "vitest";
import {
  MemoryVault, Store, indexVault, capture, setTaskState, resolveRef,
  attachPageToTask, pending, processItem, day, week,
} from "@lifeloop/semantic-core";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { load } from "js-yaml";

/**
 * Regression tests for defects found by review after the phases were called done.
 *
 * Each of these was written to *fail* first, against a suite that was green at the
 * time. That is the point: a passing suite proves the cases someone thought of.
 * They are grouped by the review angle that produced them, because the angle is
 * what generalises — the next round should start from the same list.
 */

describe("1. mutation safety and task identity", () => {
  test("a duplicated anchor must refuse, not silently pick the first", async () => {
    const vault = MemoryVault.of({
      "W.md": "* [ ] first $dup\n* [ ] second $dup\n",
    });
    const resolved = resolveRef(vault, "W@dup");
    expect(resolved, "an ambiguous anchor should refuse").toMatchObject({
      ok: false, reason: "ambiguous",
    });
  });

  test("only complete parsed anchor tokens can identify a task", async () => {
    for (const literal of ["$anchor-long", "$anchor/child", "$anchor:child", "`$anchor`", "\\$anchor", "```\n$anchor\n```"] ) {
      const text = `* [ ] wrong target ${literal}\n`;
      const vault = MemoryVault.of({ "W.md": text });
      expect(await setTaskState(vault, { ref: "W@anchor" }, true), literal)
        .toMatchObject({ ok: false, reason: "stale" });
      expect(vault.read("W.md")).toBe(text);
    }
  });

  test("an exact anchor remains unique beside longer names and literal examples", async () => {
    const prefix = "* [ ] other $anchor-long\n* [ ] example `$anchor`\n* [ ] escaped \\$anchor\n";
    const vault = MemoryVault.of({ "W.md": `${prefix}* [ ] correct $anchor\n` });
    expect((await setTaskState(vault, { ref: "W@anchor" }, true)).ok).toBe(true);
    expect(vault.read("W.md")).toContain(`${prefix}* [x] correct $anchor [completed:`);
  });

  test("anchor positions map back to original CRLF and mixed-line-ending source", async () => {
    for (const prefix of ["\r\n".repeat(20), "intro\n" + "\r\n".repeat(20)]) {
      const before = `${prefix}* [ ] WRONG\r\n* [ ] target $anchor\r\n`;
      const vault = MemoryVault.of({ "W.md": before });
      expect(resolveRef(vault, "W@anchor")).toMatchObject({ offset: before.indexOf("$anchor") });
      expect((await setTaskState(vault, { ref: "W@anchor" }, true)).ok).toBe(true);
      expect(vault.read("W.md")).toContain(`${prefix}* [ ] WRONG\r\n* [x] target $anchor [completed:`);
      expect(vault.read("W.md").split("\r\n").length).toBe(before.split("\r\n").length);
    }
  });

  test("a captured line containing a newline must not smuggle content past Processed", async () => {
    const vault = MemoryVault.of({ "Inbox.md": "* pending\n\n## Processed\n\n* old\n" });
    await capture(vault, "innocent\n## Processed\n* smuggled");
    const text = vault.read("Inbox.md");
    // The structural property: exactly one heading, at the start of a line.
    const headings = text.match(/^## Processed$/gm) ?? [];
    expect(headings, "capture created a second Processed heading").toHaveLength(1);
    // And the captured thought is still pending, not filed as done.
    expect(text.indexOf("innocent")).toBeLessThan(text.indexOf("## Processed"));
  });
});

describe("2. write lifecycle and concurrency", () => {
  test("two concurrent mutations on one page must not lose one", async () => {
    const vault = MemoryVault.of({ "W.md": "* [ ] a\n* [ ] b\n" });
    const text = vault.read("W.md");
    const aAt = text.indexOf("* [ ] a");
    const bAt = text.indexOf("* [ ] b");

    // Both read the same text, then both write the whole file. The invariant is
    // not that both succeed — it is that neither is *silently* lost. A mutation
    // whose page moved underneath must say so, so the caller can retry.
    const results = await Promise.all([
      setTaskState(vault, { ref: `W@${aAt}`, expectedText: "* [ ] a", expectedState: " " }, true),
      setTaskState(vault, { ref: `W@${bAt}`, expectedText: "* [ ] b", expectedState: " " }, true),
    ]);

    const applied = results.filter((r) => r.ok).length;
    const refused = results.filter((r) => !r.ok);
    expect(applied + refused.length).toBe(2);
    expect(refused.every((r: any) => r.reason === "stale")).toBe(true);

    const after = vault.read("W.md");
    const ticked = (after.match(/\* \[x\]/g) ?? []).length;
    expect(ticked, "an edit vanished without a refusal").toBe(applied);

    // Retrying the refused one succeeds, because nothing was corrupted.
    if (refused.length) {
      const bNow = after.indexOf("* [ ] b");
      const retry = await setTaskState(
        vault, { ref: `W@${bNow}`, expectedText: "* [ ] b", expectedState: " " }, true,
      );
      expect(retry.ok).toBe(true);
      expect(vault.read("W.md")).toContain("* [x] b");
    }
  });
});

describe("3. apple bridge authority", () => {
  test("a reminder created but never bound is cleaned up, not left orphaned", async () => {
    // create() succeeding and the binding write then failing leaves a reminder
    // over there with nothing pointing at it — invisible, and duplicated on the
    // next attempt. The same compensation attachPageToTask uses: create the
    // fallible thing last, and undo it if what follows fails.
    const { bindReminder } = await import("@lifeloop/apple-bridge");
    const vault = MemoryVault.of({ "W.md": "* [ ] a task\n" });
    const deleted: string[] = [];
    const bridge = {
      async create() { return "R-created"; },
      async remove(id: string) { deleted.push(id); return true; },
    };

    const stale = { ref: "W@0", expectedText: "* [ ] something else", expectedState: " " };
    const result = await bindReminder(vault, stale as any, "a task", "", "", bridge as any);

    expect(result.ok).toBe(false);
    expect(deleted, "the orphaned reminder was not cleaned up").toEqual(["R-created"]);
  });

  test("an uncertain reminder binding reports and retains the created id", async () => {
    const { bindReminder } = await import("@lifeloop/apple-bridge");
    class ThrowingVault extends MemoryVault {
      override async write(): Promise<void> { throw new Error("editor refused write"); }
    }
    const vault = new ThrowingVault(new Map([["W.md", "* [ ] a task\n"]]));
    const deleted: string[] = [];
    const result = await bindReminder(
      vault, { ref: "W@0", expectedText: "* [ ] a task", expectedState: " " },
      "a task", "", "", {
        async create() { return "R-created"; },
        async remove(id: string) { deleted.push(id); return true; },
      } as any,
    );

    expect(result).toMatchObject({ ok: false, reason: "unknown", orphaned: "R-created" });
    expect(result.ok ? "" : result.message).toContain("binding outcome is unknown");
    expect(deleted).toEqual([]);
  });
});

describe("4. persistence and restart", () => {
  test("Notes import state must survive a restart, or every note re-imports", async () => {
    const { planImport, applyImport } = await import("@lifeloop/apple-bridge");
    const note = {
      id: "N1", name: "idea", body: "<div>an idea</div>",
      modified: "2026-09-08T10:00:00Z", rich: false,
    };
    const vault = MemoryVault.of({ "Inbox.md": "" });

    const first = { lastImported: new Map() };
    await applyImport(vault, "Inbox", planImport([note], "", first), first);

    // A fresh process: state is empty again, but the Inbox still has the line.
    const afterRestart = { lastImported: new Map() };
    const plan = planImport([note], vault.read("Inbox.md"), afterRestart);
    expect(plan[0].action, "a restart re-imported an already-imported note").not.toBe("create");
  });
});

describe("6. index and projection consistency", () => {
  test("a deleted page leaves no objects behind", async () => {
    const dir = mkdtempSync(join(tmpdir(), "probe-"));
    writeFileSync(join(dir, "A.md"), "* [ ] a task\n");
    const store = new Store(":memory:");
    await indexVault(dir, store);
    expect(store.objects("task")).toHaveLength(1);

    rmSync(join(dir, "A.md"));
    await indexVault(dir, store);
    expect(store.objects("task"), "objects survived their page being deleted").toHaveLength(0);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("7. boundary validation", () => {
  test("a page name cannot escape the vault", async () => {
    const vault = MemoryVault.of({ "W.md": "* [ ] a\n" });
    const result = await attachPageToTask(vault, { ref: "W@0" }, "../../etc/evil");
    expect(result.ok, "attach accepted a path outside the vault").toBe(false);
  });

  test("an inbox item whose text repeats elsewhere is matched by position, not by text", async () => {
    const vault = MemoryVault.of({ "Inbox.md": "* same\n* same\n" });
    const items = pending(vault.read("Inbox.md"));
    expect(items).toHaveLength(2);
    // Process the *second* one; the first must survive untouched.
    const result = await processItem(vault, items[1], null);
    expect(result.ok).toBe(true);
    const after = vault.read("Inbox.md");
    const stillPending = pending(after);
    expect(stillPending, "processing one item removed the wrong one").toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Second round: the same angles, probed again after the first set was fixed.
// ---------------------------------------------------------------------------

const vaultWith = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "probe2-"));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  return dir;
};

describe("input robustness", () => {
  test("an attribute value containing a quote does not corrupt the line", async () => {
    const { setTaskAttribute } = await import("@lifeloop/semantic-core");
    const vault = MemoryVault.of({ "W.md": "* [ ] a task\n" });
    const result = await setTaskAttribute(vault, { ref: "W@0" }, "reminder", 'x"y');
    // Either refuse it or store it safely — but the line must still parse as one
    // task with one attribute.
    if (result.ok) {
      const line = vault.read("W.md");
      expect((line.match(/\[reminder:/g) ?? []).length).toBe(1);
      expect(line.split("\n").filter(Boolean)).toHaveLength(1);
    } else {
      expect(result.reason).toBe("invalid");
    }
  });
});

describe("Foam migration templates", () => {
  test("the converted templates have valid frontmatter and no SB cursor markers", () => {
    const root = resolve(import.meta.dirname, "../../docs/migration/foam-templates");
    for (const name of ["daily-note", "project", "area", "person"]) {
      const text = readFileSync(join(root, `${name}.md`), "utf8");
      const match = /^---\n([\s\S]*?)\n---/.exec(text);
      expect(match, `${name} has no frontmatter`).not.toBeNull();
      expect(load(match![1]), `${name} frontmatter`).toBeTypeOf("object");
      expect(text).not.toContain("|^|");
    }
  });
});

describe("indexer failure behaviour", () => {
  test("a page that cannot be extracted does not leave the store mid-transaction", async () => {
    const dir = vaultWith({ "A.md": "* [ ] one\n", "B.md": "* [ ] two\n" });
    const store = new Store(":memory:");
    await indexVault(dir, store);

    // A real failure part-way through: a file that lists but cannot be read.
    // Reading happens outside the write transaction, so a throw here used to
    // strand the connection inside one.
    writeFileSync(join(dir, "A.md"), "* [ ] one changed\n");
    writeFileSync(join(dir, "B.md"), "* [ ] two changed\n");
    chmodSync(join(dir, "B.md"), 0o000);
    await indexVault(dir, store).catch(() => {});
    chmodSync(join(dir, "B.md"), 0o644);

    // Whatever happened, the store must still accept writes — an abandoned open
    // transaction would make every later write fail.
    expect(() => store.replacePage(
      { path: "C.md", name: "C", hash: "h", lastModified: "", size: 0 }, [], "text",
    ), "the store was left inside a transaction").not.toThrow();

    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a failed policy transition cannot certify a mixed index as the old policy", async () => {
    const pages = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`${i}.md`, "* [DONE] task\n"]));
    const dir = vaultWith(pages);
    const store = new Store(":memory:");
    const open = [{ state: "DONE", done: false }];
    const done = [{ state: "DONE", done: true }];
    try {
      await indexVault(dir, store, { taskStates: open });
      const write = store.writePage.bind(store);
      let calls = 0;
      store.writePage = ((...args: Parameters<Store["writePage"]>) => {
        if (++calls === 501) throw new Error("injected final-batch failure");
        return write(...args);
      }) as Store["writePage"];
      await expect(indexVault(dir, store, { taskStates: done })).rejects.toThrow("injected");
      store.writePage = write;

      const recovered = await indexVault(dir, store, { taskStates: open });
      expect(recovered.indexed).toBe(501);
      expect(store.objects("task").every((task) => task.done === false)).toBe(true);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("index and projection consistency", () => {
  test("indexing a page from disk must not undo a newer in-memory version", async () => {
    // The extension indexes the *buffer* on a debounce and the *disk* on reindex.
    // If a disk pass runs after a buffer pass, the older text wins and Today shows
    // work the user has already ticked.
    const dir = vaultWith({ "A.md": "* [ ] from disk\n" });
    const store = new Store(":memory:");
    await indexVault(dir, store);

    const { extractObjects, pageMetaFor } = await import("@lifeloop/semantic-core");
    const newer = "* [x] edited in the buffer\n";
    const objects = await extractObjects(newer, pageMetaFor("A", new Date().toISOString()));
    store.replacePage(
      { path: "A.md", name: "A", hash: "live", lastModified: new Date().toISOString(), size: newer.length },
      objects, newer,
    );
    expect(store.objects("task")[0].name).toBe("edited in the buffer");

    // A reindex now, told that this page is held newer elsewhere.
    await indexVault(dir, store, { skip: (path) => path === "A.md" });
    expect(
      store.objects("task")[0].name,
      "a disk pass overwrote a newer buffer version",
    ).toBe("edited in the buffer");

    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("apple bridge persistence", () => {
  test("after a restart, an unknown mirror is preserved and paused for resolution", async () => {
    const { planImport, applyImport } = await import("@lifeloop/apple-bridge");
    const note = {
      id: "N1", name: "idea", body: "<div>an idea</div>",
      modified: "2026-09-08T10:00:00Z", rich: false,
    };
    const vault = MemoryVault.of({ "Inbox.md": "" });

    const before = { lastImported: new Map() };
    await applyImport(vault, "Inbox", planImport([note], "", before), before);

    // Fresh process: the in-memory map is gone, the Inbox line remains.
    const after = { lastImported: new Map() };
    const edited = { ...note, body: "<div>an idea, refined</div>", modified: "2026-09-09T10:00:00Z" };
    const plan = planImport([edited], vault.read("Inbox.md"), after);
    const result = await applyImport(vault, "Inbox", plan, after);

    expect(
      vault.read("Inbox.md"),
      "an unknown local mirror was overwritten after restart",
    ).not.toContain("refined");
    expect(vault.read("Inbox.md")).toContain('source-id: "N1"');
    expect(result.conflicts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Third round: failure scenarios rather than components — what may change,
// what must not, and what evidence settles the outcome.
// ---------------------------------------------------------------------------

describe("time behaves unexpectedly", () => {
  test("a task completed in the evening is stamped with the local date, not UTC's", async () => {
    // 2026-09-08 20:00 in UTC-5 is 2026-09-09 01:00 UTC. Stamping the UTC date
    // records a completion on a day the user had not reached yet — and it is
    // wrong for everyone west of Greenwich every evening.
    const evening = new Date("2026-09-09T01:00:00Z");
    const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(evening);
    expect(localDate).toBe("2026-09-08");

    const vault = MemoryVault.of({ "W.md": "* [ ] a task\n" });
    await setTaskState(vault, { ref: "W@0" }, true, evening);
    const stamped = /\[completed: "([\d-]+)"\]/.exec(vault.read("W.md"))?.[1];

    // The stamp must agree with the calendar the person is looking at.
    expect(stamped, "the completion was stamped with a UTC date").toBe(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        year: "numeric", month: "2-digit", day: "2-digit",
      }).format(evening),
    );
  });

  test("day() agrees with the local calendar", async () => {
    const now = new Date();
    const local = new Intl.DateTimeFormat("en-CA", {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now);
    expect(day(now), "day() used UTC rather than the local calendar").toBe(local);
  });

  test("weeks still run Monday to Sunday across a month boundary", async () => {
    expect(week("2026-10-01")).toEqual({ start: "2026-09-28", end: "2026-10-04" });
  });
});

describe("inputs are valid but unusual", () => {
  test("a CRLF file is edited without corrupting its line endings", async () => {
    const vault = MemoryVault.of({ "W.md": "* [ ] a task\r\n* [ ] another\r\n" });
    const text = vault.read("W.md");
    const line = text.slice(0, text.indexOf("\r\n"));

    const result = await setTaskState(
      vault, { ref: "W@0", expectedText: line, expectedState: " " }, true,
    );
    expect(result.ok, `refused a CRLF file: ${JSON.stringify(result)}`).toBe(true);

    const after = vault.read("W.md");
    expect(after, "a stray carriage return ended up inside the line").not.toMatch(/\r[^\n]/);
    expect(after).toContain("* [x] a task");
    expect(after.split("\r\n")).toHaveLength(3);
  });

  test("a CRLF Inbox still separates pending from processed", async () => {
    const vault = MemoryVault.of({
      "Inbox.md": "* one\r\n\r\n## Processed\r\n\r\n* old\r\n",
    });
    expect(pending(vault.read("Inbox.md")).map((i) => i.text.trim())).toEqual(["* one"]);
    const result = await capture(vault, "two");
    expect(result.ok).toBe(true);
    const text = vault.read("Inbox.md");
    expect(text.indexOf("two"), "capture landed after Processed in a CRLF file")
      .toBeLessThan(text.indexOf("## Processed"));
  });

  test("unicode in a task name does not shift the line the write lands on", async () => {
    const vault = MemoryVault.of({ "W.md": "* [ ] 爸妈来美国 🎉\n* [ ] second\n" });
    const text = vault.read("W.md");
    const secondAt = text.indexOf("* [ ] second");
    const result = await setTaskState(
      vault, { ref: `W@${secondAt}`, expectedText: "* [ ] second", expectedState: " " }, true,
    );
    expect(result.ok).toBe(true);
    expect(vault.read("W.md")).toContain("* [ ] 爸妈来美国 🎉");
    expect(vault.read("W.md")).toContain("* [x] second");
  });
});

describe("the implementation contradicts its claims", () => {
  test("a composite change set that fails on its second file leaves neither written", async () => {
    // mutation.ts says a change set is "applied all at once or not at all".
    // apply() writes files in sequence, so a failure on the second leaves the
    // first written — the claim and the code disagree.
    const { changeSet, apply } = await import("@lifeloop/semantic-core");
    class HalfFailing extends MemoryVault {
      override async write(path: string, content: string): Promise<void> {
        if (path === "B.md") throw new Error("disk full");
        return super.write(path, content);
      }
    }
    const vault = new HalfFailing(new Map([["A.md", "before\n"]]));
    const cs = changeSet("two files");
    cs.expected.set("A.md", "before\n");
    cs.writes.set("A.md", "after\n");
    cs.writes.set("B.md", "new\n");

    await apply(vault, cs).catch(() => {});
    expect(vault.read("A.md"), "the first file was written even though the set failed")
      .toBe("before\n");
  });

  test("rollback preserves a concurrent edit instead of overwriting it", async () => {
    const { changeSet, apply } = await import("@lifeloop/semantic-core");
    class ConcurrentFailure extends MemoryVault {
      override async write(path: string, content: string): Promise<void> {
        if (path === "B.md") {
          await super.write("A.md", "user edit\n");
          throw new Error("disk full");
        }
        return super.write(path, content);
      }
    }
    const vault = new ConcurrentFailure(new Map([["A.md", "before\n"]]));
    const cs = changeSet("two files");
    cs.expected.set("A.md", "before\n");
    cs.writes.set("A.md", "after\n");
    cs.writes.set("B.md", "new\n");

    await expect(apply(vault, cs)).rejects.toThrow("Could not undo A.md");
    expect(vault.read("A.md")).toBe("user edit\n");
  });
});

describe("two actions overlap", () => {
  test("a second sync joins the first rather than running a duplicate pass", async () => {
    const { syncReminders, MemoryObservations, syncInProgress } =
      await import("@lifeloop/apple-bridge");
    const { Store, indexVault } = await import("@lifeloop/semantic-core");
    const { mkdtempSync: mk, writeFileSync: wf, rmSync: rm } = await import("node:fs");
    const { tmpdir: td } = await import("node:os");
    const { join: j } = await import("node:path");

    const dir = mk(j(td(), "overlap-"));
    wf(j(dir, "W.md"), '* [ ] a task [reminder: "R1"]\n');
    const store = new Store(":memory:");
    await indexVault(dir, store);
    const vault = MemoryVault.of({ "W.md": '* [ ] a task [reminder: "R1"]\n' });

    let reads = 0;
    const slow = {
      async read(ids: string[]) {
        reads++;
        await new Promise((r) => setTimeout(r, 40));
        return new Map(ids.map((id) => [id, {
          id, name: "a task", body: "", completed: false, completionDate: null,
          modificationDate: "2026-09-08T09:00:00Z", recurring: "unknown" as const,
        }]));
      },
      async create() { return "NEW"; },
      async update() { return true; },
      async remove() { return true; },
    };

    // A timer tick landing on top of a manual sync.
    const observations = new MemoryObservations();
    const both = Promise.all([
      syncReminders({ store, vault, observations, reminders: slow as any }),
      syncReminders({ store, vault, observations, reminders: slow as any }),
    ]);
    expect(syncInProgress()).toBe(true);
    await both;

    expect(reads, "two passes ran against the same stale reads").toBe(1);
    expect(syncInProgress()).toBe(false);
    store.close();
    rm(dir, { recursive: true, force: true });
  });
});
