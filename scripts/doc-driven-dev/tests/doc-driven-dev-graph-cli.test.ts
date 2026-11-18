import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import matter from "gray-matter";
import { resolveGraphPath } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_cli";
import {
  approvePlan,
  createRun,
  initStateRoot,
} from "../src/skills/lib/execution_store";
import type { TaskStatus } from "../src/skills/lib/execution_store";

const RUN_ID = "RUN-0001";

const sourceCli = path.resolve(__dirname, "../src/skills/doc-driven-dev-graph/scripts/route_graph.ts");
const inspectCli = path.resolve(__dirname, "../src/skills/doc-driven-dev-graph/scripts/inspect_graph.ts");
const generatedCli = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/route_graph.js");
const generatedTaskGraphCli = path.resolve(
  __dirname,
  "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/build_task_graph.js",
);
const generatedInspectCli = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/inspect_graph.js");
const tsxCli = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");
const retiredRoutePath = path.resolve(
  __dirname,
  "../../../packages/doc-driven-dev/.apm/skills",
  ["doc-driven-dev", "lifecycle"].join("-"),
  "scripts",
  ["route", "lifecycle"].join("_") + ".js",
);
const newSkillPath = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/SKILL.md");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-driven-dev-graph-cli-"));
}

// Graph State v3 requires an explicit, resolvable focus for any non-terminal
// route — a bare checkout is `focus-required`-blocked. Custom-graph fixtures
// get a lone durable spec so `--focus SPEC-0001` resolves a one-doc chain,
// and a baseline commit so the auto-computed Verification Summary binds to
// HEAD (zero required checks -> verified, no stray verification blocker).
function focusedRepo(): string {
  const repo = tempRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
  }, "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph\n");
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  };
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-qm", "baseline"]);
  return repo;
}

function graphFile(repo: string): string {
  const file = path.join(repo, "graph.yaml");
  fs.writeFileSync(file, `schemaVersion: 3
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

const CANONICAL_TARGETS = [
  "docs/ideas", "docs/discovery", "docs/specs", "docs/designs", "docs/plans",
  "docs/tasks", "docs/test-specs", "docs/adr", "docs/impl/ir", "docs/impl/exp",
  "docs/knowledge", "docs/verification",
];

function writeArtifact(repo: string, relativePath: string, data: Record<string, unknown>, body: string): void {
  const file = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, matter.stringify(body, {
    created: "2026-08-13",
    updated: "2026-08-13",
    owners: [],
    relations: {},
    ...data,
  }), "utf8");
}

function completeRepo(taskStatuses: Array<"todo" | "in-progress" | "blocked" | "done" | "wont-do"> = ["done"], dependsOn: string[][] = []): string {
  const repo = tempRepo();
  for (const directory of CANONICAL_TARGETS) {
    fs.mkdirSync(path.join(repo, directory), { recursive: true });
    fs.writeFileSync(path.join(repo, directory, "README.md"), `# ${directory}\n`, "utf8");
  }
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "approved", title: "Graph",
  }, "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph\n");
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "accepted", title: "Graph",
    relations: { "decides-for": ["DESIGN-0001"] },
  }, "# Graph\n\n## Considered Options\n\n### A\n\n### B\n");
  writeArtifact(repo, "docs/designs/0001-graph.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Graph",
    relations: { realizes: ["SPEC-0001"] },
  }, "# Graph\n");
  writeArtifact(repo, "docs/plans/0001-graph.md", {
    id: "PLAN-0001", type: "plan", status: "approved", title: "Graph",
    relations: { "derives-from": ["DESIGN-0001"] },
    "test-spec-skip": "fixture exercises routing only",
  }, "# Graph\n");
  taskStatuses.forEach((status, index) => {
    const id = `TASK-${String(index + 1).padStart(4, "0")}`;
    writeArtifact(repo, `docs/tasks/${String(index + 1).padStart(4, "0")}-task.md`, {
      id, type: "task", status, title: id,
      relations: {
        implements: ["docs/plans/0001-graph.md"],
        ...(dependsOn[index]?.length ? { "depends-on": dependsOn[index] } : {}),
      },
    }, "# Task\n\n## Verification\n\n- [ ] node --test\n");
  });
  // Task docs are corpus/history only (Issue #237): the task graph the CLI
  // routes on projects this Execution Store run, whose manifest focus joins
  // the fixture's spec/adr/design/plan chain.
  initStateRoot(repo);
  createRun(repo, {
    runId: RUN_ID,
    graphId: "doc-driven-dev",
    focus: ["docs/designs/0001-graph.md"],
    plan: "# Plan\n\nStore-managed run plan.\n",
    tasks: taskStatuses.map((status, index) => ({
      taskId: `TASK-${String(index + 1).padStart(4, "0")}`,
      title: `TASK-${String(index + 1).padStart(4, "0")}`,
      status,
      dependsOn: dependsOn[index] ?? [],
    })),
  });
  approvePlan(repo, RUN_ID, { actor: "cli-fixture" });
  // Route computation auto-builds a Verification Summary against HEAD and
  // the implementation gate binds it through the canonical subject digest
  // (Issue #241) — the fixture needs a real commit for the gate to pass.
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  };
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-qm", "baseline"]);
  return repo;
}

