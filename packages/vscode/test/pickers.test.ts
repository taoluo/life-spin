import { expect, test, describe } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LifeLoop } from "../src/workspace.ts";
import { tagCounts, taggedWith, metaPages, labelOf } from "../src/pickers.ts";
import * as vscode from "./vscode-mock.ts";

async function workspaceWith(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-pickers-"));
  for (const [path, body] of Object.entries(files)) writeFileSync(join(dir, path), body);
  (vscode.workspace as any).root = dir;
  return { lifeloop: await LifeLoop.open(dir), dir };
}

describe("tags", () => {
  test("an inherited tag counts, so the picker agrees with the queries", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "P.md": "---\ntags: project\n---\n\n* [ ] a task on a project page\n",
    });
    const counts = tagCounts(lifeloop);
    const project = counts.find((t) => t.tag === "project");
    // The page and the task inside it: nobody typed `project` on the task.
    expect(project?.count).toBe(2);
    expect(taggedWith(lifeloop, "project").some((o) => o.tag === "task")).toBe(true);
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("the most-used tag comes first", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "P.md": "#common\n#common\n#common\n\n#rare\n",
    });
    const tags = tagCounts(lifeloop).map((t) => t.tag);
    expect(tags.indexOf("common")).toBeLessThan(tags.indexOf("rare"));
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a tag nothing carries is not offered", async () => {
    const { lifeloop, dir } = await workspaceWith({ "P.md": "plain text\n" });
    expect(tagCounts(lifeloop).some((t) => t.tag === "project")).toBe(false);
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("meta pages", () => {
  test("only pages carrying a meta tag, prefix included", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "Config.md": "---\ntags: meta\n---\nsettings\n",
      "Tpl.md": "---\ntags: meta/template/slash\n---\nbody\n",
      "Notes.md": "---\ntags: metaphysics\n---\nnot a meta page\n",
      "Plain.md": "nothing\n",
    });
    expect(metaPages(lifeloop)).toEqual(["Config", "Tpl"]);
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("labels", () => {
  test("whatever the object turned out to be, it gets one line", () => {
    expect(labelOf({ tag: "task", name: "do the thing" } as any)).toBe("do the thing");
    expect(labelOf({ tag: "item", text: "first\nsecond" } as any)).toBe("first");
    expect(labelOf({ tag: "anchor", ref: "P@1" } as any)).toBe("P@1");
    expect(labelOf({ tag: "page" } as any)).toBe("page");
  });
});
