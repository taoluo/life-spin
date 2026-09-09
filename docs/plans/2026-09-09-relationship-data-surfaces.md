# Relationship data surfaces

Status: implemented and qualified on `vscode-implementation`.

This design selects the useful, low-cost parts of
[`silverbullet/docs/Concepts/all-in-one-design.md`](../../silverbullet/docs/Concepts/all-in-one-design.md)
without turning LifeLoop into a second Notion, SilverBullet runtime, CRM database or PKM host.
It builds on the implemented Personal Relationship Loop: Person pages, explicit Journal
interactions, reconnect signals, follow-up tasks and Person Context.

## Decision

Markdown remains the only durable source of truth. LifeLoop may index Markdown into SQLite,
transform indexed objects and render tables, but the index remains disposable. Deleting
`.lifeloop/index.sqlite` and rebuilding it must recover every Person, Interaction and follow-up
fact.

The completed pass contains four features, ordered by user-workflow value:

1. Logging an Interaction from a task that directly identifies Person pages.
2. Named relationship projections for reusable tables and transformations.
3. Birthday resurfacing in the existing Today → People section.
4. A restricted Pre-meeting Brief for Calendar-bound tasks with explicit Person links.

The pass adds no generic database editor, schema builder, Dashboard, graph, chart engine,
semantic search service, AI classifier or event-sourcing subsystem.

## Ownership

| Concern | Owner | Boundary |
|---|---|---|
| Person pages and arbitrary page properties | Foam / Markdown | Ordinary navigation, editing, links, backlinks, tags and Smart Folders stay upstream-owned. |
| Search and file browsing | VS Code / Foam | LifeLoop does not add Library, Quick Open, Explorer or full-text search. |
| Interaction semantics | LifeLoop | Only an explicit `[interaction: kind]` item on a trustworthy Journal date counts as contact. |
| Last contact and reconnect timing | LifeLoop projection | Derived from Interaction and `contact-every`; never written back as cached metadata. |
| Follow-up work | Existing LifeLoop Task | No CRM-specific task store or scheduler. |
| Meeting time, location and recurrence | Calendar | LifeLoop reads a bound event; it does not copy Calendar-owned fields into Person pages. |
| Query table rendering | Existing LifeLoop preview | The same rows appear through preview, hover and baking. |
| General page tables | Foam Query / Smart Folder | LifeLoop only adds relationship semantics that Foam cannot derive safely. |

## All-in-one capability disposition

The source design combines a backend kernel, user-facing surfaces and future vertical products.
They do not all imply new LifeLoop code. Each item below has an explicit implementation
disposition so “already present” and “worth building next” are not confused.

