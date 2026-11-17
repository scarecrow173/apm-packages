import type {
  TaskGraphResult,
  TaskStatus,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/task_graph";

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildTaskGraph } from "../src/skills/doc-driven-dev-graph/scripts/lib/task_graph";
import {
  approvePlan,
  createRun,
  savePlan,
  updateTask,
  type StoreOptions,
} from "../src/skills/lib/execution_store";

const taskGraphCli = path.resolve(__dirname, "../src/skills/doc-driven-dev-graph/scripts/build_task_graph.ts");
const tsxCli = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");

const RUN_ID = "run-0001";

type FixtureTask = {
  title?: string;
  status?: TaskStatus;
  dependsOn?: string[];
  checks?: string[];
  scope?: string[];
};

// The store requires a git-covered state root inside the checkout; an
// explicit external root (allowExternalRoot) is the unit-test fixture —
// identical record semantics without git init overhead.
function makeFixture(
  tasks: Record<string, FixtureTask>,
  options: { plan?: string | null; approve?: boolean; focus?: string[] } = {},
): { repo: string; store: StoreOptions; result: TaskGraphResult } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-"));
  const store: StoreOptions = {
    stateRoot: fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-state-")),
    allowExternalRoot: true,
  };
  createRun(repo, {
    runId: RUN_ID,
    focus: options.focus ?? ["docs/designs/0001-graph.md"],
    ...(options.plan !== null ? { plan: options.plan ?? "# Plan\n\n- do the work\n" } : {}),
    tasks: Object.entries(tasks).map(([taskId, task]) => ({ taskId, ...task })),
  }, store);
  if (options.approve !== false && options.plan !== null) {
    approvePlan(repo, RUN_ID, { actor: "test" }, store);
  }
  return {
    repo,
    store,
    result: buildTaskGraph({ cwd: repo, runId: RUN_ID, ...store }),
  };
}

function buildFixtureGraph(
  tasks: Record<string, FixtureTask>,
  options: { plan?: string | null; approve?: boolean; focus?: string[] } = {},
): TaskGraphResult {
  return makeFixture(tasks, options).result;
}

/**
 * Write a task record the store API would refuse — the only way corrupt
 * state (dangling deps, duplicate taskIds, schema violations) can exist.
 */
function writeRawTask(store: StoreOptions, taskId: string, record: Record<string, unknown>): void {
  const file = path.join(store.stateRoot as string, "runs", RUN_ID, "tasks", `${taskId}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({
    schemaVersion: 1,
    runId: RUN_ID,
    taskId,
    title: taskId,
    status: "todo",
    dependsOn: [],
    checks: [],
    scope: [],
    version: 1,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    ...record,
  }, null, 2)}\n`, "utf8");
}

test("buildTaskGraph returns parallel roots and a fan-in task", () => {
  const result = buildFixtureGraph({
    "TASK-0001": { status: "todo" },
    "TASK-0002": { status: "todo" },
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
    "TASK-0001": { status: "done" },
    "TASK-0002": { status: "done" },
    "TASK-0003": { status: "todo", dependsOn: ["TASK-0001", "TASK-0002"] },
  });
  assert.deepEqual(result.runnable, ["TASK-0003"]);
});

test("buildTaskGraph projects dependency-ready active tasks without treating downstream waits as blockers", () => {
  const result = buildFixtureGraph({
    "TASK-0001": { status: "done" },
    "TASK-0002": { status: "in-progress", dependsOn: ["TASK-0001"] },
    "TASK-0003": { status: "todo", dependsOn: ["TASK-0002"] },
    "TASK-0004": { status: "blocked" },
  });

  assert.deepEqual(result.active, ["TASK-0002"]);
  assert.deepEqual(result.resumableActive, ["TASK-0002"]);
  assert.deepEqual(result.blocked, [
    { id: "TASK-0003", reasons: ["depends-on:TASK-0002"] },
    { id: "TASK-0004", reasons: ["status:blocked"] },
  ]);
});

