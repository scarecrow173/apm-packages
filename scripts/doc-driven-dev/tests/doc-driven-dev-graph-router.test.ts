import type {
  GraphCondition,
  GraphDefinition,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";
import type { GraphState } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_state";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  evaluateCondition,
} = require("../src/skills/doc-driven-dev-graph/scripts/lib/graph_conditions.ts");
const {
  evaluateRouteDecision,
  routeGraph,
} = require("../src/skills/doc-driven-dev-graph/scripts/lib/graph_router.ts");

function stateWith(input: Partial<Pick<GraphState, "gates" | "signals" | "blockers" | "taskGraph">> = {}): GraphState {
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

function definitionWith(input: Partial<GraphDefinition>): GraphDefinition {
  return {
    schemaVersion: 2,
    id: "arbitrary-graph",
    entry: "alpha",
    conditions: {
      first: { kind: "signal", signal: "first" },
      second: { kind: "signal", signal: "second" },
    },
    nodes: {
      alpha: { kind: "action" },
      repair: { kind: "delegate", delegate: "repair-handler" },
      finished: { kind: "terminal" },
    },
    edges: [
      { id: "alpha-to-repair", from: "alpha", to: "repair", when: "first", priority: 10 },
      { id: "alpha-to-finished", from: "alpha", to: "finished", when: "second", priority: 20 },
    ],
    ...input,
  };
}

test("routes the first satisfied outgoing edge by ascending priority", () => {
  const definition = definitionWith({
    edges: [
      { id: "alpha-to-finished", from: "alpha", to: "finished", when: "second", priority: 20 },
      { id: "alpha-to-repair", from: "alpha", to: "repair", when: "first", priority: 10 },
    ],
  });
  const route = routeGraph({ current: "alpha", definition, state: stateWith({ signals: ["first", "second"] }) });
  assert.equal(route.edgeId, "alpha-to-repair");
  assert.equal(route.next, "repair");
  assert.equal(route.status, "edge");
  assert.equal(route.condition, "first");
  assert.equal(route.delegate, "repair-handler");
});

test("keeps routeGraph compatible with the shared decision on an edge path", () => {
  const definition = definitionWith({});
  const input = { current: "alpha", definition, state: stateWith({ signals: ["first"] }) };
  assert.deepEqual(routeGraph(input), evaluateRouteDecision(input).route);
});

test("projects destination audit requirements on a selected edge", () => {
  const definition = definitionWith({
    nodes: {
      alpha: { kind: "action" },
      repair: { kind: "delegate", delegate: "repair-handler", audits: ["spec", "adr"] },
      finished: { kind: "terminal" },
    } as GraphDefinition["nodes"],
  });
  const route = routeGraph({ current: "alpha", definition, state: stateWith({ signals: ["first"] }) });
  assert.deepEqual(route.requiredAudits, ["adr", "spec"]);
});

test("returns only one edge even when the destination has a satisfied edge", () => {
  const definition = definitionWith({
    edges: [
      { id: "alpha-to-repair", from: "alpha", to: "repair", when: "first", priority: 10 },
      { id: "repair-to-finished", from: "repair", to: "finished", when: "second", priority: 10 },
    ],
  });
  const route = routeGraph({ current: "alpha", definition, state: stateWith({ signals: ["first", "second"] }) });
  assert.equal(route.edgeId, "alpha-to-repair");
  assert.equal(route.current, "alpha");
  assert.equal(route.next, "repair");
  assert.notEqual(route.next, "finished");
  assert.equal(route.status, "edge");
});

test("returns terminal status when re-entering a terminal node", () => {
  const definition: GraphDefinition = {
    schemaVersion: 2,
    id: "arbitrary-graph",
    entry: "finished",
    conditions: {},
    nodes: { finished: { kind: "terminal", delegate: "final-handler" } },
    edges: [],
  };
  const route = routeGraph({ current: "finished", definition, state: stateWith() });
  assert.deepEqual(route, {
    schemaVersion: 2,
    graphId: "arbitrary-graph",
    current: "finished",
    next: "finished",
    edgeId: null,
    condition: "terminal",
    status: "terminal",
    delegate: "final-handler",
    requiredAudits: [],
    blockers: [],
    taskGraph: null,
  });
  assert.deepEqual(
    route,
    evaluateRouteDecision({ current: "finished", definition, state: stateWith() }).route,
  );

  const hardBlockedDefinition: GraphDefinition = {
    ...definition,
    nodes: { finished: { kind: "terminal", delegate: "final-handler", audits: ["z-audit", "a-audit"] } },
  };
  const taskGraph = {
    schemaVersion: 1 as const,
    plan: "docs/plans/example.md",
    nodes: [],
    edges: [],
    runnable: [],
    active: [],
    completed: [],
    blocked: [],
    issues: [],
  };
  const hardBlockedInput = {
    current: "finished",
    definition: hardBlockedDefinition,
    state: stateWith({
      blockers: ["z-blocker", "a-blocker"],
      hardBlockers: ["artifact-graph"],
      taskGraph,
    }),
  };
  const hardBlockedRoute = routeGraph(hardBlockedInput);
  assert.deepEqual(hardBlockedRoute, {
    schemaVersion: 2,
    graphId: "arbitrary-graph",
    current: "finished",
    next: "finished",
    edgeId: null,
    condition: "terminal",
    status: "terminal",
    delegate: "final-handler",
    requiredAudits: ["a-audit", "z-audit"],
    blockers: ["a-blocker", "z-blocker"],
    taskGraph,
  });
  assert.deepEqual(hardBlockedRoute, evaluateRouteDecision(hardBlockedInput).route);
});

test("returns a blocked result when no declared condition is satisfied", () => {
  const input = { current: "alpha", definition: definitionWith({}), state: stateWith() };
  const route = routeGraph(input);
  assert.equal(route.next, "alpha");
  assert.equal(route.edgeId, null);
  assert.equal(route.condition, "blocked");
  assert.equal(route.status, "blocked");
  assert.equal(route.delegate, null);
  assert.deepEqual(route, evaluateRouteDecision(input).route);
});

test("fails closed when a node prerequisite gate is absent or not passing", () => {
  const definition = definitionWith({
    conditions: {
      first: { kind: "signal", signal: "first" },
      second: { kind: "signal", signal: "second" },
      prerequisite: { kind: "gate", gate: "prerequisite", status: "pass" },
    },
    nodes: {
      alpha: { kind: "action", requiresGates: ["prerequisite"] },
      repair: { kind: "delegate", delegate: "repair-handler" },
      finished: { kind: "terminal" },
    },
  });
  const route = routeGraph({
    current: "alpha",
    definition,
    state: stateWith({
      signals: [],
      gates: { prerequisite: { status: "fail", reasons: ["evidence-missing"] } },
    }),
  });
  assert.equal(route.next, "alpha");
  assert.equal(route.edgeId, null);
  assert.equal(route.condition, "blocked");
  assert.equal(route.status, "blocked");
  assert.deepEqual(route.blockers, [
    "required-gate:prerequisite",
    "required-gate:prerequisite:evidence-missing",
  ]);

  const missing = routeGraph({
    current: "alpha",
    definition,
    state: stateWith({ signals: ["first", "second"] }),
  });
  assert.deepEqual(missing.blockers, ["required-gate:prerequisite", "required-gate:prerequisite:missing"]);
  assert.equal(missing.next, "alpha");
  assert.equal(missing.edgeId, null);
});

test("stops before a normal edge when Graph State marks a hard blocker", () => {
  const route = routeGraph({
    current: "alpha",
    definition: definitionWith({}),
    state: stateWith({ signals: ["first"], hardBlockers: ["focus-invalid"] } as GraphState),
  });
  assert.equal(route.status, "blocked");
  assert.equal(route.edgeId, null);
  assert.equal(route.next, "alpha");
  assert.ok(route.blockers.includes("focus-invalid"));
});

test("rejects an unknown current node", () => {
  assert.throws(
    () => routeGraph({ current: "missing", definition: definitionWith({}), state: stateWith() }),
    /Unknown graph node: missing/,
  );
  assert.throws(
    () => routeGraph({ current: "toString", definition: definitionWith({}), state: stateWith() }),
    /Unknown graph node: toString/,
  );
});

test("evaluates signal and gate conditions, including gate not-pass", () => {
  const signal: GraphCondition = { kind: "signal", signal: "ready" };
  assert.equal(evaluateCondition(signal, stateWith({ signals: ["ready"] })), true);
  assert.equal(evaluateCondition(signal, stateWith()), false);

  const pass: GraphCondition = { kind: "gate", gate: "briefing", status: "pass" };
  const notPass: GraphCondition = { kind: "gate", gate: "briefing", status: "not-pass" };
  assert.equal(evaluateCondition(pass, stateWith({ gates: { briefing: { status: "pass", reasons: [] } } })), true);
  assert.equal(evaluateCondition(notPass, stateWith({ gates: { briefing: { status: "fail", reasons: [] } } })), true);
  assert.equal(evaluateCondition(notPass, stateWith()), true);
  assert.equal(evaluateCondition(pass, stateWith({ gates: { briefing: { status: "blocked", reasons: ["pending"] } } })), false);
});

test("evaluates runnable, invalid, and idle task-graph conditions", () => {
  const runnable: GraphCondition = { kind: "task-graph", state: "runnable" };
  const invalid: GraphCondition = { kind: "task-graph", state: "invalid" };
  const idle: GraphCondition = { kind: "task-graph", state: "idle" };
  const taskGraph = (overrides: Record<string, unknown> = {}): NonNullable<GraphState["taskGraph"]> => ({
    schemaVersion: 1,
    plan: "docs/plans/example.md",
    nodes: [],
    edges: [],
    runnable: [],
    active: [],
    completed: [],
    blocked: [],
    issues: [],
    ...overrides,
  } as NonNullable<GraphState["taskGraph"]>);

  assert.equal(evaluateCondition(runnable, stateWith({ taskGraph: taskGraph({ runnable: ["TASK-1"] }) })), true);
  assert.equal(evaluateCondition(runnable, stateWith({ taskGraph: null })), false);
  assert.equal(evaluateCondition(invalid, stateWith({ taskGraph: taskGraph({ issues: [{ code: "task-cycle" }] }) })), true);
  assert.equal(evaluateCondition(invalid, stateWith({ taskGraph: taskGraph() })), false);
  assert.equal(evaluateCondition(idle, stateWith({ taskGraph: taskGraph() })), true);
  assert.equal(evaluateCondition(idle, stateWith({ taskGraph: taskGraph({ runnable: ["TASK-1"] }) })), false);
  assert.equal(evaluateCondition(idle, stateWith({ taskGraph: null })), false);
});

test("does not encode domain node IDs in the generic router", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../src/skills/doc-driven-dev-graph/scripts/lib/graph_router.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /planning/);
  assert.doesNotMatch(source, /followup-triage/);
  assert.doesNotMatch(source, /exit-audit/);
});
