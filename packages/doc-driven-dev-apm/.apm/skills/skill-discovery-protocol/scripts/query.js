#!/usr/bin/env node
"use strict";

// src/skills/skill-discovery-protocol/scripts/query.ts
var fs = require("node:fs");
var path = require("node:path");
var SUBCOMMANDS = [
  "categories",
  "category-skills",
  "resolution",
  "flow-stack",
  "execution-policy"
];
function parseArgs(argv) {
  const args = {};
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
function usage() {
  return `Usage: sdp query --profile <json> <subcommand> [options]

Subcommands:
  categories          List categories
  category-skills     List skills in a category (--category <id>)
  resolution          List resolved invocations (--skill <name> optional)
  flow-stack          Show flow stack (--slot <id> optional)
  execution-policy    Show execution policy (--skill <name> optional)`;
}
function loadProfile(profilePath) {
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile not found: ${profilePath}`);
  }
  const content = fs.readFileSync(profilePath, "utf8");
  return JSON.parse(content);
}
function queryCategories(profile) {
  const classification = profile.classification;
  return classification.categories.map((c) => ({
    id: c.id,
    label: c.label,
    skill_count: c.skills.length
  }));
}
function queryCategorySkills(profile, categoryId) {
  const classification = profile.classification;
  const cat = classification.categories.find((c) => c.id === categoryId);
  if (!cat) return { error: `Category not found: ${categoryId}` };
  return cat.skills;
}
function queryResolution(profile, skillName) {
  const invocations = profile.resolved_invocations;
  if (skillName) {
    return invocations.filter((i) => i.source_skill === skillName);
  }
  return invocations;
}
function queryFlowStack(profile, slotId) {
  const flowStack = profile.flow_stack;
  if (slotId) {
    const slot = flowStack.slots.find((s) => s.slot_id === slotId);
    if (!slot) return { error: `Slot not found: ${slotId}` };
    return slot;
  }
  return flowStack;
}
function queryExecutionPolicy(profile, skillName) {
  return { note: "execution-policy requires catalog file", skill: skillName || "all" };
}
async function main() {
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
  let profile;
  try {
    profile = loadProfile(profilePath);
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
    return;
  }
  let result;
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
main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
