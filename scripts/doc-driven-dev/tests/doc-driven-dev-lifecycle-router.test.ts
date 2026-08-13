import type {
  LifecycleSignal,
  LifecycleState,
} from "../src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_state";
import type {
  LifecycleNodeId,
  LifecycleRoute,
} from "../src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_router";
import type {
  LifecycleGraph,
} from "../src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_graph";
import type {
  TaskStatus,
} from "../src/skills/doc-driven-dev-lifecycle/scripts/lib/task_graph";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const matter = require("gray-matter");
const {
  probeLifecycleState,
} = require("../src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_state.ts");
const {
  parseLifecycleGraph,
} = require("../src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_graph.ts");
const {
  routeLifecycle,
} = require("../src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_router.ts");

function loadDistributedGraph(): LifecycleGraph {
  const file = path.resolve(
    __dirname,
    "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/graphs/lifecycle.yaml",
  );
  return parseLifecycleGraph(fs.readFileSync(file, "utf8"));
}

function writeArtifact(
  repo: string,
  relativePath: string,
  data: Record<string, unknown>,
  body: string,
): void {
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

function repoWithApprovedArtifactChain(taskStatus: TaskStatus = "todo"): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-state-"));
  for (const dir of [
    "docs/ideas", "docs/discovery", "docs/specs", "docs/designs", "docs/plans",
    "docs/tasks", "docs/adr", "docs/impl/ir", "docs/impl/exp",
  ]) {
    fs.mkdirSync(path.join(repo, dir), { recursive: true });
    fs.writeFileSync(path.join(repo, dir, "README.md"), `# ${dir}\n`, "utf8");
  }
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "approved", title: "Graph",
  }, "# Graph\n\n## Acceptance Criteria\n\n- [ ] Routes deterministically\n");
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "accepted", title: "Graph ADR",
  }, "# Graph ADR\n\n## Considered Options\n\n### Package-local runtime\n\n### External runtime\n");
  writeArtifact(repo, "docs/designs/0001-graph.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Graph Design",
    relations: {
      "derives-from": ["docs/specs/0001-graph.md", "docs/adr/0001-graph.md"],
    },
  }, "# Graph Design\n");
  writeArtifact(repo, "docs/plans/0001-graph-lifecycle.md", {
    id: "PLAN-0001", type: "plan", status: "approved", title: "Graph Plan",
    relations: { "derives-from": ["docs/designs/0001-graph.md"] },
  }, "# Graph Plan\n");
  writeArtifact(repo, "docs/tasks/0001-route.md", {
    id: "TASK-0001", type: "task", status: taskStatus, title: "Route",
    relations: { implements: ["docs/plans/0001-graph-lifecycle.md"] },
  }, "# Route\n\n## Verification\n\n- [ ] node --test\n");
  return repo;
}

function repoWithIdRelationArtifactChain(taskStatus: TaskStatus = "todo"): string {
  const repo = repoWithApprovedArtifactChain(taskStatus);
  writeArtifact(repo, "docs/designs/0001-graph.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Graph Design",
    relations: {
      "derives-from": ["SPEC-0001", "ADR-0001"],
    },
  }, "# Graph Design\n");
  writeArtifact(repo, "docs/plans/0001-graph-lifecycle.md", {
    id: "PLAN-0001", type: "plan", status: "approved", title: "Graph Plan",
    relations: { "derives-from": ["DESIGN-0001"] },
  }, "# Graph Plan\n");
  return repo;
}

function repoWithTwoPlans(): string {
  const repo = repoWithApprovedArtifactChain();
  writeArtifact(repo, "docs/plans/0002-other.md", {
    id: "PLAN-0002", type: "plan", status: "approved", title: "Other Plan",
  }, "# Other Plan\n");
  return repo;
}

function stateWithDoneTasks(signals: LifecycleSignal[]): LifecycleState {
  const repo = repoWithApprovedArtifactChain("done");
  return probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    signals,
  });
}

