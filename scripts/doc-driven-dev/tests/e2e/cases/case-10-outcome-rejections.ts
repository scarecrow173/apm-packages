import type { E2ECase } from "../harness/case_types";
import type { CaseExpect } from "../harness/case_validator";
import type { EdgeScript } from "../harness/scripted_dispatcher";

/**
 * e2e-10 — outcome contract rejections, three siblings. Each scripts one
 * malformed `EffectOutcome` on `briefing`'s `spec` audit — dispatched by
 * `probe-to-briefing` (destination `briefing`: audits [adr, spec] in sorted
 * order + delegate briefing-flow):
 *
 *  10a `{malformed:"missing-proof"}` — completed outcome with `proof:{}`:
 *     assertEffectOutcome requires exactly one of canonicalEvidence or
 *     providerIdempotency.
 *  10b `{malformed:"stale-fingerprint"}` — evidence fingerprint zeroed:
 *     `canonicalEvidenceMatches` fails against live content.
 *  10c `{malformed:"scope-mismatch"}` — `authoritativeInputs: []`: violates
 *     the non-empty canonical-reference contract.
 *
 * In every sibling the dispatch DOES happen — `effect-dispatched` for `spec`
 * is emitted — then `assertEffectOutcome` throws `OutcomeRejection`, the
 * runner maps the rejection to `authority-required` (a rejected outcome is a
 * contract failure, never a crash), and NO `effect-outcome` is appended for
 * the rejected effect. The earlier `adr` audit completed normally, so its
 * outcome event exists — the tallies pin dispatch≠outcome asymmetry, and the
 * delegate is never reached.
 */
const script = (
  malformed: "missing-proof" | "stale-fingerprint" | "scope-mismatch",
): Record<string, EdgeScript> => ({
  "probe-to-briefing": {
    audits: { adr: "completed" as const, spec: { malformed } },
  },
});

const expectContract: CaseExpect = {
  yield: "authority-required",
  edgeSequence: ["probe-to-briefing"],
  completedEdges: [],
  events: [
    // adr + spec audits both dispatched…
    { kind: "effect-dispatched", edgeId: "probe-to-briefing", stage: "audit", count: 2 },
    // …but only adr produced an outcome — spec's was rejected before append.
    { kind: "effect-outcome", edgeId: "probe-to-briefing", stage: "audit", count: 1 },
    { kind: "effect-dispatched", stage: "delegate", count: 0 },
    { kind: "route-selected", count: 1 },
    { kind: "run-yield", count: 1 },
  ],
};



export const case10a: E2ECase = {
  id: "e2e-10a",
  description: "missing proof on spec audit outcome → authority-required",
  fixture: { taskStatuses: ["todo"] },
  focus: ["PLAN-0001"],
  script: script("missing-proof"),
  expect: expectContract,
};

export const case10b: E2ECase = {
  id: "e2e-10b",
  description: "stale evidence fingerprint on spec audit outcome → authority-required",
  fixture: { taskStatuses: ["todo"] },
  focus: ["PLAN-0001"],
  script: script("stale-fingerprint"),
  expect: expectContract,
};

export const case10c: E2ECase = {
  id: "e2e-10c",
  description: "scope-mismatched authoritativeInputs on spec audit outcome → authority-required",
  fixture: { taskStatuses: ["todo"] },
  focus: ["PLAN-0001"],
  script: script("scope-mismatch"),
  expect: expectContract,
};
