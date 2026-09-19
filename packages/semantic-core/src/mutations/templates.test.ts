import { expect, test, describe } from "vitest";
import { MemoryVault } from "../vault.ts";
import {
  readTemplate, createFromTemplate, substitute, builtinReviewTemplate, builtinWeeklyFocusTemplate,
} from "./templates.ts";

const AT = new Date("2026-09-08T12:00:00Z");

describe("substitutions a template can use without scripting", () => {
  test("dates and weeks resolve", async () => {
    expect(substitute("Reviews/${date.today()}", AT)).toMatch(/^Reviews\/\d{4}-\d{2}-\d{2}$/);
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
      "Templates/Review.md":
        "---\nopenIfExists: true\n---\n" +
        "# Meeting\n\n## Notes\n\n|^|\n",
    });
    const template = readTemplate(vault, "Templates/Review")!;
    expect(template.openIfExists).toBe(true);
    expect(template.body).not.toContain("openIfExists");
    expect(template.body).toContain("## Notes");
  });
});

describe("creating a page from one", () => {
  const vault = () => MemoryVault.of({
    "Templates/Review.md":
      "---\n---\n# ${date.today()}\n\n## Log\n\n|^|\n",
  });

  test("the name and body are both substituted", async () => {
    const v = vault();
    const template = readTemplate(v, "Templates/Review")!;
    const result = await createFromTemplate(v, template, "Reviews/${week.start()}", AT);
    expect(result.ok).toBe(true);

    const page = (result as any).value.page as string;
    expect(page).toMatch(/^Reviews\/\d{4}-\d{2}-\d{2}$/);
    expect(v.read(`${page}.md`)).toContain("## Log");
    expect(v.read(`${page}.md`)).not.toContain("${date.today()}");
  });

  test("the cursor marker is removed and its position reported", async () => {
    const v = vault();
    const template = readTemplate(v, "Templates/Review")!;
    const result = await createFromTemplate(v, template, "Reviews/Fixed", AT);
    expect(result.ok).toBe(true);
    expect((result as any).value.cursor).toBeGreaterThan(0);
    expect(v.read("Reviews/Fixed.md")).not.toContain("|^|");
  });

  test("an existing page is never overwritten", async () => {
    // The one outcome a convenience feature must not produce.
    const v = vault();
    v.write("Reviews/Taken.md", "mine\n");
    const template = readTemplate(v, "Templates/Review")!;
    const before = v.snapshot();
    expect(await createFromTemplate(v, template, "Reviews/Taken", AT))
      .toMatchObject({ ok: false, reason: "collision" });
    expect(v.snapshot()).toEqual(before);
  });

  test("openIfExists reports the existing page rather than refusing", async () => {
    const v = MemoryVault.of({
      "Templates/D.md": "---\nopenIfExists: true\n---\nbody\n",
      "Reviews/Taken.md": "mine\n",
    });
    const result = await createFromTemplate(v, readTemplate(v, "Templates/D")!, "Reviews/Taken", AT);
    expect(result).toMatchObject({ ok: true, value: { existed: true } });
    expect(v.read("Reviews/Taken.md")).toBe("mine\n");
  });

  test("a name that escapes the vault is refused", async () => {
    const v = vault();
    const template = readTemplate(v, "Templates/Review")!;
    expect(await createFromTemplate(v, template, "../../etc/evil", AT))
      .toMatchObject({ ok: false, reason: "invalid" });
  });
});

test("a vault with no template still gets the Review live sections", async () => {
  const v = MemoryVault.of({});
  const made = await createFromTemplate(v, builtinReviewTemplate(), "Reviews/${week.start()}", AT);
  expect(made.ok).toBe(true);
  const text = v.read(`${(made as any).value.page}.md`);
  expect(text).toContain("week: 2026-09-07");
  expect(text).toContain("${lifeloop.review.completed()}");
  expect(text).toContain("${lifeloop.review.someday()}");
});

test("the weekly focus fallback stores intent without duplicating task checkboxes", async () => {
  const v = MemoryVault.of({});
  const made = await createFromTemplate(
    v, builtinWeeklyFocusTemplate(), "Weekly/${week.start()}", AT,
  );
  expect(made.ok).toBe(true);
  const text = v.read(`${(made as any).value.page}.md`);
  expect(text).toContain("## Focus");
  expect(text).toContain("## Related Projects / Pages");
  expect(text).not.toMatch(/^\s*[-*]\s+\[[ x]\]/m);
});
