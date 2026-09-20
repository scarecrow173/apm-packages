import type { GraphInspection } from "./graph_inspector";

function xml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] as string);
}

function short(value: string): string {
  return value.length <= 26 ? value : `${value.slice(0, 25)}…`;
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
    return `<path id="edge-${index}" d="${d}" fill="none" stroke="${active ? "#c02c5b" : "#64748b"}" stroke-width="${active ? "4" : "2"}" marker-end="url(#arrow)"><title>${xml(`${edge.id}: ${edge.from} → ${edge.to}; ${edge.when}; priority ${edge.priority}`)}</title></path>${active ? `<text x="${from.x + 4}" y="${from.y + nodeHeight + 18}" class="selected-label">選択 edge</text>` : ""}`;
  }).join("");
  const nodeGroups = nodes.map((node) => {
    const position = positions.get(node.nodeId)!;
    const current = node.nodeId === selected.current;
    return `<g id="${position.alias}"><title>${xml(`${node.nodeId} (${node.kind})`)}</title><rect x="${position.x}" y="${position.y}" width="${nodeWidth}" height="${nodeHeight}" rx="8" fill="${current ? "#fff1c2" : "#f8fafc"}" stroke="${current ? "#a15c00" : "#334155"}" stroke-width="${current ? "4" : "2"}"/><text x="${position.x + 12}" y="${position.y + 28}">${xml(short(node.nodeId))}</text><text x="${position.x + 12}" y="${position.y + 53}" class="node-kind">kind: ${xml(short(node.kind))}</text>${current ? `<text x="${position.x + 118}" y="${position.y + 53}" class="selected-label">指定ノード</text>` : ""}</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="execution-title execution-desc" viewBox="0 0 ${width} ${height}"><title id="execution-title">Execution Graph</title><desc id="execution-desc">遷移条件は直後の表を参照</desc><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke"/></marker></defs><style>text{font:14px system-ui,sans-serif;fill:#172033}.node-kind{font-size:12px}.selected-label{font-size:11px;font-weight:700;fill:#8b1e45}</style>${edgePaths}${nodeGroups}</svg>`;
}
