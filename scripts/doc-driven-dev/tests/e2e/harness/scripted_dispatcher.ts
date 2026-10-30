/**
 * Scripted effect dispatcher for the deterministic e2e harness. It replaces
 * the LLM/tool that a production caller would inject: every audit/delegate
 * outcome is scripted per edge, built from REAL canonical references over the
 * fixture's authoritative-input mapping (ported verbatim from the in-process
 * oracle's effectInputPaths/effectEvidencePath, run-to-yield lines 282–317).
 *
 * The dispatcher is intentionally dumb: it produces contract-shaped outcomes
 * and applies minimal document mutators — it never self-grades (no gate
 * checks, no expectation logic). Determinism: no clocks, no randomness; all
 * references derive from file content.
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import {
  canonicalReference,
  type CallerEffect,
  type CanonicalReference,
  type CompletedEffectOutcome,
  type DispatchObservation,
  type DispatchResult,
  type EffectDispatcher,
  type EffectOutcome,
  type EffectYieldReason,
  type RetryEffectOutcome,
  type YieldEffectOutcome,
} from "../../../src/skills/doc-driven-dev-graph/scripts/lib/caller_runner";
import type { GraphRoute } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/graph_router";
import type { DispatchMethod, ExecutionMode } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/run_trace";
import { commitAll, updateArtifact, writeArtifact } from "./fixture_manager";

export const DEFAULT_PROOF_PATH = "docs/tasks/0001-task.md";

const canonicalDocumentPaths = (proofPath: string): string[] => [
  "docs/specs/0001-graph.md",
  "docs/adr/0001-graph.md",
  "docs/designs/0001-graph.md",
  "docs/plans/0001-graph.md",
  "docs/test-specs/0001-graph.md",
  proofPath,
  "docs/impl/ir/0001-task.md",
];

function taskGraphPaths(route: GraphRoute, proofPath: string): string[] {
  return route.taskGraph?.nodes.map((node) => node.path) ?? [proofPath];
}

function selectedTaskGraphPlanPath(route: GraphRoute): string {
  const plan = route.taskGraph?.plan;
  if (typeof plan !== "string" || plan.length === 0) {
    throw new Error("Missing selected Task Graph plan for build_task_graph");
  }
  return plan;
}

/** Authoritative-input mapping (oracle `effectInputPaths`, verbatim). */
export function standardResolveInputs(
  route: GraphRoute,
  effect: CallerEffect,
  proofPath: string = DEFAULT_PROOF_PATH,
): string[] {
  if (effect.kind === "audit") {
    switch (effect.id) {
      case "spec": return ["docs/specs/0001-graph.md"];
      case "adr": return ["docs/adr/0001-graph.md"];
      case "design": return ["docs/designs/0001-graph.md"];
      case "plan": return ["docs/plans/0001-graph.md"];
      case "task": return taskGraphPaths(route, proofPath);
      case "test-spec": return ["docs/test-specs/0001-graph.md"];
      case "impl-record": return ["docs/impl/ir/0001-task.md"];
      case "all": return canonicalDocumentPaths(proofPath);
    }
  }
  switch (effect.id) {
    case "migrate_docs": return canonicalDocumentPaths(proofPath);
    case "scaffold_docs": return ["."];
    case "build_task_graph": return [selectedTaskGraphPlanPath(route), ...taskGraphPaths(route, proofPath)];
    case "briefing-flow": return ["docs/specs/0001-graph.md", "docs/adr/0001-graph.md"];
    case "design-doc": return ["docs/specs/0001-graph.md", "docs/adr/0001-graph.md"];
    case "planning-flow": return ["docs/designs/0001-graph.md"];
    case "implementation-flow": return [...taskGraphPaths(route, proofPath), "docs/designs/0001-graph.md", "docs/plans/0001-graph.md"];
    case "doc-status": return canonicalDocumentPaths(proofPath);
    default: throw new Error(`No authoritative-input mapping for ${effect.kind}:${effect.id}`);
  }
}

