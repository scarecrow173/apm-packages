# Doc-Driven Dev Graph Run-to-Yield Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the deterministic one-edge router while allowing its effectful caller to checkpoint multiple edges in one execution run and return control only at an explicit semantic yield boundary.

**Architecture:** `route_graph.js` remains the stable one-edge routing primitive. The `doc-driven-dev-graph` caller owns the Run-to-Yield loop because this repository has no JavaScript host capable of invoking LLM skills; after every selected edge it runs audits, dispatches the declared delegate, persists canonical Markdown evidence, re-projects state, and routes again. Phase 2 standardizes the smallest useful delegate/audit outcome contract; Phase 3 adds an optional edge boundary to Graph Definition only if runtime evidence proves that skill-owned outcomes are insufficient.

**Tech Stack:** Markdown/YAML contracts, TypeScript 5.6, Node 20, `node:test` through `tsx`, esbuild, js-yaml, zod, markdownlint-cli2.

**Spec:** `C:\Users\akiyoshi\.codex\attachments\7693856e-6b01-4adf-a8c7-15ff2b955b36\pasted-text.txt`

## Global Constraints

- Keep `route_graph.js` as a one-edge primitive: one invocation projects state once and calls `evaluateRouteDecision()` exactly once.
- Preserve `GraphRoute` schema version 2 and its exact public keys through Phase 1 and Phase 2.
- Preserve routing order: terminal, hard blocker, prerequisite repair, prerequisite blocking, normal edge, fallback blocked.
- Never pre-route a later edge; finish audit, delegate, evidence persistence, and fresh state projection for edge N before asking for edge N+1.
- Graph Definition and canonical Markdown remain authorities; Graph State, Task Graph, run counters, and trace are derived execution data.
- Do not create SQLite, a JSON state database, a hidden mutable lifecycle store, or a generic policy engine.
- Preserve `single-step`; do not add `run-to-terminal` in Phase 1.
- Preserve explicit focus, approval, authority, irreversible-effect, and fail-closed rules; Run-to-Yield cannot infer permission from apparent safety.
- Keep English/Japanese package documents synchronized in meaning and structure.
- Edit TypeScript sources before generated JavaScript and regenerate with `pnpm --dir scripts/doc-driven-dev run build:scripts`.
- Preserve unrelated dirty files and stage only exact paths if an executor later commits this work.

---

## 1. Repository findings

### Ownership map

| Concern | Current authority | Evidence | Finding |
| --- | --- | --- | --- |
| Graph topology and binding | `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml` | 11 nodes, 44 edges, 30 conditions, one terminal, nine declared self-loop repair/retry edges | YAML declares routes, priorities, delegates, audits, and prerequisite gates; it declares no interaction/yield policy. |
| Definition parsing | `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/graph_definition.ts` | v2 zod/parser validation | Unknown endpoints/conditions, duplicate selectors/priorities, invalid prerequisites, and invalid terminal topology fail closed. |
| State projection | `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/graph_state.ts:214` | `projectGraphState()` | Canonical Markdown is scanned afresh; focus, gates, signals, blockers, hard blockers, and Task Graph are derived. |
| One-edge routing | `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/graph_router.ts:169` | `evaluateRouteDecision()` | It selects one edge or returns terminal/blocked. It does not run audits, delegates, evidence writes, or another route. |
| Public route CLI | `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/route_graph.ts:101` | one projection and one evaluator call | The CLI owns no execution loop. Generated `route_graph.js` is an esbuild output of this source. |
| Audit selection | Graph node `audits` projected by `graph_router.ts` | `GraphRoute.requiredAudits` | The router selects audit names; the caller runs them. |
| Delegate dispatch | `doc-driven-dev-graph/SKILL.md:74` and the caller | destination node `delegate` | The repository has no generic JS dispatcher for `briefing-flow`, `design-doc`, or `implementation-flow`; these are LLM-executed skills. |
| Evidence persistence | delegated skills and canonical Markdown writers | `execution-contract.md:17-20` | The graph does not write completion evidence. Delegates/scripts write domain artifacts; the caller re-projects afterward. |
| Caller loop | `doc-driven-dev-graph/SKILL.md:78` and `references/execution-contract.md:3` | prose/runtime instruction | The production execution host is the skill-capable caller, not a JS service. |
| Inspection | `inspect_graph.ts` and `graph_inspector.ts` | read-only JSON/Mermaid | Inspection does not route, dispatch, or persist state and should remain outside runtime effects. |
| Briefing subgraph | `briefing-flow/SKILL.md` | Assess through Gate phases | This delegate owns discovery/spec/ADR work and its internal loopbacks. |
| Implementation subgraph | `implementation-flow/SKILL.md:212` | Graph handoff contract | This delegate owns task execution, verification, review, and upstream repair signals. |
| Approval | `design-doc/SKILL.md:30` | user/designated reviewer approval | Approval is already a semantic skill boundary, but it is not represented in `GraphRoute`. |
| Exit audit | `doc-status/SKILL.md` | report-and-judge audit | `doc-status` returns Completable/Returned semantics; JS routing sees only later canonical signals/gates. |

### Topology facts relevant to budgets

- The live definition has 10 non-terminal nodes and one terminal node.
- Its normal no-migration path can reach `complete` in eight edges: `probe → briefing → design → planning → task-graph → implementation → followup-triage → exit-audit → complete`.
- Its migration-inclusive path reaches `complete` in 10 edges: `probe → migration → bootstrap → briefing → design → planning → task-graph → implementation → followup-triage → exit-audit → complete`.
- Nine non-terminal nodes have a declared self-loop retry/repair edge; `probe` is the only non-terminal without one.
- Multi-node repair cycles also exist, including implementation back to briefing/design and exit/follow-up repair back to upstream nodes.
- Therefore Phase 1 uses `maxHops = 10` by default: it is the current non-terminal-node count, covers the 10-edge migration path, and bounds a run once it begins revisiting topology. Terminal and blocked routes are evaluated before this budget. A caller may explicitly lower it; raising it requires an explicit user/runtime configuration and remains bounded.
- Phase 1 uses one completed traversal per self-loop edge per run. A second traversal of the same self-loop yields `budget-exhausted`; this is conservative until Phase 2 outcomes can distinguish a productive retry from an unchanged retry.

