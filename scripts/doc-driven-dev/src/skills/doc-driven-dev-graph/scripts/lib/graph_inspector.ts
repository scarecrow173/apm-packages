import type { GraphDefinition, GraphEdge, GraphNode } from "./graph_definition";

export type GraphInspectionIssue = {
  severity: "error" | "warning";
  code: "unreachable-node" | "unreachable-terminal" | "no-reachable-terminal" | "unused-condition";
  nodeId?: string;
  condition?: string;
};

type InspectedNode = {
  nodeId: string;
  kind: GraphNode["kind"];
  delegate?: string;
  audits: string[];
};

type InspectedEdge = Pick<GraphEdge, "id" | "from" | "to" | "when" | "priority">;

export type GraphInspection = {
  schemaVersion: 1;
  graphId: string;
  entry: string;
  nodeCount: number;
  edgeCount: number;
  conditionCount: number;
  terminalNodes: string[];
  reachableNodes: string[];
  unreachableNodes: string[];
  reachableTerminalNodes: string[];
  unusedConditions: string[];
  referencedConditions: string[];
  delegates: Array<{ nodeId: string; delegate: string }>;
  audits: Array<{ nodeId: string; audits: string[] }>;
  issues: GraphInspectionIssue[];
  /** Serializable node data used by the Mermaid renderer. */
  nodes: InspectedNode[];
  /** Serializable edge data used by the Mermaid renderer. */
  edges: InspectedEdge[];
};

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedStrings(values: Iterable<string>): string[] {
  return [...values].sort(compareStrings);
}

function sortedEdges(edges: Iterable<GraphEdge>): InspectedEdge[] {
  return [...edges]
    .sort((left, right) => (
      compareStrings(left.from, right.from)
      || left.priority - right.priority
      || compareStrings(left.id, right.id)
    ))
    .map(({ id, from, to, when, priority }) => ({ id, from, to, when, priority }));
}

function issueSort(left: GraphInspectionIssue, right: GraphInspectionIssue): number {
  return compareStrings(left.code, right.code)
    || compareStrings(left.nodeId ?? "", right.nodeId ?? "")
    || compareStrings(left.condition ?? "", right.condition ?? "");
}

