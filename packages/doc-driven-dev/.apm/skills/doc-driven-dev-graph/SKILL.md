---
name: doc-driven-dev-graph
description: "Graph-first router for document-driven development. Projects canonical Markdown artifacts into Graph State, evaluates a declared Graph Definition, and returns at most one declared edge or an explicit terminal/blocked result."
license: MIT
---

# Doc-Driven Development Graph

`doc-driven-dev-graph` is the public graph-first entrypoint. The Graph
Definition is the execution authority; human phase labels are conceptual
groupings only and never replace declared nodes, edges, conditions, or
delegates.

Human phase labels are conceptual and non-normative; Graph Definition remains
the execution authority.

## Four layers

- **Execution Graph**: the declared nodes, one-edge routes, conditions,
  priorities, delegates, and audits in `graphs/doc-driven-dev.yaml`.
- **Artifact Graph**: canonical Markdown documents and their IDs, types,
  statuses, and relations.
- **Graph State**: a fresh projection of the Artifact Graph with focus, gates,
  signals, blockers, and evidence for the selected route.
- **Dynamic Task Graph**: a deterministic projection of a focused plan and its
  task dependencies; it is used by planning and implementation delegates.

## Canonical command

```bash
node .apm/skills/doc-driven-dev-graph/scripts/route_graph.js \
  [--graph <path>] [--current <node>] [--signal <condition-signal>] \
  [--focus <artifact>] [--task-dir <path>] [--cwd <path>] --json
```

The JSON result is the `GraphRoute` contract: `current`, one `next`, `edgeId`,
`condition`, `status`, `delegate`, `requiredAudits`, `blockers`, and the
selected `taskGraph`. Terminal and blocked results are explicit and do not
guess a destination.

A successful transition selects exactly one declared edge. When no edge
condition is satisfied, the router returns a fail-closed same-node blocked
result with no edge; terminal results are also edge-less. No implicit or
neighboring edge is added by the caller.

## Condition DSL and priority

Edges name a condition key. The generic condition DSL supports `signal`,
`gate` (`pass` or `not-pass`), and `task-graph` (`runnable` or `invalid`)
predicates. Only declared signals are accepted. For the current node, eligible
edges are ordered by ascending `priority`, then stable edge ID; the first match
is the only route returned. The CLI never follows a second edge recursively.

## Delegates and subgraphs

Graph Definition bindings are explicit:

- migration uses `migrate_docs`; bootstrap uses `scaffold_docs`;
- briefing delegates to `briefing-flow`; design delegates to `design-doc`;
- the planning binding `build_task_graph` is executed by
  `build_task_graph.js`;
- implementation delegates to `implementation-flow`; exit verification audits
  with `doc-status`.

Delegates own their briefing and implementation subgraphs. The caller runs
returned audits before dispatching exactly the returned delegate. `focus-required`
is a hard stop until explicit focus is supplied.

## Runtime loop

1. Select the Graph Definition and current node.
2. Inspect canonical Markdown artifacts and their semantic relations.
3. Project the Artifact Graph into fresh Graph State.
4. Resolve an explicit focus when multiple chains are present.
5. Evaluate gate results, caller signals, and deterministic blockers.
6. Evaluate each outgoing edge with the generic condition DSL.
7. Apply priority order (then edge ID) to choose at most one edge.
8. Preserve the complete route and run every returned audit.
9. Dispatch only the declared delegate, including its briefing or
   implementation subgraph.
10. Record Markdown evidence, re-project, and re-enter at the returned `next`
    node.

The loop stops at a terminal node or a fail-closed blocker requiring user
authority. A task marked `wont-do` never satisfies a dependency; unresolved
tasks remain blocked in the Dynamic Task Graph.

After implementation, the `follow-up triage` node requires
`implementation-verified` and one typed signal before routing to repair,
planning, a new briefing, or exit audit.

## Persistence boundary

Markdown artifacts are durable history and status authority. Graph State and
the Dynamic Task Graph are projections for the current turn. The runtime does
not create or require a parallel database.

## Public commands

Use the four commands below for distinct purposes. `route_graph.js` makes one
route decision; `inspect_graph.js` only describes the selected definition and,
when explicitly requested, its runtime projections.

### 1. Normal routing

Run the canonical router when the caller needs the next declared edge or an
explicit terminal/blocked result:

```bash
node .apm/skills/doc-driven-dev-graph/scripts/route_graph.js \
  --current followup-triage --signal followup-terminal --json
```

The command evaluates the selected node and returns one `GraphRoute`. It does
not follow the returned destination in the same invocation.

### 2. Explain a route

Add `--explain` to the JSON route command to retain the ordinary route beside
the evidence used to choose it:

```bash
node .apm/skills/doc-driven-dev-graph/scripts/route_graph.js \
  --current followup-triage --signal followup-terminal --explain --json
```

The result is `{ "route": GraphRoute, "explanation": ... }`. The explanation
records hard blockers, prerequisite gates, evaluated repair/normal edges in
order, the selected edge, destination audits, and blocked reasons. Explain mode
requires `--json` and does not change routing or persistence behavior. See
[`references/graph-inspection.md`](references/graph-inspection.md) for the
evaluation order and field contract.

### 3. Inspect JSON

Use `inspect_graph.js` to inspect topology and declarations without evaluating
route conditions:

```bash
node .apm/skills/doc-driven-dev-graph/scripts/inspect_graph.js \
  --format json
```

The JSON always contains `definition`, including counts, topology reachability,
delegates, audits, and deterministic issues. `state`, `artifactGraph`, and
`taskGraph` are included only when an explicit `--cwd`, `--focus`, or
`--task-dir` selector requests runtime projection. Inspection never routes,
dispatches delegates, or writes Markdown/persistence state.
`referencedConditions` contains the unique edge `when` keys; `unusedConditions`
contains declared condition keys absent from those edge `when` keys. JSON accepts
these selectors for runtime projection.

### 4. Inspect Mermaid

Render the same topology as deterministic Mermaid text for review or diagrams:

```bash
node .apm/skills/doc-driven-dev-graph/scripts/inspect_graph.js \
  --format mermaid
```

Nodes and edges are sorted stably. Every node uses a deterministic `nN` alias
in Mermaid syntax, assigned by sorted original node ID; the original ID remains
in the escaped label. Node labels include node ID and kind, with delegate,
terminal, and audit labels when declared; edge labels include the condition key
and priority. Mermaid rendering is text-only and has no routing or persistence
side effect. Mermaid is definition-only and rejects `--cwd`, `--focus`, and
`--task-dir`. Original node, delegate, audit, and condition text is escaped;
`|` cannot terminate an edge label.

## References

- [`graphs/doc-driven-dev.yaml`](graphs/doc-driven-dev.yaml) — concrete
  topology and delegate bindings.
- [`references/graph-contract.md`](references/graph-contract.md) — Graph
  Definition and GraphRoute schema.
- [`references/graph-state.md`](references/graph-state.md) — projection,
  focus, gates, signals, and blockers.
- [`references/execution-contract.md`](references/execution-contract.md) —
  evidence-backed caller loop.
- [`references/task-graph-contract.md`](references/task-graph-contract.md) —
  Task Graph composition and fail-closed dependency rules.
- [`references/graph-inspection.md`](references/graph-inspection.md) — inspection
  fields, topology reachability, route explanations, and Mermaid determinism.
