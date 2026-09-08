import { changeSet, refuse, applied, type MutationResult } from "../mutation.ts";
import type { Vault } from "../vault.ts";
import { pathOf } from "../vault.ts";
import { itemAt } from "./outline.ts";

/**
 * Signing — `-- @you` at the end of a block.
 *
 * A signature credits rather than addresses, which is exactly what lets you answer
 * a mention without queuing the reply into your own inbox. The marker has to
 * *terminate* its block for the indexer to read it as a signature, so finding the
 * end of the block is the whole job — a `-- @you` in the middle of a paragraph is
 * just text, and appending one there would silently do nothing.
 *
 * Nothing here checks that you are who you say you are, and nothing should be
 * decided on the strength of a signature: it is documentary, not a credential.
 * Git already knows who actually made the change.
 */

const SIGNATURE = /(?:^|\s)(?:--|—|–)\s*(@[\w.]+(?:\s+@[\w.]+)*)\s*$/;

/** The names already signing a line, if it ends in a signature. */
export function signedBy(line: string): string[] {
  const match = SIGNATURE.exec(line);
  return match ? match[1].split(/\s+/) : [];
}

/**
 * The last line of the block containing `line`.
 *
 * A list item owns the lines nested under it, so signing one signs the item, not
 * the last child that happens to sit below it. A paragraph runs to the next blank
 * line. Both readings come from what the indexer treats as a block.
 */
export function blockEnd(lines: string[], line: number): number {
  const item = itemAt(lines, line);
  if (item) {
    // The item's last non-blank line: a signature after a trailing blank would
    // terminate nothing.
    for (let at = item.end - 1; at >= item.line; at--) {
      if (lines[at].trim() !== "") return at;
    }
    return item.line;
  }

  if ((lines[line] ?? "").trim() === "") return line;
  let end = line;
  while (end + 1 < lines.length && lines[end + 1].trim() !== "" && !itemAt(lines, end + 1)) end++;
  return end;
}

/**
 * Sign the block at `line` as `name`.
 *
 * A block already signed by that name is left alone rather than signed twice —
 * running the command again is a thing people do, and the second run should be a
 * no-op, not a second signature.
 */
export async function signBlock(
  vault: Vault,
  page: string,
  line: number,
  name: string,
): Promise<MutationResult<{ line: number }>> {
  const path = pathOf(page);
  if (!vault.exists(path)) return refuse("missing", `no such page: ${page}`);

  const identity = name.startsWith("@") ? name : `@${name}`;
  if (!/^@[\w.]+$/.test(identity)) return refuse("invalid", `not a name: ${name}`);

  const text = vault.read(path);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  if (line < 0 || line >= lines.length) return refuse("invalid", "no such line");

  const end = blockEnd(lines, line);
  const existing = lines[end];
  if (existing.trim() === "") return refuse("invalid", "there is no block here to sign");

  const already = signedBy(existing);
  if (already.includes(identity)) {
    return { ok: true, changed: [], value: { line: end } };
  }

  // Another name already signs it: join the signature rather than starting a
  // second one, which is what `-- @ada @zef` means.
  lines[end] = already.length
    ? `${existing.replace(/\s*$/, "")} ${identity}`
    : `${existing.replace(/\s*$/, "")} -- ${identity}`;

  const cs = changeSet(`sign ${page}:${end} as ${identity}`);
  cs.expected.set(path, text);
  cs.writes.set(path, lines.join(eol));
  return applied(vault, cs, { line: end });
}
