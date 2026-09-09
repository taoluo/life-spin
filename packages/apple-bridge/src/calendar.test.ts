import { describe, expect, test, vi } from "vitest";
import { FIELD_SEPARATOR as FS, RECORD_SEPARATOR as RS } from "./osascript.ts";
import { Calendar } from "./calendar.ts";

const record = (summary: string) =>
  ["E1", summary, "start", "end", "room"].join(FS) + RS;

describe("Calendar exact reads", () => {
  for (const [output, kind] of [
    ["", "missing"],
    [record("one"), "found"],
    [record("one") + record("duplicate"), "ambiguous"],
  ] as const) {
    test(`preserves ${kind} for one UID`, async () => {
      const run = vi.fn(async (_script: string, _args: string[]) => output);
      const result = await new Calendar(run).readExact("E1", "Personal");
      expect(result.kind).toBe(kind);
      expect(run.mock.calls[0][1]).toEqual(["Personal", "E1"]);
      if (result.kind === "found") expect(result.event.summary).toBe("one");
    });
  }
});
