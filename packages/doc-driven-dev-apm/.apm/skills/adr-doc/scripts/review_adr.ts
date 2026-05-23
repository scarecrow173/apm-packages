#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { adrFiles, findAdrDir, hasSection, relationLinks, sectionBody, validateFrontMatter } = require("./lib/adr_utils.ts");

type CliArgs = {
  cwd: string;
  dir?: string;
  file?: string;
  help?: boolean;
  json: boolean;
};

type Finding = {
  code: string;
  file: string;
  message: string;
  severity: "error" | "warning" | "info";
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--file") args.file = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/review_adr.ts [--dir <path>] [--file <adr.md>] [--json]";
}

function checklistItems(body: string): string[] {
  return body.split(/\r?\n/).filter((line) => /^\s*[*-]\s+\[[ xX]\]/.test(line));
}

async function reviewFile(cwd: string, relativeDir: string, file: string): Promise<Finding[]> {
  const fullPath = path.join(cwd, relativeDir, file);
  const content = fs.readFileSync(fullPath, "utf8");
  const findings: Finding[] = [];
  const required = ["Context and Problem Statement", "Considered Options", "Decision Outcome", "Implementation Plan", "Verification"];
  for (const section of required) {
    if (!(await hasSection(content, section))) findings.push({ severity: "error", file, code: "missing-agent-section", message: `Missing section: ${section}` });
  }
  const implementation = await sectionBody(content, "Implementation Plan");
  if (!/Affected paths?:/i.test(implementation)) {
    findings.push({ severity: "warning", file, code: "missing-affected-paths", message: "Implementation Plan should name affected paths" });
  }
  if (!/(Patterns to follow|Constraints):/i.test(implementation)) {
    findings.push({ severity: "warning", file, code: "missing-implementation-constraints", message: "Implementation Plan should name constraints or patterns to follow" });
  }
  const verification = await sectionBody(content, "Verification");
  if (checklistItems(verification).length === 0) {
    findings.push({ severity: "error", file, code: "missing-verification-checks", message: "Verification should contain checkboxes" });
  }
  if (/<!--|TODO|TBD|\{\{[^}]+\}\}/i.test(content)) {
    findings.push({ severity: "warning", file, code: "unresolved-draft-text", message: "ADR still contains draft placeholders" });
  }
  for (const issue of validateFrontMatter(content)) {
    findings.push({ severity: "error", file, code: "invalid-front-matter", message: `Invalid front matter ${issue.path}: ${issue.message}` });
  }
  for (const relation of relationLinks(content)) {
    const target = path.resolve(path.dirname(fullPath), relation.target);
    if (!fs.existsSync(target)) {
      findings.push({ severity: "warning", file, code: "broken-relation-link", message: `Relation ${relation.field} points to missing ADR: ${relation.target}` });
    }
  }
  return findings;
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    const cwd = path.resolve(args.cwd);
    const relativeDir = findAdrDir(cwd, args.dir);
    const files = args.file ? [path.basename(args.file)] : adrFiles(path.join(cwd, relativeDir));
    const findings = (await Promise.all(files.map((file) => reviewFile(cwd, relativeDir, file)))).flat();
    const report = { directory: relativeDir, files: files.length, findings };
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`ADR agent-readiness review: ${relativeDir}`);
    if (findings.length === 0) {
      console.log("No findings.");
      return;
    }
    for (const finding of findings) {
      console.log(`[${finding.severity}] ${relativeDir}/${finding.file}: ${finding.message}`);
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
