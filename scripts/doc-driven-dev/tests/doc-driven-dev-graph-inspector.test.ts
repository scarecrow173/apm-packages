import type { GraphInspection } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_inspector";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const nodePath = require("node:path");
const test = require("node:test");
const {
  loadGraphDefinition,
  parseGraphDefinition,
} = require("../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition.ts");
const {
  inspectGraphDefinition,
  renderGraphMermaid,
} = require("../src/skills/doc-driven-dev-graph/scripts/lib/graph_inspector.ts");

const unreachableFixture = `
schemaVersion: 2
id: unreachable
entry: start
conditions:
  ready: { kind: signal, signal: ready }
  orphan-ready: { kind: signal, signal: orphan-ready }
nodes:
  start: { kind: action }
  orphan: { kind: action }
  done: { kind: terminal }
edges:
  - { id: start-to-done, from: start, to: done, when: ready, priority: 10 }
  - { id: orphan-to-done, from: orphan, to: done, when: orphan-ready, priority: 10 }
`;

const unreachableTerminalFixture = `
schemaVersion: 2
id: unreachable-terminal
entry: start
conditions:
  ready: { kind: signal, signal: ready }
nodes:
  start: { kind: action }
  done: { kind: terminal }
  orphan: { kind: terminal }
edges:
  - { id: start-to-done, from: start, to: done, when: ready, priority: 10 }
`;

const noTerminalFixture = `
schemaVersion: 2
id: no-terminal
entry: start
conditions:
  retry: { kind: signal, signal: retry }
nodes:
  start: { kind: action }
edges:
  - { id: start-to-start, from: start, to: start, when: retry, priority: 10 }
`;

const unusedFixture = `
schemaVersion: 2
id: unused-condition
entry: start
conditions:
  ready: { kind: signal, signal: ready }
  never-used: { kind: gate, gate: never-used, status: pass }
nodes:
  start: { kind: action }
  done: { kind: terminal }
edges:
  - { id: start-to-done, from: start, to: done, when: ready, priority: 10 }
`;

function canonicalGraph() {
  const file = nodePath.resolve(
    __dirname,
    "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml",
  );
  return loadGraphDefinition(file);
}

test("inspects topology without evaluating route conditions", () => {
  const inspection = inspectGraphDefinition(parseGraphDefinition(unreachableFixture));

  assert.deepEqual(inspection.reachableNodes, ["done", "start"]);
  assert.deepEqual(inspection.unreachableNodes, ["orphan"]);
  assert.deepEqual(inspection.reachableTerminalNodes, ["done"]);
  assert.ok(inspection.issues.some((issue) => (
    issue.code === "unreachable-node" && issue.severity === "error" && issue.nodeId === "orphan"
  )));
});

test("warns for unreachable terminals and errors when no terminal is reachable", () => {
  const unreachableTerminal = inspectGraphDefinition(parseGraphDefinition(unreachableTerminalFixture));
  assert.deepEqual(unreachableTerminal.terminalNodes, ["done", "orphan"]);
  assert.ok(unreachableTerminal.issues.some((issue) => (
    issue.code === "unreachable-terminal" && issue.severity === "warning" && issue.nodeId === "orphan"
  )));

  const noTerminal = inspectGraphDefinition(parseGraphDefinition(noTerminalFixture));
  assert.deepEqual(noTerminal.reachableTerminalNodes, []);
  assert.ok(noTerminal.issues.some((issue) => (
    issue.code === "no-reachable-terminal" && issue.severity === "error"
  )));
});

test("reports conditions declared but never referenced by an edge", () => {
  const inspection = inspectGraphDefinition(parseGraphDefinition(unusedFixture));

  assert.deepEqual(inspection.referencedConditions, ["ready"]);
  assert.deepEqual(inspection.unusedConditions, ["never-used"]);
  assert.ok(inspection.issues.some((issue) => (
    issue.code === "unused-condition" && issue.severity === "warning" && issue.condition === "never-used"
  )));
});

test("renders a stable Mermaid graph with sorted labels and edge priorities", () => {
  const canonicalInspection: GraphInspection = inspectGraphDefinition(canonicalGraph());
  const first = renderGraphMermaid(canonicalInspection);

  assert.deepEqual(canonicalInspection.unreachableNodes, []);
  assert.deepEqual(canonicalInspection.reachableTerminalNodes, ["complete"]);
  assert.deepEqual(canonicalInspection.issues, []);
  assert.equal(canonicalInspection.nodes.length, canonicalInspection.nodeCount);
  assert.equal(canonicalInspection.edges.length, canonicalInspection.edgeCount);
  assert.deepEqual(canonicalInspection.nodes[0], {
    nodeId: "bootstrap",
    kind: "action",
    delegate: "scaffold_docs",
    audits: [],
  });
  assert.deepEqual(canonicalInspection.edges[0], {
    id: "bootstrap-retry",
    from: "bootstrap",
    to: "bootstrap",
    when: "bootstrap-not-pass",
    priority: 10,
  });
  assert.deepEqual(
    canonicalInspection.delegates,
    [
      { nodeId: "briefing", delegate: "briefing-flow" },
      { nodeId: "bootstrap", delegate: "scaffold_docs" },
      { nodeId: "design", delegate: "design-doc" },
      { nodeId: "exit-audit", delegate: "doc-status" },
      { nodeId: "implementation", delegate: "implementation-flow" },
      { nodeId: "migration", delegate: "migrate_docs" },
      { nodeId: "task-graph", delegate: "build_task_graph" },
    ].sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
  );
  assert.equal(renderGraphMermaid(canonicalInspection), first);
  assert.match(first, /^flowchart TD\n/);
  assert.match(first, /briefing-flow/);
  assert.match(first, /implementation-flow/);
  assert.match(first, /doc-status/);
  assert.match(first, /audits: adr, spec/);
  assert.match(first, /exit-audit.*audits: all/);
  assert.match(first, /complete.*terminal/);
  assert.match(first, /briefing.*delegate/);
  assert.match(first, /\|bootstrap · p20\|/);
  assert.match(first, /\|design · p30\|/);
  assert.match(first, /\|exit-audit · p80\|/);
});

test("accepts focus-required as a declared public signal", () => {
  const sourceCli = nodePath.resolve(
    __dirname,
    "../src/skills/doc-driven-dev-graph/scripts/route_graph.ts",
  );
  const tsxCli = nodePath.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");
  const result = spawnSync(process.execPath, [
    tsxCli,
    sourceCli,
    "--signal",
    "focus-required",
    "--json",
    "--cwd",
    nodePath.resolve(__dirname, "../../.."),
  ], {
    cwd: nodePath.resolve(__dirname, "../.."),
    encoding: "utf8",
    windowsHide: true,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /Unknown signal not declared/);
  assert.ok(["blocked", "edge", "terminal"].includes(JSON.parse(result.stdout).status));
});
