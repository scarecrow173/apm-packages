#!/usr/bin/env node
"use strict";

import path from "node:path";
import { auditAllDocuments, auditDocuments } from "../../lib/doc_audit";
import type { AuditOptions } from "../../lib/doc_audit";
import { collectOwnerAudits } from "./lib/owner_audits";

type CliArgs = {
  cwd: string;
  dir?: string;
  externalLinks?: boolean;
  help?: boolean;
  json: boolean;
  owners?: boolean;
  profile?: AuditOptions["profile"];
  type?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--type") args.type = argv[++i];
    else if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--profile") {
      const value = argv[++i];
      if (value !== "artifact" && value !== "materialized") {
        throw new Error(`Invalid --profile value: ${value}; expected artifact|materialized`);
      }
      args.profile = value;
    }
    else if (arg === "--json") args.json = true;
    else if (arg === "--owners") args.owners = true;
    else if (arg === "--external-links") args.externalLinks = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/audit_docs.js --type idea|brainstorm|discovery|spec|plan|task|design|adr|test-spec|all [--dir <path>] [--json] [--external-links] [--profile artifact|materialized] [--owners]\n" +
    "  --owners requires --type all and cannot be combined with --dir";
}

async function auditAll(cwd: string, explicitDir?: string, options?: AuditOptions) {
  return auditAllDocuments(cwd, explicitDir, options);
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.type) throw new Error("Missing required --type");
    if (args.owners && args.type !== "all") throw new Error("--owners requires --type all");
    if (args.owners && args.dir) throw new Error("--owners cannot be combined with --dir");
    const cwd = path.resolve(args.cwd);
    const options: AuditOptions = { externalLinks: Boolean(args.externalLinks), profile: args.profile };
    const report = args.type === "all" ? await auditAll(cwd, args.dir, options) : await auditDocuments(cwd, args.type, args.dir, options);
    if (args.owners) report.ownerAudits = collectOwnerAudits(cwd);
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`${args.type} audit: ${report.directory}`);
    console.log(`profile: ${report.profile}`);
    console.log(`Files: ${report.files}`);
    if (report.findings.length === 0) {
      console.log("No findings.");
    } else {
      for (const finding of report.findings) {
        const location = finding.file
          ? report.directory === "." ? finding.file : `${report.directory}/${finding.file}`
          : report.directory;
        console.log(`[${finding.severity}] ${location}: ${finding.message}`);
      }
    }
    for (const owner of report.ownerAudits ?? []) {
      console.log(`owner audit ${owner.name}: ${owner.directory} (${owner.files} files)`);
      for (const finding of owner.findings) {
        console.log(`[${finding.severity}] ${finding.file}: ${finding.message}`);
      }
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
