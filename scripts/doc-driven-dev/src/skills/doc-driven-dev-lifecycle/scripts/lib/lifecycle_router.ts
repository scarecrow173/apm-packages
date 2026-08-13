import {
  findEdge,
  type LifecycleGraph,
  type LifecycleNodeId,
  type LifecycleReasonCode,
} from "./lifecycle_graph";
import {
  type LifecycleSignal,
  type LifecycleState,
} from "./lifecycle_state";
import {
  buildTaskGraph,
  type TaskGraphResult,
} from "./task_graph";

/** The stable, agent-facing result emitted by lifecycle routing. */
export type LifecycleRoute = {
  schemaVersion: 1;
  current: LifecycleNodeId;
  next: LifecycleNodeId;
  edgeId: string | null;
  reasonCode: LifecycleReasonCode;
  delegate: string | null;
  requiredAudits: string[];
  blockers: string[];
  taskGraph: TaskGraphResult | null;
};

const routingPrecedence = [
  "focus-required",
  "migration-requested",
  "bootstrap-incomplete",
  "spec-gap",
  "design-gap",
  "constraint-gap",
  "briefing-incomplete",
  "design-incomplete",
  "planning-incomplete",
  "task-graph-invalid",
  "tasks-runnable",
  "implementation-incomplete",
  "followups-unclassified",
  "exit-audit-required",
  "lifecycle-complete",
] as const satisfies readonly LifecycleReasonCode[];

type RoutingReason = (typeof routingPrecedence)[number];

const SUCCESS_EDGES: Partial<Record<LifecycleNodeId, LifecycleReasonCode>> = {
  migration: "migration-complete",
  bootstrap: "bootstrap-complete",
  briefing: "briefing-complete",
  design: "design-complete",
  planning: "planning-complete",
  implementation: "implementation-verified",
  "followup-triage": "followups-classified",
  "exit-audit": "exit-audit-pass",
};

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function hasSignal(state: LifecycleState, signal: LifecycleSignal): boolean {
  return state.signals.includes(signal);
}

function gateIsNotPassing(state: LifecycleState, name: string): boolean {
  const gate = state.gates[name];
  return Boolean(gate && gate.status !== "pass");
}

function lifecycleComplete(state: LifecycleState): boolean {
  if (hasSignal(state, "lifecycle-complete")) return true;
  const gates = ["bootstrap", "briefing", "design", "planning", "implementation", "followup-triage", "exit-audit"];
  return gates.every((name) => state.gates[name]?.status === "pass");
}

function selectedPlan(state: LifecycleState): string | undefined {
  const focused = new Set(state.focus);
  const plan = state.artifacts.find((artifact) => artifact.type === "plan" && focused.has(artifact.path));
  if (plan) return plan.path;
  return state.artifacts.find((artifact) => artifact.type === "plan")?.path;
}

function taskGraphForState(state: LifecycleState, taskDir?: string): TaskGraphResult | null {
  const plan = selectedPlan(state);
  if (!plan) return null;
  return buildTaskGraph({ cwd: state.cwd, plan, taskDir });
}

function reasonApplies(reason: RoutingReason, state: LifecycleState, taskGraph: TaskGraphResult | null): boolean {
  switch (reason) {
    case "focus-required":
      return state.blockers.some((blocker) => blocker === "focus-required" || blocker === "focus-invalid");
    case "migration-requested":
      return hasSignal(state, "migration-requested");
    case "bootstrap-incomplete":
      return state.blockers.includes("bootstrap-incomplete") || gateIsNotPassing(state, "bootstrap");
    case "spec-gap":
      return hasSignal(state, "spec-gap");
    case "design-gap":
      return hasSignal(state, "design-gap");
    case "constraint-gap":
      return hasSignal(state, "constraint-gap");
    case "briefing-incomplete":
      return gateIsNotPassing(state, "briefing");
    case "design-incomplete":
      return gateIsNotPassing(state, "design");
    case "planning-incomplete":
      return gateIsNotPassing(state, "planning");
    case "task-graph-invalid":
      return state.blockers.includes("task-graph-invalid") || Boolean(taskGraph && taskGraph.issues.length > 0);
    case "tasks-runnable":
      return Boolean(taskGraph && taskGraph.runnable.length > 0);
    case "implementation-incomplete":
      return gateIsNotPassing(state, "implementation");
    case "followups-unclassified":
      return hasSignal(state, "followups-unclassified") || gateIsNotPassing(state, "followup-triage");
    case "exit-audit-required":
      return hasSignal(state, "exit-audit-required") || gateIsNotPassing(state, "exit-audit");
    case "lifecycle-complete":
      return lifecycleComplete(state);
  }
}

