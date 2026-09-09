import { isPromise } from "../../../../vendor/silverbullet/client/space_lua/rp.ts";
import {
  LuaStackFrame, LuaTable, jsToLuaValue as upstreamJsToLuaValue,
} from "../../../../vendor/silverbullet/client/space_lua/runtime.ts";

/** Preserve JavaScript array identity without changing the vendored runtime. */
class JavaScriptArrayTable extends LuaTable {
  override toJS(sf = LuaStackFrame.lostFrame): Record<string, any> | any[] {
    return this.length === 0 ? [] : super.toJS(sf);
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
