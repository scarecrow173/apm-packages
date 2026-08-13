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

test("routes declared graph edges by satisfied conditions", () => {
  const definition = graphDefinition();
  const state = stateFor(fixtureRepo(), ["planning-complete"]);
  const route = routeGraph({ current: "planning", definition, state });
  assert.equal(route.next, "task-graph");
  assert.equal(route.edgeId, "planning-to-task-graph");
  assert.equal(route.condition, "planning-complete");
});

test("routes runnable tasks to the implementation delegate", () => {
  const definition = graphDefinition();
  const state = stateFor(fixtureRepo(), []);
  const route = routeGraph({ current: "task-graph", definition, state });
  assert.equal(route.next, "implementation");
  assert.equal(route.delegate, "implementation-flow");
  assert.deepEqual(route.taskGraph?.runnable, ["TASK-0001"]);
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

test("exit-audit cannot complete when a required upstream gate regresses", () => {
  const definition = graphDefinition();
  const state = stateFor(fixtureRepo(["done"]), ["implementation-verified", "followup-terminal", "exit-audit-pass"]);
  state.gates.design = { status: "fail", reasons: ["design-status"] };
  const route = routeGraph({ current: "exit-audit", definition, state });
  assert.equal(route.status, "blocked");
  assert.equal(route.next, "exit-audit");
  assert.equal(route.edgeId, null);
  assert.equal(route.condition, "blocked");
  assert.ok(route.blockers.includes("required-gate:design"));
  assert.ok(route.blockers.includes("required-gate:design:design-status"));
  assert.notEqual(route.next, "complete");
});
