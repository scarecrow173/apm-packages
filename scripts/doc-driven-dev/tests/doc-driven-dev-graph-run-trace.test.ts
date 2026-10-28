import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import matter from "gray-matter";
import {
  createArtifactScanCollector,
  scanArtifactGraph,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/artifact_graph";
import { projectGraphState } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_state";

const CANONICAL_TARGETS = [
  "docs/ideas", "docs/discovery", "docs/specs", "docs/designs", "docs/plans",
  "docs/tasks", "docs/test-specs", "docs/adr", "docs/impl/ir", "docs/impl/exp",
];

function writeArtifact(repo: string, relativePath: string, data: Record<string, unknown>, body: string): number {
  const file = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const content = matter.stringify(body, {
    created: "2026-08-24", updated: "2026-08-24", owners: [], relations: {}, ...data,
  });
  fs.writeFileSync(file, content, "utf8");
  return Buffer.byteLength(content, "utf8");
}

function fixtureRepo(): { repo: string; artifactFiles: number; totalBytes: number } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "doc-driven-dev-run-trace-"));
  for (const directory of CANONICAL_TARGETS) {
    fs.mkdirSync(path.join(repo, directory), { recursive: true });
    fs.writeFileSync(path.join(repo, directory, "README.md"), `# ${directory}\n`, "utf8");
  }
  let totalBytes = 0;
  totalBytes += writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "approved", title: "Graph",
  }, "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph\n");
  totalBytes += writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "accepted", title: "Graph",
  }, "# Graph\n\n## Considered Options\n\n### A\n\n### B\n");
  totalBytes += writeArtifact(repo, "docs/designs/0001-graph.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Graph",
    relations: { "derives-from": ["SPEC-0001", "ADR-0001"] },
  }, "# Graph\n");
  return { repo, artifactFiles: 3, totalBytes };
}

test("scan collector counts files, bytes, and unique paths", () => {
  const { repo, artifactFiles, totalBytes } = fixtureRepo();
  const collector = createArtifactScanCollector();
  scanArtifactGraph({ cwd: repo }, collector);
  assert.equal(collector.scans, 1);
  assert.equal(collector.filesRead, artifactFiles);
  assert.equal(collector.bytesRead, totalBytes);
  assert.equal(collector.filePaths.size, artifactFiles);

  scanArtifactGraph({ cwd: repo }, collector);
  assert.equal(collector.scans, 2);
  assert.equal(collector.filesRead, artifactFiles * 2);
  assert.equal(collector.bytesRead, totalBytes * 2);
  assert.equal(collector.filePaths.size, artifactFiles, "unique paths dedupe repeat scans");
});

test("projectGraphState reports both internal scans through the collector", () => {
  const { repo, artifactFiles, totalBytes } = fixtureRepo();
  const collector = createArtifactScanCollector();
  projectGraphState({ cwd: repo, graphId: "doc-driven-dev", focus: [] }, collector);
  // projectGraphState scans once, then evaluateGraphGates re-scans once.
  assert.equal(collector.scans, 2);
  assert.equal(collector.filesRead, artifactFiles * 2);
  assert.equal(collector.bytesRead, totalBytes * 2);
});

test("omitting the collector keeps projections identical", () => {
  const { repo } = fixtureRepo();
  const plain = projectGraphState({ cwd: repo, graphId: "doc-driven-dev", focus: [] });
  const collector = createArtifactScanCollector();
  const traced = projectGraphState({ cwd: repo, graphId: "doc-driven-dev", focus: [] }, collector);
  assert.deepEqual(traced, plain);
});

import {
  appendTraceEvent,
  normalizeForCompare,
  normalizeTraceEvent,
  readTraceFile,
  stableRouteHash,
  summarizeTrace,
  type TraceEvent,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/run_trace";

test("appendTraceEvent assigns per-runId sequence numbers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-trace-seq-"));
  const file = path.join(dir, "trace.jsonl");
  const scan = (runId: string) => ({
    v: 1 as const, runId, kind: "artifact-scan" as const,
    scans: 2, filesRead: 14, uniqueFiles: 7, bytesRead: 4096,
  });
  appendTraceEvent(file, scan("run-a"));
  appendTraceEvent(file, scan("run-b"));
  appendTraceEvent(file, scan("run-a"));
  const events = readTraceFile(file);
  assert.deepEqual(events.map((event) => [event.runId, event.seq]), [
    ["run-a", 1], ["run-b", 1], ["run-a", 2],
  ]);
});

test("normalizeTraceEvent rejects malformed and unsafe events", () => {
  const base = { v: 1, runId: "r", seq: 1 };
  assert.throws(() => normalizeTraceEvent({ ...base, kind: "nope" }), /unknown trace event kind/);
  assert.throws(() => normalizeTraceEvent({ ...base, kind: "run-yield", reason: "terminal", hops: 0, completedEdges: [], seq: 0 }), /positive integer/);
  assert.throws(() => normalizeTraceEvent({ v: 1, kind: "run-yield", reason: "terminal", hops: 0, completedEdges: [], seq: 1 }), /runId/);
  assert.throws(() => normalizeTraceEvent({
    ...base, kind: "effect-outcome", edgeId: "e", stage: "audit", effectId: "spec",
    outcome: "completed", reason: "commit-required", evidencePaths: ["docs/specs/a.md"],
  }), /only valid for yield/);
  assert.throws(() => normalizeTraceEvent({
    ...base, kind: "effect-outcome", edgeId: "e", stage: "audit", effectId: "spec",
    outcome: "completed", evidencePaths: ["/abs/secret.md"],
  }), /relative paths/);
  assert.throws(() => normalizeTraceEvent({
    ...base, kind: "effect-outcome", edgeId: "e", stage: "audit", effectId: "spec",
    outcome: "completed", evidencePaths: ["C:\\abs\\secret.md"],
  }), /relative paths/);
  assert.throws(() => normalizeTraceEvent({
    ...base, kind: "route-selected", current: "a", next: "b", edgeId: null,
    status: "blocked", condition: "blocked", delegate: null, requiredAudits: [],
    commitGate: false, blockers: [], focus: [], tasks: [], routeHash: "x",
    durationMs: Number.NaN,
  }), /durationMs/);
  // Unknown extra fields are dropped, not kept.
  const event = normalizeTraceEvent({
    ...base, kind: "run-yield", reason: "terminal", hops: 3,
    completedEdges: ["e1"], rawPrompt: "do not keep",
  });
  assert.equal("rawPrompt" in event, false);
});

