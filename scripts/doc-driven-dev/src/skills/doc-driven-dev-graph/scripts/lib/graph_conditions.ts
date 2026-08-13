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
  if (condition.state === "runnable") return (state.taskGraph?.runnable.length ?? 0) > 0;
  if (condition.state === "invalid") return (state.taskGraph?.issues.length ?? 0) > 0;
  return state.taskGraph !== null
    && state.taskGraph.runnable.length === 0
    && state.taskGraph.issues.length === 0;
}
