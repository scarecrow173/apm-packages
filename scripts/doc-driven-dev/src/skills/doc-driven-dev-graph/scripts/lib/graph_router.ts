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

export type EvaluatedEdge = {
  edgeId: string;
  priority: number;
  condition: string;
  conditionKind: "signal" | "gate" | "task-graph";
  matched: boolean;
  evaluationPhase: "repair" | "normal";
};

export type PrerequisiteGateExplanation = {
  gate: string;
  status: "pass" | "fail" | "blocked" | "missing";
  reasons: string[];
};

export type RouteExplanation = {
  currentNode: string;
  hardBlockers: string[];
  prerequisiteGates: PrerequisiteGateExplanation[];
  evaluatedEdges: EvaluatedEdge[];
  selectedEdgeId: string | null;
  selectedDestinationAudits: string[];
  blockedReasons: string[];
};

export type RouteDecision = {
  route: GraphRoute;
  explanation: RouteExplanation;
};

type RouteInput = {
  current: GraphNodeId;
  definition: GraphDefinition;
  state: GraphState;
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

function prerequisiteGateExplanations(
  node: GraphDefinition["nodes"][GraphNodeId],
  state: GraphState,
): PrerequisiteGateExplanation[] {
  return (node.requiresGates ?? []).map((gate): PrerequisiteGateExplanation => {
    const result = state.gates[gate];
    if (!result) return { gate, status: "missing", reasons: ["missing"] };
    return { gate, status: result.status, reasons: sortedUnique(result.reasons) };
  });
}

function evaluateEdge(
  edge: GraphDefinition["edges"][number],
  definition: GraphDefinition,
  state: GraphState,
  evaluationPhase: EvaluatedEdge["evaluationPhase"],
): { evaluated: EvaluatedEdge; matched: boolean } | null {
  const condition = definition.conditions[edge.when];
  if (!condition) return null;
  const matched = evaluateCondition(condition, state);
  return {
    matched,
    evaluated: {
      edgeId: edge.id,
      priority: edge.priority,
      condition: edge.when,
      conditionKind: condition.kind,
      matched,
      evaluationPhase,
    },
  };
}

function selectedRoute(
  input: RouteInput,
  edge: GraphDefinition["edges"][number],
): GraphRoute {
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

/** Evaluate one route decision and retain the evidence used to make it. */
export function evaluateRouteDecision(input: RouteInput): RouteDecision {
  if (!Object.prototype.hasOwnProperty.call(input.definition.nodes, input.current)) {
    throw new Error(`Unknown graph node: ${input.current}`);
  }
  const node = input.definition.nodes[input.current];
  const prerequisiteGates = prerequisiteGateExplanations(node, input.state);
  const evaluatedEdges: EvaluatedEdge[] = [];
  const hardBlockers = sortedUnique(input.state.hardBlockers);

  if (hardBlockers.length > 0) {
    const route = routeResult(input, {
      next: input.current,
      edgeId: null,
      condition: "blocked",
      status: "blocked",
      delegate: null,
      requiredAudits: [],
    }, hardBlockers);
    return {
      route,
      explanation: {
        currentNode: input.current,
        hardBlockers,
        prerequisiteGates,
        evaluatedEdges,
        selectedEdgeId: null,
        selectedDestinationAudits: [],
        blockedReasons: hardBlockers,
      },
    };
  }

  if (node.kind === "terminal") {
    const route = routeResult(input, {
      next: input.current,
      edgeId: null,
      condition: "terminal",
      status: "terminal",
      delegate: node.delegate ?? null,
      requiredAudits: node.audits ?? [],
    });
    return {
      route,
      explanation: {
        currentNode: input.current,
        hardBlockers,
        prerequisiteGates,
        evaluatedEdges,
        selectedEdgeId: null,
        selectedDestinationAudits: [],
        blockedReasons: [],
      },
    };
  }

  const outgoing = sortedOutgoing(input.definition, input.current);
  const repairEdges = outgoing.filter((edge) => isPrerequisiteRepairEdge(edge, node, input.definition));
  const repairEdgeIds = new Set(repairEdges.map((edge) => edge.id));
  for (const edge of repairEdges) {
    const result = evaluateEdge(edge, input.definition, input.state, "repair");
    if (!result) continue;
    evaluatedEdges.push(result.evaluated);
    if (result.matched) {
      return {
        route: selectedRoute(input, edge),
        explanation: {
          currentNode: input.current,
          hardBlockers,
          prerequisiteGates,
          evaluatedEdges,
          selectedEdgeId: edge.id,
          selectedDestinationAudits: sortedUnique(input.definition.nodes[edge.to]?.audits ?? []),
          blockedReasons: [],
        },
      };
    }
  }

  const prerequisiteFailures = prerequisiteBlockers(node, input.state);
  if (prerequisiteFailures.length > 0) {
    const route = routeResult(input, {
      next: input.current,
      edgeId: null,
      condition: "blocked",
      status: "blocked",
      delegate: null,
      requiredAudits: [],
    }, prerequisiteFailures);
    return {
      route,
      explanation: {
        currentNode: input.current,
        hardBlockers,
        prerequisiteGates,
        evaluatedEdges,
        selectedEdgeId: null,
        selectedDestinationAudits: [],
        blockedReasons: sortedUnique(prerequisiteFailures),
      },
    };
  }

  for (const edge of outgoing.filter((candidate) => !repairEdgeIds.has(candidate.id))) {
    const result = evaluateEdge(edge, input.definition, input.state, "normal");
    if (!result) continue;
    evaluatedEdges.push(result.evaluated);
    if (result.matched) {
      return {
        route: selectedRoute(input, edge),
        explanation: {
          currentNode: input.current,
          hardBlockers,
          prerequisiteGates,
          evaluatedEdges,
          selectedEdgeId: edge.id,
          selectedDestinationAudits: sortedUnique(input.definition.nodes[edge.to]?.audits ?? []),
          blockedReasons: [],
        },
      };
    }
  }

  const route = routeResult(input, {
    next: input.current,
    edgeId: null,
    condition: "blocked",
    status: "blocked",
    delegate: null,
    requiredAudits: [],
  });
  return {
    route,
    explanation: {
      currentNode: input.current,
      hardBlockers,
      prerequisiteGates,
      evaluatedEdges,
      selectedEdgeId: null,
      selectedDestinationAudits: [],
      blockedReasons: ["no-matching-edge"],
    },
  };
}

/** Route one step through the declared graph edges. */
export function routeGraph(input: RouteInput): GraphRoute {
  return evaluateRouteDecision(input).route;
}

/** Explain the route decision without exposing the public route wrapper. */
export function explainRoute(input: RouteInput): RouteExplanation {
  return evaluateRouteDecision(input).explanation;
}
