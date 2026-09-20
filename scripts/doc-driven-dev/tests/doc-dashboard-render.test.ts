import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import type { DashboardSnapshot, InventoryItem } from "../src/skills/doc-driven-dev-graph/scripts/lib/dashboard_model";
import { renderDashboard, escapeHtml } from "../src/skills/doc-driven-dev-graph/scripts/lib/dashboard_render";
import { renderExecutionSvg } from "../src/skills/doc-driven-dev-graph/scripts/lib/dashboard_svg";
import { loadGraphDefinition } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";
import { inspectGraphDefinition } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_inspector";

const graphPath = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml");
const definition = inspectGraphDefinition(loadGraphDefinition(graphPath));

function item(pathValue: string, status: string | null, extra: Partial<InventoryItem> = {}): InventoryItem {
  return {
    path: pathValue, id: null, type: "task", title: pathValue, status, updated: null,
    kind: "canonical", graphCovered: true, parseError: null, ...extra,
  };
}

function snapshot(inventory: InventoryItem[] = []): DashboardSnapshot {
  return {
    schemaVersion: 1,
    startedAt: "2026-09-21T00:00:00Z",
    generatedAt: "2026-09-21T00:00:01Z",
    repositoryName: "fixture",
    requested: { focus: [], current: null, signals: [] },
    definition,
    state: {
      schemaVersion: 2, graphId: definition.graphId, cwd: "C:/secret/repository", taskDir: "docs/tasks",
      focus: [], artifactGraph: { nodes: [], edges: [], issues: [] }, gates: {}, signals: [],
      blockers: [], hardBlockers: [], taskGraph: null,
    },
    decision: null,
    inventory,
    plans: [], findings: [],
    health: { documents: inventory.length, blocking: 0, warnings: 0, infos: 0, categories: [] },
    coverageNotes: [],
  };
}

test("all untrusted HTML metacharacters are escaped", () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">&\''), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;");
});

test("graph SVG has safe IDs and a readable text equivalent", () => {
  const svg = renderExecutionSvg(definition, { current: null, edgeId: null });
  assert.match(svg, /<svg/);
  assert.match(svg, /<title[^>]*>Execution Graph<\/title>/);
  assert.match(svg, /遷移条件は直後の表を参照/);
  assert.doesNotMatch(svg, /<script|<foreignObject|(?:href|src)\s*=/i);
});