function successEdge(graph: LifecycleGraph, node: LifecycleNodeId, state: LifecycleState): ReturnType<typeof findEdge> {
  if (node === "probe") {
    if (state.gates.bootstrap?.status === "pass") return findEdge(graph, node, "bootstrap-complete");
    return undefined;
  }
  const reason = SUCCESS_EDGES[node];
  if (!reason) return undefined;
  if (node === "migration" && hasSignal(state, "migration-incomplete")) return undefined;
  if (node === "bootstrap" && reasonApplies("bootstrap-incomplete", state, null)) return undefined;
  if (node === "briefing" && gateIsNotPassing(state, "briefing")) return undefined;
  if (node === "design" && gateIsNotPassing(state, "design")) return undefined;
  if (node === "planning" && gateIsNotPassing(state, "planning")) return undefined;
  if (node === "implementation" && gateIsNotPassing(state, "implementation")) return undefined;
  if (node === "followup-triage" && gateIsNotPassing(state, "followup-triage")) return undefined;
  if (node === "exit-audit" && gateIsNotPassing(state, "exit-audit")) return undefined;
  return findEdge(graph, node, reason);
}

function routeResult(
  input: { current: LifecycleNodeId; graph: LifecycleGraph; state: LifecycleState },
  taskGraph: TaskGraphResult | null,
  next: LifecycleNodeId,
  reasonCode: LifecycleReasonCode,
  edgeId: string | null,
): LifecycleRoute {
  const node = input.graph.nodes[next] ?? input.graph.nodes[input.current];
  return {
    schemaVersion: 1,
    current: input.current,
    next,
    edgeId,
    reasonCode,
    delegate: node.delegate,
    requiredAudits: [...node.audits].sort(compareStrings),
    blockers: sortedUnique(input.state.blockers),
    taskGraph,
  };
}

/** Route lifecycle state through the graph, following only satisfied forward gates. */
export function routeLifecycle(input: {
  current: LifecycleNodeId;
  graph: LifecycleGraph;
  state: LifecycleState;
  taskDir?: string;
}): LifecycleRoute {
  if (!input.graph.nodes[input.current]) {
    throw new Error(`Unknown lifecycle node: ${input.current}`);
  }

  const taskGraph = taskGraphForState(input.state, input.taskDir);
  if (reasonApplies("focus-required", input.state, taskGraph)) {
    return routeResult(input, taskGraph, input.current, "focus-required", null);
  }

  let node = input.current;
  const visited = new Set<LifecycleNodeId>();
  while (!visited.has(node)) {
    visited.add(node);

    for (const reason of routingPrecedence) {
      if (!reasonApplies(reason, input.state, taskGraph)) continue;
      const edge = findEdge(input.graph, node, reason);
      if (edge) return routeResult(input, taskGraph, edge.to, reason, edge.id);

      // The terminal graph names its successful edge `exit-audit-pass`, while
      // the public route uses the more descriptive `lifecycle-complete` code.
      if (reason === "lifecycle-complete" && node === "exit-audit") {
        const terminal = findEdge(input.graph, node, "exit-audit-pass");
        if (terminal) return routeResult(input, taskGraph, terminal.to, reason, terminal.id);
      }
    }

    const edge = successEdge(input.graph, node, input.state);
    if (!edge) break;
    node = edge.to;
  }

  // A complete node is terminal. Keep the output total and deterministic even
  // for synthetic graphs without a matching lifecycle-complete edge.
  if (node === "complete") {
    return routeResult(input, taskGraph, node, "lifecycle-complete", "lifecycle-complete");
  }
  return routeResult(input, taskGraph, node, "lifecycle-complete", null);
}

export { routingPrecedence };
