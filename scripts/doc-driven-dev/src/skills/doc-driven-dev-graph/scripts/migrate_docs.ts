#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { migrateDocs } = require("../../lib/doc_suite_utils.ts");

type CliArgs = {
  apply: boolean;
  cwd: string;
  from: string[];
  help?: boolean;
  includeCanonical: boolean;
  json: boolean;
  splitH1: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    apply: false,
    cwd: process.cwd(),
    from: [],
    includeCanonical: false,
    json: false,
    splitH1: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--from") args.from.push(argv[++i]);
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--include-canonical") args.includeCanonical = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--split-h1") args.splitH1 = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/migrate_docs.js [--cwd <path>] [--from <dir>] [--split-h1] [--include-canonical] [--apply] [--json]";
}

function printHuman(report: { applied: boolean; created: string[]; migrations: any[]; skipped: any[] }): void {
  console.log(`${report.applied ? "Applied" : "Planned"} docs migration`);
  if (report.migrations.length === 0) console.log("No source documents selected.");
  for (const migration of report.migrations) {
    console.log(`${migration.source} -> ${migration.target}${migration.type ? ` [${migration.type}]` : ""}`);
  }
  for (const created of report.created) {
    console.log(`Created ${created}`);
  }
  for (const skipped of report.skipped) {
    console.log(`Skipped ${skipped.file}: ${skipped.reason}`);
  }
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }

    const report = await migrateDocs({
      apply: args.apply,
      cwd: path.resolve(args.cwd),
      from: args.from,
      includeCanonical: args.includeCanonical,
      splitH1: args.splitH1,
    });

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    printHuman(report);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
