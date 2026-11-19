# Graph Effect Outcome Contract

This is the caller-facing contract for a graph-invoked audit or delegate. It is
documentation, not a public TypeScript schema or a new Graph State object.
Each invoked effect returns exactly one `EffectOutcome` footer; a caller returns
one `GraphRunResult` when it yields.

## EffectOutcome footer

Every footer has this scope. References are typed and bound to live state:
`kind` names the reference class — a `durable-document` is canonical Markdown
located by `path` + front-matter `id` and pinned by `revision` (its canonical
content fingerprint); an `execution-task` is a task record inside the run's
Execution Store, pinned by `runId` + `taskId` + CAS `version`; a `provider`
reference carries its `idempotencyKey`. Record references, not prose claims
that work was completed.

```yaml
status: completed
edgeId: implementation-retry
stage: delegate
effect: { kind: delegate, id: implementation-flow }
inputs:
  - { kind: execution-task, runId: RUN-7QwErTyUiOpAsDfGhJkLmN, taskId: TASK-0H5nCkR2mW9xVbYqZeLp3s, version: 1 }
outputs:
  - { kind: durable-document, path: docs/knowledge/example-finding.md, id: KNOW-5RfVgTgBnHkLmQwErTyUiO, revision: sha256:evidence }
proof: { kind: durable-document, path: docs/knowledge/example-finding.md, id: KNOW-5RfVgTgBnHkLmQwErTyUiO, revision: sha256:evidence }
```

```yaml
status: retry
edgeId: implementation-to-design
stage: delegate
effect: { kind: delegate, id: implementation-flow }
inputs:
  - { kind: execution-task, runId: RUN-7QwErTyUiOpAsDfGhJkLmN, taskId: TASK-0H5nCkR2mW9xVbYqZeLp3s, version: 1 }
outputs:
  - { kind: durable-document, path: docs/designs/graph.md, id: DESIGN-2XyZaBcDeFgHiJkLmNoPqR, revision: sha256:changed }
retry:
  changedOutputs:
    - { kind: durable-document, path: docs/designs/graph.md, id: DESIGN-2XyZaBcDeFgHiJkLmNoPqR, revision: sha256:changed }
```

```yaml
status: yield
edgeId: implementation-retry
stage: delegate
effect: { kind: delegate, id: implementation-flow }
inputs:
  - { kind: execution-task, runId: RUN-7QwErTyUiOpAsDfGhJkLmN, taskId: TASK-0H5nCkR2mW9xVbYqZeLp3s, version: 1 }
outputs:
  - { kind: durable-document, path: docs/knowledge/example-finding.md, id: KNOW-5RfVgTgBnHkLmQwErTyUiO, revision: sha256:checkpoint }
reason: authority-required
```

The status variant adds these required and forbidden fields:

| Status | Required | Forbidden |
| --- | --- | --- |
| `completed` | `proof` as a `durable-document` reference (`kind`, `path`, `id`, `revision`) or a `provider` reference (`kind: provider`, `provider`, `idempotencyKey`) | `reason`, `retry` |
| `retry` | `retry.changedOutputs` with the changed canonical references | `proof`, `reason` |
| `yield` | `reason`: `approval-required`, `input-required`, `authority-required`, `unrecoverable-blocker`, or `commit-required` | `proof`, `retry` |

`outputs` records the canonical outputs for every outcome. A `completed`
outcome additionally proves this particular effect: either a durable-document
proof binds its produced canonical content or a provider reference proves an
irreversible external effect by its idempotency key. Do not use a route
fingerprint as the proof.

Accepted `completed` outcomes are persisted as Effect Receipts in the run's
Execution Store (`.apm/state/doc-driven-dev/runs/<runId>/receipts/`); the edge
checkpoint follows in `checkpoints/`. These receipts are execution-side proof
that effects completed — they are not Verification Evidence, which belongs to
the verification-side store.

## GraphRunResult at yield

`GraphRunResult` is a caller/documentation shape, not a public TypeScript
export. The caller returns it only when it yields. Its `route` is the complete
final `GraphRoute`, including terminal and blocked results, rather than a
receipt-derived subset.

