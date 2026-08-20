# Graph Execution Contract

This contract defines the caller-owned runtime loop around the one-edge CLI.
It is separate from graph topology: delegates and audits record evidence, then
the caller asks the graph for a fresh decision.

## Turn protocol

For each turn:

1. Select the Graph Definition and an explicit focus when required.
2. Run `route_graph.js` once with the current node and observed signals.
3. Preserve the complete GraphRoute JSON in the handoff.
4. Run every `requiredAudits` entry before dispatching. These are the sorted
   `audits` declared by the selected destination node; blocked routes return
   none.
5. Dispatch only `delegate` from the returned edge; do not dispatch a guessed
   or neighboring skill.
6. Record completion, gate, and follow-up evidence in canonical Markdown.
7. Re-project state and rerun from `next`.

The same turn must not call the CLI recursively or advance through multiple
edges. A terminal route is idempotent. A blocked route is a fail-closed stop
until its blockers are resolved or the user grants the required authority.

## Evidence and loopbacks

Delegates own their domain work and evidence format. The graph owns only
declared topology and generic state predicates. Upstream gaps, invalid Task
Graphs, missing focus, conflicting signals, and failed audits remain explicit
blockers or loopback signals; the caller must not reinterpret them as success.

Markdown remains the durable history. Do not create a parallel mutable state
store to make a route appear complete.
