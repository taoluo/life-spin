import { expect, test, describe, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, indexVault } from "./index.ts";
import { identities, mentions, authored, openMentions, byPage } from "./mentions.ts";
import { MemoryVault } from "./vault.ts";
import { signBlock, blockEnd, signedBy } from "./mutations/sign.ts";

let store: Store;
let root: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "mentions-"));
  writeFileSync(join(root, "P.md"), [
    "---", "recipients: sales", "---",
    "Hello @ada please look at this.",
    "",
    "* [ ] ping @pete.smith about the demo",
    "* [x] already asked @ada in the old thread",
    "",
    "A paragraph someone wrote. -- @zef",
    "",
  ].join("\n"));
  writeFileSync(join(root, "Q.md"), "Another note for @ada.\n");
  store = new Store(":memory:");
  await indexVault(root, store);
});

afterAll(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe("identities", () => {
  test("any name that was mentioned is an identity, no declaration needed", () => {
    const names = identities(store).map((i) => i.name);
    expect(names).toContain("ada");
    expect(names).toContain("pete.smith");
    // A dotted username carries whole rather than being cut at the dot.
    expect(names).not.toContain("pete");
  });

  test("the most-mentioned name comes first, so the daily one is not the fifth suggestion", () => {
    expect(identities(store)[0].name).toBe("ada");
  });

  test("a declared identity contributes its description and exists without being mentioned", () => {
    const found = identities(store, [{ name: "sales", description: "Sales team" }]);
    expect(found.find((i) => i.name === "sales")?.description).toBe("Sales team");
  });
});

describe("what is addressed and what is credited", () => {
  test("a mention addresses; a signature does not", () => {
    expect(mentions(store, "@zef")).toHaveLength(0);
    expect(authored(store, "@zef")).toHaveLength(1);
  });

  test("mentions carry the object they sit in, so a task mention is a task", () => {
    const pete = mentions(store, "pete.smith");
    expect(pete).toHaveLength(1);
    expect(pete[0].fromTag).toBe("task");
    expect(pete[0].snippet).toContain("the demo");
  });

  test("a mention on a finished task stops asking", () => {
    const all = mentions(store, "@ada");
    const open = openMentions(store, "@ada");
    expect(all.length).toBeGreaterThan(open.length);
    expect(open.some((m) => m.snippet.includes("old thread"))).toBe(false);
    // A mention in a paragraph has no completion state and is never guessed away.
    expect(open.some((m) => m.snippet.includes("please look at this"))).toBe(true);
  });

  test("grouping by page is stable", () => {
    expect(byPage(mentions(store, "@ada")).map((g) => g.page)).toEqual(["P", "Q"]);
  });
});

describe("signing", () => {
  const vaultWith = (text: string) => new MemoryVault(new Map([["P.md", text]]));

  test("a paragraph is signed at its end, not at the cursor", async () => {
    const vault = vaultWith("first line\nsecond line\n\nanother paragraph\n");
    const result = await signBlock(vault, "P", 0, "zef");
    expect(result).toMatchObject({ ok: true, value: { line: 1 } });
    // The marker has to terminate the block or the indexer does not read it.
    expect(vault.read("P.md")).toContain("second line -- @zef");
    expect(vault.read("P.md")).toContain("first line\n");
  });

  test("a list item is signed as a whole, children included", async () => {
    const vault = vaultWith("* [ ] parent\n  * child\n  * last child\n\nafter\n");
    await signBlock(vault, "P", 0, "ada");
    expect(vault.read("P.md")).toContain("last child -- @ada");
    expect(vault.read("P.md")).not.toContain("after -- @ada");
  });

  test("signing twice does not sign twice", async () => {
    const vault = vaultWith("text\n");
    await signBlock(vault, "P", 0, "ada");
    const before = vault.read("P.md");
    const again = await signBlock(vault, "P", 0, "@ada");
    expect(again).toMatchObject({ ok: true, changed: [] });
    expect(vault.read("P.md")).toBe(before);
  });

  test("a second name joins the signature rather than starting another", async () => {
    const vault = vaultWith("text -- @ada\n");
    await signBlock(vault, "P", 0, "zef");
    expect(vault.read("P.md").trim()).toBe("text -- @ada @zef");
    expect(signedBy("text -- @ada @zef")).toEqual(["@ada", "@zef"]);
  });

  test("an em dash signature is recognised as one", () => {
    expect(signedBy("said so — @zef")).toEqual(["@zef"]);
    // Mid-paragraph is not a signature, and neither is a bare mention.
    expect(signedBy("-- @zef said so")).toEqual([]);
    expect(signedBy("hello @zef")).toEqual([]);
  });

  test("a blank line has no block to sign", async () => {
    const vault = vaultWith("text\n\n\nmore\n");
    const result = await signBlock(vault, "P", 1, "ada");
    expect(result.ok).toBe(false);
    expect(blockEnd(["text", "", "", "more"], 1)).toBe(1);
  });

  test("a name that is not a name is refused", async () => {
    const vault = vaultWith("text\n");
    expect((await signBlock(vault, "P", 0, "not a name")).ok).toBe(false);
    expect(vault.read("P.md")).toBe("text\n");
  });
});