function routeFixture(input: {
  current: LifecycleNodeId;
  taskStatuses?: TaskStatus[];
  signals?: LifecycleSignal[];
}): LifecycleRoute {
  const statuses = input.taskStatuses ?? ["done"];
  const repo = repoWithApprovedArtifactChain(statuses[0]);
  for (let index = 1; index < statuses.length; index += 1) {
    writeArtifact(repo, `docs/tasks/${String(index + 1).padStart(4, "0")}-route.md`, {
      id: `TASK-${String(index + 1).padStart(4, "0")}`,
      type: "task",
      status: statuses[index],
      title: `Route ${index + 1}`,
      relations: { implements: ["docs/plans/0001-graph-lifecycle.md"] },
    }, `# Route ${index + 1}\n\n## Verification\n\n- [ ] node --test\n`);
  }
  const state = probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    signals: input.signals ?? [],
  });
  return routeLifecycle({ current: input.current, graph: loadDistributedGraph(), state });
}

function routeCompiledCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [
    path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/scripts/route_lifecycle.js"),
    "--cwd", cwd,
    ...args,
  ], { cwd, encoding: "utf8", windowsHide: true });
}

function routeSourceCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [
    path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs"),
    path.resolve(__dirname, "../src/skills/doc-driven-dev-lifecycle/scripts/route_lifecycle.ts"),
    "--cwd", cwd,
    ...args,
  ], { cwd, encoding: "utf8", windowsHide: true });
}

function writeCustomLifecycleGraph(repo: string): string {
  const graph = path.join(repo, "custom-lifecycle.yaml");
  fs.writeFileSync(graph, `
schemaVersion: 1
entry: custom-node
nodes:
  custom-node: { kind: action, delegate: custom-handler, audits: [], requiresGates: [] }
  complete: { kind: terminal, delegate: null, audits: [], requiresGates: [] }
edges:
  - { id: custom-to-complete, from: custom-node, to: complete, when: migration-requested }
`, "utf8");
  return graph;
}

test("probe requires focus when multiple active artifact chains exist", () => {
  const repo = repoWithTwoPlans();
  const state = probeLifecycleState({ cwd: repo, focus: [], signals: [] });
  assert.deepEqual(state.blockers, ["focus-required"]);
});

test("approved focused plan with valid tasks reaches task graph gate", () => {
  const repo = repoWithApprovedArtifactChain();
  const state = probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    signals: [],
  });
  assert.equal(state.gates.briefing.status, "pass");
  assert.equal(state.gates.design.status, "pass");
  assert.equal(state.gates.planning.status, "pass");
  assert.deepEqual(state.blockers, []);
});

test("raw ID relations resolve the focused plan through design and planning", () => {
  const repo = repoWithIdRelationArtifactChain("done");
  const state = probeLifecycleState({ cwd: repo, focus: ["PLAN-0001"], signals: [] });
  const design = state.artifacts.find((artifact) => artifact.id === "DESIGN-0001");
  const plan = state.artifacts.find((artifact) => artifact.id === "PLAN-0001");
  assert.ok(design?.relations["derives-from"]?.includes("SPEC-0001"));
  assert.ok(design?.relations["derives-from"]?.includes("ADR-0001"));
  assert.ok(plan?.relations["derives-from"]?.includes("DESIGN-0001"));
  assert.equal(state.gates.design.status, "pass");
  assert.equal(state.gates.planning.status, "pass");

  const route = routeLifecycle({ current: "planning", graph: loadDistributedGraph(), state });
  assert.equal(route.next, "task-graph");
  assert.equal(route.taskGraph?.plan, "docs/plans/0001-graph-lifecycle.md");
});

