# Language Feature Evaluation and Roadmap

This document is the language-feature companion to
[`LifeLoop_Action_Loop_UX_Consolidated_Addendum_v2.md`](./LifeLoop_Action_Loop_UX_Consolidated_Addendum_v2.md).
The v2 plan defines product scope, action-loop priorities and qualification boundaries. This file
defines how VS Code language providers may support those goals. It is a candidate roadmap, not a
commitment to implement every VS Code language API.

The 2026-09-12 delivery scope was deliberately small:

1. implement narrow managed-field completion — completed in the working tree;
2. compare native Expand/Shrink Selection in task-only VS Code and VS Code + Foam — completed with
   a host-satisfied decision and no LifeLoop provider.

The product test remains: make existing LifeLoop semantics easier to write correctly or select
correctly. API coverage is not a product goal.

## Ownership and safety

- Reuse semantic-core parsers, date helpers and named mutations.
- A provider projects editor UX. It does not become mutation authority.
- Completion is ordinary text editing. It does not complete/reopen a task, stamp history or touch an
  external object.
- Lazy `provide`/`resolve` callbacks may compute presentation details but never perform business
  writes or external effects.
- Ordinary Markdown, Wiki links, paths, pages, headings, backlinks, rename and navigation remain
  owned by VS Code/Foam.
- Provider hot paths do not reindex the vault, invoke a bridge, access the network or call AI.
- A displayed snapshot never authorizes a later mutation. Named actions still revalidate their
  `SourceHandle`, dirty buffer and current semantic prerequisites.

## Current status on the working tree based on `0febfe2`

Implementation status and validation evidence are separate. `Done` means the named implementation
gap is closed; it does not claim every host, performance or coexistence profile has passed.

| Capability | Status | Current implementation | Evidence or remaining qualification |
|---|---|---|---|
| Code Action hot path | Done | Candidate generation uses live text/index state without eager reindex; commands retain fresh validation | Unit regression covers no-reindex provider path; retain real-host latency checks |
| Current-document diagnostics | Done | Editing republishes lexical diagnostics for the changed document; settled index refreshes global results | Unit regression covers current-document update; deletion/dependency and host logs remain separate evidence |
| Lazy CodeLens/completion resolution | Measure first | Existing detail reads current text or SQLite projections; no demonstrated bottleneck | Measure before refactoring; no work in this milestone without evidence |
| Capture Selection with Source | Existing | Captures selected text, source/range and dirty-snapshot status to the configured Inbox while preserving focus | Existing unit and VS Code integration coverage |
| Query completion, Hover, CodeLens and diagnostics | Existing | Existing relationship/query language surfaces | Do not rebuild or expand except for a demonstrated gap |
| Mention references | Existing | `@mention` completion, links and ReferenceProvider already exist | This milestone does not broaden reference semantics |
| Document Symbols | Existing | Current provider exposes task and Interaction symbols | Do not remove, add new symbol kinds or expand its scope in this milestone |
| Binding Hover | Existing | Reminder/Calendar bindings already expose their supported actions | Do not add binding DocumentLinks in this milestone |
| Find Task | Existing | Dedicated indexed task search opens existing Task Actions | Do not duplicate it through Workspace Symbols now |
| Managed-field completion | Done; current widget K0 incomplete | Completes `scheduled`/`deadline` names and Today/Tomorrow absolute date values from the current document only | Targeted and overall checks pass. Current GUI-launched task-only/Foam hosts load the build, but this pass did not complete suggestion-widget accept/cancel. Operating-system Simplified Pinyin composition has been exercised in a native planning QuickPick; that does not qualify the editor suggestion widget |
| Semantic Selection Range | Host-satisfied | No LifeLoop provider added | Native task-only and Foam chains were identical and already covered attributes, task items, nested subtrees, continuation text and multiple cursors |
| Paste with Source at current cursor | Roadmap, overlap | Capture Selection covers capture-to-Inbox, not insertion at the current cursor | Validate an actual in-place paste workflow before implementing |
| Signature Help | Deferred | Query DSL is line-oriented `key: value` | Prefer completion documentation, Hover and snippets |
| Inlay Hints | Deferred | Existing Hover/Why surfaces explain derived state | Consider inherited-only hints, default off, after evidence of repeated friction |
| Semantic project/person references | Deferred | Mentions references and task/person projections already cover current workflows | Add only if native Shift+F12 is a demonstrated high-frequency need |
| Workspace Symbols | Deferred | Find Task already owns task retrieval | Avoid polluting code symbol search |
| Document Drop | Roadmap | Native file/Markdown handling remains available | Require frequent supporting-file drops and a keyboard-equivalent workflow |
| Opaque binding links | Roadmap | Binding Hover already provides Open/Detach/Copy ID | Require reliable object-level navigation before adding links |
| Explicit inline AI | Roadmap | No current language provider | Requires explicit invocation, privacy scope and Copilot coexistence evidence |

