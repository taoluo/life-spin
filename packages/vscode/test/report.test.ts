import { expect, test } from "vitest";
import { Store, indexVault } from "@lifeloop/semantic-core";
import { scriptNamespaces } from "../src/retrieval.ts";

test("what SilverBullet's own docs would actually cost to migrate", async () => {
  const store = new Store(":memory:");
  await indexVault("silverbullet/docs", store);
  const rows = store.objects("space-lua").map((b) => ({
    page: String(b.ref).slice(0, String(b.ref).lastIndexOf("@")),
    ...scriptNamespaces(String(b.script ?? "")),
  }));

  const runnable = rows.filter((r) => !r.editorBound.length && !r.unknown.length);
  const widgets = rows.filter((r) => r.replaced.length && !r.editorBound.length);
  const blocked = rows.filter((r) => r.editorBound.length);
  const unclear = rows.filter((r) => r.unknown.length && !r.editorBound.length);

  console.log(`\n  total blocks       : ${rows.length}`);
  console.log(`  nothing in the way : ${runnable.length}`);
  console.log(`  builds a widget    : ${widgets.length}`);
  console.log(`  editor-bound       : ${blocked.length}`);
  console.log(`  unclassified       : ${unclear.length}`);
  console.log("\n  editor-bound, and why:");
  for (const r of blocked) console.log(`    ${r.page} — ${r.editorBound.join(", ")}`);
  console.log("\n  unclassified calls:");
  console.log("    " + [...new Set(unclear.flatMap((r) => r.unknown))].join(", "));

  // A classifier that buckets everything into one pile is not measuring anything.
  // The first version did exactly that by working per namespace, and produced a
  // confident conclusion in the wrong direction.
  expect(rows.length).toBeGreaterThan(10);
  expect(runnable.length).toBeGreaterThan(0);
  expect(blocked.length).toBeGreaterThan(0);
  expect(runnable.length + widgets.length + blocked.length + unclear.length)
    .toBeGreaterThanOrEqual(rows.length - widgets.length);

  // Lua's own library is never a host call.
  const stdlib = rows.flatMap((r) => r.stdlib);
  expect(stdlib.some((c) => c.startsWith("string."))).toBe(true);
  expect(rows.flatMap((r) => r.portable).some((c) => c.startsWith("string."))).toBe(false);
  store.close();
});
