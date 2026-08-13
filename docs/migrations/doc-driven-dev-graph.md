# doc-driven-dev Graph Migration

This document is the historical record for the doc-driven-dev lifecycle graph
rename. Old public names are intentionally retained here so that migration
work can refer to them without reintroducing them into current package APIs.

## Before migration

### Branch and ancestry baseline

- Implementation branch: `codex/doc-driven-dev-graph`
- Source branch: `codex/doc-driven-dev-lifecycle-graph`
- Starting HEAD: `ce3e2cf80d20ed9767e3292a7d30e9d2db49aad9`
- `main` merge-base: `a75c1a0038a6b9f513fca1c5cea419de2fe4a202`
- Branch decision: the source branch was unmerged (10 commits ahead of the
  merge-base), so this branch was created from its HEAD rather than from
  `main`. The branch was created from local refs; no network fetch was assumed.

### Source and package locations

- TypeScript source directory:
  `scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/`
- Distributed package skill directory:
  `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/`

### Historical public entrypoints

- Distributed CLI scripts: `build_task_graph.js`, `migrate_docs.js`,
  `route_lifecycle.js`, and `scaffold_docs.js` under the package skill
  directory; their TypeScript sources are the matching `*.ts` files under the
  source directory.
- Graph module (`scripts/lib/lifecycle_graph.ts`):
  `LifecycleNodeId`, `LifecycleNodeKind`, `LifecycleReasonCode`,
  `LifecycleNode`, `LifecycleEdge`, `LifecycleGraph`, `parseLifecycleGraph`,
  `loadLifecycleGraph`, and `findEdge`.
- State module (`scripts/lib/lifecycle_state.ts`): `LifecycleSignal`,
  `GateResult`, `GateResults`, `LifecycleState`,
  `ProbeLifecycleStateOptions`, `evaluateLifecycleGates`, and
  `probeLifecycleState`.
- Router module (`scripts/lib/lifecycle_router.ts`): `LifecycleRoute`,
  `routeLifecycle`, and `routingPrecedence`.
- The lifecycle skill name and references were `doc-driven-dev-lifecycle`,
  including `route_lifecycle.js` as the agent-facing routing command.

### Inventory command

The pre-migration inventory was captured with:

```powershell
rg -n "doc-driven-dev-lifecycle|lifecycle_graph|lifecycle_state|lifecycle_router|route_lifecycle|LifecycleGraph|LifecycleState|LifecycleRoute|LifecycleSignal|LifecycleReasonCode|probeLifecycleState|evaluateLifecycleGates|parseLifecycleGraph|loadLifecycleGraph|routeLifecycle" packages/doc-driven-dev scripts/doc-driven-dev
```

### Baseline suite

Baseline checks ran on 2026-08-13 at the starting HEAD above:

- `pnpm --dir scripts/doc-driven-dev test` — **PASS**: 265 tests, 265 passed,
  0 failed, 0 skipped, 0 todo.
- `pnpm --dir scripts/doc-driven-dev run lint:md` — **PASS**: 14 Markdown
  files linted, 0 errors.
