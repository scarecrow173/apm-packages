import path from "node:path";

import {
  findEdge,
  type LifecycleGraph,
  type LifecycleNodeId,
  type LifecycleReasonCode,
} from "./lifecycle_graph";
import {
  LIFECYCLE_LINEAGE_RELATIONS,
  resolveLifecycleRelationTarget,
  type LifecycleArtifact,
} from "./lifecycle_relations";
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
  "exit-audit": "exit-audit-pass",
};

const RETRY_REASONS: Partial<Record<LifecycleNodeId, LifecycleReasonCode>> = {
  migration: "migration-incomplete",
  bootstrap: "bootstrap-incomplete",
  briefing: "briefing-incomplete",
  design: "design-incomplete",
  planning: "planning-incomplete",
  "task-graph": "task-graph-retry",
  implementation: "implementation-incomplete",
  "followup-triage": "followups-unclassified",
  "exit-audit": "exit-audit-required",
};

const REQUIRED_GATE_REASONS: Partial<Record<LifecycleNodeId, LifecycleReasonCode>> = {
  migration: "migration-incomplete",
  bootstrap: "bootstrap-incomplete",
  briefing: "briefing-incomplete",
  design: "design-incomplete",
  planning: "planning-incomplete",
  "task-graph": "task-graph-retry",
  implementation: "implementation-incomplete",
  "followup-triage": "followups-unclassified",
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

const FOLLOWUP_CLASSIFICATIONS = [
  "followup-bug-fix",
  "followup-decision-briefing",
  "followup-decision-design",
  "followup-new-feature",
  "followup-doc-only",
  "followup-terminal",
] as const satisfies readonly LifecycleReasonCode[];

function gateIsNotPassing(state: LifecycleState, name: string): boolean {
  const gate = state.gates[name];
  return Boolean(gate && gate.status !== "pass");
}

function lifecycleComplete(state: LifecycleState): boolean {
  const gates = ["bootstrap", "briefing", "design", "planning", "implementation", "followup-triage", "exit-audit"];
  return gates.every((name) => state.gates[name]?.status === "pass");
}

// Only these typed relations establish artifact lineage for focus resolution.
// Contextual, evidence, and task-dependency fields (for example `related`,
// `references`, `source`, `depends-on`, and `blocks`) must not select a plan.
function lineageValues(artifact: LifecycleArtifact & LifecycleState["artifacts"][number]): string[] {
  return [...LIFECYCLE_LINEAGE_RELATIONS].flatMap((relation) => artifact.relations[relation] ?? []);
}

function selectedPlan(state: LifecycleState): string | undefined {
  const artifacts = state.artifacts.map((artifact) => ({
    ...artifact,
    absolutePath: path.resolve(state.cwd, artifact.path),
  }));
  const queue = state.focus
    .map((focus) => {
      const byPath = artifacts.find((artifact) => artifact.path === focus);
      if (byPath) return byPath;
      const byId = artifacts.filter((artifact) => artifact.id === focus);
      return byId.length === 1 ? byId[0] : undefined;
    })
    .filter((artifact): artifact is (typeof artifacts)[number] => Boolean(artifact));
  const visited = new Set<string>();
  const plans: string[] = [];
  while (queue.length > 0) {
    const artifact = queue.shift();
    if (!artifact || visited.has(artifact.path)) continue;
    visited.add(artifact.path);
    if (artifact.type === "plan") plans.push(artifact.path);
    for (const value of lineageValues(artifact)) {
      const target = resolveLifecycleRelationTarget(state.cwd, artifact, value, artifacts);
      if (target && !visited.has(target.path)) queue.push(target);
    }
    for (const candidate of state.artifacts) {
      const candidateWithPath = artifacts.find((entry) => entry.path === candidate.path);
      if (!candidateWithPath) continue;
      const pointsTo = lineageValues(candidateWithPath).some((value) =>
        resolveLifecycleRelationTarget(state.cwd, candidateWithPath, value, artifacts)?.path === artifact.path);
      if (pointsTo && !visited.has(candidateWithPath.path)) queue.push(candidateWithPath);
    }
  }
  return plans.sort(compareStrings)[0];
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
  if (node === "migration") {
    if (hasSignal(state, "migration-incomplete")) return findEdge(graph, node, "migration-incomplete");
    if (hasSignal(state, "migration-complete")) return findEdge(graph, node, "migration-complete");
    return undefined;
  }
  if (node === "task-graph" && hasSignal(state, "task-graph-retry")) {
    return findEdge(graph, node, "task-graph-retry");
  }
  if (node === "followup-triage") {
    return typedFollowupEdge(graph, state);
  }
  const reason = SUCCESS_EDGES[node];
  if (!reason) return undefined;
  if (node === "bootstrap" && reasonApplies("bootstrap-incomplete", state, null)) return undefined;
  if (node === "briefing" && gateIsNotPassing(state, "briefing")) return undefined;
  if (node === "design" && gateIsNotPassing(state, "design")) return undefined;
  if (node === "planning" && gateIsNotPassing(state, "planning")) return undefined;
  if (node === "implementation" && gateIsNotPassing(state, "implementation")) return undefined;
  if (node === "followup-triage" && gateIsNotPassing(state, "followup-triage")) return undefined;
  if (node === "exit-audit" && gateIsNotPassing(state, "exit-audit")) return undefined;
  return findEdge(graph, node, reason);
}

function typedFollowupEdge(graph: LifecycleGraph, state: LifecycleState): ReturnType<typeof findEdge> {
  const classifications = state.signals.filter((signal): signal is (typeof FOLLOWUP_CLASSIFICATIONS)[number] =>
    FOLLOWUP_CLASSIFICATIONS.includes(signal as (typeof FOLLOWUP_CLASSIFICATIONS)[number]));
  if (classifications.length !== 1 || hasSignal(state, "followups-unclassified")) return undefined;
  return findEdge(graph, "followup-triage", classifications[0]);
}

const FOLLOWUP_UPSTREAM_REPAIRS = [
  ["bootstrap", "bootstrap-incomplete"],
  ["briefing", "briefing-incomplete"],
  ["design", "design-incomplete"],
  ["planning", "planning-incomplete"],
  ["implementation", "implementation-incomplete"],
] as const satisfies readonly [string, LifecycleReasonCode][];

function followupUpstreamRecoveryEdge(graph: LifecycleGraph, state: LifecycleState): ReturnType<typeof findEdge> {
  for (const [gate, reason] of FOLLOWUP_UPSTREAM_REPAIRS) {
    if (gateIsNotPassing(state, gate)) return findEdge(graph, "followup-triage", reason);
  }
  return undefined;
}

function prerequisiteRecoveryEdge(
  graph: LifecycleGraph,
  node: LifecycleNodeId,
  state: LifecycleState,
): ReturnType<typeof findEdge> {
  const requiresGates = graph.nodes[node]?.requiresGates ?? [];
  for (const gate of requiresGates) {
    if (state.gates[gate]?.status === "pass") continue;
    const reason = REQUIRED_GATE_REASONS[gate as LifecycleNodeId];
    if (reason) {
      const edge = findEdge(graph, node, reason);
      if (edge) return edge;
    }
    return retryEdge(graph, node);
  }
  return undefined;
}

function hasFailedPrerequisite(graph: LifecycleGraph, node: LifecycleNodeId, state: LifecycleState): boolean {
  return (graph.nodes[node]?.requiresGates ?? []).some((gate) => state.gates[gate]?.status !== "pass");
}

function retryEdge(graph: LifecycleGraph, node: LifecycleNodeId): ReturnType<typeof findEdge> {
  const reason = RETRY_REASONS[node];
  return reason ? findEdge(graph, node, reason) : undefined;
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
    delegate: reasonCode === "focus-required" ? null : node.delegate,
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

  if (reasonApplies("focus-required", input.state, null)) {
    return routeResult(input, null, input.current, "focus-required", null);
  }
  const taskGraph = taskGraphForState(input.state, input.taskDir);

  if (input.current === "followup-triage") {
    const upstreamEdge = followupUpstreamRecoveryEdge(input.graph, input.state);
    if (upstreamEdge) return routeResult(input, taskGraph, upstreamEdge.to, upstreamEdge.when, upstreamEdge.id);
    if (input.state.gates["followup-triage"]?.status === "pass") {
      const edge = typedFollowupEdge(input.graph, input.state);
      if (edge) return routeResult(input, taskGraph, edge.to, edge.when, edge.id);
    }
  }

  let node = input.current;
  const visited = new Set<LifecycleNodeId>();
  while (!visited.has(node)) {
    visited.add(node);

    if (hasFailedPrerequisite(input.graph, node, input.state)) {
      const recovery = prerequisiteRecoveryEdge(input.graph, node, input.state);
      if (recovery) return routeResult(input, taskGraph, recovery.to, recovery.when, recovery.id);
      break;
    }

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
    if (edge.to === node) {
      return routeResult(input, taskGraph, edge.to, edge.when, edge.id);
    }
    node = edge.to;
  }

  // A complete node is terminal and has no outgoing graph edge. Other nodes
  // always use a declared retry edge rather than inventing a transition.
  if (node === "complete") {
    return routeResult(input, taskGraph, node, "lifecycle-complete", null);
  }
  const retry = retryEdge(input.graph, node);
  if (retry) return routeResult(input, taskGraph, retry.to, retry.when, retry.id);
  throw new Error(`Lifecycle graph has no route for node: ${node}`);
}

export { routingPrecedence };
