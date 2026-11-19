import type { E2ECase } from "../harness/case_types";

/**
 * e2e-22 — parallel independent tasks + CAS conflict rejection
 * (mandatory scenario 6).
 *
 * 22a — two dependency-free tasks are BOTH runnable in one projection:
 * `tasks-runnable` selects `task-graph-to-implementation` once, and the
 * scripted delegate completes both task records in one dispatch (a CAS
 * write apiece — version 1 → 2). `tasksContain` pins both ids on the
 * edge's own route projection; the end-of-run store read proves both
 * records reached `done` at version 2.
 *
 * 22b — a losing CAS write must fail closed, never silently merge: the
 * scripted delegate's `task` mutator pins `expectedVersion: 999` — the
 * update's own stale "I read version N" claim — and `updateTask` raises
 * `StoreError`. The dispatcher converts the store refusal into an honest
 * `authority-required` yield (a declined dispatch: `not-executed`
 * observation + yield outcome), and TASK-0001 stays `todo` at version 1 —
 * the parallel writer's race was refused, not overwritten.
 */
export const case22a: E2ECase = {
  id: "e2e-22a",
  description: "two independent tasks runnable in one projection → one edge completes both → terminal",
  current: "task-graph",
  fixture: { taskStatuses: ["todo", "todo"] },
  focus: ["DESIGN-0001"],
  signals: ["knowledge-consolidated", "exit-audit-pass"],
  script: {
    "task-graph-to-implementation": {
      delegate: "completed",
      mutate: [
        { task: { taskId: "TASK-0001", status: "done" } },
        { task: { taskId: "TASK-0002", status: "done" } },
      ],
      commitEvidence: true,
    },
    "implementation-to-verification": { audits: { verification: "completed" } },
    "verification-to-knowledge-consolidation": { audits: { knowledge: "completed" }, delegate: "completed" },
    "knowledge-consolidation-to-exit-audit": { audits: { all: "completed" }, delegate: "completed" },
    "exit-audit-to-complete": {},
  },
  expect: {
    yield: "terminal",
    edgeSequence: [
      "task-graph-to-implementation", "implementation-to-verification",
      "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit",
      "exit-audit-to-complete", null,
    ],
    completedEdges: [
      "task-graph-to-implementation", "implementation-to-verification",
      "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit",
      "exit-audit-to-complete",
    ],
    tasksContain: [
      { edgeId: "task-graph-to-implementation", id: "TASK-0001", status: "todo" },
      { edgeId: "task-graph-to-implementation", id: "TASK-0002", status: "todo" },
    ],
    run: {
      tasks: {
        "TASK-0001": { status: "done", version: 2 },
        "TASK-0002": { status: "done", version: 2 },
      },
    },
  },
};

export const case22b: E2ECase = {
  id: "e2e-22b",
  description: "CAS conflict inside the delegate's store write → authority-required; record untouched",
  current: "task-graph",
  fixture: { taskStatuses: ["todo"] },
  focus: ["DESIGN-0001"],
  script: {
    "task-graph-to-implementation": {
      delegate: "completed",
      // The stale pin: the update claims it read version 999 — the store's
      // CAS guard refuses, exactly like a parallel writer that lost the race.
      mutate: [{ task: { taskId: "TASK-0001", status: "done", expectedVersion: 999 } }],
      commitEvidence: true,
    },
  },
  expect: {
    yield: "authority-required",
    edgeSequence: ["task-graph-to-implementation"],
    completedEdges: [],
    events: [
      { kind: "route-selected", count: 1 },
      { kind: "effect-dispatched", edgeId: "task-graph-to-implementation", stage: "delegate", count: 1 },
      { kind: "dispatch-observed", edgeId: "task-graph-to-implementation", method: "not-executed", count: 1 },
      { kind: "effect-outcome", edgeId: "task-graph-to-implementation", outcome: "yield", reason: "authority-required", count: 1 },
      { kind: "run-yield", count: 1 },
    ],
    // The refused write left no trace — status and CAS version unchanged.
    run: { tasks: { "TASK-0001": { status: "todo", version: 1 } } },
    gitDirty: false,
  },
};
