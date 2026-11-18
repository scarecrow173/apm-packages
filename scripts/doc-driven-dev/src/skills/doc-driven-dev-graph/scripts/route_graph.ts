#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import {
  loadGraphDefinition,
  type GraphDefinition,
} from "./lib/graph_definition";
import { resolveGraphPath } from "./lib/graph_cli";
import { projectGraphState } from "./lib/graph_state";
import { evaluateRouteDecision } from "./lib/graph_router";
import { createArtifactScanCollector } from "./lib/artifact_graph";
import { appendTraceEvent, stableRouteHash } from "./lib/run_trace";
import { schemaEntrypointGuard } from "../../lib/schema_preflight";
import {
  buildVerificationSummary,
  validateVerificationSummary,
} from "../../lib/verification_assessment";
import type { VerificationSummary } from "../../lib/verification_assessment";

type CliArgs = {
  graph?: string;
  current?: string;
  signals: string[];
  focus: string[];
  taskDir?: string;
  cwd: string;
  run?: string;
  stateRoot?: string;
  allowExternalRoot: boolean;
  traceFile?: string;
  runId?: string;
  verificationSummary?: string;
  json: boolean;
  explain: boolean;
  help: boolean;
};

function usage(): string {
  return "Usage: node route_graph.js [--graph <path>] [--current <node>] [--signal <condition-signal>] [--focus <artifact>] [--task-dir <path>] [--run <run-id> [--state-root <path>] [--allow-external-root]] [--cwd <path>] [--verification-summary <path>] [--trace-file <path> --run-id <id>] [--explain] --json";
}

function requiredValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    cwd: process.cwd(),
    signals: [],
    focus: [],
    allowExternalRoot: false,
    json: false,
    explain: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--graph") {
      args.graph = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--current") {
      args.current = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--signal") {
      args.signals.push(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--focus") {
      args.focus.push(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--task-dir") {
      args.taskDir = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--run") {
      args.run = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--state-root") {
      args.stateRoot = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--allow-external-root") {
      args.allowExternalRoot = true;
    } else if (arg === "--cwd") {
      args.cwd = path.resolve(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--trace-file") {
      args.traceFile = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--run-id") {
      args.runId = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--verification-summary") {
      args.verificationSummary = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--explain") {
      args.explain = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function validateSignals(definition: GraphDefinition, signals: string[]): void {
  const declared = new Set(
    [
      ...Object.values(definition.conditions)
        .filter((condition) => condition.kind === "signal")
        .map((condition) => condition.signal),
      ...(definition.runtimeSignals ?? []),
    ],
  );
  const unknown = [...new Set(signals.filter((signal) => !declared.has(signal)))];
  if (unknown.length > 0) {
    throw new Error(`Unknown signal not declared by graph definition: ${unknown.join(", ")}`);
  }
}

// The implementation gate's evidence authority (Issue #241). A
// caller-supplied summary file is the exemption channel — waivers and
// conditional out-of-scope verdicts are judgments only a caller can
// supply — and must validate against the v1 contract before the gate
// sees it. Without a file, the router computes the summary itself: every
// in-scope check assessed from the live Evidence Store against HEAD, so
// the gate always reads current measurement, never a stale artifact or a
// caller-asserted signal.
//
// Auto-compute is intentionally per-invocation: each route decision
// re-derives the summary so routing never reads a cached assessment
// against a moved HEAD or a changed store. The trade-off is a widened
// failure domain — an unreadable or corrupt Evidence Store now fails
// the whole route invocation (the gate's authority cannot be computed),
// not just verification subcommands. Fail closed is deliberate: a store
// that cannot prove coverage can never satisfy the gate.
async function verificationSummary(args: CliArgs): Promise<VerificationSummary> {
  if (args.verificationSummary !== undefined) {
    const file = path.resolve(args.cwd, args.verificationSummary);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error: unknown) {
      throw new Error(`--verification-summary is not readable JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!validateVerificationSummary(parsed)) {
      throw new Error("--verification-summary does not satisfy the Verification Summary v1 contract — refusing to route on unverifiable input");
    }
    return parsed;
  }
  return buildVerificationSummary(args.cwd, {
    subject: { kind: "commit", commit: "HEAD" },
  }, { stateRoot: args.stateRoot, allowExternalRoot: args.allowExternalRoot });
}

async function run(args: CliArgs): Promise<void> {
  if (!schemaEntrypointGuard(args.cwd)) return;
  if (args.explain && !args.json) throw new Error("--explain requires --json");
  if ((args.traceFile === undefined) !== (args.runId === undefined)) {
    throw new Error("--trace-file and --run-id must be provided together");
  }
  const definition = loadGraphDefinition(resolveGraphPath(args.graph, args.cwd));
  validateSignals(definition, args.signals);
  const current = args.current ?? definition.entry;
  if (!Object.prototype.hasOwnProperty.call(definition.nodes, current)) {
    throw new Error(`Unknown graph node: ${current}`);
  }

  // Project fresh Graph State once — durable artifacts plus the selected
  // run's store state (Issue #237) plus the bound Verification Summary
  // (Issue #241) — then route exactly one declared edge. The public skill
  // loop re-enters this command after delegates record evidence.
  const collector = args.traceFile ? createArtifactScanCollector() : undefined;
  const summary = await verificationSummary(args);
  const state = projectGraphState({
    cwd: args.cwd,
    graphId: definition.id,
    taskDir: args.taskDir,
    focus: args.focus,
    signals: args.signals,
    runId: args.run,
    stateRoot: args.stateRoot,
    allowExternalRoot: args.allowExternalRoot,
    verificationSummary: summary,
  }, collector);
  const decision = evaluateRouteDecision({ current, definition, state });
  if (args.traceFile && args.runId && collector) {
    try {
      appendTraceEvent(args.traceFile, {
        v: 1, runId: args.runId, kind: "artifact-scan",
        scans: collector.scans,
        filesRead: collector.filesRead,
        uniqueFiles: collector.filePaths.size,
        bytesRead: collector.bytesRead,
      });
      appendTraceEvent(args.traceFile, {
        v: 1, runId: args.runId, kind: "route-selected",
        current: decision.route.current,
        next: decision.route.next,
        edgeId: decision.route.edgeId,
        status: decision.route.status,
        condition: decision.route.condition,
        delegate: decision.route.delegate,
        requiredAudits: decision.route.requiredAudits,
        commitGate: decision.route.commitGate,
        blockers: decision.route.blockers,
        focus: state.focus,
        tasks: (decision.route.taskGraph?.nodes ?? []).map((node) => ({ id: node.id, status: node.status })),
        routeHash: stableRouteHash(decision.route),
      });
    } catch (error: unknown) {
      // Diagnostics never fail a route decision.
      console.error(`run trace append failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(JSON.stringify(args.explain ? { route: decision.route, explanation: decision.explanation } : decision.route, null, 2));
}

function main(): void {
  (async () => {
    try {
      const args = parseArgs(process.argv.slice(2));
      if (args.help) {
        console.log(usage());
        return;
      }
      await run(args);
    } catch (error: unknown) {
      console.error(error instanceof Error ? error.message : String(error));
      console.error(usage());
      process.exitCode = 1;
    }
  })();
}

main();
