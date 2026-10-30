# Run Trace Contract

This contract defines the structured run trace emitted while a caller drives
the [execution contract](execution-contract.md) loop. The trace records what a
run did — selected routes, artifact reads, dispatched effects, outcomes, and
yields — so runs can be measured and compared deterministically. It is
non-authoritative diagnostic data: never Graph State, never a lifecycle store,
never evidence for routing, gates, or status.

## Authority split

- The **caller** owns run-level facts: `runId`, event sequence, effect
  dispatch, execution mode, outcomes, and the final yield. Programmatic
  callers inside this repository use the trace helpers in
  `scripts/lib/run_trace.ts` (bundled into `route_graph.js`); any caller may
  also emit the same JSONL shapes directly. Agent callers record the same
  shapes in their handoff trace.
- `route_graph.js` owns per-invocation facts only. When invoked with
  `--trace-file <path> --run-id <id>` it appends one `artifact-scan` event then
  one `route-selected` event to the JSONL file. It knows nothing about runs,
  delegates, or yields. Both flags are required together.

## File format

JSON Lines (`.jsonl`), one event per line, UTF-8. Every event carries:

| Field | Meaning |
| --- | --- |
| `v` | schema version, always `1` |
| `runId` | caller-chosen identifier correlating all events of one run |
| `seq` | positive integer, assigned per `runId` in append order |
| `kind` | event kind below |

`seq` is the only ordering field; consumers sort by `(runId, seq)`. Writers
append; nothing rewrites earlier lines. A trace file may hold multiple runs;
events are grouped by `runId`. Each trace file has a single writer at a time —
concurrent appends can interleave and corrupt `seq` ordering.

## CLI-emitted events

### `artifact-scan`

One per invocation, emitted before `route-selected`.

| Field | Meaning |
| --- | --- |
| `scans` | artifact scan passes in this invocation (projection plus gate re-evaluation) |
| `filesRead` | total canonical Markdown file reads across all scans, repeats included |
| `uniqueFiles` | distinct canonical files read, deduplicated across scans |
| `bytesRead` | total UTF-8 bytes read across all scans |

`filesRead` minus `uniqueFiles` exposes duplicate fetches inside one
invocation.

### `route-selected`

One per invocation, emitted after `artifact-scan`.

| Field | Meaning |
| --- | --- |
| `current`, `next` | evaluated node and route destination |
| `edgeId` | selected edge, or `null` for terminal/blocked |
| `status` | `edge`, `terminal`, or `blocked` |
| `condition` | matched condition key, or `terminal`/`blocked` |
| `delegate`, `requiredAudits`, `commitGate` | copied from `GraphRoute` |
| `blockers` | `GraphRoute` blockers; free-text entries are normalized to `<kind>:sha256:<12hex>` tokens (see below) |
| `focus` | resolved repo-relative focus paths |
| `tasks` | selected Task Graph nodes; `{ id, status }` copies task front-matter identifiers verbatim — they are the correlation keys |
| `routeHash` | sha256 of the key-sorted JSON of the complete `GraphRoute` |
| `durationMs` | optional wall-clock diagnostic; never asserted exactly |

## Caller-emitted events

The caller records these when it drives audits/delegates; `route_graph.js`
never emits them.

### `effect-dispatched`

`edgeId`, `stage` (`audit`/`delegate`), `effectId`, `executionMode`
(`same-context`, `subagent`, `tool`, or `unknown`), and `focusPaths`
(repo-relative artifact paths handed to the effect). `modeReason` is
optional: when a caller-side execution-mode policy selected the mode, it
records the policy's `;`-joined reason tokens; normalization keeps it only
as a non-empty plain string (it is a reason list, never a path).
`executionMode` here is the *requested* mode handed to the dispatcher; what
the dispatcher actually executed is recorded by `dispatch-observed`.

### `dispatch-observed`

One event per dispatch the dispatcher reports performing, emitted
immediately after its `DispatchResult` returns and before `effect-outcome`.
`edgeId`, `stage`, and `effectId` correlate it to the producing
`effect-dispatched`. The remaining fields record the dispatcher's own
report of what ran:

| Field | Meaning |
| --- | --- |
| `target` | what the dispatch executed — equal to `effectId` for the self-observation, or an adapter-internal dispatch name (e.g. `spec-doc`, `adr-doc`, `research` inside `briefing-flow`) for work inside a composite delegate |
| `requested` | the mode the dispatch was asked to run (`same-context`/`subagent`/`tool`/`unknown`) |
| `actual` | the mode the dispatcher reports it ran as (`unknown` when declined) |
| `method` | the execution mechanism: `scripted` (deterministic adapter), `inline-skill` (ran in the caller's context), `subagent-spawn` (independent bounded subagent), `tool-call` (bounded tool-shaped delegation), or `not-executed` (declined) |

Every accepted dispatch yields exactly one self-observation
(`target === effectId`): its `requested` equals the producing
`effect-dispatched.executionMode`, and an executed dispatch reports
`actual` equal to it (`requested === "unknown"` exempts the `actual`
check). A self-report that contradicts the request — or a dispatch with no
self-observation — rejects the dispatch like a malformed outcome; the trace
then keeps the observation as the forensic record and emits no
`effect-outcome` for it. `method: "not-executed"` is honest only with a
`yield` outcome. Internal observations (`target !== effectId`) are the
adapter's own report: they are how a trace proves an independent spawn
happened rather than a same-context audit relabelled as delegated work, and
they never represent new graph effects.

### `effect-outcome`

`edgeId`, `stage`, `effectId`, `outcome` (`completed`/`retry`/`yield`),
`evidencePaths` (repo-relative), and `reason` — required when `outcome` is
`yield` and rejected on `completed`/`retry` outcomes (the validator enforces
both); one of `approval-required`, `input-required`, `authority-required`,
`unrecoverable-blocker`, `commit-required`.

### `run-yield`

`reason` (any `effect-outcome` reason plus `budget-exhausted`, `terminal`,
`single-step-complete`), `hops`, and `completedEdges` in order.

### Resume semantics

A resumed run continues appending under the same `runId`; `seq` keeps
increasing and previously uncompleted stages emit fresh `effect-dispatched`
and `effect-outcome` events. There is no resume event kind — continuity is
expressed by the per-`runId` sequence, and completed-edge ids accumulate in
`run-yield.completedEdges`.

## Determinism and normalization

- No timestamps, PIDs, absolute paths, random IDs, or environment paths are
  recorded. Fixture runs use fixed `runId` values.
- `focusPaths`/`evidencePaths`/`focus` hold repo-relative paths only;
  normalization rejects absolute paths (POSIX, Windows drive, UNC, `~`).
- `route-selected.blockers` records only bounded tokens. A blocker carrying
  free text after a `<kind>:` prefix — such as a `broken-relation:` message
  embedding a relation target — is normalized to `<kind>:sha256:<12hex>`, a
  deterministic content hash that keeps the actionable kind while dropping
  embedded paths and secrets. Kind-less blockers (`focus-required`,
  `duplicate-id`, …) pass through verbatim, and so do `tasks[].id`/`status`:
  those are the correlation identifiers the trace exists to carry.
- `normalizeTraceEvent` drops fields outside this contract, so unexpected
  content cannot leak through a newer producer.
- `durationMs` is wall-clock diagnostic only; `normalizeForCompare` strips it
  before fixture diffs and consumers must never assert it exactly.

## Metrics and non-goals

`summarizeTrace` aggregates per run: route selections, ordered edge IDs,
blocked/terminal counts, audit and delegate dispatch counts, execution-mode
counts, outcome counts, yield reasons, dispatch-observation totals
(`dispatchObservations`: `total`, `byActual`, `byMethod`), and scan totals
(`scans`, `filesRead`, `bytesRead`, `uniqueFilesMax`).

The trace never records LLM tokens, cost, provider or model names, prompts,
document bodies, or secrets — the schema carries no field that could hold
them. Callers that need raw payloads keep them outside the trace under their
own controls; contract revisions add fields only as additive-optional
extensions (unknown fields drop on read) or by bumping `v`.

Disabled tracing (no `--trace-file`) leaves routing, evidence, and gates
unchanged. A failed trace append warns on stderr and never fails a route.