| Source-design capability | Current coverage | Implementation disposition |
|---|---|---|
| Object | SB-compatible indexing already extracts pages, tasks, items, relations and Interaction items from Markdown. | **Reuse unchanged.** Do not add a canonical `objects` database. |
| Type | `page`, `task` and `item` are structural types; `project`, `person` and `journal` are semantic tags. | **Reuse unchanged.** Fixed semantic types remain clearer than a custom Type builder. |
| Relation | Direct `links`, inherited `ilinks`, Linked Tasks and exact page identities already connect tasks, projects and People. | **Reuse with distinct roles.** Direct links select action targets and meeting participants; inherited links provide read-only context and aggregation. No new relation table is durable. |
| Time | Tasks have `deadline`, `scheduled` and `completed`; Journal supplies Interaction dates; Calendar owns event intervals. | **Extend narrowly.** Add birthday parsing and resurfacing. Do not introduce a universal time schema. |
| Event / History | Completion stamps, explicit Interactions, frozen Reviews and external-sync baselines preserve domain-specific history. | **Keep domain-specific.** Do not add a generic append-only event log until a concrete query cannot be reconstructed from existing facts. |
| Query / View | Named projections, typed core queries, SLIQ/Lua transformations, preview tables, hover and baking already exist. | **Implement now.** Add normalized relationship projections and examples; do not create another query DSL. |
| Note | A Markdown page is the note. Foam owns note metadata, aliases, navigation and backlinks. | **Host-owned.** No LifeLoop Note model or editor. |
| Task | Extraction, inherited context, states, guarded SourceHandle mutations, completion and external bindings are implemented. | **Reuse unchanged.** Relationship follow-ups remain ordinary tasks. |
| Project | Project status, actionable gaps, waiting signals and linked tasks are implemented. | **Reuse unchanged.** Do not add portfolio, milestone or health-score models. |
| Person | Person pages, explicit Interaction, last contact, reconnect, follow-up and Person Context are implemented. | **Extend now.** Add table projections, birthday and task-originated Interaction logging. |
| Capture / Inbox | Capture, Capture Here, continuous processing and full-body Notes import are implemented. | **Reuse.** Task-originated Interaction logging is a contextual capture path, not a new Inbox. |
| Inbox classification / conversion | Processing can turn captured text into a task, attach project context, archive it or keep it; it does not promote arbitrary text into every object type. | **Discuss one narrow addition.** Explicit `Create Person from Inbox` is useful when Notes is a people-capture source. Do not infer a Person, date or relation automatically. Project/page creation remains Foam/manual metadata until repeated use proves otherwise. |
| Today | Overdue, due, scheduled, waiting, upcoming and reconnect signals share one derived surface. | **Extend now.** Birthday joins the existing collapsed People section. |
| Today notes / Calendar agenda | Daily Notes remain available through Foam and Today already shows task time plus bound Calendar context; it does not mirror every external event or arbitrary note. | **Gate on workflow evidence.** Add a read-only agenda only if switching to Calendar repeatedly interrupts the action loop. Keep general notes in the Daily Note. |
| Search / Library | VS Code Search, Quick Open and Explorer plus Foam tags, Connections, graph and Smart Folders cover retrieval. | **No LifeLoop implementation.** Add semantic projections only where host search cannot explain task/relationship meaning. |
| Object Detail | A Markdown page plus Foam navigation, Linked Tasks and Person Context compose the relevant detail. | **Do not add a generic detail screen.** Add a domain panel only when it needs LifeLoop-derived semantics or a guarded mutation. |
| Daily Note / Journal | Foam creates and navigates Daily Notes; LifeLoop recognizes trustworthy Journal dates and appends explicit Interactions. | **Reuse boundary.** No separate Journal object store or calendar. |
| Review | Weekly Review, frozen Markdown and baking are implemented. | **Reuse.** Relationship tables may be embedded or baked; no CRM review framework. |
| Reminders | Creation, binding, completion reconciliation, sync reporting and centralized conflict resolution are implemented. | **Reuse.** Relationship follow-ups may use existing task-to-Reminder actions. |
| Calendar | Task/event creation, binding, summary sync, verification, conflict resolution, time/location reads and compensation exist. | **Extend read-only UX.** Restricted Pre-meeting Brief uses the current binding; broader attendee mapping waits for a stable identity contract. |
| Notes bridge | Full-body import and pending-note synchronization are implemented with conflict preservation. | **Reuse unchanged.** Do not treat every imported mention as an Interaction. |
| Basic table output | Arrays of objects render through preview and hover; baking produces portable Markdown. | **Implement data access, not a renderer.** Relationship projections feed the existing table path. |
| Transformation | SLIQ supports filtering, selection, ordering, grouping and aggregation; bounded Lua can reshape results. | **Document and reuse.** Do not add DataviewJS-style arbitrary DOM or file writes. |
| Saved page views | Foam Query and Smart Folders cover page-level organization. | **Host-owned.** No return of LifeLoop's retired generic saved-view/Dashboard system. |
| Attachments and templates | VS Code/Foam and installed Markdown extensions own files, pasted assets and ordinary page templates. | **Host-owned.** LifeLoop keeps only Review generation/baking that depends on its semantics. |
| Archive | Inbox processing and Project/task states already have workflow-specific terminal meanings. | **Keep domain-specific.** Do not add universal `archived_at` or an archive database without a concrete restore workflow. |
| `created_at` / `updated_at` | Git and file metadata can help inspection but are not reliable durable Markdown facts, and task completion already has explicit time semantics. | **Do not synthesize into the data model.** Add explicit domain timestamps only when the user action needs them. |
| Chart | No generic chart renderer exists. | **Gate for later.** Require a stable, repeatedly used numeric table before adding a restricted bar/line display. |
| Goal | Projects and optional outcome text cover the current workflow. | **Defer.** Add a Goal type only after it gains semantics that Project cannot express. |
| Habit / recurrence | Reminders owns notifications and recurrence; LifeLoop does not have reliable occurrence history. | **Defer.** A Habit model requires explicit occurrence semantics and evidence of use. |
| Semantic search | No LifeLoop embeddings index exists. | **Defer.** Measure failure of VS Code/Foam retrieval before adding another index. |
| AI classification | No automatic title/date/person mutation is admitted. | **Defer.** Future AI may suggest a guarded semantic mutation that the user reviews. |
| Generic CRM / Dashboard | Relationship facts already compose through Person pages, Today, tasks and queries. | **Reject.** No pipeline, deal store, health score, generic grid or CRM-specific scheduler. |
| Generic Personal OS database | The source document proposes `objects`, `types`, `properties`, `relations`, `events` and `attachments`. | **Reject for LifeLoop.** It duplicates Markdown authority and makes a disposable index impossible. |

