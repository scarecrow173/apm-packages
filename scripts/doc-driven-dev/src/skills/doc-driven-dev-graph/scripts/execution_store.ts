#!/usr/bin/env node
"use strict";

// ---------------------------------------------------------------------------
// Execution Store v1 CLI (Issue #236)
// ---------------------------------------------------------------------------
//
// Per-run execution state under `.apm/state/doc-driven-dev/runs/<run-id>/` —
// Git-untracked, per-worktree by default. Every subcommand runs the shared
// schema preflight first (this is a normal mutation entry, not a migration
// surface); the store itself enforces ignore coverage, containment, CAS,
// and the single-writer lock on top.
//
//   init                                   add `.apm/state/` ignore coverage
//   create [--run-id <id>] [--graph <id>] [--focus <json>]
//          [--plan-file <path>] [--tasks-file <path>] [--base-commit <sha>]
//   show <run-id> | status <run-id>        load a run snapshot
//   list                                   run summaries
//   save-plan <run-id> --file <path> [--expect-revision <n>]
//   approve-plan <run-id> --actor <name> [--expect-revision <n>]
//   update <run-id> --focus <json> [--expect-revision <n>]
//   put-task <run-id> --file <task.json> [--expect-version <n>]
//   record-checkpoint <run-id> --file <cp.json>
//   record-receipt <run-id> --file <rc.json>
//   trace <run-id> --event <json>
//   finalize <run-id> --status completed|aborted [--expect-revision <n>]
//   dispose <run-id> [--expect-revision <n>] [--force --reason <text>]
//   recover <run-id>
//   export <run-id> --out <file>
//   import --file <export.json> [--on-conflict refuse|replace] [--force]
//
// Options: --cwd <path> --state-root <path> --allow-external-root --json

import fs from "node:fs";
import path from "node:path";

import { schemaEntrypointGuard } from "../../lib/schema_preflight";
import {
  StoreError,
  approvePlan,
  appendTrace,
  createRun,
  disposeRun,
  exportRun,
  finalizeRun,
  importRun,
  initStateRoot,
  listRuns,
  loadRun,
  recordCheckpoint,
  recordReceipt,
  recoverRun,
  savePlan,
  updateRun,
  updateTask,
} from "../../lib/execution_store";
import type { CreateRunInput, StoreOptions } from "../../lib/execution_store";

