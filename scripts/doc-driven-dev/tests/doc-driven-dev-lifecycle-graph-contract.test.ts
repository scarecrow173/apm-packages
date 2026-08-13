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

const completeEdgesFixture = `${requiredNodesFixture}edges:
  - { id: probe-to-migration, from: probe, to: migration, when: migration-requested }
  - { id: probe-to-bootstrap, from: probe, to: bootstrap, when: bootstrap-incomplete }
  - { id: probe-to-briefing, from: probe, to: briefing, when: bootstrap-complete }
  - { id: migration-retry, from: migration, to: migration, when: migration-incomplete }
  - { id: migration-to-bootstrap, from: migration, to: bootstrap, when: migration-complete }
  - { id: bootstrap-retry, from: bootstrap, to: bootstrap, when: bootstrap-incomplete }
  - { id: bootstrap-to-briefing, from: bootstrap, to: briefing, when: bootstrap-complete }
  - { id: briefing-retry, from: briefing, to: briefing, when: briefing-incomplete }
  - { id: briefing-to-design, from: briefing, to: design, when: briefing-complete }
  - { id: design-retry, from: design, to: design, when: design-incomplete }
  - { id: design-to-planning, from: design, to: planning, when: design-complete }
  - { id: design-to-briefing, from: design, to: briefing, when: spec-gap }
  - { id: planning-retry, from: planning, to: planning, when: planning-incomplete }
  - { id: planning-to-task-graph, from: planning, to: task-graph, when: planning-complete }
  - { id: planning-to-design, from: planning, to: design, when: design-gap }
  - { id: task-graph-to-planning, from: task-graph, to: planning, when: task-graph-invalid }
  - { id: task-graph-retry, from: task-graph, to: task-graph, when: task-graph-retry }
  - { id: task-graph-to-implementation, from: task-graph, to: implementation, when: tasks-runnable }
  - { id: implementation-retry, from: implementation, to: implementation, when: implementation-incomplete }
  - { id: implementation-to-followup-triage, from: implementation, to: followup-triage, when: implementation-verified }
  - { id: implementation-to-briefing, from: implementation, to: briefing, when: spec-gap }
  - { id: implementation-to-design, from: implementation, to: design, when: design-gap }
  - { id: implementation-constraint-to-design, from: implementation, to: design, when: constraint-gap }
  - { id: followup-triage-retry, from: followup-triage, to: followup-triage, when: followups-unclassified }
  - { id: followup-triage-to-exit-audit, from: followup-triage, to: exit-audit, when: followups-classified }
  - { id: exit-audit-retry, from: exit-audit, to: exit-audit, when: exit-audit-required }
  - { id: exit-audit-to-complete, from: exit-audit, to: complete, when: exit-audit-pass }
`;

function fixtureWithoutEdge(edgeId: string): string {
  const line = completeEdgesFixture
    .split("\n")
    .find((candidate: string) => candidate.includes(`id: ${edgeId},`));
  assert.ok(line, `fixture should contain edge ${edgeId}`);
  return completeEdgesFixture.replace(`${line}\n`, "");
}

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

test("lifecycle graph rejects missing normal progression edges with valid endpoints", () => {
  assert.throws(
    () => parseLifecycleGraph(fixtureWithoutEdge("probe-to-bootstrap")),
    /missing required lifecycle edge: probe-to-bootstrap/,
  );
});

test("lifecycle graph rejects missing same-node retry edges with valid endpoints", () => {
  assert.throws(
    () => parseLifecycleGraph(fixtureWithoutEdge("migration-retry")),
    /missing required lifecycle edge: migration-retry/,
  );
});

test("lifecycle graph rejects missing loopback edges with valid endpoints", () => {
  assert.throws(
    () => parseLifecycleGraph(fixtureWithoutEdge("implementation-to-design")),
    /missing required lifecycle edge: implementation-to-design/,
  );
});

test("lifecycle graph rejects malformed fixtures", () => {
  assert.throws(() => parseLifecycleGraph(invalidFixture), /Invalid lifecycle graph/);
});
