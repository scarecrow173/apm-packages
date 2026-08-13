#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { parseLifecycleGraph } from "./lib/lifecycle_graph";
import {
  probeLifecycleState,
  type LifecycleSignal,
} from "./lib/lifecycle_state";
import { routeLifecycle } from "./lib/lifecycle_router";

type CliArgs = {
  cwd: string;
  current?: string;
  graph?: string;
  focus: string[];
  signals: string[];
  taskDir?: string;
  json: boolean;
  help: boolean;
};

const SIGNALS: readonly LifecycleSignal[] = [
  "focus-required", "migration-requested", "migration-incomplete", "migration-complete",
  "bootstrap-incomplete", "bootstrap-complete", "briefing-incomplete", "briefing-complete",
  "implementation-verified", "design-incomplete", "design-complete", "design-gap",
  "planning-incomplete", "planning-complete", "task-graph-invalid",
  "followup-bug-fix", "followup-decision-briefing", "followup-decision-design",
  "followup-new-feature", "followup-doc-only", "followup-terminal",
  "exit-audit-pass", "spec-gap", "constraint-gap", "task-graph-retry", "tasks-runnable",
  "implementation-incomplete", "followups-unclassified", "exit-audit-required", "lifecycle-complete",
];

function usage(): string {
  return "Usage: node route_lifecycle.js --current <node> [--graph <path>] [--focus <path>] [--signal <signal>] [--task-dir <path>] [--cwd <path>] [--json]";
}

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), focus: [], signals: [], json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--current") args.current = requireValue(argv, index++, arg);
    else if (arg === "--graph") args.graph = requireValue(argv, index++, arg);
    else if (arg === "--focus") args.focus.push(requireValue(argv, index++, arg));
    else if (arg === "--signal") args.signals.push(requireValue(argv, index++, arg));
    else if (arg === "--task-dir") args.taskDir = requireValue(argv, index++, arg);
    else if (arg === "--cwd") args.cwd = requireValue(argv, index++, arg);
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function isSignal(value: string): value is LifecycleSignal {
  return SIGNALS.includes(value as LifecycleSignal);
}

function graphFile(selected?: string): string {
  if (selected) {
    const resolved = path.resolve(selected);
    if (!fs.existsSync(resolved)) throw new Error(`Unable to locate lifecycle graph: ${resolved}`);
    return resolved;
  }
  const candidates = [
    path.resolve(__dirname, "..", "graphs", "lifecycle.yaml"),
    path.resolve(__dirname, "../../../../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/graphs/lifecycle.yaml"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Unable to locate lifecycle graph");
  return found;
}

function main(): void {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.current) throw new Error("Missing required --current");
    const graph = parseLifecycleGraph(fs.readFileSync(graphFile(args.graph), "utf8"));
    if (!Object.prototype.hasOwnProperty.call(graph.nodes, args.current)) {
      throw new Error(`Unknown lifecycle node: ${args.current} (not declared in lifecycle graph)`);
    }
    for (const signal of args.signals) {
      if (!isSignal(signal)) throw new Error(`Unknown lifecycle signal: ${signal}`);
    }
    const state = probeLifecycleState({
      cwd: args.cwd,
      focus: args.focus,
      signals: args.signals as LifecycleSignal[],
      taskDir: args.taskDir,
    });
    const route = routeLifecycle({
      current: args.current,
      graph,
      state,
      taskDir: args.taskDir,
    });
    // JSON is intentionally stable in both modes; --json requests the
    // documented machine-readable pretty form and remains safe for blocked
    // lifecycle states (those are successful routes, not CLI errors).
    console.log(JSON.stringify(route, null, args.json ? 2 : 2));
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
