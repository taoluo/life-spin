import { expect, test } from "vitest";
import { apply, changeSet } from "./mutation.ts";
import type { Vault } from "./vault.ts";

class FaultVault implements Vault {
  readonly root = "/memory";
  private value = "before";
  constructor(private readonly mode: "before" | "after" | "third") {}
  exists(path: string) { return path === "W.md"; }
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
