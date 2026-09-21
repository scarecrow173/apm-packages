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
  return `<div class="table-scroll" tabindex="0"><table class="striped"><thead><tr>${headers.map((header) => `<th scope="col">${e(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

type ChartSegment = { label: string; count: number; cls: string; sw: string };

function donutChart(segments: ChartSegment[], centerValue: string, centerLabel: string): string {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const arcs = total === 0
    ? `<circle cx="70" cy="70" r="${radius}" class="donut-seg donut-empty"/>`
    : segments.filter((segment) => segment.count > 0).map((segment) => {
      const length = (segment.count / total) * circumference;
      const arc = `<circle cx="70" cy="70" r="${radius}" class="donut-seg ${segment.cls}" stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"><title>${e(segment.label)}: ${segment.count}</title></circle>`;
      offset += length;
      return arc;
    }).join("");
  return `<div class="donut-wrap"><svg viewBox="0 0 140 140" class="donut" role="img" aria-label="${e(centerLabel)}"><g transform="rotate(-90 70 70)">${arcs}</g><text x="70" y="66" text-anchor="middle" class="donut-value">${e(centerValue)}</text><text x="70" y="86" text-anchor="middle" class="donut-label">${e(centerLabel)}</text></svg><ul class="chart-legend">${segments.map((segment) => `<li><span class="legend-swatch" style="background:${segment.sw};border-color:${segment.sw}"></span>${e(segment.label)} <strong>${segment.count}</strong></li>`).join("")}</ul></div>`;
}

function hbarChart(rows: ChartSegment[]): string {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return `<ul class="hbars">${rows.map((row) => `<li><span class="hbar-label">${e(row.label)}</span><span class="hbar-track"><span class="hbar-fill ${row.cls}" style="width:${(row.count / max * 100).toFixed(1)}%"><title>${row.count}</title></span></span><span class="hbar-count">${row.count}</span></li>`).join("")}</ul>`;
}

function gaugeBar(ratio: number | null, numerator: number, denominator: number): string {
  if (ratio === null) return `<p class="empty">対象なし</p>`;
  const pct = Math.round(ratio * 100);
  return `<div class="gauge" role="img" aria-label="${pct}%"><span class="gauge-fill" style="width:${pct}%"></span></div><p class="gauge-note"><strong>${pct}%</strong> (${numerator} / ${denominator})</p>`;
}

function stackedBar(segments: ChartSegment[], emptyLabel: string): string {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  if (total === 0) return `<p class="empty">${e(emptyLabel)}</p>`;
  return `<div class="stack-bar" role="img" aria-label="${total} 件">${segments.filter((segment) => segment.count > 0).map((segment) => `<span class="stack-seg ${segment.cls}" style="width:${(segment.count / total * 100).toFixed(1)}%"><title>${e(segment.label)}: ${segment.count}</title></span>`).join("")}</div><ul class="chart-legend">${segments.map((segment) => `<li><span class="legend-swatch" style="background:${segment.sw};border-color:${segment.sw}"></span>${e(segment.label)} <strong>${segment.count}</strong></li>`).join("")}</ul>`;
}

function renderMetrics(snapshot: DashboardSnapshot): string {
  const canonicalTasks = snapshot.inventory.filter((row) => row.kind === "canonical" && row.type === "task");
  const summary = summarizeTasks(canonicalTasks);
  const canonicalDocuments = snapshot.inventory.filter((row) => row.kind === "canonical" && row.parseError === null);
  const countStatus = (status: string): number => canonicalDocuments.filter((row) => row.status === status).length;
  const ratio = summary.doneRatio === null ? "対象タスクなし" : `${Math.round(summary.doneRatio * 100)}%`;
  const metrics: Array<[string, string | number, string]> = [
    ["残存", summary.remaining, "accent-progress"], ["完了", summary.done, "accent-done"],
    ["対応しない", summary.wontDo, "accent-wontdo"], ["不明", summary.unknown, "accent-unknown"],
    ["完了率 (done)", ratio, "accent-done"], ["草案", countStatus("draft"), "accent-draft"],
    ["レビュー候補", countStatus("proposed"), "accent-progress"], ["記録中", countStatus("capturing"), "accent-capturing"],
    ["blocking findings", snapshot.health.blocking, "accent-blocked"],
  ];
  return `<section id="overview" aria-labelledby="summary-heading"><h2 id="summary-heading">概要</h2><h3>リポジトリ全体</h3><dl class="stat-grid">${metrics.map(([label, value, cls]) => `<div class="stat ${cls}"><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join("")}</dl></section>`;
}

function renderCharts(snapshot: DashboardSnapshot): string {
  const canonicalTasks = snapshot.inventory.filter((row) => row.kind === "canonical" && row.type === "task");
  const summary = summarizeTasks(canonicalTasks);
  const board = buildTaskBoard(snapshot.inventory, snapshot.plans);
  const laneVar: Record<string, string> = { todo: "--todo", "in-progress": "--progress", blocked: "--blocked", done: "--done", "wont-do": "--wontdo", unknown: "--unknown" };
  const laneColor = (status: string): string => `seg-${status.replace(/-/g, "")}`;
  const donut = donutChart(
    board.lanes.map((lane) => ({ label: lane.label.split(" /")[0], count: lane.cards.length, cls: laneColor(lane.status), sw: `var(${laneVar[lane.status]})` })),
    summary.doneRatio === null ? "—" : `${Math.round(summary.doneRatio * 100)}%`,
    "完了率"
  );

  const buckets = { draft: 0, proposed: 0, capturing: 0, other: 0, unmanaged: 0, parseError: 0 };
  for (const row of snapshot.inventory) {
    if (row.parseError !== null) buckets.parseError += 1;
    else if (row.kind === "unmanaged") buckets.unmanaged += 1;
    else buckets[documentBucket(row.status)] += 1;
  }
  const docBars = hbarChart([
    { label: "草案 (draft)", count: buckets.draft, cls: "fill-draft", sw: "var(--unknown)" },
    { label: "レビュー候補", count: buckets.proposed, cls: "fill-proposed", sw: "var(--progress)" },
    { label: "記録中", count: buckets.capturing, cls: "fill-capturing", sw: "var(--accent)" },
    { label: "その他 canonical", count: buckets.other, cls: "fill-other", sw: "var(--todo)" },
    { label: "管理対象外", count: buckets.unmanaged, cls: "fill-unmanaged", sw: "var(--border)" },
    { label: "parse error", count: buckets.parseError, cls: "fill-parse", sw: "var(--blocked)" },
  ]);

  const canonicalRows = snapshot.inventory.filter((row) => row.kind === "canonical");
  const covered = canonicalRows.filter((row) => row.graphCovered).length;
  const coverage = gaugeBar(canonicalRows.length === 0 ? null : covered / canonicalRows.length, covered, canonicalRows.length);

  const severityCount = (severity: string): number => snapshot.findings.filter((finding) => finding.severity === severity).length;
  const findingsBar = stackedBar([
    { label: "error", count: severityCount("error"), cls: "fill-error", sw: "var(--blocked)" },
    { label: "warning", count: severityCount("warning"), cls: "fill-warning", sw: "var(--unknown)" },
    { label: "info", count: severityCount("info"), cls: "fill-info", sw: "var(--progress)" },
  ], "findings なし");

  const selected = snapshot.state.taskGraph;
  let focused: string;
  if (selected) {
    const selectedSummary = summarizeTasks(selected.nodes);
    const selectedRatio = selectedSummary.doneRatio === null ? "対象タスクなし" : `${Math.round(selectedSummary.doneRatio * 100)}%`;
    focused = `<p><strong>plan:</strong> <code>${e(selected.plan)}</code></p><dl class="facts">${[
      ["残存", selectedSummary.remaining], ["完了", selectedSummary.done], ["対応しない", selectedSummary.wontDo],
      ["不明", selectedSummary.unknown], ["完了率 (done)", selectedRatio],
    ].map(([label, value]) => `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join("")}</dl>`;
  } else if (snapshot.requested.focus.length > 0 || snapshot.state.focus.length > 0) {
    focused = `<p>task graph 未解決: ${list(snapshot.state.focus.length > 0 ? snapshot.state.focus : snapshot.requested.focus)}</p>`;
  } else {
    focused = "<p>選択対象なし。focus は未指定です。</p>";
  }

  return `<section id="charts" aria-labelledby="charts-heading"><h2 id="charts-heading">チャート</h2><div class="chart-grid"><div class="panel"><h3>タスク status 分布</h3>${donut}</div><div class="panel"><h3>文書の区分</h3>${docBars}</div><div class="panel"><h3>graph coverage（canonical 文書）</h3>${coverage}</div><div class="panel"><h3>findings severity</h3>${findingsBar}</div><div class="panel"><h3>選択中の plan・focus</h3>${focused}</div></div></section>`;
}

function renderBacklogStrip(snapshot: DashboardSnapshot, ids: ReadonlyMap<string, string>): string {
  const drafts = [...snapshot.inventory]
    .filter((row) => row.kind === "canonical" && row.status === "draft")
    .sort((left, right) => compare(left.type ?? "", right.type ?? "") || compare(left.path, right.path));
  const cards = drafts.map((row) => {
    const title = ids.has(row.path) ? `<a href="#${ids.get(row.path)}">${e(row.title)}</a>` : e(row.title);
    return `<article class="task-card doc-card"><h4>${title}</h4><p><span class="status-pill bucket-draft">draft</span> <span class="coverage-badge">${e(row.type)}</span></p><p class="task-id"><code>${e(row.id)}</code></p><p class="task-path"><code>${e(row.path)}</code></p><p class="task-id">updated: ${e(row.updated)}</p></article>`;
  }).join("");
  return `<div id="backlog" class="backlog-strip"><h3>検討・着手候補（draft 文書）</h3><p>status が draft の canonical 文書です。今後レビュー・着手する対象として一覧します（${drafts.length} 件）。</p><div class="backlog-grid">${cards || `<p class="empty">draft 文書はありません</p>`}</div></div>`;
}

function renderAttention(snapshot: DashboardSnapshot): string {
  const blockingFindings = snapshot.findings.filter((finding) => finding.blocking);
  const taskIssues = snapshot.plans.flatMap((plan) => plan.graph.issues.map((issue) => ({ plan: plan.path, issue })));
  const routeBlockedReasons = snapshot.decision?.route.status === "blocked"
    ? (snapshot.decision.explanation?.blockedReasons ?? [])
    : [];
  const groups = [
    { label: "hard blockers", items: snapshot.state.hardBlockers.map((blocker) => `<li>${e(blocker)}</li>`) },
    { label: "route blocked", items: routeBlockedReasons.map((reason) => `<li>${e(reason)}</li>`) },
    { label: "blocking findings", items: blockingFindings.map((finding) => `<li><code>${e(finding.ruleId)}</code> <code>${e(finding.path)}</code>${finding.line === null ? "" : `:${e(finding.line)}`} — ${e(finding.message)}</li>`) },
    { label: "task graph issues", items: taskIssues.map(({ plan, issue }) => `<li><code>${e(plan)}</code> <code>${e(issue.code)}</code> — ${e(issue.message)} (tasks: ${list(issue.tasks)})</li>`) },
  ];
  const total = groups.reduce((count, group) => count + group.items.length, 0);
  const body = total === 0
    ? `<p class="empty">進行を止める項目はありません</p>`
    : `<div class="attention-groups">${groups.map((group) => `<div class="attention-group${group.items.length === 0 ? " attention-empty" : ""}"><h3>${e(group.label)} <span class="lane-count" aria-label="${group.items.length} 件">${group.items.length}</span></h3>${group.items.length === 0 ? `<p class="empty">なし</p>` : `<ul>${group.items.join("")}</ul>`}</div>`).join("")}</div>`;
  return `<section id="attention" class="${total === 0 ? "attention" : "attention attention-active"}" aria-labelledby="attention-heading"><h2 id="attention-heading">要対応</h2><p>進行を止めている項目を種別ごとに集約します（${total} 件）。</p>${body}</section>`;
}

function renderGraph(snapshot: DashboardSnapshot): string {
  const decision = snapshot.decision;
  const route = decision?.route;
  const explanation = decision?.explanation;
  const chips = (values: readonly string[], danger = false): string => values.length === 0
    ? `<span class="empty">なし</span>`
    : values.map((value) => `<span class="chip${danger ? " chip-danger" : ""}">${e(value)}</span>`).join(" ");
  const statusPill = (status: string | null | undefined): string => {
    const cls = status === "blocked" ? "status-blocked" : status === "terminal" ? "status-done" : "status-in-progress";
    return `<span class="status-pill ${cls}">${e(status)}</span>`;
  };
  const routeSummary = !decision
    ? "<p><strong>現在ノード未指定</strong>。遷移プレビューは評価していません。</p>"
    : `<div class="callout"><h3>遷移プレビュー（指定条件からの評価）</h3><dl class="facts"><div><dt>現在ノード</dt><dd>${e(route?.current)}</dd></div><div><dt>route status</dt><dd>${statusPill(route?.status)}</dd></div><div><dt>次ノード</dt><dd>${e(route?.next)}</dd></div><div><dt>edge</dt><dd>${e(route?.edgeId)}</dd></div><div><dt>condition</dt><dd>${e(route?.condition)}</dd></div><div><dt>delegate</dt><dd>${e(route?.delegate)}</dd></div></dl><p><strong>required audits:</strong> ${chips(route?.requiredAudits ?? [])}</p><p><strong>commit gate:</strong> ${e(bool(route?.commitGate ?? false))}</p><p><strong>hard blockers:</strong> ${chips(explanation?.hardBlockers ?? [], true)}</p><p><strong>blocked reasons:</strong> ${chips(explanation?.blockedReasons ?? [], true)}</p></div>`;
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
  return `<section id="graph" aria-labelledby="graph-heading"><h2 id="graph-heading">Graph</h2>${routeSummary}<p><strong>caller supplied signals:</strong> ${chips(snapshot.requested.signals)}</p><p><strong>state signals:</strong> ${chips(snapshot.state.signals)}</p><p><strong>hard blockers:</strong> ${chips(snapshot.state.hardBlockers, true)}</p><details><summary>Execution Graph</summary>${renderExecutionSvg(snapshot.definition, { current: snapshot.requested.current, edgeId: route?.edgeId ?? null })}<ul class="graph-legend"><li><span class="legend-swatch swatch-node"></span>ノード</li><li><span class="legend-swatch swatch-current"></span>指定ノード（現在）</li><li><span class="legend-swatch swatch-edge"></span>選択 edge</li><li>ノードにカーソルを合わせると接続 edge が強調されます</li><li>kind: action / delegate / audit / terminal</li></ul></details><details><summary>全 graph node</summary>${table(["node ID", "kind", "delegate", "audits", "commit gate", "terminal", "reachable"], nodeRows, "node 0 件")}</details><details><summary>全 graph edge</summary>${table(["edge ID", "from", "to", "condition", "priority"], edgeRows)}</details><details><summary>gate</summary>${table(["gate", "status", "reasons"], gateRows, "gate 0 件")}</details><details><summary>Graph topology issues</summary>${table(["severity", "code", "node", "condition"], topologyRows)}</details></section>`;
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
  return `<section id="task-board" aria-labelledby="task-board-heading"><h2 id="task-board-heading">タスクボード</h2><p>タスクは文書のステータスごとに表示します。依存関係による実行可否はカード内で確認できます。done / wont-do レーンは折り畳まれています。</p><form data-board-filters><label>readiness <select name="readiness"><option value="">すべて</option><option value="runnable">runnable のみ</option><option value="resumable">resumable のみ</option><option value="blocked">blocked のみ</option></select></label></form>${renderBacklogStrip(snapshot, ids)}<div class="kanban-scroll" tabindex="0" role="region" aria-label="タスク Kanban ボード"><div class="kanban-board">${lanes}</div></div></section>`;
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
    const statusPill = plan.status === null ? e(plan.status) : `<span class="status-pill status-${e(plan.status)}">${e(plan.status)}</span>`;
    return `<details><summary><code>${e(plan.path)}</code> — ${statusPill} done ${graph.completed.length}; 残存 ${graph.nodes.filter((node) => ["todo", "in-progress", "blocked"].includes(node.status)).length}; wont-do ${graph.nodes.filter((node) => node.status === "wont-do").length}</summary><h4>タスク</h4>${table(["ID", "canonical path", "task status", "depends on", "blocks", "依存上 runnable", "active", "resumable active", "停止理由"], nodes)}<h4>dependency edges</h4>${table(["from", "to"], edges)}<h4>task issues</h4>${table(["code", "message", "tasks"], issues)}</details>`;
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
  const tableHtml = inventory.length === 0 ? "<p class=\"empty\">文書 0 件</p>" : `<div class="table-scroll" tabindex="0"><table class="striped"><thead><tr><th>区分</th><th>ID</th><th>種別</th><th>title</th><th>canonical path</th><th>status</th><th>updated</th><th>graph covered</th><th>parse error</th></tr></thead><tbody>${rows}</tbody></table></div>`;
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
var themeBtn=document.getElementById('theme-toggle');var themeKey='doc-dashboard-theme';
var applyTheme=function(t){if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;else delete document.documentElement.dataset.theme;if(themeBtn){var dark=(document.documentElement.dataset.theme||'')==='dark'||(!document.documentElement.dataset.theme&&matchMedia('(prefers-color-scheme: dark)').matches);themeBtn.setAttribute('aria-pressed',String(dark));themeBtn.textContent=dark?'dark':'light';}};
var toggleTheme=function(){var cur=document.documentElement.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');var next=cur==='dark'?'light':'dark';try{localStorage.setItem(themeKey,next);}catch(e){}applyTheme(next);};
if(themeBtn)themeBtn.addEventListener('click',toggleTheme);
document.addEventListener('keydown',function(ev){if(ev.key.toLowerCase()==='t'&&!ev.ctrlKey&&!ev.metaKey&&!ev.altKey&&!(ev.target instanceof HTMLInputElement)&&!(ev.target instanceof HTMLSelectElement)&&!(ev.target instanceof HTMLTextAreaElement))toggleTheme();});
applyTheme(document.documentElement.dataset.theme||'');
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',function(){try{if(!localStorage.getItem(themeKey))applyTheme('');}catch(e){applyTheme('');}});
})();`;

const themeScript = String.raw`(function(){try{var t=localStorage.getItem('doc-dashboard-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;}catch(e){}})();`;

const darkVars = String.raw`--todo:#8fa3bf;--progress:#6ea8ff;--blocked:#ff8a7e;--done:#4ed08a;--wontdo:#b18cff;--unknown:#e0a83c;--attention-active:#33201f;--lane-progress-bg:#16233f;--lane-blocked-bg:#332022;--lane-done-bg:#16301f;--lane-wontdo-bg:#251b3d;--lane-unknown-bg:#332a16;--lane-empty:#ffffff14;--shadow:#00000055;--shadow-hover:#00000088`;

const styles = String.raw`:root{color-scheme:light dark;--bg:var(--pico-background-color);--fg:var(--pico-color);--muted:var(--pico-muted-color);--card:var(--pico-card-background-color);--border:var(--pico-muted-border-color);--border-soft:var(--pico-card-border-color);--accent:var(--pico-primary);--hover:var(--pico-secondary-background);--warn:var(--pico-del-color);--todo:#64748b;--progress:#2563eb;--blocked:#b42318;--done:#16803c;--wontdo:#7c3aed;--unknown:#b36b00;--attention-active:#fff6f5;--lane-bg:var(--pico-secondary-background);--lane-progress-bg:#eaf2ff;--lane-blocked-bg:#fff0ee;--lane-done-bg:#ebf8ef;--lane-wontdo-bg:#f4efff;--lane-unknown-bg:#fff6df;--lane-empty:#ffffffaa;--shadow:#24324a18;--shadow-hover:#24324a30}
[data-theme="dark"]{${darkVars}}@media(prefers-color-scheme:dark){:root:not([data-theme]){${darkVars}}}
html,body{max-width:100%;overflow-x:hidden}body{max-width:1200px;margin:auto;padding:24px;overflow-wrap:anywhere}body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background-image:linear-gradient(color-mix(in srgb,var(--border) 32%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--border) 32%,transparent) 1px,transparent 1px);background-size:28px 28px;mask-image:radial-gradient(ellipse 120% 90% at 50% 0%,#000 25%,transparent 75%);-webkit-mask-image:radial-gradient(ellipse 120% 90% at 50% 0%,#000 25%,transparent 75%)}body>header,body>main,body>footer{max-width:none;padding:0}a{color:var(--accent)}.skip-link{position:absolute;transform:translateY(-250%);left:12px;z-index:100;padding:.5rem .9rem;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--fg)}.skip-link:focus{transform:none;top:8px}nav{position:sticky;top:0;z-index:20;justify-content:flex-start;background:color-mix(in srgb,var(--bg) 76%,transparent);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);padding-block:.45rem;border-bottom:1px solid var(--border-soft)}nav ul{flex-wrap:wrap;gap:2px 8px}nav,form,.facts{display:flex;flex-wrap:wrap;gap:12px 16px}nav a[aria-current]{font-weight:700;text-decoration:underline;text-underline-offset:4px}.theme-toggle{margin:0;padding:.2rem .7rem;border:1px solid var(--border);border-radius:999px;background:var(--card);color:var(--fg);font-size:.8rem;line-height:1.4;cursor:pointer}.theme-toggle:hover{background:var(--hover)}.header-row{display:flex;align-items:center;gap:.65rem}.header-row h1{margin:0}.pulse-dot{width:.65rem;height:.65rem;flex:none;border-radius:50%;background:var(--done);box-shadow:0 0 0 4px color-mix(in srgb,var(--done) 18%,transparent);animation:pulse-dot 2.4s ease-in-out infinite}.pulse-bad{background:var(--blocked);box-shadow:0 0 0 4px color-mix(in srgb,var(--blocked) 18%,transparent)}@keyframes pulse-dot{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.78);opacity:.6}}.subtitle{color:var(--muted);font-size:.9rem}.facts>div,.callout{padding:.5rem .8rem;border:1px solid var(--border);border-radius:8px;background:var(--card)}.callout{border-left:4px solid var(--accent);background:color-mix(in srgb,var(--accent) 5%,var(--card))}.callout h3{margin:.1rem 0 .6rem;font-size:.78rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}.chip{display:inline-block;padding:.12rem .55rem;border:1px solid var(--border);border-radius:999px;background:var(--card);font-family:var(--pico-font-family-monospace);font-size:.78rem}.chip-danger{color:var(--blocked);border-color:currentColor;background:color-mix(in srgb,currentColor 10%,transparent)}.facts dt{font-size:.85rem}.facts dd{margin:0;font-size:1.25rem;font-weight:700;font-variant-numeric:tabular-nums}main>section{margin-block:1.5rem}main h2{display:flex;align-items:center;gap:.55rem;border-bottom:2px solid var(--border-soft);padding-bottom:.35rem}main h2::before{content:"";width:.55rem;height:.55rem;flex:none;border-radius:.18rem;background:var(--accent)}footer{margin-top:2.2rem;padding-top:1rem;border-top:1px solid var(--border-soft);text-align:center;color:var(--muted)}.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.8rem;margin:0}.stat{padding:.55rem .9rem;border:1px solid var(--border-soft);border-left:4px solid var(--stat-accent,var(--border));border-radius:8px;background:color-mix(in srgb,var(--stat-accent,var(--border)) 7%,var(--card))}.stat dt{font-size:.8rem;color:var(--muted)}.stat dd{margin:0;font-size:1.5rem;font-weight:700;font-family:var(--pico-font-family-monospace);font-variant-numeric:tabular-nums}.accent-progress{--stat-accent:var(--progress)}.accent-done{--stat-accent:var(--done)}.accent-wontdo{--stat-accent:var(--wontdo)}.accent-unknown{--stat-accent:var(--unknown)}.accent-blocked{--stat-accent:var(--blocked)}.accent-draft{--stat-accent:var(--unknown)}.accent-capturing{--stat-accent:var(--accent)}.chart-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}.panel{padding:.8rem 1rem;border:1px solid var(--border);border-radius:10px;background:var(--card)}.panel h3{margin:.1rem 0 .7rem;font-size:.95rem}.donut-wrap{display:flex;align-items:center;gap:1.2rem;flex-wrap:wrap}.donut{width:140px;height:140px;min-width:140px;flex:none}.donut-seg{fill:none;stroke-width:20}.donut-empty{stroke:var(--border-soft)}.donut-value{font-size:1.35rem;font-weight:700;fill:var(--fg)}.donut-label{font-size:.72rem;fill:var(--fg)}.chart-legend{list-style:none;margin:0;padding:0;display:grid;gap:.25rem;font-size:.85rem}.seg-todo{stroke:var(--todo);background:var(--todo)}.seg-inprogress{stroke:var(--progress);background:var(--progress)}.seg-blocked{stroke:var(--blocked);background:var(--blocked)}.seg-done{stroke:var(--done);background:var(--done)}.seg-wontdo{stroke:var(--wontdo);background:var(--wontdo)}.seg-unknown{stroke:var(--unknown);background:var(--unknown)}.hbars{list-style:none;margin:0;padding:0;display:grid;gap:.45rem;font-size:.85rem}.hbars li{display:grid;grid-template-columns:8rem 1fr 2.2rem;align-items:center;gap:.6rem}.hbar-track{display:block;height:.95rem;border-radius:5px;background:var(--lane-bg);overflow:hidden}.hbar-fill{display:block;height:100%;border-radius:5px;min-width:0}.hbar-count{text-align:right;font-variant-numeric:tabular-nums}.fill-draft{background:var(--unknown)}.fill-proposed{background:var(--progress)}.fill-capturing{background:var(--accent)}.fill-other{background:var(--todo)}.fill-unmanaged{background:var(--border)}.fill-parse{background:var(--blocked)}.fill-error{background:var(--blocked)}.fill-warning{background:var(--unknown)}.fill-info{background:var(--progress)}.gauge{height:1.15rem;border-radius:7px;background:var(--lane-bg);overflow:hidden}.gauge-fill{display:block;height:100%;background:var(--done)}.gauge-note{margin:.45rem 0 0;font-size:.85rem}.stack-bar{display:flex;height:1.15rem;border-radius:7px;overflow:hidden;background:var(--lane-bg)}.stack-seg{display:block;height:100%}.backlog-strip{margin-block:.8rem;padding:.7rem .9rem;border:1px solid var(--border-soft);border-radius:10px;background:color-mix(in srgb,var(--card) 82%,transparent)}.backlog-strip h3{margin:.1rem 0 .4rem;font-size:.95rem}.backlog-strip>p{margin:.2rem 0 .5rem;font-size:.85rem;color:var(--muted)}.backlog-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(16rem,1fr));gap:.75rem}form input:not([type=checkbox],[type=radio]),form select{width:auto}form input,form select,form label{margin-bottom:0}form[data-filters]{padding:.6rem .8rem;border:1px solid var(--border-soft);border-radius:10px;background:color-mix(in srgb,var(--card) 82%,transparent)}[data-result-count]{font-family:var(--pico-font-family-monospace);font-weight:700}.detail-toggle{margin-block:.4rem}.detail-toggle button{margin:0;padding:.3rem .8rem;border:1px solid var(--border);border-radius:999px;background:var(--card);color:var(--fg);font-size:.8rem;cursor:pointer}.detail-toggle button:hover{background:var(--hover)}.kanban-scroll{width:100%;max-width:100%;overflow-x:auto;padding:.25rem 0 1rem}.kanban-board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(17rem,1fr);gap:1rem;width:max-content;min-width:100%;align-items:start}.kanban-lane{display:flex;flex-direction:column;max-height:75vh;margin-block:0;padding:.75rem;border:1px solid var(--border-soft);border-top:5px solid var(--todo);border-radius:12px;background:var(--lane-bg)}.lane-cards{min-height:0;overflow-y:auto;display:grid;gap:.75rem}.lane-todo{border-top-color:var(--todo)}.lane-in-progress{border-top-color:var(--progress);background:var(--lane-progress-bg)}.lane-blocked{border-top-color:var(--blocked);background:var(--lane-blocked-bg)}.lane-done{border-top-color:var(--done);background:var(--lane-done-bg)}.lane-wont-do{border-top-color:var(--wontdo);background:var(--lane-wontdo-bg)}.lane-unknown{border-top-color:var(--unknown);background:var(--lane-unknown-bg)}.kanban-lane h3,.lane-heading{margin:.1rem 0 .75rem;font-size:1rem;font-weight:700}.lane-heading{cursor:pointer;padding:.15rem .2rem}.lane-count,.badge,.status-badge,.coverage-badge,.status-pill{display:inline-block;padding:.1rem .45rem;border:1px solid currentColor;border-radius:999px;font-size:.78rem;background:color-mix(in srgb,currentColor 11%,transparent)}.lane-count{float:right}.status-todo{color:var(--todo)}.status-in-progress{color:var(--progress)}.status-blocked{color:var(--blocked)}.status-done{color:var(--done)}.status-wont-do{color:var(--wontdo)}.status-unknown{color:var(--unknown)}.status-draft{color:var(--unknown)}.bucket-draft{color:var(--unknown)}.bucket-proposed{color:var(--progress)}.bucket-capturing{color:var(--unknown)}.bucket-other{color:var(--todo)}.badge-runnable{color:var(--done)}.badge-resumable{color:var(--progress)}.badge-blocked{color:var(--blocked)}.badge-runnable::before{content:"▶ "}.badge-resumable::before{content:"↻ "}.badge-blocked::before{content:"✕ "}.task-card details{margin-block:.45rem;padding:0}.task-card details>summary{padding:.35rem .55rem;font-size:.85rem;font-weight:600}.task-card details>:not(summary){margin-inline:.5rem}.doc-card{border-left:4px solid var(--unknown)}.attention{padding:.4rem .9rem;border:1px solid var(--border);border-radius:8px;background:var(--card)}.attention-groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}.attention-group{padding:.7rem .9rem;border:1px solid var(--border);border-left:4px solid var(--blocked);border-radius:10px;background:color-mix(in srgb,var(--blocked) 5%,var(--bg))}.attention-group h3{display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;margin:.1rem 0 .5rem;font-size:.95rem}.attention-group ul{margin:0;padding-inline-start:1.1rem}.attention-group li{margin-block:.35rem;font-size:.9rem}.attention-empty{border-left-color:var(--border);background:var(--bg);opacity:.55}.attention-active{border-color:var(--blocked);background:var(--attention-active)}.task-card{min-width:0;margin-bottom:0;padding:.8rem;border:1px solid var(--border-soft);border-radius:9px;background:var(--card);box-shadow:0 2px 7px var(--shadow);transition:transform .15s ease,box-shadow .15s ease}.task-card:hover{transform:translateY(-1px);box-shadow:0 4px 14px var(--shadow-hover)}.task-card h4,.task-card p{margin:.2rem 0 .55rem}.task-card a{color:var(--accent);font-weight:700}.task-id,.task-path{font-size:.85rem;color:var(--muted)}.facts dt,.gauge-note,.empty,.chart-legend{color:var(--muted)}.membership-list{margin:.6rem 0 0;padding-left:1.2rem}.membership-list li+li{margin-top:.55rem}.lane-empty{padding:.75rem;border:1px dashed var(--border);border-radius:8px;background:var(--lane-empty)}.table-scroll{max-width:100%;max-height:72vh;overflow:auto;border:1px solid var(--border);border-radius:8px}table{width:100%;min-width:42rem;margin-bottom:0}th,td{text-align:left;vertical-align:top}thead th{position:sticky;top:0;z-index:1;background:var(--bg);color:var(--muted);font-size:.8rem;font-weight:700;border-bottom:2px solid var(--border)}tbody tr:hover td,tbody tr:hover th{background:color-mix(in srgb,var(--accent) 5%,var(--hover))}tr:target{display:table-row!important}tr:target td,tr:target th{background:color-mix(in srgb,var(--accent) 10%,var(--card))!important}code{white-space:normal;overflow-wrap:anywhere}pre,.graph-scroll{overflow:auto}[hidden]{display:none!important}:focus-visible{outline:3px solid var(--accent);outline-offset:2px}svg{display:block;width:100%;min-width:760px;height:auto}.graph-scroll{max-width:100%}.graph-legend{display:flex;flex-wrap:wrap;gap:.35rem 1.2rem;margin:.6rem 0 0;padding:0;list-style:none;font-size:.85rem}.legend-swatch{display:inline-block;width:.95rem;height:.85rem;margin-right:.3rem;border:2px solid var(--border);border-radius:3px;background:var(--card);vertical-align:-2px}.swatch-current{background:#fff1c2;border-color:#a15c00}.swatch-edge{height:0;border-width:0;border-top:4px solid #c02c5b;border-radius:0;background:none;vertical-align:2px}details{margin-block:.8rem;padding:0;border:1px solid var(--border-soft);border-radius:10px;background:color-mix(in srgb,var(--card) 82%,transparent);overflow:hidden}details>summary{display:block;padding:.65rem .95rem;font-weight:600}details>summary:hover{background:var(--hover)}details[open]>summary{margin-bottom:0;border-bottom:1px solid var(--border-soft)}details>:not(summary){margin-inline:.95rem}details[open]>:not(summary){margin-top:.7rem}details>:not(summary):last-child{margin-bottom:.9rem}.warning{font-weight:700;color:var(--warn)}@media(prefers-reduced-motion:reduce){.task-card{transition:none}.task-card:hover{transform:none}.pulse-dot{animation:none}}@media(max-width:640px){body{padding:12px}h1{font-size:1.6rem}.stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.kanban-board{grid-auto-columns:minmax(min(17rem,calc(100vw - 40px)),calc(100vw - 40px))}}@media print{nav,form,.skip-link{display:none}body::before{display:none}.attention{break-inside:avoid}details>*{display:block}.table-scroll{max-height:none;overflow:visible}.kanban-scroll{overflow:visible}.kanban-board{display:block;width:auto}.kanban-lane{break-inside:avoid;max-height:none;margin-bottom:1rem}.lane-cards{overflow:visible}}`;

export function renderDashboard(snapshot: DashboardSnapshot): string {
  const ids = documentAnchors(snapshot.inventory);
  const hasBlocking = snapshot.state.hardBlockers.length > 0
    || snapshot.findings.some((finding) => finding.blocking)
    || snapshot.plans.some((plan) => plan.graph.issues.length > 0)
    || (snapshot.decision?.route.status === "blocked" && (snapshot.decision.explanation?.blockedReasons?.length ?? 0) > 0);
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; connect-src 'none'"><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%232563eb'/%3E%3C/svg%3E"><title>文書駆動開発の進行状況</title><script>${themeScript}</script><style>${picoClasslessCss}${styles}</style></head><body><a class="skip-link" href="#main">本文へ移動</a><header><div class="header-row"><span class="pulse-dot${hasBlocking ? " pulse-bad" : ""}" aria-hidden="true" title="${hasBlocking ? "要対応あり" : "ブロッカーなし"}"></span><h1>文書駆動開発の進行状況</h1></div><p class="subtitle"><strong>repository:</strong> ${e(snapshot.repositoryName)} / <strong>対象:</strong> ${list(snapshot.requested.focus)} / <strong>開始:</strong> ${e(snapshot.startedAt)} / <strong>生成時点:</strong> <time datetime="${escapeHtml(snapshot.generatedAt)}" data-relative>${e(snapshot.generatedAt)}</time></p></header><nav aria-label="セクション"><ul><li><a href="#overview">概要</a></li><li><a href="#charts">チャート</a></li><li><a href="#task-board">タスクボード</a></li><li><a href="#backlog">候補</a></li><li><a href="#graph">Graph</a></li><li><a href="#tasks">タスク詳細</a></li><li><a href="#documents">文書</a></li><li><a href="#attention">要対応</a></li><li><a href="#diagnostics">診断</a></li><li><button type="button" id="theme-toggle" class="theme-toggle" aria-pressed="false" title="テーマ切替 (T)">テーマ</button></li></ul></nav><main id="main">${renderMetrics(snapshot)}${renderCharts(snapshot)}${renderTaskBoard(snapshot, ids)}<div class="graph-scroll">${renderGraph(snapshot)}</div>${renderPlans(snapshot)}${renderDocuments(snapshot)}${renderAttention(snapshot)}${renderDiagnostics(snapshot)}</main><footer><small>この画面は生成時点の状態です。更新するにはコマンドを再実行してください。</small></footer><noscript>全情報を表示しています。絞り込みには JavaScript が必要です。</noscript><script>${filterScript}</script></body></html>`;
}
