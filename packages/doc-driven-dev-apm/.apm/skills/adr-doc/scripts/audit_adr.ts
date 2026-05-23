#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  adrFiles,
  findAdrDir,
  hasSection,
  markdownLinks,
  relationLinks,
  validateFrontMatter,
} = require("./lib/adr_utils.ts");

const requiredSections = [
  "Context and Problem Statement",
  "Considered Options",
  "Decision Outcome",
  "Implementation Plan",
  "Verification",
];
const recommendedSections = [
  "Decision Drivers",
  "Consequences",
  "Confirmation",
  "Pros and Cons",
  "More Information",
];

type CliArgs = {
  cwd: string;
  dir?: string;
  help?: boolean;
  json: boolean;
};

type Severity = "error" | "warning" | "info";

type Finding = {
  code: string;
  file: string | null;
  message: string;
  severity: Severity;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/audit_adr.ts [--dir <path>] [--json]";
}

async function auditFile(cwd: string, relativeDir: string, file: string): Promise<Finding[]> {
  const filePath = path.join(cwd, relativeDir, file);
  const content = fs.readFileSync(filePath, "utf8");
  const findings: Finding[] = [];
  for (const issue of validateFrontMatter(content)) {
    findings.push({ severity: "error", file, code: "invalid-front-matter", message: `Invalid front matter ${issue.path}: ${issue.message}` });
  }
  for (const section of requiredSections) {
    if (!(await hasSection(content, section))) {
      findings.push({ severity: "error", file, code: "missing-section", message: `Missing section: ${section}` });
    }
  }
  for (const section of recommendedSections) {
    if (!(await hasSection(content, section))) {
      findings.push({ severity: "info", file, code: "missing-recommended-section", message: `Missing recommended section: ${section}` });
    }
  }
  if (/TODO|{{[^}]+}}|<!--\s*(option|driver|justification|Describe)/i.test(content)) {
    findings.push({ severity: "warning", file, code: "unresolved-placeholder", message: "Contains unresolved placeholders" });
  }
  for (const link of await markdownLinks(content)) {
    const resolved = path.resolve(path.dirname(filePath), link.url);
    if (!fs.existsSync(resolved)) {
      findings.push({ severity: "warning", file, code: "broken-local-link", message: `Broken local link: ${link.url}` });
    }
  }
  for (const relation of relationLinks(content)) {
    const resolved = path.resolve(path.dirname(filePath), relation.target);
    if (!fs.existsSync(resolved)) {
      findings.push({
        severity: "warning",
        file,
        code: "broken-relation-link",
        message: `Relation ${relation.field} points to missing ADR: ${relation.target}`,
      });
    }
  }
  return findings;
}

function indexFindings(cwd: string, relativeDir: string, files: string[]): Finding[] {
  const adrDir = path.join(cwd, relativeDir);
  const indexPath = ["README.md", "index.md"].map((name) => path.join(adrDir, name)).find((candidate) => fs.existsSync(candidate));
  if (!indexPath) {
    return [{ severity: "warning", file: null, code: "missing-index", message: "Missing ADR index README.md or index.md" }];
  }
  const index = fs.readFileSync(indexPath, "utf8");
  return files
    .filter((file) => !index.includes(file))
    .map((file) => ({ severity: "warning", file, code: "index-missing-entry", message: `Index does not link ${file}` }));
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
    const files = adrFiles(path.join(cwd, relativeDir));
    const auditFindings = (await Promise.all(files.map((file) => auditFile(cwd, relativeDir, file)))).flat();
    const findings = auditFindings.concat(indexFindings(cwd, relativeDir, files));
    const report = { directory: relativeDir, files: files.length, findings };

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`ADR audit: ${relativeDir}`);
    console.log(`Files: ${files.length}`);
    if (findings.length === 0) {
      console.log("No findings.");
      return;
    }
    for (const finding of findings) {
      const location = finding.file ? `${relativeDir}/${finding.file}` : relativeDir;
      console.log(`[${finding.severity}] ${location}: ${finding.message}`);
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
