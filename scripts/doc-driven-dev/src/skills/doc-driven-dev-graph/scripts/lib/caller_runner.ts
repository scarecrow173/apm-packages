/**
 * Production-grade caller protocol for the doc-driven-dev execution graph.
 *
 * runCaller() drives the public contract:
 *   Graph Definition -> fresh Graph State (one route_graph CLI call per hop)
 *   -> one declared route -> audits -> delegate -> canonical Markdown evidence
 *   -> commit gate -> re-enter at next -> repeat or yield.
 *
 * Effect dispatch is injected: callers supply an EffectDispatcher (LLM, tool,
 * or scripted adapter). This module owns outcome validation, canonical
 * evidence receipts, outcome persistence, the commit baseline/gate, pending
 * edge resume, bounded hops, and run-level trace events — never effect work.
 * The trace it appends is diagnostic only (see run-trace-contract.md).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import matter from "gray-matter";
import { loadGraphDefinition } from "./graph_definition";
import { resolveGraphPath } from "./graph_cli";
import type { GraphRoute } from "./graph_router";
import { appendTraceEvent, type ExecutionMode, type TraceEventInput } from "./run_trace";

export type YieldReason =
  | "terminal" | "single-step-complete" | "budget-exhausted"
  | "approval-required" | "input-required" | "authority-required"
  | "unrecoverable-blocker" | "commit-required";

export type EffectYieldReason = Extract<YieldReason,
  "approval-required" | "input-required" | "authority-required" | "unrecoverable-blocker" | "commit-required">;

export type CallerEffect = { kind: "audit" | "delegate"; id: string };
export type CanonicalReference = { path: string; id: string; fingerprint: string };

export type CompletedEffectOutcome = {
  status: "completed"; edgeId: string; stage: "audit" | "delegate";
  effect: CallerEffect;
  authoritativeInputs: CanonicalReference[]; evidence: CanonicalReference[];
  proof: { canonicalEvidence?: CanonicalReference; providerIdempotency?: { provider: string; key: string } };
};
export type RetryEffectOutcome = {
  status: "retry"; edgeId: string; stage: "audit" | "delegate"; effect: CallerEffect;
  authoritativeInputs: CanonicalReference[]; evidence: CanonicalReference[];
  retry: { changedEvidence: CanonicalReference[] };
};
export type YieldEffectOutcome = {
  status: "yield"; edgeId: string; stage: "audit" | "delegate"; effect: CallerEffect;
  authoritativeInputs: CanonicalReference[]; evidence: CanonicalReference[];
  reason: EffectYieldReason;
};
export type EffectOutcome = CompletedEffectOutcome | RetryEffectOutcome | YieldEffectOutcome;

export type EvidenceReceipt = { edgeId: string; evidence: CanonicalReference };
export type CommitBaseline = { head: string | null; dirty: string[] };

/** Thrown for every EffectOutcome contract violation — callers catch it. */
export class OutcomeRejection extends Error {}

/**
 * Canonical workspace directories fingerprinted for the "." reference, in the
 * declared artifact order (same contract as graph_state.ts / artifact_graph.ts).
 */
const CANONICAL_TARGETS = [
  "docs/ideas",
  "docs/discovery",
  "docs/specs",
  "docs/designs",
  "docs/plans",
  "docs/tasks",
  "docs/test-specs",
  "docs/adr",
  "docs/impl/ir",
  "docs/impl/exp",
];

/**
 * Default canonical doc carrying caller bookkeeping (`effectOutcomes` and
 * `checkpointEvidence` front matter). Callers may override it per run; see
 * CallerRunnerOptions.proofPath.
 */
const DEFAULT_PROOF_PATH = "docs/tasks/0001-task.md";

