import type { E2ECase } from "../harness/case_types";

/**
 * Happy path: probe → briefing → design → planning → task-graph →
 * implementation → verification → knowledge-consolidation → exit-audit →
 * complete (Graph Definition v3).
 *
 * Delegate/audit/commitGate bindings belong to each edge's DESTINATION node:
 * probe-to-briefing dispatches briefing-flow + audits [spec,adr];
 * implementation-to-verification runs audits [verification] with no
 * delegate; verification-to-knowledge-consolidation dispatches
 * knowledge-doc + audits [knowledge]; knowledge-consolidation-to-exit-audit
 * dispatches doc-status + audits [all];
 * task-graph-to-implementation has commitGate (destination implementation);
 * exit-audit-to-complete has no effects (destination complete is terminal —
 * only evidence is recorded).
 *
 * Two intentional differences from the plan's literal spec (the plan's version
 * is unreachable — see task-3-report.md):
 *  1. `signals` declares knowledge-consolidated / exit-audit-pass up front —
 *     the caller-side signals the knowledge-consolidation / exit-audit
 *     gates require. The verification gate's authority is the
 *     auto-computed Verification Summary bound to HEAD (Issue #241), never
 *     a caller signal — the fixture declares no required checks, so the
 *     summary verifies vacuously once every selected task is done.
 *     No edge before its gate's node consults the signals, so upfront
 *     declaration is safe (per-edge injection via the live signals set
 *     stays available for repair-loop cases).
 *  2. `task-graph-to-implementation`'s completed delegate mutates TASK-0001's
 *     task RECORD to status "done" — the honest store state an
 *     implementation-flow completion asserts (the implementation gate
 *     requires every selected task done/wont-do). The legacy task doc keeps
 *     "todo" — finalFiles proves the run record, not the corpus Markdown,
 *     is the authority (Issue #237). `commitEvidence: true` then makes
 *     runCase's applyCheckpointEvidence commitAll after declaring the task
 *     doc, so the edge checkpoint completes on a clean tree.
 */
export const case01: E2ECase = {
  id: "e2e-01",
  description: "happy path: probe → … → complete",
  fixture: { taskStatuses: ["todo"] },
  focus: ["DESIGN-0001"],
  signals: ["knowledge-consolidated", "exit-audit-pass"],
  script: {
    "probe-to-briefing": { audits: { spec: "completed", adr: "completed" }, delegate: "completed" },
    "briefing-to-design": { audits: { design: "completed" }, delegate: "completed" },
    "design-to-planning": { audits: { design: "completed" }, delegate: "completed" },
    "planning-to-task-graph": {
      audits: { design: "completed" },
      delegate: "completed",
    },
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
  expect: {
    yield: "terminal",
    edgeSequence: [
      "probe-to-briefing", "briefing-to-design", "design-to-planning",
      "planning-to-task-graph", "task-graph-to-implementation", "implementation-to-verification", "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit", "exit-audit-to-complete", null,
    ],
    completedEdges: [
      "probe-to-briefing", "briefing-to-design", "design-to-planning",
      "planning-to-task-graph", "task-graph-to-implementation", "implementation-to-verification", "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit", "exit-audit-to-complete",
    ],
    finalFiles: {
      // The corpus doc is untouched — never the authority the graph read.
      "docs/tasks/0001-task.md": { frontmatter: { status: "todo" } },
    },
    run: { tasks: { "TASK-0001": { status: "done" } } },
  },
};
