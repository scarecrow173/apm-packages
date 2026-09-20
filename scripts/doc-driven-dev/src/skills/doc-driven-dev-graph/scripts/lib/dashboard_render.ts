import { documentBucket, summarizeTasks } from "./dashboard_model";
import type { DashboardSnapshot, InventoryItem } from "./dashboard_model";
import { renderExecutionSvg } from "./dashboard_svg";

export function escapeHtml(value: string): string {
  const escaped: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, (character) => escaped[character]);
}

const e = (value: unknown): string => escapeHtml(value === null || value === undefined || value === "" ? "未指定" : String(value));
const list = (values: readonly string[]): string => values.length ? values.map(e).join(", ") : "なし";
const bool = (value: boolean): string => value ? "はい" : "いいえ";
const compare = (left: string, right: string): number => left.localeCompare(right);

function table(headers: string[], rows: string[][], empty = "0 件"): string {
  if (rows.length === 0) return `<p class="empty">${e(empty)}</p>`;
  return `<div class="table-scroll" tabindex="0"><table><thead><tr>${headers.map((header) => `<th scope="col">${e(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderMetrics(snapshot: DashboardSnapshot): string {
  const canonicalTasks = snapshot.inventory.filter((row) => row.kind === "canonical" && row.type === "task");
  const summary = summarizeTasks(canonicalTasks);
  const canonicalDocuments = snapshot.inventory.filter((row) => row.kind === "canonical" && row.parseError === null);
  const countStatus = (status: string): number => canonicalDocuments.filter((row) => row.status === status).length;
  const ratio = summary.doneRatio === null ? "対象タスクなし" : `${Math.round(summary.doneRatio * 100)}%`;
  const metrics = [
    ["残存", summary.remaining], ["完了", summary.done], ["対応しない", summary.wontDo],
    ["不明", summary.unknown], ["進捗", ratio], ["草案", countStatus("draft")],
    ["レビュー候補", countStatus("proposed")], ["記録中", countStatus("capturing")],
    ["blocking findings", snapshot.health.blocking],
  ];
  const metricList = (values: Array<Array<string | number>>): string => `<dl class="metrics">${values.map(([label, value]) => `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join("")}</dl>`;
  const selected = snapshot.state.taskGraph;
  let focused: string;
  if (selected) {
    const selectedSummary = summarizeTasks(selected.nodes);
    const selectedRatio = selectedSummary.doneRatio === null ? "対象タスクなし" : `${Math.round(selectedSummary.doneRatio * 100)}%`;
    focused = `<h3>選択中の plan・focus</h3><p><strong>plan:</strong> <code>${e(selected.plan)}</code></p>${metricList([
      ["残存", selectedSummary.remaining], ["完了", selectedSummary.done], ["対応しない", selectedSummary.wontDo],
      ["不明", selectedSummary.unknown], ["進捗", selectedRatio],
    ])}`;
  } else if (snapshot.requested.focus.length > 0 || snapshot.state.focus.length > 0) {
    focused = `<h3>選択中の plan・focus</h3><p>task graph 未解決: ${list(snapshot.state.focus.length > 0 ? snapshot.state.focus : snapshot.requested.focus)}</p>`;
  } else {
    focused = "<h3>選択中の plan・focus</h3><p>選択対象なし。focus は未指定です。</p>";
  }
  return `<section aria-labelledby="summary-heading"><h2 id="summary-heading">概要</h2><h3>リポジトリ全体</h3>${metricList(metrics)}${focused}</section>`;
}

function renderGraph(snapshot: DashboardSnapshot): string {
  const decision = snapshot.decision;
  const route = decision?.route;
  const explanation = decision?.explanation;
  const routeSummary = !decision
    ? "<p><strong>現在ノード未指定</strong>。遷移プレビューは評価していません。</p>"
    : `<div class="callout"><h3>遷移プレビュー（指定条件からの評価）</h3><dl class="facts"><div><dt>現在ノード</dt><dd>${e(route?.current)}</dd></div><div><dt>route status</dt><dd>${e(route?.status)}</dd></div><div><dt>次ノード</dt><dd>${e(route?.next)}</dd></div><div><dt>edge</dt><dd>${e(route?.edgeId)}</dd></div><div><dt>condition</dt><dd>${e(route?.condition)}</dd></div><div><dt>delegate</dt><dd>${e(route?.delegate)}</dd></div></dl><p><strong>required audits:</strong> ${list(route?.requiredAudits ?? [])}</p><p><strong>commit gate:</strong> ${e(bool(route?.commitGate ?? false))}</p><p><strong>hard blockers:</strong> ${list(explanation?.hardBlockers ?? [])}</p><p><strong>blocked reasons:</strong> ${list(explanation?.blockedReasons ?? [])}</p></div>`;
  const gateRows = Object.entries(snapshot.state.gates).sort(([left], [right]) => compare(left, right))
    .map(([name, gate]) => [e(name), e(gate.status), list(gate.reasons)]);
  const edgeRows = [...snapshot.definition.edges].sort((left, right) => compare(left.from, right.from) || left.priority - right.priority || compare(left.id, right.id))
    .map((edge) => [e(edge.id), e(edge.from), e(edge.to), e(edge.when), e(edge.priority)]);
  const topologyRows = snapshot.definition.issues.map((issue) => [e(issue.severity), e(issue.code), e(issue.nodeId), e(issue.condition)]);
  return `<section id="graph" aria-labelledby="graph-heading"><h2 id="graph-heading">Graph</h2>${routeSummary}<p><strong>caller supplied signals:</strong> ${list(snapshot.requested.signals)}</p><p><strong>state signals:</strong> ${list(snapshot.state.signals)}</p><p><strong>hard blockers:</strong> ${list(snapshot.state.hardBlockers)}</p>${renderExecutionSvg(snapshot.definition, { current: snapshot.requested.current, edgeId: route?.edgeId ?? null })}<h3>全 graph edge</h3>${table(["edge ID", "from", "to", "condition", "priority"], edgeRows)}<h3>gate</h3>${table(["gate", "status", "reasons"], gateRows, "gate 0 件")}<h3>Graph topology issues</h3>${table(["severity", "code", "node", "condition"], topologyRows)}</section>`;
}

function renderPlans(snapshot: DashboardSnapshot): string {
  const plans = [...snapshot.plans].sort((left, right) => compare(left.path, right.path));
  const body = plans.map((plan) => {
    const graph = plan.graph;
    const blocked = new Map(graph.blocked.map((entry) => [entry.id, entry.reasons]));
    const nodes = [...graph.nodes].sort((left, right) => compare(left.path, right.path)).map((node) => [
      e(node.id), e(node.path), e(node.status), list(node.dependsOn), list(node.blocks),
      e(bool(graph.runnable.includes(node.id))), e(bool(graph.active.includes(node.id))),
      e(bool(graph.resumableActive.includes(node.id))), list(blocked.get(node.id) ?? []),
    ]);
    const edges = graph.edges.map((edge) => [e(edge.from), e(edge.to)]);
    const issues = graph.issues.map((issue) => [e(issue.code), e(issue.message), list(issue.tasks)]);
    return `<details><summary><code>${e(plan.path)}</code> — plan status: ${e(plan.status)}; done ${graph.completed.length}; 残存 ${graph.nodes.filter((node) => ["todo", "in-progress", "blocked"].includes(node.status)).length}; wont-do ${graph.nodes.filter((node) => node.status === "wont-do").length}</summary><h4>タスク</h4>${table(["ID", "canonical path", "task status", "depends on", "blocks", "依存上 runnable", "active", "resumable active", "停止理由"], nodes)}<h4>dependency edges</h4>${table(["from", "to"], edges)}<h4>task issues</h4>${table(["code", "message", "tasks"], issues)}</details>`;
  }).join("");
  return `<section id="tasks" aria-labelledby="tasks-heading"><h2 id="tasks-heading">plan ごとのタスク</h2>${body || "<p class=\"empty\">plan 0 件</p>"}</section>`;
}

function renderDocuments(snapshot: DashboardSnapshot): string {
  const inventory = [...snapshot.inventory].sort((left, right) => compare(left.path, right.path));
  const ids = new Map(inventory.map((row, index) => [row.path, `doc-${index}`]));
  const types = [...new Set(inventory.map((row) => row.type).filter((value): value is string => value !== null))].sort(compare);
  const statuses = [...new Set(inventory.map((row) => row.status).filter((value): value is string => value !== null))].sort(compare);
  const rows = inventory.map((row) => {
    const bucket = row.kind === "unmanaged" ? "管理対象外" : ({ draft: "draft", proposed: "proposed", capturing: "capturing", other: "その他" })[documentBucket(row.status)];
    return `<tr id="${ids.get(row.path)}" data-document-row data-type="${e(row.type ?? "")}" data-status="${e(row.status ?? "")}"><td>${e(bucket)}</td><td>${e(row.id)}</td><td>${e(row.type)}</td><td>${e(row.title)}</td><td><code>${e(row.path)}</code></td><td>${e(row.status)}</td><td>${e(row.updated)}</td><td>${e(bool(row.graphCovered))}</td><td>${e(row.parseError)}</td></tr>`;
  }).join("");
  const tableHtml = inventory.length === 0 ? "<p class=\"empty\">文書 0 件</p>" : `<div class="table-scroll" tabindex="0"><table><thead><tr><th>区分</th><th>ID</th><th>種別</th><th>title</th><th>canonical path</th><th>status</th><th>updated</th><th>graph covered</th><th>parse error</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  return `<section id="documents" aria-labelledby="documents-heading"><h2 id="documents-heading">草案とレビュー候補・文書</h2><form data-filters><label>検索 <input name="query" type="search" autocomplete="off" placeholder="ID / title / path"></label><label>種別 <select name="type"><option value="">すべて</option>${types.map((value) => `<option value="${e(value)}">${e(value)}</option>`).join("")}</select></label><label>status <select name="status"><option value="">すべて</option>${statuses.map((value) => `<option value="${e(value)}">${e(value)}</option>`).join("")}</select></label></form><p><span data-result-count aria-live="polite">${inventory.length}</span> 件</p>${tableHtml}<h3>文書内リンク</h3><ul>${inventory.map((row) => `<li><a href="#${ids.get(row.path)}">${e(row.id ?? row.path)}</a></li>`).join("") || "<li>なし</li>"}</ul>${renderRelations(snapshot, ids)}</section>`;
}

function renderRelations(snapshot: DashboardSnapshot, ids: ReadonlyMap<string, string>): string {
  const anchor = (pathValue: string): string => ids.has(pathValue) ? `<a href="#${ids.get(pathValue)}">${e(pathValue)}</a>` : e(pathValue);
  const rows = snapshot.state.artifactGraph.edges.map((edge) => [
    anchor(edge.from), e(edge.relation), e(edge.kind),
    edge.to ? anchor(edge.to) : `<span class="warning">${edge.external ? "external" : "未解決"}</span>`,
  ]);
  return `<h3>文書間の関係</h3>${table(["from", "relation", "kind", "to"], rows)}`;
}

function renderDiagnostics(snapshot: DashboardSnapshot): string {
  const findings = snapshot.findings.map((finding) => [e(finding.severity), e(bool(finding.blocking)), e(finding.ruleId), e(finding.path), e(finding.line), e(finding.message)]);
  const graphIssues = snapshot.state.artifactGraph.issues.map((issue) => [e(issue.code), e(issue.message)]);
  const notes = snapshot.coverageNotes.map((note) => [e(note)]);
  return `<section id="diagnostics" aria-labelledby="diagnostics-heading"><h2 id="diagnostics-heading">診断</h2><h3>findings</h3>${table(["severity", "blocking", "rule ID", "path", "line", "message"], findings)}<h3>artifact relation issues</h3>${table(["code", "message"], graphIssues)}<h3>対象外・不明情報</h3>${table(["note"], notes)}</section>`;
}

const filterScript = String.raw`const form=document.querySelector('[data-filters]');if(form)form.addEventListener('input',()=>{const query=form.querySelector('[name="query"]').value.toLocaleLowerCase();const type=form.querySelector('[name="type"]').value;const status=form.querySelector('[name="status"]').value;let visible=0;for(const row of document.querySelectorAll('[data-document-row]')){row.hidden=!row.textContent.toLocaleLowerCase().includes(query)||(type!==''&&row.dataset.type!==type)||(status!==''&&row.dataset.status!==status);if(!row.hidden)visible+=1;}document.querySelector('[data-result-count]').textContent=String(visible);});`;

export function renderDashboard(snapshot: DashboardSnapshot): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; connect-src 'none'"><title>文書駆動開発の進行状況</title><style>:root{color-scheme:light dark;font-family:system-ui,sans-serif}*{box-sizing:border-box}body{max-width:1200px;margin:auto;padding:24px;line-height:1.6;overflow-wrap:anywhere}nav,.metrics,form,.facts{display:flex;flex-wrap:wrap;gap:12px 16px}.metrics>div,.facts>div,.callout{padding:.5rem .8rem;border:1px solid #8792a2;border-radius:8px}.metrics dt,.facts dt{font-size:.85rem}.metrics dd,.facts dd{margin:0;font-size:1.25rem;font-weight:700}.table-scroll{max-width:100%;overflow:auto;border:1px solid #8792a2}table{border-collapse:collapse;width:100%;min-width:42rem}th,td{padding:8px;border-bottom:1px solid #888;text-align:left;vertical-align:top}code{white-space:normal;overflow-wrap:anywhere}pre,.graph-scroll{overflow:auto}[hidden]{display:none!important}:focus-visible{outline:3px solid #5879ff}svg{display:block;width:100%;min-width:760px;height:auto}.graph-scroll{max-width:100%}details{margin-block:1rem;padding:.5rem;border:1px solid #8792a2;border-radius:8px}.warning{font-weight:700;color:#a33}@media(max-width:640px){body{padding:12px}h1{font-size:1.6rem}.metrics>div{flex:1 1 8rem}}@media print{nav,form{display:none}details>*{display:block}}</style></head><body><header><h1>文書駆動開発の進行状況</h1><p><strong>repository:</strong> ${e(snapshot.repositoryName)} / <strong>対象:</strong> ${list(snapshot.requested.focus)} / <strong>開始:</strong> ${e(snapshot.startedAt)} / <strong>生成時点:</strong> ${e(snapshot.generatedAt)}</p><p>この画面は生成時点の状態です。更新するにはコマンドを再実行してください。</p></header><nav aria-label="セクション"><a href="#graph">Graph</a><a href="#tasks">タスク</a><a href="#documents">文書</a><a href="#diagnostics">診断</a></nav><main>${renderMetrics(snapshot)}<div class="graph-scroll">${renderGraph(snapshot)}</div>${renderPlans(snapshot)}${renderDocuments(snapshot)}${renderDiagnostics(snapshot)}</main><noscript>全情報を表示しています。絞り込みには JavaScript が必要です。</noscript><script>${filterScript}</script></body></html>`;
}
