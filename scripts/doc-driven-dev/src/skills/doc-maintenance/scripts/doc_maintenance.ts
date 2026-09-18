#!/usr/bin/env node
"use strict";

import path from "node:path";
import { applyMaintenance, planMaintenance } from "../../lib/doc_maintenance";

type CliArgs = {
  command?: string;
  cwd: string;
  dir?: string;
  forceIndex?: boolean;
  help?: boolean;
  json: boolean;
  type?: string;
};

const COMMANDS = ["plan", "apply"];

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--type") args.type = argv[++i];
    else if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--force-index") args.forceIndex = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (!arg.startsWith("-") && !args.command) args.command = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return [
    "Usage: node scripts/doc_maintenance.js <command> [options]",
    "",
    "Commands:",
    "  plan    Preview safe deterministic repairs without writing",
    "  apply   Apply whitelisted repairs, then rescan and validate",
    "",
    "Options:",
    "  [--type idea|brainstorm|discovery|spec|plan|task|design|adr|test-spec|all]",
    "  [--dir <path>] [--force-index] [--json]",
    "",
    "Only whitelisted repairs run: managed index regeneration and unambiguous",
    "link path-case normalization. Missing relations, statuses, sources,",
    "link targets, and orphan documents are never inferred or deleted.",
  ].join("\n");
}

async function runPlan(args: CliArgs, cwd: string): Promise<void> {
  const { plan } = await planMaintenance(cwd, { type: args.type, dir: args.dir }, { forceIndex: args.forceIndex });
  if (args.json) {
    console.log(JSON.stringify({ command: "plan", ...plan }, null, 2));
    return;
  }
  console.log(`plan: ${plan.actions.length} action(s), ${plan.skipped.length} skipped finding(s)`);
  for (const action of plan.actions) {
    console.log(`- [${action.kind}] ${action.detail} (rules: ${action.ruleIds.join(", ")})`);
  }
  for (const skipped of plan.skipped) {
    const location = skipped.path ?? ".";
    console.log(`- [skipped:${skipped.reason}] ${location}: ${skipped.message} (${skipped.ruleId})`);
  }
}

async function runApply(args: CliArgs, cwd: string): Promise<void> {
  const report = await applyMaintenance(cwd, { type: args.type, dir: args.dir }, { forceIndex: args.forceIndex });
  if (args.json) {
    console.log(JSON.stringify({ command: "apply", ...report }, null, 2));
    return;
  }
  console.log(`apply: ${report.applied.length} applied, ${report.blocked.length} blocked, ${report.skipped.length} skipped`);
  for (const action of report.applied) {
    console.log(`- [applied:${action.kind}] ${action.detail}`);
  }
  for (const item of report.blocked) {
    console.log(`- [blocked] ${item.action.detail}: ${item.reason}`);
  }
  for (const skipped of report.skipped) {
    const location = skipped.path ?? ".";
    console.log(`- [skipped:${skipped.reason}] ${location}: ${skipped.message} (${skipped.ruleId})`);
  }
  console.log(`validation: ${report.findingsBefore} finding(s) before, ${report.findingsAfter} after rescan`);
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.command) {
      console.log(usage());
      if (!args.help && !args.command) process.exitCode = 1;
      return;
    }
    if (!COMMANDS.includes(args.command)) throw new Error(`Unknown command: ${args.command}`);
    const cwd = path.resolve(args.cwd);
    if (args.command === "plan") await runPlan(args, cwd);
    else await runApply(args, cwd);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
