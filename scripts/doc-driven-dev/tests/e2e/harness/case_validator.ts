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
import type { GraphDefinition } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";
import type {
  EffectDispatchedEvent,
  EffectOutcomeEvent,
  RouteSelectedEvent,
  RunYieldEvent,
  TraceEvent,
} from "../../../src/skills/doc-driven-dev-graph/scripts/lib/run_trace";

const DEFAULT_PROOF_PATH = "docs/tasks/0001-task.md";

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
  events?: { kind: string; edgeId?: string; stage?: "audit" | "delegate"; count?: number; min?: number }[];
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
};

export type CaseRun = {
  result: CallerRunResult;
  traceEvents: TraceEvent[];
  repo: string;
  definition: GraphDefinition;
  /** Canonical doc carrying checkpointEvidence; default docs/tasks/0001-task.md. */
  proofPath?: string;
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
      + (spec.stage !== undefined ? ` stage "${spec.stage}"` : "");
    const count = events.filter((event) => {
      if (event.kind !== spec.kind) return false;
      if (spec.edgeId !== undefined && (!("edgeId" in event) || event.edgeId !== spec.edgeId)) return false;
      if (spec.stage !== undefined && (!("stage" in event) || event.stage !== spec.stage)) return false;
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
  for (const event of events) {
    if (event.kind === "effect-dispatched") {
      const dispatched = event as EffectDispatchedEvent;
      const key = `${dispatched.edgeId}${dispatched.stage}${dispatched.effectId}`;
      unmatchedDispatches.set(key, (unmatchedDispatches.get(key) ?? 0) + 1);
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
    }
  }

  return failures;
}

export function validateCase(run: CaseRun, expect: CaseExpect): string[] {
  return [...validateUniversalInvariants(run), ...checkExpectations(run, expect)];
}
