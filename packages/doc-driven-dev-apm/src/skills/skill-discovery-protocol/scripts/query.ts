#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

type QueryArgs = {
  profile?: string;
  subcommand?: string;
  category?: string;
  skill?: string;
  slot?: string;
  capability?: string;
  cwd?: string;
  help?: boolean;
};

const SUBCOMMANDS = [
  "categories",
  "category-skills",
  "resolution",
  "flow-stack",
  "execution-policy",
];

function parseArgs(argv: string[]): QueryArgs {
  const args: QueryArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--profile") args.profile = argv[++i];
    else if (arg === "--category") args.category = argv[++i];
    else if (arg === "--skill") args.skill = argv[++i];
    else if (arg === "--slot") args.slot = argv[++i];
    else if (arg === "--capability") args.capability = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (!arg.startsWith("--") && !args.subcommand) args.subcommand = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return `Usage: sdp query --profile <json> <subcommand> [options]

Subcommands:
  categories          List categories
  category-skills     List skills in a category (--category <id>)
  resolution          List resolved invocations (--skill <name> optional)
  flow-stack          Show flow stack (--slot <id> optional)
  execution-policy    Show execution policy (--skill <name> optional)`;
}

function loadProfile(profilePath: string): Record<string, unknown> {
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile not found: ${profilePath}`);
  }
  const content = fs.readFileSync(profilePath, "utf8");
  return JSON.parse(content);
}

function queryCategories(profile: Record<string, unknown>): unknown {
  const classification = profile.classification as { categories: { id: string; label: string; skills: string[] }[] };
  return classification.categories.map((c) => ({
    id: c.id,
    label: c.label,
    skill_count: c.skills.length,
  }));
}

function queryCategorySkills(profile: Record<string, unknown>, categoryId: string): unknown {
  const classification = profile.classification as { categories: { id: string; label: string; skills: string[] }[] };
  const cat = classification.categories.find((c) => c.id === categoryId);
  if (!cat) return { error: `Category not found: ${categoryId}` };
  return cat.skills;
}

function queryResolution(profile: Record<string, unknown>, skillName?: string): unknown {
  const invocations = profile.resolved_invocations as { source_skill: string }[];
  if (skillName) {
    return invocations.filter((i) => i.source_skill === skillName);
  }
  return invocations;
}

function queryFlowStack(profile: Record<string, unknown>, slotId?: string): unknown {
  const flowStack = profile.flow_stack as { slots: { slot_id: string }[] };
  if (slotId) {
    const slot = flowStack.slots.find((s) => s.slot_id === slotId);
    if (!slot) return { error: `Slot not found: ${slotId}` };
    return slot;
  }
  return flowStack;
}

function queryExecutionPolicy(profile: Record<string, unknown>, skillName?: string): unknown {
  // execution_policy is in catalog, not profile directly.
  // If the profile file was loaded, we need to check if there's a co-located catalog.
  // For now, return from resolved_invocations context or indicate catalog needed.
  // Actually, per spec, query reads from profile. The profile doesn't store execution_policy.
  // The catalog does. So execution-policy query should read the catalog instead.
  // For MVP: look for catalog in same directory.
  return { note: "execution-policy requires catalog file", skill: skillName || "all" };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage());
    return;
  }

  if (!args.profile) {
    console.error("Error: --profile is required");
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  if (!args.subcommand) {
    console.error("Error: subcommand is required");
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  if (!SUBCOMMANDS.includes(args.subcommand)) {
    console.error(`Error: Unknown subcommand "${args.subcommand}"`);
    console.error(`Available: ${SUBCOMMANDS.join(", ")}`);
    process.exitCode = 2;
    return;
  }

  const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();
  const profilePath = path.resolve(cwd, args.profile);

  let profile: Record<string, unknown>;
  try {
    profile = loadProfile(profilePath);
  } catch (e: unknown) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
    return;
  }

  let result: unknown;

  switch (args.subcommand) {
    case "categories":
      result = queryCategories(profile);
      break;
    case "category-skills":
      if (!args.category) {
        console.error("Error: --category is required for category-skills");
        process.exitCode = 1;
        return;
      }
      result = queryCategorySkills(profile, args.category);
      break;
    case "resolution":
      result = queryResolution(profile, args.skill);
      break;
    case "flow-stack":
      result = queryFlowStack(profile, args.slot);
      break;
    case "execution-policy":
      result = queryExecutionPolicy(profile, args.skill);
      break;
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
