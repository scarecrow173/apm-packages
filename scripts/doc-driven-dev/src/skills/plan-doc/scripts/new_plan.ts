#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { createDocument, logIndexResult, resolveDocumentReference } from "../../lib/doc_suite_utils";

const PLAN_DOC_GATE_ERROR = "PLAN-DOC-GATE-001: approved design-doc is required before creating a plan. Ensure docs/designs/overview.md exists and provide at least one design doc with front matter status: \"approved\".";
const PLAN_DOC_GATE_002_PREFIX = "PLAN-DOC-GATE-002: --verified-by target does not resolve to an existing document";

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
  if (args.noIndex && args.forceIndex) throw new Error("--no-index and --force-index cannot be used together");
  return args;
}

function usage(): string {
  return "Usage: node scripts/new_plan.js --title <title> --design <design-doc> [--design <design-doc>] [--implements <doc>] [--verified-by <doc>] [--dir <path>] [--name <filename>] [--status <status>] [--no-index] [--force-index]";
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
    for (const target of args.verifiedByTargets) {
      if (!resolveDocumentReference(resolvedCwd, target)) {
        throw new Error(`${PLAN_DOC_GATE_002_PREFIX}: ${target}`);
      }
    }
    const linked = args.implementsTarget ? [args.implementsTarget] : [];
    const result = await createDocument("plan", {
      cwd: resolvedCwd,
      date: args.date,
      dir: args.dir,
      name: args.name,
      forceIndex: args.forceIndex,
      noIndex: args.noIndex,
      relations: {
        implements: linked,
        "derives-from": [...linked, ...designTargets],
        "verified-by": args.verifiedByTargets,
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
