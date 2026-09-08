import { expect, test, describe } from "vitest";
import { MemoryVault } from "../vault.ts";
import {
  readTemplate, templates, createFromTemplate, substitute, cursorMarker, builtinTemplate,
} from "./templates.ts";

const AT = new Date("2026-09-08T12:00:00Z");

describe("substitutions a template can use without scripting", () => {
  test("dates and weeks resolve", async () => {
    expect(substitute("Journal/${date.today()}", AT)).toMatch(/^Journal\/\d{4}-\d{2}-\d{2}$/);
    expect(substitute("${week.start()}", AT)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("an expression we do not recognise is left alone", async () => {
    // A template written for Space Lua still reads as itself when scripting is
    // off, and the preview answers it when scripting is on.
    expect(substitute("${lifeloop.review.completed()}", AT))
      .toBe("${lifeloop.review.completed()}");
  });
});

describe("reading a template page", () => {
  test("its frontmatter configures it and never lands in the new page", async () => {
    const vault = MemoryVault.of({
      "Templates/Meeting.md":
        "---\nsuggestedName: Meetings/${date.today()}\nconfirmName: false\ncommand: New meeting\n---\n" +
        "# Meeting\n\n## Notes\n\n|^|\n",
    });
    const template = readTemplate(vault, "Templates/Meeting")!;
    expect(template).toMatchObject({
      suggestedName: "Meetings/${date.today()}",
      confirmName: false,
      command: "New meeting",
    });
    expect(template.body).not.toContain("suggestedName");
    expect(template.body).toContain("## Notes");
  });

  test("templates are found in the folder and listed in order", async () => {
    const vault = MemoryVault.of({
      "Templates/B.md": "b\n",
      "Templates/A.md": "a\n",
      "Notes.md": "not a template\n",
    });
    expect(templates(vault).map((t) => t.page)).toEqual(["Templates/A", "Templates/B"]);
  });
});

describe("creating a page from one", () => {
  const vault = () => MemoryVault.of({
    "Templates/Daily.md":
      "---\nsuggestedName: Journal/${date.today()}\n---\n# ${date.today()}\n\n## Log\n\n|^|\n",
  });

  test("the name and body are both substituted", async () => {
    const v = vault();
    const template = readTemplate(v, "Templates/Daily")!;
    const result = await createFromTemplate(v, template, template.suggestedName!, AT);
    expect(result.ok).toBe(true);

    const page = (result as any).value.page as string;
    expect(page).toMatch(/^Journal\/\d{4}-\d{2}-\d{2}$/);
    expect(v.read(`${page}.md`)).toContain("## Log");
    expect(v.read(`${page}.md`)).not.toContain("${date.today()}");
  });

  test("the cursor marker is removed and its position reported", async () => {
    const v = vault();
    const template = readTemplate(v, "Templates/Daily")!;
    const result = await createFromTemplate(v, template, "Journal/Fixed", AT);
    expect(result.ok).toBe(true);
    expect((result as any).value.cursor).toBeGreaterThan(0);
    expect(v.read("Journal/Fixed.md")).not.toContain("|^|");
  });

  test("an existing page is never overwritten", async () => {
    // The one outcome a convenience feature must not produce.
    const v = vault();
    v.write("Journal/Taken.md", "mine\n");
    const template = readTemplate(v, "Templates/Daily")!;
    const before = v.snapshot();
    expect(await createFromTemplate(v, template, "Journal/Taken", AT))
      .toMatchObject({ ok: false, reason: "collision" });
    expect(v.snapshot()).toEqual(before);
  });

  test("openIfExists reports the existing page rather than refusing", async () => {
    const v = MemoryVault.of({
      "Templates/D.md": "---\nopenIfExists: true\n---\nbody\n",
      "Journal/Taken.md": "mine\n",
    });
    const result = await createFromTemplate(v, readTemplate(v, "Templates/D")!, "Journal/Taken", AT);
    expect(result).toMatchObject({ ok: true, value: { existed: true } });
    expect(v.read("Journal/Taken.md")).toBe("mine\n");
  });

  test("a name that escapes the vault is refused", async () => {
    const v = vault();
    const template = readTemplate(v, "Templates/Daily")!;
    expect(await createFromTemplate(v, template, "../../etc/evil", AT))
      .toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("the built-in shapes", () => {
  test("a vault with no templates still gets a daily note and a review", async () => {
    // These are the strings that used to live inside the commands: moving them
    // here is what lets a vault replace one by writing a page.
    const v = MemoryVault.of({});
    const daily = builtinTemplate("daily");
    const result = await createFromTemplate(v, daily, daily.suggestedName!, AT);
    expect(result.ok).toBe(true);
    expect(v.read(`${(result as any).value.page}.md`)).toContain("## Log");

    const review = builtinTemplate("review");
    const made = await createFromTemplate(v, review, review.suggestedName!, AT);
    expect(made.ok).toBe(true);
    const text = v.read(`${(made as any).value.page}.md`);
    expect(text).toContain("week: 2026-09-07");
    // The review's live sections survive substitution untouched.
    expect(text).toContain("${lifeloop.review.completed()}");
  });

  test("a project template carries the frontmatter a project needs", async () => {
    const v = MemoryVault.of({});
    const result = await createFromTemplate(v, builtinTemplate("project"), "Projects/New", AT);
    expect(result.ok).toBe(true);
    expect(v.read("Projects/New.md")).toContain("tags: project");
    expect(v.read("Projects/New.md")).toContain("status: active");
  });
});
