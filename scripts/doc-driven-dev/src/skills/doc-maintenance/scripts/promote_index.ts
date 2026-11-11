#!/usr/bin/env node
"use strict";

import path from "node:path";
import { applyIndexPromotions, planIndexPromotions } from "./lib/index_promotion";
import type { IndexPromotion } from "./lib/index_promotion";

type CliArgs = {
  apply: boolean;
  cwd: string;
  dir?: string;
  help?: boolean;
  json: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { apply: false, cwd: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/promote_index.js [--cwd <path>] [--dir <path>] [--apply] [--json]";
}

function printHuman(results: IndexPromotion[], applied: boolean): void {
  for (const entry of results) {
    const label = { promote: "PROMOTE", rejected: "REJECT", "noop-managed": "SKIP", "noop-missing": "SKIP" }[entry.verdict];
    console.log(`${label} ${entry.path} — ${entry.detail}`);
  }
  console.log(applied ? "Applied index promotion" : "Planned index promotion (preview; pass --apply to write)");
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    const cwd = path.resolve(args.cwd);
    const results = args.apply
      ? await applyIndexPromotions(cwd, args.dir)
      : await planIndexPromotions(cwd, args.dir);
    const rejected = results.filter((entry) => entry.verdict === "rejected").length;
    if (args.json) {
      console.log(JSON.stringify({ applied: args.apply, ok: rejected === 0, rejected, results }, null, 2));
    } else {
      printHuman(results, args.apply);
    }
    if (rejected > 0) process.exitCode = 1;
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
