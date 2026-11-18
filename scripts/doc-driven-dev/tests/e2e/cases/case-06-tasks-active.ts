import type { E2ECase } from "../harness/case_types";

/**
 * Task dependencies + tasks-active outranks tasks-runnable.
 *
 * TASK-0001 done; TASK-0002 in-progress with depends-on TASK-0001 (predecessor
 * done → resumableActive); TASK-0003 todo with depends-on TASK-0001 (→
 * runnable). At the `task-graph` node BOTH task-graph conditions hold, so
 * priority 30 `task-graph-to-active-implementation` legitimately beats
 * priority 40 `task-graph-to-implementation` — a real ordering assertion, not
 * just the only matching edge.
 *
 * `tasksContain` binds the {id,status} checks to that edge's own
 * route-selected: the router projected TASK-0002 as in-progress (why the
 * active edge matched) and TASK-0003 as todo (why runnable also matched). The
 * assertion is edge-scoped because the scripted implementation-flow delegate
 * later marks both tasks done — the honest document state its completion
 * asserts (the implementation gate requires every selected task
 * done/wont-do) — so a later route's projection no longer shows them.
 */
export const case06: E2ECase = {
  id: "e2e-06",
  description: "tasks-active outranks tasks-runnable → task-graph-to-active-implementation → complete",
  fixture: {
    taskStatuses: ["done", "in-progress", "todo"],
    dependsOn: [[], ["TASK-0001"], ["TASK-0001"]],
  },
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
    "task-graph-to-active-implementation": {
      delegate: "completed",
      mutate: [
        { task: { taskId: "TASK-0002", status: "done" } },
        { task: { taskId: "TASK-0003", status: "done" } },
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
      "probe-to-briefing", "briefing-to-design", "design-to-planning",
      "planning-to-task-graph", "task-graph-to-active-implementation", "implementation-to-verification", "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit", "exit-audit-to-complete", null,
    ],
    completedEdges: [
      "probe-to-briefing", "briefing-to-design", "design-to-planning",
      "planning-to-task-graph", "task-graph-to-active-implementation", "implementation-to-verification", "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit", "exit-audit-to-complete",
    ],
    tasksContain: [
      { edgeId: "task-graph-to-active-implementation", id: "TASK-0002", status: "in-progress" },
      { edgeId: "task-graph-to-active-implementation", id: "TASK-0003", status: "todo" },
    ],
    events: [{ kind: "route-selected", count: 10 }],
    finalFiles: {
      // Corpus docs keep their initial statuses — never the authority.
      "docs/tasks/0002-task.md": { frontmatter: { status: "in-progress" } },
      "docs/tasks/0003-task.md": { frontmatter: { status: "todo" } },
    },
    run: {
      tasks: {
        "TASK-0002": { status: "done" },
        "TASK-0003": { status: "done" },
      },
    },
  },
};
