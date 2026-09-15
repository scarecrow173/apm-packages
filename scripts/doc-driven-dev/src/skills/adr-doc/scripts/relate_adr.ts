#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const matter = require("gray-matter");
const { findAdrDir, relationFields } = require("./lib/adr_utils.ts");

type CliArgs = {
  cwd: string;
  dir?: string;
  from?: string;
  help?: boolean;
  relation?: string;
  to?: string;
  write: boolean;
};

const inverseRelations: Record<string, string | null> = {
  implements: "implemented-by",
  "implemented-by": "implements",
  "depends-on": "blocks",
  blocks: "depends-on",
  supersedes: "superseded-by",
  "superseded-by": "supersedes",
  related: "related",
  refines: "refined-by",
  "refined-by": "refines",
  "derives-from": "derived-by",
  "derived-by": "derives-from",
  verifies: "verified-by",
  "verified-by": "verifies",
  source: null,
  references: null,
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), write: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--from") args.from = argv[++i];
    else if (arg === "--to") args.to = argv[++i];
    else if (arg === "--relation") args.relation = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--write") args.write = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return `Usage: node scripts/relate_adr.js --from <adr.md> --to <adr.md> --relation ${relationFields.join("|")} [--dir <path>] [--write]`;
}

function ensureRelation(content: string, relation: string, target: string): string {
  const parsed = matter(content);
  const data = parsed.data || {};
  const relations = data.relations && typeof data.relations === "object" && !Array.isArray(data.relations)
    ? data.relations as Record<string, unknown>
    : {};
  for (const field of relationFields) {
    if (!Array.isArray(relations[field])) relations[field] = [];
  }
  const values = relations[relation] as string[];
  if (!values.includes(target)) values.push(target);
  data.relations = relations;
  return matter.stringify(parsed.content, data);
}

function prepareUpdate(cwd: string, relativeDir: string, file: string, relation: string, target: string): { fullPath: string; label: string; next: string } {
  const fullPath = path.join(cwd, relativeDir, file);
  if (!fs.existsSync(fullPath)) throw new Error(`ADR not found: ${relativeDir}/${file}`);
  const next = ensureRelation(fs.readFileSync(fullPath, "utf8"), relation, target);
  return { fullPath, label: `${relativeDir}/${file}: ${relation} -> ${target}`, next };
}

function main(): void {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.from || !args.to || !args.relation) throw new Error("Missing --from, --to, or --relation");
    if (!relationFields.includes(args.relation as never)) throw new Error(`Unknown relation: ${args.relation}`);
    const cwd = path.resolve(args.cwd);
    const relativeDir = findAdrDir(cwd, args.dir);
    const from = path.basename(args.from);
    const to = path.basename(args.to);
    const updates = [prepareUpdate(cwd, relativeDir, from, args.relation, to)];
    const inverse = inverseRelations[args.relation];
    if (inverse) updates.push(prepareUpdate(cwd, relativeDir, to, inverse, from));
    if (args.write) {
      for (const update of updates) fs.writeFileSync(update.fullPath, update.next, "utf8");
    }
    console.log(args.write ? "Updated ADR relations:" : "DRY RUN: would update ADR relations:");
    for (const update of updates) console.log(`- ${update.label}`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
