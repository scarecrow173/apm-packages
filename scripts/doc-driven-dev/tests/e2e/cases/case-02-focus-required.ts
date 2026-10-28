import type { E2ECase } from "../harness/case_types";

/**
 * focus-required → input-required, then a FRESH second leg completes the run.
 *
 * Leg 1 runs with no focus: the fixture carries active-status docs, so
 * resolveArtifactFocus emits the verbatim "focus-required" blocker, the
 * router returns a same-node blocked route at probe, and the runner yields
 * "input-required" — one route-selected, zero dispatches, zero checkpoints.
 *
 * Leg 2 is a NEW run on the same repo + runId/trace (`resume: false`): a
 * blocked leg saves no pending edge, so there is nothing to resume — focus
 * simply becomes a fresh-run option. The happy sequence then replays end to
 * end. The case-level `events` tally is whole-run scoped: 1 blocked route in
 * leg 1 + 8 edges + 1 terminal row in leg 2 = 10 route-selected events.
 */
export const case02: E2ECase = {
  id: "e2e-02",
  description: "focus-required blocks leg 1; fresh leg 2 with focus reaches terminal",
  fixture: { taskStatuses: ["todo"] },
  signals: ["implementation-verified", "followup-terminal", "exit-audit-pass"],
  script: {
    "probe-to-briefing": { audits: { spec: "completed", adr: "completed" }, delegate: "completed" },
    "briefing-to-design": { audits: { design: "completed" }, delegate: "completed" },
    "design-to-planning": { audits: { design: "completed" }, delegate: "completed" },
    "planning-to-task-graph": {
      audits: { plan: "completed", task: "completed", "test-spec": "completed" },
      delegate: "completed",
    },
    "task-graph-to-implementation": {
      delegate: "completed",
      mutate: [{ set: { path: "docs/tasks/0001-task.md", frontmatter: { status: "done" } } }],
      commitEvidence: true,
    },
    "implementation-to-followup-triage": { audits: { task: "completed", "impl-record": "completed" } },
    "followup-triage-terminal": { audits: { all: "completed" }, delegate: "completed" },
    "exit-audit-to-complete": {},
  },
  steps: [
    {
      // No focus: blocked at probe — one route-selected (edgeId null), no work.
      expect: {
        yield: "input-required",
        edgeSequence: [null],
        completedEdges: [],
        blockersContain: ["focus-required"],
      },
    },
    {
      // Fresh run on the same trace — NOT a resume (blocked runs carry no
      // pending state). All runner options apply again; only focus changes.
      options: { resume: false, focus: ["PLAN-0001"] },
      expect: {
        yield: "terminal",
        edgeSequence: [
          "probe-to-briefing", "briefing-to-design", "design-to-planning",
          "planning-to-task-graph", "task-graph-to-implementation", "implementation-to-followup-triage",
          "followup-triage-terminal", "exit-audit-to-complete", null,
        ],
      },
    },
  ],
  expect: {
    yield: "terminal",
    edgeSequence: [
      "probe-to-briefing", "briefing-to-design", "design-to-planning",
      "planning-to-task-graph", "task-graph-to-implementation", "implementation-to-followup-triage",
      "followup-triage-terminal", "exit-audit-to-complete", null,
    ],
    completedEdges: [
      "probe-to-briefing", "briefing-to-design", "design-to-planning",
      "planning-to-task-graph", "task-graph-to-implementation", "implementation-to-followup-triage",
      "followup-triage-terminal", "exit-audit-to-complete",
    ],
    events: [
      { kind: "route-selected", count: 10 }, // whole-run: 1 blocked (leg 1) + 8 edges + 1 terminal (leg 2)
      { kind: "run-yield", count: 2 },
    ],
    finalFiles: { "docs/tasks/0001-task.md": { frontmatter: { status: "done" } } },
  },
};