export function fingerprint(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function filesystemEntryKind(target: string): string {
  if (!fs.existsSync(target)) return "missing";
  const entry = fs.statSync(target);
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  return "other";
}

export function canonicalReference(repo: string, relativePath: string): CanonicalReference {
  if (relativePath === ".") {
    const entries = CANONICAL_TARGETS.flatMap((directory) => {
      const target = path.join(repo, directory);
      return [
        `${directory}:${filesystemEntryKind(target)}`,
        `${directory}/README.md:${filesystemEntryKind(path.join(target, "README.md"))}`,
      ];
    });
    return {
      path: relativePath,
      id: "WORKSPACE_ROOT",
      fingerprint: fingerprint(entries.join("\n")),
    };
  }
  const file = path.join(repo, relativePath);
  const parsed = matter(fs.readFileSync(file, "utf8"));
  // Caller bookkeeping appended to a doc's front matter must not perturb the
  // artifact's own fingerprint — evidence references to the doc stay live.
  const { effectOutcomes: _outcomes, checkpointEvidence: _checkpoints, ...data } = parsed.data;
  return {
    path: relativePath,
    id: data.id as string,
    fingerprint: fingerprint(matter.stringify(parsed.content, data)),
  };
}

export function isCanonicalReference(value: unknown): value is CanonicalReference {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as CanonicalReference).path === "string"
    && typeof (value as CanonicalReference).id === "string"
    && typeof (value as CanonicalReference).fingerprint === "string";
}

export function canonicalEvidenceMatches(repo: string, evidence: CanonicalReference): boolean {
  if (path.isAbsolute(evidence.path)) return false;
  const resolved = path.resolve(repo, evidence.path);
  const relative = path.relative(repo, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(resolved)) return false;
  try {
    const current = canonicalReference(repo, evidence.path);
    return current.id === evidence.id && current.fingerprint === evidence.fingerprint;
  } catch {
    return false;
  }
}

export function storedOutcomes(repo: string, proofPath: string): EffectOutcome[] {
  const parsed = matter(fs.readFileSync(path.resolve(repo, proofPath), "utf8"));
  return Array.isArray(parsed.data.effectOutcomes) ? parsed.data.effectOutcomes as EffectOutcome[] : [];
}

export function persistOutcome(repo: string, proofPath: string, outcome: EffectOutcome): void {
  const file = path.resolve(repo, proofPath);
  const parsed = matter(fs.readFileSync(file, "utf8"));
  const outcomes = storedOutcomes(repo, proofPath);
  if (!outcomes.some((stored) => JSON.stringify(stored) === JSON.stringify(outcome))) outcomes.push(outcome);
  fs.writeFileSync(file, matter.stringify(parsed.content, { ...parsed.data, effectOutcomes: outcomes }), "utf8");
}

function hasStoredOutcome(repo: string, proofPath: string, outcome: EffectOutcome): boolean {
  return storedOutcomes(repo, proofPath).some((stored) => JSON.stringify(stored) === JSON.stringify(outcome));
}

export function evidenceReceipts(repo: string, proofPath: string): EvidenceReceipt[] {
  const parsed = matter(fs.readFileSync(path.resolve(repo, proofPath), "utf8"));
  return Array.isArray(parsed.data.checkpointEvidence)
    ? parsed.data.checkpointEvidence as EvidenceReceipt[]
    : [];
}

export function persistEvidence(repo: string, proofPath: string, edgeId: string): void {
  const file = path.resolve(repo, proofPath);
  const parsed = matter(fs.readFileSync(file, "utf8"));
  const receipts = evidenceReceipts(repo, proofPath);
  receipts.push({ edgeId, evidence: canonicalReference(repo, proofPath) });
  fs.writeFileSync(file, matter.stringify(parsed.content, { ...parsed.data, checkpointEvidence: receipts }), "utf8");
}

export function hasEvidence(repo: string, proofPath: string, edgeId: string): boolean {
  return evidenceReceipts(repo, proofPath).some((receipt) => (
    receipt.edgeId === edgeId
    && isCanonicalReference(receipt.evidence)
    && canonicalEvidenceMatches(repo, receipt.evidence)
  ));
}

