import { documentBucket, summarizeTasks } from "./dashboard_model";
import type { DashboardSnapshot, InventoryItem } from "./dashboard_model";
import { renderExecutionSvg, nodeKindClass, nodeKindGlyphs, nodeFlowOrder } from "./dashboard_svg";
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

function renderAttention(snapshot: DashboardSnapshot, ids: ReadonlyMap<string, string>): string {
  const repairLabels: Record<string, string> = { safe: "自動修復可", migration: "移行", manual: "手動" };
  const location = (file: string | null, line: number | null): string => {
    if (file === null) return "";
    const text = `${e(file)}${line === null ? "" : `:${e(line)}`}`;
    const anchorId = ids.get(file);
    return anchorId === undefined ? `<code class="issue-loc">${text}</code>` : `<a class="issue-loc" href="#${anchorId}">${text}</a>`;
  };
  const issueRow = (message: string, meta: string): string => `<li class="issue-row"><span class="issue-main"><span class="issue-dot" aria-hidden="true"></span><span class="issue-msg">${message}</span></span>${meta === "" ? "" : `<span class="issue-meta">${meta}</span>`}</li>`;
  const reasonLabels: Record<string, string> = {
    "focus-required": "進行対象（focus）の指定が必要です",
    "focus-invalid": "指定された focus を解決できません",
    "duplicate-id": "文書 ID が重複しています",
    "followups-conflicting": "follow-up signal が競合しています",
    "artifact-graph": "artifact graph gate が未合格です",
    "no-matching-edge": "現在の状態に合う遷移 edge がありません",
  };
  const reasonRow = (code: string): string => {
    if (code.startsWith("required-gate:")) {
      const [gate, ...rest] = code.slice("required-gate:".length).split(":");
      const detail = rest.join(":");
      const sub = detail === "" ? "" : detail === "missing" ? "gate 未定義" : detail.startsWith("status-") ? `status: ${detail.slice(7)}` : detail;
      return issueRow(`前提 gate <code>${e(gate)}</code> が未合格です`, `<span class="issue-tag">required-gate</span>${sub === "" ? "" : `<span class="issue-sub">${e(sub)}</span>`}`);
    }
    if (code.startsWith("broken-relation:")) {
      const detail = code.slice("broken-relation:".length);
      const parsed = detail.match(/^(.*?) from (\S+) to (\S+) \((\S+)\)$/);
      if (parsed) {
        const kindMatch = parsed[1].match(/^Broken (\S+) relation$/);
        const message = kindMatch ? `${kindMatch[1]} 関係が解決できません` : parsed[1];
        return issueRow(e(message), [
          `<span class="issue-tag">broken-relation</span>`,
          location(parsed[2], null),
          `<span class="issue-sub">→ ${e(parsed[3])}</span>`,
        ].join(""));
      }
      return issueRow(e(detail), `<span class="issue-tag">broken-relation</span>`);
    }
    const label = reasonLabels[code];
    return issueRow(label === undefined ? `<code>${e(code)}</code>` : e(label), label === undefined ? "" : `<span class="issue-tag">${e(code)}</span>`);
  };

  const blockingFindings = snapshot.findings.filter((finding) => finding.blocking);
  const taskIssues = snapshot.plans.flatMap((plan) => plan.graph.issues.map((issue) => ({ plan: plan.path, issue })));
  const routeBlockedReasons = snapshot.decision?.route.status === "blocked"
    ? (snapshot.decision.explanation?.blockedReasons ?? [])
    : [];
  const findingRows = blockingFindings.map((finding) => issueRow(e(finding.message), [
    `<span class="issue-tag">${e(finding.category)} · ${e(finding.ruleId)}</span>`,
    location(finding.path, finding.line),
    finding.target === null ? "" : `<span class="issue-sub">→ ${e(finding.target)}</span>`,
    `<span class="issue-repair repair-${e(finding.repair)}">${e(repairLabels[finding.repair] ?? finding.repair)}</span>`,
  ].filter((part) => part !== "").join("")));
  const taskIssueRows = taskIssues.map(({ plan, issue }) => issueRow(e(issue.message), [
    `<span class="issue-tag">${e(issue.code)}</span>`,
    location(plan, null),
    `<span class="issue-sub">tasks: ${list(issue.tasks)}</span>`,
  ].join("")));
  const groups: Array<{ label: string; items: readonly string[] }> = [
    { label: "hard blockers", items: snapshot.state.hardBlockers.map(reasonRow) },
    { label: "route blocked", items: routeBlockedReasons.map(reasonRow) },
    { label: "blocking findings", items: findingRows },
    { label: "task graph issues", items: taskIssueRows },
  ];
  const total = groups.reduce((count, group) => count + group.items.length, 0);
  const groupBody = (group: { label: string; items: readonly string[] }): string => group.items.length === 0
    ? `<p class="empty">なし</p>`
    : `<ul class="issue-list">${group.items.join("")}</ul>`;
  const body = total === 0
    ? `<p class="empty">進行を止める項目はありません</p>`
    : `<div class="attention-groups">${groups.map((group) => `<div class="attention-group${group.items.length === 0 ? " attention-empty" : ""}"><h3>${e(group.label)} <span class="lane-count" aria-label="${group.items.length} 件">${group.items.length}</span></h3>${groupBody(group)}</div>`).join("")}</div>`;
  return `<section id="attention" class="${total === 0 ? "attention" : "attention attention-active"}" aria-labelledby="attention-heading"><h2 id="attention-heading">要対応</h2><p>進行を止めている項目を種別ごとに集約します（${total} 件）。</p>${body}</section>`;
}