test("relates-to cannot select an unrelated plan for a focused design", () => {
  const repo = repoWithApprovedArtifactChain();
  fs.rmSync(path.join(repo, "docs/plans/0001-graph-lifecycle.md"));
  fs.rmSync(path.join(repo, "docs/tasks/0001-route.md"));
  writeArtifact(repo, "docs/designs/0001-graph.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Graph Design",
    relations: {
      "derives-from": ["SPEC-0001", "ADR-0001"],
      "relates-to": ["UNRELATED-PLAN"],
    },
  }, "# Graph Design\n");
  writeArtifact(repo, "docs/plans/0002-unrelated.md", {
    id: "UNRELATED-PLAN", type: "plan", status: "approved", title: "Unrelated Plan",
    relations: { "relates-to": ["DESIGN-0001"] },
  }, "# Unrelated Plan\n");
  writeArtifact(repo, "docs/tasks/0002-unrelated.md", {
    id: "TASK-0002", type: "task", status: "todo", title: "Unrelated Task",
    relations: { implements: ["docs/plans/0002-unrelated.md"] },
  }, "# Unrelated Task\n\n## Verification\n\n- [ ] node --test\n");

  const state = probeLifecycleState({ cwd: repo, focus: ["DESIGN-0001"], signals: [] });
  assert.notEqual(state.gates.planning.status, "pass");
  const route = routeLifecycle({ current: "planning", graph: loadDistributedGraph(), state });
  assert.equal(route.taskGraph, null);
});

test("implementation evidence remains a signal-backed gate", () => {
  const withoutEvidence = stateWithDoneTasks([]);
  const withEvidence = stateWithDoneTasks(["implementation-verified"]);
  assert.equal(withoutEvidence.gates.implementation.status, "blocked");
  assert.equal(withEvidence.gates.implementation.status, "pass");
});

test("missing bootstrap index blocks bootstrap", () => {
  const repo = repoWithApprovedArtifactChain();
  fs.rmSync(path.join(repo, "docs/plans/README.md"));
  const state = probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    signals: [],
  });
  assert.equal(state.gates.bootstrap.status, "fail");
  assert.ok(state.blockers.includes("bootstrap-incomplete"));
});

test("empty repositories leave briefing applicable without a focus blocker", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-empty-"));
  const state = probeLifecycleState({ cwd: repo, focus: [], signals: [] });
  assert.deepEqual(state.blockers, ["bootstrap-incomplete"]);
  assert.notEqual(state.gates.briefing.status, "blocked");
});

test("broken local relations block while external references remain evidence", () => {
  const repo = repoWithApprovedArtifactChain();
  writeArtifact(repo, "docs/designs/0001-graph.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Graph Design",
    relations: {
      "derives-from": [
        "docs/specs/0001-graph.md",
        "docs/adr/0001-graph.md",
        "docs/adr/missing.md",
        "https://example.test/evidence",
      ],
    },
  }, "# Graph Design\n");
  const state = probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    signals: [],
  });
  assert.ok(state.blockers.some((blocker: string) => blocker.startsWith("broken-relation:")));
  assert.equal(state.blockers.some((blocker: string) => blocker.includes("https://example.test")), false);
});

test("task graph issues block planning and surface a routing blocker", () => {
  const repo = repoWithApprovedArtifactChain();
  writeArtifact(repo, "docs/tasks/0001-route.md", {
    id: "TASK-0001", type: "task", status: "todo", title: "Route",
    relations: {
      implements: ["docs/plans/0001-graph-lifecycle.md"],
      "depends-on": ["TASK-9999"],
    },
  }, "# Route\n\n## Verification\n\n- [ ] node --test\n");
  const state = probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    signals: [],
  });
  assert.equal(state.gates.planning.status, "blocked");
  assert.ok(state.gates.planning.reasons.includes("task-graph:missing-task-reference"));
  assert.ok(state.blockers.includes("task-graph-invalid"));
});

test("ambiguous focused relation chains require explicit focus", () => {
  const repo = repoWithApprovedArtifactChain();
  writeArtifact(repo, "docs/designs/0002-other.md", {
    id: "DESIGN-0002", type: "design", status: "approved", title: "Other Design",
    relations: {
      "derives-from": ["docs/specs/0001-graph.md", "docs/adr/0001-graph.md"],
    },
  }, "# Other Design\n");
  writeArtifact(repo, "docs/plans/0002-other.md", {
    id: "PLAN-0002", type: "plan", status: "approved", title: "Other Plan",
    relations: { "derives-from": ["docs/designs/0002-other.md"] },
  }, "# Other Plan\n");
  writeArtifact(repo, "docs/tasks/0002-other.md", {
    id: "TASK-0002", type: "task", status: "todo", title: "Other Task",
    relations: { implements: ["docs/plans/0002-other.md"] },
  }, "# Other Task\n\n## Verification\n\n- [ ] node --test\n");
  const state = probeLifecycleState({
    cwd: repo,
    focus: ["docs/specs/0001-graph.md"],
    signals: [],
  });
  assert.ok(state.blockers.includes("focus-required"));
});

