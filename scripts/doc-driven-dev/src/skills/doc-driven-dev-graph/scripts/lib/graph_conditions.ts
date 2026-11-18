import type { GraphCondition } from "./graph_definition";
import type { GraphState } from "./graph_state";

/** Evaluate one condition from a graph definition against projected state. */
export function evaluateCondition(condition: GraphCondition, state: GraphState): boolean {
  if (condition.kind === "signal") return state.signals.includes(condition.signal);
  if (condition.kind === "gate") {
    return condition.status === "pass"
      ? state.gates[condition.gate]?.status === "pass"
      : state.gates[condition.gate]?.status !== "pass";
  }
  if (condition.state === "runnable") return (state.execution.taskGraph?.runnable.length ?? 0) > 0;
  if (condition.state === "active") {
    return (state.execution.taskGraph?.issues.length ?? 0) === 0
      && (state.execution.taskGraph?.resumableActive.length ?? 0) > 0;
  }
  if (condition.state === "invalid") return (state.execution.taskGraph?.issues.length ?? 0) > 0;
  return state.execution.taskGraph !== null
    && state.execution.taskGraph.completed.length > 0
    && state.execution.taskGraph.runnable.length === 0
    && state.execution.taskGraph.active.length === 0
    && state.execution.taskGraph.blocked.length === 0
    && state.execution.taskGraph.issues.length === 0;
}
