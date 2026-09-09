import { expect, test, describe } from "vitest";
import { MemoryVault, type Vault } from "@lifeloop/semantic-core";
import { planImport, applyImport, bodyToMarkdown, importedText, isRich, lineFor, resolveNoteConflict, type AppleNote, type ImportState } from "./notes.ts";

const note = (over: Partial<AppleNote> = {}): AppleNote => ({
  id: "x-coredata://N1",
  name: "counterfactual replay",
  body: "<div>counterfactual replay for eval debugging</div>",
  modified: "2026-09-08T10:00:00Z",
  rich: false,
  ...over,
});

const freshState = (): ImportState => ({ lastImported: new Map() });

describe("reading a note", () => {
  test("recovers text and list structure, and nothing else", async () => {
    expect(bodyToMarkdown("<div>one</div><div>two</div>")).toBe("one\ntwo");
    expect(bodyToMarkdown("<ul><li>a</li><li>b</li></ul>")).toBe("* a\n* b");
    expect(bodyToMarkdown("<div>a &amp; b</div>")).toBe("a & b");
  });

  test("anything a round trip would destroy makes a note pull-only", async () => {
    expect(isRich({ body: "<div>plain</div>", rich: false })).toBe(false);
    expect(isRich({ body: "<div>x</div>", rich: true })).toBe(true);
    expect(isRich({ body: "<table><tr><td>x</td></tr></table>", rich: false })).toBe(true);
  });
});

test("a full plain Note body is imported and round-trips through one pending item", async () => {
  const full = note({ body: "<div>title</div><div>second line</div><div>third line</div>" });
  const item = lineFor(full);
  expect(item).toContain("\n  second line\n  third line");
  expect(importedText(item)).toBe("title\nsecond line\nthird line");
  const vault = MemoryVault.of({ "Inbox.md": "" });
  const state = freshState();
  await applyImport(vault, "Inbox", planImport([full], "", state), state);
  expect(vault.read("Inbox.md")).toContain("  third line");
});

test("the LifeLoop resolver refuses a Note changed after it was shown", async () => {
  const original = `${lineFor(note())}\n`;
  const vault = MemoryVault.of({ "Inbox.md": original });
  const result = await resolveNoteConflict(
    vault, "Inbox", note({ body: "<div>Changed again</div>" }), "markdown", freshState(),
    { update: async () => "ok" },
    { local: importedText(lineFor(note())), remote: "Shown" },
  );
  expect(result).toMatchObject({ ok: false, reason: "stale" });
});

