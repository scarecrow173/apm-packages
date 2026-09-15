#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import path from "node:path";

import { loadAdapter } from "./lib/adapter";
import { buildCatalog } from "./lib/catalog";
import { classifySkills } from "./lib/classifier";
import { resolveInvocations } from "./lib/resolver";
import { buildProfile } from "./lib/profile";
import { stabilizeCatalog, stabilizeProfile, writeArtifact } from "./lib/renderer";
import { defaultScanListPath, loadScanList, defaultInferencePath, loadInferenceDocument, assertInferenceComplete, enrichSkills } from "./lib/inference";
import { resolveSharedCatalogPath, resolveFlowProfilePath } from "./lib/artifact_paths";

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
  return "Usage: sdp profile --adapter <adapter-yaml> [--references <json>] [--cwd <dir>]";
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
    process.exitCode = msg.includes("Adapter validation failed") ? 2 : 1;
    return;
  }

  const scanListPath = defaultScanListPath(cwd);
  if (!fs.existsSync(scanListPath)) {
    const adapterHint = path.relative(cwd, adapterPath) || path.basename(adapterPath);
    console.error(`Skill scan list required. Expected: ${scanListPath}`);
    console.error("Run scan and retry:");
    console.error(`  sdp scan --adapter \"${adapterHint}\"`);
    process.exitCode = 2;
    return;
  }

  let scanList;
  try {
    scanList = loadScanList(scanListPath);
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 2;
    return;
  }

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
    const scanPathForHint = path.relative(cwd, scanListPath) || path.basename(scanListPath);
    const inferencePathForHint = path.relative(cwd, inferencePath) || path.basename(inferencePath);
    console.error(`Skill reference inference required. Scan list found: ${scanListPath}`);
    console.error("Run inference and retry:");
    console.error(`  sdp infer init --scan \"${scanPathForHint}\" --out \"${inferencePathForHint}\" --if-exists overwrite`);
    process.exitCode = 2;
    return;
  }

  try {
    assertInferenceComplete(scanList, inferenceDoc);
  } catch (e: unknown) {
    const scanPathForHint = path.relative(cwd, scanListPath) || path.basename(scanListPath);
    const inferencePathForHint = path.relative(cwd, inferencePath) || path.basename(inferencePath);
    console.error(e instanceof Error ? e.message : String(e));
    console.error("Run inference review and retry:");
    console.error(`  sdp infer check --in \"${inferencePathForHint}\" --scan \"${scanPathForHint}\"`);
    process.exitCode = 3;
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

  const catalog = stabilizeCatalog(buildCatalog(skills));
  const { categories, unmatched_skills } = classifySkills(skills, adapter);
  const resolvedInvocations = resolveInvocations(skills, adapter);
  const profile = stabilizeProfile(
    buildProfile(adapter, catalog, categories, unmatched_skills, resolvedInvocations, skills),
  );

  const catalogPath = adapter.artifacts.protocol.skill_reference_catalog;
  const flowProfilePath = adapter.artifacts.protocol.flow_profile;

  let filesWritten = 0;

  if (catalogPath) {
    const absPath = resolveSharedCatalogPath(cwd, catalogPath);
    const relPath = path.relative(cwd, absPath);
    if (writeArtifact(absPath, catalog as unknown as Record<string, unknown>)) {
      console.log(`Written: ${relPath}`);
      filesWritten++;
    } else {
      console.log(`Unchanged: ${relPath}`);
    }
  }

  if (flowProfilePath) {
    const absPath = resolveFlowProfilePath(cwd, adapter.adapter_id, flowProfilePath);
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
