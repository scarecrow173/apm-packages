import type { E2ECase } from "../harness/case_types";

/**
 * e2e-08 — implementation loopback on `constraint-gap`, then a resumed run
 * with the repair signal cleared walks the gate path to terminal.
 *
 * Leg 1 enters at `implementation` with `constraint-gap` set. Two corrections
 * to the brief's literal fixture, both forced by real graph semantics:
 *
 *  1. `signals` also carries `implementation-verified` and the fixture's task
 *     is `done`: the implementation gate must PASS or `implementation-retry`
 *     (priority 10, `implementation-not-pass`) outranks
 *     `implementation-constraint-to-design` (priority 40) and the loop never
 *     forms. With the gate passing, constraint-gap selects the design repair
 *     edge — verified live.
 *  2. No `maxHops` cap: the brief's `maxHops:4` would yield budget-exhausted
 *     on the same 5th route, but it also persists `maxHops:4, hops:4` into
 *     the handoff — a resumed leg 2 would then yield budget-exhausted on its
 *     FIRST route before doing any work, making the specified resume
 *     unreachable. Instead the run relies on the other budget guard: the
 *     fifth route re-selects `implementation-constraint-to-design` with a
 *     byte-identical route fingerprint (docs restored to the same state),
 *     which the runner also maps to `budget-exhausted` — deterministic
 *     infinite repair, bounded by route repetition, with `hops:4` of the
 *     topology budget still available for leg 2.
 *
 * The loop traverses `implementation-constraint-to-design` →
 * `design-to-planning` → `planning-to-task-graph` →
 * `task-graph-to-implementation`. `build_task_graph`'s scripted mutate reopens
 * TASK-0001 (`todo`) — the honest post-repair state that makes
 * `tasks-runnable` true so the fourth edge reaches `implementation`
 * (with all tasks `done` that edge cannot match — verified live:
 * no-matching-edge). `implementation-flow` then marks it `done` again so the
 * next implementation projection still passes the gate. `commit-waived`
 * (declared runtime signal) skips the commit baseline inside the loop;
 * `commitEvidence` still commits the mutated docs so the completed commitGate
 * edge satisfies the universal commit-gate invariant via a real post-baseline
 * commit.
 *
 * Leg 2 resumes by handoff (`signals` is a leg-scoped override that beats the
 * handoff): constraint-gap cleared, followup-terminal + exit-audit-pass
 * supplied → `implementation-to-followup-triage` → `followup-triage-terminal`
 * → `exit-audit-to-complete` → `terminal`. The budget handoff threads through:
 * leg 2 starts at hops 4 of 10.
 */
export const case08: E2ECase = {
  id: "e2e-08",
  description: "constraint-gap repair loop → route-fingerprint budget-exhausted → resume → terminal",
  current: "implementation",
  fixture: { taskStatuses: ["done"] },
  focus: ["PLAN-0001"],
  signals: ["implementation-verified", "constraint-gap", "commit-waived"],
  script: {
    "implementation-constraint-to-design": { audits: { design: "completed" }, delegate: "completed" },
    "design-to-planning": { audits: { design: "completed" }, delegate: "completed" },
    "planning-to-task-graph": {
      audits: { plan: "completed", task: "completed", "test-spec": "completed" },
      delegate: "completed",
      // The constraint repair reopens the task for re-implementation: the
      // next task-graph projection sees it runnable → task-graph-to-implementation.
      mutate: [{ set: { path: "docs/tasks/0001-task.md", frontmatter: { status: "todo" } } }],
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
      // Leg 1: one full repair traversal (4 completed hops); the 5th route
      // re-selects the same edge byte-identically → budget-exhausted.
      expect: {
        yield: "budget-exhausted",
        edgeSequence: [
          "implementation-constraint-to-design", "design-to-planning",
          "planning-to-task-graph", "task-graph-to-implementation",
          "implementation-constraint-to-design",
        ],
        completedEdges: [
          "implementation-constraint-to-design", "design-to-planning",
          "planning-to-task-graph", "task-graph-to-implementation",
        ],
      },
    },
    {
      // Leg 2: resumed handoff (current/hops/maxHops thread through); the
      // repair signal is cleared and the gate signals are supplied instead.
      options: { signals: ["implementation-verified", "followup-terminal", "exit-audit-pass"] },
      expect: {
        yield: "terminal",
        edgeSequence: [
          "implementation-to-followup-triage", "followup-triage-terminal",
          "exit-audit-to-complete", null,
        ],
      },
    },
  ],
  expect: {
    yield: "terminal",
    edgeSequence: [
      "implementation-to-followup-triage", "followup-triage-terminal",
      "exit-audit-to-complete", null,
    ],
    completedEdges: [
      "implementation-constraint-to-design", "design-to-planning",
      "planning-to-task-graph", "task-graph-to-implementation",
      "implementation-to-followup-triage", "followup-triage-terminal",
      "exit-audit-to-complete",
    ],
    events: [
      { kind: "route-selected", count: 9 }, // 5 (leg 1) + 4 (leg 2)
      { kind: "run-yield", count: 2 },
    ],
    finalFiles: { "docs/tasks/0001-task.md": { frontmatter: { status: "done" } } },
  },
};