## 2. Current execution flow

```text
caller
  │
  ├─ route_graph.js --current N --json
  │    ├─ load Graph Definition v2
  │    ├─ projectGraphState(canonical Markdown)
  │    └─ evaluateRouteDecision() exactly once
  │
  ├─ run GraphRoute.requiredAudits
  ├─ dispatch GraphRoute.delegate
  ├─ persist completion/gate/follow-up evidence in Markdown
  ├─ retain GraphRoute.next for re-entry
  └─ return control after this turn
```

The router is already the desired one-edge primitive. The effect sequence and re-entry are caller-owned, but the current execution contract couples one caller turn to one edge.

## 3. Root cause

The stop-after-one-edge behavior is not implemented by recursive protection in `graph_router.ts`; the router simply has no recursion. The mandatory user-turn stop comes from the caller protocol:

- `references/execution-contract.md:9-24` names a per-turn protocol and explicitly forbids advancing multiple edges in the same turn.
- `SKILL.md:53` says the CLI never follows a second edge recursively; that protects one invocation and should remain.
- `SKILL.md:78-95` describes re-entry but does not define a same-run continuation mode, budgets, or semantic yield classification.
- `route_graph.ts:101-110` projects once and evaluates once, confirming the CLI is not an executor.
- `doc-driven-dev-graph-cli.test.ts:138` and `graph-router.test.ts:91` freeze one-edge CLI/router behavior, not one-edge-per-user-turn behavior.
- No JS module dispatches LLM skills or executes named audits, so a new recursive router or autonomous CLI would be unable to perform the required effects correctly.

The root cause is therefore a documentation/skill/caller protocol constraint. It is not a routing algorithm defect.

## 4. Design principles / invariants

1. One routing decision still means one declared edge.
2. An edge becomes checkpointed only after all required audits, the declared delegate, and canonical evidence persistence complete.
3. Checkpoint does not imply yield.
4. A later edge is selected only from a fresh state projection after the preceding checkpoint.
5. `GraphRoute.status` describes graph routing state; it does not describe user interaction or effect execution.
6. A terminal route is idempotent and always yields `terminal`.
7. A blocked route with no selected repair edge yields fail closed; the runtime never invents a transition.
8. A recoverable delegate/audit gap may continue only when it produces canonical evidence/signals that make a declared repair edge routable.
9. Approval, missing user input, missing authority, and irreversible external effects remain explicit boundaries.
10. Budget exhaustion always yields; it is never reinterpreted as success.
11. `single-step` checkpoints one edge and yields by mode, without changing the returned `GraphRoute`.
12. Ordered trace data is derived from actual `GraphRoute` values and effect outcomes; it never changes routing.
13. Resume re-projects canonical state. Run cursor/counters may be retained in the caller handoff, but they are not project truth.
14. A completed side effect may be skipped on resume only when canonical evidence or the effect system's idempotency key proves completion.
15. Generated JavaScript is rebuilt, never hand-edited.

## 5. Target Run-to-Yield architecture

```text
┌──────────────────────────────── effectful caller / skill runtime ────────────────────────────────┐
│ mode = single-step | run-until-yield                                                             │
│ current, hopCount, retriesByEdge, seenRouteFingerprints, ordered trace                           │
│                                                                                                  │
│ while true:                                                                                      │
│   route = invoke route_graph.js once(current, fresh inputs)                                      │
│   if route.status == terminal: yield(terminal)                                                   │
│   if route.status == blocked:  yield(classify fail-closed boundary)                              │
│   if budget would be exceeded: yield(budget-exhausted)                                           │
│   run route.requiredAudits in order                                                              │
│   dispatch only route.delegate                                                                   │
│   if audit/delegate requests input, approval, or authority: yield(the explicit reason)           │
│   persist canonical Markdown evidence                                                           │
│   append completed transition to deterministic trace                                             │
│   current = route.next                                                                           │
│   re-project by invoking the one-edge router again                                               │
│   if mode == single-step: yield(single-step-complete)                                             │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
                                      │ exactly one decision per invocation
                                      ▼
┌──────────────────────────── pure TypeScript/CLI routing core ─────────────────────────────────────┐
│ loadGraphDefinition → projectGraphState → evaluateRouteDecision → one GraphRoute                 │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
                         canonical Markdown and declared YAML
```

Phase 1 does not add `run_graph.js`. A JavaScript wrapper cannot invoke the actual LLM delegates in this repository, so such a command would either be misleading or require an unrequested plugin/host abstraction. The public skill runtime is the production caller loop.

The Phase 1 trace carried in the caller handoff is:

```ts
type GraphRunTrace = {
  mode: "single-step" | "run-until-yield";
  startNode: string;
  endNode: string;
  hopCount: number;
  maxHops: number;
  transitions: Array<{
    index: number;
    route: GraphRoute;
    auditsCompleted: string[];
    delegateCompleted: string | null;
    evidenceRecorded: boolean;
  }>;
  yieldReason:
    | "single-step-complete"
    | "terminal"
    | "approval-required"
    | "input-required"
    | "authority-required"
    | "unrecoverable-blocker"
    | "budget-exhausted";
};
```

This is a documentation/runtime handoff shape in Phase 1, not a new public TypeScript or JSON schema. Phase 2 decides whether it deserves a versioned contract after real delegate outcomes are normalized.

