#!/usr/bin/env node

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

type CliArgs = {
  graph?: string;
  current?: string;
  signals: string[];
  focus: string[];
  taskDir?: string;
  cwd: string;
  traceFile?: string;
  runId?: string;
  json: boolean;
  explain: boolean;
  help: boolean;
};

function usage(): string {
  return "Usage: node route_graph.js [--graph <path>] [--current <node>] [--signal <condition-signal>] [--focus <artifact>] [--task-dir <path>] [--cwd <path>] [--trace-file <path> --run-id <id>] [--explain] --json";
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
    } else if (arg === "--cwd") {
      args.cwd = path.resolve(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--trace-file") {
      args.traceFile = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--run-id") {
      args.runId = requiredValue(argv, index, arg);
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

function run(args: CliArgs): void {
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

  // Project the current Markdown state once, then route exactly one declared edge.
  // The public skill loop re-enters this command after delegates record evidence.
  const collector = args.traceFile ? createArtifactScanCollector() : undefined;
  const state = projectGraphState({
    cwd: args.cwd,
    graphId: definition.id,
    taskDir: args.taskDir,
    focus: args.focus,
    signals: args.signals,
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
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    run(args);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
