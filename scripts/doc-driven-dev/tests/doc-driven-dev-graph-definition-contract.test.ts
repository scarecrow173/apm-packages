import type { GraphDefinition } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  loadGraphDefinition,
  parseGraphDefinition,
} = require("../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition.ts");

function findEdge(definition: GraphDefinition, from: string, when: string): GraphDefinition["edges"][number] | undefined {
  return definition.edges.find((edge) => edge.from === from && edge.when === when);
}

function distributedGraph(): GraphDefinition {
  const file = path.resolve(
    __dirname,
    "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml",
  );
  return loadGraphDefinition(file);
}

const validFixture = `
schemaVersion: 2
id: example
entry: start
conditions:
  ready: { kind: signal, signal: ready }
  other: { kind: signal, signal: other }
nodes:
  start: { kind: action }
  done: { kind: terminal }
edges:
  - { id: start-to-done, from: start, to: done, when: ready, priority: 10 }
`;

test("loads the distributed graph definition with declared delegates", () => {
  const graph = distributedGraph();
  assert.equal(graph.schemaVersion, 2);
  assert.equal(graph.id, "doc-driven-dev");
  assert.equal(graph.nodes.briefing.delegate, "briefing-flow");
  assert.deepEqual(graph.nodes.briefing.audits, ["spec", "adr"]);
  assert.equal(graph.nodes.implementation.delegate, "implementation-flow");
  assert.deepEqual(graph.nodes["exit-audit"].audits, ["all"]);
  assert.ok(findEdge(graph, "design", "spec-gap"));
  assert.ok(findEdge(graph, "planning", "planning-not-pass"));
  assert.ok(findEdge(graph, "planning", "planning"));
  assert.ok(findEdge(graph, "exit-audit", "design-not-pass"));
  assert.ok(findEdge(graph, "task-graph", "task-graph-invalid"));
  const activeEdge = findEdge(graph, "task-graph", "tasks-active");
  const runnableEdge = findEdge(graph, "task-graph", "tasks-runnable");
  assert.deepEqual(graph.conditions["tasks-active"], { kind: "task-graph", state: "active" });
  assert.equal(activeEdge?.id, "task-graph-to-active-implementation");
  assert.equal(activeEdge?.to, "implementation");
  assert.ok(activeEdge && runnableEdge && activeEdge.priority < runnableEdge.priority);
});

test("parses a schema-v2 definition and preserves edge priority", () => {
  const definition = parseGraphDefinition(validFixture);
  assert.equal(definition.entry, "start");
  assert.equal(definition.conditions.ready.kind, "signal");
  assert.equal(definition.edges[0].priority, 10);
});

test("rejects unknown condition and edge endpoints", () => {
  assert.throws(
    () => parseGraphDefinition(validFixture.replace("when: ready", "when: missing")),
    /unknown condition: missing/,
  );
  assert.throws(
    () => parseGraphDefinition(validFixture.replace("to: done", "to: missing")),
    /unknown to node: missing/,
  );
});

test("rejects duplicate route selectors and priorities", () => {
  const duplicateSelector = validFixture.replace(
    "  - { id: start-to-done, from: start, to: done, when: ready, priority: 10 }",
    [
      "  - { id: start-to-done, from: start, to: done, when: ready, priority: 10 }",
      "  - { id: start-to-done-2, from: start, to: done, when: ready, priority: 20 }",
    ].join("\n"),
  );
  assert.throws(() => parseGraphDefinition(duplicateSelector), /duplicate route selector: start \+ ready/);

  const duplicatePriority = validFixture.replace(
    "  - { id: start-to-done, from: start, to: done, when: ready, priority: 10 }",
    [
      "  - { id: start-to-done, from: start, to: done, when: ready, priority: 10 }",
      "  - { id: start-to-done-2, from: start, to: done, when: other, priority: 10 }",
    ].join("\n"),
  );
  assert.throws(() => parseGraphDefinition(duplicatePriority), /duplicate edge priority: start \+ 10/);
});

test("rejects invalid terminal and prerequisite-gate declarations", () => {
  const terminalOutgoing = validFixture.replace(
    "  - { id: start-to-done, from: start, to: done, when: ready, priority: 10 }",
    [
      "  - { id: start-to-done, from: start, to: done, when: ready, priority: 10 }",
      "  - { id: done-to-start, from: done, to: start, when: ready, priority: 20 }",
    ].join("\n"),
  );
  assert.throws(() => parseGraphDefinition(terminalOutgoing), /terminal node must not have outgoing edges: done/);

  const unknownGate = validFixture.replace("start: { kind: action }", "start: { kind: action, requiresGates: [missing] }");
  assert.throws(() => parseGraphDefinition(unknownGate), /unknown prerequisite gate: missing/);
});
