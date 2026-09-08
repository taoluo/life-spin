// Registers the vendor alias resolve hook for plain `node`.
// Usage: node --import ./scripts/register.mjs <entry>
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./loader.mjs", pathToFileURL(import.meta.filename));
