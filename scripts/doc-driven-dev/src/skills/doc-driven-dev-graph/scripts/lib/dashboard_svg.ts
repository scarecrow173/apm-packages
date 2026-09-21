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

export { kindGlyphs as nodeKindGlyphs, kindClass as nodeKindClass };

/** Flow order for labels outside the SVG: BFS distance from entry. */
export function nodeFlowOrder(inspection: GraphInspection): Map<string, number> {
  return computeDistance(inspection);
}

type Edge = GraphInspection["edges"][number];
type Pair = { from: string; to: string; edges: Edge[] };
type Classified = Pair & { cls: "self" | "fwd" | "back"; topWrap: boolean };

type Layout = {
  position: Map<string, { x: number; y: number; alias: string }>;
  spineIndex: Map<string, number>;
  distance: Map<string, number>;
  rowOf: (nodeId: string) => number;
  splitAt: number;
  classified: Classified[];
  width: number;
  height: number;
  branchY: number;
  spineY0: number;
  spineY1: number;
  row0Gap: number;
  midLaneY: Map<string, number>;
  gapLaneY: Map<string, number>;
  wrapLaneY: Map<string, number>;
  marginX: Map<string, number>;
  bottomDepth: Map<string, number>;
};

const NODE_W = 230;
const NODE_H = 72;
const COL = 270;
const MARGIN_X = 40;
const MID_LANE_TOP = 16;
const MID_LANE_STEP = 18;
const GAP_LANE_STEP = 20;
const SELF_CLEAR = 56;
const SPLIT_MIN = 6;

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

const pairKey = (pair: Pair) => `${pair.from}->${pair.to}`;

/** Classify each pair: self-loop, forward (BFS distance grows or stays level),
 * or backward (returns to an earlier stage). */
function classifyPairs(
  pairs: Pair[],
  distance: Map<string, number>,
  rowOf: (nodeId: string) => number,
): Classified[] {
  return pairs.map((pair) => {
    if (pair.from === pair.to) return { ...pair, cls: "self" as const, topWrap: false };
    const fromDist = distance.get(pair.from) ?? Number.MAX_SAFE_INTEGER;
    const toDist = distance.get(pair.to) ?? Number.MAX_SAFE_INTEGER;
    const backward = toDist < fromDist
      && !(fromDist === Number.MAX_SAFE_INTEGER && toDist === Number.MAX_SAFE_INTEGER);
    const topWrap = backward && rowOf(pair.from) >= 0 && rowOf(pair.to) === -1;
    return { ...pair, cls: backward ? "back" as const : "fwd" as const, topWrap };
  });
}

