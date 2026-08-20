# Graph Inspection and Route Explanation

This reference defines the read-only inspection and explanation contracts for
the graph-first entrypoint. The Graph Definition remains the authority for
nodes, edges, conditions, delegates, and audits.

## Commands

Inspect the selected definition as JSON or Mermaid:

```bash
node .apm/skills/doc-driven-dev-graph/scripts/inspect_graph.js \
  [--graph <path>] [--format json|mermaid] [--cwd <path>] \
  [--focus <artifact>] [--task-dir <path>]
```

Explain one route decision with the ordinary route preserved in an envelope:

```bash
node .apm/skills/doc-driven-dev-graph/scripts/route_graph.js \
  [route options] --explain --json
```

`inspect_graph.js` does not evaluate route conditions. `route_graph.js` remains
the only command that selects an edge, terminal result, or blocked result.

## Inspection JSON

`--format json` always returns a top-level `definition` object. The inspection
schema is version `1`, independent of the Graph Definition schema version.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Inspection schema version, currently `1`. |
| `graphId` / `entry` | Definition ID and entry node. |
| `nodeCount` / `edgeCount` / `conditionCount` | Counts from the selected definition. |
| `terminalNodes` | Sorted terminal node IDs. |
| `reachableNodes` | Sorted nodes reachable from `entry` by declared edges. |
| `unreachableNodes` | Sorted node IDs not reachable from `entry`. |
| `reachableTerminalNodes` | Sorted terminal nodes reachable from `entry`. |
| `unusedConditions` | Declared condition keys not included in `referencedConditions`. |
| `referencedConditions` | Sorted edge `when` keys, prerequisite-gate condition keys, and declared signal condition keys. |
| `delegates` | `{ nodeId, delegate }` entries for nodes with a delegate. |
| `audits` | `{ nodeId, audits }` entries for nodes with declared audits. |
| `issues` | Sorted inspection findings; see the issue table below. |
| `nodes` | Serializable node data: `nodeId`, `kind`, optional `delegate`, and sorted `audits`. |
| `edges` | Serializable edge data: `id`, `from`, `to`, `when`, and `priority`. |

### Reachability is topology-only

Reachability starts at `entry` and follows every declared edge endpoint. It does
not evaluate signal values, gate status, task-graph state, focus, or any other
runtime evidence. Therefore an edge can make a node topologically reachable even
when its condition can never match in the current runtime state.

The inspection reports an `unreachable-node` error for an unreachable
non-terminal node, an `unreachable-terminal` warning for an unreachable terminal,
and a `no-reachable-terminal` error when no terminal is reachable. Inspection
does not change routing or repair these findings.

### Issues

Each issue has `severity` (`error` or `warning`), `code`, and an optional
`nodeId` or `condition`:

| Code | Severity | Meaning |
| --- | --- | --- |
| `unreachable-node` | `error` | A non-terminal node is not reachable from `entry`. |
| `unreachable-terminal` | `warning` | A terminal node is not reachable from `entry`. |
| `no-reachable-terminal` | `error` | No terminal node is reachable from `entry`. |
| `unused-condition` | `warning` | A declared condition is not referenced by the inspected definition. |

Issues are sorted by code, then node ID, then condition so repeated inspection
of the same definition is stable.

## Route explanation

`route_graph.js --explain --json` returns exactly two top-level keys:
`route` (the ordinary `GraphRoute`) and `explanation`. The `route` object is
unchanged from a normal `--json` invocation. `explanation` contains:

| Field | Meaning |
| --- | --- |
| `currentNode` | Current node used for the decision. |
| `hardBlockers` | Sorted blockers that stop evaluation before edge selection. |
| `prerequisiteGates` | Required gate status and sorted reasons. |
| `evaluatedEdges` | Edges evaluated so far, with priority, condition kind, match, and `repair` or `normal` phase. |
| `selectedEdgeId` | Selected edge ID, or `null` for terminal/blocked results. |
| `selectedDestinationAudits` | Sorted audits declared by the selected destination. |
| `blockedReasons` | Sorted reasons when no route is selected. |

The evaluation order is deterministic:

1. A terminal node returns an idempotent terminal result without evaluating edges.
2. Any hard blocker returns a blocked result without evaluating edges.
3. Declared prerequisite repair edges are evaluated first, in priority then edge-ID order.
4. If required gates still fail, the result is blocked with the stable gate blockers and reasons.
5. Remaining outgoing edges are evaluated in priority then edge-ID order; the first match is selected.
6. If no edge matches, the result is blocked with `no-matching-edge`.

The command does not recursively evaluate the selected destination. It records
the evidence for one decision and leaves the caller to persist Markdown evidence,
run required audits, and invoke the next turn.

## Runtime projection inclusion

The JSON inspection includes only `definition` by default. Supplying any
runtime selector (`--cwd`, `--focus`, or `--task-dir`) adds `state`,
`artifactGraph`, and `taskGraph` from a fresh projection. The projection is
read-only; it does not route, dispatch a delegate, or create a parallel state
store. An explicit focus that resolves to an invalid or required focus fails
closed instead of guessing.

The Mermaid format is definition-only even when runtime selectors are supplied.

## Mermaid output

`--format mermaid` returns deterministic text beginning with `flowchart TD`.
Node lines are sorted by original node ID. Every node uses a deterministic `nN`
alias in Mermaid syntax, assigned by that sorted order; the original ID remains
in the escaped label. A node label contains its ID and `kind`, then optional
`delegate`, `terminal`, and `audits` labels. Edge lines are sorted by `from`,
priority, and edge ID; each label contains the condition key and priority
(`<condition> · p<priority>`). Mermaid labels escape `&` and `"`.

Mermaid rendering is text-only and has no routing, delegate-dispatch, Markdown,
or persistence side effect.
