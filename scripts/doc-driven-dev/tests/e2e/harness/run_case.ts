/**
 * Thin case runner: fixture → multi-leg runCaller loop → trace → validator →
 * report. All nondeterminism (temp paths, durations) stays outside asserted
 * state; every leg drives the real route_graph CLI via tsx.
 */
import path from "node:path";
import {
  persistEvidence,
  runCaller,
  type CallerHandoff,
  type CallerRunResult,
  type CallerRunnerOptions,
} from "../../../src/skills/doc-driven-dev-graph/scripts/lib/caller_runner";
import { resolveGraphPath } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/graph_cli";
import { loadGraphDefinition } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";
import { readTraceFile } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/run_trace";
import type { E2ECase } from "./case_types";
import { checkExpectations, partitionByLegs, validateCase, type CaseRun } from "./case_validator";
import { commitAll, createFixtureRepo } from "./fixture_manager";
import { reportCase, type CaseReport } from "./reporter";
import {
  applyMutator,
  scriptedDispatcher,
  standardResolveEvidence,
  standardResolveInputs,
} from "./scripted_dispatcher";

const DEFAULT_PROOF_PATH = "docs/tasks/0001-task.md";
const TSX_CLI = path.resolve(__dirname, "../../../node_modules/tsx/dist/cli.mjs");
const ROUTER_CLI = path.resolve(__dirname, "../../../src/skills/doc-driven-dev-graph/scripts/route_graph.ts");

export function runCase(e2eCase: E2ECase): { run: CaseRun; report: CaseReport } {
  const started = Date.now();
  const repo = createFixtureRepo(e2eCase.fixture ?? {});
  const proofPath = e2eCase.proofPath ?? DEFAULT_PROOF_PATH;
  const graphPath = e2eCase.graph
    ? path.resolve(repo, e2eCase.graph)
    : resolveGraphPath(undefined, repo);
  const script = e2eCase.script ?? {};
  const dispatcher = scriptedDispatcher({ repo, proofPath, script });
  // The trace file lives next to the fixture repo — never inside it, so the
  // JSONL itself can never dirty the commit gate's porcelain check.
  const traceFile = path.join(path.dirname(repo), `${path.basename(repo)}-trace.jsonl`);
  const runId = e2eCase.id;

  // Evidence-phase wiring per edge: persistEvidence by default, plus
  // commitAll when the edge's script sets commitEvidence (commitGate edges
  // only checkpoint on a clean commit). `signals` is the run's live set —
  // callers needing per-edge signal injection (repair loops) may widen it to
  // Set inside an override; nothing here precludes that.
  const applyEvidence: NonNullable<CallerRunnerOptions["applyEvidence"]> = (repoDir, _signals, edgeId) => {
    persistEvidence(repoDir, proofPath, edgeId);
    if (script[edgeId]?.commitEvidence) commitAll(repoDir);
  };

  const legs = e2eCase.steps ?? [{}];
  const legResults: CallerRunResult[] = [];
  let resume: CallerHandoff | undefined;
  for (const [index, step] of legs.entries()) {
    for (const mutator of step.mutateBefore ?? []) applyMutator(repo, mutator);
    const options = step.options ?? {};
    // A non-resumed leg is a fresh run: the case-level fields apply again and
    // every option field (current/mode/maxHops included) reaches the runner —
    // on resumed legs the handoff wins those three by runner contract.
    const fresh = index === 0 || options.resume === false;
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
      resolveInputs: (route, effect) => standardResolveInputs(route, effect, proofPath),
      resolveEvidence: (route, effect) => standardResolveEvidence(route, effect, proofPath),
      applyEvidence,
      proofPath,
      executionMode: "tool", // the scripted adapter IS a tool — honest mode attribution
      // Case-declared delegate-mode policy: overrides executionMode and adds
      // modeReason on every effect-dispatched event of every leg when present.
      policy: e2eCase.policy,
      trace: { file: traceFile, runId },
      resume: options.resume === false ? undefined : resume,
    });
    resume = result.handoff;
    legResults.push(result);
  }

  const traceEvents = readTraceFile(traceFile).filter((event) => event.runId === runId);
  // Validator independence: re-load the definition from YAML — never trust
  // the emitted route set or the runner's internal copy.
  const definition = loadGraphDefinition(graphPath);
  const last = legResults[legResults.length - 1];
  const run: CaseRun = {
    result: { ...last, events: legResults.flatMap((leg) => leg.events) },
    traceEvents,
    repo,
    definition,
    proofPath,
  };

  const failures = validateCase(run, e2eCase.expect);
  const partitions = partitionByLegs(traceEvents);
  legs.forEach((step, index) => {
    if (!step.expect) return;
    const legRun: CaseRun = {
      ...run,
      result: legResults[index],
      traceEvents: partitions[index] ?? [],
    };
    failures.push(...checkExpectations(legRun, step.expect));
  });

  const report = reportCase(e2eCase.id, run, failures, Date.now() - started);
  return { run, report };
}