test("follow-up and exit gates require one typed classification", () => {
  const repo = repoWithApprovedArtifactChain();
  const withoutSignals = probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    signals: [],
  });
  const withSignals = probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    signals: ["followup-bug-fix", "exit-audit-pass"],
  });
  assert.equal(withoutSignals.gates["followup-triage"].status, "blocked");
  assert.deepEqual(withoutSignals.gates["followup-triage"].reasons, ["followups-unclassified"]);
  assert.equal(withoutSignals.gates["exit-audit"].status, "blocked");
  assert.equal(withSignals.gates["followup-triage"].status, "pass");
  assert.equal(withSignals.gates["exit-audit"].status, "pass");
});

test("follow-up classifications route through their declared graph destinations", () => {
  const routes = [
    ["followup-bug-fix", "planning", "followup-triage-to-planning"],
    ["followup-decision-briefing", "briefing", "followup-triage-to-briefing"],
    ["followup-decision-design", "design", "followup-triage-to-design"],
    ["followup-new-feature", "briefing", "followup-triage-new-feature"],
    ["followup-doc-only", "exit-audit", "followup-triage-doc-only"],
    ["followup-terminal", "exit-audit", "followup-triage-terminal"],
  ] as const;
  for (const [signal, destination, edgeId] of routes) {
    const route = routeFixture({
      current: "followup-triage",
      signals: ["implementation-verified", signal],
    });
    assert.equal(route.next, destination, signal);
    assert.equal(route.reasonCode, signal, signal);
    assert.equal(route.edgeId, edgeId, signal);
  }
});

test("follow-up terminal routing treats wont-do tasks as lifecycle-resolved", () => {
  const route = routeFixture({
    current: "followup-triage",
    taskStatuses: ["done", "wont-do"],
    signals: ["implementation-verified", "followup-terminal"],
  });
  assert.equal(route.next, "exit-audit");
  assert.equal(route.reasonCode, "followup-terminal");
  assert.equal(route.edgeId, "followup-triage-terminal");
});

test("typed follow-up routing repairs a failing upstream gate before exit audit", () => {
  const state = stateWithDoneTasks(["implementation-verified", "followup-doc-only"]);
  state.gates.planning = { status: "fail", reasons: ["planning-incomplete"] };
  const route = routeLifecycle({ current: "followup-triage", graph: loadDistributedGraph(), state });
  assert.equal(route.next, "planning");
  assert.equal(route.reasonCode, "planning-incomplete");
  assert.equal(route.edgeId, "followup-triage-to-planning-repair");
  assert.notEqual(route.next, "exit-audit");
});

test("follow-up triage retries when an upstream recovery edge is unavailable", () => {
  const state = stateWithDoneTasks(["implementation-verified", "followup-doc-only"]);
  state.gates.planning = { status: "fail", reasons: ["planning-incomplete"] };
  const graph = loadDistributedGraph();
  graph.edges = graph.edges.filter((edge) => edge.id !== "followup-triage-to-planning-repair");
  const route = routeLifecycle({ current: "followup-triage", graph, state });
  assert.equal(route.next, "followup-triage");
  assert.equal(route.reasonCode, "followups-unclassified");
  assert.equal(route.edgeId, "followup-triage-retry");
  assert.notEqual(route.next, "exit-audit");
});

test("typed follow-up treats a missing upstream gate as a regression", () => {
  const state = stateWithDoneTasks([
    "implementation-verified",
    "followup-doc-only",
    "exit-audit-pass",
  ]);
  delete state.gates.planning;
  const route = routeLifecycle({ current: "followup-triage", graph: loadDistributedGraph(), state });
  assert.equal(route.next, "planning");
  assert.equal(route.reasonCode, "planning-incomplete");
  assert.equal(route.edgeId, "followup-triage-to-planning-repair");
  assert.notEqual(route.next, "exit-audit");
});