describe("importing", () => {
  test("a new note becomes a source-backed Inbox line", async () => {
    const vault = MemoryVault.of({ "Inbox.md": "" });
    const state = freshState();
    const plan = planImport([note()], "", state);
    expect(plan[0].action).toBe("create");

    const result = await applyImport(vault, "Inbox", plan, state);
    expect(result.created).toBe(1);
    const text = vault.read("Inbox.md");
    expect(text).toContain("counterfactual replay for eval debugging");
    expect(text).toContain("[source: apple-notes]");
    expect(text).toContain('[source-id: "x-coredata://N1"]');
  });

  test("a stale create plan cannot duplicate, revive processed, or revive detached sources", async () => {
    const plan = planImport([note()], "", freshState());
    for (const existing of [
      lineFor(note()),
      `## Processed\n\n${lineFor(note())}`,
      lineFor(note()).replace('source-id: "x-coredata://N1"', 'source-id: "detached:x-coredata://N1"'),
    ]) {
      const vault = MemoryVault.of({ "Inbox.md": `${existing}\n` });
      const result = await applyImport(vault, "Inbox", plan, freshState());
      expect(result.created).toBe(0);
      expect(vault.read("Inbox.md")).toBe(`${existing}\n`);
    }
  });

  test("an unchanged note does nothing on a second pass", async () => {
    const vault = MemoryVault.of({ "Inbox.md": "" });
    const state = freshState();
    await applyImport(vault, "Inbox", planImport([note()], "", state), state);

    const plan = planImport([note()], vault.read("Inbox.md"), state);
    expect(plan[0]).toMatchObject({ action: "none", why: "unchanged" });
  });

  test("a note edited on the phone updates the mirror", async () => {
    const vault = MemoryVault.of({ "Inbox.md": "" });
    const state = freshState();
    await applyImport(vault, "Inbox", planImport([note()], "", state), state);

    const edited = note({
      body: "<div>counterfactual replay, maybe compare with trajectory branching</div>",
      modified: "2026-09-08T12:00:00Z",
    });
    const plan = planImport([edited], vault.read("Inbox.md"), state);
    expect(plan[0].action).toBe("update");

    await applyImport(vault, "Inbox", plan, state);
    expect(vault.read("Inbox.md")).toContain("trajectory branching");
  });

  test("a Markdown-only edit is compare-and-set into a plain Note", async () => {
    const vault = MemoryVault.of({ "Inbox.md": "" });
    const state = freshState();
    await applyImport(vault, "Inbox", planImport([note()], "", state), state);
    vault.write("Inbox.md", vault.read("Inbox.md").replace("eval debugging", "local edit"));
    let pushed = "";
    const result = await applyImport(
      vault, "Inbox", planImport([note()], vault.read("Inbox.md"), state), state,
      { update: async (_id, _modified, text) => { pushed = text; return "ok"; } },
    );
    expect(result.pushed).toBe(1);
    expect(pushed).toContain("local edit");
  });

  test("an update preserves a CRLF Inbox", async () => {
    const initial = `${lineFor(note())}\r\n`;
    const vault = MemoryVault.of({ "Inbox.md": initial });
    const state = freshState();
    state.lastImported.set(note().id, { text: lineFor(note()), modified: note().modified });
    const remote = note({ body: "<div>remote edit</div>", modified: "2026-09-09T10:00:00Z" });
    const result = await applyImport(vault, "Inbox", planImport([remote], initial, state), state);
    expect(result.updated).toBe(1);
    expect(vault.read("Inbox.md")).toContain("remote edit");
    expect(vault.read("Inbox.md").endsWith("\r\n")).toBe(true);
    expect(vault.read("Inbox.md").replaceAll("\r\n", "")).not.toContain("\n");
  });

  test("a CRLF conflict pauses without changing either copy", async () => {
    const initial = `${lineFor(note()).replace("eval debugging", "local edit")}\r\n`;
    const vault = MemoryVault.of({ "Inbox.md": initial });
    const result = await applyImport(
      vault, "Inbox", planImport([note({ modified: "2026-09-09T10:00:00Z" })], initial, freshState()), freshState(),
    );
    expect(result.conflicts).toHaveLength(1);
    expect(vault.read("Inbox.md")).toContain('source-id: "x-coredata://N1"');
    expect(vault.read("Inbox.md").endsWith("\r\n")).toBe(true);
    expect(vault.read("Inbox.md").replaceAll("\r\n", "")).not.toContain("\n");
  });

  test("an update refuses a concurrent Inbox edit instead of overwriting it", async () => {
    const initial = `${lineFor(note())}\n`;
    let text = initial;
    let reads = 0;
    const vault: Vault = {
      root: "/race",
      exists: () => true,
      read: () => {
        reads++;
        if (reads === 2) text = `* concurrent capture\n${text}`;
        return text;
      },
      write: async (_path, content) => { text = content; },
      remove: async () => {},
      list: () => ["Inbox.md"],
    };
    const state = freshState();
    state.lastImported.set(note().id, { text: lineFor(note()), modified: note().modified });
    const remote = note({ body: "<div>remote edit</div>", modified: "2026-09-09T10:00:00Z" });
    const result = await applyImport(vault, "Inbox", planImport([remote], initial, state), state);
    expect(result.refused).toMatchObject([{ reason: "stale", action: "update" }]);
    expect(text).toBe(`* concurrent capture\n${initial}`);
  });

  test("editing the mirror here is an ownership claim, not an error", async () => {
    // The rule that closes the only hole in one-way sync: a local edit is never
    // overwritten, and never reported as a conflict. The item simply becomes ours.
    const vault = MemoryVault.of({ "Inbox.md": "" });
    const state = freshState();
    await applyImport(vault, "Inbox", planImport([note()], "", state), state);

    const mine = vault.read("Inbox.md").replace("eval debugging", "eval debugging — ask Jiulong");
    vault.write("Inbox.md", mine);

    const plan = planImport([note({ modified: "2026-09-09T10:00:00Z" })], mine, state);
    expect(plan[0].action).toBe("conflict");

    await applyImport(vault, "Inbox", plan, state);
    expect(vault.read("Inbox.md")).toContain("ask Jiulong");
    expect(vault.read("Inbox.md")).toContain('source-id: "x-coredata://N1"');

    const again = planImport([note({ modified: "2026-09-10T10:00:00Z" })], vault.read("Inbox.md"), state);
    expect(again[0].action).toBe("conflict");
    expect(vault.read("Inbox.md")).toContain("ask Jiulong");
  });

  test("a processed item stops syncing for good", async () => {
    const state = freshState();
    const line = lineFor(note());
    const inbox = `## Processed\n\n${line}\n`;
    const plan = planImport([note({ modified: "2030-01-01T00:00:00Z" })], inbox, state);
    expect(plan[0]).toMatchObject({ action: "none" });
    expect((plan[0] as any).why).toContain("Markdown owns it");
  });

  test("imported lines land above Processed, never in the pile already dealt with", async () => {
    const vault = MemoryVault.of({
      "Inbox.md": "* pending\n\n## Processed\n\n* done earlier\n",
    });
    const state = freshState();
    await applyImport(vault, "Inbox", planImport([note()], vault.read("Inbox.md"), state), state);
    const text = vault.read("Inbox.md");
    expect(text.indexOf("counterfactual")).toBeLessThan(text.indexOf("## Processed"));
  });

  test("a restart preserves an existing Markdown line and pauses without a baseline", async () => {
    const original = `${lineFor(note()).replace("eval debugging", "local edit")}\n`;
    const vault = MemoryVault.of({ "Inbox.md": original });
    const state = freshState();
    const plan = planImport([note({ modified: "2026-09-09T10:00:00Z" })], original, state);
    expect(plan[0].action).toBe("conflict");
    await applyImport(vault, "Inbox", plan, state);
    expect(vault.read("Inbox.md")).toContain("local edit");
    expect(vault.read("Inbox.md")).toContain('source-id: "x-coredata://N1"');
  });

  test("an update planned before processing cannot rewrite the processed item", async () => {
    const vault = MemoryVault.of({ "Inbox.md": "" });
    const state = freshState();
    await applyImport(vault, "Inbox", planImport([note()], "", state), state);
    const remote = note({ body: "<div>remote edit</div>", modified: "2026-09-09T10:00:00Z" });
    const plan = planImport([remote], vault.read("Inbox.md"), state);
    vault.write("Inbox.md", `## Processed\n\n${vault.read("Inbox.md")}`);
    await applyImport(vault, "Inbox", plan, state);
    expect(vault.read("Inbox.md")).not.toContain("remote edit");
  });

  test("local indentation detaches an imported item instead of lifting it to the top level", async () => {
    const vault = MemoryVault.of({ "Inbox.md": "" });
    const state = freshState();
    await applyImport(vault, "Inbox", planImport([note()], "", state), state);
    vault.write("Inbox.md", `* parent\n  ${vault.read("Inbox.md")}`);
    const remote = note({ body: "<div>remote edit</div>", modified: "2026-09-09T10:00:00Z" });
    await applyImport(vault, "Inbox", planImport([remote], vault.read("Inbox.md"), state), state);
    expect(vault.read("Inbox.md")).toContain("  * counterfactual replay");
    expect(vault.read("Inbox.md")).not.toContain("remote edit");
  });
});
