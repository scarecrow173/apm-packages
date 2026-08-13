# Final Follow-up Recovery Report

## Scope

Closed the final-review P1 gap in follow-up triage routing. When an upstream
gate is failing but its typed `followup-triage` recovery edge is absent from an
otherwise schema-valid custom graph, the router now selects the declared
`followup-triage-retry` edge before considering typed follow-up outcomes. It
therefore cannot dispatch `followup-doc-only` (or another typed outcome) to
`exit-audit` while the upstream gate remains failed.

## Regression coverage

Added a custom-graph regression in the graph-router test suite that removes
`followup-triage-to-planning-repair`, marks planning failed, supplies the typed
doc-only signal, and asserts the route stays at `followup-triage` with reason
`followups-unclassified` and edge `followup-triage-retry`.

## Verification

- `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-graph-router.test.ts` — graph-router regressions passed.
- No generated JavaScript, YAML, or unrelated dirty files were changed.

The migration residue check includes tracked dot-paths rather than relying on a
hidden-file-skipping glob. Its only exclusions are the migration document and
the user-owned plan directory:

```powershell
$legacy = ("doc-driven-dev", "lifecycle", "router.test.ts" -join "-")
git ls-files -co --exclude-standard |
  Where-Object { $_ -ne "docs/migrations/doc-driven-dev-graph.md" -and $_ -notlike "docs/superpowers/plans/*" } |
  ForEach-Object { Select-String -LiteralPath $_ -Pattern $legacy -SimpleMatch }
```

Result: zero matches outside the explicit exclusions, including tracked
`.superpowers/**` reports.
