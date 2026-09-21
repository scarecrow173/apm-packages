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

test("graph text fallback lists every node including isolated nodes", () => {
  const value = snapshot();
  value.definition = {
    ...definition,
    nodeCount: definition.nodeCount + 1,
    nodes: [...definition.nodes, {
      nodeId: "isolated<&", kind: "audit", delegate: "review<x>", audits: ["audit<&"], commitGate: true,
    }],
  };

  const html = renderDashboard(value);
  assert.match(html, /<details><summary>全 graph node<\/summary>[\s\S]*<th scope="col">node ID<\/th>/);
  assert.match(html, /全 graph node[\s\S]*isolated&lt;&amp;[\s\S]*review&lt;x&gt;[\s\S]*audit&lt;&amp;/);
});

test("graph and diagnostic detail sections are collapsed by default", () => {
  const html = renderDashboard(snapshot());
  for (const summary of ["Execution Graph", "全 graph node", "全 graph edge", "gate", "Graph topology issues"]) {
    assert.match(html, new RegExp(`<details><summary>${summary}</summary>`));
    assert.doesNotMatch(html, new RegExp(`<details open><summary>${summary}</summary>`));
  }
  assert.match(html, /<details><summary>findings \(0 \/ blocking 0\)<\/summary>/);
  assert.match(html, /<details><summary>artifact relation issues \(0\)<\/summary>/);
  assert.match(html, /<details><summary>対象外・不明情報 \(0\)<\/summary>/);
});

test("attention section stays neutral when nothing blocks progress", () => {
  const html = renderDashboard(snapshot());
  assert.match(html, /<section id="attention" class="attention"/);
  assert.match(html, /hard blockers: 0 \/ blocking findings: 0 \/ task graph issues: 0/);
  assert.match(html, /進行を止める項目はありません/);
  assert.ok(html.indexOf('id="attention"') < html.indexOf('id="task-board"'));
});

test("attention section aggregates hard blockers, blocking findings, and task graph issues", () => {
  const value = snapshot();
  value.state.hardBlockers = ["focus-required"];
  value.findings = [{
    ruleId: "broken-relation-link", category: "relation", severity: "error", blocking: true,
    path: "docs/specs/a.md", line: 12, artifactId: null, message: "missing target", target: null, repair: "manual",
  }];
  value.plans = [{
    path: "docs/plans/p.md", status: "in-progress",
    graph: {
      schemaVersion: 1, plan: "docs/plans/p.md",
      nodes: [{ id: "A", path: "docs/tasks/a.md", status: "todo", dependsOn: [], blocks: [] }],
      edges: [], runnable: [], active: [], resumableActive: [], completed: [], blocked: [],
      issues: [{ code: "task-cycle", message: "cycle detected", tasks: ["A"] }],
    },
  }];
  const html = renderDashboard(value);
  assert.match(html, /class="attention attention-active"/);
  assert.match(html, /hard blockers: 1 \/ blocking findings: 1 \/ task graph issues: 1/);
  assert.match(html, /hard blocker:<\/strong> focus-required/);
  assert.match(html, /blocking finding:<\/strong> <code>broken-relation-link<\/code> <code>docs\/specs\/a\.md<\/code>:12 — missing target/);
  assert.match(html, /task graph:<\/strong> <code>docs\/plans\/p\.md<\/code> <code>task-cycle<\/code> — cycle detected \(tasks: A\)/);
  assert.match(html, /<details open><summary>findings \(1 \/ blocking 1\)<\/summary>/);
});

test("document free-text search is limited to id, title, and path", () => {
  const value = snapshot([
    item("docs/specs/scope.md", "mystery-status", {
      id: "SPEC-9", type: "spec", title: "Scoped", updated: "2099-01-01", parseError: "yaml boom",
    }),
    item("docs/tasks/none.md", "todo", { id: null, title: "Plain" }),
  ]);
  const html = renderDashboard(value);
  const searchTexts = [...html.matchAll(/data-search-text="([^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(searchTexts, ["SPEC-9 Scoped docs/specs/scope.md", "Plain docs/tasks/none.md"]);
  assert.doesNotMatch(searchTexts[0], /mystery-status|2099-01-01|yaml boom|管理対象外|その他/);
  assert.doesNotMatch(searchTexts[1], /todo|未指定/);
  assert.match(html, /dataset\.searchText\|\|''\)\.toLocaleLowerCase\(\)\.includes\(query\)/);
});

test("task cards surface readiness badges and fold plan membership details", () => {
  const value = snapshot([item("docs/tasks/a.md", "todo"), item("docs/tasks/b.md", "blocked")]);
  value.plans = [{
    path: "docs/plans/p.md", status: "in-progress",
    graph: {
      schemaVersion: 1, plan: "docs/plans/p.md",
      nodes: [
        { id: "A", path: "docs/tasks/a.md", status: "todo", dependsOn: [], blocks: ["B"] },
        { id: "B", path: "docs/tasks/b.md", status: "blocked", dependsOn: ["A"], blocks: [] },
      ],
      edges: [{ from: "A", to: "B" }], runnable: ["A"], active: [], resumableActive: ["A"],
      completed: [], blocked: [{ id: "B", reasons: ["dependency:A"] }], issues: [],
    },
  }];
  const html = renderDashboard(value);
  assert.match(html, /badge-runnable">runnable</);
  assert.match(html, /badge-resumable">resumable</);
  assert.match(html, /badge-blocked">blocked</);
  assert.match(html, /<details class="membership-details"><summary>plan \/ 依存 \(1\)<\/summary><ul class="membership-list">/);
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
  assert.match(done, /<dt>完了率 \(done\)<\/dt><dd>100%<\/dd>/);
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
  assert.match(html, /<details><summary>文書内リンク \(2 件\)<\/summary>/);
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

test("task board renders before graph with shared document links, empty lanes, and escaped hostile data", () => {
  const value = snapshot([
    item("docs/tasks/hostile.md", "todo", {
      id: "<TASK-X>", title: "</article><script>alert(1)</script>", graphCovered: false,
    }),
  ]);
  value.plans = [{
    path: "docs/plans/<p>.md", status: "in-progress",
    graph: {
      schemaVersion: 1, plan: "docs/plans/<p>.md", nodes: [
        { id: "OTHER-ID", path: "docs/tasks/hostile.md", status: "todo", dependsOn: ["<PRE>"], blocks: [] },
      ], edges: [], runnable: [], active: [], resumableActive: [], completed: [],
      blocked: [{ id: "OTHER-ID", reasons: ["dependency:<PRE>"] }], issues: [],
    },
  }];

  const html = renderDashboard(value);
  assert.ok(html.indexOf('id="task-board"') < html.indexOf('id="graph"'));
  assert.match(html, /aria-label="タスク Kanban ボード"/);
  assert.match(html, /todo \/ 未着手/);
  assert.match(html, /in-progress \/ 進行中[\s\S]*この lane にタスクはありません/);
  assert.match(html, /href="#doc-0"/);
  assert.match(html, /graph 未対応/);
  assert.match(html, /dependency:&lt;PRE&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test("a card document target remains visible when document filters mark its row hidden", () => {
  const html = renderDashboard(snapshot([item("docs/tasks/a.md", "todo")]));
  assert.match(html, /data-task-card[\s\S]*href="#doc-0"/);
  assert.match(html, /tr:target\{display:table-row!important\}/);
  assert.match(html, /<tr id="doc-0" data-document-row/);
});
