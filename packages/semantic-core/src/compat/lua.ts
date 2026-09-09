import { isPromise } from "../../../../vendor/silverbullet/client/space_lua/rp.ts";
import {
  LuaEnv, LuaStackFrame, LuaTable, jsToLuaValue as upstreamJsToLuaValue,
} from "../../../../vendor/silverbullet/client/space_lua/runtime.ts";
import {
  ArrayQueryCollection, type LuaCollectionQuery,
} from "../../../../vendor/silverbullet/client/space_lua/query_collection.ts";

/** Preserve JavaScript array identity without changing the vendored runtime. */
class JavaScriptArrayTable extends LuaTable {
  override toJS(sf = LuaStackFrame.lostFrame): Record<string, any> | any[] {
    return this.empty() ? [] : super.toJS(sf);
  }

  async query(query: LuaCollectionQuery, env: LuaEnv, sf: LuaStackFrame, config?: any): Promise<any> {
    const values = Array.from({ length: this.length }, (_, index) => this.rawGet(index + 1));
    return jsToLuaValue(await new ArrayQueryCollection(values).query(query, env, sf, config));
  }
}

export function jsToLuaValue(value: any): any {
  if (isPromise(value)) return value.then(jsToLuaValue);
  if (value instanceof LuaTable || value instanceof Uint8Array || value instanceof ArrayBuffer) return value;
  if (Array.isArray(value) && !("index" in value && "input" in value)) {
    return new JavaScriptArrayTable(value.map(jsToLuaValue));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const converted: Record<string, any> = {};
    for (const key in value) converted[key] = jsToLuaValue(value[key]);
    return upstreamJsToLuaValue(converted);
  }
  return upstreamJsToLuaValue(value);
}