## 6. Phase 1 detailed implementation plan

### Task 1: Freeze router and CLI compatibility before changing the caller protocol

**Files:**

- Modify: `scripts/doc-driven-dev/tests/doc-driven-dev-graph-router.test.ts:91`
- Modify: `scripts/doc-driven-dev/tests/doc-driven-dev-graph-cli.test.ts:138`
- Test: the same two files

**Interfaces:**

- Consumes: `evaluateRouteDecision(input): RouteDecision`, `routeGraph(input): GraphRoute`, and source/generated `route_graph` CLIs.
- Produces: explicit assertions that one router/CLI invocation still returns one unchanged GraphRoute.

- [ ] **Step 1: Add a failing multi-edge-temptation compatibility test**

```ts
test("one route invocation never follows the selected destination", () => {
  const state = stateWith({ signals: ["first", "second"] });
  const route = routeGraph({ current: "alpha", definition, state });
  assert.equal(route.current, "alpha");
  assert.equal(route.next, "beta");
  assert.equal(route.edgeId, "alpha-to-beta");
  assert.equal(route.status, "edge");
});
```

Extend the existing fixture so `beta` also has a satisfied outgoing edge. Assert every public GraphRoute field rather than comparing wrappers around the same evaluator.

- [ ] **Step 2: Run the focused tests and record the baseline**

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-graph-router.test.ts tests/doc-driven-dev-graph-cli.test.ts`

Expected: PASS before protocol edits. If the exact-field assertion reveals an existing mismatch, fix the plan rather than changing routing in this phase.

- [ ] **Step 3: Add generated/source parity for the one-edge shape**

```ts
assert.deepEqual(JSON.parse(generated.stdout), JSON.parse(source.stdout));
assert.deepEqual(Object.keys(JSON.parse(source.stdout)).sort(), [
  "blockers", "condition", "current", "delegate", "edgeId", "graphId",
  "next", "requiredAudits", "schemaVersion", "status", "taskGraph",
]);
```

- [ ] **Step 4: Commit the compatibility lock**

```bash
git add scripts/doc-driven-dev/tests/doc-driven-dev-graph-router.test.ts scripts/doc-driven-dev/tests/doc-driven-dev-graph-cli.test.ts
git commit -m "test: lock one-edge graph routing compatibility"
```

### Task 2: Replace the one-edge-per-turn contract with a bounded caller-owned Run-to-Yield protocol

**Files:**

- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/references/execution-contract.md:3`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/references/execution-contract.ja.md:3`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/SKILL.md:78`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/SKILL.ja.md` at the matching Runtime loop section
- Modify: `packages/doc-driven-dev/AGENTS.md:10`
- Modify: `packages/doc-driven-dev/AGENTS.ja.md` at the matching runtime-contract section
- Test: `scripts/doc-driven-dev/tests/doc-suite.test.ts`

**Interfaces:**

- Consumes: one GraphRoute per CLI invocation and existing delegate/audit bindings.
- Produces: caller modes `single-step` and `run-until-yield`, ordered per-edge protocol, bounded counters, yield table, trace summary, and resume rules.

- [ ] **Step 1: Write failing public-contract assertions**

```ts
assert.match(contract, /checkpoint != yield/);
assert.match(contract, /single-step/);
assert.match(contract, /run-until-yield/);
assert.match(contract, /maxHops.*10/);
assert.match(contract, /route.*audit.*delegate.*evidence.*re-project/is);
assert.doesNotMatch(contract, /same turn must not.*multiple\s+edges/is);
assert.match(contractJa, /checkpoint.*yield/);
assert.match(contractJa, /同じ run.*複数 edge/);
```

Also assert that both skill documents continue to say that `route_graph.js` itself never recursively follows a second edge.

- [ ] **Step 2: Run the contract test and prove it fails**

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-suite.test.ts`

Expected: FAIL because the current execution contract prohibits same-turn multi-edge continuation and does not define modes or budgets.

- [ ] **Step 3: Rewrite the execution contract around completed checkpoints**

Use this normative sequence in both languages:

```text
For each selected edge:
1. Invoke route_graph.js exactly once for current.
2. Preserve the complete GraphRoute.
3. If terminal or blocked, evaluate the yield table and stop.
4. Check maxHops, the per-self-loop budget, and the full-GraphRoute fingerprint.
5. Run every required audit in stable order.
6. Dispatch only the returned delegate.
7. If an audit or delegate explicitly requires input, approval, or authority, yield without claiming the edge checkpoint complete.
8. Persist completion, gate, and follow-up evidence in canonical Markdown.
9. Mark the edge checkpoint complete and append it to the ordered trace.
10. Re-enter from next with a fresh state projection.
11. In single-step mode yield; in run-until-yield mode repeat.
```

Define the Phase 1 yield table exactly:

| Observation | Yield reason | Continue automatically |
| --- | --- | --- |
| `GraphRoute.status == terminal` | `terminal` | Never |
| explicit approval request from a skill or user-owned gate | `approval-required` | Never |
| explicit missing focus/requirement/value only the user can choose | `input-required` | Never |
| missing permission or irreversible external action outside granted scope | `authority-required` | Never |
| blocked route with no declared executable repair edge | `unrecoverable-blocker` | Never |
| hop/retry/repetition budget reached | `budget-exhausted` | Never |
| selected edge completed and fresh state exposes another declared edge | none | Yes in `run-until-yield` |
| audit/delegate/evidence success | none | Yes in `run-until-yield` |

- [ ] **Step 4: Define bounded autonomy without adding a policy DSL**

Document these algorithms:

