#!/usr/bin/env node
"use strict";

import path from "node:path";
import fs from "node:fs";
import { createDocument, logIndexResult } from "../../lib/doc_suite_utils";

const TEST_SPEC_DOC_GATE_ERROR = "TEST-SPEC-DOC-GATE-001: at least one --verifies target resolving to an existing document is required before creating a test spec.";

type CliArgs = {
  cwd: string;
  date?: string;
  derivesFrom: string[];
  dir?: string;
  name?: string;
  forceIndex?: boolean;
  noIndex?: boolean;
  help?: boolean;
  status?: string;
  title?: string;
  verifies: string[];
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), derivesFrom: [], verifies: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title") args.title = argv[++i];
    else if (arg === "--verifies") args.verifies.push(argv[++i]);
    else if (arg === "--derives-from") args.derivesFrom.push(argv[++i]);
    else if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--name") args.name = argv[++i];
    else if (arg === "--no-index") args.noIndex = true;
    else if (arg === "--force-index") args.forceIndex = true;
    else if (arg === "--status") args.status = argv[++i];
    else if (arg === "--date") args.date = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (!args.title) args.title = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.noIndex && args.forceIndex) throw new Error("--no-index and --force-index cannot be used together");
  return args;
}

function usage(): string {
  return "Usage: node scripts/new_test_spec.js --title <title> --verifies <doc> [--verifies <doc>...] [--derives-from <doc>...] [--dir <path>] [--name <filename>] [--status <status>] [--no-index] [--force-index]";
}

function validateVerifiesGate(cwd: string, verifies: string[]): void {
  if (verifies.length === 0) throw new Error(TEST_SPEC_DOC_GATE_ERROR);
  for (const target of verifies) {
    const resolved = path.resolve(cwd, target);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new Error(TEST_SPEC_DOC_GATE_ERROR);
    }
  }
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.title) throw new Error("Missing required --title");
    const resolvedCwd = path.resolve(args.cwd);
    validateVerifiesGate(resolvedCwd, args.verifies);
    const result = await createDocument("test-spec", {
      cwd: resolvedCwd,
      date: args.date,
      dir: args.dir,
      name: args.name,
      forceIndex: args.forceIndex,
      noIndex: args.noIndex,
      relations: {
        verifies: [...new Set(args.verifies)],
        "derives-from": [...new Set(args.derivesFrom)],
      },
      status: args.status,
      title: args.title,
    });
    console.log(`Created ${result.file}`);
    logIndexResult(result);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
