#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  buildImplementationRecordContent,
  buildNewFilePath,
  implStatuses,
  posixRelative,
  updateIndexForMarkdownDir,
} = require("./lib/impl_doc_utils.ts");

type CliArgs = {
  cwd: string;
  date?: string;
  dir?: string;
  help?: boolean;
  status?: string;
  task?: string;
  title?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title") args.title = argv[++i];
    else if (arg === "--task") args.task = argv[++i];
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
  return "Usage: node scripts/new_impl_record.js --title <title> [--task <task>] [--dir <path>] [--status <status>]";
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.title) throw new Error("Missing required --title");
    const status = args.status || "draft";
    if (!implStatuses.includes(status)) throw new Error(`Invalid impl status: ${status}`);
    const cwd = path.resolve(args.cwd);
    const { number, outputPath, relativeDir } = buildNewFilePath({
      cwd,
      kind: "ir",
      title: args.title,
      explicitDir: args.dir,
    });
    if (fs.existsSync(outputPath)) throw new Error(`Document already exists: ${posixRelative(cwd, outputPath)}`);
    const date = args.date || new Date().toISOString().slice(0, 10);
    const content = buildImplementationRecordContent({
      number,
      title: args.title,
      status,
      date,
      relations: {
        implements: args.task ? [args.task] : [],
      },
    });
    fs.writeFileSync(outputPath, content, "utf8");
    updateIndexForMarkdownDir(cwd, relativeDir);
    console.log(`Created ${posixRelative(cwd, outputPath)}`);
    console.log(`Updated ${relativeDir}/README.md`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
