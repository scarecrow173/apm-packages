#!/usr/bin/env node
"use strict";

import path from "node:path";
import { configFor } from "../../lib/doc_types";
import { schemaEntrypointGuard } from "../../lib/schema_preflight";

type CliArgs = {
  cwd: string;
  date?: string;
  derivesFrom: string[];
  dir?: string;
  name?: string;
  forceIndex?: boolean;
  noIndex?: boolean;
  help?: boolean;
  status?: string;
  title?: string;
  verifies: string[];
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), derivesFrom: [], verifies: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title") args.title = argv[++i];
    else if (arg === "--verifies") args.verifies.push(argv[++i]);
    else if (arg === "--derives-from") args.derivesFrom.push(argv[++i]);
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
  return "Usage: node scripts/new_test_spec.js --title <title> --verifies <doc> [--verifies <doc>...] [--derives-from <doc>...] [--dir <path>] [--name <filename>] [--status <status>]";
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
    // Registry 3: `test-spec` is a legacy, migration-only type — durable
    // verification intent lives in `verification` docs (#239). The registry
    // gate is the one authoritative refusal, raised before any write; the
    // script is a tombstone and the historical gate check has no reachable
    // caller.
    configFor("test-spec");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
