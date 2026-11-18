import type { E2ECase } from "../harness/case_types";

/**
 * briefing gate not-pass → briefing-retry → briefing-to-design → terminal.
 *
 * The fixture spec starts `status: "draft"` — outside the briefing gate's
 * accepted set (proposed/approved/implemented) — and the run enters at the
 * `briefing` node directly (`current: "briefing"`), so the spec asserts the
 * retry edge without depending on bootstrap-gate entry semantics.
 *
 * `briefing-retry`'s destination is `briefing`, so the edge still dispatches
 * the [spec, adr] audits and the briefing-flow delegate; the scripted
 * delegate completes and its `mutate` marks the spec approved — the honest
 * document state a real delegate would leave behind. The next projection
 * passes the briefing gate and takes `briefing-to-design`; the retry edge
 * therefore appears exactly once, immediately before it, in the asserted
 * edgeSequence.
 */
export const case03: E2ECase = {
  id: "e2e-03",
  description: "briefing gate not-pass → briefing-retry once → … → complete",
  current: "briefing",
  fixture: {
    taskStatuses: ["todo"],
    files: {
      "docs/specs/0001-graph.md": {
        frontmatter: { id: "SPEC-0001", type: "spec", status: "draft", title: "Graph" },
        body: "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph\n",
      },
    },
  },
  focus: ["DESIGN-0001"],
  signals: ["knowledge-consolidated", "exit-audit-pass"],
  script: {
    "briefing-retry": {
      audits: { spec: "completed", adr: "completed" },
      delegate: "completed",
      mutate: [{ set: { path: "docs/specs/0001-graph.md", frontmatter: { status: "approved" } } }],
    },
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
      "briefing-retry", "briefing-to-design", "design-to-planning",
      "planning-to-task-graph", "task-graph-to-implementation", "implementation-to-verification", "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit", "exit-audit-to-complete", null,
    ],
    completedEdges: [
      "briefing-retry", "briefing-to-design", "design-to-planning",
      "planning-to-task-graph", "task-graph-to-implementation", "implementation-to-verification", "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit", "exit-audit-to-complete",
    ],
    events: [{ kind: "route-selected", count: 10 }],
    finalFiles: {
      "docs/specs/0001-graph.md": { frontmatter: { status: "approved" } },
      // Corpus doc untouched — the run record is the task authority.
      "docs/tasks/0001-task.md": { frontmatter: { status: "todo" } },
    },
    run: { tasks: { "TASK-0001": { status: "done" } } },
  },
};