function renderGraph(snapshot: DashboardSnapshot): string {
  const decision = snapshot.decision;
  const route = decision?.route;
  const explanation = decision?.explanation;
  const chip = (value: string, danger = false): string => `<span class="chip${danger ? " chip-danger" : ""}">${e(value)}</span>`;
  const chips = (values: readonly string[], danger = false): string => values.length === 0
    ? `<span class="empty">なし</span>`
    : values.map((value) => chip(value, danger)).join(" ");
  const statusPill = (status: string | null | undefined): string => {
    const cls = status === "blocked" ? "status-blocked" : status === "terminal" ? "status-done" : "status-in-progress";
    return `<span class="status-pill ${cls}">${e(status)}</span>`;
  };
  const probeNode = (nodeId: string | null | undefined): string => {
    const kind = snapshot.definition.nodes.find((node) => node.nodeId === nodeId)?.kind;
    const cls = kind === undefined ? "probe-node probe-unknown" : `probe-node ${nodeKindClass(kind)}`;
    const glyph = kind === undefined ? "?" : nodeKindGlyphs[kind] ?? "·";
    return `<span class="${cls}"><span class="probe-glyph" aria-hidden="true">${e(glyph)}</span>${e(nodeId)}</span>`;
  };
  const blocked = route?.status === "blocked";
  const stays = route !== null && route !== undefined && route.next === route.current;
  const probeLink = !route ? "" : stays
    ? `<span class="probe-link${blocked ? " probe-blocked" : ""}"><span class="probe-edge-label">no edge</span><span class="route-arrow" aria-hidden="true">${blocked ? "✕" : "→"}</span></span>`
    : `<span class="probe-link"><span class="probe-edge-label">${e(route.condition)}</span><span class="route-arrow" aria-hidden="true">→</span></span>`;
  const reasonRow = (explanation?.blockedReasons.length ?? 0) === 0
    ? ""
    : `<div class="signal-group"><span class="signal-label">blocked reasons</span>${chips(explanation?.blockedReasons ?? [], true)}</div>`;
  const routeSummary = !decision
    ? `<div class="callout route-probe probe-muted"><h3>遷移プレビュー</h3><p class="empty">現在ノード未指定。遷移プレビューは評価していません。</p></div>`
    : `<div class="callout route-probe"><h3>遷移プレビュー（指定条件からの評価）</h3><p class="route-path">${probeNode(route?.current)}${probeLink}${stays ? "" : probeNode(route?.next)} ${statusPill(route?.status)}</p><div class="signal-group"><span class="signal-label">route</span>${chip(`edge: ${route?.edgeId ?? "なし"}`)}${chip(`delegate: ${route?.delegate ?? "なし"}`)}${chip(`commit gate: ${bool(route?.commitGate ?? false)}`)}</div><div class="signal-group"><span class="signal-label">required audits</span>${chips(route?.requiredAudits ?? [])}</div>${reasonRow}</div>`;
  const nodeOrder = nodeFlowOrder(snapshot.definition);
  const gateEntries = Object.entries(snapshot.state.gates)
    .sort(([left], [right]) => (nodeOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (nodeOrder.get(right) ?? Number.MAX_SAFE_INTEGER) || compare(left, right));
  const passCount = gateEntries.filter(([, gate]) => gate.status === "pass").length;
  const topologyChips = snapshot.definition.issues.map((issue) => [issue.severity, issue.code, issue.nodeId, issue.condition].filter(Boolean).join(" "));
  const hardBlockerNote = snapshot.state.hardBlockers.length === 0
    ? `<p class="probe-note">hard blockers: なし</p>`
    : `<p class="probe-note probe-note-danger"><a href="#attention">hard blockers ${snapshot.state.hardBlockers.length} 件 → 要対応</a></p>`;
  const signalPanel = `<div class="probe-panel"><h3>signals</h3><div class="signal-group"><span class="signal-label">supplied</span>${chips(snapshot.requested.signals)}</div><div class="signal-group"><span class="signal-label">state</span>${chips(snapshot.state.signals)}</div>${topologyChips.length === 0 ? "" : `<div class="signal-group"><span class="signal-label">topology issues</span>${chips(topologyChips, true)}</div>`}${hardBlockerNote}</div>`;
  const gatePanel = `<div class="probe-panel"><h3>gates <span class="gate-score">${passCount}/${gateEntries.length} pass</span></h3>${gateEntries.length === 0 ? `<p class="empty">gate 評価なし</p>` : `<div class="gate-pills">${gateEntries.map(([name, gate]) => `<span class="gate-pill gate-${e(gate.status)}"${gate.reasons.length === 0 ? "" : ` title="${e(gate.reasons.join("; "))}"`}><span class="gate-dot" aria-hidden="true"></span>${e(name)}</span>`).join("")}</div>`}</div>`;
  const canvas = `<div class="graph-canvas"><div class="canvas-head"><span class="canvas-eyebrow">Execution Graph</span><span class="graph-meta">${e(snapshot.definition.graphId)} · ${snapshot.definition.nodes.length} nodes · ${snapshot.definition.edges.length} edges</span></div><div class="graph-stage">${renderExecutionSvg(snapshot.definition, { current: snapshot.requested.current, edgeId: route?.edgeId ?? null })}</div><ul class="graph-legend"><li><span class="legend-swatch sw-action"></span>action</li><li><span class="legend-swatch sw-delegate"></span>delegate</li><li><span class="legend-swatch sw-audit"></span>audit</li><li><span class="legend-swatch sw-terminal"></span>terminal</li><li><span class="legend-line sw-fwd"></span>前進遷移</li><li><span class="legend-line sw-back"></span>戻り・修復</li><li><span class="legend-line sw-retry"></span>リトライ</li><li><span class="legend-swatch swatch-current"></span>指定ノード（現在）</li><li><span class="legend-swatch swatch-edge"></span>選択 edge</li><li>ノードにカーソルを合わせると接続 edge が強調されます</li></ul></div>`;
  return `<section id="graph" aria-labelledby="graph-heading"><h2 id="graph-heading">Graph</h2><div class="probe-grid">${routeSummary}<div class="probe-side">${signalPanel}${gatePanel}</div></div>${canvas}</section>`;
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
    const nodes = [...graph.nodes].sort((left, right) => compare(left.path, right.path)).map((node) => {
      const flags = [
        graph.runnable.includes(node.id) ? `<span class="badge badge-runnable">runnable</span>` : "",
        graph.active.includes(node.id) ? `<span class="badge badge-resumable">active</span>` : "",
        graph.resumableActive.includes(node.id) ? `<span class="badge badge-resumable">resumable</span>` : "",
      ].filter(Boolean).join(" ");
      const deps = node.dependsOn.length === 0 ? "" : `<span class="row-meta">depends: ${list(node.dependsOn)}</span>`;
      const blocks = node.blocks.length === 0 ? "" : `<span class="row-meta">blocks: ${list(node.blocks)}</span>`;
      const reasons = (blocked.get(node.id) ?? []).map((reason) => `<span class="chip chip-danger">${e(reason)}</span>`).join(" ");
      return `<li class="row-item"><span class="status-pill status-${e(node.status)}">${e(node.status)}</span> <code>${e(node.id)}</code> <span class="row-title">${e(node.path)}</span> ${flags}${deps}${blocks}${reasons}</li>`;
    });
    const edges = graph.edges.map((edge) => `<span class="chip">${e(edge.from)} → ${e(edge.to)}</span>`);
    const issues = graph.issues.map((issue) => `<li class="row-item row-danger"><code>${e(issue.code)}</code> <span class="row-title">${e(issue.message)}</span> <span class="row-meta">${list(issue.tasks)}</span></li>`);
    const statusPill = plan.status === null ? e(plan.status) : `<span class="status-pill status-${e(plan.status)}">${e(plan.status)}</span>`;
    return `<details><summary><code>${e(plan.path)}</code> — ${statusPill} done ${graph.completed.length}; 残存 ${graph.nodes.filter((node) => ["todo", "in-progress", "blocked"].includes(node.status)).length}; wont-do ${graph.nodes.filter((node) => node.status === "wont-do").length}</summary><h4>タスク</h4>${nodes.length === 0 ? `<p class="empty">なし</p>` : `<ul class="row-list">${nodes.join("")}</ul>`}<h4>dependency edges</h4>${edges.length === 0 ? `<p class="empty">なし</p>` : `<div class="chip-line">${edges.join(" ")}</div>`}<h4>task issues</h4>${issues.length === 0 ? `<p class="empty">なし</p>` : `<ul class="row-list">${issues.join("")}</ul>`}</details>`;
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
    const statusPill = row.status === null ? e(row.status) : `<span class="status-pill bucket-${documentBucket(row.status)}">${e(row.status)}</span>`;
    const covered = row.graphCovered ? `<span class="badge badge-runnable">graph 対象</span>` : "";
    const parseError = row.parseError === null ? "" : `<span class="chip chip-danger">${e(row.parseError)}</span>`;
    return `<div class="doc-row" id="${ids.get(row.path)}" data-document-row data-type="${e(row.type ?? "")}" data-status="${e(row.status ?? "")}" data-search-text="${escapeHtml(searchText)}"><span class="doc-head"><span class="chip">${e(bucket)}</span> <strong class="doc-title">${e(row.title)}</strong> ${statusPill} <span class="doc-time">${e(row.updated)}</span></span><span class="doc-sub"><span class="muted">${e(row.id)}</span> <span class="muted">${e(row.type)}</span> <code class="doc-path">${e(row.path)}</code> ${covered}${parseError}</span></div>`;
  }).join("");
  const tableHtml = inventory.length === 0 ? "<p class=\"empty\">文書 0 件</p>" : `<div class="doc-list" tabindex="0">${rows}</div>`;
  return `<section id="documents" aria-labelledby="documents-heading"><h2 id="documents-heading">草案とレビュー候補・文書</h2><form data-filters><label>検索 <input name="query" type="search" autocomplete="off" placeholder="ID / title / path"></label><label>種別 <select name="type"><option value="">すべて</option>${types.map((value) => `<option value="${e(value)}">${e(value)}</option>`).join("")}</select></label><label>status <select name="status"><option value="">すべて</option>${statuses.map((value) => `<option value="${e(value)}">${e(value)}</option>`).join("")}</select></label></form><p><span data-result-count aria-live="polite">${inventory.length}</span> 件</p>${tableHtml}<details><summary>文書内リンク (${inventory.length} 件)</summary><ul>${inventory.map((row) => `<li><a href="#${ids.get(row.path)}">${e(row.id ?? row.path)}</a></li>`).join("") || "<li>なし</li>"}</ul></details>${renderRelations(snapshot, ids)}</section>`;
}

