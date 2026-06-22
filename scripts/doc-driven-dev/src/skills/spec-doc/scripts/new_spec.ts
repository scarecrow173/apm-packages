#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { createDocument, logIndexResult } = require("../../lib/doc_suite_utils.ts");

type CliArgs = {
  cwd: string;
  date?: string;
  dir?: string;
  name?: string;
  forceIndex?: boolean;
  noIndex?: boolean;
  help?: boolean;
  status?: string;
  title?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title") args.title = argv[++i];
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
  return "Usage: node scripts/new_spec.js --title <title> [--dir <path>] [--name <filename>] [--status <status>] [--no-index] [--force-index]";
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.title) throw new Error("Missing required --title");
    const result = await createDocument("spec", {
      cwd: path.resolve(args.cwd),
      date: args.date,
      dir: args.dir,
      name: args.name,
      forceIndex: args.forceIndex,
      noIndex: args.noIndex,
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
