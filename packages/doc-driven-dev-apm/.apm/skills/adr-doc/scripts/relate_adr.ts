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
  supersedes: "superseded-by",
  "superseded-by": "supersedes",
  related: "related",
  refines: null,
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
  return "Usage: node scripts/relate_adr.ts --from <adr.md> --to <adr.md> --relation supersedes|superseded-by|related|refines [--dir <path>] [--write]";
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

function updateOne(cwd: string, relativeDir: string, file: string, relation: string, target: string, write: boolean): string {
  const fullPath = path.join(cwd, relativeDir, file);
  if (!fs.existsSync(fullPath)) throw new Error(`ADR not found: ${relativeDir}/${file}`);
  const next = ensureRelation(fs.readFileSync(fullPath, "utf8"), relation, target);
  if (write) fs.writeFileSync(fullPath, next, "utf8");
  return `${relativeDir}/${file}: ${relation} -> ${target}`;
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
    const operations = [updateOne(cwd, relativeDir, from, args.relation, to, args.write)];
    const inverse = inverseRelations[args.relation];
    if (inverse) operations.push(updateOne(cwd, relativeDir, to, inverse, from, args.write));
    console.log(args.write ? "Updated ADR relations:" : "DRY RUN: would update ADR relations:");
    for (const operation of operations) console.log(`- ${operation}`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
