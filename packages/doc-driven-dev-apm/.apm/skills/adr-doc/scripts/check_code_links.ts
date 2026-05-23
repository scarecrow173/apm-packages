#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { adrFiles, findAdrDir, referencedPaths, sectionBody } = require("./lib/adr_utils.ts");

type CliArgs = {
  cwd: string;
  dir?: string;
  help?: boolean;
  json: boolean;
};

type Finding = {
  code: string;
  file: string;
  message: string;
  severity: "warning";
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
  return "Usage: node scripts/check_code_links.ts [--dir <path>] [--json]";
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
    const adrDir = path.join(cwd, relativeDir);
    const findings: Finding[] = [];
    for (const file of adrFiles(adrDir)) {
      const content = fs.readFileSync(path.join(adrDir, file), "utf8");
      const implementation = await sectionBody(content, "Implementation Plan");
      for (const target of await referencedPaths(implementation)) {
        const resolved = path.resolve(path.dirname(path.join(adrDir, file)), target);
        if (!fs.existsSync(resolved)) {
          findings.push({ severity: "warning", file, code: "missing-implementation-path", message: `Implementation Plan references missing path: ${target}` });
        }
      }
    }
    const report = { directory: relativeDir, findings };
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`ADR code link check: ${relativeDir}`);
    if (findings.length === 0) {
      console.log("No findings.");
      return;
    }
    for (const finding of findings) console.log(`[${finding.severity}] ${relativeDir}/${finding.file}: ${finding.message}`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
