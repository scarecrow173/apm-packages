/**
 * Thin case runner: fixture → multi-leg runCaller loop → trace → validator →
 * report. All nondeterminism (temp paths, durations) stays outside asserted
 * state; every leg drives the real route_graph CLI via tsx.
 */
import fs from "node:fs";
import path from "node:path";
import {
  runCaller,
  type CallerHandoff,
  type CallerRunResult,
  type CallerRunnerOptions,
} from "../../../src/skills/doc-driven-dev-graph/scripts/lib/caller_runner";
import { resolveGraphPath } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/graph_cli";
import { loadGraphDefinition } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";
import { summarizeBaseline } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/context_metrics";
import { readTraceFile, summarizeTrace } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/run_trace";
import type { E2ECase } from "./case_types";
import { checkExpectations, partitionByLegs, validateCase, type CaseRun } from "./case_validator";
import { commitAll, createFixtureRepo, fixtureTaskSeeds } from "./fixture_manager";
import { createRun, StoreError } from "../../../src/skills/lib/execution_store";
import { resolveOpArg, runOps, type CliOpResult } from "./cli_ops";
import { reportCase, type CaseReport } from "./reporter";
import {
  applyMutator,
  DEFAULT_TASK_DOC,
  scriptedDispatcher,
  standardResolveInputs,
  standardResolveOutputPath,
  type EdgeScript,
  type Mutator,
  type SubDispatchSpec,
} from "./scripted_dispatcher";
const TSX_CLI = path.resolve(__dirname, "../../../node_modules/tsx/dist/cli.mjs");
const ROUTER_CLI = path.resolve(__dirname, "../../../src/skills/doc-driven-dev-graph/scripts/route_graph.ts");

/**
 * Resolve `$`-placeholders inside a mutator's run-selection fields
 * (`$run:only` and saved-op paths) against the op results recorded so far.
 */
function resolveMutator(repo: string, mutator: Mutator, cliResults: CliOpResult[]): Mutator {
  const arg = (value: string | undefined): string | undefined =>
    value === undefined ? undefined : resolveOpArg(value, cliResults, repo);
  if ("task" in mutator) {
    const { runId, ...rest } = mutator.task;
    return { task: { ...rest, ...(runId !== undefined ? { runId: arg(runId) } : {}) } };
  }
  if ("plan" in mutator) {
    return { plan: { ...mutator.plan, ...(mutator.plan.runId !== undefined ? { runId: arg(mutator.plan.runId) } : {}) } };
  }
  if ("approve" in mutator) {
    return { approve: { ...mutator.approve, ...(mutator.approve.runId !== undefined ? { runId: arg(mutator.approve.runId) } : {}) } };
  }
  if ("runFocus" in mutator) {
    return { runFocus: { ...mutator.runFocus, ...(mutator.runFocus.runId !== undefined ? { runId: arg(mutator.runFocus.runId) } : {}) } };
  }
  return mutator;
}

