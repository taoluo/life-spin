import { expect, test } from "vitest";
import { Store, indexVault, NodeVault, markdownFiles } from "../index.ts";
import { collectDeclarations } from "./host.ts";

/**
 * SilverBullet's own Space Lua blocks, run through our host.
 *
 * The only honest measure of a host API surface is whether real scripts get
 * through it. These are not written for us and were never adjusted.
 */
test("SilverBullet's own docs run through the host API", async () => {
  const root = "silverbullet/docs";
  const store = new Store(":memory:");
  await indexVault(root, store);
  const paths = await markdownFiles(root);
  const vault = new NodeVault(root, () => paths);

  const blocks = store.objects("space-lua").map((b) => String(b.script ?? ""));
  expect(blocks.length).toBeGreaterThan(15);

  const { declared, errors } = await collectDeclarations(blocks, {
    store, vault, budgetMs: 1000,
  });

  const ran = blocks.length - errors.length;
  console.log(`\n  blocks           : ${blocks.length}`);
  console.log(`  ran without error: ${ran}`);
  console.log(`  declared         : ${declared.tags.length} tags, ${declared.identities.length} identities, ` +
              `${declared.services.length} services, ${Object.keys(declared.config).length} config keys`);
  // "attempt to index a nil value" never says *which* nil, so the useful list
  // comes from the scripts: globals they call that our env does not define.
  const provided = new Set([
    "index", "space", "lifeloop", "config", "tag", "service", "identity", "schema",
    "string", "table", "math", "os", "editor", "event", "mq", "syntax", "taskState",
    "actionButton", "widget", "dom", "js", "query",
  ]);
  const missing = new Map<string, number>();
  for (const script of blocks) {
    for (const m of script.matchAll(/\b([a-zA-Z][a-zA-Z0-9_]*)\.[a-zA-Z]/g)) {
      if (!provided.has(m[1])) missing.set(m[1], (missing.get(m[1]) ?? 0) + 1);
    }
  }
  const { unsupportedEvents } = await import("./events.ts");
  console.log(`  registries       : ${declared.registries.events.length} events, ` +
              `${declared.registries.queues.length} queues, ${declared.registries.syntax.length} syntax, ` +
              `${declared.taskStates.length} task states, ${declared.actionButtons.length} buttons`);
  const unsupported = unsupportedEvents(declared.registries);
  if (unsupported.length) console.log(`  events we never raise: ${unsupported.join(", ")}`);

  console.log("\n  globals these scripts want that we do not provide:");
  for (const [name, n] of [...missing].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(2)}  ${name}`);
  }

  // How many produce something a preview could actually show — the real measure
  // of "Lua blocks render", as opposed to "Lua blocks parse".
  const { runLua } = await import("./host.ts");
  let renders = 0;
  for (const script of blocks) {
    const r = await runLua(script, { store, vault, budgetMs: 1000 }, "block");
    if (r.ok && r.value !== undefined && r.value !== null) renders++;
  }
  console.log(`\n  produce visible output: ${renders}`);
  console.log("  (SilverBullet's docs are API *documentation* — almost every block is a");
  console.log("   `define` or `set` call with nothing to return, so zero is the correct");
  console.log("   answer here rather than a failure. See render.test.ts for the path.)");

  // Something real must get through, or the host surface is theatre.
  expect(ran).toBeGreaterThan(0);
  // And a failing block must never take the others down with it.
  expect(declared.identities.length + declared.tags.length).toBeGreaterThan(0);
  store.close();
});
