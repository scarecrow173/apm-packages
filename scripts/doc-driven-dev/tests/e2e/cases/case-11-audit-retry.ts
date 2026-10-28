import type { E2ECase } from "../harness/case_types";

/**
 * e2e-11 — an audit `retry` leaves the checkpoint incomplete, then the
 * re-projection safely re-dispatches the same audit and completes the edge in
 * ONE run.
 *
 * `design-to-planning`'s `design` audit is scripted `["retry","completed"]`
 * (queue form — consumed per dispatch). The first dispatch returns `retry`:
 * the outcome is accepted and persisted, but no audit is marked complete and
 * no evidence is recorded — the runner saves the pending edge and
 * re-projects instead of checkpointing. The second route-selected for the
 * same edge matches the pending state, skips nothing (a `retry` outcome is
 * not a completed audit), and dispatches `design` again → `completed` →
 * delegate → evidence → checkpoint → `single-step` yield.
 *
 * Assertions: exactly 2 `effect-dispatched` + 2 `effect-outcome` events for
 * the audit (the scripted queue pins the order retry→completed — the DSL
 * tallies event kinds, not outcome payloads), the edge appears in
 * `completedEdges`, and the run-yield's own `completedEdges` + the universal
 * checkpointEvidence invariant prove the receipt was recorded exactly once
 * (the evidence phase runs once per edge completion — the retry pass never
 * reached it).
 */
export const case11: E2ECase = {
  id: "e2e-11",
  description: "design audit retry → re-projection → completed → edge completes in one run",
  current: "design",
  mode: "single-step",
  fixture: { taskStatuses: ["todo"] },
  focus: ["PLAN-0001"],
  script: {
    "design-to-planning": {
      audits: { design: ["retry", "completed"] },
      delegate: "completed",
    },
  },
  expect: {
    yield: "single-step-complete",
    // Same edge selected twice: the retry pass, then the completing pass.
    edgeSequence: ["design-to-planning", "design-to-planning"],
    completedEdges: ["design-to-planning"],
    events: [
      { kind: "effect-dispatched", edgeId: "design-to-planning", stage: "audit", count: 2 },
      { kind: "effect-outcome", edgeId: "design-to-planning", stage: "audit", count: 2 },
      { kind: "effect-dispatched", edgeId: "design-to-planning", stage: "delegate", count: 1 },
      { kind: "route-selected", count: 2 },
      { kind: "run-yield", count: 1 },
    ],
  },
};
