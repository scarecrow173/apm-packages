import type {
  TaskGraphResult,
  TaskStatus,
} from "../src/skills/doc-driven-dev-lifecycle/scripts/lib/task_graph";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const matter = require("gray-matter");
const {
  buildTaskGraph,
} = require("../src/skills/doc-driven-dev-lifecycle/scripts/lib/task_graph.ts");

function writeTask(
  repo: string,
  id: string,
  input: { status: TaskStatus; dependsOn: string[] },
): void {
  const number = id.slice("TASK-".length);
  const file = path.join(repo, "docs/tasks", `${number}-task.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, matter.stringify("# Task\n\n## Verification\n\n- [ ] node --test\n", {
    id,
    type: "task",
    status: input.status,
    title: id,
    created: "2026-08-13",
    updated: "2026-08-13",
    owners: [],
    relations: {
      implements: ["docs/plans/0001-plan.md"],
      "depends-on": input.dependsOn,
      blocks: [],
    },
  }), "utf8");
}

function buildFixtureGraph(
  tasks: Record<string, { status: TaskStatus; dependsOn: string[] }>,
): TaskGraphResult {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-"));
  fs.mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/plans/0001-plan.md"), "# Plan\n", "utf8");
  for (const [id, input] of Object.entries(tasks)) writeTask(repo, id, input);
  return buildTaskGraph({ cwd: repo, plan: "docs/plans/0001-plan.md" });
}

test("buildTaskGraph returns parallel roots and a fan-in task", () => {
  const result = buildFixtureGraph({
    "TASK-0001": { status: "todo", dependsOn: [] },
    "TASK-0002": { status: "todo", dependsOn: [] },
    "TASK-0003": { status: "todo", dependsOn: ["TASK-0001", "TASK-0002"] },
  });
  assert.deepEqual(result.edges, [
    { from: "TASK-0001", to: "TASK-0003" },
    { from: "TASK-0002", to: "TASK-0003" },
  ]);
  assert.deepEqual(result.runnable, ["TASK-0001", "TASK-0002"]);
  assert.deepEqual(result.issues, []);
});

test("buildTaskGraph unlocks a dependent task only after every predecessor is done", () => {
  const result = buildFixtureGraph({
    "TASK-0001": { status: "done", dependsOn: [] },
    "TASK-0002": { status: "done", dependsOn: [] },
    "TASK-0003": { status: "todo", dependsOn: ["TASK-0001", "TASK-0002"] },
  });
  assert.deepEqual(result.runnable, ["TASK-0003"]);
});

test("buildTaskGraph fails closed on cycle and unresolved task reference", () => {
  const result = buildFixtureGraph({
    "TASK-0001": { status: "todo", dependsOn: ["TASK-0002"] },
    "TASK-0002": { status: "todo", dependsOn: ["TASK-0001", "TASK-9999"] },
  });
  assert.deepEqual(result.runnable, []);
  assert.deepEqual(result.issues.map((issue) => issue.code).sort(), [
    "missing-task-reference",
    "task-cycle",
  ]);
});
