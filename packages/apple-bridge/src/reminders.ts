import {
  osascriptRunner, parseRecords, RECORD_SEPARATOR, FIELD_SEPARATOR, type ScriptRunner,
} from "./osascript.ts";

/**
 * Reminders: 2a out, 2b back.
 *
 * The field model is the whole design (see the plan's §Phase 2 table):
 *
 *   CANONICAL       task text, deadline, project      ours
 *   EXTERNAL-OWNED  alarm, recurrence, location       theirs, never touched
 *   PROJECTION      the reminder's title and note     copied out; an edit over
 *                                                     there is divergence, not ownership
 *   SEMANTIC EVENT  completed / reopened              a transition to translate,
 *                                                     not a value to keep equal
 *
 * The last row is why the recurrence hazard below is easy to see rather than subtle.
 */

export type Reminder = {
  id: string;
  name: string;
  body: string;
  completed: boolean;
  /** Apple may report none even when completed — see `completionDate` below. */
  completionDate: string | null;
  modificationDate: string | null;
  /**
   * Tri-state, and "unknown" is the honest answer over AppleScript.
   *
   * Reminders' scripting dictionary has **no recurrence property** — checked
   * against `properties of` a real reminder, not assumed. Fourteen properties,
   * none of them recurrence. So this route cannot tell a repeating commitment
   * from a one-shot one, and pretending otherwise is how a recurring reminder
   * ends up rewriting a task's completion history.
   */
  recurring: boolean | "unknown";
};

const FIELDS = ["id", "name", "body", "completed", "completionDate", "modificationDate"];

/** AppleScript renders an absent property as this literal text, not as "". */
const absent = (value: string): string | null =>
  value === "" || value === "missing value" ? null : value;

/**
 * Two things this script gets right only because it was run against real data.
 *
 * `missing value` stringifies to the literal text "missing value", which is not
 * empty — so a reminder that has never been completed reported a completion date
 * until this was normalised. And every property read must survive `missing value`
 * rather than assuming absence means an error.
 */
const LIST_SCRIPT = `
on run argv
  set out to ""
  tell application "Reminders"
    repeat with wanted in argv
      -- One lookup per id. \`whose id is in argv\` reads naturally and does not
      -- work: AppleScript will not coerce a list into a type specifier, which
      -- only a real Reminders answered. Found by running it, not by reasoning.
      set matches to (every reminder whose id is (wanted as string))
      repeat with r in matches
        set rid to id of r as string
        set rname to name of r as string
        try
          set rbody to body of r as string
        on error
          set rbody to ""
        end try
        set rdone to (completed of r) as string
        try
          set rcomp to (completion date of r) as string
        on error
          set rcomp to ""
        end try
        try
          set rmod to (modification date of r) as string
        on error
          set rmod to ""
        end try
        -- No recurrence property exists to read; see the type above.
        set out to out & rid & FS & rname & FS & rbody & FS & rdone & FS & rcomp & FS & rmod & RS
      end repeat
    end repeat
  end tell
  return out
end run
`;

const CREATE_SCRIPT = `
on run argv
  set theName to item 1 of argv
  set theBody to item 2 of argv
  set theList to item 3 of argv
  tell application "Reminders"
    if theList is not "" then
      if not (exists list theList) then make new list with properties {name:theList}
      set target to list theList
    else
      set target to default list
    end if
    set r to make new reminder at end of target with properties {name:theName, body:theBody}
    return id of r as string
  end tell
end run
`;

const UPDATE_SCRIPT = `
on run argv
  set theId to item 1 of argv
  set expectedName to item 2 of argv
  set theName to item 3 of argv
  tell application "Reminders"
    set matches to (every reminder whose id is theId)
    if (count of matches) is 0 then return "gone"
    set r to item 1 of matches
    if (name of r as string) is not expectedName then return "conflict"
    set name of r to theName
    return "ok"
  end tell
end run
`;

const DELETE_SCRIPT = `
on run argv
  tell application "Reminders"
    set matches to (every reminder whose id is (item 1 of argv))
    if (count of matches) is 0 then return "gone"
    delete item 1 of matches
    return "ok"
  end tell
end run
`;

function withSeparators(script: string): string {
  return script
    .replace(/\bRS\b/g, `(ASCII character 29)`)
    .replace(/\bFS\b/g, `(ASCII character 31)`);
}

export class Reminders {
  constructor(private readonly run: ScriptRunner = osascriptRunner) {}

  /** Read the current state of reminders we hold ids for. */
  async read(ids: string[]): Promise<Map<string, Reminder>> {
    if (ids.length === 0) return new Map();
    const out = await this.run(withSeparators(LIST_SCRIPT), ids);
    const records = parseRecords(out, FIELDS);
    return new Map(
      records.map((r) => [
        r.id,
        {
          id: r.id,
          name: r.name,
          body: absent(r.body) ?? "",
          completed: r.completed === "true",
          completionDate: absent(r.completionDate),
          modificationDate: absent(r.modificationDate),
          // Not a guess and not a default: this route genuinely cannot say.
          recurring: "unknown" as const,
        },
      ]),
    );
  }

  async create(name: string, body: string, list: string): Promise<string> {
    return this.run(CREATE_SCRIPT, [name, body, list]);
  }

  /** Compare-and-set the projected title without touching the externally owned body. */
  async update(id: string, expectedName: string, name: string): Promise<"ok" | "gone" | "conflict"> {
    const result = await this.run(UPDATE_SCRIPT, [id, expectedName, name]);
    if (result === "ok" || result === "gone" || result === "conflict") return result;
    throw new Error(`unexpected Reminders update response: ${result}`);
  }

  /** Delete a reminder. Used to undo a creation whose binding could not be written. */
  async remove(id: string): Promise<boolean> {
    return (await this.run(DELETE_SCRIPT, [id])) === "ok";
  }
}

export { RECORD_SEPARATOR, FIELD_SEPARATOR };
