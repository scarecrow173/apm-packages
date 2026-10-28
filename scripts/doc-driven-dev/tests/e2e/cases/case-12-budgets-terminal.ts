import type { E2ECase } from "../harness/case_types";

/**
 * e2e-12 — hop budgets + terminal idempotency, three siblings.
 *
 * 12a pins the explicit `maxHops` contract: the budget check runs after route
 * selection but before dispatch, so a fourth route IS selected (and traced)
 * and exactly 3 edges complete before `budget-exhausted`.
 *
 * 12b pins the bounded-retry contract: the scripted delegate returns `retry`
 * forever. A `retry` outcome never completes an edge, so it never enters
 * `seenRouteFingerprints` — what stops the loop is the `repeatedRetry` guard:
 * a byte-identical retry outcome on the same pending edge can never progress
 * (caller_runner.ts:683-691). Second identical retry → `budget-exhausted`.
 * Deviation note: the brief calls this "route-fingerprint repetition"; the
 * actual guard is repeatedRetry (fingerprints only record COMPLETED routes).
 * Either way the observable contract is identical: deterministic infinite
 * retry ⇒ `budget-exhausted`. The completed `design` audit is reused across
 * the re-route, so the audit dispatches exactly once while the delegate
 * dispatches twice.
 *
 * 12c pins terminal idempotency: `current:"complete"` routes to the terminal
 * status before any hop accounting — `run-yield.reason === "terminal"` with
 * `hops:0`, exactly one `route-selected` (edgeId null), zero dispatches.
 * (The expect DSL asserts the observable equivalents: one null-edgeId
 * route-selected, zero completed edges, zero dispatches.)
 */
export const case12a: E2ECase = {
  id: "e2e-12a",
  description: "maxHops 3 → budget-exhausted after exactly 3 completed edges",
  fixture: { taskStatuses: ["todo"] },
  focus: ["PLAN-0001"],
  maxHops: 3,
  script: {
    "probe-to-briefing": { audits: { spec: "completed", adr: "completed" }, delegate: "completed" },
    "briefing-to-design": { audits: { design: "completed" }, delegate: "completed" },
    "design-to-planning": { audits: { design: "completed" }, delegate: "completed" },
    "planning-to-task-graph": {
      audits: { plan: "completed", task: "completed", "test-spec": "completed" },
      delegate: "completed",
    },
  },
  expect: {
    yield: "budget-exhausted",
    // The 4th route is selected and traced; the budget check fires before
    // its dispatch, so it does not complete.
    edgeSequence: [
      "probe-to-briefing", "briefing-to-design", "design-to-planning", "planning-to-task-graph",
    ],
    completedEdges: ["probe-to-briefing", "briefing-to-design", "design-to-planning"],
    events: [
      { kind: "route-selected", count: 4 },
      { kind: "run-yield", count: 1 },
    ],
  },
};

export const case12b: E2ECase = {
  id: "e2e-12b",
  description: "identical delegate retry outcomes → repeatedRetry guard → budget-exhausted",
  current: "briefing",
  fixture: { taskStatuses: ["todo"] },
  focus: ["PLAN-0001"],
  script: {
    "briefing-to-design": {
      audits: { design: "completed" },
      delegate: "retry", // scalar form retries on every dispatch
    },
  },
  expect: {
    yield: "budget-exhausted",
    edgeSequence: ["briefing-to-design", "briefing-to-design"],
    completedEdges: [],
    events: [
      // The completed audit is reused on the re-route — one dispatch…
      { kind: "effect-dispatched", edgeId: "briefing-to-design", stage: "audit", count: 1 },
      { kind: "effect-outcome", edgeId: "briefing-to-design", stage: "audit", count: 1 },
      // …while the delegate is dispatched twice and returns two (identical)
      // retry outcomes before the guard yields.
      { kind: "effect-dispatched", edgeId: "briefing-to-design", stage: "delegate", count: 2 },
      { kind: "effect-outcome", edgeId: "briefing-to-design", stage: "delegate", count: 2 },
      { kind: "route-selected", count: 2 },
      { kind: "run-yield", count: 1 },
    ],
  },
};

export const case12c: E2ECase = {
  id: "e2e-12c",
  description: "terminal node → immediate terminal yield, zero hops, one route-selected",
  current: "complete",
  expect: {
    yield: "terminal",
    edgeSequence: [null],
    completedEdges: [],
    events: [
      { kind: "route-selected", count: 1 },
      { kind: "effect-dispatched", count: 0 },
      { kind: "run-yield", count: 1 },
    ],
  },
};
