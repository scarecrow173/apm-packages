import type {
  GraphDefinition,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";
import type {
  GraphState,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_state";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  evaluateRouteDecision,
  explainRoute,
} = require("../src/skills/doc-driven-dev-graph/scripts/lib/graph_router.ts");

function stateWith(input: Partial<Pick<GraphState, "gates" | "signals" | "blockers" | "hardBlockers" | "taskGraph">> = {}): GraphState {
  return {
    schemaVersion: 2,
    graphId: "arbitrary-graph",
    cwd: process.cwd(),
    taskDir: "docs/tasks",
    focus: [],
    artifactGraph: { nodes: [], edges: [], issues: [] },
    gates: {},
    signals: [],
    blockers: [],
    hardBlockers: [],
    taskGraph: null,
    ...input,
  };
}

function definitionWith(input: Partial<GraphDefinition> = {}): GraphDefinition {
  return {
    schemaVersion: 2,
    id: "arbitrary-graph",
    entry: "alpha",
    conditions: {
      first: { kind: "signal", signal: "first" },
      second: { kind: "signal", signal: "second" },
      third: { kind: "signal", signal: "third" },
    },
    nodes: {
      alpha: { kind: "action" },
      repair: { kind: "delegate", delegate: "repair-handler", audits: ["spec"] },
      finished: { kind: "terminal" },
    },
    edges: [
      { id: "alpha-to-repair", from: "alpha", to: "repair", when: "first", priority: 10 },
      { id: "alpha-to-finished", from: "alpha", to: "finished", when: "second", priority: 20 },
      { id: "alpha-to-fallback", from: "alpha", to: "finished", when: "third", priority: 30 },
    ],
    ...input,
  };
}

test("explains normal edge ordering, condition kinds, and the selected destination", () => {
  const decision = evaluateRouteDecision({
    current: "alpha",
    definition: definitionWith(),
    state: stateWith({ signals: ["second"] }),
  });

  assert.deepEqual(decision.explanation.evaluatedEdges, [
    {
      edgeId: "alpha-to-repair",
      priority: 10,
      condition: "first",
      conditionKind: "signal",
      matched: false,
      evaluationPhase: "normal",
    },
    {
      edgeId: "alpha-to-finished",
      priority: 20,
      condition: "second",
      conditionKind: "signal",
      matched: true,
      evaluationPhase: "normal",
    },
  ]);
  assert.equal(decision.explanation.selectedEdgeId, "alpha-to-finished");
  assert.deepEqual(decision.explanation.selectedDestinationAudits, []);
  assert.deepEqual(decision.explanation.blockedReasons, []);
  assert.deepEqual(explainRoute({
    current: "alpha",
    definition: definitionWith(),
    state: stateWith({ signals: ["second"] }),
  }), decision.explanation);
});

test("explains gate repair candidates in priority order before selecting the matching edge", () => {
  const definition: GraphDefinition = {
    schemaVersion: 2,
    id: "arbitrary-graph",
    entry: "followup-triage",
    conditions: {
      "bootstrap-not-pass": { kind: "gate", gate: "bootstrap", status: "not-pass" },
      "briefing-not-pass": { kind: "gate", gate: "briefing", status: "not-pass" },
      "design-not-pass": { kind: "gate", gate: "design", status: "not-pass" },
    },
    nodes: {
      "followup-triage": { kind: "action" },
      bootstrap: { kind: "action" },
      briefing: { kind: "delegate", delegate: "briefing-flow", audits: ["adr", "spec"] },
      design: { kind: "action", audits: ["design"] },
    },
    edges: [
      { id: "followup-triage-to-bootstrap-repair", from: "followup-triage", to: "bootstrap", when: "bootstrap-not-pass", priority: 20 },
      { id: "followup-triage-to-briefing-repair", from: "followup-triage", to: "briefing", when: "briefing-not-pass", priority: 30 },
      { id: "followup-triage-to-design-repair", from: "followup-triage", to: "design", when: "design-not-pass", priority: 40 },
    ],
  };
  const state = stateWith({
    gates: {
      bootstrap: { status: "pass", reasons: [] },
      briefing: { status: "pass", reasons: [] },
      design: { status: "fail", reasons: ["design-status"] },
    },
  });
  const decision = evaluateRouteDecision({ current: "followup-triage", definition, state });

  assert.deepEqual(decision.explanation.evaluatedEdges.map((edge) => edge.edgeId), [
    "followup-triage-to-bootstrap-repair",
    "followup-triage-to-briefing-repair",
    "followup-triage-to-design-repair",
  ]);
  assert.equal(decision.explanation.selectedEdgeId, "followup-triage-to-design-repair");
  assert.deepEqual(decision.route.requiredAudits, decision.explanation.selectedDestinationAudits);
});

test("evaluates declared prerequisite repair edges before normal edges", () => {
  const definition = definitionWith({
    conditions: {
      repair: { kind: "gate", gate: "quality", status: "not-pass" },
      normal: { kind: "signal", signal: "normal" },
    },
    nodes: {
      alpha: { kind: "action", requiresGates: ["quality"] },
      repair: { kind: "delegate", delegate: "repair-handler", audits: ["spec", "adr"] },
      finished: { kind: "terminal" },
    },
    edges: [
      { id: "alpha-to-repair", from: "alpha", to: "repair", when: "repair", priority: 10 },
      { id: "alpha-to-finished", from: "alpha", to: "finished", when: "normal", priority: 20 },
    ],
  });
  const decision = evaluateRouteDecision({
    current: "alpha",
    definition,
    state: stateWith({
      signals: ["normal"],
      gates: { quality: { status: "fail", reasons: ["evidence-missing"] } },
    }),
  });

  assert.deepEqual(decision.explanation.evaluatedEdges, [{
    edgeId: "alpha-to-repair",
    priority: 10,
    condition: "repair",
    conditionKind: "gate",
    matched: true,
    evaluationPhase: "repair",
  }]);
  assert.equal(decision.explanation.selectedEdgeId, "alpha-to-repair");
  assert.deepEqual(decision.explanation.selectedDestinationAudits, ["adr", "spec"]);
  assert.deepEqual(decision.explanation.prerequisiteGates, [{
    gate: "quality",
    status: "fail",
    reasons: ["evidence-missing"],
  }]);
});

test("stops with no evaluated edges on a hard blocker", () => {
  const explanation = explainRoute({
    current: "alpha",
    definition: definitionWith(),
    state: stateWith({ hardBlockers: ["focus-invalid"] }),
  });

  assert.deepEqual(explanation.evaluatedEdges, []);
  assert.deepEqual(explanation.hardBlockers, ["focus-invalid"]);
  assert.deepEqual(explanation.blockedReasons, ["focus-invalid"]);
  assert.equal(explanation.selectedEdgeId, null);
});

test("retains terminal routing when a hard blocker is present", () => {
  const definition = definitionWith({
    entry: "finished",
    conditions: {},
    nodes: { finished: { kind: "terminal" } },
    edges: [],
  });
  const decision = evaluateRouteDecision({
    current: "finished",
    definition,
    state: stateWith({ hardBlockers: ["artifact-graph"] }),
  });

  assert.equal(decision.route.status, "terminal");
  assert.equal(decision.route.condition, "terminal");
  assert.equal(decision.route.next, "finished");
  assert.equal(decision.route.edgeId, null);
  assert.deepEqual(decision.explanation.evaluatedEdges, []);
  assert.deepEqual(decision.explanation.hardBlockers, ["artifact-graph"]);
  assert.deepEqual(decision.explanation.blockedReasons, []);
});

test("reports missing prerequisite gates and blocks when their repair edge is absent", () => {
  const definition = definitionWith({
    conditions: {
      normal: { kind: "signal", signal: "normal" },
    },
    nodes: {
      alpha: { kind: "action", requiresGates: ["quality"] },
      finished: { kind: "terminal" },
    },
    edges: [
      { id: "alpha-to-finished", from: "alpha", to: "finished", when: "normal", priority: 20 },
    ],
  });
  const decision = evaluateRouteDecision({
    current: "alpha",
    definition,
    state: stateWith({ signals: ["normal"] }),
  });

  assert.deepEqual(decision.explanation.evaluatedEdges, []);
  assert.deepEqual(decision.explanation.prerequisiteGates, [{
    gate: "quality",
    status: "missing",
    reasons: ["missing"],
  }]);
  assert.deepEqual(decision.explanation.blockedReasons, [
    "required-gate:quality",
    "required-gate:quality:missing",
  ]);
  assert.equal(decision.route.status, "blocked");
  assert.equal(decision.explanation.selectedEdgeId, null);
});
