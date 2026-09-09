import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CalendarEvent, CalendarExactRead } from "@lifeloop/apple-bridge";
import { openPreMeetingBrief } from "../src/apple.ts";
import { taskTarget } from "../src/task-target.ts";
import { LifeLoop } from "../src/workspace.ts";
import * as vscode from "./vscode-mock.ts";

async function workspaceWith(files: Record<string, string>): Promise<{ lifeloop: LifeLoop; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "lifeloop-brief-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  (vscode.workspace as any).root = dir;
  return { lifeloop: await LifeLoop.open(dir), dir };
}

const event: CalendarEvent = {
  uid: "E1", summary: "Meet", start: "start", end: "end", location: "room", cancelled: false,
};

afterEach(() => {
  vi.restoreAllMocks();
  vscode.workspace.settings = {};
});

describe("restricted Pre-meeting Brief", () => {
  const line = '* [ ] Meet [[People/Alice]] [event: "E1"]';
  const files = (task = line) => ({
    "People/Alice.md": "---\ntags: person\n---\n",
    "Work.md": `${task}\n`,
  });

  test("checks eligibility before probing Calendar", async () => {
    const missingBinding = "* [ ] Meet [[People/Alice]]";
    const { lifeloop, dir } = await workspaceWith(files(missingBinding));
    const available = vi.fn(async () => true);
    const readExact = vi.fn(async (): Promise<CalendarExactRead> => ({ kind: "found", event }));
    try {
      const source = taskTarget(lifeloop, {
        handle: { ref: "Work@0", expectedText: missingBinding, expectedState: " " },
      })!;
      await openPreMeetingBrief(lifeloop, source, { available, readExact, open: vi.fn() });
      expect(available).not.toHaveBeenCalled();
      expect(readExact).not.toHaveBeenCalled();
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("revalidates after the Calendar capability check", async () => {
    const { lifeloop, dir } = await workspaceWith(files());
    const source = taskTarget(lifeloop, {
      handle: { ref: "Work@0", expectedText: line, expectedState: " " },
    })!;
    const readExact = vi.fn(async (): Promise<CalendarExactRead> => ({ kind: "found", event }));
    const open = vi.fn();
    try {
      await openPreMeetingBrief(lifeloop, source, {
        available: async () => {
          await lifeloop.vault.write("Work.md", `${line.replace("Meet", "Changed")}\n`);
          return true;
        },
        readExact,
        open,
      });
      expect(readExact).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  for (const changed of ["binding", "people", "tag", "calendar"] as const) {
    test(`opens nothing when ${changed} changes during the exact read`, async () => {
      vscode.workspace.settings["lifeloop.calendarName"] = "Personal";
      const { lifeloop, dir } = await workspaceWith(files());
      const source = taskTarget(lifeloop, {
        handle: { ref: "Work@0", expectedText: line, expectedState: " " },
      })!;
      const open = vi.fn();
      try {
        await openPreMeetingBrief(lifeloop, source, {
          available: async () => true,
          readExact: async () => {
            if (changed === "binding") {
              await lifeloop.vault.write("Work.md", `${line.replace('"E1"', '"E2"')}\n`);
            } else if (changed === "people") {
              await lifeloop.vault.write("Work.md", `${line.replace(" [[People/Alice]]", "")}\n`);
            } else if (changed === "tag") {
              await lifeloop.vault.write("People/Alice.md", "# no longer a Person\n");
            } else {
              vscode.workspace.settings["lifeloop.calendarName"] = "Work";
            }
            return { kind: "found", event };
          },
          open,
        });
        expect(open).not.toHaveBeenCalled();
      } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
    });
  }

  for (const outcome of ["missing", "ambiguous", "throw"] as const) {
    test(`${outcome} exact reads open no partial brief`, async () => {
      const { lifeloop, dir } = await workspaceWith(files());
      const source = taskTarget(lifeloop, {
        handle: { ref: "Work@0", expectedText: line, expectedState: " " },
      })!;
      const open = vi.fn();
      const run = openPreMeetingBrief(lifeloop, source, {
        available: async () => true,
        readExact: async () => {
          if (outcome === "throw") throw new Error("Calendar read failed");
          return { kind: outcome };
        },
        open,
      });
      try {
        if (outcome === "throw") await expect(run).rejects.toThrow("Calendar read failed");
        else await run;
        expect(open).not.toHaveBeenCalled();
      } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
    });
  }

  test("requests one sealed UID and opens one complete brief", async () => {
    vscode.workspace.settings["lifeloop.calendarName"] = "Personal";
    const { lifeloop, dir } = await workspaceWith(files());
    const source = taskTarget(lifeloop, {
      handle: { ref: "Work@0", expectedText: line, expectedState: " " },
    })!;
    const readExact = vi.fn(async (): Promise<CalendarExactRead> => ({ kind: "found", event }));
    const open = vi.fn();
    try {
      await openPreMeetingBrief(lifeloop, source, { available: async () => true, readExact, open });
      expect(readExact).toHaveBeenCalledWith("E1", "Personal");
      expect(open).toHaveBeenCalledOnce();
      expect(open.mock.calls[0][0]).toContain("# Pre-meeting Brief");
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });
});
