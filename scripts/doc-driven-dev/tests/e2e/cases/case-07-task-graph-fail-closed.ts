import type { E2ECase } from "../harness/case_types";

/**
 * e2e-07 — fail-closed task graph, three siblings.
 *
 * 07a/07b surface distinct `taskGraph.issues` (task-cycle vs duplicate-task-id)
 * inside the selected run's task RECORDS (Issue #237 — the store is the
 * authority). Both make the `task-graph-invalid` condition true at
 * `task-graph`, so the run takes the priority-10 repair edge
 * `task-graph-to-planning` — a REAL edge (destination `planning`: audits
 * [design] + delegate planning-flow), not a blocked route. The scripted
 * delegate completes but does not repair the underlying issue, so the
 * planning gate stays `blocked` (`task-graph:<code>` reasons) and
 * `planning-retry` is selected. That route completes once; its
 * byte-identical re-selection trips the runner's route-fingerprint guard →
 * `budget-exhausted`. The repair is deterministic and non-progressing: the
 * case asserts the full bounded trajectory, not just the first edge.
 *
 * 07b detail: under the store, duplicate task ids can never be written via
 * the API (updateTask keys records by id), so the fixture materializes the
 * corruption directly — a second record FILE under tasks/ claiming
 * `taskId: "TASK-0001"`. Record files are keyed by filename but bound by
 * the `taskId` field, so the projection sees two records for one task and
 * reports `duplicate-task-id` — fail closed, never a silent dedup.
 *
 * 07c is the artifact-graph sibling: two spec docs sharing `id: SPEC-0001`
 * yield a `duplicate-id` issue, which `deriveHardBlockers` promotes to a hard
 * blocker → same-node blocked route at `probe`, zero dispatches. Deviation
 * from the brief: the yield is `input-required`, not `unrecoverable-blocker`
 * — `projectGraphState` force-injects `focus-required` whenever a
 * `duplicate-id` exists (focus is ambiguous by construction), and the runner
 * maps any blocked route carrying `focus-required` to `input-required`
 * (caller_runner.ts:592). `duplicate-id` itself is colon-free, so the
 * sanitized trace keeps it verbatim; the duplicated id also makes the two
 * `SPEC-0001`-targeting relations ambiguous → `broken-relation:sha256:<12hex>`
 * tokens.
 */
export const case07a: E2ECase = {
  id: "e2e-07a",
  description: "task dependency cycle → task-graph-to-planning → identical planning-retry → budget-exhausted",
  current: "task-graph",
  fixture: {
    taskStatuses: ["todo", "todo"],
    dependsOn: [["TASK-0002"], ["TASK-0001"]],
  },
  focus: ["PLAN-0001"],
  script: {
    // The scripted repairs complete honestly but leave the cycle intact —
    // that is what makes the retry loop deterministic.
    "task-graph-to-planning": { audits: { design: "completed" }, delegate: "completed" },
    "planning-retry": { audits: { design: "completed" }, delegate: "completed" },
  },
  expect: {
    yield: "budget-exhausted",
    // First edge is the repair edge; the identical re-route is emitted by the
    // tracer before the fingerprint guard yields.
    edgeSequence: ["task-graph-to-planning", "planning-retry", "planning-retry"],
    completedEdges: ["task-graph-to-planning", "planning-retry"],
    blockersContain: ["task-graph-invalid"],
    events: [
      { kind: "route-selected", count: 3 },
      { kind: "run-yield", count: 1 },
    ],
  },
};

export const case07b: E2ECase = {
  id: "e2e-07b",
  description: "duplicate task id → duplicate-task-id issue → task-graph-to-planning → budget-exhausted",
  current: "task-graph",
  fixture: {
    taskStatuses: ["todo"],
    runFiles: {
      // A second record file claiming the same taskId — written raw because
      // the store API can never produce it (records key by taskId).
      "tasks/TASK-0001-dup.json": JSON.stringify({
        schemaVersion: 1,
        runId: "e2e-run",
        taskId: "TASK-0001",
        title: "TASK-0001 duplicate",
        status: "todo",
        dependsOn: [],
        checks: [],
        scope: [],
        version: 1,
        createdAt: "2026-08-24T00:00:00.000Z",
        updatedAt: "2026-08-24T00:00:00.000Z",
      }, null, 2),
    },
  },
  focus: ["PLAN-0001"],
  script: {
    "task-graph-to-planning": { audits: { design: "completed" }, delegate: "completed" },
    "planning-retry": { audits: { design: "completed" }, delegate: "completed" },
  },
  expect: {
    yield: "budget-exhausted",
    edgeSequence: ["task-graph-to-planning", "planning-retry", "planning-retry"],
    completedEdges: ["task-graph-to-planning", "planning-retry"],
    blockersContain: ["task-graph-invalid"],
    events: [
      { kind: "route-selected", count: 3 },
      { kind: "run-yield", count: 1 },
    ],
  },
};

export const case07c: E2ECase = {
  id: "e2e-07c",
  description: "duplicate spec id → duplicate-id hard blocker → blocked at probe → input-required",
  fixture: {
    taskStatuses: ["todo"],
    files: {
      "docs/specs/0002-dup.md": {
        frontmatter: { id: "SPEC-0001", type: "spec", status: "approved", title: "Duplicate spec" },
        body: "# Duplicate\n",
      },
    },
  },
  // Focus is supplied AND still overridden: duplicate-id force-injects
  // focus-required, so the run fails closed with input-required.
  focus: ["PLAN-0001"],
  expect: {
    yield: "input-required",
    edgeSequence: [null],
    completedEdges: [],
    blockersContain: [
      "duplicate-id", // colon-free → verbatim token
      "focus-required", // force-injected by the duplicate → input-required (not unrecoverable-blocker)
      /^broken-relation:sha256:[0-9a-f]{12}$/, // ambiguous SPEC-0001 references
    ],
    events: [
      { kind: "route-selected", count: 1 },
      { kind: "effect-dispatched", count: 0 },
    ],
  },
};