test("exit audit repairs a regressed upstream gate before completion", () => {
  const state = stateWithDoneTasks([
    "implementation-verified",
    "followup-terminal",
    "exit-audit-pass",
    "lifecycle-complete",
  ]);
  state.gates.planning = { status: "fail", reasons: ["planning-incomplete"] };
  const route = routeLifecycle({ current: "exit-audit", graph: loadDistributedGraph(), state });
  assert.equal(route.next, "planning");
  assert.equal(route.reasonCode, "planning-incomplete");
  assert.equal(route.edgeId, "exit-audit-to-planning-repair");
  assert.notEqual(route.next, "complete");
});

test("exit audit retries when a prerequisite recovery edge is unavailable", () => {
  const state = stateWithDoneTasks(["implementation-verified", "followup-terminal", "exit-audit-pass"]);
  state.gates.planning = { status: "fail", reasons: ["planning-incomplete"] };
  const graph = loadDistributedGraph();
  graph.edges = graph.edges.filter((edge) => edge.id !== "exit-audit-to-planning-repair");
  const route = routeLifecycle({ current: "exit-audit", graph, state });
  assert.equal(route.next, "exit-audit");
  assert.equal(route.reasonCode, "exit-audit-required");
  assert.equal(route.edgeId, "exit-audit-retry");
  assert.notEqual(route.next, "complete");
});

test("follow-up triage retries when classification is omitted or conflicting", () => {
  const omitted = routeFixture({
    current: "followup-triage",
    signals: ["implementation-verified"],
  });
  assert.equal(omitted.next, "followup-triage");
  assert.equal(omitted.reasonCode, "followups-unclassified");

  const conflictState = stateWithDoneTasks([
    "implementation-verified",
    "followup-bug-fix",
    "followup-terminal",
  ]);
  assert.equal(conflictState.gates["followup-triage"].status, "blocked");
  assert.deepEqual(conflictState.gates["followup-triage"].reasons, ["followups-conflicting"]);
  const conflict = routeLifecycle({ current: "followup-triage", graph: loadDistributedGraph(), state: conflictState });
  assert.equal(conflict.next, "followup-triage");
  assert.notEqual(conflict.next, "exit-audit");
});

test("duplicate artifact IDs fail closed even when focus uses a path", () => {
  const repo = repoWithApprovedArtifactChain();
  writeArtifact(repo, "docs/plans/0002-duplicate.md", {
    id: "PLAN-0001", type: "plan", status: "approved", title: "Duplicate Plan",
    relations: { "derives-from": ["docs/designs/0001-graph.md"] },
  }, "# Duplicate Plan\n");
  const state = probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    signals: [],
  });
  assert.ok(state.blockers.includes("duplicate-id"));
  assert.ok(state.blockers.includes("focus-required"));
});

test("custom task directory is used by the planning gate", () => {
  const repo = repoWithApprovedArtifactChain();
  writeArtifact(repo, "docs/tasks/0001-route.md", {
    id: "TASK-DEFAULT", type: "task", status: "todo", title: "Default Task",
    relations: {
      implements: ["docs/plans/0001-graph-lifecycle.md"],
      "depends-on": ["TASK-9999"],
    },
  }, "# Default Task\n\n## Verification\n\n- [ ] node --test\n");
  writeArtifact(repo, "docs/work-items/0001-route.md", {
    id: "TASK-0001", type: "task", status: "todo", title: "Custom Task",
    relations: { implements: ["docs/plans/0001-graph-lifecycle.md"] },
  }, "# Custom Task\n\n## Verification\n\n- [ ] node --test\n");
  const state = probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    taskDir: "docs/work-items",
    signals: [],
  });
  assert.equal(state.gates.planning.status, "pass");
  assert.equal(state.blockers.includes("task-graph-invalid"), false);
  assert.ok(state.artifacts.some((artifact: { path: string }) => artifact.path === "docs/work-items/0001-route.md"));
});

