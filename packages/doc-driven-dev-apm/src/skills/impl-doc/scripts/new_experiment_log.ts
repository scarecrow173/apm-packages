#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  buildExperimentEvent,
  buildNewFilePath,
  experimentEventTypes,
  posixRelative,
  renderExperimentTemplate,
  updateIndexForExperimentDir,
  writeExperimentEvents,
} = require("./lib/impl_doc_utils.ts");

type CliArgs = {
  cwd: string;
  dir?: string;
  help?: boolean;
  summary?: string;
  task?: string;
  title?: string;
  ts?: string;
  type?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title") args.title = argv[++i];
    else if (arg === "--task") args.task = argv[++i];
    else if (arg === "--type") args.type = argv[++i];
    else if (arg === "--summary") args.summary = argv[++i];
    else if (arg === "--ts") args.ts = argv[++i];
    else if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (!args.title) args.title = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/new_experiment_log.js --title <title> [--task <task>] [--type <event-type>] [--summary <text>] [--dir <path>]";
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.title) throw new Error("Missing required --title");
    if (args.type && !experimentEventTypes.includes(args.type)) throw new Error(`Invalid event type: ${args.type}`);
    const cwd = path.resolve(args.cwd);
    const { outputPath, relativeDir } = buildNewFilePath({
      cwd,
      kind: "exp",
      title: args.title,
      explicitDir: args.dir,
    });
    if (fs.existsSync(outputPath)) throw new Error(`Experiment Log already exists: ${posixRelative(cwd, outputPath)}`);
    fs.writeFileSync(outputPath, "", "utf8");
    if (args.type) {
      const baseEvent = buildExperimentEvent({
        cwd,
        filePath: outputPath,
        seq: 1,
        type: args.type,
        ts: args.ts,
        summary: args.summary,
        extra: args.task ? { task: args.task } : undefined,
      });
      const event = renderExperimentTemplate({
        experiment_path: baseEvent.experiment,
        seq: String(baseEvent.seq),
        event_type: String(baseEvent.type),
        timestamp: String(baseEvent.ts),
        summary: String(baseEvent.summary || ""),
      });
      if (args.task) event.task = args.task;
      writeExperimentEvents(outputPath, [event]);
    }
    updateIndexForExperimentDir(cwd, relativeDir);
    console.log(`Created ${posixRelative(cwd, outputPath)}`);
    console.log(`Updated ${relativeDir}/README.md`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
