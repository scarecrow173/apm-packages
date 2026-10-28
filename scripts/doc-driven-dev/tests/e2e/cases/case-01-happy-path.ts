import type { E2ECase } from "../harness/case_types";

/**
 * Happy path: probe → briefing → design → planning → task-graph →
 * implementation → followup-triage → exit-audit → complete.
 *
 * Delegate/audit/commitGate bindings belong to each edge's DESTINATION node:
 * probe-to-briefing dispatches briefing-flow + audits [spec,adr];
 * implementation-to-followup-triage runs audits [task,impl-record] with no
 * delegate; followup-triage-terminal dispatches doc-status + audits [all];
 * task-graph-to-implementation has commitGate (destination implementation);
 * exit-audit-to-complete has no effects (destination complete is terminal —
 * only evidence is recorded).
 *
 * Two intentional differences from the plan's literal spec (the plan's version
 * is unreachable — see task-3-report.md):
 *  1. `signals` declares implementation-verified / followup-terminal /
 *     exit-audit-pass up front — the caller-side verification signals the
 *     implementation / followup-triage / exit-audit gates require. No edge
 *     before its gate's node consults them, so upfront declaration is safe
 *     (per-edge injection via the live signals set stays available for
 *     repair-loop cases).
 *  2. `task-graph-to-implementation`'s completed delegate mutates TASK-0001 to
 *     status "done" — the honest document state an implementation-flow
 *     completion asserts (the implementation gate requires every selected
 *     task done/wont-do). `finalFiles` therefore expects "done", not "todo".
 *     `commitEvidence: true` then makes runCase wire applyEvidence to
 *     persistEvidence + commitAll so the checkpoint completes on a clean tree.
 */
export const case01: E2ECase = {
  id: "e2e-01",
  description: "happy path: probe → … → complete",
  fixture: { taskStatuses: ["todo"] },
  focus: ["PLAN-0001"],
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
    finalFiles: { "docs/tasks/0001-task.md": { frontmatter: { status: "done" } } },
  },
};
