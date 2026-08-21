#!/usr/bin/env node

import path from "node:path";

import { resolveGraphPath } from "./lib/graph_cli";
import { loadGraphDefinition } from "./lib/graph_definition";
import { inspectGraphDefinition, renderGraphMermaid } from "./lib/graph_inspector";
import { projectGraphState } from "./lib/graph_state";

type OutputFormat = "json" | "mermaid";

type CliArgs = {
  graph?: string;
  format: OutputFormat;
  cwd: string;
  cwdExplicit: boolean;
  focus: string[];
  taskDir?: string;
  help: boolean;
};

function usage(): string {
  return "Usage: node inspect_graph.js [--graph <path>] [--format json|mermaid] [--cwd <path>] [--focus <artifact>] [--task-dir <path>]";
}

function requiredValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}

function parseFormat(value: string): OutputFormat {
  if (value === "json" || value === "mermaid") return value;
  throw new Error(`Unknown format: ${value} (expected json or mermaid)`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    format: "json",
    cwd: process.cwd(),
    cwdExplicit: false,
    focus: [],
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--graph") {
      args.graph = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--format") {
      args.format = parseFormat(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--cwd") {
      args.cwd = path.resolve(requiredValue(argv, index, arg));
      args.cwdExplicit = true;
      index += 1;
    } else if (arg === "--focus") {
      args.focus.push(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--task-dir") {
      args.taskDir = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function run(args: CliArgs): void {
  const definition = loadGraphDefinition(resolveGraphPath(args.graph, args.cwd));
  const inspection = inspectGraphDefinition(definition);
  if (args.format === "mermaid") {
    if (args.cwdExplicit || args.focus.length > 0 || args.taskDir !== undefined) {
      throw new Error("Mermaid format does not support runtime selectors: --cwd, --focus, --task-dir");
    }
    console.log(renderGraphMermaid(inspection));
    return;
  }

  const output: Record<string, unknown> = { definition: inspection };
  const hasRuntimeSelector = args.cwdExplicit || args.focus.length > 0 || args.taskDir !== undefined;
  if (hasRuntimeSelector) {
    const state = projectGraphState({
      cwd: args.cwd,
      graphId: definition.id,
      taskDir: args.taskDir,
      focus: args.focus,
    });
    if (args.focus.length > 0 && state.blockers.some((blocker) => blocker === "focus-invalid" || blocker === "focus-required")) {
      throw new Error(`Invalid focus: ${args.focus.join(", ")}`);
    }
    output.state = {
      schemaVersion: state.schemaVersion,
      graphId: state.graphId,
      cwd: state.cwd,
      taskDir: state.taskDir,
      focus: state.focus,
      gates: state.gates,
      signals: state.signals,
      blockers: state.blockers,
      hardBlockers: state.hardBlockers,
    };
    output.artifactGraph = state.artifactGraph;
    output.taskGraph = state.taskGraph;
  }
  console.log(JSON.stringify(output, null, 2));
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
