---
name: doc-driven-dev-graph
description: "Graph-first router for document-driven development. Projects canonical Markdown artifacts into Graph State, evaluates the selected Graph Definition, and returns exactly one next edge for a delegate or audit. Use when a repository needs deterministic lifecycle routing, explicit focus, typed signals, or fail-closed task planning."
license: MIT
---

# Doc-Driven Development Graph

`doc-driven-dev-graph` is the public graph-first entrypoint for the
document-driven development workflow. It treats the Markdown artifact graph as
the source of project state and treats the selected Graph Definition as the
source of routing topology. The CLI projects state once and routes one edge;
the caller performs the runtime loop.

## When to use

- Start or resume a document-driven development workflow.
- Select an artifact chain explicitly when more than one chain is present.
- Dispatch a declared delegate or audit from a validated graph definition.
- Inspect blockers, gate results, and the selected Task Graph as JSON.

## Canonical command

Run from a consumer repository:

```bash
node .apm/skills/doc-driven-dev-graph/scripts/route_graph.js \
  [--graph <path>] [--current <node>] [--signal <condition-signal>] \
  [--focus <artifact>] [--task-dir <path>] [--cwd <path>] --json
```

`--current` defaults to `entry` from the selected Graph Definition. Repeat
`--signal` and `--focus` when needed. A supplied current node must exist in the
selected definition. A supplied signal must be a signal value referenced by a
`kind: signal` condition in that definition. Unknown values fail closed.

The JSON result is the public `GraphRoute` contract:

- `schemaVersion`, `graphId`, `current`, `next`
- `edgeId`, `condition`, `status`, `delegate`
- `requiredAudits`, `blockers`, `taskGraph`

The route contains only one declared edge. A terminal current node returns an
idempotent terminal result (`edgeId: null`); a node with no satisfied edge
returns `status: blocked` and does not guess a destination.

## Declared delegates

The graph definition binds lifecycle work to existing skills and composites:

- Optional migration uses `migrate_docs`; bootstrap uses `scaffold_docs`.
- Briefing delegates to `briefing-flow` and design work to `design-doc`.
- Planning combines `plan-doc`, `task-doc`, and `build_task_graph.js`.
- Implementation delegates to `implementation-flow`.
- Exit verification delegates to `doc-status`.

These names are bindings in the Graph Definition, not an additional sequence
implemented by this skill. A `focus-required` blocker is a hard stop until the
caller supplies explicit focus.

## Runtime loop

1. Choose a focus path when the projection reports `focus-required`.
2. Run `route_graph.js` and inspect the returned route and blockers.
3. Run every returned audit, then dispatch only the returned delegate.
4. Record Markdown evidence in the canonical document tree.
5. Re-project and re-run the CLI from the returned `next` node.
6. Stop at a terminal node or when a blocker requires user authority.

The CLI never recursively advances through multiple nodes. Delegated skills own
their work and evidence; graph routing remains a deterministic, one-edge
decision at each turn.

## Sources of truth

- `graphs/doc-driven-dev.yaml` declares node, edge, condition, and delegate
  topology.
- [`references/graph-contract.md`](references/graph-contract.md) defines the
  Graph Definition and GraphRoute schema.
- [`references/graph-state.md`](references/graph-state.md) defines projection,
  focus, gates, signals, and blockers.
- [`references/execution-contract.md`](references/execution-contract.md)
  defines the evidence-backed runtime loop.
- [`references/task-graph-contract.md`](references/task-graph-contract.md)
  defines Task Graph composition and fail-closed dependency behavior.

Markdown artifacts remain the project history and status authority. The graph
runtime derives state from them and does not persist a parallel lifecycle
database.