/** Canonical evidence-path mapping (oracle `effectEvidencePath`, verbatim). */
export function standardResolveEvidence(
  route: GraphRoute,
  effect: CallerEffect,
  proofPath: string = DEFAULT_PROOF_PATH,
): string {
  if (effect.kind === "audit") return standardResolveInputs(route, effect, proofPath)[0];
  switch (effect.id) {
    case "design-doc": return "docs/designs/0001-graph.md";
    case "planning-flow": return "docs/plans/0001-graph.md";
    case "implementation-flow": return "docs/impl/ir/0001-task.md";
    case "doc-status": return "docs/impl/ir/0001-task.md";
    default: return standardResolveInputs(route, effect, proofPath)[0];
  }
}

export type OutcomeSpec =
  | "completed" | "retry" | { yield: EffectYieldReason }
  | { malformed: "missing-proof" | "scope-mismatch" | "stale-fingerprint" | "wrong-edge" };

export type Mutator =
  | { write: { path: string; frontmatter?: Record<string, unknown>; body?: string } }
  | { set: { path: string; frontmatter: Record<string, unknown> } }
  | { append: { path: string; body: string } }
  | { commit: true }; // commitAll(repo) — git inside the fixture repo only

/**
 * One adapter-internal sub-dispatch a composite delegate performs. This is
 * how the scripted adapter simulates briefing-flow's inner skill fan-out —
 * spec-doc/adr-doc running as same-context skills vs an independent
 * `research` dispatch under a delegated mode. Each entry produces one
 * `dispatch-observed` trace event: what the adapter actually did, not a
 * relabel of the top-level dispatch.
 */
export type SubDispatchSpec = {
  /** Internal target id recorded on the observation (e.g. "spec-doc", "research"). */
  target: string;
  /** Mode the internal dispatch is requested under; default "same-context". */
  requested?: ExecutionMode;
  /**
   * Mechanism the adapter reports; default `inline-skill` for same-context
   * requests and `subagent-spawn` for delegated ones. A delegated sub-dispatch
   * genuinely runs the bounded path: its mutators are scope-checked against
   * `writeScope` before any write, so the method reflects different behavior,
   * not a label.
   */
  method?: DispatchMethod;
  /** Mutators applied by this sub-dispatch, in order. */
  mutate?: Mutator[];
  /**
   * Permitted write scope for the bounded path (repo-relative prefixes or
   * exact paths). Required for a delegated sub-dispatch that mutates —
   * absent means fail-closed refusal; a mutator outside it is refused as an
   * unauthorized change. Ignored for same-context sub-dispatches (they run
   * in the caller's context, like the top-level inline path).
   */
  writeScope?: string[];
  /** Adapter declines outright — e.g. the host cannot execute the mode. */
  refuse?: boolean;
  /**
   * The sub-dispatch executes but its returned evidence does not resolve
   * current canonical content — the simulated host rejects the return and
   * the delegate fails instead of completing on stale evidence.
   */
  staleReturn?: boolean;
  /** Report an actual mode different from the request — dishonest adapter. */
  reportActual?: ExecutionMode;
};

export type EdgeScript = {
  /** Queue form is consumed per dispatch of that audit; scalar repeats. */
  audits?: Record<string, OutcomeSpec | OutcomeSpec[]>;
  delegate?: OutcomeSpec | OutcomeSpec[];
  /** Applied when the delegate outcome resolves to "completed". */
  mutate?: Mutator[];
  /**
   * Internal dispatch plan for a composite delegate, fired when the delegate
   * outcome resolves to "completed". Scalar repeats per delegate dispatch;
   * queue form (array of plans) is consumed one plan per delegate dispatch.
   * A refused or rejected sub-dispatch forces the delegate outcome to a
   * `yield authority-required` — the delegate never completes over a breach.
   */
  subDispatches?: SubDispatchSpec[] | SubDispatchSpec[][];
  /**
   * Report a different `actual` mode on this delegate's self-observation —
   * simulates an adapter that silently switched modes; the runner's
   * attribution check must reject the dispatch.
   */
  reportActual?: ExecutionMode;
  /** runCase wires applyEvidence = persistEvidence + commitAll (commitGate edges). */
  commitEvidence?: boolean;
};

