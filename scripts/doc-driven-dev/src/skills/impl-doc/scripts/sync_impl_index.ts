#!/usr/bin/env node
"use strict";

import path from "node:path";
import { applyImplIndexSync, planImplIndexSync } from "./lib/impl_index_sync";
import type { ImplIndexKind, SyncChange, SyncPlan } from "./lib/impl_index_sync";

type CliArgs = {
  apply: boolean;
  cwd: string;
  dir?: string;
  expect?: string;
  help?: boolean;
  json: boolean;
  kind?: string;
};

const KINDS: readonly ImplIndexKind[] = ["ir", "exp"];

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { apply: false, cwd: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--kind") args.kind = argv[++i];
    else if (arg === "--expect") {
      const value = argv[++i];
      if (value === undefined) throw new Error("Missing value for --expect");
      args.expect = value;
    } else if (arg === "--apply") args.apply = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function parseKind(raw: string | undefined): ImplIndexKind {
  if (raw === undefined) throw new Error("Missing required --kind <ir|exp>");
  if (!(KINDS as readonly string[]).includes(raw)) throw new Error(`Invalid --kind: ${raw} (expected ir or exp)`);
  return raw as ImplIndexKind;
}

function usage(): string {
  return "Usage: node scripts/sync_impl_index.js --kind <ir|exp> [--dir <path>] [--cwd <path>] [--apply] [--expect <planHash>] [--json]";
}

const VERDICT_LABEL: Record<SyncPlan["verdict"], string> = {
  "in-sync": "IN-SYNC",
  sync: "SYNC",
  create: "CREATE",
  rejected: "REJECTED",
};

function changeDetail(change: SyncChange): string {
  const transition = [change.before, change.after]
    .filter((value): value is string => value !== undefined)
    .join(" -> ");
  return transition ? ` (${transition})` : "";
}

function printHuman(plan: SyncPlan, written: boolean, applyRequested: boolean): void {
  const count = plan.changes.length > 0 ? ` — ${plan.changes.length} change(s)` : "";
  const reason = plan.reason ? ` — ${plan.reason}` : "";
  console.log(`${VERDICT_LABEL[plan.verdict]} ${plan.directory}${count}${reason}`);
  for (const change of plan.changes) {
    console.log(`  ${change.kind.padEnd(13)} ${change.file}${changeDetail(change)}`);
  }
  const indexPin = plan.pins.index ? plan.pins.index.slice(0, 12) : "none";
  console.log(
    `  pins: ${Object.keys(plan.pins.sources).length} source(s), index=${indexPin}, `
    + `files=${plan.pins.fileList.length}, planHash=${plan.planHash.slice(0, 12)}`,
  );
  if (written) {
    console.log(`Applied: wrote ${plan.indexPath}`);
  } else if (plan.verdict === "rejected") {
    console.log("Rejected: no write performed");
  } else if (applyRequested) {
    console.log(plan.verdict === "in-sync"
      ? "No write needed: index already matches source truth"
      : "Not applied");
  } else {
    console.log("Preview only; pass --apply to write");
  }
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    const kind = parseKind(args.kind);
    if (args.expect !== undefined && !args.apply) {
      throw new Error("--expect requires --apply");
    }
    const cwd = path.resolve(args.cwd);
    const { plan, written } = args.apply
      ? applyImplIndexSync(cwd, kind, args.dir, args.expect !== undefined ? { expectPlanHash: args.expect } : undefined)
      : { plan: planImplIndexSync(cwd, kind, args.dir), written: false };
    if (args.json) {
      console.log(JSON.stringify({
        kind: plan.kind,
        directory: plan.directory,
        verdict: plan.verdict,
        applied: args.apply,
        written,
        planHash: plan.planHash,
        changes: plan.changes,
        pins: plan.pins,
        plannedFiles: plan.plannedFiles,
        ...(plan.reason ? { reason: plan.reason } : {}),
      }, null, 2));
    } else {
      printHuman(plan, written, args.apply);
    }
    if (plan.verdict === "rejected" || (args.apply && !written && plan.reason !== undefined)) {
      process.exitCode = 1;
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
