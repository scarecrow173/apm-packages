# doc-driven-dev Graph Migration

This is the historical migration record for the public graph rename. The old
names below are intentionally retained only in this file.

## Final mapping

```text
old: doc-driven-dev-lifecycle / route_lifecycle.js
new: doc-driven-dev-graph / route_graph.js
```

The distributed skill directory, Graph Definition, references, CLI, tests, and
public package documents now use the new names. Generated JavaScript is rebuilt
from the TypeScript source by the package build; no compatibility alias is
published.

## What changed

- Routing topology moved to `graphs/doc-driven-dev.yaml`.
- Graph State is projected from canonical Markdown on every turn.
- The caller performs one route, required audits, delegate dispatch, evidence
  recording, and re-projection.
- The generic condition DSL supports signals, gates, and Task Graph predicates.
- Priority is deterministic: ascending priority, then edge ID.
- Delegated briefing and implementation work remains in its own subgraph.
- A Task Graph `wont-do` status never satisfies a dependency.
- Markdown remains the durable history; the runtime has no parallel database.

## Verification

The migration was checked with the public documentation contract test, the
package test suite, Markdown lint, residue search, and `git diff --check`.
Historical references to the old names must stay confined to this document.
