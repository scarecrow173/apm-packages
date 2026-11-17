#!/usr/bin/env node
"use strict";

import path from "node:path";
import { createDocument, logIndexResult } from "../../lib/doc_suite_utils";
import { schemaEntrypointGuard } from "../../lib/schema_preflight";
import { canonicalCheck } from "../../lib/verification_checks";
import { assembleChecks, verifyCheckTargets } from "./lib/verification_doc";

type CliArgs = {
  checks: string[];
  cwd: string;
  date?: string;
  dir?: string;
  from: string[];
  lifecycle?: string;
  name?: string;
  forceIndex?: boolean;
  noIndex?: boolean;
  help?: boolean;
  status?: string;
  supersedes: string[];
  title?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { checks: [], cwd: process.cwd(), from: [], supersedes: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title") args.title = argv[++i];
    else if (arg === "--check") args.checks.push(argv[++i]);
    else if (arg === "--from") args.from.push(argv[++i]);
    else if (arg === "--supersedes") args.supersedes.push(argv[++i]);
    else if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--name") args.name = argv[++i];
    else if (arg === "--no-index") args.noIndex = true;
    else if (arg === "--force-index") args.forceIndex = true;
    else if (arg === "--status") args.status = argv[++i];
    else if (arg === "--lifecycle") args.lifecycle = argv[++i];
    else if (arg === "--date") args.date = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (!args.title) args.title = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/new_verification.js --title <title> [--check '<json>']... [--from <source>] [--supersedes <verification-doc>] [--dir <path>] [--name <filename>] [--status <status>] [--lifecycle <lifecycle>]";
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.title) throw new Error("Missing required --title");
    const cwd = path.resolve(args.cwd);
    if (!schemaEntrypointGuard(cwd)) return;
    // The `checks:` front-matter array is the Check contract's sole
    // authority — every `--check` payload is a full VerificationCheckV1
    // minus `id` (allocated CHK-NN here) and must satisfy the complete
    // schema and resolve a live Claim target before any file is written
    // (Issue #239).
    const assembled = assembleChecks(args.checks, []);
    if (assembled.error) throw new Error(assembled.error);
    if (assembled.checks.length > 0) {
      const targets = await verifyCheckTargets(cwd, assembled.checks);
      if (targets.error) throw new Error(targets.error);
    }
    const result = await createDocument("verification", {
      cwd,
      date: args.date,
      dir: args.dir,
      // `checks:` is written even when empty — the field's presence keeps
      // the Check contract visible in every new Verification Design.
      fields: { checks: assembled.checks.map(canonicalCheck) },
      lifecycle: args.lifecycle,
      name: args.name,
      relations: {
        source: args.from,
        supersedes: args.supersedes,
      },
      status: args.status,
      title: args.title,
    });
    console.log(`Created ${result.file}`);
    logIndexResult(result);
    if (args.noIndex || args.forceIndex) {
      console.log("Note: --no-index/--force-index are deprecated and have no effect; indexes are materialized via doc_maintenance.js index plan|apply");
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
