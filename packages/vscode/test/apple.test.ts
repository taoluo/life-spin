import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CalendarEvent, CalendarExactRead } from "@lifeloop/apple-bridge";
import * as bridge from "@lifeloop/apple-bridge";
import { openPreMeetingBrief, registerApple } from "../src/apple.ts";
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
  vscode.workspace.textDocuments = [];
  delete (vscode.window as any).createOutputChannel;
});

/** Exercise public command registration while keeping every Apple effect fake. */
function appleCommands(lifeloop: LifeLoop) {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  vi.spyOn(vscode.commands, "registerCommand").mockImplementation(((name: string, handler: any) => {
    handlers.set(name, handler);
    return { dispose() {} };
  }) as any);
  (vscode.window as any).createOutputChannel = vi.fn(() => ({ appendLine: vi.fn(), dispose() {} }));
  const state: Record<string, unknown> = {
    "lifeloop.reminderObservations": { R0: { localName: "keep" } },
    "lifeloop.calendarObservations": { E0: { localName: "keep", remoteSummary: "keep" } },
    "lifeloop.noteObservations": { N0: { text: "keep", modified: "before" } },
    "lifeloop.syncConflicts": [{ kind: "calendar", id: "E0", ref: "Other@0", reason: "keep" }],
  };
  const before = structuredClone(state);
  const update = vi.fn(async (key: string, value: unknown) => { state[key] = value; });
  const effects = [
    vi.spyOn(lifeloop.vault, "write"), vi.spyOn(lifeloop.vault, "remove"),
    vi.spyOn(vscode.workspace, "applyEdit"),
    vi.spyOn(bridge.Calendar.prototype, "create").mockResolvedValue("NEW-EVENT"),
    vi.spyOn(bridge.Calendar.prototype, "updateSummary").mockResolvedValue("ok"),
    vi.spyOn(bridge.Calendar.prototype, "remove").mockResolvedValue(true),
    vi.spyOn(bridge.Reminders.prototype, "create").mockResolvedValue("NEW-REMINDER"),
    vi.spyOn(bridge.Reminders.prototype, "update").mockResolvedValue("ok"),
    vi.spyOn(bridge.Reminders.prototype, "remove").mockResolvedValue(true),
    vi.spyOn(bridge, "syncCalendar").mockRejectedValue(new Error("unexpected Sync")),
    vi.spyOn(bridge, "syncReminders").mockRejectedValue(new Error("unexpected Sync")),
    vi.spyOn(bridge, "resolveCalendarConflict").mockRejectedValue(new Error("unexpected Resolve")),
    vi.spyOn(bridge, "resolveReminderConflict").mockRejectedValue(new Error("unexpected Resolve")),
    vi.spyOn(bridge, "resolveNoteConflict").mockRejectedValue(new Error("unexpected Resolve")),
  ];
  const available = vi.spyOn(bridge, "appAvailable").mockResolvedValue(true);
  const read = vi.spyOn(bridge.Calendar.prototype, "readExact").mockResolvedValue({ kind: "found", event });
  const batchRead = vi.spyOn(bridge.Calendar.prototype, "read").mockRejectedValue(new Error("unexpected batch read"));
  const open = vi.spyOn(vscode.workspace, "openTextDocument");
  const show = vi.spyOn(vscode.window, "showTextDocument");
  const status = vi.spyOn(vscode.window, "setStatusBarMessage");
  registerApple(lifeloop, {
    subscriptions: [], workspaceState: { get: (key: string, fallback: unknown) => state[key] ?? fallback, update },
  } as any);
  return {
    available, read, open, show,
    run: (name: string, input: unknown) => handlers.get(name)!(input),
    unchanged() {
      for (const effect of [...effects, batchRead, update, status]) expect(effect).not.toHaveBeenCalled();
      expect(state).toStrictEqual(before);
    },
    noOutput() {
      expect(open).not.toHaveBeenCalled();
      expect(show).not.toHaveBeenCalled();
    },
  };
}

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

  test("requests one sealed UID and opens one complete navigable brief", async () => {
    vscode.workspace.settings["lifeloop.calendarName"] = "Personal";
    const anchoredLine = '* [ ] Meet [[People/Alice]] $meeting [event: "E1"]';
    const interaction = "intro\r\n* Called [[People/Alice]] [interaction: call]\r\n" +
      "* Met [[People/Alice]] [interaction: coffee] $met\r\n";
    const { lifeloop, dir } = await workspaceWith({
      ...files(anchoredLine),
      "Journal/2026-09-01.md": interaction,
    });
    const source = taskTarget(lifeloop, {
      handle: { ref: "Work@meeting", expectedText: anchoredLine, expectedState: " " },
    })!;
    const readExact = vi.fn(async (): Promise<CalendarExactRead> => ({ kind: "found", event }));
    const open = vi.fn();
    try {
      await openPreMeetingBrief(lifeloop, source, { available: async () => true, readExact, open });
      expect(readExact).toHaveBeenCalledWith("E1", "Personal");
      expect(open).toHaveBeenCalledOnce();
      expect(open.mock.calls[0][0]).toContain("# Pre-meeting Brief");
      expect(open.mock.calls[0][0]).toContain(`file://${join(dir, "People/Alice.md")}`);
      expect(open.mock.calls[0][0]).toContain(
        `[[Journal/2026-09-01@${interaction.indexOf("* Called")}]]`,
      );
      expect(open.mock.calls[0][0]).toContain("[[Journal/2026-09-01@met]]");
      expect(open.mock.calls[0][0]).toContain("[[Work@meeting]]");
    } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("registered Apple command boundaries", () => {
  const line = '* [ ] Meet [[People/Alice]] [event: "E1"]';
  const files = (task = line) => ({
    "People/Alice.md": "---\ntags: person\n---\n",
    "People/Bob.md": "---\ntags: person\n---\n",
    "Journal/2026-09-09.md": "existing Journal text\n",
    "Work.md": `${task}\n`,
  });
  const input = (text = line, ref = "Work@0") => ({
    handle: { ref, expectedText: text, expectedState: " " },
  });
  const snapshot = (lifeloop: LifeLoop) => Object.fromEntries(
    lifeloop.vault.list().map(path => [path, lifeloop.vault.read(path)]),
  );

  for (const reason of ["no binding", "empty binding", "duplicate binding", "no Person", "missing Person", "non-Person", "inherited only", "stale handle"] as const) {
    test(`Brief ${reason} refuses before capability and leaves all effects untouched`, async () => {
      const task = reason === "no binding" ? line.replace(' [event: "E1"]', "")
        : reason === "empty binding" ? line.replace('"E1"', '""')
        : reason === "duplicate binding" ? `${line} [event: "E2"]`
        : reason === "no Person" || reason === "inherited only" ? line.replace(" [[People/Alice]]", "")
        : reason === "missing Person" ? line.replace("People/Alice", "People/Missing") : line;
      const content = files(task);
      if (reason === "non-Person") content["People/Alice.md"] = "# Ordinary page\n";
      if (reason === "inherited only") content["Work.md"] = `* Context [[People/Alice]]\n  ${task}\n`;
      const { lifeloop, dir } = await workspaceWith(content);
      const command = appleCommands(lifeloop);
      const before = snapshot(lifeloop);
      const guarded = reason === "inherited only"
        ? input(`  ${task}`, `Work@${content["Work.md"].indexOf("  *")}`)
        : input(reason === "stale handle" ? "* [ ] old task" : task);
      try {
        await command.run("lifeloop.preMeetingBrief", guarded);
        expect(command.available).not.toHaveBeenCalled();
        expect(command.read).not.toHaveBeenCalled();
        command.noOutput();
        command.unchanged();
        expect(snapshot(lifeloop)).toStrictEqual(before);
      } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
    });
  }

  for (const boundary of ["capability", "exact read"] as const) {
    for (const changed of ["binding", "direct People", "Person tag", "calendar"] as const) {
      test(`Brief ${changed} drift after ${boundary} leaves no output or write effects`, async () => {
        vscode.workspace.settings["lifeloop.calendarName"] = "Personal";
        const { lifeloop, dir } = await workspaceWith(files());
        const command = appleCommands(lifeloop);
        const expected = snapshot(lifeloop);
        const drift = () => {
          if (changed === "calendar") vscode.workspace.settings["lifeloop.calendarName"] = "Work";
          else {
            const path = changed === "Person tag" ? "People/Alice.md" : "Work.md";
            const text = changed === "Person tag" ? "# Ordinary page\n"
              : `${changed === "binding" ? line.replace('"E1"', '"E2"') : line.replace("People/Alice", "People/Bob")}\n`;
            writeFileSync(join(dir, path), text);
            expected[path] = text;
          }
        };
        if (boundary === "capability") command.available.mockImplementation(async () => { drift(); return true; });
        else command.read.mockImplementation(async () => { drift(); return { kind: "found", event }; });
        try {
          await command.run("lifeloop.preMeetingBrief", input());
          expect(command.available).toHaveBeenCalledExactlyOnceWith("Calendar", { launch: true });
          if (boundary === "capability") expect(command.read).not.toHaveBeenCalled();
          else expect(command.read).toHaveBeenCalledExactlyOnceWith("E1", "Personal");
          command.noOutput();
          command.unchanged();
          expect(snapshot(lifeloop)).toStrictEqual(expected);
        } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
      });
    }
  }

  for (const outcome of ["unavailable", "missing", "ambiguous", "throw", "found"] as const) {
    test(`registered Brief ${outcome} preserves Markdown and observation/conflict state`, async () => {
      vscode.workspace.settings["lifeloop.calendarName"] = "Personal";
      const { lifeloop, dir } = await workspaceWith(files());
      const command = appleCommands(lifeloop);
      const before = snapshot(lifeloop);
      if (outcome === "unavailable") command.available.mockResolvedValue(false);
      else if (outcome === "throw") command.read.mockRejectedValue(new Error("Calendar read failed"));
      else if (outcome !== "found") command.read.mockResolvedValue({ kind: outcome });
      try {
        await command.run("lifeloop.preMeetingBrief", input());
        if (outcome === "unavailable") expect(command.read).not.toHaveBeenCalled();
        else expect(command.read).toHaveBeenCalledExactlyOnceWith("E1", "Personal");
        if (outcome === "found") {
          expect(command.open).toHaveBeenCalledOnce();
          expect((command.open.mock.calls[0] as unknown[])[0]).toMatchObject({ language: "markdown", content: expect.stringContaining("# Pre-meeting Brief") });
          expect(command.show).toHaveBeenCalledOnce();
        } else command.noOutput();
        command.unchanged();
        expect(snapshot(lifeloop)).toStrictEqual(before);
      } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
    });
  }

  for (const [name, boundary] of [["addReminder", "capability"], ["addToCalendar", "capability"], ["addToCalendar", "prompt"]] as const) {
    test(`${name} stale after ${boundary} creates nothing and reports no success`, async () => {
      const task = "* [ ] Meet [[People/Alice]] $meeting";
      const { lifeloop, dir } = await workspaceWith(files(task));
      const command = appleCommands(lifeloop);
      const expected = snapshot(lifeloop);
      const drift = () => {
        expected["Work.md"] = `~~~text\n${task}\n~~~\n`;
        writeFileSync(join(dir, "Work.md"), expected["Work.md"]);
      };
      command.available.mockImplementation(async () => {
        if (boundary === "capability") drift();
        return true;
      });
      vi.spyOn(vscode.window, "showInputBox").mockImplementation(async () => {
        if (boundary === "prompt") drift();
        return "2026-09-09 09:00" as any;
      });
      try {
        await command.run(`lifeloop.${name}`, input(task, "Work@meeting"));
        expect(command.available).toHaveBeenCalledOnce();
        command.noOutput();
        command.unchanged();
        expect(command.read).not.toHaveBeenCalled();
        expect(snapshot(lifeloop)).toStrictEqual(expected);
      } finally { lifeloop.dispose(); rmSync(dir, { recursive: true, force: true }); }
    });
  }
});
