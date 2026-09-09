import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MemoryVault,
  Store,
  backlinks,
  indexVault,
  markdownFiles,
  pageNameOf,
  processItem,
  tasks,
} from "@lifeloop/semantic-core";

/**
 * Conformance layers B and C, against a live SilverBullet.
 *
 * Layer A — extraction — is not here, and that is deliberate: we vendor and call
 * SilverBullet's own extractors, and its own 285 assertions run against that copy,
 * so there is no second implementation to differ from. See COMPATIBILITY.md.
 *
 * What remains needs a running client:
 *   B  index primitives — does SilverBullet's index answer as ours does
 *   C  mutation bytes  — does the Lua library write what our port writes
 *
 * This skips when no client answers, and says loudly what went unchecked. A
 * conformance suite that passes silently when it ran nothing is worse than none.
 */

const SPACE = process.env.LIFELOOP_SB_SPACE ?? "test_space";
const SB = process.env.SB_BIN ?? "/usr/local/bin/sb";
const FIXTURES = resolve(import.meta.dirname, "../fixtures");

function lua(script: string, seconds = 30): unknown | null {
  try {
    const out = execFileSync(SB, ["script", "-s", SPACE, "-t", String(seconds), "--json", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: (seconds + 5) * 1000,
    });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

// A short probe, because a registered space may have no live RuntimeAPI client.
// Deciding "no client" stays bounded rather than delaying the whole test suite.
const available = lua("return 1", 5) !== null;

if (!available) {
  test("live SilverBullet conformance — SKIPPED", async () => {
    console.warn(
      [
        "",
        "  ⚠ Conformance layers B and C did not run: no SilverBullet client answered.",
        "",
        "    Unchecked:  index primitives (tasks by tag, backlinks, inherited tags,",
        "                nested-item context, comment exclusion)",
        "                mutation bytes vs the Lua library, including no-op cases",
        "",
        `    To run:     sb open tmp/${SPACE}     then re-run the suite`,
        "                (layer A — extraction — is proved without a client; see COMPATIBILITY.md)",
        "",
      ].join("\n"),
    );
    expect(available).toBe(false); // records the skip rather than passing silently
  });
}

describe.runIf(available)("layer B — index primitives", () => {
  test("the open task set matches SilverBullet's", async () => {
    const store = new Store(":memory:");
    await indexVault(FIXTURES, store);
    const ours = tasks.open(store).map((t) => String(t.name)).sort();
    const pages = (await markdownFiles(FIXTURES)).map(pageNameOf);
    const fixturePages = pages.map((page) => `t.page == ${JSON.stringify(page)}`).join(" or ");

    const theirs = lua(`
      return query[[
        from t = tags.task
        where not t.done and not t.inComment and (${fixturePages})
        select t.name
      ]]
    `) as string[] | null;

    expect(theirs, "SilverBullet returned nothing").not.toBeNull();
    expect(ours).toEqual(theirs!.sort());
    store.close();
  });

  test("backlinks match for a page both sides can see", async () => {
    const store = new Store(":memory:");
    await indexVault(FIXTURES, store);
    const page = "Projects/Reed Solomon";
    const ours = [...new Set(backlinks(store, page).map((r) => String(r.page)))].sort();
    const pages = (await markdownFiles(FIXTURES)).map(pageNameOf);
    const fixturePages = pages.map((source) => `l.page == ${JSON.stringify(source)}`).join(" or ");

    const theirs = lua(`
      return query[[
        from l = tags.link
        where l.toPage == ${JSON.stringify(page)} and (${fixturePages})
        select l.page
      ]]
    `) as string[] | null;

    expect(theirs).not.toBeNull();
    expect(ours).toEqual(theirs!.sort());
    store.close();
  });
});

describe.runIf(available)("layer C — mutation bytes", () => {
  test("a stale source is a byte-identical no-op on both sides", async () => {
    // The assertion that matters most, and the one a dump comparison cannot make:
    // both implementations must refuse, and refusing must write nothing.
    const theirs = lua(`
      local before = space.readPage("Inbox")
      local ok, err = lifeloop.inbox.applyToItem({
        kind = "item",
        page = "Inbox",
        range = {0, 1},
        raw = "definitely stale"
      })
      local after = space.readPage("Inbox")
      return { refused = not ok, unchanged = before == after, error = tostring(err) }
    `) as { refused: boolean; unchanged: boolean; error: string } | null;
    expect(theirs).toMatchObject({ refused: true, unchanged: true });

    const inbox = readFileSync(resolve(FIXTURES, "Inbox.md"), "utf8");
    const vault = MemoryVault.of({ "Inbox.md": inbox });
    const ours = await processItem(vault, { offset: 0, end: 1, text: "definitely stale" }, null);
    expect(ours).toMatchObject({ ok: false, reason: "stale" });
    expect(vault.read("Inbox.md")).toBe(inbox);
  });
});
