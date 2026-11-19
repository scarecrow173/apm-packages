import fs from "node:fs";

import * as yaml from "js-yaml";
import { z } from "zod";

import { GRAPH_GATE_NAMES } from "./graph_state";

export type GraphCondition =
  | { kind: "signal"; signal: string }
  | { kind: "gate"; gate: string; status: "pass" | "not-pass" }
  | { kind: "task-graph"; state: "runnable" | "active" | "invalid" | "idle" };

export type GraphNodeId = string;
export type GraphConditionKey = string;
export type GraphNode = {
  kind: "action" | "delegate" | "audit" | "terminal";
  delegate?: string;
  audits?: string[];
  requiresGates?: string[];
  commitGate?: boolean;
};
export type GraphEdge = {
  id: string;
  from: GraphNodeId;
  to: GraphNodeId;
  when: GraphConditionKey;
  priority: number;
};

export type GraphDefinition = {
  schemaVersion: 3;
  id: string;
  entry: GraphNodeId;
  runtimeSignals?: string[];
  conditions: Record<GraphConditionKey, GraphCondition>;
  nodes: Record<GraphNodeId, GraphNode>;
  edges: GraphEdge[];
};

const graphNodeId = z.string().min(1);

const graphConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("signal"), signal: z.string().min(1) }).strict(),
  z.object({
    kind: z.literal("gate"),
    gate: z.string().min(1),
    status: z.enum(["pass", "not-pass"]),
  }).strict(),
  z.object({
    kind: z.literal("task-graph"),
    state: z.enum(["runnable", "active", "invalid", "idle"]),
  }).strict(),
]);

const graphNodeSchema = z.object({
  kind: z.enum(["action", "delegate", "audit", "terminal"]),
  delegate: z.string().min(1).optional(),
  audits: z.array(z.string().min(1)).optional(),
  requiresGates: z.array(z.string().min(1)).optional(),
  commitGate: z.boolean().optional(),
}).strict();

const graphEdgeSchema = z.object({
  id: z.string().min(1),
  from: graphNodeId,
  to: graphNodeId,
  when: z.string().min(1),
  priority: z.number().int(),
}).strict();

const graphDefinitionSchema = z.object({
  schemaVersion: z.literal(3),
  id: z.string().min(1),
  entry: graphNodeId,
  runtimeSignals: z.array(z.string().min(1)).default([]),
  conditions: z.record(graphNodeId, graphConditionSchema),
  nodes: z.record(graphNodeId, graphNodeSchema),
  edges: z.array(graphEdgeSchema),
}).strict();

function invalidGraph(message: string): Error {
  return new Error(`Invalid graph definition: ${message}`);
}

