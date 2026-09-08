import * as path from "node:path";
import Mocha from "mocha";
import { readdirSync } from "node:fs";

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 30_000 });
  const here = path.resolve(__dirname);
  for (const file of readdirSync(here)) {
    if (file.endsWith(".test.js")) mocha.addFile(path.join(here, file));
  }
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures ? reject(new Error(`${failures} test(s) failed`)) : resolve()));
  });
}
