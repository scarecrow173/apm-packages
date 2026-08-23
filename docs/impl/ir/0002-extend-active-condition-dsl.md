---
id: "IMPL-0002"
type: "impl"
status: "completed"
title: "Extend active condition DSL"
created: "2026-08-23"
updated: "2026-08-24"
owners: []
relations:
  source: []
  changes:
    added: []
    modified:
      - type: "file"
        path: "scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/graph_definition.ts"
      - type: "file"
        path: "scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/graph_conditions.ts"
      - type: "file"
        path: "scripts/doc-driven-dev/tests/doc-driven-dev-graph-definition.test.ts"
      - type: "file"
        path: "scripts/doc-driven-dev/tests/doc-driven-dev-graph-router.test.ts"
    deleted: []
    renamed: []
    moved: []
    generated: []
  implements:
    - "docs/superpowers/plans/2026-08-23-resumable-active-task-routing.md"
  implemented-by: []
  depends-on: []
  blocks: []
  supersedes: []
  superseded-by: []
  related: []
  refines: []
  refined-by: []
  derives-from: []
  derived-by: []
  verifies: []
  verified-by: []
  references: []
  defers: []
  deferred-by: []
metadata:
  experiments:
    adopted: []
    rejected: []
---

# Extend active condition DSL

## Summary

Extend the generic Task Graph condition DSL with fail-closed active-task
re-entry semantics.

## Context

This record covers Task 2 of the resumable active task routing plan. Task 1
already projects stable `active` and `resumableActive` lists.

## Implementation

### Changes

- Accept `state: active` in the public condition type and Zod schema.
- Match active only when the Task Graph has no issues and `resumableActive` is
  non-empty.
- Keep `idle` false while any task remains active.
- Cover parser acceptance and all four Task Graph condition states.

### Decisions During Implementation

The evaluator uses the Task Graph projection directly; no new routing-specific
abstraction was added.

## Related Experiments

### Adopted

None; the implementation followed the existing condition evaluator pattern.

### Rejected

None.

## Validation

- RED: focused parser/router tests failed because `active` was rejected and
  `idle` ignored active tasks.
- GREEN: `pnpm exec tsx --test tests/doc-driven-dev-graph-definition.test.ts
  tests/doc-driven-dev-graph-router.test.ts` passed 23/23.
- Independent review found one P3 coverage gap; the test now proves active
  depends only on `resumableActive` and idle rejects structural issues.
- `git diff --check` passed.
- Repository-wide TypeScript checking remains blocked by the unchanged,
  pre-existing extra `};` at
  `skill-discovery-protocol/scripts/lib/types.ts:30`.

## Risks

Task 3 must still declare the active edge before the new condition is reachable
from the distributed graph.

## Follow-ups

Continue with Task 3 after review. Keep the unrelated pre-existing TypeScript
syntax error outside this task's diff.
