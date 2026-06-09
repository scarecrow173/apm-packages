#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  buildExperimentEvent,
  experimentEventTypes,
  nextExperimentSeq,
  parseSetArguments,
  readExperimentEvents,
  writeExperimentEvents,
} = require("./lib/impl_doc_utils.ts");

type CliArgs = {
  cwd: string;
  file?: string;
  help?: boolean;
  setArgs: string[];
  summary?: string;
  ts?: string;
  type?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), setArgs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") args.file = argv[++i];
    else if (arg === "--type") args.type = argv[++i];
    else if (arg === "--summary") args.summary = argv[++i];
    else if (arg === "--ts") args.ts = argv[++i];
    else if (arg === "--set") args.setArgs.push(argv[++i]);
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/append_experiment_event.js --file <log> --type <event-type> [--summary <text>] [--set key=value]";
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.file) throw new Error("Missing required --file");
    if (!args.type) throw new Error("Missing required --type");
    if (!experimentEventTypes.includes(args.type)) throw new Error(`Invalid event type: ${args.type}`);
    const cwd = path.resolve(args.cwd);
    const filePath = path.resolve(cwd, args.file);
    const events = readExperimentEvents(filePath);
    const event = buildExperimentEvent({
      cwd,
      filePath,
      seq: nextExperimentSeq(events),
      type: args.type,
      ts: args.ts,
      summary: args.summary,
      extra: parseSetArguments(args.setArgs),
    });
    writeExperimentEvents(filePath, [...events.map((item) => item.value), event]);
    console.log(`Updated ${path.relative(cwd, filePath).replace(/\\/g, "/")}`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
