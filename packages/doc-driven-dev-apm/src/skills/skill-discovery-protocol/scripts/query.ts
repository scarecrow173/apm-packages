#!/usr/bin/env node
"use strict";

// ─── Register all handlers ───
import "./lib/query/categories";
import "./lib/query/category_skills";
import "./lib/query/resolution";
import "./lib/query/flow_stack";
import "./lib/query/execution_policy";
import "./lib/query/capability_skills";
import "./lib/query/skill_detail";
import "./lib/query/runtime_guidance";
import "./lib/query/unresolved";
import "./lib/query/validation_status";

import type { QueryArgs } from "./lib/query/registry";
import { getHandler, getSubcommandNames, getAllHandlers, findClosestMatch } from "./lib/query/registry";
import { loadQueryContext } from "./lib/query/loader";
import { getRenderer } from "./lib/query/render";
import type { OutputFormat } from "./lib/query/render";

function parseArgs(argv: string[]): QueryArgs {
  const args: QueryArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--profile") args.profile = argv[++i];
    else if (arg === "--category") args.category = argv[++i];
    else if (arg === "--skill") args.skill = argv[++i];
    else if (arg === "--slot") args.slot = argv[++i];
    else if (arg === "--capability") args.capability = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--format") args.format = argv[++i] as OutputFormat;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (!arg.startsWith("--") && !args.subcommand) args.subcommand = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  const handlers = getAllHandlers();
  const lines = handlers.map((h) => `  ${h.name.padEnd(22)}${h.description}`);
  return `Usage: sdp query --profile <json> <subcommand> [options]

Options:
  --profile <path>      Path to flow profile JSON (required)
  --format <fmt>        Output format: json|md|table (default: json)
  --cwd <path>          Working directory
  --help, -h            Show help

Subcommands:
${lines.join("\n")}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage());
    return;
  }

  if (!args.profile) {
    console.error("Error: --profile is required");
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  if (!args.subcommand) {
    console.error("Error: subcommand is required");
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const handler = getHandler(args.subcommand);
  if (!handler) {
    console.error(`Error: Unknown subcommand "${args.subcommand}"`);
    const closest = findClosestMatch(args.subcommand);
    if (closest) {
      console.error(`Did you mean: ${closest}?`);
    }
    console.error(`Available subcommands: ${getSubcommandNames().join(", ")}`);
    process.exitCode = 2;
    return;
  }

  // Validate required args
  if (handler.requiredArgs) {
    for (const req of handler.requiredArgs) {
      if (!(args as Record<string, unknown>)[req]) {
        console.error(`Error: --${req} is required for ${handler.name}`);
        process.exitCode = 1;
        return;
      }
    }
  }

  let ctx;
  try {
    ctx = loadQueryContext(args);
  } catch (e: unknown) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
    return;
  }

  const result = handler.execute(ctx);
  const format: OutputFormat = args.format || "json";
  const renderer = getRenderer(format);
  console.log(renderer.render(result));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
