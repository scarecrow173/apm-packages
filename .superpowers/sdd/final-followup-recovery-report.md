# Final Follow-up Recovery Report

## Scope

Closed the final-review P1 gap in follow-up triage routing. When an upstream
gate is failing but its typed `followup-triage` recovery edge is absent from an
otherwise schema-valid custom graph, the router now selects the declared
`followup-triage-retry` edge before considering typed follow-up outcomes. It
therefore cannot dispatch `followup-doc-only` (or another typed outcome) to
`exit-audit` while the upstream gate remains failed.

## Regression coverage

Added a custom-graph regression that removes
`followup-triage-to-planning-repair`, marks planning failed, supplies the typed
doc-only signal, and asserts the route stays at `followup-triage` with reason
`followups-unclassified` and edge `followup-triage-retry`.

## Verification

- `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-router.test.ts` — 32 passed.
- No generated JavaScript, YAML, or unrelated dirty files were changed.
