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

export function renderExecutionSvg(
  inspection: GraphInspection,
  selected: { current: string | null; edgeId: string | null },
): string {
  const nodes = [...inspection.nodes].sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const positions = new Map(nodes.map((node, index) => [node.nodeId, {
    alias: `node-${index}`, x: 30 + (index % 3) * 300, y: 40 + Math.floor(index / 3) * 130,
  }]));
  const nodeWidth = 230;
  const nodeHeight = 72;
  const width = 880;
  const height = 70 + Math.max(1, Math.ceil(nodes.length / 3)) * 130;
  const edges = [...inspection.edges].sort((left, right) => left.from.localeCompare(right.from)
    || left.priority - right.priority || left.id.localeCompare(right.id));
  const edgePaths = edges.map((edge, index) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return "";
    const active = edge.id === selected.edgeId;
    const d = edge.from === edge.to
      ? `M ${from.x + nodeWidth - 28} ${from.y} C ${from.x + nodeWidth + 60} ${from.y - 45}, ${from.x + nodeWidth + 60} ${from.y + 45}, ${from.x + nodeWidth} ${from.y + 24}`
      : `M ${from.x + nodeWidth / 2} ${from.y + nodeHeight} C ${from.x + nodeWidth / 2} ${from.y + nodeHeight + 38}, ${to.x + nodeWidth / 2} ${to.y - 38}, ${to.x + nodeWidth / 2} ${to.y}`;
    const label = active
      ? `<text x="${to.x + nodeWidth / 2}" y="${to.y - 10}" class="edge-label" text-anchor="middle">${xml(short(edge.when))}</text>`
      : "";
    return `<path id="edge-${index}" class="edge${active ? " edge-active" : ""}" data-from="${from.alias}" data-to="${to.alias}" d="${d}" marker-end="url(#arrow)"><title>${xml(`${edge.id}: ${edge.from} → ${edge.to}; ${edge.when}; priority ${edge.priority}`)}</title></path>${label}`;
  }).join("");
  const nodeGroups = nodes.map((node) => {
    const position = positions.get(node.nodeId)!;
    const current = node.nodeId === selected.current;
    const glyph = kindGlyphs[node.kind] ?? "·";
    return `<g id="${position.alias}" data-node="${position.alias}" class="${kindClass(node.kind)}"><title>${xml(`${node.nodeId} (${node.kind})`)}</title><rect class="node-rect${current ? " current" : ""}" x="${position.x}" y="${position.y}" width="${nodeWidth}" height="${nodeHeight}" rx="10"/><rect class="node-icon" x="${position.x + 11}" y="${position.y + 13}" width="19" height="19" rx="5"/><text class="node-glyph" x="${position.x + 20.5}" y="${position.y + 27}" text-anchor="middle">${xml(glyph)}</text><text class="node-title" x="${position.x + 38}" y="${position.y + 29}">${xml(short(node.nodeId))}</text><text x="${position.x + 38}" y="${position.y + 53}" class="node-kind">kind: ${xml(short(node.kind))}</text>${current ? `<text x="${position.x + nodeWidth - 12}" y="${position.y + 18}" class="selected-label" text-anchor="end">現在</text>` : ""}</g>`;
  }).join("");
  const style = `text{font-family:var(--pico-font-family-monospace,ui-monospace,monospace);font-size:13px;fill:var(--fg,#172033)}.node-title{font-weight:700}.node-kind{font-size:11px;fill:var(--muted,#64748b)}.selected-label{font-size:10px;font-weight:700;letter-spacing:.06em;fill:var(--sel,#8b1e45)}.edge-label{font-size:10px;fill:var(--sel-edge,#c02c5b)}.kind-action{--kind:var(--progress,#2563eb)}.kind-delegate{--kind:var(--wontdo,#7c3aed)}.kind-audit{--kind:var(--unknown,#b36b00)}.kind-terminal{--kind:var(--done,#16803c)}.node-rect{fill:color-mix(in srgb,var(--kind,var(--node-border,#334155)) 9%,var(--card,#f8fafc));stroke:var(--kind,var(--node-border,#334155));stroke-width:1.5}.node-icon{fill:color-mix(in srgb,var(--kind,#334155) 14%,transparent);stroke:var(--kind,#334155);stroke-width:1.2}.node-glyph{font-size:11px;fill:var(--kind,#334155)}.node-rect.current{stroke-width:3;filter:drop-shadow(0 0 6px var(--kind,var(--current-border,#a15c00)));animation:dash-pulse 1.8s ease-in-out infinite}.edge{fill:none;stroke:var(--accent,#2563eb);stroke-width:1.8;opacity:.8}.edge.edge-active{stroke:var(--sel-edge,#c02c5b);stroke-width:3.5;opacity:1;filter:drop-shadow(0 0 4px var(--sel-edge,#c02c5b))}.edge.edge-dim{opacity:.12}.edge.edge-connected{stroke:var(--sel-edge,#c02c5b);stroke-width:3;opacity:1}g[data-node]:hover .node-rect{stroke-width:2.5;filter:drop-shadow(0 0 5px var(--kind,#334155))}@keyframes dash-pulse{0%,100%{opacity:1}50%{opacity:.6}}@media(prefers-reduced-motion:reduce){.node-rect.current{animation:none}}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="execution-title execution-desc" viewBox="0 0 ${width} ${height}"><title id="execution-title">Execution Graph</title><desc id="execution-desc">遷移条件は直後の表を参照</desc><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke"/></marker></defs><style>${style}</style>${edgePaths}${nodeGroups}</svg>`;
}
