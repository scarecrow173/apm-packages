/**
 * Independent case validator. Hard gates — every violation is a failure
 * line, no soft warnings. The validator never trusts run state for the
 * universal invariants: it re-reads the run's Execution Store checkpoints,
 * re-checks git state inside the fixture repo, and validates emitted edge
 * ids against a graph definition the runner re-loaded from YAML.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import matter from "gray-matter";
import type {
  CallerRunResult,
  YieldReason,
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
import { loadRun } from "../../../src/skills/lib/execution_store";
import type { CheckpointRecord } from "../../../src/skills/lib/execution_store";
import { evaluateSchemaPreflight } from "../../../src/skills/lib/schema_preflight";
import { validateEvidenceRecord } from "../../../src/skills/lib/evidence_store/types";
import { E2E_RUN_ID, snapshotTree } from "./fixture_manager";
import { onlyRunId, readEvidenceRecords } from "./evidence_ops";
import type { CliOpResult } from "./cli_ops";
import { resolveOpArg } from "./cli_ops";
const TSX_CLI = path.resolve(__dirname, "../../../node_modules/tsx/dist/cli.mjs");
const BRIEFING_AUDIT = path.resolve(__dirname, "../../../src/skills/briefing-flow/scripts/audit_briefing.ts");
const EVIDENCE_STORE = path.resolve(__dirname, "../../../src/skills/doc-driven-dev-graph/scripts/evidence_store.ts");

const RUN_YIELD_REASONS: readonly YieldReason[] = [
  "terminal", "single-step-complete", "budget-exhausted",
  "approval-required", "input-required", "authority-required",
  "unrecoverable-blocker", "commit-required",
];

export type CaseExpect = {
  /**
   * Final-leg run-yield reason — the LAST run-yield event in scope (for a
   * leg-scoped check, that leg's run-yield). Optional: pure-ops cases
   * (`steps: []`) and expected-throw cases emit no run-yield event.
   */
  yield?: YieldReason;
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
   * edgeId — `null` targets a BLOCKED route (edgeId null), e.g. a wont-do
   * task wedging `task-graph`. Edge-scoped because a completed run may
   * legitimately mutate the task status after the asserted routing decision.
   */
  tasksContain?: { edgeId: string | null; id: string; status: string }[];
  /** End-of-run repo state — re-read from disk at validation time. */
  finalFiles?: Record<string, { frontmatter?: Record<string, unknown>; bodyIncludes?: string[] }>;
  /**
   * End-of-run Execution Store assertions (Issue #237): task-record fields
   * and the digest-bound approval are re-loaded from the run — the same
   * authority the graph projects from.
   */
  run?: {
    runId?: string;
    tasks?: Record<string, { status?: string; title?: string; version?: number }>;
    planApproved?: boolean;
    planDigest?: string;
  };
  /** Pair audit via the real CLI; step expectations run immediately after that leg. */
  briefingAudit?: { spec: string; adr: string; consistent: boolean };
  /** Counts of persisted edge checkpoints in the run's Execution Store. */
  checkpointReceipts?: { edgeId: string; count: number }[];
  /**
   * A refusal the caller raised — matched against the error message
   * captured when runCaller threw (stale router payloads, unreadable
   * state). Cases asserting refusal declare it here; an unexpected throw
   * is a failure of its own.
   */
  throwMatch?: RegExp;
  /**
   * Assertions against recorded op results (`ops`/`postOps`). `index`
   * selects the op result array position; `saveAs` selects by name
   * (exactly one must be given). `exit` pins the process exit code,
   * `jsonMatch` is a recursive subset match on parsed stdout JSON,
   * `stdoutMatch`/`stderrMatch` are substring or RegExp checks.
   */
  cli?: {
    index?: number;
    saveAs?: string;
    exit?: number;
    jsonMatch?: Record<string, unknown>;
    stdoutMatch?: string | RegExp;
    stderrMatch?: string | RegExp;
  }[];
  /** Schema-preflight status at end of run — fresh evaluation, not the op's report. */
  preflight?: string;
  /**
   * Verification Summary assertions through the real `evidence_store
   * summary --json` CLI at validation time: verdict plus reason tokens
   * collected across EVERY summary level — top-level `summary.reasons`,
   * per-check `checks[].reasons`, per-claim `claims[].reasons`, and the
   * assessment codes in `evidence[].reasons[].code` — so a case can pin
   * a classification (`required-check-undetermined:<ref>`), an exemption
   * refusal (`rejected-waiver:<ref>`), or the measured cause
   * (`claim-revision-mismatch`, `artifact-unverified`) alike. Each entry
   * is a verbatim token or a RegExp matched against any one reason.
   * Subject defaults to `commit:HEAD`; a revspec string retargets it,
   * and `args` passes extra CLI flags verbatim (`--waivers <file>`,
   * `--waiver-authority <name>`, `--not-applicable <file>`,
   * `--scope-check <ref>`, `--run-id <id>`) — `$`-placeholders resolve.
   */
  verification?: {
    verdict: string;
    reasonsContain?: (string | RegExp)[];
    subject?: string;
    args?: string[];
  };
  /** Recursive file counts under repo-relative dirs — "zero new Markdown". */
  fileCount?: Record<string, number>;
  /** Repo-relative paths that must NOT exist at end of run. */
  absentFiles?: string[];
  /** `git status --porcelain` empty (false) or non-empty (true). */
  gitDirty?: boolean;
  /**
   * Task projection exclusion: the named task id must NOT appear in the
   * tasks projection of the LAST route-selected for the edge (`null`
   * targets a blocked route) — records from another run's plan never
   * leak into the selected Task Graph.
   */
  tasksAbsent?: { edgeId: string | null; id: string }[];
  /**
   * Effect Receipt assertions re-loaded from the run's store (Issue #238):
   * the receipt↔evidence distinction's receipt half. `edgeId` scopes by
   * input.edgeId; `idempotencyKey` pins provider-receipt keys.
   */
  receiptsContain?: { edgeId?: string; stage?: string; idempotencyKey?: string; status?: string; runId?: string }[];
  /**
   * Evidence Store assertions re-read from the record files: record count
   * plus per-record fields (the evidence half of receipt-vs-evidence).
   */
  evidence?: { count?: number; records?: { outcome?: string; check?: string; claim?: string }[] };
  /**
   * The current tree snapshot must deep-equal the snapshot the named
   * `snapshot` op captured — proof a read-only or refused operation wrote
   * ZERO bytes (migrate plan on current repo, a hash-mismatched apply).
   */
  treeSnapshotEquals?: string;
};

