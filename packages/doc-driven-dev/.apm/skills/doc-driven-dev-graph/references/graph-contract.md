# Graph Definition and GraphRoute Contract

This contract is normative for the graph-first public entrypoint. The
distributed `graphs/doc-driven-dev.yaml` file is the authority for concrete
node, edge, condition, and delegate declarations. Prose must not invent a
transition or flatten a delegated subgraph.

## Graph Definition v2

The definition has `schemaVersion: 2`, a stable `id`, an `entry` node ID,
named `conditions`, `nodes`, and `edges`:

- Conditions are `signal`, `gate`, or `task-graph` predicates.
- Nodes are `action`, `delegate`, `audit`, or `terminal`.
- Edges have unique IDs, known endpoints, a declared condition key, and a
  unique priority per source node.
- A terminal node has no outgoing edges. Every non-terminal node has at least
  one outgoing edge.

The parser rejects unknown endpoints and conditions, duplicate IDs or route
selectors, invalid prerequisite gates, and invalid terminal topology before
routing.

## One-edge routing

`route_graph.js` loads the selected definition, projects Graph State, and calls
`routeGraph()` exactly once. Outgoing edges are considered by ascending
priority, then ID. The result is one declared edge, a terminal result, or a
blocked result; the CLI never follows the destination recursively.

`--current` defaults to `definition.entry` and must name a node in the selected
definition. Each `--signal` must be referenced by a `kind: signal` condition in
that definition. These validations prevent a caller from routing against a
different graph vocabulary.

## GraphRoute JSON

The stable JSON object contains exactly:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Public route schema, currently `2`. |
| `graphId` | Selected definition ID. |
| `current` / `next` | Current node and one-step destination. |
| `edgeId` | Selected edge ID, or `null` for terminal/blocked. |
| `condition` | Selected condition key, `terminal`, or `blocked`. |
| `status` | `edge`, `terminal`, or `blocked`. |
| `delegate` | Destination delegate, terminal delegate, or `null`. |
| `requiredAudits` | Audits required by the route (empty when none). |
| `blockers` | Sorted fail-closed state blockers. When a node's declared `requiresGates` is unmet, this also includes a stable `required-gate:<gate>` blocker and each failed gate reason so prerequisite evidence remains visible. |
| `taskGraph` | Selected Task Graph projection, or `null`. |