function renderRelations(snapshot: DashboardSnapshot, ids: ReadonlyMap<string, string>): string {
  const anchor = (pathValue: string): string => ids.has(pathValue) ? `<a href="#${ids.get(pathValue)}">${e(pathValue)}</a>` : e(pathValue);
  const items = snapshot.state.artifactGraph.edges.map((edge) => `<li class="row-item"><code>${anchor(edge.from)}</code> <span class="chip">${e(edge.relation)}</span> <span class="route-arrow" aria-hidden="true">→</span> ${edge.to ? `<code>${anchor(edge.to)}</code>` : `<span class="warning">${edge.external ? "external" : "未解決"}</span>`} <span class="row-meta">${e(edge.kind)}</span></li>`);
  return `<details><summary>文書間の関係</summary>${items.length === 0 ? `<p class="empty">なし</p>` : `<ul class="row-list">${items.join("")}</ul>`}</details>`;
}

function renderDiagnostics(snapshot: DashboardSnapshot): string {
  const severityClass = (severity: string): string => severity === "error" ? "status-blocked" : severity === "warning" ? "status-unknown" : "status-in-progress";
  const findings = snapshot.findings.map((finding) => `<li class="row-item${finding.severity === "error" ? " row-danger" : ""}"><span class="status-pill ${severityClass(finding.severity)}">${e(finding.severity)}</span>${finding.blocking ? ` <span class="badge badge-blocked">blocking</span>` : ""} <code>${e(finding.ruleId)}</code> <span class="row-title">${e(finding.message)}</span> <span class="row-meta">${e(finding.path)}${finding.line === null ? "" : `:${e(finding.line)}`}</span></li>`);
  const blockingCount = snapshot.findings.filter((finding) => finding.blocking).length;
  const graphIssues = snapshot.state.artifactGraph.issues.map((issue) => `<li class="row-item"><code>${e(issue.code)}</code> <span class="row-title">${e(issue.message)}</span></li>`);
  const notes = snapshot.coverageNotes.map((note) => `<li class="row-item">${e(note)}</li>`);
  const rows = (items: readonly string[]): string => items.length === 0 ? `<p class="empty">なし</p>` : `<ul class="row-list">${items.join("")}</ul>`;
  return `<section id="diagnostics" aria-labelledby="diagnostics-heading"><h2 id="diagnostics-heading">診断</h2><p class="detail-toggle"><button type="button" data-open-all="#diagnostics">すべて開く</button> <button type="button" data-close-all="#diagnostics">すべて畳む</button></p><details${blockingCount > 0 ? " open" : ""}><summary>findings (${findings.length} / blocking ${blockingCount})</summary>${rows(findings)}</details><details><summary>artifact relation issues (${graphIssues.length})</summary>${rows(graphIssues)}</details><details><summary>対象外・不明情報 (${notes.length})</summary>${rows(notes)}</details></section>`;
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

const darkVars = String.raw`--pico-background-color:#0a0d13;--pico-color:#e7eaf2;--pico-muted-color:#8a93a6;--pico-card-background-color:#121722;--pico-muted-border-color:#ffffff26;--pico-card-border-color:#ffffff12;--pico-primary:#8fa2ff;--pico-primary-hover:#a8b6ff;--pico-secondary-background:#1a2130;--pico-del-color:#ff8f82;--pico-form-element-background-color:#0e121b;--pico-form-element-border-color:#ffffff22;--pico-form-element-color:#e7eaf2;--accent:#8fa2ff;--accent-2:#5eead4;--todo:#93a7c4;--progress:#7aa5ff;--blocked:#ff8f82;--done:#59d193;--wontdo:#b18cff;--unknown:#e8b153;--attention-active:#221417;--lane-bg:#10141d;--lane-progress-bg:#131c30;--lane-blocked-bg:#261419;--lane-done-bg:#0f241c;--lane-wontdo-bg:#1e1733;--lane-unknown-bg:#251c0e;--lane-empty:#ffffff08;--shadow:#00000060;--shadow-hover:#00000092;--stage:#0b0f16;--stage-dot:#ffffff18`;

const styles = String.raw`:root{color-scheme:light dark;--pico-background-color:#f4f5f7;--pico-color:#191e28;--pico-muted-color:#5d6472;--pico-card-background-color:#ffffff;--pico-muted-border-color:#1b233330;--pico-card-border-color:#1b233314;--pico-primary:#4f46e5;--pico-primary-hover:#4038cc;--pico-secondary-background:#eceef2;--pico-del-color:#b42318;--pico-form-element-background-color:#ffffff;--pico-form-element-border-color:#1b23332a;--pico-form-element-color:#191e28;--bg:var(--pico-background-color);--fg:var(--pico-color);--muted:var(--pico-muted-color);--card:var(--pico-card-background-color);--border:var(--pico-muted-border-color);--border-soft:var(--pico-card-border-color);--accent:var(--pico-primary);--accent-2:#0891b2;--hover:var(--pico-secondary-background);--warn:var(--pico-del-color);--todo:#64748b;--progress:#2563eb;--blocked:#d92d20;--done:#15803d;--wontdo:#7c3aed;--unknown:#b54708;--attention-active:#fdf3f2;--lane-bg:#eceef2;--lane-progress-bg:#eef3fe;--lane-blocked-bg:#fdf0ee;--lane-done-bg:#ecf7f1;--lane-wontdo-bg:#f4f0fd;--lane-unknown-bg:#fdf7e8;--lane-empty:#ffffffb0;--shadow:#141b2e14;--shadow-hover:#141b2e28;--stage:#eef0f6;--stage-dot:#1b23331f;--font-display:"Segoe UI Variable Display","Inter","Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic UI","Meiryo",-apple-system,system-ui,sans-serif}
[data-theme="dark"]{${darkVars}}
@media(prefers-color-scheme:dark){:root:not([data-theme]){${darkVars}}}
html,body{max-width:100%;overflow-x:hidden}
body{max-width:1240px;margin:auto;padding:20px 28px 36px;overflow-wrap:anywhere;font-family:var(--font-display);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body::before{content:"";position:fixed;inset:0;z-index:-2;pointer-events:none;background-image:linear-gradient(color-mix(in srgb,var(--border) 24%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--border) 24%,transparent) 1px,transparent 1px);background-size:32px 32px;mask-image:radial-gradient(ellipse 130% 85% at 50% 0%,#000 18%,transparent 72%);-webkit-mask-image:radial-gradient(ellipse 130% 85% at 50% 0%,#000 18%,transparent 72%)}
body::after{content:"";position:fixed;inset:-14% -10% auto;height:52vh;z-index:-1;pointer-events:none;background:radial-gradient(44% 62% at 24% 0%,color-mix(in srgb,var(--accent) 16%,transparent),transparent 72%),radial-gradient(40% 54% at 78% 2%,color-mix(in srgb,var(--accent-2) 12%,transparent),transparent 72%);animation:aurora 26s ease-in-out infinite alternate}
@keyframes aurora{from{transform:translate3d(-2%,0,0) scale(1)}to{transform:translate3d(2%,4%,0) scale(1.05)}}
body>header,body>main,body>footer{max-width:none;padding:0}
::selection{background:color-mix(in srgb,var(--accent) 26%,transparent)}
a{color:var(--accent)}
.skip-link{position:absolute;transform:translateY(-250%);left:12px;z-index:100;padding:.5rem .9rem;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--fg)}
.skip-link:focus{transform:none;top:8px}
section[id],div[id^="doc-"]{scroll-margin-top:5rem}
body>header{padding-top:1.2rem}
.eyebrow{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;font-size:.7rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
.eyebrow-state{margin-left:auto;padding:.2rem .7rem;border:1px solid var(--border-soft);border-radius:999px;background:color-mix(in srgb,var(--card) 70%,transparent);font-family:var(--pico-font-family-monospace);font-size:.66rem;letter-spacing:.1em;color:var(--fg)}
.eyebrow-state.state-bad{color:var(--blocked);border-color:color-mix(in srgb,var(--blocked) 45%,var(--border-soft))}
.header-row{display:flex;align-items:center;gap:.65rem;margin-top:.5rem}
.header-row h1{margin:0;font-family:var(--font-display);font-size:clamp(1.9rem,1.2rem+3vw,2.85rem);line-height:1.04;letter-spacing:-.02em;font-weight:750}
.pulse-dot{width:.6rem;height:.6rem;flex:none;border-radius:50%;background:var(--done);box-shadow:0 0 0 4px color-mix(in srgb,var(--done) 18%,transparent);animation:pulse-dot 2.4s ease-in-out infinite}
.pulse-bad{background:var(--blocked);box-shadow:0 0 0 4px color-mix(in srgb,var(--blocked) 18%,transparent)}
@keyframes pulse-dot{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.78);opacity:.6}}
.subtitle{display:flex;flex-wrap:wrap;gap:.45rem 1.6rem;margin:.95rem 0 0;color:var(--muted);font-size:.84rem}
.subtitle .meta{display:inline-flex;align-items:baseline;gap:.45rem;min-width:0}
.subtitle strong{font-size:.66rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.hero{display:flex;align-items:center;gap:1.4rem 2.6rem;flex-wrap:wrap;margin-top:1.4rem;padding:1.3rem 1.5rem;border:1px solid var(--border-soft);border-radius:16px;background:linear-gradient(155deg,color-mix(in srgb,var(--accent) 7%,var(--card)),var(--card) 58%);box-shadow:0 1px 2px var(--shadow),0 20px 44px -30px var(--shadow-hover)}
.hero-metric{display:flex;flex-direction:column;flex:none}
.hero-value{font-family:var(--font-display);font-size:clamp(2.5rem,4.6vw,3.4rem);font-weight:800;line-height:1;letter-spacing:-.03em;font-variant-numeric:tabular-nums;background:linear-gradient(115deg,var(--fg) 20%,var(--accent) 80%);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero-label{margin-top:.4rem;font-size:.66rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.hero-mid{flex:1;min-width:220px;display:flex;flex-direction:column;gap:.55rem}
.hero-track{height:.5rem;border-radius:999px;background:color-mix(in srgb,var(--fg) 8%,transparent);overflow:hidden}
.hero-fill{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--accent),var(--accent-2))}
.hero-note{font-size:.76rem;color:var(--muted)}
.hero-facts{display:flex;gap:1.8rem;margin:0;flex-wrap:wrap}
.hero-facts>div{display:flex;flex-direction:column;gap:.15rem}
.hero-facts dt{font-size:.64rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.hero-facts dd{margin:0;font-family:var(--font-display);font-size:1.45rem;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
.hero-facts dd.hero-bad{color:var(--blocked)}
nav{position:sticky;top:0;z-index:20;display:flex;justify-content:flex-start;margin-top:1.2rem;padding-block:.45rem;background:color-mix(in srgb,var(--bg) 78%,transparent);-webkit-backdrop-filter:blur(10px) saturate(1.4);backdrop-filter:blur(10px) saturate(1.4);border-bottom:1px solid var(--border-soft)}
nav ul{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px}
nav a{display:inline-block;padding:.3rem .78rem;border-radius:999px;color:var(--muted);font-size:.84rem;text-decoration:none;transition:background .15s ease,color .15s ease}
nav a:hover{color:var(--fg);background:color-mix(in srgb,var(--accent) 10%,transparent)}
nav a[aria-current]{color:var(--fg);font-weight:650;background:color-mix(in srgb,var(--accent) 15%,transparent)}
nav li:last-child{margin-left:auto}
.theme-toggle{margin:0;padding:.26rem .8rem;border:1px solid var(--border);border-radius:999px;background:var(--card);color:var(--fg);font-size:.74rem;font-family:var(--pico-font-family-monospace);line-height:1.4;cursor:pointer;letter-spacing:.04em}
.theme-toggle:hover{border-color:var(--accent);color:var(--accent)}
main>*{margin-block:0}
main>*+*{margin-top:2.6rem}
main h2{display:flex;align-items:center;gap:.6rem;margin:0 0 .4rem;padding-bottom:.6rem;border-bottom:1px solid var(--border-soft);font-family:var(--font-display);font-size:1.42rem;font-weight:750;letter-spacing:-.015em}
main h2::before{content:"";width:.85rem;height:.85rem;flex:none;border-radius:.24rem;background:linear-gradient(135deg,var(--accent),var(--accent-2))}
main h3{font-size:.78rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
main h4{font-size:.8rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.facts>div,.callout{padding:.55rem .85rem;border:1px solid var(--border-soft);border-radius:10px;background:var(--card)}
.callout{border-left:3px solid var(--accent);background:color-mix(in srgb,var(--accent) 4%,var(--card))}
.callout h3{margin:.1rem 0 .6rem;font-size:.72rem}
.chip{display:inline-flex;align-items:center;padding:.14rem .6rem;border:1px solid var(--border-soft);border-radius:999px;background:var(--card);font-family:var(--pico-font-family-monospace);font-size:.72rem;line-height:1.5}
.chip-danger{color:var(--blocked);border-color:color-mix(in srgb,var(--blocked) 40%,var(--border-soft));background:color-mix(in srgb,currentColor 10%,transparent)}
.facts dt{font-size:.68rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.facts dd{margin:.15rem 0 0;font-size:1.3rem;font-weight:700;font-variant-numeric:tabular-nums}
footer{margin-top:2.2rem;padding-top:1.1rem;border-top:1px solid var(--border-soft);text-align:center;color:var(--muted);font-size:.8rem}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(9.4rem,1fr));gap:.7rem;margin:0}
.stat{position:relative;padding:.7rem .95rem .8rem;border:1px solid var(--border-soft);border-radius:12px;background:linear-gradient(180deg,color-mix(in srgb,var(--stat-accent,var(--border)) 8%,var(--card)),var(--card) 70%);overflow:hidden;transition:transform .18s ease,box-shadow .18s ease}
.stat::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;background:var(--stat-accent,var(--border));opacity:.8}
.stat:hover{transform:translateY(-2px);box-shadow:0 10px 24px -16px var(--shadow-hover)}
.stat dt{font-size:.66rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.stat dd{margin:.35rem 0 0;font-family:var(--font-display);font-size:1.75rem;font-weight:750;line-height:1.05;font-variant-numeric:tabular-nums}
.accent-progress{--stat-accent:var(--progress)}
.accent-done{--stat-accent:var(--done)}
.accent-wontdo{--stat-accent:var(--wontdo)}
.accent-unknown{--stat-accent:var(--unknown)}
.accent-blocked{--stat-accent:var(--blocked)}
.accent-draft{--stat-accent:var(--unknown)}
.accent-capturing{--stat-accent:var(--accent)}
.chart-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:.9rem}
.panel{padding:.9rem 1.05rem 1rem;border:1px solid var(--border-soft);border-radius:14px;background:var(--card)}
.panel h3{margin:.05rem 0 .8rem}
.donut-wrap{display:flex;align-items:center;gap:1.3rem;flex-wrap:wrap}
.donut{width:148px;height:148px;min-width:148px;flex:none}
.donut-seg{fill:none;stroke-width:15}
.donut-empty{stroke:var(--border-soft)}
.donut-value{font-size:1.55rem;font-weight:750;fill:var(--fg);font-family:var(--font-display)}
.donut-label{font-size:.68rem;fill:var(--muted);letter-spacing:.08em}
.chart-legend{list-style:none;margin:0;padding:0;display:grid;gap:.3rem;font-size:.8rem;color:var(--muted)}
.chart-legend strong{color:var(--fg);font-variant-numeric:tabular-nums;font-weight:650}
.seg-todo{stroke:var(--todo);background:var(--todo)}
.seg-inprogress{stroke:var(--progress);background:var(--progress)}
.seg-blocked{stroke:var(--blocked);background:var(--blocked)}
.seg-done{stroke:var(--done);background:var(--done)}
.seg-wontdo{stroke:var(--wontdo);background:var(--wontdo)}
.seg-unknown{stroke:var(--unknown);background:var(--unknown)}
.hbars{list-style:none;margin:0;padding:0;display:grid;gap:.5rem;font-size:.8rem}
.hbars li{display:grid;grid-template-columns:7.6rem 1fr 2.2rem;align-items:center;gap:.7rem}
.hbar-label{color:var(--muted)}
.hbar-track{display:block;height:.5rem;border-radius:999px;background:color-mix(in srgb,var(--fg) 7%,transparent);overflow:hidden}
.hbar-fill{display:block;height:100%;border-radius:999px;min-width:0}
.hbar-count{text-align:right;font-variant-numeric:tabular-nums;font-weight:650}
.fill-draft{background:var(--unknown)}
.fill-proposed{background:var(--progress)}
.fill-capturing{background:var(--accent)}
.fill-other{background:var(--todo)}
.fill-unmanaged{background:var(--border)}
.fill-parse{background:var(--blocked)}
.fill-error{background:var(--blocked)}
.fill-warning{background:var(--unknown)}
.fill-info{background:var(--progress)}
.gauge{height:.5rem;border-radius:999px;background:color-mix(in srgb,var(--fg) 7%,transparent);overflow:hidden}
.gauge-fill{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--done),color-mix(in srgb,var(--done) 62%,var(--accent-2)))}
.gauge-note{margin:.5rem 0 0;font-size:.8rem;color:var(--muted)}
.gauge-note strong{color:var(--fg);font-variant-numeric:tabular-nums}
.stack-bar{display:flex;height:.6rem;border-radius:999px;overflow:hidden;background:color-mix(in srgb,var(--fg) 7%,transparent)}
.stack-seg{display:block;height:100%}
.backlog-strip{margin-block:1rem;padding:.9rem 1.05rem;border:1px solid var(--border-soft);border-radius:14px;background:color-mix(in srgb,var(--card) 75%,transparent)}
.backlog-strip h3{margin:.05rem 0 .45rem}
.backlog-strip>p{margin:.2rem 0 .7rem;font-size:.82rem;color:var(--muted)}
.backlog-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(16rem,1fr));gap:.8rem}
form input:not([type=checkbox],[type=radio]),form select{width:auto}
form input,form select,form label{margin-bottom:0}
form input,form select{border-radius:8px;font-size:.85rem}
form label{display:inline-flex;align-items:center;gap:.45rem;font-size:.78rem;font-weight:650;color:var(--muted)}
form,.facts{display:flex;flex-wrap:wrap;gap:12px 16px}
form[data-filters]{padding:.6rem .8rem;border:1px solid var(--border-soft);border-radius:12px;background:color-mix(in srgb,var(--card) 78%,transparent);margin-block:.6rem}
[data-result-count]{font-family:var(--pico-font-family-monospace);font-weight:700}
.detail-toggle{margin-block:.4rem}
.detail-toggle button{margin:0;padding:.32rem .85rem;border:1px solid var(--border);border-radius:999px;background:var(--card);color:var(--fg);font-size:.78rem;cursor:pointer;transition:border-color .15s ease,color .15s ease}
.detail-toggle button:hover{border-color:var(--accent);color:var(--accent)}
.kanban-scroll{width:100%;max-width:100%;overflow-x:auto;padding:.3rem .1rem 1rem;scroll-snap-type:x proximity}
.kanban-board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(17.5rem,1fr);gap:.9rem;width:max-content;min-width:100%;align-items:start}
.kanban-lane{display:flex;flex-direction:column;max-height:75vh;margin-block:0;padding:.8rem .8rem .9rem;border:1px solid var(--border-soft);border-top:3px solid var(--todo);border-radius:14px;background:var(--lane-bg);scroll-snap-align:start}
.lane-cards{min-height:0;overflow-y:auto;display:grid;gap:.7rem;padding:.15rem .05rem}
.lane-todo{border-top-color:var(--todo)}
.lane-in-progress{border-top-color:var(--progress);background:var(--lane-progress-bg)}
.lane-blocked{border-top-color:var(--blocked);background:var(--lane-blocked-bg)}
.lane-done{border-top-color:var(--done);background:var(--lane-done-bg)}
.lane-wont-do{border-top-color:var(--wontdo);background:var(--lane-wontdo-bg)}
.lane-unknown{border-top-color:var(--unknown);background:var(--lane-unknown-bg)}
.kanban-lane h3,.lane-heading{display:flex;align-items:center;justify-content:space-between;gap:.6rem;margin:.05rem 0 .7rem;font-size:.88rem;font-weight:700;letter-spacing:.05em;color:var(--fg)}
.lane-heading{cursor:pointer;padding:.2rem .25rem;border-radius:8px}
.lane-heading:hover{background:color-mix(in srgb,var(--fg) 5%,transparent)}
.lane-count,.badge,.status-badge,.coverage-badge,.status-pill{display:inline-flex;align-items:center;padding:.12rem .55rem;border:1px solid color-mix(in srgb,currentColor 45%,transparent);border-radius:999px;font-size:.7rem;font-weight:650;letter-spacing:.05em;line-height:1.5;background:color-mix(in srgb,currentColor 11%,transparent)}
.lane-count{color:var(--muted);font-family:var(--pico-font-family-monospace);letter-spacing:0}
.status-pill{text-transform:uppercase;font-size:.64rem}
.status-todo{color:var(--todo)}
.status-in-progress{color:var(--progress)}
.status-blocked{color:var(--blocked)}
.status-done{color:var(--done)}
.status-wont-do{color:var(--wontdo)}
.status-unknown{color:var(--unknown)}
.status-draft{color:var(--unknown)}
.bucket-draft{color:var(--unknown)}
.bucket-proposed{color:var(--progress)}
.bucket-capturing{color:var(--unknown)}
.bucket-other{color:var(--todo)}
.badge-runnable{color:var(--done)}
.badge-resumable{color:var(--progress)}
.badge-blocked{color:var(--blocked)}
.badge-runnable::before{content:"▶ ";font-size:.85em}
.badge-resumable::before{content:"↻ ";font-size:.9em}
.badge-blocked::before{content:"✕ ";font-size:.85em}
.coverage-badge{color:var(--muted);border-color:var(--border-soft);background:transparent;font-weight:600}
.task-card{min-width:0;margin-bottom:0;padding:.85rem .95rem;border:1px solid var(--border-soft);border-radius:12px;background:var(--card);box-shadow:0 1px 2px var(--shadow);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
.task-card:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--accent) 42%,var(--border-soft));box-shadow:0 12px 26px -16px var(--shadow-hover)}
.task-card h4,.task-card p{margin:.2rem 0 .55rem}
.task-card h4{font-size:.95rem;font-weight:650;line-height:1.4;letter-spacing:0;text-transform:none;color:var(--fg)}
.task-card a{color:var(--fg);text-decoration:none}
.task-card a:hover{color:var(--accent);text-decoration:underline;text-underline-offset:3px}
.task-id,.task-path{font-size:.78rem;color:var(--muted)}
.task-card details{margin-block:.45rem;padding:0;border-radius:9px}
.task-card details>summary{padding:.4rem .6rem;font-size:.78rem;font-weight:650}
.task-card details>:not(summary){margin-inline:.55rem}
.doc-card{border-left:4px solid var(--unknown)}
.attention{padding:1rem 1.15rem;border:1px solid var(--border-soft);border-radius:14px;background:var(--card)}
.attention-groups{display:flex;flex-wrap:wrap;gap:.9rem;margin-top:.7rem}
.attention-group{flex:1 1 300px;padding:.75rem .95rem;border:1px solid var(--border-soft);border-left:4px solid var(--blocked);border-radius:10px;background:color-mix(in srgb,var(--blocked) 4%,var(--card))}
.attention-group h3{display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;margin:.05rem 0 .55rem;font-size:.74rem}
.attention-group ul{margin:0;padding-inline-start:0}
.attention-group li{margin-block:.35rem;font-size:.85rem}
.issue-list{list-style:none;display:flex;flex-direction:column}
.issue-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:.15rem .8rem;padding:.5rem 0;border-top:1px solid var(--border-soft)}
.issue-list>.issue-row:first-child{border-top:0;padding-top:.05rem}
.issue-main{display:flex;align-items:baseline;gap:.5rem;flex:1 1 240px;min-width:0}
.issue-dot{width:.45rem;height:.45rem;flex:none;align-self:center;border-radius:50%;background:var(--blocked)}
.issue-msg{font-size:.84rem;line-height:1.45;min-width:0;overflow-wrap:anywhere}
.issue-meta{display:flex;flex-wrap:wrap;align-items:baseline;gap:.3rem .55rem;justify-content:flex-end;text-align:end}
.issue-tag{flex:none;padding:.08rem .45rem;border:1px solid var(--border-soft);border-radius:999px;background:color-mix(in srgb,var(--blocked) 5%,var(--card));font-family:var(--pico-font-family-monospace);font-size:.62rem;letter-spacing:.02em;color:var(--muted)}
.issue-loc{font-family:var(--pico-font-family-monospace);font-size:.7rem;color:var(--muted);overflow-wrap:anywhere}
a.issue-loc:hover{color:var(--accent)}
.issue-sub{font-family:var(--pico-font-family-monospace);font-size:.66rem;color:var(--muted)}
.issue-repair{flex:none;padding:.08rem .42rem;border-radius:5px;font-size:.6rem;font-weight:700;letter-spacing:.06em}
.repair-safe{color:var(--done);background:color-mix(in srgb,var(--done) 12%,transparent)}
.repair-migration{color:var(--unknown);background:color-mix(in srgb,var(--unknown) 14%,transparent)}
.repair-manual{color:var(--muted);background:color-mix(in srgb,var(--muted) 14%,transparent)}
.attention-empty{border-left-color:var(--border);flex:0 1 220px;background:var(--card);opacity:.55}
.attention-active{border-color:color-mix(in srgb,var(--blocked) 45%,var(--border-soft));background:linear-gradient(180deg,color-mix(in srgb,var(--blocked) 7%,var(--card)),var(--card) 65%);box-shadow:0 14px 34px -22px color-mix(in srgb,var(--blocked) 55%,transparent)}
.facts dt,.gauge-note,.empty,.chart-legend{color:var(--muted)}
.empty{font-size:.84rem}
.membership-list{margin:.55rem 0 0;padding-left:1.1rem;font-size:.82rem}
.membership-list li+li{margin-top:.55rem}
.lane-empty{padding:.8rem;border:1px dashed var(--border);border-radius:9px;background:var(--lane-empty);font-size:.82rem}
code{white-space:normal;overflow-wrap:anywhere;font-size:.92em}
.row-list{list-style:none;margin:0;padding:0;display:grid;gap:.45rem}
.row-item{display:flex;align-items:baseline;gap:.35rem .6rem;flex-wrap:wrap;padding:.45rem .7rem;border:1px solid var(--border-soft);border-radius:9px;background:var(--card);font-size:.82rem}
.row-meta{color:var(--muted);font-size:.74rem}
.row-danger{border-left:3px solid var(--blocked)}
.chip-line{display:flex;flex-wrap:wrap;gap:.4rem}
.muted{color:var(--muted)}
.doc-list{display:grid;gap:.5rem;max-height:72vh;overflow:auto;padding:.15rem}
.doc-row{padding:.55rem .8rem;border:1px solid var(--border-soft);border-left:3px solid var(--border);border-radius:10px;background:var(--card);transition:border-color .15s ease}
.doc-row:hover{background:color-mix(in srgb,var(--accent) 5%,var(--hover))}
.doc-row:target{background:color-mix(in srgb,var(--accent) 10%,var(--card));border-left-color:var(--accent)}
.doc-head{display:flex;align-items:baseline;gap:.45rem .7rem;flex-wrap:wrap}
.doc-title{min-width:0;font-weight:650}
.doc-time{margin-left:auto;color:var(--muted);font-size:.72rem;white-space:nowrap;font-variant-numeric:tabular-nums}
.doc-sub{display:flex;align-items:baseline;gap:.3rem .8rem;flex-wrap:wrap;margin-top:.35rem;font-size:.74rem}
.doc-path{color:var(--muted);font-size:.74rem}
pre,.graph-scroll{overflow:auto}
[hidden]{display:none!important}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--fg) 18%,transparent);border-radius:99px;border:2px solid transparent;background-clip:content-box}
::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--fg) 30%,transparent);background-clip:content-box}
*{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--fg) 22%,transparent) transparent}
svg{display:block;width:100%;min-width:760px;height:auto}
.graph-scroll{max-width:100%}
.graph-canvas{margin-block:.9rem;padding:.95rem 1.1rem;border:1px solid var(--border-soft);border-radius:14px;background:var(--card)}
.canvas-head{display:flex;justify-content:space-between;align-items:baseline;gap:.35rem .8rem;flex-wrap:wrap;margin-bottom:.6rem}
.canvas-eyebrow{font-size:.66rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.graph-meta{font-family:var(--pico-font-family-monospace);font-size:.74rem;color:var(--muted)}
.graph-stage{overflow-x:auto;padding:.6rem;border:1px solid var(--border-soft);border-radius:10px;background-color:var(--stage);background-image:radial-gradient(circle,var(--stage-dot) 1px,transparent 1.3px);background-size:22px 22px}
.probe-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(17rem,1fr);gap:.9rem;align-items:stretch}
.probe-side{display:grid;gap:.9rem;align-content:start}
.probe-panel{padding:.6rem .9rem .75rem;border:1px solid var(--border-soft);border-radius:10px;background:var(--card)}
.probe-panel h3{margin:.05rem 0 .6rem;font-size:.72rem}
.probe-muted{border-left-color:var(--border);background:var(--card)}
.route-path{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin:.3rem 0 .7rem}
.probe-node{display:inline-flex;align-items:center;gap:.45rem;padding:.34rem .75rem .34rem .45rem;border:1.5px solid var(--kind,var(--border));border-radius:10px;background:color-mix(in srgb,var(--kind,var(--border)) 9%,var(--card));font-family:var(--pico-font-family-monospace);font-size:.82rem;font-weight:700}
.probe-glyph{display:inline-flex;align-items:center;justify-content:center;width:1.2rem;height:1.2rem;border-radius:5px;background:color-mix(in srgb,var(--kind,var(--border)) 15%,transparent);color:var(--kind,var(--border));font-size:.68rem}
.probe-node.kind-action{--kind:var(--progress)}
.probe-node.kind-delegate{--kind:var(--wontdo)}
.probe-node.kind-audit{--kind:var(--unknown)}
.probe-node.kind-terminal{--kind:var(--done)}
.probe-unknown{--kind:var(--border);color:var(--muted)}
.probe-link{display:inline-flex;flex-direction:column;align-items:center;min-width:5.2rem;padding-inline:.15rem}
.probe-edge-label{max-width:11rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--pico-font-family-monospace);font-size:.64rem;color:var(--muted)}
.route-arrow{color:var(--muted);font-weight:700;font-size:1.2rem;line-height:1}
.probe-blocked .route-arrow,.probe-blocked .probe-edge-label{color:var(--blocked)}
.signal-group{display:flex;align-items:baseline;gap:.4rem .6rem;flex-wrap:wrap;margin-block:.4rem}
.signal-label{flex:none;min-width:6.6rem;font-size:.64rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.probe-note{margin:.6rem 0 0;padding:.42rem .7rem;border-radius:8px;background:color-mix(in srgb,var(--done) 8%,var(--card));font-family:var(--pico-font-family-monospace);font-size:.72rem;color:var(--muted)}
.probe-note-danger{background:color-mix(in srgb,var(--blocked) 10%,var(--card));color:var(--blocked)}
.probe-note a{color:inherit;font-weight:700;text-decoration:none}
.probe-note a:hover{text-decoration:underline}
.gate-pills{display:flex;flex-wrap:wrap;gap:.4rem}
.gate-pill{display:inline-flex;align-items:center;gap:.4rem;padding:.18rem .65rem;border:1px solid color-mix(in srgb,var(--g,var(--border)) 45%,var(--border-soft));border-radius:999px;background:color-mix(in srgb,var(--g,var(--border)) 8%,var(--card));font-family:var(--pico-font-family-monospace);font-size:.72rem}
.gate-dot{width:.5rem;height:.5rem;flex:none;border-radius:50%;background:var(--g,var(--border))}
.gate-pass{--g:var(--done)}
.gate-fail{--g:var(--unknown)}
.gate-blocked{--g:var(--blocked)}
.gate-score{float:right;font-family:var(--pico-font-family-monospace);font-size:.74rem;font-weight:400;letter-spacing:0;text-transform:none;color:var(--muted)}
@media(max-width:900px){.probe-grid{grid-template-columns:1fr}}
.graph-legend{display:flex;flex-wrap:wrap;gap:.4rem 1.3rem;margin:.6rem 0 0;padding:.6rem .15rem 0;border-top:1px solid var(--border-soft);list-style:none;font-size:.76rem;color:var(--muted)}
.legend-swatch{display:inline-block;width:.8rem;height:.8rem;margin-right:.3rem;border:1.5px solid var(--sw,var(--border));border-radius:.25rem;background:color-mix(in srgb,var(--sw,var(--border)) 14%,transparent);vertical-align:-1px}
.sw-action{--sw:var(--progress)}
.sw-delegate{--sw:var(--wontdo)}
.sw-audit{--sw:var(--unknown)}
.sw-terminal{--sw:var(--done)}
.swatch-current{--sw:var(--unknown)}
.swatch-edge{height:0;width:1.1rem;border:0;border-top:3px solid var(--accent);border-radius:0;background:none;vertical-align:3px}
.legend-line{display:inline-block;width:1.1rem;height:0;margin-right:.3rem;border-top:2.5px solid var(--edge,var(--border));vertical-align:3px}
.sw-fwd{--edge:var(--accent)}
.sw-back{--edge:var(--unknown)}
.sw-retry{--edge:var(--muted);border-top-style:dashed}
details{margin-block:.8rem;padding:0;border:1px solid var(--border-soft);border-radius:12px;background:color-mix(in srgb,var(--card) 82%,transparent);overflow:hidden}
details>summary{display:block;padding:.65rem .95rem;font-weight:600}
details>summary{position:relative;cursor:pointer}
details>summary::-webkit-details-marker{display:none}
details>summary::after{content:"";position:absolute;right:1rem;top:calc(50% - .22rem);width:.48rem;height:.48rem;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(45deg);transition:transform .18s ease}
details[open]>summary::after{transform:rotate(225deg);top:calc(50% - .12rem)}
details>summary:hover{background:var(--hover)}
details[open]>summary{margin-bottom:0;border-bottom:1px solid var(--border-soft)}
details>:not(summary){margin-inline:.95rem}
details[open]>:not(summary){margin-top:.7rem}
details>:not(summary):last-child{margin-bottom:.9rem}
.warning{font-weight:700;color:var(--warn)}
@media(prefers-reduced-motion:no-preference){
main>*{animation:rise .55s cubic-bezier(.22,.61,.25,1) both}
main>*:nth-child(2){animation-delay:.05s}
main>*:nth-child(3){animation-delay:.1s}
main>*:nth-child(4){animation-delay:.15s}
main>*:nth-child(5){animation-delay:.2s}
main>*:nth-child(6){animation-delay:.25s}
main>*:nth-child(7){animation-delay:.3s}
main>*:nth-child(8){animation-delay:.35s}
body>header{animation:rise .5s cubic-bezier(.22,.61,.25,1) both}
}
@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.task-card{transition:none}
.task-card:hover{transform:none}
.pulse-dot{animation:none}
body::after{animation:none}
}
@media(max-width:640px){body{padding:12px 14px 28px}
h1{font-size:1.6rem}
.hero{gap:1.1rem;padding:1rem 1.1rem}
.hero-facts{gap:1.2rem}
.stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
.kanban-board{grid-auto-columns:minmax(min(17rem,calc(100vw - 40px)),calc(100vw - 40px))}
}
@media print{nav,form,.skip-link{display:none}
body::before,body::after{display:none}
main>*{animation:none}
.attention{break-inside:avoid}
details>*{display:block}
.kanban-scroll{overflow:visible}
.kanban-board{display:block;width:auto}
.kanban-lane{break-inside:avoid;max-height:none;margin-bottom:1rem}
.lane-cards{overflow:visible}
}`

export function renderDashboard(snapshot: DashboardSnapshot): string {
  const ids = documentAnchors(snapshot.inventory);
  const hasBlocking = snapshot.state.hardBlockers.length > 0
    || snapshot.findings.some((finding) => finding.blocking)
    || snapshot.plans.some((plan) => plan.graph.issues.length > 0)
    || (snapshot.decision?.route.status === "blocked" && (snapshot.decision.explanation?.blockedReasons?.length ?? 0) > 0);
  const canonicalTasks = snapshot.inventory.filter((row) => row.kind === "canonical" && row.type === "task");
  const summary = summarizeTasks(canonicalTasks);
  const heroPct = summary.doneRatio === null ? null : Math.round(summary.doneRatio * 100);
  const heroBlockers = snapshot.state.hardBlockers.length + snapshot.findings.filter((finding) => finding.blocking).length;
  const canonicalDocs = snapshot.inventory.filter((row) => row.kind === "canonical").length;
  const hero = `<div class="hero"><div class="hero-metric"><span class="hero-value">${heroPct === null ? "—" : `${heroPct}%`}</span><span class="hero-label">全体完了率</span></div><div class="hero-mid"><div class="hero-track" role="img" aria-label="完了率 ${heroPct === null ? "なし" : `${heroPct}%`}"><span class="hero-fill" style="width:${heroPct ?? 0}%"></span></div><p class="hero-note">${heroPct === null ? "対象タスクなし" : `${summary.total} タスク中 ${summary.done} 件完了`}</p></div><dl class="hero-facts"><div><dt>残存</dt><dd>${summary.remaining}</dd></div><div><dt>blocking</dt><dd${heroBlockers > 0 ? ` class="hero-bad"` : ""}>${heroBlockers}</dd></div><div><dt>文書</dt><dd>${canonicalDocs}</dd></div></dl></div>`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; connect-src 'none'"><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%232563eb'/%3E%3C/svg%3E"><title>文書駆動開発の進行状況</title><script>${themeScript}</script><style>${picoClasslessCss}${styles}</style></head><body><a class="skip-link" href="#main">本文へ移動</a><header><div class="eyebrow"><span class="pulse-dot${hasBlocking ? " pulse-bad" : ""}" aria-hidden="true" title="${hasBlocking ? "要対応あり" : "ブロッカーなし"}"></span><span>DOC-DRIVEN DEVELOPMENT · PROGRESS SNAPSHOT</span><span class="eyebrow-state${hasBlocking ? " state-bad" : ""}">${hasBlocking ? "要対応あり" : "ブロッカーなし"}</span></div><div class="header-row"><h1>文書駆動開発の進行状況</h1></div><p class="subtitle"><span class="meta"><strong>repository</strong><span>${e(snapshot.repositoryName)}</span></span><span class="meta"><strong>対象</strong><span>${list(snapshot.requested.focus)}</span></span><span class="meta"><strong>開始</strong><span>${e(snapshot.startedAt)}</span></span><span class="meta"><strong>生成時点</strong><time datetime="${escapeHtml(snapshot.generatedAt)}" data-relative>${e(snapshot.generatedAt)}</time></span></p>${hero}</header><nav aria-label="セクション"><ul><li><a href="#overview">概要</a></li><li><a href="#charts">チャート</a></li><li><a href="#task-board">タスクボード</a></li><li><a href="#backlog">候補</a></li><li><a href="#graph">Graph</a></li><li><a href="#tasks">タスク詳細</a></li><li><a href="#documents">文書</a></li><li><a href="#attention">要対応</a></li><li><a href="#diagnostics">診断</a></li><li><button type="button" id="theme-toggle" class="theme-toggle" aria-pressed="false" title="テーマ切替 (T)">テーマ</button></li></ul></nav><main id="main">${renderMetrics(snapshot)}${renderCharts(snapshot)}${renderTaskBoard(snapshot, ids)}<div class="graph-scroll">${renderGraph(snapshot)}</div>${renderPlans(snapshot)}${renderDocuments(snapshot)}${renderAttention(snapshot, ids)}${renderDiagnostics(snapshot)}</main><footer><small>この画面は生成時点の状態です。更新するにはコマンドを再実行してください。</small></footer><noscript>全情報を表示しています。絞り込みには JavaScript が必要です。</noscript><script>${filterScript}</script></body></html>`;
}
