import { parseExpressionString, parseBlock } from "../../../../vendor/silverbullet/client/space_lua/parse.ts";
import { evalExpression, evalStatement } from "../../../../vendor/silverbullet/client/space_lua/eval.ts";
import {
  LuaEnv, LuaStackFrame, LuaBuiltinFunction, LuaTable, luaValueToJS,
} from "../../../../vendor/silverbullet/client/space_lua/runtime.ts";
import { makeLuaBudget, LuaBudgetStopped } from "../../../../vendor/silverbullet/client/space_lua/budget.ts";
import {
  luaToString, luaLen, luaKeys, luaCall, luaTypeName, LuaRuntimeError, LuaMultiRes,
} from "../../../../vendor/silverbullet/client/space_lua/runtime.ts";
import { luaToNumberDetailed } from "../../../../vendor/silverbullet/client/space_lua/tonumber.ts";
import { stringApi } from "../../../../vendor/silverbullet/client/space_lua/stdlib/string.ts";
import { tableApi } from "../../../../vendor/silverbullet/client/space_lua/stdlib/table.ts";
import { mathApi } from "../../../../vendor/silverbullet/client/space_lua/stdlib/math.ts";
import { osApi } from "../../../../vendor/silverbullet/client/space_lua/stdlib/os.ts";
import type { Store } from "../store.ts";
import type { Vault } from "../vault.ts";
import { tasks, backlinks, brokenLinks } from "../query.ts";
import { runProjection, projectionNames, type ProjectionArgs, type ProjectionName } from "../contract.ts";
import { day } from "../projections.ts";
import { jsToLuaValue } from "../compat/lua.ts";
import {
  emptyRegistries, MessageQueue, SUPPORTED_EVENTS,
  type Registries, type SyntaxSpec,
} from "./events.ts";

/**
 * Space Lua, executed.
 *
 * The runtime came along with the parser and needed nothing built. What was
 * missing is this: the host API a script actually calls. It is added one method
 * at a time, and the surface is deliberately smaller than SilverBullet's —
 * `COMPATIBILITY.md` records which of its methods have an equivalent here and
 * which are tied to an editor model we do not have.
 *
 * Two rules shape everything below.
 *
 * **Reading only.** Nothing here writes to the vault. Every mutation in this
 * project goes through the named, verified API (I5), and handing a script in a
 * note the ability to write would be the one exception — the exact thing
 * `DESIGN.md` refuses for AI, for the same reason. A script that wants to change
 * something returns a value and a person applies it.
 *
 * **Bounded.** Every call carries a CPU budget, so a loop in a note cannot hang
 * the editor. That is upstream's `budget.ts`, vendored and used as intended.
 */

export type HostOptions = {
  store: Store;
  vault: Vault;
  /** Shared between passes, so a message sent in one is still there in the next. */
  queue?: MessageQueue;
  /** Wall-clock limit for one script. A note is not allowed to hang the window. */
  budgetMs?: number;
  /** Extra APIs a client can add — the extension supplies `editor.*`. */
  extend?: (env: LuaEnv) => void;
};

export type LuaResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string; stopped?: boolean };

/**
 * Wrap a plain JavaScript function as a Lua builtin.
 *
 * `luaValueToJS` needs the stack frame — it uses it to convert tables and to
 * report where a conversion failed — so the frame is threaded through rather than
 * dropped.
 */
const fn = (impl: (...args: any[]) => unknown) =>
  new LuaBuiltinFunction((sf: any, ...args: any[]) =>
    jsToLuaValue(impl(...args.map((a) => luaValueToJS(a, sf)))),
  );

/**
 * A table that answers any key by computing it.
 *
 * Lua already has the mechanism for this — a metatable with `__index` — and
 * nothing else works. A JavaScript `Proxy` cannot do it: the runtime reads a key
 * by calling the table's own `get()` method, which consults internal storage and
 * never touches the trap. Proxying it either shadowed `get` itself ("obj.get is
 * not a function") or was bypassed entirely ("Collection is nil"). Both failures
 * pointed at the collection rather than at the lookup.
 */
function synthesising(make: (key: string) => unknown): LuaTable {
  const base = new LuaTable();
  const meta = new LuaTable();
  meta.set("__index", new LuaBuiltinFunction((_sf: any, _self: unknown, key: unknown) =>
    typeof key === "string" ? make(key) : null,
  ));
  base.metatable = meta;
  return base;
}

