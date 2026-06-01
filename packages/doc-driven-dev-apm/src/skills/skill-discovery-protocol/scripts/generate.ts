#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("node:fs");

const { loadAdapter } = require("./lib/adapter.ts");
const { scanSkills } = require("./lib/scanner.ts");
const { buildCatalog } = require("./lib/catalog.ts");
const { classifySkills } = require("./lib/classifier.ts");
const { resolveInvocations } = require("./lib/resolver.ts");
const { buildProfile } = require("./lib/profile.ts");
const { stabilizeCatalog, stabilizeProfile, writeArtifact } = require("./lib/renderer.ts");
const {
  writeScanList,
  loadScanList,
  defaultInferencePath,
  loadInferenceDocument,
  enrichSkills,
} = require("./lib/inference.ts");

function parseArgs(argv: string[]): { adapter?: string; cwd?: string; references?: string; help?: boolean } {
  const args: { adapter?: string; cwd?: string; references?: string; help?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--adapter") args.adapter = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--references") args.references = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: sdp generate --adapter <adapter-yaml> [--references <json>] [--cwd <dir>]";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage());
    return;
  }

  if (!args.adapter) {
    console.error("Error: --adapter is required");
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();
  const adapterPath = path.resolve(cwd, args.adapter);

  let adapter;
  try {
    adapter = loadAdapter(adapterPath);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Error loading adapter: ${msg}`);
    // Schema validation errors from Zod contain field-level details
    process.exitCode = msg.includes("Adapter validation failed") ? 2 : 1;
    return;
  }

  // 1. Scan skill sources and persist the scan artifact.
  const rawSkills = scanSkills(cwd, adapter);
  if (rawSkills.length === 0) {
    console.log("No skills found in scan scopes.");
  }
  const scanListPath = writeScanList(cwd, rawSkills);
  const scanList = loadScanList(scanListPath);

  const inferencePath = args.references ? path.resolve(cwd, args.references) : defaultInferencePath(cwd);
  let inferenceDoc;
  try {
    inferenceDoc = loadInferenceDocument(inferencePath);
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 2;
    return;
  }

  if (!inferenceDoc) {
    console.error(`Skill reference inference required. Wrote scan list: ${scanListPath}`);
    process.exitCode = 2;
    return;
  }

  let skills;
  try {
    skills = enrichSkills(scanList.skills, inferenceDoc);
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 2;
    return;
  }

  // 2. Build Skill Reference Catalog
  const catalog = stabilizeCatalog(buildCatalog(skills));

  // 3. Classify skills
  const { categories, unmatched_skills } = classifySkills(skills, adapter);

  // 4. Resolve invocations
  const resolvedInvocations = resolveInvocations(skills, adapter);

  // 5. Build Flow Profile
  const profile = stabilizeProfile(
    buildProfile(adapter, catalog, categories, unmatched_skills, resolvedInvocations, skills),
  );

  // 6. Write artifacts (resolved relative to .sdp/ base directory)
  const sdpBase = path.resolve(cwd, ".sdp");
  const catalogPath = adapter.artifacts.protocol.skill_reference_catalog;
  const profilePath = adapter.artifacts.protocol.flow_profile;

  let filesWritten = 0;

  if (catalogPath) {
    const absPath = path.resolve(sdpBase, catalogPath);
    const relPath = path.relative(cwd, absPath);
    if (writeArtifact(absPath, catalog as unknown as Record<string, unknown>)) {
      console.log(`Written: ${relPath}`);
      filesWritten++;
    } else {
      console.log(`Unchanged: ${relPath}`);
    }
  }

  if (profilePath) {
    const absPath = path.resolve(sdpBase, profilePath);
    const relPath = path.relative(cwd, absPath);
    if (writeArtifact(absPath, profile as unknown as Record<string, unknown>)) {
      console.log(`Written: ${relPath}`);
      filesWritten++;
    } else {
      console.log(`Unchanged: ${relPath}`);
    }
  }

  if (filesWritten === 0) {
    console.log("All artifacts up to date.");
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