test("buildTaskGraph keeps unresolved active tasks active but not resumable", () => {
  const result = buildFixtureGraph({
    "TASK-0001": { status: "todo" },
    "TASK-0002": { status: "in-progress", dependsOn: ["TASK-0001"] },
  });

  assert.deepEqual(result.active, ["TASK-0002"]);
  assert.deepEqual(result.resumableActive, []);
});

test("buildTaskGraph sorts multiple resumable active tasks and suppresses them on structural issues", () => {
  const valid = buildFixtureGraph({
    "TASK-0003": { status: "in-progress" },
    "TASK-0001": { status: "in-progress" },
    "TASK-0002": { status: "done" },
  });
  assert.deepEqual(valid.resumableActive, ["TASK-0001", "TASK-0003"]);

  // A dangling dep can only exist via corrupt state — the write boundary
  // refuses it — so materialize the record directly.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-"));
  const store: StoreOptions = {
    stateRoot: fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-state-")),
    allowExternalRoot: true,
  };
  createRun(repo, { runId: RUN_ID, plan: "# Plan\n", tasks: [] }, store);
  approvePlan(repo, RUN_ID, { actor: "test" }, store);
  writeRawTask(store, "TASK-0001", { status: "in-progress", dependsOn: ["TASK-9999"] });
  const invalid = buildTaskGraph({ cwd: repo, runId: RUN_ID, ...store });
  assert.deepEqual(invalid.active, ["TASK-0001"]);
  assert.deepEqual(invalid.resumableActive, []);
  assert.deepEqual(invalid.issues.map((issue) => issue.code), ["missing-task-reference"]);
});

test("buildTaskGraph keeps dependents blocked when a predecessor is wont-do", () => {
  const result = buildFixtureGraph({
    "TASK-0001": { status: "wont-do" },
    "TASK-0002": { status: "todo", dependsOn: ["TASK-0001"] },
  });
  assert.deepEqual(result.runnable, []);
  assert.deepEqual(result.blocked, [
    { id: "TASK-0001", reasons: ["status:wont-do"] },
    { id: "TASK-0002", reasons: ["depends-on:TASK-0001"] },
  ]);
});

test("buildTaskGraph fails closed on cycle and unresolved task reference", () => {
  // A two-task cycle is creatable atomically (batch deps resolve against the
  // batch set); a dangling dep is not — it arrives via corrupt state.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-"));
  const store: StoreOptions = {
    stateRoot: fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-state-")),
    allowExternalRoot: true,
  };
  createRun(repo, {
    runId: RUN_ID,
    plan: "# Plan\n",
    tasks: [
      { taskId: "TASK-0001", status: "todo", dependsOn: ["TASK-0002"] },
      { taskId: "TASK-0002", status: "todo", dependsOn: ["TASK-0001"] },
    ],
  }, store);
  approvePlan(repo, RUN_ID, { actor: "test" }, store);
  writeRawTask(store, "TASK-0003", { dependsOn: ["TASK-9999"] });
  const result = buildTaskGraph({ cwd: repo, runId: RUN_ID, ...store });
  assert.deepEqual(result.runnable, []);
  assert.deepEqual(result.issues.map((issue) => issue.code).sort(), [
    "missing-task-reference",
    "task-cycle",
  ]);
});

test("buildTaskGraph derives blocks as the reverse projection of dependsOn", () => {
  const result = buildFixtureGraph({
    "TASK-0001": { status: "todo" },
    "TASK-0002": { status: "todo", dependsOn: ["TASK-0001"] },
  });
  assert.deepEqual(result.edges, [{ from: "TASK-0001", to: "TASK-0002" }]);
  const byId = new Map(result.nodes.map((node) => [node.id, node]));
  assert.deepEqual(byId.get("TASK-0001")?.blocks, ["TASK-0002"]);
  assert.deepEqual(byId.get("TASK-0002")?.blocks, []);
});

