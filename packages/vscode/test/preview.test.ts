import { createRequire } from "node:module";
import { expect, test, describe } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LifeLoop } from "../src/workspace.ts";
import { renderQuery, parseQueryBlock, extendMarkdownIt } from "../src/preview.ts";
import { findLocatedQueryFences, parseLocatedQuery } from "../src/query-language.ts";
import * as vscode from "./vscode-mock.ts";

async function workspaceWith(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-preview-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  (vscode.workspace as any).root = dir;
  return { lifeloop: await LifeLoop.open(dir), dir };
}

describe("query blocks in the preview", () => {
  test("a projection renders as a table of real rows", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "W.md": [
        '* [ ] overdue thing [deadline: "2020-01-01"]',
        "* [ ] blocked #waiting",
        "",
      ].join("\n"),
    });
    const html = renderQuery(lifeloop, "today\ndate: 2026-09-08");
    expect(html).toContain("<table");
    expect(html).toContain("overdue thing");
    expect(html).toContain("blocked");
    expect(html).toContain("<th>section</th>");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("fields and limit narrow what is shown", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "W.md": "* [ ] one\n* [ ] two\n* [ ] three\n",
    });
    const html = renderQuery(lifeloop, "actionable\nfields: name\nlimit: 2");
    expect(html).toContain("<th>name</th>");
    expect(html).not.toContain("<th>page</th>");
    expect((html.match(/<tr/g) ?? []).length).toBe(3); // header + two rows
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("relationship projections accept their named filters", async () => {
    const { lifeloop, dir } = await workspaceWith({
      "People/Alice.md": "---\ntags: person\n---\n",
      "Journal/2026-09-08.md": "* Called [[People/Alice]] [interaction: call]\n",
      "Journal/2026-09-09.md": "* Met [[People/Alice]] [interaction: meeting]\n",
    });
    const html = renderQuery(lifeloop,
      "interactions\nperson: People/Alice\nfrom: 2026-09-09\nkind: meeting\nfields: date, kind, text");
    expect(html).toContain("2026-09-09");
    expect(html).toContain("meeting");
    expect(html).not.toContain("2026-09-08");
    expect(parseQueryBlock("person-context\nperson: People/Alice")).toMatchObject({
      args: { person: "People/Alice" },
    });
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("an empty result says so instead of rendering an empty table", async () => {
    const { lifeloop, dir } = await workspaceWith({ "W.md": "* [x] all done\n" });
    expect(renderQuery(lifeloop, "actionable")).toContain("Nothing to show");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a broken query explains itself and never throws", async () => {
    const { lifeloop, dir } = await workspaceWith({ "W.md": "* [ ] a\n" });
    expect(renderQuery(lifeloop, "nonsense")).toContain("unknown projection");
    expect(renderQuery(lifeloop, "today\nnot a key value")).toContain("expected key: value");
    expect(renderQuery(lifeloop, "")).toContain("empty query");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("content in a note cannot inject markup into the preview", async () => {
    // A query renders whatever the vault contains, and the vault is user text.
    const { lifeloop, dir } = await workspaceWith({
      "W.md": '* [ ] <img src=x onerror=alert(1)> [deadline: "2020-01-01"]\n',
    });
    const html = renderQuery(lifeloop, "actionable");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("only lifeloop and query fences are taken over", async () => {
    const { lifeloop, dir } = await workspaceWith({ "W.md": "* [ ] a\n" });
    let fellThrough = 0;
    const md: any = {
      renderer: { rules: { fence: () => { fellThrough++; return "<pre>original</pre>"; } } },
    };
    extendMarkdownIt(() => lifeloop)(md);

    const render = (info: string, content: string) =>
      md.renderer.rules.fence([{ info, content }], 0, {}, {}, {});

    expect(render("js", "console.log(1)")).toBe("<pre>original</pre>");
    expect(fellThrough).toBe(1);
    expect(render("lifeloop", "actionable")).toContain("<table");
    expect(render("query", "actionable")).toContain("<table");
    expect(fellThrough).toBe(1);
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("parsing accepts the documented options and rejects the rest", async () => {
    expect(parseQueryBlock("upcoming\ndays: 7")).toMatchObject({
      projection: "upcoming", args: { days: 7 },
    });
    expect(parseQueryBlock("signals\nproject: Projects/P")).toMatchObject({
      args: { project: "Projects/P" },
    });
    expect(parseQueryBlock("today\ncolour: red")).toMatchObject({ error: expect.any(String) });
    expect(parseQueryBlock("people\nperson: People/Alice")).toMatchObject({ error: expect.any(String) });
    expect(parseQueryBlock("interactions\nfields: date, unknown")).toMatchObject({ error: expect.any(String) });
    for (const limit of ["-1", "1.5", "many"]) {
      expect(parseQueryBlock(`interactions\nlimit: ${limit}`)).toMatchObject({ error: expect.any(String) });
    }
  });
});

describe("the same query on three surfaces", () => {
  const page = [
    '* [ ] a target [deadline: "2020-01-01"]',
    "",
    "```lifeloop",
    "actionable",
    "fields: name",
    "```",
    "",
    "```ts",
    "const notAQuery = 1;",
    "```",
    "",
  ].join("\n");

  const documentOf = (text: string) => {
    const lines = text.split("\n");
    const offsetAt = (position: { line: number; character: number }) =>
      lines.slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) + position.character;
    const positionAt = (offset: number) => {
      let line = 0;
      while (line + 1 < lines.length && offset >= offsetAt({ line: line + 1, character: 0 })) line++;
      return new vscode.Position(line, offset - offsetAt({ line, character: 0 }));
    };
    return {
      lineCount: lines.length,
      lineAt: (n: number) => ({ text: lines[n], length: lines[n].length }),
      getText: () => text,
      offsetAt,
      positionAt,
      languageId: "markdown",
    } as any;
  };

  test("fences are found by language, and other languages are left alone", async () => {
    const { findQueryFences } = await import("../src/query-lens.ts");
    const fences = findQueryFences(documentOf(page));
    expect(fences).toHaveLength(1);
    expect(fences[0].source).toBe("actionable\nfields: name");
  });

  test("fences close only with the matching marker and sufficient run length", () => {
    const text = [
      "~~~query",
      "people",
      "```",
      "~~~   ",
      "````lifeloop",
      "interactions",
      "```",
      "`````",
    ].join("\r\n");
    const fences = findLocatedQueryFences(text);
    expect(fences.map((fence) => [fence.language, fence.markerLength])).toEqual([
      ["query", 3], ["lifeloop", 4],
    ]);
    expect(fences[0].source).toContain("```");
    expect(fences[1].source).toContain("```");
  });

  test("query fences exclude nested examples and indented code", () => {
    const text = [
      "~~~~markdown",
      "```query",
      "people",
      "```",
      "~~~~",
      "",
      "    ~~~lifeloop",
      "    interactions",
      "    ~~~",
      "",
      "~~~query",
      "reconnect",
    ].join("\n");
    const fences = findLocatedQueryFences(text);
    expect(fences).toHaveLength(1);
    expect(fences[0].source).toBe("reconnect");
  });

  test("located tokens retain live UTF-16 offsets across CRLF", () => {
    const text = "😀 heading\r\n```query\r\ninteractions\r\nlimit: -1\r\n```\r\n";
    const fence = findLocatedQueryFences(text)[0];
    const query = parseLocatedQuery(fence.source, fence.bodyFrom);
    expect(query.projection?.from).toBe(text.indexOf("interactions"));
    expect(query.options[0].value).toEqual({
      text: "-1", from: text.indexOf("-1"), to: text.indexOf("-1") + 2,
    });
  });

  test("completion stays inside query bodies and legal value positions", async () => {
    const { queryCompletions } = await import("../src/query-lens.ts");
    const { lifeloop, dir } = await workspaceWith({
      "People/Alice.md": "---\ntags: person\n---\n",
      "W.md": "* [ ] task\n",
    });
    const labels = (text: string, line: number, character: number) =>
      (queryCompletions(() => lifeloop) as any)
        .provideCompletionItems(documentOf(text), { line, character })
        .map((item: any) => item.label);
    try {
      expect(labels("outside", 0, 3)).toEqual([]);
      expect(labels("```query\n\n", 1, 0)).toEqual(expect.arrayContaining(["people", "interactions"]));

      const keys = labels("~~~lifeloop\ninteractions\n\n~~~", 2, 0);
      expect(new Set(keys)).toEqual(new Set(["person", "from", "to", "kind", "fields", "limit"]));
      expect(labels("```query\ninteractions\nperson: \n```", 2, 8)).toEqual(["People/Alice"]);
      expect(labels("```query\ninteractions\nkind: \n```", 2, 6)).toEqual(
        expect.arrayContaining(["call", "meeting"]),
      );
      expect(labels("```query\ninteractions\nfields: \n```", 2, 8)).toEqual(
        expect.arrayContaining(["ref", "date", "people"]),
      );
      expect(labels("```query\ninteractions\nfrom: \n```", 2, 6)).toEqual([]);
      expect(labels("```query\npeople\nkind: \n```", 2, 6)).toEqual([]);
      expect(labels("```query\nreconnect\nperson: \n```", 2, 8)).toEqual([]);

      lifeloop.noteSourceChange();
      expect(labels("```query\ninteractions\nperson: \n```", 2, 8)).toEqual([]);
      expect(labels("```query\ninteractions\nkind: \n```", 2, 6)).toEqual(
        expect.arrayContaining(["call", "meeting"]),
      );
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("Person completion replaces the whole current value", async () => {
    const { queryCompletions } = await import("../src/query-lens.ts");
    const { lifeloop, dir } = await workspaceWith({
      "People/Alice Smith.md": "---\ntags: person\n---\n",
    });
    const text = "```query\ninteractions\nperson: People/A suffix\n```";
    const document = documentOf(text);
    try {
      const item = (queryCompletions(() => lifeloop) as any)
        .provideCompletionItems(document, { line: 2, character: "person: People/A".length })
        .find((candidate: any) => candidate.label === "People/Alice Smith");
      const from = document.offsetAt(item.range.start);
      const to = document.offsetAt(item.range.end);
      expect(text.slice(0, from) + item.insertText + text.slice(to))
        .toContain("person: People/Alice Smith\n```");
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("CodeLens shows a count — plain text, because a title cannot be a table", async () => {
    const { codeLenses } = await import("../src/query-lens.ts");
    const { lifeloop, dir } = await workspaceWith({ "W.md": page });
    const lenses = (codeLenses(() => lifeloop) as any).provideCodeLenses(documentOf(page));

    expect(lenses).toHaveLength(2);
    expect(lenses[0].command.title).toBe("$(list-flat) actionable: 1 result");
    expect(lenses[0].command.title).not.toContain("\n");
    expect(lenses[1].command.title).toContain("Open");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("hover shows the table, and cannot inject markup or commands", async () => {
    const { hovers } = await import("../src/query-lens.ts");
    const { lifeloop, dir } = await workspaceWith({
      "W.md": page.replace("a target", "<img src=x> | piped"),
    });
    const hover: any = (hovers(() => lifeloop) as any)
      .provideHover(documentOf(page), { line: 3 });

    const value = hover.contents.value;
    expect(value).toContain("| name |");
    expect(value).toContain("| --- |");
    // A pipe in the data must not break out into a new column.
    expect(value).toContain("\\|");
    expect(hover.contents.isTrusted).toBe(false);
    expect(hover.contents.supportHtml).toBe(false);
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("all three surfaces answer with the same rows", async () => {
    const { runQueryBlock, toMarkdown, renderQuery } = await import("../src/preview.ts");
    const { lifeloop, dir } = await workspaceWith({ "W.md": page });
    const source = "actionable\nfields: name";

    const outcome = runQueryBlock(lifeloop, source);
    expect(outcome.ok && outcome.rows).toHaveLength(1);
    expect(renderQuery(lifeloop, source)).toContain("a target");
    expect(toMarkdown(outcome)).toContain("a target");
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("adds Person, CRLF, and anchored source links only to full results", async () => {
    const { runQueryBlock, toMarkdown, toNavigableMarkdown } = await import("../src/preview.ts");
    const sourceText = "intro\r\n* Coffee [[People/Alice]] [interaction: coffee]\r\n" +
      "* Met [[People/Alice]] [interaction: meeting] $met\r\n";
    const { lifeloop, dir } = await workspaceWith({
      "People/Alice.md": "---\ntags: person\n---\n",
      "Journal/2026-09-09.md": sourceText,
      "Work.md": "* [ ] Follow up [[People/Alice]] $followup\n",
    });
    try {
      const outcome = runQueryBlock(lifeloop, "interactions\nfields: ref, page, people");
      const raw = toMarkdown(outcome);
      const full = toNavigableMarkdown(lifeloop, outcome, "interactions");
      expect(raw).not.toContain("file://");
      expect(raw).not.toContain("[[Journal/");
      expect(full).toContain(`file://${join(dir, "People/Alice.md")}`);
      expect(full).toContain(`[[Journal/2026-09-09@${sourceText.indexOf("* Coffee")}]]`);
      expect(full).toContain("[[Journal/2026-09-09@met]]");

      const context = runQueryBlock(lifeloop, "person-context\nperson: People/Alice\nfields: openFollowupRefs");
      expect(toMarkdown(context)).toContain("followup");
      expect(toMarkdown(context)).not.toContain("[[Work@followup]]");
      expect(toNavigableMarkdown(lifeloop, context, "person-context")).toContain("[[Work@followup]]");
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("leaves missing, duplicate, and ambiguous anchored sources as text", async () => {
    const { runQueryBlock, toMarkdown, toNavigableMarkdown } = await import("../src/preview.ts");
    const anchored = "* Met [[People/Alice]] [interaction: meeting] $met\r\n";
    const { lifeloop, dir } = await workspaceWith({
      "People/Alice.md": "---\ntags: person\n---\n",
      "Journal/2026-09-08.md": anchored,
      "Journal/2026-09-09.md": anchored,
      "Work/A.md": "* [ ] One [[People/Alice]] $same\n",
      "Work/B.md": "* [ ] Two [[People/Alice]] $same\n",
      "me.md": "unrelated page\n",
      "sam.md": "unrelated page\n",
    });
    try {
      const interaction = runQueryBlock(lifeloop, "interactions\nfields: ref");
      const initial = toNavigableMarkdown(lifeloop, interaction, "interactions");
      expect(initial).toContain("[[Journal/2026-09-09@met]]");
      expect(initial).toContain("[[Journal/2026-09-08@met]]");

      await lifeloop.vault.write("Journal/2026-09-09.md", anchored.replace(" $met", ""));
      expect(toNavigableMarkdown(lifeloop, interaction, "interactions")).not.toContain("[[met]]");
      await lifeloop.vault.write("Journal/2026-09-09.md", `${anchored}* Duplicate $met\r\n`);
      expect(toNavigableMarkdown(lifeloop, interaction, "interactions"))
        .not.toContain("[[Journal/2026-09-09@met]]");

      const context = runQueryBlock(lifeloop, "person-context\nperson: People/Alice\nfields: openFollowupRefs");
      expect(toMarkdown(context)).toContain("same,same");
      const full = toNavigableMarkdown(lifeloop, context, "person-context");
      expect(full).not.toContain("[[same]]");
      expect(full).not.toContain("[[Work/");
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("blocks LifeLoop does not execute", () => {
  test("a Space Lua block is reported, and says which APIs it uses", async () => {
    const { publishDiagnostics } = await import("../src/retrieval.ts");
    const { lifeloop, dir } = await workspaceWith({
      "Scripts.md": [
        "```space-lua",
        'local open = index.tasks()',
        "```",
        "",
        "```space-lua",
        'editor.flashNotification("hi")',
        "```",
        "",
      ].join("\n"),
    });

    const collection = vscode.languages.createDiagnosticCollection() as any;
    publishDiagnostics(lifeloop, collection);
    const messages = collection.entries.flatMap(([, list]: [string, any[]]) =>
      list.map((d) => d.message),
    );

    // Both are reported, and the message distinguishes what could ever run here
    // from what could not.
    expect(messages.filter((m: string) => m.includes("Space Lua"))).toHaveLength(2);
    expect(messages.some((m: string) => m.includes("a VS Code host could provide"))).toBe(true);
    // `editor.flashNotification` is portable — one line of VS Code — so this block
    // must NOT be reported as blocked. Classifying by namespace once said it was.
    expect(messages.some((m: string) => m.includes("tied to SilverBullet's editor"))).toBe(false);
    // Information, not a warning: the block is not a mistake.
    const severities = collection.entries.flatMap(([, list]: [string, any[]]) =>
      list.filter((d) => d.message.includes("Space Lua")).map((d) => d.severity),
    );
    expect(new Set(severities)).toEqual(new Set([vscode.DiagnosticSeverity.Information]));

    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("calls are classified per method, not per namespace", async () => {
    const { scriptNamespaces } = await import("../src/retrieval.ts");

    // The correction that matters: two methods in the same namespace can land in
    // different buckets, and lumping them together made a vault look unportable.
    const mixed = scriptNamespaces("editor.flashNotification('hi') editor.showPanel('lhs')");
    expect(mixed.portable).toEqual(["editor.flashNotification"]);
    expect(mixed.editorBound).toEqual(["editor.showPanel"]);

    // Lua's own library is not a host API.
    const plain = scriptNamespaces("string.gsub(s, 'a', 'b') table.sort(t)");
    expect(plain.stdlib).toEqual(["string.gsub", "table.sort"]);
    expect(plain.portable).toEqual([]);
    expect(plain.editorBound).toEqual([]);

    // A widget builds content we can render, just not where SilverBullet puts it.
    expect(scriptNamespaces("widget.html('<b>x</b>')").replaced).toEqual(["widget.html"]);

    // Anything unrecognised is reported as unknown rather than silently as none.
    expect(scriptNamespaces("someLibrary.doThing()").unknown).toEqual(["someLibrary.doThing"]);
  });

  test("a vault with no such blocks reports nothing", async () => {
    const { publishDiagnostics } = await import("../src/retrieval.ts");
    const { lifeloop, dir } = await workspaceWith({ "W.md": "* [ ] just a task\n" });
    const collection = vscode.languages.createDiagnosticCollection() as any;
    publishDiagnostics(lifeloop, collection);
    const messages = collection.entries.flatMap(([, list]: [string, any[]]) =>
      list.map((d) => d.message),
    );
    expect(messages.some((m: string) => m.includes("does not execute"))).toBe(false);
    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("widgets a script builds", () => {
  test("a widget tree renders as escaped HTML with a closed tag set", async () => {
    const { renderWidgetValue } = await import("../src/preview.ts");

    expect(renderWidgetValue({ __widget: "dom.b", children: ["bold"] })).toBe("<b>bold</b>");
    expect(renderWidgetValue({ __widget: "html", children: ["x"] }))
      .toBe('<div class="lifeloop-widget">x</div>');

    // Nested, the way `widget.html(dom.i { body })` builds it.
    expect(
      renderWidgetValue({
        __widget: "html",
        children: [{ __widget: "dom.i", children: ["inner"] }],
      }),
    ).toContain("<i>inner</i>");
  });

  test("a script cannot invent markup for the preview", async () => {
    const { renderWidgetValue } = await import("../src/preview.ts");
    // Output goes into a webview, so the tag set is closed and text is escaped.
    expect(renderWidgetValue({ __widget: "dom.script", children: ["alert(1)"] }))
      .not.toContain("<script");
    expect(renderWidgetValue({ __widget: "dom.b", children: ["<img src=x>"] }))
      .toBe("<b>&lt;img src=x&gt;</b>");
    expect(renderWidgetValue("<b>plain text</b>")).toBe("&lt;b&gt;plain text&lt;/b&gt;");
  });

  test("a space-lua fence stays code until something renders it", async () => {
    const { extendMarkdownIt } = await import("../src/preview.ts");
    const { lifeloop, dir } = await workspaceWith({ "W.md": "* [ ] a\n" });

    const md: any = { renderer: { rules: { fence: () => "<pre>as code</pre>" } } };
    // No renderer supplied — the default path, and what happens when execution
    // is switched off.
    extendMarkdownIt(() => lifeloop)(md);
    expect(md.renderer.rules.fence([{ info: "space-lua", content: "x" }], 0, {}, {}, {}))
      .toBe("<pre>as code</pre>");

    // With one, the block shows what it drew.
    const md2: any = { renderer: { rules: { fence: () => "<pre>as code</pre>" } } };
    extendMarkdownIt(() => lifeloop, (s) => (s === "x" ? "<div>drawn</div>" : undefined))(md2);
    expect(md2.renderer.rules.fence([{ info: "space-lua", content: "x" }], 0, {}, {}, {}))
      .toBe("<div>drawn</div>");

    lifeloop.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Lua blocks rendering in the preview", () => {
  test("any returned value renders, not only widgets", async () => {
    const { valueToMarkdown } = await import("../src/preview.ts");

    expect(valueToMarkdown("plain")).toBe("plain");
    expect(valueToMarkdown(42)).toBe("42");
    expect(valueToMarkdown([])).toBe("_nothing_");
    expect(valueToMarkdown(["a", "b"])).toBe("* a\n* b");

    // An array of objects is what a projection returns — it becomes a table.
    const table = valueToMarkdown([{ name: "one", page: "W" }, { name: "two", page: "W" }]);
    expect(table).toContain("| name | page |");
    expect(table).toContain("| one | W |");

    // Today and Review return named sections.
    const sections = valueToMarkdown({ overdue: [{ name: "late" }], due: [] });
    expect(sections).toContain("**overdue**");
    expect(sections).not.toContain("**due**"); // empty sections are dropped
  });

  test("a pipe in the data cannot break out of a table", async () => {
    const { valueToMarkdown } = await import("../src/preview.ts");
    expect(valueToMarkdown([{ name: "a | b" }])).toContain("a \\| b");
  });

  test("${...} is substituted before parsing, so its Markdown is real Markdown", async () => {
    const { interpolate, interpolations } = await import("../src/preview.ts");

    expect(interpolations("before ${lifeloop.today()} after"))
      .toEqual(["lifeloop.today()"]);
    // Nested braces, as a table constructor produces.
    expect(interpolations("${lifeloop.upcoming({days = 7})}"))
      .toEqual(["lifeloop.upcoming({days = 7})"]);

    const answered = interpolate("Tasks:\n\n${q}", (e) => (e === "q" ? "* one\n* two" : undefined));
    expect(answered).toBe("Tasks:\n\n* one\n* two");
  });

  test("an expression with no answer is left exactly as the author wrote it", async () => {
    const { interpolate } = await import("../src/preview.ts");
    // Better than a blank or an error: the page still reads as its own source.
    expect(interpolate("see ${unknown()} here", () => undefined)).toBe("see ${unknown()} here");
  });

  test("the review template's own expressions are recognised", async () => {
    const { interpolations } = await import("../src/preview.ts");
    // This is the template LifeLoop itself writes — if these were not supported,
    // a weekly review would render as its own source code.
    expect(interpolations("## Completed\n\n${lifeloop.review.completed()}\n"))
      .toEqual(["lifeloop.review.completed()"]);
  });
});

describe("space-style in the preview", () => {
  test("rules are scoped, so a note cannot restyle the window around it", async () => {
    const { safeSpaceStyle } = await import("../src/preview.ts");
    const { css } = safeSpaceStyle("h1 { color: red; }\n.task, .note { font-weight: bold; }");
    expect(css).toContain(".lifeloop-space-style h1 {");
    expect(css).toContain(".lifeloop-space-style .task, .lifeloop-space-style .note {");
  });

  test("anything that reaches outside the page is refused by name", async () => {
    const { safeSpaceStyle } = await import("../src/preview.ts");
    // The preview is a real webview. A remote import or a background URL is a
    // note deciding to make a network request.
    const { css, refused } = safeSpaceStyle(
      "@import url(http://evil); a { background: url(http://tracker); } p { color: blue; }",
    );
    expect(css).toContain(".lifeloop-space-style p");
    expect(css).not.toContain("evil");
    expect(css).not.toContain("tracker");
    expect(refused.length).toBeGreaterThan(0);
  });

  test("markup smuggled into a style block does not survive", async () => {
    const { safeSpaceStyle } = await import("../src/preview.ts");
    const { css } = safeSpaceStyle("p { color: red; } </style><script>alert(1)</script>");
    expect(css).not.toContain("<script");
    expect(css).not.toContain("</style");
  });
});

describe("embeds in the preview", () => {
  test("a youtube embed becomes a link, with its id escaped", async () => {
    const { renderWidgetValue } = await import("../src/preview.ts");
    const html = renderWidgetValue({ __widget: "embed.youtube", children: ["mik1EbTshX4"] });
    expect(html).toContain("youtube.com/watch?v=mik1EbTshX4");

    // The id comes out of a note, and the output goes into a webview.
    const nasty = renderWidgetValue({
      __widget: "embed.youtube", children: ['x"><script>alert(1)</script>'],
    });
    expect(nasty).not.toContain("<script");
    expect(nasty).toContain("&lt;script");
  });
});


test("Lua Markdown results use the host renderer, with nested Lua fences left inert", () => {
  const MarkdownIt = createRequire(import.meta.url)("markdown-it");
  const md = new MarkdownIt({ html: true });
  let calls = 0;
  extendMarkdownIt(() => undefined, () => {
    calls++;
    return { markdown: '<script>alert(1)</script>\n\n**bold**\n\n* parent\n  * child\n\n| A |\n| --- |\n| B |\n\n```space-lua\nrecursive\n```' };
  })(md);
  const html = md.render("```space-lua\nreturn value\n```");
  expect(html).toContain("<strong>bold</strong>");
  expect(html).toContain("<thead>");
  expect(html.match(/<ul>/g)).toHaveLength(2);
  expect(html).toContain("language-space-lua");
  expect(calls).toBe(1);
  expect(html).not.toContain("<script>");
  expect(md.options.html).toBe(true);
});