function preDesignRepo(): string {
  const repo = completeRepo();
  for (const relativePath of ["docs/designs/0001-graph.md", "docs/plans/0001-graph.md", "docs/tasks/0001-task.md"]) {
    fs.rmSync(path.join(repo, relativePath));
  }
  // The pre-design chain pairs spec+ADR through a capture-layer anchor:
  // discovery.motivates -> spec plus discovery.informs -> adr (the v1
  // stored direction is always anchor -> artifact, Issue #235).
  writeArtifact(repo, "docs/discovery/0001-graph.md", {
    id: "DISC-0001", type: "discovery", status: "confirmed", title: "Graph Discovery",
    relations: { motivates: ["SPEC-0001"], informs: ["SPEC-0001", "ADR-0001"] },
  }, "# Graph Discovery\n");
  for (const [relativePath, id, type] of [
    ["docs/specs/0001-graph.md", "SPEC-0001", "spec"],
    ["docs/adr/0001-graph.md", "ADR-0001", "adr"],
  ]) {
    const body = type === "spec"
      ? "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph\n"
      : "# Graph\n\n## Considered Options\n\n### A\n\n### B\n";
    writeArtifact(repo, relativePath, {
      id, type, status: "proposed", title: "Graph",
    }, body);
  }
  return repo;
}

function approvedDesignRepo(): string {
  const repo = completeRepo(["todo"]);
  for (const relativePath of ["docs/plans/0001-graph.md", "docs/tasks/0001-task.md"]) {
    fs.rmSync(path.join(repo, relativePath));
  }
  return repo;
}

function canonicalGraphPath(): string {
  return path.resolve(
    __dirname,
    "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml",
  );
}

type Scenario = {
  name: string;
  setup: () => { repo: string; args?: string[]; graph?: string };
  edgeId: string | null;
  next: string;
  status?: "edge" | "terminal" | "blocked";
  assertRoute?: (route: Record<string, unknown>) => void;
};

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

function runInspect(cwd: string, args: string[]) {
  return runCli(tsxCli, cwd, [inspectCli, ...args]);
}

function runGeneratedInspect(cwd: string, args: string[]) {
  return runCli(generatedInspectCli, cwd, args);
}

test("default entry and one-edge JSON output are GraphRoute-shaped", () => {
  const repo = focusedRepo();
  const graph = graphFile(repo);
  const args = ["--graph", graph, "--focus", "SPEC-0001", "--signal", "advance", "--signal", "finish", "--json"];
  const source = runSource(repo, args);
  const generated = runCli(generatedCli, repo, args);
  assert.equal(source.status, 0, source.stderr);
  assert.equal(generated.status, 0, generated.stderr);
  const route = JSON.parse(source.stdout);
  assert.deepEqual(JSON.parse(generated.stdout), route);
  assert.deepEqual(Object.keys(route).sort(), [
    "blockers", "commitGate", "condition", "current", "delegate", "edgeId", "graphId", "next",
    "requiredAudits", "schemaVersion", "status", "taskGraph",
  ]);
  assert.deepEqual(route, {
    schemaVersion: 3,
    graphId: "cli-fixture",
    current: "start",
    next: "next",
    edgeId: "start-to-next",
    condition: "advance",
    status: "edge",
    delegate: "next-handler",
    requiredAudits: [],
    blockers: ["bootstrap-incomplete"],
    taskGraph: null,
    commitGate: false,
  });
});

test("source and generated CLIs route a pre-design briefing chain identically", () => {
  const repo = preDesignRepo();
  const args = [
    "--graph", canonicalGraphPath(), "--current", "briefing",
    "--focus", "SPEC-0001", "--focus", "ADR-0001", "--cwd", repo, "--json",
  ];
  const source = runSource(repo, args);
  const generated = runCli(generatedCli, repo, args);
  assert.equal(source.status, 0, source.stderr);
  assert.equal(generated.status, 0, generated.stderr);
  assert.deepEqual(JSON.parse(generated.stdout), JSON.parse(source.stdout));
  assert.deepEqual(JSON.parse(source.stdout), {
    schemaVersion: 3,
    graphId: "doc-driven-dev",
    current: "briefing",
    next: "design",
    edgeId: "briefing-to-design",
    condition: "briefing",
    status: "edge",
    delegate: "design-doc",
    requiredAudits: ["design"],
    blockers: [],
    taskGraph: null,
    commitGate: false,
  });
});

