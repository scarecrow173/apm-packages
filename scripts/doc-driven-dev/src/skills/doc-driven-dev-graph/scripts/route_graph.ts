#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import {
  loadGraphDefinition,
  type GraphDefinition,
} from "./lib/graph_definition";
import { projectGraphState } from "./lib/graph_state";
import { routeGraph } from "./lib/graph_router";

type CliArgs = {
  graph?: string;
  current?: string;
  signals: string[];
  focus: string[];
  taskDir?: string;
  cwd: string;
  json: boolean;
  help: boolean;
};

function usage(): string {
  return "Usage: node route_graph.js [--graph <path>] [--current <node>] [--signal <condition-signal>] [--focus <artifact>] [--task-dir <path>] [--cwd <path>] --json";
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
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function defaultGraphPath(): string {
  const candidates = [
    // Distributed skill layout: scripts/route_graph.js next to ../graphs.
    path.resolve(__dirname, "../graphs/doc-driven-dev.yaml"),
    // Source layout when the CLI is run from the monorepo checkout.
    path.resolve(
      __dirname,
      "../../../../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml",
    ),
    path.resolve(
      process.cwd(),
      "packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml",
    ),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`Unable to locate the default Graph Definition (tried: ${candidates.join(", ")})`);
  return found;
}

function validateSignals(definition: GraphDefinition, signals: string[]): void {
  const declared = new Set(
    Object.values(definition.conditions)
      .filter((condition) => condition.kind === "signal")
      .map((condition) => condition.signal),
  );
  const unknown = [...new Set(signals.filter((signal) => !declared.has(signal)))];
  if (unknown.length > 0) {
    throw new Error(`Unknown signal not declared by graph definition: ${unknown.join(", ")}`);
  }
}

function run(args: CliArgs): void {
  const definition = loadGraphDefinition(args.graph ? path.resolve(args.graph) : defaultGraphPath());
  validateSignals(definition, args.signals);
  const current = args.current ?? definition.entry;
  if (!Object.prototype.hasOwnProperty.call(definition.nodes, current)) {
    throw new Error(`Unknown graph node: ${current}`);
  }

  // Project the current Markdown state once, then route exactly one declared edge.
  // The public skill loop re-enters this command after delegates record evidence.
  const state = projectGraphState({
    cwd: args.cwd,
    graphId: definition.id,
    taskDir: args.taskDir,
    focus: args.focus,
    signals: args.signals,
  });
  const route = routeGraph({ current, definition, state });
  console.log(JSON.stringify(route, null, 2));
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