export function runCase(e2eCase: E2ECase): { run: CaseRun; report: CaseReport } {
  const started = Date.now();
  // Graph-run fixtures always carry the Registry 3 durable docs the declared
  // audits bind — the verification-intent document and the knowledge record.
  const repo = createFixtureRepo({
    verificationDoc: true,
    knowledgeDoc: true,
    ...(e2eCase.fixture ?? {}),
  });
  const graphPath = e2eCase.graph
    ? path.resolve(repo, e2eCase.graph)
    : resolveGraphPath(undefined, repo);
  // Pre-leg ops: real CLI invocations + store/doc mutators, recorded
  // verbatim. They run BEFORE the legs so a case can migrate, seed
  // evidence, or block preflight before the graph ever routes.
  const cliResults = runOps(repo, e2eCase.ops);
  const arg = (value: string): string => resolveOpArg(value, cliResults, repo);
  // `$`-placeholders resolve the same way inside scripted edge mutators —
  // a migrated run's `$run:only` id, or an op-produced path.
  const resolveSubs = (subs: SubDispatchSpec[] | SubDispatchSpec[][] | undefined) => {
    if (!subs) return undefined;
    const resolveOne = (sub: SubDispatchSpec): SubDispatchSpec => ({
      ...sub,
      mutate: sub.mutate?.map((mutator) => resolveMutator(repo, mutator, cliResults)),
    });
    return Array.isArray(subs[0])
      ? (subs as SubDispatchSpec[][]).map((plan) => plan.map(resolveOne))
      : (subs as SubDispatchSpec[]).map(resolveOne);
  };
  const script: Record<string, EdgeScript> = Object.fromEntries(
    Object.entries(e2eCase.script ?? {}).map(([edgeId, edge]) => [
      edgeId,
      {
        ...edge,
        mutate: edge.mutate?.map((mutator) => resolveMutator(repo, mutator, cliResults)),
        subDispatches: resolveSubs(edge.subDispatches),
      },
    ]),
  );
  const dispatcher = scriptedDispatcher({
    repo, script,
    unsupportedModes: e2eCase.unsupportedModes,
  });
  // The trace file lives next to the fixture repo — never inside it, so the
  // JSONL itself can never dirty the commit gate's porcelain check.
  const traceFile = path.join(path.dirname(repo), `${path.basename(repo)}-trace.jsonl`);
  const runId = e2eCase.id;

  // Evidence-phase wiring per edge: declare the fixture's primary task doc
  // as checkpoint-bound output, plus commitAll when the edge's script sets
  // commitEvidence (commitGate edges only checkpoint on a clean commit).
  // `signals` is the run's live set — callers needing per-edge signal
  // injection (repair loops) may widen it to Set inside an override; nothing
  // here precludes that.
  const applyCheckpointEvidence: NonNullable<CallerRunnerOptions["applyCheckpointEvidence"]> = (
    repoDir, _signals, edgeId,
  ) => {
    if (script[edgeId]?.commitEvidence) commitAll(repoDir);
    // The default declaration binds the fixture's task doc — a corpus the
    // delegate's declared refs project onto. Fixtures whose corpus carries
    // no durable task doc (a migrated repo) name their own bound refs.
    return script[edgeId]?.checkpointEvidence ?? [DEFAULT_TASK_DOC];
  };

  const legs = e2eCase.steps ?? [{}];
  const legResults: CallerRunResult[] = [];
  const legFileFailures: string[] = [];
  const legRunIds: string[] = [];
  let resume: CallerHandoff | undefined;
  let thrown: unknown;
  for (const [index, step] of legs.entries()) {
    for (const mutator of step.mutateBefore ?? []) applyMutator(repo, resolveMutator(repo, mutator, cliResults));
    const options = step.options ?? {};
    // A non-resumed leg is a fresh run: the case-level fields apply again and
    // every option field (current/mode/maxHops included) reaches the runner —
    // on resumed legs the handoff wins those three by runner contract. A
    // resumed leg also inherits the handoff's runId — the run's Execution
    // Store state (receipts, checkpoints) carries the continuation; a fresh
    // leg binds a fresh run id so store state never crosses runs.
    const fresh = index === 0 || options.resume === false;
    // A fresh leg binds `options.runId` when declared (e.g. `$run:only` for
    // the migrated run a portability case drives), else the leg-scoped id.
    const boundRunId = fresh
      ? (options.runId !== undefined ? arg(options.runId) : (index === 0 ? runId : `${runId}-leg${index + 1}`))
      : undefined;
    const store = boundRunId !== undefined ? { runId: boundRunId } : undefined;
    // A fresh leg binds a fresh run — seed its task records from the fixture's
    // task docs so the execution-task input specs resolve (Registry 3 binds
    // task state in the run, not docs/tasks durable paths). A leg binding an
    // EXISTING run (run-exists) keeps its records verbatim — migrated runs
    // are never re-seeded.
    if (store) {
      try {
        createRun(repo, { runId: store.runId, tasks: fixtureTaskSeeds(repo) });
      } catch (error) {
        if (!(error instanceof StoreError && error.code === "run-exists")) throw error;
      }
    }
    let result: CallerRunResult;
    try {
      result = runCaller({
        repo,
        router: e2eCase.router ?? { executable: process.execPath, prefixArgs: [TSX_CLI, ROUTER_CLI] },
        graphPath,
        current: options.current ?? (fresh ? e2eCase.current : undefined),
        focus: (options.focus ?? (fresh ? e2eCase.focus : undefined))?.map(arg),
        signals: options.signals ?? (fresh ? e2eCase.signals : undefined),
        mode: options.mode ?? (fresh ? e2eCase.mode : undefined),
        maxHops: options.maxHops ?? (fresh ? e2eCase.maxHops : undefined),
        verificationSummary: options.verificationSummary !== undefined ? arg(options.verificationSummary) : undefined,
        dispatcher,
        store,
        resolveInputs: (route, effect) => standardResolveInputs(route, effect),
        resolveOutputPath: (route, effect) => standardResolveOutputPath(route, effect),
        applyCheckpointEvidence,
        executionMode: "tool", // the scripted adapter IS a tool — honest mode attribution
        // Case-declared delegate-mode policy: overrides executionMode and adds
        // modeReason on every effect-dispatched event of every leg when present.
        policy: e2eCase.policy,
        buildHandoff: e2eCase.buildHandoff,
        trace: { file: traceFile, runId },
        resume: options.resume === false ? undefined : resume,
      });
    } catch (error) {
      // A refusal inside the caller (stale router payload, unreadable state)
      // is captured for `expect.throwMatch` — it is never swallowed: cases
      // without the expectation fail on the recorded throw.
      thrown = error;
      break;
    }
    resume = result.handoff;
    legResults.push(result);
    legRunIds.push(result.handoff.runId);
    // Capture these filesystem assertions before the next leg can mutate
    // their inputs. Other leg expectations retain their existing scoping.
    const { briefingAudit, checkpointReceipts } = step.expect ?? {};
    if (briefingAudit || checkpointReceipts) {
      const legRun: CaseRun = {
        result,
        traceEvents: [],
        repo,
        definition: loadGraphDefinition(graphPath),
        runIds: [result.handoff.runId],
      };
      legFileFailures.push(...checkExpectations(legRun, { briefingAudit, checkpointReceipts })
        .map((failure) => `leg ${index + 1}: ${failure}`));
    }
  }

  // Post-leg ops (e.g. `index apply` after a graph run proved routing does
  // not stall on missing indexes) append to the recorded op results.
  cliResults.push(...runOps(repo, e2eCase.postOps));

  const traceEvents = fs.existsSync(traceFile)
    ? readTraceFile(traceFile).filter((event) => event.runId === runId)
    : [];
  // Validator independence: re-load the definition from YAML — never trust
  // the emitted route set or the runner's internal copy.
  const definition = loadGraphDefinition(graphPath);
  // A zero-leg ops case still yields a CaseRun shape: an empty result the
  // universal invariants pass over vacuously; op/file/git expectations
  // carry the assertions.
  const last: CallerRunResult = legResults.at(-1) ?? {
    routes: [],
    checkpoints: [],
    yieldReason: null,
    current: e2eCase.current ?? "probe",
    hops: 0,
    outcomes: [],
    completedEdges: [],
    events: [],
    handoff: {
      runId,
      current: e2eCase.current ?? "probe",
      mode: e2eCase.mode ?? "run-until-yield",
      maxHops: 0,
      maxDispatchesPerEdge: 0,
      maxTotalDispatches: 0,
      yieldReason: null,
      focus: e2eCase.focus ?? [],
      signals: e2eCase.signals ?? [],
      graphPath,
      completedEdges: [],
      seenRouteFingerprints: [],
      taskBudgetCount: null,
      auditCounts: {},
      delegateCounts: {},
      outcomes: [],
      pending: null,
      totalDispatches: 0,
      hops: 0,
    },
  };

  // Issue #124 baseline. Scan channel: summed artifact-scan trace events
  // (summarizeTrace already aggregates filesRead/bytesRead per routing hop).
  // Delegate-input channel: unique focusPaths across every effect-dispatched
  // event — emitted before outcome validation, so rejected dispatches count
  // too. A third channel (in-process canonicalReference fingerprint reads) is
  // intentionally not counted here; see context_metrics.ts doc.
  const delegatePaths = traceEvents
    .filter((event) => event.kind === "effect-dispatched")
    .flatMap((event) => event.focusPaths);
  // Bytes are measured at end-of-run state; a path removed mid-case — or a
  // non-file ref like the "." workspace root — deterministically counts 0.
  const inputSize = (relativePath: string): number => {
    try {
      const stat = fs.statSync(path.join(repo, relativePath));
      return stat.isFile() ? stat.size : 0;
    } catch {
      return 0;
    }
  };
  const baseline = summarizeBaseline(summarizeTrace(traceEvents), delegatePaths, inputSize);

  const run: CaseRun = {
    result: { ...last, events: legResults.flatMap((leg) => leg.events) },
    traceEvents,
    repo,
    definition,
    runIds: legRunIds,
    baseline,
    cliResults,
    thrown: thrown instanceof Error ? thrown.message : (thrown === undefined ? undefined : String(thrown)),
  };

  const failures = [...validateCase(run, e2eCase.expect), ...legFileFailures];
  // An uncaptured throw with no throwMatch expectation is a failure of its
  // own — the refusal cases declare the expected rejection explicitly.
  if (thrown !== undefined && e2eCase.expect.throwMatch === undefined) {
    failures.push(`runCaller threw unexpectedly: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
  }
  // Partitions close at each run-yield — a leg that threw WITHOUT a yield
  // would leave an unclosed slice the NEXT leg's events would bleed into.
  // No current case can do that: a captured throw breaks the leg loop
  // above, and the only throwing cases emit zero trace events anyway.
  const partitions = partitionByLegs(traceEvents);
  legs.forEach((step, index) => {
    if (!step.expect) return;
    const legRun: CaseRun = {
      ...run,
      result: legResults[index],
      traceEvents: partitions[index] ?? [],
    };
    const { briefingAudit: _audit, checkpointReceipts: _receipts, ...remaining } = step.expect;
    failures.push(...checkExpectations(legRun, remaining));
  });

  const report = reportCase(e2eCase.id, run, failures, Date.now() - started);
  return { run, report };
}
