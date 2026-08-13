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

const unknownPrerequisiteFixture = `${requiredNodesFixture.replace(
  "exit-audit: { kind: audit, delegate: doc-status, audits: [all] }",
  "exit-audit: { kind: audit, delegate: doc-status, audits: [all], requiresGates: [missing] }",
)}edges: []\n`;

const duplicateEdgeIdFixture = `${requiredNodesFixture}edges:
  - { id: duplicate, from: probe, to: complete, when: migration-requested }
  - { id: duplicate, from: migration, to: complete, when: migration-complete }
`;

const duplicateRouteSelectorFixture = `
schemaVersion: 1
entry: implementation
nodes:
  implementation: { kind: action, delegate: implementation, audits: [] }
  briefing: { kind: terminal, delegate: null, audits: [] }
  design: { kind: terminal, delegate: null, audits: [] }
edges:
  - { id: implementation-to-briefing, from: implementation, to: briefing, when: spec-gap }
  - { id: implementation-to-design, from: implementation, to: design, when: spec-gap }
`;

const distinctRouteSelectorFixture = `
schemaVersion: 1
entry: implementation
nodes:
  implementation: { kind: action, delegate: implementation, audits: [] }
  briefing: { kind: terminal, delegate: null, audits: [] }
  design: { kind: terminal, delegate: null, audits: [] }
edges:
  - { id: implementation-to-briefing, from: implementation, to: briefing, when: spec-gap }
  - { id: implementation-to-design, from: implementation, to: design, when: design-gap }
`;

const terminalOutgoingEdgeFixture = `
schemaVersion: 1
entry: start
nodes:
  start: { kind: action, delegate: start, audits: [] }
  complete: { kind: terminal, delegate: null, audits: [] }
edges:
  - { id: start-to-complete, from: start, to: complete, when: lifecycle-complete }
  - { id: terminal-outgoing, from: complete, to: start, when: exit-audit-pass }
`;

const missingEntryFixture = `${requiredNodesFixture.replace("entry: probe", "entry: missing")}edges: []\n`;

const nonTerminalWithoutOutgoingFixture = `
schemaVersion: 1
entry: custom-start
nodes:
  custom-start: { kind: action, delegate: custom, audits: [] }
  custom-end: { kind: terminal, delegate: null, audits: [] }
edges: []
`;

const customNodeFixture = `
schemaVersion: 1
entry: custom-start
nodes:
  custom-start: { kind: action, delegate: custom, audits: [] }
  custom-end: { kind: terminal, delegate: null, audits: [] }
edges:
  - { id: custom-complete, from: custom-start, to: custom-end, when: lifecycle-complete }
`;

const duplicateNodeIdFixture = `
schemaVersion: 1
entry: custom-start
nodes:
  custom-start: { kind: action, delegate: custom, audits: [] }
  custom-start: { kind: terminal, delegate: null, audits: [] }
edges: []
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
  assert.deepEqual(graph.nodes["exit-audit"].requiresGates, [
    "bootstrap",
    "briefing",
    "design",
    "planning",
    "implementation",
    "followup-triage",
  ]);
  assert.ok(findEdge(graph, "followup-triage", "followup-bug-fix"));
  assert.ok(findEdge(graph, "followup-triage", "followup-decision-briefing"));
  assert.ok(findEdge(graph, "exit-audit", "planning-incomplete"));
  const exitAuditRepairs = [
    ["bootstrap-incomplete", "bootstrap", "exit-audit-to-bootstrap-repair"],
    ["briefing-incomplete", "briefing", "exit-audit-to-briefing-repair"],
    ["design-incomplete", "design", "exit-audit-to-design-repair"],
    ["planning-incomplete", "planning", "exit-audit-to-planning-repair"],
    ["implementation-incomplete", "implementation", "exit-audit-to-implementation-repair"],
    ["followups-unclassified", "followup-triage", "exit-audit-to-followup-triage-repair"],
  ] as const;
  for (const [reason, destination, edgeId] of exitAuditRepairs) {
    const edge = findEdge(graph, "exit-audit", reason);
    assert.equal(edge?.to, destination, reason);
    assert.equal(edge?.id, edgeId, reason);
  }
});

test("lifecycle graph rejects an unknown edge endpoint independently", () => {
  assert.throws(() => parseLifecycleGraph(unknownEndpointFixture), /unknown to node: missing/);
});

test("lifecycle graph rejects an unknown prerequisite gate", () => {
  assert.throws(() => parseLifecycleGraph(unknownPrerequisiteFixture), /unknown prerequisite gate: missing/);
});

test("lifecycle graph rejects duplicate edge IDs independently", () => {
  assert.throws(() => parseLifecycleGraph(duplicateEdgeIdFixture), /duplicate edge id: duplicate/);
});

test("lifecycle graph rejects duplicate route selectors", () => {
  assert.throws(
    () => parseLifecycleGraph(duplicateRouteSelectorFixture),
    /duplicate route selector: implementation \+ spec-gap/,
  );
});

test("lifecycle graph accepts distinct reasons from the same source", () => {
  const graph = parseLifecycleGraph(distinctRouteSelectorFixture);
  assert.equal(findEdge(graph, "implementation", "spec-gap")?.to, "briefing");
  assert.equal(findEdge(graph, "implementation", "design-gap")?.to, "design");
});

test("lifecycle graph rejects duplicate node IDs", () => {
  assert.throws(() => parseLifecycleGraph(duplicateNodeIdFixture), /duplicated mapping key|duplicate node/i);
});

test("lifecycle graph rejects outgoing edges from complete", () => {
  assert.throws(
    () => parseLifecycleGraph(terminalOutgoingEdgeFixture),
    /terminal node must not have outgoing edges: complete/,
  );
});

test("lifecycle graph rejects an entry endpoint that is not declared", () => {
  assert.throws(() => parseLifecycleGraph(missingEntryFixture), /entry node does not exist: missing/);
});

test("lifecycle graph rejects a non-terminal without outgoing edges", () => {
  assert.throws(
    () => parseLifecycleGraph(nonTerminalWithoutOutgoingFixture),
    /non-terminal node must have an outgoing edge: custom-start/,
  );
});

test("lifecycle graph accepts YAML-declared string node IDs", () => {
  const graph = parseLifecycleGraph(customNodeFixture);
  assert.equal(graph.entry, "custom-start");
  assert.ok(findEdge(graph, "custom-start", "lifecycle-complete"));
});

test("lifecycle graph rejects malformed fixtures", () => {
  assert.throws(() => parseLifecycleGraph(invalidFixture), /Invalid lifecycle graph/);
});