export function assertEffectOutcome(
  repo: string,
  route: GraphRoute,
  outcome: EffectOutcome,
  stage: "audit" | "delegate",
  effect: CallerEffect,
  expectedInputs: CanonicalReference[],
): void {
  if (typeof outcome !== "object" || outcome === null) {
    throw new OutcomeRejection("EffectOutcome must be an object");
  }
  if (!["completed", "retry", "yield"].includes(outcome.status)) {
    throw new OutcomeRejection("unknown EffectOutcome status");
  }
  if (outcome.edgeId !== route.edgeId) {
    throw new OutcomeRejection(`EffectOutcome edgeId does not match route edge ${route.edgeId}`);
  }
  if (outcome.stage !== stage) {
    throw new OutcomeRejection(`EffectOutcome stage does not match dispatch stage ${stage}`);
  }
  if (!isDeepStrictEqual(outcome.effect, effect)) {
    throw new OutcomeRejection("EffectOutcome effect does not match the dispatched effect");
  }
  if (!Array.isArray(outcome.authoritativeInputs)
      || outcome.authoritativeInputs.length === 0
      || !outcome.authoritativeInputs.every(isCanonicalReference)) {
    throw new OutcomeRejection("authoritativeInputs must be a non-empty list of canonical references");
  }
  if (!isDeepStrictEqual(outcome.authoritativeInputs, expectedInputs)) {
    throw new OutcomeRejection("authoritativeInputs do not match the resolved authoritative inputs");
  }
  if (!Array.isArray(outcome.evidence)
      || outcome.evidence.length === 0
      || !outcome.evidence.every(isCanonicalReference)) {
    throw new OutcomeRejection("evidence must be a non-empty list of canonical references");
  }
  if (!outcome.evidence.every((evidence) => canonicalEvidenceMatches(repo, evidence))) {
    throw new OutcomeRejection("outcome evidence must resolve current canonical content");
  }
  if (outcome.status === "completed") {
    if ("reason" in outcome) {
      throw new OutcomeRejection("completed outcome must not include reason");
    }
    if ("retry" in outcome) {
      throw new OutcomeRejection("completed outcome must not include retry");
    }
    const proof = outcome.proof ?? {};
    const hasCanonicalEvidence = isCanonicalReference(proof.canonicalEvidence);
    const hasProviderIdempotency = typeof proof.providerIdempotency?.provider === "string"
      && proof.providerIdempotency.provider.length > 0
      && typeof proof.providerIdempotency.key === "string"
      && proof.providerIdempotency.key.length > 0;
    if (hasCanonicalEvidence === hasProviderIdempotency) {
      throw new OutcomeRejection(
        "completed outcome requires exactly one of proof.canonicalEvidence or proof.providerIdempotency",
      );
    }
    if (isCanonicalReference(proof.canonicalEvidence)
        && !canonicalEvidenceMatches(repo, proof.canonicalEvidence)) {
      throw new OutcomeRejection("completed proof must resolve current canonical content");
    }
  } else if (outcome.status === "retry") {
    if ("proof" in outcome) {
      throw new OutcomeRejection("retry outcome must not include proof");
    }
    if ("reason" in outcome) {
      throw new OutcomeRejection("retry outcome must not include reason");
    }
    const changedEvidence = outcome.retry?.changedEvidence;
    if (!Array.isArray(changedEvidence)
        || changedEvidence.length === 0
        || !changedEvidence.every(isCanonicalReference)) {
      throw new OutcomeRejection("retry outcome must include non-empty canonical changedEvidence");
    }
    if (!changedEvidence.every((evidence) => canonicalEvidenceMatches(repo, evidence))) {
      throw new OutcomeRejection("retry evidence must resolve current canonical content");
    }
  } else {
    if ("proof" in outcome) {
      throw new OutcomeRejection("yield outcome must not include proof");
    }
    if ("retry" in outcome) {
      throw new OutcomeRejection("yield outcome must not include retry");
    }
    if (!["approval-required", "input-required", "authority-required", "unrecoverable-blocker", "commit-required"]
      .includes(outcome.reason)) {
      throw new OutcomeRejection(`unknown yield reason: ${String(outcome.reason)}`);
    }
  }
}

