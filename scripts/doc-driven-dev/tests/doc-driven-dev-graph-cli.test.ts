const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const matter = require("gray-matter");
const { resolveGraphPath } = require("../src/skills/doc-driven-dev-graph/scripts/lib/graph_cli.ts");

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

const CANONICAL_TARGETS = [
  "docs/ideas", "docs/discovery", "docs/specs", "docs/designs", "docs/plans",
  "docs/tasks", "docs/adr", "docs/impl/ir", "docs/impl/exp",
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
  }, "# Graph\n\n## Considered Options\n\n### A\n\n### B\n");
  writeArtifact(repo, "docs/designs/0001-graph.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Graph",
    relations: { "derives-from": ["SPEC-0001", "ADR-0001"] },
  }, "# Graph\n");
  writeArtifact(repo, "docs/plans/0001-graph.md", {
    id: "PLAN-0001", type: "plan", status: "approved", title: "Graph",
    relations: { "derives-from": ["DESIGN-0001"] },
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

test("accepts runtime signals declared separately from edge conditions", () => {
  const repo = tempRepo();
  const runners = [
    ["source", (args: string[]) => runSource(repo, args)],
    ["generated", (args: string[]) => runCli(generatedCli, repo, args)],
  ] as const;
  for (const [name, run] of runners) {
    for (const signal of ["focus-required", "implementation-verified", "exit-audit-pass"]) {
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
  const runtimeRepo = tempRepo();
  graphFile(processRepo);
  const result = runSource(processRepo, [
    "--graph", "graph.yaml", "--cwd", runtimeRepo, "--signal", "advance", "--json",
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
  const repo = tempRepo();
  const graph = graphFile(repo);
  const result = runCli(generatedCli, repo, ["--graph", graph, "--signal", "advance", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const route = JSON.parse(result.stdout);
  assert.equal(route.graphId, "cli-fixture");
  assert.equal(route.next, "next");
  assert.equal(route.edgeId, "start-to-next");
});

test("table-driven CLI routes exercise every migration scenario with one edge", () => {
  const scenarios: Scenario[] = [
    {
      name: "bootstrap required",
      setup: () => ({ repo: tempRepo() }),
      edgeId: "probe-to-bootstrap",
      next: "bootstrap",
    },
    {
      name: "happy path",
      setup: () => ({ repo: completeRepo(), args: ["--focus", "PLAN-0001"] }),
      edgeId: "probe-to-briefing",
      next: "briefing",
    },
    {
      name: "spec gap",
      setup: () => ({ repo: completeRepo(), args: ["--focus", "PLAN-0001", "--current", "design", "--signal", "spec-gap"] }),
      edgeId: "design-to-briefing",
      next: "briefing",
    },
    {
      name: "design gap",
      setup: () => ({ repo: completeRepo(), args: ["--focus", "PLAN-0001", "--current", "planning", "--signal", "design-gap"] }),
      edgeId: "planning-to-design",
      next: "design",
    },
    {
      name: "invalid task graph",
      setup: () => ({
        repo: completeRepo(["todo", "todo"], [["TASK-0002"], ["TASK-0001"]]),
        args: ["--focus", "PLAN-0001", "--current", "task-graph"],
      }),
      edgeId: "task-graph-to-planning",
      next: "planning",
    },
    {
      name: "runnable task graph",
      setup: () => ({
        repo: completeRepo(["todo"]),
        args: ["--focus", "PLAN-0001", "--current", "task-graph"],
      }),
      edgeId: "task-graph-to-implementation",
      next: "implementation",
      assertRoute: (route) => assert.deepEqual((route.taskGraph as { runnable: string[] }).runnable, ["TASK-0001"]),
    },
    {
      name: "parallel runnable tasks",
      setup: () => ({
        repo: completeRepo(["todo", "todo"]),
        args: ["--focus", "PLAN-0001", "--current", "task-graph"],
      }),
      edgeId: "task-graph-to-implementation",
      next: "implementation",
      assertRoute: (route) => assert.deepEqual((route.taskGraph as { runnable: string[] }).runnable, ["TASK-0001", "TASK-0002"]),
    },
    {
      name: "implementation retry",
      setup: () => ({
        repo: completeRepo(["todo"]),
        args: ["--focus", "PLAN-0001", "--current", "implementation", "--signal", "implementation-verified"],
      }),
      edgeId: "implementation-retry",
      next: "implementation",
    },
    ...([
      ["followup-bug-fix", "followup-triage-to-planning", "planning"],
      ["followup-decision-briefing", "followup-triage-to-briefing", "briefing"],
      ["followup-decision-design", "followup-triage-to-design", "design"],
      ["followup-new-feature", "followup-triage-new-feature", "briefing"],
      ["followup-doc-only", "followup-triage-doc-only", "exit-audit"],
      ["followup-terminal", "followup-triage-terminal", "exit-audit"],
    ] as const).map(([signal, edgeId, next]) => ({
      name: signal,
      setup: () => ({
        repo: completeRepo(),
        args: ["--focus", "PLAN-0001", "--current", "followup-triage", "--signal", "implementation-verified", "--signal", signal],
      }),
      edgeId,
      next,
    })),
    {
      name: "wont-do task remains non-runnable",
      setup: () => ({
        repo: completeRepo(["wont-do"]),
        args: ["--focus", "PLAN-0001", "--current", "task-graph", "--signal", "implementation-verified"],
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
        args: ["--focus", "PLAN-0001", "--current", "implementation", "--signal", "implementation-verified", "--signal", "spec-gap"],
      }),
      edgeId: "implementation-to-briefing",
      next: "briefing",
    },
    {
      name: "exit audit retry",
      setup: () => ({
        repo: completeRepo(),
        args: ["--focus", "PLAN-0001", "--current", "exit-audit", "--signal", "implementation-verified", "--signal", "followup-terminal"],
      }),
      edgeId: "exit-audit-retry",
      next: "exit-audit",
    },
    {
      name: "terminal re-entry",
      setup: () => ({ repo: completeRepo(), args: ["--focus", "PLAN-0001", "--current", "complete"] }),
      edgeId: null,
      next: "complete",
      status: "terminal",
    },
    {
      name: "custom graph",
      setup: () => {
        const repo = tempRepo();
        const graph = graphFile(repo).replace("cli-fixture", "custom-fixture");
        return { repo, graph, args: ["--current", "start", "--signal", "advance"] };
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
  const repo = tempRepo();
  const graph = graphFile(repo);
  const ordinaryResult = runSource(repo, ["--graph", graph, "--signal", "advance", "--json"]);
  const explainedResult = runSource(repo, ["--graph", graph, "--signal", "advance", "--explain", "--json"]);
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
  fs.writeFileSync(graph, `schemaVersion: 2\nid: cli-fixture\nentry: start\nconditions: {}\nnodes: { start: { kind: terminal } }\nedges: []\n`, "utf8");

  const definitionOnly = runInspect(repo, ["--graph", graph, "--format", "json"]);
  assert.equal(definitionOnly.status, 0, definitionOnly.stderr);
  const inspected = JSON.parse(definitionOnly.stdout);
  assert.deepEqual(Object.keys(inspected), ["definition"]);

  const withState = runInspect(repo, [
    "--graph", graph, "--format", "json", "--cwd", repo, "--focus", "PLAN-0001",
  ]);
  assert.equal(withState.status, 0, withState.stderr);
  const selected = JSON.parse(withState.stdout);
  assert.ok(selected.definition);
  assert.ok(selected.state);
  assert.ok(selected.artifactGraph);
  assert.ok(selected.taskGraph);
  assert.deepEqual(Object.keys(selected.state), [
    "schemaVersion", "graphId", "cwd", "taskDir", "focus", "gates", "signals", "blockers", "hardBlockers",
  ]);
  assert.equal(selected.artifactGraph.nodes.some((node: { id: string }) => node.id === "PLAN-0001"), true);
  assert.equal(selected.artifactGraph.edges.some((edge: { relation: string; kind: string }) => (
    edge.relation === "derives-from" && edge.kind === "lineage"
  )), true);
  assert.deepEqual(selected.taskGraph.nodes[0], {
    id: "TASK-0001",
    path: "docs/tasks/0001-task.md",
    status: "done",
    dependsOn: [],
    blocks: [],
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
    [["--task-dir", "docs/tasks"], /mermaid.*task-dir|task-dir.*mermaid/i],
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
  const repo = completeRepo(["done", "todo"]);
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
    "--plan", "docs/plans/0001-graph.md", "--cwd", repo, "--json",
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
    "--focus", "PLAN-0001",
    "--cwd", repo,
    "--json",
  ]);
  assert.equal(routeResult.status, 0, routeResult.stderr);
  const route = JSON.parse(routeResult.stdout);
  assert.equal(route.status, "edge");
  assert.equal(route.next, "implementation");
  assert.equal(route.blockers.some((blocker: string) => blocker.startsWith("broken-relation:")), false);
  assert.deepEqual(route.taskGraph.edges, [{ from: "TASK-0001", to: "TASK-0002" }]);
  assert.deepEqual(route.taskGraph.runnable, ["TASK-0002"]);
});
