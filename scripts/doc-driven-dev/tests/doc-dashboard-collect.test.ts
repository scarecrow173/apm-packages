import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import matter from "gray-matter";

import { collectDashboard } from "../src/skills/doc-driven-dev-graph/scripts/lib/dashboard_collect";
import { loadGraphDefinition } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";
import { evaluateRouteDecision } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_router";
import { projectGraphState } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_state";
import { buildTaskGraph } from "../src/skills/doc-driven-dev-graph/scripts/lib/task_graph";

test("draft inventory survives missing focus and incomplete bootstrap", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-collect-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.mkdirSync(path.join(cwd, "docs/specs"), { recursive: true });
  const file = path.join(cwd, "docs/specs/example.md");
  const content = "---\nid: SPEC-0001\ntype: spec\nstatus: draft\ntitle: 草案\ncreated: '2026-09-21'\nupdated: '2026-09-21'\nowners: []\nrelations: {}\n---\n# 草案\n";
  fs.writeFileSync(file, content);
  const graphPath = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml");

  const report = await collectDashboard({
    cwd,
    graphPath,
    focus: [],
    signals: [],
    now: () => "2026-09-21T00:00:00Z",
  });

  assert.equal(report.decision, null);
  assert.equal(report.requested.current, null);
  assert.equal(report.inventory.find((row) => row.path === "docs/specs/example.md")?.status, "draft");
  assert.ok(report.state.blockers.includes("bootstrap-incomplete"));
  assert.equal(fs.readFileSync(file, "utf8"), content);
  assert.ok(!report.state.signals.includes("exit-audit-pass"));
});

for (const scenario of [
  "done",
  "wont-do",
  "active",
  "active-waiting",
  "cycle",
  "duplicate",
  "orphan",
  "invalid",
  "empty",
  "unmanaged",
  "alias",
]) {
  test(`collector preserves canonical semantics: ${scenario}`, async (t) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-case-"));
    t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
    const write = (relative: string, data: Record<string, unknown>, body = "# Example\n") => {
      const file = path.join(cwd, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, matter.stringify(body, {
        title: "Example",
        created: "2026-09-21",
        updated: "2026-09-21",
        owners: [],
        relations: {},
        ...data,
      }));
    };
    const planPath = "docs/plans/example.md";
    if (scenario !== "empty") {
      write(planPath, { id: "PLAN-0001", type: "plan", status: "draft" });
      write("docs/tasks/a.md", {
        id: "TASK-0001",
        type: "task",
        status: scenario.startsWith("active") ? "in-progress" : "todo",
        relations: { implements: [planPath], "depends-on": ["TASK-0002"] },
      });
      write("docs/tasks/b.md", {
        id: "TASK-0002",
        type: "task",
        status: scenario === "wont-do"
          ? "wont-do"
          : scenario === "active-waiting" || scenario === "cycle"
            ? "todo"
            : "done",
        relations: {
          implements: [planPath],
          ...(scenario === "cycle" ? { "depends-on": ["TASK-0001"] } : {}),
        },
      });
    }
    if (scenario === "duplicate") {
      write("docs/plans/second.md", { id: "PLAN-0002", type: "plan", status: "draft" });
      write("docs/tasks/duplicate.md", {
        id: "TASK-0001",
        type: "task",
        status: "todo",
        relations: { implements: [planPath] },
      });
    }
    if (scenario === "orphan") {
      write("docs/tasks/orphan.md", { id: "TASK-0003", type: "task", status: "todo" });
    }
    if (scenario === "invalid") {
      fs.writeFileSync(path.join(cwd, "docs/tasks/invalid.md"), "---\nid: [\n---\n");
    }
    if (scenario === "unmanaged") {
      fs.mkdirSync(path.join(cwd, "docs/superpowers/plans"), { recursive: true });
      fs.writeFileSync(path.join(cwd, "docs/superpowers/plans/raw.md"), "# Human plan\n");
    }
    if (scenario === "alias") {
      write("docs/spec/alias.md", { id: "SPEC-0001", type: "spec", status: "draft" });
    }

    const graphPath = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml");
    const definition = loadGraphDefinition(graphPath);
    const focus = scenario === "empty" ? [] : [planPath];
    const report = await collectDashboard({ cwd, graphPath, focus, signals: [], current: "task-graph" });

    assert.deepEqual(report.state, projectGraphState({ cwd, graphId: definition.id, focus, signals: [] }));
    assert.deepEqual(report.decision, evaluateRouteDecision({ current: "task-graph", definition, state: report.state }));
    if (scenario !== "empty") {
      const graph = report.plans.find((plan) => plan.path === planPath)?.graph;
      assert.ok(graph);
      assert.ok(graph.nodes.length > 0, `${scenario} should exercise real task nodes`);
      assert.deepEqual(
        graph,
        buildTaskGraph({ cwd, plan: planPath }),
      );
      if (scenario === "done") assert.deepEqual(graph.runnable, ["TASK-0001"]);
      if (scenario === "wont-do") assert.deepEqual(graph.runnable, []);
      if (scenario === "active") assert.deepEqual(graph.resumableActive, ["TASK-0001"]);
      if (scenario === "active-waiting") assert.deepEqual(graph.resumableActive, []);
      if (scenario === "cycle") assert.ok(graph.issues.some((issue) => issue.code === "task-cycle"));
      if (scenario === "duplicate") assert.ok(graph.issues.some((issue) => issue.code === "duplicate-task-id"));
    }
    if (scenario === "unmanaged") {
      assert.equal(report.inventory.find((row) => row.path.endsWith("raw.md"))?.kind, "unmanaged");
    }
    if (scenario === "alias") {
      assert.equal(report.inventory.find((row) => row.path.endsWith("alias.md"))?.graphCovered, false);
    }
    if (scenario === "orphan") {
      assert.ok(report.inventory.some((row) => row.path.endsWith("orphan.md")));
    }
    if (scenario === "invalid") {
      assert.ok(report.inventory.some((row) => row.parseError !== null));
    }
    await assert.rejects(
      collectDashboard({ cwd, graphPath, focus, signals: [], current: "unknown-node" }),
      /Unknown graph node/,
    );
    await assert.rejects(
      collectDashboard({ cwd, graphPath, focus, signals: ["undeclared-signal"] }),
      /Unknown signal/,
    );
  });
}
