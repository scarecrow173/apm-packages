import { documentBucket, summarizeTasks } from "./dashboard_model";
import type { DashboardSnapshot, InventoryItem } from "./dashboard_model";
import { renderExecutionSvg } from "./dashboard_svg";
import { buildTaskBoard } from "./dashboard_board";

export function escapeHtml(value: string): string {
  const escaped: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, (character) => escaped[character]);
}

const e = (value: unknown): string => escapeHtml(value === null || value === undefined || value === "" ? "未指定" : String(value));
const list = (values: readonly string[]): string => values.length ? values.map(e).join(", ") : "なし";
const bool = (value: boolean): string => value ? "はい" : "いいえ";
const compare = (left: string, right: string): number => left.localeCompare(right);

function documentAnchors(inventory: readonly InventoryItem[]): Map<string, string> {
  return new Map([...inventory].sort((left, right) => compare(left.path, right.path)).map((row, index) => [row.path, `doc-${index}`]));
}

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
    ["不明", summary.unknown], ["完了率 (done)", ratio], ["草案", countStatus("draft")],
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
      ["不明", selectedSummary.unknown], ["完了率 (done)", selectedRatio],
    ])}`;
  } else if (snapshot.requested.focus.length > 0 || snapshot.state.focus.length > 0) {
    focused = `<h3>選択中の plan・focus</h3><p>task graph 未解決: ${list(snapshot.state.focus.length > 0 ? snapshot.state.focus : snapshot.requested.focus)}</p>`;
  } else {
    focused = "<h3>選択中の plan・focus</h3><p>選択対象なし。focus は未指定です。</p>";
  }
  return `<section aria-labelledby="summary-heading"><h2 id="summary-heading">概要</h2><h3>リポジトリ全体</h3>${metricList(metrics)}${focused}</section>`;
}

function renderAttention(snapshot: DashboardSnapshot): string {
  const blockingFindings = snapshot.findings.filter((finding) => finding.blocking);
  const taskIssues = snapshot.plans.flatMap((plan) => plan.graph.issues.map((issue) => ({ plan: plan.path, issue })));
  const routeBlockedReasons = snapshot.decision?.route.status === "blocked"
    ? (snapshot.decision.explanation?.blockedReasons ?? [])
    : [];
  const items = [
    ...snapshot.state.hardBlockers.map((blocker) => `<li><strong>hard blocker:</strong> ${e(blocker)}</li>`),
    ...routeBlockedReasons.map((reason) => `<li><strong>route blocked:</strong> ${e(reason)}</li>`),
    ...blockingFindings.map((finding) => `<li><strong>blocking finding:</strong> <code>${e(finding.ruleId)}</code> <code>${e(finding.path)}</code>${finding.line === null ? "" : `:${e(finding.line)}`} — ${e(finding.message)}</li>`),
    ...taskIssues.map(({ plan, issue }) => `<li><strong>task graph:</strong> <code>${e(plan)}</code> <code>${e(issue.code)}</code> — ${e(issue.message)} (tasks: ${list(issue.tasks)})</li>`),
  ];
  const body = items.length === 0
    ? `<p class="empty">進行を止める項目はありません</p>`
    : `<ul>${items.join("")}</ul>`;
  return `<section id="attention" class="${items.length === 0 ? "attention" : "attention attention-active"}" aria-labelledby="attention-heading"><h2 id="attention-heading">要対応</h2><p>hard blockers: ${snapshot.state.hardBlockers.length} / route blocked reasons: ${routeBlockedReasons.length} / blocking findings: ${blockingFindings.length} / task graph issues: ${taskIssues.length}</p>${body}</section>`;
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
  const terminalNodes = new Set(snapshot.definition.terminalNodes);
  const reachableNodes = new Set(snapshot.definition.reachableNodes);
  const nodeRows = [...snapshot.definition.nodes].sort((left, right) => compare(left.nodeId, right.nodeId))
    .map((node) => [
      e(node.nodeId), e(node.kind), e(node.delegate), list(node.audits),
      e(bool(node.commitGate === true)), e(bool(terminalNodes.has(node.nodeId))), e(bool(reachableNodes.has(node.nodeId))),
    ]);
  const edgeRows = [...snapshot.definition.edges].sort((left, right) => compare(left.from, right.from) || left.priority - right.priority || compare(left.id, right.id))
    .map((edge) => [e(edge.id), e(edge.from), e(edge.to), e(edge.when), e(edge.priority)]);
  const topologyRows = snapshot.definition.issues.map((issue) => [e(issue.severity), e(issue.code), e(issue.nodeId), e(issue.condition)]);
  return `<section id="graph" aria-labelledby="graph-heading"><h2 id="graph-heading">Graph</h2>${routeSummary}<p><strong>caller supplied signals:</strong> ${list(snapshot.requested.signals)}</p><p><strong>state signals:</strong> ${list(snapshot.state.signals)}</p><p><strong>hard blockers:</strong> ${list(snapshot.state.hardBlockers)}</p><details><summary>Execution Graph</summary>${renderExecutionSvg(snapshot.definition, { current: snapshot.requested.current, edgeId: route?.edgeId ?? null })}</details><details><summary>全 graph node</summary>${table(["node ID", "kind", "delegate", "audits", "commit gate", "terminal", "reachable"], nodeRows, "node 0 件")}</details><details><summary>全 graph edge</summary>${table(["edge ID", "from", "to", "condition", "priority"], edgeRows)}</details><details><summary>gate</summary>${table(["gate", "status", "reasons"], gateRows, "gate 0 件")}</details><details><summary>Graph topology issues</summary>${table(["severity", "code", "node", "condition"], topologyRows)}</details></section>`;
}

function renderTaskBoard(snapshot: DashboardSnapshot, ids: ReadonlyMap<string, string>): string {
  const board = buildTaskBoard(snapshot.inventory, snapshot.plans);
  const coverageLabel = (coverage: string): string => coverage === "covered" ? "Graph 対象" : coverage === "no-plan" ? "plan 未所属" : "graph 未対応";
  const lanes = board.lanes.map((lane) => {
    const cards = lane.cards.map((card) => {
      const memberships = card.memberships.map((membership) => `<li><strong>plan:</strong> <code>${e(membership.plan)}</code><br><strong>dependencies:</strong> ${list(membership.dependencies)}<br><span class="badge">runnable: ${e(bool(membership.runnable))}</span> <span class="badge">resumable: ${e(bool(membership.resumable))}</span><br><strong>停止理由:</strong> ${list(membership.blockReasons)}</li>`).join("");
      const readiness = card.memberships.length === 0 ? "" : [
        card.memberships.some((membership) => membership.runnable) ? `<span class="badge badge-runnable">runnable</span>` : "",
        card.memberships.some((membership) => membership.resumable) ? `<span class="badge badge-resumable">resumable</span>` : "",
        card.memberships.some((membership) => membership.blockReasons.length > 0) ? `<span class="badge badge-blocked">blocked</span>` : "",
      ].filter(Boolean).join(" ");
      const title = ids.has(card.path) ? `<a href="#${ids.get(card.path)}">${e(card.title)}</a>` : e(card.title);
      return `<article class="task-card" data-task-card data-task-path="${escapeHtml(card.path)}"><h4>${title}</h4><p class="task-id"><code>${e(card.id)}</code></p><p><span class="status-badge">${e(card.status)}</span> <span class="coverage-badge">${e(coverageLabel(card.coverage))}</span>${readiness ? ` ${readiness}` : ""}</p><p class="task-path"><code>${e(card.path)}</code></p>${card.parseError ? `<p class="warning"><strong>parse error:</strong> ${e(card.parseError)}</p>` : ""}${memberships ? `<details class="membership-details"><summary>plan / 依存 (${card.memberships.length})</summary><ul class="membership-list">${memberships}</ul></details>` : `<p class="empty">plan membership なし。依存判定は不明です。</p>`}</article>`;
    }).join("");
    return `<section class="kanban-lane lane-${lane.status}" data-kanban-lane="${lane.status}" aria-labelledby="lane-${lane.status}-heading"><h3 id="lane-${lane.status}-heading">${e(lane.label)} <span class="lane-count" aria-label="${lane.cards.length} 件">${lane.cards.length}</span></h3><div class="lane-cards">${cards || `<p class="empty lane-empty">この lane にタスクはありません</p>`}</div></section>`;
  }).join("");
  return `<section id="task-board" aria-labelledby="task-board-heading"><h2 id="task-board-heading">タスクボード</h2><p>タスクは文書のステータスごとに表示します。依存関係による実行可否はカード内で確認できます。</p><div class="kanban-scroll" tabindex="0" role="region" aria-label="タスク Kanban ボード"><div class="kanban-board">${lanes}</div></div></section>`;
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
  const ids = documentAnchors(inventory);
  const types = [...new Set(inventory.map((row) => row.type).filter((value): value is string => value !== null))].sort(compare);
  const statuses = [...new Set(inventory.map((row) => row.status).filter((value): value is string => value !== null))].sort(compare);
  const rows = inventory.map((row) => {
    const bucket = row.kind === "unmanaged" ? "管理対象外" : ({ draft: "draft", proposed: "proposed", capturing: "capturing", other: "その他" })[documentBucket(row.status)];
    const searchText = [row.id, row.title, row.path].filter((value): value is string => value !== null).join(" ");
    return `<tr id="${ids.get(row.path)}" data-document-row data-type="${e(row.type ?? "")}" data-status="${e(row.status ?? "")}" data-search-text="${escapeHtml(searchText)}"><td>${e(bucket)}</td><td>${e(row.id)}</td><td>${e(row.type)}</td><td>${e(row.title)}</td><td><code>${e(row.path)}</code></td><td>${e(row.status)}</td><td>${e(row.updated)}</td><td>${e(bool(row.graphCovered))}</td><td>${e(row.parseError)}</td></tr>`;
  }).join("");
  const tableHtml = inventory.length === 0 ? "<p class=\"empty\">文書 0 件</p>" : `<div class="table-scroll" tabindex="0"><table><thead><tr><th>区分</th><th>ID</th><th>種別</th><th>title</th><th>canonical path</th><th>status</th><th>updated</th><th>graph covered</th><th>parse error</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  return `<section id="documents" aria-labelledby="documents-heading"><h2 id="documents-heading">草案とレビュー候補・文書</h2><form data-filters><label>検索 <input name="query" type="search" autocomplete="off" placeholder="ID / title / path"></label><label>種別 <select name="type"><option value="">すべて</option>${types.map((value) => `<option value="${e(value)}">${e(value)}</option>`).join("")}</select></label><label>status <select name="status"><option value="">すべて</option>${statuses.map((value) => `<option value="${e(value)}">${e(value)}</option>`).join("")}</select></label></form><p><span data-result-count aria-live="polite">${inventory.length}</span> 件</p>${tableHtml}<details><summary>文書内リンク (${inventory.length} 件)</summary><ul>${inventory.map((row) => `<li><a href="#${ids.get(row.path)}">${e(row.id ?? row.path)}</a></li>`).join("") || "<li>なし</li>"}</ul></details>${renderRelations(snapshot, ids)}</section>`;
}