function installGlobals(env: LuaEnv): void {
  const global = (name: string, impl: (sf: any, ...args: any[]) => unknown) =>
    env.set(name, new LuaBuiltinFunction(impl));

  /**
   * Several of these return *more than one* value, and Lua has a type for that.
   * A JavaScript array is a single value: `local ok, err = pcall(f)` bound `ok` to
   * the whole array and left `err` nil, and `for _, v in ipairs(t)` never received
   * an iterator at all. Both failures pointed at the caller rather than at this.
   */
  const many = (...values: unknown[]) => new LuaMultiRes(values);

  global("tostring", (sf, value) => luaToString(value, sf));
  global("tonumber", (_sf, value, base) => {
    const parsed = luaToNumberDetailed(value, base === undefined ? undefined : Number(base));
    // Lua's `tonumber` answers nil for anything it cannot read, rather than raising.
    return parsed && Number.isFinite(parsed.value) ? parsed.value : null;
  });
  global("type", (_sf, value) => luaTypeName(value));
  global("rawlen", (_sf, value) => luaLen(value));
  global("rawget", (_sf, t: any, k) => t?.rawGet?.(k) ?? null);
  global("rawset", (_sf, t: any, k, v) => { t?.rawSet?.(k, v); return t; });
  global("rawequal", (_sf, a, b) => a === b);
  global("getmetatable", (_sf, t: any) => t?.metatable ?? null);
  global("setmetatable", (_sf, t: any, meta: any) => { if (t) t.metatable = meta ?? null; return t; });
  global("select", (_sf, n, ...rest) =>
    n === "#" ? rest.length : many(...rest.slice(Math.max(0, Number(n) - 1))),
  );

  /**
   * `error` throws and `pcall` catches. A script that guards its own failures is
   * a script the caller does not have to.
   */
  global("error", (sf, message) => {
    throw new LuaRuntimeError(typeof message === "string" ? message : String(message), sf);
  });
  global("assert", (sf, value, message) => {
    if (value === false || value === null || value === undefined) {
      throw new LuaRuntimeError(
        typeof message === "string" ? message : "assertion failed!", sf,
      );
    }
    return value;
  });
  global("pcall", async (sf, target, ...args) => {
    try {
      return many(true, await luaCall(target, args, sf.astCtx, sf));
    } catch (error) {
      return many(false, (error as Error).message);
    }
  });
  global("xpcall", async (sf, target, handler, ...args) => {
    try {
      return many(true, await luaCall(target, args, sf.astCtx, sf));
    } catch (error) {
      return many(false, await luaCall(handler, [(error as Error).message], sf.astCtx, sf));
    }
  });

  // Output goes nowhere useful in an editor, so `print` is accepted and discarded
  // rather than left undefined — a script that logs should still run.
  global("print", () => null);

  /**
   * Iteration. `pairs` and `ipairs` return the triple Lua's `for ... in` expects:
   * an iterator, the thing being iterated, and a starting control value.
   */
  const nextFor = (keys: unknown[]) =>
    new LuaBuiltinFunction((sf: any, t: any, control: unknown) => {
      const at = control === null || control === undefined
        ? 0
        : keys.findIndex((k) => k === control) + 1;
      if (at >= keys.length) return null;
      const key = keys[at];
      return many(key, t?.get ? t.get(key, sf) : null);
    });

  global("next", (sf, t: any, control) => {
    const keys = luaKeys(t);
    const at = control === null || control === undefined
      ? 0
      : keys.findIndex((k: unknown) => k === control) + 1;
    if (at >= keys.length) return null;
    return many(keys[at], t?.get ? t.get(keys[at], sf) : null);
  });
  global("pairs", (_sf, t: any) => many(nextFor(luaKeys(t)), t, null));
  global("ipairs", (_sf, t: any) => {
    // `luaLen` can defer to a metamethod and answer later; iteration needs a
    // number now, so a lazy length falls back to the array part.
    const measured = luaLen(t);
    const length = typeof measured === "number" ? measured : (t?.arrayPart?.length ?? 0);
    return many(
      new LuaBuiltinFunction((sf: any, table: any, index: number) => {
        const at = Number(index ?? 0) + 1;
        if (at > length) return null;
        return many(at, table?.rawGet ? table.rawGet(at) : null);
      }),
      t,
      0,
    );
  });
}

function table(entries: Record<string, unknown>): LuaTable {
  const t = new LuaTable();
  for (const [key, value] of Object.entries(entries)) t.set(key, value);
  return t;
}

