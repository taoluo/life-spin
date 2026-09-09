import { expect, test } from "vitest";
import { apply, changeSet } from "./mutation.ts";
import type { Vault } from "./vault.ts";

class FaultVault implements Vault {
  readonly root = "/memory";
  private value = "before";
  constructor(
    private readonly mode: "before" | "after" | "third",
    private readonly confirmsDurability = true,
  ) {}
  exists(path: string): boolean { return path === "W.md"; }
  read(path: string) {
    if (!this.exists(path)) throw new Error("missing");
    return this.value;
  }
  async write(_path: string, content: string) {
    if (this.mode === "before") throw new Error("response lost before write");
    this.value = this.mode === "after" ? content : "third-party state";
    throw new Error("response lost after write");
  }
  async remove() { throw new Error("unused"); }
  list() { return ["W.md"]; }
  durableEquals(_path: string, content: string | null) {
    return this.confirmsDurability ? this.value === content : undefined;
  }
}

test.each([
  ["before", false, "before"],
  ["after", true, "after"],
  ["third", false, "third-party state"],
] as const)("reconciles a %s-state write response loss", async (mode, applied, terminal) => {
  const vault = new FaultVault(mode);
  const cs = changeSet("response-loss check");
  cs.expected.set("W.md", "before");
  cs.writes.set("W.md", "after");
  const result = await apply(vault, cs);
  expect(result.ok).toBe(applied);
  if (!applied) expect(result).toMatchObject({ reason: "unknown" });
  expect(vault.read("W.md")).toBe(terminal);
});

test("an after-state without durable confirmation stays UNKNOWN", async () => {
  const vault = new FaultVault("after", false);
  const cs = changeSet("unconfirmed response-loss check");
  cs.expected.set("W.md", "before");
  cs.writes.set("W.md", "after");
  expect(await apply(vault, cs)).toMatchObject({ ok: false, reason: "unknown" });
});

test("serial rollback rechecks ownership before each compensating write", async () => {
  class InterleavedVault extends FaultVault {
    private files = new Map([
      ["A.md", "A-before"], ["B.md", "B-before"], ["C.md", "C-before"],
    ]);
    constructor() { super("before"); }
    override exists(path: string) { return this.files.has(path); }
    override read(path: string) { return this.files.get(path)!; }
    override durableEquals(path: string, content: string | null) {
      return this.files.get(path) === content;
    }
    override async write(path: string, content: string) {
      if (path === "C.md") throw new Error("disk full");
      if (path === "B.md" && content === "B-before") this.files.set("A.md", "A-third");
      this.files.set(path, content);
    }
  }
  const vault = new InterleavedVault();
  const cs = changeSet("three files");
  for (const name of ["A", "B", "C"]) {
    cs.expected.set(`${name}.md`, `${name}-before`);
    cs.writes.set(`${name}.md`, `${name}-after`);
  }
  expect(await apply(vault, cs)).toMatchObject({ ok: false, reason: "unknown" });
  expect(vault.read("A.md")).toBe("A-third");
});
