const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const sourceCli = path.resolve(__dirname, "../src/skills/doc-driven-dev-graph/scripts/route_graph.ts");
const generatedCli = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/route_graph.js");
const tsxCli = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");
const oldRouteLifecyclePath = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/scripts/route_lifecycle.js");
const newSkillPath = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/SKILL.md");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-driven-dev-graph-cli-"));
}

function graphFile(repo: string): string {
  const file = path.join(repo, "graph.yaml");
  fs.writeFileSync(file, `schemaVersion: 2
id: cli-fixture
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

function runCli(cli: string, cwd: string, args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runSource(cwd: string, args: string[]) {
  return runCli(tsxCli, cwd, [sourceCli, ...args]);
}

test("default entry and one-edge JSON output are GraphRoute-shaped", () => {
  const repo = tempRepo();
  const graph = graphFile(repo);
  const result = runSource(repo, ["--graph", graph, "--signal", "advance", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const route = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(route).sort(), [
    "blockers", "condition", "current", "delegate", "edgeId", "graphId", "next",
    "requiredAudits", "schemaVersion", "status", "taskGraph",
  ]);
  assert.equal(route.graphId, "cli-fixture");
  assert.equal(route.current, "start");
  assert.equal(route.next, "next");
  assert.equal(route.edgeId, "start-to-next");
  assert.equal(route.condition, "advance");
  assert.equal(route.status, "edge");
  assert.equal(route.delegate, "next-handler");
});

test("selected graph validates current node and declared signal", () => {
  const repo = tempRepo();
  const graph = graphFile(repo);
  const unknownCurrent = runSource(repo, ["--graph", graph, "--current", "missing", "--json"]);
  assert.notEqual(unknownCurrent.status, 0);
  assert.match(unknownCurrent.stderr, /Unknown graph node|current/);

  const unknownSignal = runSource(repo, ["--graph", graph, "--signal", "not-declared", "--json"]);
  assert.notEqual(unknownSignal.status, 0);
  assert.match(unknownSignal.stderr, /signal|declared|condition/i);
});

test("terminal re-entry emits an idempotent terminal route", () => {
  const repo = tempRepo();
  const graph = graphFile(repo);
  const result = runSource(repo, ["--graph", graph, "--current", "done", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const route = JSON.parse(result.stdout);
  assert.equal(route.current, "done");
  assert.equal(route.next, "done");
  assert.equal(route.status, "terminal");
  assert.equal(route.condition, "terminal");
  assert.equal(route.edgeId, null);
});

test("canonical graph skill and generated CLI replace the lifecycle skill", () => {
  assert.equal(fs.existsSync(oldRouteLifecyclePath), false);
  assert.equal(fs.existsSync(generatedCli), true);
  assert.equal(fs.existsSync(newSkillPath), true);
  const skill = fs.readFileSync(newSkillPath, "utf8");
  assert.match(skill, /^name:\s*doc-driven-dev-graph\s*$/m);
});

test("generated CLI smoke matches source CLI terminology", { skip: !fs.existsSync(generatedCli) }, () => {
  const repo = tempRepo();
  const graph = graphFile(repo);
  const result = runCli(generatedCli, repo, ["--graph", graph, "--signal", "advance", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const route = JSON.parse(result.stdout);
  assert.equal(route.graphId, "cli-fixture");
  assert.equal(route.next, "next");
  assert.equal(route.edgeId, "start-to-next");
});