test("buildTaskGraph reports a duplicate task id claimed by two record files", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-"));
  const store: StoreOptions = {
    stateRoot: fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-state-")),
    allowExternalRoot: true,
  };
  createRun(repo, { runId: RUN_ID, plan: "# Plan\n", tasks: [{ taskId: "TASK-0001" }] }, store);
  approvePlan(repo, RUN_ID, { actor: "test" }, store);
  // The API keys records by taskId — a second file claiming the same id is
  // only reachable through corrupt state.
  writeRawTask(store, "TASK-0001-dup", { taskId: "TASK-0001" });
  const result = buildTaskGraph({ cwd: repo, runId: RUN_ID, ...store });
  assert.deepEqual(result.nodes.map((node) => node.id), ["TASK-0001"]);
  assert.deepEqual(result.issues.map((issue) => issue.code), ["duplicate-task-id"]);
  assert.deepEqual(result.runnable, []);
});

test("buildTaskGraph reports plan-missing when the run has no plan.md", () => {
  const result = buildFixtureGraph({ "TASK-0001": { status: "todo" } }, { plan: null });
  assert.equal(result.plan, null);
  assert.deepEqual(result.issues.map((issue) => issue.code), ["plan-missing"]);
  assert.deepEqual(result.runnable, []);
});

test("buildTaskGraph reports plan-not-approved until the digest-bound approval lands", () => {
  const result = buildFixtureGraph({ "TASK-0001": { status: "todo" } }, { approve: false });
  assert.equal(result.plan?.approved, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), ["plan-not-approved"]);
  assert.deepEqual(result.runnable, []);
});

test("buildTaskGraph reports plan-not-approved again after savePlan invalidates the digest", () => {
  const { repo, store } = makeFixture({ "TASK-0001": { status: "todo" } });
  savePlan(repo, RUN_ID, "# Plan\n\n- changed after approval\n", store);
  const result = buildTaskGraph({ cwd: repo, runId: RUN_ID, ...store });
  assert.equal(result.plan?.approved, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), ["plan-not-approved"]);
});

test("buildTaskGraph flags plan-digest-drift on a write outside the store API", () => {
  const { repo, store } = makeFixture({ "TASK-0001": { status: "todo" } });
  fs.writeFileSync(
    path.join(store.stateRoot as string, "runs", RUN_ID, "plan.md"),
    "# Plan\n\n- edited out-of-band\n",
    "utf8",
  );
  const result = buildTaskGraph({ cwd: repo, runId: RUN_ID, ...store });
  const codes = result.issues.map((issue) => issue.code).sort();
  assert.deepEqual(codes, ["plan-digest-drift", "plan-not-approved"]);
  assert.deepEqual(result.runnable, []);
});

test("buildTaskGraph reports plan-has-no-tasks for a run with no task records", () => {
  const result = buildFixtureGraph({});
  assert.deepEqual(result.issues.map((issue) => issue.code), ["plan-has-no-tasks"]);
});

test("buildTaskGraph surfaces node scope, version, and state-root-relative paths", () => {
  const { repo, store } = makeFixture({ "TASK-0001": { status: "todo", scope: ["src/b.ts", "src/a.ts"], title: "Wire the graph" } });
  updateTask(repo, RUN_ID, "TASK-0001", { status: "in-progress" }, { ...store, expectedVersion: 1 });
  const result = buildTaskGraph({ cwd: repo, runId: RUN_ID, ...store });
  const [node] = result.nodes;
  assert.equal(node.id, "TASK-0001");
  assert.equal(node.path, `runs/${RUN_ID}/tasks/TASK-0001.json`);
  assert.equal(node.title, "Wire the graph");
  // Scope sorts deterministically; version tracks the CAS update.
  assert.deepEqual(node.scope, ["src/a.ts", "src/b.ts"]);
  assert.equal(node.version, 2);
  assert.equal(result.plan?.path, `runs/${RUN_ID}/plan.md`);
  assert.match(result.plan?.digest ?? "", /^[0-9a-f]{64}$/);
  assert.equal(result.plan?.approved, true);
});