### Resulting implementation scope

Only four rows above required product changes in this pass:

```text
Person        → task-originated multi-person Interaction logging
Query / View  → named relationship projections
Time          → birthday parsing and signals
Calendar      → restricted, read-only Pre-meeting Brief
```

Everything else is an existing dependency to reuse, a host feature to document, a separately
gated future capability or a rejected source of duplicate ownership. This is the practical
translation of the all-in-one kernel into LifeLoop's current architecture.

### Remaining discussion gates

The source design still raises three user-workflow questions, but none belongs in the current
four-feature implementation pass:

| Question | Current default | Evidence that would justify code |
|---|---|---|
| Should Inbox explicitly create a Person page? | Keep captured text in Inbox or let the user create/link the page with Foam. | Repeated people captures require the same manual page creation and linking steps. Then add one reviewed `Create Person from Inbox` mutation. |
| Should Today include all Calendar events? | Show tasks and task-bound Calendar context; use Calendar for the full agenda. | Users repeatedly leave Today only to determine what action fits between meetings. Then add a read-only agenda projection. |
| Should LifeLoop provide a general editable table? | Edit Markdown/frontmatter and use Foam page queries; LifeLoop tables remain derived and read-only. | Repeated, error-prone multi-row edits cannot be expressed safely as a small named semantic mutation. |

Universal archive, generic Object Detail, durable create/update timestamps and automatic natural-
language classification are not open implementation questions. They add duplicate ownership or
unsafe inference without improving the current action loop.

## Durable data model

Only existing Markdown forms are durable.

### Person

One ordinary page is one Person identity. Identity is the canonical page path; basename or
title matching is never used for relationship mutations.

```yaml
---
tags: person
groups: [friend, school]
birthday: 05-12
contact-every: 90d
---
```

Every property remains optional. Arbitrary contact metadata such as email, organization or
location belongs to the page and Foam's general page-query surface. LifeLoop reads only fields
with relationship-loop semantics.

### Interaction

An Interaction is an explicit Journal list item. One Interaction may link multiple People.

```markdown
* Discussed the evaluation plan with [[People/Alice]] and [[People/Bob]] [interaction: meeting]
```

The date comes from a valid Journal `date` property, then from a valid ISO Journal filename.
An ordinary mention, a commented item, an undated item or a dated non-Journal page does not
count. File modification time is never used.

### Follow-up

A follow-up remains an ordinary task:

```markdown
* [ ] Send notes to [[People/Alice]] [scheduled: "2026-09-16"]
```

A generated reconnect task may additionally carry `[reconnect: true]` to suppress duplicate
reconnect signals. Completion, reopening, Reminders and Calendar binding continue through the
existing guarded task mutation API.

### Derived rows

Tables are projections over Markdown, not a second persistence format.

```text
Person page ─┐
             ├─ index → relationship projection → table / hover / baked Markdown
Interaction ─┤
Task ────────┘
```

Do not store a canonical CRM CSV, Markdown table, SQLite row set or generic `objects / types /
properties / relations / events` database beside these files.

### History sufficiency rule