export function isReusableCompletedOutcome(
  repo: string,
  route: GraphRoute,
  outcome: EffectOutcome,
  proofPath: string = DEFAULT_PROOF_PATH,
): boolean {
  if (outcome.status !== "completed") return false;
  // A real GraphRoute always declares `requiredAudits`; a route missing the
  // field binds no audits, so only the effect kind can be checked. A present
  // list must contain the audit effect (verbatim oracle semantics).
  const validEffect = outcome.stage === "audit"
    ? outcome.effect.kind === "audit"
      && (!Array.isArray(route.requiredAudits) || route.requiredAudits.includes(outcome.effect.id))
    : outcome.effect.kind === "delegate" && outcome.effect.id === route.delegate;
  if (!validEffect) return false;
  try {
    // The authoritative-input mapping belongs to the injected dispatcher, so
    // reuse validation re-checks the outcome's own declared inputs — shape,
    // edge/stage/effect identity, and live evidence fingerprints.
    assertEffectOutcome(repo, route, outcome, outcome.stage, outcome.effect, outcome.authoritativeInputs);
  } catch {
    return false;
  }
  if (!hasStoredOutcome(repo, proofPath, outcome)) return false;
  const proof = outcome.proof;
  if (proof?.providerIdempotency !== undefined) return true;
  const canonicalEvidence = proof?.canonicalEvidence;
  return isCanonicalReference(canonicalEvidence)
    && canonicalEvidenceMatches(repo, canonicalEvidence);
}

export function evaluateEffectOutcome(outcome: EffectOutcome): EffectYieldReason | "retry" | null {
  if (outcome.status === "yield") return outcome.reason;
  if (outcome.status === "retry") return "retry";
  return null;
}