## Slice A — narrow managed-field completion

### First release scope

The first release completes only user-authored task scheduling fields:

- field names: `scheduled`, `deadline`;
- values: absolute local-calendar dates for Today and Tomorrow.

These are stable fields users routinely type and can safely edit as plain text. Binding IDs
(`reminder`, `event`) are produced by guarded external workflows, while `completed` is written by
Complete/Reopen history semantics. They are not offered as manual field completions. Interaction
and page metadata use different contexts and are outside this slice.

Configured task-state completion is a separate decision. Task states affect completion stamps,
index interpretation, observations and external synchronization. This slice neither suggests nor
changes a task marker.

### Context recognition

Completion operates on the current document snapshot, including dirty buffers and incomplete
syntax such as:

```markdown
- [ ] Review results [sche
```

It uses the existing Markdown/task parser for established structure and a bounded recognizer only
for the unfinished attribute fragment the parser cannot yet represent. It does not create a second
document parser.

Candidates appear only when all applicable conditions hold:

- the cursor is on a recognized task/list-item source line;
- the unfinished fragment is after the task marker and begins with `[`;
- the cursor is outside fenced/inline code and comments;
- the fragment cannot be a Wiki link or ordinary Markdown link;
- the field name or value context is unambiguous.

Field completion replaces exactly the typed unfinished name. It does not replace surrounding task
text. A field already present elsewhere on the same task is not offered again. Duplicate or
ambiguous existing fields suppress assistance instead of guessing.

Date completion is offered only inside the value of exactly one `scheduled` or `deadline`
attribute. It replaces the current value token while preserving or producing the canonical quoted
form:

```markdown
[scheduled: "2026-09-13"]
```

The provider computes one local `today` value per request and derives Tomorrow with semantic-core's
calendar-day helper. Labels show the same absolute date that acceptance inserts. A request crossing
midnight therefore cannot display one date and insert another.

No candidate executes a command, indexes the vault, saves the document, updates history or invokes
external synchronization.

### Slice A verification

Targeted tests cover:

- incomplete field names, manual invocation and replacement ranges;
- incomplete, quoted and existing date values;
- Today/Tomorrow absolute labels and inserted ISO dates from one captured local day;
- midnight/date-boundary behavior through an injected request date;
- dirty buffers, CRLF and Chinese task text;
- duplicate fields and malformed/ambiguous fragments;
- suppression in prose, Wiki links, Markdown links, fenced/inline code and comments;
- no task-state, binding or completion-history suggestions;
- no reindex, bridge or external side effect from provider requests.

Real-host qualification covers keyboard accept/cancel, IME behavior and candidate coexistence in
task-only VS Code and VS Code + Foam. Provider logs are evidence; a passing unit suite does not erase
host errors.

### Slice A outcome

The working-tree implementation reuses `TASK_DATE_FIELDS`, the existing Markdown/task parser and
semantic-core calendar-day shifting. A bounded recognizer handles only the unfinished attribute
fragment. It does not index, save, mutate or call an external bridge.

Verification at this revision:

- managed language tests: 39 passed;
- `npm run verify`: 65 test files, 904 passed and 3 live-SilverBullet checks skipped;
- last successful isolated VS Code 1.136.1 task-only gate: 27 passed;
- last successful isolated VS Code 1.136.1 with Foam 0.44.6: 34 passed and the existing folder-rename check pending;
- latest background integration runner: blocked before extension/test loading by AppKit `_RegisterApplication` `SIGABRT`, with no LifeLoop stack in the crash report;
- current GUI-launched task-only and Foam 0.44.6 Extension Development Hosts: build activation and zero-Problems smoke passed, but completion-widget accept/cancel was not completed;
- task-only macOS Simplified Pinyin evidence: per-key `mingtian` composed as `ming tian`, Space accepted `明天`, and rapid Return/Escape in the native planning QuickPick caused no mutation. This proves the operating-system IME path is controllable, not that managed-field completion is qualified.

The host tests exercise actual registered completion providers, replacement ranges and inserted
absolute text. They include Chinese task text but do not simulate an operating-system IME or the
suggestion widget's literal accept/cancel keystrokes; those remain manual K0 evidence rather than a
claim inferred from command-level tests. The Pre-meeting Brief now uses the read-only
`lifeloop-result:` path and passed the current Foam gate, so the previous generated `untitled:`
Brief limitation no longer applies to this evidence.

### Manual K0 boundary

