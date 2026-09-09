#!/usr/bin/env -S node --experimental-strip-types
import { resolve } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import {
  Store, indexVault, query,
  projectionNames, runProjection, projections, CONTRACT_VERSION, type ProjectionArgs,
} from "@lifeloop/semantic-core";

const [, , command, ...rest] = process.argv;
const flag = (name: string) => rest.includes(`--${name}`);
const value = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
};
const positional = rest.filter((a, i) => !a.startsWith("--") && !rest[i - 1]?.startsWith("--"));

const vaultRoot = resolve(value("vault") ?? positional[0] ?? process.cwd());
const dbPath = value("db") ?? resolve(vaultRoot, ".lifeloop/index.sqlite");

function openStore(fresh = false): Store {
  if (dbPath !== ":memory:") {
    mkdirSync(resolve(dbPath, ".."), { recursive: true });
    if (fresh && existsSync(dbPath)) rmSync(dbPath, { force: true });
  }
  return new Store(dbPath);
}

const emit = (data: unknown) => console.log(JSON.stringify(data, null, flag("json") ? 0 : 2));

switch (command) {
  case "index": {
    const store = openStore(flag("rebuild"));
    const taskStates = value("task-states");
    const result = await indexVault(vaultRoot, store, {
      force: flag("rebuild"),
      taskStates: taskStates ? JSON.parse(taskStates) : undefined,
    });
    console.log(
      `indexed ${result.indexed}, unchanged ${result.skipped}, removed ${result.removed} in ${result.ms}ms`,
    );
    store.close();
    break;
  }
  case "query": {
    const store = openStore();
    const what = positional[1] ?? value("source") ?? "task";
    // Phase 3: the CLI walks the contract table rather than keeping its own list.
    // That is what makes it a second consumer worth having — a hand-rolled switch
    // here would let the two clients drift and prove nothing.
    const args = Object.fromEntries([
      ["date", value("date")],
      ["days", value("days") === undefined ? undefined : Number(value("days"))],
      ["project", value("project")],
      ["page", value("page") ?? (what === "backlinks" ? value("to") : undefined)],
      ["person", value("person")], ["from", value("from")], ["to", value("to")],
      ["kind", value("kind")],
    ].filter(([, v]) => v !== undefined)) as ProjectionArgs;
    const rawLimit = value("limit");
    const limit = rawLimit === undefined ? undefined : Number(rawLimit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
      throw new Error(`--limit must be a non-negative integer, got ${rawLimit}`);
    }
    const result = (projectionNames as string[]).includes(what)
      ? runProjection(store, what as any, args)
      : query(store, { source: what, limit: limit ?? 100 }).rows;
    emit(limit !== undefined && Array.isArray(result) ? result.slice(0, limit) : result);
    store.close();
    break;
  }
  case "dump": {
    const store = openStore();
    process.stdout.write(store.dump());
    store.close();
    break;
  }
  default:
    console.log(`lifeloop — semantic core CLI

  lifeloop index  <vault> [--rebuild]     index a vault into .lifeloop/index.sqlite
  lifeloop query  <vault> <what> [--json]
${projectionNames.map((n) => `      ${n.padEnd(12)} ${projections[n].describes}`).join("\n")}
      <tag>        any object tag: task, page, item, relation, header

  contract v${CONTRACT_VERSION}
  lifeloop dump   <vault>                 stable whole-store object dump

  --db <path>   override the store location (":memory:" works)
  --task-states '<json>'  use the same ordered task-state policy as VS Code`);
    process.exit(command ? 1 : 0);
}
