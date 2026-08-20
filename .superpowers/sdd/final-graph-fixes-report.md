# Final Graph Migration Fixes Report

## Fix A — generic prerequisite fail-closed routing

`routeGraph()` now evaluates the current node's declared `requiresGates`
before selecting any outgoing edge. A missing or non-passing prerequisite
returns a same-node blocked route (`edgeId: null`, `condition: blocked`) and
never dispatches a success or terminal edge. `GraphRoute.blockers` preserves
the existing state blockers and adds deterministic `required-gate:<gate>` plus
`required-gate:<gate>:<reason>` entries, keeping failed prerequisite evidence
visible. Terminal re-entry remains idempotent.

Regression coverage uses arbitrary node and gate IDs and a canonical
`exit-audit` state with a failed upstream design gate plus `exit-audit-pass`;
the latter remains at `exit-audit` and cannot reach `complete`. The graph
contract references document the blocker visibility guarantee in English and
Japanese.

## Fix B — residue report and command

The tracked follow-up recovery report now uses graph-native test terminology
and no longer contains the retired lifecycle-router test path. Residue checks
include tracked dot-paths and untracked non-ignored files; only the migration
document and user-owned plan directory are excluded:

```powershell
$legacy = ("doc-driven-dev", "lifecycle", "router.test.ts" -join "-")
git ls-files -co --exclude-standard |
  Where-Object { $_ -ne "docs/migrations/doc-driven-dev-graph.md" -and $_ -notlike "docs/superpowers/plans/*" } |
  ForEach-Object { Select-String -LiteralPath $_ -Pattern $legacy -SimpleMatch }
```

Result: zero matches outside the explicit exclusions, including tracked
`.superpowers/**` reports.

## Verification

- Focused graph-router and routing-contract tests: 15 passed.
- Graph CLI regression suite: 6 passed.
- Full `pnpm --dir scripts/doc-driven-dev test`: 1 pre-existing docs-suite
  failure (`scripts/doc-driven-dev/src/skills/skill-discovery-protocol/assets/adapters`
  is absent in this worktree); all graph tests pass, including the updated CLI
  retry fixture.
- `pnpm --dir scripts/doc-driven-dev build:scripts`: passed; generated
  `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/route_graph.js`
  contains the same prerequisite guard.
- `pnpm --dir scripts/doc-driven-dev lint:md`: passed (0 errors).
- Scoped `git diff --check`: passed.
