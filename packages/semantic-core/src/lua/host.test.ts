import { expect, test, describe } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, indexVault, NodeVault, markdownFiles } from "../index.ts";
import { runLua, collectDeclarations, type HostOptions } from "./host.ts";

async function hostFor(files: Record<string, string>): Promise<HostOptions & { cleanup(): void }> {
  const root = mkdtempSync(join(tmpdir(), "lua-host-"));
  for (const [path, body] of Object.entries(files)) writeFileSync(join(root, path), body);
  const store = new Store(":memory:");
  await indexVault(root, store);
  let paths = await markdownFiles(root);
  const vault = new NodeVault(root, () => paths);
  return {
    store, vault,
    cleanup() { store.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

describe("what a script can read", () => {
  test("index.tasks returns the open task universe", async () => {
    const host = await hostFor({
      "W.md": "* [ ] write the paper\n* [x] shipped\n* [ ] blocked #waiting\n",
    });
    const result = await runLua("#index.tasks()", host);
    expect(result).toMatchObject({ ok: true, value: 2 });

    const filtered = await runLua("index.tasks('waiting')[1].name", host);
    expect(filtered).toMatchObject({ ok: true, value: "blocked" });
    host.cleanup();
  });

  test("lifeloop.* exposes the same projections every other client uses", async () => {
    const host = await hostFor({ "W.md": '* [ ] overdue [deadline: "2020-01-01"]\n' });
    const result = await runLua("#lifeloop.today({date = '2026-09-08'}).overdue", host);
    expect(result).toMatchObject({ ok: true, value: 1 });
    host.cleanup();
  });

  test("projection arrays stay arrays when empty", async () => {
    const host = await hostFor({ "Alice.md": "---\ntags: person\n---\n" });
    expect(await runLua("lifeloop.people({limit = 0})", host))
      .toEqual({ ok: true, value: [] });
    expect(await runLua("lifeloop.people()[1].groups", host))
      .toEqual({ ok: true, value: [] });
    expect(await runLua("query[[ from p = lifeloop.people() limit 0 ]]", host))
      .toEqual({ ok: true, value: [] });
    host.cleanup();
  });

  test("space.readPage reads a page, and a missing one is an error not a crash", async () => {
    const host = await hostFor({ "W.md": "hello\n" });
    expect(await runLua("space.readPage('W')", host)).toMatchObject({
      ok: true, value: "hello\n",
    });
    const missing = await runLua("space.readPage('Nowhere')", host);
    expect(missing.ok).toBe(false);
    expect((missing as any).error).toContain("no such page");
    host.cleanup();
  });

  test("Lua's own standard library works, because it is the vendored runtime", async () => {
    const host = await hostFor({ "W.md": "x\n" });
    expect(await runLua("string.upper('abc')", host)).toMatchObject({ ok: true, value: "ABC" });
    host.cleanup();
  });
});

describe("what a script cannot do", () => {
  test("there is no way to write a page", async () => {
    // Every mutation goes through the named, verified API (I5). A script in a
    // note is content; content does not get to edit the vault.
    const host = await hostFor({ "W.md": "before\n" });
    for (const attempt of [
      "space.writePage('W', 'after')",
      "space.deletePage('W')",
      "editor.setText('after')",
    ]) {
      const result = await runLua(attempt, host);
      expect(result.ok, `${attempt} should not be available`).toBe(false);
    }
    expect(host.vault.read("W.md")).toBe("before\n");
    host.cleanup();
  });

  test("a runaway loop is stopped rather than hanging the caller", async () => {
    const host = await hostFor({ "W.md": "x\n" });
    const started = Date.now();
    const result = await runLua(
      "local n = 0\nwhile true do n = n + 1 end\nreturn n",
      { ...host, budgetMs: 200 },
      "block",
    );
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(false);
    expect((result as any).stopped).toBe(true);
    // Bounded in wall-clock terms, not merely "eventually".
    expect(elapsed).toBeLessThan(5000);
    host.cleanup();
  });

  test("a broken script reports rather than throwing", async () => {
    const host = await hostFor({ "W.md": "x\n" });
    const result = await runLua("this is not lua at all ((", host);
    expect(result.ok).toBe(false);
    expect(typeof (result as any).error).toBe("string");
    host.cleanup();
  });
});

describe("declarations are collected, not executed", () => {
  test("tag, service, identity and config are gathered from real SilverBullet syntax", async () => {
    const host = await hostFor({ "W.md": "x\n" });
    const { declared, errors } = await collectDeclarations(
      [
        `identity.define { name = "sales", description = "Sales team" }`,
        `service.define { selector = "greeter", match = {}, run = function(n) return n end }`,
        `tag.define { name = "book", schema = schema.object { title = schema.string() } }`,
        `config.set("lifeloop.upcomingDays", 21)`,
      ],
      host,
    );

    expect(errors).toEqual([]);
    expect(declared.identities).toHaveLength(1);
    expect(declared.identities[0]).toMatchObject({ name: "sales" });
    expect(declared.services).toHaveLength(1);
    expect(declared.tags).toHaveLength(1);
    expect(declared.config["lifeloop.upcomingDays"]).toBe(21);
    host.cleanup();
  });

  test("one broken declaration does not stop the others", async () => {
    const host = await hostFor({ "W.md": "x\n" });
    const { declared, errors } = await collectDeclarations(
      [`tag.define { name = "ok" }`, `nonsense((`, `tag.define { name = "also ok" }`],
      host,
    );
    expect(declared.tags).toHaveLength(2);
    expect(errors).toHaveLength(1);
    host.cleanup();
  });
});

describe("events, queues and custom syntax", () => {
  test("a listener for an event we raise is kept; one for an event we do not is too", async () => {
    const host = await hostFor({ "W.md": "x\n" });
    const { declared } = await collectDeclarations(
      [
        `event.listen { name = "page:index", run = function(e) return e end }`,
        `event.listen { name = "editor:showPanel", run = function() end }`,
      ],
      host,
    );
    // Both are recorded. Which of them can ever fire is a separate question, and
    // dropping the second would hide the fact that a script expected it.
    expect(declared.registries.events.map((e) => e.name))
      .toEqual(["page:index", "editor:showPanel"]);

    const { unsupportedEvents } = await import("./events.ts");
    expect(unsupportedEvents(declared.registries)).toEqual(["editor:showPanel"]);
    host.cleanup();
  });

  test("a message survives from one pass to the next when the queue is shared", async () => {
    const host = await hostFor({ "W.md": "x\n" });
    const { MessageQueue } = await import("./events.ts");
    const queue = new MessageQueue();

    await runLua(`mq.send("jobs", "first")`, { ...host, queue }, "block");
    await runLua(`mq.send("jobs", "second")`, { ...host, queue }, "block");
    expect(queue.depth("jobs")).toBe(2);

    const depth = await runLua(`mq.depth("jobs")`, { ...host, queue });
    expect(depth).toMatchObject({ ok: true, value: 2 });

    expect(queue.take("jobs", 1)).toEqual(["first"]);
    expect(queue.depth("jobs")).toBe(1);
    host.cleanup();
  });

  test("SilverBullet's own mq.subscribe syntax is accepted", async () => {
    const host = await hostFor({ "W.md": "x\n" });
    const { declared, errors } = await collectDeclarations(
      [`mq.subscribe {
          queue = "testqueue",
          batchSize = 1,
          run = function(messages) return #messages end
        }`],
      host,
    );
    expect(errors).toEqual([]);
    expect(declared.registries.queues).toMatchObject([{ queue: "testqueue", batchSize: 1 }]);
    host.cleanup();
  });

  test("syntax.define is captured with both its markers", async () => {
    const host = await hostFor({ "W.md": "x\n" });
    const { declared, errors } = await collectDeclarations(
      [`syntax.define {
          name = "LatexInline",
          startMarker = "\\\\$",
          endMarker = "\\\\$",
          mode = "inline",
          renderHtml = function(body) return dom.i { body } end
        }`],
      host,
    );
    expect(errors).toEqual([]);
    expect(declared.registries.syntax).toMatchObject([
      { name: "LatexInline", mode: "inline" },
    ]);
    host.cleanup();
  });

  test("custom syntax finds its spans, and a broken pattern does not throw", async () => {
    const { findSyntaxMatches } = await import("./events.ts");
    const specs = [
      { name: "Latex", startMarker: "\\$", endMarker: "\\$", mode: "inline" as const },
      { name: "Broken", startMarker: "([", endMarker: "]", mode: "inline" as const },
    ];
    const { matches, errors } = findSyntaxMatches("a $x + y$ b $z$ c", specs);
    expect(matches.map((m) => m.body)).toEqual(["x + y", "z"]);
    // A pattern that arrived in a note must not be able to break the editor.
    expect(errors.map((e) => e.name)).toEqual(["Broken"]);
  });

  test("overlapping declarations do not produce overlapping spans", async () => {
    const { findSyntaxMatches } = await import("./events.ts");
    const { matches } = findSyntaxMatches("$a$", [
      { name: "One", startMarker: "\\$", endMarker: "\\$", mode: "inline" as const },
      { name: "Two", startMarker: "\\$", endMarker: "\\$", mode: "inline" as const },
    ]);
    // Highlighting the same region twice produces tokens an editor cannot place.
    expect(matches).toHaveLength(1);
  });
});

describe("commands and embeds a vault defines", () => {
  test("SilverBullet's own command.define syntax is accepted and callable", async () => {
    const host = await hostFor({ "W.md": "x\n" });
    const { declared, errors, call } = await collectDeclarations(
      [`command.define {
          name = "Hello world",
          run = function()
            return "greeted"
          end
        }`],
      host,
    );
    // Accepted, so the rest of the block still runs. Nothing registers it: the
    // Command Palette lists what a manifest declared at install time, and that is
    // enough.
    expect(errors).toEqual([]);
    expect(declared.commands).toMatchObject([{ name: "Hello world" }]);

    const result = await call(declared.commands[0].run);
    expect(result).toMatchObject({ ok: true, value: "greeted" });
    host.cleanup();
  });

  test("a command with no name is refused rather than registered namelessly", async () => {
    const host = await hostFor({ "W.md": "x\n" });
    const { declared, errors } = await collectDeclarations(
      [`command.define { run = function() end }`],
      host,
    );
    expect(declared.commands).toHaveLength(0);
    expect(errors).toHaveLength(1);
    host.cleanup();
  });

  test("embed.youtube recognises a link and refuses to guess at one it cannot read", async () => {
    const host = await hostFor({ "W.md": "x\n" });
    const ok = await runLua(`embed.youtube "https://www.youtube.com/watch?v=mik1EbTshX4"`, host);
    expect(ok).toMatchObject({ ok: true, value: { __widget: "embed.youtube", children: ["mik1EbTshX4"] } });

    const short = await runLua(`embed.youtube "https://youtu.be/bb1USz_cEBY"`, host);
    expect((short as any).value.children).toEqual(["bb1USz_cEBY"]);

    // Not a video link: a plain link rather than a broken frame.
    const other = await runLua(`embed.youtube "https://example.com"`, host);
    expect((other as any).value.__widget).toBe("markdown");
    host.cleanup();
  });
});


test("SB task-state names remain complete rather than collapsing to their first letter", async () => {
  const host = await hostFor({ "W.md": "# W\n" });
  try {
    const result = await collectDeclarations([
      'taskState.define {name="TO DO", order=1}\ntaskState.define {name="IN PROGRESS", order=2}\ntaskState.define {name="DONE", done=true, order=3}',
    ], host);
    expect(result.errors).toEqual([]);
    expect(result.declared.taskStates).toEqual([
      { name: "TO DO", state: "TO DO", done: false, order: 1 },
      { name: "IN PROGRESS", state: "IN PROGRESS", done: false, order: 2 },
      { name: "DONE", state: "DONE", done: true, order: 3 },
    ]);
  } finally { host.cleanup(); }
});