function sharedUpstreamRepo(): string {
  const repo = preDesignRepo();
  // IDEA-0001 is the shared upstream for three chains: idea.motivates ->
  // spec is the only v1 spelling (Issue #235).
  writeArtifact(repo, "docs/ideas/0001-root.md", {
    id: "IDEA-0001", type: "idea", status: "active", title: "Root Idea",
    relations: { motivates: ["SPEC-0001", "SPEC-0002", "SPEC-0003"] },
  }, "# Root Idea\n");
  writeArtifact(repo, "docs/discovery/0001-graph.md", {
    id: "DISC-0001", type: "discovery", status: "confirmed", title: "Graph Discovery",
    relations: { motivates: ["SPEC-0001"], informs: ["SPEC-0001", "ADR-0001"] },
  }, "# Graph Discovery\n");
  for (const index of [2, 3]) {
    const suffix = String(index).padStart(4, "0");
    writeArtifact(repo, `docs/discovery/${suffix}-chain.md`, {
      id: `DISC-${suffix}`, type: "discovery", status: "confirmed", title: `Discovery ${index}`,
      relations: { motivates: [`SPEC-${suffix}`], informs: ["IDEA-0001"] },
    }, `# Discovery ${index}\n`);
    writeArtifact(repo, `docs/specs/${suffix}-chain.md`, {
      id: `SPEC-${suffix}`, type: "spec", status: "proposed", title: `Spec ${index}`,
    }, `# Spec ${index}\n\n## Acceptance Criteria\n\n- [ ] chain\n`);
    writeArtifact(repo, `docs/adr/${suffix}-chain.md`, {
      id: `ADR-${suffix}`, type: "adr", status: "accepted", title: `ADR ${index}`,
      relations: { "decides-for": [`DESIGN-${suffix}`] },
    }, `# ADR ${index}\n\n## Considered Options\n\n### A\n\n### B\n`);
    writeArtifact(repo, `docs/designs/${suffix}-chain.md`, {
      id: `DESIGN-${suffix}`, type: "design", status: "approved", title: `Design ${index}`,
      relations: { realizes: [`SPEC-${suffix}`] },
    }, `# Design ${index}\n`);
    // Pre-v3 plan corpus is migration inventory — the projection never
    // reads it (Issue #243); it stays to prove exactly that.
    writeArtifact(repo, `docs/plans/${suffix}-chain.md`, {
      id: `PLAN-${suffix}`, type: "plan", status: "completed", title: `Plan ${index}`,
      relations: { "derives-from": [`DESIGN-${suffix}`] },
    }, `# Plan ${index}\n`);
  }
  return repo;
}

test("source and generated CLIs route a unique chain past shared-upstream plans", () => {
  const repo = sharedUpstreamRepo();
  for (const focus of [["--focus", "SPEC-0001"], ["--focus", "DISC-0001"]]) {
    const args = [
      "--graph", canonicalGraphPath(), "--current", "briefing",
      ...focus, "--cwd", repo, "--json",
    ];
    const source = runSource(repo, args);
    const generated = runCli(generatedCli, repo, args);
    assert.equal(source.status, 0, source.stderr);
    assert.equal(generated.status, 0, generated.stderr);
    assert.deepEqual(JSON.parse(generated.stdout), JSON.parse(source.stdout));
    const route = JSON.parse(source.stdout);
    assert.equal(route.status, "edge", focus.join(" "));
    assert.equal(route.edgeId, "briefing-to-design", focus.join(" "));
    assert.deepEqual(route.blockers, [], focus.join(" "));
  }
});

