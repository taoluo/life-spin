import { describe, expect, test } from "vitest";
import { MemoryVault, type Vault } from "../vault.ts";
import { createReconnectTask, logInteraction } from "./relationships.ts";

describe("relationship mutations", () => {
  test("records a flattened interaction and creates a reconnect task before Processed", async () => {
    const vault = MemoryVault.of({
      "People/Alice.md": "---\ntags: person\n---\n",
      "Inbox.md": "## Processed\n\n* old\n",
    });
    expect(await logInteraction(vault, "People/Alice", "2026-09-09", "call", "Talked\nabout work"))
      .toMatchObject({ ok: true, value: { page: "Journal/2026-09-09" } });
    expect(vault.read("Journal/2026-09-09.md")).toContain(
      "* Talked about work [[People/Alice]] [interaction: call]\n",
    );

    expect((await createReconnectTask(vault, "People/Alice", "2026-10-01")).ok).toBe(true);
    expect(vault.read("Inbox.md")).toMatch(/^\* \[ \] Reconnect with \[\[People\/Alice\]\].*\n\n## Processed/);
  });

  test("records one interaction for multiple exact People and validates all of them before writing", async () => {
    const vault = MemoryVault.of({
      "People/Alice.md": "---\ntags: person\n---\n",
      "People/Bob.md": "---\ntags: person\n---\n",
    });
    const result = await logInteraction(
      vault, ["People/Alice", "People/Bob", "People/Alice"], "2026-09-09", "meeting", "Planning",
    );
    expect(result).toMatchObject({ ok: true, value: { people: ["People/Alice", "People/Bob"] } });
    expect(vault.read("Journal/2026-09-09.md").match(/\[interaction:/g)).toHaveLength(1);
    expect(vault.read("Journal/2026-09-09.md")).toContain(
      "* Planning [[People/Alice]] and [[People/Bob]] [interaction: meeting]",
    );

    const before = vault.snapshot();
    expect(await logInteraction(vault, ["People/Alice", "People/Missing"], "2026-09-10", "call"))
      .toMatchObject({ ok: false, reason: "missing" });
    expect(vault.snapshot()).toEqual(before);
  });

  test("refuses missing people and impossible dates without writing", async () => {
    const vault = MemoryVault.of({ "People/Alice.md": "---\ntags: person\n---\n# Alice\n" });
    expect(await logInteraction(vault, "People/Missing", "2026-09-09", "call"))
      .toMatchObject({ ok: false, reason: "missing" });
    expect(await logInteraction(vault, "People/Alice", "2026-02-31", "call"))
      .toMatchObject({ ok: false, reason: "invalid" });
    expect(await logInteraction(vault, [], "2026-09-09", "call"))
      .toMatchObject({ ok: false, reason: "invalid" });
    expect(vault.list()).toEqual(["People/Alice.md"]);
  });

  test("guards selected People and caller-supplied task source in the final change set", async () => {
    const inner = MemoryVault.of({
      "People/Alice.md": "---\ntags: person\n---\n",
      "Work.md": "* [ ] Call [[People/Alice]]\n",
    });
    let raced = false;
    const vault: Vault = {
      root: inner.root,
      list: () => inner.list(),
      read: (path) => inner.read(path),
      write: (path, content) => inner.write(path, content),
      remove: (path) => inner.remove(path),
      exists: (path) => {
        if (!raced && path === "Journal/2026-09-09.md") {
          raced = true;
          void inner.write("People/Alice.md", "---\ntags: note\n---\n");
          void inner.write("Work.md", "* [ ] Changed [[People/Alice]]\n");
        }
        return inner.exists(path);
      },
    };
    const result = await logInteraction(
      vault, "People/Alice", "2026-09-09", "call", "", "Journal",
      new Map([["Work.md", "* [ ] Call [[People/Alice]]\n"]]),
    );
    expect(result).toMatchObject({ ok: false, reason: "stale" });
    expect(inner.exists("Journal/2026-09-09.md")).toBe(false);
  });

  test("does not replace a task receipt when its source is the selected Person", async () => {
    const original = "---\ntags: person\n---\n* [ ] Call [[People/Alice]]\n";
    const changed = "---\ntags: person\n---\n* [ ] Different task\n";
    const journal = "existing\n";
    const inner = MemoryVault.of({
      "People/Alice.md": original,
      "Journal/2026-09-09.md": journal,
    });
    let raced = false;
    const vault: Vault = {
      root: inner.root, list: () => inner.list(), read: (path) => inner.read(path),
      write: (path, content) => inner.write(path, content), remove: (path) => inner.remove(path),
      exists: (path) => {
        if (!raced && path === "People/Alice.md") {
          raced = true;
          void inner.write(path, changed);
        }
        return inner.exists(path);
      },
    };
    expect(await logInteraction(
      vault, "People/Alice", "2026-09-09", "call", "", "Journal",
      new Map([["People/Alice.md", original]]),
    )).toMatchObject({ ok: false, reason: "stale" });
    expect(inner.read("People/Alice.md")).toBe(changed);
    expect(inner.read("Journal/2026-09-09.md")).toBe(journal);
  });

  test("does not replace a task receipt when its source is today's Journal", async () => {
    const original = "* [ ] Call [[People/Alice]]\n";
    const changed = "* [ ] Different task\n";
    const inner = MemoryVault.of({
      "People/Alice.md": "---\ntags: person\n---\n",
      "Journal/2026-09-09.md": original,
    });
    let raced = false;
    const vault: Vault = {
      root: inner.root, list: () => inner.list(), read: (path) => inner.read(path),
      write: (path, content) => inner.write(path, content), remove: (path) => inner.remove(path),
      exists: (path) => {
        if (!raced && path === "Journal/2026-09-09.md") {
          raced = true;
          void inner.write(path, changed);
        }
        return inner.exists(path);
      },
    };
    expect(await logInteraction(
      vault, "People/Alice", "2026-09-09", "call", "", "Journal",
      new Map([["Journal/2026-09-09.md", original]]),
    )).toMatchObject({ ok: false, reason: "stale" });
    expect(inner.read("Journal/2026-09-09.md")).toBe(changed);
  });
});