/** Apply one document mutator inside the fixture repo. */
export function applyMutator(repo: string, mutator: Mutator): void {
  if ("write" in mutator) {
    const { path: rel, frontmatter, body } = mutator.write;
    const file = path.join(repo, rel);
    const parsed = fs.existsSync(file) ? matter(fs.readFileSync(file, "utf8")) : null;
    writeArtifact(repo, rel, { ...(parsed?.data ?? {}), ...(frontmatter ?? {}) }, body ?? parsed?.content ?? "");
  } else if ("set" in mutator) {
    updateArtifact(repo, mutator.set.path, mutator.set.frontmatter);
  } else if ("append" in mutator) {
    const file = path.join(repo, mutator.append.path);
    const parsed = matter(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, matter.stringify(parsed.content + mutator.append.body, parsed.data), "utf8");
  } else {
    commitAll(repo);
  }
}

function inputReferences(
  repo: string,
  route: GraphRoute,
  effect: CallerEffect,
  proofPath: string,
): CanonicalReference[] {
  return [...new Set(standardResolveInputs(route, effect, proofPath))]
    .sort()
    .map((relativePath) => canonicalReference(repo, relativePath));
}

function completedOutcome(
  repo: string,
  route: GraphRoute,
  stage: "audit" | "delegate",
  effect: CallerEffect,
  inputs: CanonicalReference[],
  evidence: CanonicalReference,
  proofPath: string,
): CompletedEffectOutcome {
  const evidenceReferences = effect.id === "planning-flow"
    ? [
        evidence,
        canonicalReference(repo, "docs/test-specs/0001-graph.md"),
        ...taskGraphPaths(route, proofPath).map((relativePath) => canonicalReference(repo, relativePath)),
      ]
    : [evidence];
  return {
    status: "completed",
    edgeId: route.edgeId as string,
    stage,
    effect,
    authoritativeInputs: inputs,
    evidence: evidenceReferences,
    proof: { canonicalEvidence: evidence },
  };
}

function buildOutcome(
  spec: OutcomeSpec,
  ctx: {
    repo: string; route: GraphRoute; stage: "audit" | "delegate"; effect: CallerEffect;
    inputs: CanonicalReference[]; evidence: CanonicalReference; proofPath: string;
  },
): EffectOutcome {
  const { repo, route, stage, effect, inputs, evidence, proofPath } = ctx;
  if (spec === "completed") {
    return completedOutcome(repo, route, stage, effect, inputs, evidence, proofPath);
  }
  if (spec === "retry") {
    const outcome: RetryEffectOutcome = {
      status: "retry",
      edgeId: route.edgeId as string,
      stage,
      effect,
      authoritativeInputs: inputs,
      evidence: [evidence],
      retry: { changedEvidence: [evidence] },
    };
    return outcome;
  }
  if (typeof spec === "object" && "yield" in spec) {
    const outcome: YieldEffectOutcome = {
      status: "yield",
      edgeId: route.edgeId as string,
      stage,
      effect,
      authoritativeInputs: inputs,
      evidence: [evidence],
      reason: spec.yield,
    };
    return outcome;
  }
  if (typeof spec === "object" && "malformed" in spec) {
    const completed = completedOutcome(repo, route, stage, effect, inputs, evidence, proofPath);
    switch (spec.malformed) {
      case "missing-proof":
        return { ...completed, proof: {} };
      case "scope-mismatch":
        return { ...completed, authoritativeInputs: [] };
      case "stale-fingerprint":
        return { ...completed, evidence: [{ ...evidence, fingerprint: "0".repeat(64) }] };
      case "wrong-edge":
        return { ...completed, edgeId: `${route.edgeId as string}-wrong` };
    }
  }
  throw new Error(`Unknown outcome spec: ${JSON.stringify(spec)}`);
}

/** The repo-relative path a mutator writes; commit mutators touch no path. */
function mutatorPath(mutator: Mutator): string | null {
  if ("write" in mutator) return mutator.write.path;
  if ("set" in mutator) return mutator.set.path;
  if ("append" in mutator) return mutator.append.path;
  return null;
}

/** Prefix-or-exact scope membership on repo-relative paths (posix-normalized). */
export function pathInScope(relativePath: string, scopes: readonly string[]): boolean {
  const rel = relativePath.split(path.sep).join("/");
  return scopes.some((scope) => {
    const normalized = scope.split(path.sep).join("/");
    return normalized.endsWith("/") ? rel.startsWith(normalized) : rel === normalized;
  });
}

