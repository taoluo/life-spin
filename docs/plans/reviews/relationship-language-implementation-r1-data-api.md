# Implementation R1 — independent data/API and editor-semantics review

Status: **NOT CLEAN — ten P2 findings**. No P0/P1 finding in this assigned scope.
Reviewer: **gpt-6-astra, high reasoning**. Review completed 2026-09-09.

## Frozen input and verification

- Implementation ref: `refs/codex/recovery/relationship-language-implementation-r1-20260909`.
- Commit: `c0c2d9164b8ae34641f1848f2dcd12d846da8041`.
- Tree: `755b79722b05fd4d598765b954a33326a58f4b74`.
- Design ref: `refs/codex/recovery/relationship-language-design-reviewed-20260909`;
  design baseline revision `dbd6fd56fffa225d108b76b57ea4f68d23a06b41`.
- Reviewed design: `docs/plans/2026-09-09-relationship-language-features.md` from that ref.
- Verified the implementation review JSON first: every one of its 40 inventory entries matches
  the frozen Git blob's SHA-256, byte count, and newline count. Ref and tree match. The binary
  diff from the declared base hashes to
  `e2b25694432a5c75bed8a711336b98b2d7699abb470ed890430a291e58e3737a`, as declared.

No frozen source was edited. The only review artifact written is this report. In-memory esbuild
probes imported the frozen working-copy source, used the existing VS Code mock, an in-memory
Store/Vault, and upstream extraction; their bundles were never written to disk. The exact-Person
path probe also read the existing `test/fixtures/People/Jiulong.md` using `NodeVault`.

The existing focused test command passed **54 tests in five files**:

```sh
./node_modules/.bin/vitest run --configLoader runner \
  packages/semantic-core/src/relationships.test.ts \
  packages/vscode/test/language-features.test.ts \
  packages/vscode/test/preview.test.ts \
  packages/vscode/test/relationship-parity.test.ts \
  packages/cli/src/main.test.ts
```

That passing result does not cover the counterexamples below. Real VS Code/Foam and Apple gates
were not rerun by this reviewer; the manifest's reported gates were inspected, not recertified.

## Findings

### D1 — P2: live Interaction classification contradicts core extraction

Location: `packages/vscode/src/retrieval.ts:52` (`locatedInteractions`, through line 83).

Concrete counterexamples, with an existing `People/Alice` Person and source page
`Journal/2026-09-09`:

```markdown
<!--
* [[People/Alice]] [interaction: coffee]
-->
```

The same item in a `~~~text` fence, in inline backticks, or with an escaped opening bracket
also reproduces the fault. Core returns no Interaction rows; editor hover says
`coffee counts as an Interaction`, Outline emits `coffee / counted Interaction`, and no
exclusion diagnostic appears. An unquoted `[interaction: 42]` likewise is not a string-valued
core Interaction but is advertised as counted. Conversely:

```markdown
* [interaction: coffee]
  [[People/Alice]]
```

Core emits a coffee Interaction with `people: ["People/Alice"]`; hover, symbols, and diagnostics
say it is excluded for lacking a direct Person link. These results were executed, not inferred.

Violated invariant: core owns explicit Interaction inclusion and direct-link semantics; R5/R18
and semantic hover/symbols require the same counted/excluded answer. The line regex invents a
second item parser and treats continuation links differently from upstream extraction.

Minimal fix: reuse the existing Markdown parser/item-extraction semantics on the supplied live
document, including comments, code, parsed attribute type, and direct item links; retain located
source tokens for presentation ranges. Keep empty/excluded explicit attributes diagnosable without
calling ordinary code examples Interactions. No full-vault reindex or generic language service.
Affected surfaces/tests: relationship diagnostics, hover, document symbols, and their comparisons
to `runProjection("interactions")`; add all six context/type cases and the multiline positive
case to the current language-feature tests. **Reuse/removal resolves this**: remove the duplicate
classification rules, rather than expanding them with more independent regex exceptions.

### D2 — P2: quoted valid YAML values lose relationship hover

Location: `packages/vscode/src/retrieval.ts:262` and `:271`.

Counterexample: a Person with `birthday: "02-29"` and `contact-every: "30d"` has public
`birthday: "02-29"` and `contactEveryDays: 30` in core. Both birthday and cadence hovers return
`undefined` when invoked on their live values. The same raw-value problem applies to valid YAML
quotes and inline comments: the hover validates the source spelling including YAML syntax, even
though `pageObject` already parsed the authoritative semantic value.