function renderRelations(snapshot: DashboardSnapshot, ids: ReadonlyMap<string, string>): string {
  const anchor = (pathValue: string): string => ids.has(pathValue) ? `<a href="#${ids.get(pathValue)}">${e(pathValue)}</a>` : e(pathValue);
  const rows = snapshot.state.artifactGraph.edges.map((edge) => [
    anchor(edge.from), e(edge.relation), e(edge.kind),
    edge.to ? anchor(edge.to) : `<span class="warning">${edge.external ? "external" : "未解決"}</span>`,
  ]);
  return `<details><summary>文書間の関係</summary>${table(["from", "relation", "kind", "to"], rows)}</details>`;
}

function renderDiagnostics(snapshot: DashboardSnapshot): string {
  const findings = snapshot.findings.map((finding) => [e(finding.severity), e(bool(finding.blocking)), e(finding.ruleId), e(finding.path), e(finding.line), e(finding.message)]);
  const blockingCount = snapshot.findings.filter((finding) => finding.blocking).length;
  const graphIssues = snapshot.state.artifactGraph.issues.map((issue) => [e(issue.code), e(issue.message)]);
  const notes = snapshot.coverageNotes.map((note) => [e(note)]);
  return `<section id="diagnostics" aria-labelledby="diagnostics-heading"><h2 id="diagnostics-heading">診断</h2><details${blockingCount > 0 ? " open" : ""}><summary>findings (${findings.length} / blocking ${blockingCount})</summary>${table(["severity", "blocking", "rule ID", "path", "line", "message"], findings)}</details><details><summary>artifact relation issues (${graphIssues.length})</summary>${table(["code", "message"], graphIssues)}</details><details><summary>対象外・不明情報 (${notes.length})</summary>${table(["note"], notes)}</details></section>`;
}

