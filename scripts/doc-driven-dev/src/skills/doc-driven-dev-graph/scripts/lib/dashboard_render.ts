import { documentBucket, summarizeTasks } from "./dashboard_model";
import type { DashboardSnapshot, InventoryItem } from "./dashboard_model";
import { renderExecutionSvg } from "./dashboard_svg";
import { buildTaskBoard } from "./dashboard_board";
import { picoClasslessCss } from "./pico_classless_css";

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
  return `<section id="graph" aria-labelledby="graph-heading"><h2 id="graph-heading">Graph</h2>${routeSummary}<p><strong>caller supplied signals:</strong> ${list(snapshot.requested.signals)}</p><p><strong>state signals:</strong> ${list(snapshot.state.signals)}</p><p><strong>hard blockers:</strong> ${list(snapshot.state.hardBlockers)}</p><details><summary>Execution Graph</summary>${renderExecutionSvg(snapshot.definition, { current: snapshot.requested.current, edgeId: route?.edgeId ?? null })}<ul class="graph-legend"><li><span class="legend-swatch swatch-node"></span>ノード</li><li><span class="legend-swatch swatch-current"></span>指定ノード（現在）</li><li><span class="legend-swatch swatch-edge"></span>選択 edge</li><li>ノードにカーソルを合わせると接続 edge が強調されます</li><li>kind: action / delegate / audit / terminal</li></ul></details><details><summary>全 graph node</summary>${table(["node ID", "kind", "delegate", "audits", "commit gate", "terminal", "reachable"], nodeRows, "node 0 件")}</details><details><summary>全 graph edge</summary>${table(["edge ID", "from", "to", "condition", "priority"], edgeRows)}</details><details><summary>gate</summary>${table(["gate", "status", "reasons"], gateRows, "gate 0 件")}</details><details><summary>Graph topology issues</summary>${table(["severity", "code", "node", "condition"], topologyRows)}</details></section>`;
}

function renderTaskBoard(snapshot: DashboardSnapshot, ids: ReadonlyMap<string, string>): string {
  const board = buildTaskBoard(snapshot.inventory, snapshot.plans);
  const coverageLabel = (coverage: string): string => coverage === "covered" ? "Graph 対象" : coverage === "no-plan" ? "plan 未所属" : "graph 未対応";
  const lanes = board.lanes.map((lane) => {
    const cards = lane.cards.map((card) => {
      const memberships = card.memberships.map((membership) => `<li><strong>plan:</strong> <code>${e(membership.plan)}</code><br><strong>dependencies:</strong> ${list(membership.dependencies)}<br><span class="badge">runnable: ${e(bool(membership.runnable))}</span> <span class="badge">resumable: ${e(bool(membership.resumable))}</span><br><strong>停止理由:</strong> ${list(membership.blockReasons)}</li>`).join("");
      const flags = card.memberships.length === 0 ? [] : [
        card.memberships.some((membership) => membership.runnable) ? "runnable" : "",
        card.memberships.some((membership) => membership.resumable) ? "resumable" : "",
        card.memberships.some((membership) => membership.blockReasons.length > 0) ? "blocked" : "",
      ].filter(Boolean);
      const readiness = flags.map((flag) => `<span class="badge badge-${flag}">${flag}</span>`).join(" ");
      const title = ids.has(card.path) ? `<a href="#${ids.get(card.path)}">${e(card.title)}</a>` : e(card.title);
      return `<article class="task-card" data-task-card data-task-path="${escapeHtml(card.path)}" data-readiness="${flags.join(" ")}"><h4>${title}</h4><p class="task-id"><code>${e(card.id)}</code></p><p><span class="status-badge status-${card.lane}">${e(card.status)}</span> <span class="coverage-badge">${e(coverageLabel(card.coverage))}</span>${readiness ? ` ${readiness}` : ""}</p><p class="task-path"><code>${e(card.path)}</code></p>${card.parseError ? `<p class="warning"><strong>parse error:</strong> ${e(card.parseError)}</p>` : ""}${memberships ? `<details class="membership-details"><summary>plan / 依存 (${card.memberships.length})</summary><ul class="membership-list">${memberships}</ul></details>` : `<p class="empty">plan membership なし。依存判定は不明です。</p>`}</article>`;
    }).join("");
    const label = `${e(lane.label)} <span class="lane-count" aria-label="${lane.cards.length} 件">${lane.cards.length}</span>`;
    const body = `<div class="lane-cards">${cards || `<p class="empty lane-empty">この lane にタスクはありません</p>`}</div>`;
    if (lane.status === "done" || lane.status === "wont-do") {
      return `<details class="kanban-lane lane-${lane.status}" data-kanban-lane="${lane.status}"><summary class="lane-heading">${label}</summary>${body}</details>`;
    }
    return `<section class="kanban-lane lane-${lane.status}" data-kanban-lane="${lane.status}" aria-labelledby="lane-${lane.status}-heading"><h3 id="lane-${lane.status}-heading">${label}</h3>${body}</section>`;
  }).join("");
  return `<section id="task-board" aria-labelledby="task-board-heading"><h2 id="task-board-heading">タスクボード</h2><p>タスクは文書のステータスごとに表示します。依存関係による実行可否はカード内で確認できます。done / wont-do レーンは折り畳まれています。</p><form data-board-filters><label>readiness <select name="readiness"><option value="">すべて</option><option value="runnable">runnable のみ</option><option value="resumable">resumable のみ</option><option value="blocked">blocked のみ</option></select></label></form><div class="kanban-scroll" tabindex="0" role="region" aria-label="タスク Kanban ボード"><div class="kanban-board">${lanes}</div></div></section>`;
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
  return `<section id="tasks" aria-labelledby="tasks-heading"><h2 id="tasks-heading">plan ごとのタスク</h2><p class="detail-toggle"><button type="button" data-open-all="#tasks">すべて開く</button> <button type="button" data-close-all="#tasks">すべて畳む</button></p>${body || "<p class=\"empty\">plan 0 件</p>"}</section>`;
}

