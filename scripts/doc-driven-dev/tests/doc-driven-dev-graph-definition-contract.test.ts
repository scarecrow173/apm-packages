import type { GraphDefinition } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadGraphDefinition, parseGraphDefinition } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";

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
schemaVersion: 3
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

// The distributed graph is the normative routing authority: probe →
// briefing → design → planning → task-graph → implementation →
// verification → knowledge-consolidation → exit-audit → complete, with no
// migration, follow-up-triage, or durable plan/task audit surface (v3,
// Issue #243).
test("loads the distributed graph definition with declared delegates", () => {
  const graph = distributedGraph();
  assert.equal(graph.schemaVersion, 3);
  assert.equal(graph.id, "doc-driven-dev");
  assert.equal(graph.entry, "probe");
  assert.equal(graph.nodes.bootstrap.delegate, "scaffold_docs");
  assert.equal(graph.nodes.briefing.delegate, "briefing-flow");
  assert.deepEqual(graph.nodes.briefing.audits, ["spec", "adr"]);
  assert.equal(graph.nodes.design.delegate, "design-doc");
  assert.deepEqual(graph.nodes.design.audits, ["design"]);
  assert.equal(graph.nodes.planning.kind, "delegate");
  assert.equal(graph.nodes.planning.delegate, "planning-flow");
  assert.deepEqual(graph.nodes.planning.audits, ["design"]);
  // The task graph projects the Execution Store run — its audits read only
  // the durable design surface; plan/task/test-spec audits are gone.
  assert.equal(graph.nodes["task-graph"].delegate, "build_task_graph");
  assert.deepEqual(graph.nodes["task-graph"].audits, ["design"]);
  assert.equal(graph.nodes.implementation.delegate, "implementation-flow");
  assert.equal(graph.nodes.implementation.audits, undefined);
  assert.equal(graph.nodes.implementation.commitGate, true);
  assert.equal(graph.nodes.briefing.commitGate, undefined);
  assert.ok(graph.runtimeSignals?.includes("commit-waived"));
  assert.ok(graph.runtimeSignals?.includes("knowledge-consolidated"));
  // Verification reads durable Verification Design docs on arrival; the
  // gate itself consumes the HEAD-bound Verification Summary.
  assert.deepEqual(graph.nodes.verification.audits, ["verification"]);
  assert.equal(graph.nodes["knowledge-consolidation"].delegate, "knowledge-doc");
  assert.deepEqual(graph.nodes["knowledge-consolidation"].audits, ["knowledge"]);
  assert.equal(graph.nodes["exit-audit"].delegate, "doc-status");
  assert.deepEqual(graph.nodes["exit-audit"].audits, ["all"]);
  assert.deepEqual(graph.nodes["exit-audit"].requiresGates, [
    "bootstrap",
    "briefing",
    "design",
    "planning",
    "implementation",
    "verification",
    "knowledge-consolidation",
  ]);
  assert.equal(graph.nodes["followup-triage"], undefined);
  assert.equal(graph.nodes["migrate"], undefined);
  assert.equal(graph.nodes.complete.kind, "terminal");
});

test("declares the normal route plus every repair and retry edge", () => {
  const graph = distributedGraph();
  assert.ok(findEdge(graph, "probe", "bootstrap"));
  assert.ok(findEdge(graph, "probe", "bootstrap-not-pass"));
  assert.ok(findEdge(graph, "design", "spec-gap"));
  assert.ok(findEdge(graph, "planning", "planning-not-pass"));
  assert.ok(findEdge(graph, "planning", "planning"));
  assert.ok(findEdge(graph, "exit-audit", "design-not-pass"));
  assert.ok(findEdge(graph, "task-graph", "task-graph-invalid"));
  const activeEdge = findEdge(graph, "task-graph", "tasks-active");
  const runnableEdge = findEdge(graph, "task-graph", "tasks-runnable");
  const idleEdge = findEdge(graph, "task-graph", "tasks-idle");
  assert.deepEqual(graph.conditions["tasks-active"], { kind: "task-graph", state: "active" });
  assert.deepEqual(graph.conditions["tasks-idle"], { kind: "task-graph", state: "idle" });
  assert.equal(activeEdge?.id, "task-graph-to-active-implementation");
  assert.equal(activeEdge?.to, "implementation");
  assert.ok(activeEdge && runnableEdge && activeEdge.priority < runnableEdge.priority);
  // Idle outranks nothing: it is the last task-graph selector so runnable
  // and active work always win over the all-terminal fallback.
  assert.ok(runnableEdge && idleEdge && runnableEdge.priority < idleEdge.priority);
  assert.equal(idleEdge?.to, "implementation");
  const verifyFail = findEdge(graph, "verification", "verification-not-pass");
  const verifyPass = findEdge(graph, "verification", "verification");
  assert.equal(verifyFail?.to, "implementation");
  assert.equal(verifyPass?.to, "knowledge-consolidation");
  const consolidate = findEdge(graph, "knowledge-consolidation", "knowledge-consolidation");
  assert.equal(consolidate?.to, "exit-audit");
  const complete = findEdge(graph, "exit-audit", "exit-audit");
  assert.equal(complete?.to, "complete");
});

test("parses a schema-v3 definition and preserves edge priority", () => {
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

test("parses commitGate on nodes and rejects non-boolean values", () => {
  const withGate = validFixture.replace(
    "  done: { kind: terminal }",
    "  done: { kind: terminal, commitGate: true }",
  );
  assert.equal(parseGraphDefinition(withGate).nodes.done.commitGate, true);
  const invalid = validFixture.replace(
    "  done: { kind: terminal }",
    "  done: { kind: terminal, commitGate: \"yes\" }",
  );
  assert.throws(() => parseGraphDefinition(invalid), /commitGate/);
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