```text
maxHops default = 10
  Rationale: current Graph Definition has 10 non-terminal nodes and the normal path is 8 edges.

self-loop budget = 1 completed traversal per edge ID per run
  A second traversal of the same from == to edge yields budget-exhausted.

route fingerprint = stable JSON serialization of the complete GraphRoute
  If the same fingerprint is observed again in the same run, yield budget-exhausted.

multi-node repair loop = bounded by both repeated fingerprint detection and maxHops
```

The fingerprint is computed before effects. Append it to `seenRouteFingerprints` only after the edge checkpoint completes; this allows resume of an interrupted, uncompleted edge without falsely classifying it as a completed loop.

- [ ] **Step 5: Define checkpoint/resume and duplicate-effect rules**

Add these exact requirements:

```text
- A completed checkpoint records route, completed audits, completed delegate, and evidenceRecorded=true in the caller handoff.
- Resume always re-projects canonical Markdown before routing again.
- Resume starts at the last completed route.next; an incomplete edge resumes only its uncompleted audit/delegate/evidence stages.
- A stage is skipped only when canonical evidence or the side-effect provider's idempotency key proves completion.
- If neither proof exists, yield authority-required rather than replaying a potentially irreversible effect.
- Run counters and trace may be retained in task/thread handoff metadata; they are not Graph State or project authority.
```

This provides same-task crash recovery. Cross-host recovery when both caller handoff and task/thread history are lost remains outside Phase 1; canonical Markdown alone currently does not encode the last runtime node or every external side-effect receipt.

- [ ] **Step 6: Update the public skill instructions**

Make `run-until-yield` the normal runtime mode. Keep `single-step` available when the user requests debugging, inspection, deterministic testing, or one-checkpoint execution. Keep `route_graph.js` examples unchanged as one-edge commands; do not add a misleading multi-edge CLI flag.

- [ ] **Step 7: Update package guidance without changing router ownership**

Change the package runtime summary to:

```text
Graph Definition -> fresh Graph State -> one declared route -> audit/delegate ->
canonical Markdown checkpoint -> re-project -> caller evaluates yield -> repeat or yield
```

