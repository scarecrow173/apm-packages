#!/usr/bin/env node

import path from "node:path";

import { resolveGraphPath } from "./lib/graph_cli";
import { loadGraphDefinition } from "./lib/graph_definition";
import { inspectGraphDefinition, renderGraphMermaid } from "./lib/graph_inspector";
import { projectGraphState } from "./lib/graph_state";
import { schemaEntrypointGuard } from "../../lib/schema_preflight";

type OutputFormat = "json" | "mermaid";

type CliArgs = {
  graph?: string;
  format: OutputFormat;
  cwd: string;
  cwdExplicit: boolean;
  focus: string[];
  run?: string;
  stateRoot?: string;
  allowExternalRoot: boolean;
  help: boolean;
};

function usage(): string {
  return "Usage: node inspect_graph.js [--graph <path>] [--format json|mermaid] [--cwd <path>] [--focus <artifact-or-run>] [--run <run-id> [--state-root <path>] [--allow-external-root]]";
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
    allowExternalRoot: false,
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
      // Graph State v3 has no task-doc scan root — the Execution Store is
      // the only execution-state authority (Issue #243).
      throw new Error("--task-dir is not accepted by Graph State v3 — plan/task state lives in the Execution Store; select it with --run and --state-root");
    } else if (arg === "--run") {
      args.run = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--state-root") {
      args.stateRoot = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--allow-external-root") {
      args.allowExternalRoot = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

/**
 * True when the caller supplied any runtime-projection selector. The
 * Execution Store root flags count too: passing only `--state-root` or
 * `--allow-external-root` requests a projection — silently dropping them
 * would emit definition-only output the caller never asked for (Issue
 * #243).
 */
function hasRuntimeSelector(args: CliArgs): boolean {
  return args.cwdExplicit || args.focus.length > 0 || args.run !== undefined
    || args.stateRoot !== undefined || args.allowExternalRoot;
}

async function run(args: CliArgs): Promise<void> {
  if (!schemaEntrypointGuard(args.cwd)) return;
  const definition = loadGraphDefinition(resolveGraphPath(args.graph, args.cwd));
  const inspection = inspectGraphDefinition(definition);
  if (args.format === "mermaid") {
    // Mermaid is definition-only: every runtime selector is rejected —
    // `--allow-external-root` included — never silently ignored.
    if (hasRuntimeSelector(args)) {
      throw new Error("Mermaid format does not support runtime selectors: --cwd, --focus, --run, --state-root, --allow-external-root");
    }
    console.log(renderGraphMermaid(inspection));
    return;
  }

  const output: Record<string, unknown> = { definition: inspection };
  if (hasRuntimeSelector(args)) {
    const state = await projectGraphState({
      cwd: args.cwd,
      graphId: definition.id,
      focus: args.focus,
      runId: args.run,
      stateRoot: args.stateRoot,
      allowExternalRoot: args.allowExternalRoot,
    });
    if (args.focus.length > 0 && state.blockers.some((blocker) => blocker === "focus-invalid" || blocker === "focus-required")) {
      throw new Error(`Invalid focus: ${args.focus.join(", ")}`);
    }
    // Graph State v3 (Issue #243): knowledge/execution/verification are the
    // three store projections — no artifactGraph or taskDir remains.
    output.state = {
      schemaVersion: state.schemaVersion,
      graphId: state.graphId,
      cwd: state.cwd,
      focus: state.focus,
      gates: state.gates,
      signals: state.signals,
      blockers: state.blockers,
      hardBlockers: state.hardBlockers,
      execution: state.execution,
      verification: state.verification,
    };
    output.knowledge = state.knowledge.graph;
    output.taskGraph = state.execution.taskGraph;
  }
  console.log(JSON.stringify(output, null, 2));
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