A mutation writes history only when an already committed workflow must later distinguish the
transition and the answer must survive index deletion and rebuild. If current Markdown cannot
answer that question, write the smallest explicit domain fact alongside the mutation. Completion
uses `[completed: ...]`, contact history uses an explicit Interaction item, and Review history uses
frozen Markdown. Speculative analytics do not qualify, and this rule never creates a generic event
log.

## P0: named relationship projections

Add four read-only projections to the public semantic contract.

| Projection | Arguments | Result |
|---|---|---|
| `people` | none | One normalized relationship row per Person page. |
| `interactions` | optional `person`, `from`, `to`, `kind` | Explicit Interaction rows, newest first. |
| `reconnect` | optional `date`, default today | Due reconnect and never-contacted rows. |
| `person-context` | required exact `person` path | Summary, open follow-ups and recent interactions for one Person. |

The public rows expose stable relationship fields rather than the complete internal SB object.
Projection names and existing field meanings form the compatibility contract, while row schemas
remain open to additive fields. Consumers must ignore fields they do not recognize. Adding a field
is compatible; removing a field or changing its type or meaning is a breaking contract change.

```ts
type PersonRow = {
  person: string;
  groups: string[];
  birthday?: string;
  contactEveryDays?: number;
  lastInteractionDate?: string;
  reconnectOn?: string;
  openFollowups: number;
};

type InteractionRow = {
  ref: string;
  page: string;
  date: string;
  kind: string;
  text: string;
  people: string[];
};
```

General Person metadata is intentionally absent from this contract. A user who wants a table of
email, company or city should use a Foam page query. This keeps LifeLoop's API tied to semantics
it owns.

The existing query-block grammar gains only the arguments these projections require. It does not
become a second query language. Advanced filter, select, ordering, grouping and aggregation remain
available through SLIQ and Space Lua.

Examples:

````markdown
```lifeloop
people
fields: person, groups, birthday, lastInteractionDate, reconnectOn, openFollowups
```

```lifeloop
interactions
person: People/Alice
fields: date, kind, text
limit: 20
```
````

The output reuses the current preview table, hover, CodeLens count and baking path. No new view
renderer is introduced.

## P0: log Interaction from a task

Add `Log Interaction` to Task Actions when the indexed task has at least one direct, exact Person
link. Candidate People come only from the task's own `links` intersected with pages tagged
`person`. Inherited `ilinks` remain useful for Person Context and Linked Tasks, but they must not
select Interaction participants. No title parsing, basename guessing or Calendar attendee
inference is allowed.

Flow:

```text
Task Actions
  → Log Interaction
  → choose linked People when more than one exists
  → choose call / meeting / message / other
  → enter an optional one-line note
  → append one Interaction to today's Journal
  → reindex and refresh Person Context
```

Selecting multiple People creates one Interaction with multiple links. It must not write one
duplicate Journal line per Person. The mutation validates every selected Person page and the
Journal's expected contents immediately before the atomic write. Newlines in the note are
flattened as in Capture so pasted text cannot create accidental list items or headings.

For an event-bound task, `meeting` is the default kind but remains user-visible and changeable.
For any other task there is no inferred default. A task with only an inherited Person link is not
eligible: it reports that it needs a direct Person link and writes nothing.

## P1: birthday resurfacing

Birthday is an optional Person-page fact. Accept two strict formats:

```text
MM-DD
YYYY-MM-DD
```

Both represent an annually recurring month and day. A full date may support age display later,
but this pass does not calculate or show age. Invalid dates are ignored and exposed by X-Ray or a
targeted diagnostic; they must not create a signal on a guessed date.

Today reuses its collapsed People section:

```text
People
  Alice    birthday today
  Bob      birthday tomorrow
  Carol    last 104d · reconnect overdue
```

The look-ahead window reuses `lifeloop.upcomingDays`; no relationship-specific setting is added.
Sorting is deterministic: birthday today, upcoming birthday date, overdue reconnect date, then
canonical Person path. Leap-day birthdays appear on February 29 only; LifeLoop does not silently
move the fact to February 28 or March 1.

A birthday signal opens the Person page. It does not automatically create a task, Reminder or
Calendar event. Those are explicit user actions through existing commands.

