import { execFile } from "node:child_process";

/**
 * The bridge to Reminders and Calendar.
 *
 * **Values are passed as arguments, never interpolated into the script.** A task
 * called `Fix "the" thing` would otherwise rewrite the program being run, which is
 * an injection bug in a tool that edits your calendar. AppleScript reads them from
 * `argv` instead.
 *
 * This package imports nothing from `vscode`. An extension host can be local,
 * remote, SSH or web, so "EventKit is reachable from here" is not a fact the editor
 * may assume. Promoting this to a service later is a deployment change, not a rewrite.
 */

export type ScriptRunner = (
  script: string,
  args: string[],
  options?: { timeoutMs?: number; maxBuffer?: number },
) => Promise<string>;

export type RunOptions = { timeoutMs?: number; maxBuffer?: number };

export const osascriptRunner: ScriptRunner = (script, args, options = {}) =>
  new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const child = execFile(
      "osascript",
      ["-l", "AppleScript", "-", ...args],
      { timeout: timeoutMs, maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024 },
      (error: any, stdout, stderr) => {
        if (!error) return resolve(stdout.trim());
        // A killed process reports no stderr at all, so the bare message is
        // "Command failed" with nothing to act on. Say which limit was hit —
        // scale problems and permission problems need opposite responses.
        if (error.killed || error.signal === "SIGTERM") {
          return reject(
            new Error(
              `osascript timed out after ${timeoutMs}ms. Apple's scripting bridge is slow ` +
                `per item, so this usually means too much was asked for at once.`,
            ),
          );
        }
        if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          return reject(new Error("osascript produced more output than the buffer allows"));
        }
        reject(new Error(stderr?.trim() || error.message));
      },
    );
    child.stdin?.end(script);
  });

/**
 * Whether a specific app can be scripted, and optionally start it.
 *
 * Calendar reports "Application isn't running (-600)" rather than answering, so
 * this is a real state, not an error. Launching is **opt-in**: a background sync
 * must never open an app the user did not ask for — that is their machine doing
 * something surprising. An explicit command may pass `launch: true`.
 */
export async function appAvailable(
  app: "Reminders" | "Calendar" | "Notes",
  options: { launch?: boolean } = {},
  runner: ScriptRunner = osascriptRunner,
): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  const running = await runner(
    `on run argv
      tell application "System Events" to return (exists process (item 1 of argv)) as string
    end run`,
    [app],
  ).catch(() => "false");

  if (running === "true") return true;
  if (!options.launch) return false;

  try {
    await runner(
      `on run argv
        tell application (item 1 of argv) to launch
        return "ok"
      end run`,
      [app],
      { timeoutMs: 20_000 },
    );
    return true;
  } catch {
    return false;
  }
}

/** Whether this host can talk to Apple at all. Reported, never assumed. */
export async function available(runner: ScriptRunner = osascriptRunner): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try {
    await runner('on run argv\nreturn "ok"\nend run', []);
    return true;
  } catch {
    return false;
  }
}

// ASCII group and unit separators. AppleScript output is flat text and a task's own
// title may contain tabs, newlines or commas; it cannot contain either of these.
export const RECORD_SEPARATOR = "\u001d";
export const FIELD_SEPARATOR = "\u001f";

export function parseRecords(out: string, fields: string[]): Record<string, string>[] {
  if (!out) return [];
  return out
    .split(RECORD_SEPARATOR)
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(FIELD_SEPARATOR);
      return Object.fromEntries(fields.map((name, i) => [name, parts[i] ?? ""]));
    });
}
