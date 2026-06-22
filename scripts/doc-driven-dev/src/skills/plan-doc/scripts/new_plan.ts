#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const matter = require("gray-matter");
const { createDocument } = require("../../lib/doc_suite_utils.ts");

const PLAN_DOC_GATE_ERROR = "PLAN-DOC-GATE-001: approved design-doc is required before creating a plan. Ensure docs/designs/overview.md exists and provide at least one design doc with front matter status: \"approved\".";

type CliArgs = {
  cwd: string;
  date?: string;
  designTargets: string[];
  dir?: string;
  name?: string;
  help?: boolean;
  implementsTarget?: string;
  status?: string;
  title?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), designTargets: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title") args.title = argv[++i];
    else if (arg === "--implements") args.implementsTarget = argv[++i];
    else if (arg === "--design") args.designTargets.push(argv[++i]);
    else if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--name") args.name = argv[++i];
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
  return "Usage: node scripts/new_plan.js --title <title> --design <design-doc> [--design <design-doc>] [--implements <doc>] [--dir <path>] [--name <filename>] [--status <status>]";
}

function resolveFromCwd(cwd: string, target: string): string {
  return path.resolve(cwd, target);
}

function readStatus(filePath: string): string | null {
  const parsed = matter(fs.readFileSync(filePath, "utf8")).data;
  return typeof parsed.status === "string" ? parsed.status : null;
}

function validateDesignGate(cwd: string, designTargets: string[]): string[] {
  const overviewPath = path.join(cwd, "docs/designs/overview.md");
  if (!fs.existsSync(overviewPath)) {
    throw new Error(PLAN_DOC_GATE_ERROR);
  }

  if (designTargets.length === 0) {
    throw new Error(PLAN_DOC_GATE_ERROR);
  }

  const resolved = designTargets.map((target) => resolveFromCwd(cwd, target));
  for (const filePath of resolved) {
    if (!fs.existsSync(filePath)) {
      throw new Error(PLAN_DOC_GATE_ERROR);
    }
  }

  const hasApproved = resolved
    .filter((filePath) => path.basename(filePath).toLowerCase() !== "overview.md")
    .some((filePath) => readStatus(filePath) === "approved");

  if (!hasApproved) {
    throw new Error(PLAN_DOC_GATE_ERROR);
  }

  return designTargets;
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
    const designTargets = validateDesignGate(resolvedCwd, args.designTargets);
    const linked = args.implementsTarget ? [args.implementsTarget] : [];
    const result = await createDocument("plan", {
      cwd: resolvedCwd,
      date: args.date,
      dir: args.dir,
      name: args.name,
      relations: {
        implements: linked,
        "derives-from": [...linked, ...designTargets],
      },
      status: args.status,
      title: args.title,
    });
    console.log(`Created ${result.file}`);
    console.log(`Updated ${result.index}`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