function computeLayout(inspection: GraphInspection, pairs: Pair[]): Layout {
  const nodes = [...inspection.nodes].sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const aliases = new Map(nodes.map((node, index) => [node.nodeId, `node-${index}`]));
  const spine = computeSpine(inspection);
  const spineIndex = new Map(spine.map((nodeId, index) => [nodeId, index]));
  const distance = computeDistance(inspection);
  const splitAt = spine.length >= SPLIT_MIN ? Math.ceil(spine.length / 2) : spine.length;
  const rowOf = (nodeId: string) => {
    const index = spineIndex.get(nodeId);
    return index === undefined ? -1 : index < splitAt ? 0 : 1;
  };
  const classified = classifyPairs(pairs, distance, rowOf);
  const span = (pair: Pair) => Math.abs(
    (spineIndex.get(pair.from) ?? 0) - (spineIndex.get(pair.to) ?? 0),
  );
  const byKey = (left: Pair, right: Pair) => pairKey(left).localeCompare(pairKey(right));
  const bySpan = (left: Pair, right: Pair) => span(right) - span(left) || byKey(left, right);
  const isContinuation = (pair: Pair) =>
    spineIndex.get(pair.from) === splitAt - 1 && spineIndex.get(pair.to) === splitAt;

  // Inter-row channel lanes, shallow (row-0 side) to deep (row-1 side):
  // row-0 backward dips, row-1 backward risers, margin-feed wraps, misc, then
  // the row-continuation wire deepest so forward flow reads as a clean wrap.
  const midA = classified.filter((pair) => pair.cls === "back" && !pair.topWrap
    && rowOf(pair.from) === 0 && rowOf(pair.to) === 0).sort(bySpan);
  const midB = classified.filter((pair) => pair.cls === "back" && !pair.topWrap
    && rowOf(pair.from) === 1 && rowOf(pair.to) === 0).sort(bySpan);
  const midC = classified.filter((pair) => (pair.topWrap && rowOf(pair.from) === 1)
    || (pair.cls === "back" && rowOf(pair.from) === -1 && rowOf(pair.to) === 1)
    || (pair.cls === "fwd" && rowOf(pair.from) === 1 && rowOf(pair.to) === -1)
    || (pair.cls === "fwd" && rowOf(pair.from) === -1 && rowOf(pair.to) === 1)).sort(byKey);
  const midD = classified.filter((pair) => pair.cls !== "self" && !pair.topWrap
    && rowOf(pair.from) === 0 && rowOf(pair.to) === 1 && !isContinuation(pair)).sort(byKey);
  const midKeys = [...midA, ...midB, ...midC, ...midD, ...classified.filter(isContinuation)]
    .map(pairKey);

  // Return channel below row 1 for backward edges that stay inside row 1.
  const bottomPairs = classified.filter((pair) => pair.cls === "back"
    && rowOf(pair.from) === 1 && rowOf(pair.to) === 1).sort(bySpan);
  const bottomDepth = new Map(bottomPairs.map((pair, index) => [pairKey(pair), 56 + index * 26]));

  // Over-the-top lanes and left-margin risers for edges wrapping to the branch lane.
  const overTop = classified.filter((pair) => pair.topWrap
    || (pair.cls !== "self" && rowOf(pair.from) === 1 && rowOf(pair.to) === -1)
    || (pair.cls !== "self" && rowOf(pair.from) === -1 && rowOf(pair.to) === 1)).sort(byKey);
  const marginX = new Map(overTop.map((pair, index) => [pairKey(pair), 14 + index * 12]));
  const wrapLaneY = new Map<string, number>();

  // Row-0 gap lanes for backward edges that rise straight into the branch lane.
  const gapPairs = classified.filter((pair) => pair.topWrap && rowOf(pair.from) === 0).sort(byKey);
  const gapLaneY = new Map<string, number>();

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

  const branchY = 60 + Math.max(1, overTop.length) * 26;
  const row0Gap = Math.max(120, SELF_CLEAR + gapPairs.length * GAP_LANE_STEP + 24);
  const spineY0 = branchY + NODE_H + row0Gap;
  const rowGap = midKeys.length > 0
    ? MID_LANE_TOP + (midKeys.length - 1) * MID_LANE_STEP + SELF_CLEAR + 28
    : 96;
  const hasRow1 = splitAt < spine.length;
  const spineY1 = spineY0 + NODE_H + rowGap;
  const midLaneY = new Map(midKeys.map((key, index) => [
    key, spineY0 + NODE_H + MID_LANE_TOP + index * MID_LANE_STEP,
  ]));
  overTop.forEach((pair, index) => wrapLaneY.set(pairKey(pair), branchY - 60 - index * 26));
  gapPairs.forEach((pair, index) => gapLaneY.set(pairKey(pair), spineY0 - SELF_CLEAR - 8 - index * GAP_LANE_STEP));

  const position = new Map<string, { x: number; y: number; alias: string }>();
  spine.forEach((nodeId, index) => {
    const column = index < splitAt ? index : index - splitAt;
    position.set(nodeId, {
      x: MARGIN_X + column * COL,
      y: index < splitAt ? spineY0 : spineY1,
      alias: aliases.get(nodeId)!,
    });
  });
  const usedColumns = new Set<number>();
  for (const node of offSpine) {
    const anchored = node.anchor === Number.MAX_SAFE_INTEGER ? usedColumns.size : node.anchor;
    let column = anchored < splitAt ? anchored : anchored - splitAt;
    while (usedColumns.has(column)) column += 1;
    usedColumns.add(column);
    position.set(node.nodeId, { x: MARGIN_X + column * COL, y: branchY, alias: aliases.get(node.nodeId)! });
  }

  const maxCols = Math.max(splitAt, spine.length - splitAt, offSpine.length);
  const width = MARGIN_X + maxCols * COL + 44;
  const height = hasRow1
    ? spineY1 + NODE_H + (bottomPairs.length > 0 ? 56 + (bottomPairs.length - 1) * 26 : 24) + 64
    : (midKeys.length > 0
      ? spineY0 + NODE_H + MID_LANE_TOP + (midKeys.length - 1) * MID_LANE_STEP + 64
      : spineY0 + NODE_H + 90);
  return {
    position, spineIndex, distance, rowOf, splitAt, classified, width, height,
    branchY, spineY0, spineY1, row0Gap, midLaneY, gapLaneY, wrapLaneY, marginX, bottomDepth,
  };
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
  const { position, classified, rowOf } = layout;
  const isContinuation = (pair: Pair) =>
    layout.spineIndex.get(pair.from) === layout.splitAt - 1
    && layout.spineIndex.get(pair.to) === layout.splitAt;

  // Spread multiple backward edges leaving or entering the same node edge.
  const spread = (pairsForNode: Classified[], keyOf: (pair: Classified) => string) => {
    const offsets = new Map<string, number>();
    const groups = new Map<string, Classified[]>();
    for (const pair of pairsForNode) {
      const key = keyOf(pair);
      groups.set(key, [...(groups.get(key) ?? []), pair]);
    }
    for (const group of groups.values()) {
      group.forEach((pair, index) => {
        offsets.set(pairKey(pair), (index - (group.length - 1) / 2) * 16);
      });
    }
    return offsets;
  };
  const backPairs = classified.filter((pair) => pair.cls === "back");
  const backStartOffset = spread(backPairs, (pair) => pair.from);
  const backEndOffset = spread(backPairs, (pair) => pair.to);

  const activeEdge = edges.find((edge) => edge.id === selected.edgeId);

  const edgePaths = classified.map((pair) => {
    const from = position.get(pair.from);
    const to = position.get(pair.to);
    if (!from || !to) return "";
    const key = pairKey(pair);
    const active = pair.edges.some((edge) => edge.id === selected.edgeId);
    const ids = pair.edges.map((edge) => edge.id).join(", ");
    const conditions = pair.edges.map((edge) => edge.when).join("; ");
    const cls = `edge edge-${pair.cls}${active ? " edge-active" : ""}`;
    const startX = from.x + NODE_W / 2 + (pair.cls === "back" ? backStartOffset.get(key) ?? 0 : 0);
    const endX = to.x + NODE_W / 2 + (pair.cls === "back" ? backEndOffset.get(key) ?? 0 : 0);
    const fr = rowOf(pair.from);
    const tr = rowOf(pair.to);
    const laneY = layout.midLaneY.get(key) ?? layout.spineY0 + NODE_H + MID_LANE_TOP;
    const wy = layout.wrapLaneY.get(key) ?? layout.branchY - 60;
    const mx = layout.marginX.get(key) ?? 14;
    const gapY = layout.gapLaneY.get(key) ?? layout.spineY0 - SELF_CLEAR - 8;
    let d: string;
    let labelX = endX;
    let labelY = to.y - 10;
    if (pair.cls === "self") {
      d = `M ${startX - 26} ${from.y} C ${startX - 26} ${from.y - 46}, ${startX + 26} ${from.y - 46}, ${startX + 26} ${from.y}`;
      labelX = startX;
      labelY = from.y - 52;
    } else if (pair.cls === "back" && pair.topWrap) {
      // Return into the branch lane: feed the left margin, run over the top,
      // then drop onto the branch node.
      if (fr === 0) {
        d = `M ${startX} ${from.y} L ${startX} ${gapY} L ${mx} ${gapY} L ${mx} ${wy} L ${endX} ${wy} L ${endX} ${to.y}`;
      } else {
        d = `M ${startX} ${from.y} L ${startX} ${laneY} L ${mx} ${laneY} L ${mx} ${wy} L ${endX} ${wy} L ${endX} ${to.y}`;
      }
      labelX = (mx + endX) / 2;
      labelY = wy - 8;
    } else if (pair.cls === "back" && tr === 0) {
      // Backward edges into row 0 ride the inter-row channel and enter the
      // target from below; row-1 sources exit upward, row-0 sources dip.
      if (fr === -1) {
        d = `M ${startX} ${from.y + NODE_H} C ${startX} ${from.y + NODE_H + 60}, ${endX} ${to.y - 44}, ${endX} ${to.y}`;
      } else {
        const exit = fr === 0 ? from.y + NODE_H : from.y;
        d = `M ${startX} ${exit} L ${startX} ${laneY} L ${endX} ${laneY} L ${endX} ${to.y + NODE_H}`;
        labelX = (startX + endX) / 2;
        labelY = laneY - 8;
      }
    } else if (pair.cls === "back" && tr === 1 && fr === 1) {
      const depth = layout.bottomDepth.get(key) ?? 56;
      d = `M ${startX} ${from.y + NODE_H} L ${startX} ${from.y + NODE_H + depth} L ${endX} ${to.y + NODE_H + depth} L ${endX} ${to.y + NODE_H}`;
      labelX = (startX + endX) / 2;
      labelY = from.y + NODE_H + depth + 14;
    } else if (pair.cls === "back" && tr === 1 && fr === 0) {
      d = `M ${startX} ${from.y + NODE_H} L ${startX} ${laneY} L ${endX} ${laneY} L ${endX} ${to.y}`;
      labelX = (startX + endX) / 2;
      labelY = laneY - 8;
    } else if (pair.cls === "back" && tr === 1) {
      // Branch-lane source returning deep into row 1: wrap the left margin.
      d = `M ${startX} ${from.y} L ${startX} ${wy} L ${mx} ${wy} L ${mx} ${laneY} L ${endX} ${laneY} L ${endX} ${to.y}`;
      labelX = (mx + endX) / 2;
      labelY = wy - 8;
    } else if (pair.cls === "back") {
      d = `M ${startX} ${from.y + NODE_H} C ${startX} ${from.y + NODE_H + 56}, ${endX} ${to.y + NODE_H + 56}, ${endX} ${to.y + NODE_H}`;
    } else if (isContinuation(pair)) {
      // Row wrap: the spine continues on the deepest channel lane and drops
      // into the next row's first node near its top-right corner.
      const sx = from.x + NODE_W / 2 + 28;
      const ex = to.x + NODE_W - 30;
      d = `M ${sx} ${from.y + NODE_H} L ${sx} ${laneY} L ${ex} ${laneY} L ${ex} ${to.y}`;
      labelX = (sx + ex) / 2;
      labelY = laneY - 8;
    } else if (fr >= 0 && tr >= 0) {
      const span = (layout.spineIndex.get(pair.to) ?? 0) - (layout.spineIndex.get(pair.from) ?? 0);
      if (fr !== tr) {
        // Rare forward hop across rows other than the row wrap.
        d = `M ${startX} ${from.y + NODE_H} L ${startX} ${laneY} L ${endX} ${laneY} L ${endX} ${to.y}`;
        labelX = (startX + endX) / 2;
        labelY = laneY - 8;
      } else if (span === 1) {
        d = `M ${from.x + NODE_W} ${from.y + NODE_H / 2} L ${to.x} ${to.y + NODE_H / 2}`;
        labelY = to.y - 10;
      } else if (fr === 0) {
        const lift = Math.min(44 + Math.min(span, 4) * 18, layout.row0Gap - 46);
        d = `M ${startX} ${from.y} C ${startX} ${from.y - lift}, ${endX} ${to.y - lift}, ${endX} ${to.y}`;
        labelX = (startX + endX) / 2;
        labelY = Math.min(from.y, to.y) - lift - 6;
      } else {
        const dip = 30;
        d = `M ${startX} ${from.y + NODE_H} L ${startX} ${from.y + NODE_H + dip} L ${endX} ${to.y + NODE_H + dip} L ${endX} ${to.y + NODE_H}`;
        labelX = (startX + endX) / 2;
        labelY = from.y + NODE_H + dip + 12;
      }
    } else if (fr >= 0 && tr === -1) {
      if (fr === 0) {
        // Forward edge from row 0 up into the branch lane.
        d = `M ${startX} ${from.y} C ${startX} ${from.y - 80}, ${endX} ${to.y + NODE_H + 42}, ${endX} ${to.y + NODE_H}`;
        labelX = (startX + endX) / 2;
        labelY = Math.min(from.y, to.y) - 14;
      } else {
        // Row-1 source feeding the branch lane wraps the left margin.
        d = `M ${startX} ${from.y} L ${startX} ${laneY} L ${mx} ${laneY} L ${mx} ${wy} L ${endX} ${wy} L ${endX} ${to.y}`;
        labelX = (mx + endX) / 2;
        labelY = wy - 8;
      }
    } else if (fr === -1 && tr >= 0) {
      if (tr === 0) {
        // Branch lane feeding down into row 0.
        d = `M ${startX} ${from.y + NODE_H} C ${startX} ${from.y + NODE_H + 78}, ${endX} ${to.y - 42}, ${endX} ${to.y}`;
        labelY = to.y - 10;
      } else {
        d = `M ${startX} ${from.y} L ${startX} ${wy} L ${mx} ${wy} L ${mx} ${laneY} L ${endX} ${laneY} L ${endX} ${to.y}`;
        labelX = (mx + endX) / 2;
        labelY = wy - 8;
      }
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

  const style = `text{font-family:var(--pico-font-family-monospace,ui-monospace,monospace);font-size:13px;fill:var(--fg,#172033)}.node-title{font-weight:700}.node-kind{font-size:11px;fill:var(--muted,#64748b)}.selected-label{font-size:10px;font-weight:700;letter-spacing:.06em;fill:var(--sel,#8b1e45)}.edge-label{font-size:10px;fill:var(--sel-edge,#c02c5b)}.kind-action{--kind:var(--progress,#2563eb)}.kind-delegate{--kind:var(--wontdo,#7c3aed)}.kind-audit{--kind:var(--unknown,#b36b00)}.kind-terminal{--kind:var(--done,#16803c)}.node-rect{fill:color-mix(in srgb,var(--kind,var(--node-border,#334155)) 9%,var(--card,#f8fafc));stroke:var(--kind,var(--node-border,#334155));stroke-width:1.5}.node-icon{fill:color-mix(in srgb,var(--kind,#334155) 14%,transparent);stroke:var(--kind,#334155);stroke-width:1.2}.node-glyph{font-size:11px;fill:var(--kind,#334155)}.node-rect.current{stroke-width:3;filter:drop-shadow(0 0 6px var(--kind,var(--current-border,#a15c00)));animation:dash-pulse 1.8s ease-in-out infinite}.edge{fill:none;stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round;opacity:.85}.edge-fwd{stroke:var(--accent,#2563eb)}.edge-back{stroke:var(--unknown,#b36b00)}.edge-self{stroke:var(--muted,#64748b);stroke-dasharray:5 4}.edge.edge-active{stroke:var(--sel-edge,#c02c5b);stroke-width:3.5;opacity:1;stroke-dasharray:none;filter:drop-shadow(0 0 4px var(--sel-edge,#c02c5b))}.edge.edge-dim{opacity:.12}.edge.edge-connected{stroke:var(--sel-edge,#c02c5b);stroke-width:3;opacity:1;stroke-dasharray:none}g[data-node]:hover .node-rect{stroke-width:2.5;filter:drop-shadow(0 0 5px var(--kind,#334155))}@keyframes dash-pulse{0%,100%{opacity:1}50%{opacity:.6}}@media(prefers-reduced-motion:reduce){.node-rect.current{animation:none}}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="execution-title execution-desc" viewBox="0 0 ${layout.width} ${layout.height}"><title id="execution-title">Execution Graph</title><desc id="execution-desc">上段はセットアップ、中央2段はメインフロー（右端で下段へ折り返し）、段間と下段は戻り・修復の遷移です。遷移条件はedgeのツールチップと遷移プレビューを参照</desc><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke"/></marker></defs><style>${style}</style>${edgePaths}${nodeGroups}</svg>`;
}
