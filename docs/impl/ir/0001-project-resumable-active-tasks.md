---
id: "IMPL-0001"
type: "impl"
status: "in-progress"
title: "Project resumable active tasks"
created: "2026-08-23"
updated: "2026-08-23"
owners: []
relations:
  source: []
  changes:
    added: []
    modified: []
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

# Project resumable active tasks

## Summary

Added the public TaskGraphResult.resumableActive projection. It reports sorted in-progress tasks whose normalized predecessors are all done, and returns an empty list whenever structural graph issues exist.

## Context

Implements Task 1 of the resumable active task routing plan: expose dependency-ready active tasks for later DSL and routing slices without changing the meaning of the existing active projection.

## Implementation

### Changes

Extended TaskGraphResult with resumableActive: string[]. summarizeTaskGraph() computes it from sorted normalized edges and task statuses, suppressing the projection when normalized structural issues are present, then sorts it by task ID. Added focused tests covering ready active tasks, unresolved active tasks, deterministic sorting, and fail-closed structural issues.

### Decisions During Implementation

Kept active as the complete in-progress task list. Downstream todo tasks remain represented by existing blocked reasons; they do not make an otherwise ready active task non-resumable. Used the same structural-issue gate and predecessor readiness rule as runnable.

## Related Experiments

### Adopted

None.

### Rejected

None.

## Validation

- RED: rtk pnpm exec tsx --test tests/doc-driven-dev-graph-task-graph.test.ts from scripts/doc-driven-dev — 17 tests, 14 passed, 3 failed (the new assertions reported missing resumableActive).
- GREEN: rtk pnpm exec tsx --test tests/doc-driven-dev-graph-task-graph.test.ts — 17 passed, 0 failed.
- Full suite: rtk pnpm exec tsx --test tests/*.test.ts — 155 passed, 0 failed.
- Mise activation emitted only the known PowerShell 5.1 chpwd compatibility warning.

## Risks

The source projection is implemented and tested, but distributed/generated package assets are intentionally outside this slice ownership and may need synchronization in a later integration slice. Status remains in-progress pending controller review.

## Follow-ups

Controller review; then consume resumableActive in the graph DSL/routing slices and update any generated/distributed artifacts those slices own.
