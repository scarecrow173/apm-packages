#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { docEntries } = require("../../lib/doc_suite_utils.ts");

type CliArgs = {
  cwd: string;
  dir?: string;
  help?: boolean;
  json: boolean;
  status?: string;
  type?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--type") args.type = argv[++i];
    else if (arg === "--status") args.status = argv[++i];
    else if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/list_docs.js --type spec|plan|task [--status <status>] [--dir <path>] [--json]";
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.type) throw new Error("Missing required --type");
    const entries = (await docEntries(path.resolve(args.cwd), args.type, args.dir))
      .filter((entry: { status: string | null }) => !args.status || entry.status === args.status);
    if (args.json) {
      console.log(JSON.stringify({ type: args.type, entries }, null, 2));
      return;
    }
    console.log(`${args.type} documents:`);
    for (const entry of entries) {
      const status = entry.status ? ` [${entry.status}]` : "";
      console.log(`- ${entry.path}${status}: ${entry.title}`);
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
