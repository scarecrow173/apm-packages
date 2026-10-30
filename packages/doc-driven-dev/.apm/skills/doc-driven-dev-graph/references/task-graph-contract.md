# Task Graph Contract

When a focused plan is available, Graph State includes the Task Graph produced
by `build_task_graph.js`. Task documents remain the source of truth; the Task
Graph is a deterministic projection used by planning and implementation
routing.

## Composition

```bash
node .apm/skills/doc-driven-dev-graph/scripts/build_task_graph.js \
  --plan <path> [--task-dir <path>] [--cwd <path>] [--json]
```

`--task-dir` selects the task-doc subtree to scan (default `docs/tasks`) and
must stay inside the checkout. An absolute-outside or `..`-escaping value, or
a path that resolves outside through a link, is a caller error: the command
fails closed with `--task-dir escapes the checkout` and a non-zero exit
before any file is read. The same rule guards `--task-dir` on
`route_graph.js`, `inspect_graph.js`, `fetch_context.js`, and
`check_parallel.js` — every artifact scan validates the selector once at the
shared boundary rather than in each CLI.

Task IDs are unique. `depends-on` and `blocks` relations are normalized into
directed edges. The public projection contains:

- `active`: every `in-progress` task in stable ID order.
- `resumableActive`: active tasks whose every predecessor is `done`, in stable
  ID order. Structural issues force this list to be empty.
- `runnable`: `todo` tasks whose every predecessor is `done`.

Downstream dependency waits and unrelated blocked tasks do not remove an
eligible task from `resumableActive`. Active tasks with unresolved predecessors
remain in `active` only. The complete projection, including dependency edges,
is passed to the implementation delegate; it sequences dependent active tasks
and parallelizes only independent work. `wont-do` does not satisfy a dependency.

## Fail-closed behavior

Duplicate IDs, unresolved task references, cycles, malformed relations, and a
plan with no selected tasks produce `issues`, an empty `resumableActive` list,
and an empty `runnable` list.
Issues are surfaced in Graph State blockers and planning gate reasons. The
router must not infer readiness from file order, names, or a partial DAG.

The Task Graph result is included in `GraphRoute.taskGraph` when a focused plan
was selected, otherwise that field is `null`.
