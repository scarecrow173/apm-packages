# Graph Execution Contract

This contract defines the bounded caller-owned Run-to-Yield protocol around the
one-edge CLI. A completed edge checkpoint is not a yield (`checkpoint != yield`).
The router still returns one complete `GraphRoute` per CLI invocation; the
caller owns whether to stop after that checkpoint or ask for another decision.

## Caller modes

- `run-until-yield` is the normal runtime mode. It repeats the selected-edge
  protocol after each fresh state projection until a yield reason applies.
- `single-step` is available for debugging, inspection, deterministic testing,
  or one-checkpoint execution. It yields after the selected edge checkpoint.

`route_graph.js` itself never recursively follows a second edge. Its examples
remain one-edge commands; the caller, not the router, owns continuation.

## Selected-edge protocol

For each selected edge:

1. Invoke `route_graph.js` exactly once for `current`.
2. Preserve the complete `GraphRoute`.
3. If terminal or blocked, evaluate the yield table and stop.
4. Freeze the task-aware default `maxHops` when the first implementation-flow route
   is selected, then check `maxHops` and the stable fingerprint of the complete
   `GraphRoute`.
5. Run every required audit in stable order.
6. Dispatch only the returned delegate.
7. If an audit or delegate explicitly requires input, approval, or authority,
   yield without claiming the edge checkpoint complete.
8. Persist completion, gate, and follow-up evidence in canonical Markdown.
9. Mark the edge checkpoint complete and append it to the ordered trace.
10. Re-enter from `next` with a fresh state projection.
11. In `single-step` mode yield; in `run-until-yield` mode repeat.

Record completion, gate, and follow-up evidence by persisting those values in
canonical Markdown.

The checkpoint is complete only after its audits, delegate, and evidence are
recorded. A run trace summary records the mode, bounded counters, completed
edge IDs in order, route fingerprints, and the final yield reason.

## Git commit boundary

Across briefing, spec, ADR, design, plan, task, implementation, follow-up, and
audit work, make each reviewable logical change one commit. A logical change
should be explainable and reviewable on its own, have a clear verification
method where practical, have a clear meaning if reverted, and contain no
unrelated changes. Minimizing or maximizing the number of commits is not a
goal.

Graph runtime structure does not define Git commit boundaries. In particular,
a Graph node, edge, phase, or checkpoint is not a commit boundary. Neither an
artifact type nor the Dynamic Task Graph (`task-graph`), which is a projection
generated from task documents, is a commit boundary. Do not use `1 phase = 1
commit`, `1 graph node = 1 commit`, `1 graph edge = 1 commit`, or `1 artifact =
1 commit` as execution rules.

A task is an implementation scope boundary, not necessarily a commit boundary:
`1 task = 1..N commits` is valid. Split independent logical changes within one
task into separate commits. Avoid mixing unrelated tasks in one commit; when
changes from multiple tasks are semantically or technically inseparable, they
may share a commit only when the reason they cannot be separated is
explainable. If a task contains many independent logical changes, consider
splitting the task instead of creating one large commit.

Group changes by logical intent rather than file or artifact type. Related
code, tests, task status, Implementation Records, verification evidence, and
upstream artifacts may share a commit when they form one logical change.
Conversely, split independently reviewable logical changes even when they edit
the same artifact. Do not mechanically separate code, tests, and documentation
solely because their file types differ.

This skill defines only when changes form one commit. Commit message syntax,
type, scope, subject or description, body, footer, task or issue reference
format, and conventions such as Conventional Commits remain the responsibility
of existing Git commit tooling and repository conventions.

## Effect outcome evaluation

Every graph-invoked audit and delegate returns the exact `EffectOutcome` footer
defined in [execution-outcome-contract.md](execution-outcome-contract.md). The
caller performs an exact `EffectOutcome.status` and `reason` match, never a
free-form semantic inference. It evaluates terminal or blocked `GraphRoute`
results and hop/retry/repetition budgets separately before effect outcomes.
At yield, it records one `GraphRunResult` handoff with the complete route and
ordered outcomes. A completed effect is reusable only when the receipt scope
and canonical-evidence or provider-idempotency proof validate against the
fresh projection.

The caller adapter normalizes the declared script delegates (`migrate_docs`,
`scaffold_docs`, and `build_task_graph`) and named audits (`spec`, `adr`,
`design`, `plan`, `task`, `impl-record`, and `all`) into `EffectOutcome`.
Skills that can emit the footer return it directly. Missing or malformed adapter
evidence yields `authority-required`; it never advances a checkpoint. The
effect-specific canonical input/evidence mapping is defined in
[execution-outcome-contract.md](execution-outcome-contract.md).

## Phase 1 yield table

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

## Bounded autonomy

The caller uses fixed run counters; this protocol adds no policy DSL:

```text
topologyBaseHops = 10
  This is the current longest simple entry-to-terminal path and already includes
  the first implementation-flow dispatch.

taskBudgetCount = unfinished Task Graph node count frozen immediately before the
  first implementation-flow dispatch
  Count exactly todo, in-progress, and blocked nodes in the focused Task Graph;
  exclude done and wont-do. Persist the frozen value. If the handoff already
  contains a value, do not recalculate it. Tasks added later contribute to the
  next run's budget, never the current run's budget.

repairAllowance = 0
  A positive repair policy is not part of this defect fix.

maxHops default = topologyBaseHops
  + Math.max(0, taskBudgetCount - 1)
  + repairAllowance
  A caller-supplied explicit maxHops remains authoritative and records
  taskBudgetCount: null.

route fingerprint = stable JSON serialization of the complete GraphRoute
  The complete route includes the fresh Task Graph projection. A completed task that exposes
  the next runnable task changes task statuses plus runnable/active/resumableActive/completed,
  so the next declared edge may continue. If the same fingerprint is observed again in the
  same run, yield budget-exhausted.

changing repair loop = bounded by the frozen maxHops
  A task retry or repair that reaches this limit yields budget-exhausted and
  hands control to a new run. Budget exhaustion is neither an execution error
  nor a successful checkpoint.
```

The fingerprint is computed before effects. Append it to
`seenRouteFingerprints` only after the edge checkpoint completes; this allows
resume of an interrupted, uncompleted edge without falsely classifying it as a
completed loop.

## Checkpoint, resume, and duplicate effects

- A completed checkpoint records route, completed audits, completed delegate,
  and `evidenceRecorded=true` in the caller handoff.
- Resume always re-projects canonical Markdown before routing again.
- Resume starts at the last completed `route.next`; an incomplete edge resumes
  only its uncompleted audit/delegate/evidence stages.
- A stage is skipped only when canonical evidence or the side-effect provider's
  idempotency key proves completion.
- If neither proof exists, yield `authority-required` rather than replaying a
  potentially irreversible effect.
- Run counters and trace may be retained in task/thread handoff metadata; they
  are not Graph State or project authority.

This provides same-task crash recovery. Cross-host recovery when both the
caller handoff and task/thread history are lost remains outside Phase 1;
canonical Markdown alone currently does not encode the last runtime node or
every external side-effect receipt.

## Evidence and persistence

Delegates own their domain work and evidence format. The graph owns only
declared topology and generic state predicates. Upstream gaps, invalid Task
Graphs, missing focus, conflicting signals, and failed audits remain explicit
blockers or loopback signals; the caller must not reinterpret them as success.

Markdown remains the durable history and status authority. Do not create a
parallel mutable state store to make a route appear complete.
