# Graph Effect Outcome Contract

This is the caller-facing contract for a graph-invoked audit or delegate. It is
documentation, not a public TypeScript schema or a new Graph State object.
Each invoked effect returns exactly one `EffectOutcome` footer; a caller returns
one `GraphRunResult` when it yields.

## EffectOutcome footer

Every footer has this scope. Record canonical paths, IDs, and fingerprints, not
prose claims that work was completed.

```yaml
status: completed
edgeId: implementation-retry
stage: delegate
effect: { kind: delegate, id: implementation-flow }
authoritativeInputs:
  - { path: docs/tasks/0001-task.md, id: TASK-0001, fingerprint: sha256:input }
evidence:
  - { path: docs/impl/ir/0001-task.md, id: IMPL-0001, fingerprint: sha256:evidence }
proof:
  canonicalEvidence: { path: docs/impl/ir/0001-task.md, id: IMPL-0001, fingerprint: sha256:evidence }
```

```yaml
status: retry
edgeId: implementation-to-design
stage: delegate
effect: { kind: delegate, id: implementation-flow }
authoritativeInputs:
  - { path: docs/tasks/0001-task.md, id: TASK-0001, fingerprint: sha256:before }
evidence:
  - { path: docs/designs/0001-graph.md, id: DESIGN-0001, fingerprint: sha256:changed }
retry:
  changedEvidence:
    - { path: docs/designs/0001-graph.md, id: DESIGN-0001, fingerprint: sha256:changed }
```

```yaml
status: yield
edgeId: implementation-retry
stage: delegate
effect: { kind: delegate, id: implementation-flow }
authoritativeInputs:
  - { path: docs/tasks/0001-task.md, id: TASK-0001, fingerprint: sha256:input }
evidence:
  - { path: docs/impl/ir/0001-task.md, id: IMPL-0001, fingerprint: sha256:checkpoint }
reason: authority-required
```

The status variant adds these required and forbidden fields:

| Status | Required | Forbidden |
| --- | --- | --- |
| `completed` | exactly one `proof.canonicalEvidence` (`path`, `id` when present, `fingerprint`) or `proof.providerIdempotency` (`provider`, `key`) | `reason`, `retry` |
| `retry` | `retry.changedEvidence` with the changed canonical path/ID/fingerprint | `proof`, `reason` |
| `yield` | `reason`: `approval-required`, `input-required`, `authority-required`, or `unrecoverable-blocker` | `proof`, `retry` |

`evidence` records the canonical checkpoint for every outcome. A `completed`
outcome additionally proves this particular effect: either canonical evidence
proves it or the external provider idempotency key proves it. Do not use a
route fingerprint as the proof.

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
}

type GraphRunHandoff = {
  current: string;
  mode: "single-step" | "run-until-yield";
  maxHops: number;
  yieldReason: GraphRunResult["reason"] | null;
  focus: string[];
  signals: string[];
  graphPath: string;
  completedEdges: string[];
  seenRouteFingerprints: string[];
  selfLoopCounts: Record<string, number>;
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
  } | null;
  hops: number;
}
```

`outcomes` and `trace` preserve caller order. `GraphRunTrace` holds each
complete route, its ordered outcomes, completed audits, delegate state, and
evidence/checkpoint flags. `GraphRunHandoff` retains the resume fields:
`current`, mode, `maxHops`, focus, signals, graph path, completed edge IDs,
seen route fingerprints, self-loop/audit/delegate counters, completed routes,
trace, outcomes, pending edge, and hop count.

## Caller-normalized effects

Skills that can emit the footer return it directly. The caller adapter
normalizes these declared effects into the same `EffectOutcome` shape without
changing Graph Definition YAML, scripts, or generated JavaScript:

| Declared effects | Footer owner |
| --- | --- |
| `migrate_docs`, `scaffold_docs`, `build_task_graph` | caller adapter for script delegates |
| `spec`, `adr`, `design`, `plan`, `task`, `impl-record`, `all` | caller adapter for named audits |
| `briefing-flow`, `design-doc`, `planning-flow`, `implementation-flow`, `doc-status` | invoked skill |

The adapter records effect-specific canonical inputs and evidence before it
returns `completed` or `retry`. Missing or malformed adapter evidence fails
closed with `authority-required`; it never creates a checkpoint or completion
receipt.

## Effect-specific canonical inputs

The receipt scope uses the effect, not a generic Task Graph fallback. In the
standard document graph, `spec`, `adr`, `design`, and `plan` audits read their
matching canonical document; `task` reads selected Task Graph task documents;
`impl-record` reads its Implementation Record; and `all` reads the declared
canonical document set. `briefing-flow` reads the spec and ADR, `design-doc`
reads the spec and ADR and records design evidence, `planning-flow` reads the
selected approved design and records the selected plan and all produced
plan-linked task documents, `implementation-flow` reads selected tasks plus
design/plan and records its Implementation Record, and `doc-status` reads the
declared document set. Script-adapter inputs are
`migrate_docs` (declared document set), `scaffold_docs` (workspace-root bootstrap input), and
`build_task_graph` (focused plan plus selected task documents). Every referenced path/ID and
fingerprint must resolve against current canonical content before use.

## Existing delegate meanings

This contract renders existing semantics; it does not add workflow states.

| Effect | `completed` | `retry` | `yield` |
| --- | --- | --- | --- |
| `briefing-flow` | briefing gate passes | recoverable document gap | `input-required` for an unresolved user-only requirement |
| `design-doc` | design is approved | — | `approval-required` for its designated reviewer; `input-required` for an upstream user decision |
| `planning-flow` | approved/active plan plus linked task evidence | changed canonical plan/task repair evidence | `approval-required` when plan review is pending; `input-required` when a user-owned planning choice is missing; `unrecoverable-blocker` when no declared safe repair exists |
| `implementation-flow` | task slice is verified and its Implementation Record is complete | declared spec/design/constraint repair | `authority-required` for an irreversible effect without permission; `unrecoverable-blocker` when no declared safe repair exists |
| `doc-status` | documents are Completable | Returned with declared repair evidence | `unrecoverable-blocker` when Returned has no safe repair |

## Exact caller evaluation

The caller first evaluates terminal or blocked `GraphRoute` results and its
hop/repetition budgets under the [execution contract](execution-contract.md).
It then matches `EffectOutcome.status` and, for `yield`, `reason` exactly; it
does not infer a result from free-form delegate prose.

- `completed` may skip only this scoped audit or delegate stage after its input
  scope and proof validate.
- `retry` is auto-continuable only after its canonical changed evidence is
  re-projected and a fresh route selects a declared edge.
- `yield` stops with its exact reason.

At yield, the caller records a `GraphRunResult` handoff containing the complete
`GraphRoute`, ordered `EffectOutcome` footers, bounded counters/trace, and the
final yield reason. The retained route supports topology, terminal/blocked,
and budget evaluation. Receipt validity binds only `edgeId`, stage, effect,
authoritative inputs, evidence, and proof; it never requires byte-equivalent
complete `GraphRoute` objects.

## Resume and duplicate effects

Re-project canonical Markdown before comparing a saved receipt. Skip a saved
`completed` stage only when its `edgeId`, stage, effect identity, every
authoritative input path/ID/fingerprint, and its canonical-evidence or
provider-idempotency proof match the fresh scope. Missing proof yields
`authority-required` rather than replaying an irreversible effect.

For example, an `implementation-flow` receipt scoped to Task Graph A cannot
skip that delegate after canonical Markdown projects Task Graph B. It becomes
eligible only if its authoritative-input scope still matches the fresh graph.
