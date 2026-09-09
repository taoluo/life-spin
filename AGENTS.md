# Repository agent guidance

## Product boundary

- Reuse VS Code and Foam for ordinary PKM, navigation, search, links, backlinks, graph, templates
  and editor behavior.
- Keep LifeLoop focused on task and relationship semantics, guarded mutations, execution loops and
  external bindings.
- Markdown is the durable source of truth. SQLite indexes and generated previews are disposable and
  rebuildable.
- Route every write through the shared semantic mutation API and preserve `SourceHandle`
  validation. Never infer a mutation target from rendered text.

## Working state and commits

- Inspect tracked and untracked changes before editing. Preserve unrelated and pre-existing work;
  never reset or discard it to make a task easier.
- When commits are authorized, commit after each cohesive, tested milestone instead of accumulating
  an entire multi-phase change. Keep each commit reviewable and exclude unrelated changes.
- Do not commit a known failing or unconverged milestone. Record the relevant verification in the
  handoff or commit message.
- When commits are not yet authorized or appropriate, refresh the durable recovery snapshot after
  every material milestone and before cleanup, handoff, migration or risky reconciliation.
- Never use a temporary directory, conversation history or generated build output as the only copy
  of material work. Do not commit personal vault data, credentials or host-specific test state.

## Implementation and verification

- Prefer deletion and existing helpers, then standard library and host APIs, before adding code or
  dependencies. Do not build a generic platform for one workflow.
- Fix a shared root cause once after tracing all callers. Keep input validation and data-loss guards
  even when a shorter implementation exists.
- Run the smallest meaningful targeted check while iterating, then run `npm run verify` once the
  milestone converges. Run real VS Code, Foam and packaged-extension gates when host behavior or
  packaging changes.
- Report skipped live-host checks separately; a skip is not coverage. Do not modify a personal vault
  or external Apple object during qualification.