test("nested custom task directory does not duplicate canonical artifacts", () => {
  const repo = repoWithApprovedArtifactChain();
  writeArtifact(repo, "docs/tasks/custom/0002-route.md", {
    id: "TASK-CUSTOM", type: "task", status: "todo", title: "Nested Custom Task",
    relations: { implements: ["docs/plans/0001-graph-lifecycle.md"] },
  }, "# Nested Custom Task\n\n## Verification\n\n- [ ] node --test\n");
  const state = probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    taskDir: "docs/tasks/custom",
    signals: [],
  });
  assert.equal(state.gates.planning.status, "pass");
  assert.equal(state.blockers.includes("duplicate-id"), false);
  assert.equal(state.blockers.includes("focus-required"), false);
  assert.equal(state.artifacts.filter((artifact: { path: string }) => artifact.path === "docs/tasks/custom/0002-route.md").length, 1);
});

test("router sends independent root tasks to implementation-flow", () => {
  const route = routeFixture({ current: "task-graph", taskStatuses: ["todo", "todo"] });
  assert.equal(route.next, "implementation");
  assert.equal(route.delegate, "implementation-flow");
  assert.deepEqual(route.taskGraph?.runnable, ["TASK-0001", "TASK-0002"]);
});

test("router retries an incomplete implementation gate", () => {
  const route = routeFixture({ current: "implementation", taskStatuses: ["in-progress"] });
  assert.equal(route.next, "implementation");
  assert.equal(route.reasonCode, "implementation-incomplete");
  assert.equal(route.edgeId, "implementation-retry");
});

test("router preserves typed migration and task-graph retries", () => {
  const migration = routeFixture({ current: "migration", signals: ["migration-incomplete"] });
  assert.equal(migration.next, "migration");
  assert.equal(migration.reasonCode, "migration-incomplete");
  const taskGraph = routeFixture({ current: "task-graph", taskStatuses: ["done"], signals: ["task-graph-retry"] });
  assert.equal(taskGraph.next, "task-graph");
  assert.equal(taskGraph.reasonCode, "task-graph-retry");
  assert.equal(taskGraph.edgeId, "task-graph-retry");
});

test("router never invents an edge for the terminal node", () => {
  const route = routeFixture({ current: "complete", taskStatuses: ["done"] });
  assert.equal(route.next, "complete");
  assert.equal(route.reasonCode, "lifecycle-complete");
  assert.equal(route.edgeId, null);
});

test("custom terminal nodes are idempotently complete", () => {
  const graph = parseLifecycleGraph(`
schemaVersion: 1
entry: custom-start
nodes:
  custom-start: { kind: action, delegate: custom-handler, audits: [], requiresGates: [] }
  custom-end: { kind: terminal, delegate: null, audits: [], requiresGates: [] }
edges:
  - { id: custom-to-end, from: custom-start, to: custom-end, when: migration-requested }
`);
  const state = stateWithDoneTasks([]);
  for (const gate of Object.values(state.gates)) gate.status = "pass";

  const entered = routeLifecycle({
    current: "custom-start",
    graph,
    state: { ...state, signals: ["migration-requested"] },
  });
  assert.equal(entered.next, "custom-end");
  assert.equal(entered.edgeId, "custom-to-end");

  const route = routeLifecycle({ current: "custom-end", graph, state });
  assert.equal(route.current, "custom-end");
  assert.equal(route.next, "custom-end");
  assert.equal(route.edgeId, null);
  assert.equal(route.reasonCode, "lifecycle-complete");
});

test("focus-required routes never authorize delegation", () => {
  const repo = repoWithTwoPlans();
  const state = probeLifecycleState({ cwd: repo, focus: [], signals: [] });
  for (const current of ["briefing", "implementation"] as const) {
    const route = routeLifecycle({ current, graph: loadDistributedGraph(), state });
    assert.equal(route.reasonCode, "focus-required");
    assert.equal(route.edgeId, null);
    assert.equal(route.delegate, null);
    assert.equal(route.taskGraph, null);
  }
});

