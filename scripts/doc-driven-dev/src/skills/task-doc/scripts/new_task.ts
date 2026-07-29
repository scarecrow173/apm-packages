#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const matter = require("gray-matter");
const { createDocument, logIndexResult } = require("../../lib/doc_suite_utils.ts");

const TASK_DOC_GATE_ERROR = "TASK-DOC-GATE-001: a plan with status approved, in-progress, or completed is required before creating a task from a plan.";
const TASKABLE_PLAN_STATUSES = new Set(["approved", "in-progress", "completed"]);

type CliArgs = {
  cwd: string;
  date?: string;
  dir?: string;
  name?: string;
  forceIndex?: boolean;
  noIndex?: boolean;
  help?: boolean;
  plan?: string;
  status?: string;
  title?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title") args.title = argv[++i];
    else if (arg === "--plan") args.plan = argv[++i];
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
  if (args.noIndex && args.forceIndex) throw new Error("--no-index and --force-index cannot be used together");
  return args;
}

function usage(): string {
  return "Usage: node scripts/new_task.js --title <title> [--plan <plan>] [--dir <path>] [--name <filename>] [--status <status>] [--no-index] [--force-index]";
}

function validatePlanGate(cwd: string, planTarget?: string): void {
  if (!planTarget) return;
  const planPath = path.resolve(cwd, planTarget);
  if (!fs.existsSync(planPath) || !fs.statSync(planPath).isFile()) throw new Error(TASK_DOC_GATE_ERROR);
  let status: unknown;
  try {
    status = matter(fs.readFileSync(planPath, "utf8")).data.status;
  } catch {
    throw new Error(TASK_DOC_GATE_ERROR);
  }
  if (typeof status !== "string" || !TASKABLE_PLAN_STATUSES.has(status)) {
    throw new Error(TASK_DOC_GATE_ERROR);
  }
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.title) throw new Error("Missing required --title");
    const resolvedCwd = path.resolve(args.cwd);
    validatePlanGate(resolvedCwd, args.plan);
    const linked = args.plan ? [args.plan] : [];
    const result = await createDocument("task", {
      cwd: resolvedCwd,
      date: args.date,
      dir: args.dir,
      name: args.name,
      forceIndex: args.forceIndex,
      noIndex: args.noIndex,
      relations: {
        implements: linked,
        "depends-on": linked,
      },
      status: args.status,
      title: args.title,
    });
    console.log(`Created ${result.file}`);
    logIndexResult(result);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
