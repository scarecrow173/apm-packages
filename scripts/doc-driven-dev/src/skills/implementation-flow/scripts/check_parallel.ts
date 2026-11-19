#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import path from "node:path";
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
import { schemaEntrypointGuard } from "../../lib/schema_preflight";

type CliArgs = {
  baseRef?: string;
  cwd: string;
  help?: boolean;
  json: boolean;
  run?: string;
  stateRoot?: string;
  allowExternalRoot: boolean;
  verifyMerge?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), json: false, allowExternalRoot: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--run") args.run = argv[++i];
    else if (arg === "--verify-merge") args.verifyMerge = argv[++i];
    else if (arg === "--base-ref") args.baseRef = argv[++i];
    else if (arg === "--state-root") args.stateRoot = argv[++i];
    else if (arg === "--allow-external-root") args.allowExternalRoot = true;
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/check_parallel.js --run <run-id> [--cwd DIR] [--state-root DIR] [--allow-external-root] [--json]\n"
    + "       node scripts/check_parallel.js --verify-merge <slices.json> --run <run-id> [--cwd DIR] [--base-ref REF] [--json]";
}

/** Raw slices.json entry before touchedPaths collection. */
type SliceInput = {
  taskId: string;
  declaredScope: string[];
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
    // `evidencePaths` was the v2 repo-path evidence surface (files under
    // docs/impl/ that had to name the task ID). Under the current contract
    // verification evidence lives in the Git-untracked Evidence Store and
    // never appears in a merge diff — a caller still declaring repo-path
    // evidence is stale input and fails closed (Issue #249).
    if (slice.evidencePaths !== undefined) {
      throw new Error(
        `${label}.evidencePaths is not accepted — repo-path evidence was removed (Issue #249); ` +
        "verification evidence lives in the Evidence Store (.apm/state/doc-driven-dev/evidence/) " +
        "and never appears in a merge diff",
      );
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
      ...(slice.touchedPaths !== undefined ? { touchedPaths: slice.touchedPaths } : {}),
      ...(slice.baseRef !== undefined ? { baseRef: slice.baseRef } : {}),
    };
  });
}

/**
 * --run selects the run whose task records the parallel judgment reads —
 * the graph, eligibility, and every task's declared write scope come from
 * that run's records only. Never mixes runs.
 */
function runParallelCheck(cwd: string, args: CliArgs): ParallelReport {
  if (!args.run) throw new Error("Missing required --run <run-id>");
  const store = { stateRoot: args.stateRoot, allowExternalRoot: args.allowExternalRoot };
  const taskGraph = buildTaskGraph({ cwd, runId: args.run, ...store });
  // The evaluator owns eligibility (resumableActive before runnable) and
  // treats a task absent from this list as scope-undeclared — fail closed.
  const tasks = taskGraph.nodes.map((node) => ({ id: node.id, scope: node.scope }));
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
  // each taskId to a task record in the run and re-checks declaredScope
  // against the record's own scope. Omit touchedPaths so the verifier
  // collects the real diff itself — baseRef must predate the slice (a
  // slice-level baseRef wins over --base-ref; both default to HEAD).
  const slices: SliceOutcome[] = inputs.map((input) => ({
    taskId: input.taskId,
    declaredScope: input.declaredScope,
    touchedPaths: input.touchedPaths
      ?? collectChangedPaths(cwd, input.baseRef ?? args.baseRef ?? "HEAD"),
  }));
  return verifyParallelMerge(cwd, args.run as string, slices, {
    stateRoot: args.stateRoot,
    allowExternalRoot: args.allowExternalRoot,
  });
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
    if (args.verifyMerge && !args.run) {
      throw new Error("--verify-merge requires --run <run-id>");
    }
    const cwd = path.resolve(args.cwd);
    if (!schemaEntrypointGuard(cwd)) return;
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
