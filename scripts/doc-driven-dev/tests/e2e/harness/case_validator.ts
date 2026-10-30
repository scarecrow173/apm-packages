/**
 * Independent case validator. Hard gates — every violation is a failure
 * line, no soft warnings. The validator never trusts run state for the
 * universal invariants: it re-reads the proof doc for evidence receipts,
 * re-checks git state inside the fixture repo, and validates emitted edge
 * ids against a graph definition the runner re-loaded from YAML.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import matter from "gray-matter";
import {
  evidenceReceipts,
  type CallerRunResult,
  type EvidenceReceipt,
  type YieldReason,
} from "../../../src/skills/doc-driven-dev-graph/scripts/lib/caller_runner";
import type { ContextBaseline } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/context_metrics";
import type { GraphDefinition } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";
import type {
  DispatchMethod,
  DispatchObservedEvent,
  EffectDispatchedEvent,
  EffectOutcomeEvent,
  ExecutionMode,
  RouteSelectedEvent,
  RunYieldEvent,
  TraceEvent,
} from "../../../src/skills/doc-driven-dev-graph/scripts/lib/run_trace";

const DEFAULT_PROOF_PATH = "docs/tasks/0001-task.md";
const TSX_CLI = path.resolve(__dirname, "../../../node_modules/tsx/dist/cli.mjs");
const BRIEFING_AUDIT = path.resolve(__dirname, "../../../src/skills/briefing-flow/scripts/audit_briefing.ts");

const RUN_YIELD_REASONS: readonly YieldReason[] = [
  "terminal", "single-step-complete", "budget-exhausted",
  "approval-required", "input-required", "authority-required",
  "unrecoverable-blocker", "commit-required",
];

export type CaseExpect = {
  /**
   * Final-leg run-yield reason — the LAST run-yield event in scope (for a
   * leg-scoped check, that leg's run-yield).
   */
  yield: YieldReason;
  /**
   * route-selected edgeIds of the LAST leg's trace partition in order
   * (nulls allowed as "blocked"/"terminal"). Earlier legs' routes are not
   * part of this sequence — assert them via steps[].expect instead.
   */
  edgeSequence?: (string | null)[];
  /** run-yield.completedEdges of the LAST leg's run-yield event. */
  completedEdges?: string[];
  /**
   * Trace tallies over the evaluated scope's events (the WHOLE run for the
   * case-level expect; the leg's own partition for steps[].expect). Optional
   * `edgeId`/`stage` narrow the tally to events carrying those fields —
   * e.g. "zero audit dispatches on the resumed edge" for pending reuse.
   */
  events?: {
    kind: string;
    edgeId?: string;
    stage?: "audit" | "delegate";
    /** Effect dispatch or outcome identity. */
    effectId?: string;
    /** effect-outcome only. */
    outcome?: "completed" | "retry" | "yield";
    /** effect-outcome / run-yield reason. */
    reason?: string;
    /** effect-dispatched only: exact executionMode ("tool"/"same-context"/…). */
    executionMode?: ExecutionMode;
    /** effect-dispatched only: modeReason CONTAINS this substring (token search). */
    modeReason?: string;
    /** dispatch-observed only: exact target id (effectId = self-observation). */
    target?: string;
    /** dispatch-observed only: exact requested mode. */
    requested?: ExecutionMode;
    /** dispatch-observed only: exact actual mode. */
    actual?: ExecutionMode;
    /** dispatch-observed only: exact dispatch method. */
    method?: DispatchMethod;
    count?: number;
    min?: number;
  }[];
  /**
   * LAST route-selected in the evaluated scope must carry each blocker:
   * string entries require verbatim membership (sanitized token form, e.g.
   * "focus-required"), RegExp entries match any one blocker (e.g.
   * /^broken-relation:sha256:[0-9a-f]{12}$/).
   */
  blockersContain?: (string | RegExp)[];
  /**
   * Selected-task assertions: each entry's {id,status} must appear in the
   * `tasks` projection of the LAST route-selected in scope carrying the named
   * edgeId. Edge-scoped because a completed run may legitimately mutate the
   * task status after the asserted routing decision.
   */
  tasksContain?: { edgeId: string; id: string; status: string }[];
  /** End-of-run repo state — re-read from disk at validation time. */
  finalFiles?: Record<string, { frontmatter?: Record<string, unknown>; bodyIncludes?: string[] }>;
  /** Pair audit via the real CLI; step expectations run immediately after that leg. */
  briefingAudit?: { spec: string; adr: string; consistent: boolean };
  /** Counts of persisted checkpoint receipts; step expectations run after that leg. */
  checkpointReceipts?: { edgeId: string; count: number }[];
};

