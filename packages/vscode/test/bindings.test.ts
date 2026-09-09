import { expect, test } from "vitest";
import { bindingsIn } from "../src/bindings.ts";

test("external binding decorations only recognize exact task attributes", () => {
  const text = [
    '* [ ] call [reminder: "r-1"]',
    '* [ ] meet [event: "e-1"]',
    'prose [reminder: "not-a-task"]',
    '* [ ] malformed [event: e-2]',
  ].join("\r\n");
  expect(bindingsIn(text).map(({ kind, id, line }) => ({ kind, id, line }))).toEqual([
    { kind: "reminder", id: "r-1", line: '* [ ] call [reminder: "r-1"]' },
    { kind: "event", id: "e-1", line: '* [ ] meet [event: "e-1"]' },
  ]);
});
