#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { adrEntries, findAdrDir } = require("./lib/adr_utils.ts");

type CliArgs = {
  cwd: string;
  dir?: string;
  help?: boolean;
  json: boolean;
  status?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--status") args.status = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/list_adrs.js [--dir <path>] [--status <status>] [--json]";
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    const cwd = path.resolve(args.cwd);
    const relativeDir = findAdrDir(cwd, args.dir);
    const entries = (await adrEntries(cwd, relativeDir))
      .filter((entry) => !args.status || entry.status === args.status);
    const report = { directory: relativeDir, count: entries.length, entries };
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`ADR list: ${relativeDir}`);
    for (const entry of entries) {
      const status = entry.status ? ` [${entry.status}]` : "";
      const date = entry.date ? ` ${entry.date}` : "";
      console.log(`- ${entry.file}${status}${date}: ${entry.title}`);
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
