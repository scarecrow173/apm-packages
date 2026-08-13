# Task 5 implementation report

## Status

Complete.

## Migration

- Moved `task_graph.ts`, `build_task_graph.ts`, `migrate_docs.ts`, and `scaffold_docs.ts` from the lifecycle skill source tree into `doc-driven-dev-graph` with `git mv`.
- Updated `GraphState` and `GraphRoute` to import the graph-local task graph implementation.
- Added the graph-native `GraphSignal` type and used it for projected state and input signals.
- Removed the remaining legacy lifecycle TypeScript runtime modules (`route_lifecycle.ts`, lifecycle graph/state/router/relation modules).
- Renamed lifecycle graph regression tests to graph names and migrated them to `GraphDefinition`, `GraphState`, `GraphRoute`, and `routeGraph` APIs.
- Updated command tests to invoke the graph-native source entry points.

## Behavior covered

The migrated tests retain fan-out/fan-in scheduling, missing references, cycles, duplicate task IDs, fail-closed malformed documents, `wont-do` predecessor blocking, and lifecycle-resolved `wont-do` completion behavior.

## Verification

`pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-graph-*.test.ts` — 49 passed, 0 failed.

## Scope note

Distributed public skill assets and generated JavaScript were intentionally left for later tasks.
