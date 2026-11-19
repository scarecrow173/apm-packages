import type { E2ECase } from "../harness/case_types";
import type { CaseExpect } from "../harness/case_validator";
import type { EdgeScript } from "../harness/scripted_dispatcher";

/**
 * e2e-23 — provider idempotency + Effect Receipt reuse on resume; delegate
 * contract rejections (mandatory scenario 7 — the audit-side scope/proof
 * rejections are already pinned by e2e-10).
 *
 * 23a — the scripted `design` audit returns a provider proof
 * (`{kind:"provider", provider:"e2e-ci", idempotencyKey:"…"}`) instead of a
 * durable-document proof: the recorded Effect Receipt carries the
 * idempotency key the provider itself dedupes on. Leg 1's delegate yields
 * `approval-required`; leg 2's resume re-validates the parked audit — its
 * receipt exists AND `receipt.idempotencyKey` equals the proof's key
 * (`isReusableCompletedOutcome`) — so zero audit dispatches re-fire on the
 * resumed edge while the delegate re-dispatches once. `receiptsContain`
 * re-reads the receipt from the Execution Store, not from trace events.
 *
 * 23b/23c — delegate-stage outcome contract rejections: the dispatched
 * delegate returns a malformed completed outcome (empty `proof` / empty
 * `inputs`), `assertEffectOutcome` throws `OutcomeRejection`, the runner
 * maps it to `authority-required`, and no `effect-outcome` is appended for
 * the rejected delegate. Same dispatch≠outcome asymmetry as e2e-10, but on
 * the delegate stage — the audit completed normally first, so its outcome
 * event exists.
 */
export const case23a: E2ECase = {
  id: "e2e-23a",
  description: "provider-proof audit → approval-required → resume reuses the receipt (idempotency key) → terminal",
  current: "design",
  fixture: { taskStatuses: ["todo"] },
  focus: ["DESIGN-0001"],
  signals: ["knowledge-consolidated", "exit-audit-pass"],
  script: {
    "design-to-planning": {
      audits: { design: "completed" },
      delegate: [{ yield: "approval-required" }, "completed"],
      // The provider-scoped proof: the receipt's idempotency key is the
      // dedupe handle the resume path verifies.
      proof: { kind: "provider", provider: "e2e-ci", idempotencyKey: "e2e-23a-plan-approval" },
    },
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
      // The approval the yield was waiting for.
      mutateBefore: [{ approve: {} }],
      expect: {
        yield: "terminal",
        edgeSequence: [
          "design-to-planning", "planning-to-task-graph", "task-graph-to-implementation",
          "implementation-to-verification", "verification-to-knowledge-consolidation",
          "knowledge-consolidation-to-exit-audit", "exit-audit-to-complete", null,
        ],
        events: [
          // The parked audit's receipt carried the idempotency key — reused,
          // not re-dispatched…
          { kind: "effect-dispatched", edgeId: "design-to-planning", stage: "audit", count: 0 },
          // …while the incomplete delegate is re-dispatched exactly once.
          { kind: "effect-dispatched", edgeId: "design-to-planning", stage: "delegate", count: 1 },
        ],
      },
    },
  ],
  expect: {
    yield: "terminal",
    completedEdges: [
      "design-to-planning", "planning-to-task-graph", "task-graph-to-implementation",
      "implementation-to-verification", "verification-to-knowledge-consolidation",
      "knowledge-consolidation-to-exit-audit", "exit-audit-to-complete",
    ],
    receiptsContain: [
      // Re-read from the Execution Store — the audit's receipt carries the
      // provider idempotency key the resume's reuse check verified.
      { edgeId: "design-to-planning", stage: "audit", idempotencyKey: "e2e-23a-plan-approval" },
    ],
    run: {
      planApproved: true,
      tasks: { "TASK-0001": { status: "done" } },
    },
  },
};

const rejectedDelegate = (
  malformed: "missing-proof" | "scope-mismatch",
): Record<string, EdgeScript> => ({
  "design-to-planning": {
    audits: { design: "completed" },
    delegate: { malformed },
  },
});

const rejectedDelegateExpect: CaseExpect = {
  yield: "authority-required",
  edgeSequence: ["design-to-planning"],
  completedEdges: [],
  events: [
    // The audit dispatched and completed normally…
    { kind: "effect-dispatched", edgeId: "design-to-planning", stage: "audit", count: 1 },
    { kind: "effect-outcome", edgeId: "design-to-planning", stage: "audit", outcome: "completed", count: 1 },
    // …the delegate WAS dispatched…
    { kind: "effect-dispatched", edgeId: "design-to-planning", stage: "delegate", count: 1 },
    // …but its malformed outcome was rejected before append.
    { kind: "effect-outcome", edgeId: "design-to-planning", stage: "delegate", count: 0 },
    { kind: "route-selected", count: 1 },
    { kind: "run-yield", count: 1 },
  ],
};

export const case23b: E2ECase = {
  id: "e2e-23b",
  description: "delegate returns missing proof → OutcomeRejection → authority-required",
  current: "design",
  fixture: { taskStatuses: ["todo"] },
  focus: ["DESIGN-0001"],
  script: rejectedDelegate("missing-proof"),
  expect: rejectedDelegateExpect,
};

export const case23c: E2ECase = {
  id: "e2e-23c",
  description: "delegate returns scope-mismatched inputs → OutcomeRejection → authority-required",
  current: "design",
  fixture: { taskStatuses: ["todo"] },
  focus: ["DESIGN-0001"],
  script: rejectedDelegate("scope-mismatch"),
  expect: rejectedDelegateExpect,
};
