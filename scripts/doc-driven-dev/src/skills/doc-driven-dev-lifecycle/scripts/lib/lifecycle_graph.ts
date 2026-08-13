import fs from "node:fs";

import * as yaml from "js-yaml";
import { z } from "zod";

/** The nodes that make up the lifecycle execution topology. */
export type LifecycleNodeId =
  | "probe"
  | "migration"
  | "bootstrap"
  | "briefing"
  | "design"
  | "planning"
  | "task-graph"
  | "implementation"
  | "followup-triage"
  | "exit-audit"
  | "complete";

export type LifecycleNodeKind = "probe" | "action" | "subgraph" | "gate" | "audit" | "terminal";

/** Signals and gate outcomes that can select a lifecycle edge. */
export type LifecycleReasonCode =
  | "focus-required"
  | "migration-requested"
  | "migration-incomplete"
  | "migration-complete"
  | "bootstrap-incomplete"
  | "bootstrap-complete"
  | "briefing-incomplete"
  | "briefing-complete"
  | "spec-gap"
  | "design-incomplete"
  | "design-complete"
  | "design-gap"
  | "planning-incomplete"
  | "planning-complete"
  | "constraint-gap"
  | "task-graph-invalid"
  | "task-graph-retry"
  | "tasks-runnable"
  | "implementation-incomplete"
  | "implementation-verified"
  | "followups-unclassified"
  | "followups-classified"
  | "exit-audit-required"
  | "exit-audit-pass"
  | "lifecycle-complete";

export type LifecycleNode = {
  kind: LifecycleNodeKind;
  delegate: string | null;
  audits: string[];
};

export type LifecycleEdge = {
  id: string;
  from: LifecycleNodeId;
  to: LifecycleNodeId;
  when: LifecycleReasonCode;
};

export type LifecycleGraph = {
  schemaVersion: 1;
  entry: LifecycleNodeId;
  nodes: Record<LifecycleNodeId, LifecycleNode>;
  edges: LifecycleEdge[];
};

const lifecycleNodeId = z.string().min(1);
const lifecycleNodeSchema = z.object({
  kind: z.enum(["probe", "action", "subgraph", "gate", "audit", "terminal"]),
  delegate: z.string().min(1).nullable(),
  audits: z.array(z.string().min(1)),
}).strict();

const lifecycleReasonCode = z.enum([
  "focus-required",
  "migration-requested",
  "migration-incomplete",
  "migration-complete",
  "bootstrap-incomplete",
  "bootstrap-complete",
  "briefing-incomplete",
  "briefing-complete",
  "spec-gap",
  "design-incomplete",
  "design-complete",
  "design-gap",
  "planning-incomplete",
  "planning-complete",
  "constraint-gap",
  "task-graph-invalid",
  "task-graph-retry",
  "tasks-runnable",
  "implementation-incomplete",
  "implementation-verified",
  "followups-unclassified",
  "followups-classified",
  "exit-audit-required",
  "exit-audit-pass",
  "lifecycle-complete",
]);

const lifecycleEdgeSchema = z.object({
  id: z.string().min(1),
  from: lifecycleNodeId,
  to: lifecycleNodeId,
  when: lifecycleReasonCode,
}).strict();

const lifecycleGraphSchema = z.object({
  schemaVersion: z.literal(1),
  entry: lifecycleNodeId,
  nodes: z.record(lifecycleNodeId, lifecycleNodeSchema),
  edges: z.array(lifecycleEdgeSchema),
}).strict();

function invalidGraph(message: string): Error {
  return new Error(`Invalid lifecycle graph: ${message}`);
}

function formatIssue(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "graph"}: ${issue.message}`)
    .join("; ");
}

function hasNode(nodes: Record<string, unknown>, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(nodes, id);
}

function validateGraph(value: z.infer<typeof lifecycleGraphSchema>): LifecycleGraph {
  const requiredNodes: LifecycleNodeId[] = [
    "probe", "migration", "bootstrap", "briefing", "design", "planning",
    "task-graph", "implementation", "followup-triage", "exit-audit", "complete",
  ];
  const unknownNodes = Object.keys(value.nodes).filter((id) => !requiredNodes.includes(id as LifecycleNodeId));
  if (unknownNodes.length > 0) {
    throw invalidGraph(`unknown node(s): ${unknownNodes.join(", ")}`);
  }
  const missingNodes = requiredNodes.filter((id) => !hasNode(value.nodes, id));
  if (missingNodes.length > 0) {
    throw invalidGraph(`missing required node(s): ${missingNodes.join(", ")}`);
  }
  if (!hasNode(value.nodes, value.entry)) {
    throw invalidGraph(`entry node does not exist: ${value.entry}`);
  }
  if (!hasNode(value.nodes, "complete")) {
    throw invalidGraph("required terminal node does not exist: complete");
  }

  const edgeIds = new Set<string>();
  for (const edge of value.edges) {
    if (edgeIds.has(edge.id)) {
      throw invalidGraph(`duplicate edge id: ${edge.id}`);
    }
    edgeIds.add(edge.id);
    if (!hasNode(value.nodes, edge.from)) {
      throw invalidGraph(`edge ${edge.id} references unknown from node: ${edge.from}`);
    }
    if (!hasNode(value.nodes, edge.to)) {
      throw invalidGraph(`edge ${edge.id} references unknown to node: ${edge.to}`);
    }
  }

  if (value.edges.some((edge) => edge.from === "complete")) {
    throw invalidGraph("complete node must not have outgoing edges");
  }

  return value as LifecycleGraph;
}

/** Parse and validate lifecycle YAML content without mutating it. */
export function parseLifecycleGraph(source: string): LifecycleGraph {
  try {
    const parsed = yaml.load(source);
    const result = lifecycleGraphSchema.safeParse(parsed);
    if (!result.success) throw invalidGraph(formatIssue(result.error));
    return validateGraph(result.data);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("Invalid lifecycle graph:")) {
      throw error;
    }
    throw invalidGraph(error instanceof Error ? error.message : String(error));
  }
}

/** Load and validate a package-local lifecycle graph file. */
export function loadLifecycleGraph(file: string): LifecycleGraph {
  try {
    return parseLifecycleGraph(fs.readFileSync(file, "utf8"));
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("Invalid lifecycle graph:")) {
      throw error;
    }
    throw invalidGraph(`unable to read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Find the first edge selected by a current node and typed reason code. */
export function findEdge(
  graph: LifecycleGraph,
  current: LifecycleNodeId,
  reasonCode: LifecycleReasonCode,
): LifecycleEdge | undefined {
  return graph.edges.find((edge) => edge.from === current && edge.when === reasonCode);
}
