import type {
  GraphDefinition,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";
import type {
  GraphState,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_state";
import type {
  TaskStatus,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/task_graph";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const matter = require("gray-matter");
const {
  loadGraphDefinition,
} = require("../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition.ts");
const {
  projectGraphState,
} = require("../src/skills/doc-driven-dev-graph/scripts/lib/graph_state.ts");
const {
  evaluateRouteDecision,
  routeGraph,
} = require("../src/skills/doc-driven-dev-graph/scripts/lib/graph_router.ts");

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

function fixtureRepo(statuses: TaskStatus[] = ["todo"], dependsOn: string[][] = []): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "doc-driven-dev-graph-routing-"));
  for (const directory of [
    "docs/ideas", "docs/discovery", "docs/specs", "docs/designs", "docs/plans",
    "docs/tasks", "docs/adr", "docs/impl/ir", "docs/impl/exp",
  ]) {
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
  statuses.forEach((status, index) => {
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

function graphDefinition(): GraphDefinition {
  return loadGraphDefinition(path.resolve(
    __dirname,
    "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml",
  ));
}

function stateFor(repo: string, signals: string[] = []): GraphState {
  return projectGraphState({
    cwd: repo,
    focus: ["PLAN-0001"],
    signals,
  });
}

test("projects the selected plan and its task graph", () => {
  const state = stateFor(fixtureRepo(["todo", "done"], [[], []]));
  assert.equal(state.taskGraph?.plan, "docs/plans/0001-graph.md");
  assert.deepEqual(state.taskGraph?.runnable, ["TASK-0001"]);
  assert.equal(state.gates.planning.status, "pass");
});

test("uses the planning gate rather than a caller completion signal", () => {
  const definition = graphDefinition();
  const state = stateFor(fixtureRepo(), ["planning-complete"]);
  state.gates.planning = { status: "fail", reasons: ["plan-status"] };
  const route = routeGraph({ current: "planning", definition, state });
  assert.notEqual(route.next, "task-graph");
  assert.equal(route.edgeId, "planning-retry");
  assert.equal(route.condition, "planning-not-pass");
});

test("routes runnable tasks to the implementation delegate", () => {
  const definition = graphDefinition();
  const state = stateFor(fixtureRepo(), []);
  const route = routeGraph({ current: "task-graph", definition, state });
  assert.equal(route.next, "implementation");
  assert.equal(route.delegate, "implementation-flow");
  assert.deepEqual(route.taskGraph?.runnable, ["TASK-0001"]);
});

test("resumes an active task whose predecessors are done despite downstream waits", () => {
  const definition = graphDefinition();
  const state = stateFor(fixtureRepo(
    ["done", "in-progress", "todo"],
    [[], ["TASK-0001"], ["TASK-0002"]],
  ));
  const route = routeGraph({ current: "task-graph", definition, state });

  assert.equal(route.edgeId, "task-graph-to-active-implementation");
  assert.equal(route.next, "implementation");
  assert.equal(route.delegate, "implementation-flow");
  assert.deepEqual(route.taskGraph?.active, ["TASK-0002"]);
  assert.deepEqual(route.taskGraph?.resumableActive, ["TASK-0002"]);
  assert.deepEqual(route.taskGraph?.blocked, [
    { id: "TASK-0003", reasons: ["depends-on:TASK-0002"] },
  ]);
});

test("prioritizes resumable active tasks over runnable tasks with one route edge", () => {
  const definition = graphDefinition();
  const state = stateFor(fixtureRepo(["in-progress", "todo"], [[], []]));
  const decision = evaluateRouteDecision({ current: "task-graph", definition, state });

  assert.equal(decision.route.edgeId, "task-graph-to-active-implementation");
  assert.deepEqual(decision.route.taskGraph?.active, ["TASK-0001"]);
  assert.deepEqual(decision.route.taskGraph?.resumableActive, ["TASK-0001"]);
  assert.deepEqual(decision.route.taskGraph?.runnable, ["TASK-0002"]);
  assert.equal(decision.explanation.selectedEdgeId, "task-graph-to-active-implementation");
  assert.equal(decision.explanation.evaluatedEdges.filter((edge) => edge.matched).length, 1);
});

test("does not resume an active task when the task graph is invalid", () => {
  const definition = graphDefinition();
  const state = stateFor(fixtureRepo(
    ["in-progress", "in-progress"],
    [["TASK-0002"], ["TASK-0001"]],
  ));
  const route = routeGraph({ current: "task-graph", definition, state });

  assert.ok((state.taskGraph?.issues.length ?? 0) > 0);
  assert.deepEqual(route.taskGraph?.resumableActive, []);
  assert.equal(route.edgeId, "task-graph-to-planning");
  assert.notEqual(route.edgeId, "task-graph-to-active-implementation");
});

test("resumes an active task alongside an unrelated blocked task", () => {
  const definition = graphDefinition();
  const state = stateFor(fixtureRepo(["in-progress", "blocked"], [[], []]));
  const route = routeGraph({ current: "task-graph", definition, state });

  assert.equal(route.edgeId, "task-graph-to-active-implementation");
  assert.deepEqual(route.taskGraph?.resumableActive, ["TASK-0001"]);
  assert.deepEqual(route.taskGraph?.blocked, [
    { id: "TASK-0002", reasons: ["status:blocked"] },
  ]);
});

test("passes sorted active tasks and dependency edges while only ready active tasks are resumable", () => {
  const definition = graphDefinition();
  const state = stateFor(fixtureRepo(
    ["in-progress", "in-progress", "in-progress"],
    [[], [], ["TASK-0001"]],
  ));
  const route = routeGraph({ current: "task-graph", definition, state });

  assert.equal(route.edgeId, "task-graph-to-active-implementation");
  assert.deepEqual(route.taskGraph?.active, ["TASK-0001", "TASK-0002", "TASK-0003"]);
  assert.deepEqual(route.taskGraph?.resumableActive, ["TASK-0001", "TASK-0002"]);
  assert.deepEqual(route.taskGraph?.edges, [{ from: "TASK-0001", to: "TASK-0003" }]);
});

test("fails closed when no active task has resolved predecessors", () => {
  const definition = graphDefinition();
  const state = stateFor(fixtureRepo(["todo", "in-progress"], [[], ["TASK-0001"]]));
  state.taskGraph!.runnable = [];
  const route = routeGraph({ current: "task-graph", definition, state });

  assert.equal(route.status, "blocked");
  assert.equal(route.edgeId, null);
  assert.deepEqual(route.taskGraph?.active, ["TASK-0002"]);
  assert.deepEqual(route.taskGraph?.resumableActive, []);
});

test("keeps dependents blocked by wont-do predecessors while resolving completion", () => {
  const definition = graphDefinition();
  const repo = fixtureRepo(["wont-do", "todo"], [[], ["TASK-0001"]]);
  const state = stateFor(repo, ["implementation-verified"]);
  assert.deepEqual(state.taskGraph?.runnable, []);
  assert.deepEqual(state.taskGraph?.blocked, [
    { id: "TASK-0001", reasons: ["status:wont-do"] },
    { id: "TASK-0002", reasons: ["depends-on:TASK-0001"] },
  ]);
  assert.equal(state.gates.implementation.status, "blocked");

  const doneState = stateFor(fixtureRepo(["wont-do"]), ["implementation-verified"]);
  assert.equal(doneState.gates.implementation.status, "pass");
  const route = routeGraph({ current: "task-graph", definition, state: doneState });
  assert.equal(route.status, "blocked");
  assert.equal(route.next, "task-graph");
});

test("does not let implementation verification bypass an incomplete implementation gate", () => {
  const definition = graphDefinition();
  const state = stateFor(fixtureRepo(["todo"]), ["implementation-verified"]);
  const route = routeGraph({ current: "implementation", definition, state });
  assert.equal(state.gates.implementation.status, "blocked");
  assert.equal(route.edgeId, "implementation-retry");
  assert.equal(route.next, "implementation");
  assert.equal(route.condition, "implementation-not-pass");
});

test("exit-audit cannot complete when a required upstream gate regresses", () => {
  const definition = graphDefinition();
  const state = stateFor(fixtureRepo(["done"]), ["implementation-verified", "followup-terminal", "exit-audit-pass"]);
  state.gates.design = { status: "fail", reasons: ["design-status"] };
  const route = routeGraph({ current: "exit-audit", definition, state });
  assert.equal(route.status, "edge");
  assert.equal(route.next, "design");
  assert.equal(route.edgeId, "exit-audit-to-design-repair");
  assert.equal(route.condition, "design-not-pass");
});

test("fails closed at exit-audit when no declared prerequisite repair edge matches", () => {
  const definition = graphDefinition();
  definition.edges = definition.edges.filter((edge) => edge.id !== "exit-audit-to-design-repair");
  const state = stateFor(fixtureRepo(["done"]), ["implementation-verified", "followup-terminal", "exit-audit-pass"]);
  state.gates.design = { status: "fail", reasons: ["design-status"] };
  const route = routeGraph({ current: "exit-audit", definition, state });
  assert.equal(route.status, "blocked");
  assert.equal(route.next, "exit-audit");
  assert.equal(route.edgeId, null);
  assert.ok(route.blockers.includes("required-gate:design"));
});

test("blocks conflicting typed follow-ups instead of choosing a priority edge", () => {
  const definition = graphDefinition();
  const state = stateFor(fixtureRepo(["done"]), ["implementation-verified", "followup-bug-fix", "followup-terminal"]);
  const route = routeGraph({ current: "followup-triage", definition, state });
  assert.equal(route.status, "blocked");
  assert.equal(route.next, "followup-triage");
  assert.equal(route.edgeId, null);
  assert.ok(route.blockers.includes("followups-conflicting"));
});

test("does not let exit-audit pass bypass a fatal artifact graph blocker", () => {
  const definition = graphDefinition();
  const repo = fixtureRepo(["done"]);
  writeArtifact(repo, "docs/ideas/0001-broken.md", {
    id: "IDEA-0001", type: "idea", status: "draft", title: "Broken", relations: 42,
  }, "# Broken\n");
  const state = stateFor(repo, ["implementation-verified", "followup-terminal", "exit-audit-pass"]);
  const route = routeGraph({ current: "exit-audit", definition, state });
  assert.ok(state.hardBlockers.includes("artifact-graph"));
  assert.equal(route.status, "blocked");
  assert.equal(route.edgeId, null);
  assert.equal(route.next, "exit-audit");
});

test("exit-audit reaches complete when all declared prerequisites pass", () => {
  const definition = graphDefinition();
  const state = stateFor(fixtureRepo(["done"]), ["implementation-verified", "followup-terminal", "exit-audit-pass"]);
  const route = routeGraph({ current: "exit-audit", definition, state });
  assert.equal(route.status, "edge");
  assert.equal(route.edgeId, "exit-audit-to-complete");
  assert.equal(route.next, "complete");
  assert.deepEqual(route.blockers, []);
});
