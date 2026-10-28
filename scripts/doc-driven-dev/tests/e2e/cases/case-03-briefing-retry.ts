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
  focus: ["PLAN-0001"],
  signals: ["implementation-verified", "followup-terminal", "exit-audit-pass"],
  script: {
    "briefing-retry": {
      audits: { spec: "completed", adr: "completed" },
      delegate: "completed",
      mutate: [{ set: { path: "docs/specs/0001-graph.md", frontmatter: { status: "approved" } } }],
    },
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
      "briefing-retry", "briefing-to-design", "design-to-planning",
      "planning-to-task-graph", "task-graph-to-implementation", "implementation-to-followup-triage",
      "followup-triage-terminal", "exit-audit-to-complete", null,
    ],
    completedEdges: [
      "briefing-retry", "briefing-to-design", "design-to-planning",
      "planning-to-task-graph", "task-graph-to-implementation", "implementation-to-followup-triage",
      "followup-triage-terminal", "exit-audit-to-complete",
    ],
    events: [{ kind: "route-selected", count: 9 }],
    finalFiles: {
      "docs/specs/0001-graph.md": { frontmatter: { status: "approved" } },
      "docs/tasks/0001-task.md": { frontmatter: { status: "done" } },
    },
  },
};