## P1: restricted Pre-meeting Brief

Pre-meeting Brief is available only for a task carrying an exact Calendar binding and at least
one direct, exact Person link. It reads the bound event on demand and builds a temporary Markdown
document.

```markdown
# Pre-meeting Brief

**Weekly sync**
2026-09-10 14:00–15:00 · Zoom

## Alice

- Last interaction: 2026-08-20 · call
- Open follow-ups: 2
- Recent context:
  - 2026-08-20 · Discussed benchmark design
  - 2026-07-15 · Shared evaluation notes
```

The brief contains:

- Calendar summary, start, end and location from the bound event.
- One section per explicitly linked Person.
- Last explicit Interaction.
- Existing open linked tasks.
- A small fixed number of recent explicit Interactions.

It excludes ordinary mentions, inferred attendees, relationship scores, email history and AI
summaries. It is regenerated on each invocation and is never a new source of truth.

Failure behavior is explicit:

| Condition | Result |
|---|---|
| No task at the command target | Refuse and ask the user to place the cursor on a task. |
| No event binding | Refuse without Calendar access. |
| No linked Person | Refuse and point to the source task. |
| Event missing | Surface the stale binding through the existing sync/audit path. |
| Calendar unavailable | Show the bridge error; do not render partially authoritative event data. |
| Person page disappeared after indexing | Refuse that Person section rather than fuzzy-match a replacement. |

The first version uses the existing temporary Markdown preview mechanism. It adds no Webview,
dock protocol or saved brief page.

## Transformation model

The transformation stack has three levels:

| Level | Use | Mechanism |
|---|---|---|
| General page organization | Filter Person pages by arbitrary metadata | Foam Query / Smart Folder |
| Stable LifeLoop semantics | People, Interaction, reconnect and Person context tables | Named projections |
| Advanced analysis | Select, filter, group, aggregate and reshape rows | SLIQ / bounded Space Lua |

LifeLoop should publish examples before adding another data API. Useful initial recipes are:

- People ordered by reconnect date.
- Interaction timeline for one Person.
- Interactions grouped by month and kind.
- People with open follow-ups.
- People with no explicit Interaction.

SLIQ results that are arrays of objects already render as tables. Baked Sections can turn a
dynamic result into portable Markdown. This is sufficient for the first data-management pass;
there is no editable grid in scope.

## Chart gate

No chart renderer ships in this pass. A chart becomes eligible only when all of these are true:

1. A stable named or saved query is already used repeatedly as a table.
2. The table contains one clear category/time column and one or more numeric measures.
3. Seeing the shape changes a recurring decision; the chart is not decorative analytics.
4. The result can be rendered safely without arbitrary browser JavaScript.

The first eligible implementation, if needed, is a restricted bar or line display over an
existing query result. It accepts explicit `x` and `y` fields, preserves a text/table fallback for
accessibility and export, and stores no chart state. Chart.js/Vega, a Dashboard builder, arbitrary
DataviewJS-style DOM access and user-defined formulas remain out of scope.

Candidate charts after real data accumulates:

- Interaction count by month and kind.
- Completed tasks by month and Project.
- Waiting duration distribution.
- Reconnect overdue days.

Relationship health scores, productivity scores and inferred importance rankings are explicitly
excluded.

## Deferred features

| Feature | Reconsider when |
|---|---|
| Trustworthy Calendar attendee mapping | A stable EventKit or other host contract provides attendee identity that can map explicitly to Person pages. |
| Semantic search | VS Code/Foam retrieval has a measured failure that embeddings solve. |
| AI capture classification | Suggestions can be reviewed before the existing semantic mutation API writes them. |
| Recurring tasks / Habit | A real workflow needs occurrence history that Reminders cannot own alone. |
| Goal type | Project plus desired outcome no longer expresses an established workflow. |
| Person duplicate suggestions | A real vault contains recurring duplicates that exact paths and Foam search cannot manage. |
| Editable data grid | Repeated multi-row edits make page/frontmatter editing materially inadequate. |
| Calendar timeline | Users need a LifeLoop semantic overlay that the Calendar application and Today cannot show. |

## Rejected architecture