function formatIssue(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "graph"}: ${issue.message}`)
    .join("; ");
}

function hasNode(nodes: Record<string, unknown>, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(nodes, id);
}

function validateGraphDefinition(value: z.infer<typeof graphDefinitionSchema>): GraphDefinition {
  if (!hasNode(value.nodes, value.entry)) {
    throw invalidGraph(`entry node does not exist: ${value.entry}`);
  }
  const duplicateRuntimeSignal = value.runtimeSignals.find((signal, index) => (
    value.runtimeSignals.indexOf(signal) !== index
  ));
  if (duplicateRuntimeSignal !== undefined) {
    throw invalidGraph(`duplicate runtime signal: ${duplicateRuntimeSignal}`);
  }

  // Gate conditions may only name gates the runtime actually emits
  // (GRAPH_GATE_NAMES in graph_state.ts). An unrecognized name would make
  // a `pass` edge unreachable and a `not-pass` edge always taken — a
  // typo'd gate must refuse at load, never silently route (Issue #243).
  const knownGates = new Set<string>(GRAPH_GATE_NAMES);
  for (const [conditionKey, condition] of Object.entries(value.conditions)) {
    if (condition.kind === "gate" && !knownGates.has(condition.gate)) {
      throw invalidGraph(
        `unknown gate "${condition.gate}" in condition "${conditionKey}" `
        + `(known gates: ${GRAPH_GATE_NAMES.join(", ")})`,
      );
    }
  }
  const declaredGates = new Set(
    Object.values(value.conditions)
      .filter((condition) => condition.kind === "gate")
      .map((condition) => condition.gate),
  );
  for (const [nodeId, node] of Object.entries(value.nodes)) {
    const requiresGates = node.requiresGates ?? [];
    const unknownGates = requiresGates.filter((gate) => !declaredGates.has(gate));
    if (unknownGates.length > 0) {
      throw invalidGraph(`unknown prerequisite gate: ${unknownGates.join(", ")}`);
    }
    if (new Set(requiresGates).size !== requiresGates.length) {
      throw invalidGraph(`duplicate prerequisite gate on node ${nodeId}`);
    }
    const audits = node.audits ?? [];
    if (new Set(audits).size !== audits.length) {
      throw invalidGraph(`duplicate audit on node ${nodeId}`);
    }
  }

  const edgeIds = new Set<string>();
  const routeSelectors = new Set<string>();
  const priorities = new Set<string>();
  for (const edge of value.edges) {
    if (edgeIds.has(edge.id)) {
      throw invalidGraph(`duplicate edge id: ${edge.id}`);
    }
    edgeIds.add(edge.id);

    const selector = `${edge.from}\u0000${edge.when}`;
    const priority = `${edge.from}\u0000${edge.priority}`;
    if (routeSelectors.has(selector)) {
      throw invalidGraph(`duplicate route selector: ${edge.from} + ${edge.when}`);
    }
    if (priorities.has(priority)) {
      throw invalidGraph(`duplicate edge priority: ${edge.from} + ${edge.priority}`);
    }
    if (!Object.prototype.hasOwnProperty.call(value.conditions, edge.when)) {
      throw invalidGraph(`unknown condition: ${edge.when}`);
    }
    routeSelectors.add(selector);
    priorities.add(priority);

    if (!hasNode(value.nodes, edge.from)) {
      throw invalidGraph(`edge ${edge.id} references unknown from node: ${edge.from}`);
    }
    if (!hasNode(value.nodes, edge.to)) {
      throw invalidGraph(`edge ${edge.id} references unknown to node: ${edge.to}`);
    }
  }

  const outgoingByNode = new Map<string, number>();
  for (const edge of value.edges) {
    outgoingByNode.set(edge.from, (outgoingByNode.get(edge.from) ?? 0) + 1);
  }
  for (const [nodeId, node] of Object.entries(value.nodes)) {
    const outgoing = outgoingByNode.get(nodeId) ?? 0;
    if (node.kind === "terminal") {
      if (outgoing > 0) {
        throw invalidGraph(`terminal node must not have outgoing edges: ${nodeId}`);
      }
    } else if (outgoing === 0) {
      throw invalidGraph(`non-terminal node must have an outgoing edge: ${nodeId}`);
    }
  }

  return value as GraphDefinition;
}

// Graph Definition v3 is the only schema normal runtime accepts — a v2
// definition is migration-domain data, never silently parsed (Issue #243).
// The refusal names the migration lane (`#245`/`#247` own the tooling); there
// is no dual-schema parse path and no compatibility shim.
export const GRAPH_MIGRATION_GUIDANCE =
  "Graph Definition schemaVersion 2 is not supported by normal runtime. " +
  "Run `node .apm/skills/doc-maintenance/scripts/doc_maintenance.js migrate plan --json` " +
  "to evaluate the repository's legacy artifacts, then `migrate apply --expect <planHash>`. " +
  "If an earlier apply was interrupted, `migrate recovery --resume` continues " +
  "and `migrate recovery --rollback` undoes it.";

function detectLegacySchema(parsed: unknown): void {
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    const version = (parsed as Record<string, unknown>).schemaVersion;
    // Any declared non-3 schemaVersion — `2`, the YAML string `"2"`, or a
    // future value — is not parseable by this runtime: the same migration
    // guidance applies. A missing key stays an ordinary schema error.
    if (version !== undefined && version !== 3) throw invalidGraph(GRAPH_MIGRATION_GUIDANCE);
  }
}

/** Parse and validate Graph Definition v3 YAML content. */
export function parseGraphDefinition(source: string): GraphDefinition {
  try {
    const parsed = yaml.load(source);
    detectLegacySchema(parsed);
    const result = graphDefinitionSchema.safeParse(parsed);
    if (!result.success) throw invalidGraph(formatIssue(result.error));
    return validateGraphDefinition(result.data);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("Invalid graph definition:")) {
      throw error;
    }
    throw invalidGraph(error instanceof Error ? error.message : String(error));
  }
}

/** Load and validate a Graph Definition v3 YAML file. */
export function loadGraphDefinition(file: string): GraphDefinition {
  try {
    return parseGraphDefinition(fs.readFileSync(file, "utf8"));
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("Invalid graph definition:")) {
      throw error;
    }
    throw invalidGraph(`unable to read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
