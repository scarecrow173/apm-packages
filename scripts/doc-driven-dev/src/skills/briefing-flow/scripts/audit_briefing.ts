#!/usr/bin/env node
"use strict";

import path from "node:path";
import { auditBriefingPair } from "./lib/briefing_audit";

type CliArgs = {
  adr?: string;
  cwd: string;
  help?: boolean;
  json: boolean;
  spec?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--spec") args.spec = argv[++i];
    else if (arg === "--adr") args.adr = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/audit_briefing.js --spec <path> --adr <path> [--cwd DIR] [--json]";
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.spec || !args.adr) throw new Error("Both --spec and --adr are required");

    const cwd = path.resolve(args.cwd);
    const report = await auditBriefingPair(cwd, args.spec, args.adr);

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`Briefing audit: spec=${report.spec ?? "(missing)"} adr=${report.adr ?? "(missing)"}`);
      console.log(`Consistent: ${report.consistent}`);
      for (const finding of report.findings) {
        console.log(`[${finding.severity}] ${finding.code}${finding.file ? ` ${finding.file}` : ""}: ${finding.message}`);
      }
    }
    if (report.findings.some((finding) => finding.severity === "error")) {
      process.exitCode = 1;
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

void main();
