#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  defaultScanListPath,
  defaultInferencePath,
  loadScanList,
  readInferenceOrThrow,
  writeInferenceDocument,
} = require("./lib/inference.ts");
const { SkillReferenceInferenceDocumentSchema } = require("./lib/schemas/inference.ts");
const {
  buildInitDocument,
  mergeInitWithExisting,
  parseOpsJsonl,
  applyOps,
  upsertSkill,
  deleteSkill,
} = require("./lib/infer_edit.ts");

type InferCommand = "init" | "apply" | "check" | "set-skill" | "delete-skill";

function parseCommand(argv: string[]): { command: InferCommand; rest: string[] } {
  const head = argv[0];
  if (!head || head.startsWith("-")) {
    return { command: "init", rest: argv };
  }

  if (head === "init" || head === "apply" || head === "check" || head === "set-skill" || head === "delete-skill") {
    return { command: head, rest: argv.slice(1) };
  }

  return { command: "init", rest: argv };
}

function parseArgs(argv: string[]): {
  command: InferCommand;
  scan?: string;
  out?: string;
  in?: string;
  cwd?: string;
  ops?: string;
  name?: string;
  spec?: string;
  ifExists?: "fail" | "overwrite" | "merge";
  dryRun?: boolean;
  help?: boolean;
} {
  const parsedCommand = parseCommand(argv);
  const args: {
    command: InferCommand;
    scan?: string;
    out?: string;
    in?: string;
    cwd?: string;
    ops?: string;
    name?: string;
    spec?: string;
    ifExists?: "fail" | "overwrite" | "merge";
    dryRun?: boolean;
    help?: boolean;
  } = { command: parsedCommand.command };

  const tokens = parsedCommand.rest;
  for (let i = 0; i < tokens.length; i++) {
    const arg = tokens[i];
    if (
      arg === "--scan"
      || arg === "--out"
      || arg === "--in"
      || arg === "--cwd"
      || arg === "--ops"
      || arg === "--name"
      || arg === "--spec"
      || arg === "--if-exists"
    ) {
      const next = tokens[i + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(`Option ${arg} requires a value`);
      }

      if (arg === "--scan") args.scan = next;
      else if (arg === "--out") args.out = next;
      else if (arg === "--in") args.in = next;
      else if (arg === "--cwd") args.cwd = next;
      else if (arg === "--ops") args.ops = next;
      else if (arg === "--name") args.name = next;
      else if (arg === "--spec") args.spec = next;
      else if (arg === "--if-exists") {
        if (next !== "fail" && next !== "overwrite" && next !== "merge") {
          throw new Error(`Option --if-exists must be one of: fail, overwrite, merge`);
        }
        args.ifExists = next;
      }
      i++;
    }
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function usage(): string {
  return `Usage:
  sdp infer init [--scan <json>] [--out <json>] [--cwd <dir>] [--if-exists <fail|overwrite|merge>]
  sdp infer apply --ops <jsonl> --in <json> [--out <json>] [--cwd <dir>] [--dry-run]
  sdp infer check --in <json> [--cwd <dir>]
  sdp infer set-skill --name <skill> --spec <json> --in <json> [--out <json>] [--cwd <dir>] [--dry-run]
  sdp infer delete-skill --name <skill> --in <json> [--out <json>] [--cwd <dir>] [--dry-run]

Options:
  --scan  Path to skill-scan-list.json (default: .sdp/skill-scan-list.json)
  --in    Path to existing skill-reference-inferences.json (default: .sdp/skill-reference-inferences.json)
  --out   Path to skill-reference-inferences.json (default: .sdp/skill-reference-inferences.json)
  --cwd   Working directory (default: process.cwd())
  --ops   Path to JSONL operation file for apply command
  --name  Skill name for set-skill/delete-skill commands
  --spec  Path to JSON file used by set-skill command
  --if-exists  init behavior when output exists: fail|overwrite|merge (default: fail)
  --dry-run  Validate changes but do not write output`;
}

function main(): void {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e: unknown) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  if (args.help) {
    console.log(usage());
    return;
  }

  const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();
  const scanPath = args.scan ? path.resolve(cwd, args.scan) : defaultScanListPath(cwd);
  const outPath = args.out ? path.resolve(cwd, args.out) : defaultInferencePath(cwd);
  const inPath = args.in ? path.resolve(cwd, args.in) : defaultInferencePath(cwd);

  if (args.command === "check") {
    try {
      readInferenceOrThrow(inPath);
      console.log("Inference document is valid");
      return;
    } catch (e: unknown) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 2;
      return;
    }
  }

  if (args.command === "init") {
    if (!fs.existsSync(scanPath)) {
      console.error(`Scan list not found: ${scanPath}`);
      process.exitCode = 2;
      return;
    }

    const behavior = args.ifExists ?? "fail";
    if (fs.existsSync(outPath) && behavior === "fail") {
      console.error(`Inference file already exists: ${outPath}. Use --if-exists overwrite|merge`);
      process.exitCode = 2;
      return;
    }

    let scanList;
    try {
      scanList = loadScanList(scanPath);
    } catch (e: unknown) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 2;
      return;
    }

    let doc = buildInitDocument(scanList);
    if (behavior === "merge" && fs.existsSync(outPath)) {
      try {
        const existing = readInferenceOrThrow(outPath);
        doc = mergeInitWithExisting(doc, existing);
      } catch (e: unknown) {
        console.error(e instanceof Error ? e.message : String(e));
        process.exitCode = 2;
        return;
      }
    }

    const parsed = SkillReferenceInferenceDocumentSchema.safeParse(doc);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue: { path: (string | number)[]; message: string }) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      console.error(`Generated inference document failed schema validation: ${details}`);
      process.exitCode = 1;
      return;
    }

    if (!args.dryRun) {
      writeInferenceDocument(outPath, parsed.data);
      console.log(`Written: ${path.relative(cwd, outPath)}`);
    } else {
      console.log(`dry-run: would write ${path.relative(cwd, outPath)}`);
    }
    return;
  }

  if (args.command === "apply") {
    if (!args.ops) {
      console.error("Option --ops requires a value");
      process.exitCode = 2;
      return;
    }

    const opsPath = path.resolve(cwd, args.ops);
    if (!fs.existsSync(opsPath)) {
      console.error(`Operation file not found: ${opsPath}`);
      process.exitCode = 2;
      return;
    }

    try {
      const base = readInferenceOrThrow(inPath);
      const ops = parseOpsJsonl(fs.readFileSync(opsPath, "utf8"));
      const next = applyOps(base, ops);
      const parsed = SkillReferenceInferenceDocumentSchema.safeParse(next);
      if (!parsed.success) {
        const details = parsed.error.issues
          .map((issue: { path: (string | number)[]; message: string }) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ");
        throw new Error(`Edited inference failed schema validation: ${details}`);
      }

      if (!args.dryRun) {
        writeInferenceDocument(outPath, parsed.data);
        console.log(`Written: ${path.relative(cwd, outPath)}`);
      } else {
        console.log(`dry-run: would apply ${ops.length} op(s)`);
      }
      return;
    } catch (e: unknown) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 2;
      return;
    }
  }

  if (args.command === "set-skill") {
    if (!args.name || !args.spec) {
      console.error("set-skill requires --name and --spec");
      process.exitCode = 2;
      return;
    }

    const specPath = path.resolve(cwd, args.spec);
    if (!fs.existsSync(specPath)) {
      console.error(`Skill spec not found: ${specPath}`);
      process.exitCode = 2;
      return;
    }

    try {
      const base = readInferenceOrThrow(inPath);
      const skillSpec = JSON.parse(fs.readFileSync(specPath, "utf8"));
      const next = upsertSkill(base, args.name, skillSpec);
      const parsed = SkillReferenceInferenceDocumentSchema.safeParse(next);
      if (!parsed.success) {
        const details = parsed.error.issues
          .map((issue: { path: (string | number)[]; message: string }) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ");
        throw new Error(`Edited inference failed schema validation: ${details}`);
      }

      if (!args.dryRun) {
        writeInferenceDocument(outPath, parsed.data);
        console.log(`Written: ${path.relative(cwd, outPath)}`);
      } else {
        console.log(`dry-run: would set skill ${args.name}`);
      }
      return;
    } catch (e: unknown) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 2;
      return;
    }
  }

  if (args.command === "delete-skill") {
    if (!args.name) {
      console.error("delete-skill requires --name");
      process.exitCode = 2;
      return;
    }

    try {
      const base = readInferenceOrThrow(inPath);
      const next = deleteSkill(base, args.name);
      const parsed = SkillReferenceInferenceDocumentSchema.safeParse(next);
      if (!parsed.success) {
        const details = parsed.error.issues
          .map((issue: { path: (string | number)[]; message: string }) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ");
        throw new Error(`Edited inference failed schema validation: ${details}`);
      }

      if (!args.dryRun) {
        writeInferenceDocument(outPath, parsed.data);
        console.log(`Written: ${path.relative(cwd, outPath)}`);
      } else {
        console.log(`dry-run: would delete skill ${args.name}`);
      }
      return;
    } catch (e: unknown) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 2;
      return;
    }
  }

  console.error(`Unknown command: ${args.command}`);
  process.exitCode = 2;
}

main();
