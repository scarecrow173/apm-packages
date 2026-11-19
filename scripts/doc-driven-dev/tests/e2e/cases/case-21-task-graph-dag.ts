import type { E2ECase } from "../harness/case_types";

/**
 * e2e-21 — Task DAG semantics beyond the covered baseline (mandatory
 * scenario 5; `active`/`runnable`/`resumableActive`/cycles are pinned by
 * e2e-06/e2e-07a).
 *
 * 21a — `wont-do` never satisfies a dependency. TASK-0001 is done,
 * TASK-0002 is wont-do, and TASK-0003 depends on TASK-0002 — so the
 * projection lists TASK-0003 blocked (`depends-on:TASK-0002`), completed
 * non-empty, nothing runnable/active/resumable, and NO issues: every
 * task-graph condition is false, so no declared edge matches and the
 * router returns a same-node blocked route (`no-matching-edge`) →
 * `unrecoverable-blocker`. A post-leg `route_graph` CLI invocation
 * re-projects the same DAG independently — `runnable:[]`,
 * `resumableActive:[]`, and the blocked reasons — so the assertion is the
 * projection's own output, never the trace's retelling.
 *
 * 21b — a dependency on a task that does not exist in the run is a
 * `missing-task-reference` issue (fail closed: runnable/resumableActive
 * empty): `task-graph-invalid` routes `task-graph-to-planning`, the
 * scripted delegate completes without repairing, the planning gate stays
 * blocked (`task-graph:*` reasons), and the identical `planning-retry`
 * trips the route-fingerprint guard → `budget-exhausted`. A post-leg
 * `route_graph` call independently pins the issue code. The dangling
 * record is written raw via `runFiles` — `createRun`'s own intake
 * validation refuses a dangling `dependsOn`, so only the read path can
 * ever see it (the projection's fail-closed contract is what is under
 * test).
 */
export const case21a: E2ECase = {
  id: "e2e-21a",
  description: "wont-do predecessor blocks the dependent → no task-graph condition matches → unrecoverable-blocker",
  current: "task-graph",
  fixture: {
    taskStatuses: ["done", "wont-do", "todo"],
    dependsOn: [[], ["TASK-0001"], ["TASK-0002"]],
  },
  focus: ["DESIGN-0001"],
  steps: [{}],
  postOps: [
    {
      kind: "cli",
      cli: "route_graph",
      argv: ["--current", "task-graph", "--focus", "DESIGN-0001", "--json"],
      saveAs: "route",
    },
  ],
  expect: {
    yield: "unrecoverable-blocker",
    edgeSequence: [null],
    completedEdges: [],
    blockersContain: ["no-matching-edge"],
    tasksContain: [
      // The blocked route still carries the projection — wont-do and the
      // dependent it wedges are both visible, honestly.
      { edgeId: null, id: "TASK-0002", status: "wont-do" },
      { edgeId: null, id: "TASK-0003", status: "todo" },
    ],
    events: [
      { kind: "route-selected", count: 1 },
      { kind: "effect-dispatched", count: 0 },
      { kind: "run-yield", count: 1 },
    ],
    cli: [
      {
        saveAs: "route",
        exit: 0,
        jsonMatch: {
          status: "blocked",
          condition: "blocked",
          taskGraph: {
            runnable: [],
            active: [],
            resumableActive: [],
            completed: ["TASK-0001"],
            blocked: [
              { id: "TASK-0002", reasons: ["status:wont-do"] },
              { id: "TASK-0003", reasons: ["depends-on:TASK-0002"] },
            ],
            issues: [],
          },
        },
      },
    ],
  },
};

export const case21b: E2ECase = {
  id: "e2e-21b",
  description: "dangling depends-on → missing-task-reference → task-graph-to-planning → planning-retry → budget-exhausted",
  current: "task-graph",
  fixture: {
    // Two task docs so the leg-scoped run seeds TASK-0002 — the raw record
    // below then REPLACES e2e-run's TASK-0002 with the dangling variant
    // (createRun's intake validation refuses a dangling dependsOn, so only
    // the read path can ever see it — the projection's fail-closed contract
    // is what is under test).
    taskStatuses: ["todo", "todo"],
    runFiles: {
      "tasks/TASK-0002.json": JSON.stringify({
        schemaVersion: 1,
        runId: "e2e-run",
        taskId: "TASK-0002",
        title: "TASK-0002",
        status: "todo",
        dependsOn: ["TASK-9999"],
        checks: [],
        scope: [],
        version: 1,
        createdAt: "2026-08-24T00:00:00.000Z",
        updatedAt: "2026-08-24T00:00:00.000Z",
      }, null, 2),
    },
  },
  focus: ["DESIGN-0001"],
  script: {
    "task-graph-to-planning": { audits: { design: "completed" }, delegate: "completed" },
    "planning-retry": { audits: { design: "completed" }, delegate: "completed" },
  },
  postOps: [
    {
      kind: "cli",
      cli: "route_graph",
      argv: ["--current", "task-graph", "--focus", "DESIGN-0001", "--json"],
      saveAs: "route",
    },
  ],
  expect: {
    yield: "budget-exhausted",
    edgeSequence: ["task-graph-to-planning", "planning-retry", "planning-retry"],
    completedEdges: ["task-graph-to-planning", "planning-retry"],
    blockersContain: ["task-graph-invalid"],
    events: [
      { kind: "route-selected", count: 3 },
      { kind: "run-yield", count: 1 },
    ],
    cli: [
      {
        saveAs: "route",
        exit: 0,
        jsonMatch: {
          status: "edge",
          edgeId: "task-graph-to-planning",
          condition: "task-graph-invalid",
          taskGraph: {
            runnable: [],
            resumableActive: [],
            issues: [
              {
                code: "missing-task-reference",
                tasks: ["TASK-0002"],
                message: "Task TASK-0002 depends on TASK-9999, which does not exist in run e2e-run — dependencies resolve inside the same run only",
              },
            ],
          },
        },
      },
    ],
  },
};
