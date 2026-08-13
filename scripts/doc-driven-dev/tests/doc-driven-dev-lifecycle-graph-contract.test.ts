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

const invalidFixture = `
schemaVersion: 1
entry: probe
nodes:
  probe: { kind: probe, delegate: null, audits: [] }
  complete: { kind: terminal, delegate: null, audits: [] }
edges:
  - { id: duplicate, from: probe, to: missing, when: invalid }
  - { id: duplicate, from: probe, to: complete, when: valid }
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

test("lifecycle graph rejects unknown nodes and duplicate edge ids", () => {
  assert.throws(() => parseLifecycleGraph(invalidFixture), /Invalid lifecycle graph/);
});
