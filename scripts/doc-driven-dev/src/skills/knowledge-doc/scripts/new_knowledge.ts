#!/usr/bin/env node
"use strict";

import path from "node:path";
import { createDocument, logIndexResult } from "../../lib/doc_suite_utils";
import { configFor } from "../../lib/doc_types";
import { schemaEntrypointGuard } from "../../lib/schema_preflight";

const KNOWLEDGE_KINDS: readonly string[] = configFor("knowledge").fieldVocabularies.knowledge_kind ?? [];

type CliArgs = {
  cwd: string;
  date?: string;
  dir?: string;
  explains: string[];
  from: string[];
  informs: string[];
  supersedes: string[];
  kind?: string;
  lifecycle?: string;
  name?: string;
  forceIndex?: boolean;
  noIndex?: boolean;
  help?: boolean;
  status?: string;
  title?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), explains: [], from: [], informs: [], supersedes: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title") args.title = argv[++i];
    else if (arg === "--kind") args.kind = argv[++i];
    else if (arg === "--from") args.from.push(argv[++i]);
    else if (arg === "--informs") args.informs.push(argv[++i]);
    else if (arg === "--explains") args.explains.push(argv[++i]);
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
  return `Usage: node scripts/new_knowledge.js --title <title> --kind <${KNOWLEDGE_KINDS.join("|")}> [--from <source>] [--informs <doc>] [--explains <doc>] [--supersedes <doc>] [--dir <path>] [--name <filename>] [--status <status>] [--lifecycle <lifecycle>]`;
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.title) throw new Error("Missing required --title");
    if (!args.kind) throw new Error(`Missing required --kind (expected one of: ${KNOWLEDGE_KINDS.join(", ")})`);
    if (!KNOWLEDGE_KINDS.includes(args.kind)) {
      throw new Error(`Invalid knowledge kind: ${args.kind} (expected one of: ${KNOWLEDGE_KINDS.join(", ")})`);
    }
    // The extraction contract (Issue #242): `confirmed` marks verified,
    // reviewed knowledge — it always carries recorded provenance. An
    // unverified guess is never saved as certain; it stays `draft`.
    if (args.status === "confirmed" && args.from.length === 0) {
      throw new Error("--status confirmed requires at least one --from source (unverified findings stay draft)");
    }
    const cwd = path.resolve(args.cwd);
    if (!schemaEntrypointGuard(cwd)) return;
    const result = await createDocument("knowledge", {
      cwd,
      date: args.date,
      dir: args.dir,
      fields: { knowledge_kind: args.kind },
      lifecycle: args.lifecycle,
      name: args.name,
      relations: {
        source: args.from,
        informs: args.informs,
        explains: args.explains,
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
