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
package test suite (257/257), Markdown lint (23 files), generated script build,
the table-driven CLI scenario matrix (55/55 graph tests), the generated CLI
smoke route, and scoped `git diff --check`.

`apm compile --dry-run --cwd packages/doc-driven-dev` was attempted verbatim;
the installed APM 0.23.1 rejects the unsupported `--cwd` option (exit 2).

The strict residue audit over `packages/doc-driven-dev` and
`scripts/doc-driven-dev` is clean. A repository-wide audit excluding this file
and `docs/superpowers/plans/**` finds only three historical, user-owned
untracked plans containing old names; those plans were intentionally preserved
and are not migration runtime, source, test, distributed, or public-doc
residue. Historical references to the old names must stay confined to this
document and explicitly retained plan history.

Reason-schema work for `wont-do` remains intentionally deferred; execution
resolves the status while dependency satisfaction remains blocked.