Computer Use can exercise a real VS Code suggestion widget, literal Enter/Escape keys, focus and
operating-system IME composition when characters are sent as individual key events. Direct Unicode
injection still does not prove candidate-window behavior. On 2026-09-12 it also exposed an evidence mismatch: the ordinary VS Code window had the
2026-09-08 installed extension, while the current working-tree Extension Development Hosts were
isolated processes that the available UI controller could not select. No result from that older
window is counted as current-build completion evidence. Finish K0 against the current build in both
task-only and Foam profiles. The current planning QuickPick IME pass cannot be reused as evidence for
the managed-field suggestion widget; that widget still needs its own accept/cancel and coexistence run.

The 2026-09-13 background retry still aborted in AppKit before extension or test loading. After the
Mac was unlocked, Computer Use reached GUI-launched task-only and Foam Extension Development Hosts
and verified current-build activation. That bypass does not turn the aborted runner into a pass.
The later task-only planning QuickPick run proved true Simplified Pinyin composition, but the
managed-field suggestion widget remains an explicit gap.

## Slice B — Semantic Selection Range comparison

### Compare before adding a provider

First record native Expand/Shrink Selection behavior in both supported profiles:

1. task-only VS Code;
2. VS Code + Foam.

Use representative tasks containing attributes, nested lists, multiline continuation text,
Chinese text, CRLF, dirty buffers and multiple cursors. Record whether native selection already
covers the useful steps and whether Foam changes them.

The spike succeeds when it reaches an evidence-backed decision. It does not have to produce code.
Stop without a provider when native behavior is sufficient or an added range creates extra
low-value keystrokes.

### Slice B outcome — host-satisfied, no provider

The comparison used the real `vscode.executeSelectionRangeProvider` command in VS Code 1.136.1,
first without Foam and then with Foam 0.44.6. One dirty CRLF document contained Chinese text, a
managed date attribute, continuation text, a nested task and an adjacent task. Five cursor positions
were requested together, covering the date, attribute name, task wording, continuation and child
task.

Both profiles returned the same useful chain: token or date fragment, whole attribute where
applicable, whole task line, parent task with continuation and child task, surrounding list, then
document. Native Markdown therefore already supplies the high-value selection behavior and handles
dirty text, CRLF, Unicode, nesting and multiple cursors. Its first range inside an ISO date selects
the year token rather than the whole date; the next range selects the complete attribute. That small
difference does not justify another provider or another expansion layer. The temporary measurement
probe was removed after recording this result.

### Minimum provider contract if a real gap remains

Add only ranges the native Markdown behavior lacks. Every parent must contain its child. Candidate
chains depend on cursor position, for example:

```text
date value → whole attribute → whole task item → nested list subtree
task wording → whole task item → nested list subtree
```

A task-body range that excludes metadata cannot be the parent of an attribute range. Missing,
identical or duplicate levels are omitted. The provider does not recreate Markdown headings or
general document hierarchy and reads only the current document.

Provider verification, if implemented, covers containment, Expand/Shrink behavior, nesting,
continuation lines, Unicode, CRLF, dirty buffers, multiple cursors and adjacent unrelated content.
This is a read-only provider; task mutation, TreeView target conflicts and external-sync gates do not
apply.

## Paste with Source roadmap boundary

Capture Selection and Paste with Source overlap but have different destinations:

- Capture writes a snapshot to the configured capture target.
- Paste with Source inserts text and provenance at the current editor position.

The latter remains `Roadmap, overlap` until real use shows that ordinary paste plus Capture Selection
is insufficient. `prepareDocumentPaste` metadata is limited to the current VS Code editor window and
is not a general cross-window or cross-application transport. Future work must first compare a plain
text `body + source` representation with semantic clipboard metadata.

`page@offset` is provenance at capture time, not permanent identity. `$anchor` still requires the
existing uniqueness, page-resolution, rename and deletion checks. Copy/paste must never create an
anchor silently. When a durable task reference cannot be proven, it falls back to copied contents or
page-level provenance.

## Explicitly unchanged boundaries

- Do not add or expand current Document Symbols.
- Do not add Rename, Formatting, On-Type Formatting, custom Folding, Semantic Tokens, Linked Editing,
  Call Hierarchy or Type Hierarchy providers.
- Do not use completion to normalize source, infer business meaning or run semantic actions.
- Do not build a shared language-service framework, generic cache, task query builder or second
  Markdown parser for these two slices.

## Delivery and evidence

Each slice reports:

1. the actual user friction and code delta;
2. reused parser/date/provider mechanisms;
3. targeted, overall and applicable real-host results;
4. SKIP/PENDING items, provider logs and unproven claims;
5. the reason to continue or stop.

The prior 3-file/71-test run remains baseline evidence only. The outcome evidence above qualifies
the implemented completion and native Selection comparison at the named host versions; it does not
qualify operating-system IME interaction, unrelated provider latency or future host versions.

No roadmap entry becomes authorized implementation merely by appearing in this document.
