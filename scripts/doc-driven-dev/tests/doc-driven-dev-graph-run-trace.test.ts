import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import {
  appendTraceEvent,
  normalizeForCompare,
  normalizeTraceEvent,
  readTraceFile,
  stableRouteHash,
  summarizeTrace,
  type TraceEvent,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/run_trace";

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

test("route-selected blockers are tokenized deterministically and idempotently", () => {
  const raw = {
    v: 1, runId: "r", seq: 1, kind: "route-selected", current: "a", next: "a",
    edgeId: null, status: "blocked", condition: "blocked", delegate: null,
    requiredAudits: [], commitGate: false,
    blockers: [
      "broken-relation:Broken implements relation from docs/specs/x.md to /abs/secret.md",
      "focus-required",
    ],
    focus: [], tasks: [], routeHash: "x",
  };
  const event = normalizeTraceEvent(raw);
  assert.equal(event.kind, "route-selected");
  if (event.kind !== "route-selected") return;
  assert.equal(event.blockers.length, 2);
  assert.match(event.blockers[0], /^broken-relation:sha256:[0-9a-f]{12}$/);
  assert.equal(event.blockers[1], "focus-required", "kind-less blockers pass through verbatim");
  assert.equal(JSON.stringify(event).includes("/abs/"), false);
  // Deterministic: the same free-text blocker maps to the same token.
  const again = normalizeTraceEvent(raw);
  assert.deepEqual(again, event);
  // Idempotent: already-tokenized blockers survive a second normalization.
  const reread = normalizeTraceEvent(JSON.parse(JSON.stringify(event)));
  assert.deepEqual(reread, event);
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

const sourceCli = path.resolve(__dirname, "../src/skills/doc-driven-dev-graph/scripts/route_graph.ts");
const generatedCli = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/route_graph.js");
const tsxCli = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");

function graphFile(repo: string): string {
  const file = path.join(repo, "graph.yaml");
  fs.writeFileSync(file, `schemaVersion: 2
id: trace-fixture
entry: start
conditions:
  advance: { kind: signal, signal: advance }
  finish: { kind: signal, signal: finish }
nodes:
  start: { kind: action }
  next: { kind: delegate, delegate: next-handler }
  done: { kind: terminal }
edges:
  - { id: start-to-next, from: start, to: next, when: advance, priority: 10 }
  - { id: next-to-done, from: next, to: done, when: finish, priority: 10 }
`, "utf8");
  return file;
}

function runSource(cwd: string, args: string[]) {
  const result = spawnSync(process.execPath, [tsxCli, sourceCli, ...args], { cwd, encoding: "utf8", windowsHide: true });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runGenerated(cwd: string, args: string[]) {
  const result = spawnSync(process.execPath, [generatedCli, ...args], { cwd, encoding: "utf8", windowsHide: true });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// The fixture artifacts carry "active" statuses, so without --focus the router
// blocks on focus-required. Pass an explicit focus to get an `edge` route.
const traceArgs = (graph: string, traceFile: string, runId: string) => [
  "--graph", graph, "--signal", "advance", "--focus", "docs/specs/0001-graph.md",
  "--json", "--trace-file", traceFile, "--run-id", runId,
];

test("route_graph appends artifact-scan and route-selected events", () => {
  const { repo } = fixtureRepo();
  const graph = graphFile(repo);
  const traceFile = path.join(repo, "traces", "run.jsonl");
  const source = runSource(repo, traceArgs(graph, traceFile, "r-1"));
  assert.equal(source.status, 0, source.stderr);
  const events = readTraceFile(traceFile);
  assert.deepEqual(events.map((event) => event.kind), ["artifact-scan", "route-selected"]);
  assert.deepEqual(events.map((event) => event.seq), [1, 2]);
  const scan = events[0] as Extract<typeof events[number], { kind: "artifact-scan" }>;
  assert.equal(scan.scans, 2, "project + gate re-scan are both measured");
  assert.equal(scan.uniqueFiles, 3);
  assert.equal(scan.filesRead, 6);
  assert.ok(scan.bytesRead > 0);
  const route = events[1] as Extract<typeof events[number], { kind: "route-selected" }>;
  assert.equal(route.edgeId, "start-to-next");
  assert.equal(route.delegate, "next-handler");
  assert.equal(route.status, "edge");
  assert.deepEqual(route.focus, ["docs/specs/0001-graph.md"]);
  assert.equal(route.runId, "r-1");
  assert.match(route.routeHash, /^[0-9a-f]{64}$/);
});

test("generated CLI emits identical trace events and identical stdout", () => {
  const { repo } = fixtureRepo();
  const graph = graphFile(repo);
  const traceFile = path.join(repo, "trace.jsonl");
  const generatedTraceFile = path.join(repo, "generated-trace.jsonl");
  const args = ["--graph", graph, "--signal", "advance", "--focus", "docs/specs/0001-graph.md", "--json"];
  const source = runSource(repo, [...args, "--trace-file", traceFile, "--run-id", "r-2"]);
  const generated = runGenerated(repo, [...args, "--trace-file", generatedTraceFile, "--run-id", "r-2"]);
  assert.equal(generated.status, 0, generated.stderr);
  assert.deepEqual(JSON.parse(generated.stdout), JSON.parse(source.stdout));
  // Route output is identical with and without tracing.
  const plain = runSource(repo, args);
  assert.deepEqual(JSON.parse(plain.stdout), JSON.parse(source.stdout));
  const generatedEvents = readTraceFile(generatedTraceFile);
  assert.deepEqual(generatedEvents.map((event) => event.kind), ["artifact-scan", "route-selected"]);
  // The generated bundle emits exactly what the source CLI emits.
  assert.deepEqual(
    normalizeForCompare(generatedEvents),
    normalizeForCompare(readTraceFile(traceFile)),
  );
});

test("a second invocation continues the per-runId sequence", () => {
  const { repo } = fixtureRepo();
  const graph = graphFile(repo);
  const traceFile = path.join(repo, "trace.jsonl");
  runSource(repo, traceArgs(graph, traceFile, "r-3"));
  runSource(repo, traceArgs(graph, traceFile, "r-3"));
  const events = readTraceFile(traceFile);
  assert.deepEqual(events.map((event) => event.seq), [1, 2, 3, 4]);
});

test("trace requires both flags and never leaks document bodies", () => {
  const { repo } = fixtureRepo();
  const graph = graphFile(repo);
  const lonely = runSource(repo, ["--graph", graph, "--json", "--trace-file", path.join(repo, "t.jsonl")]);
  assert.equal(lonely.status, 1);
  assert.match(lonely.stderr, /--trace-file and --run-id/);
  const noTrace = path.join(repo, "absent.jsonl");
  runSource(repo, ["--graph", graph, "--signal", "advance", "--json"]);
  assert.equal(fs.existsSync(noTrace), false);
  const marker = "SECRET-BODY-SENTINEL";
  writeArtifact(repo, "docs/specs/0002-secret.md", { id: "SPEC-0002", type: "spec", status: "approved", title: "S" }, marker);
  const traceFile = path.join(repo, "trace.jsonl");
  runSource(repo, ["--graph", graph, "--signal", "advance", "--json", "--trace-file", traceFile, "--run-id", "r-4"]);
  assert.equal(fs.readFileSync(traceFile, "utf8").includes(marker), false);
});

test("an absolute-path relation reaches the trace only as a hashed blocker token", () => {
  const { repo } = fixtureRepo();
  writeArtifact(repo, "docs/specs/0002-broken.md", {
    id: "SPEC-0002", type: "spec", status: "approved", title: "Broken",
    relations: { implements: ["/abs/x.md"] },
  }, "# Broken\n");
  const graph = graphFile(repo);
  const traceFile = path.join(repo, "trace.jsonl");
  const result = runSource(repo, traceArgs(graph, traceFile, "r-5"));
  assert.equal(result.status, 0, result.stderr);
  // The stdout route keeps the human-readable blocker; only the trace tokenizes it.
  assert.ok(JSON.parse(result.stdout).blockers.some((blocker: string) => blocker.includes("/abs/x.md")));
  assert.equal(fs.readFileSync(traceFile, "utf8").includes("/abs/x.md"), false);
  const route = readTraceFile(traceFile).find((event) => event.kind === "route-selected");
  const blocker = route?.kind === "route-selected"
    ? route.blockers.find((item) => item.startsWith("broken-relation:"))
    : undefined;
  assert.match(blocker ?? "", /^broken-relation:sha256:[0-9a-f]{12}$/);
});

test("an unwritable trace file warns on stderr without failing the route", () => {
  const { repo } = fixtureRepo();
  const graph = graphFile(repo);
  // A regular file where the trace directory belongs makes mkdir/append fail.
  const occupied = path.join(repo, "not-a-directory");
  fs.writeFileSync(occupied, "occupied\n", "utf8");
  const result = runSource(repo, traceArgs(graph, path.join(occupied, "trace.jsonl"), "r-6"));
  assert.equal(result.status, 0, result.stderr);
  const route = JSON.parse(result.stdout);
  assert.equal(route.schemaVersion, 2);
  assert.equal(route.edgeId, "start-to-next");
  assert.match(result.stderr, /run trace append failed/);
});
