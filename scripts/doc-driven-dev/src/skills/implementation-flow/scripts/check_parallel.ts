#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import {
  normalizeArtifactPath,
  scanArtifactGraph,
  type ArtifactRecord,
} from "../../doc-driven-dev-graph/scripts/lib/artifact_graph";
import { buildTaskGraph } from "../../doc-driven-dev-graph/scripts/lib/task_graph";
import {
  evaluateParallelSafety,
  type ParallelReport,
} from "./lib/parallel_safety";
import {
  collectChangedPaths,
  verifyParallelMerge,
  type MergeReport,
  type SliceOutcome,
} from "./lib/merge_verification";

type CliArgs = {
  baseRef?: string;
  cwd: string;
  help?: boolean;
  json: boolean;
  plan?: string;
  taskDir?: string;
  verifyMerge?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--plan") args.plan = argv[++i];
    else if (arg === "--verify-merge") args.verifyMerge = argv[++i];
    else if (arg === "--base-ref") args.baseRef = argv[++i];
    else if (arg === "--task-dir") args.taskDir = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/check_parallel.js --plan <path-or-id> [--cwd DIR] [--task-dir DIR] [--json]\n"
    + "       node scripts/check_parallel.js --verify-merge <slices.json> [--cwd DIR] [--base-ref REF] [--task-dir DIR] [--json]";
}

/** Raw slices.json entry before touchedPaths collection. */
type SliceInput = {
  taskId: string;
  declaredScope: string[];
  evidencePaths: string[];
  taskDocPath: string;
  touchedPaths?: string[];
  baseRef?: string;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * The slices file is an untrusted JSON boundary: validate every field
 * fail-closed so malformed input surfaces as a clear CLI error instead of a
 * TypeError deep inside verifyParallelMerge.
 */
function parseSliceInputs(raw: unknown): SliceInput[] {
  if (!Array.isArray(raw)) {
    throw new Error("Slices JSON must be an array of slice outcome objects");
  }
  return raw.map((entry, index) => {
    const label = `slices[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${label} must be an object`);
    }
    const slice = entry as Record<string, unknown>;
    if (typeof slice.taskId !== "string" || !slice.taskId.trim()) {
      throw new Error(`${label}.taskId must be a non-empty string`);
    }
    if (!isStringArray(slice.declaredScope)) {
      throw new Error(`${label}.declaredScope must be an array of strings`);
    }
    if (!isStringArray(slice.evidencePaths)) {
      throw new Error(`${label}.evidencePaths must be an array of strings`);
    }
    if (typeof slice.taskDocPath !== "string") {
      throw new Error(`${label}.taskDocPath must be a string`);
    }
    if (slice.touchedPaths !== undefined && !isStringArray(slice.touchedPaths)) {
      throw new Error(`${label}.touchedPaths must be an array of strings when present`);
    }
    if (slice.baseRef !== undefined && (typeof slice.baseRef !== "string" || !slice.baseRef.trim())) {
      throw new Error(`${label}.baseRef must be a non-empty string when present`);
    }
    return {
      taskId: slice.taskId,
      declaredScope: slice.declaredScope,
      evidencePaths: slice.evidencePaths,
      taskDocPath: slice.taskDocPath,
      ...(slice.touchedPaths !== undefined ? { touchedPaths: slice.touchedPaths } : {}),
      ...(slice.baseRef !== undefined ? { baseRef: slice.baseRef } : {}),
    };
  });
}

/**
 * --plan accepts a repo-relative path (or any cwd-resolvable path) or an
 * artifact ID; it must resolve to exactly one plan record. An unresolved or
 * ambiguous plan fails closed — the task graph is never built on a guess.
 */
function resolvePlanRecord(cwd: string, planArg: string, records: ArtifactRecord[]): ArtifactRecord {
  const normalizedPath = normalizeArtifactPath(cwd, planArg);
  const matches = new Map<string, ArtifactRecord>();
  for (const record of records) {
    if (record.type !== "plan") continue;
    if (record.path === normalizedPath || record.id === planArg) {
      matches.set(record.path, record);
    }
  }
  if (matches.size === 0) {
    throw new Error(`No plan artifact found for --plan ${JSON.stringify(planArg)}`);
  }
  if (matches.size > 1) {
    throw new Error(`--plan ${JSON.stringify(planArg)} matches multiple plan artifacts: ${[...matches.keys()].join(", ")}`);
  }
  return [...matches.values()][0];
}

function runParallelCheck(cwd: string, args: CliArgs): ParallelReport {
  if (!args.plan) throw new Error("Missing required --plan <path-or-id>");
  const taskDir = args.taskDir ?? "docs/tasks";
  const projection = scanArtifactGraph({ cwd, taskDir });
  const plan = resolvePlanRecord(cwd, args.plan, projection.records);
  const taskGraph = buildTaskGraph({ cwd, plan: plan.path, taskDir });
  // Read every selected task doc body; the evaluator owns eligibility
  // (resumableActive before runnable) and treats tasks absent from this list
  // as scope-undeclared, so an unreadable doc still fails closed.
  const tasks: Array<{ id: string; body: string }> = [];
  for (const node of taskGraph.nodes) {
    try {
      tasks.push({ id: node.id, body: matter(fs.readFileSync(path.join(cwd, node.path), "utf8")).content });
    } catch {
      // Unreadable task doc → absent from the list → serial/scope-undeclared.
    }
  }
  return evaluateParallelSafety(taskGraph, tasks);
}

function runMergeVerification(cwd: string, args: CliArgs): MergeReport {
  const slicesArg = args.verifyMerge as string;
  const slicesFile = path.resolve(cwd, slicesArg);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(slicesFile, "utf8"));
  } catch (error: unknown) {
    throw new Error(`Unable to read slices JSON ${JSON.stringify(slicesArg)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const inputs = parseSliceInputs(parsed);
  // Supplied fields are asserted, not trusted: verifyParallelMerge binds
  // taskDocPath to the slice and re-checks declaredScope against the task
  // doc's ## Affected Files. Omit touchedPaths so the verifier collects the
  // real diff itself — baseRef must predate the slice (a slice-level baseRef
  // wins over --base-ref; both default to HEAD).
  const slices: SliceOutcome[] = inputs.map((input) => ({
    taskId: input.taskId,
    declaredScope: input.declaredScope,
    evidencePaths: input.evidencePaths,
    taskDocPath: input.taskDocPath,
    touchedPaths: input.touchedPaths
      ?? collectChangedPaths(cwd, input.baseRef ?? args.baseRef ?? "HEAD"),
  }));
  return verifyParallelMerge(cwd, slices, { taskDir: args.taskDir });
}

function main(): void {
  // JSON is the stable public output (same convention as build_task_graph.js):
  // the report is always printed to stdout, so --json only selects whether
  // errors surface as a JSON {error} object on stdout or as text on stderr.
  const jsonRequested = process.argv.slice(2).includes("--json");
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (args.plan && args.verifyMerge) {
      throw new Error("Use either --plan or --verify-merge, not both");
    }
    const cwd = path.resolve(args.cwd);
    if (args.verifyMerge) {
      const report = runMergeVerification(cwd, args);
      console.log(JSON.stringify(report, null, 2));
      if (report.verdict !== "merge") process.exitCode = 1;
    } else {
      const report = runParallelCheck(cwd, args);
      console.log(JSON.stringify(report, null, 2));
      if (report.decision !== "parallel") process.exitCode = 1;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (jsonRequested) {
      console.log(JSON.stringify({ error: message }));
    } else {
      console.error(message);
      console.error(usage());
    }
    process.exitCode = 1;
  }
}

main();