```ts
type GraphRunResult = {
  status: "yielded";
  reason:
    | "approval-required"
    | "input-required"
    | "authority-required"
    | "unrecoverable-blocker"
    | "commit-required"
    | "budget-exhausted"
    | "terminal"
    | "single-step-complete";
  route: GraphRoute;
  outcomes: EffectOutcome[];
  trace: GraphRunTrace[];
  handoff: GraphRunHandoff;
}

type GraphRunTrace = {
  route: GraphRoute;
  outcomes: EffectOutcome[];
  completedAudits: string[];
  delegate: string | null;
  delegateComplete: boolean;
  evidenceRecorded: boolean;
  checkpointComplete: boolean;
  commitWaived: boolean;
}

type GraphRunHandoff = {
  runId: string;
  current: string;
  mode: "single-step" | "run-until-yield";
  maxHops: number;
  maxDispatchesPerEdge: number;
  maxTotalDispatches: number;
  yieldReason: GraphRunResult["reason"] | null;
  focus: string[];
  signals: string[];
  graphPath: string;
  completedEdges: string[];
  seenRouteFingerprints: string[];
  taskBudgetCount: number | null;
  auditCounts: Record<string, number>;
  delegateCounts: Record<string, number>;
  checkpoints: GraphRoute[];
  edgeTrace: GraphRunTrace[];
  outcomes: EffectOutcome[];
  pending: {
    route: GraphRoute;
    outcomes: EffectOutcome[];
    completedAudits: string[];
    delegateComplete: boolean;
    evidenceRecorded: boolean;
    evidenceCheckpointId: string | null;
    commitBaseline: { head: string | null; dirty: string[] } | null;
    dispatches: number;
  } | null;
  totalDispatches: number;
  hops: number;
}
```

`outcomes` and `trace` preserve caller order. `GraphRunTrace` holds each
complete route, its ordered outcomes, completed audits, delegate state, and
evidence/checkpoint flags. `commitWaived` is `true` when the edge's
destination declares `commitGate` and the caller applied the declared
`commit-waived` signal for that edge, and `false` otherwise; this is how a
waived gate is recorded in the run trace. `GraphRunHandoff` retains the
resume fields: `runId` binds the Execution Store run every receipt and
checkpoint was recorded under,
`current`, mode, `maxHops`, the per-edge dispatch budget `maxDispatchesPerEdge`,
the run-level dispatch bound `maxTotalDispatches`,
focus, signals, graph path, completed edge IDs,
seen route fingerprints, the frozen task-budget basis, audit/delegate counters,
the accumulated `totalDispatches` count,
completed routes, trace, outcomes, pending edge, and hop count. `null` means
the caller supplied an explicit `maxHops`; a non-negative number is the
immutable dynamic-default basis. The pending edge's `evidenceCheckpointId`
names the Execution Store checkpoint its evidence phase recorded, so a resume
verifies the checkpoint record rather than trusting the flag alone.

## Caller-normalized effects

Skills that can emit the footer return it directly. The caller adapter
normalizes these declared effects into the same `EffectOutcome` shape without
changing Graph Definition YAML, scripts, or generated JavaScript:

| Declared effects | Footer owner |
| --- | --- |
| `migrate_docs`, `scaffold_docs`, `build_task_graph` | caller adapter for script delegates |
| `spec`, `adr`, `design`, `verification`, `knowledge`, `all` | caller adapter for named audits |
| `briefing-flow`, `design-doc`, `planning-flow`, `implementation-flow`, `knowledge-doc`, `doc-status` | invoked skill |

Under Document Registry 3 the legacy `plan`, `task`, and `test-spec` audit
names are refused scopes — `audit_docs.js --type <name>` fails at the
registry gate (`plan`/`task` are execution-bound; `test-spec` is a legacy
migration-only format) — and they appear in no v3 `audits:` list.

The adapter records effect-specific canonical inputs and outputs before it
returns `completed` or `retry`. Missing or malformed adapter outputs fail
closed with `authority-required`; the caller never records a receipt or edge
checkpoint for them.

## Effect-specific canonical inputs

