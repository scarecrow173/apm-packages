#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const matter = require("gray-matter");

const candidateDirs = ["docs/adr", "docs/decisions", "adr", "docs/adrs", "decisions"];
const requiredSections = [
  "Context and Problem Statement",
  "Considered Options",
  "Decision Outcome",
  "Implementation Plan",
  "Verification",
];
const requiredMetadata = ["status", "date", "decision-makers", "consulted", "informed"];
const relationFields = ["supersedes", "superseded-by", "related", "refines"];
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

type MarkdownLink = {
  url: string;
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

function findAdrDir(cwd: string, explicitDir?: string): string {
  if (explicitDir) return explicitDir.replace(/\\/g, "/");
  return candidateDirs.find((candidate) => fs.existsSync(path.join(cwd, candidate))) || "docs/adr";
}

function adrFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".md") && !/^readme\.md$/i.test(file) && !/^index\.md$/i.test(file))
    .sort();
}

function hasSection(content: string, section: string): boolean {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#{2,3}\\s+${escaped}\\s*$`, "mi").test(content);
}

async function markdownLinks(content: string): Promise<MarkdownLink[]> {
  const [{ unified }, remarkParse, visitModule] = await Promise.all([
    import("unified"),
    import("remark-parse"),
    import("unist-util-visit"),
  ]);
  const tree = unified().use(remarkParse.default).parse(content);
  const links: MarkdownLink[] = [];
  visitModule.visit(tree, ["link", "definition"], (node: { url?: string }) => {
    if (node.url && isLocalLink(node.url)) links.push({ url: stripAnchor(node.url) });
  });
  return links;
}

function isLocalLink(url: string): boolean {
  return url.startsWith("./") || url.startsWith("../") || url.startsWith("/");
}

function stripAnchor(url: string): string {
  return url.split("#")[0];
}

function matterData(content: string): Record<string, unknown> {
  return matter(content).data || {};
}

function relationLinks(content: string): { field: string; target: string }[] {
  const relations = matterData(content).relations;
  if (!relations || typeof relations !== "object" || Array.isArray(relations)) return [];
  const links: { field: string; target: string }[] = [];
  const relationMap = relations as Record<string, unknown>;
  for (const field of relationFields) {
    const value = relationMap[field];
    if (Array.isArray(value)) {
      for (const target of value) {
        if (typeof target === "string" && target.trim()) links.push({ field, target: target.trim() });
      }
    } else if (typeof value === "string" && value.trim()) {
      links.push({ field, target: value.trim() });
    }
  }
  return links;
}

async function auditFile(cwd: string, relativeDir: string, file: string): Promise<Finding[]> {
  const filePath = path.join(cwd, relativeDir, file);
  const content = fs.readFileSync(filePath, "utf8");
  const data = matterData(content);
  const findings: Finding[] = [];
  for (const field of requiredMetadata) {
    if (!(field in data)) {
      findings.push({ severity: "error", file, code: "missing-metadata", message: `Missing metadata: ${field}` });
    }
  }
  for (const section of requiredSections) {
    if (!hasSection(content, section)) {
      findings.push({ severity: "error", file, code: "missing-section", message: `Missing section: ${section}` });
    }
  }
  for (const section of recommendedSections) {
    if (!hasSection(content, section)) {
      findings.push({ severity: "info", file, code: "missing-recommended-section", message: `Missing recommended section: ${section}` });
    }
  }
  if (typeof data.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    findings.push({ severity: "warning", file, code: "invalid-date", message: "Date metadata should be YYYY-MM-DD" });
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
