#!/usr/bin/env node

import { buildTaskGraph } from "./lib/task_graph";
import { schemaEntrypointGuard } from "../../lib/schema_preflight";

type CliArgs = {
  cwd: string;
  run?: string;
  stateRoot?: string;
  allowExternalRoot: boolean;
  json: boolean;
  help: boolean;
};

function usage(): string {
  return "Usage: node scripts/build_task_graph.js --run <run-id> [--state-root <path>] [--allow-external-root] [--cwd <path>] [--json]";
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), allowExternalRoot: false, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run") args.run = argv[++index];
    else if (arg === "--state-root") args.stateRoot = argv[++index];
    else if (arg === "--allow-external-root") args.allowExternalRoot = true;
    else if (arg === "--cwd") args.cwd = argv[++index] || args.cwd;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function main(): void {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.run) throw new Error("Missing required --run <run-id>");
    if (!schemaEntrypointGuard(args.cwd)) return;
    const result = buildTaskGraph({
      cwd: args.cwd,
      runId: args.run,
      stateRoot: args.stateRoot,
      allowExternalRoot: args.allowExternalRoot,
    });
    // JSON is the stable public output. Keep the default readable as well so
    // the command remains useful in a terminal without changing its contract.
    console.log(JSON.stringify(result, null, 2));
    if (result.issues.length > 0) process.exitCode = 1;
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
