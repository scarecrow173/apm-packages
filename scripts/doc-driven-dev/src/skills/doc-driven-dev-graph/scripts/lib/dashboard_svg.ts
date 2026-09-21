import type { GraphInspection } from "./graph_inspector";

function xml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] as string);
}

function short(value: string): string {
  return value.length <= 26 ? value : `${value.slice(0, 25)}…`;
}

const kindGlyphs: Record<string, string> = {
  action: "▶", delegate: "⇄", audit: "✓", terminal: "■",
};

function kindClass(kind: string): string {
  return `kind-${kind.toLowerCase().replace(/[^a-z-]/g, "") || "unknown"}`;
}

type Edge = GraphInspection["edges"][number];
type Pair = { from: string; to: string; edges: Edge[] };

type Layout = {
  position: Map<string, { x: number; y: number; alias: string }>;
  spineIndex: Map<string, number>;
  distance: Map<string, number>;
  width: number;
  spineY: number;
  branchY: number;
  topWrapLanes: number;
};

const NODE_W = 230;
const NODE_H = 72;
const COL = 270;
const MARGIN_X = 40;

/** Greedy spine: walk the highest-priority non-self edge to an unvisited node. */
function computeSpine(inspection: GraphInspection): string[] {
  const spine: string[] = [];
  const seen = new Set<string>();
  let current: string | null = inspection.entry;
  while (current !== null && !seen.has(current)) {
    spine.push(current);
    seen.add(current);
    const outgoing = inspection.edges
      .filter((edge) => edge.from === current && edge.to !== current && !seen.has(edge.to))
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
    current = outgoing[0]?.to ?? null;
  }
  return spine;
}

/** BFS distance from entry, ignoring self-loops. Unreachable nodes get Infinity. */
function computeDistance(inspection: GraphInspection): Map<string, number> {
  const distance = new Map<string, number>([[inspection.entry, 0]]);
  const queue = [inspection.entry];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of inspection.edges) {
      if (edge.from !== current || edge.to === current || distance.has(edge.to)) continue;
      distance.set(edge.to, distance.get(current)! + 1);
      queue.push(edge.to);
    }
  }
  return distance;
}

function computeLayout(inspection: GraphInspection, pairs: Pair[]): Layout {
  const nodes = [...inspection.nodes].sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const aliases = new Map(nodes.map((node, index) => [node.nodeId, `node-${index}`]));
  const spine = computeSpine(inspection);
  const spineIndex = new Map(spine.map((nodeId, index) => [nodeId, index]));
  const distance = computeDistance(inspection);

  const offSpine = nodes.filter((node) => !spineIndex.has(node.nodeId)).map((node) => {
    const targets = inspection.edges
      .filter((edge) => edge.from === node.nodeId && spineIndex.has(edge.to))
      .map((edge) => spineIndex.get(edge.to)!);
    const sources = inspection.edges
      .filter((edge) => edge.to === node.nodeId && spineIndex.has(edge.from))
      .map((edge) => spineIndex.get(edge.from)!);
    const anchor = targets.length > 0 ? Math.min(...targets) : sources.length > 0 ? Math.min(...sources) : Number.MAX_SAFE_INTEGER;
    return { nodeId: node.nodeId, anchor };
  }).sort((left, right) => left.anchor - right.anchor || left.nodeId.localeCompare(right.nodeId));

  const branchCount = offSpine.length;
  const topWrapLanes = pairs.filter((pair) => spineIndex.has(pair.from) && !spineIndex.has(pair.to)).length;
  const branchY = 60 + Math.max(1, topWrapLanes) * 26;
  const spineY = branchCount > 0 ? branchY + NODE_H + 120 : branchY;

  const position = new Map<string, { x: number; y: number; alias: string }>();
  spine.forEach((nodeId, index) => {
    position.set(nodeId, { x: MARGIN_X + index * COL, y: spineY, alias: aliases.get(nodeId)! });
  });
  const usedColumns = new Set<number>();
  for (const node of offSpine) {
    let column = node.anchor === Number.MAX_SAFE_INTEGER ? usedColumns.size : node.anchor;
    while (usedColumns.has(column)) column += 1;
    usedColumns.add(column);
    position.set(node.nodeId, { x: MARGIN_X + column * COL, y: branchY, alias: aliases.get(node.nodeId)! });
  }

  const width = MARGIN_X * 2 + Math.max(spine.length, branchCount) * COL - 30;
  return { position, spineIndex, distance, width, spineY, branchY, topWrapLanes };
}

