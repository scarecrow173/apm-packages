#!/usr/bin/env node
"use strict";

import path from "node:path";
import { applyMaintenance, planMaintenance } from "../../lib/doc_maintenance";
import {
  applyIndexMaterialization,
  planIndexMaterialization,
} from "./lib/index_materialize";
import type { IndexMaterializeTarget } from "./lib/index_materialize";

type CliArgs = {
  command?: string;
  cwd: string;
  dir?: string;
  expect?: string;
  forceIndex?: boolean;
  help?: boolean;
  json: boolean;
  type?: string;
  verb?: string;
};

const COMMANDS = ["plan", "apply", "index"];
const INDEX_VERBS = ["plan", "apply"];

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--type") args.type = argv[++i];
    else if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--expect") {
      const value = argv[++i];
      if (value === undefined) throw new Error("Missing value for --expect");
      args.expect = value;
    }
    else if (arg === "--force-index") args.forceIndex = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (!arg.startsWith("-") && !args.command) args.command = arg;
    else if (!arg.startsWith("-") && args.command === "index" && !args.verb) args.verb = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return [
    "Usage: node scripts/doc_maintenance.js <command> [options]",
    "",
    "Commands:",
    "  plan         Preview safe deterministic repairs without writing",
    "  apply        Apply whitelisted repairs, then rescan and validate",
    "  index plan   Preview managed index materialization without writing",
    "  index apply  Materialize managed indexes, revalidating drift pins first",
    "",
    "Options:",
    "  [--type idea|brainstorm|discovery|spec|plan|task|design|adr|test-spec|all]",
    "  [--dir <path>] [--force-index] [--expect <planHash>] [--json]",
    "",
    "Only whitelisted repairs run: managed index regeneration and unambiguous",
    "link path-case normalization. Missing relations, statuses, sources,",
    "link targets, and orphan documents are never inferred or deleted.",
    "The index op writes only managed index content through the owning writer",
    "per directory; --type, --force-index, and --expect do not apply to it",
    "(--expect is index apply only).",
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

// --- index plan|apply (Issue #197) -------------------------------------------
//
// The INDEX-only surface: `plan` previews per-target materialization verdicts
// and writes nothing; `apply` re-plans, re-validates every drift pin, and
// writes only managed index content through the owning writer per directory.
// There is no --type or --force-index here — strict by contract.

// JSON contract: the write payload `content` never leaves the process — it is
// stripped from every serialized target.
function targetReport(target: IndexMaterializeTarget): Omit<IndexMaterializeTarget, "content"> {
  const copy = { ...target };
  delete copy.content;
  return copy;
}

async function runIndexPlan(args: CliArgs, cwd: string): Promise<void> {
  const plan = await planIndexMaterialization(cwd, { dir: args.dir });
  if (args.json) {
    console.log(JSON.stringify({
      command: "index plan",
      targets: plan.targets.map(targetReport),
      planHash: plan.planHash,
    }, null, 2));
    return;
  }
  console.log(`index plan: ${plan.targets.length} target(s), planHash ${plan.planHash}`);
  for (const target of plan.targets) {
    const reason = target.reason ? ` reason=${target.reason}` : "";
    console.log(
      `- ${target.directory} kind=${target.kind} owner=${target.owner ?? "none"}`
      + ` verdict=${target.verdict}${reason} changes=${target.changes.length}`
      + ` sources=${target.sourceCount} planHash=${target.planHash.slice(0, 12)}`,
    );
  }
}

async function runIndexApply(args: CliArgs, cwd: string): Promise<void> {
  const report = await applyIndexMaterialization(cwd, { dir: args.dir, expectPlanHash: args.expect });
  if (args.json) {
    console.log(JSON.stringify({
      command: "index apply",
      written: report.written,
      blocked: report.blocked.map((item) => ({ target: targetReport(item.target), reason: item.reason })),
      planHash: report.plan.planHash,
    }, null, 2));
  } else {
    console.log(`index apply: ${report.written.length} written, ${report.blocked.length} blocked, planHash ${report.plan.planHash}`);
    for (const file of report.written) {
      console.log(`- [written] ${file}`);
    }
    for (const item of report.blocked) {
      console.log(`- [blocked] ${item.target.indexPath}: ${item.reason}`);
    }
  }
  if (report.blocked.length > 0) process.exitCode = 1;
}

// `index` requires its own plan|apply verb; the repair surface keeps its
// single-positional contract (a second positional is an unknown argument).
function validateIndexArgs(args: CliArgs): void {
  if (args.verb === undefined) {
    throw new Error("index requires a verb: index plan|index apply");
  }
  if (!INDEX_VERBS.includes(args.verb)) {
    throw new Error(`Unknown index verb: ${args.verb} (expected plan|apply)`);
  }
  if (args.type !== undefined) {
    throw new Error("--type is not supported on the index op; use --dir to scope");
  }
  if (args.forceIndex) {
    throw new Error("--force-index is not supported on the index op");
  }
  if (args.expect !== undefined && args.verb !== "apply") {
    throw new Error("--expect requires index apply");
  }
}

async function main(): Promise<void> {
  let args: CliArgs = { cwd: process.cwd(), json: false };
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.help || !args.command) {
      console.log(usage());
      if (!args.help && !args.command) process.exitCode = 1;
      return;
    }
    if (!COMMANDS.includes(args.command)) throw new Error(`Unknown command: ${args.command}`);
    const cwd = path.resolve(args.cwd);
    if (args.command === "index") {
      validateIndexArgs(args);
      if (args.verb === "plan") await runIndexPlan(args, cwd);
      else await runIndexApply(args, cwd);
      return;
    }
    if (args.expect !== undefined) throw new Error("--expect requires index apply");
    if (args.command === "plan") await runPlan(args, cwd);
    else await runApply(args, cwd);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.json) {
      console.log(JSON.stringify({ command: args.command ?? null, error: message }));
    } else {
      console.error(message);
      console.error(usage());
    }
    process.exitCode = 1;
  }
}

main();
