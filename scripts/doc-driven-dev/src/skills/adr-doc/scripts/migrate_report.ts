#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { adrFiles, findAdrDir, hasSection } = require("./lib/adr_utils.ts");
const targetSections = [
  "Status",
  "Context and Problem Statement",
  "Decision Drivers",
  "Considered Options",
  "Decision Outcome",
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

type Migration = {
  actions: string[];
  file: string;
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
  return "Usage: node scripts/migrate_report.js [--dir <path>] [--json]";
}

async function migrationFor(cwd: string, relativeDir: string, file: string): Promise<Migration> {
  const content = fs.readFileSync(path.join(cwd, relativeDir, file), "utf8");
  const sectionPresence = await Promise.all(targetSections.map(async (section) => ({ section, present: await hasSection(content, section) })));
  const missingSections = sectionPresence.filter((item) => !item.present).map((item) => item.section);
  const actions: string[] = [];
  for (const field of ["id", "type", "status", "title", "created", "updated", "owners", "relations"]) {
    if (!new RegExp(`^${field}:\\s*(?:.+)?$`, "m").test(content)) actions.push(`Add ${field} metadata`);
  }
  for (const field of ["decision-makers", "consulted", "informed"]) {
    if (new RegExp(`^${field}:\\s*(?:.+)?$`, "m").test(content)) {
      actions.push(`Move ${field} under metadata.adr`);
    }
  }
  for (const field of ["created", "updated"]) {
    if (!new RegExp(`^${field}:\\s+"?\\d{4}-\\d{2}-\\d{2}"?$`, "m").test(content)) {
      actions.push(`Review ${field} metadata format`);
    }
  }
  if (missingSections.length > 0) actions.push(`Add or map sections: ${missingSections.join(", ")}`);
  if (!/^#\s+\d+\.\s+.+$/m.test(content)) actions.push("Review title format for MADR numbering");
  if (actions.length === 0) actions.push("No structural migration needed");
  return { file, actions };
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
    const migrations = await Promise.all(files.map((file) => migrationFor(cwd, relativeDir, file)));
    const report = { directory: relativeDir, migrations };

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`MADR migration report: ${relativeDir}`);
    for (const migration of migrations) {
      console.log(`\n${migration.file}`);
      for (const action of migration.actions) {
        console.log(`- ${action}`);
      }
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
