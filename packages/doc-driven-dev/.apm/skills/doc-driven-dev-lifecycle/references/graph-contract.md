# doc-driven-dev-lifecycle: Graph Contract

This contract defines the runtime topology consumed by
`route_lifecycle.js`. The distributed file
`graphs/lifecycle.yaml` is the only authority for lifecycle node and edge
topology and for delegate bindings. The router follows declared edges; prose
must not invent a transition or flatten a delegated subgraph.

## Graph schema

The graph uses `schemaVersion: 1` and starts at `entry: probe`.

Each node is keyed by a stable node ID and has:

| Field | Meaning |
| --- | --- |
| `kind` | `probe`, `action`, `subgraph`, `gate`, `audit`, or `terminal`. |
| `delegate` | A bundled skill or CLI name, or `null` when the node is a composite/gate. |
| `audits` | Audit names that must pass before dispatch or completion. |

The required nodes are `probe`, `migration`, `bootstrap`, `briefing`,
`design`, `planning`, `task-graph`, `implementation`, `followup-triage`,
`exit-audit`, and `complete`. `briefing` remains a `subgraph` delegated to
`briefing-flow`; `implementation` remains a `subgraph` delegated to
`implementation-flow`; `planning` is the documented composite planning step.

Each edge has a unique `id`, a known `from` and `to` node, and a typed `when`
reason code. Retry and loopback edges are explicit. The `complete` terminal
node has no outgoing edge. Invalid YAML, duplicate edge IDs, unknown endpoints,
or terminal outgoing edges are rejected before routing.

## Thin-router CLI

Run the distributed router from a consumer repository:

```bash
node .apm/skills/doc-driven-dev-lifecycle/scripts/route_lifecycle.js \
  --current <node> [--focus <path>] [--signal <signal>] \
  [--task-dir <path>] [--cwd <path>] [--json]
```

`--focus` and `--signal` may be repeated. Unknown node IDs or signal names are
errors. The stable route object contains `schemaVersion`, `current`, `next`,
`edgeId`, `reasonCode`, `delegate`, `requiredAudits`, `blockers`, and
`taskGraph`. A `focus-required` route is a successful, fail-closed decision:
it authorizes no delegate until the caller supplies explicit focus.

The router evaluates reasons in precedence order so typed upstream gaps win
over forward gates. It returns only a declared edge and uses a declared retry
edge when a gate is incomplete. `complete` is terminal and returns
`reasonCode: lifecycle-complete` with `edgeId: null`.

## Task DAG composite

When a plan is selected, planning may run:

```bash
node .apm/skills/doc-driven-dev-lifecycle/scripts/build_task_graph.js \
  --plan <path> [--task-dir <path>] [--cwd <path>] [--json]
```

The result has `nodes`, `edges`, `runnable`, `active`, `completed`, `blocked`,
and `issues`. `depends-on` and `blocks` relations are normalized into directed
task edges. Independent root tasks fan out in stable ID order; a fan-in task is
runnable only after every predecessor is `done`. Duplicate IDs, unresolved task
references, cycles, and plans without tasks produce `issues` and an empty
`runnable` list. The router therefore fails closed instead of guessing a task.

## Delegation boundaries

- `graphs/lifecycle.yaml` is normative for topology, edge reason codes, and
  delegate bindings.
- [`flow-contract.md`](flow-contract.md) is normative for human approval
  criteria, evidence requirements, and follow-up classification.
- [`lifecycle-state.md`](lifecycle-state.md) is normative for derived state,
  focus, typed signals, and fail-closed behavior.
- Markdown artifacts remain normative for project history and status. Runtime
  state is derived from those artifacts on every probe; no state database is
  required.
