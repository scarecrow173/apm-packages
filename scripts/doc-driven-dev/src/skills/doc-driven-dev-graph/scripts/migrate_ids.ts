#!/usr/bin/env node
"use strict";

import path from "node:path";
import { migrateArtifactIds } from "./lib/id_migration";
import type { IdMigrationReport } from "./lib/id_migration";

type CliArgs = {
  allowDirty: boolean;
  apply: boolean;
  cwd: string;
  help?: boolean;
  json: boolean;
  keepFilenames: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    allowDirty: false,
    apply: false,
    cwd: process.cwd(),
    json: false,
    keepFilenames: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--allow-dirty") args.allowDirty = true;
    else if (arg === "--keep-filenames") args.keepFilenames = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/migrate_ids.js [--cwd <path>] [--apply] [--keep-filenames] [--allow-dirty] [--json]";
}

function printHuman(report: IdMigrationReport): void {
  console.log(`${report.applied ? "Applied" : "Planned"} artifact id migration`);
  for (const mapping of report.mappings) {
    console.log(`${mapping.legacyId} -> ${mapping.newId} (${mapping.files.join(", ")})`);
  }
  for (const rename of report.renames) {
    console.log(`Rename ${rename.from} -> ${rename.to}`);
  }
  for (const rewrite of report.rewrites) {
    console.log(`Rewrite ${rewrite.file} (${rewrite.replacements} replacement${rewrite.replacements === 1 ? "" : "s"})`);
  }
  for (const index of report.indexes) {
    console.log(`Index ${index.path}: ${index.action}`);
  }
  for (const blocker of report.blockers) {
    console.error(`BLOCKER ${blocker.code}${blocker.file ? ` [${blocker.file}]` : ""}: ${blocker.message}`);
  }
  if (report.applied) {
    const { remainingLegacyIds, duplicateIds, unresolvedLegacyRefs } = report.validation;
    console.log(`Validation: ${remainingLegacyIds.length} remaining legacy ids, ${duplicateIds.length} duplicate ids, ${unresolvedLegacyRefs.length} unresolved legacy refs`);
  }
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }

    const report = await migrateArtifactIds({
      allowDirty: args.allowDirty,
      apply: args.apply,
      cwd: path.resolve(args.cwd),
      keepFilenames: args.keepFilenames,
    });

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printHuman(report);
    }
    if (report.blockers.length > 0) process.exitCode = 1;
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
