import type {
  TaskGraphResult,
  TaskStatus,
} from "../src/skills/doc-driven-dev-lifecycle/scripts/lib/task_graph";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const matter = require("gray-matter");
const {
  buildTaskGraph,
} = require("../src/skills/doc-driven-dev-lifecycle/scripts/lib/task_graph.ts");

function writeTask(
  repo: string,
  id: string,
  input: { status: TaskStatus; dependsOn: string[]; blocks?: string[]; implements?: string[] },
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
      implements: input.implements ?? ["docs/plans/0001-plan.md"],
      "depends-on": input.dependsOn,
      blocks: input.blocks ?? [],
    },
  }), "utf8");
}

function buildFixtureGraph(
  tasks: Record<string, { status: TaskStatus; dependsOn: string[]; blocks?: string[]; implements?: string[] }>,
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

test("buildTaskGraph keeps dependents blocked when a predecessor is wont-do", () => {
  const result = buildFixtureGraph({
    "TASK-0001": { status: "wont-do", dependsOn: [] },
    "TASK-0002": { status: "todo", dependsOn: ["TASK-0001"] },
  });
  assert.deepEqual(result.runnable, []);
  assert.deepEqual(result.blocked, [
    { id: "TASK-0001", reasons: ["status:wont-do"] },
    { id: "TASK-0002", reasons: ["depends-on:TASK-0001"] },
  ]);
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

test("buildTaskGraph resolves blocks in task-to-blocked direction and deduplicates edges", () => {
  const result = buildFixtureGraph({
    "TASK-0001": { status: "todo", dependsOn: [], blocks: ["TASK-0002"] },
    "TASK-0002": { status: "todo", dependsOn: ["TASK-0001"] },
  });
  assert.deepEqual(result.edges, [{ from: "TASK-0001", to: "TASK-0002" }]);
});

test("buildTaskGraph ignores typed artifact relations but rejects unresolved task-directory paths", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-artifacts-"));
  fs.mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  fs.mkdirSync(path.join(repo, "docs/specs"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/plans/0001-plan.md"), "# Plan\n", "utf8");
  fs.writeFileSync(path.join(repo, "docs/specs/0001-spec.md"), matter.stringify("# Spec\n", {
    id: "SPEC-0001", type: "spec", status: "approved", title: "Spec", created: "2026-08-13", updated: "2026-08-13", owners: [], relations: {},
  }), "utf8");
  writeTask(repo, "TASK-0001", { status: "todo", dependsOn: ["docs/specs/0001-spec.md", "docs/tasks/README.md"] });
  fs.writeFileSync(path.join(repo, "docs/tasks/README.md"), "# Task index\n", "utf8");
  const result = buildTaskGraph({ cwd: repo, plan: "docs/plans/0001-plan.md" });
  assert.deepEqual(result.edges, []);
  assert.deepEqual(result.issues.map((issue) => issue.code), ["missing-task-reference"]);
  assert.deepEqual(Object.keys(result.issues[0]).sort(), ["code", "message", "tasks"]);
});

test("buildTaskGraph ignores typed artifact ID relations", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-artifact-ids-"));
  fs.mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  fs.mkdirSync(path.join(repo, "docs/specs"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/plans/0001-plan.md"), matter.stringify("# Plan\n", {
    id: "PLAN-0001", type: "plan", status: "approved", title: "Plan", created: "2026-08-13", updated: "2026-08-13", owners: [], relations: {},
  }), "utf8");
  fs.writeFileSync(path.join(repo, "docs/specs/0001-spec.md"), matter.stringify("# Spec\n", {
    id: "SPEC-0001", type: "spec", status: "approved", title: "Spec", created: "2026-08-13", updated: "2026-08-13", owners: [], relations: {},
  }), "utf8");
  writeTask(repo, "TASK-0001", { status: "todo", dependsOn: ["PLAN-0001", "SPEC-0001"] });
  const result = buildTaskGraph({ cwd: repo, plan: "docs/plans/0001-plan.md" });
  assert.deepEqual(result.edges, []);
  assert.deepEqual(result.issues, []);
});

test("buildTaskGraph fails closed with clear malformed-document diagnostics", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-malformed-"));
  fs.mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/plans/0001-plan.md"), "# Plan\n", "utf8");
  writeTask(repo, "TASK-0001", { status: "invalid-status" as TaskStatus, dependsOn: [] });
  fs.writeFileSync(path.join(repo, "docs/tasks/0002-malformed.md"), matter.stringify("# Task\n", {
    id: "TASK-0002", type: "task", status: "todo", title: "Malformed", created: "2026-08-13", updated: "2026-08-13", owners: [], relations: { implements: ["docs/plans/0001-plan.md"], "depends-on": 3 },
  }), "utf8");
  fs.writeFileSync(path.join(repo, "docs/tasks/0003-missing-id.md"), matter.stringify("# Task\n", {
    type: "task", status: "todo", title: "Missing ID", created: "2026-08-13", updated: "2026-08-13", owners: [], relations: { implements: ["docs/plans/0001-plan.md"] },
  }), "utf8");
  const result = buildTaskGraph({ cwd: repo, plan: "docs/plans/0001-plan.md" });
  assert.equal(result.runnable.length, 0);
  assert.equal(result.issues.length, 3);
  for (const issue of result.issues) {
    assert.equal(Object.keys(issue).sort().join(","), "code,message,tasks");
    assert.ok(issue.tasks.length > 0);
    assert.match(issue.message, /Malformed task document/);
    assert.doesNotMatch(issue.message, /references unresolved task/);
  }
});

test("buildTaskGraph reports duplicate IDs and filters tasks by plan", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-filter-"));
  fs.mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/plans/0001-plan.md"), "# Plan\n", "utf8");
  fs.writeFileSync(path.join(repo, "docs/plans/0002-plan.md"), "# Other\n", "utf8");
  writeTask(repo, "TASK-0001", { status: "todo", dependsOn: [] });
  writeTask(repo, "TASK-0002", { status: "todo", dependsOn: [], implements: ["docs/plans/0002-plan.md"] });
  const duplicate = path.join(repo, "docs/tasks/0001-duplicate.md");
  fs.copyFileSync(path.join(repo, "docs/tasks/0001-task.md"), duplicate);
  const result = buildTaskGraph({ cwd: repo, plan: "docs/plans/0001-plan.md" });
  assert.deepEqual(result.nodes.map((node) => node.id), ["TASK-0001", "TASK-0001"]);
  assert.deepEqual(result.issues.map((issue) => issue.code), ["duplicate-task-id"]);
  assert.deepEqual(result.runnable, []);
});

test("build_task_graph CLI returns JSON and exit 1 for invalid graphs", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-cli-"));
  fs.mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/plans/0001-plan.md"), "# Plan\n", "utf8");
  writeTask(repo, "TASK-0001", { status: "todo", dependsOn: [] });
  const cli = path.resolve(process.cwd(), "../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/scripts/build_task_graph.js");
  const valid = spawnSync(process.execPath, [cli, "--cwd", repo, "--plan", "docs/plans/0001-plan.md", "--json"], { encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stderr);
  assert.deepEqual(JSON.parse(valid.stdout).runnable, ["TASK-0001"]);

  writeTask(repo, "TASK-0002", { status: "todo", dependsOn: ["TASK-9999"] });
  const invalid = spawnSync(process.execPath, [cli, "--cwd", repo, "--plan", "docs/plans/0001-plan.md", "--json"], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stdout).issues[0].code, "missing-task-reference");
});