Do not implement the all-in-one document's generic backend tables as durable product state:

```text
objects / types / properties / relations / events / attachments
```

That model is reasonable for a standalone Personal OS, but in LifeLoop it would duplicate
Markdown and create an authority conflict. In particular:

- Generic event sourcing duplicates explicit completion and Interaction facts.
- Stored `last-contact`, Today membership and relationship scores can drift from source notes.
- A custom Type/Property/Formula builder recreates Notion and SB's extension platform.
- A Library/Search/Backlinks surface duplicates VS Code and Foam.
- Treating Calendar as merely a view of timed objects loses Calendar-owned recurrence, timezone,
  attendee and invitation semantics.
- Automatic extraction from titles or event summaries can attach actions to the wrong Person.

## Verification

The implementation is complete when these checks pass:

### Semantic core

- Projection rows rebuild identically from Markdown after deleting the index.
- The direct core API, query preview, SLIQ/Lua access and baked Markdown produce the same normalized
  relationship rows for the same snapshot.
- Existing consumers tolerate additive projection fields; removing a field or changing its meaning
  remains a contract-version change.
- Ordinary mentions and dated non-Journal items never enter Interaction tables.
- Person filters use canonical page paths and refuse ambiguous or missing identities.
- Person metadata covers YAML scalar/list forms and malformed `tags`, `groups`, `birthday` and
  `contact-every` values without silently changing identity or cadence.
- Birthday parsing covers invalid dates, yearless dates, full dates, year boundaries and leap day.
- Reconnect suppression still follows an existing open `[reconnect: true]` task.
- Multi-person task logging writes one Interaction and refuses stale Journal contents.
- A direct Person link enables task-originated logging; the same link inherited only from a parent
  provides context but cannot select an Interaction participant.
- Person rename or ref drift never falls back to basename matching for reads or mutations.
- Person names and Interaction text are escaped correctly in Markdown and HTML renderers.

### Mutation boundaries

- Multi-person logging writes exactly one Journal item containing every selected exact Person link.
- A dirty Journal buffer or concurrent disk change fails before writing and preserves both versions.
- A failed validation writes no partial Interaction, task, Reminder or Calendar state.

### VS Code

- Query blocks render People, Interaction and reconnect tables through the existing renderer.
- Today displays birthday and reconnect signals in one collapsed People section.
- Task Actions shows Log Interaction only when a directly linked Person exists.
- Pre-meeting Brief reads the exact event binding and opens one temporary Markdown preview.
- Pre-meeting Brief never treats an inherited Person link as an attendee.
- Dirty source documents continue to use guarded handles for task actions.
- A missing event, unavailable bridge, timeout or changed binding produces an actionable error and
  no partial or cached brief.
- Pre-meeting Brief remains read-only: opening it never mutates Markdown or Calendar.

### Coexistence

- The task-only profile passes without Foam installed.
- Foam remains the only provider for general page queries, links, backlinks, graph and navigation.
- Relationship query rendering composes with Foam preview hooks in both extension orders.
- No test writes to a personal vault or external Calendar.

### Representative-vault qualification

- Repository fixtures exercise writable mutations and malformed/counterexample cases.
- Read-only copies of the trial space and official SilverBullet examples exercise representative
  syntax breadth; differences are recorded as supported, adapted, restricted or host-owned rather
  than used to demand broad SB parity.
- The packaged extension repeats task-only and Foam coexistence smoke tests. Optional live
  SilverBullet or Apple-host checks are reported separately; a skipped live check is not counted as
  covered behavior.

Do not add performance, chart, AI-classification or editable-grid tests before those capabilities
pass their feature gate. Test committed boundaries and counterexamples, not the source document's
speculative platform breadth.

## Delivery order

1. Extend the existing Interaction mutation to accept multiple direct, exact Person identities and
   expose it through Task Actions.
2. Add normalized projection rows and query examples.
3. Add birthday parsing and Today signals.
4. Add restricted Pre-meeting Brief using the current Calendar read path and Markdown preview.
5. Run headless, task-only VS Code, Foam coexistence and packaged-extension gates.

Stop after step 4. Analytics-specific UI, charts and broader Calendar identity work require a
separate evidence-backed decision.