The receipt scope uses the effect, not a generic Task Graph fallback. In the
standard document graph, `spec`, `adr`, and `design` audits read their
matching canonical document; `verification` reads the durable Verification
Design document; `knowledge` reads the durable knowledge record; and `all`
reads the declared durable document set.
Graph-dispatched doc-type audits run as
`audit_docs.js --type <name> --profile artifact` and `all` runs as
`audit_docs.js --type all --profile artifact`. The `artifact` profile evaluates
canonical-document integrity only, so a missing or stale index never gates
graph execution. `briefing-flow` reads the spec and ADR, `design-doc`
reads the spec and ADR and records design evidence, `planning-flow` reads the
selected approved design and records the selected run's `plan.md` and all
produced task records, `implementation-flow` reads the selected run's task
records plus the design, and records its
Implementation Record, `knowledge-doc` reads the durable knowledge and
verification documents and records the knowledge record, and
`doc-status` reads the declared document set. Script-adapter inputs are
`migrate_docs` (declared document set), `scaffold_docs` (workspace-root bootstrap input), and
`build_task_graph` (selected run's `plan.md` plus its task records). Store
paths are state-root-relative inside the run tree — the repo-relative form
`.apm/state/doc-driven-dev/runs/<run-id>/...` is what a canonical reference
records. Every referenced typed reference must resolve against current
state before use.

## Existing delegate meanings

This contract renders existing semantics; it does not add workflow states.

| Effect | `completed` | `retry` | `yield` |
| --- | --- | --- | --- |
| `briefing-flow` | briefing gate passes | recoverable document gap | `input-required` for an unresolved user-only requirement |
| `design-doc` | design is approved | — | `approval-required` for its designated reviewer; `input-required` for an upstream user decision |
| `planning-flow` | digest-approved run plan plus materialized task records | changed run plan/task repair evidence | `approval-required` when plan review is pending; `input-required` when a user-owned planning choice is missing; `unrecoverable-blocker` when no declared safe repair exists |
| `implementation-flow` | task slice is verified and its Implementation Record is complete | declared spec/design/constraint repair | `commit-required` when its slice produced changes it cannot commit within granted authority; `authority-required` for an irreversible effect without permission; `unrecoverable-blocker` when no declared safe repair exists |
| `knowledge-doc` | the consolidation decision is recorded (integrated findings or a deliberate no-op) | recoverable knowledge-document gap | `input-required` for a user-owned consolidation choice |
| `doc-status` | documents are Completable | Returned with declared repair evidence | `unrecoverable-blocker` when Returned has no safe repair |

## Exact caller evaluation

The caller first evaluates terminal or blocked `GraphRoute` results and its
hop/repetition budgets under the [execution contract](execution-contract.md).
It then matches `EffectOutcome.status` and, for `yield`, `reason` exactly; it
does not infer a result from free-form delegate prose.

- `completed` may skip only this scoped audit or delegate stage after its input
  scope, recorded receipt, outputs, and proof validate.
- `retry` is auto-continuable only after its declared changed outputs are
  re-projected and a fresh route selects a declared edge.
- `yield` stops with its exact reason.

At yield, the caller records a `GraphRunResult` handoff containing the complete
`GraphRoute`, ordered `EffectOutcome` footers, bounded counters/trace, and the
final yield reason. The retained route supports topology, terminal/blocked,
and budget evaluation. Receipt validity binds only `edgeId`, stage, effect,
input scope, outputs, and proof; it never requires byte-equivalent
complete `GraphRoute` objects.

## Resume and duplicate effects

Re-project state — canonical Markdown and the selected run's Execution Store
records — before comparing a saved receipt. A pending
`completed` stage is reused only when a recorded Effect Receipt in the run's
Execution Store attests the same `edgeId`, stage, effect, input binding, and
output/proof result, the fresh route resolves the same input scope (the same
multiset of typed references), and every bound output plus the proof still
resolves current state. Missing proof or a missing receipt yields
`authority-required` rather than replaying an irreversible effect.

For example, an `implementation-flow` receipt scoped to Task Graph A cannot
skip that delegate after the run projects Task Graph B. It becomes
eligible only if its authoritative-input scope still matches the fresh graph.
