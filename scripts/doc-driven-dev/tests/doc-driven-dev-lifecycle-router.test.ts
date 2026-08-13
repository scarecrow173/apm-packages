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

test("follow-up and exit gates require their typed signals", () => {
  const repo = repoWithApprovedArtifactChain();
  const withoutSignals = probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    signals: [],
  });
  const withSignals = probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    signals: ["followups-classified", "exit-audit-pass"],
  });
  assert.equal(withoutSignals.gates["followup-triage"].status, "blocked");
  assert.equal(withoutSignals.gates["exit-audit"].status, "blocked");
  assert.equal(withSignals.gates["followup-triage"].status, "pass");
  assert.equal(withSignals.gates["exit-audit"].status, "pass");
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
