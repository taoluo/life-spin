/** Explicit-policy core qualification; production policy loading is separately required. */
import assert from "node:assert/strict";
import { extractObjects, pageMetaFor, MemoryVault, setTaskState, cycleTaskState } from "../../packages/semantic-core/src/index.ts";

const text = "* [w] waiting task\n";
const vault = MemoryVault.of({ "Work.md": text });
const indexed = (await extractObjects(text, pageMetaFor("Work"))).find(o => o.tag === "task")!;
const completed = await setTaskState(vault, { ref: indexed.ref, expectedState: "w", expectedText: text.trim() }, true);
const custom = MemoryVault.of({ "Work.md": "* [ ] custom task\n" });
const states = [{ state: " " }, { state: "d", done: true }];
await cycleTaskState(custom, { ref: "Work@0" }, states);
const after = (await extractObjects(custom.read("Work.md"), pageMetaFor("Work"), undefined, states)).find(o => o.tag === "task")!;
console.log(JSON.stringify({ waitingIndexedDone: indexed.done, completingWaiting: completed, customDoneIndexed: after.done }, null, 2));
assert.equal(indexed.done, false);
assert.equal(completed.ok, true, "an indexed open waiting task must be completable");
assert.equal(after.done, true, "declared completion state must remain completed after indexing");