export function renderExecutionSvg(
  inspection: GraphInspection,
  selected: { current: string | null; edgeId: string | null },
): string {
  const nodes = [...inspection.nodes].sort((left, right) => left.nodeId.localeCompare(right.nodeId));

  // Merge parallel edges between the same ordered pair into one drawn path.
  const pairMap = new Map<string, Pair>();
  const edges = [...inspection.edges].sort((left, right) => left.from.localeCompare(right.from)
    || left.priority - right.priority || left.id.localeCompare(right.id));
  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}`;
    const pair = pairMap.get(key) ?? { from: edge.from, to: edge.to, edges: [] };
    pair.edges.push(edge);
    pairMap.set(key, pair);
  }
  const pairs = [...pairMap.values()];

  const layout = computeLayout(inspection, pairs);
  const { position, spineIndex, distance } = layout;
  const spineBottom = layout.spineY + NODE_H;

  // Classify each pair semantically: self-loop, forward (BFS distance grows
  // or stays level), or backward (returns to an earlier stage).
  type Classified = Pair & { cls: "self" | "fwd" | "back"; topWrap: boolean };
  const classified: Classified[] = pairs.map((pair) => {
    if (pair.from === pair.to) return { ...pair, cls: "self", topWrap: false };
    const fromDist = distance.get(pair.from) ?? Number.MAX_SAFE_INTEGER;
    const toDist = distance.get(pair.to) ?? Number.MAX_SAFE_INTEGER;
    const backward = toDist < fromDist && !(fromDist === Number.MAX_SAFE_INTEGER && toDist === Number.MAX_SAFE_INTEGER);
    const topWrap = backward && spineIndex.has(pair.from) && !spineIndex.has(pair.to);
    return { ...pair, cls: backward ? "back" : "fwd", topWrap };
  });

  // Bottom return-channel depth: longer spans nest deeper.
  const backArcs = classified.filter((pair) => pair.cls === "back" && !pair.topWrap)
    .sort((left, right) => {
      const span = (pair: Classified) => (spineIndex.get(pair.from) ?? 0) - (spineIndex.get(pair.to) ?? 0);
      const bySpan = span(right) - span(left);
      return bySpan !== 0 ? bySpan : left.from.localeCompare(right.from) || left.to.localeCompare(right.to);
    });
  const backDepth = new Map(backArcs.map((pair, index) => [`${pair.from}->${pair.to}`, 56 + index * 26]));

  // Top-wrap lanes for backward edges that return into the branch lane.
  const topArcs = classified.filter((pair) => pair.topWrap)
    .sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to));
  const topDepth = new Map(topArcs.map((pair, index) => [`${pair.from}->${pair.to}`, index]));

  // Spread multiple arcs entering/leaving the same edge of a node.
  const spread = (pairsForNode: Classified[], keyOf: (pair: Classified) => string) => {
    const offsets = new Map<string, number>();
    const groups = new Map<string, Classified[]>();
    for (const pair of pairsForNode) {
      const key = keyOf(pair);
      groups.set(key, [...(groups.get(key) ?? []), pair]);
    }
    for (const group of groups.values()) {
      group.forEach((pair, index) => {
        offsets.set(`${pair.from}->${pair.to}`, (index - (group.length - 1) / 2) * 16);
      });
    }
    return offsets;
  };
  const backStartOffset = spread(classified.filter((pair) => pair.cls === "back"), (pair) => pair.from);
  const backEndOffset = spread(classified.filter((pair) => pair.cls === "back"), (pair) => pair.to);

  const activeEdge = edges.find((edge) => edge.id === selected.edgeId);
  const maxDepth = backArcs.length > 0 ? 56 + (backArcs.length - 1) * 26 : 0;
  const height = spineBottom + maxDepth + 60;

  const edgePaths = classified.map((pair) => {
    const from = position.get(pair.from);
    const to = position.get(pair.to);
    if (!from || !to) return "";
    const key = `${pair.from}->${pair.to}`;
    const active = pair.edges.some((edge) => edge.id === selected.edgeId);
    const ids = pair.edges.map((edge) => edge.id).join(", ");
    const conditions = pair.edges.map((edge) => edge.when).join("; ");
    const cls = `edge edge-${pair.cls}${active ? " edge-active" : ""}`;
    const startX = from.x + NODE_W / 2;
    const startY = pair.cls === "self" || pair.topWrap ? from.y : from.y + NODE_H;
    const endX = to.x + NODE_W / 2;
    let d: string;
    let labelX = endX;
    let labelY = to.y - 10;
    if (pair.cls === "self") {
      d = `M ${startX - 26} ${from.y} C ${startX - 26} ${from.y - 46}, ${startX + 26} ${from.y - 46}, ${startX + 26} ${from.y}`;
      labelX = startX;
      labelY = from.y - 52;
    } else if (pair.cls === "back" && pair.topWrap) {
      const lane = topDepth.get(key) ?? 0;
      const wy = layout.branchY - 60 - lane * 26;
      const sx = startX + (backStartOffset.get(key) ?? 0);
      const ex = endX + (backEndOffset.get(key) ?? 0);
      d = `M ${sx} ${from.y} C ${sx} ${wy}, ${ex} ${wy}, ${ex} ${to.y}`;
      labelX = (sx + ex) / 2;
      labelY = wy - 6;
    } else if (pair.cls === "back") {
      const depth = backDepth.get(key) ?? 56;
      const sx = startX + (backStartOffset.get(key) ?? 0);
      const ex = endX + (backEndOffset.get(key) ?? 0);
      d = `M ${sx} ${startY} C ${sx} ${startY + depth}, ${ex} ${to.y + NODE_H + depth}, ${ex} ${to.y + NODE_H}`;
      labelX = (sx + ex) / 2;
      labelY = startY + depth + 12;
    } else if (spineIndex.has(pair.from) && spineIndex.has(pair.to)) {
      const span = (spineIndex.get(pair.to) ?? 0) - (spineIndex.get(pair.from) ?? 0);
      if (span === 1) {
        d = `M ${from.x + NODE_W} ${from.y + NODE_H / 2} L ${to.x} ${to.y + NODE_H / 2}`;
        labelY = to.y - 10;
      } else {
        const lift = 44 + Math.min(span, 4) * 18;
        d = `M ${startX} ${from.y} C ${startX} ${from.y - lift}, ${endX} ${to.y - lift}, ${endX} ${to.y}`;
        labelX = (startX + endX) / 2;
        labelY = Math.min(from.y, to.y) - lift - 6;
      }
    } else if (spineIndex.has(pair.from)) {
      // Forward edge from the spine up into the branch lane.
      d = `M ${startX} ${from.y} C ${startX} ${from.y - 80}, ${endX} ${to.y + NODE_H + 42}, ${endX} ${to.y + NODE_H}`;
      labelX = (startX + endX) / 2;
      labelY = Math.min(from.y, to.y) - 14;
    } else if (spineIndex.has(pair.to)) {
      // Branch lane feeding back down into the spine.
      d = `M ${startX} ${from.y + NODE_H} C ${startX} ${from.y + NODE_H + 78}, ${endX} ${to.y - 42}, ${endX} ${to.y}`;
      labelY = to.y - 10;
    } else {
      const sameRow = from.y === to.y;
      d = sameRow
        ? `M ${from.x + NODE_W} ${from.y + NODE_H / 2} L ${to.x} ${to.y + NODE_H / 2}`
        : `M ${startX} ${from.y + NODE_H} C ${startX} ${from.y + NODE_H + 60}, ${endX} ${to.y - 40}, ${endX} ${to.y}`;
    }
    const label = active && activeEdge
      ? `<text x="${labelX}" y="${labelY}" class="edge-label" text-anchor="middle">${xml(short(activeEdge.when))}</text>`
      : "";
    return `<path id="edge-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}" class="${cls}" data-from="${from.alias}" data-to="${to.alias}" d="${d}" marker-end="url(#arrow)"><title>${xml(`${ids}: ${pair.from} → ${pair.to}; ${conditions}`)}</title></path>${label}`;
  }).join("");

  const nodeGroups = nodes.map((node) => {
    const pos = position.get(node.nodeId)!;
    const current = node.nodeId === selected.current;
    const glyph = kindGlyphs[node.kind] ?? "·";
    return `<g id="${pos.alias}" data-node="${pos.alias}" class="${kindClass(node.kind)}"><title>${xml(`${node.nodeId} (${node.kind})`)}</title><rect class="node-rect${current ? " current" : ""}" x="${pos.x}" y="${pos.y}" width="${NODE_W}" height="${NODE_H}" rx="10"/><rect class="node-icon" x="${pos.x + 11}" y="${pos.y + 13}" width="19" height="19" rx="5"/><text class="node-glyph" x="${pos.x + 20.5}" y="${pos.y + 27}" text-anchor="middle">${xml(glyph)}</text><text class="node-title" x="${pos.x + 38}" y="${pos.y + 29}">${xml(short(node.nodeId))}</text><text x="${pos.x + 38}" y="${pos.y + 53}" class="node-kind">kind: ${xml(short(node.kind))}</text>${current ? `<text x="${pos.x + NODE_W - 12}" y="${pos.y + 18}" class="selected-label" text-anchor="end">現在</text>` : ""}</g>`;
  }).join("");

  const style = `text{font-family:var(--pico-font-family-monospace,ui-monospace,monospace);font-size:13px;fill:var(--fg,#172033)}.node-title{font-weight:700}.node-kind{font-size:11px;fill:var(--muted,#64748b)}.selected-label{font-size:10px;font-weight:700;letter-spacing:.06em;fill:var(--sel,#8b1e45)}.edge-label{font-size:10px;fill:var(--sel-edge,#c02c5b)}.kind-action{--kind:var(--progress,#2563eb)}.kind-delegate{--kind:var(--wontdo,#7c3aed)}.kind-audit{--kind:var(--unknown,#b36b00)}.kind-terminal{--kind:var(--done,#16803c)}.node-rect{fill:color-mix(in srgb,var(--kind,var(--node-border,#334155)) 9%,var(--card,#f8fafc));stroke:var(--kind,var(--node-border,#334155));stroke-width:1.5}.node-icon{fill:color-mix(in srgb,var(--kind,#334155) 14%,transparent);stroke:var(--kind,#334155);stroke-width:1.2}.node-glyph{font-size:11px;fill:var(--kind,#334155)}.node-rect.current{stroke-width:3;filter:drop-shadow(0 0 6px var(--kind,var(--current-border,#a15c00)));animation:dash-pulse 1.8s ease-in-out infinite}.edge{fill:none;stroke-width:1.8;opacity:.85}.edge-fwd{stroke:var(--accent,#2563eb)}.edge-back{stroke:var(--unknown,#b36b00)}.edge-self{stroke:var(--muted,#64748b);stroke-dasharray:5 4}.edge.edge-active{stroke:var(--sel-edge,#c02c5b);stroke-width:3.5;opacity:1;stroke-dasharray:none;filter:drop-shadow(0 0 4px var(--sel-edge,#c02c5b))}.edge.edge-dim{opacity:.12}.edge.edge-connected{stroke:var(--sel-edge,#c02c5b);stroke-width:3;opacity:1;stroke-dasharray:none}g[data-node]:hover .node-rect{stroke-width:2.5;filter:drop-shadow(0 0 5px var(--kind,#334155))}@keyframes dash-pulse{0%,100%{opacity:1}50%{opacity:.6}}@media(prefers-reduced-motion:reduce){.node-rect.current{animation:none}}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="execution-title execution-desc" viewBox="0 0 ${layout.width} ${height}"><title id="execution-title">Execution Graph</title><desc id="execution-desc">上段はセットアップ、中段はメインフロー、下段は戻り・修復の遷移です。遷移条件は直後の表を参照</desc><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke"/></marker></defs><style>${style}</style>${edgePaths}${nodeGroups}</svg>`;
}