type CliArgs = {
  command?: string;
  positional: string[];
  cwd: string;
  stateRoot?: string;
  allowExternalRoot: boolean;
  json: boolean;
  help?: boolean;
  // option values
  runId?: string;
  graph?: string;
  focus?: string;
  file?: string;
  planFile?: string;
  tasksFile?: string;
  baseCommit?: string;
  out?: string;
  actor?: string;
  status?: string;
  expectRevision?: number;
  expectVersion?: number;
  onConflict?: string;
  force: boolean;
  reason?: string;
  event?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { positional: [], cwd: process.cwd(), allowExternalRoot: false, json: false, force: false };
  const take = (flag: string, i: number): string => {
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cwd") args.cwd = take(arg, i), i += 1;
    else if (arg === "--state-root") args.stateRoot = take(arg, i), i += 1;
    else if (arg === "--allow-external-root") args.allowExternalRoot = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--run-id") args.runId = take(arg, i), i += 1;
    else if (arg === "--graph") args.graph = take(arg, i), i += 1;
    else if (arg === "--focus") args.focus = take(arg, i), i += 1;
    else if (arg === "--file") args.file = take(arg, i), i += 1;
    else if (arg === "--plan-file") args.planFile = take(arg, i), i += 1;
    else if (arg === "--tasks-file") args.tasksFile = take(arg, i), i += 1;
    else if (arg === "--base-commit") args.baseCommit = take(arg, i), i += 1;
    else if (arg === "--out") args.out = take(arg, i), i += 1;
    else if (arg === "--actor") args.actor = take(arg, i), i += 1;
    else if (arg === "--status") args.status = take(arg, i), i += 1;
    else if (arg === "--expect-revision") args.expectRevision = Number(take(arg, i)), i += 1;
    else if (arg === "--expect-version") args.expectVersion = Number(take(arg, i)), i += 1;
    else if (arg === "--on-conflict") args.onConflict = take(arg, i), i += 1;
    else if (arg === "--force") args.force = true;
    else if (arg === "--reason") args.reason = take(arg, i), i += 1;
    else if (arg === "--event") args.event = take(arg, i), i += 1;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (!arg.startsWith("-") && args.command === undefined) args.command = arg;
    else if (!arg.startsWith("-")) args.positional.push(arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return [
    "Usage: node scripts/execution_store.js <command> [options]",
    "",
    "Commands: init | create | show | list | save-plan | approve-plan | update",
    "          put-task | record-checkpoint | record-receipt | trace",
    "          finalize | dispose | recover | export | import",
    "",
    "Run `node scripts/execution_store.js` with a command plus --cwd <repo>;",
    "see references/execution-store-contract.md for the layout and semantics.",
  ].join("\n");
}

function readFileArg(cwd: string, value: string | undefined, flag: string): string {
  if (value === undefined) throw new Error(`${flag} is required`);
  return fs.readFileSync(path.resolve(cwd, value), "utf8");
}

function parseJsonArg(value: string | undefined, flag: string): unknown {
  if (value === undefined) throw new Error(`${flag} is required`);
  try {
    return JSON.parse(value);
  } catch (error: unknown) {
    throw new Error(`${flag} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireRunId(args: CliArgs): string {
  const runId = args.positional[0];
  if (runId === undefined) throw new Error(`${args.command} requires a <run-id>`);
  return runId;
}

function storeOptions(args: CliArgs): StoreOptions {
  return { stateRoot: args.stateRoot, allowExternalRoot: args.allowExternalRoot };
}

function emit(args: CliArgs, payload: Record<string, unknown>): void {
  if (args.json) {
    console.log(JSON.stringify({ command: args.command, ...payload }, null, 2));
    return;
  }
  console.log(JSON.stringify({ command: args.command, ...payload }));
}

function main(): void {
  let args: CliArgs = { positional: [], cwd: process.cwd(), allowExternalRoot: false, json: false, force: false };
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.help || args.command === undefined) {
      console.log(usage());
      if (!args.help && args.command === undefined) process.exitCode = 1;
      return;
    }
    const cwd = path.resolve(args.cwd);
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      throw new Error(`--cwd does not exist or is not a directory: ${args.cwd}`);
    }
    if (!schemaEntrypointGuard(cwd)) return;
    const options = storeOptions(args);
    const command = args.command;

    if (command === "init") {
      emit(args, initStateRoot(cwd, options) as unknown as Record<string, unknown>);
      return;
    }
    if (command === "create") {
      const input: CreateRunInput = {};
      const runId = args.runId ?? args.positional[0];
      if (runId !== undefined) input.runId = runId;
      if (args.graph !== undefined) input.graphId = args.graph;
      if (args.focus !== undefined) input.focus = parseJsonArg(args.focus, "--focus");
      if (args.baseCommit !== undefined) input.baseCommit = args.baseCommit === "null" ? null : args.baseCommit;
      if (args.planFile !== undefined) input.plan = readFileArg(cwd, args.planFile, "--plan-file");
      if (args.tasksFile !== undefined) {
        const tasks = JSON.parse(readFileArg(cwd, args.tasksFile, "--tasks-file"));
        if (!Array.isArray(tasks)) throw new Error("--tasks-file must be a JSON array");
        input.tasks = tasks;
      }
      const snapshot = createRun(cwd, input, options);
      emit(args, { run: { runId: snapshot.runId, revision: snapshot.manifest.revision, status: snapshot.status } });
      return;
    }
    if (command === "list") {
      emit(args, { runs: listRuns(cwd, options) });
      return;
    }
    if (command === "show" || command === "status") {
      emit(args, { run: loadRun(cwd, requireRunId(args), options) as unknown as Record<string, unknown> });
      return;
    }
    if (command === "save-plan") {
      const content = readFileArg(cwd, args.file ?? args.planFile, "--file");
      emit(args, savePlan(cwd, requireRunId(args), content, { ...options, expectedRevision: args.expectRevision }) as unknown as Record<string, unknown>);
      return;
    }
    if (command === "approve-plan") {
      if (args.actor === undefined) throw new Error("approve-plan requires --actor <name>");
      emit(args, approvePlan(cwd, requireRunId(args), { actor: args.actor }, { ...options, expectedRevision: args.expectRevision }) as unknown as Record<string, unknown>);
      return;
    }
    if (command === "update") {
      emit(args, updateRun(cwd, requireRunId(args), { focus: parseJsonArg(args.focus, "--focus") }, { ...options, expectedRevision: args.expectRevision }));
      return;
    }
    if (command === "put-task") {
      const task = JSON.parse(readFileArg(cwd, args.file, "--file"));
      if (typeof task.taskId !== "string") throw new Error("task file requires a taskId string");
      emit(args, updateTask(cwd, requireRunId(args), task.taskId, task, { ...options, expectedVersion: args.expectVersion }) as unknown as Record<string, unknown>);
      return;
    }
    if (command === "record-checkpoint") {
      const checkpoint = JSON.parse(readFileArg(cwd, args.file, "--file"));
      emit(args, recordCheckpoint(cwd, requireRunId(args), checkpoint, options) as unknown as Record<string, unknown>);
      return;
    }
    if (command === "record-receipt") {
      const receipt = JSON.parse(readFileArg(cwd, args.file, "--file"));
      emit(args, recordReceipt(cwd, requireRunId(args), receipt, options) as unknown as Record<string, unknown>);
      return;
    }
    if (command === "trace") {
      const event = parseJsonArg(args.event, "--event");
      if (typeof event !== "object" || event === null || Array.isArray(event)) {
        throw new Error("--event must be a JSON object");
      }
      appendTrace(cwd, requireRunId(args), event as Record<string, unknown>, options);
      emit(args, { traced: true });
      return;
    }
    if (command === "finalize") {
      if (args.status !== "completed" && args.status !== "aborted") {
        throw new Error("finalize requires --status completed|aborted");
      }
      emit(args, finalizeRun(cwd, requireRunId(args), { status: args.status }, { ...options, expectedRevision: args.expectRevision }));
      return;
    }
    if (command === "dispose") {
      emit(args, disposeRun(cwd, requireRunId(args), { ...options, expectedRevision: args.expectRevision, force: args.force, reason: args.reason }) as unknown as Record<string, unknown>);
      return;
    }
    if (command === "recover") {
      emit(args, recoverRun(cwd, requireRunId(args), options));
      return;
    }
    if (command === "export") {
      if (args.out === undefined) throw new Error("export requires --out <file>");
      const document = exportRun(cwd, requireRunId(args), { ...options, out: args.out });
      emit(args, { exported: true, runId: document.runId, files: document.files.length, out: args.out });
      return;
    }
    if (command === "import") {
      if (args.file === undefined) throw new Error("import requires --file <export.json>");
      if (args.onConflict !== undefined && args.onConflict !== "refuse" && args.onConflict !== "replace") {
        throw new Error("--on-conflict must be refuse|replace");
      }
      emit(args, importRun(cwd, { file: args.file }, {
        ...options,
        onConflict: args.onConflict as "refuse" | "replace" | undefined,
        force: args.force,
        expectedRevision: args.expectRevision,
      }));
      return;
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (error: unknown) {
    if (error instanceof StoreError) {
      const payload: Record<string, unknown> = { command: args.command ?? null, error: error.code, message: error.message };
      if (error.detail !== undefined) payload.detail = error.detail;
      console.log(JSON.stringify(payload, null, 2));
    } else {
      const message = error instanceof Error ? error.message : String(error);
      if (args.json) {
        console.log(JSON.stringify({ command: args.command ?? null, error: "invalid-argument", message }));
      } else {
        console.error(message);
        console.error(usage());
      }
    }
    process.exitCode = 1;
  }
}

main();
