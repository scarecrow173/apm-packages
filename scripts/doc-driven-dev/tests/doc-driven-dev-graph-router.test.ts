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

test("returns terminal status when re-entering a terminal node", () => {
  const definition = definitionWith({ nodes: { finished: { kind: "terminal", delegate: "final-handler" } } });
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
});

test("returns a blocked result when no declared condition is satisfied", () => {
  const route = routeGraph({ current: "alpha", definition: definitionWith({}), state: stateWith() });
  assert.equal(route.next, "alpha");
  assert.equal(route.edgeId, null);
  assert.equal(route.condition, "blocked");
  assert.equal(route.status, "blocked");
  assert.equal(route.delegate, null);
});

test("rejects an unknown current node", () => {
  assert.throws(
    () => routeGraph({ current: "missing", definition: definitionWith({}), state: stateWith() }),
    /Unknown graph node: missing/,
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
