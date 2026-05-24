#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { auditDocuments } = require("../../lib/doc_suite_utils.ts");

type CliArgs = {
  cwd: string;
  dir?: string;
  help?: boolean;
  json: boolean;
  type?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--type") args.type = argv[++i];
    else if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/audit_docs.js --type spec|plan|task [--dir <path>] [--json]";
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.type) throw new Error("Missing required --type");
    const report = await auditDocuments(path.resolve(args.cwd), args.type, args.dir);
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`${args.type} audit: ${report.directory}`);
    console.log(`Files: ${report.files}`);
    if (report.findings.length === 0) {
      console.log("No findings.");
      return;
    }
    for (const finding of report.findings) {
      const location = finding.file ? `${report.directory}/${finding.file}` : report.directory;
      console.log(`[${finding.severity}] ${location}: ${finding.message}`);
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
