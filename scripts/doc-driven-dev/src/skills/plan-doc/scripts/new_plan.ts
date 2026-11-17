#!/usr/bin/env node
"use strict";

import path from "node:path";
import { configFor } from "../../lib/doc_types";
import { schemaEntrypointGuard } from "../../lib/schema_preflight";

type CliArgs = {
  cwd: string;
  date?: string;
  designTargets: string[];
  dir?: string;
  name?: string;
  forceIndex?: boolean;
  noIndex?: boolean;
  help?: boolean;
  implementsTarget?: string;
  status?: string;
  title?: string;
  verifiedByTargets: string[];
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), designTargets: [], verifiedByTargets: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title") args.title = argv[++i];
    else if (arg === "--implements") args.implementsTarget = argv[++i];
    else if (arg === "--design") args.designTargets.push(argv[++i]);
    else if (arg === "--verified-by") args.verifiedByTargets.push(argv[++i]);
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
  return "Usage: node scripts/new_plan.js --title <title> --design <design-doc> [--design <design-doc>] [--implements <doc>] [--verified-by <doc>] [--dir <path>] [--name <filename>] [--status <status>]";
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
    // Registry 3: `plan` is execution-bound — the registry gate is the one
    // authoritative refusal, raised here before any write. The script is a
    // tombstone: plan state lives in the Execution Store, so it performs no
    // creation and the historical gate checks have no reachable caller.
    configFor("plan");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
