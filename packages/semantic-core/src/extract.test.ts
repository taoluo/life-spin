import { expect, test } from "vitest";
import { extractObjects, pageMetaFor } from "./extract.ts";

const on = (objects: any[], tag: string) => objects.filter((o) => o.tag === tag);

test("a plain checkbox is a first-class task, with no metadata at all", async () => {
  const objects = await extractObjects("* [ ] Write design\n", pageMetaFor("Notes"));
  const tasks = on(objects, "task");
  expect(tasks).toHaveLength(1);
  expect(tasks[0].name).toBe("Write design");
  expect(tasks[0].done).toBe(false);
});

test("task attributes parse the way LifeLoop writes them", async () => {
  const objects = await extractObjects(
    '* [ ] Submit paper [deadline: "2026-09-15"] [reminder: "01K"]\n',
    pageMetaFor("Paper"),
  );
  const [task] = on(objects, "task");
  expect(task.deadline).toBe("2026-09-15");
  expect(task.reminder).toBe("01K");
});

test("a commented-out task is still indexed, and marked inComment", async () => {
  // The distinction LifeLoop's whole task universe rests on: SilverBullet does not
  // skip comments, it flags them, so exclusion has to be deliberate.
  const objects = await extractObjects(
    "* [ ] real\n\n<!--\n* [ ] parked\n-->\n",
    pageMetaFor("Notes"),
  );
  const tasks = on(objects, "task");
  expect(tasks).toHaveLength(2);
  expect(tasks.find((t) => t.name === "parked")?.inComment).toBe(true);
  expect(tasks.find((t) => t.name === "real")?.inComment).toBeUndefined();
});

test("tags are inherited into itags", async () => {
  const objects = await extractObjects(
    "---\ntags: project\n---\n\n* [ ] a task\n",
    pageMetaFor("Q3 Launch"),
  );
  const [task] = on(objects, "task");
  expect(task.itags).toContain("project");
});

test("a wikilink resolves against the vault, and an unresolved one is aspiring", async () => {
  const vault = new Set(["Projects/Reed Solomon.md"]);
  const objects = await extractObjects(
    "See [[Reed Solomon]] and [[Nowhere]]\n",
    pageMetaFor("Journal/2026-09-08"),
    { has: (path) => vault.has(path), all: () => vault },
  );
  // A link is a relation with kind "mention" — links are not their own tag.
  const mentions = on(objects, "relation").filter((r) => r.kind === "mention");
  // Resolution is by basename, so [[Reed Solomon]] finds Projects/Reed Solomon.md
  // even though the link names no folder — and the relation records the *resolved*
  // page, which is what makes a backlink from a folder-less link work at all.
  expect(mentions.map((m) => m.to)).toEqual(["Projects/Reed Solomon", "Nowhere"]);

  // Only the genuinely missing one is aspiring.
  const aspiring = on(objects, "aspiring-page").map((a) => a.name ?? a.to);
  expect(aspiring).toEqual(["Nowhere"]);
});
