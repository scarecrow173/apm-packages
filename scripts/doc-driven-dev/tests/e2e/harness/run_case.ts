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
import { reportCase, type CaseReport } from "./reporter";
import {
  applyMutator,
  DEFAULT_TASK_DOC,
  scriptedDispatcher,
  standardResolveInputs,
  standardResolveOutputPath,
} from "./scripted_dispatcher";
const TSX_CLI = path.resolve(__dirname, "../../../node_modules/tsx/dist/cli.mjs");
const ROUTER_CLI = path.resolve(__dirname, "../../../src/skills/doc-driven-dev-graph/scripts/route_graph.ts");

export function runCase(e2eCase: E2ECase): { run: CaseRun; report: CaseReport } {
  const started = Date.now();
  // Graph-run fixtures always carry the Registry 3 verification document —
  // the `test-spec` audit's refused scope binds it on every task-graph edge.
  const repo = createFixtureRepo({ verificationDoc: true, ...(e2eCase.fixture ?? {}) });
  const graphPath = e2eCase.graph
    ? path.resolve(repo, e2eCase.graph)
    : resolveGraphPath(undefined, repo);
  const script = e2eCase.script ?? {};
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
    return [DEFAULT_TASK_DOC];
  };

  const legs = e2eCase.steps ?? [{}];
  const legResults: CallerRunResult[] = [];
  const legFileFailures: string[] = [];
  const legRunIds: string[] = [];
  let resume: CallerHandoff | undefined;
  for (const [index, step] of legs.entries()) {
    for (const mutator of step.mutateBefore ?? []) applyMutator(repo, mutator);
    const options = step.options ?? {};
    // A non-resumed leg is a fresh run: the case-level fields apply again and
    // every option field (current/mode/maxHops included) reaches the runner —
    // on resumed legs the handoff wins those three by runner contract. A
    // resumed leg also inherits the handoff's runId — the run's Execution
    // Store state (receipts, checkpoints) carries the continuation; a fresh
    // leg binds a fresh run id so store state never crosses runs.
    const fresh = index === 0 || options.resume === false;
    const store = fresh ? { runId: index === 0 ? runId : `${runId}-leg${index + 1}` } : undefined;
    // A fresh leg binds a fresh run — seed its task records from the fixture's
    // task docs so the execution-task input specs resolve (Registry 3 binds
    // task state in the run, not docs/tasks durable paths).
    if (store) {
      try {
        createRun(repo, { runId: store.runId, tasks: fixtureTaskSeeds(repo) });
      } catch (error) {
        if (!(error instanceof StoreError && error.code === "run-exists")) throw error;
      }
    }
    const result = runCaller({
      repo,
      router: { executable: process.execPath, prefixArgs: [TSX_CLI, ROUTER_CLI] },
      graphPath,
      current: options.current ?? (fresh ? e2eCase.current : undefined),
      focus: options.focus ?? (fresh ? e2eCase.focus : undefined),
      signals: options.signals ?? (fresh ? e2eCase.signals : undefined),
      mode: options.mode ?? (fresh ? e2eCase.mode : undefined),
      maxHops: options.maxHops ?? (fresh ? e2eCase.maxHops : undefined),
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

  const traceEvents = readTraceFile(traceFile).filter((event) => event.runId === runId);
  // Validator independence: re-load the definition from YAML — never trust
  // the emitted route set or the runner's internal copy.
  const definition = loadGraphDefinition(graphPath);
  const last = legResults[legResults.length - 1];

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
  };

  const failures = [...validateCase(run, e2eCase.expect), ...legFileFailures];
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
