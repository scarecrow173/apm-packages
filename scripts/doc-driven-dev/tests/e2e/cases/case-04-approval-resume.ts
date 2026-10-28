import type { E2ECase } from "../harness/case_types";

/**
 * approval-required yield on a delegate → pending edge → resume reuses audits.
 *
 * The fixture plan starts `status: "in-progress"` — a status that is both a
 * valid chain record and planning-gate-passing, so leg 1 reaches the yield
 * point (a non-chain status like "proposed" would leave the chain
 * unselectable, failing the briefing gate before the yield — verified live).
 * Leg 1 completes probe→briefing→design, then on `design-to-planning`
 * (destination `planning`: audits [design] + delegate planning-flow — the
 * only edge that both dispatches planning-flow and can carry a completed
 * design audit) the scripted delegate yields "approval-required". The
 * pending edge saves the completed design audit.
 *
 * Leg 2 resumes by handoff (no `resume: false` — pending state threads
 * through): `mutateBefore` approves the plan — a REAL status change, but not
 * an input of the design audit, so the stored outcome's fingerprints stay
 * live — and the runner re-routes design-to-planning, skips the completed
 * audit (zero audit dispatches on the resumed edge — asserted edge-scoped,
 * since later edges legitimately dispatch their own audits), re-dispatches
 * only the delegate, and continues to terminal.
 */
export const case04: E2ECase = {
  id: "e2e-04",
  description: "approval-required yield → pending edge resume → terminal",
  fixture: {
    taskStatuses: ["todo"],
    files: {
      "docs/plans/0001-graph.md": {
        frontmatter: {
          id: "PLAN-0001", type: "plan", status: "in-progress", title: "Graph",
          relations: { "derives-from": ["DESIGN-0001"], "verified-by": ["docs/test-specs/0001-graph.md"] },
        },
        body: "# Graph\n",
      },
    },
  },
  focus: ["PLAN-0001"],
  signals: ["implementation-verified", "followup-terminal", "exit-audit-pass"],
  script: {
    "probe-to-briefing": { audits: { spec: "completed", adr: "completed" }, delegate: "completed" },
    "briefing-to-design": { audits: { design: "completed" }, delegate: "completed" },
    "design-to-planning": {
      audits: { design: "completed" },
      // Queue: leg 1 yields approval-required; leg 2's resume completes it.
      delegate: [{ yield: "approval-required" }, "completed"],
    },
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
      // Leg 1: two checkpoints, then the delegate yield parks the pending edge.
      expect: {
        yield: "approval-required",
        edgeSequence: ["probe-to-briefing", "briefing-to-design", "design-to-planning"],
        completedEdges: ["probe-to-briefing", "briefing-to-design"],
      },
    },
    {
      // The approval the yield was waiting for — applied between runs.
      mutateBefore: [{ set: { path: "docs/plans/0001-graph.md", frontmatter: { status: "approved" } } }],
      expect: {
        yield: "terminal",
        edgeSequence: [
          "design-to-planning", "planning-to-task-graph", "task-graph-to-implementation",
          "implementation-to-followup-triage", "followup-triage-terminal", "exit-audit-to-complete", null,
        ],
        events: [
          // Pending audits are reused, not re-run, on the resumed edge…
          { kind: "effect-dispatched", edgeId: "design-to-planning", stage: "audit", count: 0 },
          // …while the incomplete delegate is re-dispatched exactly once.
          { kind: "effect-dispatched", edgeId: "design-to-planning", stage: "delegate", count: 1 },
        ],
      },
    },
  ],
  expect: {
    yield: "terminal",
    edgeSequence: [
      "design-to-planning", "planning-to-task-graph", "task-graph-to-implementation",
      "implementation-to-followup-triage", "followup-triage-terminal", "exit-audit-to-complete", null,
    ],
    completedEdges: [
      "probe-to-briefing", "briefing-to-design", "design-to-planning",
      "planning-to-task-graph", "task-graph-to-implementation", "implementation-to-followup-triage",
      "followup-triage-terminal", "exit-audit-to-complete",
    ],
    events: [
      { kind: "route-selected", count: 10 }, // whole-run: 3 (leg 1) + 6 edges + 1 terminal (leg 2)
      { kind: "run-yield", count: 2 },
    ],
    finalFiles: {
      "docs/plans/0001-graph.md": { frontmatter: { status: "approved" } },
      "docs/tasks/0001-task.md": { frontmatter: { status: "done" } },
    },
  },
};
