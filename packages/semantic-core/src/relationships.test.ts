import { describe, expect, test } from "vitest";
import { MemoryVault, Store, indexVault } from "./index.ts";
import {
  birthdaySignals, directPersonLinks, interactionRows, interactions, personContext,
  personContextRows, personRows, reconnectRows, reconnectSignals,
} from "./relationships.ts";
import { runProjection } from "./contract.ts";
import { tasks } from "./query.ts";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function indexed(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "lifeloop-relationships-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const store = new Store(":memory:");
  await indexVault(root, store);
  return { store, done: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

describe("personal relationship facts", () => {
  test("derives a multi-person timeline and reconnect from explicit dated interactions", async () => {
    const x = await indexed({
      "People/Alice.md": "---\ntags: person\ncontact-every: 30d\n---\n",
      "People/Bob.md": "---\ntags: person\n---\n",
      "Journal/2026-08-01.md": "* Called [[People/Alice]] and [[People/Bob]] [interaction: call]\n",
      "Journal/undated.md": "* Mentioned [[People/Alice]] [interaction: message]\n",
      "Journal/2026-02-31.md": "* Impossible [[People/Alice]] [interaction: call]\n",
      "Journal/2026-08-02.md": "* Empty [[People/Alice]] [interaction: ]\n",
      "Meetings/2026-08-03.md": "* Dated but not a journal [[People/Alice]] [interaction: meeting]\n",
      "Work.md": "* [ ] Send notes [[People/Alice]]\n",
    });
    expect(interactions(x.store)).toMatchObject([{ date: "2026-08-01", kind: "call", people: ["People/Alice", "People/Bob"] }]);
    expect(personContext(x.store, "People/Alice")).toMatchObject({
      reconnectOn: "2026-08-31", openFollowups: [{ name: "Send notes [[People/Alice]]" }],
    });
    expect(reconnectSignals(x.store, "2026-09-09")).toMatchObject([{ person: "People/Alice", kind: "reconnect", due: "2026-08-31" }]);
    x.done();
  });

  test("does not treat mentions, comments, ambiguous dates, or an existing reconnect task as contact work", async () => {
    const x = await indexed({
      "People/Alice.md": "---\ntags: person\ncontact-every: 30d\n---\n",
      "Journal/2026-08-01.md": "<!-- * [[People/Alice]] [interaction: call] -->\n* merely mentioned [[People/Alice]]\n",
      "Work.md": "* [ ] Reconnect [[People/Alice]] [reconnect: true]\n",
    });
    expect(interactions(x.store)).toEqual([]);
    expect(reconnectSignals(x.store, "2026-09-09")).toEqual([]);
    x.done();
  });

  test("normalizes projection rows and filters explicit interactions", async () => {
    const x = await indexed({
      "People/Alice.md": "---\ntags: person\ngroups: friend\nbirthday: 05-12\ncontact-every: 30d\n---\n",
      "People/Bob.md": "---\ntags: person\ngroups: [work, school]\nbirthday: 1990-06-01\n---\n",
      "Journal/2026-08-01.md": "* Call [[People/Alice]] [interaction: call]\n",
      "Journal/2026-08-02.md": "* Meet [[People/Alice]] and [[People/Bob]] [interaction: meeting]\n",
      "Work.md": "* [ ] Follow up [[People/Alice]]\n",
    });
    expect(personRows(x.store)).toMatchObject([
      { person: "People/Alice", groups: ["friend"], birthday: "05-12", contactEveryDays: 30,
        lastInteractionDate: "2026-08-02", openFollowups: 1 },
      { person: "People/Bob", groups: ["work", "school"], birthday: "1990-06-01", openFollowups: 0 },
    ]);
    expect(interactionRows(x.store, { person: "People/Alice", from: "2026-08-02", kind: "meeting" }))
      .toMatchObject([{ date: "2026-08-02", people: ["People/Alice", "People/Bob"] }]);
    expect(reconnectRows(x.store, "2026-09-09")).toMatchObject([
      { person: "People/Alice", due: "2026-09-01", lastInteractionDate: "2026-08-02" },
    ]);
    expect(personContextRows(x.store, "People/Alice")[0]).toMatchObject({
      person: "People/Alice", openFollowups: 1, openFollowupRefs: [expect.any(String)],
    });
    expect(runProjection(x.store, "people")).toEqual(personRows(x.store));
    expect(runProjection(x.store, "interactions", { to: "2026-08-01" })).toMatchObject([{ date: "2026-08-01" }]);
    expect(() => runProjection(x.store, "person-context")).toThrow("requires person");
    x.done();
  });

  test("uses direct Person links for actions and inherited links only for context", async () => {
    const x = await indexed({
      "People/Alice.md": "---\ntags: person\n---\n",
      "People/Bob.md": "---\ntags: person\n---\n",
      "Work.md": "* Context [[People/Alice]]\n  * [ ] inherited only\n  * [ ] direct [[People/Bob]]\n",
    });
    const indexedTasks = tasks.universe(x.store);
    expect(indexedTasks[0].ilinks).toContain("People/Alice");
    expect(directPersonLinks(x.store, indexedTasks[0])).toEqual([]);
    expect(directPersonLinks(x.store, indexedTasks[1])).toEqual(["People/Bob"]);
    x.done();
  });

  test("surfaces strict birthdays without moving leap day", async () => {
    const x = await indexed({
      "People/Today.md": "---\ntags: person\nbirthday: 09-09\n---\n",
      "People/Tomorrow.md": "---\ntags: person\nbirthday: 1990-09-10\n---\n",
      "People/Leap.md": "---\ntags: person\nbirthday: 02-29\n---\n",
      "People/Bad.md": "---\ntags: person\nbirthday: 02-31\n---\n",
      "People/VeryBad.md": "---\ntags: person\nbirthday: 99-99\n---\n",
    });
    expect(birthdaySignals(x.store, "2026-09-09", 1)).toMatchObject([
      { person: "People/Today", nextBirthday: "2026-09-09", daysUntil: 0 },
      { person: "People/Tomorrow", nextBirthday: "2026-09-10", daysUntil: 1 },
    ]);
    expect(birthdaySignals(x.store, "2027-02-28", 400).find((s) => s.person === "People/Leap"))
      .toMatchObject({ nextBirthday: "2028-02-29" });
    expect(personRows(x.store).find((p) => p.person === "People/Bad")?.birthday).toBeUndefined();
    expect(personRows(x.store).find((p) => p.person === "People/VeryBad")?.birthday).toBeUndefined();
    x.done();
  });
});