function escapeMermaidLabel(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function mermaidNodeAliases(nodes: readonly InspectedNode[]): Map<string, string> {
  return new Map(
    [...nodes]
      .sort((left, right) => compareStrings(left.nodeId, right.nodeId))
      .map((node, index) => [node.nodeId, `n${index}`]),
  );
}

function renderNode(
  node: InspectedNode,
  terminalNodes: ReadonlySet<string>,
  aliases: ReadonlyMap<string, string>,
): string {
  const labels = [node.nodeId, `kind: ${node.kind}`];
  if (node.delegate !== undefined) labels.push(`delegate: ${node.delegate}`);
  if (terminalNodes.has(node.nodeId)) labels.push("terminal");
  if (node.audits.length > 0) labels.push(`audits: ${node.audits.join(", ")}`);
  return `  ${aliases.get(node.nodeId) ?? node.nodeId}["${escapeMermaidLabel(labels.join("<br/>"))}"]`;
}

/** Inspect graph topology without evaluating any edge conditions. */
export function inspectGraphDefinition(definition: GraphDefinition): GraphInspection {
  const nodeIds = sortedStrings(Object.keys(definition.nodes));
  const terminalNodes = sortedStrings(
    nodeIds.filter((nodeId) => definition.nodes[nodeId].kind === "terminal"),
  );
  const outgoing = new Map<string, string[]>();
  for (const edge of definition.edges) {
    const destinations = outgoing.get(edge.from) ?? [];
    destinations.push(edge.to);
    outgoing.set(edge.from, destinations);
  }

  const reachable = new Set<string>([definition.entry]);
  const pending = [definition.entry];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const destination of outgoing.get(current) ?? []) {
      if (!reachable.has(destination)) {
        reachable.add(destination);
        pending.push(destination);
      }
    }
  }

  const reachableNodes = sortedStrings(reachable);
  const unreachableNodes = nodeIds.filter((nodeId) => !reachable.has(nodeId));
  const reachableTerminalNodes = terminalNodes.filter((nodeId) => reachable.has(nodeId));
  const prerequisiteGateNames = Object.values(definition.nodes)
    .flatMap((node) => node.requiresGates ?? []);
  const prerequisiteGateConditions = Object.entries(definition.conditions)
    .filter(([, condition]) => condition.kind === "gate" && prerequisiteGateNames.includes(condition.gate))
    .map(([conditionKey]) => conditionKey);
  const signalConditions = Object.entries(definition.conditions)
    .filter(([, condition]) => condition.kind === "signal")
    .map(([conditionKey]) => conditionKey);
  const referencedConditions = sortedStrings(new Set([
    ...definition.edges.map((edge) => edge.when),
    ...prerequisiteGateConditions,
    ...signalConditions,
  ]));
  const referencedConditionSet = new Set(referencedConditions);
  const unusedConditions = sortedStrings(
    Object.keys(definition.conditions).filter((condition) => !referencedConditionSet.has(condition)),
  );

  const nodes = nodeIds.map((nodeId) => {
    const node = definition.nodes[nodeId];
    return {
      nodeId,
      kind: node.kind,
      ...(node.delegate === undefined ? {} : { delegate: node.delegate }),
      audits: sortedStrings(node.audits ?? []),
    };
  });
  const delegates = nodes
    .filter((node): node is InspectedNode & { delegate: string } => node.delegate !== undefined)
    .map(({ nodeId, delegate }) => ({ nodeId, delegate }));
  const audits = nodes
    .filter((node) => node.audits.length > 0)
    .map(({ nodeId, audits: nodeAudits }) => ({ nodeId, audits: nodeAudits }));
  const edges = sortedEdges(definition.edges);

  const issues: GraphInspectionIssue[] = [];
  for (const nodeId of unreachableNodes) {
    if (terminalNodes.includes(nodeId)) {
      issues.push({ severity: "warning", code: "unreachable-terminal", nodeId });
    } else {
      issues.push({ severity: "error", code: "unreachable-node", nodeId });
    }
  }
  if (reachableTerminalNodes.length === 0) {
    issues.push({ severity: "error", code: "no-reachable-terminal" });
  }
  for (const condition of unusedConditions) {
    issues.push({ severity: "warning", code: "unused-condition", condition });
  }

  return {
    schemaVersion: 1,
    graphId: definition.id,
    entry: definition.entry,
    nodeCount: nodeIds.length,
    edgeCount: definition.edges.length,
    conditionCount: Object.keys(definition.conditions).length,
    terminalNodes,
    reachableNodes,
    unreachableNodes,
    reachableTerminalNodes,
    unusedConditions,
    referencedConditions,
    delegates,
    audits,
    issues: issues.sort(issueSort),
    nodes,
    edges,
  };
}

/** Render a graph inspection as deterministic Mermaid flowchart text. */
export function renderGraphMermaid(inspection: GraphInspection): string {
  const terminalNodes = new Set(inspection.terminalNodes);
  const nodes = [...inspection.nodes].sort((left, right) => compareStrings(left.nodeId, right.nodeId));
  const aliases = mermaidNodeAliases(nodes);
  const edges = [...inspection.edges].sort((left, right) => (
    compareStrings(left.from, right.from)
    || left.priority - right.priority
    || compareStrings(left.id, right.id)
  ));
  return [
    "flowchart TD",
    ...nodes.map((node) => renderNode(node, terminalNodes, aliases)),
    ...edges.map((edge) => (
      `  ${aliases.get(edge.from) ?? edge.from} -->|${escapeMermaidLabel(`${edge.when} · p${edge.priority}`)}| ${aliases.get(edge.to) ?? edge.to}`
    )),
  ].join("\n");
}
