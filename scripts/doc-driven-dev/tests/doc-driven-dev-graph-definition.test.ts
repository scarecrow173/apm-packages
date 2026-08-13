import type { GraphDefinition } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadGraphDefinition, parseGraphDefinition } = require("../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition.ts");

const validFixture = `
schemaVersion: 2
id: doc-driven-dev
entry: probe
conditions:
  focus-required: { kind: signal, signal: focus-required }
  bootstrap-pass: { kind: gate, gate: bootstrap, status: pass }
  tasks-runnable: { kind: task-graph, state: runnable }
nodes:
  probe: { kind: action }
  done: { kind: terminal }
edges:
  - { id: probe-to-done, from: probe, to: done, when: focus-required, priority: 10 }
`;

function withFixture(edits: string): string {
  return validFixture.replace("edges:\n", `${edits}edges:\n`);
}

const unknownConditionFixture = validFixture.replace(
  "when: focus-required",
  "when: missing-condition",
);
const duplicateRouteFixture = validFixture.replace(
  "  - { id: probe-to-done, from: probe, to: done, when: focus-required, priority: 10 }",
  [
    "  - { id: probe-to-done, from: probe, to: done, when: focus-required, priority: 10 }",
    "  - { id: probe-to-done-2, from: probe, to: done, when: focus-required, priority: 20 }",
  ].join("\n"),
);
const duplicatePriorityFixture = validFixture.replace(
  "  - { id: probe-to-done, from: probe, to: done, when: focus-required, priority: 10 }",
  [
    "  - { id: probe-to-done, from: probe, to: done, when: focus-required, priority: 10 }",
    "  - { id: probe-to-done-2, from: probe, to: done, when: tasks-runnable, priority: 10 }",
  ].join("\n"),
);
const unknownEndpointFixture = validFixture.replace("to: done", "to: missing");
const invalidRequiresGatesFixture = validFixture.replace(
  "probe: { kind: action }",
  "probe: { kind: action, requiresGates: [missing] }",
);
const terminalOutgoingFixture = validFixture.replace(
  "  - { id: probe-to-done, from: probe, to: done, when: focus-required, priority: 10 }",
  [
    "  - { id: probe-to-done, from: probe, to: done, when: focus-required, priority: 10 }",
    "  - { id: done-to-probe, from: done, to: probe, when: focus-required, priority: 20 }",
  ].join("\n"),
);
const nonTerminalWithoutOutgoingFixture = validFixture.replace(
  "  probe: { kind: action }",
  "  probe: { kind: action }\n  idle: { kind: action }",
);

test("parses a schema-v2 graph definition with declared conditions", () => {
  const definition = parseGraphDefinition(validFixture);
  assert.equal(definition.schemaVersion, 2);
  assert.equal(definition.id, "doc-driven-dev");
  assert.equal(definition.entry, "probe");
  assert.equal(definition.conditions["focus-required"].kind, "signal");
  assert.equal(definition.edges[0].priority, 10);
});

test("loads and validates the distributed doc-driven-dev graph definition", () => {
  const file = path.resolve(
    __dirname,
    "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml",
  );
  const definition: GraphDefinition = loadGraphDefinition(file);
  assert.equal(definition.schemaVersion, 2);
  assert.equal(definition.id, "doc-driven-dev");
  assert.ok(definition.edges.length > 0);
});

test("rejects an edge that uses an unknown condition", () => {
  assert.throws(() => parseGraphDefinition(unknownConditionFixture), /unknown condition: missing-condition/);
});

test("rejects duplicate route selectors", () => {
  assert.throws(
    () => parseGraphDefinition(duplicateRouteFixture),
    /duplicate route selector: probe \+ focus-required/,
  );
});

test("rejects duplicate edge priorities", () => {
  assert.throws(
    () => parseGraphDefinition(duplicatePriorityFixture),
    /duplicate edge priority: probe \+ 10/,
  );
});

test("rejects unknown edge endpoints", () => {
  assert.throws(() => parseGraphDefinition(unknownEndpointFixture), /unknown to node: missing/);
});

test("rejects invalid prerequisite gates", () => {
  assert.throws(() => parseGraphDefinition(invalidRequiresGatesFixture), /unknown prerequisite gate: missing/);
});

test("rejects outgoing edges from terminal nodes", () => {
  assert.throws(
    () => parseGraphDefinition(terminalOutgoingFixture),
    /terminal node must not have outgoing edges: done/,
  );
});

test("rejects non-terminal nodes without outgoing edges", () => {
  assert.throws(
    () => parseGraphDefinition(nonTerminalWithoutOutgoingFixture),
    /non-terminal node must have an outgoing edge: idle/,
  );
});
