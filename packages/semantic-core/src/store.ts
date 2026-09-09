import { DatabaseSync } from "node:sqlite";

/**
 * `node:sqlite` is why this needs a recent host.
 *
 * It removes the native dependency entirely — nothing to compile, prebuild or
 * fail to install — but it only exists from Node 22.5, and unflagged from 22.13.
 * A host without it should say so precisely: "cannot find module node:sqlite"
 * thrown from deep inside an indexer is a bug report nobody can act on.
 */
export function assertRuntime(): void {
  if (typeof DatabaseSync !== "function") {
    throw new Error(
      "LifeLoop needs node:sqlite, which this host does not provide. " +
        "That means Node 22.13 or newer — in VS Code, version 1.102 or newer. " +
        `This host reports Node ${process.versions.node}.`,
    );
  }
}
import type { LifeloopObject } from "./extract.ts";

/**
 * One derived store, one rebuild path (execution plan I3).
 *
 * Everything in here is derivable from Markdown, so deleting the file loses no
 * user fact. That is only true because external bindings live on the task line
 * rather than in a side table (I6) — the two decisions hold each other up.
 *
 * Node's built-in `node:sqlite` carries FTS5, so there is no native dependency
 * to build, prebuild or fail to install.
 */

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pages (
  id   INTEGER PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  hash TEXT NOT NULL,
  last_modified TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0
);
-- The object itself stays JSON: its shape is SilverBullet's, and mirroring that
-- into columns would be a second schema to keep in step for no gain. Five fields
-- are lifted out because every projection filters on them and nothing else does:
-- done and in_comment define the task universe, deadline and scheduled are the
-- only scheduling DESIGN.md gives a task, and rel_to carries a link's target.
-- They are derived at write time, so the rule still holds — delete the file,
-- rebuild, lose nothing.
CREATE TABLE IF NOT EXISTS objects (
  page       TEXT NOT NULL,
  tag        TEXT NOT NULL,
  ref        TEXT NOT NULL,
  pos        INTEGER,
  done       INTEGER,
  in_comment INTEGER,
  deadline   TEXT,
  scheduled  TEXT,
  rel_to     TEXT,
  json       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS objects_page ON objects(page);
CREATE INDEX IF NOT EXISTS objects_ref  ON objects(ref);
CREATE INDEX IF NOT EXISTS objects_tag  ON objects(tag, page, pos, ref);

-- Sort columns belong in each index. Without them SQLite picks the plain tag
-- index and sorts into a temp b-tree, and the narrower index is never used.
CREATE INDEX IF NOT EXISTS objects_task
  ON objects(in_comment, done, deadline, page, pos, ref) WHERE tag = 'task';
CREATE INDEX IF NOT EXISTS objects_task_scheduled
  ON objects(in_comment, done, scheduled, page, pos, ref) WHERE tag = 'task';
CREATE INDEX IF NOT EXISTS objects_relation_to
  ON objects(rel_to, page, pos, ref) WHERE tag = 'relation';

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- FTS rows are keyed by the page's rowid, never by its name. Deleting by an
-- UNINDEXED column makes SQLite scan the whole table, which turned a reindex into
-- a quadratic one: every page paid to search every other page's text.
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(body);
`;

export type PageRecord = { path: string; name: string; hash: string; lastModified: string; size: number };

export class Store {
  readonly db: DatabaseSync;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
    this.db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)")
      .run(String(SCHEMA_VERSION));
  }

  close(): void {
    this.db.close();
  }

  /**
   * Replace everything known about one page, in a single transaction.
   *
   * Delete-then-insert rather than merge: a page's objects are a pure function of
   * its text, so anything already there is by definition stale. A partial update
   * would leave objects from a version of the file that no longer exists.
   */
  replacePage(page: PageRecord, objects: LifeloopObject[], body: string): void {
    const { db } = this;
    db.exec("BEGIN");
    try {
      this.writePage(page, objects, body);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  /** The body of `replacePage`, without its transaction — for bulk callers that own one. */
  writePage(page: PageRecord, objects: LifeloopObject[], body: string): void {
    const { db } = this;
    db.prepare(
      `INSERT INTO pages(path, name, hash, last_modified, size) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET name=excluded.name, hash=excluded.hash,
         last_modified=excluded.last_modified, size=excluded.size`,
    ).run(page.path, page.name, page.hash, page.lastModified, page.size);
    const id = (db.prepare("SELECT id FROM pages WHERE path = ?").get(page.path) as any).id;

    db.prepare("DELETE FROM objects WHERE page = ?").run(page.name);
    db.prepare("DELETE FROM fts WHERE rowid = ?").run(id);

    const insert = db.prepare(
      `INSERT INTO objects(page, tag, ref, pos, done, in_comment, deadline, scheduled, rel_to, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const o of objects) {
      const pos = Array.isArray(o.range) ? o.range[0] : null;
      insert.run(
        page.name,
        o.tag,
        String(o.ref ?? ""),
        pos,
        o.done === true ? 1 : o.done === false ? 0 : null,
        o.inComment === true ? 1 : 0,
        typeof o.deadline === "string" ? o.deadline : null,
        typeof o.scheduled === "string" ? o.scheduled : null,
        o.tag === "relation" && o.kind === "mention" && typeof o.to === "string" ? o.to : null,
        JSON.stringify(o),
      );
    }
    db.prepare("INSERT INTO fts(rowid, body) VALUES (?, ?)").run(id, body);
  }

  forgetPage(name: string): void {
    const { db } = this;
    db.exec("BEGIN");
    try {
      const row = db.prepare("SELECT id FROM pages WHERE name = ?").get(name) as any;
      db.prepare("DELETE FROM objects WHERE page = ?").run(name);
      if (row) db.prepare("DELETE FROM fts WHERE rowid = ?").run(row.id);
      db.prepare("DELETE FROM pages WHERE name = ?").run(name);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  hashOf(path: string): string | undefined {
    const row = this.db.prepare("SELECT hash FROM pages WHERE path = ?").get(path) as any;
    return row?.hash;
  }

  pagePaths(): string[] {
    return (this.db.prepare("SELECT path FROM pages ORDER BY path").all() as any[]).map((r) => r.path);
  }

  pageNames(): string[] {
    return (this.db.prepare("SELECT name FROM pages ORDER BY name").all() as any[]).map((r) => r.name);
  }

  /** Rows for a raw SQL predicate over `objects`. The projections above use this. */
  select(where: string, params: unknown[] = []): LifeloopObject[] {
    const rows = this.db
      .prepare(`SELECT json FROM objects WHERE ${where} ORDER BY page, pos, ref`)
      .all(...(params as any[])) as any[];
    return rows.map((r) => JSON.parse(r.json));
  }

  objects(tag?: string): LifeloopObject[] {
    const rows = tag
      ? this.db.prepare("SELECT json FROM objects WHERE tag = ? ORDER BY page, pos, ref").all(tag)
      : this.db.prepare("SELECT json FROM objects ORDER BY page, pos, ref").all();
    return (rows as any[]).map((r) => JSON.parse(r.json));
  }

  /**
   * A stable, whole-store dump. The rebuildability check compares two of these
   * byte for byte, so the ordering has to be total and independent of insert order.
   */
  dump(): string {
    const rows = this.db
      .prepare("SELECT page, tag, ref, json FROM objects ORDER BY page, tag, ref, pos, json")
      .all() as any[];
    return rows.map((r) => JSON.stringify(JSON.parse(r.json))).join("\n") + "\n";
  }
}
