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
(repo-relative artifact paths handed to the effect).

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
counts, outcome counts, yield reasons, and scan totals (`scans`, `filesRead`,
`bytesRead`, `uniqueFilesMax`).

The trace never records LLM tokens, cost, provider or model names, prompts,
document bodies, or secrets — the schema carries no field that could hold
them. Callers that need raw payloads keep them outside the trace under their
own controls; a future contract revision adds fields only by bumping `v`.

Disabled tracing (no `--trace-file`) leaves routing, evidence, and gates
unchanged. A failed trace append warns on stderr and never fails a route.
