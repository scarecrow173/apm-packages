import type {
  LifecycleGraph,
} from "../src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_graph";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  findEdge,
  parseLifecycleGraph,
} = require("../src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_graph.ts");

function loadDistributedGraph(): LifecycleGraph {
  const file = path.resolve(
    __dirname,
    "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/graphs/lifecycle.yaml",
  );
  return parseLifecycleGraph(fs.readFileSync(file, "utf8"));
}

const requiredNodesFixture = `
schemaVersion: 1
entry: probe
nodes:
  probe: { kind: probe, delegate: null, audits: [] }
  migration: { kind: action, delegate: migrate_docs, audits: [] }
  bootstrap: { kind: action, delegate: scaffold_docs, audits: [] }
  briefing: { kind: subgraph, delegate: briefing-flow, audits: [spec, adr] }
  design: { kind: action, delegate: design-doc, audits: [design] }
  planning: { kind: subgraph, delegate: null, audits: [plan, task] }
  task-graph: { kind: gate, delegate: build_task_graph, audits: [task] }
  implementation: { kind: subgraph, delegate: implementation-flow, audits: [impl-record] }
  followup-triage: { kind: gate, delegate: null, audits: [task, impl-record] }
  exit-audit: { kind: audit, delegate: doc-status, audits: [all] }
  complete: { kind: terminal, delegate: null, audits: [] }
`;

const unknownEndpointFixture = `${requiredNodesFixture}edges:
  - { id: unknown-endpoint, from: probe, to: missing, when: migration-requested }
`;

const duplicateEdgeIdFixture = `${requiredNodesFixture}edges:
  - { id: duplicate, from: probe, to: complete, when: migration-requested }
  - { id: duplicate, from: migration, to: complete, when: migration-complete }
`;

const terminalOutgoingEdgeFixture = `${requiredNodesFixture}edges:
  - { id: terminal-outgoing, from: complete, to: probe, when: exit-audit-pass }
`;

const invalidFixture = `
schemaVersion: 1
entry: probe
nodes:
  probe: { kind: probe, delegate: null, audits: [] }
  complete: { kind: terminal, delegate: null, audits: [] }
edges:
  - { id: duplicate, from: probe, to: missing, when: migration-requested }
  - { id: duplicate, from: probe, to: complete, when: migration-complete }
`;

test("lifecycle graph preserves existing meta-skill boundaries", () => {
  const graph = loadDistributedGraph();
  assert.equal(graph.nodes.briefing.delegate, "briefing-flow");
  assert.equal(graph.nodes.implementation.delegate, "implementation-flow");
  assert.equal(graph.nodes.planning.delegate, null);
});

test("lifecycle graph declares required upstream loopbacks", () => {
  const graph = loadDistributedGraph();
  assert.ok(findEdge(graph, "design", "spec-gap"));
  assert.ok(findEdge(graph, "planning", "design-gap"));
  assert.ok(findEdge(graph, "implementation", "spec-gap"));
  assert.ok(findEdge(graph, "implementation", "design-gap"));
  assert.ok(findEdge(graph, "task-graph", "task-graph-invalid"));
});

test("lifecycle graph rejects an unknown edge endpoint independently", () => {
  assert.throws(() => parseLifecycleGraph(unknownEndpointFixture), /unknown to node: missing/);
});

test("lifecycle graph rejects duplicate edge IDs independently", () => {
  assert.throws(() => parseLifecycleGraph(duplicateEdgeIdFixture), /duplicate edge id: duplicate/);
});

test("lifecycle graph rejects outgoing edges from complete", () => {
  assert.throws(() => parseLifecycleGraph(terminalOutgoingEdgeFixture), /complete node must not have outgoing edges/);
});

test("lifecycle graph rejects malformed fixtures", () => {
  assert.throws(() => parseLifecycleGraph(invalidFixture), /Invalid lifecycle graph/);
});
