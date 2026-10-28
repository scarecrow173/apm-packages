import type { CallerEffect } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/caller_runner";
import type { DelegateMode, PolicyFacts } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/delegate_policy";
import type { GraphRoute } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/graph_router";
import type { E2ECase } from "../harness/case_types";
import { case01 } from "./case-01-happy-path";

/**
 * e2e-13 — delegate execution-mode policy through the real caller, three
 * siblings. The policy is trace-attribution only: it rewrites the
 * `executionMode` field of `effect-dispatched` and records the decision's
 * reason tokens as `modeReason`. Dispatch, outcome validation, and the
 * commit/evidence gates are untouched — proven by 13a/13c.
 *
 * Dispatch totals on the happy path (per-edge audits + delegate):
 *   probe-to-briefing          2 audits [adr, spec] + briefing-flow       = 3
 *   briefing-to-design         1 audit  [design]     + design-doc         = 2
 *   design-to-planning         1 audit  [design]     + planning-flow      = 2
 *   planning-to-task-graph     3 audits [plan,task,test-spec] + build_task_graph = 4
 *   task-graph-to-implementation                       implementation-flow = 1
 *   implementation-to-followup-triage 2 audits [task, impl-record]         = 2
 *   followup-triage-terminal   1 audit  [all]        + doc-status         = 2
 *   exit-audit-to-complete     (terminal — evidence only)                  = 0
 *                                                                     = 16
 *
 * Host capabilities are declared maximal (all three modes) so the selected
 * mode is the policy's own choice — no `host-unsupported` fallback noise.
 */
const ALL_MODES: ReadonlySet<DelegateMode> = new Set<DelegateMode>([
  "same-context",
  "subagent-as-tool",
  "isolated-subagent",
]);

const HAPPY_EDGES = [
  "probe-to-briefing", "briefing-to-design", "design-to-planning",
  "planning-to-task-graph", "task-graph-to-implementation", "implementation-to-followup-triage",
  "followup-triage-terminal", "exit-audit-to-complete",
];
const GATE_SIGNALS = ["implementation-verified", "followup-terminal", "exit-audit-pass"];
const DISPATCH_TOTAL = 16;

/**
 * PolicyFacts for one dispatch: effect identity from the runner's dispatch,
 * fact row from `overrides`. Defaults are the all-inert row (independent
 * scope false, no shared judgment, low context cost, no parallelism) which
 * selects same-context/"default" — the honest "nothing justifies delegation"
 * row for effects the case doesn't call out.
 */
const facts = (effect: CallerEffect, overrides: Partial<PolicyFacts> = {}): PolicyFacts => ({
  effectId: effect.id,
  stage: effect.kind,
  independentScope: false,
  sharedJudgment: false,
  contextCost: "low",
  parallelCandidate: false,
  hostCapabilities: ALL_MODES,
  ...overrides,
});

/**
 * e2e-13a `same-context-preserved`: NO policy — identical happy path to
 * e2e-01. Every `effect-dispatched` carries `executionMode:"tool"` (the
 * declared scripted-adapter mode) and NO `modeReason` key. The modeReason
 * absence is structural: `dispatchEffect` only writes it inside the
 * `decision` branch, which requires `options.policy` — so "16/16 tool, 0
 * anything else" transitively pins zero modeReason emissions. Proves the
 * additive trace schema doesn't perturb existing runs.
 */
export const case13a: E2ECase = {
  id: "e2e-13a",
  description: "no policy: declared mode \"tool\" unchanged, no modeReason",
  fixture: { taskStatuses: ["todo"] },
  focus: ["PLAN-0001"],
  signals: GATE_SIGNALS,
  script: case01.script,
  expect: {
    yield: "terminal",
    edgeSequence: [...HAPPY_EDGES, null],
    completedEdges: HAPPY_EDGES,
    events: [
      { kind: "effect-dispatched", count: DISPATCH_TOTAL },
      { kind: "effect-dispatched", executionMode: "tool", count: DISPATCH_TOTAL },
      { kind: "effect-dispatched", executionMode: "same-context", count: 0 },
      { kind: "effect-dispatched", executionMode: "subagent", count: 0 },
      { kind: "effect-dispatched", executionMode: "unknown", count: 0 },
    ],
    finalFiles: { "docs/tasks/0001-task.md": { frontmatter: { status: "done" } } },
  },
};