const filterScript = String.raw`const form=document.querySelector('[data-filters]');if(form)form.addEventListener('input',()=>{const query=form.querySelector('[name="query"]').value.toLocaleLowerCase();const type=form.querySelector('[name="type"]').value;const status=form.querySelector('[name="status"]').value;let visible=0;for(const row of document.querySelectorAll('[data-document-row]')){row.hidden=!(row.dataset.searchText||'').toLocaleLowerCase().includes(query)||(type!==''&&row.dataset.type!==type)||(status!==''&&row.dataset.status!==status);if(!row.hidden)visible+=1;}document.querySelector('[data-result-count]').textContent=String(visible);});`;

export function renderDashboard(snapshot: DashboardSnapshot): string {
  const ids = documentAnchors(snapshot.inventory);
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; connect-src 'none'"><title>文書駆動開発の進行状況</title><style>:root{color-scheme:light;font-family:system-ui,sans-serif;color:#172033;background:#f5f7fb}*{box-sizing:border-box}html,body{max-width:100%;overflow-x:hidden}body{max-width:1200px;margin:auto;padding:24px;line-height:1.6;overflow-wrap:anywhere}nav,.metrics,form,.facts{display:flex;flex-wrap:wrap;gap:12px 16px}.metrics>div,.facts>div,.callout{padding:.5rem .8rem;border:1px solid #8792a2;border-radius:8px;background:#fff}.metrics dt,.facts dt{font-size:.85rem}.metrics dd,.facts dd{margin:0;font-size:1.25rem;font-weight:700}.kanban-scroll{width:100%;max-width:100%;overflow-x:auto;padding:.25rem 0 1rem}.kanban-board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(17rem,1fr);gap:1rem;width:max-content;min-width:100%}.kanban-lane{padding:.75rem;border:1px solid #bcc5d3;border-top:5px solid #64748b;border-radius:12px;background:#e9eef5}.lane-todo{border-top-color:#64748b}.lane-in-progress{border-top-color:#2563eb;background:#eaf2ff}.lane-blocked{border-top-color:#b42318;background:#fff0ee}.lane-done{border-top-color:#16803c;background:#ebf8ef}.lane-wont-do{border-top-color:#7c3aed;background:#f4efff}.lane-unknown{border-top-color:#b36b00;background:#fff6df}.kanban-lane h3{margin:.1rem 0 .75rem;font-size:1rem}.lane-count,.badge,.status-badge,.coverage-badge{display:inline-block;padding:.1rem .45rem;border:1px solid currentColor;border-radius:999px;font-size:.78rem}.lane-count{float:right}.badge-runnable{color:#16803c}.badge-resumable{color:#2563eb}.badge-blocked{color:#b42318}.task-card details{margin-block:.45rem;padding:.35rem .55rem}.attention{padding:.4rem .9rem;border:1px solid #98a3b3;border-radius:8px;background:#fff}.attention-active{border-color:#b42318;background:#fff6f5}.lane-cards{display:grid;gap:.75rem}.task-card{min-width:0;padding:.8rem;border:1px solid #c7cfda;border-radius:9px;background:#fff;box-shadow:0 2px 7px #24324a18}.task-card h4,.task-card p{margin:.2rem 0 .55rem}.task-card a{color:#174ea6;font-weight:700}.task-id,.task-path{font-size:.85rem}.membership-list{margin:.6rem 0 0;padding-left:1.2rem}.membership-list li+li{margin-top:.55rem}.lane-empty{padding:.75rem;border:1px dashed #98a3b3;border-radius:8px;background:#ffffffaa}.table-scroll{max-width:100%;overflow:auto;border:1px solid #8792a2}table{border-collapse:collapse;width:100%;min-width:42rem}th,td{padding:8px;border-bottom:1px solid #888;text-align:left;vertical-align:top}tr:target{display:table-row!important}code{white-space:normal;overflow-wrap:anywhere}pre,.graph-scroll{overflow:auto}[hidden]{display:none!important}:focus-visible{outline:3px solid #5879ff;outline-offset:2px}svg{display:block;width:100%;min-width:760px;height:auto}.graph-scroll{max-width:100%}details{margin-block:1rem;padding:.5rem;border:1px solid #8792a2;border-radius:8px;background:#fff}.warning{font-weight:700;color:#a33}@media(max-width:640px){body{padding:12px}h1{font-size:1.6rem}.metrics>div{flex:1 1 8rem}.kanban-board{grid-auto-columns:minmax(min(17rem,calc(100vw - 40px)),calc(100vw - 40px))}}@media print{nav,form{display:none}details>*{display:block}.kanban-scroll{overflow:visible}.kanban-board{display:block;width:auto}.kanban-lane{break-inside:avoid;margin-bottom:1rem}}</style></head><body><header><h1>文書駆動開発の進行状況</h1><p><strong>repository:</strong> ${e(snapshot.repositoryName)} / <strong>対象:</strong> ${list(snapshot.requested.focus)} / <strong>開始:</strong> ${e(snapshot.startedAt)} / <strong>生成時点:</strong> ${e(snapshot.generatedAt)}</p><p>この画面は生成時点の状態です。更新するにはコマンドを再実行してください。</p></header><nav aria-label="セクション"><a href="#attention">要対応</a><a href="#task-board">タスクボード</a><a href="#graph">Graph</a><a href="#tasks">タスク詳細</a><a href="#documents">文書</a><a href="#diagnostics">診断</a></nav><main>${renderAttention(snapshot)}${renderMetrics(snapshot)}${renderTaskBoard(snapshot, ids)}<div class="graph-scroll">${renderGraph(snapshot)}</div>${renderPlans(snapshot)}${renderDocuments(snapshot)}${renderDiagnostics(snapshot)}</main><noscript>全情報を表示しています。絞り込みには JavaScript が必要です。</noscript><script>${filterScript}</script></body></html>`;
}
