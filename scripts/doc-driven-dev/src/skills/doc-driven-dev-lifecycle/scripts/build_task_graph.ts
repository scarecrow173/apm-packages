#!/usr/bin/env node

import { buildTaskGraph } from "./lib/task_graph";

type CliArgs = {
  cwd: string;
  plan?: string;
  taskDir?: string;
  json: boolean;
  help: boolean;
};

function usage(): string {
  return "Usage: node scripts/build_task_graph.js --plan <path> [--task-dir <path>] [--cwd <path>] [--json]";
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--plan") args.plan = argv[++index];
    else if (arg === "--task-dir") args.taskDir = argv[++index];
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
    if (!args.plan) throw new Error("Missing required --plan");
    const result = buildTaskGraph({
      cwd: args.cwd,
      plan: args.plan,
      taskDir: args.taskDir,
    });
    // JSON is the stable public output. Keep the default readable as well so
    // the command remains useful in a terminal without changing its contract.
    console.log(JSON.stringify(result, null, args.json ? 2 : 2));
    if (result.issues.length > 0) process.exitCode = 1;
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();

