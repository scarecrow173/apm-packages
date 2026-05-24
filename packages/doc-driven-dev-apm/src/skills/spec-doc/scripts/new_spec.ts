#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { createDocument } = require("../../lib/doc_suite_utils.ts");

type CliArgs = {
  cwd: string;
  date?: string;
  dir?: string;
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
    else if (arg === "--status") args.status = argv[++i];
    else if (arg === "--date") args.date = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (!args.title) args.title = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/new_spec.js --title <title> [--dir <path>] [--status <status>]";
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
      status: args.status,
      title: args.title,
    });
    console.log(`Created ${result.file}`);
    console.log(`Updated ${result.index}`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
