#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv: string[]): { profile?: string; adapter?: string; cwd?: string; help?: boolean } {
  const args: { profile?: string; adapter?: string; cwd?: string; help?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--profile") args.profile = argv[++i];
    else if (arg === "--adapter") args.adapter = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: sdp validate --profile <json> | --adapter <yaml> [--cwd <dir>]";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage());
    return;
  }

  if (!args.profile && !args.adapter) {
    console.error("Error: --profile or --adapter is required");
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();

  if (args.profile) {
    const profilePath = path.resolve(cwd, args.profile);
    if (!fs.existsSync(profilePath)) {
      console.error(`Error: Profile not found: ${args.profile}`);
      process.exitCode = 1;
      return;
    }

    const content = fs.readFileSync(profilePath, "utf8");
    let profile;
    try {
      profile = JSON.parse(content);
    } catch {
      console.error(`Error: Invalid JSON in ${args.profile}`);
      process.exitCode = 1;
      return;
    }

    // Basic schema validation
    const errors: string[] = [];
    if (!profile.schema_version) errors.push("Missing schema_version");
    if (!profile.profile_id) errors.push("Missing profile_id");
    if (!profile.adapter_id) errors.push("Missing adapter_id");
    if (!profile.flow_stack) errors.push("Missing flow_stack");
    if (!profile.classification) errors.push("Missing classification");
    if (!profile.resolved_invocations) errors.push("Missing resolved_invocations");

    if (errors.length > 0) {
      console.error("Validation failed:");
      for (const e of errors) console.error(`  - ${e}`);
      process.exitCode = 1;
      return;
    }

    console.log("Validation passed.");
    return;
  }

  if (args.adapter) {
    const { loadAdapter } = require("./lib/adapter.ts");
    const adapterPath = path.resolve(cwd, args.adapter);
    try {
      loadAdapter(adapterPath);
      console.log("Adapter validation passed.");
    } catch (e: unknown) {
      console.error(`Adapter validation failed: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