test("buildTaskGraph fails closed at load on a malformed task record", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-"));
  const store: StoreOptions = {
    stateRoot: fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-state-")),
    allowExternalRoot: true,
  };
  createRun(repo, { runId: RUN_ID, plan: "# Plan\n", tasks: [{ taskId: "TASK-0001" }] }, store);
  const file = path.join(store.stateRoot as string, "runs", RUN_ID, "tasks", "TASK-0001.json");
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, runId: RUN_ID, taskId: "TASK-0001", status: "garbage" }), "utf8");
  assert.throws(() => buildTaskGraph({ cwd: repo, runId: RUN_ID, ...store }), /task/i);
});

test("the write boundary refuses cross-run and dangling dependency spellings", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-"));
  const store: StoreOptions = {
    stateRoot: fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-state-")),
    allowExternalRoot: true,
  };
  for (const dep of ["other-run:TASK-0001", "docs/tasks/0001-task.md", "run\\TASK-0001"]) {
    assert.throws(
      () => createRun(repo, {
        runId: `run-${dep.length}`,
        tasks: [{ taskId: "TASK-0001", dependsOn: [dep] }],
      }, store),
      /same-run task ids only|does not exist in run scope/,
      `dependency ${dep} must be rejected at the write boundary`,
    );
  }
});

test("a missing run id surfaces the store's fail-closed error, never an empty graph", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-"));
  const store: StoreOptions = {
    stateRoot: fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-state-")),
    allowExternalRoot: true,
  };
  assert.throws(() => buildTaskGraph({ cwd: repo, runId: "no-such-run", ...store }), /does not exist/);
});

test("build_task_graph CLI requires --run and reports issues with exit 1", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-cli-"));
  const store: StoreOptions = {
    stateRoot: fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-cli-state-")),
    allowExternalRoot: true,
  };
  const missing = spawnSync(process.execPath, [tsxCli, taskGraphCli, "--cwd", repo, "--json"], { encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /--run <run-id>/);

  createRun(repo, { runId: RUN_ID, plan: "# Plan\n", tasks: [{ taskId: "TASK-0001" }] }, store);
  approvePlan(repo, RUN_ID, { actor: "test" }, store);
  const valid = spawnSync(process.execPath, [
    tsxCli, taskGraphCli, "--cwd", repo, "--run", RUN_ID,
    "--state-root", store.stateRoot as string, "--allow-external-root", "--json",
  ], { encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stderr);
  assert.deepEqual(JSON.parse(valid.stdout).runnable, ["TASK-0001"]);

  writeRawTask(store, "TASK-0002", { dependsOn: ["TASK-9999"] });
  const invalid = spawnSync(process.execPath, [
    tsxCli, taskGraphCli, "--cwd", repo, "--run", RUN_ID,
    "--state-root", store.stateRoot as string, "--allow-external-root", "--json",
  ], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stdout).issues[0].code, "missing-task-reference");
});

test("build_task_graph CLI never mixes runs: each --run projects its own records", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-cli-runs-"));
  const store: StoreOptions = {
    stateRoot: fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-cli-state-")),
    allowExternalRoot: true,
  };
  createRun(repo, { runId: "run-a", plan: "# A\n", tasks: [{ taskId: "TASK-0001" }] }, store);
  approvePlan(repo, "run-a", { actor: "test" }, store);
  createRun(repo, { runId: "run-b", plan: "# B\n", tasks: [{ taskId: "TASK-0009" }] }, store);
  approvePlan(repo, "run-b", { actor: "test" }, store);
  const run = spawnSync(process.execPath, [
    tsxCli, taskGraphCli, "--cwd", repo, "--run", "run-b",
    "--state-root", store.stateRoot as string, "--allow-external-root", "--json",
  ], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout) as TaskGraphResult;
  assert.equal(result.runId, "run-b");
  assert.deepEqual(result.nodes.map((node) => node.id), ["TASK-0009"]);
});
