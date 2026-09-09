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
  async writeIfUnchanged(path: string, before: string | null, after: string | null) {
    if ((this.exists(path) ? this.read(path) : null) !== before) return false;
    if (after === null) await this.remove();
    else await this.write(path, after);
    return true;
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
    override async writeIfUnchanged(path: string, before: string | null, after: string | null) {
      if ((this.files.get(path) ?? null) !== before) return false;
      if (after === null) this.files.delete(path);
      else await this.write(path, after);
      return true;
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

test("a later forward write cannot replace state changed during an earlier effect", async () => {
  let entered!: () => void;
  let resume!: () => void;
  const suspended = new Promise<void>((resolve) => { entered = resolve; });
  const resumed = new Promise<void>((resolve) => { resume = resolve; });
  class ForwardBarrierVault implements Vault {
    readonly root = "/memory";
    readonly files = new Map([["A.md", "A-before"], ["B.md", "B-before"]]);
    exists(path: string) { return this.files.has(path); }
    read(path: string) { return this.files.get(path)!; }
    durableEquals(path: string, content: string | null) { return this.files.get(path) === content; }
    list() { return [...this.files.keys()]; }
    async remove(path: string) { this.files.delete(path); }
    async write(path: string, content: string) {
      if (path === "A.md") { entered(); await resumed; }
      this.files.set(path, content);
    }
    async writeIfUnchanged(path: string, before: string | null, after: string | null) {
      if (path === "A.md") { entered(); await resumed; }
      if ((this.files.get(path) ?? null) !== before) return false;
      if (after === null) this.files.delete(path); else this.files.set(path, after);
      return true;
    }
  }
  const vault = new ForwardBarrierVault();
  const cs = changeSet("forward barrier");
  for (const name of ["A", "B"]) {
    cs.expected.set(`${name}.md`, `${name}-before`);
    cs.writes.set(`${name}.md`, `${name}-after`);
  }
  const result = apply(vault, cs);
  await suspended;
  vault.files.set("B.md", "B-third");
  resume();
  expect(await result).toMatchObject({ ok: false, reason: "unknown" });
  expect(vault.read("B.md")).toBe("B-third");
});

test("a third-party edit survives while rollback is suspended", async () => {
  let entered!: () => void;
  let resume!: () => void;
  const suspended = new Promise<void>((resolve) => { entered = resolve; });
  const resumed = new Promise<void>((resolve) => { resume = resolve; });
  class BarrierVault implements Vault {
    readonly root = "/memory";
    readonly files = new Map([
      ["A.md", "A-before"], ["B.md", "B-before"], ["C.md", "C-before"],
    ]);
    exists(path: string) { return this.files.has(path); }
    read(path: string) { return this.files.get(path)!; }
    durableEquals(path: string, content: string | null) { return this.files.get(path) === content; }
    list() { return [...this.files.keys()]; }
    async remove(path: string) { this.files.delete(path); }
    async write(path: string, content: string) {
      if (path === "C.md") throw new Error("disk full");
      if (path === "B.md" && content === "B-before") { entered(); await resumed; }
      this.files.set(path, content);
    }
    async writeIfUnchanged(path: string, before: string | null, after: string | null) {
      if (path === "B.md" && after === "B-before") { entered(); await resumed; }
      if ((this.files.get(path) ?? null) !== before) return false;
      if (path === "C.md") throw new Error("disk full");
      if (after === null) this.files.delete(path); else this.files.set(path, after);
      return true;
    }
  }
  const vault = new BarrierVault();
  const cs = changeSet("barrier rollback");
  for (const name of ["A", "B", "C"]) {
    cs.expected.set(`${name}.md`, `${name}-before`);
    cs.writes.set(`${name}.md`, `${name}-after`);
  }
  const result = apply(vault, cs);
  await suspended;
  vault.files.set("A.md", "A-third");
  resume();
  expect(await result).toMatchObject({ ok: false, reason: "unknown" });
  expect(Object.fromEntries(vault.files)).toEqual({
    "A.md": "A-third", "B.md": "B-before", "C.md": "C-before",
  });
});

test("a same-target edit survives while its rollback is suspended", async () => {
  let entered!: () => void;
  let resume!: () => void;
  const suspended = new Promise<void>((resolve) => { entered = resolve; });
  const resumed = new Promise<void>((resolve) => { resume = resolve; });
  class SameTargetBarrierVault implements Vault {
    readonly root = "/memory";
    readonly files = new Map([
      ["A.md", "A-before"], ["B.md", "B-before"], ["C.md", "C-before"],
    ]);
    exists(path: string) { return this.files.has(path); }
    read(path: string) { return this.files.get(path)!; }
    durableEquals(path: string, content: string | null) { return this.files.get(path) === content; }
    list() { return [...this.files.keys()]; }
    async remove(path: string) { this.files.delete(path); }
    async write(path: string, content: string) {
      if (path === "C.md") throw new Error("disk full");
      if (path === "B.md" && content === "B-before") { entered(); await resumed; }
      this.files.set(path, content);
    }
    async writeIfUnchanged(path: string, before: string | null, after: string | null) {
      if (path === "B.md" && after === "B-before") { entered(); await resumed; }
      if ((this.files.get(path) ?? null) !== before) return false;
      if (path === "C.md") throw new Error("disk full");
      if (after === null) this.files.delete(path); else this.files.set(path, after);
      return true;
    }
  }
  const vault = new SameTargetBarrierVault();
  const cs = changeSet("same-target rollback barrier");
  for (const name of ["A", "B", "C"]) {
    cs.expected.set(`${name}.md`, `${name}-before`);
    cs.writes.set(`${name}.md`, `${name}-after`);
  }
  const result = apply(vault, cs);
  await suspended;
  vault.files.set("B.md", "B-third");
  resume();
  expect(await result).toMatchObject({ ok: false, reason: "unknown" });
  expect(vault.read("B.md")).toBe("B-third");
});

test("an unreadable partial state is preserved for reconciliation", async () => {
  class UnreadableVault implements Vault {
    readonly root = "/memory";
    private unreadable = false;
    private files = new Map([
      ["A.md", "A-before"], ["B.md", "B-before"], ["C.md", "C-before"],
    ]);
    exists(path: string) { return this.files.has(path); }
    read(path: string) {
      if (this.unreadable && path === "B.md") throw new Error("unreadable");
      return this.files.get(path)!;
    }
    durableEquals(path: string, content: string | null) {
      return this.unreadable && path === "B.md" ? undefined : this.files.get(path) === content;
    }
    list() { return [...this.files.keys()]; }
    async remove(path: string) { this.files.delete(path); }
    async write(path: string, content: string) {
      if (path === "C.md") { this.unreadable = true; throw new Error("disk full"); }
      this.files.set(path, content);
    }
    async writeIfUnchanged(path: string, before: string | null, after: string | null) {
      if ((this.files.get(path) ?? null) !== before) return false;
      if (after === null) this.files.delete(path); else await this.write(path, after);
      return true;
    }
    value(path: string) { return this.files.get(path); }
  }
  const vault = new UnreadableVault();
  const cs = changeSet("unreadable rollback");
  for (const name of ["A", "B", "C"]) {
    cs.expected.set(`${name}.md`, `${name}-before`);
    cs.writes.set(`${name}.md`, `${name}-after`);
  }
  expect(await apply(vault, cs)).toMatchObject({ ok: false, reason: "unknown" });
  expect([vault.value("A.md"), vault.value("B.md"), vault.value("C.md")])
    .toEqual(["A-after", "B-after", "C-before"]);
});

test.each(["before", "after"] as const)("reconciles rollback response loss %s its effect", async (when) => {
  class RollbackVault implements Vault {
    readonly root = "/memory";
    private files = new Map([
      ["A.md", "A-before"], ["B.md", "B-before"], ["C.md", "C-before"],
    ]);
    exists(path: string) { return this.files.has(path); }
    read(path: string) { return this.files.get(path)!; }
    durableEquals(path: string, content: string | null) { return this.files.get(path) === content; }
    list() { return [...this.files.keys()]; }
    async remove(path: string) { this.files.delete(path); }
    async write(path: string, content: string) {
      if (path === "C.md") throw new Error("disk full");
      if (path === "B.md" && content === "B-before") {
        if (when === "after") this.files.set(path, content);
        throw new Error("rollback response lost");
      }
      this.files.set(path, content);
    }
    async writeIfUnchanged(path: string, before: string | null, after: string | null) {
      if ((this.files.get(path) ?? null) !== before) return false;
      if (after === null) this.files.delete(path); else await this.write(path, after);
      return true;
    }
    value(path: string) { return this.files.get(path); }
  }
  const vault = new RollbackVault();
  const cs = changeSet("rollback response loss");
  for (const name of ["A", "B", "C"]) {
    cs.expected.set(`${name}.md`, `${name}-before`);
    cs.writes.set(`${name}.md`, `${name}-after`);
  }
  expect(await apply(vault, cs)).toMatchObject({ ok: false, reason: "unknown" });
  expect(vault.value("A.md")).toBe("A-before");
  expect(vault.value("B.md")).toBe(when === "after" ? "B-before" : "B-after");
});

test("safe rollback removes a file created before a later failure", async () => {
  class CreateVault implements Vault {
    readonly root = "/memory";
    private files = new Map([["C.md", "C-before"]]);
    exists(path: string) { return this.files.has(path); }
    read(path: string) { return this.files.get(path)!; }
    durableEquals(path: string, content: string | null) {
      return content === null ? !this.files.has(path) : this.files.get(path) === content;
    }
    list() { return [...this.files.keys()]; }
    async remove(path: string) { this.files.delete(path); }
    async write(path: string, content: string) {
      if (path === "C.md") throw new Error("disk full");
      this.files.set(path, content);
    }
    async writeIfUnchanged(path: string, before: string | null, after: string | null) {
      if ((this.files.get(path) ?? null) !== before) return false;
      if (after === null) this.files.delete(path); else await this.write(path, after);
      return true;
    }
  }
  const vault = new CreateVault();
  const cs = changeSet("create then fail");
  cs.expected.set("New.md", null);
  cs.expected.set("C.md", "C-before");
  cs.writes.set("New.md", "new");
  cs.writes.set("C.md", "C-after");
  expect(await apply(vault, cs)).toMatchObject({ ok: false, reason: "unknown" });
  expect(vault.exists("New.md")).toBe(false);
  expect(vault.read("C.md")).toBe("C-before");
});