Violated invariant: birthday/cadence interpretation belongs to core and valid relationship facts
have the specified semantic hover, including leap-day behavior (R18).

Minimal fix: use `livePage.birthday` and `livePage["contact-every"]` for semantics; use located
frontmatter tokens only for ranges. A second YAML parser is unnecessary. Affected tests: quoted,
unquoted, and commented equivalent scalars must produce equivalent hover facts and retain their
own source ranges. **Reuse resolves this** through the existing parsed live page.

### D3 — P2: canonical Person completion lacks the replacement range

Location: `packages/vscode/src/query-lens.ts:80`–`:83` and `completion` at `:38`.

Counterexample: after typing `person: People/A`, the returned completion for Alice has
`insertText: "People/Alice"` and `range: undefined` (executed). VS Code's default word
replacement acts on the word at the cursor, not the complete slash-containing Person value;
accepting this item can produce `person: People/People/Alice`. A partial Person name containing
spaces has the same problem. The existing tests assert labels only, not the applied edit.

Violated invariant: completion offers exact canonical Person identities in the correct value
position; it must produce a query the shared validator accepts (R6/R8).

Minimal fix: set the Person item's replacement range to the located Person value or its current
typed prefix, using the existing located query offsets. Affected tests: actually apply the
completion to `People/A`, a path with a space, and a value with a suffix under the real editor
contract, and validate the resulting query. **Reuse resolves this**; no completion service needed.
The returned item shape was executed. The installed VS Code 1.136.1 Markdown language
configuration was also read: its `wordPattern` contains alphabetic/number/mark characters and
internal underscores, excluding `/` and spaces. Completion acceptance itself was not re-executed
in a real host in this round.

### D4 — P2: query providers bypass projection-specific ownership

Locations: `packages/vscode/src/retrieval.ts:92`–`:100`;
`packages/vscode/src/query-lens.ts:71`–`:74`.

Counterexamples (executed): `person: People/Alice` resolves to Alice under `open`, `people`,
and even `nonsense` query heads. Separately, `people` followed by `kind:` offers call, meeting,
message, and other. Core rejects these relationship arguments, and the design gives Person
definition only to a recognized relationship query, with completion restricted to legal keys.

Violated invariant: static projection metadata is authoritative for the provider's syntax scope;
ordinary/unrelated text and illegal argument positions are not LifeLoop relationship features.

Minimal fix: admit a query Person definition only after checking the relationship projection and
its `allowedArgs`; gate kind completion with the same metadata already used for Person completion.
Affected tests: both positive allowed positions and every disallowed projection/key combination.
**Reuse/simplification resolves this** with existing metadata checks.

### D5 — P2: exact Person definition accepts noncanonical paths and throws on malformed paths

Location: `packages/vscode/src/retrieval.ts:33`–`:39` (also called by the live classifier).

Counterexamples (executed against the existing disk fixture):
`person: ./People/Jiulong` returns a definition even though the canonical Person is
`People/Jiulong` and the shared projection validator rejects the former identity.
`person: ../../../outside` throws `path escapes the vault: ../../../outside.md` out of the
provider: `vault.exists` is outside its catch. A malformed link encountered during relationship
diagnostic publication can invoke this same helper and interrupt publication.

Violated invariant: definition requires an exact canonical Person identity; malformed inputs
return no definition/appropriate diagnostics and must not escape as provider failures.

Minimal fix: validate canonical page syntax using the existing page-name/path rules before
filesystem access and include existence/read failures in the existing fail-closed catch; preserve
live-buffer Person-tag checking. For platform-normalized spellings, require an exact canonical
path match, not mere existence after normalization. Affected tests: dot segments, duplicate
separators, absolute/traversal paths, read errors, and the valid dirty Person case. **Reuse resolves
this**; no new identity layer or inferred canonical correction is needed.

### D6 — P2: empty query/frontmatter values evade diagnostics or produce invalid live ranges

Locations: `packages/vscode/src/retrieval.ts:124`, `:155`–`:167`, `:201`, `:220`;
`packages/vscode/src/query-language.ts:58`–`:74`.

Counterexamples (executed): `people\nlimit:` and `people\nfields:` both fail query parsing with
`expected key: value` but produce no diagnostics. `Number("")` is accepted as zero by the
diagnostic branch; an empty fields list simply has no field tokens. For
`interactions\nperson:\r\n`, the diagnostic range extends from column 7 to 8: it selects the
CR terminator rather than a live token. In a CRLF Person document containing:

