/** Read-only semantic inventory. Does not execute Space Lua or mutate the supplied vault. */
import { indexVault, Store } from "../../packages/semantic-core/src/index.ts";
const root = process.argv[2];
if (!root) throw new Error("Provide an isolated vault path");
const store = new Store();
try {
  const indexed = await indexVault(root, store);
  const tasks = store.objects("task");
  const states: Record<string, number> = {};
  for (const task of tasks) states[String(task.state)] = (states[String(task.state)] ?? 0) + 1;
  const scripts = store.objects("space-lua");
  const dependencies: Record<string, string[]> = {};
  for (const block of scripts) {
    for (const match of String(block.script ?? "").matchAll(/\b(event|mq|service|syntax|taskState|command|widget|actionButton)\.([A-Za-z_]\w*)/g)) {
      const key = `${match[1]}.${match[2]}`;
      dependencies[key] ??= [];
      if (!dependencies[key].includes(String(block.ref).replace(/@\d+$/, ""))) dependencies[key].push(String(block.ref).replace(/@\d+$/, ""));
    }
  }
  console.log(JSON.stringify({ status: "READ_ONLY_INVENTORY_NOT_SCRIPT_EXECUTION", indexed, taskCount: tasks.length, states, scriptBlocks: scripts.length, dependencies }, null, 2));
} finally { store.close(); }