/**
 * The registries.
 *
 * `tag.define`, `schema.*`, `service.define` and friends are *data* — a script
 * declaring something, not doing something. They are collected rather than acted
 * on, so a client can read what a vault declares without any of it having had a
 * side effect first.
 */
export type Declarations = {
  tags: Record<string, unknown>[];
  services: Record<string, unknown>[];
  identities: Record<string, unknown>[];
  config: Record<string, unknown>;
  /** Custom task states — `[w]`, `[b]` — declared by a vault. */
  taskStates: TaskStateSpec[];
  /** Buttons a vault wants in the UI. A client decides where they go. */
  actionButtons: Record<string, unknown>[];
  /** Commands a vault defines for itself. */
  commands: { name: string; description?: unknown; run: unknown }[];
  /** Event listeners, queue subscriptions and custom syntax. */
  registries: Registries;
};

/**
 * A custom task state.
 *
 * SilverBullet cycles a task through these on click and never reaches done, which
 * is why LifeLoop originally refused them. That is a property of *its* click
 * handler, not of the idea: we write our own, so the cycle can always end at done.
 */
export type TaskStateSpec = {
  name: string;
  /** The character between the brackets. `[w]` is `w`. */
  state: string;
  done?: boolean;
  order?: number;
};

export function buildEnv(options: HostOptions): { env: LuaEnv; declared: Declarations } {
  const { store, vault } = options;
  const env = new LuaEnv();
  const declared: Declarations = {
    tags: [], services: [], identities: [], config: {}, taskStates: [], actionButtons: [],
    commands: [], registries: emptyRegistries(),
  };
  const queue = options.queue ?? new MessageQueue();

  /**
   * Lua's own library, module by module.
   *
   * Real scripts use `string.gsub` and `table.sort` far more than any host API —
   * in SilverBullet's own docs they outnumber host calls three to one. Assembled
   * here rather than through upstream's `stdlib.ts`, because that file also brings
   * `net` (arbitrary fetch) and `js` (arbitrary module import), which are the two
   * capabilities a script in a note should least have.
   */
  /**
   * Lua's global functions.
   *
   * Not the namespaced tables — those are `string.*` and friends — but the bare
   * ones: `tostring`, `pairs`, `type`, `pcall`. Without them almost no real script
   * runs, and the failure names the symbol rather than the omission: the first
   * query on SilverBullet's own front page died with "attempt to call a nil value
   * (global 'tostring')".
   *
   * Written here rather than vendored because upstream's `stdlib.ts` defines these
   * alongside `net` and `js` — arbitrary fetch and arbitrary module import — and
   * taking the file would take those too. Building the list by hand is what keeps
   * them out by construction rather than by intention.
   */
  installGlobals(env);
  env.set("string", stringApi);
  env.set("table", tableApi);
  env.set("math", mathApi);
  env.set("os", osApi);

  /** `index.*` — the object index, read-only. */
  env.set("index", table({
    tasks: fn((filter?: string) => {
      const open = tasks.open(store);
      return filter ? open.filter((t) => (t.itags as string[] | undefined)?.includes(filter)) : open;
    }),
    allTasks: fn(() => tasks.universe(store)),
    actionable: fn(() => tasks.actionable(store)),
    parked: fn(() => tasks.parked(store)),
    pages: fn(() => store.objects("page")),
    links: fn((page: string) => backlinks(store, page)),
    brokenLinks: fn(() => brokenLinks(store)),
    objects: fn((tag: string) => store.objects(String(tag))),
    has: fn((path: string) => vault.exists(String(path))),
  }));

  /**
   * `tags.*` — the entry point every query on SilverBullet's own front page uses.
   *
   *     from t = tags.task where not t.done
   *     from p = tags.page order by p.lastModified desc
   *     from f = tags.feature where f.tag == "page"
   *
   * Not `index.tasks()`. Ours worked and theirs did not, which meant a vault's
   * existing queries all failed — the difference between "SLIQ runs" and "a
   * SilverBullet vault's queries run".
   *
   * A name matches on `itags`, not on `tag`: a page with `tags: feature` in its
   * frontmatter is indexed as a `page` whose itags include `feature`, and
   * `tags.feature` has to find it. That is exactly what the third query above
   * relies on — it selects from `tags.feature` and then narrows to pages.
   */
  env.set("tags", synthesising((name) =>
    jsToLuaValue(
      store.objects().filter(
        (o) => o.tag === name || (o.itags as string[] | undefined)?.includes(name),
      ),
    ),
  ));

  /** `space.*` — pages, read-only. */
  env.set("space", table({
    readPage: fn((name: string) => {
      const path = `${name}.md`;
      if (!vault.exists(path)) throw new Error(`no such page: ${name}`);
      return vault.read(path);
    }),
    pageExists: fn((name: string) => vault.exists(`${name}.md`)),
    listPages: fn(() => vault.list().filter((p) => p.endsWith(".md")).map((p) => p.slice(0, -3))),
    // Deliberately absent: writePage, deletePage. See the note at the top.
  }));

  /** `lifeloop.*` — our own projections, which is what a query block wants. */
  env.set("lifeloop", table({
    ...Object.fromEntries(
      projectionNames.map((name) => [
        name,
        fn((args?: Record<string, unknown>) => {
          const { limit, ...explicit } = args ?? {};
          if (limit !== undefined && (!Number.isInteger(limit as number) || (limit as number) < 0)) {
            throw new Error(`limit must be a non-negative integer, got ${String(limit)}`);
          }
          const result = runProjection(store, name as ProjectionName, explicit as ProjectionArgs);
          return limit !== undefined && Array.isArray(result) ? result.slice(0, limit as number) : result;
        }),
      ]),
    ),
    today: fn((args?: Record<string, unknown>) =>
      runProjection(store, "today", { date: (args?.date as string) ?? day() }),
    ),
    day: fn(() => day()),
  }));

  /** `config.*` — read what a vault declares, and let a script declare more. */
  env.set("config", table({
    get: fn((key: string, fallback?: unknown) => declared.config[String(key)] ?? fallback ?? null),
    set: fn((key: string, value: unknown) => {
      declared.config[String(key)] = value;
      return null;
    }),
  }));

  /** Declarations, collected rather than executed. */
  env.set("tag", table({ define: fn((spec: unknown) => { declared.tags.push(spec as any); return null; }) }));
  env.set("service", table({
    define: fn((spec: unknown) => { declared.services.push(spec as any); return null; }),
  }));
  env.set("identity", table({
    define: fn((spec: unknown) => { declared.identities.push(spec as any); return null; }),
  }));

  /**
   * `taskState.define` — a vault declaring its own task states.
   *
   * Collected, not applied: the state set is data, and what a click does with it
   * is the client's decision.
   */
  env.set("taskState", table({
    define: fn((spec: any) => {
      const name = String(spec?.name ?? "").trim();
      if (!name) throw new Error("taskState.define needs a name");
      declared.taskStates.push({
        name,
        state: String(spec?.state ?? name),
        done: spec?.done === true,
        order: typeof spec?.order === "number" ? spec.order : undefined,
      });
      return null;
    }),
  }));

  env.set("actionButton", table({
    define: fn((spec: unknown) => { declared.actionButtons.push(spec as any); return null; }),
  }));

  /** Commands are collected as data; VS Code exposes them through its native picker. */
  env.set("command", table({
    define: fn((spec: any) => {
      const name = String(spec?.name ?? "").trim();
      if (!name) throw new Error("command.define needs a name");
      declared.commands.push({ name, description: spec?.description, run: spec?.run });
      return null;
    }),
  }));

  /**
   * `embed.*` — a link turned into something a page can show.
   *
   * A widget rather than raw HTML, so the same escaping and closed tag set apply.
   * Only providers we can render are answered; anything else says so rather than
   * producing a broken frame.
   */
  env.set("embed", table({
    youtube: fn((url: string) => {
      const id = /(?:v=|youtu\.be\/|embed\/)([\w-]{6,})/.exec(String(url))?.[1];
      return id
        ? { __widget: "embed.youtube", children: [id] }
        : { __widget: "markdown", children: [`[${url}](${url})`] };
    }),
    url: fn((url: string) => ({ __widget: "markdown", children: [`[${url}](${url})`] })),
  }));

  /**
   * `widget.*` and `dom.*` — content, not placement.
   *
   * SilverBullet puts the result inside the editor, which VS Code cannot do. The
   * *content* is what our query blocks already render, so these return a tagged
   * value and a client shows it in the preview, a hover or a panel. Building HTML
   * as data also means a script cannot reach the DOM, because there is none.
   */
  const widgetValue = (kind: string) =>
    fn((...args: unknown[]) => ({ __widget: kind, children: args }));
  env.set("widget", table({
    html: widgetValue("html"),
    htmlBlock: widgetValue("htmlBlock"),
    markdown: widgetValue("markdown"),
    new: widgetValue("widget"),
    refreshAll: fn(() => null),
  }));
  env.set("dom", synthesising((tag) => widgetValue(`dom.${tag}`)));

  /**
   * `js.import` is refused by name rather than left undefined.
   *
   * Importing arbitrary JavaScript from a note defeats every boundary above it.
   * "Not implemented" is a much better answer than `attempt to index a nil value`,
   * which is what a missing global gives you and which points nowhere.
   */
  env.set("js", table({
    import: fn(() => {
      throw new Error(
        "js.import is not available: a script in a note may not load arbitrary JavaScript",
      );
    }),
  }));

  /**
   * `event.listen` — declared, and fired only for events we actually have.
   *
   * SilverBullet's event names are kept rather than renamed, so a vault's scripts
   * do not need editing. A listener for something we do not raise is accepted and
   * simply never called: the listener exists, the event does not, and saying that
   * plainly beats either silently dropping it or pretending to support it.
   */
  env.set("event", table({
    listen: fn((spec: any) => {
      const name = String(spec?.name ?? spec?.event ?? "");
      if (!name) throw new Error("event.listen needs a name");
      declared.registries.events.push({ name, run: spec?.run });
      return null;
    }),
    dispatch: fn((name: string) => {
      // Accepted so a script can be written naturally; a client decides whether
      // anything listens.
      return SUPPORTED_EVENTS.has(String(name));
    }),
  }));

  /**
   * `mq.*` — a small in-memory queue.
   *
   * Deferring work, not storing it. Everything a script can do is read-only, so a
   * message lost on restart cannot lose anything a person would miss.
   */
  env.set("mq", table({
    send: fn((name: string, body: unknown) => { queue.send(String(name), body); return null; }),
    batchSend: fn((name: string, bodies: unknown[]) => {
      for (const body of bodies ?? []) queue.send(String(name), body);
      return null;
    }),
    subscribe: fn((spec: any) => {
      const name = String(spec?.queue ?? "");
      if (!name) throw new Error("mq.subscribe needs a queue");
      declared.registries.queues.push({
        queue: name,
        batchSize: Number(spec?.batchSize ?? 1),
        run: spec?.run,
      });
      return null;
    }),
    depth: fn((name: string) => queue.depth(String(name))),
  }));

  /**
   * `syntax.define` — one declaration, two halves.
   *
   * SilverBullet highlights the span *and* renders it inline. VS Code splits
   * those: highlighting is semantic tokens at runtime, rendering is the Markdown
   * preview. Both come from this, so a vault writes it once.
   */
  env.set("syntax", table({
    define: fn((spec: any) => {
      const name = String(spec?.name ?? "");
      if (!name) throw new Error("syntax.define needs a name");
      declared.registries.syntax.push({
        name,
        startMarker: String(spec?.startMarker ?? ""),
        endMarker: String(spec?.endMarker ?? spec?.startMarker ?? ""),
        mode: spec?.mode === "block" ? "block" : "inline",
        render: spec?.renderHtml ?? spec?.renderWidget,
      } as SyntaxSpec);
      return null;
    }),
  }));

  /** `schema.*` — pure constructors, no host involvement at all. */
  env.set("schema", table({
    array: fn((of: unknown) => ({ type: "array", items: of })),
    object: fn((props: unknown) => ({ type: "object", properties: props })),
    string: fn(() => ({ type: "string" })),
    number: fn(() => ({ type: "number" })),
    boolean: fn(() => ({ type: "boolean" })),
    null: fn(() => ({ type: "null" })),
  }));

  options.extend?.(env);
  return { env, declared };
}