function git(repo: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

export function captureBaseline(repo: string): CommitBaseline {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" });
  if (status.status !== 0) throw new Error(`git status failed: ${status.stderr}`);
  return {
    head: head.status === 0 ? head.stdout.trim() : null,
    dirty: status.stdout.split("\n").filter((line) => line.length > 0).sort(),
  };
}

export function commitGatePasses(baseline: CommitBaseline, after: CommitBaseline): boolean {
  // Strict rule: HEAD advancing alone does not pass. The gate passes only when
  // every current porcelain entry was already present in the baseline. `head`
  // stays in the captured baseline for trace/debugging context only.
  const baselineDirty = new Set(baseline.dirty);
  return after.dirty.every((entry) => baselineDirty.has(entry));
}

export type EffectDispatchContext = {
  repo: string;
  route: GraphRoute;
  effect: CallerEffect;
  signals: ReadonlySet<string>;
};

/** Injected effect executor — an LLM, tool, or scripted adapter. */
export type EffectDispatcher = (ctx: EffectDispatchContext) => EffectOutcome;

export type CallerRunnerOptions = {
  repo: string;
  /** Spawn: executable [...prefixArgs, ...routeArgs]. */
  router: { executable: string; prefixArgs: string[] };
  /** Default: resolveGraphPath(undefined, repo). */
  graphPath?: string;
  /** Default: definition entry node. */
  current?: string;
  /** Default: []. */
  focus?: string[];
  /** Default: []. */
  signals?: string[];
  /** Default: "run-until-yield". */
  mode?: "run-until-yield" | "single-step";
  /** Explicit fixed budget; absent -> topology budget below. */
  maxHops?: number;
  /**
   * Default true: the first implementation-flow route freezes the hop budget
   * at 10 + (activeTasks - 1). Pass false to keep the plain topology budget.
   */
  taskBudget?: boolean;
  dispatcher: EffectDispatcher;
  /** Adapter-owned authoritative input mapping, resolved to live canonical refs. */
  resolveInputs: (route: GraphRoute, effect: CallerEffect) => string[];
  /** Adapter-owned canonical evidence path mapping (consumed by dispatchers). */
  resolveEvidence: (route: GraphRoute, effect: CallerEffect) => string;
  /**
   * Evidence-phase hook; default persistEvidence(repo, proofPath, edgeId).
   * Receives the run's live signal set (the oracle's mutable-signal channel).
   */
  applyEvidence?: (repo: string, signals: ReadonlySet<string>, edgeId: string) => void;
  /** Canonical doc holding outcome+evidence front matter. */
  proofPath?: string;
  /** The dispatcher's nature, caller-declared; recorded on effect-dispatched. */
  executionMode?: ExecutionMode;
  trace?: { file: string; runId: string };
  resume?: CallerHandoff;
};

export type PendingEdge = {
  route: GraphRoute;
  outcomes: EffectOutcome[];
  completedAudits: string[];
  delegateComplete: boolean;
  evidenceRecorded: boolean;
  commitBaseline: CommitBaseline | null;
};

/** JSON-serializable — callers may persist it across sessions. */
export type CallerHandoff = {
  current: string;
  mode: "run-until-yield" | "single-step";
  maxHops: number;
  yieldReason: YieldReason | null;
  focus: string[];
  signals: string[];
  graphPath: string;
  completedEdges: string[];
  seenRouteFingerprints: string[];
  taskBudgetCount: number | null;
  auditCounts: Record<string, number>;
  delegateCounts: Record<string, number>;
  outcomes: EffectOutcome[];
  pending: PendingEdge | null;
  hops: number;
};

export type CallerRunResult = {
  routes: GraphRoute[];
  checkpoints: GraphRoute[];
  yieldReason: YieldReason | null;
  current: string;
  hops: number;
  outcomes: EffectOutcome[];
  completedEdges: string[];
  /** "route:<id>", "audit:<id>", "delegate:<id>", "evidence:<id>", "project". */
  events: string[];
  handoff: CallerHandoff;
};

/**
 * Drive the caller loop: spawn the route_graph CLI once per hop (a fresh
 * projection per process), run the declared audits then the delegate, record
 * canonical evidence, enforce the commit gate, and re-enter at next until the
 * graph yields. All oracle `runScenario` semantics are preserved; effect work
 * is delegated to the injected dispatcher.
 */
export function runCaller(options: CallerRunnerOptions): CallerRunResult {
  const repo = options.repo;
  const proofPath = options.proofPath ?? DEFAULT_PROOF_PATH;
  const graphPath = options.graphPath ?? options.resume?.graphPath ?? resolveGraphPath(undefined, repo);
  const definition = loadGraphDefinition(graphPath);
  const mode = options.resume?.mode ?? options.mode ?? "run-until-yield";
  const topologyBaseHops = 10;
  let taskBudgetCount = options.resume
    ? options.resume.taskBudgetCount
    : options.maxHops === undefined ? 0 : null;
  let taskBudgetFrozen = options.resume !== undefined || options.maxHops !== undefined || options.taskBudget === false;
  let maxHops = options.resume?.maxHops
    ?? options.maxHops
    ?? topologyBaseHops;
  const focus = options.focus ?? options.resume?.focus ?? [];
  const signals = new Set(options.signals ?? options.resume?.signals ?? []);
  let current = options.resume?.current ?? options.current ?? definition.entry;
  let hops = options.resume?.hops ?? 0;
  const routes: GraphRoute[] = [];
  const checkpoints: GraphRoute[] = [];
  const completedEdges = [...(options.resume?.completedEdges ?? [])];
  const seenRouteFingerprints = new Set(options.resume?.seenRouteFingerprints ?? []);
  const auditCounts = { ...(options.resume?.auditCounts ?? {}) };
  const delegateCounts = { ...(options.resume?.delegateCounts ?? {}) };
  const outcomes = [...(options.resume?.outcomes ?? [])];
  const events: string[] = [];
  let pending: PendingEdge | null = options.resume?.pending ? {
    route: options.resume.pending.route,
    outcomes: [...options.resume.pending.outcomes],
    completedAudits: [...options.resume.pending.completedAudits],
    delegateComplete: options.resume.pending.delegateComplete,
    evidenceRecorded: options.resume.pending.evidenceRecorded,
    commitBaseline: options.resume.pending.commitBaseline ?? null,
  } : null;
  const trace = options.trace;
  const executionMode = options.executionMode ?? "unknown";

  const emitTrace = (input: TraceEventInput): void => {
    if (!trace) return;
    try {
      appendTraceEvent(trace.file, input);
    } catch (error: unknown) {
      // Diagnostics never fail a run.
      console.error(`run trace append failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const routeOnce = (): GraphRoute => {
    const args = [
      ...options.router.prefixArgs,
      "--graph", graphPath,
      "--cwd", repo,
      "--current", current,
      ...focus.flatMap((entry) => ["--focus", entry]),
      ...[...signals].flatMap((signal) => ["--signal", signal]),
      "--task-dir", "docs/tasks",
      "--json",
      ...(trace ? ["--trace-file", trace.file, "--run-id", trace.runId] : []),
    ];
    const result = spawnSync(options.router.executable, args, { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`route_graph invocation failed: ${result.stderr || result.error?.message || result.stdout}`);
    }
    try {
      return JSON.parse(result.stdout) as GraphRoute;
    } catch {
      throw new Error(`route_graph invocation failed: ${result.stderr || result.stdout}`);
    }
  };

  const resolveEffectInputs = (route: GraphRoute, effect: CallerEffect): CanonicalReference[] => {
    const paths = options.resolveInputs(route, effect);
    return [...new Set(paths)].sort().map((relativePath) => canonicalReference(repo, relativePath));
  };

  /**
   * Dispatch one effect: emit effect-dispatched before validation, then
   * assertEffectOutcome is the sole input-binding enforcer and runs before any
   * persist. Accepted outcomes emit effect-outcome; rejected ones leave only
   * the dispatch event (no outcome event, no persisted outcome).
   */
  const dispatchEffect = (
    route: GraphRoute,
    stage: "audit" | "delegate",
    effect: CallerEffect,
  ): { outcome: EffectOutcome } | { rejection: OutcomeRejection } => {
    const expectedInputs = resolveEffectInputs(route, effect);
    emitTrace({
      v: 1, runId: trace?.runId ?? "", kind: "effect-dispatched",
      edgeId: route.edgeId as string, stage, effectId: effect.id,
      executionMode, focusPaths: expectedInputs.map((entry) => entry.path),
    });
    try {
      const outcome = options.dispatcher({ repo, route, effect, signals });
      assertEffectOutcome(repo, route, outcome, stage, effect, expectedInputs);
      emitTrace({
        v: 1, runId: trace?.runId ?? "", kind: "effect-outcome",
        edgeId: route.edgeId as string, stage, effectId: effect.id,
        outcome: outcome.status,
        ...(outcome.status === "yield" ? { reason: outcome.reason } : {}),
        evidencePaths: outcome.evidence.map((entry) => entry.path),
      });
      return { outcome };
    } catch (error: unknown) {
      if (error instanceof OutcomeRejection) return { rejection: error };
      throw error;
    }
  };

  const savePending = (
    route: GraphRoute,
    edgeOutcomes: EffectOutcome[],
    evidenceRecorded: boolean,
    commitBaseline: CommitBaseline | null = null,
  ): void => {
    const completedAudits = edgeOutcomes
      .filter((outcome): outcome is CompletedEffectOutcome => outcome.status === "completed" && outcome.stage === "audit")
      .map((outcome) => outcome.effect.id)
      .sort();
    const delegateComplete = edgeOutcomes.some((outcome) => (
      outcome.status === "completed" && outcome.stage === "delegate" && outcome.effect.id === route.delegate
    ));
    pending = {
      route,
      outcomes: [...edgeOutcomes],
      completedAudits,
      delegateComplete,
      evidenceRecorded,
      commitBaseline,
    };
  };

  let yieldReason: YieldReason | null = null;
  let firstRoute = true;
  hopLoop: while (yieldReason === null) {
    if (!firstRoute) events.push("project");
    firstRoute = false;
    const route = routeOnce();
    routes.push(route);
    events.push(`route:${route.edgeId ?? route.status}`);

    if (!taskBudgetFrozen && route.delegate === "implementation-flow") {
      if (!route.taskGraph || route.taskGraph.issues.length !== 0) {
        throw new Error("implementation-flow route requires a selected Task Graph without issues");
      }
      taskBudgetCount = route.taskGraph.nodes
        .filter((task) => ["todo", "in-progress", "blocked"].includes(task.status))
        .length;
      maxHops = topologyBaseHops + Math.max(0, taskBudgetCount - 1);
      taskBudgetFrozen = true;
    }

    if (route.status === "terminal") {
      yieldReason = "terminal";
      break;
    }
    if (route.status === "blocked") {
      yieldReason = route.blockers.includes("focus-required") || route.blockers.includes("focus-invalid")
        ? "input-required"
        : "unrecoverable-blocker";
      break;
    }
    if (hops >= maxHops) {
      yieldReason = "budget-exhausted";
      break;
    }

    const routeFingerprint = JSON.stringify(route);
    if (seenRouteFingerprints.has(routeFingerprint)) {
      yieldReason = "budget-exhausted";
      break;
    }

    const resumingPending = pending?.route.edgeId === route.edgeId && pending.route.current === route.current
      ? pending
      : null;
    if (resumingPending) {
      const invalidReceipt = resumingPending.outcomes
        .filter((outcome): outcome is CompletedEffectOutcome => outcome.status === "completed")
        .some((outcome) => !isReusableCompletedOutcome(repo, route, outcome, proofPath));
      const unverifiedEvidence = resumingPending.evidenceRecorded && !hasEvidence(repo, proofPath, route.edgeId as string);
      if (invalidReceipt || unverifiedEvidence) {
        yieldReason = "authority-required";
        break;
      }
    }

    const commitBaseline = resumingPending?.commitBaseline
      ?? (route.commitGate && !signals.has("commit-waived") ? captureBaseline(repo) : null);

    const edgeOutcomes = [...(resumingPending?.outcomes ?? [])];
    const completedAudits = new Set(edgeOutcomes
      .filter((outcome): outcome is CompletedEffectOutcome => outcome.status === "completed" && outcome.stage === "audit")
      .map((outcome) => outcome.effect.id));
    for (const audit of route.requiredAudits) {
      if (completedAudits.has(audit)) continue;
      events.push(`audit:${audit}`);
      const effect: CallerEffect = { kind: "audit", id: audit };
      const dispatched = dispatchEffect(route, "audit", effect);
      if ("rejection" in dispatched) {
        yieldReason = "authority-required";
        savePending(route, edgeOutcomes, false, commitBaseline);
        break hopLoop;
      }
      const outcome = dispatched.outcome;
      edgeOutcomes.push(outcome);
      outcomes.push(outcome);
      persistOutcome(repo, proofPath, outcome);
      const evaluation = evaluateEffectOutcome(outcome);
      if (evaluation === "retry") {
        // A retry promises changed evidence; an identical retry outcome on an
        // identical re-route can never progress, so the run stops instead of
        // looping forever (the oracle bounded this with its finite step list).
        const repeatedRetry = edgeOutcomes.slice(0, -1)
          .some((prior) => JSON.stringify(prior) === JSON.stringify(outcome));
        savePending(route, edgeOutcomes, false, commitBaseline);
        if (repeatedRetry) {
          yieldReason = "budget-exhausted";
          break hopLoop;
        }
        continue hopLoop;
      }
      if (evaluation) {
        yieldReason = evaluation;
        savePending(route, edgeOutcomes, false, commitBaseline);
        break hopLoop;
      }
      completedAudits.add(audit);
      auditCounts[audit] = (auditCounts[audit] ?? 0) + 1;
    }

    let delegateComplete = edgeOutcomes.some((outcome) => (
      outcome.status === "completed" && outcome.stage === "delegate" && outcome.effect.id === route.delegate
    ));
    if (route.delegate && !delegateComplete) {
      events.push(`delegate:${route.delegate}`);
      const effect: CallerEffect = { kind: "delegate", id: route.delegate };
      const dispatched = dispatchEffect(route, "delegate", effect);
      if ("rejection" in dispatched) {
        yieldReason = "authority-required";
        savePending(route, edgeOutcomes, false, commitBaseline);
        break hopLoop;
      }
      const outcome = dispatched.outcome;
      edgeOutcomes.push(outcome);
      outcomes.push(outcome);
      persistOutcome(repo, proofPath, outcome);
      const evaluation = evaluateEffectOutcome(outcome);
      if (evaluation === "retry") {
        const repeatedRetry = edgeOutcomes.slice(0, -1)
          .some((prior) => JSON.stringify(prior) === JSON.stringify(outcome));
        savePending(route, edgeOutcomes, false, commitBaseline);
        if (repeatedRetry) {
          yieldReason = "budget-exhausted";
          break hopLoop;
        }
        continue hopLoop;
      }
      if (evaluation) {
        yieldReason = evaluation;
        savePending(route, edgeOutcomes, false, commitBaseline);
        break hopLoop;
      }
      delegateCounts[route.delegate] = (delegateCounts[route.delegate] ?? 0) + 1;
      delegateComplete = true;
    }

    let evidenceRecorded = resumingPending?.evidenceRecorded === true && hasEvidence(repo, proofPath, route.edgeId as string);
    if (!evidenceRecorded) {
      const evidenceBefore = evidenceReceipts(repo, proofPath).filter((receipt) => receipt.edgeId === route.edgeId).length;
      if (options.applyEvidence) {
        options.applyEvidence(repo, signals, route.edgeId as string);
      } else {
        persistEvidence(repo, proofPath, route.edgeId as string);
      }
      evidenceRecorded = hasEvidence(repo, proofPath, route.edgeId as string)
        && evidenceReceipts(repo, proofPath).filter((receipt) => receipt.edgeId === route.edgeId).length > evidenceBefore;
      if (!evidenceRecorded) {
        yieldReason = "authority-required";
        savePending(route, edgeOutcomes, false, commitBaseline);
        break;
      }
    }
    events.push(`evidence:${route.edgeId}`);
    if (commitBaseline && !signals.has("commit-waived")) {
      const after = captureBaseline(repo);
      if (!commitGatePasses(commitBaseline, after)) {
        yieldReason = "commit-required";
        savePending(route, edgeOutcomes, true, commitBaseline);
        break;
      }
    }
    pending = null;
    checkpoints.push(route);
    completedEdges.push(route.edgeId as string);
    seenRouteFingerprints.add(routeFingerprint);
    hops += 1;
    current = route.next;

    if (mode === "single-step") {
      yieldReason = "single-step-complete";
      break;
    }
  }

  const handoff: CallerHandoff = {
    current,
    mode,
    maxHops,
    yieldReason,
    focus: [...focus],
    signals: [...signals].sort(),
    graphPath,
    completedEdges,
    seenRouteFingerprints: [...seenRouteFingerprints],
    taskBudgetCount,
    auditCounts,
    delegateCounts,
    outcomes,
    pending,
    hops,
  };
  if (yieldReason !== null) {
    emitTrace({
      v: 1, runId: trace?.runId ?? "", kind: "run-yield",
      reason: yieldReason, hops, completedEdges: [...completedEdges],
    });
  }
  return {
    routes,
    checkpoints,
    yieldReason,
    current,
    hops,
    outcomes,
    completedEdges,
    events,
    handoff: JSON.parse(JSON.stringify(handoff)) as CallerHandoff,
  };
}
