import assert from "node:assert/strict";
import test from "node:test";

import type { InventoryItem, PlanView } from "../src/skills/doc-driven-dev-graph/scripts/lib/dashboard_model";
import { buildTaskBoard } from "../src/skills/doc-driven-dev-graph/scripts/lib/dashboard_board";

function task(path: string, status: string | null, extra: Partial<InventoryItem> = {}): InventoryItem {
  return {
    path, id: path, type: "task", title: path, status, updated: null,
    kind: "canonical", graphCovered: true, parseError: null, ...extra,
  };
}

function plan(path: string, nodes: PlanView["graph"]["nodes"], extra: Partial<PlanView["graph"]> = {}): PlanView {
  return {
    path, status: "in-progress",
    graph: {
      schemaVersion: 1, plan: path, nodes, edges: [], runnable: [], active: [],
      resumableActive: [], completed: [], blocked: [], issues: [], ...extra,
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

test("deduplicates cards by path while preserving duplicate IDs and per-plan membership", () => {
  const inventory = [
    task("tasks/a.md", "todo", { id: "DUP", title: "First" }),
    task("tasks/b.md", "todo", { id: "DUP", title: "Second" }),
  ];
  const plans = [
    plan("plans/one.md", [
      { id: "DUP", path: "tasks/a.md", status: "todo", dependsOn: [], blocks: [] },
      { id: "DUP", path: "tasks/b.md", status: "todo", dependsOn: ["PRE"], blocks: [] },
    ], { runnable: ["DUP"], blocked: [{ id: "DUP", reasons: ["duplicate-id:DUP"] }] }),
    plan("plans/two.md", [
      { id: "ALT", path: "tasks/a.md", status: "todo", dependsOn: ["WAIT"], blocks: [] },
    ], { blocked: [{ id: "ALT", reasons: ["dependency:WAIT"] }] }),
  ];

  const cards = buildTaskBoard(inventory, plans).lanes[0].cards;
  assert.equal(cards.length, 2);
  assert.deepEqual(cards[0].memberships.map((entry) => entry.plan), ["plans/one.md", "plans/two.md"]);
  assert.deepEqual(cards[0].memberships[1], {
    plan: "plans/two.md", taskId: "ALT", dependencies: ["WAIT"], runnable: false,
    resumable: false, blockReasons: ["dependency:WAIT"],
  });
  assert.deepEqual(cards[1].memberships.map((entry) => entry.plan), ["plans/one.md"]);
});

test("keeps orphan and graph-uncovered task cards with explicit unknown coverage", () => {
  const board = buildTaskBoard([
    task("tasks/orphan.md", "todo"),
    task("tasks/uncovered.md", "done", { graphCovered: false }),
  ], []);

  assert.equal(board.lanes[0].cards[0].coverage, "no-plan");
  assert.equal(board.lanes[3].cards[0].coverage, "graph-uncovered");
});

test("keeps canonical blocked status separate from a todo waiting on dependencies", () => {
  const plans = [plan("plans/p.md", [
    { id: "WAITING", path: "tasks/waiting.md", status: "todo", dependsOn: ["DONE-FIRST"], blocks: [] },
    { id: "BLOCKED", path: "tasks/blocked.md", status: "blocked", dependsOn: [], blocks: [] },
  ], { blocked: [
    { id: "WAITING", reasons: ["dependency:DONE-FIRST"] },
    { id: "BLOCKED", reasons: ["status:blocked"] },
  ] })];
  const board = buildTaskBoard([task("tasks/waiting.md", "todo"), task("tasks/blocked.md", "blocked")], plans);

  assert.equal(board.lanes[0].cards[0].path, "tasks/waiting.md");
  assert.deepEqual(board.lanes[0].cards[0].memberships[0].blockReasons, ["dependency:DONE-FIRST"]);
  assert.equal(board.lanes[2].cards[0].path, "tasks/blocked.md");
});
