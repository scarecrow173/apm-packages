import type { E2ECase } from "../harness/case_types";

/**
 * e2e-20 — plan approval yields `approval-required`; a plan-DIGEST change
 * voids that approval and demands a fresh one (mandatory scenario 4).
 *
 * Leg 1 enters at `design`: the scripted planning-flow delegate yields
 * `approval-required` on `design-to-planning` — the pending edge parks with
 * the completed design audit attached.
 *
 * Leg 2's `mutateBefore` rewrites the run's `plan.md` through the real
 * `savePlan` boundary: the new content digests differently, so the
 * digest-bound approval no longer describes it — `snapshot.planApproved`
 * is false and the Task Graph projects `plan-not-approved`. The resume
 * still completes `design-to-planning` (its audit stays live — the plan
 * is not an input of the design audit), but at `planning` the gate reads
 * the drifted approval: `task-graph:plan-not-approved` → not-pass →
 * `planning-retry` → byte-identical re-route → `budget-exhausted`. The
 * repair loop is honest and non-progressing: re-approving was the only
 * way through.
 *
 * Leg 3's `approve` mutator binds the CURRENT digest — a real
 * `approvePlan` write — and the resumed run passes the planning gate and
 * reaches terminal. `run.planApproved: true` at end state proves the
 * second approval, not the first, is what the gate accepted.
 */
export const case20: E2ECase = {
  id: "e2e-20",
  description: "approval-required yield → plan digest drift invalidates the approval → re-approval resumes to terminal",
  current: "design",
  fixture: { taskStatuses: ["todo"] },
  focus: ["DESIGN-0001"],
  signals: ["knowledge-consolidated", "exit-audit-pass"],
  script: {
    "design-to-planning": {
      audits: { design: "completed" },
      // Leg 1 yields for approval; leg 2's resumed dispatch completes.
      delegate: [{ yield: "approval-required" }, "completed"],
    },
    "planning-retry": { audits: { design: "completed" }, delegate: "completed" },
    "planning-to-task-graph": { audits: { design: "completed" }, delegate: "completed" },
    "task-graph-to-implementation": {
      delegate: "completed",
      mutate: [{ task: { taskId: "TASK-0001", status: "done" } }],
      commitEvidence: true,
    },
    "implementation-to-verification": { audits: { verification: "completed" } },
    "verification-to-knowledge-consolidation": { audits: { knowledge: "completed" }, delegate: "completed" },
    "knowledge-consolidation-to-exit-audit": { audits: { all: "completed" }, delegate: "completed" },
    "exit-audit-to-complete": {},
  },
  steps: [
    {
      expect: {
        yield: "approval-required",
        edgeSequence: ["design-to-planning"],
        completedEdges: [],
      },
    },
    {
      // savePlan invalidates the digest-bound approval — the digest the
      // first approval bound no longer describes plan.md.
      mutateBefore: [{ plan: { content: "# Plan\n\n- implement the graph — revised\n" } }],
      expect: {
        yield: "budget-exhausted",
        edgeSequence: ["design-to-planning", "planning-retry", "planning-retry"],
        completedEdges: ["design-to-planning", "planning-retry"],
        blockersContain: ["task-graph-invalid"],
        events: [
          // The parked design audit is reused — plan.md is not its input.
          { kind: "effect-dispatched", edgeId: "design-to-planning", stage: "audit", count: 0 },
          { kind: "effect-dispatched", edgeId: "design-to-planning", stage: "delegate", count: 1 },
        ],
      },
    },
    {
      // The re-approval the planning gate was waiting for — bound to the
      // revised plan's current digest.
      mutateBefore: [{ approve: {} }],
      expect: {
        yield: "terminal",
        edgeSequence: [
          "planning-to-task-graph", "task-graph-to-implementation", "implementation-to-verification",
          "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit",
          "exit-audit-to-complete", null,
        ],
      },
    },
  ],
  expect: {
    yield: "terminal",
    edgeSequence: [
      "planning-to-task-graph", "task-graph-to-implementation", "implementation-to-verification",
      "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit",
      "exit-audit-to-complete", null,
    ],
    completedEdges: [
      "design-to-planning", "planning-retry",
      "planning-to-task-graph", "task-graph-to-implementation", "implementation-to-verification",
      "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit",
      "exit-audit-to-complete",
    ],
    events: [
      { kind: "route-selected", count: 11 }, // 1 (leg 1) + 3 (leg 2) + 6 edges + 1 terminal (leg 3)
      { kind: "run-yield", count: 3 },
    ],
    run: {
      planApproved: true,
      tasks: { "TASK-0001": { status: "done" } },
    },
  },
};