test("focus lineage ignores contextual links to an unrelated plan", () => {
  const repo = repoWithApprovedArtifactChain();
  writeArtifact(repo, "docs/plans/0002-other.md", {
    id: "PLAN-0002", type: "plan", status: "approved", title: "Other Plan",
  }, "# Other Plan\n");
  const state: LifecycleState = {
    schemaVersion: 1,
    cwd: repo,
    focus: ["docs/designs/0001-graph.md"],
    artifacts: [
      {
        id: "DESIGN-0001",
        path: "docs/designs/0001-graph.md",
        type: "design",
        status: "approved",
        relations: {
          related: ["docs/plans/0002-other.md"],
          references: ["docs/plans/0002-other.md"],
          source: ["docs/plans/0002-other.md"],
        },
      },
      {
        id: "PLAN-0002",
        path: "docs/plans/0002-other.md",
        type: "plan",
        status: "approved",
        relations: {},
      },
    ],
    gates: {
      bootstrap: { status: "pass", reasons: [] },
      briefing: { status: "pass", reasons: [] },
      design: { status: "pass", reasons: [] },
      planning: { status: "pass", reasons: [] },
      implementation: { status: "pass", reasons: [] },
      "followup-triage": { status: "pass", reasons: [] },
      "exit-audit": { status: "pass", reasons: [] },
    },
    signals: [],
    blockers: [],
  };
  const route = routeLifecycle({ current: "task-graph", graph: loadDistributedGraph(), state });
  assert.equal(route.taskGraph, null);
  assert.equal(route.reasonCode, "task-graph-retry");
  assert.equal(route.edgeId, "task-graph-retry");
});

test("blocked task-graph state falls back to its declared retry edge", () => {
  const route = routeFixture({ current: "task-graph", taskStatuses: ["done"] });
  assert.equal(route.next, "task-graph");
  assert.equal(route.reasonCode, "task-graph-retry");
  assert.equal(route.edgeId, "task-graph-retry");
});

test("router uses typed upstream loopbacks before forward gates", () => {
  const specGap = routeFixture({ current: "implementation", signals: ["spec-gap"] });
  const designGap = routeFixture({ current: "implementation", signals: ["design-gap"] });
  assert.equal(specGap.next, "briefing");
  assert.equal(designGap.next, "design");
});

test("router resumes from documents without persisted runtime state", () => {
  const repo = repoWithApprovedArtifactChain();
  const route = routeCompiledCli([
    "--current", "probe",
    "--focus", "docs/plans/0001-graph-lifecycle.md",
    "--json",
  ], repo);
  assert.equal(route.status, 0);
  assert.equal(JSON.parse(route.stdout).next, "implementation");
});

test("source CLI locates the package graph without an explicit graph path", () => {
  const repo = repoWithApprovedArtifactChain();
  const route = routeSourceCli([
    "--current", "probe",
    "--focus", "docs/plans/0001-graph-lifecycle.md",
    "--json",
  ], repo);
  assert.equal(route.status, 0);
  assert.equal(JSON.parse(route.stdout).next, "implementation");
});

test("source CLI validates current against the selected YAML graph", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-cli-"));
  const graph = writeCustomLifecycleGraph(repo);
  const route = routeSourceCli([
    "--graph", graph,
    "--current", "custom-node",
    "--signal", "migration-requested",
    "--json",
  ], repo);
  assert.equal(route.status, 0, route.stderr);
  const result = JSON.parse(route.stdout) as { next: string; edgeId: string; reasonCode: string };
  assert.equal(result.next, "complete");
  assert.equal(result.edgeId, "custom-to-complete");
  assert.equal(result.reasonCode, "migration-requested");
});

test("source CLI rejects a current node absent from the selected YAML graph", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-cli-"));
  const graph = writeCustomLifecycleGraph(repo);
  const route = routeSourceCli([
    "--graph", graph,
    "--current", "not-declared",
  ], repo);
  assert.equal(route.status, 1);
  assert.match(route.stderr, /Unknown lifecycle node: not-declared \(not declared in lifecycle graph\)/);
});
