import { expect, test, describe } from "vitest";
import { MemoryVault } from "@lifeloop/semantic-core";
import { planImport, applyImport, bodyToMarkdown, isRich, lineFor, type AppleNote, type ImportState } from "./notes.ts";

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

  test("editing the mirror here is an ownership claim, not an error", async () => {
    // The rule that closes the only hole in one-way sync: a local edit is never
    // overwritten, and never reported as a conflict. The item simply becomes ours.
    const vault = MemoryVault.of({ "Inbox.md": "" });
    const state = freshState();
    await applyImport(vault, "Inbox", planImport([note()], "", state), state);

    const mine = vault.read("Inbox.md").replace("eval debugging", "eval debugging — ask Jiulong");
    vault.write("Inbox.md", mine);

    const plan = planImport([note({ modified: "2026-09-09T10:00:00Z" })], mine, state);
    expect(plan[0].action).toBe("went-native");

    const before = vault.snapshot();
    await applyImport(vault, "Inbox", plan, state);
    expect(vault.snapshot()).toEqual(before);
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
});
