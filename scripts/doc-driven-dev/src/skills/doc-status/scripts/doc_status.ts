#!/usr/bin/env node
"use strict";

import path from "node:path";
import { collectFindings, filterFindings, listDocuments, summarizeHealth } from "../../lib/doc_report";
import type { Finding } from "../../lib/doc_repository";

type CliArgs = {
  blocking?: boolean;
  command?: string;
  cwd: string;
  dir?: string;
  externalLinks?: boolean;
  help?: boolean;
  json: boolean;
  rule?: string;
  severity?: string;
  status?: string;
  type?: string;
};

const COMMANDS = ["list", "lint", "audit", "health"];

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--type") args.type = argv[++i];
    else if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--status") args.status = argv[++i];
    else if (arg === "--rule") args.rule = argv[++i];
    else if (arg === "--severity") args.severity = argv[++i];
    else if (arg === "--blocking") args.blocking = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--external-links") args.externalLinks = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (!arg.startsWith("-") && !args.command) args.command = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return [
    "Usage: node scripts/doc_status.js <command> [options]",
    "",
    "Commands:",
    "  list     List artifact inventory and metadata",
    "  lint     Enumerate deterministic contract and structure findings",
    "  audit    Evaluate findings with blocking summary for graph gates",
    "  health   Aggregate repository-wide findings by category",
    "",
    "Options:",
    "  [--type idea|brainstorm|discovery|spec|plan|task|design|adr|test-spec|all]",
    "  [--dir <path>] [--status <status>] [--rule <ruleId>] [--severity error|warning|info]",
    "  [--blocking] [--json] [--external-links]",
  ].join("\n");
}

function printFindings(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log("No findings.");
    return;
  }
  for (const finding of findings) {
    const location = finding.path ?? ".";
    const line = finding.line ? `:${finding.line}` : "";
    const blocking = finding.blocking ? " blocking" : "";
    console.log(`[${finding.severity}${blocking}] ${location}${line}: ${finding.message} (${finding.ruleId})`);
  }
}

async function runList(args: CliArgs, cwd: string): Promise<void> {
  const groups = await listDocuments(cwd, { type: args.type, dir: args.dir, status: args.status });
  if (args.json) {
    console.log(JSON.stringify({ command: "list", groups }, null, 2));
    return;
  }
  for (const group of groups) {
    console.log(`${group.type} documents (${group.directory}):`);
    for (const entry of group.entries) {
      const status = entry.status ? ` [${entry.status}]` : "";
      console.log(`- ${entry.path}${status}: ${entry.title}`);
    }
  }
}

async function runLint(args: CliArgs, cwd: string, audit: boolean): Promise<void> {
  const collected = await collectFindings(cwd, { type: args.type, dir: args.dir, externalLinks: args.externalLinks });
  const findings = filterFindings(collected.findings, {
    rule: args.rule,
    severity: args.severity,
    blocking: args.blocking,
  });
  const blocking = findings.filter((finding) => finding.blocking).length;
  const command = audit ? "audit" : "lint";
  if (args.json) {
    console.log(JSON.stringify({ command, blocking, documents: collected.documents, findings }, null, 2));
    return;
  }
  console.log(`${command}: ${collected.documents} document(s), ${findings.length} finding(s), ${blocking} blocking`);
  printFindings(findings);
}

async function runHealth(args: CliArgs, cwd: string): Promise<void> {
  const collected = await collectFindings(cwd, { type: args.type, dir: args.dir, externalLinks: args.externalLinks });
  const findings = filterFindings(collected.findings, {
    rule: args.rule,
    severity: args.severity,
    blocking: args.blocking,
  });
  const health = summarizeHealth(collected, findings);
  if (args.json) {
    console.log(JSON.stringify({ command: "health", ...health }, null, 2));
    return;
  }
  console.log(`Documents: ${health.documents}`);
  console.log(`Blocking:  ${health.blocking}`);
  console.log(`Warnings:  ${health.warnings}`);
  console.log(`Infos:     ${health.infos}`);
  console.log("");
  for (const category of health.categories) {
    const status = category.clean
      ? "clean"
      : category.blocking > 0
        ? `${category.blocking} blocking`
        : category.warnings > 0
          ? `${category.warnings} warning(s)`
          : `${category.infos} info`;
    console.log(`${category.category.padEnd(16)}${status}`);
  }
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.command) {
      console.log(usage());
      if (!args.help && !args.command) process.exitCode = 1;
      return;
    }
    if (!COMMANDS.includes(args.command)) throw new Error(`Unknown command: ${args.command}`);
    const cwd = path.resolve(args.cwd);
    if (args.command === "list") await runList(args, cwd);
    else if (args.command === "lint") await runLint(args, cwd, false);
    else if (args.command === "audit") await runLint(args, cwd, true);
    else await runHealth(args, cwd);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
