import type {
  GraphConditionKey,
  GraphDefinition,
  GraphNodeId,
} from "./graph_definition";
import { evaluateCondition } from "./graph_conditions";
import type { GraphState } from "./graph_state";
import type { TaskGraphResult } from "../../../doc-driven-dev-lifecycle/scripts/lib/task_graph";

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
  result: Pick<GraphRoute, "next" | "edgeId" | "condition" | "status" | "delegate">,
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
    requiredAudits: [],
    blockers: sortedUnique(input.state.blockers),
    taskGraph: input.state.taskGraph,
  };
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
    });
  }

  for (const edge of sortedOutgoing(input.definition, input.current)) {
    const condition = input.definition.conditions[edge.when];
    if (condition && evaluateCondition(condition, input.state)) {
      const destination = input.definition.nodes[edge.to];
      return routeResult(input, {
        next: edge.to,
        edgeId: edge.id,
        condition: edge.when,
        status: "edge",
        delegate: destination?.delegate ?? null,
      });
    }
  }

  return routeResult(input, {
    next: input.current,
    edgeId: null,
    condition: "blocked",
    status: "blocked",
    delegate: null,
  });
}
