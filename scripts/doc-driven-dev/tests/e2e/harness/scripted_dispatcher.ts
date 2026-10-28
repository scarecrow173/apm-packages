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
  type EffectDispatcher,
  type EffectOutcome,
  type EffectYieldReason,
  type RetryEffectOutcome,
  type YieldEffectOutcome,
} from "../../../src/skills/doc-driven-dev-graph/scripts/lib/caller_runner";
import type { GraphRoute } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/graph_router";
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

export type EdgeScript = {
  /** Queue form is consumed per dispatch of that audit; scalar repeats. */
  audits?: Record<string, OutcomeSpec | OutcomeSpec[]>;
  delegate?: OutcomeSpec | OutcomeSpec[];
  /** Applied when the delegate outcome resolves to "completed". */
  mutate?: Mutator[];
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

/**
 * Build an EffectDispatcher from a per-edge outcome script. Unscripted
 * effects follow `onUnhandled` ("throw" by default — no silent defaults);
 * an exhausted queue always throws (a script bug must fail deterministically).
 */
export function scriptedDispatcher(options: {
  repo: string;
  proofPath?: string;
  script: Record<string, EdgeScript>;
  onUnhandled?: "throw" | "completed";
}): EffectDispatcher {
  const proofPath = options.proofPath ?? DEFAULT_PROOF_PATH;
  const onUnhandled = options.onUnhandled ?? "throw";
  const queues = new Map<string, OutcomeSpec[]>();
  for (const [edgeId, edgeScript] of Object.entries(options.script)) {
    for (const [auditId, spec] of Object.entries(edgeScript.audits ?? {})) {
      if (Array.isArray(spec)) queues.set(`${edgeId}${auditId}`, [...spec]);
    }
    if (Array.isArray(edgeScript.delegate)) queues.set(`${edgeId}delegate`, [...edgeScript.delegate]);
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

  return ({ repo, route, effect }) => {
    const edgeId = route.edgeId as string;
    const stage = effect.kind;
    let spec = scriptedSpec(edgeId, effect);
    if (spec === undefined) {
      if (onUnhandled === "throw") {
        throw new Error(`scriptedDispatcher: no scripted outcome for ${effect.kind}:${effect.id} on edge ${edgeId}`);
      }
      spec = "completed";
    }
    // Authoritative inputs are what the effect READ — resolved before any
    // mutator runs so they match the runner's pre-dispatch expectedInputs
    // binding (a mutator that touches an input doc must not break it).
    const inputs = inputReferences(repo, route, effect, proofPath);
    // Mutators are the completed delegate's work product: they run before
    // evidence is computed so evidence reflects post-mutation content.
    if (effect.kind === "delegate" && spec === "completed") {
      for (const mutator of options.script[edgeId]?.mutate ?? []) applyMutator(repo, mutator);
    }
    const evidence = canonicalReference(repo, standardResolveEvidence(route, effect, proofPath));
    return buildOutcome(spec, { repo, route, stage, effect, inputs, evidence, proofPath });
  };
}