/**
 * A stack frame carrying a CPU budget.
 *
 * The budget lives on `threadState`, which is the **fifth constructor argument** —
 * not a property to assign afterwards. Setting `sf.budget` compiles, does nothing,
 * and leaves an infinite loop in a note running forever. That is exactly what
 * happened here: the limit was decorative until a runaway-loop test hung the suite
 * and said so.
 */
function boundedFrame(env: LuaEnv, budgetMs: number): LuaStackFrame {
  /**
   * `budgetTick` yields and reports; it only *throws* once `stopped` is set, and
   * upstream sets that when a person clicks Stop. There is nobody to click here,
   * so `onLimit` closes the loop: the limit is reached, the budget stops itself,
   * and the next tick raises.
   *
   * Without this the limit is decorative — which it was, until a runaway-loop test
   * hung the whole suite and said so.
   */
  const budget = makeLuaBudget({
    busyLimitMs: budgetMs,
    yieldAfterMs: Math.min(50, budgetMs),
    onLimit: (b) => { b.stopped = true; },
  });
  return new LuaStackFrame(env, null, undefined, undefined, {
    closeStack: undefined,
    budget,
  } as any);
}

/**
 * Evaluate one expression or block.
 *
 * Never throws. A script in a note is content, and content that can take down the
 * editor is a much worse problem than a script that does not run.
 */