test("route-selected normalization rejects missing commitGate", () => {
  const baseRouteSelected = {
    v: 1, runId: "r", seq: 1, kind: "route-selected", current: "a", next: "a",
    edgeId: null, status: "blocked", condition: "blocked", delegate: null,
    requiredAudits: [], commitGate: false, blockers: [], focus: [],
    tasks: [], routeHash: "x",
  };
  const { commitGate: _omitted, ...rest } = baseRouteSelected;
  assert.throws(() => normalizeTraceEvent(rest), /commitGate/);
});

test("summarizeTrace aggregates routes, dispatches, outcomes, and scans", () => {
  const events = [
    normalizeTraceEvent({ v: 1, runId: "r", seq: 1, kind: "artifact-scan", scans: 2, filesRead: 14, uniqueFiles: 7, bytesRead: 4096 }),
    normalizeTraceEvent({ v: 1, runId: "r", seq: 2, kind: "route-selected", current: "task-graph", next: "implementation", edgeId: "task-graph-to-implementation", status: "edge", condition: "tasks-runnable", delegate: "implementation-flow", requiredAudits: ["task"], commitGate: true, blockers: [], focus: ["docs/plans/0001-graph.md"], tasks: [{ id: "TASK-1", status: "todo" }], routeHash: "abc" }),
    normalizeTraceEvent({ v: 1, runId: "r", seq: 3, kind: "effect-dispatched", edgeId: "task-graph-to-implementation", stage: "audit", effectId: "task", executionMode: "tool", focusPaths: ["docs/tasks/0001-task.md"] }),
    normalizeTraceEvent({ v: 1, runId: "r", seq: 4, kind: "effect-outcome", edgeId: "task-graph-to-implementation", stage: "audit", effectId: "task", outcome: "retry", evidencePaths: ["docs/tasks/0001-task.md"] }),
    normalizeTraceEvent({ v: 1, runId: "r", seq: 5, kind: "effect-dispatched", edgeId: "task-graph-to-implementation", stage: "delegate", effectId: "implementation-flow", executionMode: "subagent", focusPaths: ["docs/tasks/0001-task.md"] }),
    normalizeTraceEvent({ v: 1, runId: "r", seq: 6, kind: "effect-outcome", edgeId: "task-graph-to-implementation", stage: "delegate", effectId: "implementation-flow", outcome: "yield", reason: "commit-required", evidencePaths: ["docs/impl/ir/0001-task.md"] }),
    normalizeTraceEvent({ v: 1, runId: "r", seq: 7, kind: "run-yield", reason: "commit-required", hops: 1, completedEdges: [] }),
  ];
  const summary = summarizeTrace(events);
  assert.equal(summary.runId, "r");
  assert.equal(summary.routeSelections, 1);
  assert.deepEqual(summary.edgesSelected, ["task-graph-to-implementation"]);
  assert.deepEqual(summary.auditsDispatched, { task: 1 });
  assert.deepEqual(summary.delegatesDispatched, { "implementation-flow": 1 });
  assert.equal(summary.executionModes.subagent, 1);
  assert.equal(summary.executionModes.tool, 1);
  assert.equal(summary.effectOutcomes.retry, 1);
  assert.equal(summary.effectOutcomes.yield, 1);
  assert.deepEqual(summary.yieldReasons, { "commit-required": 2 });
  assert.equal(summary.filesRead, 14);
  assert.equal(summary.uniqueFilesMax, 7);
});

test("stableRouteHash ignores key order and normalizeForCompare drops durationMs", () => {
  const left = stableRouteHash({ a: 1, b: { c: [2, 3], d: 4 } });
  const right = stableRouteHash({ b: { d: 4, c: [2, 3] }, a: 1 });
  assert.equal(left, right);
  const withDuration: TraceEvent = normalizeTraceEvent({
    v: 1, runId: "r", seq: 1, kind: "route-selected", current: "a", next: "a",
    edgeId: null, status: "blocked", condition: "blocked", delegate: null,
    requiredAudits: [], commitGate: false, blockers: ["b"], focus: [],
    tasks: [], routeHash: left, durationMs: 12.5,
  });
  const compared = normalizeForCompare([withDuration]);
  assert.equal("durationMs" in compared[0], false);
  assert.equal(compared[0].routeHash, left);
});

test("readTraceFile rejects malformed lines instead of skipping them", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-trace-bad-"));
  const file = path.join(dir, "trace.jsonl");
  fs.writeFileSync(file, `${JSON.stringify({ v: 1, runId: "r", seq: 1, kind: "run-yield", reason: "terminal", hops: 0, completedEdges: [] })}\nnot-json\n`, "utf8");
  assert.throws(() => readTraceFile(file), /line 2/);
});
