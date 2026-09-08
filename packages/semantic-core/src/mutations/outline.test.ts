import { expect, test, describe } from "vitest";
import { MemoryVault } from "../vault.ts";
import { moveItem, itemAt } from "./outline.ts";

const OUTLINE = [
  "* first",
  "  * first child",
  "  * second child",
  "* second",
  "* third",
  "",
].join("\n");

describe("an item owns what is nested under it", () => {
  test("its extent includes its children", async () => {
    const lines = OUTLINE.split("\n");
    expect(itemAt(lines, 0)).toMatchObject({ line: 0, end: 3, indent: 0 });
    expect(itemAt(lines, 1)).toMatchObject({ line: 1, end: 2, indent: 2 });
    expect(itemAt(lines, 3)).toMatchObject({ line: 3, end: 4 });
    expect(itemAt(lines, 5)).toBeNull();
  });
});

describe("moving an item", () => {
  test("down takes its children with it — the whole point", async () => {
    // VS Code's own Alt+Down moves one line and orphans the rest.
    const vault = MemoryVault.of({ "W.md": OUTLINE });
    expect((await moveItem(vault, "W", 0, "down")).ok).toBe(true);
    expect(vault.read("W.md")).toBe(
      ["* second", "* first", "  * first child", "  * second child", "* third", ""].join("\n"),
    );
  });

  test("up does the same in reverse", async () => {
    const vault = MemoryVault.of({ "W.md": OUTLINE });
    expect((await moveItem(vault, "W", 3, "up")).ok).toBe(true);
    expect(vault.read("W.md")).toBe(
      ["* second", "* first", "  * first child", "  * second child", "* third", ""].join("\n"),
    );
  });

  test("a child moves among its siblings, not out of its parent", async () => {
    const vault = MemoryVault.of({ "W.md": OUTLINE });
    expect((await moveItem(vault, "W", 1, "down")).ok).toBe(true);
    expect(vault.read("W.md")).toContain("  * second child\n  * first child");
  });

  test("nothing to swap with is a refusal, not an approximation", async () => {
    const vault = MemoryVault.of({ "W.md": OUTLINE });
    const before = vault.snapshot();
    expect(await moveItem(vault, "W", 0, "up")).toMatchObject({ ok: false });
    expect(await moveItem(vault, "W", 4, "down")).toMatchObject({ ok: false });
    expect(vault.snapshot()).toEqual(before);
  });
});

describe("indenting and outdenting", () => {
  test("indent nests the whole subtree under the item above", async () => {
    const vault = MemoryVault.of({ "W.md": OUTLINE });
    expect((await moveItem(vault, "W", 3, "indent")).ok).toBe(true);
    expect(vault.read("W.md")).toContain("  * second");
  });

  test("outdent lifts it back, children and all", async () => {
    const vault = MemoryVault.of({ "W.md": OUTLINE });
    expect((await moveItem(vault, "W", 1, "outdent")).ok).toBe(true);
    const lines = vault.read("W.md").split("\n");
    expect(lines[1]).toBe("* first child");
  });

  test("the outer level cannot be outdented, and the first item cannot be indented", async () => {
    const vault = MemoryVault.of({ "W.md": OUTLINE });
    const before = vault.snapshot();
    expect(await moveItem(vault, "W", 0, "outdent")).toMatchObject({ ok: false });
    // Indenting the first item would nest it under nothing.
    expect(await moveItem(vault, "W", 0, "indent")).toMatchObject({ ok: false });
    expect(vault.snapshot()).toEqual(before);
  });
});

describe("the file itself", () => {
  test("a CRLF outline keeps its line endings", async () => {
    const vault = MemoryVault.of({ "W.md": "* a\r\n* b\r\n" });
    expect((await moveItem(vault, "W", 0, "down")).ok).toBe(true);
    expect(vault.read("W.md")).toBe("* b\r\n* a\r\n");
  });

  test("a task keeps its state and stamp when it moves", async () => {
    const vault = MemoryVault.of({
      "W.md": '* [ ] one [deadline: "2026-09-08"]\n* [x] two [completed: "2026-09-01"]\n',
    });
    expect((await moveItem(vault, "W", 0, "down")).ok).toBe(true);
    expect(vault.read("W.md")).toBe(
      '* [x] two [completed: "2026-09-01"]\n* [ ] one [deadline: "2026-09-08"]\n',
    );
  });

  test("a cursor not on a list item refuses", async () => {
    const vault = MemoryVault.of({ "W.md": "# Heading\n\n* an item\n" });
    expect(await moveItem(vault, "W", 0, "down")).toMatchObject({ ok: false, reason: "invalid" });
  });
});
