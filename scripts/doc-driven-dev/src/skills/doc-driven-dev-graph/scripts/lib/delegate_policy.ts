/**
 * Deterministic delegate execution-mode policy for the doc-driven-dev
 * execution graph.
 *
 * selectDelegateMode() maps dispatch facts to a DelegateMode plus recorded
 * string reasons — it never spawns anything itself. Host capabilities gate
 * every selection: an unsupported mode falls back to "same-context" with
 * fallbackFrom + a "host-unsupported:<mode>" reason, never silently.
 * toExecutionMode() projects the finer policy taxonomy onto the trace
 * ExecutionMode enum. buildDelegateHandoff() assembles the minimum
 * JSON-serializable dispatch contract — canonical references by
 * path/ID/fingerprint, permissions, tool limits, hop budget, and the
 * completion sentence; never lossy summaries in place of canonical refs.
 */

import type { CanonicalReference } from "./caller_runner";
import type { ExecutionMode } from "./run_trace";

export type DelegateMode = "same-context" | "subagent-as-tool" | "isolated-subagent";

export type PolicyFacts = {
  effectId: string;
  stage: "audit" | "delegate";
  independentScope: boolean;
  sharedJudgment: boolean;
  contextCost: "low" | "high";
  parallelCandidate: boolean;
  hostCapabilities: ReadonlySet<DelegateMode>;
  override?: { mode: DelegateMode; reason: string };
};

export type PolicyDecision = {
  mode: DelegateMode;
  reasons: string[];
  fallbackFrom?: DelegateMode;
};

const EXECUTION_MODES: Record<DelegateMode, ExecutionMode> = {
  "same-context": "same-context",
  "subagent-as-tool": "tool",
  "isolated-subagent": "subagent",
};

/** Project the policy taxonomy onto the trace ExecutionMode enum. */
export function toExecutionMode(mode: DelegateMode): ExecutionMode {
  return EXECUTION_MODES[mode];
}

/** The selected mode when host-capable, else a recorded same-context fallback. */
function gate(mode: DelegateMode, reasons: string[], facts: PolicyFacts): PolicyDecision {
  if (facts.hostCapabilities.has(mode)) return { mode, reasons };
  return {
    mode: "same-context",
    reasons: [...reasons, `host-unsupported:${mode}`],
    fallbackFrom: mode,
  };
}

/**
 * Select the delegate execution mode in a fixed order — first match wins:
 *   1. explicit override (honored only when host-capable, else refused)
 *   2. sharedJudgment -> same-context
 *   3. independentScope && parallelCandidate -> isolated-subagent
 *   4. independentScope -> subagent-as-tool
 *   5. contextCost "high" -> subagent-as-tool
 *   6. default -> same-context
 * Type or document-kind differences alone never justify delegation.
 */
export function selectDelegateMode(facts: PolicyFacts): PolicyDecision {
  if (facts.override) {
    if (facts.hostCapabilities.has(facts.override.mode)) {
      return { mode: facts.override.mode, reasons: [`override:${facts.override.reason}`] };
    }
    return {
      mode: "same-context",
      reasons: [`host-unsupported:${facts.override.mode}`, "override-refused"],
      fallbackFrom: facts.override.mode,
    };
  }
  if (facts.sharedJudgment) return { mode: "same-context", reasons: ["shared-judgment"] };
  if (facts.independentScope && facts.parallelCandidate) {
    return gate("isolated-subagent", ["independent-scope", "parallel-candidate"], facts);
  }
  if (facts.independentScope) return gate("subagent-as-tool", ["independent-scope"], facts);
  if (facts.contextCost === "high") return gate("subagent-as-tool", ["context-cost"], facts);
  return { mode: "same-context", reasons: ["default"] };
}

/**
 * Minimum JSON-serializable contract a dispatched delegate effect receives.
 * `authoritativeInputs`/`sourceRefs` carry live canonical references —
 * verification-relevant information is never substituted with summaries.
 * `executionMode` records the trace-taxonomy mode the dispatch was requested
 * under, so the receiving adapter and the `dispatch-observed` report name the
 * same request.
 */
export type DelegateHandoff = {
  executionMode: ExecutionMode;
  focus: string[];
  authoritativeInputs: CanonicalReference[];
  sourceRefs: CanonicalReference[];
  acceptanceCriteria: string[];
  permissions: { read: string[]; write: string[] };
  toolLimits: string[];
  budget: { maxHops: number };
  completion: string;
};

/** Default single-hop bound — expand explicitly for multi-hop delegate flows. */
const DEFAULT_MAX_HOPS = 1;
const DEFAULT_COMPLETION = "completed EffectOutcome with canonical evidence";

/** Assemble a DelegateHandoff; absent fields fall back to the empty/default contract. */
export function buildDelegateHandoff(options: {
  /** The requested execution mode the handoff is dispatched under. */
  mode: ExecutionMode;
  focus: string[];
  inputs: CanonicalReference[];
  sourceRefs?: CanonicalReference[];
  criteria?: string[];
  permissions?: { read: string[]; write: string[] };
  toolLimits?: string[];
  maxHops?: number;
  completion?: string;
}): DelegateHandoff {
  return {
    executionMode: options.mode,
    focus: [...options.focus],
    authoritativeInputs: [...options.inputs],
    sourceRefs: [...(options.sourceRefs ?? [])],
    acceptanceCriteria: [...(options.criteria ?? [])],
    permissions: {
      read: [...(options.permissions?.read ?? [])],
      write: [...(options.permissions?.write ?? [])],
    },
    toolLimits: [...(options.toolLimits ?? [])],
    budget: { maxHops: options.maxHops ?? DEFAULT_MAX_HOPS },
    completion: options.completion ?? DEFAULT_COMPLETION,
  };
}
