---
name: planning-flow
description: Use when doc-driven-dev-graph returns a GraphRoute with delegate planning-flow after a focused approved design needs an implementation-ready plan and concrete task documents.
license: MIT
---

# Planning Flow

`planning-flow` is the graph-only composition boundary between an approved
design and its plan/task evidence. Direct user requests still use `plan-doc`
or `task-doc`.

## Workflow

1. Accept the invocation only when the returned `GraphRoute.delegate` is
   `planning-flow`.
2. Consume the selected approved design and its exact focused lineage.
3. Invoke `plan-doc` to create or repair one implementation-ready plan.
4. If the plan awaits review, return `EffectOutcome` `yield` with
   `approval-required` and create no tasks.
5. After the plan status is `approved`, `in-progress`, or `completed`, invoke
   `task-doc` once per concrete plan slice, preserving declared dependencies.
6. Return one exact `EffectOutcome` for `planning-flow` with the current design
   input and plan/task evidence.
7. Let the graph re-project; do not call `build_task_graph` or choose the next
   edge inside `planning-flow`.

## Graph Effect Outcome

When `doc-driven-dev-graph` invokes this skill, return exactly the
[`EffectOutcome footer`](../doc-driven-dev-graph/references/execution-outcome-contract.md).
The footer defines the required `edgeId`, stage, effect identity, authoritative
input scope, evidence, proof, and yield fields.

Use `completed` for an approved or active plan with linked task evidence, `retry` for
changed canonical plan/task repair evidence, `yield` with `approval-required` while plan
review is pending, `yield` with `input-required` when a user-owned planning choice is
missing, and `yield` with `unrecoverable-blocker` when no declared safe repair exists.