export type CaseRun = {
  result: CallerRunResult;
  traceEvents: TraceEvent[];
  /** Recorded op (`ops`/`postOps`) results in execution order. */
  cliResults?: CliOpResult[];
  /** Error message when runCaller threw during a leg, else undefined. */
  thrown?: string;
  repo: string;
  definition: GraphDefinition;
  /**
   * Execution Store run ids the legs ran under — resumed legs share the
   * handoff's runId, fresh legs bind their own. Checkpoint validation reads
   * every listed run's store.
   */
  runIds: string[];
  /**
   * Issue #124 baseline: runtime artifact-scan reads vs the document bodies
   * actually supplied to dispatched effects (unique resolved input
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

function readCheckpoints(repo: string, runIds: readonly string[]): CheckpointRecord[] {
  const records: CheckpointRecord[] = [];
  for (const runId of new Set(runIds)) {
    try {
      records.push(...loadRun(repo, runId).checkpoints);
    } catch {
      // A leg that never wrote a checkpoint still leaves a readable run;
      // an unreadable one contributes nothing (invariant checks stay honest).
    }
  }
  return records;
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
  if (expect.run !== undefined) {
    const runId = expect.run.runId === "$run:only" ? onlyRunId(run.repo) : (expect.run.runId ?? E2E_RUN_ID);
    try {
      const snapshot = loadRun(run.repo, runId);
      for (const [taskId, spec] of Object.entries(expect.run.tasks ?? {})) {
        const record = snapshot.tasks.find((task) => task.taskId === taskId);
        if (!record) {
          failures.push(`run ${runId}: task ${taskId} missing`);
          continue;
        }
        if (spec.status !== undefined && record.status !== spec.status) {
          failures.push(`run ${runId} task ${taskId}: status expected ${spec.status}, got ${record.status}`);
        }
        if (spec.title !== undefined && record.title !== spec.title) {
          failures.push(`run ${runId} task ${taskId}: title expected ${JSON.stringify(spec.title)}, got ${JSON.stringify(record.title)}`);
        }
        if (spec.version !== undefined && record.version !== spec.version) {
          failures.push(`run ${runId} task ${taskId}: version expected ${spec.version}, got ${record.version}`);
        }
      }
      if (expect.run.planApproved !== undefined && snapshot.planApproved !== expect.run.planApproved) {
        failures.push(`run ${runId}: planApproved expected ${expect.run.planApproved}, got ${snapshot.planApproved}`);
      }
      if (expect.run.planDigest !== undefined && snapshot.plan?.digest !== expect.run.planDigest) {
        failures.push(`run ${runId}: planDigest expected ${expect.run.planDigest}, got ${snapshot.plan?.digest ?? "null"}`);
      }
    } catch (error) {
      failures.push(`run ${runId}: failed to load run — ${error instanceof Error ? error.message : String(error)}`);
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
      const checkpoints = readCheckpoints(run.repo, run.runIds);
      for (const { edgeId, count } of expect.checkpointReceipts) {
        const actual = checkpoints.filter((checkpoint) => checkpoint.edgeId === edgeId).length;
        if (actual !== count) failures.push(`checkpointReceipts ${edgeId}: expected ${count}, got ${actual}`);
      }
    } catch (error) {
      failures.push(`checkpointReceipts: failed to read the Execution Store: ${String(error)}`);
    }
  }

  if (expect.throwMatch !== undefined) {
    if (run.thrown === undefined) {
      failures.push(`throwMatch: expected a thrown error matching ${String(expect.throwMatch)}, but nothing was thrown`);
    } else if (!expect.throwMatch.test(run.thrown)) {
      failures.push(`throwMatch: thrown error ${JSON.stringify(run.thrown)} does not match ${String(expect.throwMatch)}`);
    }
  }

  for (const [cliIndex, spec] of (expect.cli ?? []).entries()) {
    const label = `cli[${spec.saveAs ?? spec.index ?? cliIndex}]`;
    const result = spec.saveAs !== undefined
      ? (run.cliResults ?? []).find((entry) => "saveAs" in entry && entry.saveAs === spec.saveAs)
      : (run.cliResults ?? [])[spec.index ?? -1];
    const invocation = result !== undefined && (result.kind === "cli" || result.kind === "verificationSummary")
      ? result.invocation
      : undefined;
    if (invocation === undefined) {
      failures.push(`${label}: no recorded cli op result`);
      continue;
    }
    if (spec.exit !== undefined && invocation.status !== spec.exit) {
      failures.push(`${label}: expected exit ${spec.exit}, got ${invocation.status} (stderr: ${invocation.stderr.trim().slice(0, 200)})`);
    }
    if (spec.jsonMatch !== undefined) {
      try {
        matchJsonSubset(JSON.parse(invocation.stdout), spec.jsonMatch, `${label} stdout`, failures);
      } catch {
        failures.push(`${label}: stdout is not JSON: ${invocation.stdout.slice(0, 200)}`);
      }
    }
    const streamChecks: [string, string, string | RegExp | undefined][] = [
      ["stdoutMatch", invocation.stdout, spec.stdoutMatch],
      ["stderrMatch", invocation.stderr, spec.stderrMatch],
    ];
    for (const [stream, text, expected] of streamChecks) {
      if (expected === undefined) continue;
      const found = typeof expected === "string" ? text.includes(expected) : expected.test(text);
      if (!found) failures.push(`${label} ${stream}: does not match ${String(expected)}`);
    }
  }

  if (expect.preflight !== undefined) {
    const report = evaluateSchemaPreflight(run.repo);
    if (report.status !== expect.preflight) {
      failures.push(
        `preflight: expected status "${expect.preflight}", got "${report.status}"`
        + ` (issues: ${report.issues.map((issue) => issue.reason).join(", ") || "none"})`,
      );
    }
  }

  if (expect.verification !== undefined) {
    const { verdict, reasonsContain = [], subject = "commit:HEAD", args = [] } = expect.verification;
    const [kind, ref] = subject.split(":", 2);
    const subjectArgs = kind === "workspace" || kind === "snapshot" ? ["--snapshot", ref] : ["--commit", ref];
    const extraArgs = args.map((value) => resolveOpArg(value, run.cliResults ?? [], run.repo));
    const result = spawnSync(
      process.execPath,
      [TSX_CLI, EVIDENCE_STORE, "summary", "--cwd", run.repo, "--json", ...subjectArgs, ...extraArgs],
      { encoding: "utf8" },
    );
    try {
      const report: unknown = JSON.parse(result.stdout);
      if (!report || typeof report !== "object" || !("summary" in report)
          || typeof report.summary !== "object" || report.summary === null) {
        throw new Error("missing summary object");
      }
      const summary = report.summary as {
        verdict?: unknown;
        reasons?: unknown;
        checks?: unknown;
        claims?: unknown;
        evidence?: unknown;
      };
      if (summary.verdict !== verdict) {
        failures.push(`verification: expected verdict "${verdict}", got ${JSON.stringify(summary.verdict)} (reasons: ${JSON.stringify(summary.reasons)})`);
      }
      // Flatten every reason the summary emits — top-level classifications,
      // per-check / per-claim rollups, and the per-record assessment codes.
      const reasons: string[] = Array.isArray(summary.reasons) ? summary.reasons.map(String) : [];
      const collect = (entries: unknown): void => {
        if (!Array.isArray(entries)) return;
        for (const entry of entries) {
          if (!entry || typeof entry !== "object") continue;
          const entryReasons = (entry as { reasons?: unknown }).reasons;
          if (!Array.isArray(entryReasons)) continue;
          for (const reason of entryReasons) {
            if (typeof reason === "string") reasons.push(reason);
            else if (reason && typeof reason === "object" && typeof (reason as { code?: unknown }).code === "string") {
              reasons.push((reason as { code: string }).code);
            }
          }
        }
      };
      collect(summary.checks);
      collect(summary.claims);
      collect(summary.evidence);
      for (const needle of reasonsContain) {
        const found = typeof needle === "string" ? reasons.includes(needle) : reasons.some((reason) => needle.test(reason));
        if (!found) failures.push(`verification: reasons ${JSON.stringify(reasons)} do not contain ${String(needle)}`);
      }
    } catch (error) {
      failures.push(`verification: invalid CLI result (exit=${result.status}, stderr=${result.stderr.trim().slice(0, 200)}): ${String(error)}`);
    }
  }

  for (const [dir, count] of Object.entries(expect.fileCount ?? {})) {
    const root = path.join(run.repo, dir);
    let actual = 0;
    const visit = (entry: string): void => {
      if (!fs.existsSync(entry)) return;
      const stat = fs.statSync(entry);
      if (stat.isDirectory()) for (const child of fs.readdirSync(entry)) visit(path.join(entry, child));
      else if (stat.isFile()) actual += 1;
    };
    visit(root);
    if (actual !== count) failures.push(`fileCount ${dir}: expected ${count} file(s), got ${actual}`);
  }

  for (const rel of expect.absentFiles ?? []) {
    if (fs.existsSync(path.join(run.repo, rel))) {
      failures.push(`absentFiles ${rel}: path exists but must not`);
    }
  }

  if (expect.gitDirty !== undefined) {
    const dirty = gitStatus(run.repo).length > 0;
    if (dirty !== expect.gitDirty) {
      failures.push(`gitDirty: expected ${expect.gitDirty}, got ${dirty} (${gitStatus(run.repo).join(", ") || "clean"})`);
    }
  }

  for (const entry of expect.tasksAbsent ?? []) {
    const target = events.filter((event): event is RouteSelectedEvent => (
      event.kind === "route-selected" && event.edgeId === entry.edgeId
    )).at(-1);
    if (!target) {
      failures.push(`tasksAbsent: no route-selected for edge "${entry.edgeId}" in scope`);
      continue;
    }
    if (target.tasks.some((task) => task.id === entry.id)) {
      failures.push(
        `tasksAbsent: route-selected "${entry.edgeId}" tasks ${JSON.stringify(target.tasks.map((task) => task.id))}`
        + ` contain ${JSON.stringify(entry.id)} — a foreign run's record leaked into the projection`,
      );
    }
  }

  if (expect.receiptsContain !== undefined) {
    try {
      const receipts = new Set(run.runIds).size === 0 ? [] : [...new Set(run.runIds)].flatMap((runId) => {
        try {
          return loadRun(run.repo, runId).receipts;
        } catch {
          return [];
        }
      });
      for (const spec of expect.receiptsContain) {
        const found = receipts.some((record) => {
          if (spec.runId !== undefined && record.runId !== spec.runId) return false;
          if (spec.idempotencyKey !== undefined && record.idempotencyKey !== spec.idempotencyKey) return false;
          if (spec.status !== undefined && record.status !== spec.status) return false;
          const scope = typeof record.input === "object" && record.input !== null
            ? record.input as Record<string, unknown>
            : {};
          if (spec.edgeId !== undefined && scope.edgeId !== spec.edgeId) return false;
          if (spec.stage !== undefined && scope.stage !== spec.stage) return false;
          return true;
        });
        if (!found) {
          failures.push(
            `receiptsContain: no Effect Receipt matching ${JSON.stringify(spec)}`
            + ` (${receipts.length} receipt(s) re-read from the Execution Store)`,
          );
        }
      }
    } catch (error) {
      failures.push(`receiptsContain: failed to read receipts — ${String(error)}`);
    }
  }

  if (expect.evidence !== undefined) {
    try {
      const records = readEvidenceRecords(run.repo);
      if (expect.evidence.count !== undefined && records.length !== expect.evidence.count) {
        failures.push(`evidence.count: expected ${expect.evidence.count} record(s), got ${records.length}`);
      }
      for (const spec of expect.evidence.records ?? []) {
        const found = records.some((record) => (
          (spec.outcome === undefined || record.outcome === spec.outcome)
          && (spec.check === undefined || record.check.ref === spec.check)
          && (spec.claim === undefined || record.claim.ref === spec.claim)
        ));
        if (!found) {
          failures.push(`evidence.records: no Evidence Record matching ${JSON.stringify(spec)}`);
        }
      }
    } catch (error) {
      failures.push(`evidence: failed to read the Evidence Store — ${String(error)}`);
    }
  }

  if (expect.treeSnapshotEquals !== undefined) {
    const saved = (run.cliResults ?? []).find((entry) => entry.kind === "snapshot" && entry.saveAs === expect.treeSnapshotEquals);
    if (saved === undefined || saved.kind !== "snapshot") {
      failures.push(`treeSnapshotEquals: no snapshot op named ${JSON.stringify(expect.treeSnapshotEquals)}`);
    } else if (snapshotTree(run.repo) !== saved.snapshot) {
      failures.push(`treeSnapshotEquals: tree changed since snapshot "${expect.treeSnapshotEquals}" — a read-only or refused operation wrote bytes`);
    }
  }
  return failures;
}

/** Recursive JSON subset match — objects pin keys, everything else deep-equals. */
function matchJsonSubset(actual: unknown, expected: unknown, label: string, failures: string[]): void {
  if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
      failures.push(`${label}: expected object, got ${JSON.stringify(actual)}`);
      return;
    }
    for (const [key, value] of Object.entries(expected as Record<string, unknown>)) {
      matchJsonSubset((actual as Record<string, unknown>)[key], value, `${label}.${key}`, failures);
    }
    return;
  }
  if (!isDeepStrictEqual(actual, expected)) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** Universal invariants — hard gates over the run's trace + fresh file/git state. */