test("standalone HTML escapes content and stays offline", () => {
  const hostile = item('docs/specs/日本語".md', "draft", {
    id: "SPEC-0001", type: "spec", title: "</script><img src=x onerror=alert(1)>", graphCovered: false,
  });
  const value = snapshot([hostile]);
  value.repositoryName = "<repo>";
  const html = renderDashboard(value);
  assert.match(html, /現在ノード未指定/);
  assert.match(html, /生成時点/);
  assert.ok(html.includes("&lt;/script&gt;&lt;img"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes(value.state.cwd));
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|fetch\(/i);
  assert.match(html, /data-filters/);
  assert.match(html, /name="query"/);
  assert.match(html, /name="type"/);
  assert.match(html, /name="status"/);
  assert.match(html, /data-document-row/);
  assert.equal(html, renderDashboard(value));
});

test("empty and unknown inventories avoid a misleading completion rate", () => {
  assert.match(renderDashboard(snapshot()), /対象タスクなし/);
  const html = renderDashboard(snapshot([item("docs/tasks/unknown.md", "mystery")]));
  assert.match(html, /<dt>不明<\/dt><dd>1<\/dd>/);
  assert.doesNotMatch(html, /<dd>100(?:\.0)?%<\/dd>/);
});

test("done and wont-do remain separate task metrics", () => {
  const done = renderDashboard(snapshot([item("a", "done"), item("b", "done")]));
  assert.match(done, /<dt>完了<\/dt><dd>2<\/dd>/);
  assert.match(done, /100%/);
  const wontDo = renderDashboard(snapshot([item("a", "wont-do"), item("b", "wont-do")]));
  assert.match(wontDo, /<dt>対応しない<\/dt><dd>2<\/dd>/);
  assert.match(wontDo, /0%/);
});

test("draft canonical and unmanaged documents are labeled and filterable", () => {
  const value = snapshot([
    item("docs/specs/a.md", "draft", { type: "spec", title: "Draft", graphCovered: false }),
    item("notes/x.md", null, { type: null, kind: "unmanaged", title: "Loose", graphCovered: false }),
  ]);
  const html = renderDashboard(value);
  assert.match(html, /草案/);
  assert.match(html, /管理対象外/);
  assert.match(html, /data-type="spec" data-status="draft"/);
  assert.match(html, /href="#doc-0"/);
});

test("repository metrics count canonical draft states separately from unmanaged and parse errors", () => {
  const value = snapshot([
    item("docs/specs/draft.md", "draft", { type: "spec" }),
    item("docs/specs/proposed.md", "proposed", { type: "spec" }),
    item("docs/ideas/capturing.md", "capturing", { type: "idea" }),
    item("notes/unmanaged-draft.md", "draft", { type: null, kind: "unmanaged" }),
    item("docs/specs/broken.md", "draft", { type: "spec", parseError: "invalid YAML" }),
  ]);
  const html = renderDashboard(value);
  assert.match(html, /<dt>草案<\/dt><dd>1<\/dd>/);
  assert.match(html, /<dt>レビュー候補<\/dt><dd>1<\/dd>/);
  assert.match(html, /<dt>記録中<\/dt><dd>1<\/dd>/);
  assert.doesNotMatch(html, /草案・レビュー候補/);
});

test("repository-wide and selected focus task summaries are explicitly distinct", () => {
  const value = snapshot([
    item("docs/tasks/a1.md", "done"),
    item("docs/tasks/a2.md", "todo"),
    item("docs/tasks/b1.md", "todo"),
    item("docs/tasks/b2.md", "todo"),
    item("docs/tasks/b3.md", "wont-do"),
  ]);
  value.requested.focus = ["docs/plans/a.md"];
  value.state.focus = ["docs/plans/a.md"];
  value.state.taskGraph = {
    schemaVersion: 1, plan: "docs/plans/a.md",
    nodes: [
      { id: "A1", path: "docs/tasks/a1.md", status: "done", dependsOn: [], blocks: [] },
      { id: "A2", path: "docs/tasks/a2.md", status: "todo", dependsOn: [], blocks: [] },
    ],
    edges: [], runnable: ["A2"], active: [], resumableActive: [], completed: ["A1"], blocked: [], issues: [],
  };
  value.plans = [
    { path: "docs/plans/a.md", status: "in-progress", graph: value.state.taskGraph },
    { path: "docs/plans/b.md", status: "in-progress", graph: {
      ...value.state.taskGraph, plan: "docs/plans/b.md",
      nodes: [
        { id: "B1", path: "docs/tasks/b1.md", status: "todo", dependsOn: [], blocks: [] },
        { id: "B2", path: "docs/tasks/b2.md", status: "todo", dependsOn: [], blocks: [] },
        { id: "B3", path: "docs/tasks/b3.md", status: "wont-do", dependsOn: [], blocks: [] },
      ], completed: [], runnable: ["B1", "B2"],
    } },
  ];
  const html = renderDashboard(value);
  assert.match(html, /リポジトリ全体[\s\S]*<dt>残存<\/dt><dd>3<\/dd>[\s\S]*<dt>対応しない<\/dt><dd>1<\/dd>/);
  assert.match(html, /選択中の plan・focus[\s\S]*docs\/plans\/a\.md[\s\S]*<dt>残存<\/dt><dd>1<\/dd>[\s\S]*<dt>完了<\/dt><dd>1<\/dd>/);
});

test("focus summary reports unselected or unresolved state without inference", () => {
  assert.match(renderDashboard(snapshot([item("docs/tasks/a.md", "todo")])), /選択対象なし/);
  const value = snapshot([item("docs/tasks/a.md", "todo")]);
  value.requested.focus = ["docs/plans/missing.md"];
  value.state.focus = ["docs/plans/missing.md"];
  assert.match(renderDashboard(value), /task graph 未解決/);
});

test("blocked route preview is shown as supplied evidence", () => {
  const value = snapshot();
  value.requested.current = "briefing";
  value.requested.signals = ["explicit-signal"];
  value.decision = {
    route: {
      schemaVersion: 2, graphId: definition.graphId, current: "briefing", next: "briefing",
      edgeId: null, condition: "blocked", status: "blocked", delegate: null,
      requiredAudits: ["audit-x"], blockers: ["hard-x"], taskGraph: null, commitGate: true,
    },
    explanation: {
      currentNode: "briefing", hardBlockers: ["hard-x"], prerequisiteGates: [], evaluatedEdges: [],
      selectedEdgeId: null, selectedDestinationAudits: [], blockedReasons: ["hard-x"],
    },
  };
  const html = renderDashboard(value);
  assert.match(html, /遷移プレビュー/);
  assert.match(html, /blocked/);
  assert.match(html, /audit-x/);
  assert.match(html, /commit gate/);
  assert.match(html, /explicit-signal/);
});

test("plans render declared status separately from DAG eligibility and every dependency edge", () => {
  const value = snapshot();
  value.plans = [{
    path: "docs/plans/p.md", status: "draft",
    graph: {
      schemaVersion: 1, plan: "docs/plans/p.md",
      nodes: [
        { id: "TASK-A", path: "docs/tasks/a.md", status: "todo", dependsOn: [], blocks: ["TASK-B"] },
        { id: "TASK-B", path: "docs/tasks/b.md", status: "blocked", dependsOn: ["TASK-A"], blocks: [] },
      ],
      edges: [{ from: "TASK-A", to: "TASK-B" }], runnable: ["TASK-A"], active: [], resumableActive: [],
      completed: [], blocked: [{ id: "TASK-B", reasons: ["dependency:TASK-A"] }], issues: [],
    },
  }];
  const html = renderDashboard(value);
  assert.match(html, /plan status/);
  assert.match(html, /依存上 runnable/);
  assert.match(html, /TASK-A[\s\S]*TASK-B/);
});
