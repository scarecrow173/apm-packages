#!/usr/bin/env node
"use strict";

import path from "node:path";
import { configFor } from "../../lib/doc_types";
import { schemaEntrypointGuard } from "../../lib/schema_preflight";

type CliArgs = {
  blocks: string[];
  cwd: string;
  date?: string;
  dependsOn: string[];
  dir?: string;
  name?: string;
  forceIndex?: boolean;
  noIndex?: boolean;
  help?: boolean;
  plan?: string;
  status?: string;
  title?: string;
  verifiedBy: string[];
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { blocks: [], cwd: process.cwd(), dependsOn: [], verifiedBy: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title") args.title = argv[++i];
    else if (arg === "--plan") args.plan = argv[++i];
    else if (arg === "--depends-on") args.dependsOn.push(argv[++i]);
    else if (arg === "--blocks") args.blocks.push(argv[++i]);
    else if (arg === "--verified-by") args.verifiedBy.push(argv[++i]);
    else if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--name") args.name = argv[++i];
    else if (arg === "--no-index") args.noIndex = true;
    else if (arg === "--force-index") args.forceIndex = true;
    else if (arg === "--status") args.status = argv[++i];
    else if (arg === "--date") args.date = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (!args.title) args.title = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/new_task.js --title <title> [--plan <plan>] [--depends-on <task>] [--blocks <task>] [--verified-by <test-spec>] [--dir <path>] [--name <filename>] [--status <status>]";
}

function main(): void {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.title) throw new Error("Missing required --title");
    const resolvedCwd = path.resolve(args.cwd);
    if (!schemaEntrypointGuard(resolvedCwd)) return;
    // Registry 3: `task` is execution-bound — the registry gate is the one
    // authoritative refusal, raised here before any write. The script is a
    // tombstone: task state lives in the Execution Store, so it performs no
    // creation and the historical gate checks have no reachable caller.
    configFor("task");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