```yaml
birthday:
contact-every: 30d
```

the invalid birthday diagnostic selects the entire *contact-every line* (zero-based line 3,
columns 0–18 in the executed fixture). The `\s*` following the colon consumes the newline.

Violated invariant: malformed presentation values are Errors and diagnostic/replacement ranges
identify the smallest live token without including CRLF; lexical diagnostics agree with execution.

Minimal fix: diagnose an empty option value before numeric/field-specific branches, using the key
or colon as the nonempty source token. Use horizontal whitespace in the existing line-local
frontmatter locator; choose a real token when the semantic value is empty rather than forcing the
end offset forward into an EOL. Preserve intentional empty-item parsing only if the query contract
actually allows it. Affected tests: missing limit/fields/person, empty birthday/cadence, LF/CRLF,
and exact selected substrings. **Small shared guards and locator reuse resolve this**; no new schema.

### D7 — P2: cadence validation allows dates outside the strict public date representation

Locations: `packages/semantic-core/src/relationships.ts:79`–`:86`, `personContext` at `:154`;
dependency `packages/semantic-core/src/projections.ts:26`.

Counterexample (executed): `contact-every: 3000000d` and a last Interaction on `2026-09-09`
yield `contactEveryDays: 3000000`, `reconnectOn: "+010240-05"`, and a reconnect row with
`due: "+010240-05"` when querying `2026-09-09`. This malformed far-future date is classified
as already due because `+` sorts before the year digits. The new probe only checks Date's finite
range, while `shift()` truncates extended ISO years to ten characters.

Violated invariant: strict relationship date derivation, safe overflow handling, valid public row
values and due filtering (R4). A passing test with an astronomically large integer does not cover
the much smaller extended-year boundary.

Minimal fix: keep shared legacy `shift` behavior out of scope unless required; validate the actual
relationship date arithmetic/result against the strict four-digit date contract before exposing
or comparing it, and deterministically exclude/report the out-of-range relationship derivation.
Do not reject every positive cadence merely because adding it to 9999-12-31 crosses year 9999.
Affected tests: the concrete 3000000d case, the representable boundary, and a normal cadence near
the final supported date, across core rows and derived hover/diagnostics. **A local strict-date
guard/reuse resolves this**; extended-year support or a new date library is not required.

### D8 — P2: temporary source navigation drops anchored item/task identities

Locations: `packages/vscode/src/temporary-navigation.ts:16`–`:24`;
callers `packages/vscode/src/preview.ts:247` and `packages/vscode/src/apple.ts:52`–`:66`.

Counterexample (executed): an Interaction
`* [[People/Alice]] [interaction: coffee] $met` has public `ref: "met"`; an open task ending
in `$followup` has public `ref: "followup"`. The full Interaction result renders plain `met`,
and Person Context's `openFollowupRefs` renders plain `followup`. Brief passes the same bare
refs into the same helper. Upstream deliberately uses the bare anchor as item/task identity.
The helper assumes every ref contains a page and `@`, so these required source links disappear.

Violated invariant: successful temporary full results/Brief provide source navigation for the
existing anchored as well as numeric source identities (R19, special-reference/anchor contract).

Minimal fix: construct a presentation SB ref using the object's known `page` plus bare anchor;
carry existing page context through rendering where available. For `openFollowupRefs`, resolve
against the existing context/index without guessing among ambiguous anchors. Reuse the existing
task-ref conversion seam and retain one-time numeric CRLF conversion. Do not change raw public
refs just to repair presentation. Affected tests: anchored Interaction, anchored follow-up in
Brief/full results, duplicate/missing anchors, and current CRLF numeric regressions.
**Reuse resolves this** without public schema changes.

### D9 — P2: the extended document-symbol provider still uses stale normalized task ranges

Location: `packages/vscode/src/retrieval.ts:704`–`:711`.

Counterexample (executed): source `intro\r\n\r\n* [ ] task [[People/Alice]] $followup\r\n`
returns the task symbol on the preceding blank line (zero-based line 1), not the task on line 2.
The provider uses parser `task.range[0]` directly against the live CRLF document. Inserting a
new line in the live document before the index settles similarly leaves the cached task location
and name driving a current-document symbol. This is an existing path retained inside the provider
that this design explicitly extends; it is not claimed as newly introduced task extraction.

Violated invariant: supplied live documents determine provider tokens/ranges, and parser offsets
must undergo `originalSourceOffset`; the requested editor dependency closure includes this provider.