export async function runLua(
  source: string,
  options: HostOptions,
  mode: "expression" | "block" = "expression",
  /**
   * A space to evaluate in, so definitions made elsewhere are visible.
   *
   * SilverBullet has one environment per space: a block defines
   * `templates.featureItem`, and a query on another page calls it. Evaluating
   * every snippet in a fresh environment made that impossible — which is why the
   * `select templates.featureItem(f)` on their own front page could never have
   * worked here, however well the query itself ran.
   */
  space?: LuaEnv,
): Promise<LuaResult> {
  const env = space ?? buildEnv(options).env;
  const sf = boundedFrame(env, options.budgetMs ?? 2000);

  try {
    if (mode === "expression") {
      const expression = parseExpressionString(source);
      const value = await evalExpression(expression, env, sf);
      if (expression.type === "Query" && value instanceof LuaTable && value.empty()) {
        return { ok: true, value: [] };
      }
      return { ok: true, value: await luaValueToJS(value, sf) };
    }

    /**
     * A block's `return` arrives as a control signal, not a value.
     *
     * `evalStatement` answers with `{ ctrl: "return", values: [...] }` — and
     * handing that straight back meant a block returning a widget produced an
     * object whose `__widget` was buried one level down, so nothing ever
     * rendered. The signal is unwrapped, and only then converted: `luaValueToJS`
     * on the wrapper leaves the Lua table inside it untouched.
     */
    const signal = await evalStatement(parseBlock(source), env, sf, true);
    const returned = (signal as any)?.ctrl === "return" ? (signal as any).values : undefined;
    if (returned === undefined) return { ok: true, value: undefined };
    const values = await Promise.all(returned.map((v: unknown) => luaValueToJS(v, sf)));
    return { ok: true, value: values.length <= 1 ? values[0] : values };
  } catch (error) {
    if (error instanceof LuaBudgetStopped) {
      return {
        ok: false,
        stopped: true,
        error: `script exceeded its time limit (${options.budgetMs ?? 2000}ms) and was stopped`,
      };
    }
    return { ok: false, error: (error as Error).message };
  }
}

