#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  parseSetArguments,
  readExperimentEvents,
  writeExperimentEvents,
} = require("./lib/impl_doc_utils.ts");

type CliArgs = {
  cwd: string;
  file?: string;
  help?: boolean;
  seq?: number;
  setArgs: string[];
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), setArgs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") args.file = argv[++i];
    else if (arg === "--seq") args.seq = Number(argv[++i]);
    else if (arg === "--set") args.setArgs.push(argv[++i]);
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/edit_experiment_log.js --file <log> --seq <n> --set key=value [--set key=value]";
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.file) throw new Error("Missing required --file");
    if (!args.seq || !Number.isInteger(args.seq) || args.seq <= 0) throw new Error("Missing or invalid --seq");
    if (args.setArgs.length === 0) throw new Error("At least one --set is required");
    const cwd = path.resolve(args.cwd);
    const filePath = path.resolve(cwd, args.file);
    const events = readExperimentEvents(filePath);
    const patch = parseSetArguments(args.setArgs);
    let updated = false;
    const nextEvents = events.map((item) => {
      if (item.value.seq !== args.seq) return item.value;
      updated = true;
      return {
        ...item.value,
        ...patch,
        seq: item.value.seq,
      };
    });
    if (!updated) throw new Error(`Experiment event not found: seq=${args.seq}`);
    writeExperimentEvents(filePath, nextEvents);
    console.log(`Updated ${path.relative(cwd, filePath).replace(/\\/g, "/")}#${args.seq}`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
