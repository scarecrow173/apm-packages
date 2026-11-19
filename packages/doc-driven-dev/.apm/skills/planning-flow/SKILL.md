---
name: planning-flow
description: Use when doc-driven-dev-graph returns a GraphRoute with delegate planning-flow after a focused approved design needs an implementation-ready run plan and concrete task records.
license: MIT
---

# Planning Flow

`planning-flow` is the graph-only composition boundary between an approved
design and its plan/task evidence.

Under Document Registry 3 `plan` and `task` are execution-bound
(`persistence: ephemeral`): no `new_plan.js`/`new_task.js` creators ship
(Issue #249 removed them) and plan/task state lives in the Execution Store
run the graph selected; the `plan-doc`/`task-doc` conventions govern the record
contract and pre-v3 corpus migration. `test-spec` is a legacy
migration-only format — durable verification evidence is recorded by
`verification-doc` under `docs/verification`.

## Workflow

1. Accept the invocation only when the returned `GraphRoute.delegate` is
   `planning-flow`.
2. Consume the selected approved design and its exact focused lineage.
3. Open or create the Execution Store run bound to the focused chain with
   `execution_store.js` (`create` / `show`) — one run owns this planning
   unit's `plan.md` and task records, and `manifest.focus` carries the
   artifact paths inside the focused chain.
4. Write or repair the implementation-ready plan into the run's `plan.md`
   with `save-plan`. If the plan awaits review, return `EffectOutcome`
   `yield` with `approval-required` and create no task records.
5. After `approve-plan` binds the current plan digest, materialize one task
   record per concrete plan slice with `put-task`: `taskId`, `title`,
   `status`, same-run `dependsOn` ids, the verifiable `checks` the slice
   must pass, and the `scope` entries declaring its write boundary. New
   records create with `expectedVersion: 0` (or omitted); updates carry the
   record's current CAS `version`.
6. Return one exact `EffectOutcome` for `planning-flow` with the current
   design input and the run's plan/task evidence (the store paths
   `runs/<run-id>/plan.md` and `runs/<run-id>/tasks/<task-id>.json`).
7. Let the graph re-project; do not call `build_task_graph` or choose the
   next edge inside `planning-flow`. A plan edited after approval makes the
   recorded digest diverge — the task graph fails closed until
   `approve-plan` binds the new digest.

**Staged loading:** this subgraph consumes no `.sdp` profile — apply the same
discipline by loading each invoked document skill's body at its dispatch step
and its references only when the step needs them — see
[progressive-loading-contract](../skill-discovery-protocol/references/progressive-loading-contract.md).

## Graph Effect Outcome

When `doc-driven-dev-graph` invokes this skill, return exactly the
[`EffectOutcome footer`](../doc-driven-dev-graph/references/execution-outcome-contract.md).
The footer defines the required `edgeId`, stage, effect identity, authoritative
input scope, evidence, proof, and yield fields.

Use `completed` for a digest-approved run plan with materialized task records,
`retry` for changed plan/task repair evidence, `yield` with
`approval-required` while plan review is pending, `yield` with `input-required` when a
user-owned planning choice is missing, and `yield` with `unrecoverable-blocker` when no
declared safe repair exists.