export type Collected = {
  declared: Declarations;
  /** The environment every block ran in, so later evaluation can see their definitions. */
  space: LuaEnv;
  errors: { script: string; error: string }[];
  /**
   * Call a function a declaration handed us — an action button's `run`, say.
   *
   * A `LuaFunction` closes over the environment it was defined in, so the caller
   * cannot invoke one after `collectDeclarations` returns unless that environment
   * is kept alive. It is, here, behind a call that carries its own fresh budget:
   * a button pressed a hundred times gets a hundred separate time limits rather
   * than slowly exhausting one.
   */
  call(target: unknown, ...args: unknown[]): Promise<LuaResult>;
};

/** Run a script only for what it declares, ignoring any value it returns. */
export async function collectDeclarations(
  scripts: string[],
  options: HostOptions,
): Promise<Collected> {
  const errors: { script: string; error: string }[] = [];
  const { env, declared } = buildEnv(options);

  for (const script of scripts) {
    const sf = boundedFrame(env, options.budgetMs ?? 2000);
    try {
      await evalStatement(parseBlock(script), env, sf);
    } catch (error) {
      errors.push({ script: script.slice(0, 60), error: (error as Error).message });
    }
  }

  const call = async (target: unknown, ...args: unknown[]): Promise<LuaResult> => {
    if (!target || typeof (target as any).call !== "function") {
      return { ok: false, error: "not a callable Lua value" };
    }
    const sf = boundedFrame(env, options.budgetMs ?? 2000);
    try {
      const value = await (target as any).call(sf, ...args.map((a) => jsToLuaValue(a)));
      return { ok: true, value: await luaValueToJS(value, sf) };
    } catch (error) {
      if (error instanceof LuaBudgetStopped) {
        return { ok: false, stopped: true, error: "the script exceeded its time limit" };
      }
      return { ok: false, error: (error as Error).message };
    }
  };

  return { declared, errors, call, space: env };
}