Minimal fix: derive task symbol tokens/ranges from the current document using the existing parser
seam, or postpone index-derived task symbols when freshness cannot be established and translate
the normalized range exactly once. Affected tests: CRLF with blank/astral prefixes, dirty insertion,
changed task labels, alongside live Interaction symbols. **Reuse/safe postponement resolves this**;
no index refresh solely for a symbol request.

### D10 — P2: located query-fence scanning treats code examples as executable query bodies

Location: `packages/vscode/src/query-language.ts:83`–`:91`.

Counterexample (executed):

``````markdown
~~~~markdown
~~~query
people
~~~
~~~~
``````

`findLocatedQueryFences` returns the nested `people` block, so editor providers offer query
results/completion/definitions inside a Markdown code example. Markdown-it preview treats the
whole outer block as literal Markdown code and runs no query. The scanner skips no nonquery
fences and permits arbitrary indentation, causing a related mismatch for indented code. This
is distinct from D1: it affects shared query ownership even after Interaction classification is fixed.

Violated invariant: the shared located parser recognizes actual query fence bodies, preserves
same-marker/length Markdown fence semantics, and keeps preview/hover/CodeLens scope in agreement
(R6/R2). Ordinary examples are not relationship query syntax.

Minimal fix: track surrounding fence context for every language and respect Markdown fence
indentation/context before selecting the two query aliases, or reuse an existing Markdown parser
for that boundary. Preserve incomplete final real query blocks for completion. Affected tests:
the nested example, nonquery fences with both marker types/lengths, indented code, and current
long/short/opposite-marker query tests, compared against actual preview parsing.
**Reuse or a small contextual fence scan resolves this**; no second query grammar is needed.

## Completed scope and closure assessment

The review continued across the entire assigned scope after identifying the first defect:

- Core contracts: all four projection schemas, legal/required arguments, runtime rejection,
  omission rather than undefined, null-first reconnect ordering, interaction date/ref ordering,
  exact Person filtering, public nested row keys and ten-entry context bound, birthday/cadence
  parsing, page-date selection, direct/inherited People, and mutation vocabulary versus custom
  Markdown kinds. Normal rows and adapter routes are consistent; D7 is the strict-date boundary.
- Extraction dependency closure: upstream item/task refs, anchors, comments, code, attribute
  values, continuation links, inherited links and parser offsets. This establishes D1/D8/D9 rather
  than assuming line-level regex behavior equals parser semantics.
- Adapters: core `runProjection`, CLI explicit argument construction and limit application, Lua
  host argument forwarding/limit handling, SLIQ, preview execution, query hover, CodeLens count,
  baked Markdown evaluation, selected fields, documentation recipes and public-key tests. The
  discriminating fixture passes but tests primarily prove adapter parity for a valid Interaction
  query; they do not prove malformed/context/anchor behavior.
- Editor features: source-local token/range computation, query aliases/fences, completion values
  and edits, relationship diagnostics/severity, exact Person and special definitions, literal `@`
  page precedence, semantic hover ownership, guarded command-backed CodeActions, deterministic
  spelling fix receipts/registration, live Interaction symbols, and existing task-symbol closure.
  No writable eager CodeAction edits were found. Task command concurrency/reconciliation remains
  the separate authority review's primary scope; this report does not certify that implementation.
- Temporary results: full result and Brief are untitled Markdown, use standard Person file-URI
  links, leave raw rows and hover output unchanged, and perform one numeric source-offset
  conversion. Actual `vscode.Uri.toString()` is the escaping boundary; mock URI strings do not
  themselves qualify special-character URI behavior. Anchored sources fail as D8 describes.
- Registration/freshness boundaries: file/untitled selectors, lexical change publication,
  settled-index checks, live Person reads and task handle admission were followed through their
  consumers. Existing old task diagnostics and symbol code were considered, not silently excluded
  because the new Interaction symbols pass.
- Schema ledger: the four optional frontmatter keys and relationship task attributes are listed
  with rationale; contract version remains 1.1.0 and package/editor version is not spuriously bumped.
  No generic LSP/service, new renderer, or unrequested schema system is needed for these fixes.

All ten findings have concrete counterexamples and minimal in-scope resolutions. Reviewers'
overlapping ownership/classifier findings should be deduplicated by these root causes, not fixed
with separate additional mechanisms. After consolidation, rerun every counterexample and its
dependency closure; the current passing suite cannot support a CLEAN verdict for this digest.