function validateUniversalInvariants(run: CaseRun): string[] {
  const failures: string[] = [];
  const events = run.traceEvents;
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

  // 3. Every edgeId in run-yield.completedEdges has a CheckpointRecord in
  //    the run's Execution Store (re-read from disk — not run state).
  const completedEdgeIds = [...new Set(yieldEvents.flatMap((event) => event.completedEdges))];
  const checkpointEdges = new Set(
    readCheckpoints(run.repo, run.runIds)
      .map((checkpoint) => checkpoint.edgeId)
      .filter((edgeId): edgeId is string => edgeId !== null),
  );
  for (const edgeId of completedEdgeIds) {
    if (!checkpointEdges.has(edgeId)) {
      failures.push(`completed edge "${edgeId}" has no checkpoint record in the Execution Store`);
    }
  }

  // 4. Commit gate: a completed commitGate edge must show checkpoint work plus
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
    if (!run.result.events.includes(`checkpoint:${edgeId}`)) {
      failures.push(`commitGate edge "${edgeId}" completed without a checkpoint:${edgeId} runner event`);
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

  // 8. Receipt↔evidence separation (#238 vs #240): every file under the
  //    fixture's Evidence Store parses as a VALID Evidence Record and every
  //    file under a run's receipts/ dir does NOT — completion authority and
  //    check-outcome authority can never be confused on disk, whichever
  //    path a case drove writes through.
  const evidenceDir = path.join(run.repo, ".apm", "state", "doc-driven-dev", "evidence", "records");
  if (fs.existsSync(evidenceDir)) {
    for (const name of fs.readdirSync(evidenceDir).filter((entry) => entry.endsWith(".json")).sort()) {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(path.join(evidenceDir, name), "utf8"));
        if (!validateEvidenceRecord(parsed)) {
          failures.push(`evidence record ${name} fails EvidenceRecord validation — a non-evidence payload is in the Evidence Store`);
        }
      } catch (error) {
        failures.push(`evidence record ${name} is unreadable — ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  const runsDir = path.join(run.repo, ".apm", "state", "doc-driven-dev", "runs");
  if (fs.existsSync(runsDir)) {
    for (const runEntry of fs.readdirSync(runsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const receiptsDir = path.join(runsDir, runEntry.name, "receipts");
      if (!fs.existsSync(receiptsDir)) continue;
      for (const name of fs.readdirSync(receiptsDir).filter((entry) => entry.endsWith(".json")).sort()) {
        try {
          const parsed: unknown = JSON.parse(fs.readFileSync(path.join(receiptsDir, name), "utf8"));
          if (validateEvidenceRecord(parsed)) {
            failures.push(`receipt ${name} in run ${runEntry.name} validates as an Evidence Record — store confusion`);
          }
        } catch (error) {
          failures.push(`receipt ${name} in run ${runEntry.name} is unreadable — ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  return failures;
}

export function validateCase(run: CaseRun, expect: CaseExpect): string[] {
  return [...validateUniversalInvariants(run), ...checkExpectations(run, expect)];
}
