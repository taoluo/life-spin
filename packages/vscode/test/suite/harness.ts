// A LifeLoop opened against the test workspace, for assertions that need the
// vault and store rather than the running extension's private instance.
export { LifeLoop as LifeLoopForTest } from "../../src/workspace.ts";