function renderDocuments(snapshot: DashboardSnapshot): string {
  const inventory = [...snapshot.inventory].sort((left, right) => compare(left.path, right.path));
  const ids = documentAnchors(inventory);
  const types = [...new Set(inventory.map((row) => row.type).filter((value): value is string => value !== null))].sort(compare);
  const statuses = [...new Set(inventory.map((row) => row.status).filter((value): value is string => value !== null))].sort(compare);
  const rows = inventory.map((row) => {
    const bucket = row.kind === "unmanaged" ? "管理対象外" : ({ draft: "draft", proposed: "proposed", capturing: "capturing", other: "その他" })[documentBucket(row.status)];
    const searchText = [row.id, row.title, row.path].filter((value): value is string => value !== null).join(" ");
    const statusCell = row.status === null ? e(row.status) : `<span class="status-pill bucket-${documentBucket(row.status)}">${e(row.status)}</span>`;
    return `<tr id="${ids.get(row.path)}" data-document-row data-type="${e(row.type ?? "")}" data-status="${e(row.status ?? "")}" data-search-text="${escapeHtml(searchText)}"><td>${e(bucket)}</td><td>${e(row.id)}</td><td>${e(row.type)}</td><td>${e(row.title)}</td><td><code>${e(row.path)}</code></td><td>${statusCell}</td><td>${e(row.updated)}</td><td>${e(bool(row.graphCovered))}</td><td>${e(row.parseError)}</td></tr>`;
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
  return `<section id="diagnostics" aria-labelledby="diagnostics-heading"><h2 id="diagnostics-heading">診断</h2><p class="detail-toggle"><button type="button" data-open-all="#diagnostics">すべて開く</button> <button type="button" data-close-all="#diagnostics">すべて畳む</button></p><details${blockingCount > 0 ? " open" : ""}><summary>findings (${findings.length} / blocking ${blockingCount})</summary>${table(["severity", "blocking", "rule ID", "path", "line", "message"], findings)}</details><details><summary>artifact relation issues (${graphIssues.length})</summary>${table(["code", "message"], graphIssues)}</details><details><summary>対象外・不明情報 (${notes.length})</summary>${table(["note"], notes)}</details></section>`;
}

const filterScript = String.raw`(function(){
var form=document.querySelector('[data-filters]');
var apply=function(){if(!form)return;var query=form.querySelector('[name="query"]').value.toLocaleLowerCase();var type=form.querySelector('[name="type"]').value;var status=form.querySelector('[name="status"]').value;var visible=0;for(var row of document.querySelectorAll('[data-document-row]')){row.hidden=!(row.dataset.searchText||'').toLocaleLowerCase().includes(query)||(type!==''&&row.dataset.type!==type)||(status!==''&&row.dataset.status!==status);if(!row.hidden)visible+=1;}document.querySelector('[data-result-count]').textContent=String(visible);};
var sync=function(){if(!form)return;var p=new URLSearchParams();for(var k of['query','type','status']){var v=form.querySelector('[name="'+k+'"]').value;if(v)p.set(k,v);}var s=p.toString();history.replaceState(null,'',s?'#filter='+s:location.pathname+location.search);};
if(form){form.addEventListener('input',function(){apply();sync();});var m=location.hash.match(/^#filter=(.*)/);if(m){var p=new URLSearchParams(m[1]);for(var k of['query','type','status']){var v=p.get(k);if(v)form.querySelector('[name="'+k+'"]').value=v;}apply();}}
for(var b of document.querySelectorAll('[data-open-all],[data-close-all]')){b.addEventListener('click',function(btn){return function(){var sel=btn.dataset.openAll||btn.dataset.closeAll;var open=!!btn.dataset.openAll;for(var d of document.querySelectorAll(sel+' details'))d.open=open;};}(b));}
var bf=document.querySelector('[data-board-filters]');if(bf)bf.addEventListener('input',function(){var r=bf.querySelector('[name="readiness"]').value;for(var c of document.querySelectorAll('[data-task-card]')){c.hidden=r!==''&&(c.dataset.readiness||'').split(' ').indexOf(r)===-1;}});
for(var g of document.querySelectorAll('#graph svg g[data-node]')){(function(group){var edges=group.closest('svg').querySelectorAll('path.edge');group.addEventListener('mouseenter',function(){for(var p of edges){var hit=p.dataset.from===group.dataset.node||p.dataset.to===group.dataset.node;p.classList.toggle('edge-connected',hit);p.classList.toggle('edge-dim',!hit);}});group.addEventListener('mouseleave',function(){for(var p of edges)p.classList.remove('edge-connected','edge-dim');});})(g);}
for(var t of document.querySelectorAll('time[data-relative]')){var d=new Date(t.getAttribute('datetime')).getTime();if(!isNaN(d)){var s=Math.max(0,Math.round((Date.now()-d)/1000));var u=s<60?[s,'秒']:s<3600?[Math.floor(s/60),'分']:s<86400?[Math.floor(s/3600),'時間']:[Math.floor(s/86400),'日'];t.textContent+='（'+u[0]+u[1]+'前）';}}
if('IntersectionObserver' in window){var map=new Map();for(var a of document.querySelectorAll('nav a[href^="#"]'))map.set(a.getAttribute('href').slice(1),a);var obs=new IntersectionObserver(function(entries){for(var en of entries){var l=map.get(en.target.id);if(!l)continue;if(en.isIntersecting)l.setAttribute('aria-current','true');else l.removeAttribute('aria-current');}},{rootMargin:'-35% 0px -55% 0px'});for(var s2 of document.querySelectorAll('main section[id]'))obs.observe(s2);}
})();`;

const styles = String.raw`:root{color-scheme:light dark;--bg:#f5f7fb;--fg:#172033;--card:#fff;--border:#8792a2;--border-soft:#bcc5d3;--accent:#174ea6;--hover:#eef2f9;--zebra:#f7f9fc;--warn:#a33;--todo:#64748b;--progress:#2563eb;--blocked:#b42318;--done:#16803c;--wontdo:#7c3aed;--unknown:#b36b00;--attention-active:#fff6f5;--lane-bg:#e9eef5;--lane-progress-bg:#eaf2ff;--lane-blocked-bg:#fff0ee;--lane-done-bg:#ebf8ef;--lane-wontdo-bg:#f4efff;--lane-unknown-bg:#fff6df;--lane-empty:#ffffffaa;--shadow:#24324a18;--shadow-hover:#24324a30}
@media(prefers-color-scheme:dark){:root{--bg:#0f1420;--fg:#e2e8f2;--card:#1a2233;--border:#54617a;--border-soft:#3a4763;--accent:#8ab4ff;--hover:#232e45;--zebra:#1c2537;--warn:#ff8a8a;--todo:#8fa3bf;--progress:#6ea8ff;--blocked:#ff8a7e;--done:#4ed08a;--wontdo:#b18cff;--unknown:#e0a83c;--attention-active:#33201f;--lane-bg:#182033;--lane-progress-bg:#16233f;--lane-blocked-bg:#332022;--lane-done-bg:#16301f;--lane-wontdo-bg:#251b3d;--lane-unknown-bg:#332a16;--lane-empty:#ffffff14;--shadow:#00000055;--shadow-hover:#00000088}}
*{box-sizing:border-box}html,body{max-width:100%;overflow-x:hidden}body{max-width:1200px;margin:auto;padding:24px;line-height:1.6;overflow-wrap:anywhere;background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif}body>header,body>main{max-width:none;padding:0}a{color:var(--accent)}.skip-link{position:absolute;transform:translateY(-250%);left:12px;z-index:100;padding:.5rem .9rem;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--fg)}.skip-link:focus{transform:none;top:8px}nav{position:sticky;top:0;z-index:20;justify-content:flex-start;background:var(--bg);padding-block:.45rem;border-bottom:1px solid var(--border-soft)}nav,.metrics,form,.facts{display:flex;flex-wrap:wrap;gap:12px 16px}nav a[aria-current]{font-weight:700;text-decoration:underline;text-underline-offset:4px}.metrics>div,.facts>div,.callout{padding:.5rem .8rem;border:1px solid var(--border);border-radius:8px;background:var(--card)}.metrics dt,.facts dt{font-size:.85rem}.metrics dd,.facts dd{margin:0;font-size:1.25rem;font-weight:700;font-variant-numeric:tabular-nums}main>section{margin-block:1.5rem}main h2{border-bottom:2px solid var(--border-soft);padding-bottom:.35rem}.top-grid{display:grid;gap:1rem}@media(min-width:960px){.top-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}}input,select,button{font:inherit;color:var(--fg)}input,select{padding:.25rem .5rem;border:1px solid var(--border);border-radius:6px;background:var(--card)}button{padding:.25rem .7rem;border:1px solid var(--border);border-radius:6px;background:var(--card);cursor:pointer}button:hover{background:var(--hover)}form input:not([type=checkbox],[type=radio]),form select{width:auto}form input,form select{margin-bottom:0}.kanban-scroll{width:100%;max-width:100%;overflow-x:auto;padding:.25rem 0 1rem}.kanban-board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(17rem,1fr);gap:1rem;width:max-content;min-width:100%;align-items:start}.kanban-lane{display:flex;flex-direction:column;max-height:75vh;margin-block:0;padding:.75rem;border:1px solid var(--border-soft);border-top:5px solid var(--todo);border-radius:12px;background:var(--lane-bg)}.lane-cards{min-height:0;overflow-y:auto;display:grid;gap:.75rem}.lane-todo{border-top-color:var(--todo)}.lane-in-progress{border-top-color:var(--progress);background:var(--lane-progress-bg)}.lane-blocked{border-top-color:var(--blocked);background:var(--lane-blocked-bg)}.lane-done{border-top-color:var(--done);background:var(--lane-done-bg)}.lane-wont-do{border-top-color:var(--wontdo);background:var(--lane-wontdo-bg)}.lane-unknown{border-top-color:var(--unknown);background:var(--lane-unknown-bg)}.kanban-lane h3,.lane-heading{margin:.1rem 0 .75rem;font-size:1rem;font-weight:700}.lane-heading{cursor:pointer}.lane-count,.badge,.status-badge,.coverage-badge,.status-pill{display:inline-block;padding:.1rem .45rem;border:1px solid currentColor;border-radius:999px;font-size:.78rem}.lane-count{float:right}.status-todo{color:var(--todo)}.status-in-progress{color:var(--progress)}.status-blocked{color:var(--blocked)}.status-done{color:var(--done)}.status-wont-do{color:var(--wontdo)}.status-unknown{color:var(--unknown)}.bucket-draft{color:var(--unknown)}.bucket-proposed{color:var(--progress)}.bucket-capturing{color:var(--unknown)}.bucket-other{color:var(--todo)}.badge-runnable{color:var(--done)}.badge-resumable{color:var(--progress)}.badge-blocked{color:var(--blocked)}.badge-runnable::before{content:"▶ "}.badge-resumable::before{content:"↻ "}.badge-blocked::before{content:"✕ "}.task-card details{margin-block:.45rem;padding:.35rem .55rem}.attention{padding:.4rem .9rem;border:1px solid var(--border);border-radius:8px;background:var(--card)}.attention-active{border-color:var(--blocked);background:var(--attention-active)}.task-card{min-width:0;margin-bottom:0;padding:.8rem;border:1px solid var(--border-soft);border-radius:9px;background:var(--card);box-shadow:0 2px 7px var(--shadow);transition:transform .15s ease,box-shadow .15s ease}.task-card:hover{transform:translateY(-1px);box-shadow:0 4px 14px var(--shadow-hover)}.task-card h4,.task-card p{margin:.2rem 0 .55rem}.task-card a{color:var(--accent);font-weight:700}.task-id,.task-path{font-size:.85rem}.membership-list{margin:.6rem 0 0;padding-left:1.2rem}.membership-list li+li{margin-top:.55rem}.lane-empty{padding:.75rem;border:1px dashed #98a3b3;border-radius:8px;background:var(--lane-empty)}.table-scroll{max-width:100%;max-height:72vh;overflow:auto;border:1px solid var(--border)}table{border-collapse:collapse;width:100%;min-width:42rem}th,td{padding:8px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}thead th{position:sticky;top:0;z-index:1;background:var(--card)}tbody tr:nth-child(even){background:var(--zebra)}tbody tr:hover{background:var(--hover)}tr:target{display:table-row!important}code{white-space:normal;overflow-wrap:anywhere}pre,.graph-scroll{overflow:auto}[hidden]{display:none!important}:focus-visible{outline:3px solid #5879ff;outline-offset:2px}svg{display:block;width:100%;min-width:760px;height:auto}.graph-scroll{max-width:100%}.graph-legend{display:flex;flex-wrap:wrap;gap:.35rem 1.2rem;margin:.6rem 0 0;padding:0;list-style:none;font-size:.85rem}.legend-swatch{display:inline-block;width:.95rem;height:.85rem;margin-right:.3rem;border:2px solid var(--border);border-radius:3px;background:var(--card);vertical-align:-2px}.swatch-current{background:#fff1c2;border-color:#a15c00}.swatch-edge{height:0;border-width:0;border-top:4px solid #c02c5b;border-radius:0;background:none;vertical-align:2px}details{margin-block:1rem;padding:.5rem;border:1px solid var(--border);border-radius:8px;background:var(--card)}.warning{font-weight:700;color:var(--warn)}@media(prefers-reduced-motion:reduce){.task-card{transition:none}.task-card:hover{transform:none}}@media(max-width:640px){body{padding:12px}h1{font-size:1.6rem}.metrics>div{flex:1 1 8rem}.kanban-board{grid-auto-columns:minmax(min(17rem,calc(100vw - 40px)),calc(100vw - 40px))}}@media print{nav,form,.skip-link{display:none}.attention{break-inside:avoid}details>*{display:block}.kanban-scroll{overflow:visible}.kanban-board{display:block;width:auto}.kanban-lane{break-inside:avoid;max-height:none;margin-bottom:1rem}.lane-cards{overflow:visible}}`;

export function renderDashboard(snapshot: DashboardSnapshot): string {
  const ids = documentAnchors(snapshot.inventory);
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; connect-src 'none'"><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%232563eb'/%3E%3C/svg%3E"><title>文書駆動開発の進行状況</title><style>${picoClasslessCss}${styles}</style></head><body><a class="skip-link" href="#main">本文へ移動</a><header><h1>文書駆動開発の進行状況</h1><p><strong>repository:</strong> ${e(snapshot.repositoryName)} / <strong>対象:</strong> ${list(snapshot.requested.focus)} / <strong>開始:</strong> ${e(snapshot.startedAt)} / <strong>生成時点:</strong> <time datetime="${escapeHtml(snapshot.generatedAt)}" data-relative>${e(snapshot.generatedAt)}</time></p><p>この画面は生成時点の状態です。更新するにはコマンドを再実行してください。</p></header><nav aria-label="セクション"><a href="#attention">要対応</a><a href="#task-board">タスクボード</a><a href="#graph">Graph</a><a href="#tasks">タスク詳細</a><a href="#documents">文書</a><a href="#diagnostics">診断</a></nav><main id="main"><div class="top-grid">${renderAttention(snapshot)}${renderMetrics(snapshot)}</div>${renderTaskBoard(snapshot, ids)}<div class="graph-scroll">${renderGraph(snapshot)}</div>${renderPlans(snapshot)}${renderDocuments(snapshot)}${renderDiagnostics(snapshot)}</main><noscript>全情報を表示しています。絞り込みには JavaScript が必要です。</noscript><script>${filterScript}</script></body></html>`;
}
