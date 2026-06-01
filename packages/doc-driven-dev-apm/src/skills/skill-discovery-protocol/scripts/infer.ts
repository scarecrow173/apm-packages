#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { defaultScanListPath, defaultInferencePath, loadScanList } = require("./lib/inference.ts");
const { buildInferenceDocument } = require("./lib/infer_builder.ts");
const { SkillReferenceInferenceDocumentSchema } = require("./lib/schemas/inference.ts");

function parseArgs(argv: string[]): { scan?: string; out?: string; cwd?: string; help?: boolean } {
  const args: { scan?: string; out?: string; cwd?: string; help?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scan") args.scan = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return `Usage: sdp infer [--scan <json>] [--out <json>] [--cwd <dir>]

Options:
  --scan  Path to skill-scan-list.json (default: .sdp/skill-scan-list.json)
  --out   Path to skill-reference-inferences.json (default: .sdp/skill-reference-inferences.json)
  --cwd   Working directory (default: process.cwd())`;
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

  if (!fs.existsSync(scanPath)) {
    console.error(`Scan list not found: ${scanPath}`);
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

  const doc = buildInferenceDocument(scanList.skills);
  const parsed = SkillReferenceInferenceDocumentSchema.safeParse(doc);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue: { path: (string | number)[]; message: string }) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    console.error(`Generated inference document failed schema validation: ${details}`);
    process.exitCode = 1;
    return;
  }

  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(outPath, JSON.stringify(parsed.data, null, 2) + "\n", "utf8");
  console.log(`Written: ${path.relative(cwd, outPath)}`);
}

main();
