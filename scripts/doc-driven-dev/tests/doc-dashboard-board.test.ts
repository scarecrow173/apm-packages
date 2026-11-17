import assert from "node:assert/strict";
import test from "node:test";

import type { InventoryItem, RunView } from "../src/skills/doc-driven-dev-graph/scripts/lib/dashboard_model";
import { buildTaskBoard } from "../src/skills/doc-driven-dev-graph/scripts/lib/dashboard_board";
import type { TaskGraphNode, TaskGraphResult } from "../src/skills/doc-driven-dev-graph/scripts/lib/task_graph";

function task(path: string, status: string | null, extra: Partial<InventoryItem> = {}): InventoryItem {
  return {
    path, id: path, type: "task", title: path, status, updated: null,
    kind: "canonical", graphCovered: true, parseError: null, ...extra,
  };
}

function node(id: string, status: TaskGraphNode["status"], extra: Partial<TaskGraphNode> = {}): TaskGraphNode {
  return {
    id, path: `runs/run-0001/tasks/${id}.json`, title: id, status,
    dependsOn: [], blocks: [], scope: [], version: 1, ...extra,
  };
}

function run(runId: string, nodes: TaskGraphNode[], extra: Partial<TaskGraphResult> = {}): RunView {
  return {
    runId, status: "active",
    graph: {
      schemaVersion: 2, runId,
      plan: { path: `runs/${runId}/plan.md`, digest: "a".repeat(64), approved: true },
      nodes, edges: [], runnable: [], active: [], resumableActive: [],
      completed: [], blocked: [], issues: [], ...extra,
    },
  };
}

test("places every canonical task status in its lane and keeps invalid or parse-error tasks unknown", () => {
  const board = buildTaskBoard([
    task("todo.md", "todo"), task("active.md", "in-progress"), task("blocked.md", "blocked"),
    task("done.md", "done"), task("wont.md", "wont-do"), task("invalid.md", "draft"),
    task("parse.md", "todo", { parseError: "bad <yaml>" }),
    task("notes.md", "todo", { kind: "unmanaged" }),
  ], []);

  assert.deepEqual(board.lanes.map((lane) => [lane.status, lane.cards.map((card) => card.path)]), [
    ["todo", ["todo.md"]], ["in-progress", ["active.md"]], ["blocked", ["blocked.md"]],
    ["done", ["done.md"]], ["wont-do", ["wont.md"]], ["unknown", ["invalid.md", "parse.md"]],
  ]);
});

test("keeps each run-scoped record as its own card with a single run membership", () => {
  const inventory = [
    task("tasks/a.md", "todo", { id: "DUP", title: "First" }),
    task("tasks/b.md", "todo", { id: "DUP", title: "Second" }),
  ];
  const runs = [
    run("run-one", [
      node("DUP", "todo", { path: "runs/run-one/tasks/DUP.json", dependsOn: ["PRE"] }),
    ], { blocked: [{ id: "DUP", reasons: ["dependency:PRE"] }] }),
    run("run-two", [
      node("ALT", "todo", { path: "runs/run-two/tasks/ALT.json", dependsOn: ["WAIT"] }),
    ], { blocked: [{ id: "ALT", reasons: ["dependency:WAIT"] }] }),
  ];

  const cards = buildTaskBoard(inventory, runs).lanes[0].cards;
  assert.equal(cards.length, 4);
  // Record paths sort before the legacy `tasks/` docs; each record card
  // belongs to exactly one run — identity is (runId, taskId), not a doc path.
  assert.deepEqual(cards[0].memberships.map((entry) => entry.run), ["run-one"]);
  assert.deepEqual(cards[0].memberships[0], {
    run: "run-one", taskId: "DUP", dependencies: ["PRE"], runnable: false,
    resumable: false, blockReasons: ["dependency:PRE"],
  });
  assert.deepEqual(cards[1].memberships.map((entry) => entry.run), ["run-two"]);
  assert.equal(cards[1].memberships[0].taskId, "ALT");
  assert.deepEqual(cards[1].memberships[0].blockReasons, ["dependency:WAIT"]);
  assert.deepEqual(cards.slice(2).map((card) => card.path), ["tasks/a.md", "tasks/b.md"]);
  assert.equal(cards[2].memberships.length, 0);
});

test("keeps orphan and graph-uncovered task cards with explicit unknown coverage", () => {
  const board = buildTaskBoard([
    task("tasks/orphan.md", "todo"),
    task("tasks/uncovered.md", "done", { graphCovered: false }),
  ], []);

  assert.equal(board.lanes[0].cards[0].coverage, "no-run");
  assert.equal(board.lanes[3].cards[0].coverage, "graph-uncovered");
});

test("run record cards cover the lane statuses the store permits", () => {
  const board = buildTaskBoard([], [run("run-0001", [
    node("A", "todo"), node("B", "in-progress"), node("C", "blocked"),
    node("D", "done"), node("E", "wont-do"),
  ])]);
  assert.deepEqual(board.lanes.map((lane) => [lane.status, lane.cards.map((card) => card.id)]), [
    ["todo", ["A"]], ["in-progress", ["B"]], ["blocked", ["C"]],
    ["done", ["D"]], ["wont-do", ["E"]],
  ]);
});

test("keeps canonical blocked status separate from a todo waiting on dependencies", () => {
  const runs = [run("run-p", [
    node("WAITING", "todo", { path: "runs/run-p/tasks/WAITING.json", dependsOn: ["DONE-FIRST"] }),
    node("BLOCKED", "blocked", { path: "runs/run-p/tasks/BLOCKED.json" }),
  ], { blocked: [
    { id: "WAITING", reasons: ["dependency:DONE-FIRST"] },
    { id: "BLOCKED", reasons: ["status:blocked"] },
  ] })];
  const board = buildTaskBoard([task("tasks/legacy.md", "todo")], runs);

  assert.equal(board.lanes[0].cards[0].path, "runs/run-p/tasks/WAITING.json");
  assert.deepEqual(board.lanes[0].cards[0].memberships[0].blockReasons, ["dependency:DONE-FIRST"]);
  assert.equal(board.lanes[2].cards[0].path, "runs/run-p/tasks/BLOCKED.json");
});