- [ ] **Step 8: Run contract tests and commit paired documents**

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-suite.test.ts tests/doc-driven-dev-graph-cli.test.ts tests/doc-driven-dev-graph-router.test.ts`

Expected: PASS; one-edge tests remain unchanged while the same-turn prohibition is absent from both languages.

```bash
git add packages/doc-driven-dev/AGENTS.md packages/doc-driven-dev/AGENTS.ja.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/SKILL.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/SKILL.ja.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/references/execution-contract.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/references/execution-contract.ja.md scripts/doc-driven-dev/tests/doc-suite.test.ts
git commit -m "docs: define bounded run-to-yield graph execution"
```

### Task 3: Add executable acceptance scenarios for the caller protocol

**Files:**

- Create: `scripts/doc-driven-dev/tests/doc-driven-dev-graph-run-to-yield.test.ts`
- Modify: `scripts/doc-driven-dev/package.json` only if the new test path is not already matched; the current `tests/*.test.ts` glob should require no change.
- Test: the new file plus existing routing-contract and CLI tests

**Interfaces:**

- Consumes: the real `loadGraphDefinition()`, `projectGraphState()`, `routeGraph()`, and a test-local effect driver that mutates only canonical fixture Markdown/signals.
- Produces: scenario evidence for A–O without adding an unused production runtime abstraction.

- [ ] **Step 1: Create a minimal test-local driver**

```ts
type ScenarioStep = {
  expectEdge: string | null;
  applyEvidence?: (repo: string, signals: Set<string>) => void;
  yield?: "approval-required" | "input-required" | "authority-required";
};

function runScenario(options: {
  repo: string;
  current: string;
  mode: "single-step" | "run-until-yield";
  steps: ScenarioStep[];
  maxHops?: number;
}) {
  // Invoke the real projector and one-edge router once per step.
  // Apply fixture evidence only after the expected route is observed.
  // Re-project before the next route and return ordered routes plus yield reason.
}
```

The helper exists only in the test file. It must not duplicate condition evaluation or choose edges itself.

- [ ] **Step 2: Prove a fully automatic path checkpoints multiple edges**

Use a fixture whose evidence callbacks move `probe → briefing → design → planning → task-graph`. Assert four ordered GraphRoutes in one scenario run, a fresh projector call between each route, and no yield before the configured boundary.

- [ ] **Step 3: Prove approval and input boundaries yield exactly once**

Use a design delegate callback that returns `approval-required` before marking design approved, and a multi-chain fixture that projects `focus-required`. Assert no later route/effect runs and the pending edge is retained for resume.

- [ ] **Step 4: Prove resume does not repeat completed stages**

Serialize the test driver handoff after a completed edge and after an audit-complete/delegate-pending edge. Resume both. Assert completed audit/delegate counters remain one and the router starts from the last completed `next`.

- [ ] **Step 5: Prove recoverable implementation paths auto-continue**

Exercise these real declared routes with fixture evidence updates:

```text
implementation-retry
implementation-to-design -> design-to-planning
task-graph-to-planning -> planning-to-task-graph
implementation-to-followup-triage
```

Assert every subsequent decision occurs only after re-projection.

- [ ] **Step 6: Prove all safety stops**

Cover:

- second traversal of the same self-loop edge → `budget-exhausted`;
- a multi-node repair cycle reaching `maxHops` → `budget-exhausted`;
- repeated byte-identical GraphRoute fingerprint → `budget-exhausted`;
- terminal re-entry → one idempotent `terminal` yield;
- malformed graph/unknown signal/invalid focus → existing fail-closed error or `input-required`;
- blocked route without an edge → `unrecoverable-blocker`;
- `single-step` → exactly one completed checkpoint and `single-step-complete`.

- [ ] **Step 7: Prove evidence ordering and determinism**

Capture an event list and assert:

```ts
assert.deepEqual(events, [
  "route:edge-a", "audit:spec", "delegate:briefing-flow", "evidence:edge-a",
  "project", "route:edge-b",
]);
assert.deepEqual(secondRun.routes, firstRun.routes);
```

- [ ] **Step 8: Run the focused Phase 1 suite**

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-graph-run-to-yield.test.ts tests/doc-driven-dev-graph-router.test.ts tests/doc-driven-dev-graph-routing-contract.test.ts tests/doc-driven-dev-graph-cli.test.ts tests/doc-suite.test.ts`

Expected: PASS with no production router or schema edits.

- [ ] **Step 9: Commit the acceptance scenarios**

```bash
git add scripts/doc-driven-dev/tests/doc-driven-dev-graph-run-to-yield.test.ts
git commit -m "test: cover run-to-yield caller protocol"
```

### Task 4: Complete Phase 1 documentation parity and verification

**Files:**

- Modify: no additional production files unless lint or parity checks identify a paired-document omission.
- Test: focused Graph suite, markdown lint, generated parity, diff check

**Interfaces:**

- Consumes: Tasks 1–3.
- Produces: a reviewable Phase 1 release candidate with unchanged YAML/GraphRoute/generated router behavior.

- [ ] **Step 1: Confirm Phase 1 contains no schema or generated-runtime diff**

Run: `git diff -- packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/route_graph.ts scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/graph_router.ts packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/route_graph.js`

Expected: empty.

- [ ] **Step 2: Run focused Graph tests**

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-graph-definition.test.ts tests/doc-driven-dev-graph-definition-contract.test.ts tests/doc-driven-dev-graph-router.test.ts tests/doc-driven-dev-graph-routing-contract.test.ts tests/doc-driven-dev-graph-state.test.ts tests/doc-driven-dev-graph-cli.test.ts tests/doc-driven-dev-graph-run-to-yield.test.ts tests/doc-suite.test.ts`

Expected: PASS.

- [ ] **Step 3: Run document and patch checks**

Run: `pnpm --dir scripts/doc-driven-dev run lint:md`

Run: `git diff --check`

Expected: PASS; English/Japanese sections have matching order and meaning.

- [ ] **Step 4: Record disposable test-driver smoke evidence**

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test --test-name-pattern="bounded partial canonical|observes terminal after|single-step completes" tests/doc-driven-dev-graph-run-to-yield.test.ts`

Expected: PASS; the test-local driver uses the real definition, projector, and router to prove one `single-step` checkpoint, a deliberately partial multi-edge fixture, and a 10-edge `run-until-yield` sequence ending at terminal. Exhausting fixture steps with no yield is test-driver partial execution, not normal production completion. Phase 1 exposes no host caller-mode command, so there is no standalone host manual-smoke command to run.

- [ ] **Step 5: Commit any verification-only contract correction**

Commit only if Step 3 or Step 4 required a scoped document/test correction; otherwise create no empty commit.

## 7. Phase 2 detailed implementation plan

Phase 2 starts because Phase 1 scenarios consume already-normalized yield reasons and therefore do not prove that production free-form delegate/audit results map unambiguously to yield and resume behavior. It adds two small concepts and deliberately does not change GraphRoute:

```ts
type EffectOutcome =
  | { status: "completed"; evidence: string[] }
  | { status: "retry"; evidence: string[]; reason: string }
  | {
      status: "yield";
      reason: "input-required" | "approval-required" | "authority-required" | "unrecoverable-blocker";
      evidence: string[];
    };

type GraphRunResult = {
  status: "yielded";
  reason: EffectOutcome extends { status: "yield"; reason: infer R } ? R
    : "terminal" | "budget-exhausted" | "single-step-complete";
  trace: GraphRunTrace;
};
```

`blocked` is intentionally absent from `EffectOutcome`: it remains a GraphRoute/Graph State fact. `terminal` and budget reasons are runtime results, not delegate outcomes.

A completion receipt is valid only for the effect invocation it proves. Its scope binds the edge and stage, audit or delegate identity, authoritative input consumed by that effect, and canonical evidence or provider idempotency proof. Do not bind receipts to the byte-equivalent complete `GraphRoute`: unrelated route changes must not invalidate otherwise valid work.

### Task 5: Standardize minimal audit/delegate outcomes at the skill boundary

**Files:**

- Create: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/references/execution-outcome-contract.md`
- Create: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/references/execution-outcome-contract.ja.md`
- Modify: paired `doc-driven-dev-graph/SKILL.md` files
- Modify: paired `briefing-flow/SKILL.md` files
- Modify: paired `design-doc/SKILL.md` files
- Modify: paired `implementation-flow/SKILL.md` files
- Modify: paired `doc-status/SKILL.md` files
- Modify: `scripts/doc-driven-dev/package.json` markdown lint inputs
- Modify: `scripts/doc-driven-dev/tests/doc-suite.test.ts`
- Modify: `scripts/doc-driven-dev/tests/doc-driven-dev-graph-run-to-yield.test.ts`

**Interfaces:**

- Consumes: existing skill completion/gate/loopback semantics.
- Produces: one `EffectOutcome` footer from every graph-invoked audit/delegate and one `GraphRunResult` at yield.

- [ ] **Step 1: Write failing contract tests for exact statuses and reasons**

Require the receipt scope fields above for every completed effect outcome.

```ts
for (const text of [briefing, design, implementation, docStatus]) {
  assert.match(text, /status: completed \| retry \| yield/);
  assert.match(text, /evidence/);
}
assert.match(outcomeContract, /blocked.*GraphRoute|GraphRoute.*blocked/s);
assert.doesNotMatch(outcomeContract, /status: blocked/);
```

- [ ] **Step 2: Define the outcome contract once**

Specify required/forbidden fields for each variant, evidence paths/IDs rather than prose claims, and the rule that a `retry` is auto-continuable only after canonical evidence changes and a fresh route selects a declared edge.

- [ ] **Step 3: Map existing delegate semantics without adding new workflow states**

- `briefing-flow`: gate pass → `completed`; unresolved user-only requirement → `yield/input-required`; recoverable document gap → `retry`.
- `design-doc`: approved design → `completed`; awaiting designated reviewer → `yield/approval-required`; missing upstream user decision → `yield/input-required`.
- `implementation-flow`: verified task slice and implementation record → `completed`; declared spec/design/constraint repair → `retry`; missing permission for an irreversible effect → `yield/authority-required`; no safe declared repair → `yield/unrecoverable-blocker`.
- `doc-status`: Completable → `completed`; Returned with declared repair evidence → `retry`; Returned without safe repair → `yield/unrecoverable-blocker`.

- [ ] **Step 4: Update the caller yield evaluator**

Replace free-form semantic detection in the skill protocol with exact `EffectOutcome` matching. Keep terminal/blocked GraphRoute handling and budgets separate.

- [ ] **Step 5: Add resume and duplicate-side-effect scenarios**

Test a saved `completed` outcome, a pending approval outcome, a retry with changed evidence, and an irreversible effect without an idempotency key. Also test an `implementation-flow` receipt produced from Task Graph A, followed by a canonical Markdown change that projects Task Graph B: the old receipt must not skip the delegate unless its authoritative-input scope still matches. Assert only safe, scope-valid completed stages are skipped; missing proof yields `authority-required`.

- [ ] **Step 6: Run Phase 2 verification and commit in two reviewable units**

Commit 1: outcome contract and graph skill integration.

```bash
git add packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph packages/doc-driven-dev/.apm/skills/briefing-flow packages/doc-driven-dev/.apm/skills/design-doc packages/doc-driven-dev/.apm/skills/implementation-flow packages/doc-driven-dev/.apm/skills/doc-status scripts/doc-driven-dev/package.json scripts/doc-driven-dev/tests/doc-suite.test.ts
git commit -m "docs: define graph execution outcomes"
```

Commit 2: scenario coverage.

```bash
git add scripts/doc-driven-dev/tests/doc-driven-dev-graph-run-to-yield.test.ts
git commit -m "test: cover typed graph yield outcomes"
```

## 8. Phase 3 detailed implementation plan

### Phase 3 necessity gate

Do not implement Graph Definition v3 merely to restate skill-owned approval rules. Start Phase 3 only when Phase 1/2 traces contain at least two repeated cases where the runtime must know a boundary before dispatch and the delegate outcome arrives too late to prevent the effect.

If that gate is not met, runtime policy plus typed outcomes is sufficient and Phase 3 is closed with no schema change.

If the gate is met, add only optional edge boundary metadata. Do not add node `interaction: auto`; auto is the default and the field carries no information. Do not add authority inheritance, risk classes, effect classes, or retry policy until a separate concrete use case requires one.

```yaml
schemaVersion: 3
edges:
  - id: design-to-planning
    from: design
    to: planning
    when: design
    priority: 30
    boundary:
      type: approval
      reason: design-signoff
```

### Task 6: Add minimal optional edge boundaries with v2 compatibility

**Files:**

- Modify: `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/graph_definition.ts`
- Modify: `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/graph_inspector.ts`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml`
- Modify: paired `references/graph-contract.md` files
- Modify: paired `references/graph-inspection.md` files
- Modify: paired `SKILL.md` files
- Modify: definition/inspection/CLI/doc-suite tests
- Generated: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/*.js` through `build:scripts`

**Interfaces:**

- Consumes: schema v2 definitions with no boundary and schema v3 definitions with optional `edge.boundary`.
- Produces: `GraphBoundary = { type: "approval"; reason: string }` for runtime pre-dispatch yield evaluation; GraphRoute remains unchanged.

- [ ] **Step 1: Write v2/v3 parser compatibility tests**

```ts
assert.equal(parseGraphDefinition(v2Fixture).schemaVersion, 2);
assert.deepEqual(parseGraphDefinition(v3Fixture).edges[0].boundary, {
  type: "approval",
  reason: "design-signoff",
});
assert.throws(() => parseGraphDefinition(v3UnknownBoundary), /boundary|approval/);
```

- [ ] **Step 2: Implement the smallest schema extension**

Accept schema versions 2 and 3. For v2, reject boundary fields. For v3, allow only `type: approval` and a non-empty stable reason. Preserve every existing endpoint, condition, priority, terminal, and prerequisite validation.

- [ ] **Step 3: Expose boundary data through definition inspection, not GraphRoute**

Add boundary to serialized inspection edge entries and Mermaid labels. Keep normal `route_graph.js --json` keys byte-compatible with v2.

- [ ] **Step 4: Evaluate boundary before effects in the caller**

When the selected edge has an unsatisfied approval boundary, return `approval-required` before audits/delegate execution. A scoped approval in caller context may satisfy the boundary; Graph State and YAML do not become a permission database.

- [ ] **Step 5: Migrate only evidence-backed boundaries**

Change the distributed definition to schema v3 and annotate only the edges identified by the necessity gate. Do not annotate every edge or node.

- [ ] **Step 6: Regenerate and verify**

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-graph-definition.test.ts tests/doc-driven-dev-graph-definition-contract.test.ts tests/doc-driven-dev-graph-inspector.test.ts tests/doc-driven-dev-graph-cli.test.ts tests/doc-driven-dev-graph-run-to-yield.test.ts`

Run: `pnpm --dir scripts/doc-driven-dev run build:scripts`

Run: `pnpm --dir scripts/doc-driven-dev run lint:md`

Run: `git diff --check`

Expected: v2 fixtures remain valid, v3 boundary failures close safely, normal GraphRoute JSON is unchanged, inspection/Mermaid is deterministic, and generated JS matches source.

## 9. File-by-file change matrix

| File | Phase | Change | Reason | Compatibility |
| --- | --- | --- | --- | --- |
| `doc-driven-dev-graph/references/execution-contract.md` and `.ja.md` | 1 | Replace per-turn stop with bounded modes, checkpoint/yield split, budgets, trace, resume rules | This is the root authority for caller execution semantics | One-edge CLI unchanged |
| `doc-driven-dev-graph/SKILL.md` and `.ja.md` | 1 | Make Run-to-Yield normal; retain single-step and exact effect order | This is the production skill runtime | Existing route examples remain valid |
| `packages/doc-driven-dev/AGENTS.md` and `.ja.md` | 1 | Update runtime summary | Keep package guidance aligned | No code behavior change |
| `graph-router.test.ts` | 1 | Assert all GraphRoute fields on one-edge temptation | Prevent routing-core drift | Strengthens v2 contract |
| `graph-cli.test.ts` | 1 | Source/generated exact route parity | Prevent generated/public drift | Exact keys remain v2 |
| `doc-suite.test.ts` | 1/2 | Assert bilingual runtime/outcome contracts | Treat skill prose as executable public policy | No runtime schema change |
| `doc-driven-dev-graph-run-to-yield.test.ts` | 1/2 | Test-local effect driver and A–O scenarios | Verify sequencing without unused production abstraction | Calls real projector/router |
| `execution-outcome-contract.md` and `.ja.md` | 2 | Define minimal EffectOutcome and GraphRunResult | Separate graph block from control yield | GraphRoute unchanged |
| paired delegate/audit skills | 2 | Emit one exact outcome footer when graph-invoked | Remove free-form boundary ambiguity | Standalone workflows keep their content |
| `graph_definition.ts` | 3 conditional | Parse v2 plus minimal v3 edge approval boundary | Only if pre-dispatch policy is proven necessary | v2 remains accepted |
| `graph_inspector.ts`, inspection refs/tests | 3 conditional | Project boundary metadata read-only | Observability without routing mutation | Existing fields retained |
| `doc-driven-dev.yaml` | 3 conditional | v3 and only proven boundary annotations | Declarative pre-dispatch approval | No Phase 1/2 change |
| generated JS | 3 conditional | Rebuild from TypeScript | Distributed parity | Never hand-edited |

Files intentionally unchanged in Phase 1 and Phase 2: `route_graph.ts`, `graph_router.ts`, `graph_state.ts`, `graph_definition.ts`, `inspect_graph.ts`, `build_task_graph.ts`, Graph Definition YAML, GraphRoute contract, Graph State contract, Task Graph contract, and generated JavaScript.

## 10. Test plan

| ID | Layer | Concrete case | Expected evidence |
| --- | --- | --- | --- |
| A | Integration/scenario | Fully automatic route across at least four declared edges | One run, ordered checkpoints, no intermediate user yield |
| B | Integration/scenario | Design delegate requests approval | Exactly one `approval-required`; no later effect |
| C | Integration/scenario | Resume after approval | Completed audit/delegate counts remain one |
| D | State/scenario | Multiple chains produce `focus-required` | `input-required`; no guessed focus or repair |
| E | Routing/scenario | Implementation/design/task-graph repair edge exists | Auto-continue after changed canonical evidence |
| F | Runtime/scenario | Same self-loop selected twice | `budget-exhausted` on second traversal |
| G | Runtime/scenario | Multi-node cycle reaches 10 hops | `budget-exhausted`, deterministic trace |
| H | Router/CLI | Re-enter `complete` | Idempotent terminal route and one terminal yield |
| I | Integration/scenario | Evidence callback between edge A and route B | event order proves evidence then projection then B |
| J | Router/scenario | Same artifacts/signals/focus | Byte-equivalent ordered GraphRoutes |
| K | Unit/CLI | Destination also has satisfied edge | `route_graph` returns only first edge |
| L | Integration/scenario | `single-step` mode | One completed checkpoint and mode yield |
| M | Integration/scenario | Save handoff after checkpoint and resume | Starts from saved `next`, re-projects Markdown |
| N | Phase 2 integration | Saved effect receipt or provider idempotency key | No duplicate; missing proof yields authority-required |
| O | Definition/state/CLI | Invalid topology, malformed state selector, unknown signal | Existing nonzero/fail-closed behavior |
| P | Deferred host contract | Host-facing stable user summary | Deferred until a host owns the summary contract; Phase 1 asserts structured handoff and trace data |
| Q | Documentation | English/Japanese mode, order, yield, and budget sections | Matching assertions and markdown lint |

Phase 1 does not define a host-facing summary formatter or golden text. Its test-local driver asserts structured routes, checkpoints, edge traces, and the final handoff `yieldReason`. Add a golden only when a later phase identifies the host that owns the rendering contract.

## 11. Failure modes and mitigations

| Failure | Cause | Mitigation | Detection |
| --- | --- | --- | --- |
| Infinite retry | self-loop keeps routing after unchanged work | one traversal per self-loop edge per run; repeated full-route fingerprint stop | F |
| Repair loop | multi-node repair cycles keep changing nodes | maxHops 10 plus repeated route fingerprint | G |
| Stale state | next edge selected before evidence write/reprojection | normative edge order; real projector called per scenario step | I |
| Duplicate side effects | resume replays completed delegate/audit | checkpoint stage receipts; skip only with canonical/provider proof | C, N |
| Approval bypass | caller treats a completed document write as approval | explicit design outcome; agents cannot self-approve | B |
| Input-required bypass | focus or requirement guessed | hard blocker and exact `input-required` mapping | D |
| State divergence | trace/counters treated as project truth | derived handoff only; fresh canonical projection owns routing | I, M |
| Hidden mutable state | runtime creates a second project database | no runtime DB; caller task/thread handoff only | doc contract test |
| Audit skipping | continuation routes before all audits | append checkpoint only after stable ordered audit completion | I |
| Premature checkpoint | delegate yields midway but edge marked complete | pending route retained; `evidenceRecorded` must be true | B, C |
| False loop positive | route repeats after visible task progress | fingerprint includes complete GraphRoute including Task Graph | F |
| Unbounded autonomy after topology growth | happy path exceeds old budget | topology contract test reports node/path change; review default before release | definition/inspection test |
| Misleading JS runtime | wrapper claims to execute skills but cannot | no `run_graph.js` until a real host dispatch API exists | file matrix check |

## 12. Backward compatibility / migration

Phase 1 is a caller-behavior change, not a route/schema change:

- Existing consumers invoking `route_graph.js` directly receive the exact v2 GraphRoute.
- Existing scripts that manually call one edge continue to work.
- Debuggers select `single-step`; it recreates current behavior after one completed checkpoint.
- Normal skill invocation defaults to `run-until-yield` after the contract release.
- Rollback requires only switching the skill default back to `single-step`; router/YAML/generated JS are untouched.
- Phase 2 adds skill return text/structure but does not change routing input/output.
- Phase 3, if activated, accepts v2 and v3 definitions. A v2 definition means no graph-declared pre-dispatch boundary and continues using typed skill outcomes.

Migration sequence:

1. Release Phase 1 documentation and scenario tests with Run-to-Yield default plus explicit single-step escape hatch.
2. Observe ambiguous outcomes and resume failures; do not infer new schema needs from hypothetical cases.
3. Release Phase 2 outcome footer across all graph-invoked skills in one synchronized package change.
4. Activate Phase 3 only after the necessity gate; retain v2 parser compatibility for at least one package release cycle.

Rollback sequence:

1. Set caller mode to `single-step` in both skill documents.
2. Leave Graph Definition, GraphRoute, state projection, and generated JS in place.
3. Keep trace/evidence already written; it is observational and canonical evidence remains valid.
4. If Phase 2 caused ambiguity, ignore typed footers and use single-step/manual user confirmation while correcting the contract.
5. If Phase 3 is rolled back, revert YAML to schema v2 and remove boundary fields; the dual-version parser can remain until its deprecation window ends.

## 13. Suggested commit sequence

1. `test: lock one-edge graph routing compatibility`
2. `docs: define bounded run-to-yield graph execution`
3. `test: cover run-to-yield caller protocol`
4. `docs: define graph execution outcomes` — Phase 2
5. `test: cover typed graph yield outcomes` — Phase 2
6. `feat: parse graph approval boundaries` — Phase 3 only after gate
7. `docs: publish graph definition v3 boundaries` — Phase 3 only after gate and generated build

Each commit has an independent rejection boundary: router compatibility, execution policy, executable acceptance coverage, typed effect contract, typed scenarios, parser/inspection capability, and public v3 migration.

## 14. Open questions

Only two questions remain unresolved by repository code:

1. Does every supported APM host persist task/thread handoff metadata across a process crash? Phase 1 can resume within a preserved task from the last completed `next`, but the repository has no host API contract proving cross-host persistence.
2. Which external side-effect providers used by future delegates expose idempotency keys or durable receipts? Canonical Markdown proves document/task progress, but it cannot prove every external effect. Until a provider contract exists, the safe result is `authority-required` before replay.

The following are not open questions: routing loop ownership is caller-side; `route_graph.js` is one-edge; Graph State is reprojected; Markdown/YAML are authoritative; design approval is user/reviewer-owned; TypeScript is generated-JS authority.

## 15. Final recommendation

### Required decisions

- **A. Phase 1 Graph Definition schema change:** No. Yield is execution control, and the current YAML already declares every route/repair edge needed for Phase 1.
- **B. Phase 1 GraphRoute schema change:** No. GraphRoute correctly represents one routing decision; trace/outcome data belongs outside it.
- **C. Execution-loop authority:** Composite, with the effectful skill-capable caller authoritative for looping and the JS CLI authoritative only for each one-edge decision. Skill instructions and execution contract are the production runtime policy.
- **D. Yield-decision authority:** The caller runtime, using GraphRoute terminal/blocked facts, explicit audit/delegate outcomes, granted authority, and run budgets. The router must not decide interaction policy.
- **E. Phase 2 typed outcome location:** A shared paired execution-outcome reference consumed by `doc-driven-dev-graph` and emitted by each graph-invoked skill. Do not define an unused TypeScript enum in the router package.
- **F. Phase 3 necessity:** Not currently proven. Phase 1/2 runtime policy is sufficient for known approval/input/repair cases. Add v3 optional edge approval boundaries only when traces prove a pre-dispatch boundary cannot be expressed safely by typed skill outcomes.

Implement Phase 1 first as a contract-and-acceptance-test change. It delivers the requested transition-boundary/user-boundary split with the smallest viable change, preserves every routing invariant, and keeps rollback to single-step immediate.

## Self-review

- Spec coverage: current ownership, root cause, target architecture, three phases, invariants, failure modes, A–O tests, migration, rollback, commit order, open questions, and decisions A–F all map to explicit sections/tasks.
- Placeholder scan: every implementation step names exact files, assertions, algorithms, commands, or gate criteria.
- Type consistency: `GraphRoute` remains v2; `EffectOutcome` owns effect status; `GraphRunResult` owns yield; `blocked` remains graph state/routing status.
- Scope check: Phase 1 is independently shippable; Phase 2 is independently gated by observed ambiguity; Phase 3 is independently gated by proven pre-dispatch policy need.
