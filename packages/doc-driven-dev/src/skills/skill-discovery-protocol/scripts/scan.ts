#!/usr/bin/env node
"use strict";

const path = require("node:path");

const { loadAdapter } = require("./lib/adapter.ts");
const { scanSkills } = require("./lib/scanner.ts");
const { writeScanList } = require("./lib/inference.ts");

function parseArgs(argv: string[]): { adapter?: string; cwd?: string; help?: boolean } {
  const args: { adapter?: string; cwd?: string; help?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--adapter") args.adapter = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: sdp scan --adapter <adapter-yaml> [--cwd <dir>]";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage());
    return;
  }

  if (!args.adapter) {
    console.error("Error: --adapter is required");
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();
  const adapterPath = path.resolve(cwd, args.adapter);

  let adapter;
  try {
    adapter = loadAdapter(adapterPath);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Error loading adapter: ${msg}`);
    process.exitCode = msg.includes("Adapter validation failed") ? 2 : 1;
    return;
  }

  const rawSkills = scanSkills(cwd, adapter);
  if (rawSkills.length === 0) {
    console.log("No skills found in scan scopes.");
  }

  const scanListPath = writeScanList(cwd, rawSkills);
  console.log(`Written: ${path.relative(cwd, scanListPath)}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
