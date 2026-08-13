#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { scaffoldDocsTree } = require("../../lib/doc_suite_utils.ts");

type CliArgs = {
  cwd: string;
  help?: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/scaffold_docs.js [--cwd <path>]";
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }

    const result = await scaffoldDocsTree(path.resolve(args.cwd));
    console.log(`Created docs tree scaffold in ${path.resolve(args.cwd)}`);
    for (const file of result.created) {
      console.log(`Created ${file}`);
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