export type CaseRun = {
  result: CallerRunResult;
  traceEvents: TraceEvent[];
  repo: string;
  definition: GraphDefinition;
  /** Canonical doc carrying checkpointEvidence; default docs/tasks/0001-task.md. */
  proofPath?: string;
  /**
   * Issue #124 baseline: runtime artifact-scan reads vs the document bodies
   * actually supplied to dispatched effects (unique authoritativeInputs
   * paths). Optional — only runCase computes it; ad-hoc CaseRun literals in
   * unit tests may omit it.
   */
  baseline?: ContextBaseline;
};

function gitStatus(repo: string): string[] {
  const result = spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git status failed: ${result.stderr}`);
  return result.stdout.split("\n").filter((line) => line.length > 0).sort();
}

function commitCount(repo: string): number {
  const result = spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) return 0;
  return Number.parseInt(result.stdout.trim(), 10) || 0;
}

function readReceipts(repo: string, proofPath: string): EvidenceReceipt[] {
  try {
    return evidenceReceipts(repo, proofPath);
  } catch {
    return [];
  }
}

/**
 * Split a run's events into per-leg slices: every leg ends with exactly one
 * run-yield event, so partitions close at each run-yield.
 */
export function partitionByLegs(events: TraceEvent[]): TraceEvent[][] {
  const legs: TraceEvent[][] = [[]];
  for (const event of events) {
    legs[legs.length - 1].push(event);
    if (event.kind === "run-yield") legs.push([]);
  }
  if (legs[legs.length - 1].length === 0) legs.pop();
  return legs;
}

/**
 * Expectation-only checks (yield, sequences, tallies, final files) against the
 * events visible in `run.traceEvents`. Field scoping is explicit:
 * yield/edgeSequence/completedEdges evaluate the LAST leg's partition in the
 * given scope (final-leg expectations); events tallies and finalFiles span
 * the whole run/repo. runCase uses this for per-leg expects: universal
 * invariants run once over the whole case; each leg's expectations run
 * against that leg's own event slice.
 */
export function checkExpectations(run: CaseRun, expect: Partial<CaseExpect>): string[] {
  const failures: string[] = [];
  const events = run.traceEvents;
  const lastLegRoutes = (partitionByLegs(events).at(-1) ?? [])
    .filter((event): event is RouteSelectedEvent => event.kind === "route-selected");
  const yieldEvents = events.filter((event): event is RunYieldEvent => event.kind === "run-yield");

  if (expect.yield !== undefined) {
    const last = yieldEvents.at(-1);
    if (!last) {
      failures.push(`expected run-yield "${expect.yield}" but no run-yield event was emitted`);
    } else if (last.reason !== expect.yield) {
      failures.push(`expected final run-yield reason "${expect.yield}", got "${last.reason}"`);
    }
  }
  if (expect.edgeSequence !== undefined) {
    const actual = lastLegRoutes.map((event) => event.edgeId);
    if (!isDeepStrictEqual(actual, expect.edgeSequence)) {
      failures.push(`edgeSequence mismatch: expected ${JSON.stringify(expect.edgeSequence)}, got ${JSON.stringify(actual)}`);
    }
  }
  if (expect.completedEdges !== undefined) {
    const actual = yieldEvents.at(-1)?.completedEdges ?? [];
    if (!isDeepStrictEqual(actual, expect.completedEdges)) {
      failures.push(`completedEdges mismatch: expected ${JSON.stringify(expect.completedEdges)}, got ${JSON.stringify(actual)}`);
    }
  }
  for (const spec of expect.events ?? []) {
    const label = `event kind "${spec.kind}"`
      + (spec.edgeId !== undefined ? ` edge "${spec.edgeId}"` : "")
      + (spec.stage !== undefined ? ` stage "${spec.stage}"` : "")
      + (spec.effectId !== undefined ? ` effect "${spec.effectId}"` : "")
      + (spec.outcome !== undefined ? ` outcome "${spec.outcome}"` : "")
      + (spec.reason !== undefined ? ` reason "${spec.reason}"` : "")
      + (spec.executionMode !== undefined ? ` mode "${spec.executionMode}"` : "")
      + (spec.modeReason !== undefined ? ` modeReason~"${spec.modeReason}"` : "")
      + (spec.target !== undefined ? ` target "${spec.target}"` : "")
      + (spec.requested !== undefined ? ` requested "${spec.requested}"` : "")
      + (spec.actual !== undefined ? ` actual "${spec.actual}"` : "")
      + (spec.method !== undefined ? ` method "${spec.method}"` : "");
    const count = events.filter((event) => {
      if (event.kind !== spec.kind) return false;
      if (spec.edgeId !== undefined && (!("edgeId" in event) || event.edgeId !== spec.edgeId)) return false;
      if (spec.stage !== undefined && (!("stage" in event) || event.stage !== spec.stage)) return false;
      if (spec.effectId !== undefined && (!("effectId" in event) || event.effectId !== spec.effectId)) return false;
      if (spec.outcome !== undefined && (!("outcome" in event) || event.outcome !== spec.outcome)) return false;
      if (spec.reason !== undefined && (!("reason" in event) || event.reason !== spec.reason)) return false;
      if (spec.executionMode !== undefined
          && (!("executionMode" in event) || event.executionMode !== spec.executionMode)) return false;
      if (spec.modeReason !== undefined
          && (!("modeReason" in event) || !event.modeReason?.includes(spec.modeReason))) return false;
      if (spec.target !== undefined && (!("target" in event) || event.target !== spec.target)) return false;
      if (spec.requested !== undefined && (!("requested" in event) || event.requested !== spec.requested)) return false;
      if (spec.actual !== undefined && (!("actual" in event) || event.actual !== spec.actual)) return false;
      if (spec.method !== undefined && (!("method" in event) || event.method !== spec.method)) return false;
      return true;
    }).length;
    if (spec.count !== undefined && count !== spec.count) {
      failures.push(`${label}: expected count ${spec.count}, got ${count}`);
    }
    if (spec.min !== undefined && count < spec.min) {
      failures.push(`${label}: expected at least ${spec.min}, got ${count}`);
    }
  }
  for (const needle of expect.blockersContain ?? []) {
    const lastRoute = events.filter((event): event is RouteSelectedEvent => event.kind === "route-selected").at(-1);
    if (!lastRoute) {
      failures.push(`blockersContain: no route-selected event in scope (expected ${String(needle)})`);
      continue;
    }
    const found = typeof needle === "string"
      ? lastRoute.blockers.includes(needle)
      : lastRoute.blockers.some((blocker) => needle.test(blocker));
    if (!found) {
      failures.push(
        `blockersContain: last route-selected blockers ${JSON.stringify(lastRoute.blockers)}`
        + ` do not contain ${String(needle)}`,
      );
    }
  }
  for (const entry of expect.tasksContain ?? []) {
    const target = events.filter((event): event is RouteSelectedEvent => (
      event.kind === "route-selected" && event.edgeId === entry.edgeId
    )).at(-1);
    if (!target) {
      failures.push(`tasksContain: no route-selected for edge "${entry.edgeId}" in scope`);
      continue;
    }
    if (!target.tasks.some((task) => task.id === entry.id && task.status === entry.status)) {
      failures.push(
        `tasksContain: route-selected "${entry.edgeId}" tasks ${JSON.stringify(target.tasks)}`
        + ` do not contain ${JSON.stringify({ id: entry.id, status: entry.status })}`,
      );
    }
  }
  for (const [rel, spec] of Object.entries(expect.finalFiles ?? {})) {
    const file = path.join(run.repo, rel);
    if (!fs.existsSync(file)) {
      failures.push(`finalFiles ${rel}: file missing`);
      continue;
    }
    const parsed = matter(fs.readFileSync(file, "utf8"));
    for (const [key, value] of Object.entries(spec.frontmatter ?? {})) {
      if (!isDeepStrictEqual(parsed.data[key], value)) {
        failures.push(`finalFiles ${rel}: frontmatter.${key} expected ${JSON.stringify(value)}, got ${JSON.stringify(parsed.data[key])}`);
      }
    }
    for (const needle of spec.bodyIncludes ?? []) {
      if (!parsed.content.includes(needle)) {
        failures.push(`finalFiles ${rel}: body missing substring ${JSON.stringify(needle)}`);
      }
    }
  }
  if (expect.briefingAudit) {
    const { spec, adr, consistent } = expect.briefingAudit;
    const result = spawnSync(process.execPath, [TSX_CLI, BRIEFING_AUDIT, "--cwd", run.repo, "--spec", spec, "--adr", adr, "--json"], { encoding: "utf8" });
    try {
      const report: unknown = JSON.parse(result.stdout);
      if (!report || typeof report !== "object" || !("consistent" in report)
          || typeof report.consistent !== "boolean") throw new Error("missing boolean consistent");
      if (report.consistent !== consistent || result.status !== (consistent ? 0 : 1)) {
        failures.push(`briefingAudit: expected consistent=${consistent}, exit=${consistent ? 0 : 1}; got consistent=${report.consistent}, exit=${result.status}`);
      }
    } catch (error) {
      failures.push(`briefingAudit: invalid CLI result (exit=${result.status}, stderr=${result.stderr}): ${String(error)}`);
    }
  }
  if (expect.checkpointReceipts) {
    try {
      const receipts = evidenceReceipts(run.repo, run.proofPath ?? DEFAULT_PROOF_PATH);
      for (const { edgeId, count } of expect.checkpointReceipts) {
        const actual = receipts.filter((receipt) => receipt.edgeId === edgeId).length;
        if (actual !== count) failures.push(`checkpointReceipts ${edgeId}: expected ${count}, got ${actual}`);
      }
    } catch (error) {
      failures.push(`checkpointReceipts: failed to read proof: ${String(error)}`);
    }
  }
  return failures;
}

/** Universal invariants — hard gates over the run's trace + fresh file/git state. */
function validateUniversalInvariants(run: CaseRun): string[] {
  const failures: string[] = [];
  const events = run.traceEvents;
  const proofPath = run.proofPath ?? DEFAULT_PROOF_PATH;
  const routeEvents = events.filter((event): event is RouteSelectedEvent => event.kind === "route-selected");
  const yieldEvents = events.filter((event): event is RunYieldEvent => event.kind === "run-yield");

  // 1. Every route-selected.edgeId is null or an id in the (re-loaded) definition.
  const declaredEdges = new Set(run.definition.edges.map((edge) => edge.id));
  routeEvents.forEach((event, index) => {
    if (event.edgeId !== null && !declaredEdges.has(event.edgeId)) {
      failures.push(`route-selected[${index}] edge "${event.edgeId}" is not declared in the graph definition`);
    }
  });

  // 2. Continuity within each leg: route-selected[n+1].current ===
  //    route-selected[n].next when the edge completed — and ===
  //    route-selected[n].current when it did not: a `retry` outcome re-projects
  //    from the same node (the runner only assigns `current = route.next` on
  //    edge completion). Legs partition at run-yield events — a resume leg
  //    legitimately re-routes the pending edge from its `from` node, so
  //    continuity must not span the boundary.
  let previous: RouteSelectedEvent | null = null;
  let retryBetween = false;
  for (const event of events) {
    if (event.kind === "run-yield") {
      previous = null;
      retryBetween = false;
      continue;
    }
    if (event.kind === "effect-outcome" && event.outcome === "retry") {
      retryBetween = true;
      continue;
    }
    if (event.kind !== "route-selected") continue;
    if (previous) {
      const expected = retryBetween ? previous.current : previous.next;
      if (event.current !== expected) {
        failures.push(
          `route continuity broken: route "${previous.edgeId ?? previous.status}"` +
          ` ${retryBetween ? "re-routed from" : "next="}${expected}` +
          ` but next route-selected current=${event.current}`,
        );
      }
    }
    previous = event;
    retryBetween = false;
  }

  // 3. Every edgeId in run-yield.completedEdges has a checkpointEvidence
  //    receipt in the proof doc (re-read from disk — not run state).
  const completedEdgeIds = [...new Set(yieldEvents.flatMap((event) => event.completedEdges))];
  const receiptEdges = new Set(readReceipts(run.repo, proofPath).map((receipt) => receipt.edgeId));
  for (const edgeId of completedEdgeIds) {
    if (!receiptEdges.has(edgeId)) {
      failures.push(`completed edge "${edgeId}" has no checkpointEvidence receipt in ${proofPath}`);
    }
  }

  // 4. Commit gate: a completed commitGate edge must show evidence work plus
  //    proof its output was committed — a prior "commit-required" yield (the
  //    gate fired on a failing leg), the declared "commit-waived" signal, a
  //    clean final tree, or a post-baseline commit in the fixture's history.
  const commitGateByEdge = new Map<string, boolean>();
  for (const event of routeEvents) {
    if (event.edgeId !== null) commitGateByEdge.set(event.edgeId, event.commitGate);
  }
  const sawCommitRequired = yieldEvents.some((event) => event.reason === "commit-required");
  const commitWaived = run.result.handoff.signals.includes("commit-waived");
  const cleanTree = gitStatus(run.repo).length === 0;
  const hasPostBaselineCommit = commitCount(run.repo) > 1;
  for (const edgeId of completedEdgeIds) {
    if (commitGateByEdge.get(edgeId) !== true) continue;
    if (!run.result.events.includes(`evidence:${edgeId}`)) {
      failures.push(`commitGate edge "${edgeId}" completed without an evidence:${edgeId} runner event`);
    }
    if (!(sawCommitRequired || commitWaived || cleanTree || hasPostBaselineCommit)) {
      failures.push(
        `commitGate edge "${edgeId}" completed with uncommitted work` +
        " (no commit-required yield, no commit-waived signal, dirty tree, no post-baseline commit)",
      );
    }
  }

  // 5. run-yield reasons are valid; completedEdges ⊆ emitted route edgeIds.
  const emittedEdgeIds = new Set(
    routeEvents.map((event) => event.edgeId).filter((edgeId): edgeId is string => edgeId !== null),
  );
  yieldEvents.forEach((event, index) => {
    if (!RUN_YIELD_REASONS.includes(event.reason)) {
      failures.push(`run-yield[${index}] has invalid reason "${event.reason}"`);
    }
    for (const edgeId of event.completedEdges) {
      if (!emittedEdgeIds.has(edgeId)) {
        failures.push(`run-yield[${index}] completedEdges lists "${edgeId}", never emitted as route-selected edgeId`);
      }
    }
  });

  // 6. No orphan outcomes: every effect-outcome matches an earlier
  //    effect-dispatched with the same edgeId+stage+effectId.
  const unmatchedDispatches = new Map<string, number>();
  // For invariant 7: every effect-dispatched in emission order, plus whether
  // its dispatch produced an outcome (accepted) or was rejected before it.
  const dispatchedEvents: { key: string; event: EffectDispatchedEvent; seq: number; accepted: boolean }[] = [];
  const latestDispatch = new Map<string, { accepted: boolean }>();
  for (const event of events) {
    if (event.kind === "effect-dispatched") {
      const dispatched = event as EffectDispatchedEvent;
      const key = `${dispatched.edgeId}${dispatched.stage}${dispatched.effectId}`;
      unmatchedDispatches.set(key, (unmatchedDispatches.get(key) ?? 0) + 1);
      const entry = { key, event: dispatched, seq: event.seq, accepted: false };
      dispatchedEvents.push(entry);
      latestDispatch.set(key, entry);
    } else if (event.kind === "effect-outcome") {
      const outcome = event as EffectOutcomeEvent;
      const key = `${outcome.edgeId}${outcome.stage}${outcome.effectId}`;
      const pending = unmatchedDispatches.get(key) ?? 0;
      if (pending === 0) {
        failures.push(
          `effect-outcome ${outcome.effectId} (${outcome.stage}) on ${outcome.edgeId}` +
          " has no earlier matching effect-dispatched",
        );
      } else {
        unmatchedDispatches.set(key, pending - 1);
      }
      const producer = latestDispatch.get(key);
      if (producer) producer.accepted = true;
    }
  }

  // 7. Dispatch attribution: every dispatch-observed records what the adapter
  //    actually did for a prior effect-dispatched (same edgeId+stage+effectId).
  //    Each self-observation (target === effectId) of an ACCEPTED dispatch —
  //    one that produced an outcome — is checked against the dispatch that
  //    produced it (the nearest prior same-key dispatch event): `requested`
  //    must equal its executionMode, and an executed dispatch
  //    (method !== "not-executed") must show `actual` equal to it. A rejected
  //    dispatch may leave a mismatched report in the trace — that report is
  //    the forensic record the rejection enforced, not a consistency failure.
  //    Observations of effects that were never dispatched always fail.
  for (const event of events) {
    if (event.kind !== "dispatch-observed") continue;
    const observed = event as DispatchObservedEvent;
    const key = `${observed.edgeId}${observed.stage}${observed.effectId}`;
    const producer = [...dispatchedEvents]
      .reverse()
      .find((entry) => entry.key === key && entry.seq < event.seq);
    if (!producer) {
      failures.push(
        `dispatch-observed "${observed.target}" on ${observed.edgeId} has no prior effect-dispatched`,
      );
      continue;
    }
    if (!producer.accepted || observed.target !== observed.effectId) continue; // rejected report or internal record
    if (observed.requested !== producer.event.executionMode) {
      failures.push(
        `dispatch-observed self-report on ${observed.edgeId} requested "${observed.requested}"`
        + ` but the dispatch recorded "${producer.event.executionMode}"`,
      );
    }
    if (producer.event.executionMode !== "unknown"
        && observed.method !== "not-executed"
        && observed.actual !== producer.event.executionMode) {
      failures.push(
        `dispatch-observed self-report on ${observed.edgeId} executed as "${observed.actual}"`
        + ` but the dispatch recorded "${producer.event.executionMode}" — a silent mode switch`,
      );
    }
  }

  return failures;
}

export function validateCase(run: CaseRun, expect: CaseExpect): string[] {
  return [...validateUniversalInvariants(run), ...checkExpectations(run, expect)];
}
