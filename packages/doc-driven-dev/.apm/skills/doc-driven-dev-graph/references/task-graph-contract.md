# Task Graph Contract

Graph State includes the Task Graph produced by `build_task_graph.js`
whenever a run is selected. The selected Execution Store run's `plan.md`
and task records are the source of truth; the Task Graph is a
deterministic, read-only projection of exactly one run — corpus
`docs/plans/` and `docs/tasks/` Markdown is history and is never
consulted by the projection.

## Composition

```bash
node .apm/skills/doc-driven-dev-graph/scripts/build_task_graph.js \
  --run <run-id> [--state-root <path>] [--allow-external-root] [--cwd <path>] [--json]
```

`--run` is required and selects the run whose records the projection
reads. Task identity is `(runId, taskId)`: `dependsOn` names sibling
task ids inside the same run, and the projection never mixes runs —
a missing or corrupt run surfaces the store's fail-closed error.

`--state-root` overrides Execution Store root resolution and
`--allow-external-root` authorizes a root that resolves outside the
checkout. The same selectors (`--run`, `--state-root`,
`--allow-external-root`) apply to `route_graph.js`, `inspect_graph.js`,
and `check_parallel.js`; every store access validates the root once at
the shared boundary rather than in each CLI. Without `--run`, Graph State
selects implicitly only when exactly one active run is bound to the
graph — zero candidates leave `taskGraph` null without a blocker
(planning has not materialized a run yet), while multiple fail closed as
ambiguous (`task-graph-run-ambiguous`).

The projection carries `schemaVersion: 2`, `runId`, `plan`, `nodes`,
`edges`, and the status lists below. `plan` is
`{ path, digest, approved }` with `path` the state-root-relative
`runs/<run-id>/plan.md`. Each node is
`{ id, path, title, status, dependsOn, blocks, scope, version }` where
`path` is the state-root-relative `runs/<run-id>/tasks/<id>.json` record,
`blocks` is the derived reverse of `dependsOn` (not an independent
relation), `scope` is the record's declared write-scope entries, and
`version` is the record's CAS version at projection time.

The public projection contains:

- `active`: every `in-progress` task in stable ID order.
- `resumableActive`: active tasks whose every predecessor is `done`, in
  stable ID order. Any issue forces this list to be empty.
- `runnable`: `todo` tasks whose every predecessor is `done`.
- `completed`: every `done` task in stable ID order.
- `blocked`: tasks that cannot start, each with its reasons.

Downstream dependency waits and unrelated blocked tasks do not remove an
eligible task from `resumableActive`. Active tasks with unresolved
predecessors remain in `active` only. The complete projection, including
dependency edges, is passed to the implementation delegate; it sequences
dependent active tasks and parallelizes only independent work. `wont-do`
does not satisfy a dependency.

The `idle` routing predicate is the completed-only state: at least one
task is `done` and `runnable`, `active`, `blocked`, and `issues` are all
empty. It is distinct from an empty run (`plan-has-no-tasks`), `blocked`
or `wont-do` residue, and unresolved dependencies — none of which are
idle.

## Plan approval gate

A runtime task graph is only valid while the run's `plan.md` exists and
carries a digest-bound approval. Re-`save-plan` after approval, or a
write outside the store API, makes the recorded digest diverge — the
gate fails closed until `approve-plan` binds the current digest again.

## Fail-closed behavior

A missing plan (`plan-missing`), a missing or stale approval
(`plan-not-approved`), a manifest-digest divergence
(`plan-digest-drift`), duplicate task IDs (`duplicate-task-id`),
unresolved same-run references (`missing-task-reference`), dependency
cycles (`task-cycle`), and a run with no task records
(`plan-has-no-tasks`) produce `issues`, an empty `resumableActive` list,
and an empty `runnable` list.
Issues are surfaced in Graph State blockers and planning gate reasons.
The router must not infer readiness from record order, names, or a
partial DAG.

The Task Graph result is included in `GraphRoute.taskGraph` when a run
was selected, otherwise that field is `null`.
