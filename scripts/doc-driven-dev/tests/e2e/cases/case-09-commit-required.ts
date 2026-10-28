import type { E2ECase } from "../harness/case_types";

/**
 * e2e-09 — `commit-required` yield on the commitGate edge, then a real commit
 * lets the resumed run complete it without re-dispatching any effect.
 *
 * Leg 1 enters at `task-graph` with two runnable tasks:
 * `tasks-runnable` selects `task-graph-to-implementation` (destination
 * `implementation`: commitGate, delegate implementation-flow, no audits).
 * `commit-waived` is absent, so the runner captures a git baseline before
 * dispatch. The scripted delegate completes and its `mutate` writes the
 * honest work product — TASK-0001 → `done` plus the implementation record —
 * and `commitEvidence` is deliberately NOT set, so applyEvidence records the
 * checkpoint receipt but never commits. `after.dirty` then has new porcelain
 * entries outside the baseline → the commit gate fails → `commit-required`
 * yield with `pending.commitBaseline` + `evidenceRecorded: true` retained in
 * the handoff.
 *
 * TASK-0002 stays `todo` — deliberately: a resumed leg re-SELECTS the pending
 * edge from a fresh projection, and `task-graph-to-implementation` only
 * matches while some task is runnable (if leg 1 had closed every task, the
 * re-route would find `no-matching-edge` — verified live). The pending match
 * is on edgeId+current only, so the smaller runnable set is fine.
 *
 * Leg 2's `mutateBefore: [{commit:true}]` is the missing caller-side commit.
 * The resume re-routes `task-graph-to-implementation`, matches the pending
 * edge, and re-validates it live: the stored delegate outcome is still
 * reusable (its evidence/proof fingerprints match post-commit content) and
 * the persisted checkpoint receipt still resolves → `authority-required`
 * does not fire. No effect is re-dispatched (delegate already complete, zero
 * required audits) and the evidence phase is skipped — asserted edge-scoped
 * as zero `effect-dispatched` events on the resumed edge. `after.dirty` is
 * now `[]` ⊆ baseline → the gate passes for real → the edge completes.
 *
 * The honest consequence then plays out: at `implementation`, the gate sees
 * TASK-0002 still `todo` → `implementation-not-pass` → `implementation-retry`
 * (the graph's own repair edge — same commitGate destination) → its delegate
 * completes TASK-0002's slice and `commitEvidence` commits it → the gate
 * passes → `implementation-to-followup-triage` → … → `terminal`.
 *
 * Leg-1/case `signals` carry the three gate signals up front (same rationale
 * as e2e-01): leg 2's resumed handoff inherits them.
 */
export const case09: E2ECase = {
  id: "e2e-09",
  description: "commit-required on commitGate edge → mutateBefore commit → resume reuses pending → terminal",
  current: "task-graph",
  fixture: { taskStatuses: ["todo", "todo"] },
  focus: ["PLAN-0001"],
  signals: ["implementation-verified", "followup-terminal", "exit-audit-pass"],
  script: {
    "task-graph-to-implementation": {
      delegate: "completed",
      mutate: [
        { set: { path: "docs/tasks/0001-task.md", frontmatter: { status: "done" } } },
        { append: { path: "docs/impl/ir/0001-task.md", body: "\nTASK-0001 implemented and verified.\n" } },
      ],
      // commitEvidence intentionally absent: the dirty work product is what
      // trips the gate on leg 1.
    },
    // The remaining task slice, completed by the graph's own repair edge once
    // the implementation gate reports tasks-incomplete on leg 2.
    "implementation-retry": {
      delegate: "completed",
      mutate: [{ set: { path: "docs/tasks/0002-task.md", frontmatter: { status: "done" } } }],
      commitEvidence: true,
    },
    "implementation-to-followup-triage": { audits: { task: "completed", "impl-record": "completed" } },
    "followup-triage-terminal": { audits: { all: "completed" }, delegate: "completed" },
    "exit-audit-to-complete": {},
  },
  steps: [
    {
      // Leg 1: delegate + evidence done, commit gate fails → commit-required.
      expect: {
        yield: "commit-required",
        edgeSequence: ["task-graph-to-implementation"],
        completedEdges: [],
        events: [
          { kind: "effect-dispatched", edgeId: "task-graph-to-implementation", stage: "delegate", count: 1 },
          { kind: "effect-dispatched", edgeId: "task-graph-to-implementation", stage: "audit", count: 0 },
          { kind: "route-selected", count: 1 },
        ],
      },
    },
    {
      // The commit the gate was waiting for — applied between runs.
      mutateBefore: [{ commit: true }],
      expect: {
        yield: "terminal",
        edgeSequence: [
          "task-graph-to-implementation", "implementation-retry",
          "implementation-to-followup-triage", "followup-triage-terminal",
          "exit-audit-to-complete", null,
        ],
        events: [
          // The resumed edge is re-routed exactly once…
          { kind: "route-selected", edgeId: "task-graph-to-implementation", count: 1 },
          // …and NO effect is re-dispatched on it — the pending delegate
          // outcome and the recorded evidence are reused, not re-run.
          { kind: "effect-dispatched", edgeId: "task-graph-to-implementation", count: 0 },
          { kind: "route-selected", count: 6 },
        ],
      },
    },
  ],
  expect: {
    yield: "terminal",
    edgeSequence: [
      "task-graph-to-implementation", "implementation-retry",
      "implementation-to-followup-triage", "followup-triage-terminal",
      "exit-audit-to-complete", null,
    ],
    completedEdges: [
      "task-graph-to-implementation", "implementation-retry",
      "implementation-to-followup-triage", "followup-triage-terminal",
      "exit-audit-to-complete",
    ],
    events: [
      { kind: "route-selected", count: 7 }, // 1 (leg 1) + 5 edges + 1 terminal (leg 2)
      { kind: "run-yield", count: 2 },
    ],
    finalFiles: {
      "docs/tasks/0001-task.md": { frontmatter: { status: "done" } },
      "docs/tasks/0002-task.md": { frontmatter: { status: "done" } },
    },
  },
};
