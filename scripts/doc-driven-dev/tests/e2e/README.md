# Deterministic E2E Harness (doc-driven-dev-graph)

Offline, deterministic end-to-end coverage for the doc-driven-dev execution
graph (Issue #121). Every case drives the **real** `route_graph` CLI —
spawned once per hop through `runCaller` — against a real temp git
repository with canonical Markdown artifacts. A scripted dispatcher
replaces the LLM/tool a production caller would inject, and an independent
validator re-checks the run against the file system, git state, and the
graph definition re-loaded from YAML. No network, no API keys, no real
models, no wall-clock gates.

## Layout

- `harness/fixture_manager.ts` — `createFixtureRepo` builds an isolated temp
  repo per case: canonical doc scaffold, deterministic front matter (fixed
  ids/statuses/dates — `created`/`updated` are pinned, never wall-clock),
  and a real baseline git commit. `writeArtifact`/`updateArtifact`/
  `commitAll`/`addTask` are the only mutators; git runs only inside the
  fixture repo.
- `harness/scripted_dispatcher.ts` — `scriptedDispatcher(script)` returns the
  `EffectDispatcher` the runner injects. Per edge it serves scripted
  `completed`/`retry`/`yield`/malformed outcomes with real canonical
  references (resolved via the authoritative input/evidence mapping ported
  from the oracle) and applies minimal document mutators. It never
  self-grades: no gate checks, no expectation logic. It also plays the host
  adapter at the #135 dispatch boundary: it receives `requestedMode` (and a
  `DelegateHandoff` for delegated modes), returns a `DispatchResult`
  (outcome + observations), enforces the handoff write scope on top-level
  mutators, declines `unsupportedModes` as `not-executed` + `yield` rather
  than silently switching, and runs each edge's `subDispatches` internal
  plan — same-context internals as `inline-skill`, delegated ones bounded
  by a declared `writeScope` as `subagent-spawn`, each recorded as a
  `dispatch-observed` event. A scripted internal dispatch is a deterministic
  model of what a real adapter does by literally spawning a subagent; it
  proves the *boundary contract*, never model quality.
- `harness/run_case.ts` — thin case runner: fixture -> multi-leg `runCaller`
  loop (each hop spawns `route_graph` via tsx, `executionMode: "tool"`,
  `--trace-file` JSONL beside — never inside — the repo) -> trace ->
  validator -> report. Case-declared `policy`, `buildHandoff`, and
  `unsupportedModes` pass straight through to the runner/dispatcher.
  `run_case.test.ts` is its unit test and runs as part of `test:e2e`.
- `harness/case_validator.ts` — independent hard gates (below) plus the
  expectation DSL. It never trusts run state: evidence receipts are re-read
  from the proof doc, git state is re-queried, edge ids are validated
  against a freshly re-loaded definition.
- `harness/reporter.ts` — `CaseReport` records, `formatReport` (aligned
  text table emitted via test diagnostics), `writeReportJson` (JSONL), and
  `compareNormalizedTraces` (deep-equal over `normalizeForCompare`'d traces
  for reproducibility checks). `durationMs` is reference-only.
- `cases/` — declarative `E2ECase` objects, one export per case, registered
  in `cases/index.ts`.
- `doc-driven-dev-graph-e2e.test.ts` — runs every registered case.

## Validator invariants (universal hard gates)

Every case — pass or fail expectations — must satisfy all seven. Any
violation is a failure line; there are no soft warnings.

1. **Declared edges.** Every `route-selected.edgeId` is `null` or an edge id
   declared in the graph definition (re-loaded from YAML — not the emitted
   route set).
2. **Route continuity.** Within each leg, `route-selected[n+1].current`
   equals `route-selected[n].next` when the edge completed — or
   `route-selected[n].current` when a `retry` effect-outcome lies between
   them (the runner re-projects from the same node on retry and only
   assigns `current = route.next` on completion). Legs partition at
   `run-yield` events: a resumed leg legitimately re-routes the pending
   edge from its `from` node, so continuity never spans the boundary.
3. **Evidence receipts.** Every edge id in `run-yield.completedEdges` has a
   `checkpointEvidence` receipt in the proof doc (default
   `docs/tasks/0001-task.md`), re-read from disk.
4. **Commit gate.** Each completed `commitGate` edge shows an
   `evidence:<edgeId>` runner event plus commit proof — a prior
   `commit-required` yield, the `commit-waived` signal, a clean final tree,
   or a post-baseline commit in the fixture's history.
