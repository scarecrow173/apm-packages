import type { GraphDefinition } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  GRAPH_MIGRATION_GUIDANCE,
  loadGraphDefinition,
  parseGraphDefinition,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";

const validFixture = `
schemaVersion: 3
id: doc-driven-dev
entry: probe
conditions:
  focus-required: { kind: signal, signal: focus-required }
  bootstrap-pass: { kind: gate, gate: bootstrap, status: pass }
  tasks-active: { kind: task-graph, state: active }
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
const duplicateAuditsFixture = validFixture.replace(
  "probe: { kind: action }",
  "probe: { kind: action, audits: [spec, spec] }",
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
const runtimeSignalsFixture = validFixture.replace(
  "entry: probe\n",
  "entry: probe\nruntimeSignals: [review-passed, exit-audit-pass]\n",
);
const duplicateRuntimeSignalsFixture = runtimeSignalsFixture.replace(
  "runtimeSignals: [review-passed, exit-audit-pass]",
  "runtimeSignals: [review-passed, review-passed]",
);
const emptyRuntimeSignalFixture = runtimeSignalsFixture.replace(
  "runtimeSignals: [review-passed, exit-audit-pass]",
  "runtimeSignals: [\"\", exit-audit-pass]",
);

test("parses a schema-v3 graph definition with declared conditions", () => {
  const definition = parseGraphDefinition(validFixture);
  assert.equal(definition.schemaVersion, 3);
  assert.equal(definition.id, "doc-driven-dev");
  assert.equal(definition.entry, "probe");
  assert.deepEqual(definition.runtimeSignals, []);
  assert.equal(definition.conditions["focus-required"].kind, "signal");
  assert.deepEqual(definition.conditions["tasks-active"], { kind: "task-graph", state: "active" });
  assert.equal(definition.edges[0].priority, 10);
});

// Legacy v2 definitions are migration-domain data: normal runtime refuses
// them outright and names the migration lane instead of parsing them
// through a compatibility shim (Issue #243).
test("refuses a schema-v2 graph definition with migration guidance", () => {
  const v2Fixture = validFixture.replace("schemaVersion: 3", "schemaVersion: 2");
  assert.throws(
    () => parseGraphDefinition(v2Fixture),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Invalid graph definition:/);
      assert.match(error.message, /schemaVersion 2 is not supported by normal runtime/);
      assert.match(error.message, /doc_maintenance\.js migrate plan --json/);
      return true;
    },
  );
  assert.ok(GRAPH_MIGRATION_GUIDANCE.includes("migrate apply --expect <planHash>"));

  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "graph-v2-")),
    "graph.yaml",
  );
  try {
    fs.writeFileSync(file, v2Fixture, "utf8");
    assert.throws(() => loadGraphDefinition(file), /schemaVersion 2 is not supported/);
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

test("parses and validates Graph Definition-owned runtime signal vocabulary", () => {
  const definition = parseGraphDefinition(runtimeSignalsFixture);
  assert.deepEqual(definition.runtimeSignals, ["review-passed", "exit-audit-pass"]);
  assert.throws(
    () => parseGraphDefinition(duplicateRuntimeSignalsFixture),
    /duplicate runtime signal: review-passed/,
  );
  assert.throws(() => parseGraphDefinition(emptyRuntimeSignalFixture), /runtimeSignals\.0/);
});

test("loads and validates the distributed doc-driven-dev graph definition", () => {
  const file = path.resolve(
    __dirname,
    "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml",
  );
  const definition: GraphDefinition = loadGraphDefinition(file);
  assert.equal(definition.schemaVersion, 3);
  assert.equal(definition.id, "doc-driven-dev");
  assert.ok(definition.edges.length > 0);
});

test("exit-audit binds shared audits in stable order", () => {
  const file = path.resolve(
    __dirname,
    "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml",
  );
  const definition: GraphDefinition = loadGraphDefinition(file);
  const node = definition.nodes["exit-audit"];
  assert.deepEqual(node.audits, ["all"]);
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

test("rejects duplicate node audit declarations", () => {
  assert.throws(() => parseGraphDefinition(duplicateAuditsFixture), /duplicate audit on node probe/);
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