/**
 * Build an EffectDispatcher from a per-edge outcome script. Unscripted
 * effects follow `onUnhandled` ("throw" by default — no silent defaults);
 * an exhausted queue always throws (a script bug must fail deterministically).
 *
 * The adapter reports honest DispatchObservations: its self-observation is
 * `method: "scripted"` (it IS a scripted simulation) with `actual` equal to
 * the request it honored — same-context effects mutate inline, delegated
 * requests run the handoff's write scope. `unsupportedModes` simulates a
 * host that cannot execute a mode: the dispatch declines (not-executed +
 * yield), it never silently switches.
 */
export function scriptedDispatcher(options: {
  repo: string;
  proofPath?: string;
  script: Record<string, EdgeScript>;
  onUnhandled?: "throw" | "completed";
  /** Modes the simulated host cannot execute — dispatching one is refused. */
  unsupportedModes?: readonly ExecutionMode[];
}): EffectDispatcher {
  const proofPath = options.proofPath ?? DEFAULT_PROOF_PATH;
  const onUnhandled = options.onUnhandled ?? "throw";
  const unsupported = new Set<ExecutionMode>(options.unsupportedModes ?? []);
  const queues = new Map<string, OutcomeSpec[]>();
  const subPlans = new Map<string, SubDispatchSpec[][]>();
  for (const [edgeId, edgeScript] of Object.entries(options.script)) {
    for (const [auditId, spec] of Object.entries(edgeScript.audits ?? {})) {
      if (Array.isArray(spec)) queues.set(`${edgeId}${auditId}`, [...spec]);
    }
    if (Array.isArray(edgeScript.delegate)) queues.set(`${edgeId}delegate`, [...edgeScript.delegate]);
    if (Array.isArray(edgeScript.subDispatches?.[0])) {
      subPlans.set(`${edgeId}subDispatches`, [...edgeScript.subDispatches] as SubDispatchSpec[][]);
    }
  }

  const scriptedSpec = (edgeId: string, effect: CallerEffect): OutcomeSpec | undefined => {
    const edgeScript = options.script[edgeId];
    if (!edgeScript) return undefined;
    if (effect.kind === "audit") {
      const spec = edgeScript.audits?.[effect.id];
      if (spec === undefined) return undefined;
      if (Array.isArray(spec)) {
        const queue = queues.get(`${edgeId}${effect.id}`) ?? [];
        const next = queue.shift();
        if (next === undefined) {
          throw new Error(`scriptedDispatcher: outcome queue exhausted for ${effect.kind}:${effect.id} on ${edgeId}`);
        }
        return next;
      }
      return spec;
    }
    const spec = edgeScript.delegate;
    if (spec === undefined) return undefined;
    if (Array.isArray(spec)) {
      const queue = queues.get(`${edgeId}delegate`) ?? [];
      const next = queue.shift();
      if (next === undefined) {
        throw new Error(`scriptedDispatcher: outcome queue exhausted for delegate on ${edgeId}`);
      }
      return next;
    }
    return spec;
  };

  const subDispatchPlan = (edgeId: string): SubDispatchSpec[] => {
    const declared = options.script[edgeId]?.subDispatches;
    if (!declared) return [];
    if (!Array.isArray(declared[0])) return declared as SubDispatchSpec[];
    const queue = subPlans.get(`${edgeId}subDispatches`) ?? [];
    const next = queue.shift();
    if (next === undefined) {
      throw new Error(`scriptedDispatcher: subDispatches queue exhausted on ${edgeId}`);
    }
    return next;
  };

  const delegated = (mode: ExecutionMode): boolean => mode === "tool" || mode === "subagent";

  /**
   * Fire one edge's internal dispatch plan: every entry produces an
   * observation; a refusal (unsupported mode, unauthorized write scope,
   * explicit `refuse`) or a rejected return (`staleReturn`) fails the
   * delegate's internal pipeline — the adapter then yields authority-
   * required instead of claiming a completed delegate over a breach.
   */
  const runSubDispatches = (
    repo: string,
    edgeId: string,
  ): { observations: DispatchObservation[]; failed: boolean } => {
    const observations: DispatchObservation[] = [];
    for (const sub of subDispatchPlan(edgeId)) {
      const requested = sub.requested ?? "same-context";
      const mutators = sub.mutate ?? [];
      const writePaths = mutators.map(mutatorPath).filter((p): p is string => p !== null);
      // A delegated sub-dispatch mutating without a declared writeScope is a
      // fail-closed contract breach — like a handoff that grants no writes.
      const scope = sub.writeScope;
      const unauthorized = delegated(requested)
        && writePaths.length > 0
        && (scope === undefined || !writePaths.every((p) => pathInScope(p, scope)));
      const declined = sub.refuse === true || unsupported.has(requested) || unauthorized;
      if (declined) {
        observations.push({ target: sub.target, requested, actual: "unknown", method: "not-executed" });
        return { observations, failed: true };
      }
      for (const mutator of mutators) applyMutator(repo, mutator);
      observations.push({
        target: sub.target,
        requested,
        actual: sub.reportActual ?? requested,
        method: sub.method ?? (delegated(requested) ? "subagent-spawn" : "inline-skill"),
      });
      // The sub-dispatch executed but returned evidence that no longer
      // resolves current content — the host rejects it and the delegate fails.
      if (sub.staleReturn === true) return { observations, failed: true };
    }
    return { observations, failed: false };
  };

  return (ctx): DispatchResult => {
    const { repo, route, effect, requestedMode } = ctx;
    const edgeId = route.edgeId as string;
    const stage = effect.kind;
    const self = (actual: ExecutionMode, method: DispatchMethod): DispatchObservation => (
      { target: effect.id, requested: requestedMode, actual, method }
    );
    const refused = (): DispatchResult => {
      const inputs = inputReferences(repo, route, effect, proofPath);
      const evidence = canonicalReference(repo, standardResolveEvidence(route, effect, proofPath));
      const outcome = buildOutcome(
        { yield: "authority-required" },
        { repo, route, stage, effect, inputs, evidence, proofPath },
      );
      return { outcome, observations: [self("unknown", "not-executed")] };
    };

    let spec = scriptedSpec(edgeId, effect);
    if (spec === undefined) {
      if (onUnhandled === "throw") {
        throw new Error(`scriptedDispatcher: no scripted outcome for ${effect.kind}:${effect.id} on edge ${edgeId}`);
      }
      spec = "completed";
    }
    // Capability gate: the adapter declines a mode it cannot execute.
    if (unsupported.has(requestedMode)) return refused();
    // Authoritative inputs are what the effect READ — resolved before any
    // mutator runs so they match the runner's pre-dispatch expectedInputs
    // binding (a mutator that touches an input doc must not break it).
    const inputs = inputReferences(repo, route, effect, proofPath);
    // Mutators are the completed delegate's work product: they run before
    // evidence is computed so evidence reflects post-mutation content. A
    // delegated top-level dispatch confines them to the handoff write scope
    // — a write outside it is refused as an unauthorized change.
    const mutators = effect.kind === "delegate" && spec === "completed"
      ? options.script[edgeId]?.mutate ?? []
      : [];
    if (ctx.handoff) {
      const writePaths = mutators.map(mutatorPath).filter((p): p is string => p !== null);
      if (writePaths.length > 0 && !writePaths.every((p) => pathInScope(p, ctx.handoff!.permissions.write))) {
        return refused();
      }
    }
    for (const mutator of mutators) applyMutator(repo, mutator);

    const subObservations: DispatchObservation[] = [];
    let subFailed = false;
    if (effect.kind === "delegate" && spec === "completed") {
      const subs = runSubDispatches(repo, edgeId);
      subObservations.push(...subs.observations);
      subFailed = subs.failed;
    }
    const evidence = canonicalReference(repo, standardResolveEvidence(route, effect, proofPath));
    const outcome = subFailed
      ? buildOutcome(
          { yield: "authority-required" },
          { repo, route, stage, effect, inputs, evidence, proofPath },
        )
      : buildOutcome(spec, { repo, route, stage, effect, inputs, evidence, proofPath });
    return {
      outcome,
      observations: [
        self(options.script[edgeId]?.reportActual ?? requestedMode, "scripted"),
        ...subObservations,
      ],
    };
  };
}