/**
 * e2e-13b `policy-selected-modes`: the case declares a policy — the
 * `briefing-flow` delegate on probe-to-briefing gets `sharedJudgment:true`
 * (→ same-context, reason `shared-judgment`); `build_task_graph` on
 * planning-to-task-graph gets the inert row (`independentScope:false`,
 * `contextCost:"low"` → same-context, reason `default`); every other effect
 * gets the same inert row → all 16 dispatches are `same-context` and the
 * declared "tool" mode is fully overridden. The run still reaches terminal —
 * the policy never changes what executes.
 */
const policySharedJudgment = (_route: GraphRoute, effect: CallerEffect): PolicyFacts => (
  facts(effect, {
    sharedJudgment: effect.kind === "delegate" && effect.id === "briefing-flow",
  })
);

export const case13b: E2ECase = {
  id: "e2e-13b",
  description: "declared policy: briefing-flow sharedJudgment → same-context + modeReason, runs to terminal",
  fixture: { taskStatuses: ["todo"] },
  focus: ["PLAN-0001"],
  signals: GATE_SIGNALS,
  script: case01.script,
  policy: policySharedJudgment,
  expect: {
    yield: "terminal",
    edgeSequence: [...HAPPY_EDGES, null],
    completedEdges: HAPPY_EDGES,
    events: [
      { kind: "effect-dispatched", count: DISPATCH_TOTAL },
      { kind: "effect-dispatched", executionMode: "same-context", count: DISPATCH_TOTAL },
      { kind: "effect-dispatched", executionMode: "tool", count: 0 },
      // The one dispatch the brief names: briefing-flow via sharedJudgment.
      { kind: "effect-dispatched", edgeId: "probe-to-briefing", stage: "delegate", executionMode: "same-context", modeReason: "shared-judgment", count: 1 },
      // build_task_graph via the inert row → same-context on the "default" rule.
      { kind: "effect-dispatched", edgeId: "planning-to-task-graph", stage: "delegate", executionMode: "same-context", modeReason: "default", count: 1 },
    ],
    finalFiles: { "docs/tasks/0001-task.md": { frontmatter: { status: "done" } } },
  },
};

/**
 * e2e-13c `mode-independent-rejection`: the policy selects
 * `isolated-subagent` for the `spec` audit on probe-to-briefing
 * (independentScope && parallelCandidate → isolated-subagent → trace mode
 * "subagent", reasons "independent-scope;parallel-candidate"); `adr` stays
 * inert → same-context. The scripted dispatcher returns e2e-10's
 * `scope-mismatch` malformed outcome for spec → the SAME
 * `authority-required` yield as e2e-10c: dispatch event emitted (with the
 * subagent mode + reason), assertEffectOutcome throws before any
 * effect-outcome append, delegate never reached. Safety conditions are
 * mode-independent.
 */
const policyIsolatedSpec = (route: GraphRoute, effect: CallerEffect): PolicyFacts => (
  facts(effect, {
    independentScope: route.edgeId === "probe-to-briefing" && effect.kind === "audit" && effect.id === "spec",
    parallelCandidate: route.edgeId === "probe-to-briefing" && effect.kind === "audit" && effect.id === "spec",
  })
);

export const case13c: E2ECase = {
  id: "e2e-13c",
  description: "isolated-subagent policy on spec audit: malformed outcome → identical authority-required",
  fixture: { taskStatuses: ["todo"] },
  focus: ["PLAN-0001"],
  script: {
    "probe-to-briefing": {
      audits: { adr: "completed", spec: { malformed: "scope-mismatch" } },
    },
  },
  policy: policyIsolatedSpec,
  expect: {
    yield: "authority-required",
    edgeSequence: ["probe-to-briefing"],
    completedEdges: [],
    events: [
      // adr + spec both dispatched…
      { kind: "effect-dispatched", edgeId: "probe-to-briefing", stage: "audit", count: 2 },
      // …spec as subagent (policy-selected, recorded BEFORE validation)…
      { kind: "effect-dispatched", edgeId: "probe-to-briefing", stage: "audit", executionMode: "subagent", modeReason: "independent-scope", count: 1 },
      // …adr in same context…
      { kind: "effect-dispatched", edgeId: "probe-to-briefing", stage: "audit", executionMode: "same-context", count: 1 },
      // …but only adr produced an outcome — spec's was rejected before append.
      { kind: "effect-outcome", edgeId: "probe-to-briefing", stage: "audit", count: 1 },
      { kind: "effect-dispatched", stage: "delegate", count: 0 },
      { kind: "route-selected", count: 1 },
      { kind: "run-yield", count: 1 },
    ],
  },
};