5. **Yield contract.** Every `run-yield.reason` is a declared
   `YieldReason`; `completedEdges` is a subset of emitted `route-selected`
   edge ids.
6. **No orphan outcomes.** Every `effect-outcome` matches an earlier
   `effect-dispatched` with the same `edgeId` + `stage` + `effectId`.
7. **Dispatch attribution.** Every `dispatch-observed` correlates to a
   prior `effect-dispatched` (`edgeId` + `stage` + `effectId`). For an
   *accepted* dispatch (one that produced an outcome), the self-observation
   (`target === effectId`) must echo that dispatch's `executionMode` in
   `requested`, and an executed dispatch (`method !== "not-executed"`) must
   show `actual` equal to it — an independent re-check of the runner's own
   gate against the emitted trace. A rejected dispatch may leave a
   mismatched report in the trace; that report is the forensic record the
   rejection enforced, not a consistency failure.

## Adding a case

Create `cases/case-NN-name.ts` exporting an `E2ECase` (`harness/case_types.ts`)
and register it in `cases/index.ts`. Fields:

| Field | Meaning |
| --- | --- |
| `id`, `description` | Case identity; tests are named `e2e <id>: <description>`. |
| `fixture` | `createFixtureRepo` options: `files` overrides (`DocSpec` / raw `string` / `null` to delete), `taskStatuses`, `dependsOn`, `secondPlan`, `scaffoldDirs`. Defaults to the standard happy fixture. |
| `current` | Start node (default: graph entry). Use to start mid-graph. |
| `focus`, `signals` | Caller focus ids and runtime signals. Routing past `focus-required` needs `focus`; the implementation/followup/exit-audit gates need their `*-verified`/`*-pass` signals. |
| `graph`, `proofPath` | Custom graph YAML (repo-relative) and proof doc (default `docs/tasks/0001-task.md`). |
| `maxHops`, `mode` | Hop budget; `run-until-yield` (default) or `single-step`. |
| `script` | `Record<edgeId, EdgeScript>` — `audits`/`delegate` outcome specs (scalar repeats, queue consumed per dispatch), `mutate` document mutators applied when the delegate completes, `commitEvidence` to commit during evidence persistence, `subDispatches` internal dispatch plan, `reportActual` to simulate a dishonest self-report. Unscripted effects throw — no silent defaults. |
| `script.subDispatches` | `SubDispatchSpec[]` (repeats per delegate dispatch that resolves `completed` — a `yield`/`retry` spec consumes nothing, so queues stay aligned across yields; e2e-15c depends on this) or `SubDispatchSpec[][]` (one plan consumed per completed dispatch). Fields: `target` (internal dispatch name), `requested` (mode, default `same-context`), `method` (override the mechanism report), `mutate` (mutators), `writeScope` (required for delegated requests that mutate — fail-closed refusal otherwise), `refuse` (decline outright), `staleReturn` (execute but return unresolvable evidence → delegate yields), `reportActual` (dishonest mode report → runner rejects). A refused/rejected entry stops the plan and forces the delegate to `yield authority-required`. |
| `unsupportedModes` | `ExecutionMode[]` the simulated host cannot execute — a dispatch requesting one declines `not-executed` + `yield` instead of silently switching. |
| `buildHandoff` | Optional `CallerRunnerOptions.buildHandoff` override; the runner calls it for every delegated policy decision and rejects a falsy return or a handoff whose `executionMode` mismatches the request. |
| `steps` | Multi-leg runs. Each leg: `mutateBefore` (applied between runs), `options` (`focus`/`signals`/`current`/`mode`/`maxHops`, plus `resume:false` for a fresh run — on resumed legs the prior `CallerHandoff` wins `current`/`mode`/`maxHops`), `expect` (trace checks use that leg's partition). |
| `expect` | Final-leg expectations: `yield`, `edgeSequence`, `completedEdges` scope to the last leg; `events` tallies span the whole run; `blockersContain`/`tasksContain` match `route-selected` payloads; `finalFiles` re-reads end-of-run repo state. |
| `expect.briefingAudit` | Run the real source `audit_briefing` CLI via tsx against the fixture (`spec`, `adr`, and expected `consistent`); check both JSON and exit status. A step expectation runs immediately after that leg; a top-level expectation reads the final state. |
| `expect.checkpointReceipts` | Assert counts of persisted proof-document receipts by edge. Step expectations read at the leg boundary; top-level expectations read final state. A checkpoint is not a trace event; trace `run-yield.completedEdges` is asserted separately. |

Write scopes (`SubDispatchSpec.writeScope`, `DelegateHandoff.permissions.read`/`.write`) use `pathInScope` semantics — **prefix match with a trailing `/`, or exact path match; no glob syntax**. `docs/specs/` covers `docs/specs/0001-graph.md`; `docs/specs/0001-graph.md` covers only that file. `docs/specs/**` is a literal string that matches nothing under the trailing-`/` rule — do not write glob patterns into checked positions. Path-less mutators (`{ commit: true }`) are unauthorized under any delegated scope: a commit is caller-phase work no write scope can express.

## Running

```bash
# All e2e cases plus the harness unit test (from scripts/doc-driven-dev):
pnpm test:e2e

# The golden-case suite only:
pnpm exec tsx --test tests/e2e/doc-driven-dev-graph-e2e.test.ts

# Part of the package suite — pnpm test already globs tests/**/*.test.ts.
```

Per-case JSONL reports are written to `${os.tmpdir()}/e2e-report.jsonl`
(refreshed after every case, so a failing run still leaves the accumulated
report); the aligned pass/fail table is emitted via test diagnostics.

## Determinism rules

- Fixture front matter carries fixed ids, statuses, and dates — no
  wall-clock values anywhere in asserted state.
- No timestamps, PIDs, or random ids in assertions; `durationMs` is
  reported but never asserted. Trace comparison goes through
  `normalizeForCompare` (`compareNormalizedTraces`).
- Assertions use fixture-relative paths only; temp dirs and the trace file
  (kept beside the repo so it cannot dirty the commit gate) are never
  asserted.
- Git runs only inside the case's own fixture repo — never the host
  checkout.
- Routing past `focus-required` requires explicit `focus` on the case (or
  leg); gate-protected nodes require their declared signals up front or via
  per-leg/per-edge injection.

## Issue #121 acceptance mapping

| Criterion | Where it lands |
| --- | --- |
| >= 10 regression cases | 33 `E2ECase` entries in `cases/` (15 files; e2e-07/10/12/13/15 carry a/b/c/… siblings). |
| Real CLI + filesystem + git + Markdown + fresh projection | Every case: real temp git repo, `route_graph` spawned via tsx once per hop, projection recomputed per invocation. |
| Deterministic delegate/audit replacement incl. error/yield/resume/commit | `scriptedDispatcher` (completed/retry/yield/malformed); exercised by e2e-03/11 (retry), e2e-04 (resume), e2e-08 (resume after budget), e2e-09 (commit), e2e-10 (rejections), e2e-02 (input-required). |
| Reproducible + contract-violation detection (hard gates) | Seven universal invariants + per-case expectation DSL; `compareNormalizedTraces` for reproducibility; e2e-05/07/10 target contract violations. |
| Per-case + aggregate report | `CaseReport` JSONL + `formatReport` table; `${os.tmpdir()}/e2e-report.jsonl`. |
| Non-goals documented | "What this harness does NOT verify" below. |
| Existing tests + lint green | Suite runs under `pnpm test`; this file is covered by `lint:md`. |

| Case | Scenario | Criteria exercised |
| --- | --- | --- |
| e2e-01 | Happy path probe -> complete; commitGate edge | real CLI/git/Markdown; commit |
| e2e-02 | `focus-required` blocks leg 1; fresh leg 2 with focus reaches terminal | yield; fresh-run legs |
| e2e-03 | Briefing gate not-pass -> briefing-retry -> complete | repair-edge retry |
| e2e-04 | `approval-required` yield -> pending-edge resume -> terminal | yield/resume |
| e2e-05 | Dangling `verified-by` -> `broken-relation` blocker -> `unrecoverable-blocker` | contract-violation detection |
| e2e-06 | `tasks-active` outranks `tasks-runnable` | task-graph routing |
| e2e-07a | Task dependency cycle -> `task-graph-to-planning` -> `budget-exhausted` | fail-closed task graph |
| e2e-07b | Duplicate task id -> `duplicate-task-id` -> `task-graph-to-planning` -> `budget-exhausted` | fail-closed task graph |
| e2e-07c | Duplicate artifact id -> `duplicate-id` hard blocker -> `input-required` | contract-violation detection |
| e2e-08 | Constraint-gap repair loop -> route-fingerprint `budget-exhausted` -> resume -> terminal | loopback, budgets, resume |
| e2e-09 | `commit-required` -> `mutateBefore` commit -> pending reuse -> terminal | commit gate + resume |
| e2e-10a/b/c | Missing proof / stale fingerprint / scope mismatch -> `authority-required` | outcome contract rejection |
| e2e-11 | Audit `retry` -> re-projection -> `completed` in one run | retry continuity |
| e2e-12a | `maxHops: 3` -> `budget-exhausted` after exactly 3 completed edges | hop budget |
| e2e-12b | Identical delegate retries -> `repeatedRetry` guard -> `budget-exhausted` | stall budget |
| e2e-12c | `current: "complete"` -> immediate terminal, zero hops | terminal idempotency |
| e2e-13a | No policy: declared `executionMode:"tool"` unchanged; zero `modeReason` emissions | additive trace schema |
| e2e-13b | Declared policy: `sharedJudgment`/`default` -> all-`same-context` + `modeReason`; still terminal | policy mode selection + reason tokens |
| e2e-13c | `isolated-subagent` on spec audit; `scope-mismatch` -> same `authority-required` as e2e-10c | mode-independent rejection |
| e2e-14a | Scripted pair creation with shared-judgment attribution; real pair audit | graph trace + artifact consistency |
| e2e-14c | Scripted partial pair -> briefing-retry delegate yields `input-required` -> pending resume repairs pair | yield/resume, audit receipt reuse, leg-boundary pair audits and checkpoint receipts |
| e2e-15a | Same-context path: spec-doc/adr-doc observed `inline-skill`, zero spawns, same graph dispatches as 15b | dispatch-observed boundary; requested==actual==trace |
| e2e-15b | Independent research observed `subagent-spawn` bounded to `docs/discovery/`; pair stays inline | real internal path difference at identical `effect-dispatched` counts |
| e2e-15c | Delegated path: research spawn, `input-required` yield, resume writes pair + late-arriving info | retry/yield/resume + late info on the delegated path |
| e2e-15d | Host lacks `subagent`: research declines `not-executed`, delegate yields `authority-required` | no silent same-context fallback |
| e2e-15e | Adapter reports `actual: same-context` while `subagent` was requested -> dispatch rejected | self-observation honesty gate |
| e2e-15f | Research write outside `writeScope` -> refused `not-executed` -> yield | unauthorized-change rejection on delegated path |
| e2e-15g | Delegate returns stale-fingerprint outcome on same-context path | stale-evidence rejection |
| e2e-15h | Executed research spawn returns stale evidence -> delegate yield | stale-evidence rejection on delegated path |
| e2e-15i | Policy delegates briefing-flow itself; caller-built handoff scopes writes; `actual: subagent` | requested mode -> handoff -> scoped execution -> observed actual |
| e2e-15j | Policy delegates briefing-flow but host lacks `subagent` -> top-level dispatch declines `not-executed` + `yield` | top-level capability refusal, no silent switch |

## What this harness does NOT verify

Deterministic E2E proves Graph/Tool/Artifact contract compliance and run
reproducibility only. It does not measure real-LLM output quality,
subagent-vs-same-context model quality, semantic document quality,
token/cost/latency improvements, or model skill-selection accuracy. Never
infer model-quality conclusions from case diffs or trace comparisons.
The dispatcher boundary IS observable now: `dispatch-observed` records what the
adapter actually ran (self-observation plus internal sub-dispatch records), and
e2e-15 compares the same-context pair path against the independent research
path at identical `effect-dispatched` counts. What it still cannot prove is
model quality — a scripted `subagent-spawn` record is the deterministic model
of a host adapter literally spawning a subagent, not the spawn itself, and a
scripted audit relabelled "research" would only prove a label, which is why
internal observations must describe real adapter behavior (scope-bounded,
capability-gated, refusable) rather than renamed fields.
e2e-14c exercises a two-leg resume after an EffectOutcome `yield`, not an
EffectOutcome `retry`. A separate harness test verifies an audited spec edit
between yield and resume is rejected as `authority-required`; the successful
case changes the spec only inside the resumed delegate after receipt validation.
The in-process oracle test (`doc-driven-dev-graph-run-to-yield.test.ts`)
and this spawned-CLI runner are two independent implementations of the
same contract; the runner additionally emits the #120 run-level trace
events a production caller owns.