test("source and generated CLIs route an approved design through planning-flow identically", () => {
  const repo = approvedDesignRepo();
  // The Execution Store run's manifest focus joins the design's chain, so the
  // task graph projects on every route and planning passes to task-graph.
  const expected = {
    design: {
      schemaVersion: 3,
      graphId: "doc-driven-dev",
      current: "design",
      next: "planning",
      edgeId: "design-to-planning",
      condition: "design",
      status: "edge",
      delegate: "planning-flow",
      requiredAudits: ["design"],
      blockers: [],
      commitGate: false,
    },
    planning: {
      schemaVersion: 3,
      graphId: "doc-driven-dev",
      current: "planning",
      next: "task-graph",
      edgeId: "planning-to-task-graph",
      condition: "planning",
      status: "edge",
      delegate: "build_task_graph",
      requiredAudits: ["design"],
      blockers: [],
      commitGate: false,
    },
  };

  for (const current of ["design", "planning"] as const) {
    const args = [
      "--graph", canonicalGraphPath(), "--current", current,
      "--focus", "DESIGN-0001", "--cwd", repo, "--json",
    ];
    const source = runSource(repo, args);
    const generated = runCli(generatedCli, repo, args);
    assert.equal(source.status, 0, source.stderr);
    assert.equal(generated.status, 0, generated.stderr);
    assert.deepEqual(JSON.parse(source.stdout), JSON.parse(generated.stdout));
    const route = JSON.parse(source.stdout) as Record<string, unknown>;
    const taskGraph = route.taskGraph;
    delete route.taskGraph;
    assert.deepEqual(route, expected[current]);
    assert.ok(taskGraph !== null && typeof taskGraph === "object", `${current}: task graph must project`);
    assert.deepEqual((taskGraph as { runnable: string[] }).runnable, ["TASK-0001"], current);
    assert.equal((taskGraph as { runId: string }).runId, RUN_ID, current);
  }
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

test("accepts runtime signals declared separately from edge conditions", () => {
  const repo = tempRepo();
  const runners = [
    ["source", (args: string[]) => runSource(repo, args)],
    ["generated", (args: string[]) => runCli(generatedCli, repo, args)],
  ] as const;
  for (const [name, run] of runners) {
    for (const signal of ["focus-required", "exit-audit-pass", "commit-waived"]) {
      const result = run(["--graph", canonicalGraphPath(), "--signal", signal, "--json"]);
      assert.equal(result.status, 0, `${name}/${signal}: ${result.stderr}`);
    }
    const unknownSignal = run([
      "--graph", canonicalGraphPath(), "--signal", "not-declared", "--json",
    ]);
    assert.notEqual(unknownSignal.status, 0, name);
    assert.match(unknownSignal.stderr, /signal|declared|condition/i, name);
  }
});

test("relative explicit graph paths remain process-cwd-relative when --cwd selects runtime state", () => {
  const processRepo = tempRepo();
  const runtimeRepo = focusedRepo();
  graphFile(processRepo);
  const result = runSource(processRepo, [
    "--graph", "graph.yaml", "--cwd", runtimeRepo, "--focus", "SPEC-0001", "--signal", "advance", "--json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const route = JSON.parse(result.stdout);
  assert.equal(route.graphId, "cli-fixture");
  assert.equal(route.edgeId, "start-to-next");
});

test("default graph resolution supplies JSON inspection and fails closed when candidates are absent", () => {
  const repo = tempRepo();
  const result = runInspect(repo, []);
  assert.equal(result.status, 0, result.stderr);
  const inspected = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(inspected), ["definition"]);
  assert.equal(inspected.definition.graphId, "doc-driven-dev");

  const originalExistsSync = fs.existsSync;
  fs.existsSync = (() => false) as typeof fs.existsSync;
  try {
    assert.throws(() => resolveGraphPath(undefined, repo), /Unable to locate.*Graph Definition/);
  } finally {
    fs.existsSync = originalExistsSync;
  }
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
  assert.equal(fs.existsSync(retiredRoutePath), false);
  assert.equal(fs.existsSync(generatedCli), true);
  assert.equal(fs.existsSync(newSkillPath), true);
  const skill = fs.readFileSync(newSkillPath, "utf8");
  assert.match(skill, /^name:\s*doc-driven-dev-graph\s*$/m);
});

test("generated CLI smoke matches source CLI terminology", { skip: !fs.existsSync(generatedCli) }, () => {
  const repo = focusedRepo();
  const graph = graphFile(repo);
  const result = runCli(generatedCli, repo, ["--graph", graph, "--focus", "SPEC-0001", "--signal", "advance", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const route = JSON.parse(result.stdout);
  assert.equal(route.graphId, "cli-fixture");
  assert.equal(route.next, "next");
  assert.equal(route.edgeId, "start-to-next");
});

test("resumable active task graph runs through source and generated CLIs", () => {
  const repo = completeRepo(
    ["done", "in-progress", "in-progress", "in-progress"],
    [[], ["TASK-0001"], ["TASK-0001"], ["TASK-0002"]],
  );
  const args = ["--focus", "DESIGN-0001", "--current", "task-graph", "--explain", "--json"];

  for (const [name, result] of [
    ["source", runSource(repo, args)],
    ["generated", runCli(generatedCli, repo, args)],
  ] as const) {
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    const explained = JSON.parse(result.stdout);
    const route = explained.route;
    assert.equal(route.edgeId, "task-graph-to-active-implementation", name);
    assert.equal(route.next, "implementation", name);
    assert.equal(route.delegate, "implementation-flow", name);
    assert.equal(route.status, "edge", name);
    assert.equal(route.commitGate, true, name);
    assert.deepEqual(route.taskGraph.active, ["TASK-0002", "TASK-0003", "TASK-0004"], name);
    assert.deepEqual(route.taskGraph.resumableActive, ["TASK-0002", "TASK-0003"], name);
    assert.deepEqual(explained.explanation.blockedReasons, [], name);
  }
});

test("active task takes priority over runnable task in source and generated CLIs", () => {
  const repo = completeRepo(["in-progress", "todo"]);
  const args = ["--focus", "DESIGN-0001", "--current", "task-graph", "--explain", "--json"];

  for (const [name, result] of [
    ["source", runSource(repo, args)],
    ["generated", runCli(generatedCli, repo, args)],
  ] as const) {
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    const explained = JSON.parse(result.stdout);
    const route = explained.route;
    assert.equal(route.edgeId, "task-graph-to-active-implementation", name);
    assert.equal(route.next, "implementation", name);
    assert.equal(route.delegate, "implementation-flow", name);
    assert.equal(route.status, "edge", name);
    assert.equal(route.commitGate, true, name);
    assert.deepEqual(route.taskGraph.active, ["TASK-0001"], name);
    assert.deepEqual(route.taskGraph.resumableActive, ["TASK-0001"], name);
    assert.deepEqual(route.taskGraph.runnable, ["TASK-0002"], name);
    assert.deepEqual(explained.explanation.blockedReasons, [], name);
  }
});

test("runnable prerequisite progresses while dependent active task remains unresolved", () => {
  const repo = completeRepo(["todo", "in-progress"], [[], ["TASK-0001"]]);
  const args = ["--focus", "DESIGN-0001", "--current", "task-graph", "--explain", "--json"];

  for (const [name, result] of [
    ["source", runSource(repo, args)],
    ["generated", runCli(generatedCli, repo, args)],
  ] as const) {
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    const explained = JSON.parse(result.stdout);
    const route = explained.route;
    assert.equal(route.edgeId, "task-graph-to-implementation", name);
    assert.equal(route.next, "implementation", name);
    assert.equal(route.delegate, "implementation-flow", name);
    assert.equal(route.status, "edge", name);
    assert.equal(route.commitGate, true, name);
    assert.deepEqual(route.taskGraph.runnable, ["TASK-0001"], name);
    assert.deepEqual(route.taskGraph.active, ["TASK-0002"], name);
    assert.deepEqual(route.taskGraph.resumableActive, [], name);
    assert.deepEqual(explained.explanation.blockedReasons, [], name);
  }
});

test("table-driven CLI routes exercise every migration scenario with one edge", () => {
  const scenarios: Scenario[] = [
    {
      name: "bootstrap required",
      setup: () => ({ repo: focusedRepo(), args: ["--focus", "SPEC-0001"] }),
      edgeId: "probe-to-bootstrap",
      next: "bootstrap",
    },
    {
      name: "happy path",
      setup: () => ({ repo: completeRepo(), args: ["--focus", "DESIGN-0001"] }),
      edgeId: "probe-to-briefing",
      next: "briefing",
    },
    {
      name: "spec gap",
      setup: () => ({ repo: completeRepo(), args: ["--focus", "DESIGN-0001", "--current", "design", "--signal", "spec-gap"] }),
      edgeId: "design-to-briefing",
      next: "briefing",
    },
    {
      name: "design gap",
      setup: () => ({ repo: completeRepo(), args: ["--focus", "DESIGN-0001", "--current", "planning", "--signal", "design-gap"] }),
      edgeId: "planning-to-design",
      next: "design",
    },
    {
      name: "invalid task graph",
      setup: () => ({
        repo: completeRepo(["todo", "todo"], [["TASK-0002"], ["TASK-0001"]]),
        args: ["--focus", "DESIGN-0001", "--current", "task-graph"],
      }),
      edgeId: "task-graph-to-planning",
      next: "planning",
    },
    {
      name: "runnable task graph",
      setup: () => ({
        repo: completeRepo(["todo"]),
        args: ["--focus", "DESIGN-0001", "--current", "task-graph"],
      }),
      edgeId: "task-graph-to-implementation",
      next: "implementation",
      assertRoute: (route) => {
        assert.deepEqual((route.taskGraph as { runnable: string[] }).runnable, ["TASK-0001"]);
        assert.equal(route.commitGate, true);
      },
    },
    {
      name: "parallel runnable tasks",
      setup: () => ({
        repo: completeRepo(["todo", "todo"]),
        args: ["--focus", "DESIGN-0001", "--current", "task-graph"],
      }),
      edgeId: "task-graph-to-implementation",
      next: "implementation",
      assertRoute: (route) => {
        assert.deepEqual((route.taskGraph as { runnable: string[] }).runnable, ["TASK-0001", "TASK-0002"]);
        assert.equal(route.commitGate, true);
      },
    },
    {
      name: "implementation retry",
      setup: () => ({
        repo: completeRepo(["todo"]),
        args: ["--focus", "DESIGN-0001", "--current", "implementation"],
      }),
      edgeId: "implementation-retry",
      next: "implementation",
      assertRoute: (route) => assert.equal(route.commitGate, true),
    },
    {
      name: "implementation complete routes to verification",
      setup: () => ({
        repo: completeRepo(["done"]),
        args: ["--focus", "DESIGN-0001", "--current", "implementation"],
      }),
      edgeId: "implementation-to-verification",
      next: "verification",
      assertRoute: (route) => {
        assert.equal(route.commitGate, false);
        assert.deepEqual(route.requiredAudits, ["verification"]);
      },
    },
    {
      name: "verified summary routes to knowledge consolidation",
      setup: () => ({
        repo: completeRepo(["done"]),
        args: ["--focus", "DESIGN-0001", "--current", "verification"],
      }),
      edgeId: "verification-to-knowledge-consolidation",
      next: "knowledge-consolidation",
    },
    {
      name: "knowledge consolidation retries until the caller signals it",
      setup: () => ({
        repo: completeRepo(["done"]),
        args: ["--focus", "DESIGN-0001", "--current", "knowledge-consolidation"],
      }),
      edgeId: "knowledge-consolidation-retry",
      next: "knowledge-consolidation",
    },
    {
      name: "knowledge consolidated routes to exit audit",
      setup: () => ({
        repo: completeRepo(["done"]),
        args: ["--focus", "DESIGN-0001", "--current", "knowledge-consolidation", "--signal", "knowledge-consolidated"],
      }),
      edgeId: "knowledge-consolidation-to-exit-audit",
      next: "exit-audit",
    },
    {
      name: "wont-do task remains non-runnable",
      setup: () => ({
        repo: completeRepo(["wont-do"]),
        args: ["--focus", "DESIGN-0001", "--current", "task-graph"],
      }),
      edgeId: null,
      next: "task-graph",
      status: "blocked",
      assertRoute: (route) => assert.deepEqual((route.taskGraph as { blocked: Array<{ id: string; reasons: string[] }> }).blocked, [
        { id: "TASK-0001", reasons: ["status:wont-do"] },
      ]),
    },
    {
      name: "upstream regression returns to briefing",
      setup: () => ({
        repo: completeRepo(),
        args: ["--focus", "DESIGN-0001", "--current", "implementation", "--signal", "spec-gap"],
      }),
      edgeId: "implementation-to-briefing",
      next: "briefing",
      assertRoute: (route) => assert.equal(route.commitGate, false),
    },
    {
      name: "exit audit retry",
      setup: () => ({
        repo: completeRepo(),
        args: ["--focus", "DESIGN-0001", "--current", "exit-audit", "--signal", "knowledge-consolidated"],
      }),
      edgeId: "exit-audit-retry",
      next: "exit-audit",
    },
    {
      name: "exit audit pass routes to complete",
      setup: () => ({
        repo: completeRepo(),
        args: ["--focus", "DESIGN-0001", "--current", "exit-audit", "--signal", "knowledge-consolidated", "--signal", "exit-audit-pass"],
      }),
      edgeId: "exit-audit-to-complete",
      next: "complete",
    },
    {
      name: "terminal re-entry",
      setup: () => ({ repo: completeRepo(), args: ["--focus", "DESIGN-0001", "--current", "complete"] }),
      edgeId: null,
      next: "complete",
      status: "terminal",
    },
    {
      name: "custom graph",
      setup: () => {
        const repo = focusedRepo();
        const graph = graphFile(repo).replace("cli-fixture", "custom-fixture");
        return { repo, graph, args: ["--current", "start", "--focus", "SPEC-0001", "--signal", "advance"] };
      },
      edgeId: "start-to-next",
      next: "next",
    },
  ];

  for (const scenario of scenarios) {
    const fixture = scenario.setup();
    const graphArgs = fixture.graph ? ["--graph", fixture.graph] : [];
    const result = runSource(fixture.repo, [...graphArgs, ...(fixture.args ?? []), "--json"]);
    assert.equal(result.status, 0, `${scenario.name}: ${result.stderr}`);
    const route = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(route.edgeId, scenario.edgeId, scenario.name);
    assert.equal(route.next, scenario.next, scenario.name);
    assert.equal(route.status, scenario.status ?? "edge", scenario.name);
    scenario.assertRoute?.(route);
  }
});

test("explain mode preserves the ordinary route under a separate envelope", () => {
  const repo = focusedRepo();
  const graph = graphFile(repo);
  const ordinaryResult = runSource(repo, ["--graph", graph, "--focus", "SPEC-0001", "--signal", "advance", "--json"]);
  const explainedResult = runSource(repo, ["--graph", graph, "--focus", "SPEC-0001", "--signal", "advance", "--explain", "--json"]);
  assert.equal(ordinaryResult.status, 0, ordinaryResult.stderr);
  assert.equal(explainedResult.status, 0, explainedResult.stderr);
  const ordinary = JSON.parse(ordinaryResult.stdout);
  const explained = JSON.parse(explainedResult.stdout);
  assert.deepEqual(explained.route, ordinary);
  assert.deepEqual(Object.keys(explained).sort(), ["explanation", "route"]);
  assert.equal(explained.explanation.selectedEdgeId, "start-to-next");
});

test("inspection CLI emits runtime state only for an explicit selector", () => {
  const repo = completeRepo();
  const graph = path.join(repo, "graph.yaml");
  fs.writeFileSync(graph, `schemaVersion: 3\nid: cli-fixture\nentry: start\nconditions: {}\nnodes: { start: { kind: terminal } }\nedges: []\n`, "utf8");

  const definitionOnly = runInspect(repo, ["--graph", graph, "--format", "json"]);
  assert.equal(definitionOnly.status, 0, definitionOnly.stderr);
  const inspected = JSON.parse(definitionOnly.stdout);
  assert.deepEqual(Object.keys(inspected), ["definition"]);

  const withState = runInspect(repo, [
    "--graph", graph, "--format", "json", "--cwd", repo, "--focus", "DESIGN-0001",
    // The fixture graph id (cli-fixture) never matches the run's manifest
    // graphId, so the task graph only appears through the explicit selector.
    "--run", RUN_ID,
  ]);
  assert.equal(withState.status, 0, withState.stderr);
  const selected = JSON.parse(withState.stdout);
  assert.ok(selected.definition);
  assert.ok(selected.state);
  assert.ok(selected.knowledge);
  assert.ok(selected.taskGraph);
  assert.deepEqual(Object.keys(selected.state), [
    "schemaVersion", "graphId", "cwd", "focus", "gates", "signals", "blockers", "hardBlockers",
    "execution", "verification",
  ]);
  assert.equal(selected.knowledge.nodes.some((node: { id: string }) => node.id === "DESIGN-0001"), true);
  assert.equal(selected.knowledge.edges.some((edge: { relation: string }) => (
    edge.relation === "realizes"
  )), true);
  assert.equal(selected.taskGraph.runId, RUN_ID);
  assert.deepEqual(selected.taskGraph.nodes[0], {
    id: "TASK-0001",
    path: `runs/${RUN_ID}/tasks/TASK-0001.json`,
    title: "TASK-0001",
    status: "done",
    dependsOn: [],
    blocks: [],
    scope: [],
    version: 1,
  });
  assert.deepEqual(selected.taskGraph.completed, ["TASK-0001"]);
});

test("inspection Mermaid output is deterministic and pure text", () => {
  const repo = tempRepo();
  const graph = graphFile(repo);
  const first = runInspect(repo, ["--graph", graph, "--format", "mermaid"]);
  const second = runInspect(repo, ["--graph", graph, "--format", "mermaid"]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.match(first.stdout, /^flowchart TD\n/);
});

test("inspection Mermaid rejects runtime projection selectors", () => {
  const repo = tempRepo();
  const graph = graphFile(repo);
  const selectors = [
    [["--cwd", repo], /mermaid.*cwd|cwd.*mermaid/i],
    [["--focus", "MISSING"], /mermaid.*focus|focus.*mermaid/i],
    // --task-dir is rejected as a v3-removed selector before format checks.
    [["--task-dir", "docs/tasks"], /task-dir.*not accepted|not accepted.*task-dir/i],
  ] as const;

  for (const [selector, message] of selectors) {
    const result = runInspect(repo, ["--graph", graph, "--format", "mermaid", ...selector]);
    assert.notEqual(result.status, 0, selector.join(" "));
    assert.match(result.stderr, message, selector.join(" "));
  }
});

test("CLI rejects unknown options, missing values, bad graphs, and invalid focus", () => {
  const repo = tempRepo();
  const graph = graphFile(repo);
  for (const args of [
    ["--graph", graph, "--signal", "missing", "--json"],
    ["--graph", graph, "--current", "missing", "--json"],
    ["--graph", graph, "--format", "yaml"],
    ["--graph"],
    ["--graph", path.join(repo, "missing.yaml"), "--json"],
  ]) {
    const result = args.includes("--format") ? runInspect(repo, args) : runSource(repo, args);
    assert.notEqual(result.status, 0, args.join(" "));
    assert.ok(result.stderr.trim(), args.join(" "));
  }
  const invalidFocus = runInspect(repo, ["--graph", graph, "--format", "json", "--cwd", repo, "--focus", "MISSING"]);
  assert.notEqual(invalidFocus.status, 0);
  assert.match(invalidFocus.stderr, /focus|invalid|unknown/i);
});

test("--task-dir fails closed identically on route and inspect CLIs under Graph State v3", () => {
  const repo = completeRepo();
  const outsideAbsolute = path.dirname(repo);
  // Graph State v3 rejects --task-dir unconditionally — plan/task state lives
  // in the Execution Store and is selected with --run/--state-root.
  for (const taskDir of ["docs/tasks", "docs/../docs/tasks", "../outside", "./../outside", outsideAbsolute]) {
    for (const [name, result] of [
      ["route(source)", runSource(repo, ["--task-dir", taskDir, "--focus", "DESIGN-0001", "--json"])],
      ["route(generated)", runCli(generatedCli, repo, ["--task-dir", taskDir, "--focus", "DESIGN-0001", "--json"])],
      ["inspect(source)", runInspect(repo, ["--task-dir", taskDir, "--format", "json", "--cwd", repo])],
      ["inspect(generated)", runGeneratedInspect(repo, ["--task-dir", taskDir, "--format", "json", "--cwd", repo])],
    ] as const) {
      assert.notEqual(result.status, 0, `${name} --task-dir ${taskDir} must exit nonzero`);
      assert.match(result.stderr, /--task-dir is not accepted/, `${name} --task-dir ${taskDir}`);
    }
  }
});

test("explain mode requires JSON output", () => {
  const repo = tempRepo();
  const graph = graphFile(repo);
  const result = runSource(repo, ["--graph", graph, "--explain"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /explain.*json|json.*explain/i);
});

test("source and generated graph CLIs have identical explain and inspection output", () => {
  const repo = tempRepo();
  const graph = graphFile(repo);
  const routeArgs = ["--graph", graph, "--signal", "advance", "--explain", "--json"];
  const inspectArgs = ["--graph", graph, "--format", "json"];
  const mermaidArgs = ["--graph", graph, "--format", "mermaid"];

  const sourceRoute = runSource(repo, routeArgs);
  const generatedRoute = runCli(generatedCli, repo, routeArgs);
  const sourceInspect = runInspect(repo, inspectArgs);
  const generatedInspect = runGeneratedInspect(repo, inspectArgs);
  const sourceMermaid = runInspect(repo, mermaidArgs);
  const generatedMermaid = runGeneratedInspect(repo, mermaidArgs);

  for (const [label, result] of [
    ["source route", sourceRoute],
    ["generated route", generatedRoute],
    ["source inspection", sourceInspect],
    ["generated inspection", generatedInspect],
    ["source Mermaid", sourceMermaid],
    ["generated Mermaid", generatedMermaid],
  ] as const) {
    assert.equal(result.status, 0, `${label}: ${result.stderr}`);
  }

  assert.deepEqual(JSON.parse(generatedRoute.stdout), JSON.parse(sourceRoute.stdout));
  assert.deepEqual(JSON.parse(generatedInspect.stdout), JSON.parse(sourceInspect.stdout));
  assert.equal(generatedMermaid.stdout, sourceMermaid.stdout);
});

test("canonical generated graph scripts contain no trailing whitespace", () => {
  const generatedGraphScripts = fs.readdirSync(path.dirname(generatedCli))
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(path.dirname(generatedCli), name));
  for (const cli of generatedGraphScripts) {
    const lines = fs.readFileSync(cli, "utf8").split(/\r?\n/);
    const trailingLine = lines.findIndex((line) => /[ \t]+$/.test(line));
    assert.equal(trailingLine, -1, `${path.basename(cli)} line ${trailingLine + 1} has trailing whitespace`);
  }
});
test("generated graph CLIs resolve owner-relative tasks and existing local files", () => {
  const repo = completeRepo(["done", "todo"], [[], ["TASK-0001"]]);
  // Corpus docs still exercise owner-relative relation resolution on the
  // artifact graph; the task graph itself projects the run's records.
  writeArtifact(repo, "docs/tasks/0001-task.md", {
    id: "TASK-0001", type: "task", status: "done", title: "TASK-0001",
    relations: { implements: ["../plans/0001-graph.md"] },
  }, "# Task\n\n## Verification\n\n- [x] complete\n");
  writeArtifact(repo, "docs/tasks/0002-task.md", {
    id: "TASK-0002", type: "task", status: "todo", title: "TASK-0002",
    relations: {
      implements: ["../plans/0001-graph.md"],
      "depends-on": ["0001-task.md"],
    },
  }, "# Task\n\n## Verification\n\n- [ ] pending\n");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src/example.py"), "VALUE = 1\n", "utf8");
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "approved", title: "Graph",
    relations: { source: ["../../src/example.py"] },
  }, "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph\n");

  const taskResult = runCli(generatedTaskGraphCli, repo, [
    "--run", RUN_ID, "--cwd", repo, "--json",
  ]);
  assert.equal(taskResult.status, 0, taskResult.stderr);
  const taskGraph = JSON.parse(taskResult.stdout);
  assert.deepEqual(taskGraph.nodes.map((node: { id: string }) => node.id), ["TASK-0001", "TASK-0002"]);
  assert.deepEqual(taskGraph.edges, [{ from: "TASK-0001", to: "TASK-0002" }]);
  assert.deepEqual(taskGraph.runnable, ["TASK-0002"]);
  assert.deepEqual(taskGraph.issues, []);

  const routeResult = runCli(generatedCli, repo, [
    "--graph", canonicalGraphPath(),
    "--current", "task-graph",
    "--focus", "DESIGN-0001",
    "--cwd", repo,
    "--json",
  ]);
  assert.equal(routeResult.status, 0, routeResult.stderr);
  const route = JSON.parse(routeResult.stdout);
  assert.equal(route.status, "edge");
  assert.equal(route.next, "implementation");
  assert.equal(route.commitGate, true);
  assert.equal(route.blockers.some((blocker: string) => blocker.startsWith("broken-relation:")), false);
  assert.deepEqual(route.taskGraph.edges, [{ from: "TASK-0001", to: "TASK-0002" }]);
  assert.deepEqual(route.taskGraph.runnable, ["TASK-0002"]);
});
