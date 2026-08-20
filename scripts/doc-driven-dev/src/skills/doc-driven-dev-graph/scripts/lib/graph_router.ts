import type {
  GraphConditionKey,
  GraphDefinition,
  GraphNodeId,
} from "./graph_definition";
import { evaluateCondition } from "./graph_conditions";
import type { GraphState } from "./graph_state";
import type { TaskGraphResult } from "./task_graph";

export type GraphRoute = {
  schemaVersion: 2;
  graphId: string;
  current: GraphNodeId;
  next: GraphNodeId;
  edgeId: string | null;
  condition: GraphConditionKey | "terminal" | "blocked";
  status: "edge" | "terminal" | "blocked";
  delegate: string | null;
  requiredAudits: string[];
  blockers: string[];
  taskGraph: TaskGraphResult | null;
};

function sortedOutgoing(definition: GraphDefinition, current: GraphNodeId) {
  return definition.edges
    .filter((edge) => edge.from === current)
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function routeResult(
  input: { current: GraphNodeId; definition: GraphDefinition; state: GraphState },
  result: Pick<GraphRoute, "next" | "edgeId" | "condition" | "status" | "delegate" | "requiredAudits">,
  additionalBlockers: Iterable<string> = [],
): GraphRoute {
  return {
    schemaVersion: 2,
    graphId: input.definition.id,
    current: input.current,
    next: result.next,
    edgeId: result.edgeId,
    condition: result.condition,
    status: result.status,
    delegate: result.delegate,
    requiredAudits: sortedUnique(result.requiredAudits),
    blockers: sortedUnique([...input.state.blockers, ...additionalBlockers]),
    taskGraph: input.state.taskGraph,
  };
}

function prerequisiteBlockers(node: GraphDefinition["nodes"][GraphNodeId], state: GraphState): string[] {
  const blockers: string[] = [];
  for (const gate of node.requiresGates ?? []) {
    const result = state.gates[gate];
    if (!result) {
      blockers.push(`required-gate:${gate}`, `required-gate:${gate}:missing`);
      continue;
    }
    if (result.status === "pass") continue;
    blockers.push(`required-gate:${gate}`);
    if (result.reasons.length === 0) {
      blockers.push(`required-gate:${gate}:status-${result.status}`);
    } else {
      blockers.push(...result.reasons.map((reason) => `required-gate:${gate}:${reason}`));
    }
  }
  return blockers;
}

function isPrerequisiteRepairEdge(
  edge: GraphDefinition["edges"][number],
  node: GraphDefinition["nodes"][GraphNodeId],
  definition: GraphDefinition,
): boolean {
  const condition = definition.conditions[edge.when];
  return condition?.kind === "gate"
    && condition.status === "not-pass"
    && (node.requiresGates ?? []).includes(condition.gate);
}

/** Route one step through the declared graph edges. */
export function routeGraph(input: {
  current: GraphNodeId;
  definition: GraphDefinition;
  state: GraphState;
}): GraphRoute {
  if (!Object.prototype.hasOwnProperty.call(input.definition.nodes, input.current)) {
    throw new Error(`Unknown graph node: ${input.current}`);
  }
  const node = input.definition.nodes[input.current];

  if (node.kind === "terminal") {
    return routeResult(input, {
      next: input.current,
      edgeId: null,
      condition: "terminal",
      status: "terminal",
      delegate: node.delegate ?? null,
      requiredAudits: node.audits ?? [],
    });
  }

  if (input.state.hardBlockers.length > 0) {
    return routeResult(input, {
      next: input.current,
      edgeId: null,
      condition: "blocked",
      status: "blocked",
      delegate: null,
      requiredAudits: [],
    }, input.state.hardBlockers);
  }

  const outgoing = sortedOutgoing(input.definition, input.current);
  for (const edge of outgoing.filter((edge) => isPrerequisiteRepairEdge(edge, node, input.definition))) {
    const condition = input.definition.conditions[edge.when];
    if (condition && evaluateCondition(condition, input.state)) {
      const destination = input.definition.nodes[edge.to];
      return routeResult(input, {
        next: edge.to,
        edgeId: edge.id,
        condition: edge.when,
        status: "edge",
        delegate: destination?.delegate ?? null,
        requiredAudits: destination?.audits ?? [],
      });
    }
  }

  const prerequisiteFailures = prerequisiteBlockers(node, input.state);
  if (prerequisiteFailures.length > 0) {
    return routeResult(input, {
      next: input.current,
      edgeId: null,
      condition: "blocked",
      status: "blocked",
      delegate: null,
      requiredAudits: [],
    }, prerequisiteFailures);
  }

  for (const edge of outgoing) {
    const condition = input.definition.conditions[edge.when];
    if (condition && evaluateCondition(condition, input.state)) {
      const destination = input.definition.nodes[edge.to];
      return routeResult(input, {
        next: edge.to,
        edgeId: edge.id,
        condition: edge.when,
        status: "edge",
        delegate: destination?.delegate ?? null,
        requiredAudits: destination?.audits ?? [],
      });
    }
  }

  return routeResult(input, {
    next: input.current,
    edgeId: null,
    condition: "blocked",
    status: "blocked",
    delegate: null,
    requiredAudits: [],
  });
}
